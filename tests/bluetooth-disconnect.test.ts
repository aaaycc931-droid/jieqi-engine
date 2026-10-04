import assert from "node:assert/strict";
import test from "node:test";

import {
  BluetoothHostRoom,
  BLUETOOTH_GUEST_PLAYER,
  BLUETOOTH_HOST_PLAYER,
} from "../src/bluetooth-host-room.ts";

test("BTDISC-01 断线期间暂停英雄选择倒计时，重连后从原剩余时间继续", () => {
  let now = 1_000;
  const room = new BluetoothHostRoom({
    roomId: "bt-disconnect-pause",
    admissionSecret: "local-link",
    now: () => now,
    randomInt: () => 0,
    mode: { heroesEnabled: true, mutationsEnabled: true },
  });

  const initial = room.views();
  const originalDeadline = initial.publicRoom.features?.heroSelection?.deadlineAt;
  assert.equal(originalDeadline, 61_000);

  now = 11_000;
  room.disconnect(BLUETOOTH_GUEST_PLAYER);
  now = 51_000;
  const paused = room.advance();
  assert.equal(paused.publicRoom.phase, "hero_selection", "normal phase deadlines must not advance while disconnected");
  assert.equal(paused.publicRoom.disconnects?.players[BLUETOOTH_GUEST_PLAYER]?.disconnectedAt, 11_000);

  room.reconnect(BLUETOOTH_GUEST_PLAYER);
  const resumed = room.views();
  assert.equal(
    resumed.publicRoom.features?.heroSelection?.deadlineAt,
    101_000,
    "40 seconds of disconnect pause must be added back to the phase deadline",
  );

  now = 61_000;
  assert.equal(room.advance().publicRoom.phase, "hero_selection", "the old deadline must no longer expire the phase");
});

test("BTDISC-02 同一玩家多次断线累计达到 60 秒后直接判负", () => {
  let now = 1_000;
  const room = new BluetoothHostRoom({
    roomId: "bt-disconnect-cumulative",
    admissionSecret: "local-link",
    now: () => now,
    randomInt: () => 0,
  });
  room.handle(BLUETOOTH_HOST_PLAYER, { kind: "rps", choice: "rock", round: 1 });
  room.handle(BLUETOOTH_GUEST_PLAYER, { kind: "rps", choice: "scissors", round: 1 });

  now = 2_000;
  room.disconnect(BLUETOOTH_GUEST_PLAYER);
  now = 32_000;
  room.reconnect(BLUETOOTH_GUEST_PLAYER);
  assert.equal(
    room.views().publicRoom.disconnects?.players[BLUETOOTH_GUEST_PLAYER]?.accumulatedMs,
    30_000,
  );

  now = 40_000;
  room.disconnect(BLUETOOTH_GUEST_PLAYER);
  now = 70_000;
  const finished = room.advance();
  assert.equal(finished.publicRoom.phase, "finished");
  assert.equal(finished.publicRoom.disconnectOutcome?.winnerPlayerId, BLUETOOTH_HOST_PLAYER);
  assert.deepEqual(finished.publicRoom.disconnectOutcome?.timedOutPlayerIds, [BLUETOOTH_GUEST_PLAYER]);
  assert.equal(finished.publicRoom.state?.status, "finished");
  assert.equal(finished.publicRoom.state?.winner, "red");
  assert.equal(finished.publicRoom.state?.reason, "disconnect");
});

test("BTDISC-03 任一玩家断线后锁定双方全部游戏操作", () => {
  let now = 1_000;
  const room = new BluetoothHostRoom({
    roomId: "bt-disconnect-lock",
    admissionSecret: "local-link",
    now: () => now,
    randomInt: () => 0,
    mode: { heroesEnabled: true },
  });

  now = 2_000;
  room.disconnect(BLUETOOTH_GUEST_PLAYER);
  assert.throws(
    () => room.handle(BLUETOOTH_HOST_PLAYER, { kind: "hero", hero: "hunter" }),
    /断线|重连|连接/,
  );
});

