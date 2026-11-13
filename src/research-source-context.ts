import { RuleError } from "./errors.ts";
import { sha256Hex } from "./sha256.ts";
import type { FeatureRules, GameModeId, HeroId, HeroSelection, MutationId, OptionalModeConfig, Side, GameState, SecretState, AssassinationCommand, MoveCommand } from "./types.ts";

// Internal source qualification only. No client field, serialized capability,
// disabled source mask, or product readiness flag grants this authority.
export const HALF_CHAOS_RESEARCH_TUPLES = Object.freeze({
  "HC-ADM-PD-M01": Object.freeze({ red: "qin_long", black: "warrior", mutation: "iron_steed" }),
  "HC-ADM-PD-M04": Object.freeze({ red: "qin_long", black: "warrior", mutation: "war_chariot" }),
  "HC-ADM-DS-D01": Object.freeze({ red: "nozdormu", black: "murozond", mutation: "end_time" }),
} satisfies Record<string, { red: HeroId; black: HeroId; mutation: MutationId }>);
export type HalfChaosResearchTupleId = keyof typeof HALF_CHAOS_RESEARCH_TUPLES;
interface ExactTupleContext { roomId: string; tupleId: HalfChaosResearchTupleId; players: Record<Side, string> }
export const STANDARD_NP_RESEARCH_TUPLE = Object.freeze({ red: "rogue", black: "devout_zealot", mutation: "war_chariot", mode: "xiangqi", variant: "invincible" } as const);
interface StandardNpContext { roomId: string; tupleId: "STD-NP32-AS-AP-ES"; branch: "AS" | "AP" | "ES"; players: Record<Side, string> }
interface StandardH10PreparationContext { roomId: string; tupleId: "STD-H10-PREPARATION"; players: Record<Side, string> }
interface StandardH10ForwardContext { roomId: string; tupleId: "STD-H10-FORWARD-PREFIX"; players: Record<Side, string> }
export const STANDARD_H10_PREPARATION_TUPLE = Object.freeze({ red: "rogue", black: "wind", mutation: "war_chariot", mode: "xiangqi" } as const);
type ExactResearchContext = ExactTupleContext | StandardNpContext | StandardH10PreparationContext | StandardH10ForwardContext;
const issuedTupleCapabilities = new WeakSet<object>();
const issuedTupleRooms = new WeakMap<object, Readonly<ExactResearchContext>>();
let exactScope: Readonly<ExactResearchContext> | undefined;
const exactTuple = (context: ExactResearchContext) => context.tupleId === "STD-NP32-AS-AP-ES" ? STANDARD_NP_RESEARCH_TUPLE : context.tupleId === "STD-H10-PREPARATION" || context.tupleId === "STD-H10-FORWARD-PREFIX" ? STANDARD_H10_PREPARATION_TUPLE : HALF_CHAOS_RESEARCH_TUPLES[context.tupleId];
const exactGameMode = (context: ExactResearchContext) => context.tupleId.startsWith("STD-") ? "xiangqi" : "half_chaos";

/** Internal source-bound T0 only. Does not qualify the conditional R1-R5 tape. */
export function issueOriginalStandardH10Preparation(context: StandardH10PreparationContext, prefixText: string, confirmationText: string): Readonly<StandardH10PreparationContext> {
  if (context.tupleId !== "STD-H10-PREPARATION" ||
      sha256Hex(prefixText) !== "c98c1acc44734b92be785092e6239e28df56c95421f3a21c8e67ace3f21217f4" ||
      sha256Hex(confirmationText) !== "78ec040f646f4cd30df341731e7b457870b26cf0a83616ac7425a89a5919121c")
    throw new RuleError("RESEARCH_SCOPE_INVALID", "H10准备能力必须绑定原合同与首次抽样确认");
  const issued = Object.freeze({ roomId: context.roomId, tupleId: context.tupleId, players: Object.freeze({ ...context.players }) });
  issuedTupleCapabilities.add(issued); return issued;
}
export function withExactStandardH10Preparation<T>(context: StandardH10PreparationContext, operation: () => T): T {
  if (context.tupleId !== "STD-H10-PREPARATION") throw new RuleError("RESEARCH_SCOPE_INVALID", "H10准备能力不能替代其他研究");
  return withExactTuple(context, operation);
}
export function standardH10PreparationScope(): boolean { return exactScope?.tupleId === "STD-H10-PREPARATION" || standardH10ForwardScope(); }
export function standardH10ForwardScope(): boolean { return exactScope?.tupleId === "STD-H10-FORWARD-PREFIX"; }

