import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FixtureRunner, fixtures, permutationDraws } from "../scripts/scoring/fixture-runner.ts";
import { readInput, verifyArchive } from "../scripts/scoring/research-log.ts";
import { initializeFeatureGameState } from "../src/game.ts";
import { createInitialGame } from "../src/setup.ts";
import { captureMechanismEvents } from "../src/mechanism-observer.ts";

for (const fixture of fixtures) test(`SCORE ${fixture.id}: ${fixture.title}`, () => {
  const runner = new FixtureRunner(fixture.id).run(fixture);
  assert.equal(runner.room.game!.state.status, "playing");
  const replay = new FixtureRunner(fixture.id, { replay: runner.random.recorded }).run(fixture);
  assert.deepEqual(replay.room, runner.room);
  assert.deepEqual(replay.random.recorded, runner.random.recorded);
  assert.deepEqual(replay.log.rows, runner.log.rows);
});

export function pendingB(id = "B-transactions") {
  const fixture = fixtures.find(f => f.id === "JF03");
  const runner = new FixtureRunner(id);
  for (const action of [...fixture.prefix, ...fixture.actions.slice(0, -1)]) runner.execute(action);
  assert.equal(runner.room.game!.state.pendingShuffle!.window, "B");
  return runner;
}

test("SCORE B stale/wrong actor/invalid ability reject, successful action replays exactly once", () => {
  const runner = pendingB();
  const wash = runner.commandFor({ kind: "shuffle_choice", choice: "wash" }, "B-once");
  const before = structuredClone(runner.room);
  assert.equal(runner.submit({ ...wash, expectedRevision: wash.expectedRevision - 1 }, "B").errorCode, "STALE_REVISION");
  assert.equal(runner.submit(wash, "A").errorCode, "WRONG_TURN");
  assert.equal(runner.submit({ ...wash, ability: "insight" } as any, "B").errorCode, "NO_SHUFFLE_WINDOW");
  assert.deepEqual(runner.room, before);
  const commit = runner.submit(wash, "B");
  assert.equal(commit.outcome, "committed");
  assert.equal(runner.room.game!.state.formalTurns!.black, 2);
  assert.equal(runner.room.game!.state.lastCompletedFormalTurn!.mainActionId, before.game!.state.lastCompletedFormalTurn!.mainActionId);
  assert(!commit.sourceEvents.some(e => (e.kind === "formal_turn_begin" || e.kind === "formal_turn_end") && e.details.side === "black"));
  const after = structuredClone(runner.room);
  const draws = runner.random.recorded.length;
  assert.equal(runner.submit(wash, "B").outcome, "duplicate");
  assert.deepEqual(runner.room, after);
  assert.equal(runner.random.recorded.length, draws);
  const commits = runner.log.rows.authoritative.filter(row => row.kind === "commit" && row.action_id === wash.actionId);
  assert.equal(commits.length, 1);
});

test("SCORE A never adds a formal turn; skipped B counts only after its actual ordinary action", () => {
  const a = new FixtureRunner("A-count");
  const f = fixtures.find(f => f.id === "JF02");
  a.run(f);
  assert.equal(a.room.game!.state.formalTurns!.black, 1);
  const reset = a.attempts.at(-1)!.sourceEvents.find(e => e.kind === "shuffle_reset")!;
  assert.equal(reset.state.heroRuntime!.red!.pupil, 0);
  const grant = a.attempts.at(-1)!.sourceEvents.find(e => e.kind === "pupil_grant")!;
  assert.equal(grant.details.side, "red");
  assert.equal(grant.details.number, 2);
  assert.equal(grant.details.amount, 6);
  const b = new FixtureRunner("B-skip-count").run(fixtures.find(f => f.id === "JF04"));
  assert.equal(b.room.game!.state.formalTurns!.black, 1);
  assert.equal(b.room.game!.state.turnLifecycle!.number, 2);
  assert.equal(b.room.game!.state.formalClock!.side, "black");
  assert.equal(b.room.game!.state.formalClock!.number, 2);
  assert.equal(b.room.game!.state.turnDeadlineAt, b.attempts.at(-1)!.now + 60_000);
  const blackMove = fixtures.find(f => f.id === "JF06").prefix.find(p => p.kind === "ordinary_move" && p.side === "black" && p.own_formal_turn === 2);
  b.execute(blackMove);
  assert.equal(b.room.game!.state.formalTurns!.black, 2);
});

