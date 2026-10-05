import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeAssassination, applyAuthoritativeMove, applyHeroAbility, getLegalAssassinationMoves, getLegalMoves, initializeFeatureGameState, initializeFeatureSecret, isGeneralInCheck, publicRemoteRoom, playerRoomView, submitRemoteHeroAbility } from "../src/index.ts";
import type { GameState, HeroAbilityCommand, RemoteRoom } from "../src/index.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";

const skill = (ability: HeroAbilityCommand["ability"], state: GameState, extra: Partial<HeroAbilityCommand> = {}) => ({ kind: "hero_ability" as const, ability, actionId: `target:${ability}:${state.revision}`, expectedRevision: state.revision, ...extra });

test("TARGET-SHADOW-01 actual Wind Shadow Dance cannot directly select its invisible piece and rolls back", () => {
  const s = initializeFeatureGameState(gameState([revealed("host", "red", "rook", 0, 7), revealed("reply", "black", "pawn", 2, 3)]), { red: "wind", black: "hunter" }, "shadow_dance");
  const hidden = applyAuthoritativeAssassination(s, secretState(), { ...move({ x: 0, y: 7 }, { x: 0, y: 6 }, "conceal"), kind: "assassination", source: "mutation", useStrongStrike: false });
  const reply = applyAuthoritativeMove(hidden.state, hidden.secret, move({ x: 2, y: 3 }, { x: 2, y: 4 }, "reply", hidden.state.revision));
  const before = structuredClone(reply);
  assert.throws(() => applyHeroAbility(reply.state, reply.secret, skill("shadow", reply.state, { pieceId: "host" })), e => e.code === "INVALID_SHADOW_TARGET");
  assert.deepEqual(reply, before);
});

test("TARGET-WIND-01 ordinary capture markers and check ignore the concealed true general identity", () => {
  const s = initializeFeatureGameState(gameState([revealed("host", "red", "rook", 0, 7), revealed("mover", "red", "pawn", 2, 6), revealed("attacker", "black", "rook", 0, 3)]), { red: "wind", black: "hunter" });
  const shadow = applyHeroAbility(s, secretState(), skill("shadow", s, { pieceId: "host" }));
  const turn = applyAuthoritativeMove(shadow.state, shadow.secret, move({ x: 2, y: 6 }, { x: 2, y: 5 }, "pass"));
  const ordinary = applyAuthoritativeMove(s, secretState(), move({ x: 2, y: 6 }, { x: 2, y: 5 }, "pass"));
  assert.deepEqual(turn.state, ordinary.state);
  assert.deepEqual(getLegalMoves(turn.state, "attacker"), getLegalMoves(ordinary.state, "attacker"));
  assert.ok(getLegalMoves(turn.state, "attacker").some(p => p.x === 0 && p.y === 7));
  assert.equal(isGeneralInCheck(turn.state, "red"), false);
  const killed = applyAuthoritativeMove(turn.state, turn.secret, move({ x: 0, y: 3 }, { x: 0, y: 7 }, "kill-host", turn.state.revision));
  assert.equal(killed.state.status, "finished"); assert.equal(killed.state.winner, "black");
  assert.equal(killed.state.captured.find(p => p.id === "host")?.type, "general");
  assert.equal(killed.state.automaticEvents?.some(e => e.kind === "wind_flow"), false);
});

test("TARGET-WIND-02 delayed strong strike targets a normal-looking carrier, excludes public Wind generals with or without shadow", () => {
  const s = initializeFeatureGameState(gameState([revealed("host", "red", "rook", 0, 7), revealed("mover", "red", "pawn", 2, 6), revealed("striker", "black", "rook", 1, 2)]), { red: "wind", black: "rogue" });
  const shadow = applyHeroAbility(s, secretState(), skill("shadow", s, { pieceId: "host" }));
  let h = applyAuthoritativeMove(shadow.state, shadow.secret, move({ x: 2, y: 6 }, { x: 2, y: 5 }, "red"));
  h = applyAuthoritativeAssassination(h.state, h.secret, { ...move({ x: 1, y: 2 }, { x: 0, y: 2 }, "activate", h.state.revision), kind: "assassination", source: "hero", useStrongStrike: false });
  h = applyAuthoritativeMove(h.state, h.secret, move({ x: 2, y: 5 }, { x: 2, y: 4 }, "red-reply", h.state.revision));
  assert.ok(getLegalAssassinationMoves(h.state, "striker", true).some(p => p.x === 0 && p.y === 7));
  const killed = applyAuthoritativeAssassination(h.state, h.secret, { ...move({ x: 0, y: 2 }, { x: 0, y: 7 }, "strike", h.state.revision), kind: "assassination", useStrongStrike: true });
  assert.equal(killed.state.reason, "ambush"); assert.equal(killed.state.winner, "black");
  for (const activated of [false, true]) {
    const publicState = structuredClone(h.state);
    // Geometry fixture puts the same striker on the public general's file.
    publicState.pieces.find(p => p.id === "striker")!.x = 3;
    const k = structuredClone(h.secret); if (!activated) delete k.wind!.red!.hostId;
    assert.equal(getLegalAssassinationMoves(publicState, "striker", true).some(p => p.x === 3 && p.y === 9), false);
    assert.throws(() => applyAuthoritativeAssassination(publicState, k, { ...move({ x: 3, y: 2 }, { x: 3, y: 9 }, `public:${activated}`, publicState.revision), kind: "assassination", useStrongStrike: true }), e => e.code === "ILLEGAL_TARGET");
  }
});

