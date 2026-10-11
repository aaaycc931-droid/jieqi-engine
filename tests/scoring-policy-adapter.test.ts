import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicySession, P0_CONFIG } from "../scripts/scoring/policy-session.ts";
import { ObservationBroker, policyProjection } from "../scripts/scoring/policy-observation.ts";
import { decideIsolated } from "../scripts/scoring/policy-process.ts";
import { SemanticRandom } from "../scripts/scoring/semantic-rng.ts";
import { ClusterRegistry, createDiagnosticCluster } from "../scripts/scoring/cluster.ts";
import { verifyPolicyArchive } from "../scripts/scoring/policy-archive.ts";
import { RandomTape, permutationDraws, layout, resetLayout, fixtures } from "../scripts/scoring/fixture-runner.ts";
import { createIdentityPool } from "../src/setup.ts";
import { MUTATION_IDS } from "../src/mutations.ts";
import { createRemoteRoom, joinRemoteRoom, submitRemoteHeroSelection, submitRemoteRps, completeRemoteHeroIntro, advanceRemoteRoomTime, submitRemoteMove, submitRemoteHeroAbility } from "../src/remote-room.ts";
import { withResearchSources } from "../src/research-source-context.ts";

const clone = <T>(v: T): T => structuredClone(v);
function make(options: any = {}, identities = Object.values(layout.authoritative_private_identities)) {
  const tape = new RandomTape();
  tape.plan([...permutationDraws(createIdentityPool(), identities, "initial"), { event_key: "conditioned_mutation:jian_xie", max_exclusive: MUTATION_IDS.length, value: MUTATION_IDS.indexOf("jian_xie") }]);
  const session = new PolicySession({ ruleSeed: "authority-only-seed", policySeed: "independent-policy-seed", initialRandom: tape.next, ...options });
  tape.finish(); return { session, tape };
}
function action(runner: ReturnType<typeof make>, step: any) {
  const { session: s, tape } = runner;
  const intent: any = step.kind === "ordinary_move" ? { kind: "move", pieceId: step.piece_id, from: { x: step.from_xy[0], y: step.from_xy[1] }, to: { x: step.to_xy[0], y: step.to_xy[1] } }
    : step.kind === "shuffle_choice" ? { kind: "shuffle", skip: step.choice === "skip" } : { kind: "insight", pieceId: step.target_piece_id, secretInsight: step.normal_or_secret === "secret" };
  tape.plan(intent.kind === "shuffle" && !intent.skip ? permutationDraws(Object.values(s.room.game!.secret.shuffleOpening!.identities), Object.values(resetLayout.authoritative_private_identities), "reset") : []);
  const receipt = s.submit(s.room.game!.players[step.side], intent, { random: tape.next });
  assert.equal(receipt.outcome, step.kind === "insight_attempt" && !step.expected_commit ? "rejected" : "committed");
  if (step.kind === "insight_attempt") assert.equal(receipt.code, step.expected_error_code_from_pinned_source);
  tape.finish(receipt.outcome === "committed"); return receipt;
}
function runFixture(id: string) {
  const r = make(), f = fixtures.find(f => f.id === id)!;
  for (const a of [...f.prefix, ...f.actions]) action(r, a);
  return r;
}
function productRoom(tape: RandomTape) {
  let now = 1000;
  let room = createRemoteRoom("policy-qualification", "A", "research-admission", now++, { baseMode: "jieqi", heroesEnabled: true, mutationsEnabled: true });
  room = joinRemoteRoom(room, "B", "research-admission", now++).room;
  room = submitRemoteHeroSelection(room, "A", "night", undefined, now++);
  room = submitRemoteHeroSelection(room, "B", "shuffler", undefined, now++);
  room = submitRemoteRps(room, "A", "scissors", 1, tape.next, now++);
  room = submitRemoteRps(room, "B", "rock", 1, tape.next, now++);
  room = completeRemoteHeroIntro(room, "A", now++); room = completeRemoteHeroIntro(room, "B", now++);
  return advanceRemoteRoomTime(room, tape.next, now++);
}

