import assert from "node:assert/strict";
import test from "node:test";

import {
  RuleError,
  applyAuthoritativeAssassination,
  applyAuthoritativeMove,
  getLegalAssassinationMoves,
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
    activatedOnFormalTurn: 1,
    strongStrikeAvailable: true,
    source: "hero",
  });
});

test("ROGUE-02 无形地面棋仍挡路径，不能直接进攻", () => {
  const state = initializeFeatureGameState(
    gameState([
      revealed("red-rook", "red", "rook", 0, 7),
      revealed("black-rook", "black", "rook", 0, 2),
    ], { turn: "black" }),
    { red: "rogue", black: "rogue" },
  );
  state.effectsByPieceId = {
    "red-rook": {
      stealth: { owner: "red", remainingOwnerTurns: 1, strongStrikeAvailable: true, source: "hero" },
    },
  };
  state.assassination!.red.activePieceId = "red-rook";
  assert.equal(
    validatePublicMove(state, { from: { x: 0, y: 2 }, to: { x: 0, y: 7 } }, "black").code,
    "ILLEGAL_TARGET",
  );
  assert.equal(
    validatePublicMove(state, { from: { x: 0, y: 2 }, to: { x: 0, y: 8 } }, "black").ok,
    false,
  );
});

test("ROGUE-03 刺杀机会可以直接指定无形目标", () => {
  const state = initializeFeatureGameState(
    gameState([
      revealed("red-rook", "red", "rook", 0, 7),
      revealed("black-rook", "black", "rook", 0, 4),
    ], { turn: "black" }),
    { red: "rogue", black: "rogue" },
  );
  state.effectsByPieceId = {
    "red-rook": { stealth: { owner: "red", remainingOwnerTurns: 1, strongStrikeAvailable: true, source: "hero" } },
    "black-rook": { stealth: { owner: "black", remainingOwnerTurns: 1, strongStrikeAvailable: true, source: "hero" } },
  };
  state.assassination!.red.activePieceId = "red-rook";
  state.assassination!.black.activePieceId = "black-rook";
  const result = applyAuthoritativeAssassination(state, secretState(), assassination({ x: 0, y: 4 }, { x: 0, y: 7 }, "strong", undefined, true));
  assert.equal(result.state.pieces.some(p => p.id === "red-rook"), false);
  assert.equal(state.pieces.some(p => p.id === "red-rook"), true);
});
test("ROGUE-04 两个己方窗口后隐身退出，普通入口不能绕过来源", () => {
  const state = initializeFeatureGameState(
    gameState([
      revealed("rogue-rook", "red", "rook", 0, 7),
      revealed("red-pawn-a", "red", "pawn", 1, 7),
      revealed("black-pawn-a", "black", "pawn", 1, 2),
    ]),
    { red: "rogue", black: "hunter" },
  );
  const first = applyAuthoritativeAssassination(
    state, secretState(), assassination({ x: 0, y: 7 }, { x: 0, y: 6 }, "start", "hero"),
  );
  const blackOne = applyAuthoritativeMove(first.state, first.secret, move({ x: 1, y: 2 }, { x: 1, y: 3 }, "black-1", 1));
  const redOne = applyAuthoritativeMove(blackOne.state, blackOne.secret, move({ x: 1, y: 7 }, { x: 1, y: 6 }, "red-1", 2));
  assert.equal(redOne.state.effectsByPieceId?.["rogue-rook"]?.stealth?.remainingOwnerTurns, 1);
  const blackTwo = applyAuthoritativeMove(redOne.state, redOne.secret, move({ x: 1, y: 3 }, { x: 1, y: 4 }, "black-2", 3));
  const redTwo = applyAuthoritativeMove(blackTwo.state, blackTwo.secret, move({ x: 1, y: 6 }, { x: 1, y: 5 }, "red-2", 4));
  assert.equal(redTwo.state.effectsByPieceId?.["rogue-rook"]?.stealth, undefined);
  assert.equal(redTwo.state.assassination?.red.activePieceId, undefined);
  assert.throws(
    () => applyAuthoritativeMove({ ...first.state, turn: "red" }, first.secret, move({ x: 0, y: 6 }, { x: 0, y: 5 }, "wrong-api", 1)),
    (error) => error instanceof RuleError && error.code === "STEALTH_ACTION_REQUIRED",
  );
});

test("ROGUE-05 发动可普通进攻但不能立即使用刺杀机会；资源失败不消耗", () => {
  const state = initializeFeatureGameState(gameState([revealed("rogue", "red", "rook", 0, 7), revealed("barrier", "black", "pawn", 0, 6)]), { red: "rogue", black: "warrior" });
  assert.deepEqual(getLegalAssassinationMoves(state, "rogue", true), []);
  assert.throws(() => applyAuthoritativeAssassination(state, secretState(), assassination({ x: 0, y: 7 }, { x: 0, y: 6 }, "strong", "hero", true)), (e) => e instanceof RuleError && e.code === "ASSASSINATION_DELAYED");
  assert.equal(state.assassination.red.heroChargeAvailable, true);
});

