import { RuleError } from "./errors.js";


/** 同步权威栈的开放批次，不序列化到任何快照。所有死亡派生共用此屏障。 */
export const openDestructionBatches = new WeakMap                                                              ();
export function requireClosedDestructionBatch(state           )       {
  if (openDestructionBatches.has(state)) throw new RuleError("DESTRUCTION_BATCH_OPEN", "必须闭合整个消灭批次后才处理后续触发或终局");
}
