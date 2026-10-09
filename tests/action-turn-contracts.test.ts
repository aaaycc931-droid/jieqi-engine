import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAuthoritativeAssassination, applyAuthoritativeMove, applyHeroAbility,
  beginFormalTurn, closeMainActionAtom, finishFormalTurn, initializeFeatureGameState, initializeFeatureSecret,
  pieceById, recordAction, startFormalClock,
} from "../src/index.ts";
import type { GameState, HeroAbilityCommand } from "../src/index.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";
import { executedWindFixture } from "./flow-fixtures.ts";

const phases = ["turn_start", "before_main", "main_action", "atom_closure", "turn_end"];
const skill = (ability: HeroAbilityCommand["ability"], state: GameState, extra: Partial<HeroAbilityCommand> = {}) => ({ kind: "hero_ability" as const, ability, actionId: `phase:${ability}:${state.revision}`, expectedRevision: state.revision, ...extra });

test("R4-ACTION-01 普通移动和进攻均可为Ⅰ级，历史和公开记录分别保留关键词", () => {
  for (const attack of [false, true]) {
    const s = gameState([revealed("mover", "red", "rook", 0, 7), ...(attack ? [revealed("target", "black", "pawn", 0, 6)] : [])]);
    const r = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }));
    const c = r.state.lastMove!.classification!;
    assert.equal(c.tier, 1);
    assert.deepEqual(c.keywords, [attack ? "进攻" : "移动"]);
    assert.equal(c.opportunity, "main");
    assert.equal(c.source, "ordinary");
    assert.deepEqual(r.secret.history!.at(-1)!.classification, c);
    assert.deepEqual(r.state.lastCompletedFormalTurn!.phases, phases);
    assert.equal(r.state.formalTurns?.red, 1);
    assert.equal(r.state.turnLifecycle?.side, "black");
    assert.deepEqual(r.state.turnLifecycle?.phases, phases.slice(0, 2));
  }
});

test("R4-ACTION-02 壁垒弹回仍记录Ⅰ级进攻，不因未吃掉目标丢失分类", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7), revealed("guard", "black", "pawn", 0, 6)]));
  s.effectsByPieceId = { guard: { barrier: { owner: "black", enemyTurnsRemaining: 3 } } };
  const r = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }));
  assert.equal(r.state.lastMove?.landed, false);
  assert.equal(r.state.lastMove?.tier, 1);
  assert.deepEqual(r.state.lastMove?.keywords, ["进攻"]);
  assert.deepEqual(r.secret.history?.at(-1)?.classification, r.state.lastMove?.classification);
  assert.deepEqual(r.state.lastCompletedFormalTurn?.phases, phases);
});

test("R4-ACTION-03 时间线占步与衍生移动分开记录，子行动是Ⅲ级且不新增历史或回合", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7)]), { black: "murozond" });
  const h = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }, "first"));
  const r = applyHeroAbility(h.state, h.secret, skill("timeline_twist", h.state, { to: { x: 0, y: 8 } }), 100);
  const [main, child] = r.state.actionRecords!;
  assert.equal(main.opportunity, "main");
  assert.deepEqual(main.keywords, ["占步", "耗费"]);
  assert.equal(main.from, undefined);
  assert.equal(child.source, "skill_derived");
  assert.equal(child.opportunity, "child");
  assert.equal(child.tier, 3);
  assert.deepEqual(child.keywords, ["移动"]);
  assert.equal(child.parentActionId, main.actionId);
  assert.equal(child.countsAsFormalTurn, false);
  assert.equal(r.secret.history?.length, 2);
  assert.deepEqual(r.state.formalTurns, { red: 1, black: 1 });
  assert.deepEqual(r.state.lastCompletedFormalTurn?.phases, phases);
});

test("R4-ACTION-04 上一正式回合只有占步技能时，时间线不跳回更早的Ⅰ级棋", () => {
  const s = initializeFeatureGameState(gameState([revealed("old", "red", "rook", 0, 7), revealed("reply", "black", "pawn", 2, 3)]), { red: "devout_zealot", black: "murozond" });
  let r = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }, "old"));
  r = applyAuthoritativeMove(r.state, r.secret, move({ x: 2, y: 3 }, { x: 2, y: 4 }, "reply", r.state.revision));
  r = applyHeroAbility(r.state, r.secret, skill("invoke", r.state), 100);
  const before = structuredClone(r);
  assert.equal(r.secret.history?.at(-1)?.pieceId, undefined);
  assert.throws(() => applyHeroAbility(r.state, r.secret, skill("timeline_twist", r.state, { to: { x: 0, y: 8 } }), 200), e => e.code === "NOT_PREVIOUS_ORDINARY");
  assert.deepEqual(r, before);
});

