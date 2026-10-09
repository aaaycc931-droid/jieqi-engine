import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { applyAuthoritativeMove, applyHeroAbility, beginFormalTurn, COVERED_SLOTS, destroyPiece, effectiveIdentity, finishFormalTurn, generateGhosts, getBombers, getController, getGhostResourceObjects, getLegalAssassinationMoves, getLegalMoves, getShadowRevealedTargets, initializeFeatureGameState, initializeFeatureSecret, isGeneralInCheck, markRevealed, ownerHeroSecrets, playerRoomView, publicRemoteRoom, putGhostObject, relocatePiece, serializePublicRemoteRoom, validatePublicMove } from "../src/index.ts";
import type { GameState, HeroAbilityCommand, RemoteRoom, SecretState, Side } from "../src/index.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";

const errorCode = (code: string) => (e: unknown) => (e as { code?: string }).code === code;
const ability = (state: GameState, name: HeroAbilityCommand["ability"], extra: Partial<HeroAbilityCommand> = {}): HeroAbilityCommand => ({ kind: "hero_ability", ability: name, expectedRevision: state.revision, actionId: `control:${name}`, ...extra });
function roomWith(s: GameState, k: SecretState): RemoteRoom {
  return { roomId: "current-control", phase: "playing", updatedAt: 100, seats: { host: { playerId: "alice", connectedAt: 0, lastSeenAt: 0 }, guest: { playerId: "bob", connectedAt: 0, lastSeenAt: 0 } }, mode: { heroesEnabled: true, mutationsEnabled: true }, game: { players: { red: "alice", black: "bob" }, state: s, secret: k }, features: s.featureRules, featureSecret: { traps: [] } } as RemoteRoom;
}

test("R4-CONTROL-01 暗棋当前位置决定控制方，原始/混乱秘密阵营不参与", () => {
  for (const slot of COVERED_SLOTS) {
    const p = covered("covered", slot.x, slot.y);
    assert.equal(getController(p), slot.side);
    // 公共入口不接受秘密状态；非法附加字段也不能成为身份兜底。
    assert.equal(getController({ ...p, color: slot.side === "red" ? "black" : "red" } as never), slot.side);
  }
  const p = covered("moved", 0, 6); assert.equal(getController(p), "red");
  p.y = 3; assert.equal(getController(p), "black");
  assert.equal(getController(revealed("shown", "red", "rook", 0, 3)), "red");
});

test("R4-CONTROL-02 普通及强击目标提示、非法来源错误不以秘密阵营变化", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7), covered("target", 0, 3)]), { red: "rogue" }, "chaos");
  const strike = structuredClone(s);
  strike.assassination!.red.activePieceId = "mover";
  strike.effectsByPieceId = { mover: { stealth: { owner: "red", source: "hero", remainingOwnerTurns: 1, strongStrikeAvailable: true } } };
  const results = [];
  for (const color of ["red", "black"] as const) {
    const k = secretState({ target: { color, type: "horse" } });
    const hints = { ordinary: getLegalMoves(s, "mover"), strike: getLegalAssassinationMoves(strike, "mover", true), check: isGeneralInCheck(s, "red"), wrong: validatePublicMove(s, { from: { x: 0, y: 3 }, to: { x: 0, y: 4 } }) };
    let failure;
    try { applyAuthoritativeMove(s, k, move({ x: 0, y: 3 }, { x: 0, y: 4 })); } catch (e) { failure = { code: e.code, message: e.message }; }
    assert.equal(hints.wrong.code, "NOT_CONTROLLED");
    results.push({ hints, failure }); assert.deepEqual(k.identities.target, { color, type: "horse" });
  }
  assert.deepEqual(results[0], results[1]);
  assert.ok(results[0].hints.ordinary.some(p => p.x === 0 && p.y === 3));
  assert.ok(results[0].hints.strike.some(p => p.x === 0 && p.y === 3));
});

