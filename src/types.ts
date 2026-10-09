export type Side = "red" | "black";

export type GameModeId = "jieqi" | "half_chaos" | "xiangqi";

export type HeroId = "hunter" | "rogue" | "warrior" | "qin_long" | "murozond"
  | "nozdormu" | "murozond_minion" | "devout_zealot" | "prince" | "deathwing"
  | "death_knight" | "wind" | "shuffler" | "warlock" | "single_blade" | "night" | "sky_admiral" | "berserker" | "jiang_he";

export type HeroForm = "front" | "inner";
export type GalakrondForm = "nightmare" | "invincible" | "fel" | "storm" | "unspeakable";
export interface HeroSelection { heroId: HeroId; form: HeroForm; packageId: string; variant?: GalakrondForm }
export type HeroSelections = Partial<Record<Side, HeroSelection>>;

export type MutationId =
  | "iron_steed"
  | "iron_wall"
  | "shadow_dance"
  | "war_chariot"
  | "expedition"
  | "cavalry" | "chaos" | "jian_xie" | "end_time";

export interface FeatureRules {
  /** 本地试玩可只启用一方英雄；联机开始后的房间始终同时具备两方选择。 */
  heroes?: Partial<Record<Side, HeroId>>;
  /** 单方单一完整形态包；缺省的旧英雄ID只对应现有表包。 */
  heroSelections?: HeroSelections;
  mutation?: MutationId;
}

/** 技能次数的来源；英雄与“暗影之舞”彼此独立。 */
export type SkillSource = "hero" | "mutation";

export interface OptionalModeConfig {
  heroesEnabled: boolean;
  mutationsEnabled: boolean;
  baseMode?: GameModeId;
}

export type PieceType =
  | "general"
  | "advisor"
  | "elephant"
  | "horse"
  | "rook"
  | "cannon"
  | "pawn" | "storm_elemental";

export interface Position {
  x: number;
  y: number;
}

/** 来源专属格标识；基础层不定义第11行、邻接或容量。 */
export interface RiverLocation {
  source: string;
  spaceId: string;
  cellId: string;
  /** 暗子位于非基础空间时，须由来源明确提供公开身份与控制关系。 */
  coveredIdentity?: { type: Exclude<PieceType, "general">; controller: Side };
}
export interface RiverReadPermission { source: string; readRiver: true }

export interface PieceBase extends Position {
  id: string;
  layer?: "air" | "river";
  river?: RiverLocation;
}

export type CoveredPiece = PieceBase & {
  faceDown: true;
};

export type RevealedPiece = PieceBase & {
  faceDown: false;
  color: Side;
  type: PieceType;
};

export type PublicPiece = CoveredPiece | RevealedPiece;

export interface SecretIdentity {
  color: Side;
  type: PieceType;
}

// ambush is kept as the wire value for backward compatibility; its rule name is “背刺”.
export type WinReason =
  | "ambush"
  | "checkmate"
  | "stalemate"
  | "resign"
  | "trap_ambush"
  | "crush_them"
  | "rampage"
  | "disconnect" | "infection" | "suffocation" | "time_collapse" | "general_destroyed"
  | "rain_night" | "timeout";

export interface CapturedPiece extends SecretIdentity {
  id: string;
  capturedBy: Side;
  moveNumber: number;
  cause?: string;
  /** 混乱暗子死亡只公开兵种；color 为既有公开控制方，非秘密阵营。 */
  secretColorWithheld?: true;
  position?: Position;
  river?: RiverLocation;
}

