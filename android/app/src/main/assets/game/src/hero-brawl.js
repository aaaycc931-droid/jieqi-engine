import { RuleError } from "./errors.js";
import { selectedHeroId, validateHeroForms } from "./hero-forms.js";
import { getController } from "./slots.js";
import { pieceAt } from "./rules.js";
import { copy, beginFormalTurn, formalTurn } from "./settlement.js";
import { applyAuthoritativeMove, finishHeroChildTurn } from "./game.js";

const requireRule = (ok         , code        , text        ) => { if (!ok) throw new RuleError(code, text); };
function continueBrawl(result            , side      , parent          , victimId        , wasOwn         , command                    , now        )             {
  const { state: s, secret: k } = result;
  const actor = s.pieces.find(p => p.id === parent.pieceId);
  const killed = s.automaticEvents?.some(e => e.pieceId === victimId && ["destroy:attack", "destroy:crush"].includes(e.kind) && e.deathRecord?.capturedBy === side && e.wasCovered && e.side === side);
  if (wasOwn && killed && s.status === "playing" && actor && getController(actor) === side) {
    s.pendingHeroChild = { kind: "brawl", side, pieceId: actor.id, parent: copy(parent) };
  } else finishHeroChildTurn(s, k, side, parent, now);
  k.processedActions[command.actionId] = s.revision;
  return result;
}
export function applyBrawlStart(state           , secret             , command                    , now        , randomInt           )             {
  validateHeroForms(state, secret);
  requireRule(command.expectedRevision === state.revision, "STALE_REVISION", "客户端版本过期");
  requireRule(state.status === "playing" && !state.forcedDefense && !state.flowDance && !state.pendingShuffle && !state.pendingDescent, "INVALID_PHASE", "只能在正常正式回合主行动前发动乱斗");
  const s = copy(state), k = copy(secret), side = s.turn;
  requireRule(selectedHeroId(s, side) === "berserker" && s.featureRules?.mutation === "chaos", "WRONG_BRAWL_SOURCE", "只有混乱狂战可发动乱斗");
  beginFormalTurn(s, k, randomInt);
  requireRule(s.turnLifecycle?.phase === "before_main", "INVALID_PRE_MAIN_WINDOW", "乱斗占用尚未使用的主行动");
  const actor = s.pieces.find(p => p.id === command.pieceId), target = command.to && pieceAt(s, command.to);
  requireRule(actor && getController(actor) === side && target?.faceDown && getController(target) === side, "INVALID_BRAWL_FIRST_TARGET", "第一刀须同棋合法进攻己方控制暗子");
  const runtime = (s.heroRuntime ??= {})[side] ??= {}, n = runtime.chargeCount ?? 0, cost = 6 + 5 * n;
  requireRule((runtime.will ?? 0) >= cost, "INSUFFICIENT_WILL", "先支付乱斗启动费，第一刀收益不能垫付");
  const classification                       = { tier: 2, keywords: ["进攻", "占步", "耗费"], source: "hero", opportunity: "main", countsAsFormalTurn: true };
  // 入场前检查余额；从结算结果扣费，保留历史快照中真实的入场前余额/共享次数。
  const result = applyAuthoritativeMove(s, k, { from: actor , to: command.to , pieceId: actor .id, actionId: command.actionId, expectedRevision: s.revision }, true, now, { mainClassification: classification });
  const paid = (result.state.heroRuntime ??= {})[side] ??= {};
  paid.will = (paid.will ?? 0) - cost; paid.chargeCount = n + 1; paid.chargeTurn = formalTurn(s, side) + 1;
  return continueBrawl(result, side, copy(result.state.lastMove ), target .id, true, command, now);
}
export function applyBrawlChild(state           , secret             , command                    , now        )             {
  requireRule(command.expectedRevision === state.revision, "STALE_REVISION", "客户端版本过期");
  const s = copy(state), k = copy(secret), pending = s.pendingHeroChild ;
  requireRule(pending.kind === "brawl" && s.status === "playing" && s.turn === pending.side, "NO_CHILD_WINDOW", "没有当前乱斗连斩窗口");
  if (command.skip) {
    delete s.pendingHeroChild; s.revision++;
    finishHeroChildTurn(s, k, pending.side, pending.parent, now);
    k.processedActions[command.actionId] = s.revision;
    return { state: s, secret: k, duplicate: false };
  }
  const actor = s.pieces.find(p => p.id === pending.pieceId), target = command.to && pieceAt(s, command.to);
  requireRule(command.ability === "brawl_attack" && (!command.pieceId || command.pieceId === pending.pieceId) && actor && getController(actor) === pending.side && target?.faceDown, "INVALID_BRAWL_CHILD", "只能由原棋连续合法进攻暗子");
  const own = getController(target ) === pending.side;
  delete s.pendingHeroChild;
  const result = applyAuthoritativeMove(s, k, { from: actor , to: command.to , pieceId: actor .id, actionId: command.actionId, expectedRevision: s.revision }, true, now, { parentActionId: pending.parent.actionId });
  return continueBrawl(result, pending.side, pending.parent, target .id, own, command, now);
}
