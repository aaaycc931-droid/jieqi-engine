import assert from "node:assert/strict";
import test from "node:test";
import { applyHeroAbility, applyAuthoritativeMove, getRelayPairs, initializeFeatureGameState, initializeFeatureSecret,
  publicStateSnapshot, hasAnyLegalMove, isGeneralInCheck, HERO_IDS, getHeroPackage, putGhostObject,
  validateHeroForms, startFormalClock, getLegalMoves } from "../src/index.ts";
import { gameState, revealed, covered, secretState } from "./helpers.ts";
import type { GameState, HeroAbilityCommand, MutationId, Side } from "../src/types.ts";

export function fixture(side: Side = "red", mutation?: MutationId) {
  const y = side === "red" ? 6 : 3;
  const state = initializeFeatureGameState(gameState([
    revealed("a", side, "rook", 0, y), revealed("b", side, "horse", 2, y),
    revealed("enemy", side === "red" ? "black" : "red", "pawn", 8, 4),
  ], { turn: side }), { [side]: "siheng" }, mutation, undefined, undefined, true);
  const secret = secretState(); initializeFeatureSecret(state, secret);
  return { state, secret };
}
export const swap = (state: GameState, rest: Partial<HeroAbilityCommand> = {}): HeroAbilityCommand =>
  ({ kind: "hero_ability", ability: "relay_swap", pieceId: "a", partnerId: "b", actionId: `swap:${state.revision}`, expectedRevision: state.revision, ...rest });
function assertRejectedUnchanged(f: ReturnType<typeof fixture>, rest: Partial<HeroAbilityCommand> = {}) {
  const before = structuredClone(f);
  assert.throws(() => applyHeroAbility(f.state, f.secret, swap(f.state, rest), 1000, () => 0));
  assert.deepEqual(f, before);
}

