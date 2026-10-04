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
    remainingOwnerTurns: 1,
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
    "red-rook": { stealth: { owner: "red", remainingOwnerTurns: 1, strongStrikeAvailable: true, source: "hero" } },
    "black-rook": { stealth: { owner: "black", remainingOwnerTurns: 1, strongStrikeAvailable: true, source: "hero" } },
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

test("ROGUE-04 隐身在下一个己方其他走子后消失，普通走子不能直接调用隐身棋", () => {
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
  assert.equal(redOne.state.effectsByPieceId?.["rogue-rook"], undefined);
  assert.equal(redOne.state.assassination?.red.activePieceId, undefined);
  assert.throws(
    () => applyAuthoritativeMove({ ...first.state, turn: "red" }, first.secret, move({ x: 0, y: 6 }, { x: 0, y: 5 }, "wrong-api", 1)),
    (error) => error instanceof RuleError && error.code === "STEALTH_ACTION_REQUIRED",
  );
});

test("ROGUE-05 刺杀首次行动可立即强击，破除防御后进入一回合隐身", () => {
  const state = initializeFeatureGameState(
    gameState([revealed("rogue", "red", "rook", 0, 7), revealed("barrier", "black", "pawn", 0, 6)]),
    { red: "rogue", black: "warrior" },
  );
  state.effectsByPieceId = { barrier: { barrier: { owner: "black", enemyHalfEntered: false, movesAfterEnemyHalfEntry: 0 } } };
  const normalLegal = getLegalAssassinationMoves(state, "rogue", false);
  const strongLegal = getLegalAssassinationMoves(state, "rogue", true);
  assert.equal(normalLegal.some((position) => position.x === 0 && position.y === 6), false);
  assert.equal(normalLegal.some((position) => position.x === 0 && position.y === 8), true);
  assert.equal(strongLegal.some((position) => position.x === 0 && position.y === 6), true);
  assert.throws(
    () => applyAuthoritativeAssassination(state, secretState(), assassination({ x: 0, y: 7 }, { x: 0, y: 6 }, "capture", "hero")),
    (error) => error instanceof RuleError && error.code === "ASSASSINATION_FIRST_MOVE_MUST_BE_EMPTY",
  );
  const result = applyAuthoritativeAssassination(
    state,
    secretState(),
    assassination({ x: 0, y: 7 }, { x: 0, y: 6 }, "strong", "hero", true),
  );
  assert.equal(result.state.pieces.some((piece) => piece.id === "barrier"), false);
  assert.equal(result.state.pieces.find((piece) => piece.id === "rogue")?.y, 6);
  assert.equal(result.state.assassination?.red.heroChargeAvailable, false);
  assert.equal(result.state.assassination?.red.activePieceId, "rogue");
  assert.deepEqual(result.state.effectsByPieceId?.rogue?.stealth, {
    owner: "red",
    remainingOwnerTurns: 1,
    strongStrikeAvailable: false,
    source: "hero",
  });
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
    (error) => error instanceof RuleError && error.code === "INVALID_STRONG_STRIKE_TARGET",
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
    assassination({ x: 0, y: 7 }, { x: 0, y: 6 }, "hero-strong", "hero", true),
  );
  assert.equal(hero.state.assassination?.red.heroChargeAvailable, false);
  assert.equal(hero.state.assassination?.red.mutationChargeAvailable, true);

  const blackOne = applyAuthoritativeMove(hero.state, hero.secret, move({ x: 1, y: 2 }, { x: 1, y: 3 }, "black-one", 1));
  const redOne = applyAuthoritativeMove(blackOne.state, blackOne.secret, move({ x: 1, y: 7 }, { x: 1, y: 6 }, "red-one", 2));
  assert.equal(redOne.state.assassination?.red.activePieceId, undefined);
  const blackTwo = applyAuthoritativeMove(redOne.state, redOne.secret, move({ x: 1, y: 3 }, { x: 1, y: 4 }, "black-two", 3));
  const mutation = applyAuthoritativeAssassination(
    blackTwo.state,
    blackTwo.secret,
    assassination({ x: 0, y: 6 }, { x: 0, y: 5 }, "mutation-move", "mutation", false, 4),
  );
  assert.equal(mutation.state.assassination?.red.heroChargeAvailable, false);
  assert.equal(mutation.state.assassination?.red.mutationChargeAvailable, false);
  assert.deepEqual(mutation.state.effectsByPieceId?.["rogue-rook"]?.stealth, {
    owner: "red",
    remainingOwnerTurns: 1,
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
    barrier: { owner: "red", enemyHalfEntered: false, movesAfterEnemyHalfEntry: 0 },
    stealth: { owner: "red", remainingOwnerTurns: 1, strongStrikeAvailable: true, source: "mutation" },
  });
});