test("SCORE observer is passive: all nine final states, RNG tapes and clock values match with capture disabled", () => {
  for (const fixture of fixtures) {
    const observed = new FixtureRunner(fixture.id).run(fixture);
    const silent = new FixtureRunner(fixture.id, { observer: false }).run(fixture);
    assert.deepEqual(silent.room, observed.room);
    assert.deepEqual(silent.random.recorded, observed.random.recorded);
    assert.equal(silent.now, observed.now);
  }
});

test("SCORE private targets/payloads stay in owner and authority projections", () => {
  for (const id of ["JF03", "JF06", "JF07"]) {
    const runner = new FixtureRunner(id).run(fixtures.find(f => f.id === id));
    for (const row of [...runner.log.rows.public, ...runner.log.rows.actor_B_private]) {
      for (const snapshot of [row.before, row.after]) {
        assert.equal(snapshot.secret, undefined);
        assert.equal(snapshot.ownHeroSecrets?.insights, undefined);
        assert.equal(snapshot.state?.identities, undefined);
        assert.equal(snapshot.fields, undefined);
      }
    }
    const insight = runner.attempts.find(a => a.command.ability === "insight" && a.outcome === "committed")!;
    const publicRow = runner.log.rows.public.find(row => row.event_id === insight.attemptId)!;
    assert.equal(publicRow.own_attempt, undefined);
    const peerRow = runner.log.rows.actor_B_private.find(row => row.event_id === insight.attemptId)!;
    assert.equal(peerRow.own_attempt, undefined);
    const ownerRow = runner.log.rows.actor_A_private.find(row => row.event_id === insight.attemptId)!;
    assert.equal(ownerRow.own_attempt.command.pieceId, "covered-10");
    assert.deepEqual(ownerRow.after.ownHeroSecrets.insights.at(-1).identity, { color: "red", type: "cannon" });
    const record = publicRow.after.state.actionRecords.at(-1);
    assert.equal(record.pieceId, id === "JF03" ? "covered-10" : undefined);
    assert.equal(Boolean(publicRow.after.state.effectsByPieceId?.["covered-10"]?.insightMark), id === "JF03");
  }
});

