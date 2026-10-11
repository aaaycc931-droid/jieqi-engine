import { RuleError } from "./errors.ts";
import type { HeroId, OptionalModeConfig } from "./types.ts";

/** Trusted, synchronous harness capability. Never read from room/client JSON. */
export interface ResearchSourceContext {
  readonly roomId: string;
  readonly actors: Readonly<Record<string, Readonly<{ hero: "night" | "shuffler"; enabled: boolean }>>>;
}
const scopes: ResearchSourceContext[] = [];

export function withResearchSources<T>(context: ResearchSourceContext, operation: () => T): T {
  if (scopes.length) throw new RuleError("RESEARCH_SCOPE_INVALID", "研究上下文不能嵌套覆盖");
  if (!context.roomId || Object.keys(context.actors).length !== 2 ||
      Object.values(context.actors).filter(s => s.hero === "night").length !== 1 ||
      Object.values(context.actors).filter(s => s.hero === "shuffler").length !== 1 ||
      Object.values(context.actors).some(s => typeof s.enabled !== "boolean")) {
    throw new RuleError("RESEARCH_SCOPE_INVALID", "研究范围仅支持H14/H11两个稳定玩家");
  }
  const sealed = Object.freeze({ roomId: context.roomId, actors: Object.freeze(Object.fromEntries(
    Object.entries(context.actors).map(([id, source]) => [id, Object.freeze({ hero: source.hero, enabled: source.enabled })]),
  )) });
  scopes.push(sealed);
  try {
    const result = operation();
    if (result && typeof (result as any).then === "function") throw new TypeError("Research source scope must be synchronous");
    return result;
  } finally { scopes.pop(); }
}

export function researchSources(roomId: string, mode: OptionalModeConfig): ResearchSourceContext | undefined {
  const scope = scopes.at(-1);
  if (!scope) return undefined;
  if (scope.roomId !== roomId || (mode.baseMode ?? "jieqi") !== "jieqi" || !mode.heroesEnabled || !mode.mutationsEnabled) {
    throw new RuleError("RESEARCH_SCOPE_INVALID", "研究上下文不能用于其他房间或未经适配的模式");
  }
  return scope;
}

export function effectiveResearchHero(roomId: string, mode: OptionalModeConfig, actor: string, hero: HeroId): HeroId | undefined {
  const context = researchSources(roomId, mode);
  if (!context) return hero;
  const source = context.actors[actor];
  if (!source || source.hero !== hero) throw new RuleError("RESEARCH_SOURCE_MISMATCH", "研究来源不能改选或借用其他玩家来源");
  return source.enabled ? hero : undefined;
}