test("POLICY Q01/Q19-Q24: four whole-source worlds retain actor identity and both pre-RPS strata", () => {
  for (const mask of ["00", "10", "01", "11"] as const) for (const stratum of ["A_initial_red", "A_initial_black"] as const) {
    const { session: s } = make({ mask, stratum }); const game = s.room.game!;
    const initialRed = stratum === "A_initial_red" ? "A" : "B";
    const finalRed = mask[1] === "1" ? initialRed === "A" ? "B" : "A" : initialRed;
    assert.equal(game.players.red, finalRed);
    for (const actor of ["A", "B"]) {
      const side = game.players.red === actor ? "red" : "black";
      assert.equal(game.state.featureRules!.heroes![side], mask[actor === "A" ? 0 : 1] === "1" ? actor === "A" ? "night" : "shuffler" : undefined);
      const projection = s.input(actor).projection;
      if (mask[actor === "A" ? 0 : 1] === "0") assert.equal(projection.own_source, undefined);
    }
    assert.equal(game.secret.shuffleOpening !== undefined, mask[1] === "1");
    assert.equal(game.state.featureRules!.mutation, "jian_xie");
    assert.equal(game.state.heroRuntime![game.players.red === "A" ? "red" : "black"]?.pupil !== undefined, mask[0] === "1" && game.players.red === "A");
    const before = clone(game.state.heroRuntime);
    const intent: any = mask[0] === "0" ? { kind: "insight", pieceId: "covered-10", secretInsight: false } : mask[1] === "0" ? { kind: "shuffle", skip: false } : undefined;
    if (intent) { const receipt = s.submit(intent.kind === "insight" ? "A" : "B", intent); assert.equal(receipt.code, "RESEARCH_SOURCE_DISABLED"); assert.deepEqual(game.state.heroRuntime, before); }
  }
});

test("POLICY Q22: 11 initialization and complete JF03 authority trajectory match unchanged product APIs", () => {
  const r = make(), tape = new RandomTape();
  tape.plan([...permutationDraws(createIdentityPool(), Object.values(layout.authoritative_private_identities), "initial"), { event_key: "conditioned_mutation:jian_xie", max_exclusive: MUTATION_IDS.length, value: MUTATION_IDS.indexOf("jian_xie") }]);
  let product = productRoom(tape); tape.finish(); assert.deepEqual(r.session.room, product);
  const f = fixtures.find(f => f.id === "JF03")!;
  for (const step of [...f.prefix, ...f.actions]) {
    const revision = product.game!.state.revision, at = r.session.now + 1;
    action(r, step);
    const attempt = r.session.journal.filter(row => row.kind === "attempt").at(-1)!;
    const cmd: any = step.kind === "ordinary_move" ? { actionId: attempt.actionId, expectedRevision: revision, pieceId: step.piece_id, from: { x: step.from_xy[0], y: step.from_xy[1] }, to: { x: step.to_xy[0], y: step.to_xy[1] } }
      : { kind: "hero_ability", actionId: attempt.actionId, expectedRevision: revision, ability: step.kind === "shuffle_choice" ? "shuffle" : "insight", ...(step.kind === "shuffle_choice" ? { skip: step.choice === "skip" } : { pieceId: step.target_piece_id, secretInsight: step.normal_or_secret === "secret" }) };
    tape.plan(step.kind === "shuffle_choice" && step.choice === "wash" ? permutationDraws(Object.values(product.game!.secret.shuffleOpening!.identities), Object.values(resetLayout.authoritative_private_identities), "reset") : []);
    product = (step.kind === "ordinary_move" ? submitRemoteMove(product, product.game!.players[step.side], cmd, at) : submitRemoteHeroAbility(product, product.game!.players[step.side], cmd, at, tape.next)).room;
    product = advanceRemoteRoomTime(product, tape.next, at); tape.finish();
    assert.deepEqual(r.session.room, product);
  }
  assert.deepEqual(r.tape.recorded, tape.recorded);
});

for (const id of ["JF01", "JF02", "JF03", "JF04", "JF05", "JF06", "JF07", "JF08", "JF09"]) test(`POLICY Q03-Q11 authority routing reuses legal ${id} prefix`, () => { runFixture(id); });

