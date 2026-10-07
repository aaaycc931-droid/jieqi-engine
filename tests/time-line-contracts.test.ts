import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, applyHeroAbility, initializeFeatureGameState, initializeFeatureSecret, submitRemoteMove, submitRemoteHeroAbility, validatePublicMove } from "../src/index.ts";
import type { GameState, HeroAbilityCommand, RemoteRoom } from "../src/index.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";

const skill = (ability: HeroAbilityCommand["ability"], state: GameState, to?: { x: number; y: number }) => ({ kind: "hero_ability" as const, ability, actionId: `skill:${ability}:${state.revision}`, expectedRevision: state.revision, ...(to ? { to } : {}) });

function turncoatHistory(remaining: number) {
  // 猎人控制的暗兵揭示后倒戈。姆诺兹多将其退回猎人的脚下陷阱。
  const s = initializeFeatureGameState(gameState([covered("turncoat", 0, 6), revealed("red-pawn", "red", "pawn", 2, 6), revealed("black-pawn", "black", "pawn", 2, 3)]), { red: "hunter", black: "murozond" });
  const k = secretState({ turncoat: { color: "black", type: "rook" } });
  k.traps = [{ id: "return-trap", owner: "red", position: { x: 0, y: 6 }, opponentTurnsRemaining: remaining }];
  return applyAuthoritativeMove(s, k, move({ x: 0, y: 6 }, { x: 0, y: 5 }, "turncoat"));
}

test("TIME-TRAP-01 late return trap is lethal and stops linked control", () => {
 const h=turncoatHistory(3),before=structuredClone(h),r=applyHeroAbility(h.state,h.secret,skill("timeline_twist",h.state,{x:0,y:7}),100);
 assert.equal(r.state.pieces.some(p=>p.id==="turncoat"),false);assert.equal(r.state.formalTurns!.black,1);assert.equal(r.secret.traps?.length,0);assert.equal(r.secret.processedActions["skill:timeline_twist:1:controlled"],undefined);assert.deepEqual(h,before);
});

test("TIME-TIER-01 timeline rewrite is tier III in history and public action record", () => {
  const h = turncoatHistory(3);
  const r = applyHeroAbility(h.state, h.secret, skill("timeline_twist", h.state, { x: 0, y: 7 }), 100);
  assert.equal(r.secret.history?.at(-1)?.tier, 3);
  assert.equal(r.state.lastMove?.tier, 3);
  const replay = applyHeroAbility(r.state, r.secret, skill("timeline_twist", h.state, { x: 0, y: 7 }), 200);
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.state, r.state);
  assert.deepEqual(replay.secret, r.secret);
});

test("TIME-TIER-02 opposing Murozond cannot treat a completed rewrite as an ordinary prior action", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7)]), { red: "murozond", black: "murozond" });
  const first = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }, "first"));
  const twisted = applyHeroAbility(first.state, first.secret, skill("timeline_twist", first.state, { x: 0, y: 8 }), 100);
  const before = structuredClone(twisted);
  assert.throws(() => applyHeroAbility(twisted.state, twisted.secret, skill("timeline_twist", twisted.state, { x: 0, y: 7 }), 200), e => e.code === "NOT_PREVIOUS_ORDINARY");
  assert.deepEqual(twisted, before);
});

test("TIME-TRAP-02 lethal return trap closes the skill without executing its selected move", () => {
  const h = turncoatHistory(4);
  const r = applyHeroAbility(h.state, h.secret, skill("timeline_twist", h.state, { x: 0, y: 7 }), 100);
  assert.equal(r.state.pieces.some(p => p.id === "turncoat"), false);
  assert.equal(r.state.captured.find(p => p.id === "turncoat")?.cause, "trap_ambush");
  assert.equal(r.state.formalTurns?.black, 1);
  assert.equal(r.state.turn, "red");
  assert.equal(r.secret.processedActions["skill:timeline_twist:1:controlled"], undefined);
});

test("TIME-TRAP-03 invalid controlled destination rolls back resource, trap and history changes", () => {
  const h = turncoatHistory(0), before = structuredClone(h);
  assert.throws(() => applyHeroAbility(h.state, h.secret, skill("timeline_twist", h.state, { x: 1, y: 7 }), 100), e => e.code === "INVALID_CONTROLLED_MOVE");
  assert.deepEqual(h, before);
});

