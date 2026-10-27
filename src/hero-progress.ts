import { RuleError } from "./errors.ts";
import { requireClosedDestructionBatch } from "./settlement-context.ts";
import { selectedHeroId, selectedHeroSelection, validateHeroForms } from "./hero-forms.ts";
import { getController, getCurrentPieceType, otherSide } from "./slots.ts";
import { isBoardPiece, isGround, isRiver } from "./spaces.ts";
import { effectiveIdentity, formalTurn, markRevealed } from "./settlement.ts";
import type { GameState, PieceType, RandomInt, SecretState, Side } from "./types.ts";
export const TRAINING_COST: Partial<Record<PieceType, number>> = { pawn: 2, advisor: 2, elephant: 3, horse: 5, cannon: 6, rook: 6 };
function trainingCoverage(message: string): never {
  const error = new Error(message); error.name = "TrainingCoverageError"; throw error;
}
export function initializeTrainingOrigins(state: GameState, secret: SecretState): void {
  if (secret.trainingOriginalSides || !["red", "black"].some(side => selectedHeroId(state, side as Side) === "sky_admiral")) return;
  secret.trainingOriginalSides = Object.fromEntries(state.pieces.filter(isBoardPiece).map(p => [p.id, effectiveIdentity(p, secret, "hero:sky_admiral:training").color]));
}
function trainingPool(state: GameState, secret: SecretState, side: Side, type: PieceType) {
  const origins = secret.trainingOriginalSides ?? Object.fromEntries(state.pieces.filter(isBoardPiece).map(p => [p.id, effectiveIdentity(p, secret, "hero:sky_admiral:training").color]));
  return state.pieces.filter(isBoardPiece).filter(p => origins[p.id] === side &&
    effectiveIdentity(p, secret, "hero:sky_admiral:training").type === type);
}
function selectTrainingBody(state: GameState, secret: SecretState, side: Side, type: PieceType, random: RandomInt): string {
  const pool = trainingPool(state, secret, side, type);
  // Empty-pool consumption/feedback is not a selected gameplay policy.
  if (!pool.length) trainingCoverage("H15无候选的扣次与反馈分支尚未覆盖");
  const index = random(pool.length);
  if (!Number.isInteger(index) || index < 0 || index >= pool.length) throw new RangeError("H15征募随机数超出范围");
  return pool[index].id;
}
export function startTraining(state: GameState, secret: SecretState, side: Side, type: PieceType | undefined, random: RandomInt): void {
  validateHeroForms(state, secret);
  if (selectedHeroId(state, side) !== "sky_admiral") throw new RuleError("WRONG_HERO", "英雄没有征兵技能");
  const runtime = state.heroRuntime?.[side];
  if (runtime?.used || runtime?.trainingType || secret.training?.[side]) throw new RuleError("SKILL_USED", "本局训练机会已用");
  if (!type || TRAINING_COST[type] === undefined) throw new RuleError("INVALID_TRAINING_TYPE", "请选择普通非将帅兵种");
  const pieceId = selectTrainingBody(state, secret, side, type, random);
  initializeTrainingOrigins(state, secret);
  const current = (state.heroRuntime ??= {})[side] ??= {};
  current.trainingType = type as Exclude<PieceType, "general">; current.used = true;
  (secret.training ??= {})[side] = { type: type as Exclude<PieceType, "general">, pieceId, progress: 0 };
}
/** Reconcile only the three source-resolved H06/H15 lifecycle branches. */
export function reconcileTrainingRewind(currentState: GameState, currentSecret: SecretState, restoredState: GameState, restoredSecret: SecretState): void {
  for (const side of ["red", "black"] as const) {
    if (selectedHeroId(currentState, side) !== "sky_admiral") continue;
    const now = currentSecret.training?.[side], past = restoredSecret.training?.[side];
    if (!now && !past) continue;
    if ((currentSecret.timelineEpoch ?? 0) !== (restoredSecret.timelineEpoch ?? 0)) trainingCoverage("H15回溯不能跨洗牌历史屏障");
    if (now?.failed && now.failureCause === "pregraduation_death" && past && !past.failed && !past.graduated &&
        past.pieceId === now.pieceId && past.type === now.type) {
      (restoredSecret.training ??= {})[side] = { ...now };
      const runtime = (restoredState.heroRuntime ??= {})[side] ??= {};
      runtime.used = true; runtime.trainingType = now.type;
      continue;
    }
    const currentPiece = currentState.pieces.find(p => p.id === now?.pieceId);
    const pastPiece = restoredState.pieces.find(p => p.id === now?.pieceId);
    if (!now || now.failed || now.graduated || !currentPiece || !pastPiece || getController(currentPiece) !== getController(pastPiece)) {
      trainingCoverage("H15回溯的毕业、其他失败或控制变换分支尚未覆盖");
    }
    if (past && !past.failed && !past.graduated && past.pieceId === now.pieceId && past.type === now.type) continue;
    if (!past && !restoredState.heroRuntime?.[side]?.used && !restoredState.heroRuntime?.[side]?.trainingType) continue;
    trainingCoverage("H15回溯的绑定转换分支尚未覆盖");
  }
}
/** After H11's real identity rebuild, before the next ordinary begin. */
export function rebindTrainingAfterShuffle(state: GameState, secret: SecretState, random: RandomInt): void {
  if (!["red", "black"].some(side => selectedHeroId(state, side as Side) === "sky_admiral")) return;
  secret.trainingOriginalSides = Object.fromEntries(state.pieces.filter(isBoardPiece).map(p => [p.id, effectiveIdentity(p, secret, "hero:sky_admiral:training").color]));
  for (const side of ["red", "black"] as const) {
    const training = secret.training?.[side];
    if (!training || training.failed || training.graduated) continue;
    if (state.gameMode === "half_chaos") continue; // Its confirmed stable-body branch.
    if (state.gameMode === "xiangqi") trainingCoverage("普通模式H11训练绑定适配尚未覆盖");
    training.pieceId = selectTrainingBody(state, secret, side, training.type, random);
  }
}
export function configureHeroPreparation(state: GameState, secret: SecretState, side: Side, choice: { blade?: "left" | "right"; trainingType?: PieceType }, random: RandomInt = max => Math.floor(Math.random() * max)): void {
  validateHeroForms(state, secret);
  if (state.revision !== 0 || state.turnLifecycle || Object.values(state.formalTurns ?? {}).some(n => n > 0)) throw new RuleError("PREPARATION_LOCKED", "只能在开局准备期确定");
  const hero = selectedHeroId(state, side), runtime = (state.heroRuntime ??= {})[side] ??= {};
  if (hero === "single_blade") {
    if (runtime.blade) throw new RuleError("PREPARATION_LOCKED", "刃侧已经确定");
    if (choice.blade !== "left" && choice.blade !== "right") throw new RuleError("INVALID_BLADE", "请选择左刃或右刃");
    runtime.blade = choice.blade;
  } else if (hero === "sky_admiral") {
    startTraining(state, secret, side, choice.trainingType, random);
  } else throw new RuleError("WRONG_HERO", "当前英雄没有此准备选项");
}
export function settleTrainingDeaths(state: GameState, secret: SecretState, random: RandomInt): void {
  for (const side of ["red", "black"] as const) {
    const training = secret.training?.[side];
    if (training && !training.graduated && !training.failed && training.pieceId && !state.pieces.some(p => p.id === training.pieceId)) {
      training.failed = true; training.failureCause = "pregraduation_death";
    }
  }
}
export function advanceTraining(state: GameState, secret: SecretState, side: Side, random: RandomInt): void {
  settleTrainingDeaths(state, secret, random);
  const training = secret.training?.[side];
  if (!training || training.failed || training.graduated || !training.pieceId) return;
  training.progress++;
  if (training.progress < TRAINING_COST[training.type]!) return;
  let p = state.pieces.find(p => p.id === training.pieceId)!;
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
export function strongBladeSide(state: GameState, side: Side, x: number): boolean {
  const blade = state.heroRuntime?.[side]?.blade;
  const ownX = side === "red" ? x : 8 - x;
  return blade === "left" ? ownX < 4 : blade === "right" ? ownX > 4 : false;
}
export function qualifyRiverArrival(state: GameState, side: Side): void {
  const last = state.lastMove, p = state.pieces.find(p => p.id === last?.pieceId), selection = selectedHeroSelection(state, side);
  if (selection?.heroId !== "jiang_he" || !last?.landed || last.classification?.source !== "ordinary" || last.classification.opportunity !== "main" || !p || !isGround(p) || getController(p) !== side || getCurrentPieceType(p) === "general" || ![4, 5].includes(p.y)) return;
  state.effectsByPieceId ??= {}; (state.effectsByPieceId[p.id] ??= {}).riverQualified = true;
}
/** 整个原子结束后按死亡瞬间的公开控制方统一入账，不能由秘密阵营改变收益。 */
export function settleHeroDeathResources(state: GameState): void {
  requireClosedDestructionBatch(state);
  const events = (state.automaticEvents ?? []).filter(e => e.kind.startsWith("destroy:") && !e.resourceHandled);
  for (const side of ["red", "black"] as const) {
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
