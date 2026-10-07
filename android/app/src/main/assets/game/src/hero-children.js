import { RuleError } from "./errors.js";
import { selectedHeroId } from "./hero-forms.js";
import { getController } from "./slots.js";
import { isGround } from "./spaces.js";
import { getLegalMoves, pieceAt } from "./rules.js";
import { copy, formalTurn, relocatePiece } from "./settlement.js";
import { strongBladeSide } from "./hero-progress.js";
import { applyAuthoritativeMove, finishHeroChildTurn } from "./game.js";
import { recordAction } from "./turns.js";

const requireRule = (ok         , code        , text        ) => { if (!ok) throw new RuleError(code, text); };
export function openHeroChild(state           , side      )          {
  const last = state.lastMove, piece = state.pieces.find(p => p.id === last?.pieceId), hero = selectedHeroId(state, side);
  if (!last || !piece || getController(piece) !== side || !last.classification?.countsAsFormalTurn || last.classification.source !== "ordinary" || last.classification.opportunity !== "main") return false;
  const runtime = state.heroRuntime?.[side], number = formalTurn(state, side) + 1;
  if (hero === "single_blade" && runtime?.bladeTurn !== number && last.landed && last.keywords?.includes("移动") && strongBladeSide(state, side, last.from.x) && strongBladeSide(state, side, piece.x) && isGround(piece)) {
    state.pendingHeroChild = { kind: "blade", side, pieceId: piece.id, parent: copy(last) }; return true;
  }
  if (hero === "berserker" && runtime?.chargeTurn !== number && last.tier === 1 && state.automaticEvents?.some(e => e.kind.startsWith("destroy:") && e.side !== side && e.deathRecord?.capturedBy === side && ["destroy:attack", "destroy:crush"].includes(e.kind))) {
    state.pendingHeroChild = { kind: "charge", side, pieceId: piece.id, parent: copy(last) }; return true;
  }
  return false;
}
export function applyHeroChild(state           , secret             , command                    , now        , random           )             {
  const s = copy(state), k = copy(secret), pending = s.pendingHeroChild;
  requireRule(pending && s.status === "playing" && s.turn === pending.side, "NO_CHILD_WINDOW", "没有该英雄的衍生窗口");
  requireRule(command.expectedRevision === state.revision, "STALE_REVISION", "客户端版本过期");
  const side = pending .side, piece = s.pieces.find(p => p.id === pending .pieceId), runtime = (s.heroRuntime ??= {})[side] ??= {};
  if (command.skip) { delete s.pendingHeroChild; s.revision++; }
  else if (pending .kind === "blade") {
    requireRule(command.ability === "blade_shift" && piece && command.to && command.to.y === piece.y && Math.abs(command.to.x - piece.x) === 1 && strongBladeSide(s, side, command.to.x), "INVALID_BLADE_SHIFT", "必须同棋横向相邻移置且仍在强侧");
    requireRule(relocatePiece(s, k, piece .id, command.to , "single_blade:shift"), "INVALID_BLADE_SPACE", "移置空间不合法");
    runtime.bladeTurn = formalTurn(s, side) + 1;
    recordAction(s, { tier: 3, keywords: ["移置", "额外"], source: "skill_derived", opportunity: "child", countsAsFormalTurn: false, parentActionId: pending .parent.actionId, actionId: command.actionId, actingSide: side, pieceId: piece .id });
    delete s.pendingHeroChild; s.revision++;
  } else {
    const isWave = pending .kind === "inner_wave", attack = command.ability === "charge_attack", n = runtime.chargeCount ?? 0;
    requireRule(piece && command.to && (isWave ? command.ability === "wave_move" : command.ability === "charge_move" || attack), "INVALID_CHILD_ACTION", "请选择同棋的合法衍生行动");
    if (!isWave) {
      requireRule(s.featureRules?.mutation !== "chaos", "DESIGN_REQUIRED_BRAWL_ENTRY", "乱斗初始付费/发动触发边界未完整定义，当前只结算已确认资源");
      const cost = attack ? 6 + 5 * n : 4 + 3 * n;
      requireRule((runtime.will ?? 0) >= cost, "INSUFFICIENT_WILL", "战意不足");
      runtime.will = (runtime.will ?? 0) - cost; runtime.chargeCount = n + 1; runtime.chargeTurn = formalTurn(s, side) + 1;
    }
    requireRule(Boolean(pieceAt(s, command.to )) === attack, "CHILD_ACTION_KIND", "移动只能选空格，进攻必须选目标");
    delete s.pendingHeroChild;
    const result = applyAuthoritativeMove(s, k, { from: { x: piece .x, y: piece .y }, to: command.to , pieceId: piece .id, actionId: command.actionId, expectedRevision: s.revision }, true, now, { parentActionId: pending .parent.actionId });
    Object.assign(s, result.state); Object.assign(k, result.secret);
  }
  finishHeroChildTurn(s, k, side, pending .parent, now);
  k.processedActions[command.actionId] = s.revision;
  return { state: s, secret: k, duplicate: false };
}
