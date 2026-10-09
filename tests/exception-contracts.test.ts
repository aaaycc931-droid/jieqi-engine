import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, applyHeroAbility, initializeFeatureGameState, disconnectRemotePlayer, reconnectRemotePlayer, advanceRemoteRoomTime, submitRemoteMove, getLegalMoves } from "../src/index.ts";
import { destroyPiece, relocatePiece } from "../src/settlement.ts";
import type { RemoteRoom } from "../src/index.ts";
import { gameState, move, revealed, secretState } from "./helpers.ts";

test("EX-TIME-01 occupied timeline return spends once, leaves both pieces and skips controlled action", () => {
  const s = initializeFeatureGameState(gameState([revealed("rook", "red", "rook", 0, 6), revealed("block", "black", "pawn", 0, 7)]), { red: "hunter", black: "murozond" });
  const h = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 6 }, { x: 0, y: 5 }, "previous"));
  // Simulate a return square occupied by another ground piece at commit time.
  h.state.pieces.find(p => p.id === "block")!.y = 6;
  const command = { kind: "hero_ability" as const, ability: "timeline_twist" as const, actionId: "twist", expectedRevision: h.state.revision, to: { x: 0, y: 8 } };
  const r = applyHeroAbility(h.state, h.secret, command, 100);
  assert.equal(r.state.pieces.find(p => p.id === "rook")?.y, 5);
  assert.equal(r.state.pieces.find(p => p.id === "block")?.y, 6);
  assert.equal(r.state.heroRuntime?.black?.used, true);
  assert.equal(r.state.formalTurns?.black, 1);
  assert.equal(r.secret.processedActions["twist:controlled"], undefined);
  assert.equal(r.state.landingEvents?.length, 0);
  assert.equal(applyHeroAbility(r.state, r.secret, command, 200).duplicate, true);
});

test("EX-TIME-02 returned bottom-rank pawn with no legal move refuses the whole skill", () => {
  const s = initializeFeatureGameState(gameState([revealed("pawn", "red", "pawn", 0, 0)]), { red: "hunter", black: "murozond" });
  const h = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 0 }, { x: 1, y: 0 }, "previous"));
  // Construct current availability after a displacement, without overlapping pieces.
  Object.assign(h.state.pieces.find(p => p.id === "pawn")!, { x: 0, y: 2 });
  h.state.pieces.push(revealed("closed-side", "red", "pawn", 1, 0));
  const preview = structuredClone(h.state); Object.assign(preview.pieces.find(p => p.id === "pawn")!, { x: 0, y: 0 }); preview.turn = "red";
  assert.deepEqual(getLegalMoves(preview, "pawn"), []);
  const before = structuredClone(h);
  assert.throws(() => applyHeroAbility(h.state, h.secret, { kind: "hero_ability", ability: "timeline_twist", actionId: "twist", expectedRevision: h.state.revision, to: { x: 0, y: 1 } }, 100), e => e.code === "INVALID_CONTROLLED_MOVE");
  assert.deepEqual(h, before);
});

test("EX-WARRIOR-01 three different slots persist after death, re-entry and restored piece identity", () => {
  let s = initializeFeatureGameState(gameState([revealed("a", "red", "rook", 3, 7), revealed("b", "red", "rook", 4, 7), revealed("c", "red", "rook", 5, 7), revealed("d", "red", "rook", 3, 8), revealed("screen3", "black", "pawn", 3, 3), revealed("screen4", "black", "pawn", 4, 3), revealed("screen5", "black", "pawn", 5, 3)]), { red: "warrior", black: "hunter" });
  let k = secretState();
  const act = (id: string, to: { x: number; y: number }) => {
    s.turn = "red";
    const p = s.pieces.find(p => p.id === id)!;
    const r = applyAuthoritativeMove(s, k, move(p, to, `${id}:${s.revision}`, s.revision)); s = r.state; k = r.secret;
  };
  act("a", { x: 3, y: 6 }); act("b", { x: 4, y: 6 }); act("c", { x: 5, y: 6 });
  assert.deepEqual(s.warrior?.red.barrierPieceIds, ["a", "b", "c"]);
  destroyPiece(s, k, "a", "black", "test_lifecycle");
  assert.deepEqual(s.warrior?.red.barrierPieceIds, ["a", "b", "c"]);
  // State restoration fixture: no current warrior revival source is assumed.
  s.pieces.push(revealed("a", "red", "rook", 3, 7));
  act("a", { x: 3, y: 6 });
  assert.equal(s.effectsByPieceId?.a?.barrier, undefined);
  act("b", { x: 4, y: 7 }); delete s.effectsByPieceId!.b;
  act("b", { x: 4, y: 6 });
  assert.equal(s.effectsByPieceId?.b?.barrier, undefined);
  act("d", { x: 2, y: 8 });
  assert.equal(s.effectsByPieceId?.d?.barrier, undefined);
  assert.deepEqual(s.warrior?.red.barrierPieceIds, ["a", "b", "c"]);
});

