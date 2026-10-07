import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, applyHeroAbility, BLUETOOTH_PROTOCOL_VERSION, clearAllGhostKinds, clearGhostObjects, destroyPiece, destroyPieceBatch, encodeBluetoothEnvelope, finishFormalTurn, generateGhosts, getGhostKind, getGhostObjects, getGhostResourceObjects, initializeFeatureGameState, initializeFeatureSecret, parseBluetoothEnvelope, publicStateSnapshot, putGhostObject, queueLanding, reconcileGhostInfections, settleLandings, tickGhostObjects } from "../src/index.ts";
import type { GhostKind, GhostObjectSpec, Side } from "../src/index.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";

const spec = (kind: GhostKind, owner: Side = "black", remaining = 3, source = `test:${kind}`): GhostObjectSpec => ({ kind, owner, remaining, source, position: { x: 2, y: 3 } });
const code = (expected: string) => (e: unknown) => (e as { code?: string }).code === expected;

test("R4-GHOST-01 两类同格独立保存归属、来源、层数和寿命", () => {
  const s = gameState();
  putGhostObject(s, { ...spec("ghost"), layers: 2 }, "reject");
  putGhostObject(s, { ...spec("inner_ghost", "black", 8), layers: 7 }, "reject");
  putGhostObject(s, spec("inner_ghost", "red", 5), "reject");
  assert.equal(s.ghosts!.length, 3);
  assert.deepEqual(getGhostObjects(s, { kind: "ghost" }), [{ ...spec("ghost"), layers: 2 }]);
  assert.deepEqual(getGhostObjects(s, { kind: "inner_ghost", owner: "black" }), [{ ...spec("inner_ghost", "black", 8), layers: 7 }]);
  assert.equal(getGhostObjects(s, { kind: "inner_ghost", owner: "red" })[0].remaining, 5);
});

test("R4-GHOST-02 普通死亡只刷新普通亡魂，保留共格里亡魂及对方对象", () => {
  const s = initializeFeatureGameState(gameState([revealed("victim", "black", "pawn", 2, 3)]), { black: "death_knight" }), k = secretState();
  putGhostObject(s, spec("ghost", "black", 1), "reject");
  putGhostObject(s, { ...spec("inner_ghost", "black", 7), layers: 4 }, "reject");
  putGhostObject(s, spec("ghost", "red", 2), "reject");
  const independent = structuredClone(s.ghosts!.slice(1));
  destroyPiece(s, k, "victim", "red", "test"); generateGhosts(s);
  assert.deepEqual(s.ghosts!.slice(1), independent);
  assert.deepEqual(s.ghosts![0], spec("ghost", "black", 3, "death_knight:death"));
  s.ghosts![0].remaining = 1; generateGhosts(s);
  assert.equal(s.ghosts![0].remaining, 1);
});

test("R4-GHOST-03 冲突策略由来源指定，同类叠层不能借其他来源或另一类", () => {
  const s = gameState();
  putGhostObject(s, { ...spec("inner_ghost"), layers: 20 }, "reject");
  putGhostObject(s, { ...spec("ghost"), layers: 2 }, "add_layers");
  putGhostObject(s, { ...spec("ghost", "black", 4), layers: 3 }, "add_layers");
  assert.equal(getGhostObjects(s, { kind: "ghost" })[0].layers, 5);
  assert.equal(getGhostObjects(s, { kind: "inner_ghost" })[0].layers, 20);
  const before = structuredClone(s);
  assert.throws(() => putGhostObject(s, spec("ghost"), "reject"), code("GHOST_OBJECT_EXISTS"));
  assert.throws(() => putGhostObject(s, { ...spec("ghost", "black", 2, "different"), layers: 3 }, "add_layers"), code("GHOST_LAYERS_UNDEFINED"));
  assert.throws(() => putGhostObject(s, spec("ghost"), "add_layers"), code("GHOST_LAYERS_UNDEFINED"));
  assert.deepEqual(s, before);
});