/** Separate capability: the old T0 authority remains unable to execute moves. */
export function issueOriginalStandardH10Forward(context: StandardH10ForwardContext, prefixText: string, confirmationText: string, atomicText: string): Readonly<StandardH10ForwardContext> {
  if (context.tupleId !== "STD-H10-FORWARD-PREFIX" ||
      sha256Hex(prefixText) !== "c98c1acc44734b92be785092e6239e28df56c95421f3a21c8e67ace3f21217f4" ||
      sha256Hex(confirmationText) !== "78ec040f646f4cd30df341731e7b457870b26cf0a83616ac7425a89a5919121c" ||
      sha256Hex(atomicText) !== "2276b2678a252b2d5dcbdd4b58f8ba34b0a0a3409b6fab65ec7fdc45411b6212")
    throw new RuleError("RESEARCH_SCOPE_INVALID", "H10正式前缀能力必须绑定原8手、首次采样确认与原子合同");
  const issued = Object.freeze({ roomId: context.roomId, tupleId: context.tupleId, players: Object.freeze({ ...context.players }) });
  issuedTupleCapabilities.add(issued); return issued;
}
export function withExactStandardH10Forward<T>(context: StandardH10ForwardContext, operation: () => T): T {
  if (context.tupleId !== "STD-H10-FORWARD-PREFIX") throw new RuleError("RESEARCH_SCOPE_INVALID", "正式前缀不能借用T0能力");
  return withExactTuple(context, operation);
}

// Identity mapping is from the actual standard32 initializer; not synthetic IDs.
export const STANDARD_H10_FORWARD_TAPE = Object.freeze([
  ["covered-25",0,6,0,5], ["covered-01",1,0,0,2],
  ["covered-25",0,5,0,4], ["covered-14",8,3,8,4],
  ["covered-25",0,4,1,4], ["covered-13",6,3,6,4],
  ["covered-15",0,9,0,4], ["covered-14",8,4,8,5],
  ["covered-15",0,4,0,2],
].map(row => Object.freeze(row)));

/** Exact requests only, before clock/authority mutation; no new wire field. */
export function requireStandardH10ForwardAction(room: { updatedAt: number; game?: { state: GameState; secret: SecretState } }, playerId: string, command: MoveCommand | AssassinationCommand, kind: "move" | "assassination", now: number): void {
  if (!standardH10ForwardScope()) return;
  const game = room.game, i = command.expectedRevision, step = STANDARD_H10_FORWARD_TAPE[i];
  const side = i % 2 ? "black" : "red";
  const skill = command as AssassinationCommand;
  if (!game || !Number.isFinite(now) || now < room.updatedAt || !Number.isInteger(i) || !step || playerId !== exactScope!.players[side] || command.actionId !== `h10-forward-${i}` ||
      command.pieceId !== step[0] || command.from.x !== step[1] || command.from.y !== step[2] || command.to.x !== step[3] || command.to.y !== step[4] ||
      kind !== (i === 6 || i === 8 ? "assassination" : "move") ||
      (i === 6 ? skill.source !== "hero" || Boolean(skill.useStrongStrike) : i === 8 ? skill.source !== undefined || skill.useStrongStrike !== true : skill.source !== undefined || Boolean(skill.useStrongStrike)) ||
      game.secret.processedActions[command.actionId] === undefined && (game.state.revision !== i || game.state.turn !== side) ||
      game.state.turnDeadlineAt !== undefined && (!Number.isFinite(game.state.turnDeadlineAt) || now >= game.state.turnDeadlineAt))
    windPreparationCoverage("仅覆盖原8手与R5的及时、同源精确请求");
  const { state, secret } = game, wind = secret.wind?.black;
  if (!modeResearchPermits("xiangqi", state.featureRules) || state.gameMode !== "xiangqi" ||
      !wind || !["covered-10", "covered-11"].includes(wind.hostId ?? "") || wind.uses !== 1 || wind.activatedOnTurn !== 0 || wind.readyOnTurn !== 8 ||
      !secret.windPreparation?.black?.completed || state.pendingShuffle || state.pendingHeroChild || state.pendingDescent || state.forcedDefense || state.flowDance || secret.replay ||
      state.pieces.some(p => p.faceDown || p.layer && p.layer !== "ground") || secret.traps?.length || state.ghosts?.length || state.warps?.length)
    windPreparationCoverage("H10原前缀来源、准备或空间状态超出资格");
}
export function windPreparationCoverage(message: string): never {
  const error = new Error(message); error.name = "WindPreparationCoverageError"; throw error;
}