test("BTDISC-04 双方在同一检查点均累计达到 60 秒时判为断线平局", () => {
  let now = 1_000;
  const room = new BluetoothHostRoom({
    roomId: "bt-disconnect-draw",
    admissionSecret: "local-link",
    now: () => now,
    randomInt: () => 0,
  });
  room.handle(BLUETOOTH_HOST_PLAYER, { kind: "rps", choice: "rock", round: 1 });
  room.handle(BLUETOOTH_GUEST_PLAYER, { kind: "rps", choice: "scissors", round: 1 });

  now = 2_000;
  room.disconnect(BLUETOOTH_HOST_PLAYER);
  room.disconnect(BLUETOOTH_GUEST_PLAYER);
  now = 62_000;
  const finished = room.advance();

  assert.equal(finished.publicRoom.phase, "finished");
  assert.equal(finished.publicRoom.disconnectOutcome?.winnerPlayerId, undefined);
  assert.deepEqual(
    [...(finished.publicRoom.disconnectOutcome?.timedOutPlayerIds ?? [])].sort(),
    [BLUETOOTH_GUEST_PLAYER, BLUETOOTH_HOST_PLAYER].sort(),
  );
  assert.equal(finished.publicRoom.state?.status, "finished");
  assert.equal(finished.publicRoom.state?.winner, undefined);
  assert.equal(finished.publicRoom.state?.drawReason, "disconnect_timeout");
});

test("BTDISC-05 成功重连会永久保留累计断线时间并增加重连历史计数", () => {
  let now = 1_000;
  const room = new BluetoothHostRoom({
    roomId: "bt-disconnect-history",
    admissionSecret: "local-link",
    now: () => now,
    randomInt: () => 0,
  });

  now = 6_000;
  room.disconnect(BLUETOOTH_HOST_PLAYER);
  now = 16_000;
  room.reconnect(BLUETOOTH_HOST_PLAYER);
  const first = room.views().publicRoom.disconnects?.players[BLUETOOTH_HOST_PLAYER];
  assert.equal(first?.accumulatedMs, 10_000);
  assert.equal(first?.reconnectCount, 1);
  assert.equal(first?.disconnectedAt, undefined);

  now = 20_000;
  room.disconnect(BLUETOOTH_HOST_PLAYER);
  now = 25_000;
  room.reconnect(BLUETOOTH_HOST_PLAYER);
  const second = room.views().publicRoom.disconnects?.players[BLUETOOTH_HOST_PLAYER];
  assert.equal(second?.accumulatedMs, 15_000);
  assert.equal(second?.reconnectCount, 2);
});


test("BTDISC-06 延迟检查时按实际到达 60 秒的先后裁定，不把错开的超时误判为平局", () => {
  let now = 1_000;
  const room = new BluetoothHostRoom({
    roomId: "bt-disconnect-staggered",
    admissionSecret: "local-link",
    now: () => now,
    randomInt: () => 0,
  });
  room.handle(BLUETOOTH_HOST_PLAYER, { kind: "rps", choice: "rock", round: 1 });
  room.handle(BLUETOOTH_GUEST_PLAYER, { kind: "rps", choice: "scissors", round: 1 });

  now = 2_000;
  room.disconnect(BLUETOOTH_HOST_PLAYER);
  now = 12_000;
  room.disconnect(BLUETOOTH_GUEST_PLAYER);

  now = 72_000;
  const finished = room.advance();
  assert.equal(finished.publicRoom.phase, "finished");
  assert.deepEqual(finished.publicRoom.disconnectOutcome?.timedOutPlayerIds, [BLUETOOTH_HOST_PLAYER]);
  assert.equal(finished.publicRoom.disconnectOutcome?.winnerPlayerId, BLUETOOTH_GUEST_PLAYER);
  assert.equal(finished.publicRoom.state?.winner, "black");
  assert.equal(finished.publicRoom.state?.reason, "disconnect");
});
