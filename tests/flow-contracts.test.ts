import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, applyAutomaticExecution, getFlowDanceMoves, isGeneralInCheck } from "../src/index.ts";
import { revealed, covered, move } from "./helpers.ts";
import { flowFixture, executedWindFixture } from "./flow-fixtures.ts";

test("FLOW-DEFENSE-01 ordinary barrier bounces first dance attack and can be consumed before second capture", () => {
  const h = flowFixture([revealed("lock", "black", "rook", 3, 5), revealed("guard", "black", "pawn", 4, 9)]);
  h.state.effectsByPieceId = { guard: { barrier: { owner: "black", enemyTurnsRemaining: 3 } } };
  const first = applyAuthoritativeMove(h.state, h.secret, move({ x: 3, y: 9 }, { x: 4, y: 9 }, "first"));
  assert.ok(first.state.pieces.some(p => p.id === "guard"));
  assert.equal(first.state.pieces.find(p => p.id === "red-general")?.x, 3);
  assert.equal(first.state.effectsByPieceId?.guard?.barrier, undefined);
  assert.equal(first.state.flowDance?.steps, 1);
  assert.deepEqual(first.state.formalTurns, h.state.formalTurns);
  const second = applyAuthoritativeMove(first.state, first.secret, move({ x: 3, y: 9 }, { x: 4, y: 9 }, "second", first.state.revision));
  assert.equal(second.state.captured.find(p => p.id === "guard")?.cause, "flow_attack");
  assert.equal(second.state.pieces.find(p => p.id === "red-general")?.x, 4);
  assert.equal(second.state.flowDance, undefined); assert.equal(second.state.turn, "red");
  assert.equal(second.state.lastMove?.countsAsFormalTurn, false);
});

test("FLOW-DEFENSE-02 second-step markers do not treat a protected capture as safe escape", () => {
  const h = flowFixture([revealed("lock", "black", "rook", 3, 5), revealed("guard", "black", "pawn", 4, 9)]);
  h.state.flowDance!.steps = 1;
  h.state.effectsByPieceId = { guard: { barrier: { owner: "black", enemyTurnsRemaining: 3 } } };
  assert.equal(getFlowDanceMoves(h.state, "red-general").some(p => p.x === 4 && p.y === 9), false);
  const r = applyAuthoritativeMove(h.state, h.secret, move({ x: 3, y: 9 }, { x: 4, y: 9 }, "bounce-fails"));
  assert.equal(r.state.status, "execution"); assert.equal(r.state.reason, "checkmate");
  assert.ok(r.state.pieces.some(p => p.id === "guard")); assert.equal(r.state.flowDance, undefined);
});

test("FLOW-DEFENSE-03 bounce triggers the original-square trap, never the protected target trap", () => {
  // Constructed cross-source fixture isolates landing dispatch, not a natural
  // Warrior+Hunter hero pairing on one side.
  const h = flowFixture([revealed("guard", "black", "pawn", 4, 9)]);
  h.state.effectsByPieceId = { guard: { barrier: { owner: "black", enemyTurnsRemaining: 3 } } };
  h.secret.traps = [{ id: "origin", owner: "black", position: { x: 3, y: 9 }, opponentTurnsRemaining: 6 }, { id: "target", owner: "black", position: { x: 4, y: 9 }, opponentTurnsRemaining: 6 }];
  const r = applyAuthoritativeMove(h.state, h.secret, move({ x: 3, y: 9 }, { x: 4, y: 9 }, "bounce-trap"));
  assert.equal(r.state.status, "finished"); assert.equal(r.state.reason, "trap_ambush");
  assert.ok(r.state.pieces.some(p => p.id === "guard"));
  assert.equal(r.state.captured.find(p => p.id === "red-general")?.position?.x, 3);
  assert.deepEqual(r.secret.traps?.map(t => t.id), ["target"]);
  assert.equal(r.state.flowDance, undefined);
});

test("FLOW-ATOMIC-01 actual execution return and two-step escape preserve formal counters and idempotency", () => {
  const h = executedWindFixture(), before = structuredClone(h);
  assert.equal(h.state.flowDance?.pieceId, "host");
  assert.equal(h.state.pieces.find(p => p.id === "executor")?.y, 7);
  assert.equal(h.state.pieces.find(p => p.id === "host")?.type, "general");
  const command = move({ x: 3, y: 9 }, { x: 3, y: 8 }, "first", h.state.revision);
  const first = applyAuthoritativeMove(h.state, h.secret, command);
  assert.equal(first.state.flowDance?.steps, 1); assert.equal(isGeneralInCheck(first.state, "red"), true);
  assert.deepEqual(first.state.formalTurns, h.state.formalTurns);
  const repeated = applyAuthoritativeMove(first.state, first.secret, command);
  assert.equal(repeated.duplicate, true); assert.deepEqual(repeated.state, first.state);
  const second = applyAuthoritativeMove(first.state, first.secret, move({ x: 3, y: 8 }, { x: 3, y: 7 }, "second", first.state.revision));
  assert.equal(second.state.flowDance, undefined); assert.equal(second.state.status, "playing");
  assert.equal(second.state.turn, "red"); assert.equal(isGeneralInCheck(second.state, "red"), false);
  assert.deepEqual(second.state.formalTurns, h.state.formalTurns); assert.deepEqual(h, before);
});

