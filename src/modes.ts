import { RuleError } from "./errors.ts";
import type { FeatureRules, GameModeId } from "./types.ts";

export const GAME_MODE_IDS: readonly GameModeId[] = ["jieqi", "half_chaos", "xiangqi"];
export const GAME_MODES = {
  jieqi: { name: "现有揭棋", description: "双方30枚非将帅全局混洗，揭示后可能倒戈。", featuresReady: true },
  half_chaos: { name: "半混乱揭棋", description: "双方各自混洗15枚非将帅暗棋，基础揭示不倒戈。", featuresReady: false },
  xiangqi: { name: "普通象棋", description: "全棋明置，固定布局；士限九宫，象不过河。", featuresReady: false },
} as const;

export function normalizeGameMode(value: unknown): GameModeId {
  if (value === undefined) return "jieqi";
  if (!GAME_MODE_IDS.includes(value as GameModeId)) throw new RuleError("INVALID_GAME_MODE", "未知游戏模式");
  return value as GameModeId;
}

export function requireModeAdaptationReady(mode: unknown): void {
  const id = normalizeGameMode(mode);
  if (!GAME_MODES[id].featuresReady) {
    throw new RuleError("MODE_ADAPTATION_PENDING", "该模式的英雄与畸变尚待独立适配，暂未开放完整对局");
  }
}

/** 新模式保留系统，完整适配未确认时拒绝启动组合，不自行决定技能效果。 */
export function requireModeFeatureAdaptation(mode: unknown, rules: FeatureRules = {}): void {
  normalizeGameMode(mode);
  if (rules.mutation || Object.values(rules.heroes ?? {}).some(Boolean)) requireModeAdaptationReady(mode);
}
