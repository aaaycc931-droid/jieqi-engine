import assert from "node:assert/strict";
import test from "node:test";
import {
  BluetoothHostRoom, COVERED_SLOTS, RuleError, applyAuthoritativeMove,
  createInitialGame, countPoolByColorAndType, getController, getLegalMoves,
  getPseudoMoves, initializeFeatureGameState, initializeFeatureSecret,
  createRemoteRoom, joinRemoteRoom, playerRoomView, publicRemoteRoom,
  serializePublicRemoteRoom, submitRemoteRps, normalizeGameMode,
  isSquareAttacked,
} from "../src/index.ts";
import { gameState, move, revealed, seededRandomInt } from "./helpers.ts";
import type { GameModeId } from "../src/types.ts";
const errorIs = (code: string) => (error: unknown) => error instanceof RuleError && error.code === code;

test("MODE-01 默认开局仍全局混洗，旧快照缺省模式不变化", () => {
  const implicit = createInitialGame(seededRandomInt(99));
  const explicit = createInitialGame(seededRandomInt(99), "jieqi");
  assert.deepEqual(implicit, explicit); assert.equal("gameMode" in implicit.state, false);
  assert(implicit.state.pieces.some(p => p.faceDown && implicit.secret.identities[p.id].color !== getController(p)));
  assert.equal(normalizeGameMode(undefined), "jieqi");
});

test("MODE-02 半混乱在多种随机洗牌下保持各方完整身份库存", () => {
  const expected = { rook: 2, horse: 2, elephant: 2, advisor: 2, cannon: 2, pawn: 5 };
  let shuffledTypes = false;
  for (let seed = 1; seed <= 24; seed += 1) {
    const { state, secret } = createInitialGame(seededRandomInt(seed), "half_chaos");
    assert.equal(state.gameMode, "half_chaos"); assert.equal(state.pieces.length, 32);
    assert.equal(new Set(state.pieces.map(p => p.id)).size, 32);
    for (const p of state.pieces.filter(p => p.faceDown)) {
      const slot = COVERED_SLOTS.find(s => s.x === p.x && s.y === p.y)!;
      assert.equal(secret.identities[p.id].color, slot.side);
      assert.equal("color" in p, false); assert.equal("type" in p, false);
      shuffledTypes ||= secret.identities[p.id].type !== slot.type;
    }
    const counts = countPoolByColorAndType(Object.values(secret.identities));
    assert.deepEqual(counts.red, expected); assert.deepEqual(counts.black, expected);
  }
  assert(shuffledTypes);
});

test("MODE-03 半混乱实际首步按暗位行动，揭示保留阵营和幂等", () => {
  const session = createInitialGame(seededRandomInt(17), "half_chaos");
  const p = session.state.pieces.find(p => p.x === 0 && p.y === 6)!;
  assert(p.faceDown); assert(getLegalMoves(session.state, p.id).some(to => to.x === 0 && to.y === 5));
  const command = move(p, { x: 0, y: 5 }, "half-first");
  const next = applyAuthoritativeMove(session.state, session.secret, command);
  const revealedPiece = next.state.pieces.find(x => x.id === p.id)!;
  assert.equal(revealedPiece.faceDown, false); assert.equal(getController(revealedPiece), "red");
  assert.deepEqual(next.state.lastMove?.revealed, session.secret.identities[p.id]);
  assert.equal(next.secret.identities[p.id], undefined); assert.equal(next.state.gameMode, "half_chaos");
  assert.equal(next.state.turn, "black");
  const repeated = applyAuthoritativeMove(next.state, next.secret, command);
  assert(repeated.duplicate); assert.deepEqual(repeated.state, next.state); assert.deepEqual(repeated.secret, next.secret);
});

test("MODE-04 普通象棋全明固定布局，开局不消耗随机数或保留暗身份", () => {
  const session = createInitialGame(() => { throw Error("fixed layout must not shuffle"); }, "xiangqi");
  assert.equal(session.state.gameMode, "xiangqi"); assert.equal(session.state.pieces.length, 32);
  assert.deepEqual(session.secret.identities, {}); assert(session.state.pieces.every(p => !p.faceDown));
  for (const slot of COVERED_SLOTS) {
    const p = session.state.pieces.find(p => p.x === slot.x && p.y === slot.y)!;
    assert(!p.faceDown); assert.equal(p.color, slot.side); assert.equal(p.type, slot.type);
  }
});

test("MODE-05 普通象棋实际行棋不揭示，JSON恢复后仍保留区域规则", () => {
  const { state, secret } = createInitialGame(undefined, "xiangqi");
  const next = applyAuthoritativeMove(state, secret, move({ x: 0, y: 6 }, { x: 0, y: 5 }));
  assert.equal(next.state.turn, "black"); assert.equal(next.state.lastMove?.revealed, undefined);
  const restored = JSON.parse(JSON.stringify(next.state)); assert.equal(restored.gameMode, "xiangqi");
  assert(restored.pieces.every((p: {faceDown: boolean}) => !p.faceDown));
  const p = restored.pieces.find((p: {x: number;y: number}) => p.x === 0 && p.y === 3)!;
  assert(getLegalMoves(restored, p.id).some(to => to.x === 0 && to.y === 4));
});