test("R4-GHOST-04 无种类旧快照只按普通亡魂兼容，新写入必须明确来源与种类", () => {
  const s = gameState(); s.ghosts = [{ owner: "black", position: { x: 2, y: 3 }, remaining: 2 }];
  assert.equal(getGhostKind(s.ghosts[0]), "ghost");
  assert.equal(getGhostObjects(s, { kind: "ghost" }).length, 1);
  assert.equal(getGhostObjects(s, { kind: "inner_ghost" }).length, 0);
  assert.throws(() => getGhostObjects(s, {} as never), code("GHOST_KIND_REQUIRED"));
  assert.throws(() => putGhostObject(s, { ...spec("ghost"), kind: undefined } as never, "replace"), code("GHOST_KIND_REQUIRED"));
  assert.throws(() => putGhostObject(s, { ...spec("ghost"), source: "" }, "replace"), code("INVALID_GHOST_OBJECT"));
  assert.throws(() => putGhostObject(s, spec("ghost"), undefined as never), code("GHOST_CONFLICT_POLICY"));
  assert.equal(s.ghosts[0].remaining, 2);
});

test("R4-GHOST-05 精确清普通亡魂保留里亡魂和另一归属，里亡魂不维持普通感染", () => {
  const s = gameState([revealed("enemy", "red", "pawn", 2, 3)]);
  for (const g of [spec("ghost"), spec("inner_ghost"), spec("ghost", "red")]) putGhostObject(s, g, "reject");
  s.effectsByPieceId = { enemy: { infection: { owner: "black", stacks: 2 } } };
  assert.equal(clearGhostObjects(s, { kind: "ghost", owner: "black", position: { x: 2, y: 3 } }), 1);
  assert.equal(s.effectsByPieceId.enemy.infection, undefined);
  assert.deepEqual(s.ghosts, [spec("inner_ghost"), spec("ghost", "red")]);
  assert.equal(clearGhostObjects(s, { kind: "ghost", source: "unrelated" }), 0);
});

test("R4-GHOST-06 精确清里亡魂不改普通寿命、层数或现有感染", () => {
  const s = gameState([revealed("enemy", "red", "pawn", 2, 3)]);
  putGhostObject(s, spec("ghost"), "reject"); putGhostObject(s, spec("inner_ghost"), "reject");
  s.effectsByPieceId = { enemy: { infection: { owner: "black", stacks: 2 } } };
  assert.equal(clearGhostObjects(s, { kind: "inner_ghost" }), 1);
  assert.deepEqual(s.ghosts, [spec("ghost")]);
  assert.deepEqual(s.effectsByPieceId.enemy.infection, { owner: "black", stacks: 2 });
});

test("R4-GHOST-07 只有显式所有亡魂类入口清双类，仍尊重归属与棋格过滤", () => {
  const s = gameState();
  for (const kind of ["ghost", "inner_ghost"] as const) {
    putGhostObject(s, spec(kind), "reject"); putGhostObject(s, spec(kind, "red"), "reject");
    putGhostObject(s, { ...spec(kind), position: { x: 4, y: 3 } }, "reject");
  }
  assert.equal(clearAllGhostKinds(s, { owner: "black", position: { x: 2, y: 3 } }), 2);
  assert.equal(s.ghosts!.length, 4);
  assert.equal(clearAllGhostKinds(s), 4);
  assert.deepEqual(s.ghosts, []);
});

test("R4-GHOST-08 普通正式回合末只让普通亡魂感染及减寿，里亡魂无默认时钟", () => {
  const s = initializeFeatureGameState(gameState([revealed("enemy", "red", "pawn", 2, 3)]), { black: "death_knight" });
  putGhostObject(s, spec("ghost"), "reject"); putGhostObject(s, { ...spec("inner_ghost", "black", 9), layers: 5 }, "reject");
  finishFormalTurn(s, secretState(), "black");
  assert.deepEqual(s.effectsByPieceId!.enemy.infection, { owner: "black", stacks: 1 });
  assert.equal(getGhostObjects(s, { kind: "ghost" })[0].remaining, 2);
  assert.deepEqual(getGhostObjects(s, { kind: "inner_ghost" }), [{ ...spec("inner_ghost", "black", 9), layers: 5 }]);
});

test("R4-GHOST-09 只有里亡魂的格不感染、普通到期也不借里亡魂保留感染", () => {
  for (const ordinary of [false, true]) {
    const s = gameState([revealed("enemy", "red", "pawn", 2, 3)]);
    putGhostObject(s, spec("inner_ghost", "black", 9), "reject");
    if (ordinary) putGhostObject(s, spec("ghost", "black", 1), "reject");
    finishFormalTurn(s, secretState(), "black");
    assert.equal(s.effectsByPieceId?.enemy?.infection, undefined);
    assert.equal(getGhostObjects(s, { kind: "inner_ghost" })[0].remaining, 9);
    assert.ok(s.pieces.some(p => p.id === "enemy"));
  }
});

