import assert from "node:assert/strict";
import test from "node:test";

import {
  RuleError,
  applyAuthoritativeAssassination,
  applyAuthoritativeMove,
  initializeFeatureGameState,
  validatePublicMove,
} from "../src/index.ts";
import { gameState, move, revealed, secretState } from "./helpers.ts";

function assassination(
  from: { x: number; y: number },
  to: { x: number; y: number },
  actionId: string,
  source: "hero" | "mutation" | undefined,
  useStrongStrike = false,
  expectedRevision = 0,
) {
  return { kind: "assassination" as const, from, to, actionId, source, useStrongStrike, expectedRevision };
}

test("ROGUE-01 刺杀首步消耗英雄次数，棋子进入公开隐身并保留强击", () => {
  const state = initializeFeatureGameState(
    gameState([revealed("rogue-rook", "red", "rook", 0, 7)]),
    { red: "rogue", black: "hunter" },
  );
  const result = applyAuthoritativeAssassination(
    state,
    secretState(),
    assassination({ x: 0, y: 7 }, { x: 0, y: 6 }, "rogue-start", "hero"),
  );
  assert.equal(result.state.turn, "black");
  assert.equal(result.state.assassination?.red.heroChargeAvailable, false);
  assert.equal(result.state.assassination?.red.activePieceId, "rogue-rook");
  assert.deepEqual(result.state.effectsByPieceId?.["rogue-rook"]?.stealth, {
    owner: "red",
    remainingOwnerTurns: 2,
    strongStrikeAvailable: true,
    source: "hero",
  });
});

test("ROGUE-02 隐身棋仍占格但不挡路径，也不能被普通吃子", () => {
  const state = initializeFeatureGameState(
    gameState([
      revealed("red-rook", "red", "rook", 0, 7),
      revealed("black-rook", "black", "rook", 0, 2),
    ], { turn: "black" }),
    { red: "rogue", black: "rogue" },
  );
  state.effectsByPieceId = {
    "red-rook": {
      stealth: { owner: "red", remainingOwnerTurns: 2, strongStrikeAvailable: true, source: "hero" },
    },
  };
  state.assassination!.red.activePieceId = "red-rook";
  assert.equal(
    validatePublicMove(state, { from: { x: 0, y: 2 }, to: { x: 0, y: 7 } }, "black").code,
    "ILLEGAL_TARGET",
  );
  assert.equal(
    validatePublicMove(state, { from: { x: 0, y: 2 }, to: { x: 0, y: 8 } }, "black").ok,
    true,
  );
});

test("ROGUE-03 隐身期间强击可直接杀死隐身目标并清除对方活动状态", () => {
  const state = initializeFeatureGameState(
    gameState([
      revealed("red-rook", "red", "rook", 0, 7),
      revealed("black-rook", "black", "rook", 0, 4),
    ], { turn: "black" }),
    { red: "rogue", black: "rogue" },
  );
  state.effectsByPieceId = {
    "red-rook": { stealth: { owner: "red", remainingOwnerTurns: 2, strongStrikeAvailable: true, source: "hero" } },
    "black-rook": { stealth: { owner: "black", remainingOwnerTurns: 2, strongStrikeAvailable: true, source: "hero" } },
  };
  state.assassination!.red.activePieceId = "red-rook";
  state.assassination!.black.activePieceId = "black-rook";
  const result = applyAuthoritativeAssassination(
    state,
    secretState(),
    assassination({ x: 0, y: 4 }, { x: 0, y: 7 }, "strong", undefined, true),
  );
  assert.equal(result.state.pieces.some((piece) => piece.id === "red-rook"), false);
  assert.equal(result.state.effectsByPieceId?.["red-rook"], undefined);
  assert.equal(result.state.assassination?.red.activePieceId, undefined);
  assert.equal(result.state.assassination?.black.activePieceId, undefined);
  assert.equal(result.state.pieces.find((piece) => piece.id === "black-rook")?.y, 7);
});

