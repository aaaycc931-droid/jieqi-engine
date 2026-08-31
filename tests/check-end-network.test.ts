import assert from "node:assert/strict";
import test from "node:test";
import {
  RuleError,
  applyAuthoritativeMove,
  applyAutomaticExecution,
  applyResignation,
  applyRoomMove,
  createInitialGame,
  getAutomaticExecutionPlan,
  isCheckmate,
  isGeneralInCheck,
  isStalemate,
  pieceById,
  serializePublicRoom,
  validatePublicMove,
} from "../src/index.ts";
import type { RoomGame } from "../src/room.ts";
import {
  covered,
  gameState,
  move,
  revealed,
  secretState,
  seededRandomInt,
} from "./helpers.ts";

test("CHECK-01 受到明子将军时不能走无关棋", () => {
  const state = gameState(
    [
      revealed("checker", "black", "rook", 4, 5),
      revealed("unrelated", "red", "rook", 0, 9),
    ],
    {
      redGeneral: { x: 4, y: 9 },
      blackGeneral: { x: 5, y: 0 },
    },
  );
  const validation = validatePublicMove(
    state,
    move({ x: 0, y: 9 }, { x: 0, y: 8 }),
  );
  assert.equal(validation.code, "SELF_CHECK");
});

test("CHECK-02 不能移动阻挡棋造成将帅照面", () => {
  const state = gameState(
    [revealed("block", "red", "rook", 4, 5)],
    {
      redGeneral: { x: 4, y: 9 },
      blackGeneral: { x: 4, y: 0 },
    },
  );
  assert.equal(
    validatePublicMove(state, move({ x: 4, y: 5 }, { x: 5, y: 5 })).code,
    "SELF_CHECK",
  );
});

test("CHECK-03 红暗炮位翻出黑车直攻红帅触发背刺并自动终结", () => {
  const result = applyAuthoritativeMove(
    gameState([covered("source", 1, 7)], {
      redGeneral: { x: 4, y: 9 },
      blackGeneral: { x: 5, y: 0 },
    }),
    secretState({ source: { color: "black", type: "rook" } }),
    move({ x: 1, y: 7 }, { x: 4, y: 7 }),
  );
  assert.equal(result.state.status, "execution");
  assert.equal(result.state.winner, "black");
  assert.equal(result.state.reason, "ambush");
  assert.deepEqual(getAutomaticExecutionPlan(result.state), {
    pieceId: "source",
    from: { x: 4, y: 7 },
    to: { x: 4, y: 9 },
  });
  const execution = applyAutomaticExecution(result.state, result.secret, "execute");
  assert.equal(execution.state.status, "finished");
  assert.equal(pieceById(execution.state, "red-general"), undefined);
});

test("CHECK-04 黑暗马位翻出红马直攻黑将触发背刺", () => {
  const result = applyAuthoritativeMove(
    gameState([covered("source", 1, 0)], {
      turn: "black",
      redGeneral: { x: 3, y: 9 },
      blackGeneral: { x: 5, y: 0 },
    }),
    secretState({ source: { color: "red", type: "horse" } }),
    move({ x: 1, y: 0 }, { x: 3, y: 1 }),
  );
  assert.equal(result.state.winner, "red");
  assert.equal(result.state.reason, "ambush");
});

test("CHECK-05 异色炮没有恰好一个炮架时不触发背刺", () => {
  const result = applyAuthoritativeMove(
    gameState([covered("source", 1, 7)], {
      redGeneral: { x: 4, y: 9 },
      blackGeneral: { x: 5, y: 0 },
    }),
    secretState({ source: { color: "black", type: "cannon" } }),
    move({ x: 1, y: 7 }, { x: 4, y: 7 }),
  );
  assert.equal(result.state.reason, undefined);
  assert.equal(result.state.status, "playing");
});

test("CHECK-06 异色车攻击路线被挡时不触发背刺", () => {
  const result = applyAuthoritativeMove(
    gameState(
      [
        covered("source", 1, 7),
        revealed("block", "red", "pawn", 4, 8),
      ],
      {
        redGeneral: { x: 4, y: 9 },
        blackGeneral: { x: 5, y: 0 },
      },
    ),
    secretState({ source: { color: "black", type: "rook" } }),
    move({ x: 1, y: 7 }, { x: 4, y: 7 }),
  );
  assert.equal(result.state.status, "playing");
  assert.equal(result.state.reason, undefined);
});