export type ActionTier = 1 | 2 | 3;
export type FormalTurnPhase = "turn_start" | "before_main" | "main_action" | "atom_closure" | "turn_end";
export interface ActionClassification {
  tier: ActionTier;
  keywords: string[];
  source: "ordinary" | "hero" | "mutation" | "skill_derived" | "rewind_replay";
  opportunity: "main" | "before_main" | "child" | "extra";
  forced?: true;
  countsAsFormalTurn: boolean;
  parentActionId?: string;
}
export interface ActionRecord extends ActionClassification {
  actionId: string;
  actingSide: Side;
  pieceId?: string;
  from?: Position;
  to?: Position;
}
export interface FormalTurnLifecycle {
  side: Side;
  number: number;
  phase: FormalTurnPhase;
  phases: FormalTurnPhase[];
  mainActionId?: string;
  mainPieceId?: string;
}
export interface FormalActionSnapshot {
  actingSide: Side;
  pieceId?: string;
  tier: number;
  classification?: ActionClassification;
  formalTurnNumber?: number;
  from?: Position;
  remainingMs?: number;
  state: GameState;
  secret: SecretState;
}

export interface LastMove {
  actionId: string;
  pieceId: string;
  actingSide: Side;
  from: Position;
  to: Position;
  captured?: CapturedPiece;
  /** 路径碾碎按行进顺序记录，供双方一致播放战车/铁马效果。 */
  pathCrushed?: CapturedPiece[];
  /** 普通防御拦截时的目标棋子，用于播放弹回效果。 */
  bouncedAgainstPieceId?: string;
  revealed?: SecretIdentity;
  /** 普通防御弹回时为 false：并未进入所选目标点。 */
  landed?: boolean;
  /** 战士铁甲提供的额外应将不消耗猎人陷阱的十二回合寿命。 */
  countsAsFormalTurn?: boolean;
  tier?: 1 | 2 | 3;
  keywords?: string[];
  classification?: ActionClassification;
}

/**
 * 棋子效果全部是公开状态；它们从不包含暗子真实身份。
 * 后续战士、骑兵等效果在此对象上扩展，避免将状态绑定到格子。
 */
export interface StealthEffect {
  owner: Side;
  /** 发动回合不计入；在随后两个己方正式回合窗口结束时清除。 */
  remainingOwnerTurns: 1 | 2;
  /** 发动所在己方正式回合，不计入两个后续窗口。 */
  activatedOnFormalTurn?: number;
  strongStrikeAvailable: boolean;
  source: SkillSource;
}

export interface PieceEffects {
  stealth?: StealthEffect;
  /** 战士防护壁垒：普通吃子会消耗并把攻击者弹回。 */
  barrier?: { owner: Side; enemyTurnsRemaining: number };
  /** 骑兵仅在真实马揭示后附着。 */
  cavalry?: true;
  intangible?: true;
  immuneCrush?: true;
  flight?: { remainingOwnerTurns: number; source?: "sky_admiral"; forcedLanding?: true };
  infection?: { owner: Side; stacks: number };
  insightMark?: true;
  riverQualified?: true;
  riverTurns?: number;
  dragonClaw?: true; dragonScale?: 1;
  controlTrap?: { controller: Side; blockedFormalTurn: number };
  timeCollapse?: { expiresAtOwnerTurnEnd: number };
  destiny?: "time_warrior" | "infinite_dragon";
  ammunition?: 0 | 1;
}

export type PieceEffectsById = Record<string, PieceEffects>;

export interface AssassinationState {
  heroChargeAvailable: boolean;
  mutationChargeAvailable: boolean;
  /** 当前处于刺杀隐身阶段的棋子；一方同时至多一个。 */
  activePieceId?: string;
}

export type AssassinationStates = Record<Side, AssassinationState>;

export type WarriorStates = Record<Side, {
  barrierPieceIds: string[];
  ironArmorAvailable: boolean;
}>;

export interface ForcedDefenseState {
  responder: Side;
  resumeTurn: Side;
  cause: "iron_armor_blocked_backstab";
}

/** 来源先锁定的消灭承诺；只有明确同批来源才使用批次入口。 */
export interface DestructionTarget { pieceId: string; by: Side; cause: string }
export interface ClosedDestructionBatch {
  batchId: string;
  source: string;
  targetIds: string[];
  targets: DestructionTarget[];
  destroyedIds: string[];
  phase: "closed";
}