test("R4-ACTION-05 缺少历史层级时拒绝猜成俗手，拒绝不消耗英雄资源", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7)]), { black: "murozond" });
  const h = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }));
  delete (h.secret.history![0] as { tier?: number }).tier;
  const before = structuredClone(h);
  assert.throws(() => applyHeroAbility(h.state, h.secret, skill("timeline_twist", h.state, { to: { x: 0, y: 8 } })), e => e.code === "NOT_PREVIOUS_ORDINARY");
  assert.deepEqual(h, before);
});

test("R4-TURN-01 铁甲额外强迫应将不进入历史，不推进任何第二次正式计时", () => {
  const s = initializeFeatureGameState(gameState([covered("turncoat", 4, 6), { ...revealed("flyer", "red", "rook", 0, 7), layer: "air" }, revealed("guard", "black", "pawn", 0, 3)], { redGeneral: { x: 4, y: 9 } }), { red: "warrior", black: "hunter" });
  s.effectsByPieceId = { flyer: { flight: { remainingOwnerTurns: 3 } }, guard: { barrier: { owner: "black", enemyTurnsRemaining: 3 } } };
  s.ghosts = [{ owner: "red", position: { x: 0, y: 4 }, remaining: 3 }];
  const k = secretState({ turncoat: { color: "black", type: "rook" } });
  k.traps = [{ id: "timer", owner: "black", position: { x: 8, y: 6 }, opponentTurnsRemaining: 3 }];
  const h = applyAuthoritativeMove(s, k, move({ x: 4, y: 6 }, { x: 4, y: 5 }, "main"));
  assert.equal(h.state.formalTurns?.red, 1, "原主行动只完成一次正式回合");
  const r = applyAuthoritativeMove(h.state, h.secret, move({ x: 4, y: 9 }, { x: 3, y: 9 }, "extra", h.state.revision));
  assert.deepEqual(r.state.formalTurns, h.state.formalTurns);
  assert.deepEqual(r.secret.history, h.secret.history);
  assert.equal(r.state.lastMove?.classification?.opportunity, "extra");
  assert.equal(r.state.lastMove?.classification?.forced, true);
  assert.equal(r.state.lastMove?.tier, 3);
  assert.deepEqual(r.state.lastMove?.keywords, ["移动", "额外", "强迫"]);
  assert.equal(r.state.effectsByPieceId?.flyer?.flight?.remainingOwnerTurns, 2);
  assert.equal(r.state.effectsByPieceId?.guard?.barrier?.enemyTurnsRemaining, 2);
  assert.equal(r.state.ghosts?.[0].remaining, 2);
  assert.equal(r.secret.traps?.[0].opponentTurnsRemaining, 2);
  assert.equal(r.state.turnLifecycle?.side, "black");
});

test("R4-TURN-02 实际裁决后的流舞保持额外Ⅲ级与原正式历史，不生成正式阶段", () => {
  const h = executedWindFixture();
  const r = applyAuthoritativeMove(h.state, h.secret, move({ x: 3, y: 9 }, { x: 3, y: 8 }, "dance", h.state.revision));
  assert.deepEqual(r.secret.history, h.secret.history);
  assert.deepEqual(r.state.formalTurns, h.state.formalTurns);
  assert.deepEqual(r.state.turnLifecycle, h.state.turnLifecycle);
  assert.equal(r.state.lastMove?.classification?.opportunity, "extra");
  assert.equal(r.state.lastMove?.classification?.source, "skill_derived");
  assert.equal(r.state.lastMove?.tier, 3);
  assert.ok(r.state.lastMove?.keywords?.includes("移动"));
});

test("R4-TURN-03 秦龙开始结算只运行一次，回合末/重复观察不能提前或重复抽取", () => {
  const s = initializeFeatureGameState(gameState(), { red: "qin_long" });
  s.formalTurns = { red: 15, black: 14 };
  const k = secretState(); let rolls = 0;
  finishFormalTurn(s, k, "black", () => { throw new Error("回合末不能抽秦龙开始效果"); });
  assert.equal(s.heroRuntime?.red?.rainActive, undefined);
  beginFormalTurn(s, k, max => { assert.equal(max, 100); rolls++; return 0; });
  assert.equal(s.heroRuntime?.red?.rainActive, true);
  beginFormalTurn(s, k, () => { throw new Error("同一正式回合不能重复抽取"); });
  startFormalClock(s, 100);
  assert.equal(rolls, 1);
  assert.deepEqual(s.turnLifecycle?.phases, phases.slice(0, 2));
});

