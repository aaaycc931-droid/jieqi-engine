import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, initializeFeatureGameState } from "../src/index.ts";
import { gameState, move, revealed, secretState } from "./helpers.ts";

test("WARRIOR-01 明棋离开己方九宫获得一次公开壁垒", () => {
  const state = initializeFeatureGameState(gameState([revealed("guard", "red", "rook", 4, 8)]), { red: "warrior", black: "hunter" });
  const result = applyAuthoritativeMove(state, secretState(), move({ x: 4, y: 8 }, { x: 4, y: 6 }, "leave"));
  assert.deepEqual(result.state.effectsByPieceId?.guard?.barrier, { owner: "red", enemyHalfEntered: false, movesAfterEnemyHalfEntry: 0 });
});

test("WARRIOR-02 普通吃子撞壁垒会弹回并消耗防御", () => {
  const state = initializeFeatureGameState(gameState([revealed("attacker", "red", "rook", 4, 5), revealed("guard", "black", "rook", 4, 4)]), { red: "hunter", black: "warrior" });
  state.effectsByPieceId = { guard: { barrier: { owner: "black", enemyHalfEntered: false, movesAfterEnemyHalfEntry: 0 } } };
  const result = applyAuthoritativeMove(state, secretState(), move({ x: 4, y: 5 }, { x: 4, y: 4 }, "bounce"));
  assert.equal(result.state.pieces.some((piece) => piece.id === "guard"), true);
  assert.equal(result.state.pieces.find((piece) => piece.id === "attacker")?.y, 5);
  assert.equal(result.state.effectsByPieceId?.guard, undefined);
});

test("WARRIOR-03 将帅铁甲会拦截一次背刺并交给己方额外应将", () => {
  const state = initializeFeatureGameState(gameState([
    { id: "turncoat", x: 4, y: 6, faceDown: true },
  ], { redGeneral: { x: 4, y: 9 } }), { red: "warrior", black: "hunter" });
  const result = applyAuthoritativeMove(state, secretState({ turncoat: { color: "black", type: "rook" } }), move({ x: 4, y: 6 }, { x: 4, y: 5 }, "backstab"));
  assert.equal(result.state.status, "playing");
  assert.equal(result.state.turn, "red");
  assert.equal(result.state.warrior?.red.ironArmorAvailable, false);
  assert.deepEqual(result.state.forcedDefense, { responder: "red", resumeTurn: "black", cause: "iron_armor_blocked_backstab" });
});

test("WARRIOR-04 壁垒进入敌方半场后在两次成功移动后衰减", () => {
  const state = initializeFeatureGameState(gameState([
    revealed("guard", "red", "rook", 4, 8),
    revealed("black-pawn", "black", "pawn", 1, 2),
  ], { redGeneral: { x: 4, y: 9 }, blackGeneral: { x: 3, y: 0 } }), { red: "warrior", black: "hunter" });
  const first = applyAuthoritativeMove(state, secretState(), move({ x: 4, y: 8 }, { x: 4, y: 6 }, "leave", 0));
  const blackOne = applyAuthoritativeMove(first.state, first.secret, move({ x: 1, y: 2 }, { x: 1, y: 3 }, "black-1", 1));
  const enterEnemyHalf = applyAuthoritativeMove(blackOne.state, blackOne.secret, move({ x: 4, y: 6 }, { x: 4, y: 4 }, "enter", 2));
  assert.deepEqual(enterEnemyHalf.state.effectsByPieceId?.guard?.barrier, { owner: "red", enemyHalfEntered: true, movesAfterEnemyHalfEntry: 0 });
  const blackTwo = applyAuthoritativeMove(enterEnemyHalf.state, enterEnemyHalf.secret, move({ x: 1, y: 3 }, { x: 1, y: 4 }, "black-2", 3));
  const oneAfter = applyAuthoritativeMove(blackTwo.state, blackTwo.secret, move({ x: 4, y: 4 }, { x: 4, y: 3 }, "after-1", 4));
  assert.equal(oneAfter.state.effectsByPieceId?.guard?.barrier?.movesAfterEnemyHalfEntry, 1);
  const blackThree = applyAuthoritativeMove(oneAfter.state, oneAfter.secret, move({ x: 1, y: 4 }, { x: 1, y: 5 }, "black-3", 5));
  const expired = applyAuthoritativeMove(blackThree.state, blackThree.secret, move({ x: 4, y: 3 }, { x: 4, y: 2 }, "after-2", 6));
  assert.equal(expired.state.effectsByPieceId?.guard?.barrier, undefined);
});

test("WARRIOR-05 铁甲挡下背刺但无合法应将时，立即转为裁决", () => {
  const state = initializeFeatureGameState(gameState([
    { id: "turncoat", x: 4, y: 6, faceDown: true },
    revealed("left-lock", "black", "rook", 3, 5),
    revealed("right-lock", "black", "rook", 5, 5),
  ], { redGeneral: { x: 4, y: 9 } }), { red: "warrior", black: "hunter" });
  const result = applyAuthoritativeMove(
    state,
    secretState({ turncoat: { color: "black", type: "rook" } }),
    move({ x: 4, y: 6 }, { x: 4, y: 5 }, "no-defense"),
  );
  assert.equal(result.state.status, "execution");
  assert.equal(result.state.winner, "black");
  assert.equal(result.state.reason, "checkmate");
  assert.equal(result.state.forcedDefense, undefined);
});

test("WARRIOR-06 普通防御被消耗只移除壁垒，不会误删棋子上的骑兵效果", () => {
  const state = initializeFeatureGameState(gameState([
    revealed("attacker", "red", "rook", 4, 5),
    revealed("guard", "black", "rook", 4, 4),
  ]), { red: "hunter", black: "warrior" }, "cavalry");
  state.effectsByPieceId = {
    guard: { cavalry: true, barrier: { owner: "black", enemyHalfEntered: false, movesAfterEnemyHalfEntry: 0 } },
  };
  const result = applyAuthoritativeMove(state, secretState(), move({ x: 4, y: 5 }, { x: 4, y: 4 }, "preserve-cavalry"));
  assert.equal(result.state.effectsByPieceId?.guard?.barrier, undefined);
  assert.equal(result.state.effectsByPieceId?.guard?.cavalry, true);
});
