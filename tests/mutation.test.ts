import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, getLegalMoves, initializeFeatureGameState, isGeneralInCheck, validatePublicMove } from "../src/index.ts";
import { gameState, move, revealed, secretState } from "./helpers.ts";

test("MUT-01 堡垒禁止从宫外落入敌方九宫", () => {
  const state = initializeFeatureGameState(gameState([revealed("rook", "red", "rook", 4, 3)]), undefined, "iron_wall");
  assert.equal(validatePublicMove(state, { from: { x: 4, y: 3 }, to: { x: 4, y: 2 } }).code, "IRON_WALL");
});

test("MUT-02 亲征将帅获得车式移动", () => {
  const state = initializeFeatureGameState(gameState([], { redGeneral: { x: 4, y: 9 } }), undefined, "expedition");
  assert.equal(getLegalMoves(state, "red-general").some((position) => position.x === 4 && position.y === 5), true);
});

test("MUT-03 骑兵暗置时不启用额外马步，不按兵位授予", () => {
 const state = initializeFeatureGameState(gameState([{ id: "covered", x: 0, y: 6, faceDown: true }]), undefined, "cavalry");
 assert.equal(getLegalMoves(state, "covered").some(p => p.x === 1 && p.y === 4), false);
 assert.equal(getLegalMoves(state, "covered").some(p => p.x === 0 && p.y === 5), true);
 assert.equal(state.effectsByPieceId?.covered, undefined);
});

test("MUT-04 铁马无视马腿阻挡", () => {
  const blocked = gameState([
    revealed("horse", "red", "horse", 4, 7),
    revealed("leg", "red", "pawn", 5, 7),
  ]);
  assert.equal(getLegalMoves(initializeFeatureGameState(blocked, undefined, "iron_steed"), "horse").some((position) => position.x === 6 && position.y === 8), true);
});

test("MUT-05 铁马碾碎马腿棋并继续落位", () => {
  const state = initializeFeatureGameState(gameState([
    revealed("horse", "red", "horse", 4, 7),
    revealed("leg", "black", "pawn", 5, 7),
  ]), undefined, "iron_steed");
  const result = applyAuthoritativeMove(state, secretState(), move({ x: 4, y: 7 }, { x: 6, y: 8 }, "crush"));
  assert.equal(result.state.pieces.some((piece) => piece.id === "leg"), false);
  assert.deepEqual(result.state.pieces.find((piece) => piece.id === "horse" && piece.x === 6 && piece.y === 8)?.id, "horse");
});

test("MUT-06 战车隔一枚棋子碾碎路径后吃掉目标", () => {
  const state = initializeFeatureGameState(gameState([
    revealed("rook", "red", "rook", 0, 7),
    revealed("path", "black", "pawn", 0, 5),
    revealed("target", "black", "cannon", 0, 3),
  ]), undefined, "war_chariot");
  const result = applyAuthoritativeMove(state, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 3 }, "chariot"));
  assert.equal(result.state.pieces.some((piece) => piece.id === "path"), false);
  assert.equal(result.state.pieces.some((piece) => piece.id === "target"), false);
  assert.equal(result.state.pieces.find((piece) => piece.id === "rook")?.y, 3);
});

test("MUT-07 铁马碾碎敌方将帅时触发碾碎他们终局", () => {
  const state = initializeFeatureGameState(gameState([
    revealed("horse", "red", "horse", 4, 7),
  ], { blackGeneral: { x: 5, y: 7 } }), undefined, "iron_steed");
  const result = applyAuthoritativeMove(state, secretState(), move({ x: 4, y: 7 }, { x: 6, y: 8 }, "general-crush"));
  assert.equal(result.state.status, "finished");
  assert.equal(result.state.winner, "red");
  assert.equal(result.state.reason, "crush_them");
});

test("MUT-08 铁马误伤己方将帅时触发乱杀失败", () => {
  const state = initializeFeatureGameState(gameState([
    revealed("horse", "red", "horse", 4, 7),
    revealed("block", "black", "pawn", 5, 5),
  ], { redGeneral: { x: 5, y: 7 } }), undefined, "iron_steed");
  const result = applyAuthoritativeMove(state, secretState(), move({ x: 4, y: 7 }, { x: 6, y: 8 }, "self-crush"));
  assert.equal(result.state.status, "finished");
  assert.equal(result.state.winner, "black");
  assert.equal(result.state.reason, "rampage");
});