test("CHECK-07 同色棋翻开后攻击对方将帅属于普通将军", () => {
  const result = applyAuthoritativeMove(
    gameState([covered("source", 1, 7)], {
      redGeneral: { x: 3, y: 9 },
      blackGeneral: { x: 4, y: 0 },
    }),
    secretState({ source: { color: "red", type: "rook" } }),
    move({ x: 1, y: 7 }, { x: 1, y: 0 }),
  );
  assert.equal(result.state.status, "playing");
  assert.equal(result.state.reason, undefined);
  assert.equal(isGeneralInCheck(result.state, "black"), true);
});

test("CHECK-08 背刺后败方不能应将，系统将自动终结", () => {
  const first = applyAuthoritativeMove(
    gameState([covered("source", 1, 7)], {
      redGeneral: { x: 4, y: 9 },
      blackGeneral: { x: 5, y: 0 },
    }),
    secretState({ source: { color: "black", type: "rook" } }),
    move({ x: 1, y: 7 }, { x: 4, y: 7 }),
  );
  const validation = validatePublicMove(
    first.state,
    move({ x: 4, y: 9 }, { x: 3, y: 9 }, "reply", 1),
  );
  assert.equal(validation.code, "GAME_FINISHED");
});

test("CHECK-09 落子前的公开状态与提示不暴露背刺身份", () => {
  const state = gameState([covered("source", 1, 7)], {
    redGeneral: { x: 4, y: 9 },
    blackGeneral: { x: 5, y: 0 },
  });
  const secret = secretState({ source: { color: "black", type: "rook" } });
  const validation = validatePublicMove(
    state,
    move({ x: 1, y: 7 }, { x: 4, y: 7 }),
  );
  assert.deepEqual(validation, { ok: true });
  const publicSource = pieceById(state, "source");
  assert.equal(publicSource && "color" in publicSource, false);
  assert.equal(JSON.stringify(state).includes(JSON.stringify(secret.identities)), false);
});

test("END-01 将死进入裁决并自动吃掉将军", () => {
  const state = gameState(
    [
      revealed("left-block", "black", "pawn", 3, 0),
      revealed("right-block", "black", "pawn", 5, 0),
      revealed("checker", "red", "rook", 4, 2),
      revealed("protector", "red", "rook", 4, 3),
      revealed("left-guard", "red", "rook", 3, 1),
      revealed("right-guard", "red", "rook", 5, 1),
    ],
    {
      redGeneral: { x: 3, y: 9 },
      blackGeneral: { x: 4, y: 0 },
    },
  );
  const result = applyAuthoritativeMove(
    state,
    secretState(),
    move({ x: 4, y: 2 }, { x: 4, y: 1 }),
  );
  assert.equal(result.state.status, "execution");
  assert.equal(result.state.reason, "checkmate");
  assert.deepEqual(getAutomaticExecutionPlan(result.state), {
    pieceId: "checker",
    from: { x: 4, y: 1 },
    to: { x: 4, y: 0 },
  });
  const execution = applyAutomaticExecution(result.state, result.secret, "judgment");
  assert.equal(execution.state.status, "finished");
  assert.equal(execution.state.reason, "checkmate");
  assert.equal(pieceById(execution.state, "black-general"), undefined);
});

test("END-02 普通将军且对方无合法应对即为将死", () => {
  const state = gameState(
    [
      revealed("left-block", "black", "pawn", 3, 0),
      revealed("right-block", "black", "pawn", 5, 0),
      revealed("checker", "red", "rook", 4, 1),
      revealed("protector", "red", "rook", 4, 2),
      revealed("left-guard", "red", "rook", 3, 1),
      revealed("right-guard", "red", "rook", 5, 1),
    ],
    {
      turn: "black",
      redGeneral: { x: 3, y: 9 },
      blackGeneral: { x: 4, y: 0 },
    },
  );
  assert.equal(isCheckmate(state, "black"), true);
});