test("POLICY Q09-Q11/Q28: A count, B replacement callbacks and receipt clocks stay distinct", () => {
  const a = runFixture("JF02").session; assert.equal(a.room.game!.state.formalTurns!.black, 1);
  assert.equal(a.room.game!.state.heroRuntime!.red!.pupil, 6);
  const b = runFixture("JF03").session; const state = b.room.game!.state;
  assert.equal(state.formalTurns!.black, 2); assert.equal(state.turnLifecycle!.number, 3);
  assert.equal(state.heroRuntime!.red!.pupil, 2); assert.equal(state.heroRuntime!.red!.insightCount, 1);
  const wash = b.journal.filter(r => r.kind === "attempt").at(-1)!;
  assert(!wash.source_events.some((e: any) => ["formal_turn_begin", "formal_turn_end", "formal_clock_start"].includes(e.kind) && e.details.side === "black"));
  assert.equal(wash.source_events.filter((e: any) => e.kind === "formal_clock_start" && e.details.side === "red").length, 1);
  const skipped = runFixture("JF04").session; assert.equal(skipped.room.game!.state.formalTurns!.black, 1);
  assert.equal(skipped.room.game!.state.formalClock!.number, 2); assert.equal(skipped.room.game!.state.turnDeadlineAt, skipped.now + 60000);
});

test("POLICY Q02/Q15/Q18/Q37: unseen identity permutations and authority metadata cannot reach process input", () => {
  const identities = clone(Object.values(layout.authoritative_private_identities)); [identities[0], identities[2]] = [identities[2], identities[0]];
  const left = make().session, right = make({}, identities).session;
  (right.room.game!.secret as any).future_tape = "CANARY-SECRET";
  (right.room.game!.state as any).authority_hash = "CANARY-SECRET";
  (right.room.game!.state.formalTurns as any).authority = "CANARY-SECRET";
  assert.deepEqual(left.input("A"), right.input("A"));
  const input = left.input("A"); assert(Object.isFrozen(input.projection.public_state!.pieces));
  assert.throws(() => decideIsolated({ ...input, authority: right.room.game!.secret } as any, {}, [1,2,3,4]), /unqualified_policy_input/);
  assert(!JSON.stringify(right.input("A")).includes("CANARY-SECRET"));
  assert.deepEqual(decideIsolated(input, {}, [1,2,3,4]), decideIsolated(right.input("A"), {}, [1,2,3,4]));
  const rejectedLeft = left.submit("A", { kind: "insight", pieceId: "covered-10", secretInsight: true });
  const rejectedRight = right.submit("A", { kind: "insight", pieceId: "covered-10", secretInsight: true });
  assert.deepEqual(rejectedLeft, rejectedRight); assert.deepEqual(left.input("A"), right.input("A"));
});

test("POLICY Q06/Q16: secret target and private payload do not change peer history, catalog, budget or process decision", () => {
  const l = make(), r = make(), f = fixtures.find(f => f.id === "JF06")!;
  for (const step of f.prefix) { action(l, step); action(r, step); }
  l.session.submit("A", { kind: "insight", pieceId: "covered-10", secretInsight: true });
  r.session.submit("A", { kind: "insight", pieceId: "covered-11", secretInsight: true });
  assert.deepEqual(l.session.input("B"), r.session.input("B"));
  assert.deepEqual(decideIsolated(l.session.input("B"), {}, [4,3,2,1]), decideIsolated(r.session.input("B"), {}, [4,3,2,1]));
  assert.notDeepEqual(l.session.input("A").projection.own_insights, r.session.input("A").projection.own_insights);
});

