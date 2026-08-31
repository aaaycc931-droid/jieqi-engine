export type Side = "red" | "black";

export type HeroId = "hunter" | "rogue" | "warrior";

export type MutationId =
  | "iron_steed"
  | "iron_wall"
  | "shadow_dance"
  | "war_chariot"
  | "expedition"
  | "cavalry";

export interface FeatureRules {
  /** 本地试玩可只启用一方英雄；联机开始后的房间始终同时具备两方选择。 */
  heroes?: Partial<Record<Side, HeroId>>;
  mutation?: MutationId;
}

/** 技能次数的来源；英雄与“暗影之舞”彼此独立。 */
export type SkillSource = "hero" | "mutation";

export interface OptionalModeConfig {
  heroesEnabled: boolean;
  mutationsEnabled: boolean;
}

export type PieceType =
  | "general"
  | "advisor"
  | "elephant"
  | "horse"
  | "rook"
  | "cannon"
  | "pawn";

export interface Position {
  x: number;
  y: number;
}

export interface PieceBase extends Position {
  id: string;
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
  | "rampage";

export interface CapturedPiece extends SecretIdentity {
  id: string;
  capturedBy: Side;
  moveNumber: number;
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
  /** 战士铁甲提供的额外应将不消耗猎人陷阱的十回合寿命。 */
  countsAsFormalTurn?: boolean;
}

/**
 * 棋子效果全部是公开状态；它们从不包含暗子真实身份。
 * 后续战士、骑兵等效果在此对象上扩展，避免将状态绑定到格子。
 */
export interface StealthEffect {
  owner: Side;
  /** 只在拥有者完成正式行动时递减；发动回合不计入。 */
  remainingOwnerTurns: 1 | 2;
  strongStrikeAvailable: boolean;
  source: SkillSource;
}

export interface PieceEffects {
  stealth?: StealthEffect;
  /** 战士防护壁垒：普通吃子会消耗并把攻击者弹回。 */
  barrier?: { owner: Side; enemyHalfEntered: boolean; movesAfterEnemyHalfEntry: 0 | 1 };
  /** 骑兵畸变附着在开局三个兵位的具体棋子 ID 上。 */
  cavalry?: true;
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

export interface GameState {
  status: "playing" | "execution" | "finished";
  turn: Side;
  revision: number;
  pieces: PublicPiece[];
  captured: CapturedPiece[];
  lastMove?: LastMove;
  winner?: Side;
  drawReason?: "mutual_destruction";
  reason?: WinReason;
  /** 未受英雄/畸变影响的旧棋局可省略，视为空效果。 */
  effectsByPieceId?: PieceEffectsById;
  /** 技能次数和活动隐身均为公开信息。 */
  assassination?: AssassinationStates;
  warrior?: WarriorStates;
  forcedDefense?: ForcedDefenseState;
  featureRules?: FeatureRules;
}

export interface SecretState {
  identities: Record<string, SecretIdentity>;
  processedActions: Record<string, number>;
}

export interface MoveCommand {
  from: Position;
  to: Position;
  expectedRevision: number;
  actionId: string;
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