test("MODE-06 普通象棋士限九宫，不改变旧揭棋和半混乱明士", () => {
  const s = gameState([revealed("advisor", "red", "advisor", 3, 7)]);
  assert(getPseudoMoves(s, "advisor").some(p => p.x === 2 && p.y === 6));
  assert(getPseudoMoves({ ...s, gameMode: "half_chaos" }, "advisor").some(p => p.x === 2 && p.y === 6));
  const classic = { ...s, gameMode: "xiangqi" as const };
  assert(!getPseudoMoves(classic, "advisor").some(p => p.x === 2 && p.y === 6));
  assert(getPseudoMoves(classic, "advisor").some(p => p.x === 4 && p.y === 8));
});

test("MODE-07 普通象棋红黑象不过河，象眼与公开攻击判定一致", () => {
  for (const [side, y, targetY] of [["red", 5, 3], ["black", 4, 6]] as const) {
    const s = gameState([revealed("elephant", side, "elephant", 2, y)]);
    assert(getPseudoMoves(s, "elephant").some(p => p.x === 4 && p.y === targetY));
    const classic = { ...s, gameMode: "xiangqi" as const };
    assert(!getPseudoMoves(classic, "elephant").some(p => p.x === 4 && p.y === targetY));
    assert.equal(isSquareAttacked(classic, { x: 4, y: targetY }, side), false);
    const blocked = { ...classic, pieces: [...classic.pieces, revealed("eye", side, "pawn", 3, y + (side === "red" ? 1 : -1))] };
    assert(!getPseudoMoves(blocked, "elephant").some(p => p.x === 4 && p.y === y + (side === "red" ? 2 : -2)));
  }
});

test("MODE-08 普通象棋保留炮架、马腿与兵卒方向且不能吃己方明棋", () => {
  const { state } = createInitialGame(undefined, "xiangqi");
  const cannon = state.pieces.find(p => p.x === 1 && p.y === 7)!;
  assert(getPseudoMoves(state, cannon.id).some(p => p.x === 1 && p.y === 0));
  assert(!getPseudoMoves(state, cannon.id).some(p => p.x === 1 && p.y === 2));
  const rook = state.pieces.find(p => p.x === 0 && p.y === 9)!;
  assert(!getPseudoMoves(state, rook.id).some(p => p.x === 1 && p.y === 9));
  const horseState = { ...gameState([revealed("horse", "red", "horse", 2, 7), revealed("leg", "red", "pawn", 2, 6)]), gameMode: "xiangqi" as const };
  assert(!getPseudoMoves(horseState, "horse").some(p => p.x === 3 && p.y === 5));
  assert.equal(isSquareAttacked(horseState, { x: 3, y: 5 }, "red"), false);
});

test("MODE-09 未知模式不静默降级，创建前拒绝且不使用随机数", () => {
  let calls = 0;
  assert.throws(() => createInitialGame(() => { calls += 1; return 0; }, "bad" as GameModeId), errorIs("INVALID_GAME_MODE"));
  assert.equal(calls, 0);
  assert.throws(() => createRemoteRoom("r", "a", "t", 0, { baseMode: "bad" as GameModeId }), errorIs("INVALID_GAME_MODE"));
});

test("MODE-10 新模式未适配组合拒绝且不改基础棋局、身份或次数", () => {
  for (const mode of ["half_chaos", "xiangqi"] as const) {
    const session = createInitialGame(seededRandomInt(1), mode); const before = structuredClone(session);
    assert.throws(() => initializeFeatureGameState(session.state, { red: "wind" }), errorIs("MODE_ADAPTATION_PENDING"));
    const unadapted = { ...session.state, featureRules: { mutation: "chaos" as const } };
    assert.throws(() => initializeFeatureSecret(unadapted, session.secret, () => 0), errorIs("MODE_ADAPTATION_PENDING"));
    assert.deepEqual(session, before);
    assert.throws(() => createRemoteRoom("r", "a", "t", 0, { baseMode: mode, heroesEnabled: true, mutationsEnabled: true }), errorIs("MODE_ADAPTATION_PENDING"));
  }
});

test("MODE-11 房间基础开局与双方公开/私有快照保存模式，不泄露暗身份", () => {
  for (const mode of ["half_chaos", "xiangqi"] as const) {
    let room = joinRemoteRoom(createRemoteRoom("r", "alice", "token", 0, { baseMode: mode }), "bob", "token", 1).room;
    room = submitRemoteRps(room, "alice", "rock", 1, seededRandomInt(17), 2);
    room = submitRemoteRps(room, "bob", "scissors", 1, seededRandomInt(17), 3);
    assert.equal(room.game?.state.gameMode, mode); assert.equal(publicRemoteRoom(room).mode.baseMode, mode);
    for (const side of ["alice", "bob"]) {
      const view = playerRoomView(room, side); assert.equal(view.state?.gameMode, mode);
      assert.equal(JSON.stringify(view).includes('"identities"'), false);
    }
    assert.equal(serializePublicRemoteRoom(room).includes('"identities"'), false);
    assert.equal(room.game?.state.pieces.filter(p => p.faceDown).length, mode === "xiangqi" ? 0 : 30);
  }
});

test("MODE-12 未适配新模式不会经蓝牙房主接口开放到旧协议", () => {
  for (const baseMode of ["half_chaos", "xiangqi"] as const) {
    assert.throws(() => new BluetoothHostRoom({ roomId: "r", admissionSecret: "t", mode: { baseMode } }), errorIs("MODE_TRANSPORT_PENDING"));
  }
});
