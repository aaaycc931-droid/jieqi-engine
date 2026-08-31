import assert from "node:assert/strict";
import test from "node:test";

import { RuleError } from "../src/errors.ts";
import {
  BLUETOOTH_MAX_MESSAGE_BYTES,
  BLUETOOTH_PROTOCOL_VERSION,
  createBluetoothSnapshot,
  encodeBluetoothEnvelope,
  parseBluetoothEnvelope,
} from "../src/bluetooth-protocol.ts";

function expectRuleError(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof RuleError && error.code === code);
}

test("BT-01 协议消息可编码并在接收端无损解析", () => {
  const raw = encodeBluetoothEnvelope({
    v: BLUETOOTH_PROTOCOL_VERSION,
    type: "action",
    id: "move-17",
    payload: { expectedRevision: 17, from: { x: 4, y: 9 }, to: { x: 4, y: 8 } },
  });
  assert.deepEqual(parseBluetoothEnvelope(raw), JSON.parse(raw));
});

test("BT-02 错误版本、未知类型与非对象消息在规则层之前被拒绝", () => {
  expectRuleError(() => parseBluetoothEnvelope('{"v":2,"type":"action"}'), "BLUETOOTH_PROTOCOL_MISMATCH");
  expectRuleError(() => parseBluetoothEnvelope('{"v":1,"type":"secret-dump"}'), "INVALID_BLUETOOTH_MESSAGE");
  expectRuleError(() => parseBluetoothEnvelope('[]'), "INVALID_BLUETOOTH_MESSAGE");
});

test("BT-03 超出 RFCOMM 单消息上限的数据不会被编码或接收", () => {
  const oversized = "x".repeat(BLUETOOTH_MAX_MESSAGE_BYTES + 1);
  expectRuleError(() => parseBluetoothEnvelope(oversized), "BLUETOOTH_MESSAGE_TOO_LARGE");
  expectRuleError(() => encodeBluetoothEnvelope({
    v: BLUETOOTH_PROTOCOL_VERSION,
    type: "snapshot",
    id: "too-large",
    payload: oversized,
  }), "BLUETOOTH_MESSAGE_TOO_LARGE");
});

test("BT-04 快照只接收调用方提供的公开视图，并保留幂等 id", () => {
  const snapshot = createBluetoothSnapshot("state-4", {
    revision: 4,
    pieces: [{ id: "hidden-1", faceDown: true }],
  });
  assert.deepEqual(snapshot, {
    v: 1,
    type: "snapshot",
    id: "state-4",
    payload: { revision: 4, pieces: [{ id: "hidden-1", faceDown: true }] },
  });
});
