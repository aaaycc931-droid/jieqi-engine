import { RuleError } from "./errors.ts";
import { requireClosedDestructionBatch } from "./settlement-context.ts";
import { getController, isInsideBoard } from "./slots.ts";
import { isGround } from "./spaces.ts";
import type { GameState, GhostKind, GhostObject, GhostObjectSpec, GhostQuery, Side } from "./types.ts";

function requireKind(kind: unknown): asserts kind is GhostKind {
  if (kind !== "ghost" && kind !== "inner_ghost") throw new RuleError("GHOST_KIND_REQUIRED", "必须精确指定亡魂或里亡魂");
}
function requireOwner(owner: unknown): asserts owner is Side {
  if (owner !== "red" && owner !== "black") throw new RuleError("GHOST_OWNER_REQUIRED", "亡魂归属须为公开红/黑方");
}
/** 唯一旧快照兼容：没有种类的既有亡魂就是普通亡魂，不推定里形态。 */
export function getGhostKind(object: GhostObject): GhostKind {
  const kind = object.kind ?? "ghost";
  requireKind(kind);
  return kind;
}
function matches(object: GhostObject, query: GhostQuery): boolean {
  return getGhostKind(object) === query.kind && (!query.owner || object.owner === query.owner) &&
    (!query.source || object.source === query.source) &&
    (!query.position || isInsideBoard(query.position) && object.position.x === query.position.x && object.position.y === query.position.y);
}
function requireQuery(query: GhostQuery): void {
  requireKind(query.kind);
  if (query.owner !== undefined) requireOwner(query.owner);
}
/** 精确名称查询，默认不将两种对象或不同归属的资源混在一起。 */
export function getGhostObjects(state: Pick<GameState, "ghosts">, query: GhostQuery): GhostObject[] {
  requireClosedDestructionBatch(state as GameState);
  requireQuery(query);
  return state.ghosts?.filter(g => g.remaining > 0 && matches(g, query)) ?? [];
}
/** 资源来源查询还必须给出归属；仅返回对象，不赋予任何英雄收益或爆发效果。 */
export function getGhostResourceObjects(state: Pick<GameState, "ghosts">, query: GhostQuery & { owner: Side }): GhostObject[] {
  requireOwner(query.owner);
  return structuredClone(getGhostObjects(state, query));
}

/** 同类同方同格的合并方式必须由来源明确给出，不能从另一类借层或寿命。 */
export function putGhostObject(state: GameState, spec: GhostObjectSpec, conflict: "reject" | "replace" | "add_layers"): GhostObject {
  requireClosedDestructionBatch(state);
  requireKind(spec.kind); requireOwner(spec.owner);
  if (!isInsideBoard(spec.position) || !Number.isInteger(spec.remaining) || spec.remaining <= 0 ||
      typeof spec.source !== "string" || !spec.source.trim() ||
      spec.layers !== undefined && (!Number.isInteger(spec.layers) || spec.layers <= 0)) throw new RuleError("INVALID_GHOST_OBJECT", "亡魂对象须有明确来源、标准棋格及正整数寿命/来源层数");
  if (!["reject", "replace", "add_layers"].includes(conflict)) throw new RuleError("GHOST_CONFLICT_POLICY", "同类对象冲突须由来源明确处理");
  const existing = state.ghosts?.find(g => matches(g, { kind: spec.kind, owner: spec.owner, position: spec.position }));
  if (existing && conflict === "reject") throw new RuleError("GHOST_OBJECT_EXISTS", "同类同方同格对象已存在");
  const next = structuredClone(spec);
  if (existing && conflict === "add_layers") {
    if (existing.source !== spec.source || existing.layers === undefined || spec.layers === undefined) throw new RuleError("GHOST_LAYERS_UNDEFINED", "来源未定义同类层数，不能借用其他对象叠层");
    next.layers = existing.layers + spec.layers;
  }
  state.ghosts ??= [];
  if (existing) state.ghosts[state.ghosts.indexOf(existing)] = next;
  else state.ghosts.push(next);
  return structuredClone(next);
}

/** 普通感染只由有效普通亡魂支撑，里亡魂不提供感染资源。 */
export function reconcileGhostInfections(state: GameState): void {
  requireClosedDestructionBatch(state);
  for (const [id, effects] of Object.entries(state.effectsByPieceId ?? {})) {
    if (!effects.infection) continue;
    const piece = state.pieces.find(p => p.id === id);
    if (!piece || !isGround(piece) || getController(piece) === effects.infection.owner ||
        !getGhostObjects(state, { kind: "ghost", owner: effects.infection.owner, position: piece }).length) delete effects.infection;
  }
}
export function clearGhostObjects(state: GameState, query: GhostQuery): number {
  requireClosedDestructionBatch(state); requireQuery(query);
  const previous = state.ghosts?.length ?? 0;
  if (state.ghosts) state.ghosts = state.ghosts.filter(g => !matches(g, query));
  if (query.kind === "ghost") reconcileGhostInfections(state);
  return previous - (state.ghosts?.length ?? 0);
}
/** 只有明确“所有亡魂类”的来源才调用该显式双类入口。 */
export function clearAllGhostKinds(state: GameState, filter: Omit<GhostQuery, "kind"> = {}): number {
  return clearGhostObjects(state, { ...filter, kind: "ghost" }) + clearGhostObjects(state, { ...filter, kind: "inner_ghost" });
}
/** 仅推进所点名种类/归属；来源完成后续生成后再协调感染，保持原有结算顺序。 */
export function tickGhostObjects(state: GameState, query: GhostQuery & { owner: Side }): void {
  requireClosedDestructionBatch(state); requireQuery(query); requireOwner(query.owner);
  for (const g of getGhostObjects(state, query)) g.remaining -= 1;
  if (state.ghosts) state.ghosts = state.ghosts.filter(g => !matches(g, query) || g.remaining > 0);
}
