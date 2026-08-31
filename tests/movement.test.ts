import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAuthoritativeMove,
  getController,
  getLegalMoves,
  getPseudoMoves,
  pieceById,
  validatePublicMove,
} from "../src/index.ts";
import {
  covered,
  gameState,
  move,
  revealed,
  secretState,
} from "./helpers.ts";

test("DARK-01 暗车位可以沿空路径横直移动", () => {
  const state = gameState([covered("source", 0, 9)]);
  assert.equal(
    validatePublicMove(state, move({ x: 0, y: 9 }, { x: 0, y: 7 })).ok,
    true,
  );
});

test("DARK-02 暗车位不能越过棋子", () => {
  const state = gameState([
    covered("source", 0, 9),
    revealed("block", "red", "pawn", 0, 8),
  ]);
  assert.equal(
    validatePublicMove(state, move({ x: 0, y: 9 }, { x: 0, y: 7 })).code,
    "ILLEGAL_MOVEMENT",
  );
});

test("DARK-03 暗马位受马腿阻挡", () => {
  const state = gameState([
    covered("source", 1, 9),
    revealed("leg", "red", "pawn", 1, 8),
  ]);
  assert.equal(
    validatePublicMove(state, move({ x: 1, y: 9 }, { x: 2, y: 7 })).ok,
    false,
  );
});

test("DARK-04 暗炮位不吃子时路径必须为空", () => {
  const clear = gameState([covered("source", 1, 7)]);
  const blocked = gameState([
    covered("source", 1, 7),
    revealed("block", "red", "pawn", 1, 6),
  ]);
  const command = move({ x: 1, y: 7 }, { x: 1, y: 5 });
  assert.equal(validatePublicMove(clear, command).ok, true);
  assert.equal(validatePublicMove(blocked, command).ok, false);
});

test("DARK-05 暗炮位隔一枚炮架可以吃子", () => {
  const state = gameState([
    covered("source", 1, 7),
    revealed("screen", "red", "pawn", 1, 5),
    revealed("target", "black", "pawn", 1, 3),
  ]);
  assert.equal(
    validatePublicMove(state, move({ x: 1, y: 7 }, { x: 1, y: 3 })).ok,
    true,
  );
});

test("DARK-06 暗炮位吃子时零枚或两枚炮架均非法", () => {
  const noScreen = gameState([
    covered("source", 1, 7),
    revealed("target", "black", "pawn", 1, 3),
  ]);
  const twoScreens = gameState([
    covered("source", 1, 7),
    revealed("screen-1", "red", "pawn", 1, 5),
    revealed("screen-2", "black", "pawn", 1, 4),
    revealed("target", "black", "pawn", 1, 3),
  ]);
  const command = move({ x: 1, y: 7 }, { x: 1, y: 3 });
  assert.equal(validatePublicMove(noScreen, command).ok, false);
  assert.equal(validatePublicMove(twoScreens, command).ok, false);
});

test("DARK-07 红暗兵第一步只能向y减一", () => {
  const state = gameState([covered("source", 4, 6)]);
  assert.equal(
    validatePublicMove(state, move({ x: 4, y: 6 }, { x: 4, y: 5 })).ok,
    true,
  );
  assert.equal(
    validatePublicMove(state, move({ x: 4, y: 6 }, { x: 3, y: 6 })).ok,
    false,
  );
});

test("DARK-08 黑暗卒第一步只能向y加一", () => {
  const state = gameState([covered("source", 4, 3)], { turn: "black" });
  assert.equal(
    validatePublicMove(
      state,
      move({ x: 4, y: 3 }, { x: 4, y: 4 }),
      "black",
    ).ok,
    true,
  );
  assert.equal(
    validatePublicMove(
      state,
      move({ x: 4, y: 3 }, { x: 3, y: 3 }),
      "black",
    ).ok,
    false,
  );
});

test("DARK-09 暗仕位第一步不能走出位置方九宫", () => {
  const state = gameState([covered("source", 3, 9)], {
    redGeneral: { x: 4, y: 9 },
  });
  assert.equal(
    validatePublicMove(state, move({ x: 3, y: 9 }, { x: 2, y: 8 })).ok,
    false,
  );
  assert.equal(
    validatePublicMove(state, move({ x: 3, y: 9 }, { x: 4, y: 8 })).ok,
    true,
  );
});

test("DARK-10 暗相位第一步终点自然留在本方并落地翻开", () => {
  const state = gameState([covered("source", 2, 9)]);
  assert.deepEqual(getPseudoMoves(state, "source"), [
    { x: 0, y: 7 },
    { x: 4, y: 7 },
  ]);
  const result = applyAuthoritativeMove(
    state,
    secretState({ source: { color: "red", type: "elephant" } }),
    move({ x: 2, y: 9 }, { x: 0, y: 7 }),
  );
  assert.equal(pieceById(result.state, "source")?.faceDown, false);
});