test("pilot excluded from product pool and rejects default/mode/form access", () => {
  assert.equal(HERO_IDS.includes("siheng"), false);
  assert.equal(getHeroPackage("siheng").name, "司衡");
  assert.throws(() => getHeroPackage("siheng", "inner"));
  assert.throws(() => initializeFeatureGameState(gameState(), { red: "siheng" }));
  const f = fixture(); f.state.gameMode = "half_chaos"; assert.throws(() => validateHeroForms(f.state));
  f.state.gameMode = "xiangqi"; assert.throws(() => validateHeroForms(f.state));
  f.state.gameMode = "jieqi"; delete f.state.featureRules!.experimentalHeroPilot; assert.throws(() => validateHeroForms(f.state));
});
for (const side of ["red", "black"] as const) test(`swap ${side}: two endpoints, one main turn, public resource, original unchanged`, () => {
  const f = fixture(side), before = structuredClone(f);
  const r = applyHeroAbility(f.state, f.secret, swap(f.state), 1000, () => 0);
  assert.deepEqual(f, before);
  assert.equal(r.state.pieces.find(p => p.id === "a")!.x, 2);
  assert.equal(r.state.pieces.find(p => p.id === "b")!.x, 0);
  assert.equal(r.state.heroRuntime![side]!.relayUses, 1);
  assert.equal(r.state.formalTurns![side], 1);
  assert.notEqual(r.state.turn, side);
  assert.equal(r.state.lastMove!.tier, 2);
  assert.deepEqual(r.state.lastMove!.relaySwap, [
    { pieceId: "a", from: { x: 0, y: side === "red" ? 6 : 3 }, to: { x: 2, y: side === "red" ? 6 : 3 } },
    { pieceId: "b", from: { x: 2, y: side === "red" ? 6 : 3 }, to: { x: 0, y: side === "red" ? 6 : 3 } },
  ]);
  assert.deepEqual(r.state.lastMove!.keywords, ["占步", "耗费", "移置"]);
  assert.equal(r.state.lastCompletedFormalTurn!.phase, "turn_end");
  assert.equal(publicStateSnapshot(r.state).heroRuntime![side]!.relayUses, 1);
});
for (const mutation of ["iron_steed", "war_chariot", "iron_wall", "shadow_dance", "expedition", "cavalry", "chaos", "jian_xie"] as const) test(`swap is displacement, not movement/path attack: ${mutation}`, () => {
  const f = fixture("red", mutation);
  f.state.pieces.push(revealed("middle", "black", "pawn", 1, 6));
  const r = applyHeroAbility(f.state, f.secret, swap(f.state), 1000, () => 0);
  assert(r.state.pieces.some(p => p.id === "middle")); assert.equal(r.state.captured.length, 0);
  assert.equal(r.state.heroRuntime!.red!.relayUses, 1);
});
test("range boundary 4 accepted; 5 rejected", () => {
  const f = fixture(); f.state.pieces.find(p => p.id === "b")!.x = 4;
  assert.equal(getRelayPairs(f.state).length, 1);
  f.state.pieces.find(p => p.id === "b")!.x = 5; assertRejectedUnchanged(f);
});
for (const target of ["same", "enemy", "king", "covered", "air", "river", "intangible", "stealth", "missing"] as const) test(`reject target ${target}, no consumption`, () => {
  const f = fixture(), b = f.state.pieces.find(p => p.id === "b")!;
  if (target === "same") return assertRejectedUnchanged(f, { partnerId: "a" });
  if (target === "enemy") return assertRejectedUnchanged(f, { partnerId: "enemy" });
  if (target === "king") return assertRejectedUnchanged(f, { partnerId: "red-general" });
  if (target === "missing") return assertRejectedUnchanged(f, { partnerId: "absent" });
  if (target === "covered") f.state.pieces = f.state.pieces.map(p => p.id === "b" ? covered("b", 2, 6) : p);
  if (target === "air" || target === "river") b.layer = target;
  if (target === "intangible") f.state.effectsByPieceId!.b = { intangible: true };
  if (target === "stealth") f.state.effectsByPieceId!.b = { stealth: { owner: "red", remainingOwnerTurns: 2, source: "mutation", strongStrikeAvailable: true } };
  assertRejectedUnchanged(f);
});
test("check forbids activation and cannot masquerade as checkmate escape", () => {
  const f = fixture(); f.state.pieces.push(revealed("checker", "black", "rook", 3, 5));
  assert(isGeneralInCheck(f.state, "red")); assert.deepEqual(getRelayPairs(f.state), []); assertRejectedUnchanged(f);
});
test("swap can give check; opponent retains a legal response", () => {
  const f = fixture();
  Object.assign(f.state.pieces.find(p => p.id === "a")!, { x: 1, y: 3 });
  Object.assign(f.state.pieces.find(p => p.id === "b")!, { x: 5, y: 3 });
  const r = applyHeroAbility(f.state, f.secret, swap(f.state), 1000, () => 0);
  assert.equal(r.state.status, "playing"); assert(isGeneralInCheck(r.state, "black"));
  const moves = getLegalMoves(r.state, "black-general", "black"); assert(moves.length > 0);
  const p = r.state.pieces.find(p => p.id === "black-general")!;
  const reply = applyAuthoritativeMove(r.state, r.secret, { from: p, to: moves[0], expectedRevision: r.state.revision, actionId: "reply" }, false, 2000, undefined, () => 0);
  assert(!isGeneralInCheck(reply.state, "black")); assert.equal(reply.state.turn, "red");
});
test("iron wall outside-to-inside cannot be bypassed by occupied endpoints", () => {
  const f = fixture("red", "iron_wall");
  Object.assign(f.state.pieces.find(p => p.id === "a")!, { x: 2, y: 1 });
  Object.assign(f.state.pieces.find(p => p.id === "b")!, { x: 3, y: 1 });
  assertRejectedUnchanged(f);
});
test("finite resource cannot be refreshed by a new command; duplicate remains idempotent", () => {
  const f = fixture(); f.state.heroRuntime!.red!.relayUses = 1;
  const cmd = swap(f.state), r = applyHeroAbility(f.state, f.secret, cmd, 1000, () => 0);
  const dup = applyHeroAbility(r.state, r.secret, cmd, 2000, () => 0);
  assert(dup.duplicate); assert.deepEqual(dup.state, r.state); assert.deepEqual(dup.secret, r.secret);
  const next = { state: r.state, secret: r.secret }; next.state.turn = "red";
  assertRejectedUnchanged(next, { actionId: "new-id", expectedRevision: next.state.revision });
});
test("stale revision and terminal requests are atomic rejections", () => {
  const f = fixture(); assertRejectedUnchanged(f, { expectedRevision: 99 });
  f.state.status = "finished"; assertRejectedUnchanged(f);
});
test("trap risk commits both placements and spends the charge, with no secret oracle", () => {
  const f = fixture();
  // A historical/constructed trap under an already present partner is intentional.
  f.secret.traps = [{ id: "hazard", owner: "black", position: { x: 2, y: 6 }, opponentTurnsRemaining: 4 }];
  const safe = structuredClone(f); safe.secret.traps = [];
  assert.deepEqual(getRelayPairs(f.state), getRelayPairs(safe.state));
  const r = applyHeroAbility(f.state, f.secret, swap(f.state), 1000, () => 0);
  assert(!r.state.pieces.some(p => p.id === "a"));
  assert.equal(r.state.pieces.find(p => p.id === "b")!.x, 0);
  assert.equal(r.state.heroRuntime!.red!.relayUses, 1);
  assert.equal(r.state.captured[0].cause, "trap_ambush");
});
test("canonical endpoints preserve landing order under reversed command", () => {
  const f = fixture();
  const a = applyHeroAbility(f.state, f.secret, swap(f.state), 1000, () => 0);
  const b = applyHeroAbility(f.state, f.secret, swap(f.state, { pieceId: "b", partnerId: "a" }), 1000, () => 0);
  assert.deepEqual(a.state.pieces, b.state.pieces); assert.deepEqual(a.state.automaticEvents, b.state.automaticEvents);
  assert.deepEqual(a.state.lastMove!.relaySwap, b.state.lastMove!.relaySwap);
});
test("infection rechecks each arrival and effects follow identity without refresh", () => {
  const f = fixture(); f.state.effectsByPieceId!.a = { barrier: { owner: "red", enemyTurnsRemaining: 2 } };
  putGhostObject(f.state, { kind: "ghost", source: "test", owner: "black", position: { x: 2, y: 6 }, remaining: 3 }, "replace");
  const r = applyHeroAbility(f.state, f.secret, swap(f.state), 1000, () => 0);
  assert.equal(r.state.effectsByPieceId!.a.barrier!.enemyTurnsRemaining, 2);
  assert.equal(r.state.effectsByPieceId!.a.infection!.stacks, 1); // only arrival; ghost owner black has not ended its turn
  assert(!r.state.effectsByPieceId!.b?.infection);
});
test("availability includes swap when ordinary pieces cannot move", () => {
  const f = fixture(); f.state.pieces = [
    revealed("red-general", "red", "general", 3, 9), revealed("black-general", "black", "general", 5, 0),
    revealed("a", "red", "pawn", 0, 0), revealed("b", "red", "pawn", 1, 0),
    revealed("r1", "black", "rook", 4, 2), revealed("r2", "black", "rook", 2, 8),

  ];
  for (const id of ["a", "b"]) f.state.effectsByPieceId![id] = { controlTrap: { controller: "red", blockedFormalTurn: 1 } };
  for (const id of ["a", "b", "red-general"]) assert.equal(getLegalMoves(f.state, id, "red").length, 0);
  assert(getRelayPairs(f.state).length > 0); assert(hasAnyLegalMove(f.state, "red"));
});
test("private identities and clock unchanged on illegal request; duplicate no extra tick", () => {
  const f = fixture(); f.state.pieces.push(covered("hidden", 8, 6)); f.secret.identities.hidden = { color: "black", type: "cannon" };
  startFormalClock(f.state, 1000, f.secret, () => 0);
  const original = structuredClone(f); assertRejectedUnchanged(f, { partnerId: "hidden" });
  assert.deepEqual(f, original);
  const r = applyHeroAbility(f.state, f.secret, swap(f.state), 2000, () => 0);
  assert.deepEqual(r.secret.identities, f.secret.identities);
  assert(!JSON.stringify(publicStateSnapshot(r.state)).includes('"identities"'));
});