test("MUT-09 战车碾碎己方将帅并击杀敌将时两败俱伤", () => {
  const state = initializeFeatureGameState(gameState([
    revealed("rook", "red", "rook", 0, 7),
  ], { redGeneral: { x: 0, y: 5 }, blackGeneral: { x: 0, y: 3 } }), undefined, "war_chariot");
  const result = applyAuthoritativeMove(state, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 3 }, "mutual"));
  assert.equal(result.state.status, "finished");
  assert.equal(result.state.winner, undefined);
  assert.equal(result.state.drawReason, "mutual_destruction");
});

test("MUT-10 铁马可把敌将帅作为马腿路径将军", () => {
  const state = initializeFeatureGameState(gameState([
    revealed("horse", "red", "horse", 4, 7),
  ], { blackGeneral: { x: 5, y: 7 } }), undefined, "iron_steed");
  assert.equal(isGeneralInCheck(state, "black"), true);
});

test("MUT-11 战车路径包含无形地面棋的实体计数", () => {
 const state = initializeFeatureGameState(gameState([revealed("rook", "red", "rook", 0, 7), revealed("first", "black", "pawn", 0, 5), revealed("intangible", "black", "horse", 0, 4), revealed("target", "black", "cannon", 0, 3)]), undefined, "war_chariot");
 state.effectsByPieceId = { intangible: { intangible: true } };
 assert.equal(validatePublicMove(state, { from: { x: 0, y: 7 }, to: { x: 0, y: 3 } }).code, "ILLEGAL_MOVEMENT");
 state.pieces = state.pieces.filter(p => p.id !== "first");
 const result = applyAuthoritativeMove(state, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 3 }, "one"));
 assert.deepEqual(result.state.lastMove.pathCrushed.map(p => p.id), ["intangible"]);
});

test("MUT-12 骑兵只给明马额外一步，保留八方向普通马跳", () => {
 const state = initializeFeatureGameState(gameState([revealed("horse", "red", "horse", 4, 6), revealed("pawn", "red", "pawn", 2, 6)]), undefined, "cavalry");
 assert.equal(getLegalMoves(state, "horse").some(p => p.x === 3 && p.y === 8), true);
 assert.equal(getLegalMoves(state, "horse").some(p => p.x === 4 && p.y === 5), true);
 assert.equal(getLegalMoves(state, "pawn").some(p => p.x === 1 && p.y === 8), false);
});

// Public synthetic component positions, not the half-chaos PD03 natural
// replay. Manual route tables exercise the shared move geometry separately
// from the threat query; no production/replay state or hidden identity is rewritten.
const ironSteedLegDirections = [
  { id: "E", horse: [3, 1], royal: [4, 1], routes: [[5, 0], [5, 2]], unrelated: [[4, 3]] },
  { id: "W", horse: [5, 1], royal: [4, 1], routes: [[3, 0], [3, 2]], unrelated: [[4, 3]] },
  { id: "S", horse: [4, 0], royal: [4, 1], routes: [[3, 2], [5, 2]], unrelated: [[2, 1], [6, 1]] },
  { id: "N", horse: [4, 2], royal: [4, 1], routes: [[3, 0], [5, 0]], unrelated: [[2, 1], [6, 1]] },
  { id: "TOP-EDGE-E", horse: [3, 0], royal: [4, 0], routes: [[5, 1]], unrelated: [[4, 2]] },
];

for (const fixture of ironSteedLegDirections) {
  for (const threatened of [false, true]) {
    test(`R38-LEG-${fixture.id}-${threatened ? 'missed' : 'false'}-check uses a completable route through the royal leg`, () => {
      const blocked = threatened ? fixture.unrelated : fixture.routes;
      const state = initializeFeatureGameState(gameState([
        revealed("horse", "red", "horse", fixture.horse[0], fixture.horse[1]),
        // Keep the two real royals in their palaces and block their file.
        revealed("royal-file-blocker", "red", "pawn", 4, 5),
        ...blocked.map(([x, y], i) => revealed(`route-blocker-${i}`, "red", "pawn", x, y)),
      ], { turn: "black", redGeneral: { x: 4, y: 9 }, blackGeneral: { x: fixture.royal[0], y: fixture.royal[1] } }), undefined, "iron_steed");
      const before = structuredClone(state);
      const moves = getLegalMoves({ ...state, turn: "red" }, "horse");
      const hasCompletableRoute = fixture.routes.some(([x, y]) => moves.some(to => to.x === x && to.y === y));
      assert.equal(hasCompletableRoute, threatened, "existing ordinary move eligibility must agree with the manual route witness");
      assert.equal(isGeneralInCheck(state, "black"), threatened);
      assert.deepEqual(state, before, "the public threat query must not alter pieces or resources");
    });
  }
}