test("DARK-11 暗相位受象眼阻挡", () => {
  const state = gameState([
    covered("source", 2, 9),
    revealed("eye", "red", "pawn", 3, 8),
  ]);
  assert.equal(
    validatePublicMove(state, move({ x: 2, y: 9 }, { x: 4, y: 7 })).ok,
    false,
  );
});

test("DARK-12 暗子非吃子移动后立即公开身份", () => {
  const result = applyAuthoritativeMove(
    gameState([covered("source", 0, 9)]),
    secretState({ source: { color: "black", type: "horse" } }),
    move({ x: 0, y: 9 }, { x: 0, y: 8 }),
  );
  assert.deepEqual(pieceById(result.state, "source"), {
    id: "source",
    x: 0,
    y: 8,
    faceDown: false,
    color: "black",
    type: "horse",
  });
});

test("CAP-01 红明子可以吃红方位置上的暗子", () => {
  const result = applyAuthoritativeMove(
    gameState([
      revealed("source", "red", "rook", 0, 5),
      covered("target", 0, 6),
    ]),
    secretState({ target: { color: "red", type: "pawn" } }),
    move({ x: 0, y: 5 }, { x: 0, y: 6 }),
  );
  assert.equal(pieceById(result.state, "target"), undefined);
  assert.equal(result.state.captured[0].type, "pawn");
});

test("CAP-02 红明子可以吃黑方位置上的暗子", () => {
  const result = applyAuthoritativeMove(
    gameState([
      revealed("source", "red", "rook", 0, 4),
      covered("target", 0, 3),
    ]),
    secretState({ target: { color: "black", type: "pawn" } }),
    move({ x: 0, y: 4 }, { x: 0, y: 3 }),
  );
  assert.equal(result.state.captured[0].color, "black");
});

test("CAP-03 自残只允许吃暗子，不能吃己方明子", () => {
  const state = gameState([
    revealed("source", "red", "rook", 0, 5),
    revealed("target", "red", "pawn", 0, 4),
  ]);
  assert.equal(
    validatePublicMove(state, move({ x: 0, y: 5 }, { x: 0, y: 4 })).code,
    "ILLEGAL_TARGET",
  );
});

test("CAP-03A 不能直接吃将帅", () => {
  const state = gameState([revealed("source", "red", "rook", 5, 1)]);
  assert.equal(
    validatePublicMove(state, move({ x: 5, y: 1 }, { x: 5, y: 0 })).code,
    "ILLEGAL_TARGET",
  );
});

test("CAP-04 红方暗子可以吃另一枚红方暗子", () => {
  const result = applyAuthoritativeMove(
    gameState([covered("source", 0, 9), covered("target", 0, 6)]),
    secretState({
      source: { color: "red", type: "rook" },
      target: { color: "black", type: "pawn" },
    }),
    move({ x: 0, y: 9 }, { x: 0, y: 6 }),
  );
  assert.equal(pieceById(result.state, "target"), undefined);
  assert.equal(pieceById(result.state, "source")?.faceDown, false);
});

test("CAP-05 被吃暗子真实同色也不会撤销吃子", () => {
  const result = applyAuthoritativeMove(
    gameState([
      revealed("source", "red", "rook", 0, 5),
      covered("target", 0, 6),
    ]),
    secretState({ target: { color: "red", type: "cannon" } }),
    move({ x: 0, y: 5 }, { x: 0, y: 6 }),
  );
  assert.equal(result.state.captured[0].color, "red");
  assert.equal(pieceById(result.state, "target"), undefined);
});

test("CAP-06 被吃暗子真实异色也不产生额外回合", () => {
  const result = applyAuthoritativeMove(
    gameState([
      revealed("source", "red", "rook", 0, 5),
      covered("target", 0, 6),
    ]),
    secretState({ target: { color: "black", type: "cannon" } }),
    move({ x: 0, y: 5 }, { x: 0, y: 6 }),
  );
  assert.equal(result.state.turn, "black");
  assert.equal(result.state.revision, 1);
});

test("CAP-07 暗来源翻成被吃明子的同色后仍保留吃子结果", () => {
  const result = applyAuthoritativeMove(
    gameState([
      covered("source", 0, 9),
      revealed("target", "black", "pawn", 0, 6),
    ]),
    secretState({ source: { color: "black", type: "horse" } }),
    move({ x: 0, y: 9 }, { x: 0, y: 6 }),
  );
  const source = pieceById(result.state, "source");
  assert.equal(pieceById(result.state, "target"), undefined);
  assert.equal(source && getController(source), "black");
});