/** 明确获准读取真实身份的既有权威来源；普通目标/资源/UI不能借用。 */
export type TrueIdentityReadSource = "death:reveal" | "mutation:end_time:initialization" | "hero:wind:covered_carrier" | "hero:night:insight" | "hero:sky_admiral:training";

export type GhostKind = "ghost" | "inner_ghost";
export interface GhostObject {
  /** 旧快照省略时仅兼容为普通亡魂。新增对象必须通过明确种类的入口。 */
  kind?: GhostKind;
  source?: string;
  owner: Side;
  position: Position;
  remaining: number;
  /** 明确永久来源不参与回合寿命；旧对象仍按remaining计时。 */
  persistent?: true;
  /** 只有来源明确提供时才记录；不从寿命或其他种类推算层数。 */
  layers?: number;
}
export type GhostObjectSpec = GhostObject & { kind: GhostKind; source: string };
export interface GhostQuery { kind: GhostKind; owner?: Side; source?: string; position?: Position }

export interface HeroRuntime {
  used?: boolean; invokeCount?: number; rainActive?: boolean; carefreeSuspended?: boolean;
  omen?: true; descended?: true;
  pupil?: number; insightCount?: number; insightTurn?: number;
  blade?: "left" | "right"; bladeTurn?: number;
  trainingType?: Exclude<PieceType, "general">;
  will?: number; chargeCount?: number; chargeTurn?: number;
  shuffleWindow?: "A" | "B"; shuffleLost?: true;
}

export interface GameState {
  /** 缺省为原有全局混洗揭棋，兼容既有棋局与快照。 */
  gameMode?: GameModeId;
  status: "playing" | "execution" | "finished";
  turn: Side;
  revision: number;
  pieces: PublicPiece[];
  captured: CapturedPiece[];
  lastMove?: LastMove;
  winner?: Side;
  drawReason?: "mutual_destruction" | "disconnect_timeout";
  reason?: WinReason;
  /** 未受英雄/畸变影响的旧棋局可省略，视为空效果。 */
  effectsByPieceId?: PieceEffectsById;
  /** 技能次数和活动隐身均为公开信息。 */
  assassination?: AssassinationStates;
  warrior?: WarriorStates;
  forcedDefense?: ForcedDefenseState;
  featureRules?: FeatureRules;
  /** 开局所选完整形态，随公开快照/历史保存，不能中途重置。 */
  heroFormLock?: HeroSelections;
  formalTurns?: Record<Side, number>;
  /** 当前正式回合的阶段；子行动不创建或推进新的正式回合。 */
  turnLifecycle?: FormalTurnLifecycle;
  lastCompletedFormalTurn?: FormalTurnLifecycle;
  /** 最近一次公开操作及其子行动；秘密操作不写入。 */
  actionRecords?: ActionRecord[];
  pendingShuffle?: { side: "black"; window: "A" | "B" };
  pendingHeroChild?: { kind: "blade" | "charge" | "inner_wave" | "brawl"; side: Side; pieceId: string; parent: LastMove };
  pendingDescent?: { side: Side; variant: GalakrondForm; pieces: PublicPiece[]; atom: string; assaultIds?: string[] };
  heroRuntime?: Partial<Record<Side, HeroRuntime>>;
  /** 两种独立格对象共用存储，所有规则读取须精确指定种类。 */
  ghosts?: GhostObject[];
  warps?: Position[];
  hourglasses?: number;
  /** 一次原子行动内各落位，含弹回/移置/复活，供共同结算管线使用。 */
  landingEvents?: Array<{ pieceId: string; beforeController: Side; position: Position; source: string; beforeGhostOwners?: Side[] }>;
  automaticEvents?: Array<{ kind: string; pieceId?: string; side?: Side; position?: Position;
    /** 死亡时公开记录，不含未公开的混乱阵营。用于区分同ID复活后的再次死亡。 */
    deathRecord?: CapturedPiece; ghostTriggerHandled?: true; batchId?: string; wasCovered?: boolean; resourceHandled?: true }>;
  /** 当前原子链中已闭合的消灭批次；不保存开放批次或秘密候选。 */
  destructionBatches?: ClosedDestructionBatch[];
  formalClock?: { side: Side; number: number };
  turnStartedAt?: number;
  turnDeadlineAt?: number;
  flowDance?: { side: Side; pieceId: string; steps: 0 | 1; resumeTurn: Side };
}

