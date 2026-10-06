import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAuthoritativeMove,
  applyHeroAbility,
  getController,
  getCurrentPieceType,
  getDarkIdentity,
  getLegalMoves,
  getMovementIdentity,
  getPieceTypeForMovement,
  initializeFeatureGameState,
  pieceById,
  RuleError,
  validatePublicMove,
} from "../src/index.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";

test("R4-DARK-01 两方全部30个基础暗子棋位使用位置兵种", () => {
  for (const backY of [0, 9]) {
    for (const [x, type] of [
      [0, "rook"], [1, "horse"], [2, "elephant"], [3, "advisor"],
      [5, "advisor"], [6, "elephant"], [7, "horse"], [8, "rook"],
    ] as const) {
      assert.equal(getCurrentPieceType(covered("same-id", x, backY)), type);
    }
  }
  for (const cannonY of [2, 7]) {
    for (const x of [1, 7]) assert.equal(getDarkIdentity(covered("same-id", x, cannonY)), "cannon");
  }
  for (const pawnY of [3, 6]) {
    for (const x of [0, 2, 4, 6, 8]) assert.equal(getDarkIdentity(covered("same-id", x, pawnY)), "pawn");
  }
});

test("R4-DARK-02 当前坐标决定兵种，不固定在原始棋位或棋子ID", () => {
  const piece = covered("original-rook-slot", 0, 9);
  assert.equal(getCurrentPieceType(piece), "rook");
  // 仅构造来源已经完成移置后的公开位置，未定义新的移置技能。
  piece.x = 1;
  assert.equal(getCurrentPieceType(piece), "horse");
  piece.y = 7;
  assert.equal(getCurrentPieceType(piece), "cannon");
  assert.equal(piece.faceDown, true);
});

test("R4-DARK-03 普通判定不读附带真实身份、不揭示、不改变公开或秘密状态", () => {
  const piece = covered("source", 0, 9);
  Object.defineProperties(piece, {
    type: { get() { throw new Error("禁止读取隐藏兵种"); } },
    color: { get() { throw new Error("禁止读取秘密阵营"); } },
  });
  Object.freeze(piece);
  const secret = secretState({ source: { type: "pawn", color: "black" } });
  const before = structuredClone(secret);
  assert.equal(getCurrentPieceType(piece), "rook");
  assert.equal(getPieceTypeForMovement(piece), "rook");
  assert.deepEqual(getMovementIdentity(piece), { type: "rook", side: "red" });
  assert.equal(getController(piece), "red");
  assert.equal(piece.faceDown, true);
  assert.deepEqual(secret, before);
});

test("R4-DARK-04 相同公开状态的不同隐藏身份不改变普通走法资格，揭示才读取真实身份", () => {
  const state = gameState([covered("source", 0, 9)]);
  const command = move({ x: 0, y: 9 }, { x: 0, y: 8 });
  const before = structuredClone(state);
  const publicMoves = getLegalMoves(state, "source");
  assert.equal(validatePublicMove(state, command).ok, true);
  for (const identity of [
    { color: "red", type: "pawn" },
    { color: "black", type: "horse" },
  ] as const) {
    const secret = secretState({ source: identity });
    const secretBefore = structuredClone(secret);
    assert.deepEqual(getLegalMoves(state, "source"), publicMoves);
    const result = applyAuthoritativeMove(state, secret, command);
    const shown = pieceById(result.state, "source")!;
    assert.equal(shown.faceDown, false);
    assert.equal(getCurrentPieceType(shown), identity.type);
    assert.equal(getController(shown), identity.color);
    assert.deepEqual(result.state.lastMove?.revealed, identity);
    assert.equal(result.secret.identities.source, undefined);
    assert.deepEqual(secret, secretBefore);
  }
  assert.deepEqual(state, before);
});

test("R4-DARK-05 明棋位于任何位置都使用公开真实兵种，不继续套暗置棋位", () => {
  for (const type of ["general", "advisor", "elephant", "horse", "rook", "cannon", "pawn"] as const) {
    assert.equal(getCurrentPieceType(revealed("shown", "black", type, 0, 9)), type);
    assert.equal(getPieceTypeForMovement(revealed("shown", "black", type, 4, 5)), type);
  }
});

test("R4-DARK-06 非基础棋位明确缺少来源定义，绝不以真实兵种或统一身份兜底", () => {
  for (const [x, y] of [[4, 5], [4, 0], [4, 9], [-1, 3], [1.5, 9]]) {
    const piece = covered("undefined-source", x, y);
    Object.defineProperty(piece, "type", { get() { throw new Error("不得秘密兜底"); } });
    const expected = (error: unknown) => error instanceof RuleError && error.code === "UNDEFINED_DARK_IDENTITY";
    assert.throws(() => getDarkIdentity(piece), expected);
    assert.throws(() => getCurrentPieceType(piece), expected);
    assert.throws(() => getMovementIdentity(piece), expected);
    assert.throws(() => getPieceTypeForMovement(piece), expected);
    assert.equal(piece.faceDown, true);
  }
});

test("R4-DARK-07 铁马的暗马位资格和马腿碾碎使用公共身份，随后揭示真实车", () => {
  const state = initializeFeatureGameState(gameState([
    covered("source", 1, 9), revealed("leg", "red", "pawn", 1, 8),
  ]), undefined, "iron_steed");
  const command = move({ x: 1, y: 9 }, { x: 2, y: 7 });
  assert.equal(validatePublicMove(state, command).ok, true);
  const result = applyAuthoritativeMove(state, secretState({ source: { type: "rook", color: "red" } }), command);
  assert.equal(result.state.captured.find(p => p.id === "leg")?.cause, "crush");
  assert.equal(getCurrentPieceType(pieceById(result.state, "source")!), "rook");
});

test("R4-DARK-08 战车的暗车位资格和路径碾碎使用公共身份，随后揭示真实兵", () => {
  const state = initializeFeatureGameState(gameState([
    covered("source", 0, 9), revealed("path", "red", "pawn", 0, 8),
    revealed("target", "black", "pawn", 0, 6),
  ]), undefined, "war_chariot");
  const command = move({ x: 0, y: 9 }, { x: 0, y: 6 });
  assert.equal(validatePublicMove(state, command).ok, true);
  const result = applyAuthoritativeMove(state, secretState({ source: { type: "pawn", color: "red" } }), command);
  assert.equal(result.state.captured.find(p => p.id === "path")?.cause, "crush");
  assert.equal(result.state.captured.find(p => p.id === "target")?.cause, "attack");
  assert.equal(getCurrentPieceType(pieceById(result.state, "source")!), "pawn");
});

test("R4-DARK-09 毁灭的非将帅候选判定使用公共兵种，未消灭暗子不要求读取真实身份", () => {
  const state = initializeFeatureGameState(gameState([covered("source", 0, 9)]), { red: "deathwing" });
  let rolls = 0;
  // 故意不提供暗子真实身份：候选筛选无需它，只有实际死亡揭示才需要。
  const result = applyHeroAbility(state, secretState(), {
    kind: "hero_ability", ability: "destruction", actionId: "dark-pool", expectedRevision: 0,
  }, 0, max => { assert.equal(max, 2); rolls += 1; return 1; });
  assert.equal(rolls, 1);
  assert.equal(pieceById(result.state, "source")?.faceDown, true);
  assert.equal(result.state.captured.length, 0);
  assert.equal(result.state.turn, "black");
});
