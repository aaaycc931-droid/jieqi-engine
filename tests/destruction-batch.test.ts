import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, applyHeroAbility, advanceToFormalTurn, closeDirectDeaths, destroyPiece, destroyPieceBatch, finishFormalTurn, generateGhosts, initializeFeatureGameState, initializeFeatureSecret, relocatePiece, resolveWindReturn, settleLandings } from "../src/index.ts";
import type { DestructionTarget } from "../src/index.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";
const targets = (...ids: string[]): DestructionTarget[] => ids.map(pieceId => ({ pieceId, by: "red", cause: "test_simultaneous" }));
const openError = (e: unknown) => (e as { code?: string }).code === "DESTRUCTION_BATCH_OPEN";

test("R4-BATCH-01 整批死亡揭示和记录闭合后才生成亡魂，重读不刷新旧死亡", () => {
  const s = initializeFeatureGameState(gameState([covered("a", 0, 3), covered("b", 2, 3)]), { black: "death_knight" });
  const k = secretState({ a: { color: "red", type: "horse" }, b: { color: "black", type: "rook" } });
  const b = destroyPieceBatch(s, k, "batch", "confirmed:simultaneous", targets("a", "b"));
  assert.deepEqual(b.destroyedIds, ["a", "b"]);
  assert.equal(b.phase, "closed");
  assert.equal(s.pieces.some(p => p.id === "a" || p.id === "b"), false);
  assert.deepEqual(k.identities, {});
  assert.deepEqual(s.captured.map(p => p.type), ["horse", "rook"]);
  assert.equal(s.ghosts?.length ?? 0, 0);
  assert.ok(s.automaticEvents!.every(e => e.batchId === "batch"));
  generateGhosts(s);
  assert.deepEqual(s.ghosts?.map(g => g.position), [{ x: 0, y: 3 }, { x: 2, y: 3 }]);
  s.ghosts![0].remaining = 1;
  generateGhosts(s);
  assert.equal(s.ghosts![0].remaining, 1);
});

test("R4-BATCH-02 开放批次屏障禁止提前亡魂、召回、落位、回合末或终局", () => {
  const s = initializeFeatureGameState(gameState([revealed("a", "black", "pawn", 0, 3), revealed("b", "black", "pawn", 2, 3)]), { black: "death_knight" });
  const k = secretState();
  let observations = 0;
  const push = s.captured.push.bind(s.captured);
  s.captured.push = (...records) => {
    observations++;
    for (const run of [() => generateGhosts(s), () => resolveWindReturn(s, k), () => settleLandings(s, k), () => closeDirectDeaths(s, k, "red"), () => finishFormalTurn(s, k, "red"), () => advanceToFormalTurn(s, k, "black"), () => relocatePiece(s, k, "red-general", { x: 4, y: 9 }, "return")]) assert.throws(run, openError);
    assert.throws(() => destroyPieceBatch(s, k, "nested", "test", []), openError);
    assert.throws(() => destroyPiece(s, k, "red-general", "red", "test_simultaneous"), e => e.code === "UNCOMMITTED_BATCH_TARGET");
    assert.equal(s.destructionBatches?.length ?? 0, 0);
    return push(...records);
  };
  destroyPieceBatch(s, k, "batch", "test", targets("a", "b"));
  delete s.captured.push;
  assert.equal(observations, 2);
  assert.equal(s.destructionBatches?.length, 1);
  assert.doesNotThrow(() => generateGhosts(s));
});

test("R4-BATCH-03 冻结目标不受中途外部列表追加影响，闭合后移入与复活不倒流", () => {
  const s = gameState([revealed("a", "black", "pawn", 0, 3), revealed("b", "black", "pawn", 2, 3), revealed("late", "black", "rook", 8, 3)]);
  const k = secretState(), locked = targets("a", "b"), original = structuredClone(locked);
  const push = s.captured.push.bind(s.captured);
  s.captured.push = (...records) => { locked.push(...targets("late")); return push(...records); };
  const batch = destroyPieceBatch(s, k, "batch", "test", locked);
  delete s.captured.push;
  assert.deepEqual(batch.targetIds, ["a", "b"]);
  assert.ok(relocatePiece(s, k, "late", { x: 0, y: 3 }, "post_batch_return"));
  s.pieces.push(revealed("a", "black", "pawn", 2, 3));
  assert.deepEqual(destroyPieceBatch(s, k, "batch", "test", original), batch);
  assert.ok(s.pieces.some(p => p.id === "late" && p.x === 0));
  assert.ok(s.pieces.some(p => p.id === "a"));
  assert.equal(s.captured.length, 2);
  // 明确的下一次来源可另开新批，不自动再次扫描。
  assert.deepEqual(destroyPieceBatch(s, k, "next", "test", targets("a")).destroyedIds, ["a"]);
});

