import assert from "node:assert/strict";
import test from "node:test";
import { BluetoothHostRoom, BLUETOOTH_HOST_PLAYER as host, BLUETOOTH_GUEST_PLAYER as guest } from "../src/bluetooth-host-room.ts";
import { createBluetoothSnapshot, encodeBluetoothEnvelope, parseBluetoothEnvelope } from "../src/bluetooth-protocol.ts";

function preparedRoom() {
  let now = 1_000;
  const room = new BluetoothHostRoom({ roomId: "private-boundaries", admissionSecret: "test-admission", now: () => now, randomInt: () => 0, mode: { heroesEnabled: true, mutationsEnabled: false } });
  room.handle(host, { kind: "hero", hero: "wind" }); room.handle(guest, { kind: "hero", hero: "hunter" });
  room.handle(host, { kind: "rps", choice: "rock", round: 1 }); room.handle(guest, { kind: "rps", choice: "scissors", round: 1 });
  room.handle(host, { kind: "hero_intro_complete" }); room.handle(guest, { kind: "hero_intro_complete" });
  room.handle(guest, { kind: "trap_draft", positions: [{ x: 1, y: 2 }, { x: 2, y: 2 }] });
  room.handle(host, { kind: "preparation_ready" }); room.handle(guest, { kind: "preparation_ready" });
  assert.equal(room.views().publicRoom.phase, "playing");
  return { room, setNow: (n: number) => { now = n; } };
}
const shadow = { kind: "hero_ability" as const, command: { kind: "hero_ability" as const, ability: "shadow" as const, randomCovered: true, actionId: "private-shadow", expectedRevision: 0 } };
const wire = (view: unknown) => parseBluetoothEnvelope(encodeBluetoothEnvelope(createBluetoothSnapshot("view", view))).payload;

test("BT-PRIVATE-01 actual Wind/Hunter setup and shadow change only the owner's serialized view", () => {
  const { room } = preparedRoom(); const before = room.views();
  const after = room.handle(host, shadow);
  assert.deepEqual(after.publicRoom, before.publicRoom); assert.deepEqual(wire(after.guest), wire(before.guest));
  assert.notDeepEqual(after.host.ownHeroSecrets, before.host.ownHeroSecrets);
  assert.equal(after.host.ownTraps, undefined); assert.equal(after.guest.ownTraps?.length, 2);
  const serialized = JSON.stringify(wire(after.guest));
  for (const key of ["identities", "processedActions", "history", "inviteTokenHash", "hostId", "decoyId"]) assert.equal(serialized.includes(`"${key}"`), false, key);
  for (const p of after.guest.state!.pieces.filter(p => p.faceDown)) { assert.equal(p.color, undefined); assert.equal(p.type, undefined); }
  assert.deepEqual(room.handle(host, shadow), after, "duplicate secret command cannot consume another use");
});

test("BT-PRIVATE-02 wrong-turn shadow is rejected without consuming or leaking private state", () => {
  const { room } = preparedRoom();
  room.handle(host, { kind: "move", command: { from: { x: 0, y: 9 }, to: { x: 0, y: 8 }, actionId: "formal", expectedRevision: 0 } });
  const before = room.views();
  assert.throws(() => room.handle(host, shadow), /还没有轮到/);
  assert.deepEqual(room.views(), before);
});

test("BT-PRIVATE-03 reconnect preserves owner-only secrets and shifts the shared deadline once", () => {
  const { room, setNow } = preparedRoom(); const before = room.handle(host, shadow);
  setNow(2_000); room.disconnect(guest); setNow(5_000); const after = room.reconnect(guest);
  assert.deepEqual(after.host.ownHeroSecrets, before.host.ownHeroSecrets);
  assert.deepEqual(after.guest.ownHeroSecrets, before.guest.ownHeroSecrets);
  assert.deepEqual(after.guest.ownTraps, before.guest.ownTraps); assert.equal(after.host.ownTraps, undefined);
  assert.equal(after.publicRoom.state?.turnDeadlineAt, before.publicRoom.state!.turnDeadlineAt! + 3_000);
  assert.deepEqual(wire(after.guest), wire(room.reconnect(guest).guest));
  assert.equal(JSON.stringify(wire(after.guest)).includes('"hostId"'), false);
});
