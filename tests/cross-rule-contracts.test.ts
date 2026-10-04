import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, applyHeroAbility, canRevealedPieceAttack, destroyPiece, getLegalMoves, initializeFeatureGameState, initializeFeatureSecret, markRevealed, queueLanding, relocatePiece, settleLandings, validatePublicMove } from "../src/index.ts";
import type { GameState, HeroAbilityCommand } from "../src/index.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";

const skill = (ability: HeroAbilityCommand["ability"], state: GameState, extra: Partial<HeroAbilityCommand> = {}) => ({ kind: "hero_ability" as const, ability, actionId: `cross:${ability}:${state.revision}`, expectedRevision: state.revision, ...extra });

test("CROSS-BOARD-01 invalid displacement coordinates leave the living piece and secret state unchanged", () => {
  for (const to of [{x: -1,y: 5}, {x: 9,y: 5}, {x: 0,y: 10}, {x: 0.5,y: 5}, {x: NaN,y: 5}, {x: 0,y: Infinity}]) {
    const s = gameState([revealed("p", "red", "rook", 0, 7)]), k = secretState(), before = structuredClone({s,k});
    assert.equal(relocatePiece(s, k, "p", to, "contract_displacement"), false);
    assert.deepEqual({s,k}, before);
    assert.equal(validatePublicMove(s, {from: {x: 0,y: 7}, to}).code, "OUT_OF_BOARD");
  }
});

test("CROSS-PLAN-01 iron steed attacking an immune friendly leg is still an attack before any kill", () => {
  const s = initializeFeatureGameState(gameState([revealed("horse", "red", "horse", 4, 7), revealed("leg", "red", "pawn", 5, 7)]), undefined, "iron_steed");
  s.effectsByPieceId = {leg: {intangible: true, immuneCrush: true}};
  const r = applyAuthoritativeMove(s, secretState(), move({x: 4,y: 7}, {x: 6,y: 8}, "immune-leg"));
  assert.deepEqual(r.state.lastMove?.keywords, ["进攻"]);
  assert.equal(r.state.lastMove?.tier, 2);
  assert.deepEqual(r.state.lastMove?.pathCrushed, []);
  assert.ok(r.state.pieces.some(p => p.id === "leg"));
});

test("CROSS-PLAN-02 automatic landing trap does not reclassify an empty move as attack", () => {
  const s = initializeFeatureGameState(gameState([revealed("p", "red", "pawn", 0, 6)]), {red: "prince", black: "hunter"}), k = secretState();
  k.traps = [{id: "t", owner: "black", position: {x: 0,y: 5}, opponentTurnsRemaining: 4}];
  const r = applyAuthoritativeMove(s, k, move({x: 0,y: 6}, {x: 0,y: 5}, "trap"));
  assert.deepEqual(r.state.lastMove?.keywords, ["移动"]);
  assert.equal(r.state.lastMove?.tier, 1);
  assert.equal(r.state.captured.find(p => p.id === "p")?.cause, "trap_ambush");
  assert.notEqual(r.state.heroRuntime?.red?.carefreeSuspended, true);
});

test("CROSS-CHARIOT-01 a sole route crushing both generals gives no effective check", () => {
  const s = initializeFeatureGameState(gameState([revealed("rook", "red", "rook", 0, 7)], {redGeneral: {x: 0,y: 5}, blackGeneral: {x: 0,y: 3}}), undefined, "war_chariot");
  // 单独核验车的这条路线；本手工残局中将帅照面是另一独立威胁。
  assert.equal(canRevealedPieceAttack(s, s.pieces.find(p => p.id === "rook")!, {x: 0,y: 3}), false);
  const r = applyAuthoritativeMove(s, secretState(), move({x: 0,y: 7}, {x: 0,y: 3}, "mutual"));
  assert.equal(r.state.drawReason, "mutual_destruction");
});

test("CROSS-COLLAPSE-01 displacement between warps preserves deadline and leaving removes collapse", () => {
  const s = initializeFeatureGameState(gameState([revealed("p", "red", "rook", 0, 6)]), {red: "nozdormu", black: "murozond"}, "end_time"), k = secretState();
  s.warps = [{x: 0,y: 6}, {x: 0,y: 5}];
  queueLanding(s, s.pieces.find(p => p.id === "p")!, "red", "displacement"); settleLandings(s, k);
  const deadline = s.effectsByPieceId?.p?.timeCollapse?.expiresAtOwnerTurnEnd;
  assert.equal(deadline, 2);
  s.formalTurns!.red = 1;
  assert.equal(relocatePiece(s, k, "p", {x: 0,y: 5}, "displacement"), true);
  assert.equal(s.effectsByPieceId?.p?.timeCollapse?.expiresAtOwnerTurnEnd, deadline);
  assert.equal(relocatePiece(s, k, "p", {x: 0,y: 4}, "displacement"), true);
  assert.equal(s.effectsByPieceId?.p?.timeCollapse, undefined);
});

test("CROSS-CAREFREE-01 final-target kill suspends protection for enemy turn then restores it", () => {
  const s = initializeFeatureGameState(gameState([revealed("attacker", "red", "rook", 0, 7), revealed("target", "black", "pawn", 0, 6), revealed("reply", "black", "pawn", 2, 3)]), {red: "prince", black: "hunter"});
  const r = applyAuthoritativeMove(s, secretState(), move({x: 0,y: 7}, {x: 0,y: 6}, "attack"));
  assert.equal(r.state.heroRuntime?.red?.carefreeSuspended, true);
  const next = applyAuthoritativeMove(r.state, r.secret, move({x: 2,y: 3}, {x: 2,y: 4}, "reply", r.state.revision));
  assert.equal(next.state.heroRuntime?.red?.carefreeSuspended, false);
});

