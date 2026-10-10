import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixtures, FixtureRunner, ruleHash } from "./fixture-runner.ts";
import { readInput, sha256, verifyArchive } from "./research-log.ts";

const output = resolve(process.argv[2] ?? "review/scoring/2026-10-10");
mkdirSync(output, { recursive: true });
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const baselineCommit = "a3704459e8dbb08e1bb6fb9bcb1b169319a6d1bc";
const changedFiles = [...new Set([...git("diff", "--name-only", baselineCommit, "HEAD").split("\n"), ...git("diff", "HEAD", "--name-only").split("\n")].filter(Boolean))];
const metadata = { source_base_commit: baselineCommit, source_commit: git("rev-parse", "HEAD"), source_branch: git("branch", "--show-current"), tested_source_hash: ruleHash, executor: "scripts/scoring/fixture-runner.ts", clock_contract: "Existing authority receipt times; explicit post-command advanceRemoteRoomTime mirrors BluetoothHostRoom.views. Logger never advances time.", random_contract: "Legal bounded deterministic realizations of product Fisher-Yates and mutation selection; no empirical population weight." };
const write = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const runners = new Map<string, FixtureRunner>();
const results: any[] = [];
let failed = false;
for (const fixture of fixtures) {
  let runner: FixtureRunner | undefined;
  try {
    runner = new FixtureRunner(fixture.id).run(fixture);
    const replay = new FixtureRunner(fixture.id, { replay: runner.random.recorded }).run(fixture);
    assert.deepEqual(replay.room, runner.room);
    assert.deepEqual(replay.random.recorded, runner.random.recorded);
    const silent = new FixtureRunner(fixture.id, { observer: false }).run(fixture);
    assert.deepEqual(silent.room, runner.room);
    assert.deepEqual(silent.random.recorded, runner.random.recorded);
    for (const row of [...runner.log.rows.public, ...runner.log.rows.actor_B_private]) for (const projection of [row.before, row.after]) {
      assert.equal(projection.secret, undefined);
      assert.equal(projection.ownHeroSecrets?.insights, undefined);
    }
    const fieldPlan = readInput("LOG_FIELD_PLAN.json");
    for (const row of runner.log.rows.authoritative.filter(row => row.kind === "attempt")) {
      const values = Object.values(row.fields).flatMap((g: any) => Object.values(g)) as any[];
      assert.equal(values.length, 85);
      assert(values.every(v => v.value !== null && v.null_reason === null || v.value === null && typeof v.null_reason === "string"));
      for (const field of fieldPlan.fields.filter(f => f.phase === "empirical_calibration_deferred")) assert.equal(row.fields[field.group][field.field].value, null);
    }
    runner.log.save(join(output, fixture.id), runner.random.recorded, metadata);
    runners.set(fixture.id, runner);
    results.push({ fixture_id: fixture.id, status: "passed", evidence_path: `${fixture.id}/manifest.json`, failure_or_blocker: null, authority_submissions: runner.attempts.length, formal_turns: runner.room.game!.state.formalTurns, terminal_status: runner.room.game!.state.status, winner: null, q: null, H: null, I: null, B: null, replay_matches: true, observer_is_passive: true });
  } catch (error) {
    failed = true;
    const failure = String(error);
    if (runner) runner.log.save(join(output, fixture.id), runner.random.recorded, { ...metadata, completion: "interrupted", failure });
    results.push({ fixture_id: fixture.id, status: "failed", evidence_path: runner ? `${fixture.id}/manifest.json` : null, failure_or_blocker: failure });
  }
}

