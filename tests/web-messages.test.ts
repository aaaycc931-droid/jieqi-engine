import assert from "node:assert/strict";
import test from "node:test";

import { trapTriggerAnnouncement } from "../web/messages.ts";

test("UI-TRAP-01 普通棋子踩中陷阱只播报击杀，不错误宣告胜利", () => {
  const message = trapTriggerAnnouncement("black", false);

  assert.equal(message, "猎物已踏入陷阱！该棋子已被击杀。");
  assert.equal(message.includes("获得胜利"), false);
});

test("UI-TRAP-02 将帅踩中陷阱仍播报伏击胜利", () => {
  assert.equal(
    trapTriggerAnnouncement("red", true),
    "猎物已踏入陷阱！伏击触发，红方获得胜利。",
  );
});