function rewindHistory(remaining: number) {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7), revealed("reply", "black", "pawn", 2, 3)]), { red: "nozdormu", black: "hunter" });
  s.turnStartedAt = 0; s.turnDeadlineAt = 60_000;
  const first = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }, "first"), false, 60_000 - remaining);
  const second = applyAuthoritativeMove(first.state, first.secret, move({ x: 2, y: 3 }, { x: 2, y: 4 }, "reply", first.state.revision), false, 61_000);
  second.state.turnStartedAt = 62_000; second.state.turnDeadlineAt = 122_000;
  return second;
}

for (const remaining of [3_000, 10_000, 42_000]) test(`TIME-CLOCK-01 rewind replay budget uses historical ${remaining}ms remaining`, () => {
  const h = rewindHistory(remaining);
  const r = applyHeroAbility(h.state, h.secret, skill("rewind", h.state), 63_000);
  assert.equal(r.state.turnDeadlineAt, 63_000 + Math.min(remaining, 10_000));
  assert.equal(r.secret.replay?.deadlineAt, r.state.turnDeadlineAt);
  assert.equal(r.secret.history?.find(h => h.actingSide === "red")?.remainingMs, remaining);
});

test("TIME-CLOCK-02 room receipt time is authoritative for rewind, including exact replay expiry", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7), revealed("reply", "black", "pawn", 2, 3)]), { red: "nozdormu", black: "hunter" });
  s.turnStartedAt = 0; s.turnDeadlineAt = 60_000;
  let room = { roomId: "time", phase: "playing", updatedAt: 0, game: { players: { red: "alice", black: "bob" }, state: s, secret: secretState() } } as RemoteRoom;
  room = submitRemoteMove(room, "alice", move({ x: 0, y: 7 }, { x: 0, y: 6 }, "first"), 57_000).room;
  room = submitRemoteMove(room, "bob", move({ x: 2, y: 3 }, { x: 2, y: 4 }, "reply", room.game!.state.revision), 63_000).room;
  room = submitRemoteHeroAbility(room, "alice", skill("rewind", room.game!.state), 64_000).room;
  assert.equal(room.game!.state.turnDeadlineAt, 67_000);
  const late = submitRemoteMove(room, "alice", move({ x: 0, y: 7 }, { x: 0, y: 8 }, "late", room.game!.state.revision), 67_000).room;
  assert.equal(late.phase, "finished"); assert.equal(late.game!.state.reason, "timeout");
  assert.equal(late.game!.state.pieces.find(p => p.id === "mover")?.y, 7);
});

test("TIME-CLOCK-03 missing historical clock evidence refuses rewind without consuming it", () => {
  const h = rewindHistory(3_000);
  delete h.secret.history![0].remainingMs;
  const before = structuredClone(h);
  assert.throws(() => applyHeroAbility(h.state, h.secret, skill("rewind", h.state), 63_000), e => e.code === "REWIND_CLOCK_MISSING");
  assert.deepEqual(h, before);
});

test("TIME-SNAPSHOT-01 rewind restores opponent secret skill resources and trap durations without re-landing", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7), revealed("host", "black", "rook", 2, 2)]), { red: "nozdormu", black: "wind" });
  s.turnStartedAt = 0; s.turnDeadlineAt = 60_000;
  const k = secretState();
  k.traps = [{ id: "persistent", owner: "red", position: { x: 1, y: 7 }, opponentTurnsRemaining: 8 }];
  initializeFeatureSecret(s, k);
  const initialWind = structuredClone(k.wind!.black);
  const first = applyAuthoritativeMove(s, k, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "first"), false, 55_000);
  const shadow = applyHeroAbility(first.state, first.secret, { ...skill("shadow", first.state), pieceId: "host" }, 61_000);
  assert.equal(shadow.secret.wind?.black?.uses, 1);
  const reply = applyAuthoritativeMove(shadow.state, shadow.secret, move({ x: 2, y: 2 }, { x: 2, y: 3 }, "reply", shadow.state.revision), false, 62_000);
  reply.state.turnStartedAt = 63_000; reply.state.turnDeadlineAt = 123_000;
  assert.equal(reply.secret.traps?.[0].opponentTurnsRemaining, 7);
  const rewind = applyHeroAbility(reply.state, reply.secret, skill("rewind", reply.state), 64_000);
  assert.deepEqual(rewind.secret.wind?.black, initialWind);
  assert.deepEqual(rewind.secret.traps, k.traps);
  assert.deepEqual(rewind.state.pieces, s.pieces);
  assert.deepEqual(rewind.state.heroRuntime, s.heroRuntime);
  assert.equal(rewind.state.landingEvents?.length ?? 0, 0);
  assert.equal(rewind.state.automaticEvents?.length ?? 0, 0);
  assert.equal(rewind.secret.rewindUsed?.red, true);
  assert.equal(rewind.secret.replay?.deadlineAt, 69_000);
});
