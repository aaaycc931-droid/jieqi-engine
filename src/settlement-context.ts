import { RuleError } from "./errors.ts";
import type { DestructionTarget, GameState } from "./types.ts";

/** 同步权威栈的开放批次，不序列化到任何快照。所有死亡派生共用此屏障。 */
export const openDestructionBatches = new WeakMap<GameState, { batchId: string; targets: DestructionTarget[] }>();
export function requireClosedDestructionBatch(state: GameState): void {
  if (openDestructionBatches.has(state)) throw new RuleError("DESTRUCTION_BATCH_OPEN", "必须闭合整个消灭批次后才处理后续触发或终局");
}
