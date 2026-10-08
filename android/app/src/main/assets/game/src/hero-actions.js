import { applyShuffleAction } from "./hero-shuffle.js";
import { applyHeroChild } from "./hero-children.js";
import { applyRiverAbility } from "./hero-river.js";
import { applyDescentAction } from "./hero-descent.js";
import { selectedHeroId, selectedHeroSelection, validateHeroForms } from "./hero-forms.js";
import { getGhostObjects, clearGhostObjects, reconcileGhostInfections } from "./ghosts.js";
import { isBoardPiece, isGround } from "./spaces.js";
import { RuleError } from "./errors.js";
import { applyAuthoritativeMove } from "./game.js";
import { getController, getCurrentPieceType, isInPalace, isInsideBoard, otherSide } from "./slots.js";
import { getLegalMoves, hasStealthEffect, isCheckmate, isGeneralInCheck, isStalemate, samePosition } from "./rules.js";
import { closeDirectDeaths, copy, destroyPiece, destroyPieceBatch, effectiveIdentity, beginFormalTurn, advanceToFormalTurn, finishFormalTurn, formalTurn, generateGhosts, initializeFeatureSecret, markRevealed, placementAllowed, queueLanding, relocatePiece, landFlyingPiece, rememberAction, settleLandings } from "./settlement.js";
import { actionFields, closeMainActionAtom, isOrdinaryFormalAction, previousFormalAction, recordAction } from "./turns.js";


function requireRule(ok         , code        , text        )             {
  if (!ok) throw new RuleError(code, text);
}
/** 明子模式直接指定目标；当前承载者 ID 只能由拥有者的私有视图提供。 */
export function getShadowRevealedTargets(state           , side      , currentGeneralId         ) {
  validateHeroForms(state);
  return state.pieces.filter(p => isBoardPiece(p) && !p.faceDown && p.color === side && p.id !== currentGeneralId && !hasStealthEffect(state, p.id));
}
/** 已现身无限龙的公开单棋资格；正式窗口和全军每回合限制仍由权威入口检查。 */
export function getBombers(state           , side      ) {
  validateHeroForms(state);
  return state.pieces.filter(p => isBoardPiece(p) && !p.faceDown && getController(p) === side &&
    state.effectsByPieceId?.[p.id]?.destiny === "infinite_dragon" && state.effectsByPieceId[p.id].ammunition === 1);
}
export function formalTurnDurationMs(state           , side      )         {
  validateHeroForms(state);
  if (state.featureRules?.mutation === "end_time" && formalTurn(state, side) === 0) return 75_000;
  const hasThief = selectedHeroId(state, side) === "murozond_minion", otherThief = selectedHeroId(state, otherSide(side)) === "murozond_minion";
  if (hasThief && otherThief) throw new RuleError("DESIGN_REQUIRED_THIEF_MIRROR", "双方窃时镜像叠加尚未正式冻结");
  return !hasThief && !otherThief ? 60_000 : hasThief ? 75_000 : 45_000;
}
export function startFormalClock(state           , now        , secret              , randomInt            )       {
  if (state.status !== "playing" || state.forcedDefense || state.flowDance || state.pendingShuffle) return;
  beginFormalTurn(state, secret, randomInt);
  const number = formalTurn(state, state.turn) + 1;
  if (state.formalClock?.side === state.turn && state.formalClock.number === number && state.turnDeadlineAt !== undefined) return;
  state.formalClock = { side: state.turn, number };
  state.turnStartedAt = now;
  state.turnDeadlineAt = now + formalTurnDurationMs(state, state.turn);
}
function endSkillTurn(state           , secret             , side      , randomInt           )       {
  settleLandings(state, secret);
  if (state.lastMove) closeMainActionAtom(state, state.lastMove.actionId);
  if (closeDirectDeaths(state, secret, side)) return;
  generateGhosts(state);
  // 占步技能应将失败的结果在整个锁定集合结算完成后裁决。
  if (isGeneralInCheck(state, side)) {
    state.status = "execution"; state.winner = otherSide(side); state.turn = otherSide(side); state.reason = "checkmate";
    return;
  }
  finishFormalTurn(state, secret, side, randomInt);
  if (state.status === "finished") return;
  advanceToFormalTurn(state, secret, otherSide(side), randomInt);
}