test("R4-TURN-04 混乱在开始刷新一次，公开时钟/窗口重复/回合末均不重掷", () => {
  const s = initializeFeatureGameState(gameState([covered("hidden", 0, 6)]), undefined, "chaos");
  const k = secretState({ hidden: { color: "black", type: "rook" } });
  initializeFeatureSecret(s, k, () => { throw new Error("准备初始化不能重掷正式回合阵营"); });
  startFormalClock(s, 0);
  beginFormalTurn(s, k, max => { assert.equal(max, 2); return 0; });
  assert.deepEqual(k.identities.hidden, { color: "red", type: "rook" });
  beginFormalTurn(s, k, () => { throw new Error("窗口不能重复刷新"); });
  assert.equal(pieceById(s, "hidden")?.faceDown, true);
  // 公共主行动仍走另一个明棋；回合末入口只负责使用时长。
  recordAction(s, { tier: 1, keywords: ["移动"], source: "ordinary", opportunity: "main", countsAsFormalTurn: true, actionId: "test-end", actingSide: "red" });
  closeMainActionAtom(s, "test-end");
  finishFormalTurn(s, k, "red", () => { throw new Error("回合末不能刷新阵营"); });
  assert.equal(k.identities.hidden.color, "red");
  s.turn = "black";
  beginFormalTurn(s, k, () => 1);
  assert.deepEqual(k.identities.hidden, { color: "black", type: "rook" });
  assert.equal((pieceById(s, "hidden") as unknown as { color?: string }).color, undefined);
});

test("R4-TURN-05 当回合飞行持续时间参与首次回合末，不向后额外延长一回合", () => {
  const s = initializeFeatureGameState(gameState([{ ...revealed("flyer", "red", "rook", 0, 7), layer: "air" }]));
  beginFormalTurn(s);
  s.effectsByPieceId = { flyer: { flight: { remainingOwnerTurns: 1 } } };
  const r = applyAuthoritativeMove(s, secretState(), { ...move({ x: 0, y: 7 }, { x: 0, y: 6 }, "fly", 0), pieceId: "flyer" });
  assert.equal(pieceById(r.state, "flyer")?.layer, undefined);
  assert.equal(r.state.effectsByPieceId?.flyer?.flight, undefined);
  assert.equal(r.state.formalTurns?.red, 1);
});

test("R4-TURN-06 潜行者明确例外：发动回合不清隐身，下一己方正式行动才退出", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7), revealed("reply", "black", "pawn", 2, 3)]), { red: "rogue" });
  let r = applyAuthoritativeAssassination(s, secretState(), { ...move({ x: 0, y: 7 }, { x: 0, y: 6 }, "conceal"), kind: "assassination", source: "hero", useStrongStrike: false });
  assert.ok(r.state.effectsByPieceId?.mover?.stealth);
  r = applyAuthoritativeMove(r.state, r.secret, move({ x: 2, y: 3 }, { x: 2, y: 4 }, "reply", r.state.revision));
  assert.ok(r.state.effectsByPieceId?.mover?.stealth);
  r = applyAuthoritativeAssassination(r.state, r.secret, { ...move({ x: 0, y: 6 }, { x: 0, y: 5 }, "exit", r.state.revision), kind: "assassination", useStrongStrike: false });
  assert.equal(r.state.effectsByPieceId?.mover?.stealth, undefined);
  assert.equal(r.secret.history?.at(-1)?.tier, 2);
});

test("R4-TURN-07 占步技能消耗主行动并走完五阶段，不伪造移动或进攻", () => {
  const s = initializeFeatureGameState(gameState(), { red: "devout_zealot" });
  const r = applyHeroAbility(s, secretState(), skill("invoke", s), 0);
  assert.deepEqual(r.state.lastCompletedFormalTurn?.phases, phases);
  assert.equal(r.state.formalTurns?.red, 1);
  assert.equal(r.state.lastMove?.classification?.opportunity, "main");
  assert.equal(r.state.lastMove?.tier, 2);
  assert.deepEqual(r.state.lastMove?.keywords, ["占步", "耗费"]);
  assert.equal(r.secret.history?.at(-1)?.pieceId, undefined);
});