test("END-03 未被将军但没有合法棋即为无处可逃", () => {
  const state = gameState(
    [
      revealed("left-control", "red", "rook", 3, 1),
      revealed("right-control", "red", "rook", 5, 1),
    ],
    {
      turn: "black",
      redGeneral: { x: 3, y: 9 },
      blackGeneral: { x: 4, y: 0 },
    },
  );
  assert.equal(isGeneralInCheck(state, "black"), false);
  assert.equal(isStalemate(state, "black"), true);
});

test("END-04 玩家臣服后对方获胜", () => {
  const result = applyResignation(
    gameState(),
    secretState(),
    "red",
    0,
    "resign-1",
  );
  assert.equal(result.state.status, "finished");
  assert.equal(result.state.winner, "black");
  assert.equal(result.state.reason, "resign");
});

function roomFixture(): RoomGame {
  return {
    players: { red: "alice", black: "bob" },
    state: gameState([revealed("source", "red", "rook", 0, 5)]),
    secret: secretState(),
  };
}

test("NET-01 非当前行动方不能提交落子", () => {
  const room = roomFixture();
  assert.throws(
    () =>
      applyRoomMove(
        room,
        "bob",
        move({ x: 0, y: 5 }, { x: 0, y: 4 }),
      ),
    (error) => error instanceof RuleError && error.code === "WRONG_TURN",
  );
});

test("NET-02 非房间玩家不能提交落子", () => {
  const room = roomFixture();
  assert.throws(
    () =>
      applyRoomMove(
        room,
        "mallory",
        move({ x: 0, y: 5 }, { x: 0, y: 4 }),
      ),
    (error) => error instanceof RuleError && error.code === "NOT_PLAYER",
  );
});

test("NET-03 过期棋局版本被拒绝", () => {
  const room = roomFixture();
  assert.throws(
    () =>
      applyRoomMove(
        room,
        "alice",
        move({ x: 0, y: 5 }, { x: 0, y: 4 }, "old", 9),
      ),
    (error) => error instanceof RuleError && error.code === "STALE_REVISION",
  );
});

test("NET-04 同一actionId重复提交不会重复执行", () => {
  const command = move({ x: 0, y: 5 }, { x: 0, y: 4 }, "same-action", 0);
  const first = applyRoomMove(roomFixture(), "alice", command);
  const second = applyRoomMove(first.room, "alice", command);
  assert.equal(first.room.state.revision, 1);
  assert.equal(second.room.state.revision, 1);
  assert.equal(second.duplicate, true);
});

test("NET-05 同一版本的两个操作只有一个成功", () => {
  const firstCommand = move(
    { x: 0, y: 5 },
    { x: 0, y: 4 },
    "concurrent-a",
    0,
  );
  const secondCommand = move(
    { x: 0, y: 5 },
    { x: 0, y: 3 },
    "concurrent-b",
    0,
  );
  const first = applyRoomMove(roomFixture(), "alice", firstCommand);
  assert.throws(
    () => applyRoomMove(first.room, "alice", secondCommand),
    (error) =>
      error instanceof RuleError &&
      ["WRONG_TURN", "STALE_REVISION"].includes(error.code),
  );
  assert.equal(first.room.state.revision, 1);
});

test("NET-06 公开房间序列化后可恢复相同状态", () => {
  const room = roomFixture();
  const serialized = serializePublicRoom(room);
  const restored = JSON.parse(serialized);
  assert.deepEqual(restored, { players: room.players, state: room.state });
});

test("NET-07 所有公开数据都不包含未揭身份", () => {
  const initial = createInitialGame(seededRandomInt(42));
  const room: RoomGame = {
    players: { red: "alice", black: "bob" },
    state: initial.state,
    secret: initial.secret,
  };
  const serialized = serializePublicRoom(room);
  assert.equal(serialized.includes("identities"), false);
  const restored = JSON.parse(serialized);
  for (const piece of restored.state.pieces.filter(
    (item: { faceDown: boolean }) => item.faceDown,
  )) {
    assert.equal("color" in piece, false);
    assert.equal("type" in piece, false);
  }
});
