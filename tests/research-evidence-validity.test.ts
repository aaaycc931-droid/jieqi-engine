import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitMechanismEvent, withIsolatedMechanismEvents } from "../src/mechanism-observer.ts";
import { FixtureRunner, fixtures } from "../scripts/scoring/fixture-runner.ts";
import { PolicySession } from "../scripts/scoring/policy-session.ts";
import { verifyArchive } from "../scripts/scoring/research-log.ts";
import { verifyPolicyArchive } from "../scripts/scoring/policy-archive.ts";
import { MechanismEvidence } from "../scripts/scoring/mechanism-evidence.ts";

// Inject an actual isolated observer failure during a real authority event.
// The authority operation and the event's ordinary snapshot still succeed.
function withLostEvidence<T>(operation: () => T): T {
  const clone = globalThis.structuredClone;
  let injected = false;
  globalThis.structuredClone = ((value: any, options?: any) => {
    if (!injected && value?.kind && value.state && "details" in value) {
      injected = true;
      withIsolatedMechanismEvents(() => emitMechanismEvent(value.kind, value.state, value.secret, { uncloneable: () => {} }));
    }
    return clone(value, options);
  }) as typeof structuredClone;
  try {
    const result = operation();
    assert(injected, "The test must reach a real observed authority event");
    return result;
  } finally { globalThis.structuredClone = clone; }
}
const firstStep = fixtures.find(f => f.id === "JF02")!.prefix[0];
function firstIntent() {
  return { kind: "move" as const, pieceId: firstStep.piece_id,
    from: { x: firstStep.from_xy[0], y: firstStep.from_xy[1] }, to: { x: firstStep.to_xy[0], y: firstStep.to_xy[1] } };
}
const make = () => new PolicySession({ ruleSeed: "evidence-authority", policySeed: "evidence-policy" });

test("EVID01 fixture initialization failure blocks verification despite retained authority state", () => {
  const valid = new FixtureRunner("evidence-init");
  const invalid = withLostEvidence(() => new FixtureRunner("evidence-init"));
  assert.deepEqual(invalid.room, valid.room);
  assert.deepEqual(invalid.random.recorded, valid.random.recorded);
  assert.throws(() => invalid.run(fixtures.find(f => f.id === "JF01")), /mechanism evidence/i);
});

test("EVID02 invalid fixture events cannot become zero-valued evidence or a completed archive", () => {
  const valid = new FixtureRunner("evidence-submit"), invalid = new FixtureRunner("evidence-submit");
  const expected = valid.execute(firstStep);
  const actual = withLostEvidence(() => invalid.execute(firstStep));
  assert.equal(actual.outcome, expected.outcome);
  assert.deepEqual(invalid.room, valid.room);
  assert.deepEqual(invalid.random.recorded, valid.random.recorded);
  assert.equal(invalid.now, valid.now);
  assert.deepEqual(actual.sourceEvents, []);
  for (const group of Object.values(actual.fields) as any[]) for (const field of Object.values(group) as any[]) {
    assert.equal(field.value, null); assert.equal(field.null_reason, "mechanism_evidence_invalid");
  }
  // A later good capture, duplicate or caller-supplied success metadata cannot heal it.
  invalid.submit(actual.command, "A", invalid.now);
  const directory = mkdtempSync(join(tmpdir(), "lezi-evidence-fixture-"));
  try {
    const manifest = invalid.log.save(directory, invalid.random.recorded, { completion: "controlled_prefix_completed", evidence_valid: true });
    assert.equal(manifest.completion, "invalid_evidence");
    assert.equal(manifest.evidence_valid, false);
    assert.equal(verifyArchive(directory).evidence_valid, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("EVID03 policy initialization evidence failure cannot qualify a prefix", () => {
  const control = make(), invalid = withLostEvidence(make);
  assert.deepEqual(invalid.room, control.room);
  assert.deepEqual(invalid.random.audit, control.random.audit);
  assert.deepEqual(invalid.classify(), { status: "invalid_execution", reason: "mechanism_evidence_invalid", result: null });
  assert(!JSON.stringify(invalid.input("A")).includes("evidence_valid"));
  assert(!JSON.stringify(invalid.input("B")).includes("evidence_valid"));
});

test("EVID04 policy retains a committed receipt and RNG while invalidating the research archive", () => {
  const control = make(), invalid = make();
  // Any actual legal ordinary action is enough; covered identity remains authoritative.
  const intent = firstIntent(), actor = invalid.room.game!.players[invalid.room.game!.state.turn];
  const expected = control.submit(actor, intent, { actionId: "evidence-move" });
  const receipt = withLostEvidence(() => invalid.submit(actor, intent, { actionId: "evidence-move" }));
  assert.equal(receipt.outcome, "committed");
  assert.deepEqual(receipt, expected);
  assert.deepEqual(invalid.room, control.room);
  assert.deepEqual(invalid.random.audit, control.random.audit);
  const attempt = invalid.journal.find(r => r.kind === "attempt")!;
  assert.deepEqual(attempt.source_events, []);
  assert.equal(attempt.evidence_valid, false);
  invalid.tick(invalid.now + 1);
  assert.equal(invalid.classify().reason, "mechanism_evidence_invalid");
  const attempts = invalid.journal.filter(r => r.kind === "attempt").length;
  invalid.runP0(1);
  assert.equal(invalid.journal.filter(r => r.kind === "attempt").length, attempts);
  const directory = mkdtempSync(join(tmpdir(), "lezi-evidence-policy-"));
  try {
    const manifest = invalid.save(directory, "478d798657524e18662683d053b5246b3c76419b");
    assert.equal(manifest.evidence_valid, false);
    assert.equal(manifest.classification.status, "invalid_execution");
    assert.equal(verifyPolicyArchive(directory).classification.reason, "mechanism_evidence_invalid");
    assert.throws(() => invalid.requireValidEvidence(), /mechanism evidence/i);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("EVID05 a discarded candidate's failed observation does not poison committed evidence", () => {
  const evidence = new MechanismEvidence(), state = make().room.game!.state;
  const observed = evidence.capture(() => {
    try {
      withIsolatedMechanismEvents(() => {
        emitMechanismEvent("formal_main_action", state, undefined, { uncloneable: () => {} });
        throw new Error("discard candidate");
      });
    } catch { /* The candidate did not commit. */ }
    emitMechanismEvent("formal_main_action", state, undefined, { committed: true });
    return "authority result";
  });
  assert.equal(observed.result, "authority result");
  assert.equal(observed.evidenceValid, true);
  assert.equal(observed.events.length, 1);
  evidence.requireValid();
});

test("EVID06 a later timeout cannot turn invalid policy evidence into a legal terminal", () => {
  const invalid = withLostEvidence(make);
  invalid.tick(invalid.room.game!.state.turnDeadlineAt!);
  assert.equal(invalid.room.game!.state.reason, "timeout");
  assert.deepEqual(invalid.classify(), { status: "invalid_execution", reason: "mechanism_evidence_invalid", result: null });
});