test("R4-BATCH-04 批次死亡缺失秘密身份时预检失败，不留下半批死亡", () => {
  const s = gameState([revealed("a", "black", "pawn", 0, 3), covered("missing", 2, 3)]), k = secretState();
  const before = structuredClone({ s, k });
  assert.throws(() => destroyPieceBatch(s, k, "batch", "test", targets("a", "missing")), e => e.code === "MISSING_SECRET");
  assert.deepEqual({ s, k }, before);
  k.identities.missing = { color: "black", type: "horse" };
  assert.equal(destroyPieceBatch(s, k, "batch", "test", targets("a", "missing")).destroyedIds.length, 2);
});

test("R4-BATCH-05 重复目标与批次ID冲突拒绝，空批和已死目标可闭合", () => {
  const s = gameState([revealed("a", "black", "pawn", 0, 3)]), k = secretState();
  assert.throws(() => destroyPieceBatch(s, k, "bad", "test", targets("a", "a")), e => e.code === "DUPLICATE_BATCH_TARGET");
  destroyPieceBatch(s, k, "batch", "test", targets("a"));
  assert.throws(() => destroyPieceBatch(s, k, "batch", "test", [{ pieceId: "a", by: "black", cause: "test_simultaneous" }]), e => e.code === "BATCH_ID_CONFLICT");
  assert.deepEqual(destroyPieceBatch(s, k, "empty", "test", []).destroyedIds, []);
  assert.deepEqual(destroyPieceBatch(s, k, "dead", "test", targets("a")).destroyedIds, []);
});

test("R4-BATCH-06 同批双方真将帅死亡按闭合后两败俱伤，不抢先单方获胜", () => {
  for (const ids of [["red-general", "black-general"], ["black-general", "red-general"]]) {
    const s = gameState(), k = secretState(); initializeFeatureSecret(s, k);
    destroyPieceBatch(s, k, "generals", "test", targets(...ids));
    assert.equal(s.status, "playing");
    assert.equal(closeDirectDeaths(s, k, "red"), true);
    assert.equal(s.drawReason, "mutual_destruction");
    assert.equal(s.winner, undefined);
  }
});

test("R4-BATCH-07 风影武者与承载者同批死亡不能提前召回，存活承载者批后才归位", () => {
  for (const killHost of [true, false]) {
    const s = initializeFeatureGameState(gameState([revealed("host", "red", "rook", 0, 7)]), { red: "wind" });
    const k = secretState(); initializeFeatureSecret(s, k); k.wind!.red!.hostId = "host";
    destroyPieceBatch(s, k, "wind", "test", targets("red-general", ...(killHost ? ["host"] : [])));
    assert.equal(resolveWindReturn(s, k), !killHost);
    assert.equal(closeDirectDeaths(s, k, "black"), killHost);
    if (killHost) assert.equal(s.winner, "black");
    else assert.ok(s.pieces.some(p => p.id === "host" && !p.faceDown && p.type === "general" && p.x === 3 && p.y === 9));
  }
});

test("R4-BATCH-08 混乱批次死亡只公开兵种，亡魂按死亡时公开控制方生成", () => {
  const results = [];
  for (const color of ["red", "black"] as const) {
    const s = initializeFeatureGameState(gameState([covered("hidden", 0, 3)]), { black: "death_knight" }, "chaos");
    const k = secretState({ hidden: { color, type: "rook" } });
    destroyPieceBatch(s, k, "batch", "test", targets("hidden")); generateGhosts(s);
    assert.equal(s.captured[0].secretColorWithheld, true);
    assert.equal(s.captured[0].color, "black");
    assert.equal(s.ghosts![0].owner, "black");
    results.push(s);
  }
  assert.deepEqual(results[0], results[1]);
});

test("R4-BATCH-09 批次不先驱散、保留碾碎免疫和非地面资格", () => {
  const s = gameState([revealed("immune", "black", "pawn", 0, 3), { ...revealed("air", "black", "rook", 2, 3), layer: "air" }, revealed("plain", "black", "pawn", 4, 3)]), k = secretState();
  s.effectsByPieceId = { immune: { immuneCrush: true, intangible: true }, plain: { intangible: true } };
  const b = destroyPieceBatch(s, k, "crush", "test", ["immune", "air", "plain"].map(pieceId => ({ pieceId, by: "red", cause: "crush" })));
  assert.deepEqual(b.destroyedIds, ["plain"]);
  assert.equal(s.effectsByPieceId.immune.intangible, true);
  assert.ok(s.pieces.some(p => p.id === "air"));
});