const extraResults: any[] = [];
function extra(id: string, run: (runner: FixtureRunner) => void, prepare: (runner: FixtureRunner) => void = () => {}) {
  const runner = new FixtureRunner(id);
  try {
    prepare(runner); run(runner);
    runner.log.save(join(output, id), runner.random.recorded, metadata);
    extraResults.push({ id, status: "passed", evidence_path: `${id}/manifest.json`, failure_or_blocker: null });
  } catch (error) {
    failed = true;
    runner.log.save(join(output, id), runner.random.recorded, { ...metadata, completion: "interrupted", failure: String(error) });
    extraResults.push({ id, status: "failed", evidence_path: `${id}/manifest.json`, failure_or_blocker: String(error) });
  }
}
extra("TX-B", runner => {
  const wash = runner.commandFor({ kind: "shuffle_choice", choice: "wash" }, "B-once");
  const before = structuredClone(runner.room);
  assert.equal(runner.submit({ ...wash, expectedRevision: wash.expectedRevision - 1 }, "B").errorCode, "STALE_REVISION");
  assert.equal(runner.submit(wash, "A").errorCode, "WRONG_TURN");
  assert.equal(runner.submit({ ...wash, ability: "insight" } as any, "B").errorCode, "NO_SHUFFLE_WINDOW");
  assert.deepEqual(runner.room, before);
  const committed = runner.submit(wash, "B");
  assert.equal(committed.outcome, "committed");
  assert.equal(runner.room.game!.state.formalTurns!.black, 2);
  assert(!committed.sourceEvents.some(e => (e.kind === "formal_turn_begin" || e.kind === "formal_turn_end") && e.details.side === "black"));
  assert.equal(committed.sourceEvents.filter(e => e.kind === "formal_clock_start").length, 1);
  assert.equal(runner.submit(wash, "B").outcome, "duplicate");
  assert.equal(runner.log.rows.authoritative.filter(row => row.kind === "commit" && row.action_id === wash.actionId).length, 1);
}, runner => {
  const fixture = fixtures.find(f => f.id === "JF03");
  for (const action of [...fixture.prefix, ...fixture.actions.slice(0, -1)]) runner.execute(action);
});
extra("TX-SKIP", runner => {
  const fixture = fixtures.find(f => f.id === "JF04");
  runner.run(fixture);
  assert.equal(runner.room.game!.state.formalTurns!.black, 1);
  assert.equal(runner.room.game!.state.formalClock!.number, 2);
  runner.execute(fixtures.find(f => f.id === "JF06").prefix.find(p => p.kind === "ordinary_move" && p.side === "black" && p.own_formal_turn === 2));
  assert.equal(runner.room.game!.state.formalTurns!.black, 2);
});
extra("TX-CLOCK", runner => {
  const before = structuredClone(runner.room.game!);
  const command = runner.commandFor({ kind: "insight_attempt", normal_or_secret: "secret", target_piece_id: "covered-10" });
  assert.equal(runner.submit(command, "A", runner.room.game!.state.turnDeadlineAt!).outcome, "timeout");
  assert.deepEqual(runner.room.game!.state.formalTurns, before.state.formalTurns);
  assert.deepEqual(runner.room.game!.state.heroRuntime, before.state.heroRuntime);
  assert.equal(runner.room.game!.secret.processedActions[command.actionId], undefined);
});
extra("HISTORY", runner => {
  runner.run(fixtures.find(f => f.id === "JF09"));
  for (let i = 0; i < 4; i++) {
    const side = runner.room.game!.state.turn;
    const id = side === "red" ? "covered-16" : "covered-01";
    const piece = runner.room.game!.state.pieces.find(p => p.id === id)!;
    const back = piece.y === (side === "red" ? 7 : 2);
    const to = side === "red" ? back ? [1, 9] : [2, 7] : back ? [1, 0] : [2, 2];
    assert.equal(runner.submit({ actionId: `history:${i}`, expectedRevision: runner.room.game!.state.revision, from: { x: piece.x, y: piece.y }, to: { x: to[0], y: to[1] } }, side === "red" ? "A" : "B").outcome, "committed");
  }
  assert.equal(runner.room.game!.secret.history!.length, 8);
  assert(runner.log.rows.authoritative.length > 8);
});