/** Issuer used only by the internal original-input driver, never a wire API. */
export function issueOriginalHalfChaosTuple(context: ExactTupleContext, initializationText: string, replayText: string, replayId: string): Readonly<ExactTupleContext> {
  const ids = context.tupleId === "HC-ADM-PD-M01" ? ["MA-PD02","MA-PD03","MA-PD06-A","MA-PD06-B"]
    : context.tupleId === "HC-ADM-PD-M04" ? ["MA-PD01","MA-PD04","MA-PD05-A","MA-PD05-B"] : ["MA-DS01-02","MA-DS03","MA-DS04","MA-DS05"];
  if (!HALF_CHAOS_RESEARCH_TUPLES[context.tupleId] || !ids.includes(replayId) ||
      sha256Hex(initializationText) !== "ba8f0a40e19230176df732e267d14b6070778d74886f4c007ea0ff1be4084836" ||
      sha256Hex(replayText) !== "1e213fe2c6db48ab54d15a599023f57ab50f1ecda50e30601ae555fbf88fda68")
    throw new RuleError("RESEARCH_SCOPE_INVALID", "原始研究能力必须绑定精确tuple、回放及不可变输入");
  const issued = Object.freeze({ roomId:context.roomId,tupleId:context.tupleId,players:Object.freeze({...context.players}) });
  issuedTupleCapabilities.add(issued); return issued;
}

/** Only the internal room-owning driver calls this, around one synchronous API. */
export function withExactHalfChaosTuple<T>(context: ExactTupleContext, operation: () => T): T {
  if (!HALF_CHAOS_RESEARCH_TUPLES[context.tupleId]) throw new RuleError("RESEARCH_SCOPE_INVALID", "半混乱能力不能替代其他模式");
  return withExactTuple(context, operation);
}

/** Internal, immutable source-bound ordinary NP32 issuer. Never a wire option. */
export function issueOriginalStandardNpTuple(context: StandardNpContext, contractText: string, rngText: string): Readonly<StandardNpContext> {
  if (context.tupleId !== "STD-NP32-AS-AP-ES" || !["AS", "AP", "ES"].includes(context.branch) ||
      sha256Hex(contractText) !== "be1a9aff0b0f9e3f088afd0ee99c19a140f4690208cedf93f3fe39c3c61c945f" ||
      sha256Hex(rngText) !== "99c58b51bc473cb58793b2ea7f3e5481e27a24608522d9d1da71a579a4ad0e55")
    throw new RuleError("RESEARCH_SCOPE_INVALID", "普通NP32能力必须绑定原三支及不可变来源");
  const issued = Object.freeze({ roomId: context.roomId, tupleId: context.tupleId, branch: context.branch, players: Object.freeze({ ...context.players }) });
  issuedTupleCapabilities.add(issued); return issued;
}
export function withExactStandardNpTuple<T>(context: StandardNpContext, operation: () => T): T {
  if (context.tupleId !== "STD-NP32-AS-AP-ES" || !["AS", "AP", "ES"].includes(context.branch)) throw new RuleError("RESEARCH_SCOPE_INVALID", "普通NP32能力不适用于其他来源");
  return withExactTuple(context, operation);
}
function withExactTuple<T>(context: ExactResearchContext, operation: () => T): T {
  if (!issuedTupleCapabilities.has(context) || scopes.length || exactScope || !exactTuple(context) || !context.roomId ||
      !context.players.red || !context.players.black || context.players.red === context.players.black ||
      Object.keys(context.players).sort().join(",") !== "black,red") throw new RuleError("RESEARCH_SCOPE_INVALID", "研究组合与两个稳定玩家必须精确绑定且不可嵌套");
  exactScope = context;
  try {
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === "function") throw new TypeError("Exact research scope must be synchronous");
    return result;
  } finally { exactScope = undefined; }
}

function exactMode(roomId: string, mode: OptionalModeConfig | undefined): void {
  if (exactScope && (roomId !== exactScope.roomId || mode?.baseMode !== exactGameMode(exactScope) || !mode?.heroesEnabled || !mode?.mutationsEnabled))
    throw new RuleError("RESEARCH_SCOPE_INVALID", "受限研究不能用于其他房间、模式或来源开关");
}