test("ROGUE-04 隐身两次己方其他走子后自动消失，普通走子不能直接调用隐身棋", () => {
  const state = initializeFeatureGameState(
    gameState([
      revealed("rogue-rook", "red", "rook", 0, 7),
      revealed("red-pawn-a", "red", "pawn", 1, 7),
      revealed("red-pawn-b", "red", "pawn", 2, 7),
      revealed("black-pawn-a", "black", "pawn", 1, 2),
      revealed("black-pawn-b", "black", "pawn", 2, 2),
    ]),
    { red: "rogue", black: "hunter" },
  );
  const first = applyAuthoritativeAssassination(
    state, secretState(), assassination({ x: 0, y: 7 }, { x: 0, y: 6 }, "start", "hero"),
  );
  const blackOne = applyAuthoritativeMove(first.state, first.secret, move({ x: 1, y: 2 }, { x: 1, y: 3 }, "black-1", 1));
  const redOne = applyAuthoritativeMove(blackOne.state, blackOne.secret, move({ x: 1, y: 7 }, { x: 1, y: 6 }, "red-1", 2));
  assert.equal(redOne.state.effectsByPieceId?.["rogue-rook"]?.stealth?.remainingOwnerTurns, 1);
  const blackTwo = applyAuthoritativeMove(redOne.state, redOne.secret, move({ x: 2, y: 2 }, { x: 2, y: 3 }, "black-2", 3));
  const redTwo = applyAuthoritativeMove(blackTwo.state, blackTwo.secret, move({ x: 2, y: 7 }, { x: 2, y: 6 }, "red-2", 4));
  assert.equal(redTwo.state.effectsByPieceId?.["rogue-rook"], undefined);
  assert.equal(redTwo.state.assassination?.red.activePieceId, undefined);
  assert.throws(
    () => applyAuthoritativeMove({ ...first.state, turn: "red" }, first.secret, move({ x: 0, y: 6 }, { x: 0, y: 5 }, "wrong-api", 1)),
    (error) => error instanceof RuleError && error.code === "STEALTH_ACTION_REQUIRED",
  );
});

test("ROGUE-05 首次普通刺杀撞壁垒会原地隐身并保留强击", () => {
  const state = initializeFeatureGameState(
    gameState([revealed("rogue", "red", "rook", 0, 7), revealed("barrier", "black", "pawn", 0, 6)]),
    { red: "rogue", black: "warrior" },
  );
  state.effectsByPieceId = { barrier: { barrier: { owner: "black", enemyHalfEntered: false, movesAfterEnemyHalfEntry: 0 } } };
  const result = applyAuthoritativeAssassination(state, secretState(), assassination({ x: 0, y: 7 }, { x: 0, y: 6 }, "bounce", "hero"));
  assert.equal(result.state.pieces.find((piece) => piece.id === "rogue")?.y, 7);
  assert.equal(result.state.effectsByPieceId?.barrier, undefined);
  assert.equal(result.state.effectsByPieceId?.rogue?.stealth?.strongStrikeAvailable, true);
});

test("ROGUE-06 强击与战车同一原子行动会先碾碎路径，再处决最终目标", () => {
  const state = initializeFeatureGameState(
    gameState([
      revealed("rogue-rook", "red", "rook", 0, 7),
      revealed("path", "black", "pawn", 0, 5),
      revealed("target", "black", "cannon", 0, 3),
    ]),
    { red: "rogue", black: "hunter" },
    "war_chariot",
  );
  const result = applyAuthoritativeAssassination(
    state,
    secretState(),
    assassination({ x: 0, y: 7 }, { x: 0, y: 3 }, "war-chariot-strong", "hero", true),
  );
  assert.equal(result.state.pieces.some((piece) => piece.id === "path"), false);
  assert.equal(result.state.pieces.some((piece) => piece.id === "target"), false);
  assert.equal(result.state.pieces.find((piece) => piece.id === "rogue-rook")?.y, 3);
  assert.equal(result.state.assassination?.red.heroChargeAvailable, false);
  assert.equal(result.state.assassination?.red.activePieceId, undefined);
});