test("POLICY Q12/Q14: exact retry, changed payload, cross-actor ID and failed attempts have bounded transaction effects", () => {
  const s = make().session;
  const intent = s.input("A").command_catalog.find(i => i.kind === "move")!;
  const revision = s.room.game!.state.revision;
  assert.equal(s.submit("A", intent, { actionId: "opaque-once", expectedRevision: revision }).outcome, "committed");
  const before = clone(s.room.game), draws = s.random.audit.length;
  assert.equal(s.submit("A", intent, { actionId: "opaque-once", expectedRevision: revision }).outcome, "duplicate");
  assert.equal(s.submit("A", { kind: "wait" }, { actionId: "opaque-once", expectedRevision: revision }).code, "RESEARCH_ACTION_ID_CONFLICT");
  assert.equal(s.submit("B", intent, { actionId: "opaque-once", expectedRevision: revision }).code, "RESEARCH_ACTION_ID_CONFLICT");
  assert.deepEqual(s.room.game, before); assert.equal(s.random.audit.length, draws);
  const bHistory = clone(s.input("B"));
  s.submit("A", { kind: "insight", pieceId: "covered-10", secretInsight: true });
  assert.deepEqual(s.input("B"), bHistory);
});

test("POLICY Q13/Q17/Q36: memory preserves known-then payload while wash invalidates current slot constraints", () => {
  const r = make(), f = fixtures.find(f => f.id === "JF03")!;
  for (const step of [...f.prefix, ...f.actions.slice(0,-1)]) action(r, step);
  const memory = decideIsolated(r.session.input("A"), {}, [0,0,0,0]).nextMemory;
  assert.equal(memory.known_then[0].mapping_epoch, 0); assert.equal(memory.current_constraints.length, 1);
  const snapshot = clone(memory.known_then);
  action(r, f.actions.at(-1));
  const after = decideIsolated(r.session.input("A"), memory, [0,0,0,0]).nextMemory;
  assert.deepEqual(after.known_then, snapshot); assert.equal(after.current_constraints.length, 0);
  assert.equal(r.session.input("A").mapping_epoch, 1);
  const firstDecisionAfterWash = decideIsolated(r.session.input("A"), {}, [0,0,0,0]).nextMemory;
  assert.equal(firstDecisionAfterWash.known_then[0].mapping_epoch, 0);
  assert.deepEqual(after.known_then[0].identity, { type: "cannon", color: "red" });
});

test("POLICY Q23: scope is synchronous, room-bound, fixed-source, and does not change normal product or mode guards", () => {
  const context: any = { roomId: "other-room", actors: { A: { hero: "night", enabled: false }, B: { hero: "shuffler", enabled: false } } };
  assert.throws(() => withResearchSources(context, () => make()), (e: any) => e.code === "RESEARCH_SCOPE_INVALID");
  assert.throws(() => withResearchSources(context, () => Promise.resolve(1)), /synchronous/);
  for (const mode of ["xiangqi", "half_chaos"] as const) assert.throws(() => withResearchSources(context, () => createRemoteRoom("other-room", "A", "token", 0, { baseMode: mode, heroesEnabled: true })), (e: any) => e.code === "MODE_ADAPTATION_PENDING");
  const fakeWire: any = { baseMode: "jieqi", heroesEnabled: true, mutationsEnabled: true, researchMask: "00" };
  assert.equal((createRemoteRoom("plain", "A", "token", 0, fakeWire).mode as any).researchMask, undefined);
  const product = make().session; assert.equal(product.room.game!.state.featureRules!.heroes!.black, "shuffler");
});

test("POLICY Q25/Q38: semantic RNG ranges, repeatability, domain separation and rollback", () => {
  const l = new SemanticRandom("fixed-key"), r = new SemanticRandom("fixed-key");
  const failed = l.transaction("H11:wash:B"); failed.next(30); // discarded, never committed
  const a = l.transaction("H11:wash:B"), b = r.transaction("H11:wash:B");
  for (const max of [30,29,28,17,2,1]) { const value = a.next(max); assert.equal(value, b.next(max)); assert(value >= 0 && value < max); }
  a.commit(); b.commit(); assert.deepEqual(l.audit, r.audit); assert.throws(a.commit, /committed/);
  const unrelated = l.transaction("policy:unrelated"); unrelated.next(100); unrelated.commit();
  assert.equal(l.transaction("H11:wash:B").next(30), r.transaction("H11:wash:B").next(30));
  assert.throws(() => l.transaction("invalid").next(0), /bound/);
  assert.throws(() => a.next(30), /committed/);
});

