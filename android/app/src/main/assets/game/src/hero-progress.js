import { RuleError } from "./errors.js";
import { requireClosedDestructionBatch } from "./settlement-context.js";
import { selectedHeroId, selectedHeroSelection, validateHeroForms } from "./hero-forms.js";
import { getController, getCurrentPieceType, otherSide } from "./slots.js";
import { isBoardPiece, isGround, isRiver } from "./spaces.js";
import { effectiveIdentity, formalTurn, markRevealed } from "./settlement.js";

export const TRAINING_COST                                     = { pawn: 2, advisor: 2, elephant: 3, horse: 5, cannon: 6, rook: 6 };
function selectTraining(state           , secret             , side      , random           )       {
  const training = secret.training [side] ;
  const pool = state.pieces.filter(p => isBoardPiece(p)).filter(p => { const identity = effectiveIdentity(p, secret, "hero:sky_admiral:training"); return identity.color === side && identity.type === training.type; });
  training.progress = 0; delete training.pieceId;
  if (pool.length) { training.pieceId = pool[random(pool.length)].id; delete training.failed; }
  else training.failed = true;
}
export function configureHeroPreparation(state           , secret             , side      , choice                                                        , random            = max => Math.floor(Math.random() * max))       {
  validateHeroForms(state, secret);
  if (state.revision !== 0 || state.turnLifecycle || Object.values(state.formalTurns ?? {}).some(n => n > 0)) throw new RuleError("PREPARATION_LOCKED", "只能在开局准备期确定");
  const hero = selectedHeroId(state, side), runtime = (state.heroRuntime ??= {})[side] ??= {};
  if (hero === "single_blade") {
    if (runtime.blade) throw new RuleError("PREPARATION_LOCKED", "刃侧已经确定");
    if (choice.blade !== "left" && choice.blade !== "right") throw new RuleError("INVALID_BLADE", "请选择左刃或右刃");
    runtime.blade = choice.blade;
  } else if (hero === "sky_admiral") {
    if (runtime.trainingType) throw new RuleError("PREPARATION_LOCKED", "培养兵种已经确定");
    if (!choice.trainingType || TRAINING_COST[choice.trainingType] === undefined) throw new RuleError("INVALID_TRAINING_TYPE", "请选择普通非将帅兵种");
    runtime.trainingType = choice.trainingType; secret.training ??= {}; secret.training[side] = { type: choice.trainingType, progress: 0 };
    selectTraining(state, secret, side, random);
  } else throw new RuleError("WRONG_HERO", "当前英雄没有此准备选项");
}
export function settleTrainingDeaths(state           , secret             , random           )       {
  for (const side of ["red", "black"]         ) {
    const training = secret.training?.[side];
    if (training && !training.graduated && !training.failed && training.pieceId && !state.pieces.some(p => p.id === training.pieceId)) selectTraining(state, secret, side, random);
  }
}
export function advanceTraining(state           , secret             , side      , random           )       {
  settleTrainingDeaths(state, secret, random);
  const training = secret.training?.[side];
  if (!training || training.failed || training.graduated || !training.pieceId) return;
  training.progress++;
  if (training.progress < TRAINING_COST[training.type] ) return;
  let p = state.pieces.find(p => p.id === training.pieceId) ;
  if (p.faceDown) {
    const identity = effectiveIdentity(p, secret, "hero:sky_admiral:training");
    p = { ...p, faceDown: false, ...identity }; state.pieces[state.pieces.findIndex(q => q.id === p.id)] = p;
    delete secret.identities[p.id]; markRevealed(state, secret, p.id);
  }
  delete p.river; p.layer = "air";
  state.effectsByPieceId ??= {}; Object.assign(state.effectsByPieceId[p.id] ??= {}, { flight: { remainingOwnerTurns: 3, source: "sky_admiral" }, intangible: true, immuneCrush: true });
  delete state.effectsByPieceId[p.id].infection;
  training.graduated = true;
}
export function strongBladeSide(state           , side      , x        )          {
  const blade = state.heroRuntime?.[side]?.blade;
  const ownX = side === "red" ? x : 8 - x;
  return blade === "left" ? ownX < 4 : blade === "right" ? ownX > 4 : false;
}
export function qualifyRiverArrival(state           , side      )       {
  const last = state.lastMove, p = state.pieces.find(p => p.id === last?.pieceId), selection = selectedHeroSelection(state, side);
  if (selection?.heroId !== "jiang_he" || !last?.landed || last.classification?.source !== "ordinary" || last.classification.opportunity !== "main" || !p || !isGround(p) || getController(p) !== side || getCurrentPieceType(p) === "general" || ![4, 5].includes(p.y)) return;
  state.effectsByPieceId ??= {}; (state.effectsByPieceId[p.id] ??= {}).riverQualified = true;
}
/** 整个原子结束后按死亡瞬间的公开控制方统一入账，不能由秘密阵营改变收益。 */
export function settleHeroDeathResources(state           )       {
  requireClosedDestructionBatch(state);
  const events = (state.automaticEvents ?? []).filter(e => e.kind.startsWith("destroy:") && !e.resourceHandled);
  for (const side of ["red", "black"]         ) {
    if (selectedHeroId(state, side) !== "berserker") continue;
    const runtime = (state.heroRuntime ??= {})[side] ??= {};
    const relevant = events.filter(e => e.side === otherSide(side));
    if (state.featureRules?.mutation !== "chaos") runtime.will = (runtime.will ?? 0) + relevant.reduce((sum, _, i) => sum + (i === 0 ? 3 : i === 1 ? 2 : 1), 0);
    else {
      const actor = state.lastMove?.actingSide;
      const direct = events.filter(e => e.deathRecord?.capturedBy === side && actor === side && ["destroy:attack", "destroy:crush"].includes(e.kind));
      runtime.will = (runtime.will ?? 0) + direct.reduce((sum, e) => sum + (e.wasCovered ? e.side === side ? 2 : 3 : e.side === side ? 0 : 1), 0);
    }
  }
  for (const e of events) e.resourceHandled = true;
}