test("ROGUE-06 首次立即强击仍不能以将帅为目标", () => {
  const state = initializeFeatureGameState(
    gameState([revealed("rogue", "red", "rook", 0, 7)], { blackGeneral: { x: 0, y: 6 } }),
    { red: "rogue", black: "hunter" },
  );
  assert.equal(getLegalAssassinationMoves(state, "rogue", true).some((position) => position.x === 0 && position.y === 6), false);
  assert.throws(
    () => applyAuthoritativeAssassination(
      state,
      secretState(),
      assassination({ x: 0, y: 7 }, { x: 0, y: 6 }, "general", "hero", true),
    ),
    (error) => error instanceof RuleError && error.code === "ASSASSINATION_DELAYED",
  );
});

test("ROGUE-07 强击与战车同一原子行动会先碾碎路径，再处决最终目标", () => {
  const state = initializeFeatureGameState(
    gameState([
      revealed("rogue-rook", "red", "rook", 0, 7),
      revealed("path", "black", "pawn", 0, 5),
      revealed("target", "black", "cannon", 0, 3),
    ]),
    { red: "rogue", black: "hunter" },
    "war_chariot",
  );
  state.effectsByPieceId = {
    "rogue-rook": { stealth: { owner: "red", remainingOwnerTurns: 1, strongStrikeAvailable: true, source: "hero" } },
  };
  state.assassination!.red.heroChargeAvailable = false;
  state.assassination!.red.activePieceId = "rogue-rook";
  const result = applyAuthoritativeAssassination(
    state,
    secretState(),
    assassination({ x: 0, y: 7 }, { x: 0, y: 3 }, "war-chariot-strong", undefined, true),
  );
  assert.equal(result.state.pieces.some((piece) => piece.id === "path"), false);
  assert.equal(result.state.pieces.some((piece) => piece.id === "target"), false);
  assert.equal(result.state.pieces.find((piece) => piece.id === "rogue-rook")?.y, 3);
  assert.equal(result.state.assassination?.red.heroChargeAvailable, false);
  assert.equal(result.state.assassination?.red.activePieceId, undefined);
});

test("ROGUE-08 英雄与暗影之舞来源独立消耗，并共享新刺杀规则", () => {
  const state = initializeFeatureGameState(
    gameState([
      revealed("rogue-rook", "red", "rook", 0, 7),
      revealed("red-pawn", "red", "pawn", 1, 7),
      revealed("black-target", "black", "pawn", 0, 6),
      revealed("black-pawn", "black", "pawn", 1, 2),
    ]),
    { red: "rogue", black: "hunter" },
    "shadow_dance",
  );
  const hero = applyAuthoritativeAssassination(
    state,
    secretState(),
    assassination({ x: 0, y: 7 }, { x: 0, y: 8 }, "hero-empty", "hero", false),
  );
  assert.equal(hero.state.assassination?.red.heroChargeAvailable, false);
  assert.equal(hero.state.assassination?.red.mutationChargeAvailable, true);

  const blackOne = applyAuthoritativeMove(hero.state, hero.secret, move({ x: 1, y: 2 }, { x: 1, y: 3 }, "black-one", 1));
  const redOne = applyAuthoritativeAssassination(blackOne.state, blackOne.secret, assassination({ x: 0, y: 8 }, { x: 0, y: 7 }, "red-one", undefined, false, 2));
  assert.equal(redOne.state.assassination?.red.activePieceId, undefined);
  const blackTwo = applyAuthoritativeMove(redOne.state, redOne.secret, move({ x: 1, y: 3 }, { x: 1, y: 4 }, "black-two", 3));
  const mutation = applyAuthoritativeAssassination(
    blackTwo.state,
    blackTwo.secret,
    assassination({ x: 0, y: 7 }, { x: 0, y: 8 }, "mutation-move", "mutation", false, 4),
  );
  assert.equal(mutation.state.assassination?.red.heroChargeAvailable, false);
  assert.equal(mutation.state.assassination?.red.mutationChargeAvailable, false);
  assert.deepEqual(mutation.state.effectsByPieceId?.["rogue-rook"]?.stealth, {
    owner: "red",
    remainingOwnerTurns: 2,
    activatedOnFormalTurn: 3,
    strongStrikeAvailable: true,
    source: "mutation",
  });
});

test("ROGUE-09 暗影之舞进入隐身时保留同一步获得的战士壁垒", () => {
  const state = initializeFeatureGameState(
    gameState([revealed("warrior-rook", "red", "rook", 4, 7)]),
    { red: "warrior", black: "hunter" },
    "shadow_dance",
  );
  const result = applyAuthoritativeAssassination(
    state,
    secretState(),
    assassination({ x: 4, y: 7 }, { x: 4, y: 6 }, "warrior-shadow", "mutation"),
  );
  assert.deepEqual(result.state.effectsByPieceId?.["warrior-rook"], {
    barrier: { owner: "red", enemyTurnsRemaining: 3 },
    stealth: { owner: "red", remainingOwnerTurns: 2, activatedOnFormalTurn: 1, strongStrikeAvailable: true, source: "mutation" },
  });
});