test("POLICY Q28/Q30/Q33-Q35: P0 real engine flow, passive observer, unknown endpoints and finite budget never produce scores", () => {
  for (const mask of ["00", "10", "01", "11"] as const) for (const stratum of ["A_initial_red", "A_initial_black"] as const) {
    const observed = new PolicySession({ mask, stratum, ruleSeed: "flow-key", policySeed: "policy-key" });
    const silent = new PolicySession({ mask, stratum, ruleSeed: "flow-key", policySeed: "policy-key", observer: false });
    assert.deepEqual(observed.runP0(8), silent.runP0(8)); assert.deepEqual(observed.room, silent.room); assert.deepEqual(observed.random.audit, silent.random.audit);
    assert.equal(observed.classify().result, null);
  }
  const s = make().session; s.tick(s.room.game!.state.turnDeadlineAt!); assert.equal(s.classify().status, "legal_terminal"); assert.equal(s.room.game!.state.reason, "timeout");
  (s.room.game!.state as any).reason = "unconfirmed_repetition"; assert.equal(s.classify().status, "blocked");
  const bounded = make({ config: { ...P0_CONFIG, maxAttempts: 1 } }).session;
  bounded.submit("A", { kind: "wait" }); assert.equal(bounded.submit("A", { kind: "wait" }).outcome, "censored");
  assert.equal(bounded.classify().reason, "attempt_budget");
  assert.throws(() => make({ config: { ...P0_CONFIG, profile: "P1" } }), /P1/);
});

test("POLICY Q34: private durable journal retains prep/attempt/callback witnesses with frozen manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "policy-private-"));
  try {
    const s = runFixture("JF03").session;
    const manifest = s.save(dir, "local-test-source");
    assert.equal(manifest.q, null); assert.equal(manifest.formal_scoring_status, "frozen");
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(statSync(join(dir, "authoritative.jsonl")).mode & 0o777, 0o600);
    const text = readFileSync(join(dir, "authoritative.jsonl"), "utf8"); assert(text.includes('"kind":"prepare"')); assert(text.includes('"kind":"shuffle_reset"')); assert(text.includes('"kind":"insight_spend"'));
    const player = readFileSync(join(dir, "actor_B_private.jsonl"), "utf8"); assert(!player.includes('"shuffleOpening"')); assert(!player.includes('"source_events"'));
    assert.equal(s.room.game!.secret.history!.length, 0);
    verifyPolicyArchive(dir);
    writeFileSync(join(dir, "authoritative.jsonl"), text.replace('"kind":"attempt"', '"kind":"corrupted"'));
    assert.throws(() => verifyPolicyArchive(dir), /checksum/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("POLICY Q26/Q27: related worlds keep legal marginals, isolated sessions and one cluster identity across splits", () => {
  const registry = new ClusterRegistry();
  const cluster = createDiagnosticCluster(registry, { clusterId: "diagnostic-only", ruleSeed: "cluster-rule", policySeed: "cluster-policy", split: "test" });
  assert.equal(cluster.sessions.length, 8); assert.equal(cluster.metadata.independent_empirical_n, null);
  const initial = cluster.sessions[0].session.room.game!.secret.identities;
  for (const { session } of cluster.sessions) {
    assert.deepEqual(session.room.game!.secret.identities, initial);
    assert.deepEqual(Object.values(initial).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), createIdentityPool().sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    assert.deepEqual(session.random.audit.map(d => d.max_exclusive), Array.from({ length: 29 }, (_, i) => 30-i));
    assert(!JSON.stringify(session.input("A")).includes("diagnostic-only"));
  }
  cluster.sessions[0].session.submit("A", { kind: "wait" });
  assert.equal(cluster.sessions[1].session.input("A").visible_history.filter(e => e.kind === "own_receipt").length, 0);
  assert.throws(() => registry.register("mirror", "cluster-rule", "another-policy", "train"), /registered/);
  assert.throws(() => registry.register("diagnostic-only", "different-root", "different-policy", "validation"), /registered/);
});