test("FLOW-FAIL-01 wrong first branch with no safe continuation retains original execution outcome", () => {
  const h = flowFixture([revealed("lock3", "black", "rook", 3, 5), revealed("lock4", "black", "rook", 4, 5), revealed("screen", "black", "pawn", 5, 3)]);
  h.state.pieces.find(p => p.id === "red-general")!.x = 4;
  assert.ok(getFlowDanceMoves(h.state, "red-general").some(p => p.x === 5 && p.y === 9));
  const r = applyAuthoritativeMove(h.state, h.secret, move({ x: 4, y: 9 }, { x: 3, y: 9 }, "wrong-branch"));
  assert.equal(r.state.status, "execution"); assert.equal(r.state.reason, "checkmate");
  assert.equal(r.state.winner, "black"); assert.equal(r.state.flowDance, undefined);
  assert.deepEqual(r.state.formalTurns, h.state.formalTurns);
  const finished = applyAutomaticExecution(r.state, r.secret, "continue-execution");
  assert.equal(finished.state.status, "finished"); assert.equal(finished.state.reason, "checkmate");
});

test("FLOW-REGION-01 expedition still restricts dance to one orthogonal palace step", () => {
  const h = flowFixture([], "expedition"), before = structuredClone(h);
  const targets = getFlowDanceMoves(h.state, "red-general");
  assert.ok(targets.every(p => p.x >= 3 && p.x <= 5 && p.y >= 7 && p.y <= 9));
  for (const to of [{ x: 3, y: 6 }, { x: 5, y: 9 }, { x: 4, y: 8 }]) {
    assert.throws(() => applyAuthoritativeMove(h.state, h.secret, move({ x: 3, y: 9 }, to, `invalid:${to.x}:${to.y}`)), e => e.code === "INVALID_FLOW_STEP");
    assert.deepEqual(h, before);
  }
});

test("FLOW-DEATH-01 dance capture creates Death Knight ghost without aging formal-turn durations", () => {
  const h = flowFixture([revealed("victim", "black", "pawn", 4, 9)], undefined, "death_knight");
  const r = applyAuthoritativeMove(h.state, h.secret, move({ x: 3, y: 9 }, { x: 4, y: 9 }, "capture"));
  assert.equal(r.state.ghosts?.find(g => g.owner === "black")?.remaining, 3);
  assert.deepEqual(r.state.ghosts?.[0].position, { x: 4, y: 9 });
  assert.deepEqual(r.state.formalTurns, h.state.formalTurns);
});

test("FLOW-SECRET-01 covered capture reveals death identity and clears private identity exactly once", () => {
  const h = flowFixture([covered("covered", 3, 9)]);
  h.state.pieces.find(p => p.id === "red-general")!.x = 4;
  h.secret.identities.covered = { color: "black", type: "horse" };
  const r = applyAuthoritativeMove(h.state, h.secret, move({ x: 4, y: 9 }, { x: 3, y: 9 }, "capture"));
  assert.equal(r.state.captured.find(p => p.id === "covered")?.type, "horse");
  assert.equal(r.secret.identities.covered, undefined);
  assert.equal(r.state.lastMove?.captured?.id, "covered");
});

test("FLOW-DEATH-02 lethal trap during actual returned dance stops before second step without formal tick", () => {
  const h = executedWindFixture();
  h.secret.traps = [{ id: "lethal", owner: "black", position: { x: 3, y: 8 }, opponentTurnsRemaining: 6 }];
  const r = applyAuthoritativeMove(h.state, h.secret, move({ x: 3, y: 9 }, { x: 3, y: 8 }, "trap", h.state.revision));
  assert.equal(r.state.status, "finished"); assert.equal(r.state.reason, "trap_ambush");
  assert.equal(r.state.flowDance, undefined); assert.deepEqual(r.state.formalTurns, h.state.formalTurns);
  assert.equal(r.state.captured.find(p => p.id === "host")?.type, "general");
  assert.throws(() => applyAuthoritativeMove(r.state, r.secret, move({ x: 3, y: 8 }, { x: 3, y: 7 }, "after-death", r.state.revision)), e => e.code === "GAME_FINISHED");
});

test("FLOW-CLOCK-01 room two-step escape preserves its formal deadline and next ordinary move starts the next clock", async () => {
  const { createRemoteRoom, joinRemoteRoom, submitRemoteMove } = await import("../src/index.ts");
  const h = executedWindFixture(); h.state.turnStartedAt = 1_000; h.state.turnDeadlineAt = 61_000;
  const joined = joinRemoteRoom(createRemoteRoom("flow-clock", "alice", "token", 1_000), "bob", "token", 1_000).room;
  const room = { ...joined, phase: "playing" as const, game: { ...h, players: { red: "alice", black: "bob" } } };
  const first = submitRemoteMove(room, "alice", move({ x: 3, y: 9 }, { x: 3, y: 8 }, "dance-one", h.state.revision), 10_000).room;
  const second = submitRemoteMove(first, "alice", move({ x: 3, y: 8 }, { x: 3, y: 7 }, "dance-two", first.game!.state.revision), 20_000).room;
  assert.equal(second.game!.state.flowDance, undefined); assert.equal(second.game!.state.turn, "red");
  assert.equal(second.game!.state.turnStartedAt, 1_000); assert.equal(second.game!.state.turnDeadlineAt, 61_000);
  const ordinary = submitRemoteMove(second, "alice", move({ x: 3, y: 7 }, { x: 3, y: 8 }, "ordinary", second.game!.state.revision), 30_000).room;
  assert.equal(ordinary.game!.state.turn, "black"); assert.equal(ordinary.game!.state.turnStartedAt, 30_000);
  assert.equal(ordinary.game!.state.turnDeadlineAt, 90_000);
});