test("R4-CONTROL-03 普通进攻的公开死亡记录按当前控制方，秘密阵营不泄露", () => {
  const outputs = [];
  for (const color of ["red", "black"] as const) {
    const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7), covered("target", 0, 3)]), { black: "death_knight" }, "chaos"), k = secretState({ target: { color, type: "horse" } });
    initializeFeatureSecret(s, k); beginFormalTurn(s, k, () => color === "red" ? 0 : 1);
    const r = applyAuthoritativeMove(s, k, move({ x: 0, y: 7 }, { x: 0, y: 3 }), false, 100);
    assert.equal(r.state.captured[0].color, "black"); assert.equal(r.state.captured[0].secretColorWithheld, true);
    assert.equal(r.state.ghosts![0].owner, "black"); outputs.push(r.state);
  }
  assert.deepEqual(outputs[0], outputs[1]);
});

test("R4-CONTROL-04 落位陷阱明确读取进入前和揭示后的控制方", () => {
  for (const owner of ["red", "black"] as const) {
    const s = gameState([covered("mover", 0, 6)]), k = secretState({ mover: { color: "black", type: "rook" } });
    k.traps = [{ id: "trap", owner, position: { x: 0, y: 5 }, opponentTurnsRemaining: 10 }];
    const r = applyAuthoritativeMove(s, k, move({ x: 0, y: 6 }, { x: 0, y: 5 }));
    assert.equal(getController(r.state.pieces.find(p => p.id === "mover")!), "black");
    assert.equal(r.secret.traps!.length, 1); assert.equal(r.state.captured.length, 0);
  }
  // 这是公开揭示后的合法控制变化，不要求揭示后效果对真实阵营不变。
});