test("R4-GHOST-10 落位到里亡魂格不立即感染，原有普通感染不能跨类维持", () => {
  const s = gameState([revealed("enemy", "red", "pawn", 2, 3)]);
  putGhostObject(s, spec("inner_ghost"), "reject");
  s.effectsByPieceId = { enemy: { infection: { owner: "black", stacks: 2 } } };
  queueLanding(s, s.pieces.find(p => p.id === "enemy")!, "red", "test:placement");
  settleLandings(s, secretState());
  assert.equal(s.effectsByPieceId.enemy.infection, undefined);
  assert.deepEqual(s.ghosts, [spec("inner_ghost")]);
});

test("R4-GHOST-11 来源显式计时仅改点名类、归属和来源，不能替另一类刷新", () => {
  const s = gameState();
  for (const g of [spec("ghost"), spec("inner_ghost", "black", 1), spec("inner_ghost", "red", 5)]) putGhostObject(s, g, "reject");
  tickGhostObjects(s, { kind: "inner_ghost", owner: "black", source: "test:inner_ghost" });
  assert.deepEqual(s.ghosts, [spec("ghost"), spec("inner_ghost", "red", 5)]);
  assert.throws(() => tickGhostObjects(s, { kind: "ghost" } as never), code("GHOST_OWNER_REQUIRED"));
});

test("R4-GHOST-12 资源读取必须指定种类及公开归属，不混层、不奖励且返回副本", () => {
  const s = gameState();
  for (const g of [{ ...spec("ghost"), layers: 2 }, { ...spec("inner_ghost"), layers: 8 }, { ...spec("ghost", "red"), layers: 4 }]) putGhostObject(s, g, "reject");
  const before = structuredClone(s);
  const resource = getGhostResourceObjects(s, { kind: "ghost", owner: "black", source: "test:ghost" });
  assert.deepEqual(resource, [{ ...spec("ghost"), layers: 2 }]);
  resource[0].layers = 100;
  assert.deepEqual(s, before);
  assert.throws(() => getGhostResourceObjects(s, { kind: "ghost" } as never), code("GHOST_OWNER_REQUIRED"));
});

test("R4-GHOST-13 普通棋子进攻与消灭不删除共格亡魂对象，也不把它们当棋子", () => {
  const s = gameState([revealed("mover", "red", "rook", 2, 7), revealed("target", "black", "pawn", 2, 3)]);
  putGhostObject(s, spec("ghost"), "reject"); putGhostObject(s, spec("inner_ghost"), "reject");
  const r = applyAuthoritativeMove(s, secretState(), move({ x: 2, y: 7 }, { x: 2, y: 3 }));
  assert.deepEqual(r.state.ghosts, s.ghosts);
  assert.deepEqual(r.state.captured.map(p => p.id), ["target"]);
  destroyPiece(r.state, r.secret, "mover", "black", "test");
  assert.deepEqual(r.state.ghosts, s.ghosts);
});

test("R4-GHOST-14 开放死亡批次禁止精确读取、清除、生成、资源和计时", () => {
  const s = gameState([revealed("target", "black", "pawn", 2, 3)]), k = secretState();
  putGhostObject(s, spec("inner_ghost"), "reject"); const before = structuredClone(s.ghosts);
  const push = s.captured.push.bind(s.captured); let checks = 0;
  s.captured.push = (...records) => {
    for (const run of [() => getGhostObjects(s, { kind: "inner_ghost" }), () => getGhostResourceObjects(s, { kind: "inner_ghost", owner: "black" }), () => putGhostObject(s, spec("ghost"), "reject"), () => clearGhostObjects(s, { kind: "inner_ghost" }), () => clearAllGhostKinds(s), () => tickGhostObjects(s, { kind: "inner_ghost", owner: "black" }), () => reconcileGhostInfections(s)]) {
      assert.throws(run, code("DESTRUCTION_BATCH_OPEN")); checks++;
    }
    assert.deepEqual(s.ghosts, before); return push(...records);
  };
  destroyPieceBatch(s, k, "batch", "test", [{ pieceId: "target", by: "red", cause: "test" }]); delete s.captured.push;
  assert.equal(checks, 7);
  assert.equal(clearGhostObjects(s, { kind: "inner_ghost" }), 1);
});