/** 共同权威技能入口：本机/蓝牙使用同一规则。私密技能不改变公共资源或日志。 */
export function applyHeroAbility(state           , secret             , command                    , now = Date.now(), randomInt            = max => Math.floor(Math.random() * max))             {
  validateHeroForms(state, secret);
  if (secret.processedActions[command.actionId] !== undefined) return { state: copy(state), secret: copy(secret), duplicate: true };
  if (state.pendingShuffle) return applyShuffleAction(state, secret, command, randomInt);
  if (state.pendingHeroChild) return applyHeroChild(state, secret, command, now, randomInt);
  if (state.pendingDescent) return applyDescentAction(state, secret, command, now);
  requireRule(command.expectedRevision === state.revision, "STALE_REVISION", "客户端棋局版本已经过期");
  requireRule(state.status === "playing" && !state.forcedDefense && !state.flowDance, "INVALID_PHASE", "只能在自己的正式回合开始发动技能");
  const s = copy(state), k = copy(secret), side = s.turn, hero = selectedHeroId(s, side);
  initializeFeatureSecret(s, k);
  beginFormalTurn(s, k, randomInt);
  requireRule(s.turnLifecycle?.phase === "before_main", "INVALID_PRE_MAIN_WINDOW", "只能在正式回合主行动前发动技能");
  const forcedFlyer = s.pieces.find(p => p.layer === "air" && getController(p) === side && s.effectsByPieceId?.[p.id]?.flight?.forcedLanding);
  const isMain = ["invoke", "destruction", "timeline_twist", "burning_flame", "inner_ghost_burst", "river_enter", "river_move", "river_exit", "inner_wave", "landing"].includes(command.ability);
  requireRule(!forcedFlyer || !isMain || command.ability === "landing" && command.pieceId === forcedFlyer.id, "FORCED_LANDING_REQUIRED", "第四个控制方回合的主行动必须原地降落");
  const classification                       = { tier: command.ability === "timeline_twist" || command.ability === "rewind" ? 3 : 2, keywords: isMain ? ["占步", "耗费"] : ["耗费"], source: "hero", opportunity: isMain ? "main" : "before_main", countsAsFormalTurn: isMain };
  const beforeAction = copy(s);
  if (command.ability !== "shadow") {
    if (isMain && command.ability !== "timeline_twist") rememberAction(beforeAction, k, undefined, classification.tier, undefined, now, classification);
    recordAction(s, { ...classification, actionId: command.actionId, actingSide: side });
  }
  s.heroRuntime ??= {};
  const runtime = s.heroRuntime[side] ??= {};
  s.automaticEvents = []; s.destructionBatches = []; s.landingEvents = [];
  const once = () => requireRule(!runtime.used, "SKILL_USED", "本局技能次数已用完");
  const ordinaryTime = () => requireRule(s.featureRules?.mutation !== "end_time", "DESTINY_REPLACED", "宿命已替换普通时间技能");
  let endsTurn = false, secretOnly = false;
  switch (command.ability) {
    case "invoke":
      requireRule(hero === "devout_zealot", "WRONG_HERO", "英雄没有祈求技能");
      requireRule(!isGeneralInCheck(s, side), "IN_CHECK", "被将军时不能祈求");
      requireRule((runtime.invokeCount ?? 0) < 4, "INVOKE_COMPLETE", "迦拉克隆已经降临");
      runtime.invokeCount = (runtime.invokeCount ?? 0) + 1;
      if (runtime.invokeCount === 4) runtime.omen = true;
      endsTurn = true;
      break;
    case "unspeakable": throw new RuleError("RETIRED_SKILL", "讳言已替换为固定形态的自动降临，不能重复主动发动");
    case "destruction": {
      requireRule(hero === "deathwing", "WRONG_HERO", "英雄没有毁灭技能"); once(); runtime.used = true;
      const checkedAtActivation = isGeneralInCheck(s, side);
      const locked = s.pieces.filter(p => isBoardPiece(p) && getCurrentPieceType(p) !== "general");
      const committed = locked.filter(() => randomInt(2) === 0).map(p => ({ pieceId: p.id, by: side, cause: "destruction" }));
      destroyPieceBatch(s, k, `${command.actionId}:destruction`, "deathwing:destruction", committed);
      if (checkedAtActivation) {
        const penalty = s.pieces.filter(p => isBoardPiece(p) && !p.faceDown && getController(p) === side && p.type !== "general").map(p => ({ pieceId: p.id, by: side, cause: "destruction_penalty" }));
        destroyPieceBatch(s, k, `${command.actionId}:penalty`, "deathwing:in_check_penalty", penalty);
      }
      endsTurn = true;
      break;
    }
    case "river_enter": case "river_move": case "river_exit": case "inner_wave": {
      applyRiverAbility(s, k, side, command); endsTurn = true; break;
    }
    case "landing": {
      const p = s.pieces.find(p => p.id === command.pieceId && p.layer === "air" && getController(p) === side);
      requireRule(p && s.effectsByPieceId?.[p.id]?.flight?.source === "sky_admiral", "INVALID_FLYER", "请选择己方征兵飞行棋");
      landFlyingPiece(s, k, p.id); endsTurn = true; break;
    }
    case "insight": {
      requireRule(hero === "night", "WRONG_HERO", "英雄没有洞察");
      const number = formalTurn(s, side) + 1, n = runtime.insightCount ?? 0;
      requireRule(runtime.insightTurn !== number, "INSIGHT_TURN_LIMIT", "每个己方正式回合最多洞察一次");
      const cost = command.secretInsight ? 7 + 6 * n : 4 + 4 * n;
      requireRule((runtime.pupil ?? 0) >= cost, "INSUFFICIENT_PUPIL", "瞳力不足");
      const p = s.pieces.find(p => p.id === command.pieceId && p.faceDown);
      requireRule(p, "INVALID_INSIGHT_TARGET", "洞察目标必须仍为暗子");
      const identity = effectiveIdentity(p, k, "hero:night:insight");
      runtime.pupil = (runtime.pupil ?? 0) - cost; runtime.insightCount = n + 1; runtime.insightTurn = number;
      k.insights ??= {}; (k.insights[side] ??= []).push({ pieceId: p.id, identity, revision: state.revision + 1, valid: true });
      if (!command.secretInsight) { s.effectsByPieceId ??= {}; (s.effectsByPieceId[p.id] ??= {}).insightMark = true; }
      // Secret mode publishes operation and cost, never its target.
      const record = s.actionRecords?.at(-1); if (record && !command.secretInsight) record.pieceId = p.id;
      break;
    }
    case "burning_flame": {
      requireRule(hero === "warlock", "WRONG_HERO", "英雄没有燃烧烈焰"); once();
      const center = s.pieces.find(p => p.id === command.pieceId && isBoardPiece(p) && getController(p) === side);
      requireRule(center, "INVALID_FLAME_CENTER", "必须选择当前控制的合法棋盘中心棋");
      const ranks                         = { pawn: 1, advisor: 2, elephant: 2, horse: 3, cannon: 3, rook: 4 };
      const rank = ranks[getCurrentPieceType(center)];
      const region = s.pieces.filter(p => isBoardPiece(p) && Math.abs(p.x - center.x) <= 1 && Math.abs(p.y - center.y) <= 1);
      requireRule(!region.some(p => p.id !== center.id && (rank === undefined || getCurrentPieceType(p) === "general")), "DESIGN_REQUIRED_FLAME_GENERAL", "燃烧烈焰将帅中心/目标的普通层级交叉未定义，不能猜测");
      const targets = region.filter(p => p.id === center.id || ranks[getCurrentPieceType(p)] <= rank + 1).map(p => ({ pieceId: p.id, by: side, cause: "burning_flame" }));
      runtime.used = true;
      destroyPieceBatch(s, k, `${command.actionId}:flame`, "warlock:burning_flame", targets); endsTurn = true; break;
    }
    case "inner_ghost_burst": {
      const selection = selectedHeroSelection(s, side);
      requireRule(selection?.heroId === "death_knight" && selection.form === "inner", "WRONG_HERO", "必须选择里死亡骑士完整包"); once();
      reconcileGhostInfections(s);
      const committed = copy(getGhostObjects(s, { kind: "inner_ghost", owner: side }));
      const targets = s.pieces.filter(p => isGround(p) && getController(p) !== side).filter(p => {
        const contribution = committed.reduce((sum, g) => sum + (Math.abs(g.position.x - p.x) + Math.abs(g.position.y - p.y) <= 1 ? g.layers ?? 0 : 0), 0);
        const infection = s.effectsByPieceId?.[p.id]?.infection;
        return contribution > 0 && contribution + (infection?.owner === side ? infection.stacks : 0) >= 3;
      }).map(p => ({ pieceId: p.id, by: side, cause: "inner_ghost_burst" }));
      runtime.used = true;
      clearGhostObjects(s, { kind: "inner_ghost", owner: side });
      destroyPieceBatch(s, k, `${command.actionId}:inner_ghost`, "death_knight:inner_burst", targets); endsTurn = true; break;
    }
    case "timeline_twist": {
      requireRule(hero === "murozond", "WRONG_HERO", "英雄没有扭曲时间线"); ordinaryTime(); once();
      const previous = previousFormalAction(k);
      requireRule(previous && previous.actingSide === otherSide(side) && isOrdinaryFormalAction(previous) && previous.pieceId && previous.from, "NOT_PREVIOUS_ORDINARY", "只能操控对手紧接上一正式俗手的存活棋");
      const p = s.pieces.find(p => p.id === previous.pieceId);
      requireRule(p && isBoardPiece(p) && command.to, "NO_TARGET", "目标已死亡或缺少重走落点");
      runtime.used = true;
      rememberAction(beforeAction, k, p.id, 3, { x: p.x, y: p.y }, now, classification);
      const returned = relocatePiece(s, k, p.id, previous.from, "timeline_twist");
      if (!returned || !s.pieces.some(q => q.id === p.id)) { endsTurn = true; break; }
      const controlled = copy(s);
      controlled.turn = getController(p);
      // 此次操控是当前连带动作；“下一正式回合”封锁不取消它。
      requireRule(getLegalMoves(controlled, p.id, controlled.turn, { allowLinkedControl: true }).some(to => samePosition(to, command.to )), "INVALID_CONTROLLED_MOVE", "重走必须符合该敌棋一侧全部合法规则");
      const moved = applyAuthoritativeMove(controlled, k, { from: p, to: command.to, expectedRevision: controlled.revision, actionId: `${command.actionId}:controlled` }, true, now, { parentActionId: command.actionId });
      Object.assign(s, moved.state); Object.assign(k, moved.secret);
      s.turn = side;
      endsTurn = true;
      break;
    }
    case "rewind": {
      requireRule(hero === "nozdormu", "WRONG_HERO", "英雄没有回溯技能"); ordinaryTime();
      requireRule(!k.rewindUsed?.[side], "SKILL_USED", "本局回溯已使用");
      requireRule(now - (state.turnStartedAt ?? now) < 10_000 && !isGeneralInCheck(s, side), "REWIND_WINDOW", "回溯只允许回合前10秒且未受将军");
      const previous = previousFormalAction(k, side);
      requireRule(previous?.pieceId, "NO_HISTORY", "没有上一己方行动快照");
      requireRule(previous.remainingMs !== undefined && Number.isFinite(previous.remainingMs), "REWIND_CLOCK_MISSING", "历史落子前真实剩余时间缺失，不能推定回溯重走时限");
      validateHeroForms(previous.state, k);
      validateHeroForms(previous.state, previous.secret);
      const formLock = copy(k.heroFormLock);
      const processed = copy(k.processedActions), used = { ...k.rewindUsed, [side]: true          }, history = k.history;
      for (const key of Object.keys(s)) delete (s                                      )[key];
      Object.assign(s, copy(previous.state));
      const knowledge = copy(k.insights);
      const restoredSecret = copy(previous.secret);
      if (knowledge) {
        restoredSecret.insights ??= {};
        for (const owner of ["red", "black"]         ) {
          const past = restoredSecret.insights[owner] ??= [];
          for (const learned of knowledge[owner] ?? []) if (!past.some(row => JSON.stringify(row) === JSON.stringify(learned))) past.push({ ...learned, valid: false });
        }
      }
      for (const key of Object.keys(k)) delete (k                                      )[key];
      Object.assign(k, restoredSecret, { heroFormLock: formLock, processedActions: processed, rewindUsed: used, history, replay: { pieceId: previous.pieceId, deadlineAt: now + Math.min(10_000, Math.max(0, previous.remainingMs)) } });
      s.revision = state.revision;
      s.turn = side; s.turnStartedAt = now; s.turnDeadlineAt = k.replay .deadlineAt;
      // 回溯恢复阶段与开始结算，不能把已完成的开始效果再跑一次。
      beginFormalTurn(s, k, randomInt);
      recordAction(s, { ...classification, actionId: command.actionId, actingSide: side });
      break;
    }
    case "hourglass": {
      requireRule(hero === "nozdormu" && s.featureRules?.mutation === "end_time", "NO_DESTINY", "只有时光之末诺兹多姆可使用沙漏");
      requireRule((s.hourglasses ?? 0) > 0, "SKILL_USED", "沙漏已耗尽");
      s.hourglasses --;
      // 候选和锚点合法性先冻结；不在净化后重试被扭曲或占据的锚点。
      const candidates = Object.entries(k.destinyIdentities ?? {}).filter(([id, d]) => d.kind === "time_warrior" && d.shown && !s.pieces.some(p => p.id === id && !isBoardPiece(p)));
      const eligible = candidates.filter(([id, d]) => !s.pieces.some(p => isBoardPiece(p) && samePosition(p, d.anchor)) && !s.warps?.some(w => samePosition(w, d.anchor)) && placementAllowed(s, { id, ...d.anchor, faceDown: false, ...d.identity }, d.anchor));
      for (const [id, d] of eligible) {
        const living = s.pieces.find(p => p.id === id);
        if (living) { living.x = d.anchor.x; living.y = d.anchor.y; }
        else {
          s.pieces.push({ id, ...d.anchor, faceDown: false, ...d.identity });
          s.captured = s.captured.filter(p => p.id !== id);
          delete k.identities[id];
        }
        s.effectsByPieceId ??= {}; s.effectsByPieceId[id] = { destiny: "time_warrior" };
        queueLanding(s, s.pieces.find(p => p.id === id) , side, living ? "hourglass_return" : "revival");
      }
      settleLandings(s, k);
      s.warps = [];
      for (const [id, e] of Object.entries(s.effectsByPieceId ?? {})) if (!s.pieces.some(p => p.id === id && !isBoardPiece(p))) delete e.timeCollapse;
      for (const p of s.pieces) if (isBoardPiece(p) && k.destinyIdentities?.[p.id]?.kind === "infinite_dragon" && k.destinyIdentities[p.id].shown) {
        s.effectsByPieceId ??= {}; s.effectsByPieceId[p.id] = { ...s.effectsByPieceId[p.id], ammunition: 1 };
      }
      break;
    }
    case "bomb": {
      requireRule(hero === "murozond" && s.featureRules?.mutation === "end_time", "NO_DESTINY", "只有无限龙可以投弹");
      const p = getBombers(s, side).find(p => p.id === command.pieceId), d = command.pieceId ? k.destinyIdentities?.[command.pieceId] : undefined;
      requireRule(p && d?.kind === "infinite_dragon" && d.shown && command.to, "INVALID_BOMBER", "需要已现身的己方无限龙及一枚弹药");
      requireRule(!k.processedActions[`bomb:turn:${side}:${formalTurn(s, side)}`], "BOMB_TURN_LIMIT", "每个正式回合全军最多投放一枚");
      const to = command.to;
      requireRule(isInsideBoard(to) && !samePosition(p, to) && Math.abs(p.x - to.x) + Math.abs(p.y - to.y) <= 3 && !s.warps?.some(w => samePosition(w, to)), "INVALID_BOMB_TARGET", "目标须为棋盘整数格，在曼哈顿距离3内且非自身或已有扭曲");
      s.effectsByPieceId [p.id].ammunition = 0;
      s.warps ??= []; s.warps.push({ ...to });
      k.processedActions[`bomb:turn:${side}:${formalTurn(s, side)}`] = s.revision + 1;
      for (const q of s.pieces.filter(q => isGround(q) && samePosition(q, to) && getController(q) !== side)) queueLanding(s, q, getController(q), "bomb_hit");
      settleLandings(s, k);
      break;
    }
    case "shadow": {
      requireRule(hero === "wind", "WRONG_HERO", "英雄没有影技能");
      const wind = k.wind?.[side];
      requireRule(wind && wind.uses < 2 && formalTurn(s, side) >= wind.readyOnTurn && wind.activatedOnTurn !== formalTurn(s, side), "SHADOW_UNAVAILABLE", "影尚在冷却或次数已用完");
      // 随机暗子不是直接指定，无形仍可进入该池；明子选择遵守无形目标限制。
      const pool = command.randomCovered
        ? s.pieces.filter(p => isBoardPiece(p) && p.id !== (wind.hostId ?? wind.decoyId) && p.faceDown && effectiveIdentity(p, k, "hero:wind:covered_carrier").color === side)
        : getShadowRevealedTargets(s, side, wind.hostId ?? wind.decoyId);
      const host = command.randomCovered ? pool[randomInt(pool.length)] : pool.find(p => p.id === command.pieceId);
      requireRule(host, "INVALID_SHADOW_TARGET", "请选择己方合法明棋或随机己方真实阵营暗子");
      wind.uses += 1; wind.activatedOnTurn = formalTurn(s, side); wind.readyOnTurn = formalTurn(s, side) + 8;
      wind.hostId = host.id === wind.decoyId ? undefined : host.id;
      secretOnly = true;
      break;
    }
    default: throw new RuleError("UNKNOWN_SKILL", "未知英雄技能");
  }
  if (!secretOnly) {
    s.revision += 1;
    if (endsTurn) {
      s.lastMove = { actionId: command.actionId, pieceId: command.pieceId ?? `hero:${side}`, actingSide: side, from: command.to ?? { x: 0, y: 0 }, to: command.to ?? { x: 0, y: 0 }, landed: false, ...actionFields(classification) };
      if (command.ability === "inner_wave" && s.pieces.some(p => p.id === command.pieceId && getController(p) === side) && !closeDirectDeaths(s, k, side) && !isGeneralInCheck(s, side)) {
        closeMainActionAtom(s, command.actionId);
        s.pendingHeroChild = { kind: "inner_wave", side, pieceId: command.pieceId , parent: copy(s.lastMove) };
      } else endSkillTurn(s, k, side, randomInt);
    } else closeDirectDeaths(s, k, side);
  }
  k.processedActions[command.actionId] = s.revision;
  return { state: secretOnly ? copy(state) : s, secret: k, duplicate: false };
}

export function ownerHeroSecrets(secret             , side      ) {
  return { ...(secret.wind?.[side] ? { wind: copy(secret.wind[side]) } : {}), ...(secret.training?.[side] ? { training: copy(secret.training[side]) } : {}), ...(secret.insights?.[side] ? { insights: copy(secret.insights[side]) } : {}) };
}