test("CROSS-CAREFREE-02 barrier bounce without final-target kill or check keeps protection", () => {
  const s = initializeFeatureGameState(gameState([revealed("attacker", "red", "rook", 0, 7), revealed("target", "black", "pawn", 0, 6)]), {red: "prince", black: "warrior"});
  s.effectsByPieceId = {target: {barrier: {owner: "black", enemyTurnsRemaining: 3}}};
  const r = applyAuthoritativeMove(s, secretState(), move({x: 0,y: 7}, {x: 0,y: 6}, "bounce"));
  assert.notEqual(r.state.heroRuntime?.red?.carefreeSuspended, true);
  assert.ok(r.state.pieces.some(p => p.id === "target"));
});

test("CROSS-DISPLACE-01 occupied ordinary displacement fails in place without suffocation or landing", () => {
  const s = gameState([revealed("p", "red", "rook", 0, 7), revealed("occupied", "black", "pawn", 0, 6)]), k = secretState(), before = structuredClone({s,k});
  assert.equal(relocatePiece(s, k, "p", {x: 0,y: 6}, "contract_displacement"), false);
  assert.deepEqual({s,k}, before);
});

test("CROSS-FORTRESS-01 flight cannot enter enemy palace through movement or displacement", () => {
  const s = initializeFeatureGameState(gameState([{...revealed("flyer", "red", "rook", 4, 3), layer: "air"}]), undefined, "iron_wall"), k = secretState();
  assert.equal(validatePublicMove(s, {from: {x: 4,y: 3}, to: {x: 4,y: 2}, pieceId: "flyer"}).code, "IRON_WALL");
  assert.equal(relocatePiece(s, k, "flyer", {x: 4,y: 2}, "contract_displacement"), false);
  assert.equal(s.pieces.find(p => p.id === "flyer")?.y, 3);
});

for (const side of ["red", "black"] as const) test(`CROSS-JIANXIE-01 ${side} crossed pawn uses only forward and diagonals; baseline pawn survives immobility`, () => {
  const y = side === "red" ? 4 : 5, f = side === "red" ? -1 : 1;
  const s = initializeFeatureGameState(gameState([revealed("p", side, "pawn", 4, y)], {turn: side}), undefined, "jian_xie");
  assert.deepEqual(getLegalMoves(s, "p").sort((a,b) => a.x-b.x), [{x: 3,y: y+f}, {x: 4,y: y+f}, {x: 5,y: y+f}]);
  s.pieces.find(p => p.id === "p")!.y = side === "red" ? 0 : 9;
  assert.deepEqual(getLegalMoves(s, "p"), []);
  assert.ok(s.pieces.some(p => p.id === "p")); assert.equal(s.status, "playing");
});

test("CROSS-ATOMIC-01 destruction keeps its locked draw set after killing Wind's true host", () => {
  const s = initializeFeatureGameState(gameState([revealed("host", "black", "rook", 0, 3), covered("later", 0, 6)], {turn: "black"}), {red: "deathwing", black: "wind"});
  const k = secretState({later: {color: "red", type: "horse"}});
  const shadow = applyHeroAbility(s, k, skill("shadow", s, {pieceId: "host"})); shadow.state.turn = "red";
  let draws = 0;
  const r = applyHeroAbility(shadow.state, shadow.secret, skill("destruction", shadow.state), 100, () => {draws++; return 0;});
  assert.equal(draws, 2);
  assert.ok(r.state.captured.some(p => p.id === "later" && p.type === "horse"));
  assert.ok(r.state.captured.some(p => p.id === "host" && p.type === "general"));
  assert.ok(r.state.pieces.some(p => p.id === "black-general"));
  assert.equal(r.state.winner, "red"); assert.equal(r.state.reason, "general_destroyed");
  assert.equal(r.state.formalTurns?.red, 0); assert.equal(r.state.flowDance, undefined);
});

test("CROSS-REVIVE-01 hourglass revives a shown warrior without temporary states and preserves public identity", () => {
  const s = initializeFeatureGameState(gameState([revealed("warrior", "red", "pawn", 0, 6), revealed("dragon", "black", "pawn", 0, 3)]), {red: "nozdormu", black: "murozond"}, "end_time"), k = secretState();
  initializeFeatureSecret(s, k); markRevealed(s, k, "warrior"); markRevealed(s, k, "dragon");
  s.effectsByPieceId!.warrior = {destiny: "time_warrior", infection: {owner: "black", stacks: 2}, intangible: true, immuneCrush: true, flight: {remainingOwnerTurns: 1}, barrier: {owner: "red", enemyTurnsRemaining: 3}, timeCollapse: {expiresAtOwnerTurnEnd: 2}};
  destroyPiece(s, k, "warrior", "black", "attack");
  const r = applyHeroAbility(s, k, skill("hourglass", s), 100);
  assert.deepEqual(r.state.effectsByPieceId?.warrior, {destiny: "time_warrior"});
  assert.deepEqual(r.state.pieces.find(p => p.id === "warrior"), revealed("warrior", "red", "pawn", 0, 6));
  assert.equal(r.state.captured.some(p => p.id === "warrior"), false);
  assert.equal(r.secret.destinyIdentities?.warrior?.shown, true);
});
