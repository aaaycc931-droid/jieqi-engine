import { isBoardPiece, isGround } from "./spaces.js";
import { RuleError } from "./errors.js";
import { applyAuthoritativeMove } from "./game.js";
import { getController, getCurrentPieceType, isInPalace, otherSide } from "./slots.js";
import { getLegalMoves, hasStealthEffect, isCheckmate, isGeneralInCheck, isStalemate, samePosition } from "./rules.js";
import { closeDirectDeaths, copy, destroyPiece, destroyPieceBatch, effectiveIdentity, beginFormalTurn, advanceToFormalTurn, finishFormalTurn, formalTurn, generateGhosts, initializeFeatureSecret, markRevealed, placementAllowed, queueLanding, relocatePiece, rememberAction, settleLandings } from "./settlement.js";
import { actionFields, closeMainActionAtom, isOrdinaryFormalAction, previousFormalAction, recordAction } from "./turns.js";


function requireRule(ok         , code        , text        )             {
  if (!ok) throw new RuleError(code, text);
}
/** 明子模式直接指定目标；当前承载者 ID 只能由拥有者的私有视图提供。 */
export function getShadowRevealedTargets(state           , side      , currentGeneralId         ) {
  return state.pieces.filter(p => isBoardPiece(p) && !p.faceDown && p.color === side && p.id !== currentGeneralId && !hasStealthEffect(state, p.id));
}
/** 已现身无限龙的公开单棋资格；正式窗口和全军每回合限制仍由权威入口检查。 */
export function getBombers(state           , side      ) {
  return state.pieces.filter(p => isBoardPiece(p) && !p.faceDown && getController(p) === side &&
    state.effectsByPieceId?.[p.id]?.destiny === "infinite_dragon" && state.effectsByPieceId[p.id].ammunition === 1);
}
export function formalTurnDurationMs(state           , side      )         {
  if (state.featureRules?.mutation === "end_time" && formalTurn(state, side) === 0) return 75_000;
  const heroes = state.featureRules?.heroes;
  const hasThief = heroes?.[side] === "murozond_minion", otherThief = heroes?.[otherSide(side)] === "murozond_minion";
  return hasThief === otherThief ? 60_000 : hasThief ? 75_000 : 45_000;
}
export function startFormalClock(state           , now        , secret              , randomInt            )       {
  if (state.status !== "playing" || state.forcedDefense || state.flowDance) return;
  beginFormalTurn(state, secret, randomInt);
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
  if (secret.processedActions[command.actionId] !== undefined) return { state: copy(state), secret: copy(secret), duplicate: true };
  requireRule(command.expectedRevision === state.revision, "STALE_REVISION", "客户端棋局版本已经过期");
  requireRule(state.status === "playing" && !state.forcedDefense && !state.flowDance, "INVALID_PHASE", "只能在自己的正式回合开始发动技能");
  const s = copy(state), k = copy(secret), side = s.turn, hero = s.featureRules?.heroes?.[side];
  initializeFeatureSecret(s, k);
  beginFormalTurn(s, k, randomInt);
  requireRule(s.turnLifecycle?.phase === "before_main", "INVALID_PRE_MAIN_WINDOW", "只能在正式回合主行动前发动技能");
  const isMain = ["invoke", "unspeakable", "destruction", "timeline_twist"].includes(command.ability);
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
      endsTurn = true;
      break;
    case "unspeakable": {
      requireRule(hero === "devout_zealot" && runtime.invokeCount === 4, "NOT_DESCENDED", "迦拉克隆尚未降临");
      const targets = s.pieces.filter(p => isBoardPiece(p) && !p.faceDown && p.color !== side && p.type !== "general");
      const home = targets.filter(p => side === "red" ? p.y >= 5 : p.y <= 4);
      const pool = home.length ? home : targets;
      requireRule(pool.length, "NO_TARGET", "没有合法处决目标");
      destroyPiece(s, k, pool[randomInt(pool.length)].id, side, "unspeakable");
      endsTurn = true;
      break;
    }
    case "destruction": {
      requireRule(hero === "deathwing", "WRONG_HERO", "英雄没有毁灭技能"); once(); runtime.used = true;
      const locked = s.pieces.filter(p => isBoardPiece(p) && getCurrentPieceType(p) !== "general");
      const committed = locked.filter(() => randomInt(2) === 0).map(p => ({ pieceId: p.id, by: side, cause: "destruction" }));
      destroyPieceBatch(s, k, `${command.actionId}:destruction`, "deathwing:destruction", committed);
      endsTurn = true;
      break;
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
      const processed = copy(k.processedActions), used = { ...k.rewindUsed, [side]: true          }, history = k.history;
      for (const key of Object.keys(s)) delete (s                                      )[key];
      Object.assign(s, copy(previous.state));
      const restoredSecret = copy(previous.secret);
      for (const key of Object.keys(k)) delete (k                                      )[key];
      Object.assign(k, restoredSecret, { processedActions: processed, rewindUsed: used, history, replay: { pieceId: previous.pieceId, deadlineAt: now + Math.min(10_000, Math.max(0, previous.remainingMs)) } });
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
      requireRule(to.x >= 0 && to.x <= 8 && to.y >= 0 && to.y <= 9 && !samePosition(p, to) && Math.abs(p.x - to.x) + Math.abs(p.y - to.y) <= 3 && !s.warps?.some(w => samePosition(w, to)), "INVALID_BOMB_TARGET", "目标须在曼哈顿距离3内且非自身或已有扭曲");
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
      wind.uses += 1; wind.activatedOnTurn = formalTurn(s, side); wind.readyOnTurn = formalTurn(s, side) + 6;
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
      endSkillTurn(s, k, side, randomInt);
    } else closeDirectDeaths(s, k, side);
  }
  k.processedActions[command.actionId] = s.revision;
  return { state: secretOnly ? copy(state) : s, secret: k, duplicate: false };
}

export function ownerHeroSecrets(secret             , side      )                                                    {
  return secret.wind?.[side] ? { wind: copy(secret.wind[side]) } : {};
}