test("SCORE journal survives history truncation and B reset; persisted archive detects corruption", () => {
  const directory = mkdtempSync(join(tmpdir(), "lezi-score-"));
  try {
    const runner = new FixtureRunner("persistent-history").run(fixtures.find(f => f.id === "JF09"));
    // JF09 has eight ordinary actions. Extend legally until history truncates.
    for (let i = 0; i < 4; i++) {
      const side = runner.room.game!.state.turn;
      const id = side === "red" ? "covered-16" : "covered-01";
      const piece = runner.room.game!.state.pieces.find(p => p.id === id)!;
      const back = piece.y === (side === "red" ? 7 : 2);
      const to = side === "red" ? back ? [1, 9] : [2, 7] : back ? [1, 0] : [2, 2];
      runner.submit({ actionId: `extension:${i}`, expectedRevision: runner.room.game!.state.revision, from: { x: piece.x, y: piece.y }, to: { x: to[0], y: to[1] } }, side === "red" ? "A" : "B");
      assert.equal(runner.attempts.at(-1)!.outcome, "committed");
    }
    assert.equal(runner.room.game!.secret.history!.length, 8);
    runner.log.save(directory, runner.random.recorded);
    verifyArchive(directory);
    const saved = readFileSync(join(directory, "authoritative.jsonl"), "utf8");
    assert(saved.includes('"kind":"insight_spend"'));
    assert(saved.includes('"kind":"attempt"'));
    assert(runner.log.rows.authoritative.length > runner.room.game!.secret.history!.length);
    writeFileSync(join(directory, "authoritative.jsonl"), saved.replace('"kind":"attempt"', '"kind":"tampered"'));
    assert.throws(() => verifyArchive(directory), /checksum mismatch/);
    const wash = new FixtureRunner("persistent-reset").run(fixtures.find(f => f.id === "JF03"));
    assert.equal(wash.room.game!.secret.history!.length, 0);
    const resetDirectory = join(directory, "wash");
    wash.log.save(resetDirectory, wash.random.recorded);
    const archive = readFileSync(join(resetDirectory, "authoritative.jsonl"), "utf8");
    assert(archive.includes('"kind":"insight_spend"'));
    assert(archive.includes('"kind":"shuffle_reset"'));
    assert.equal(wash.room.game!.secret.insights!.red![0].valid, false);
    assert.deepEqual(wash.room.game!.secret.insights!.red![0].identity, { color: "red", type: "cannon" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("SCORE legal permutation ranges and new mode guards remain enforced", () => {
  assert.throws(() => permutationDraws([{ color: "red", type: "pawn" }], [{ color: "black", type: "pawn" }], "bad"));
  for (const mode of ["xiangqi", "half_chaos"] as const) {
    const initial = createInitialGame(max => max - 1, mode);
    assert.throws(() => initializeFeatureGameState(initial.state, { red: "night", black: "shuffler" }, "jian_xie"), (error: any) => error.code === "MODE_ADAPTATION_PENDING");
  }
});

test("SCORE clock expiry rejects insight without advancing counters, paying cost or incrementing n", () => {
  const runner = new FixtureRunner("expired-insight");
  const before = structuredClone(runner.room.game!);
  const command = runner.commandFor({ kind: "insight_attempt", normal_or_secret: "secret", target_piece_id: "covered-10" });
  const attempt = runner.submit(command, "A", runner.room.game!.state.turnDeadlineAt!);
  assert.equal(attempt.outcome, "timeout");
  assert.equal(runner.room.game!.state.reason, "timeout");
  assert.deepEqual(runner.room.game!.state.formalTurns, before.state.formalTurns);
  assert.deepEqual(runner.room.game!.state.heroRuntime, before.state.heroRuntime);
  assert.equal(runner.room.game!.secret.processedActions[command.actionId], undefined);
  assert.equal(attempt.fields.H14_resources.actually_charged_cost.value, 0);
});

test("SCORE insight does not restart its clock; B has no black ordinary clock and starts red3 once", () => {
  const secret = new FixtureRunner("insight-clock").run(fixtures.find(f => f.id === "JF06"));
  const insight = secret.attempts.at(-1)!;
  assert.equal(insight.after.game!.state.turnStartedAt, insight.before.game!.state.turnStartedAt);
  assert.equal(insight.after.game!.state.turnDeadlineAt, insight.before.game!.state.turnDeadlineAt);
  assert(!insight.sourceEvents.some(e => e.kind === "formal_clock_start"));
  const b = pendingB("B-clock");
  assert.equal(b.room.game!.state.turnDeadlineAt, undefined);
  const wash = b.submit(b.commandFor({ kind: "shuffle_choice", choice: "wash" }), "B");
  const clocks = wash.sourceEvents.filter(e => e.kind === "formal_clock_start");
  assert.equal(clocks.length, 1);
  assert.deepEqual(clocks[0].details, { side: "red", number: 3, start: wash.now, deadline: wash.now + 60_000 });
  assert.equal(b.room.game!.state.formalClock!.number, 3);
});

test("SCORE all 85 fields have values or explicit reasons; empirical and outcome estimates remain unknown", () => {
  const plan = readInput("LOG_FIELD_PLAN.json");
  const runner = new FixtureRunner("field-contract").run(fixtures.find(f => f.id === "JF03"));
  for (const row of runner.log.rows.authoritative.filter(row => row.kind === "attempt")) {
    const entries = Object.values(row.fields).flatMap((group: any) => Object.values(group)) as any[];
    assert.equal(entries.length, 85);
    assert(entries.every(entry => entry.value !== null && entry.null_reason === null || entry.value === null && typeof entry.null_reason === "string"));
    for (const entry of plan.fields.filter(entry => entry.phase === "empirical_calibration_deferred")) {
      assert.equal(row.fields[entry.group][entry.field].value, null);
      assert.equal(row.fields[entry.group][entry.field].null_reason, "empirical_calibration_deferred");
    }
    assert.equal(row.fields.trajectory_result.actor_result_point.value, null);
    assert.equal(row.fields.trajectory_result.winner.value, null);
  }
});

test("SCORE captured snapshots are immutable, detached and scope cleanup survives errors", () => {
  const runner = pendingB("immutable-observer");
  const command = runner.commandFor({ kind: "shuffle_choice", choice: "wash" });
  const attempt = runner.submit(command, "B");
  const snapshot = attempt.sourceEvents.find(e => e.kind === "shuffle_reset")!;
  assert(Object.isFrozen(snapshot.state.pieces[0]));
  assert.throws(() => { snapshot.state.pieces[0].x = 99; }, TypeError);
  assert.notEqual(runner.room.game!.state.pieces[0].x, 99);
  assert.throws(() => captureMechanismEvents(() => { throw new Error("probe"); }), /probe/);
  assert.deepEqual(captureMechanismEvents(() => "ok"), { result: "ok", events: [] });
});
