import assert from "node:assert/strict";
import test from "node:test";
import {
  COVERED_SLOTS,
  RuleError,
  countPoolByColorAndType,
  createIdentityPool,
  createInitialGame,
  createRpsState,
  getCoveredSlot,
  submitRpsChoice,
} from "../src/index.ts";
import { seededRandomInt } from "./helpers.ts";

test("SET-01 将帅固定在标准位置", () => {
  const { state } = createInitialGame(seededRandomInt(1));
  const red = state.pieces.find((piece) => piece.id === "red-general");
  const black = state.pieces.find((piece) => piece.id === "black-general");
  assert.deepEqual(red, {
    id: "red-general",
    x: 4,
    y: 9,
    faceDown: false,
    color: "red",
    type: "general",
  });
  assert.deepEqual(black, {
    id: "black-general",
    x: 4,
    y: 0,
    faceDown: false,
    color: "black",
    type: "general",
  });
});

test("SET-02 秘密池恰好30枚且不含将帅", () => {
  const pool = createIdentityPool();
  assert.equal(pool.length, 30);
  assert.equal(pool.some((piece) => piece.type === "general"), false);
});

test("SET-03 每种颜色的棋子数量正确", () => {
  const counts = countPoolByColorAndType(createIdentityPool());
  for (const color of ["red", "black"] as const) {
    assert.deepEqual(counts[color], {
      rook: 2,
      horse: 2,
      elephant: 2,
      advisor: 2,
      cannon: 2,
      pawn: 5,
    });
  }
});

test("SET-04 全局洗牌允许红黑棋进入对方位置", () => {
  const { state, secret } = createInitialGame(seededRandomInt(20260830));
  const crossed = state.pieces.filter((piece) => piece.faceDown).map((piece) => {
    const slot = getCoveredSlot(piece.x, piece.y);
    return slot && secret.identities[piece.id].color !== slot.side;
  });
  assert.equal(crossed.some(Boolean), true);
});

test("SET-05 32个棋子ID唯一且没有遗漏", () => {
  const { state } = createInitialGame(seededRandomInt(2));
  assert.equal(state.pieces.length, 32);
  assert.equal(new Set(state.pieces.map((piece) => piece.id)).size, 32);
});

test("SET-06 公开暗子不含真实颜色与兵种", () => {
  const { state } = createInitialGame(seededRandomInt(3));
  for (const piece of state.pieces.filter((item) => item.faceDown)) {
    assert.equal("color" in piece, false);
    assert.equal("type" in piece, false);
  }
});

test("SET-07 相同随机源可稳定复现映射", () => {
  const first = createInitialGame(seededRandomInt(99));
  const second = createInitialGame(seededRandomInt(99));
  assert.deepEqual(first, second);
});

test("SET-08 所有存活暗子都在标准暗子位置", () => {
  const { state } = createInitialGame(seededRandomInt(4));
  const covered = state.pieces.filter((piece) => piece.faceDown);
  assert.equal(covered.length, COVERED_SLOTS.length);
  for (const piece of covered) {
    assert.ok(getCoveredSlot(piece.x, piece.y));
  }
});

test("RPS-01 单方选择只公开已提交状态", () => {
  const initial = createRpsState("alice", "bob");
  const next = submitRpsChoice(
    initial.publicState,
    initial.secretState,
    "alice",
    "rock",
    1,
  );
  assert.equal(next.publicState.submitted.alice, true);
  assert.equal(next.publicState.submitted.bob, false);
  assert.equal(JSON.stringify(next.publicState).includes("rock"), false);
  assert.equal(next.secretState.choices.alice, "rock");
});

for (const [id, first, second, expected] of [
  ["RPS-02", "rock", "scissors", "alice"],
  ["RPS-03", "scissors", "paper", "alice"],
  ["RPS-04", "paper", "rock", "alice"],
] as const) {
  test(`${id} 正确判定胜者并分配红方`, () => {
    const initial = createRpsState("alice", "bob");
    const one = submitRpsChoice(
      initial.publicState,
      initial.secretState,
      "alice",
      first,
      1,
    );
    const two = submitRpsChoice(
      one.publicState,
      one.secretState,
      "bob",
      second,
      1,
    );
    assert.equal(two.publicState.status, "resolved");
    assert.equal(two.publicState.assignments?.red, expected);
    assert.equal(two.publicState.assignments?.black, "bob");
  });
}

test("RPS-05 平局后轮次加一并重新选择", () => {
  const initial = createRpsState("alice", "bob");
  const one = submitRpsChoice(
    initial.publicState,
    initial.secretState,
    "alice",
    "rock",
    1,
  );
  const two = submitRpsChoice(
    one.publicState,
    one.secretState,
    "bob",
    "rock",
    1,
  );
  assert.equal(two.publicState.status, "choosing");
  assert.equal(two.publicState.round, 2);
  assert.equal(two.publicState.lastResult?.tie, true);
  assert.deepEqual(two.publicState.submitted, { alice: false, bob: false });
  assert.deepEqual(two.secretState.choices, {});
});

test("RPS-06 同一轮不能覆盖已经锁定的选择", () => {
  const initial = createRpsState("alice", "bob");
  const one = submitRpsChoice(
    initial.publicState,
    initial.secretState,
    "alice",
    "rock",
    1,
  );
  assert.throws(
    () =>
      submitRpsChoice(
        one.publicState,
        one.secretState,
        "alice",
        "paper",
        1,
      ),
    (error) => error instanceof RuleError && error.code === "CHOICE_LOCKED",
  );
});

test("RPS-07 胜者成为红方且正式棋局红方先走", () => {
  const initial = createRpsState("alice", "bob");
  const one = submitRpsChoice(
    initial.publicState,
    initial.secretState,
    "alice",
    "scissors",
    1,
  );
  const two = submitRpsChoice(
    one.publicState,
    one.secretState,
    "bob",
    "paper",
    1,
  );
  const game = createInitialGame(seededRandomInt(8));
  assert.equal(two.publicState.assignments?.red, "alice");
  assert.equal(game.state.turn, "red");
});