export interface SecretState {
  /** 权威独立保存的整局形态锁，用于检测公共选择/历史恢复冲突。 */
  heroFormLock?: HeroSelections;
  identities: Record<string, SecretIdentity>;
  processedActions: Record<string, number>;
  shuffleOpening?: { pieces: PublicPiece[]; identities: Record<string, SecretIdentity> };
  timelineEpoch?: number;
  training?: Partial<Record<Side, { type: Exclude<PieceType, "general">; pieceId?: string; progress: number; graduated?: true; failed?: true }>>;
  insights?: Partial<Record<Side, Array<{ pieceId: string; identity: SecretIdentity; revision: number; valid: boolean }>>>;
  traps?: Array<{ id: string; owner: Side; position: Position; opponentTurnsRemaining: number }>;
  trueGenerals?: Partial<Record<Side, string>>;
  wind?: Partial<Record<Side, { uses: number; readyOnTurn: number; activatedOnTurn?: number; hostId?: string; decoyId: string }>>;
  destinyIdentities?: Record<string, { side: Side; kind: "time_warrior" | "infinite_dragon"; anchor: Position; shown: boolean; identity: SecretIdentity }>;
  rewindUsed?: Partial<Record<Side, true>>;
  history?: FormalActionSnapshot[];
  replay?: { pieceId: string; deadlineAt: number };
  chaosInitialized?: true;
  /** 私密回合开始效果的幂等标记，公共时钟初始化不会暴露它。 */
  formalStart?: { side: Side; number: number };
}

export interface MoveCommand {
  from: Position;
  to: Position;
  expectedRevision: number;
  actionId: string;
  pieceId?: string;
}

export interface HeroAbilityCommand {
  kind: "hero_ability";
  ability: "invoke" | "unspeakable" | "destruction" | "timeline_twist" | "rewind" | "hourglass" | "bomb" | "shadow" | "burning_flame" | "insight" | "inner_ghost_burst" | "ascension" | "storm_assault" | "river_enter" | "river_move" | "river_exit" | "inner_wave" | "landing" | "blade_shift" | "charge_move" | "charge_attack" | "wave_move" | "skip_child" | "shuffle" | "brawl" | "brawl_attack";
  actionId: string;
  expectedRevision: number;
  pieceId?: string;
  to?: Position;
  randomCovered?: boolean;
  secretInsight?: boolean;
  placements?: Array<{ pieceId: string; to: Position }>;
  skip?: boolean;
}

/**
 * “刺杀”的发动和首步（或隐身棋的后续一步）必须一起由服务端结算。
 * 首次发动须指定尚可用的 source；后续隐身行动不应再指定 source。
 */
export interface AssassinationCommand extends MoveCommand {
  kind: "assassination";
  useStrongStrike: boolean;
  source?: SkillSource;
}

export interface AutomaticExecutionPlan {
  pieceId: string;
  from: Position;
  to: Position;
}

export interface MoveValidation {
  ok: boolean;
  code?: string;
  message?: string;
}

export interface MoveResult {
  state: GameState;
  secret: SecretState;
  duplicate: boolean;
}

export type RandomInt = (maxExclusive: number) => number;

export interface CoveredSlot extends Position {
  side: Side;
  type: Exclude<PieceType, "general">;
}