export function requireExactResearchCreate(roomId: string, host: string): void {
  if (exactScope && (roomId !== exactScope.roomId || host !== exactScope.players.red)) throw new RuleError("RESEARCH_SCOPE_INVALID", "原始研究建房必须匹配房间与房主");
}
/** Called by the internal driver only after validating an actual API return. */
export function registerExactResearchRoom(room: object): void {
  if (!exactScope) throw new RuleError("RESEARCH_SCOPE_INVALID", "权威房间注册必须在内部同步能力内完成");
  issuedTupleRooms.set(room,exactScope);
}
export function requireExactResearchRoom(room: {roomId:string;phase?:string;mode:OptionalModeConfig;seats:{host:{playerId:string};guest?:{playerId:string}};game?:{state:{gameMode?:GameModeId;featureRules?:FeatureRules}}}, joiningPlayer?: string, forwardAction?: "move" | "assassination"): void {
  if (!exactScope) {
    const rules = room.game?.state.featureRules;
    const restrictedFeatures = (["half_chaos", "xiangqi"].includes(room.mode?.baseMode ?? "") || ["half_chaos", "xiangqi"].includes(room.game?.state.gameMode ?? "")) &&
      (room.mode?.heroesEnabled || room.mode?.mutationsEnabled || rules?.mutation || Object.values(rules?.heroes ?? {}).some(Boolean) || Object.values(rules?.heroSelections ?? {}).some(Boolean));
    const mode = room.game?.state.gameMode ?? room.mode?.baseMode;
    if (issuedTupleRooms.has(room) || restrictedFeatures && !modeResearchPermits(mode!,rules,room.roomId))
      throw new RuleError("MODE_ADAPTATION_PENDING", "受限研究房间不能脱离内部同步研究能力继续调用");
    return;
  }
  exactMode(room.roomId,room.mode);
  if (issuedTupleRooms.get(room)!==exactScope || room.seats.host.playerId!==exactScope.players.red ||
      room.seats.guest && room.seats.guest.playerId!==exactScope.players.black || joiningPlayer!==undefined && joiningPlayer!==exactScope.players.black)
    throw new RuleError("RESEARCH_SCOPE_INVALID", "研究入口拒绝未登记权威实例、复制房间或错误席位");
  if (exactScope.tupleId === "STD-H10-PREPARATION" && ["playing", "finished"].includes(room.phase ?? ""))
    windPreparationCoverage("本能力只覆盖H10准备，正式行棋、王安全与R5同批结算尚未准入");
  if (standardH10ForwardScope() && ["playing", "finished"].includes(room.phase ?? "") && !forwardAction)
    windPreparationCoverage("正式前缀能力不覆盖计时推进、其他技能或房间生命周期");
}
export function requireExactResearchAssignments(players: Record<Side,string>, heroes: Partial<Record<Side,HeroId>> | undefined): void {
  if (!exactScope) return;
  const tuple = exactTuple(exactScope);
  if ((["red","black"] as const).some(side=>players[side]!==exactScope!.players[side] || heroes?.[side]!==tuple[side]))
    throw new RuleError("RESEARCH_SCOPE_INVALID", "真实猜拳红黑分配必须匹配原始tuple，不能换边入局");
}

export function requireExactResearchSelection(roomId: string, actor: string, selection: HeroSelection): void {
  if (!exactScope) return;
  const side = (["red", "black"] as const).find(s => exactScope!.players[s] === actor);
  const tuple = exactTuple(exactScope);
  const variant = exactScope.tupleId === "STD-NP32-AS-AP-ES" && side === "black" ? "invincible" : undefined;
  if (roomId !== exactScope.roomId || !side || selection.heroId !== tuple[side] || selection.form !== "front" || selection.variant !== variant ||
      selection.packageId !== `${tuple[side]}:front:v1${variant ? ":" + variant : ""}`)
    throw new RuleError("RESEARCH_SOURCE_MISMATCH", "研究选择必须在原时点锁定精确完整包");
}

/** Trusted, synchronous harness capability. Never read from room/client JSON. */
export interface ResearchSourceContext {
  readonly roomId: string;
  readonly mode?: "xiangqi" | "half_chaos";
  readonly actors: Readonly<Record<string, Readonly<{ hero: "night" | "shuffler" | "hunter" | "rogue"; enabled: boolean }>>>;
}
const scopes: ResearchSourceContext[] = [];
export const MODE_RESEARCH_SOURCES = Object.freeze({ xiangqi: Object.freeze(["hunter", "rogue", "shuffler"] as const), half_chaos: Object.freeze(["shuffler"] as const) });

