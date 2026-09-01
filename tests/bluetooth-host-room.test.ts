import assert from "node:assert/strict";
import test from "node:test";

import { BluetoothHostRoom, BLUETOOTH_GUEST_PLAYER, BLUETOOTH_HOST_PLAYER } from "../src/bluetooth-host-room.ts";
import { sha256Hex } from "../src/sha256.ts";

test("BTHOST-01 SHA-256 邀请口令哈希在 Node 与 WebView 使用相同标准结果", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex("揭棋"), "34ab6ec8a545f6dfd76d6cbdb4ae0a2882058d35044f4d2960ca074af125335d");
});

test("BTHOST-02 物理连接后只有房主保存完整房间，来宾只收到公开 RPS 状态", () => {
  const room = new BluetoothHostRoom({ roomId: "bt-room", admissionSecret: "local-link", now: () => 100 });
  const before = room.views();
  assert.equal(before.publicRoom.phase, "rps");
  assert.deepEqual(before.guest.rps?.submitted, { [BLUETOOTH_HOST_PLAYER]: false, [BLUETOOTH_GUEST_PLAYER]: false });

  const afterHostChoice = room.handle(BLUETOOTH_HOST_PLAYER, { kind: "rps", choice: "rock", round: 1 });
  assert.equal(afterHostChoice.guest.rps?.submitted[BLUETOOTH_HOST_PLAYER], true);
  assert.equal("choices" in (afterHostChoice.guest.rps ?? {}), false);
});

test("BTHOST-03 双方猜拳后由房主权威建局，并向来宾发送揭示后仍安全的公开棋盘", () => {
  let tick = 0;
  const room = new BluetoothHostRoom({ roomId: "bt-game", admissionSecret: "local-link", now: () => ++tick, randomInt: () => 0 });
  room.handle(BLUETOOTH_HOST_PLAYER, { kind: "rps", choice: "rock", round: 1 });
  const views = room.handle(BLUETOOTH_GUEST_PLAYER, { kind: "rps", choice: "scissors", round: 1 });
  assert.equal(views.publicRoom.phase, "playing");
  assert.equal(views.guest.viewerSide, "black");
  const hidden = views.guest.state!.pieces.find((piece) => piece.faceDown)!;
  assert.equal(hidden.color, undefined);
  assert.equal(hidden.type, undefined);
});

test("BTHOST-04 英雄、陷阱和私有坐标均通过房主单点结算", () => {
  let tick = 0;
  const room = new BluetoothHostRoom({
    roomId: "bt-heroes",
    admissionSecret: "local-link",
    now: () => ++tick,
    randomInt: () => 0,
    mode: { heroesEnabled: true, mutationsEnabled: true },
  });
  room.handle(BLUETOOTH_HOST_PLAYER, { kind: "rps", choice: "rock", round: 1 });
  room.handle(BLUETOOTH_GUEST_PLAYER, { kind: "rps", choice: "scissors", round: 1 });
  let views = room.views();
  assert.equal(views.publicRoom.phase, "hero_selection");
  assert.equal(views.guest.ownHeroChoice, undefined);

  room.handle(BLUETOOTH_HOST_PLAYER, { kind: "hero", hero: "hunter" });
  views = room.views();
  assert.equal(views.guest.ownHeroChoice, undefined, "guest cannot learn host hero early");
  views = room.handle(BLUETOOTH_GUEST_PLAYER, { kind: "hero", hero: "hunter" });
  assert.equal(views.publicRoom.phase, "trap_setup");
  assert.equal(views.publicRoom.features?.mutation, "iron_steed");

  room.handle(BLUETOOTH_HOST_PLAYER, { kind: "traps", positions: [{ x: 0, y: 5 }, { x: 0, y: 5 }] });
  views = room.views();
  assert.equal(views.guest.ownTraps?.length, 0, "guest cannot receive host trap coordinates");
  views = room.handle(BLUETOOTH_GUEST_PLAYER, { kind: "traps", positions: [{ x: 0, y: 0 }, { x: 0, y: 0 }] });
  assert.equal(views.publicRoom.phase, "playing");
  assert.equal(views.host.ownTraps?.length, 2);
  assert.equal(views.guest.ownTraps?.length, 2);

  views = room.handle(BLUETOOTH_HOST_PLAYER, {
    kind: "move",
    command: { from: { x: 0, y: 9 }, to: { x: 0, y: 8 }, expectedRevision: 0, actionId: "host-first-move" },
  });
  assert.equal(views.publicRoom.state?.revision, 1, "a complete Bluetooth room progresses into authoritative play");
});

test("BTHOST-05 来宾操作仍受回合、版本和房主规则引擎约束", () => {
  let tick = 0;
  const room = new BluetoothHostRoom({ roomId: "bt-turn", admissionSecret: "local-link", now: () => ++tick, randomInt: () => 0 });
  room.handle(BLUETOOTH_HOST_PLAYER, { kind: "rps", choice: "rock", round: 1 });
  room.handle(BLUETOOTH_GUEST_PLAYER, { kind: "rps", choice: "scissors", round: 1 });
  assert.throws(() => room.handle(BLUETOOTH_GUEST_PLAYER, {
    kind: "move",
    command: { from: { x: 0, y: 0 }, to: { x: 0, y: 1 }, expectedRevision: 0, actionId: "guest-too-early" },
  }), /还没有轮到/);
});