// AC rows are tied to executed assertions or a recorded validation file, not
// inferred from a successful process exit or the expected fixture text.
const evidence: Record<string, string[]> = {
  AC01: ["source-state.json"], AC02: ["JF03/authoritative.jsonl", "TX-B/authoritative.jsonl"],
  AC03: ["JF03/authoritative.jsonl", "TX-B/authoritative.jsonl"], AC04: ["JF02/authoritative.jsonl"],
  AC05: ["JF04/authoritative.jsonl", "TX-SKIP/authoritative.jsonl"], AC06: ["TX-B/authoritative.jsonl"],
  AC07: ["TX-B/authoritative.jsonl", "TX-CLOCK/authoritative.jsonl"], AC08: ["JF03/public.jsonl", "JF06/public.jsonl", "JF06/actor_A_private.jsonl", "JF06/actor_B_private.jsonl"],
  AC09: ["JF03/authoritative.jsonl"], AC10: ["JF02/authoritative.jsonl", "JF03/authoritative.jsonl", "JF06/authoritative.jsonl", "JF09/authoritative.jsonl"],
  AC11: ["HISTORY/manifest.json", "JF03/manifest.json", "validation/scoring-mechanism.tap"], AC12: ["runtime-results.json"],
  AC13: ["JF03/random-tape.json", "validation/scoring-mechanism.tap"], AC14: ["TX-SKIP/authoritative.jsonl", "TX-B/authoritative.jsonl", "validation/scoring-mechanism.tap"],
  AC15: ["source-state.json", "validation/related-regression.tap"], AC16: ["field-coverage.json", "JF03/manifest.json", "RETURN_CONTRACT.json"],
};
write("source-state.json", { ...metadata, repository: "aaaycc931-droid/jieqi-engine", worktree_status: git("status", "--short"), changed_tracked_files: changedFiles, repository_write_authorized: true, scope: "SCORE-IMPL-001..003 only", formal_scoring_status: "frozen" });
write("runtime-results.json", { results, supplemental_results: extraResults, accepted_runtime_fixtures: results.filter(r => r.status === "passed").length, formal_scoring_status: "frozen", empirical_parameters_approved: false });
write("field-coverage.json", { field_count: 85, full_contract_location: "authoritative attempt rows: fields[group][field]", public_and_private_visibility: "Separate existing product projections; no authority field objects in player channels.", empirical_stage_deferred_fields: readInput("LOG_FIELD_PLAN.json").empirical_stage_deferred_fields, null_reason_required: true, q: null, H: null, I: null, B: null, formal_scoring_status: "frozen" });

const validation = JSON.parse(readFileSync(join(output, "validation/results.json"), "utf8"));
assert.equal(validation.scoring_mechanism.exit_code, 0);
assert.equal(validation.related_regression.exit_code, 0);
assert.equal(validation.build_web.exit_code, 0);
for (const v of Object.values(validation) as any[]) if (v.evidence_path) assert.equal(sha256(readFileSync(join(output, v.evidence_path))), v.sha256);
for (const row of results.filter(r => r.status === "passed")) verifyArchive(join(output, row.fixture_id));
const criteria = readInput("ACCEPTANCE_CRITERIA.json").criteria.map((criterion: any) => ({ id: criterion.id, title: criterion.title, status: failed ? "review_required" : "passed", evidence: evidence[criterion.id] }));
write("criteria-results.json", { criteria, scope: "Controlled mechanism acceptance; no empirical score validation", formal_scoring_status: "frozen" });
const template = readInput("RETURN_CONTRACT.json");
write("RETURN_CONTRACT.json", { ...template, status: failed ? "mechanism_acceptance_incomplete" : "controlled_mechanism_acceptance_passed", source_branch: metadata.source_branch, source_commit: metadata.source_commit, tested_source_hash: ruleHash, changed_files: changedFiles, run_commands: [validation.scoring_mechanism.command, validation.related_regression.command, validation.build_web.command, "node scripts/scoring/run-acceptance.ts <output>"], runtime_results: results, supplemental_results: extraResults, criteria_results: criteria, authority_entry_used: "submitRemoteMove / submitRemoteHeroAbility after actual hero selection and RPS; post-command advanceRemoteRoomTime mirrors product views", clock_contract: metadata.clock_contract, random_tape_reference: "<fixture_id>/random-tape.json", public_log: "<fixture_id>/public.jsonl", actor_A_private_log: "<fixture_id>/actor_A_private.jsonl", actor_B_private_log: "<fixture_id>/actor_B_private.jsonl", authoritative_log: "<fixture_id>/authoritative.jsonl", manifest: "<fixture_id>/manifest.json", field_coverage_report: "field-coverage.json", remaining_dependencies: ["Empirical player-policy definition and independent cluster sampling", "Mode-specific parameter calibration", "q estimator and mutation-impact encoder validation", "Ordinary xiangqi/half-chaos feature adaptation remains guarded"] });
console.log(JSON.stringify({ fixtures_passed: results.filter(r => r.status === "passed").length, supplemental_passed: extraResults.filter(r => r.status === "passed").length, criteria: criteria.length, formal_scoring_status: "frozen", output }, null, 2));
if (failed) process.exitCode = 1;