/** Explicit source qualification capability; does not change product readiness. */
export function modeResearchPermits(mode: GameModeId, rules?: FeatureRules, roomId?: string): boolean {
  if (exactScope) {
    if (mode !== exactGameMode(exactScope) || roomId !== undefined && roomId !== exactScope.roomId) return false;
    if (!rules) return true;
    const tuple = exactTuple(exactScope);
    if (rules.mutation !== tuple.mutation || Object.keys(rules.heroes ?? {}).sort().join(",") !== "black,red" ||
        Object.keys(rules.heroSelections ?? {}).sort().join(",") !== "black,red") return false;
    return (["red", "black"] as const).every(side => rules.heroes![side] === tuple[side] &&
      rules.heroSelections![side]?.heroId === tuple[side] && rules.heroSelections![side]?.form === "front" &&
      rules.heroSelections![side]?.packageId === `${tuple[side]}:front:v1${exactScope!.tupleId === "STD-NP32-AS-AP-ES" && side === "black" ? ":invincible" : ""}` &&
      rules.heroSelections![side]?.variant === (exactScope!.tupleId === "STD-NP32-AS-AP-ES" && side === "black" ? "invincible" : undefined));
  }
  const scope = scopes.at(-1);
  if (!scope?.mode || scope.mode !== mode || roomId !== undefined && scope.roomId !== roomId) return false;
  if (!rules) return true;
  const enabled = Object.values(scope.actors).filter(s => s.enabled).map(s => s.hero);
  if (rules.mutation || Object.values(rules.heroes ?? {}).some(h => h && !enabled.includes(h as any))) return false;
  return Object.values(rules.heroSelections ?? {}).every(s => !s || enabled.includes(s.heroId as any) && s.form === "front" && !s.variant);
}

export function withResearchSources<T>(context: ResearchSourceContext, operation: () => T): T {
  if (scopes.length || exactScope) throw new RuleError("RESEARCH_SCOPE_INVALID", "研究上下文不能嵌套覆盖");
  if (!context.roomId || Object.keys(context.actors).length !== 2 ||
      (context.mode ? !MODE_RESEARCH_SOURCES[context.mode] || Object.values(context.actors).some(s => !(MODE_RESEARCH_SOURCES[context.mode] as readonly string[]).includes(s.hero)) :
        Object.values(context.actors).filter(s => s.hero === "night").length !== 1 || Object.values(context.actors).filter(s => s.hero === "shuffler").length !== 1) ||
      Object.values(context.actors).some(s => typeof s.enabled !== "boolean")) {
    throw new RuleError("RESEARCH_SCOPE_INVALID", "研究上下文必须匹配已限定的模式、来源和两个稳定玩家");
  }
  const sealed = Object.freeze({ roomId: context.roomId, ...(context.mode ? { mode: context.mode } : {}), actors: Object.freeze(Object.fromEntries(
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
  if (exactScope) { exactMode(roomId, mode); return undefined; }
  const scope = scopes.at(-1);
  if (!scope) return undefined;
  if (scope.roomId !== roomId || (mode.baseMode ?? "jieqi") !== (scope.mode ?? "jieqi") || !mode.heroesEnabled ||
      (scope.mode ? Boolean(mode.mutationsEnabled) : !mode.mutationsEnabled)) {
    throw new RuleError("RESEARCH_SCOPE_INVALID", "研究上下文不能用于其他房间或未经适配的模式");
  }
  return scope;
}

export function effectiveResearchHero(roomId: string, mode: OptionalModeConfig, actor: string, hero: HeroId): HeroId | undefined {
  if (exactScope) {
    exactMode(roomId, mode);
    const side = (["red", "black"] as const).find(side => exactScope!.players[side] === actor);
    if (!side || exactTuple(exactScope)[side] !== hero) throw new RuleError("RESEARCH_SOURCE_MISMATCH", "研究英雄必须匹配玩家的原红黑来源");
    return hero;
  }
  const context = researchSources(roomId, mode);
  if (!context) return hero;
  const source = context.actors[actor];
  if (!source || source.hero !== hero) throw new RuleError("RESEARCH_SOURCE_MISMATCH", "研究来源不能改选或借用其他玩家来源");
  return source.enabled ? hero : undefined;
}