test("R4-CONTROL-05 暗置移置后落位重新读取当前控制，不沿用旧棋位或秘密色", () => {
  const outcomes = [];
  for (const color of ["red", "black"] as const) {
    const s = gameState([covered("mover", 0, 6)]), k = secretState({ mover: { color, type: "rook" } });
    k.traps = [{ id: "trap", owner: "black", position: { x: 0, y: 3 }, opponentTurnsRemaining: 10 }];
    assert.equal(relocatePiece(s, k, "mover", { x: 0, y: 3 }, "test:source_defined_dark_placement"), true);
    assert.equal(getController(s.pieces.find(p => p.id === "mover")!), "black");
    assert.equal(k.traps.length, 1); assert.equal(s.pieces.find(p => p.id === "mover")!.faceDown, true); outcomes.push(s);
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test("R4-CONTROL-06 亡魂归属冻结死亡时控制，后续派生不重读秘密", () => {
  const outcomes = [];
  for (const color of ["red", "black"] as const) {
    const s = initializeFeatureGameState(gameState([covered("victim", 0, 6)]), { red: "death_knight" }, "chaos"), k = secretState({ victim: { color, type: "horse" } });
    destroyPiece(s, k, "victim", "black", "test");
    Object.defineProperty(k, "identities", { get() { throw Error("死亡闭合后不得读取秘密"); } });
    generateGhosts(s);
    assert.equal(s.automaticEvents![0].side, "red"); assert.equal(s.ghosts![0].owner, "red"); outcomes.push(s);
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test("R4-CONTROL-07 普通感染按地面棋当前控制，秘密同色不提供免疫", () => {
  for (const owner of ["red", "black"] as const) {
    const outcomes = [];
    for (const color of ["red", "black"] as const) {
      const s = initializeFeatureGameState(gameState([covered("target", 0, 6)]), { [owner]: "death_knight" }, "chaos");
      putGhostObject(s, { kind: "ghost", owner, source: "test", position: { x: 0, y: 6 }, remaining: 3 }, "reject");
      finishFormalTurn(s, secretState({ target: { color, type: "horse" } }), owner);
      assert.equal(s.effectsByPieceId?.target?.infection?.stacks, owner === "black" ? 1 : undefined); outcomes.push(s);
    }
    assert.deepEqual(outcomes[0], outcomes[1]);
  }
});

test("R4-CONTROL-08 持续计时读取当前控制方，飞行与死亡归属不偷读秘密", () => {
  const outcomes = [];
  for (const color of ["red", "black"] as const) {
    const s = initializeFeatureGameState(gameState([{ ...covered("air", 0, 6), layer: "air" }, covered("collapse", 2, 6)]), { red: "hunter" }, "chaos");
    s.effectsByPieceId = { air: { flight: { remainingOwnerTurns: 3 } }, collapse: { timeCollapse: { expiresAtOwnerTurnEnd: 1 } } };
    finishFormalTurn(s, secretState({ air: { color, type: "rook" }, collapse: { color, type: "horse" } }), "red");
    assert.equal(s.effectsByPieceId.air.flight!.remainingOwnerTurns, 2); assert.equal(s.captured[0].color, "red");
    assert.equal(s.captured[0].secretColorWithheld, true); outcomes.push(s);
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test("R4-CONTROL-09 资源和房间/双方私有视图对未授权秘密阵营编码一致", () => {
  const s = initializeFeatureGameState(gameState([covered("hidden", 0, 6)]), { red: "hunter", black: "death_knight" }, "chaos");
  putGhostObject(s, { kind: "ghost", owner: "black", source: "test", position: { x: 0, y: 6 }, remaining: 3 }, "reject");
  const outcomes = [];
  for (const color of ["red", "black"] as const) {
    const k = secretState({ hidden: { color, type: "rook" } }); const room = roomWith(s, k);
    outcomes.push({ public: serializePublicRemoteRoom(room), red: JSON.stringify(playerRoomView(room, "alice")), black: JSON.stringify(playerRoomView(room, "bob")), resource: getGhostResourceObjects(s, { kind: "ghost", owner: "black" }) });
    assert.equal(outcomes.at(-1)!.public.includes('"identities"'), false);
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test("R4-CONTROL-10 真实身份接口拒绝缺少/伪造来源，拒绝前不触碰秘密", () => {
  const k = { get identities() { throw Error("未经许可不能读取"); } } as SecretState;
  for (const source of [undefined, "current_controller", "hero:future_untransferred", "ui:targets"]) assert.throws(() => effectiveIdentity(covered("hidden", 0, 6), k, source as never), errorCode("TRUE_IDENTITY_PERMISSION"));
  for (const source of ["death:reveal", "mutation:end_time:initialization", "hero:wind:covered_carrier"] as const) {
    assert.deepEqual(effectiveIdentity(covered("hidden", 0, 6), secretState({ hidden: { color: "black", type: "horse" } }), source), { color: "black", type: "horse" });
  }
});

test("R4-CONTROL-11 风暗子池保留明确真实归属例外，不改为棋位控制", () => {
  const s = initializeFeatureGameState(gameState([covered("host", 0, 3)]), { red: "wind" }, "chaos"), k = secretState({ host: { color: "red", type: "horse" } });
  initializeFeatureSecret(s, k); beginFormalTurn(s, k, () => 0);
  assert.equal(getController(s.pieces.find(p => p.id === "host")!), "black");
  const r = applyHeroAbility(s, k, ability(s, "shadow", { randomCovered: true }), 100, () => 0);
  assert.equal(r.secret.wind!.red!.hostId, "host"); assert.deepEqual(r.state, s);
  assert.equal(JSON.stringify(publicRemoteRoom(roomWith(r.state, r.secret))), JSON.stringify(publicRemoteRoom(roomWith(s, k))));
  assert.equal(ownerHeroSecrets(r.secret, "red").wind!.hostId, "host"); assert.equal(ownerHeroSecrets(r.secret, "black").wind, undefined);
});

test("R4-CONTROL-12 宿命初始化保留真实兵归属例外，未现身时不泄露分类", () => {
  const outputs = [];
  for (const type of ["pawn", "rook"] as const) {
    const s = initializeFeatureGameState(gameState([covered("hidden", 0, 3)]), { red: "nozdormu", black: "murozond" }, "end_time"), k = secretState({ hidden: { color: "red", type } });
    initializeFeatureSecret(s, k);
    assert.equal(k.destinyIdentities?.hidden?.kind, type === "pawn" ? "time_warrior" : undefined);
    assert.equal(getController(s.pieces.find(p => p.id === "hidden")!), "black");
    assert.deepEqual(getBombers(s, "black"), []); outputs.push(publicRemoteRoom(roomWith(s, k)));
  }
  assert.deepEqual(outputs[0], outputs[1]);
});

function bombState() {
  const s = initializeFeatureGameState(gameState([revealed("bomber", "black", "pawn", 0, 3), revealed("spent", "black", "pawn", 2, 3), revealed("other", "red", "pawn", 4, 6), covered("hidden", 6, 3)], { turn: "black" }), { red: "nozdormu", black: "murozond" }, "end_time"), k = secretState({ hidden: { color: "black", type: "pawn" } });
  initializeFeatureSecret(s, k); markRevealed(s, k, "bomber"); markRevealed(s, k, "spent");
  s.effectsByPieceId!.spent.ammunition = 0;
  return { s, k };
}

test("R4-CONTROL-13 无限龙公开资格排除空弹、暗棋、另一控制方和河道，权威共用", () => {
  const { s, k } = bombState();
  s.effectsByPieceId!.other = { destiny: "infinite_dragon", ammunition: 1 };
  s.effectsByPieceId!.hidden = { destiny: "infinite_dragon", ammunition: 1 };
  s.pieces.push({ ...revealed("river", "black", "pawn", 0, 3), layer: "river", river: { source: "test", spaceId: "r", cellId: "a" } }); s.effectsByPieceId!.river = { destiny: "infinite_dragon", ammunition: 1 };
  assert.deepEqual(getBombers(s, "black").map(p => p.id), ["bomber"]);
  assert.throws(() => applyHeroAbility(s, k, ability(s, "bomb", { pieceId: "spent", to: { x: 2, y: 4 } })), errorCode("INVALID_BOMBER"));
  const r = applyHeroAbility(s, k, ability(s, "bomb", { pieceId: "bomber", to: { x: 0, y: 4 } }));
  assert.deepEqual(getBombers(r.state, "black"), []); assert.equal(r.state.effectsByPieceId!.bomber.ammunition, 0);
});

// 执行真实网页菜单函数及共享判定；轻量DOM只记录选项，不模拟布局或声称浏览器验收。
const app = readFileSync(new URL("../web/app.ts", import.meta.url), "utf8");
const menuSource = app.slice(app.indexOf("function openHeroAbility("), app.indexOf("function localGameHandoff()"));
function menuOptions(s: GameState, k: SecretState, selectedAbility: string, viewer: Side | undefined = undefined) {
  const selects: Array<{ options: Array<{ text: string; value: string }> }> = [];
  class Element {
    options: Array<{ text: string; value: string }> = [];
    setAttribute() {} append() {} add(o: { text: string; value: string }) { this.options.push(o); }
  }
  runInNewContext(stripTypeScriptTypes(menuSource + `\nopenHeroAbility(selectedAbility);`), {
    gameState: s, gameSecret: k, bluetooth: undefined, localPrivateViewerSide: viewer, selectedAbility,
    document: { createElement(tag: string) { const node = new Element(); if (tag === "select") selects.push(node); return node; } },
    Option: class { text: string; value: string; constructor(text: string, value: string) { this.text = text; this.value = value; } }, getBombers, getShadowRevealedTargets,
    pieceLabel: { red: { pawn: "兵", rook: "车" }, black: { pawn: "卒", rook: "车" } }, showDialog() {}, dialogText: new Element(),
  });
  return structuredClone(selects[0].options);
}

test("R4-CONTROL-14 实际投弹菜单遵守公开弹药资格且不读取隐藏身份", () => {
  const { s, k } = bombState();
  Object.defineProperty(k, "identities", { get() { throw Error("普通UI不得读隐藏身份"); } });
  assert.deepEqual(menuOptions(s, k, "bomb").map(o => o.value), ["bomber"]);
  s.effectsByPieceId!.bomber.ammunition = 0;
  assert.deepEqual(menuOptions(s, k, "bomb"), []);
});

test("R4-CONTROL-15 实际影菜单不以秘密池可用性探测暗阵营，只使用拥有者许可标记", () => {
  const s = initializeFeatureGameState(gameState([covered("hidden", 0, 3), revealed("host", "red", "rook", 0, 7)]), { red: "wind" }, "chaos");
  const outputs = [];
  for (const color of ["red", "black"] as const) {
    const k = secretState({ hidden: { color, type: "horse" } }); initializeFeatureSecret(s, k);
    outputs.push(menuOptions(s, k, "shadow", "red"));
  }
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[0].map(o => o.value), ["random_covered", "host"]);
});