test("R4-BATCH-10 毁灭先完成锁定集合独立判定，再闭合成功结果与亡魂", () => {
  const s = initializeFeatureGameState(gameState([covered("hidden", 0, 3), revealed("keep", "black", "horse", 1, 2), revealed("die", "black", "rook", 2, 3)]), { red: "deathwing", black: "death_knight" });
  const k = secretState({ hidden: { color: "red", type: "pawn" } }); let rolls = 0;
  const command = { kind: "hero_ability" as const, ability: "destruction" as const, expectedRevision: 0, actionId: "destroy" };
  const r = applyHeroAbility(s, k, command, 100, max => { assert.equal(max, 2); assert.equal(s.captured.length, 0); return [0, 1, 0][rolls++]; });
  assert.equal(rolls, 3);
  assert.deepEqual(r.state.destructionBatches![0].targetIds, ["hidden", "die"]);
  assert.equal(r.state.destructionBatches![0].source, "deathwing:destruction");
  assert.deepEqual(r.state.captured.map(p => p.id), ["hidden", "die"]);
  assert.equal(r.state.ghosts?.length, 2);
  assert.ok(r.state.pieces.some(p => p.id === "keep"));
  assert.ok(r.state.pieces.some(p => p.id === "red-general"));
  assert.ok(r.state.pieces.some(p => p.id === "black-general"));
  assert.equal(r.state.formalTurns?.red, 1);
  assert.deepEqual(applyHeroAbility(r.state, r.secret, command, 200), { ...r, duplicate: true });
});

test("R4-BATCH-11 同ID复活后新死亡独立派生，不借旧将帅记录判断新兵种", () => {
  const s = initializeFeatureGameState(gameState([revealed("reuse", "black", "general", 0, 3)]), { black: "death_knight" }), k = secretState();
  destroyPiece(s, k, "reuse", "red", "test"); generateGhosts(s);
  assert.equal(s.ghosts?.length ?? 0, 0);
  s.pieces.push(revealed("reuse", "black", "pawn", 0, 3));
  destroyPiece(s, k, "reuse", "red", "test"); generateGhosts(s);
  assert.equal(s.ghosts?.length, 1);
  s.ghosts![0].remaining = 1;
  generateGhosts(s); assert.equal(s.ghosts![0].remaining, 1);
});

test("R4-BATCH-12 普通进攻仍按来源顺序结算，不自动套用同批消灭", () => {
  const s = gameState([revealed("mover", "red", "rook", 0, 7), revealed("target", "black", "pawn", 0, 6)]);
  const r = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }));
  assert.deepEqual(r.state.destructionBatches, []);
  assert.equal(r.state.captured[0].cause, "attack");
  assert.equal(r.state.automaticEvents!.find(e => e.kind === "destroy:attack")!.batchId, undefined);
});

test("R4-BATCH-13 公共蓝牙快照保留闭合与消费标记，恢复不重触发或泄露秘密", async () => {
  const { BLUETOOTH_PROTOCOL_VERSION, encodeBluetoothEnvelope, parseBluetoothEnvelope, publicStateSnapshot } = await import("../src/index.ts");
  const s = initializeFeatureGameState(gameState([covered("hidden", 0, 3)]), { black: "death_knight" }, "chaos");
  const k = secretState({ hidden: { color: "red", type: "rook" } });
  destroyPieceBatch(s, k, "batch", "test", targets("hidden")); generateGhosts(s);
  s.ghosts![0].remaining = 1;
  const raw = encodeBluetoothEnvelope({ v: BLUETOOTH_PROTOCOL_VERSION, type: "snapshot", id: "closed", payload: publicStateSnapshot(s) });
  const restored = parseBluetoothEnvelope<typeof s>(raw).payload;
  assert.deepEqual(restored, publicStateSnapshot(s));
  assert.equal(raw.includes('"identities"'), false);
  assert.equal(raw.includes('"color":"red","type":"rook"'), false);
  generateGhosts(restored);
  assert.equal(restored.ghosts![0].remaining, 1);
  assert.deepEqual(destroyPieceBatch(restored, k, "batch", "test", targets("hidden")), s.destructionBatches![0]);
  assert.equal(restored.captured.length, 1);
});