test("R4-TURN-08 沙漏主行动前使用不推进计时，后续普通主行动仅结束一次", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7)]), { red: "nozdormu", black: "murozond" }, "end_time");
  s.ghosts = [{ owner: "red", position: { x: 0, y: 4 }, remaining: 3 }];
  const h = applyHeroAbility(s, secretState(), skill("hourglass", s), 100);
  assert.equal(h.state.turnLifecycle?.phase, "before_main");
  assert.equal(h.state.actionRecords?.[0].opportunity, "before_main");
  assert.equal(h.state.actionRecords?.[0].countsAsFormalTurn, false);
  assert.equal(h.state.hourglasses, 4);
  assert.equal(h.state.ghosts?.[0].remaining, 3);
  assert.equal(h.secret.history, undefined);
  const r = applyAuthoritativeMove(h.state, h.secret, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "main", h.state.revision));
  assert.equal(r.state.formalTurns?.red, 1);
  assert.equal(r.state.ghosts?.[0].remaining, 2);
  assert.deepEqual(r.state.lastCompletedFormalTurn?.phases, phases);
  assert.equal(applyHeroAbility(r.state, r.secret, skill("hourglass", s), 200).duplicate, true);
});

test("R4-TURN-09 终局在原子闭合停止，不推进回合末或下一回合开始", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 5, 7)]), { red: "qin_long", black: "prince" });
  s.heroRuntime!.red!.rainActive = true;
  s.heroRuntime!.black!.carefreeSuspended = true;
  s.ghosts = [{ owner: "red", position: { x: 0, y: 4 }, remaining: 3 }];
  const r = applyAuthoritativeMove(s, secretState(), move({ x: 5, y: 7 }, { x: 5, y: 6 }));
  assert.equal(r.state.reason, "rain_night");
  assert.equal(r.state.turnLifecycle?.phase, "atom_closure");
  assert.deepEqual(r.state.turnLifecycle?.phases, phases.slice(0, 4));
  assert.equal(r.state.formalTurns?.red, 0);
  assert.equal(r.state.ghosts?.[0].remaining, 3);
  assert.equal(r.state.heroRuntime?.black?.carefreeSuspended, true);
});

test("R4-TURN-10 回溯恢复主行动前阶段；重新行动标Ⅲ级并仅结算一次正式回合", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7), revealed("reply", "black", "pawn", 2, 3)]), { red: "nozdormu", black: "hunter" });
  startFormalClock(s, 0);
  let r = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }, "first"), false, 55_000);
  r = applyAuthoritativeMove(r.state, r.secret, move({ x: 2, y: 3 }, { x: 2, y: 4 }, "reply", r.state.revision), false, 61_000);
  startFormalClock(r.state, 62_000);
  r = applyHeroAbility(r.state, r.secret, skill("rewind", r.state), 63_000);
  assert.equal(r.state.turnLifecycle?.phase, "before_main");
  assert.equal(r.state.turnDeadlineAt, 68_000);
  r = applyAuthoritativeMove(r.state, r.secret, move({ x: 0, y: 7 }, { x: 0, y: 8 }, "replay", r.state.revision), false, 64_000);
  assert.equal(r.state.lastMove?.classification?.source, "rewind_replay");
  assert.equal(r.state.lastMove?.tier, 3);
  assert.deepEqual(r.state.lastMove?.keywords, ["移动"]);
  assert.equal(r.state.formalTurns?.red, 1);
  assert.deepEqual(r.state.lastCompletedFormalTurn?.phases, phases);
});

test("R4-TURN-11 重复行动与重复回合末结算不再次消耗持续时间或推进正式计数", () => {
  const s = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7)]));
  s.ghosts = [{ owner: "red", position: { x: 0, y: 4 }, remaining: 3 }];
  const command = move({ x: 0, y: 7 }, { x: 0, y: 6 }, "once");
  const h = applyAuthoritativeMove(s, secretState(), command);
  const duplicate = applyAuthoritativeMove(h.state, h.secret, command);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate, { ...h, duplicate: true });
  const before = structuredClone(h);
  finishFormalTurn(h.state, h.secret, "red");
  assert.deepEqual(h, before);
});

test("R4-TURN-12 普通裁决候选不运行败方下一回合的秦龙抽签", () => {
  const s = initializeFeatureGameState(gameState([revealed("checker", "red", "rook", 3, 3), revealed("lock", "red", "rook", 4, 5)], { redGeneral: { x: 5, y: 9 }, blackGeneral: { x: 3, y: 0 } }), { black: "qin_long" });
  s.formalTurns = { red: 15, black: 15 };
  const r = applyAuthoritativeMove(s, secretState(), move({ x: 3, y: 3 }, { x: 3, y: 2 }));
  assert.equal(r.state.status, "execution");
  assert.equal(r.state.reason, "checkmate");
  assert.equal(r.state.heroRuntime?.black?.rainActive, undefined);
  assert.equal(r.state.turnLifecycle?.side, "red");
  assert.equal(r.state.turnLifecycle?.phase, "turn_end");
});
