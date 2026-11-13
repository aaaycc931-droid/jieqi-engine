import { RuleError } from "./errors.ts";
import { selectedHeroId, validateHeroForms } from "./hero-forms.ts";
import { standardH10PreparationScope, windPreparationCoverage } from "./research-source-context.ts";
import { hasStealthEffect } from "./rules.ts";
import { getController } from "./slots.ts";
import { isBoardPiece } from "./spaces.ts";
import type { GameState, SecretState, Side, RandomInt } from "./types.ts";

function requireT0(state: GameState, secret: SecretState, side: Side): void {
  if (!standardH10PreparationScope()) throw new RuleError("MODE_ADAPTATION_PENDING", "首次影准备仅获准精确普通研究");
  validateHeroForms(state, secret);
  if (state.gameMode !== "xiangqi" || side !== "black" || selectedHeroId(state, side) !== "wind" || state.revision !== 0 ||
      state.turnLifecycle || Object.values(state.formalTurns ?? {}).some(n => n > 0))
    windPreparationCoverage("仅覆盖普通H02/H10/M04正式回合前的首次准备");
  const wind = secret.wind?.[side];
  if (!wind || wind.uses !== 0 || wind.hostId || wind.activatedOnTurn !== undefined)
    throw new RuleError("PREPARATION_LOCKED", "首次影已完成或准备状态不匹配");
}

function eligible(state: GameState, secret: SecretState, side: Side) {
  const decoy = secret.wind?.[side]?.decoyId;
  return state.pieces.filter(p => isBoardPiece(p) && !p.faceDown && p.color === side && getController(p) === side &&
    p.id !== decoy && p.type !== "general" && !hasStealthEffect(state, p.id)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function binding(pool: ReturnType<typeof eligible>): string { return JSON.stringify(pool.map(p => [p.id, p.x, p.y])); }

/** Unbiased when RandomInt is unbiased. Default room RNG uses rejection sampling.
 * Stable bodies, not piece types; each ordered triple has probability 1/(n(n-1)(n-2)). */
export function sampleThreeDistinctBodies(ids: readonly string[], random: RandomInt): string[] {
  if (ids.length < 3) windPreparationCoverage("少于三个候选的产品规则尚未确认");
  if (new Set(ids).size !== ids.length) windPreparationCoverage("候选本体ID不唯一");
  const remaining = [...ids], result: string[] = [];
  for (let i = 0; i < 3; i++) {
    const index = random(remaining.length);
    if (!Number.isInteger(index) || index < 0 || index >= remaining.length) throw new RangeError("H10候选随机数超出范围");
    result.push(remaining.splice(index, 1)[0]);
  }
  return result;
}

export function beginWindPreparation(state: GameState, secret: SecretState, side: Side, random: RandomInt): void {
  requireT0(state, secret, side);
  const pool = eligible(state, secret, side), poolBinding = binding(pool), prior = secret.windPreparation?.[side];
  if (prior) {
    if (prior.poolBinding !== poolBinding || prior.completed) windPreparationCoverage("同阶段候选变化尚未确认");
    return; // Retries never reroll a still-valid offer.
  }
  const candidateIds = sampleThreeDistinctBodies(pool.map(p => p.id), random);
  (secret.windPreparation ??= {})[side] = { candidateIds, poolBinding };
}

export function chooseWindPreparation(state: GameState, secret: SecretState, side: Side, pieceId?: string): void {
  requireT0(state, secret, side);
  const offer = secret.windPreparation?.[side];
  if (!offer || offer.completed) throw new RuleError("HERO_PREPARATION_REQUIRED", "首次影候选尚未生成");
  if (offer.poolBinding !== binding(eligible(state, secret, side))) windPreparationCoverage("同阶段候选失效或移动的规则尚未确认");
  if (!pieceId || !offer.candidateIds.includes(pieceId)) throw new RuleError("INVALID_SHADOW_TARGET", "必须选择本次三个候选之一");
  const wind = secret.wind![side]!;
  wind.hostId = pieceId; wind.uses = 1; wind.activatedOnTurn = 0; wind.readyOnTurn = 8;
  secret.windPreparation![side] = { candidateIds: [], poolBinding: "", completed: true };
}

/** A temporary owner-only locator. No board mark survives the successful choice. */
export function ownWindPreparation(state: GameState, secret: SecretState, side: Side) {
  const offer = secret.windPreparation?.[side];
  if (!offer || offer.completed) return undefined;
  const pool = eligible(state, secret, side);
  if (offer.poolBinding !== binding(pool)) windPreparationCoverage("候选变化后的展示未获准");
  return { candidates: offer.candidateIds.map(pieceId => {
    const p = pool.find(p => p.id === pieceId)!; return { pieceId, x: p.x, y: p.y };
  }) };
}
