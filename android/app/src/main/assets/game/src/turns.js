import { RuleError } from "./errors.js";


export function enterTurnPhase(state           , phase                 )       {
  const turn = state.turnLifecycle;
  if (!turn || turn.phase === phase) return;
  const phases                    = ["turn_start", "before_main", "main_action", "atom_closure", "turn_end"];
  if (phases.indexOf(phase) !== phases.indexOf(turn.phase) + 1) {
    throw new RuleError("INVALID_TURN_PHASE", "正式回合阶段不能跳过或倒退");
  }
  turn.phase = phase;
  turn.phases.push(phase);
}

export function recordAction(state           , action              )       {
  if (action.countsAsFormalTurn !== (action.opportunity === "main") ||
      action.source === "skill_derived" && action.tier === 1 ||
      action.opportunity === "extra" && action.keywords.includes("占步")) {
    throw new RuleError("INVALID_ACTION_CLASSIFICATION", "行动来源、层级与正式回合推进权限不一致");
  }
  if (action.opportunity === "main") {
    if (state.turnLifecycle?.phase !== "before_main") throw new RuleError("MAIN_ACTION_USED", "当前正式回合没有未使用的主行动机会");
    state.turnLifecycle.mainActionId = action.actionId;
    state.turnLifecycle.mainPieceId = action.pieceId;
    enterTurnPhase(state, "main_action");
    state.actionRecords = [structuredClone(action)];
  } else if (action.opportunity === "before_main") {
    if (state.turnLifecycle?.phase !== "before_main") throw new RuleError("INVALID_PRE_MAIN_WINDOW", "只能在主行动前发动");
    state.actionRecords = [structuredClone(action)];
  } else {
    state.actionRecords = [...(state.actionRecords ?? []), structuredClone(action)];
  }
}

export function closeMainActionAtom(state           , actionId        )       {
  if (state.turnLifecycle?.mainActionId === actionId && state.turnLifecycle.phase === "main_action") enterTurnPhase(state, "atom_closure");
}

export function actionFields(classification                      ) {
  return { tier: classification.tier, keywords: [...classification.keywords], countsAsFormalTurn: classification.countsAsFormalTurn, classification: structuredClone(classification) };
}

/** 只选紧接的正式主行动，不先筛Ⅰ级再跨回合搜索。兼容有明确tier的旧快照。 */
export function previousFormalAction(secret             , side       )                                   {
  return [...(secret.history ?? [])].reverse().find(h =>
    (!side || h.actingSide === side) &&
    !h.state.forcedDefense && !h.state.flowDance &&
    (!h.classification || h.classification.opportunity === "main" && h.classification.countsAsFormalTurn));
}

export function isOrdinaryFormalAction(action                      )          {
  const c = action.classification;
  return action.tier === 1 && (!c || c.tier === 1 && c.source === "ordinary" && c.opportunity === "main" && c.countsAsFormalTurn && !c.forced);
}

export function movementClassification(state           , attack         , specialPath         , child                              )                       {
  const keyword = attack ? "进攻" : "移动";
  if (child) return { tier: 3, keywords: [keyword], source: "skill_derived", opportunity: "child", countsAsFormalTurn: false, ...child };
  if (state.forcedDefense) return { tier: 3, keywords: [keyword, "额外", "强迫"], source: "hero", opportunity: "extra", forced: true, countsAsFormalTurn: false, parentActionId: state.turnLifecycle?.mainActionId };
  return { tier: specialPath ? 2 : 1, keywords: [keyword], source: specialPath ? "mutation" : "ordinary", opportunity: "main", countsAsFormalTurn: true };
}