test("EX-WARRIOR-02 fortress allows original-square barrier bounce but blocks other returns", () => {
  const s = initializeFeatureGameState(gameState([revealed("attacker", "red", "rook", 4, 1), revealed("guard", "black", "rook", 4, 3)]), { red: "hunter", black: "warrior" }, "iron_wall");
  s.effectsByPieceId = { guard: { barrier: { owner: "black", enemyTurnsRemaining: 3 } } };
  const r = applyAuthoritativeMove(s, secretState(), move({ x: 4, y: 1 }, { x: 4, y: 3 }, "bounce"));
  assert.equal(r.state.pieces.find(p => p.id === "attacker")?.y, 1);
  assert.equal(r.state.pieces.some(p => p.id === "guard"), true);
  assert.equal(r.state.effectsByPieceId?.guard?.barrier, undefined);
  assert.equal(r.state.automaticEvents?.some(e => e.kind === "destroy:suffocation"), false);
  const k = r.secret; r.state.pieces.find(p => p.id === "attacker")!.y = 3;
  assert.equal(relocatePiece(r.state, k, "attacker", { x: 4, y: 1 }, "ordinary_return"), false);
});

for (const replay of [false, true]) test(`EX-CLOCK-01 ${replay ? "rewind replay" : "formal turn"} pause preserves remaining time and rejects expiry exactly`, () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7)]), { red: "nozdormu", black: "hunter" });
  s.turnStartedAt = 1_000; s.turnDeadlineAt = 11_000;
  const k = secretState(); if (replay) k.replay = { pieceId: "mover", deadlineAt: 11_000 };
  let room = { roomId: "pause", seats: { host: { playerId: "alice" }, guest: { playerId: "bob" } }, rps: { assignments: { red: "alice", black: "bob" } }, phase: "playing", updatedAt: 1_000, game: { players: { red: "alice", black: "bob" }, state: s, secret: k }, disconnects: { players: { alice: { accumulatedMs: 0, reconnectCount: 0 }, bob: { accumulatedMs: 0, reconnectCount: 0 } } } } as RemoteRoom;
  room = disconnectRemotePlayer(room, "bob", 4_000);
  const before = structuredClone(room);
  assert.equal(advanceRemoteRoomTime(room, undefined, 20_000).phase, "playing");
  const resumed = reconnectRemotePlayer(room, "bob", 24_000);
  assert.deepEqual(room, before);
  assert.equal(resumed.game!.state.turnStartedAt, 21_000);
  assert.equal(resumed.game!.state.turnDeadlineAt, 31_000);
  if (replay) assert.equal(resumed.game!.secret.replay?.deadlineAt, 31_000);
  assert.equal(advanceRemoteRoomTime(resumed, undefined, 30_999).phase, "playing");
  const late = submitRemoteMove(resumed, "alice", move({ x: 0, y: 7 }, { x: 0, y: 6 }, "late"), 31_000).room;
  assert.equal(late.phase, "finished"); assert.equal(late.game!.state.reason, "timeout");
  assert.equal(late.game!.state.pieces.find(p => p.id === "mover")?.y, 7);
});

test("EX-CLOCK-02 overlapping disconnects shift once when the final player reconnects", () => {
  const s = gameState(); s.turnStartedAt = 1_000; s.turnDeadlineAt = 61_000;
  let room = { roomId: "overlap", seats: { host: { playerId: "alice" }, guest: { playerId: "bob" } }, rps: { assignments: { red: "alice", black: "bob" } }, phase: "playing", game: { players: { red: "alice", black: "bob" }, state: s, secret: secretState() }, disconnects: { players: { alice: { accumulatedMs: 0, reconnectCount: 0 }, bob: { accumulatedMs: 0, reconnectCount: 0 } } } } as RemoteRoom;
  room = disconnectRemotePlayer(room, "alice", 5_000); room = disconnectRemotePlayer(room, "bob", 10_000);
  room = reconnectRemotePlayer(room, "alice", 15_000);
  assert.equal(room.game!.state.turnDeadlineAt, 61_000);
  room = reconnectRemotePlayer(room, "bob", 25_000);
  assert.equal(room.game!.state.turnDeadlineAt, 81_000);
  assert.equal(reconnectRemotePlayer(room, "bob", 30_000).game!.state.turnDeadlineAt, 81_000);
});

for (const ability of ["rewind", "timeline_twist", "hourglass"] as const) test(`EX-END-01 finished game rejects ${ability} without changing resources`, () => {
  const s = initializeFeatureGameState(gameState([], { status: "finished" }), { red: ability === "timeline_twist" ? "murozond" : "nozdormu", black: "hunter" });
  const k = secretState(), before = structuredClone({ s, k });
  assert.throws(() => applyHeroAbility(s, k, { kind: "hero_ability", ability, actionId: "after-end", expectedRevision: s.revision }, 100), e => e.code === "INVALID_PHASE");
  assert.deepEqual({ s, k }, before);
});