test("CTRL-01 红方暗子翻出红棋后仍由红方控制", () => {
  const result = applyAuthoritativeMove(
    gameState([covered("source", 0, 9)]),
    secretState({ source: { color: "red", type: "rook" } }),
    move({ x: 0, y: 9 }, { x: 0, y: 8 }),
  );
  const source = pieceById(result.state, "source");
  assert.equal(source && getController(source), "red");
});

test("CTRL-02 红方暗子翻出黑棋后立即由黑方控制", () => {
  const result = applyAuthoritativeMove(
    gameState([covered("source", 0, 9)]),
    secretState({ source: { color: "black", type: "horse" } }),
    move({ x: 0, y: 9 }, { x: 0, y: 8 }),
  );
  const source = pieceById(result.state, "source");
  assert.equal(source && getController(source), "black");
});

test("CTRL-03 黑方暗子翻出红棋后立即由红方控制", () => {
  const result = applyAuthoritativeMove(
    gameState([covered("source", 0, 0)], { turn: "black" }),
    secretState({ source: { color: "red", type: "horse" } }),
    move({ x: 0, y: 0 }, { x: 0, y: 1 }),
  );
  const source = pieceById(result.state, "source");
  assert.equal(source && getController(source), "red");
});

test("CTRL-04 倒戈但未触发背刺时正常换手", () => {
  const result = applyAuthoritativeMove(
    gameState([covered("source", 0, 9)]),
    secretState({ source: { color: "black", type: "horse" } }),
    move({ x: 0, y: 9 }, { x: 0, y: 8 }),
  );
  assert.equal(result.state.status, "playing");
  assert.equal(result.state.turn, "black");
});

test("OPEN-01 明仕士可以在九宫外斜走一格", () => {
  const state = gameState([revealed("source", "red", "advisor", 4, 5)]);
  assert.equal(
    validatePublicMove(state, move({ x: 4, y: 5 }, { x: 3, y: 4 })).ok,
    true,
  );
});

test("OPEN-02 明仕士不能横走或直走", () => {
  const state = gameState([revealed("source", "red", "advisor", 4, 5)]);
  assert.equal(
    validatePublicMove(state, move({ x: 4, y: 5 }, { x: 4, y: 4 })).ok,
    false,
  );
});

test("OPEN-02A 中路仕挡住将帅照面时不能移开", () => {
  const state = gameState(
    [revealed("source", "red", "advisor", 4, 3)],
    { redGeneral: { x: 4, y: 9 }, blackGeneral: { x: 4, y: 0 } },
  );
  assert.deepEqual(getLegalMoves(state, "source"), []);
  assert.equal(
    validatePublicMove(state, move({ x: 4, y: 3 }, { x: 3, y: 2 })).code,
    "SELF_CHECK",
  );
});

test("OPEN-03 明相象可以跨河走田字", () => {
  const state = gameState([revealed("source", "red", "elephant", 4, 5)]);
  assert.equal(
    validatePublicMove(state, move({ x: 4, y: 5 }, { x: 2, y: 3 })).ok,
    true,
  );
});

test("OPEN-04 明相象跨河仍受象眼阻挡", () => {
  const state = gameState([
    revealed("source", "red", "elephant", 4, 5),
    revealed("eye", "red", "pawn", 3, 4),
  ]);
  assert.equal(
    validatePublicMove(state, move({ x: 4, y: 5 }, { x: 2, y: 3 })).ok,
    false,
  );
});

test("OPEN-05 红兵位翻出黑卒后按黑方方向移动", () => {
  const first = applyAuthoritativeMove(
    gameState([covered("source", 4, 6)]),
    secretState({ source: { color: "black", type: "pawn" } }),
    move({ x: 4, y: 6 }, { x: 4, y: 5 }),
  );
  assert.equal(
    validatePublicMove(
      first.state,
      move({ x: 4, y: 5 }, { x: 4, y: 6 }, "next", 1),
      "black",
    ).ok,
    true,
  );
});

test("OPEN-06 黑卒位翻出红兵后按红方方向移动", () => {
  const first = applyAuthoritativeMove(
    gameState([covered("source", 4, 3)], { turn: "black" }),
    secretState({ source: { color: "red", type: "pawn" } }),
    move({ x: 4, y: 3 }, { x: 4, y: 4 }),
  );
  assert.equal(
    validatePublicMove(
      first.state,
      move({ x: 4, y: 4 }, { x: 4, y: 3 }, "next", 1),
      "red",
    ).ok,
    true,
  );
});

test("OPEN-07 异色兵翻开时已过真实河界即可横走", () => {
  const state = gameState(
    [revealed("source", "black", "pawn", 4, 5)],
    { turn: "black" },
  );
  assert.equal(
    validatePublicMove(
      state,
      move({ x: 4, y: 5 }, { x: 3, y: 5 }),
      "black",
    ).ok,
    true,
  );
});