test("TARGET-RANDOM-01 a sole invisible carrier remains a legal random execution target", () => {
  const s = initializeFeatureGameState(gameState([revealed("host", "black", "rook", 0, 7)], { turn: "black" }), { red: "devout_zealot", black: "wind" }, "shadow_dance");
  s.heroRuntime!.red!.invokeCount = 4; // Prepared descended phase, not a complete setup flow.
  const shadow = applyHeroAbility(s, secretState(), skill("shadow", s, { pieceId: "host" }));
  const hidden = applyAuthoritativeAssassination(shadow.state, shadow.secret, { ...move({ x: 0, y: 7 }, { x: 0, y: 6 }, "conceal"), kind: "assassination", source: "mutation", useStrongStrike: false });
  let poolSize = 0;
  const killed = applyHeroAbility(hidden.state, hidden.secret, skill("unspeakable", hidden.state), 100, max => { poolSize = max; return 0; });
  assert.equal(poolSize, 1); assert.equal(killed.state.winner, "red");
  assert.equal(killed.state.reason, "general_destroyed");
  assert.equal(killed.state.captured.find(p => p.id === "host")?.cause, "unspeakable");
  assert.ok(killed.state.pieces.some(p => p.id === "black-general"));
});

test("TARGET-RANDOM-02 destruction includes a covered carrier and finishes every locked draw after its death", () => {
  const s = initializeFeatureGameState(gameState([covered("host", 0, 3), revealed("later", "red", "pawn", 2, 6), revealed("reply", "black", "pawn", 2, 3)], { turn: "black" }), { red: "deathwing", black: "wind" });
  const k = secretState({ host: { color: "black", type: "rook" } });
  const shadow = applyHeroAbility(s, k, skill("shadow", s, { randomCovered: true }), 100, () => 0);
  const h = applyAuthoritativeMove(shadow.state, shadow.secret, move({ x: 2, y: 3 }, { x: 2, y: 4 }, "reply"));
  let draws = 0;
  const killed = applyHeroAbility(h.state, h.secret, skill("destruction", h.state), 200, max => { assert.equal(max, 2); draws++; return 0; });
  assert.equal(draws, 3); assert.equal(killed.state.winner, "red");
  assert.deepEqual(killed.state.captured.map(p => p.id), ["host", "later", "reply"]);
  assert.equal(killed.secret.identities.host, undefined);
  assert.equal(killed.state.captured[0].type, "general");
  assert.equal(killed.state.pieces.filter(p => !p.faceDown && p.type === "general").length, 2);
});

test("TARGET-PRIVATE-01 opponent serialized view and public legality stay identical after secret shadow", () => {
  const s = initializeFeatureGameState(gameState([revealed("host", "red", "rook", 0, 7), revealed("attacker", "black", "rook", 0, 3)]), { red: "wind", black: "hunter" });
  const k = secretState(); initializeFeatureSecret(s, k);
  const room = { roomId: "public-target", phase: "playing", updatedAt: 100, seats: { host: { playerId: "alice", connectedAt: 0, lastSeenAt: 0 }, guest: { playerId: "bob", connectedAt: 0, lastSeenAt: 0 } }, mode: { heroesEnabled: true, mutationsEnabled: false }, game: { players: { red: "alice", black: "bob" }, state: s, secret: k }, features: { heroes: { red: "wind", black: "hunter" } }, featureSecret: { traps: [] } } as RemoteRoom;
  const after = submitRemoteHeroAbility(room, "alice", skill("shadow", s, { pieceId: "host" }), 200).room;
  assert.deepEqual(publicRemoteRoom(after), publicRemoteRoom(room));
  assert.equal(JSON.stringify(playerRoomView(after, "bob")), JSON.stringify(playerRoomView(room, "bob")));
  const beforeState = { ...room.game!.state, turn: "black" as const }, afterState = { ...after.game!.state, turn: "black" as const };
  assert.deepEqual(getLegalMoves(afterState, "attacker"), getLegalMoves(beforeState, "attacker"));
});