test("R4-GHOST-15 标准格亡魂不读河道锚点、飞行棋或隐藏真实阵营", () => {
  const s = gameState([{ ...revealed("river", "red", "pawn", 2, 3), layer: "river", river: { source: "test", spaceId: "r", cellId: "a" } }, { ...revealed("air", "red", "pawn", 2, 3), layer: "air" }]);
  putGhostObject(s, spec("ghost"), "reject");
  assert.throws(() => putGhostObject(s, { ...spec("inner_ghost"), position: { x: 2, y: 3, layer: "river" } } as never, "reject"), code("INVALID_GHOST_OBJECT"));
  finishFormalTurn(s, secretState(), "black");
  assert.equal(s.effectsByPieceId?.river?.infection, undefined); assert.equal(s.effectsByPieceId?.air?.infection, undefined);
  const outputs = [];
  for (const color of ["red", "black"] as const) {
    const c = initializeFeatureGameState(gameState([covered("hidden", 2, 3)]), { red: "death_knight" }, "chaos");
    putGhostObject(c, spec("ghost", "red"), "reject"); putGhostObject(c, spec("inner_ghost", "black", 10), "reject");
    finishFormalTurn(c, secretState({ hidden: { color, type: "rook" } }), "red");
    assert.deepEqual(c.effectsByPieceId!.hidden.infection, { owner: "red", stacks: 1 }); outputs.push(c);
  }
  assert.deepEqual(outputs[0], outputs[1]);
});

test("R4-GHOST-16 公共蓝牙快照保留两类来源层数寿命，旧对象兼容且无秘密字段", () => {
  const s = gameState();
  putGhostObject(s, { ...spec("ghost"), layers: 2 }, "reject"); putGhostObject(s, { ...spec("inner_ghost", "red", 7), layers: 9 }, "reject");
  s.ghosts!.push({ owner: "black", position: { x: 4, y: 3 }, remaining: 1 });
  const raw = encodeBluetoothEnvelope({ v: BLUETOOTH_PROTOCOL_VERSION, type: "snapshot", id: "ghosts", payload: publicStateSnapshot(s) });
  const restored = parseBluetoothEnvelope<typeof s>(raw).payload;
  assert.deepEqual(restored.ghosts, s.ghosts); assert.equal(raw.includes("identities"), false);
  assert.equal(getGhostObjects(restored, { kind: "ghost" }).length, 2);
  clearGhostObjects(restored, { kind: "inner_ghost" }); assert.equal(restored.ghosts!.length, 2);
  assert.equal(s.ghosts!.length, 3);
});

test("R4-GHOST-17 实际回溯恢复两类完整对象及感染，不由另一类推算资源", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7), revealed("reply", "black", "pawn", 4, 3), revealed("enemy", "red", "pawn", 2, 3)]), { red: "nozdormu", black: "death_knight" }), k = secretState();
  putGhostObject(s, spec("ghost", "black", 2), "reject"); putGhostObject(s, { ...spec("inner_ghost", "black", 8), layers: 4 }, "reject");
  s.effectsByPieceId = { enemy: { infection: { owner: "black", stacks: 1 } } };
  s.turnStartedAt = 0; s.turnDeadlineAt = 60_000; initializeFeatureSecret(s, k);
  const before = structuredClone(s);
  const first = applyAuthoritativeMove(s, k, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "first"), false, 55_000);
  const reply = applyAuthoritativeMove(first.state, first.secret, move({ x: 4, y: 3 }, { x: 4, y: 4 }, "reply", first.state.revision), false, 62_000);
  assert.equal(getGhostObjects(reply.state, { kind: "ghost" })[0].remaining, 1);
  assert.equal(reply.state.effectsByPieceId!.enemy.infection!.stacks, 2);
  assert.deepEqual(getGhostObjects(reply.state, { kind: "inner_ghost" }), getGhostObjects(before, { kind: "inner_ghost" }));
  reply.state.turnStartedAt = 63_000; reply.state.turnDeadlineAt = 123_000;
  const rewind = applyHeroAbility(reply.state, reply.secret, { kind: "hero_ability", ability: "rewind", actionId: "rewind", expectedRevision: reply.state.revision }, 64_000);
  assert.deepEqual(rewind.state.ghosts, before.ghosts);
  assert.deepEqual(rewind.state.effectsByPieceId, before.effectsByPieceId);
});
