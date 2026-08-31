import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, getLegalMoves, initializeFeatureGameState, isGeneralInCheck, validatePublicMove } from "../src/index.ts";
import { gameState, move, revealed, secretState } from "./helpers.ts";

test("MUT-01 铁壁禁止从宫外落入敌方九宫", () => {
  const state = initializeFeatureGameState(gameState([revealed("rook", "red", "rook", 4, 3)]), undefined, "iron_wall");
  assert.equal(validatePublicMove(state, { from: { x: 4, y: 3 }, to: { x: 4, y: 2 } }).code, "IRON_WALL");
});

test("MUT-02 出征将帅获得车式移动", () => {
  const state = initializeFeatureGameState(gameState([], { redGeneral: { x: 4, y: 9 } }), undefined, "expedition");
  assert.equal(getLegalMoves(state, "red-general").some((position) => position.x === 4 && position.y === 5), true);
});

test("MUT-03 骑兵为三枚固定兵位提供前向马步", () => {
  const state = initializeFeatureGameState(gameState([
    { id: "red-cavalry", x: 0, y: 6, faceDown: true },
  ]), undefined, "cavalry");
  assert.equal(getLegalMoves(state, "red-cavalry").some((position) => position.x === 1 && position.y === 4), true);
  assert.equal(getLegalMoves(state, "red-cavalry").some((position) => position.x === 1 && position.y === 8), false);
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

test("MUT-11 战车只计一枚非隐身路径棋，但会同时碾碎所有隐身路径棋", () => {
  const state = initializeFeatureGameState(gameState([
    revealed("rook", "red", "rook", 0, 7),
    revealed("counted-path", "black", "pawn", 0, 5),
    revealed("stealth-path", "black", "horse", 0, 4),
    revealed("target", "black", "cannon", 0, 3),
  ]), undefined, "war_chariot");
  state.effectsByPieceId = {
    "stealth-path": { stealth: { owner: "black", remainingOwnerTurns: 2, strongStrikeAvailable: true, source: "hero" } },
  };
  state.assassination!.black.activePieceId = "stealth-path";

  const result = applyAuthoritativeMove(state, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 3 }, "all-paths"));
  for (const id of ["counted-path", "stealth-path", "target"]) {
    assert.equal(result.state.pieces.some((piece) => piece.id === id), false);
  }
  assert.equal(result.state.effectsByPieceId?.["stealth-path"], undefined);
  assert.equal(result.state.assassination?.black.activePieceId, undefined);
  assert.deepEqual(result.state.lastMove?.pathCrushed?.map((piece) => piece.id), ["counted-path", "stealth-path"]);
});

test("MUT-12 骑兵翻开成非兵种后仍保留完整八方向马步", () => {
  const state = initializeFeatureGameState(gameState([
    revealed("cavalry-rook", "red", "rook", 4, 6),
    revealed("cavalry-pawn", "red", "pawn", 2, 6),
  ]), undefined, "cavalry");
  state.effectsByPieceId = { "cavalry-rook": { cavalry: true }, "cavalry-pawn": { cavalry: true } };
  assert.equal(getLegalMoves(state, "cavalry-rook").some((position) => position.x === 3 && position.y === 8), true);
  assert.equal(getLegalMoves(state, "cavalry-pawn").some((position) => position.x === 1 && position.y === 8), false);
});