test("two actual alternating turns exhaust swaps; returning positions cannot create an infinite loop", () => {
  let f = fixture();
  for (let i = 0; i < 2; i++) {
    const r = applyHeroAbility(f.state, f.secret, swap(f.state), 1000 + i * 2000, () => 0);
    const p = r.state.pieces.find(p => p.id === "black-general")!;
    const to = getLegalMoves(r.state, p.id)[0]; assert(to);
    const reply = applyAuthoritativeMove(r.state, r.secret, { pieceId: p.id, from: p, to, expectedRevision: r.state.revision, actionId: `reply:${i}` }, false, 2000 + i * 2000, undefined, () => 0);
    f = { state: reply.state, secret: reply.secret };
  }
  assert.equal(f.state.turn, "red"); assert.equal(f.state.heroRuntime!.red!.relayUses, 2);
  assert.equal(f.state.pieces.find(p => p.id === "a")!.x, 0);
  assert.deepEqual(getRelayPairs(f.state), []); assertRejectedUnchanged(f);
});

test("opponent H06 rewinds positions and swap cost through the existing full snapshot", () => {
  const state = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7), revealed("a", "black", "rook", 0, 2), revealed("b", "black", "horse", 2, 2)]), { red: "nozdormu", black: "siheng" }, undefined, undefined, undefined, true);
  const secret = secretState(); initializeFeatureSecret(state, secret);
  state.turnStartedAt = 0; state.turnDeadlineAt = 60_000;
  const first = applyAuthoritativeMove(state, secret, { pieceId: "mover", from: {x:0,y:7}, to: {x:0,y:6}, expectedRevision: 0, actionId: "first" }, false, 55_000);
  const shifted = applyHeroAbility(first.state, first.secret, swap(first.state), 61_000, () => 0);
  assert.equal(shifted.state.turn, "red"); assert.equal(shifted.state.heroRuntime!.black!.relayUses, 1);
  shifted.state.turnStartedAt = 63_000; shifted.state.turnDeadlineAt = 123_000;
  const r = applyHeroAbility(shifted.state, shifted.secret, { kind: "hero_ability", ability: "rewind", expectedRevision: shifted.state.revision, actionId: "rewind" }, 64_000, () => 0);
  assert.deepEqual(r.state.pieces, state.pieces);
  assert.equal(r.state.heroRuntime!.black?.relayUses ?? 0, 0);
  assert.equal(r.secret.rewindUsed!.red, true); assert.equal(r.secret.replay!.pieceId, "mover");
});

test("H05 cannot reinterpret this tier II two-piece displacement as a historical ordinary piece move", () => {
  const f = fixture();
  f.state.featureRules!.heroes!.black = "murozond";
  delete f.state.featureRules!.heroSelections; delete f.state.heroFormLock; delete f.secret.heroFormLock;
  const r = applyHeroAbility(f.state, f.secret, swap(f.state), 1000, () => 0);
  const before = structuredClone(r);
  assert.throws(() => applyHeroAbility(r.state, r.secret, { kind: "hero_ability", ability: "timeline_twist", pieceId: "a", to: {x:0,y:5}, expectedRevision: r.state.revision, actionId: "bad-history" }, 2000, () => 0));
  assert.deepEqual(r, before);
});
