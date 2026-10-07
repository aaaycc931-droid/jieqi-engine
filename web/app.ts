import { configureHeroPreparation } from "../src/hero-progress.ts";
import { getHeroPackage } from "../src/hero-forms.ts";
import { isBoardPiece } from "../src/spaces.ts";
import { HERO_IDS, HERO_CATALOG as heroCatalog } from "../src/heroes.ts";
import { applyHeroAbility, getShadowRevealedTargets, getBombers, startFormalClock, formalTurnDurationMs } from "../src/hero-actions.ts";
import { initializeFeatureSecret } from "../src/settlement.ts";
// The browser playground must only load browser-safe modules.  In particular,
// `src/index.ts` also re-exports the room adapter, which depends on
// `node:crypto` for invite-token hashing.  Importing that server-only adapter
// prevented the whole browser module from evaluating, so even the RPS buttons
// had no click handlers.
import { RuleError } from "../src/errors.ts";
import {
  applyAutomaticExecution,
  applyAuthoritativeAssassination,
  applyAuthoritativeMove,
  applyResignation,
  getAutomaticExecutionPlan,
  getFlowDanceMoves,
  initializeFeatureGameState,
  reassessAfterTrapResolution,
} from "../src/game.ts";
import { createRpsState, submitRpsChoice } from "../src/rps.ts";
import {
  getLegalAssassinationMoves,
  getLegalMoves,
  getPseudoMoves,
  getPieceTypeForMovement,
  isGeneralInCheck,
  pieceAt,
  validatePublicMove,
} from "../src/rules.ts";
import { createInitialGame } from "../src/setup.ts";
import { GAME_MODES, normalizeGameMode } from "../src/modes.ts";
import { getController, otherSide } from "../src/slots.ts";
import {
  MUTATION_IDS,
  drawRuntimeMutation,
  MUTATION_RARITY_LABELS,
  NORMAL_FORMAL_TURN_DURATION_MS,
  mutationDefinition,
} from "../src/mutations.ts";
import {
  BLUETOOTH_GUEST_PLAYER,
  BLUETOOTH_HOST_PLAYER,
  BluetoothHostRoom,
  type BluetoothRoomAction,
} from "../src/bluetooth-host-room.ts";
import {
  BLUETOOTH_PROTOCOL_VERSION,
  createBluetoothSnapshot,
  encodeBluetoothEnvelope,
  parseBluetoothEnvelope,
} from "../src/bluetooth-protocol.ts";
import {
  DISCONNECT_TIMEOUT_MS,
  CHAT_COOLDOWN_MS,
  CHAT_MAX_CHARACTERS,
  HERO_PREPARATION_DURATION_MS,
  HERO_SELECTION_DURATION_MS,
  REMATCH_INVITATION_DURATION_MS,
  RPS_SELECTION_DURATION_MS,
  type MatchMessage,
  type PlayerRemoteRoomView,
} from "../src/remote-room.ts";
import type {
  GameState,
  GameModeId,
  HeroId,
  HeroForm, GalakrondForm, HeroSelection,
  HeroAbilityCommand,
  MutationId,
  PieceType,
  Position,
  SecretState,
  Side,
} from "../src/types.ts";
import type { RpsChoice, RpsPublicState, RpsSecretState } from "../src/rps.ts";
import { trapTriggerAnnouncement } from "./messages.ts";

const PLAYER_ONE = "玩家一";
const PLAYER_TWO = "玩家二";
const choiceLabel: Record<RpsChoice, string> = { rock: "石头", scissors: "剪刀", paper: "布" };
const pieceLabel = {
  red: { general: "帅", advisor: "仕", elephant: "相", horse: "马", rook: "车", cannon: "炮", pawn: "兵", storm_elemental: "风暴元素" },
  black: { general: "将", advisor: "士", elephant: "象", horse: "馬", rook: "車", cannon: "砲", pawn: "卒", storm_elemental: "风暴元素" },
} as const;
const movementLabel = { general: "将帅", advisor: "仕/士", elephant: "相/象", horse: "马", rook: "车", cannon: "炮", pawn: "兵/卒", storm_elemental: "风暴元素" } as const;

type MovementGuideId = "rook" | "horse" | "cannon" | "pawn" | "general" | "advisor" | "elephant";
type DiagramPoint = readonly [number, number];

interface MovementRoute {
  points: readonly DiagramPoint[];
  secondary?: boolean;
}

interface MovementGuide {
  id: MovementGuideId;
  title: string;
  glyph: string;
  summary: string;
  detail: string;
  destinations: readonly DiagramPoint[];
  routes: readonly MovementRoute[];
  obstacles?: readonly { at: DiagramPoint; label: string }[];
  caption?: string;
}

const movementGuides: readonly MovementGuide[] = [
  {
    id: "rook",
    title: "车",
    glyph: "车",
    summary: "横直任意步",
    detail: "车沿横线或直线移动任意距离，路径必须畅通。传说畸变“战车”生效时，车可隔一枚非隐身路径棋发动碾碎，并继续结算落点。",
    destinations: [[20, 100], [60, 100], [140, 100], [180, 100], [100, 20], [100, 60], [100, 140], [100, 180]],
    routes: [
      { points: [[20, 100], [180, 100]] },
      { points: [[100, 20], [100, 180]] },
    ],
  },
  {
    id: "horse",
    title: "马",
    glyph: "马",
    summary: "日字跳跃，受马腿阻挡",
    detail: "马走日字；与起点相邻的第一格是马腿，马腿有非隐身棋时该方向不能走。史诗畸变“铁马”会忽略并碾碎马腿。",
    destinations: [[20, 60], [20, 140], [60, 20], [140, 20], [180, 60], [180, 140], [60, 180], [140, 180]],
    routes: [
      { points: [[100, 100], [60, 100], [20, 60]] }, { points: [[100, 100], [60, 100], [20, 140]] },
      { points: [[100, 100], [100, 60], [60, 20]] }, { points: [[100, 100], [100, 60], [140, 20]] },
      { points: [[100, 100], [140, 100], [180, 60]] }, { points: [[100, 100], [140, 100], [180, 140]] },
      { points: [[100, 100], [100, 140], [60, 180]] }, { points: [[100, 100], [100, 140], [140, 180]] },
    ],
    obstacles: [
      { at: [60, 100], label: "马腿" }, { at: [140, 100], label: "马腿" },
      { at: [100, 60], label: "马腿" }, { at: [100, 140], label: "马腿" },
    ],
  },
  {
    id: "cannon",
    title: "炮",
    glyph: "炮",
    summary: "平移如车，隔一枚吃子",
    detail: "炮不吃子时沿横线或直线移动，路径中不能有棋；吃子时必须且只能隔一枚棋作为炮架。图中赭色点示意炮架，虚线终点示意可吃目标。",
    destinations: [[20, 100], [60, 100], [100, 20], [100, 60], [100, 140], [100, 180], [180, 100]],
    routes: [
      { points: [[20, 100], [100, 100]] }, { points: [[100, 20], [100, 100]] },
      { points: [[100, 100], [100, 180]] }, { points: [[100, 100], [140, 100], [180, 100]], secondary: true },
    ],
    obstacles: [{ at: [140, 100], label: "炮架" }],
  },
  {
    id: "pawn",
    title: "兵卒",
    glyph: "兵",
    summary: "向前一步，过河可横走",
    detail: "兵卒每次一步，不能后退；未过河只能向前，过河后可向前或横走。方向和是否过河按棋子的真实阵营与当前位置判定。",
    destinations: [[100, 60], [60, 100], [140, 100]],
    routes: [
      { points: [[100, 100], [100, 60]] },
      { points: [[100, 100], [60, 100]], secondary: true },
      { points: [[100, 100], [140, 100]], secondary: true },
    ],
    caption: "前",
  },
  {
    id: "general",
    title: "将帅",
    glyph: "将",
    summary: "九宫内横直一步",
    detail: "将帅通常只能在己方九宫内横走或直走一步；两将帅同列且中间无棋时形成照面攻击。史诗畸变“亲征”会开放离开九宫后的现行移动规则。",
    destinations: [[60, 100], [140, 100], [100, 60], [100, 140]],
    routes: [
      { points: [[60, 100], [140, 100]] }, { points: [[100, 60], [100, 140]] },
      { points: [[100, 20], [100, 180]], secondary: true },
    ],
  },
  {
    id: "advisor",
    title: "仕士",
    glyph: "仕",
    summary: "斜走一步",
    detail: "暗仕、暗士首次移动按原位置兵种规则，必须留在对应九宫；揭示后的明仕、明士每次斜走一步，可离开九宫。",
    destinations: [[60, 60], [140, 60], [60, 140], [140, 140]],
    routes: [
      { points: [[100, 100], [60, 60]] }, { points: [[100, 100], [140, 60]] },
      { points: [[100, 100], [60, 140]] }, { points: [[100, 100], [140, 140]] },
    ],
  },
  {
    id: "elephant",
    title: "相象",
    glyph: "相",
    summary: "田字斜走，受象眼阻挡",
    detail: "相象沿对角线走两格；中间象眼有非隐身棋时不能通过。暗相、暗象首次移动受原位置限制，揭示后的明相、明象可以过河。",
    destinations: [[20, 20], [180, 20], [20, 180], [180, 180]],
    routes: [
      { points: [[100, 100], [20, 20]] }, { points: [[100, 100], [180, 20]] },
      { points: [[100, 100], [20, 180]] }, { points: [[100, 100], [180, 180]] },
    ],
    obstacles: [
      { at: [60, 60], label: "象眼" }, { at: [140, 60], label: "象眼" },
      { at: [60, 140], label: "象眼" }, { at: [140, 140], label: "象眼" },
    ],
  },
] as const;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`找不到界面元素：${id}`);
  return found as T;
}

const mainMenuView = element<HTMLElement>("main-menu-view");
const rpsView = element<HTMLElement>("rps-view");
const bluetoothLobbyView = element<HTMLElement>("lobby-view");
const settingsView = element<HTMLElement>("settings-view");
const rulesView = element<HTMLElement>("rules-view");
const heroView = element<HTMLElement>("hero-view");
const gameView = element<HTMLElement>("game-view");
const battleCanvas = element<HTMLElement>("battle-canvas");
const battleBoard = element<HTMLElement>("battle-board");
const rpsTitle = element<HTMLElement>("rps-title");
const rpsHelp = element<HTMLElement>("rps-help");
const rpsHistory = element<HTMLElement>("rps-history");
const rpsSelectionTimer = element<HTMLElement>("rps-selection-timer");
const rpsLockStatus = element<HTMLElement>("rps-lock-status");
const rpsConfirmButton = element<HTMLButtonElement>("rps-confirm-button");
const boardPoints = element<HTMLElement>("board-points");
const boardPlane = document.querySelector<HTMLElement>(".board-plane");
if (!boardPlane) throw new Error("找不到棋盘");
const executionGhost = element<HTMLElement>("execution-ghost");
const terminationEffect = element<HTMLElement>("termination-effect");
const battleEventCue = element<HTMLElement>("battle-event-cue");
const moveHint = element<HTMLElement>("move-hint");
const announcement = element<HTMLElement>("announcement");
const redPlayer = element<HTMLElement>("red-player");
const blackPlayer = element<HTMLElement>("black-player");
const turnStatus = element<HTMLElement>("turn-status");
const battleTurnTimer = element<HTMLElement>("battle-turn-timer");
const battleMutationName = element<HTMLElement>("battle-mutation-name");
const redCapturedButton = element<HTMLButtonElement>("red-captured-button");
const blackCapturedButton = element<HTMLButtonElement>("black-captured-button");
const redCapturedCount = element<HTMLElement>("red-captured-count");
const blackCapturedCount = element<HTMLElement>("black-captured-count");
const battleMoreButton = element<HTMLButtonElement>("battle-more-button");
const heroMoreButton = element<HTMLButtonElement>("hero-more-button");
const rpsMoreButton = element<HTMLButtonElement>("rps-more-button");
const matchMenuLayer = element<HTMLElement>("match-menu-layer");
const battleActionMenu = element<HTMLElement>("battle-action-menu");
const battleSkillPanel = element<HTMLElement>("battle-skill-panel");
const matchMutationButton = element<HTMLButtonElement>("match-mutation-button");
const matchExitButton = element<HTMLButtonElement>("match-exit-button");
const resignButton = element<HTMLButtonElement>("resign-button");
const matchDetailLayer = element<HTMLElement>("match-detail-layer");
const matchDetailTitle = element<HTMLElement>("match-detail-title");
const matchDetailBody = element<HTMLElement>("match-detail-body");
const matchDetailActions = element<HTMLElement>("match-detail-actions");
const matchDetailConfirm = element<HTMLButtonElement>("match-detail-confirm");
const statusBlueHeroName = element<HTMLElement>("status-blue-hero-name");
const statusRedHeroName = element<HTMLElement>("status-red-hero-name");
const pieceMovementGrid = element<HTMLElement>("piece-movement-grid");
const ruleDiagramLayer = element<HTMLElement>("rule-diagram-layer");
const ruleDiagramTitle = element<HTMLElement>("rule-diagram-title");
const ruleDiagramArt = element<HTMLElement>("rule-diagram-art");
const ruleDiagramDescription = element<HTMLElement>("rule-diagram-description");
const flowDialog = element<HTMLDialogElement>("flow-dialog");
const dialogTitle = element<HTMLElement>("dialog-title");
const dialogText = element<HTMLElement>("dialog-text");
const dialogAction = element<HTMLButtonElement>("dialog-action");
const toast = element<HTMLElement>("toast");
const bluetoothStatus = element<HTMLElement>("bluetooth-status");
const heroGrid = element<HTMLElement>("hero-grid");
const heroDetailAvatar = element<HTMLElement>("hero-detail-avatar");
const heroSelectionName = element<HTMLElement>("hero-selection-name");
const heroSkillList = element<HTMLElement>("hero-skill-list");
const heroSkillDescription = element<HTMLElement>("hero-skill-description");
const heroSelectionTimer = element<HTMLElement>("hero-selection-timer");
const heroOpponentStatus = element<HTMLElement>("hero-opponent-status");
const heroConfirmButton = element<HTMLButtonElement>("hero-confirm-button");
const openingSequence = element<HTMLElement>("opening-sequence");
const mutationReveal = element<HTMLElement>("mutation-reveal");
const heroIntroStage = element<HTMLElement>("hero-intro-stage");
const heroPreparationPanel = element<HTMLElement>("hero-preparation-panel");
const heroPreparationTitle = element<HTMLElement>("hero-preparation-title");
const heroPreparationStatus = element<HTMLElement>("hero-preparation-status");
const heroPreparationTimer = element<HTMLElement>("hero-preparation-timer");
const trapUndoButton = element<HTMLButtonElement>("trap-undo-button");
const preparationConfirmButton = element<HTMLButtonElement>("preparation-confirm-button");
const disconnectLayer = element<HTMLElement>("disconnect-layer");
const disconnectTitle = element<HTMLElement>("disconnect-title");
const disconnectCopy = element<HTMLElement>("disconnect-copy");
const disconnectTimer = element<HTMLElement>("disconnect-timer");
const disconnectBluetoothButton = element<HTMLButtonElement>("disconnect-bluetooth-button");
const bluetoothInitialActions = element<HTMLElement>("bluetooth-initial-actions");
const bluetoothJoinPanel = element<HTMLElement>("bluetooth-join-panel");
const bluetoothStateActions = element<HTMLElement>("bluetooth-state-actions");
const bluetoothEnableButton = element<HTMLButtonElement>("bluetooth-enable-button");
const bluetoothPermissionButton = element<HTMLButtonElement>("bluetooth-permission-button");
const bluetoothAppSettingsButton = element<HTMLButtonElement>("bluetooth-app-settings-button");
const bluetoothSessionPanel = element<HTMLElement>("bluetooth-session-panel");
const bluetoothSessionKicker = element<HTMLElement>("bluetooth-session-kicker");
const bluetoothSessionTitle = element<HTMLElement>("bluetooth-session-title");
const bluetoothSessionDevice = element<HTMLElement>("bluetooth-session-device");
const bluetoothSessionDetail = element<HTMLElement>("bluetooth-session-detail");
const bluetoothRematchTimer = element<HTMLElement>("bluetooth-rematch-timer");
const bluetoothRetryButton = element<HTMLButtonElement>("bluetooth-retry-button");
const bluetoothRematchRequestButton = element<HTMLButtonElement>("bluetooth-rematch-request-button");
const bluetoothRematchAcceptButton = element<HTMLButtonElement>("bluetooth-rematch-accept-button");
const bluetoothRematchDeclineButton = element<HTMLButtonElement>("bluetooth-rematch-decline-button");
const bluetoothCancelButton = element<HTMLButtonElement>("bluetooth-cancel-button");
const bluetoothReturnButton = element<HTMLButtonElement>("bluetooth-return-button");
const matchResultLayer = element<HTMLElement>("match-result-layer");
const matchResultHeading = element<HTMLElement>("match-result-heading");
const matchResultType = element<HTMLElement>("match-result-type");
const matchResultMessage = element<HTMLElement>("match-result-message");
const matchResultWinner = element<HTMLElement>("match-result-winner");
const matchResultAvatar = element<HTMLElement>("match-result-avatar");
const matchResultSide = element<HTMLElement>("match-result-side");
const matchResultPlayer = element<HTMLElement>("match-result-player");
const matchResultHero = element<HTMLElement>("match-result-hero");
const matchResultRematch = element<HTMLButtonElement>("match-result-rematch");
const matchResultMainMenu = element<HTMLButtonElement>("match-result-main-menu");
const messagePanelToggle = element<HTMLButtonElement>("message-panel-toggle");
const messageLatest = element<HTMLElement>("message-latest");
const messageUnreadDot = element<HTMLElement>("message-unread-dot");
const messageDrawer = element<HTMLElement>("message-drawer");
const messageDrawerClose = element<HTMLButtonElement>("message-drawer-close");
const messageHistory = element<HTMLElement>("message-history");
const messageNewButton = element<HTMLButtonElement>("message-new-button");
const quickMessageArea = element<HTMLElement>("quick-message-area");
const messageForm = element<HTMLFormElement>("message-form");
const messageInput = element<HTMLInputElement>("message-input");
const messageCharacterCount = element<HTMLElement>("message-character-count");
const messageSend = element<HTMLButtonElement>("message-send");

interface LocalUiPreferences {
  sound: boolean;
  haptics: boolean;
  reduceMotion: boolean;
}

const DEFAULT_UI_PREFERENCES: LocalUiPreferences = {
  sound: true,
  haptics: true,
  reduceMotion: false,
};

const UI_PREFERENCES_KEY = "lezi-xiangqi-ui-preferences-v1";

interface BluetoothNativeBridge {
  status(): string;
  pairedDevices(): string;
  requestPermission(): void;
  host(): void;
  join(address: string): void;
  send(message: string): void;
  disconnect(): void;
  reconnect(): void;
  openBluetoothSettings(): void;
  openAppSettings(): void;
}

interface BluetoothEventDetail {
  event?: string;
  type?: string;
  state?: string;
  message?: unknown;
  address?: string;
  detail?: string;
  adapterEnabled?: boolean;
  permanentlyDenied?: boolean;
  role?: "NONE" | "HOST" | "GUEST";
}

interface BluetoothAvailabilityStatus {
  available?: boolean;
  enabled?: boolean;
  permissionGranted?: boolean;
  deviceName?: string;
  role?: "NONE" | "HOST" | "GUEST";
  state?: string;
}

type BluetoothRole = "host" | "guest";

interface BluetoothSession {
  role: BluetoothRole;
  hostRoom?: BluetoothHostRoom;
  view?: PlayerRemoteRoomView;
  nativeState: string;
  pendingAction: boolean;
  playedTerminalEventId?: string;
  shownFinishRevision?: number;
  trapDraft: Position[];
  openingStarted?: boolean;
  everConnected?: boolean;
  localDisconnectStartedAt?: number;
  localDisconnectPlayerId?: typeof BLUETOOTH_HOST_PLAYER | typeof BLUETOOTH_GUEST_PLAYER;
  adapterEnabled?: boolean;
  shownDisconnectOutcomeKey?: string;
  shownForfeitActionId?: string;
  targetAddress?: string;
  targetName?: string;
  localDeviceName?: string;
  lastFailure?: string;
}

interface LocalTrapLayer {
  id: string;
  owner: Side;
  position: Position;
  opponentTurnsRemaining: number;
}

let rpsPublic: RpsPublicState;
let rpsSecret: RpsSecretState;
let rpsActor = PLAYER_ONE;
let rpsDraft: RpsChoice | undefined;
let rpsDraftRound = 1;
let localRpsDeadlineAt: number | undefined;
let gameState: GameState | undefined;
let gameSecret: SecretState | undefined;
let selectedPieceId: string | undefined;
let latestAnnouncement = "红方先行。点选己方棋子，再点选落点。";
let toastTimer: number | undefined;
let actionSequence = 0;
let executionTimer: number | undefined;
let assassinationArmed = false;
let strongStrikeArmed = false;
let localPrivateViewerSide: Side | undefined;
let localHeroes: Partial<Record<Side, HeroId>> = {};
let heroFormDraft: HeroForm = "front";
let galakrondDraft: GalakrondForm = "unspeakable";
let localHeroPackages: Partial<Record<string, HeroSelection>> = {};
let localHeroChoices: Partial<Record<string, HeroId>> = {};
let localHeroConfirmed: Record<string, boolean> = { [PLAYER_ONE]: false, [PLAYER_TWO]: false };
let localHeroActor = PLAYER_ONE;
let heroDraft: HeroId | undefined;
let activeSkillIndex = 0;
let heroSelectionDeadlineAt: number | undefined;
let localTraps: LocalTrapLayer[] = [];
let trapSetupQueue: Side[] = [];
let trapSetupSide: Side | undefined;
let localTrapDraft: Position[] = [];
let heroPreparationDeadlineAt: number | undefined;
let localPreparationActive = false;
let openingActive = false;
let openingTimer: number | undefined;
let openingStage: "mutation" | "heroes" | undefined;
let openingDeadlineAt: number | undefined;
let openingPausedRemainingMs: number | undefined;
let openingCompletion: (() => void) | undefined;
let battleTurnRevision: number | undefined;
let battleTurnDeadlineAt: number | undefined;
let battlePausedRemainingMs: number | undefined;
let bluetooth: BluetoothSession | undefined;
let localMessages: MatchMessage[] = [];
let messageDrawerOpen = false;
let messageHasUnread = false;
let lastRenderedMessageId: string | undefined;
let lastMessageSignature = "";
let localChatCooldownUntil = 0;
let chatCooldownTimer: number | undefined;
let renderedCaptureCounts: Record<Side, number> = { red: 0, black: 0 };
let eventCueQueue: string[] = [];
let eventCueTimer: number | undefined;
let lastEventCueActionId: string | undefined;

const BOARD_X_CENTERS = [81, 162, 242, 322, 402, 482, 562, 642, 722] as const;
const BOARD_Y_CENTERS = [57, 134, 212, 289, 367, 444, 522, 599, 677, 755] as const;
const RING_ASSETS = [
  "top_1_master1_120deg.png",
  "top_2_master2_120deg.png",
  "top_3_master3_120deg.png",
  "top_4_master4_180deg.png",
  "top_5_master5_180deg.png",
  "bottom_1_master1_240deg.png",
  "bottom_2_master2_240deg.png",
  "bottom_3_master3_0deg.png",
  "bottom_4_master4_0deg.png",
  "bottom_5_master5_0deg.png",
] as const;

function ringAsset(index: number): string {
  return `./assets/gameplay-v4/components/rings-display-68/${RING_ASSETS[index % RING_ASSETS.length]}`;
}

function glyphAsset(color: Side, type: PieceType): string {
  return `./assets/gameplay-v4/runtime/glyphs/${color}-${type}.png`;
}

function createPieceGlyph(color: Side, type: PieceType): HTMLImageElement {
  const glyph = document.createElement("img");
  glyph.className = "piece-glyph";
  glyph.src = type === "storm_elemental" ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><text x="40" y="58" text-anchor="middle" font-family="serif" font-size="52" fill="${color === "red" ? "#8c2828" : "#203951"}">风</text></svg>`) : glyphAsset(color, type);
  glyph.alt = "";
  glyph.setAttribute("aria-hidden", "true");
  glyph.draggable = false;
  return glyph;
}

function stableRingIndex(value: string): number {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return hash % RING_ASSETS.length;
}

function nativeBluetooth(): BluetoothNativeBridge | undefined {
  return (window as unknown as { JieqiBluetooth?: BluetoothNativeBridge }).JieqiBluetooth;
}

function isBluetoothGame(): boolean {
  return Boolean(bluetooth?.view || bluetooth?.hostRoom);
}

function ownBluetoothPlayerId(): typeof BLUETOOTH_HOST_PLAYER | typeof BLUETOOTH_GUEST_PLAYER | undefined {
  if (!bluetooth) return undefined;
  return bluetooth.role === "host" ? BLUETOOTH_HOST_PLAYER : BLUETOOTH_GUEST_PLAYER;
}

function bluetoothActionId(): string {
  return `bt-${nextActionId()}`;
}

function currentMatchMessages(): MatchMessage[] {
  return bluetooth?.view?.messages ?? localMessages;
}

function appendLocalSystemMessage(text: string): void {
  localMessages.push({
    id: `local-system-${nextActionId()}`,
    kind: "system",
    text,
    createdAt: Date.now(),
  });
}

function playNextEventCue(): void {
  if (eventCueTimer || eventCueQueue.length === 0) return;
  const next = eventCueQueue.shift()!;
  battleEventCue.hidden = true;
  battleEventCue.textContent = next;
  void battleEventCue.offsetWidth;
  battleEventCue.hidden = false;
  eventCueTimer = window.setTimeout(() => {
    battleEventCue.hidden = true;
    eventCueTimer = undefined;
    playNextEventCue();
  }, 900);
}

function queueFormalEventCues(state: GameState, trapTriggered = false, skillCue?: string): void {
  const move = state.lastMove;
  if (!move || move.actionId === lastEventCueActionId || state.status !== "playing") return;
  lastEventCueActionId = move.actionId;
  if (skillCue) eventCueQueue.push(skillCue);
  if (move.pathCrushed?.length) eventCueQueue.push(`碾碎 ${move.pathCrushed.length} 枚棋子`);
  if (move.bouncedAgainstPieceId) eventCueQueue.push("防护壁垒破裂");
  if (trapTriggered) eventCueQueue.push("猎人陷阱触发");
  if (isGeneralInCheck(state, state.turn)) eventCueQueue.push("将军");
  playNextEventCue();
}

function historyIsAtNewest(): boolean {
  return messageHistory.scrollHeight - messageHistory.scrollTop - messageHistory.clientHeight < 28;
}

function markMessagesRead(): void {
  const latest = currentMatchMessages().at(-1);
  lastRenderedMessageId = latest?.id;
  messageHasUnread = false;
  messageUnreadDot.hidden = true;
  messageNewButton.hidden = true;
}

function renderMessagePanel(): void {
  const messages = currentMatchMessages();
  const latest = messages.at(-1);
  const newestId = latest?.id;
  const wasAtNewest = historyIsAtNewest();
  if (newestId && newestId !== lastRenderedMessageId) {
    if (lastRenderedMessageId === undefined && lastMessageSignature === "") lastRenderedMessageId = newestId;
    else if (!messageDrawerOpen || !wasAtNewest) messageHasUnread = true;
    else lastRenderedMessageId = newestId;
  }
  messageLatest.textContent = latest?.text ?? latestAnnouncement;
  messageUnreadDot.hidden = messageDrawerOpen || !messageHasUnread;

  const signature = messages.map((message) => message.id).join("|");
  if (signature !== lastMessageSignature) {
    messageHistory.replaceChildren(...messages.map((message) => {
      const row = document.createElement("p");
      const own = message.kind === "chat" && message.senderPlayerId === ownBluetoothPlayerId();
      row.className = `message-row ${message.kind === "system" ? "system" : own ? "own" : "opponent"}`;
      const copy = document.createElement("span");
      copy.textContent = message.text;
      row.append(copy);
      return row;
    }));
    lastMessageSignature = signature;
    if (messageDrawerOpen && wasAtNewest) {
      messageHistory.scrollTop = messageHistory.scrollHeight;
      markMessagesRead();
    }
  }

  const canChat = bluetooth?.view?.phase === "playing";
  quickMessageArea.hidden = !canChat;
  const coolingDown = Date.now() < localChatCooldownUntil;
  const disconnected = isBluetoothTransportInterrupted();
  const disabled = !canChat || coolingDown || disconnected;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#quick-message-grid button")) button.disabled = disabled;
  messageInput.disabled = !canChat || disconnected;
  messageSend.disabled = disabled || !messageInput.value.trim();
  messageCharacterCount.textContent = `${Array.from(messageInput.value).length}/${CHAT_MAX_CHARACTERS}`;
  messageNewButton.hidden = !messageDrawerOpen || !messageHasUnread || wasAtNewest;
}

function setMessageDrawer(open: boolean): void {
  messageDrawerOpen = open && !gameView.hidden;
  messageDrawer.hidden = !messageDrawerOpen;
  messagePanelToggle.setAttribute("aria-expanded", String(messageDrawerOpen));
  if (messageDrawerOpen) {
    setBattleActionMenu(false);
    setBattleSkillPanel(false);
    renderMessagePanel();
    requestAnimationFrame(() => {
      messageHistory.scrollTop = messageHistory.scrollHeight;
      markMessagesRead();
    });
  }
  renderGame();
}

function resetMessageUi(clearDraft: boolean): void {
  messageDrawerOpen = false;
  messageDrawer.hidden = true;
  messagePanelToggle.setAttribute("aria-expanded", "false");
  messageHasUnread = false;
  lastRenderedMessageId = undefined;
  lastMessageSignature = "";
  localChatCooldownUntil = 0;
  if (chatCooldownTimer) window.clearTimeout(chatCooldownTimer);
  chatCooldownTimer = undefined;
  if (clearDraft) messageInput.value = "";
  messageHistory.replaceChildren();
}

function beginChatCooldown(): void {
  localChatCooldownUntil = Date.now() + CHAT_COOLDOWN_MS;
  if (chatCooldownTimer) window.clearTimeout(chatCooldownTimer);
  chatCooldownTimer = window.setTimeout(renderMessagePanel, CHAT_COOLDOWN_MS + 20);
  renderMessagePanel();
}

function sendBluetoothChat(rawText: string, clearInput: boolean): void {
  if (!bluetooth?.view || bluetooth.view.phase !== "playing") return;
  if (isBluetoothTransportInterrupted() || Date.now() < localChatCooldownUntil) return;
  const text = rawText.trim();
  if (!text || /\r|\n/.test(text) || Array.from(text).length > CHAT_MAX_CHARACTERS) return;
  const messageId = bluetoothActionId();
  const action: BluetoothRoomAction = { kind: "chat", messageId, text };
  try {
    if (bluetooth.role === "host") {
      bluetooth.hostRoom!.handle(BLUETOOTH_HOST_PLAYER, action);
      publishBluetoothViews();
    } else {
      sendBluetoothEnvelope({ v: BLUETOOTH_PROTOCOL_VERSION, type: "action", id: `chat:${messageId}`, payload: action });
    }
    beginChatCooldown();
    if (clearInput) messageInput.value = "";
    renderMessagePanel();
    if (clearInput) messageInput.focus({ preventScroll: true });
  } catch {
    // Chat send failures stay silent; the preserved draft can be retried after reconnect.
  }
}

function nextActionId(): string {
  const values = new Uint32Array(2);
  globalThis.crypto.getRandomValues(values);
  actionSequence += 1;
  return `local-${Date.now().toString(36)}-${values[0].toString(36)}-${values[1].toString(36)}-${actionSequence}`;
}

function randomSessionText(prefix: string): string {
  const values = new Uint32Array(2);
  globalThis.crypto.getRandomValues(values);
  return `${prefix}-${Date.now().toString(36)}-${values[0].toString(36)}${values[1].toString(36)}`;
}

function bluetoothModeConfig(): { heroesEnabled: boolean; mutationsEnabled: boolean } {
  return { heroesEnabled: true, mutationsEnabled: true };
}

function randomIndex(maxExclusive: number): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0] % maxExclusive;
}

function randomHero(): HeroId {
  return HERO_IDS[randomIndex(HERO_IDS.length)];
}

function randomRpsChoice(): RpsChoice {
  const choices: readonly RpsChoice[] = ["rock", "scissors", "paper"];
  return choices[randomIndex(choices.length)];
}

function randomMutation(heroes?: Record<Side, HeroId>): MutationId {
  // Transitional flat draw until the four outer rarity probabilities are confirmed.
  return drawRuntimeMutation(randomIndex, heroes);
}

function randomOwnHalfPosition(side: Side): Position {
  const index = randomIndex(45);
  return { x: index % 9, y: (side === "red" ? 5 : 0) + Math.floor(index / 9) };
}

function setBluetoothStatus(message: string): void {
  bluetoothStatus.textContent = message;
}

function isBluetoothTransportInterrupted(): boolean {
  return Boolean(bluetooth?.everConnected && bluetooth.nativeState !== "CONNECTED");
}

function pauseBluetoothUiClocks(): void {
  if (battleTurnDeadlineAt !== undefined && battlePausedRemainingMs === undefined) {
    battlePausedRemainingMs = Math.max(0, battleTurnDeadlineAt - Date.now());
    battleTurnDeadlineAt = undefined;
  }
  if (openingActive && openingTimer !== undefined && openingDeadlineAt !== undefined && openingPausedRemainingMs === undefined) {
    openingPausedRemainingMs = Math.max(0, openingDeadlineAt - Date.now());
    window.clearTimeout(openingTimer);
    openingTimer = undefined;
  }
}

function scheduleOpeningStage(stage: "mutation" | "heroes", delayMs: number): void {
  openingStage = stage;
  openingDeadlineAt = Date.now() + delayMs;
  if (openingTimer) window.clearTimeout(openingTimer);
  openingTimer = window.setTimeout(() => {
    openingTimer = undefined;
    openingDeadlineAt = undefined;
    if (isBluetoothTransportInterrupted()) {
      openingPausedRemainingMs = 0;
      return;
    }
    if (stage === "mutation") {
      mutationReveal.hidden = true;
      const heroes = battleHeroes();
      if (!heroes) {
        openingActive = false;
        openingCompletion?.();
        openingCompletion = undefined;
        return;
      }
      const blackHero = element<HTMLElement>("intro-black-hero");
      const redHero = element<HTMLElement>("intro-red-hero");
      blackHero.querySelector("b")!.textContent = battleHeroName("black");
      redHero.querySelector("b")!.textContent = battleHeroName("red");
      heroIntroStage.hidden = false;
      heroIntroStage.classList.add("playing");
      scheduleOpeningStage("heroes", 2_000);
      return;
    }
    heroIntroStage.classList.remove("playing");
    heroIntroStage.hidden = true;
    openingSequence.hidden = true;
    openingActive = false;
    openingStage = undefined;
    const heroes = battleHeroes();
    if (heroes) setBattleHeroAvatars(heroes, true);
    const complete = openingCompletion;
    openingCompletion = undefined;
    complete?.();
  }, Math.max(0, delayMs));
}

function resumeBluetoothUiClocks(): void {
  if (battlePausedRemainingMs !== undefined) {
    battleTurnDeadlineAt = Date.now() + battlePausedRemainingMs;
    battlePausedRemainingMs = undefined;
  }
  if (openingActive && openingStage && openingPausedRemainingMs !== undefined) {
    const remaining = openingPausedRemainingMs;
    openingPausedRemainingMs = undefined;
    scheduleOpeningStage(openingStage, remaining);
  }
}

function hidePrimaryViews(): void {
  if (messageDrawerOpen) setMessageDrawer(false);
  setBattleActionMenu(false);
  setBattleSkillPanel(false);
  closeMatchDetail();
  mainMenuView.hidden = true;
  bluetoothLobbyView.hidden = true;
  settingsView.hidden = true;
  rulesView.hidden = true;
  heroView.hidden = true;
  rpsView.hidden = true;
  gameView.hidden = true;
}

function closeMatchResult(): void {
  matchResultLayer.hidden = true;
}

function showMainMenu(): void {
  disconnectLayer.hidden = true;
  closeMatchResult();
  hidePrimaryViews();
  mainMenuView.hidden = false;
  openingSequence.hidden = true;
}

function readBluetoothAvailability(): BluetoothAvailabilityStatus | undefined {
  const bridge = nativeBluetooth();
  if (!bridge) return undefined;
  try {
    return JSON.parse(bridge.status()) as BluetoothAvailabilityStatus;
  } catch {
    return undefined;
  }
}

function resetBluetoothLobbyPanels(): void {
  bluetoothInitialActions.hidden = false;
  bluetoothJoinPanel.hidden = true;
  bluetoothSessionPanel.hidden = true;
  bluetoothRetryButton.hidden = true;
  bluetoothRematchTimer.hidden = true;
  bluetoothRematchRequestButton.hidden = true;
  bluetoothRematchAcceptButton.hidden = true;
  bluetoothRematchDeclineButton.hidden = true;
  bluetoothCancelButton.hidden = false;
  bluetoothReturnButton.hidden = true;
  bluetoothSessionDevice.hidden = true;
  bluetoothSessionDevice.textContent = "";
  bluetoothSessionDetail.textContent = "";
}

function showBluetoothSessionState(options: {
  kicker: string;
  title: string;
  detail: string;
  deviceName?: string;
  retry?: boolean;
  cancel?: boolean;
  back?: boolean;
}): void {
  bluetoothInitialActions.hidden = true;
  bluetoothJoinPanel.hidden = true;
  bluetoothStateActions.hidden = true;
  bluetoothSessionPanel.hidden = false;
  bluetoothSessionKicker.textContent = options.kicker;
  bluetoothSessionTitle.textContent = options.title;
  bluetoothSessionDetail.textContent = options.detail;
  bluetoothSessionDevice.textContent = options.deviceName ?? "";
  bluetoothSessionDevice.hidden = !options.deviceName;
  bluetoothRetryButton.hidden = !options.retry;
  bluetoothRematchTimer.hidden = true;
  bluetoothRematchRequestButton.hidden = true;
  bluetoothRematchAcceptButton.hidden = true;
  bluetoothRematchDeclineButton.hidden = true;
  bluetoothCancelButton.hidden = options.cancel === false;
  bluetoothReturnButton.hidden = !options.back;
}

function cancelBluetoothSetup(): void {
  nativeBluetooth()?.disconnect();
  bluetooth = undefined;
  resetBluetoothLobbyPanels();
  renderBluetoothAvailability();
}

function leaveBluetoothLobby(): void {
  if (bluetooth?.everConnected) {
    showDialog(
      "断开蓝牙对局",
      "确定要断开当前蓝牙对局并返回主菜单吗？",
      "确认断开",
      () => {
        nativeBluetooth()?.disconnect();
        bluetooth = undefined;
        showMainMenu();
      },
    );
    return;
  }
  nativeBluetooth()?.disconnect();
  bluetooth = undefined;
  showMainMenu();
}

function renderBluetoothAvailability(): void {
  const bridge = nativeBluetooth();
  bluetoothStateActions.hidden = true;
  bluetoothEnableButton.hidden = true;
  bluetoothPermissionButton.hidden = true;
  bluetoothAppSettingsButton.hidden = true;

  const setControlsDisabled = (disabled: boolean) => {
    element<HTMLButtonElement>("bluetooth-host-button").disabled = disabled;
    element<HTMLButtonElement>("bluetooth-join-mode-button").disabled = disabled;
    element<HTMLButtonElement>("bluetooth-refresh-button").disabled = disabled;
    element<HTMLButtonElement>("bluetooth-join-button").disabled = disabled;
  };

  if (!bridge) {
    bluetoothInitialActions.hidden = false;
    setControlsDisabled(true);
    setBluetoothStatus("当前为普通浏览器。蓝牙对局仅在 Android 安装包中可用。");
    return;
  }

  try {
    const status = readBluetoothAvailability();
    if (!status) throw new Error("status unavailable");
    if (status.available === false) {
      bluetoothInitialActions.hidden = true;
      bluetoothJoinPanel.hidden = true;
      bluetoothSessionPanel.hidden = true;
      setControlsDisabled(true);
      setBluetoothStatus("此设备不支持蓝牙。");
      return;
    }
    if (status.enabled === false) {
      bluetoothInitialActions.hidden = true;
      bluetoothJoinPanel.hidden = true;
      bluetoothSessionPanel.hidden = true;
      setControlsDisabled(true);
      bluetoothStateActions.hidden = false;
      bluetoothEnableButton.hidden = false;
      setBluetoothStatus("蓝牙当前处于关闭状态，请先开启蓝牙。");
      return;
    }
    if (status.permissionGranted === false) {
      bluetoothInitialActions.hidden = true;
      bluetoothJoinPanel.hidden = true;
      bluetoothSessionPanel.hidden = true;
      setControlsDisabled(true);
      bluetoothStateActions.hidden = false;
      bluetoothPermissionButton.hidden = false;
      setBluetoothStatus("蓝牙对局需要附近设备权限，用于连接已配对的另一台手机。");
      return;
    }
    setControlsDisabled(false);
    if (bluetoothJoinPanel.hidden && bluetoothSessionPanel.hidden) bluetoothInitialActions.hidden = false;
    setBluetoothStatus("请选择创建对局或加入对局。");
  } catch {
    setControlsDisabled(true);
    setBluetoothStatus("无法读取蓝牙状态，请稍后重试。");
  }
}

function showBluetoothLobby(): void {
  if (!GAME_MODES[selectedGameMode].featuresReady) return showBaseModePreview();
  disconnectLayer.hidden = true;
  hidePrimaryViews();
  bluetoothLobbyView.hidden = false;
  resetBluetoothLobbyPanels();
  openingSequence.hidden = true;
  element<HTMLButtonElement>("bluetooth-open-settings-button").disabled = !nativeBluetooth();
  renderBluetoothAvailability();
}

function activateLocalGame(): void {
  if (!GAME_MODES[selectedGameMode].featuresReady) {
    showBaseModePreview();
    return;
  }
  bluetooth?.role && nativeBluetooth()?.disconnect();
  bluetooth = undefined;
  resetMatch();
  beginLocalHeroSelection();
}

function applyBluetoothView(view: PlayerRemoteRoomView): void {
  if (!bluetooth) return;
  const prior = bluetooth.view;
  bluetooth.view = view;
  bluetooth.pendingAction = false;
  rpsPublic = view.rps ?? rpsPublic;
  gameState = view.state;
  gameSecret = undefined;
  selectedPieceId = undefined;
  assassinationArmed = false;
  strongStrikeArmed = false;
  if (view.phase === "hero_preparation") {
    bluetooth.trapDraft = view.ownTrapDraft?.map((position) => ({ ...position })) ?? bluetooth.trapDraft;
  } else if (view.phase !== "hero_intro") {
    bluetooth.trapDraft = [];
  }
  const assignments = view.rps?.assignments;
  if (assignments) {
    rpsPublic = view.rps!;
  }
  if (prior?.state && view.state && prior.state.lastMove?.actionId !== view.state.lastMove?.actionId) {
    const actionHistory = view.messages?.find((message) => message.id === `system:${view.state?.lastMove?.actionId}`)?.text ?? "";
    const skillCue = actionHistory.includes("发动刺杀机会") ? "刺杀机会发动" : actionHistory.includes("发动刺杀") ? "刺杀发动" : undefined;
    queueFormalEventCues(view.state, view.lastTrapTrigger?.actionId === view.state.lastMove?.actionId, skillCue);
  }

  if (prior?.phase === "finished" && view.phase !== "finished") {
    resetMessageUi(true);
    closeMatchResult();
    bluetooth.openingStarted = false;
    bluetooth.playedTerminalEventId = undefined;
    bluetooth.shownFinishRevision = undefined;
    bluetooth.shownForfeitActionId = undefined;
    bluetooth.shownDisconnectOutcomeKey = undefined;
  }

  if (view.phase === "finished" && view.rematch) {
    showBluetoothRematchLobby(view);
    return;
  }

  const heroSelectionTimedOut = prior?.phase === "hero_selection"
    && view.phase === "rps"
    && Date.now() >= (prior.features?.heroSelection?.deadlineAt ?? Number.POSITIVE_INFINITY)
    && Boolean(view.ownHeroChoice);
  if (heroSelectionTimedOut) {
    bluetoothLobbyView.hidden = true;
    mainMenuView.hidden = true;
    settingsView.hidden = true;
    heroView.hidden = false;
    rpsView.hidden = true;
    gameView.hidden = true;
    renderHeroSelection({
      selected: view.ownHeroChoice,
      confirmed: true,
      opponentConfirmed: true,
      deadlineAt: prior?.features?.heroSelection?.deadlineAt,
    });
    showToast("选择超时，系统已为未确认玩家随机英雄。");
    window.setTimeout(() => {
      if (bluetooth?.view?.phase !== "rps") return;
      heroView.hidden = true;
      rpsView.hidden = false;
      renderRps();
    }, 800);
    return;
  }

  if (view.phase === "hero_selection") {
    bluetoothLobbyView.hidden = true;
    mainMenuView.hidden = true;
    settingsView.hidden = true;
    heroView.hidden = false;
    rpsView.hidden = true;
    gameView.hidden = true;
    renderHeroSelection();
  } else if (view.phase === "rps") {
    bluetoothLobbyView.hidden = true;
    mainMenuView.hidden = true;
    settingsView.hidden = true;
    heroView.hidden = true;
    rpsView.hidden = false;
    gameView.hidden = true;
    renderRps();
  } else if (view.state) {
    bluetoothLobbyView.hidden = true;
    mainMenuView.hidden = true;
    settingsView.hidden = true;
    heroView.hidden = true;
    rpsView.hidden = true;
    gameView.hidden = false;
    latestAnnouncement = bluetoothAnnouncement(view);
    renderGame();
    if (view.phase === "hero_intro" && !bluetooth.openingStarted) {
      bluetooth.openingStarted = true;
      runOpeningSequence(() => handleBluetoothAction({ kind: "hero_intro_complete" }));
    }
  }

  const ownPlayerId = ownBluetoothPlayerId();
  const forfeitOutcome = view.forfeitOutcome;
  if (forfeitOutcome && ownPlayerId && bluetooth.shownForfeitActionId !== forfeitOutcome.actionId) {
    bluetooth.shownForfeitActionId = forfeitOutcome.actionId;
    const lost = forfeitOutcome.loserPlayerId === ownPlayerId;
    setBattleActionMenu(false);
    closeMatchDetail();
    window.setTimeout(() => showDialog(
      lost ? "已退出对局" : "对方已退出",
      lost ? "你已退出当前对局，本局判负。" : "对方已臣服于您，获得胜利！",
      "返回主菜单",
      () => {
        nativeBluetooth()?.disconnect();
        bluetooth = undefined;
        showMainMenu();
      },
    ), 50);
    return;
  }
  const disconnectOutcome = view.disconnectOutcome;
  if (disconnectOutcome && ownPlayerId && disconnectOutcome.timedOutPlayerIds.includes(ownPlayerId)) {
    messageInput.value = "";
    const key = `lost:${[...disconnectOutcome.timedOutPlayerIds].sort().join("|")}`;
    if (bluetooth.nativeState === "CONNECTED" && bluetooth.shownDisconnectOutcomeKey !== key) {
      bluetooth.shownDisconnectOutcomeKey = key;
      const draw = disconnectOutcome.timedOutPlayerIds.length > 1;
      window.setTimeout(() => showDialog(
        draw ? "断线平局" : "断线超时",
        draw ? "双方累计断线均达到 60 秒，本局平局。" : "你的累计断线时间达到 60 秒，本局判负。",
        "返回主菜单",
        () => {
          nativeBluetooth()?.disconnect();
          bluetooth = undefined;
          showMainMenu();
        },
      ), 50);
    }
    return;
  }
  if (disconnectOutcome && ownPlayerId && disconnectOutcome.winnerPlayerId === ownPlayerId && !view.state) {
    const key = `won:${disconnectOutcome.timedOutPlayerIds.join("|")}`;
    if (bluetooth.shownDisconnectOutcomeKey !== key) {
      bluetooth.shownDisconnectOutcomeKey = key;
      disconnectLayer.hidden = true;
      window.setTimeout(() => showDialog(
        "流放",
        "对方被流放至扭曲虚空。您获得胜利！",
        "返回蓝牙页",
        () => {
          nativeBluetooth()?.disconnect();
          bluetooth = undefined;
          showMainMenu();
        },
      ), 50);
    }
    return;
  }

  if (view.terminalAnimation && bluetooth.playedTerminalEventId !== view.terminalAnimation.eventId) {
    bluetooth.playedTerminalEventId = view.terminalAnimation.eventId;
    playRemoteTerminalAnimation(view.terminalAnimation);
  } else if (view.state?.status === "finished" && prior?.state?.revision !== view.state.revision
    && bluetooth.shownFinishRevision !== view.state.revision) {
    bluetooth.shownFinishRevision = view.state.revision;
    window.setTimeout(showMatchResult, 50);
  }
}

function showBluetoothRematchLobby(view = bluetooth?.view): void {
  if (!bluetooth || !view) return;
  closeMatchResult();
  hidePrimaryViews();
  bluetoothLobbyView.hidden = false;
  bluetoothInitialActions.hidden = true;
  bluetoothJoinPanel.hidden = true;
  bluetoothStateActions.hidden = true;
  bluetoothSessionPanel.hidden = false;
  bluetoothCancelButton.hidden = true;
  bluetoothReturnButton.hidden = true;
  bluetoothRetryButton.hidden = true;
  bluetoothRematchAcceptButton.hidden = true;
  bluetoothRematchDeclineButton.hidden = true;
  bluetoothRematchRequestButton.hidden = true;
  bluetoothRematchAcceptButton.disabled = false;
  bluetoothRematchDeclineButton.disabled = false;
  bluetoothRematchRequestButton.disabled = false;
  bluetoothRematchTimer.hidden = true;
  bluetoothSessionKicker.textContent = "蓝牙房间 · 已连接";
  bluetoothSessionDevice.hidden = true;
  const rematch = view.rematch;
  const own = ownBluetoothPlayerId();
  if (!rematch) {
    bluetoothSessionTitle.textContent = "本局已经结束";
    bluetoothSessionDetail.textContent = "连接仍然保留，可以再次邀请对方开始新的一局。";
    bluetoothRematchRequestButton.hidden = false;
    return;
  }
  if (rematch.status === "pending") {
    bluetoothRematchTimer.hidden = false;
    bluetoothRematchTimer.textContent = String(secondsRemaining(rematch.deadlineAt));
    if (rematch.requestedBy === own) {
      bluetoothSessionTitle.textContent = "等待对方确认";
      bluetoothSessionDetail.textContent = `再战邀请已发送；对方可在 ${REMATCH_INVITATION_DURATION_MS / 1_000} 秒内接受或拒绝。`;
    } else {
      bluetoothSessionTitle.textContent = "对方邀请再战";
      bluetoothSessionDetail.textContent = "接受后将重新选择英雄、猜拳，并重新随机本局畸变。";
      bluetoothRematchAcceptButton.hidden = false;
      bluetoothRematchDeclineButton.hidden = false;
    }
    return;
  }
  bluetoothSessionTitle.textContent = rematch.status === "declined"
    ? rematch.respondedBy === own ? "已拒绝再战" : "对方已拒绝再战"
    : "对方未响应再战请求";
  bluetoothSessionDetail.textContent = "仍保持蓝牙连接，可以稍后再次发起邀请。";
  bluetoothRematchRequestButton.hidden = false;
}

function requestBluetoothRematch(): void {
  if (!bluetooth?.view || bluetooth.view.phase !== "finished") return;
  showBluetoothRematchLobby(bluetooth.view);
  bluetoothSessionTitle.textContent = "正在发送再战邀请";
  bluetoothSessionDetail.textContent = "请稍候，房主正在确认邀请状态。";
  bluetoothRematchRequestButton.hidden = true;
  handleBluetoothAction({ kind: "rematch_request", actionId: bluetoothActionId() });
}

function respondBluetoothRematch(accept: boolean): void {
  if (!bluetooth?.view?.rematch || bluetooth.view.rematch.status !== "pending") return;
  bluetoothRematchAcceptButton.disabled = true;
  bluetoothRematchDeclineButton.disabled = true;
  handleBluetoothAction({ kind: "rematch_response", accept });
  if (!accept) {
    bluetoothSessionTitle.textContent = "已拒绝再战";
    bluetoothSessionDetail.textContent = "仍保持蓝牙连接，可以稍后由任一方再次邀请。";
  }
}

function bluetoothAnnouncement(view: PlayerRemoteRoomView): string {
  if (view.lastTrapTrigger) return "猎物已踏入陷阱！伏击触发。";
  if (view.features?.mutation) return `本局畸变：${mutationName(view.features.mutation)}。`;
  return "房主正在权威裁定本局；双方只会收到各自允许看到的信息。";
}

function mutationName(mutation: MutationId): string {
  return mutationDefinition(mutation).name;
}

function showCurrentMutationDetails(): void {
  const mutation = bluetooth?.view?.features?.mutation ?? gameState?.featureRules?.mutation;
  if (!mutation) {
    showMatchDetails("本局畸变", "<p>本局没有启用畸变。</p>");
    return;
  }
  const definition = mutationDefinition(mutation);
  showMatchDetails(
    "本局畸变",
    `<h3>${definition.name}</h3><p><strong>${MUTATION_RARITY_LABELS[definition.rarity]}</strong>｜${definition.summary}</p><p>${definition.rules}</p>`,
  );
}

function sendBluetoothEnvelope<T>(envelope: { v: typeof BLUETOOTH_PROTOCOL_VERSION; type: "hello" | "action" | "snapshot" | "error" | "ping" | "pong"; id?: string; payload?: T }): void {
  const bridge = nativeBluetooth();
  if (!bridge) throw new Error("此设备没有蓝牙桥接能力");
  bridge.send(encodeBluetoothEnvelope(envelope));
}

function refreshBluetoothHostViews(sendGuest: boolean): void {
  if (!bluetooth?.hostRoom) return;
  const views = bluetooth.hostRoom.views();
  applyBluetoothView(views.host);
  if (sendGuest && bluetooth.nativeState === "CONNECTED") {
    sendBluetoothEnvelope(createBluetoothSnapshot(`snapshot-${views.publicRoom.updatedAt}-${views.publicRoom.phase}`, views.guest));
  }
}

function publishBluetoothViews(): void {
  refreshBluetoothHostViews(true);
}

function handleBluetoothAction(action: BluetoothRoomAction): void {
  if (!bluetooth) return;
  if (isBluetoothTransportInterrupted()) return showToast("连接正在恢复，当前操作已锁定。");
  if (bluetooth.pendingAction) return showToast("正在等待房主确认上一项操作。");
  if (bluetooth.role === "host") {
    try {
      bluetooth.hostRoom!.handle(BLUETOOTH_HOST_PLAYER, action);
      publishBluetoothViews();
    } catch (error) {
      showToast(error instanceof RuleError ? error.message : "房主裁定失败，请重试。");
    }
    return;
  }
  try {
    bluetooth.pendingAction = true;
    sendBluetoothEnvelope({ v: BLUETOOTH_PROTOCOL_VERSION, type: "action", id: bluetoothActionId(), payload: action });
    showToast("操作已发送，等待房主裁定。");
  } catch (error) {
    bluetooth.pendingAction = false;
    showToast(error instanceof Error ? error.message : "蓝牙发送失败。");
  }
}

function handleIncomingBluetoothMessage(raw: string): void {
  if (!bluetooth) return;
  try {
    const envelope = parseBluetoothEnvelope(raw);
    if (bluetooth.role === "host" && envelope.type === "action") {
      const action = envelope.payload as BluetoothRoomAction;
      try {
        bluetooth.hostRoom!.handle(BLUETOOTH_GUEST_PLAYER, action);
        publishBluetoothViews();
      } catch (error) {
        const message = error instanceof RuleError ? error.message : "房主拒绝了此操作。";
        sendBluetoothEnvelope({ v: BLUETOOTH_PROTOCOL_VERSION, type: "error", id: envelope.id, payload: { message } });
        if (action.kind !== "chat") showToast(message);
      }
    } else if (bluetooth.role === "guest" && envelope.type === "snapshot") {
      applyBluetoothView(envelope.payload as PlayerRemoteRoomView);
    } else if (envelope.type === "error") {
      bluetooth.pendingAction = false;
      const payload = envelope.payload as { message?: string } | undefined;
      if (!envelope.id?.startsWith("chat:")) showToast(payload?.message ?? "房主拒绝了此操作。");
    } else if (envelope.type === "ping") {
      sendBluetoothEnvelope({ v: BLUETOOTH_PROTOCOL_VERSION, type: "pong", id: envelope.id });
    }
  } catch (error) {
    showToast(error instanceof RuleError ? error.message : "收到的蓝牙消息无效。");
  }
}

function beginBluetoothHost(): void {
  const bridge = nativeBluetooth();
  if (!bridge) return showToast("蓝牙双机模式只能在 Android 安装包内使用。");
  const localDeviceName = readBluetoothAvailability()?.deviceName || "本机设备";
  bluetooth = {
    role: "host",
    nativeState: "STARTING",
    pendingAction: false,
    trapDraft: [],
    localDeviceName,
  };
  showBluetoothSessionState({
    kicker: "创建对局",
    title: "正在建立房间",
    deviceName: localDeviceName,
    detail: "正在开启房主监听，请稍候。",
    cancel: true,
  });
  setBluetoothStatus("正在开启房主监听，请让另一台已配对手机选择本机并加入。");
  bridge.host();
}

function beginBluetoothGuest(address: string, targetName: string): void {
  const bridge = nativeBluetooth();
  if (!bridge) return showToast("蓝牙双机模式只能在 Android 安装包内使用。");
  bluetooth = {
    role: "guest",
    nativeState: "CONNECTING",
    pendingAction: false,
    trapDraft: [],
    targetAddress: address,
    targetName,
  };
  showBluetoothSessionState({
    kicker: "加入对局",
    title: "正在连接",
    deviceName: targetName,
    detail: "正在连接房主设备，请稍候。",
    cancel: true,
  });
  setBluetoothStatus("正在连接房主设备，请稍候。");
  bridge.join(address);
}

function joinBluetoothRoom(): void {
  const select = element<HTMLSelectElement>("bluetooth-device");
  const address = select.value;
  if (!address) return showToast("请先刷新并选择已配对的房主设备。");
  const selected = select.selectedOptions[0];
  beginBluetoothGuest(address, selected?.dataset.name || selected?.textContent || "房主设备");
}

function retryBluetoothConnection(): void {
  if (!bluetooth) return showBluetoothLobby();
  if (bluetooth.role === "host") {
    beginBluetoothHost();
    return;
  }
  if (bluetooth.targetAddress) {
    const { targetAddress, targetName = "房主设备" } = bluetooth;
    beginBluetoothGuest(targetAddress, targetName);
    return;
  }
  showBluetoothLobby();
}

function refreshBluetoothDevices(): void {
  const bridge = nativeBluetooth();
  if (!bridge) return showToast("蓝牙双机模式只能在 Android 安装包内使用。");
  try {
    const devices = JSON.parse(bridge.pairedDevices()) as Array<{ name?: string; address: string }>;
    const select = element<HTMLSelectElement>("bluetooth-device");
    select.replaceChildren(...devices.map((device) => {
      const option = document.createElement("option");
      option.value = device.address;
      option.dataset.name = device.name || "未命名设备";
      option.textContent = `${device.name || "未命名设备"} · ${device.address}`;
      return option;
    }));
    if (devices.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "没有已配对设备";
      select.append(option);
    }
    element<HTMLButtonElement>("bluetooth-join-button").disabled = devices.length === 0;
    setBluetoothStatus(devices.length === 0
      ? "没有找到已配对设备。请先在系统蓝牙设置中完成配对，再重新检测。"
      : `已读取 ${devices.length} 台已配对设备。`);
  } catch {
    element<HTMLButtonElement>("bluetooth-join-button").disabled = true;
    showToast("读取已配对设备失败，请检查蓝牙权限。");
  }
}

function resetMatch(): void {
  localMessages = [];
  resetMessageUi(true);
  renderedCaptureCounts = { red: 0, black: 0 };
  eventCueQueue = [];
  lastEventCueActionId = undefined;
  if (eventCueTimer) window.clearTimeout(eventCueTimer);
  eventCueTimer = undefined;
  battleEventCue.hidden = true;
  const session = createRpsState(PLAYER_ONE, PLAYER_TWO);
  rpsPublic = session.publicState;
  rpsSecret = session.secretState;
  rpsActor = PLAYER_ONE;
  rpsDraft = undefined;
  rpsDraftRound = 1;
  localRpsDeadlineAt = undefined;
  gameState = undefined;
  gameSecret = undefined;
  selectedPieceId = undefined;
  assassinationArmed = false;
  strongStrikeArmed = false;
  localHeroes = {};
  localHeroChoices = {}; localHeroPackages = {}; heroFormDraft = "front"; galakrondDraft = "unspeakable";
  localHeroConfirmed = { [PLAYER_ONE]: false, [PLAYER_TWO]: false };
  localHeroActor = PLAYER_ONE;
  heroDraft = undefined; heroFormDraft = "front"; galakrondDraft = "unspeakable";
  activeSkillIndex = 0;
  heroSelectionDeadlineAt = undefined;
  localTraps = [];
  if (gameState && gameSecret) initializeFeatureSecret(gameState, gameSecret);
  trapSetupQueue = [];
  trapSetupSide = undefined;
  localTrapDraft = [];
  heroPreparationDeadlineAt = undefined;
  localPreparationActive = false;
  openingActive = false;
  openingStage = undefined;
  openingDeadlineAt = undefined;
  openingPausedRemainingMs = undefined;
  openingCompletion = undefined;
  battleTurnRevision = undefined;
  battleTurnDeadlineAt = undefined;
  battlePausedRemainingMs = undefined;
  disconnectLayer.hidden = true;
  closeMatchResult();
  if (executionTimer) window.clearTimeout(executionTimer);
  if (openingTimer) window.clearTimeout(openingTimer);
  executionTimer = undefined;
  openingTimer = undefined;
  executionGhost.hidden = true;
  executionGhost.className = "execution-ghost";
  terminationEffect.className = "termination-effect";
  battleActionMenu.hidden = true;
  battleMoreButton.setAttribute("aria-expanded", "false");
  hidePrimaryViews();
}

function beginLocalHeroSelection(): void {
  localHeroActor = PLAYER_ONE;
  heroSelectionDeadlineAt = Date.now() + HERO_SELECTION_DURATION_MS;
  mainMenuView.hidden = true;
  bluetoothLobbyView.hidden = true;
  settingsView.hidden = true;
  heroView.hidden = false;
  rpsView.hidden = true;
  gameView.hidden = true;
  renderHeroSelection();
}

function loadUiPreferences(): LocalUiPreferences {
  try {
    const stored = localStorage.getItem(UI_PREFERENCES_KEY);
    if (!stored) return { ...DEFAULT_UI_PREFERENCES };
    const parsed = JSON.parse(stored) as Partial<LocalUiPreferences>;
    return {
      sound: parsed.sound ?? DEFAULT_UI_PREFERENCES.sound,
      haptics: parsed.haptics ?? DEFAULT_UI_PREFERENCES.haptics,
      reduceMotion: parsed.reduceMotion ?? DEFAULT_UI_PREFERENCES.reduceMotion,
    };
  } catch {
    return { ...DEFAULT_UI_PREFERENCES };
  }
}

function applyUiPreferences(preferences: LocalUiPreferences): void {
  element<HTMLInputElement>("sound-setting").checked = preferences.sound;
  element<HTMLInputElement>("haptics-setting").checked = preferences.haptics;
  element<HTMLInputElement>("reduce-motion-setting").checked = preferences.reduceMotion;
  document.documentElement.classList.toggle("reduce-motion", preferences.reduceMotion);
}

function saveUiPreferences(): void {
  const preferences: LocalUiPreferences = {
    sound: element<HTMLInputElement>("sound-setting").checked,
    haptics: element<HTMLInputElement>("haptics-setting").checked,
    reduceMotion: element<HTMLInputElement>("reduce-motion-setting").checked,
  };
  try {
    localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    showToast("当前环境无法保存设置。");
  }
  applyUiPreferences(preferences);
}

function showSettings(): void {
  hidePrimaryViews();
  settingsView.hidden = false;
  applyUiPreferences(loadUiPreferences());
  renderGameModeSetting();
}

function showRulesTab(tabName: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".rule-tab")) {
    const active = tab.dataset.ruleTab === tabName;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  for (const panel of document.querySelectorAll<HTMLElement>(".rule-panel")) {
    panel.hidden = panel.dataset.rulePanel !== tabName;
  }
  element<HTMLElement>("rules-scroll").scrollTop = 0;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function createMovementSvg(guide: MovementGuide): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 200 200");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${guide.title}走法示意图`);

  const appendSvgElement = <K extends keyof SVGElementTagNameMap>(
    tag: K,
    attributes: Record<string, string>,
  ): SVGElementTagNameMap[K] => {
    const node = document.createElementNS(SVG_NAMESPACE, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    svg.append(node);
    return node;
  };

  for (const coordinate of [20, 60, 100, 140, 180]) {
    appendSvgElement("line", { x1: "20", y1: String(coordinate), x2: "180", y2: String(coordinate), class: "movement-grid-line" });
    appendSvgElement("line", { x1: String(coordinate), y1: "20", x2: String(coordinate), y2: "180", class: "movement-grid-line" });
  }
  for (const route of guide.routes) {
    appendSvgElement("polyline", {
      points: route.points.map(([x, y]) => `${x},${y}`).join(" "),
      class: `movement-route${route.secondary ? " secondary" : ""}`,
    });
  }
  for (const [x, y] of guide.destinations) {
    appendSvgElement("circle", { cx: String(x), cy: String(y), r: "7", class: "movement-destination" });
  }
  for (const obstacle of guide.obstacles ?? []) {
    const [x, y] = obstacle.at;
    appendSvgElement("circle", { cx: String(x), cy: String(y), r: "6", class: "movement-obstacle" });
    const label = appendSvgElement("text", { x: String(x), y: String(y - 10), class: "movement-obstacle-text" });
    label.textContent = obstacle.label;
  }
  appendSvgElement("circle", { cx: "100", cy: "100", r: "20", class: "movement-origin" });
  const glyph = appendSvgElement("text", { x: "100", y: "100", class: "movement-origin-text" });
  glyph.textContent = guide.glyph;
  if (guide.caption) {
    const caption = appendSvgElement("text", { x: "100", y: "13", class: "movement-caption" });
    caption.textContent = guide.caption;
  }
  return svg;
}

function closeRuleDiagram(): void {
  ruleDiagramLayer.hidden = true;
}

function openRuleDiagram(guideId: MovementGuideId): void {
  const guide = movementGuides.find((candidate) => candidate.id === guideId);
  if (!guide) return;
  ruleDiagramTitle.textContent = guide.title;
  ruleDiagramArt.replaceChildren(createMovementSvg(guide));
  ruleDiagramDescription.textContent = guide.detail;
  ruleDiagramLayer.hidden = false;
  element<HTMLButtonElement>("rule-diagram-close").focus();
}

function renderMovementGuides(): void {
  pieceMovementGrid.replaceChildren(...movementGuides.map((guide) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "movement-card";
    button.dataset.guide = guide.id;
    button.setAttribute("aria-label", `放大查看${guide.title}走法`);
    const copy = document.createElement("span");
    copy.className = "movement-card-copy";
    const title = document.createElement("strong");
    title.textContent = guide.title;
    const summary = document.createElement("small");
    summary.textContent = guide.summary;
    copy.append(title, summary);
    button.append(createMovementSvg(guide), copy);
    button.addEventListener("click", () => openRuleDiagram(guide.id));
    return button;
  }));
}

function showRules(): void {
  hidePrimaryViews();
  rulesView.hidden = false;
  showRulesTab("basic");
}

function closeMatchDetail(): void {
  matchDetailLayer.hidden = true;
  matchDetailActions.hidden = true;
  matchDetailConfirm.onclick = null;
}

function showMatchDetails(title: string, content: string): void {
  setBattleActionMenu(false);
  matchDetailTitle.textContent = title;
  matchDetailBody.innerHTML = content;
  matchDetailActions.hidden = true;
  matchDetailLayer.hidden = false;
  matchDetailBody.scrollTop = 0;
}

function showMatchConfirmation(title: string, text: string, confirmLabel: string, action: () => void): void {
  setBattleActionMenu(false);
  matchDetailTitle.textContent = title;
  matchDetailBody.replaceChildren(Object.assign(document.createElement("p"), { textContent: text }));
  matchDetailActions.hidden = false;
  matchDetailConfirm.textContent = confirmLabel;
  matchDetailConfirm.onclick = () => {
    closeMatchDetail();
    action();
  };
  matchDetailLayer.hidden = false;
}

function showMatchRules(): void {
  showMatchDetails("对局规则", `
    <details open><summary>暗子与揭棋</summary><p>除将帅外的棋子全局混合。暗子第一步按所在位置对应兵种行动，落子后公开真实阵营与兵种。</p></details>
    <details><summary>移动与吃子</summary><p>明棋按真实兵种行动。明棋可吃任意阵营的暗子，但不能吃己方明棋，也不能把将帅当作普通目标直接吃掉。</p></details>
    <details><summary>控制权与背刺</summary><p>暗子揭示后由真实阵营控制；若异色棋揭示后立即攻击当前控制方将帅，按背刺及防御规则结算。</p></details>
    <details><summary>英雄与畸变</summary><p>英雄技能、公开状态和本局畸变会改变部分行动与结算；未触发陷阱坐标和暗子身份始终保持秘密。</p></details>
    <details><summary>胜负</summary><p>裁决、背刺、伏击、碾碎、困毙、认输和断线超时等路径均可结束对局。</p></details>
  `);
}

function handleSystemBack(): boolean {
  if (!disconnectLayer.hidden) return true;
  if (!ruleDiagramLayer.hidden) {
    closeRuleDiagram();
    return true;
  }
  if (flowDialog.open) {
    flowDialog.close();
    return true;
  }
  if (!matchResultLayer.hidden) {
    returnFromMatchResult();
    return true;
  }
  if (!matchDetailLayer.hidden) {
    closeMatchDetail();
    return true;
  }
  if (messageDrawerOpen) {
    setMessageDrawer(false);
    return true;
  }
  if (!matchMenuLayer.hidden) {
    setBattleActionMenu(false);
    return true;
  }
  if (!battleSkillPanel.hidden) {
    setBattleSkillPanel(false);
    return true;
  }
  if (assassinationArmed || strongStrikeArmed || (gameState?.assassination?.[gameState.turn]?.activePieceId === selectedPieceId)) {
    assassinationArmed = false;
    strongStrikeArmed = false;
    selectedPieceId = undefined;
    latestAnnouncement = "已取消技能目标选择。";
    renderGame();
    return true;
  }
  if (!settingsView.hidden) {
    showMainMenu();
    return true;
  }
  if (!rulesView.hidden) {
    showMainMenu();
    return true;
  }
  if (!bluetoothLobbyView.hidden) {
    leaveBluetoothLobby();
    return true;
  }
  if (!gameView.hidden) {
    if (gameState?.status === "finished") {
      showMainMenu();
      return true;
    }
    setBattleActionMenu(true);
    return true;
  }
  if (!heroView.hidden || !rpsView.hidden) {
    setBattleActionMenu(true);
    return true;
  }
  return false;
}

function showDialog(title: string, text: string, actionLabel: string, action: () => void): void {
  flowDialog.classList.remove("mode-preview-dialog");
  element<HTMLElement>("dialog-extra").replaceChildren();
  element<HTMLElement>("dialog-extra").hidden = true;
  dialogTitle.textContent = title;
  dialogText.textContent = text;
  dialogAction.textContent = actionLabel;
  dialogAction.onclick = () => {
    flowDialog.close();
    action();
  };
  if (!flowDialog.open) flowDialog.showModal();
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("visible");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function secondsRemaining(deadlineAt: number | undefined): number {
  return deadlineAt === undefined ? 0 : Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1_000));
}

function heroSelectionState(): { selected?: HeroId; confirmed: boolean; opponentConfirmed: boolean; deadlineAt?: number } {
  if (bluetooth?.view?.phase === "hero_selection") {
    const own = ownBluetoothPlayerId();
    const selection = bluetooth.view.features?.heroSelection;
    const confirmed = own ? Boolean(selection?.confirmed[own]) : false;
    const opponentConfirmed = own
      ? Object.entries(selection?.confirmed ?? {}).some(([id, value]) => id !== own && value)
      : false;
    return {
      selected: confirmed ? bluetooth.view.ownHeroChoice : heroDraft,
      confirmed,
      opponentConfirmed,
      deadlineAt: selection?.deadlineAt,
    };
  }
  const opponent = localHeroActor === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE;
  return {
    selected: localHeroConfirmed[localHeroActor] ? localHeroChoices[localHeroActor] : heroDraft,
    confirmed: localHeroConfirmed[localHeroActor],
    opponentConfirmed: localHeroConfirmed[opponent],
    deadlineAt: heroSelectionDeadlineAt,
  };
}

function renderHeroSelection(overrideState?: ReturnType<typeof heroSelectionState>): void {
  const state = overrideState ?? heroSelectionState();
  const selected = state.selected;
  const remaining = secondsRemaining(state.deadlineAt);
  const bluetoothSelection = bluetooth?.view?.phase === "hero_selection";
  const pending = Boolean(bluetooth?.pendingAction);
  heroSelectionTimer.textContent = String(remaining);
  heroSelectionTimer.classList.toggle("urgent", remaining <= 10);
  heroOpponentStatus.textContent = bluetoothSelection
    ? state.opponentConfirmed ? "对方已确定" : "对方选择中"
    : localHeroConfirmed[localHeroActor === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE]
      ? `${localHeroActor === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE}已确定`
      : `${localHeroActor === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE}待选择`;
  heroConfirmButton.textContent = state.confirmed ? "已确定" : pending ? "发送中" : "确定";
  heroConfirmButton.disabled = state.confirmed || !selected || pending;

  if (!selected) {
    heroSelectionName.textContent = "请选择英雄";
    heroDetailAvatar.dataset.hero = "";
    heroDetailAvatar.setAttribute("aria-label", "英雄形象尚未定稿");
    heroSkillList.replaceChildren();
    heroSkillDescription.textContent = "选择下方英雄后查看技能。";
  } else {
    const hero = heroCatalog[selected];
    heroSelectionName.textContent = hero.name;
    heroDetailAvatar.dataset.hero = selected;
    heroDetailAvatar.setAttribute("aria-label", `${hero.name}形象占位，正式画像尚未定稿`);
    activeSkillIndex = Math.min(activeSkillIndex, hero.skills.length - 1);
    heroSkillList.replaceChildren(...hero.skills.map((skill, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `hero-skill-button${index === activeSkillIndex ? " active" : ""}`;
      button.innerHTML = `<i aria-hidden="true">${skill.name.slice(0, 1)}</i><span>${skill.name}</span>`;
      button.setAttribute("aria-label", `${skill.name}：查看说明`);
      button.addEventListener("click", () => {
        activeSkillIndex = index;
        renderHeroSelection(overrideState);
      });
      let helpTimer: number | undefined;
      const cancelHelp = () => {
        if (helpTimer) window.clearTimeout(helpTimer);
        helpTimer = undefined;
      };
      button.addEventListener("pointerdown", () => {
        cancelHelp();
        helpTimer = window.setTimeout(() => {
          helpTimer = undefined;
          showDialog(`${hero.name} · ${skill.name}`, skill.fullDescription, "知道了", () => undefined);
        }, 650);
      });
      button.addEventListener("pointerup", cancelHelp);
      button.addEventListener("pointercancel", cancelHelp);
      button.addEventListener("pointerleave", cancelHelp);
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        cancelHelp();
        showDialog(`${hero.name} · ${skill.name}`, skill.fullDescription, "知道了", () => undefined);
      });
      return button;
    }));
    heroSkillDescription.textContent = hero.skills[activeSkillIndex].description;
    if (selected === "jiang_he" || selected === "death_knight") {
      const form = document.createElement("select"); form.setAttribute("aria-label", "英雄完整形态");
      form.add(new Option("表·完整技能包", "front")); form.add(new Option("里·完整技能包", "inner")); form.value = heroFormDraft; form.disabled = state.confirmed || pending;
      form.onchange = () => { heroFormDraft = form.value as HeroForm; }; heroSkillDescription.append(form);
    }
    if (selected === "devout_zealot") {
      const variant = document.createElement("select"); variant.setAttribute("aria-label", "迦拉克隆固定形态");
      for (const [value, label] of [["nightmare","梦魇"],["invincible","无敌"],["fel","邪火"],["storm","风暴"],["unspeakable","讳言"]]) variant.add(new Option(label,value));
      variant.value = galakrondDraft; variant.disabled = state.confirmed || pending;
      variant.onchange = () => { galakrondDraft = variant.value as GalakrondForm; }; heroSkillDescription.append(variant);
    }

  }

  heroGrid.replaceChildren(...HERO_IDS.map((heroId) => {
    const hero = heroCatalog[heroId];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hero-grid-item${selected === heroId ? " selected" : ""}`;
    button.disabled = state.confirmed || pending;
    button.innerHTML = `<span class="hero-art-placeholder grid-avatar" data-hero="${heroId}" aria-hidden="true"></span><span class="hero-grid-name${hero.name.length > 4 ? " long-name" : ""}">${hero.name}</span>`;
    button.setAttribute("aria-label", `选择${hero.name}`);
    button.addEventListener("click", () => {
      if (state.confirmed) return;
      heroDraft = heroId; heroFormDraft = "front"; galakrondDraft = "unspeakable";
      activeSkillIndex = 0;
      renderHeroSelection();
    });
    return button;
  }));
}

function confirmHeroSelection(): void {
  if (!heroDraft) return;
  if (bluetooth?.view?.phase === "hero_selection") {
    handleBluetoothAction({ kind: "hero", hero: heroDraft, form: heroFormDraft, ...(heroDraft === "devout_zealot" ? { variant: galakrondDraft } : {}) });
    renderHeroSelection();
    return;
  }
  const pkg = getHeroPackage(heroDraft, heroFormDraft, heroDraft === "devout_zealot" ? galakrondDraft : undefined);
  localHeroPackages[localHeroActor] = { heroId: pkg.heroId, form: pkg.form, packageId: pkg.packageId, ...(pkg.variant ? { variant: pkg.variant } : {}) };
  localHeroChoices[localHeroActor] = heroDraft;
  localHeroConfirmed[localHeroActor] = true;
  heroSelectionDeadlineAt = undefined;
  if (localHeroConfirmed[PLAYER_ONE] && localHeroConfirmed[PLAYER_TWO]) {
    beginLocalRps();
    return;
  }
  const completed = localHeroActor;
  localHeroActor = completed === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE;
  heroDraft = undefined;
  activeSkillIndex = 0;
  showDialog("英雄已确定", `请将设备交给${localHeroActor}继续选择英雄。上一位玩家的选择已从页面清除。`, `${localHeroActor}已接手`, () => {
    heroSelectionDeadlineAt = Date.now() + HERO_SELECTION_DURATION_MS;
    renderHeroSelection();
  });
  renderHeroSelection();
}

function handleLocalHeroSelectionTimeout(): void {
  if (heroSelectionDeadlineAt === undefined) return;
  heroSelectionDeadlineAt = undefined;
  const timedOutActor = localHeroActor;
  const selected = randomHero();
  localHeroChoices[timedOutActor] = selected;
  localHeroConfirmed[timedOutActor] = true;
  heroDraft = selected;
  renderHeroSelection();
  if (flowDialog.open) flowDialog.close();
  showToast(`选择超时，系统已为${timedOutActor}随机英雄。`);
  window.setTimeout(() => {
    if (localHeroConfirmed[PLAYER_ONE] && localHeroConfirmed[PLAYER_TWO]) {
      beginLocalRps();
      return;
    }
    localHeroActor = timedOutActor === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE;
    heroDraft = undefined;
    activeSkillIndex = 0;
    showDialog("请交给下一位玩家", `${timedOutActor}的英雄已锁定并从页面清除。`, `${localHeroActor}已接手`, () => {
      heroSelectionDeadlineAt = Date.now() + HERO_SELECTION_DURATION_MS;
      renderHeroSelection();
    });
    renderHeroSelection();
  }, 800);
}

function beginLocalRps(): void {
  if (flowDialog.open) flowDialog.close();
  heroSelectionDeadlineAt = undefined;
  heroView.hidden = true;
  rpsView.hidden = false;
  gameView.hidden = true;
  rpsActor = PLAYER_ONE;
  rpsDraft = undefined;
  rpsDraftRound = rpsPublic.round;
  localRpsDeadlineAt = Date.now() + RPS_SELECTION_DURATION_MS;
  renderRps();
}

function renderRps(): void {
  const tie = rpsPublic.lastResult?.tie;
  if (rpsDraftRound !== rpsPublic.round) {
    rpsDraftRound = rpsPublic.round;
    rpsDraft = undefined;
  }
  let confirmed = false;
  let opponentConfirmed = false;
  let deadlineAt = localRpsDeadlineAt;
  if (bluetooth?.view?.phase === "rps") {
    const submitted = bluetooth.view.rps?.submitted ?? {};
    const own = ownBluetoothPlayerId();
    const ownSubmitted = own ? Boolean(submitted[own]) : false;
    confirmed = ownSubmitted;
    opponentConfirmed = own
      ? Object.entries(submitted).some(([id, value]) => id !== own && value)
      : false;
    deadlineAt = bluetooth.view.rpsDeadlineAt;
    if (ownSubmitted) rpsDraft = undefined;
    rpsTitle.textContent = ownSubmitted ? "出拳已锁定" : "请秘密出拳";
    rpsHelp.textContent = ownSubmitted
      ? `第 ${rpsPublic.round} 轮：已发送，等待对方出拳。`
      : `第 ${rpsPublic.round} 轮：选择一项后按“确定”，胜者执红先走。`;
    rpsHistory.textContent = tie && rpsPublic.lastResult
      ? `上一轮平局：双方再次出拳。`
      : "";
  } else {
    rpsTitle.textContent = `${rpsActor}，请秘密出拳`;
    rpsHelp.textContent = rpsActor === PLAYER_ONE
      ? `第 ${rpsPublic.round} 轮：选择一项后按“确定”，再把设备交给${PLAYER_TWO}。`
      : `第 ${rpsPublic.round} 轮：${PLAYER_ONE} 已锁定。选择后确认，随后揭晓。`;
    rpsHistory.textContent = tie && rpsPublic.lastResult
      ? `上一轮平局：${PLAYER_ONE}${choiceLabel[rpsPublic.lastResult.choices[PLAYER_ONE]]}，${PLAYER_TWO}${choiceLabel[rpsPublic.lastResult.choices[PLAYER_TWO]]}。`
      : "";
  }

  const remaining = secondsRemaining(deadlineAt);
  rpsSelectionTimer.textContent = String(remaining);
  rpsSelectionTimer.classList.toggle("urgent", remaining <= 10);
  const pending = Boolean(bluetooth?.pendingAction);
  const locked = confirmed || pending;
  const choices = element<HTMLElement>("rps-view").querySelector<HTMLElement>(".rps-choices")!;
  choices.classList.toggle("has-selection", Boolean(rpsDraft) && !locked);
  choices.classList.toggle("is-locked", locked);
  document.querySelectorAll<HTMLButtonElement>(".rps-choice").forEach((button) => {
    const choice = button.dataset.choice as RpsChoice;
    const selected = !locked && rpsDraft === choice;
    button.disabled = locked;
    button.classList.toggle("selected", selected);
    button.classList.toggle("locked", locked);
    button.setAttribute("aria-pressed", String(selected));
  });
  rpsConfirmButton.disabled = confirmed || pending || !rpsDraft;
  rpsConfirmButton.textContent = confirmed ? "已锁定" : pending ? "发送中" : "确定";
  rpsLockStatus.textContent = pending
    ? "已隐藏手势，等待房主确认。"
    : confirmed
    ? opponentConfirmed ? "双方均已锁定，正在结算。" : "已锁定并隐藏手势，等待对方。"
    : rpsDraft ? `已选择${choiceLabel[rpsDraft]}，确认后不可更改。` : "先选择手势，再确认锁定。";
}

function selectRpsChoice(choice: RpsChoice): void {
  if (bluetooth?.view?.phase === "rps") {
    const own = ownBluetoothPlayerId();
    if ((own && bluetooth.view.rps?.submitted[own]) || bluetooth.pendingAction) return;
  }
  rpsDraft = choice;
  rpsDraftRound = rpsPublic.round;
  renderRps();
}

function confirmRpsChoice(): void {
  if (!rpsDraft) return;
  submitChoice(rpsDraft);
}

function submitChoice(choice: RpsChoice, timedOut = false): void {
  if (bluetooth?.view?.phase === "rps") {
    handleBluetoothAction({ kind: "rps", choice, round: bluetooth.view.rps!.round });
    renderRps();
    return;
  }
  localRpsDeadlineAt = undefined;
  rpsDraft = undefined;
  const beforeRound = rpsPublic.round;
  const result = submitRpsChoice(rpsPublic, rpsSecret, rpsActor, choice, beforeRound);
  rpsPublic = result.publicState;
  rpsSecret = result.secretState;

  if (rpsPublic.status === "resolved") {
    const resolved = rpsPublic.lastResult!;
    const winner = resolved.winner!;
    const summary = `${PLAYER_ONE}出${choiceLabel[resolved.choices[PLAYER_ONE]]}，${PLAYER_TWO}出${choiceLabel[resolved.choices[PLAYER_TWO]]}。${winner}获胜，执红先走。`;
    showDialog(timedOut ? "倒计时结束" : "先手已决定", `${timedOut ? "系统已随机出拳。\n" : ""}${summary}`, "开始对局", startGame);
    return;
  }

  if (rpsPublic.round > beforeRound) {
    const tie = rpsPublic.lastResult!;
    const summary = `${PLAYER_ONE}出${choiceLabel[tie.choices[PLAYER_ONE]]}，${PLAYER_TWO}出${choiceLabel[tie.choices[PLAYER_TWO]]}。平局，再来一轮。`;
    showDialog("平局", summary, "下一轮", () => {
      rpsActor = PLAYER_ONE;
      rpsDraftRound = rpsPublic.round;
      localRpsDeadlineAt = Date.now() + RPS_SELECTION_DURATION_MS;
      renderRps();
    });
    return;
  }

  showDialog(timedOut ? "倒计时结束" : "选择已锁定", `${timedOut ? "系统已随机出拳。\n" : ""}请将设备交给${PLAYER_TWO}，不要让${PLAYER_ONE}看到对方的选择。`, `${PLAYER_TWO}已接手`, () => {
    rpsActor = PLAYER_TWO;
    rpsDraft = undefined;
    localRpsDeadlineAt = Date.now() + RPS_SELECTION_DURATION_MS;
    renderRps();
  });
}

function handleLocalRpsTimeout(): void {
  if (localRpsDeadlineAt === undefined) return;
  localRpsDeadlineAt = undefined;
  submitChoice(randomRpsChoice(), true);
}

function startGame(): void {
  const session = createInitialGame();
  let assignments = rpsPublic.assignments!;
  const swaps = [assignments.red, assignments.black].filter(id => localHeroChoices[id] === "shuffler").length;
  if (swaps % 2) { assignments = { red: assignments.black, black: assignments.red }; rpsPublic.assignments = assignments; }
  const redHero = localHeroChoices[assignments.red];
  const blackHero = localHeroChoices[assignments.black];
  if (!redHero || !blackHero) return showToast("双方英雄选择不完整，请重新开始。");
  if (redHero === "murozond_minion" && blackHero === "murozond_minion") {
    showDialog("需要正式规则定义", "双方窃时镜像的计时叠加尚未冻结，请重新选择英雄。", "重新选择", () => { resetMatch(); beginLocalHeroSelection(); });
    return;
  }
  const mutation = randomMutation({ red: redHero, black: blackHero });
  localHeroes = {
    red: redHero,
    black: blackHero,
  };
  gameState = initializeFeatureGameState(
    session.state,
    localHeroes,
    mutation,
    { red: localHeroPackages[assignments.red]?.form ?? "front", black: localHeroPackages[assignments.black]?.form ?? "front" },
    { red: localHeroPackages[assignments.red]?.variant, black: localHeroPackages[assignments.black]?.variant },
  );
  gameSecret = session.secret;
  localPrivateViewerSide = "red";
  selectedPieceId = undefined;
  assassinationArmed = false;
  strongStrikeArmed = false;
  localTraps = [];
  if (gameState && gameSecret) initializeFeatureSecret(gameState, gameSecret);
  trapSetupQueue = [];
  trapSetupSide = undefined;
  localTrapDraft = [];
  localPreparationActive = false;
  heroPreparationDeadlineAt = undefined;
  latestAnnouncement = `${rpsPublic.assignments!.red}执红，红方先行。`;
  appendLocalSystemMessage("对局开始，红方先行。");
  heroView.hidden = true;
  rpsView.hidden = true;
  gameView.hidden = false;
  // Set the opening lock before rendering so the formal clock is not started
  // during the introduction or the hunter preparation phase.
  runOpeningSequence(beginLocalHeroPreparation);
  renderGame();
}

function battleHeroName(side: Side): string {
  const selection = gameState?.featureRules?.heroSelections?.[side];
  if (!selection) return heroCatalog[battleHeroes()?.[side] ?? "hunter"].name;
  const name = getHeroPackage(selection.heroId, selection.form, selection.variant).name;
  const variants = { nightmare: "梦魇", invincible: "无敌", fel: "邪能", storm: "风暴", unspeakable: "讳言" };
  return selection.variant ? `${name}·${variants[selection.variant]}迦拉克隆` : name;
}

function battleHeroes(): Record<Side, HeroId> | undefined {
  const remote = bluetooth?.view?.features?.heroes;
  if (remote) return remote;
  if (localHeroes.red && localHeroes.black) return { red: localHeroes.red, black: localHeroes.black };
  return undefined;
}

interface RuntimeSkillEntry {
  key: string;
  title: string;
  state: string;
  catalogIndex: number;
  active: boolean;
}

function runtimeSkillEntries(side: Side, hero: HeroId): RuntimeSkillEntry[] {
  const entries = baseRuntimeSkillEntries(side, hero);
  if (hero === "rogue" || gameState?.featureRules?.mutation !== "shadow_dance") return entries;
  const skills = gameState.assassination?.[side];
  const active = skills?.activePieceId;
  const strongAvailable = Boolean(active && gameState.effectsByPieceId?.[active]?.stealth?.strongStrikeAvailable);
  // Every hero receives the mutation. Reuse the existing three skill circles;
  // while stealthed, the mutation slot becomes its delayed strong-strike entry.
  return [...entries, {
    key: active ? "strong-strike" : "assassination-mutation",
    title: active ? "隐身·刺杀机会" : "畸变·刺杀",
    state: active ? `隐身中｜刺杀机会${strongAvailable ? "可用" : "已用"}` : skills?.mutationChargeAvailable ? "可用" : "已用",
    catalogIndex: 0,
    active: true,
  }];
}

function baseRuntimeSkillEntries(side: Side, hero: HeroId): RuntimeSkillEntry[] {
  if (hero === "hunter") {
    const ready = gameState?.status === "playing" || gameState?.status === "execution" || gameState?.status === "finished";
    return [{ key: "hunter-trap", title: "陷阱", state: ready ? "已秘密布置" : "准备中", catalogIndex: 0, active: false }];
  }
  if (hero === "warrior") {
    const warrior = gameState?.warrior?.[side];
    const barriers = warrior?.barrierPieceIds.length ?? 0;
    return [{
      key: "warrior-armor",
      title: "盔甲",
      state: `壁垒 ${barriers}｜铁甲${warrior?.ironArmorAvailable ? "可用" : "已用"}`,
      catalogIndex: 0,
      active: false,
    }];
  }
  if (hero !== "rogue") {
    const runtime = gameState?.heroRuntime?.[side];
    const passive = ["qin_long", "murozond_minion", "prince", "single_blade", "berserker", "shuffler"].includes(hero) || hero === "death_knight" && gameState?.featureRules?.heroSelections?.[side]?.form !== "inner";
    const abilities = hero === "death_knight" ? ["inner_ghost_burst"] : hero === "devout_zealot" ? ["invoke"] : hero === "deathwing" ? ["destruction"] : hero === "murozond" ? [gameState?.featureRules?.mutation === "end_time" ? "bomb" : "timeline_twist"] : hero === "nozdormu" ? [gameState?.featureRules?.mutation === "end_time" ? "hourglass" : "rewind"] : hero === "wind" ? ["shadow"] : hero === "warlock" ? ["burning_flame"] : hero === "night" ? ["insight"] : hero === "sky_admiral" ? ["landing"] : hero === "jiang_he" ? [gameState?.featureRules?.heroSelections?.[side]?.form === "inner" ? "inner_wave" : "river_enter", "river_move", "river_exit"] : [];
    if (passive) return [{ key: `passive:${hero}`, title: heroCatalog[hero].skills[0].name, state: "被动技能", catalogIndex: 0, active: false }];
    return abilities.map((ability, index) => ({ key: `ability:${ability}`, title: ability === "hourglass" ? "时光沙漏" : ability === "bomb" ? "时空扭曲炸弹" : heroCatalog[hero].skills[index]?.name ?? heroCatalog[hero].skills[0].name, state: hero === "wind" ? "秘密技能｜每局最多两次" : ability === "invoke" ? `祈求 ${runtime?.invokeCount ?? 0}/4` : ability === "hourglass" ? `剩余 ${gameState?.hourglasses ?? 0}` : runtime?.used ? "已用" : "主动技能", catalogIndex: index, active: true }));
  }
  const assassination = gameState?.assassination?.[side];
  const entries: RuntimeSkillEntry[] = [{
    key: "assassination-hero",
    title: "英雄·刺杀",
    state: assassination?.heroChargeAvailable ? "可用" : "已用",
    catalogIndex: 0,
    active: true,
  }];
  if ((bluetooth?.view?.features?.mutation ?? gameState?.featureRules?.mutation) === "shadow_dance") {
    entries.push({
      key: "assassination-mutation",
      title: "畸变·刺杀",
      state: assassination?.mutationChargeAvailable ? "可用" : "已用",
      catalogIndex: 0,
      active: true,
    });
  }
  const activePieceId = assassination?.activePieceId;
  const strikeAvailable = Boolean(activePieceId && gameState?.effectsByPieceId?.[activePieceId]?.stealth?.strongStrikeAvailable);
  entries.push({
    key: "strong-strike",
    title: "隐身·刺杀机会",
    state: activePieceId ? `隐身中｜刺杀机会${strikeAvailable ? "可用" : "已用"}` : "未进入隐身",
    catalogIndex: 2,
    active: true,
  });
  return entries;
}

function canActivateRuntimeSkill(side: Side, entry: RuntimeSkillEntry): boolean {
  if (!entry.active || !gameState || gameState.status !== "playing" || gameState.turn !== side || gameState.flowDance) return false;
  if (bluetooth?.view && bluetooth.view.viewerSide !== side) return false;
  if (openingActive || localPreparationActive || bluetooth?.view?.phase !== undefined && bluetooth.view.phase !== "playing") return false;
  if (isBluetoothTransportInterrupted() || isMatchOverlayOpen()) return false;
  if (entry.key.startsWith("ability:")) return true;
  const assassination = gameState.assassination?.[side];
  if (entry.key === "assassination-hero") return Boolean(assassination?.heroChargeAvailable || assassination?.activePieceId);
  if (entry.key === "assassination-mutation") return Boolean(assassination?.mutationChargeAvailable || assassination?.activePieceId);
  if (entry.key === "strong-strike") {
    const active = assassination?.activePieceId;
    return Boolean(active && gameState.effectsByPieceId?.[active]?.stealth?.strongStrikeAvailable);
  }
  return false;
}

function heroRuntimeSummary(side: Side, hero: HeroId): string[] {
  return runtimeSkillEntries(side, hero).map((entry) => `${entry.title}：${entry.state}`);
}

function showHeroDetails(side: Side): void {
  const hero = battleHeroes()?.[side];
  if (!hero || !disconnectLayer.hidden || !matchResultLayer.hidden) return;
  const info = heroCatalog[hero];
  const skills = info.skills.map((skill) => `<details><summary>${skill.name}</summary><p>${skill.fullDescription}</p></details>`).join("");
  const runtime = heroRuntimeSummary(side, hero).map((line) => `<li>${line}</li>`).join("");
  showMatchDetails(`${side === "red" ? "红方" : "蓝方"}·${info.name}`, `${skills}<h3>本局公开状态</h3><ul>${runtime}</ul>`);
}

function skillEntryForButton(button: HTMLButtonElement): { side: Side; hero: HeroId; entry: RuntimeSkillEntry } | undefined {
  const side: Side = button.closest(".v4-status-red") ? "red" : "black";
  const hero = battleHeroes()?.[side];
  const key = button.dataset.skillKey;
  if (!hero || !key) return undefined;
  const entry = runtimeSkillEntries(side, hero).find((candidate) => candidate.key === key);
  return entry ? { side, hero, entry } : undefined;
}

function showRuntimeSkillDetails(button: HTMLButtonElement): void {
  const resolved = skillEntryForButton(button);
  if (!resolved || !disconnectLayer.hidden || !matchResultLayer.hidden) return;
  const { side, hero, entry } = resolved;
  const catalogEntry = heroCatalog[hero].skills[entry.catalogIndex] ?? heroCatalog[hero].skills[0];
  const activeId = gameState?.assassination?.[side]?.activePieceId;
  const mutationSkill = entry.key === "assassination-mutation" || entry.key === "strong-strike" && Boolean(activeId && gameState?.effectsByPieceId?.[activeId]?.stealth?.source === "mutation");
  const description = mutationSkill ? mutationDefinition("shadow_dance").rules : catalogEntry.fullDescription;
  showMatchDetails(entry.title, `<p>${description}</p><h3>本局公开状态</h3><p>${entry.state}</p>`);
}

function activateRuntimeSkill(button: HTMLButtonElement): void {
  const resolved = skillEntryForButton(button);
  if (!resolved) return;
  if (!canActivateRuntimeSkill(resolved.side, resolved.entry)) return showRuntimeSkillDetails(button);
  if (resolved.entry.key.startsWith("ability:")) return openHeroAbility(resolved.entry.key.slice(8) as HeroAbilityCommand["ability"]);
  const source = element<HTMLSelectElement>("assassination-source");
  if (resolved.entry.key === "assassination-hero") source.value = "hero";
  if (resolved.entry.key === "assassination-mutation") source.value = "mutation";
  if (resolved.entry.key === "strong-strike") element<HTMLButtonElement>("strong-strike-button").click();
  else element<HTMLButtonElement>("assassination-button").click();
}

function renderRuntimeStatusPanels(heroes: Record<Side, HeroId> | undefined): void {
  if (!heroes) return;
  for (const side of ["black", "red"] as const) {
    const panel = document.querySelector<HTMLElement>(side === "red" ? ".v4-status-red" : ".v4-status-blue")!;
    const entries = runtimeSkillEntries(side, heroes[side]);
    panel.querySelectorAll<HTMLButtonElement>(".v4-skill-trigger").forEach((button, index) => {
      const entry = entries[index];
      button.hidden = !entry;
      if (!entry) return;
      button.dataset.skillKey = entry.key;
      button.innerHTML = `<span>${entry.title}</span><small>${entry.state}</small>`;
      button.setAttribute("aria-label", `${side === "red" ? "红方" : "蓝方"}${entry.title}，${entry.state}`);
      button.disabled = gameState?.status !== "playing" || !disconnectLayer.hidden || !matchResultLayer.hidden;
    });
  }
}

function setBattleHeroAvatars(heroes: Record<Side, HeroId>, visible: boolean): void {
  for (const side of ["red", "black"] as const) {
    const avatar = element<HTMLElement>(`${side}-hero-avatar`);
    avatar.hidden = !visible;
    avatar.dataset.hero = heroes[side];
    avatar.title = battleHeroName(side);
  }
}

function runOpeningSequence(onComplete: () => void): void {
  const heroes = battleHeroes();
  const mutation = bluetooth?.view?.features?.mutation ?? gameState?.featureRules?.mutation;
  if (!heroes) return onComplete();
  openingActive = true;
  openingCompletion = onComplete;
  setBattleHeroAvatars(heroes, false);
  openingSequence.hidden = false;
  heroIntroStage.hidden = true;
  heroIntroStage.classList.remove("playing");
  mutationReveal.hidden = false;
  const mutationInfo = mutation ? mutationDefinition(mutation) : undefined;
  mutationReveal.dataset.rarity = mutationInfo?.rarity ?? "none";
  if (mutationInfo) {
    const name = document.createElement("strong");
    name.textContent = mutationInfo.name;
    const rarity = document.createElement("span");
    rarity.textContent = MUTATION_RARITY_LABELS[mutationInfo.rarity];
    mutationReveal.replaceChildren(name, rarity);
  } else {
    mutationReveal.textContent = "无畸变";
  }
  mutationReveal.style.animation = "none";
  void mutationReveal.offsetWidth;
  mutationReveal.style.animation = "";
  scheduleOpeningStage("mutation", 1_200);
}

function beginLocalHeroPreparation(): void {
  trapSetupQueue = (["red", "black"] as const).filter((side) => ["hunter", "single_blade", "sky_admiral"].includes(localHeroes[side]));
  trapSetupSide = trapSetupQueue.shift();
  localTrapDraft = [];
  if (!trapSetupSide) {
    finishLocalHeroPreparation();
    return;
  }
  localPreparationActive = true;
  heroPreparationDeadlineAt = Date.now() + HERO_PREPARATION_DURATION_MS;
  renderGame();
  showDialog(
    `${trapSetupSide === "red" ? "红方" : "蓝方"}英雄准备`,
    localHeroes[trapSetupSide] === "hunter" ? "猎人需在己方半场布置两层陷阱。" : "请在英雄准备面板选择公开刃侧或征兵兵种。",
    "开始准备",
    renderGame,
  );
}

function finishLocalHeroPreparation(): void {
  localPreparationActive = false;
  heroPreparationDeadlineAt = undefined;
  trapSetupSide = undefined;
  trapSetupQueue = [];
  localTrapDraft = [];
  latestAnnouncement = `${rpsPublic.assignments!.red}执红，红方先行。`;
  renderGame();
}

function commitLocalTrapDraft(side: Side): void {
  const firstLayerIndex = localTraps.length;
  localTrapDraft.forEach((position, index) => localTraps.push({
    id: `local-trap:${side}:${firstLayerIndex + index}`,
    owner: side,
    position: { ...position },
    opponentTurnsRemaining: 12,
  }));
}

function completeLocalHeroPreparation(): void {
  if (!localPreparationActive || !trapSetupSide) return;
  const hero = localHeroes[trapSetupSide];
  if (hero === "hunter" && localTrapDraft.length !== 2) return showToast("请先布置完两层陷阱。");
  if (hero === "single_blade" && !gameState?.heroRuntime?.[trapSetupSide]?.blade || hero === "sky_admiral" && !gameState?.heroRuntime?.[trapSetupSide]?.trainingType) return showToast("请先确定英雄准备选项。");
  const completedSide = trapSetupSide;
  if (localHeroes[completedSide] === "hunter") commitLocalTrapDraft(completedSide);
  trapSetupSide = trapSetupQueue.shift();
  localTrapDraft = [];
  if (!trapSetupSide) {
    finishLocalHeroPreparation();
    return;
  }
  renderGame();
  showDialog(
    `${completedSide === "red" ? "红方" : "蓝方"}准备完成`,
    `请将设备交给${trapSetupSide === "red" ? "红方" : "蓝方"}继续英雄准备。`,
    "继续准备",
    renderGame,
  );
}

function handleLocalPreparationTimeout(): void {
  if (!localPreparationActive || !trapSetupSide || localHeroes[trapSetupSide] !== "hunter") return;
  while (localTrapDraft.length < 2) localTrapDraft.push(randomOwnHalfPosition(trapSetupSide));
  completeLocalHeroPreparation();
  showToast("准备时间结束，系统已补齐猎人陷阱；其他英雄仍需确认准备选项。");
}

function undoTrapDraft(): void {
  if (bluetooth?.view?.phase === "hero_preparation") {
    const side = bluetooth.view.viewerSide;
    const ready = side ? bluetooth.view.features?.heroPreparation?.ready[side] : true;
    if (!side || ready || bluetooth.trapDraft.length === 0) return;
    bluetooth.trapDraft.pop();
    handleBluetoothAction({
      kind: "trap_draft",
      positions: bluetooth.trapDraft.map((position) => ({ ...position })),
    });
    renderGame();
    return;
  }
  if (!localPreparationActive || localTrapDraft.length === 0) return;
  localTrapDraft.pop();
  renderGame();
}

function confirmHeroPreparation(): void {
  if (bluetooth?.view?.phase === "hero_preparation") {
    handleBluetoothAction({ kind: "preparation_ready" });
    return;
  }
  completeLocalHeroPreparation();
}

function disconnectPlayerLabel(playerId: string): string {
  const own = ownBluetoothPlayerId();
  if (playerId === own) return "你";
  const side = bluetooth?.view?.rps?.assignments
    ? bluetooth.view.rps.assignments.red === playerId ? "红方" : bluetooth.view.rps.assignments.black === playerId ? "蓝方" : undefined
    : undefined;
  return side ? `对方（${side}）` : "对方";
}

function renderDisconnectLayer(): void {
  if (!bluetooth?.everConnected || bluetooth.nativeState === "CONNECTED") {
    disconnectLayer.hidden = true;
    return;
  }
  setBattleActionMenu(false);
  setBattleSkillPanel(false);
  closeMatchDetail();
  disconnectLayer.hidden = false;
  const now = Date.now();
  const authoritative = bluetooth.view?.disconnects?.players ?? {};
  const active = Object.entries(authoritative).filter(([, state]) => state.disconnectedAt !== undefined);
  const fallbackId = bluetooth.localDisconnectPlayerId;
  const rows = active.length > 0
    ? active.map(([playerId, state]) => {
        const total = state.accumulatedMs + Math.max(0, now - (state.disconnectedAt ?? now));
        return { playerId, total };
      })
    : fallbackId
      ? [{ playerId: fallbackId, total: Math.max(0, now - (bluetooth.localDisconnectStartedAt ?? now)) }]
      : [];
  disconnectTitle.textContent = bluetooth.adapterEnabled === false ? "请开启蓝牙" : "连接中断，正在重连";
  disconnectCopy.textContent = rows.length > 0
    ? rows.map(({ playerId, total }) => {
        const elapsed = Math.min(DISCONNECT_TIMEOUT_MS, total);
        const remaining = Math.max(0, DISCONNECT_TIMEOUT_MS - elapsed);
        return `${disconnectPlayerLabel(playerId)}已累计断线 ${Math.floor(elapsed / 1_000)} 秒，剩余 ${Math.ceil(remaining / 1_000)} 秒。`;
      }).join(" ")
    : "对局已暂停，正在自动尝试恢复连接。";
  const maxElapsed = rows.reduce((value, row) => Math.max(value, row.total), 0);
  disconnectTimer.textContent = String(Math.max(0, Math.ceil((DISCONNECT_TIMEOUT_MS - maxElapsed) / 1_000)));
  disconnectBluetoothButton.hidden = bluetooth.adapterEnabled !== false;
}

function updateBluetoothDisconnectState(): boolean {
  if (!isBluetoothTransportInterrupted()) {
    disconnectLayer.hidden = true;
    return false;
  }
  if (bluetooth?.role === "host" && bluetooth.hostRoom) {
    refreshBluetoothHostViews(false);
  }
  const own = ownBluetoothPlayerId();
  const outcome = bluetooth?.view?.disconnectOutcome;
  const localWon = Boolean(
    outcome
    && own
    && outcome.winnerPlayerId === own
    && !outcome.timedOutPlayerIds.includes(own),
  );
  if (localWon) {
    disconnectLayer.hidden = true;
    return false;
  }
  renderDisconnectLayer();
  return true;
}

function updateVisibleTimers(): void {
  if (updateBluetoothDisconnectState()) return;
  if (!bluetoothLobbyView.hidden && bluetooth?.view?.rematch?.status === "pending") {
    const remaining = secondsRemaining(bluetooth.view.rematch.deadlineAt);
    bluetoothRematchTimer.textContent = String(remaining);
    if (remaining === 0) {
      if (bluetooth.role === "host" && bluetooth.hostRoom) publishBluetoothViews();
      else {
        bluetoothRematchTimer.hidden = true;
        bluetoothSessionTitle.textContent = "对方未响应再战请求";
        bluetoothSessionDetail.textContent = "仍保持蓝牙连接，可以稍后再次发起邀请。";
        bluetoothRematchAcceptButton.hidden = true;
        bluetoothRematchDeclineButton.hidden = true;
        bluetoothRematchRequestButton.hidden = false;
      }
    }
  }
  if (!heroView.hidden) {
    const state = heroSelectionState();
    const remaining = secondsRemaining(state.deadlineAt);
    heroSelectionTimer.textContent = String(remaining);
    heroSelectionTimer.classList.toggle("urgent", remaining <= 10);
    if (remaining === 0) {
      if (bluetooth?.role === "host" && bluetooth.view?.phase === "hero_selection") {
        publishBluetoothViews();
      } else if (!bluetooth && heroSelectionDeadlineAt !== undefined) {
        handleLocalHeroSelectionTimeout();
      }
    }
  }

  if (!rpsView.hidden) {
    const deadlineAt = bluetooth?.view?.phase === "rps"
      ? bluetooth.view.rpsDeadlineAt
      : localRpsDeadlineAt;
    const remaining = secondsRemaining(deadlineAt);
    rpsSelectionTimer.textContent = String(remaining);
    rpsSelectionTimer.classList.toggle("urgent", remaining <= 10);
    if (remaining === 0 && deadlineAt !== undefined) {
      if (bluetooth?.role === "host" && bluetooth.view?.phase === "rps") {
        publishBluetoothViews();
      } else if (!bluetooth) {
        handleLocalRpsTimeout();
      }
    }
  }

  const remotePreparation = bluetooth?.view?.phase === "hero_preparation";
  if (!gameView.hidden && (remotePreparation || localPreparationActive)) {
    const deadlineAt = remotePreparation
      ? bluetooth?.view?.features?.heroPreparation?.deadlineAt
      : heroPreparationDeadlineAt;
    const remaining = secondsRemaining(deadlineAt);
    heroPreparationTimer.textContent = String(remaining);
    heroPreparationTimer.classList.toggle("urgent", remaining <= 10);
    if (remaining === 0) {
      if (bluetooth?.role === "host" && remotePreparation) {
        publishBluetoothViews();
      } else if (!bluetooth && localPreparationActive) {
        handleLocalPreparationTimeout();
      }
    }
  }

  updateBattleTurnTimer();
}

function updateBattleTurnTimer(): void {
  if (gameView.hidden || !gameState) return;
  if (isBluetoothTransportInterrupted()) return;
  const waitingForOpening = openingActive
    || localPreparationActive
    || bluetooth?.view?.phase === "hero_intro"
    || bluetooth?.view?.phase === "hero_preparation";
  if (localPreparationActive || bluetooth?.view?.phase === "hero_preparation") {
    const deadlineAt = bluetooth?.view?.phase === "hero_preparation"
      ? bluetooth.view.features?.heroPreparation?.deadlineAt
      : heroPreparationDeadlineAt;
    const remaining = secondsRemaining(deadlineAt);
    battleTurnDeadlineAt = undefined;
    battleTurnRevision = undefined;
    battleTurnTimer.textContent = String(remaining);
    battleTurnTimer.classList.toggle("urgent", remaining <= 10);
    return;
  }
  if (gameState.status !== "playing" || waitingForOpening) {
    battleTurnDeadlineAt = undefined;
    battleTurnRevision = undefined;
    battleTurnTimer.textContent = gameState.status === "finished" ? "0" : "60";
    battleTurnTimer.classList.remove("urgent");
    return;
  }
  if (battleTurnRevision !== gameState.revision || battleTurnDeadlineAt === undefined) {
    battleTurnRevision = gameState.revision;
    if (!bluetooth && gameState.turnStartedAt === undefined) startFormalClock(gameState, Date.now(), gameSecret);
    battleTurnDeadlineAt = gameState.turnDeadlineAt ?? Date.now() + formalTurnDurationMs(gameState, gameState.turn);
  }
  const remaining = secondsRemaining(battleTurnDeadlineAt);
  battleTurnTimer.textContent = String(remaining);
  battleTurnTimer.classList.toggle("urgent", remaining <= 10);
  // 当前规则只确认了 60 秒视觉倒计时；归零后的自动判负/换手仍待产品确认。
}

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

function descriptionForPiece(pieceId: string): string {
  if (!gameState) return "";
  const piece = gameState.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) return "";
  if (piece.faceDown) return `暗子首步按${movementLabel[getPieceTypeForMovement(piece)]}位走，落子后翻开。`;
  return `${piece.color === "red" ? "红" : "黑"}${pieceLabel[piece.color][piece.type]}，明子按本身走法行动。`;
}

function noLegalMoveMessage(pieceId: string): string {
  if (!gameState) return "这枚棋子当前没有合法落点。";
  const piece = gameState.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) return "这枚棋子当前没有合法落点。";
  const pseudoMoves = getPseudoMoves(gameState, pieceId);
  const everyMoveExposesGeneral = pseudoMoves.length > 0 && pseudoMoves.every(
    (to) => validatePublicMove(gameState!, { from: piece, to }, gameState!.turn).code === "SELF_CHECK",
  );
  if (everyMoveExposesGeneral) {
    return "这枚棋子正在挡住将帅照面；移开会让己方将帅受将。请先用其他棋子补住中路。";
  }
  return "这枚棋子当前没有合法落点。";
}

function renderBoard(): void {
  if (!gameState) return;
  const remotePreparation = bluetooth?.view?.phase === "hero_preparation";
  const remoteSide = bluetooth?.view?.viewerSide;
  const remoteCanPrepare = Boolean(
    remotePreparation
    && remoteSide
    && bluetooth?.view?.features?.heroes?.[remoteSide] === "hunter"
    && !bluetooth.view.features?.heroPreparation?.ready[remoteSide],
  );
  const activeTrapSetupSide = remoteCanPrepare ? remoteSide : localPreparationActive ? trapSetupSide : undefined;
  battleBoard.classList.toggle("trap-preparing", Boolean(activeTrapSetupSide));
  battleBoard.classList.toggle("trap-preparing-red", activeTrapSetupSide === "red");
  battleBoard.classList.toggle("trap-preparing-black", activeTrapSetupSide === "black");
  const activeStealth = selectedPieceId && gameState.assassination?.[gameState.turn]?.activePieceId === selectedPieceId;
  const usingAssassination = Boolean(selectedPieceId && (assassinationArmed || activeStealth));
  const legalMoves = selectedPieceId
    ? usingAssassination
      ? getLegalAssassinationMoves(gameState, selectedPieceId, strongStrikeArmed)
      : (gameState.flowDance ? getFlowDanceMoves(gameState, selectedPieceId) : getLegalMoves(gameState, selectedPieceId))
    : [];
  const legalKeys = new Set(legalMoves.map(positionKey));
  const pieces = new Map(gameState.pieces.filter(isBoardPiece).map((piece) => [positionKey(piece), piece]));
  const lastMove = gameState.lastMove;
  const executionPlan = gameState.status === "execution"
    ? getAutomaticExecutionPlan(gameState)
    : undefined;
  const visibleTrapPositions = bluetooth?.view
    ? bluetooth.view.phase === "hero_preparation"
      ? (bluetooth.view.ownTrapDraft ?? bluetooth.trapDraft)
      : (bluetooth.view.ownTraps ?? []).map((trap) => trap.position)
    : localPreparationActive ? localTrapDraft : localTraps.filter(t => t.owner === localPrivateViewerSide).map(t => t.position);
  const ownTrapCounts = new Map<string, number>();
  for (const position of visibleTrapPositions) {
    const key = positionKey(position);
    ownTrapCounts.set(key, (ownTrapCounts.get(key) ?? 0) + 1);
  }
  const fragment = document.createDocumentFragment();

  for (let y = 0; y <= 9; y += 1) {
    for (let x = 0; x <= 8; x += 1) {
      const position = { x, y };
      const key = positionKey(position);
      const piece = gameState.pieces.find(p => p.layer === undefined && positionKey(p) === key) ?? pieces.get(key);
      const point = document.createElement("button");
      point.type = "button";
      point.className = "point";
      point.style.left = `${(BOARD_X_CENTERS[x] / 810) * 100}%`;
      point.style.top = `${(BOARD_Y_CENTERS[y] / 812) * 100}%`;
      point.dataset.x = String(x);
      point.dataset.y = String(y);
      point.setAttribute("aria-label", piece
        ? piece.faceDown ? `暗子，坐标 ${x + 1}, ${y + 1}` : `${piece.color === "red" ? "红" : "黑"}${pieceLabel[piece.color][piece.type]}，坐标 ${x + 1}, ${y + 1}`
        : `空位，坐标 ${x + 1}, ${y + 1}`);
      if (activeTrapSetupSide && isOwnHalf(activeTrapSetupSide, position)) {
        point.classList.add("trap-eligible");
        point.setAttribute("aria-label", `${point.getAttribute("aria-label")}，可布置陷阱`);
      }
      if (piece?.id === selectedPieceId) point.classList.add("selected");
      if (legalKeys.has(key)) point.classList.add(piece ? "legal-capture" : "legal-empty");
      if (lastMove && positionKey(lastMove.from) === key) point.classList.add("last-from");
      if (lastMove && positionKey(lastMove.to) === key) point.classList.add("last-to");
      if (executionPlan && positionKey(executionPlan.from) === key) point.classList.add("execution-source");
      if (executionPlan && positionKey(executionPlan.to) === key) point.classList.add("execution-target");
      const trapLayers = ownTrapCounts.get(key) ?? 0;
      if (trapLayers > 0) point.classList.add("own-trap", `trap-layers-${Math.min(trapLayers, 2)}`);

      if (piece) {
        const token = document.createElement("span");
        token.className = `piece ${piece.faceDown ? "covered" : piece.color}`;
        token.style.setProperty("--ring-url", `url("${ringAsset(stableRingIndex(piece.id))}")`);
        token.setAttribute("aria-hidden", "true");
        if (!piece.faceDown) token.append(createPieceGlyph(piece.color, piece.type));
        point.append(token);
        const effects = gameState.effectsByPieceId?.[piece.id];
        const airAt = gameState.pieces.filter(p => p.layer === "air" && positionKey(p) === key);
        const badge = airAt.length ? `空${airAt.length}` : effects?.stealth ? "隐" : effects?.barrier ? "盾" : effects?.cavalry ? "骑" : undefined;
        if (badge) {
          const marker = document.createElement("small");
          marker.className = "effect-marker";
          marker.textContent = badge;
          point.append(marker);
        }
      }
      if (trapLayers > 0) {
        const trapCount = document.createElement("small");
        trapCount.className = "trap-layer-count";
        trapCount.textContent = String(trapLayers);
        trapCount.setAttribute("aria-label", `己方陷阱 ${trapLayers} 层`);
        point.append(trapCount);
      }
      fragment.append(point);
    }
  }
  boardPoints.replaceChildren(fragment);
}

function capturesBySide(side: Side): GameState["captured"] {
  if (!gameState) return [];
  return gameState.captured.filter((piece) => piece.color === side && !piece.secretColorWithheld);
}

function capturedToken(piece: GameState["captured"][number]): HTMLElement {
    const token = document.createElement("span");
    token.className = `captured-token ${piece.color}`;
    token.style.setProperty("--ring-url", `url("${ringAsset(stableRingIndex(piece.id))}")`);
    if (piece.secretColorWithheld) { token.className = "captured-token unknown"; token.textContent = movementLabel[piece.type]; }
    else token.append(createPieceGlyph(piece.color, piece.type));
    token.title = piece.secretColorWithheld ? "兵种已揭示，秘密阵营未公开" : `${piece.color === "red" ? "红方" : "蓝方"}${pieceLabel[piece.color][piece.type]}`;
    return token;
}

function renderCaptureCounts(): void {
  const redCount = capturesBySide("red").length;
  const blackCount = capturesBySide("black").length;
  redCapturedCount.textContent = String(redCount);
  blackCapturedCount.textContent = String(blackCount);
  redCapturedButton.setAttribute("aria-label", `查看红方已消灭棋子，共 ${redCount} 枚`);
  blackCapturedButton.setAttribute("aria-label", `查看蓝方已消灭棋子，共 ${blackCount} 枚`);
  for (const [side, count, button] of [["red", redCount, redCapturedButton], ["black", blackCount, blackCapturedButton]] as const) {
    if (count > renderedCaptureCounts[side]) {
      button.classList.remove("capture-updated");
      requestAnimationFrame(() => button.classList.add("capture-updated"));
      window.setTimeout(() => button.classList.remove("capture-updated"), 420);
    }
    renderedCaptureCounts[side] = count;
  }
}

function captureDetailGroup(side: Side): HTMLElement {
  const records = capturesBySide(side);
  const section = document.createElement("section");
  section.className = "captured-detail-group";
  const heading = document.createElement("h3");
  heading.innerHTML = `<span>${side === "red" ? "红方" : "蓝方"}</span><small>已消灭 ${records.length}</small>`;
  section.append(heading);
  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "captured-detail-empty";
    empty.textContent = "尚未吃子";
    section.append(empty);
    return section;
  }
  const grid = document.createElement("div");
  grid.className = "captured-detail-grid";
  for (const piece of records) {
    const item = document.createElement("div");
    item.className = "captured-detail-piece";
    item.append(capturedToken(piece));
    const identity = document.createElement("small");
    identity.textContent = `${piece.color === "red" ? "红方" : "蓝方"}·${pieceLabel[piece.color][piece.type]}`;
    item.append(identity);
    grid.append(item);
  }
  section.append(grid);
  return section;
}

function showCapturedDetails(): void {
  if (!gameState || !disconnectLayer.hidden || !matchResultLayer.hidden) return;
  showMatchDetails("已消灭棋子", "");
  const groups = document.createElement("div");
  groups.className = "captured-detail-groups";
  groups.append(captureDetailGroup("black"), captureDetailGroup("red"));
  const withheld = gameState.captured.filter(p => p.secretColorWithheld);
  if (withheld.length) {
    const group = document.createElement("section"), title = document.createElement("h3");
    title.textContent = "秘密阵营未公开"; group.append(title);
    for (const record of withheld) group.append(capturedToken(record));
    groups.append(group);
  }
  matchDetailBody.replaceChildren(groups);
}

function finishMessage(): string {
  if (gameState?.drawReason === "mutual_destruction") return "双方将帅同归于尽，两败俱伤！";
  if (gameState?.drawReason === "disconnect_timeout") return "双方累计断线均达到 60 秒，本局平局。";
  if (!gameState?.winner) return "对局结束。";
  const reason = gameState.reason;
  const lostRemoteGame = Boolean(bluetooth?.view?.viewerSide && bluetooth.view.viewerSide !== gameState.winner);
  if (lostRemoteGame) {
    if (reason === "ambush") return "对方暗中潜行，破影而袭！您战败。";
    if (reason === "checkmate") return "圣光的正义终结了您！";
    if (reason === "stalemate") return "您已无处可逃。";
    if (reason === "resign") return "您已臣服，对方获得胜利。";
    if (reason === "trap_ambush") return "您已踏入对方陷阱！伏击得手。";
    if (reason === "crush_them") return "对方碾碎了您的将帅！";
    if (reason === "rampage") return "对方误伤己方将帅，乱杀失败；您获得胜利！";
    if (reason === "disconnect") return "您因累计断线达到 60 秒，本局失败。";
    return "您已战败。";
  }
  if (reason === "ambush") return "暗中潜行，破影而袭！您获得胜利！";
  if (reason === "checkmate") return "圣光的正义终结了敌人！您获得胜利！";
  if (reason === "stalemate") return "对方已无路可走。您获得胜利！";
  if (reason === "resign") return "对方已臣服于您，获得胜利！";
  if (reason === "trap_ambush") return "猎物已踏入陷阱！伏击得手，您获得胜利！";
  if (reason === "crush_them") return "碾碎他们！您获得胜利！";
  if (reason === "rampage") return "误伤己方将帅，乱杀失败！";
  if (reason === "disconnect") return "对方被流放至扭曲虚空。您获得胜利！";
  return "您获得胜利！";
}

function finishTitle(): string {
  if (!gameState?.reason) return "对局结束";
  return { ambush: "背刺", checkmate: "裁决", stalemate: "无处可逃", resign: "臣服", trap_ambush: "伏击", crush_them: "碾碎他们！", rampage: "乱杀失败", disconnect: "流放", infection: "感染", suffocation: "窒息", time_collapse: "时间坍缩", general_destroyed: "主帅消灭", rain_night: "雨夜", timeout: "回合超时" }[gameState.reason];
}

function resultOutcome(): "win" | "loss" | "draw" {
  if (!gameState?.winner) return "draw";
  const viewer = bluetooth?.view?.viewerSide;
  if (viewer && viewer !== gameState.winner) return "loss";
  return "win";
}

function resultPlayerName(side: Side): string {
  const assigned = rpsPublic.assignments?.[side];
  if (!assigned) return side === "red" ? "红方玩家" : "蓝方玩家";
  const own = ownBluetoothPlayerId();
  if (assigned === own) return "你";
  if (bluetooth?.view) return "对方";
  return assigned;
}

function showMatchResult(): void {
  if (!gameState || gameState.status !== "finished") return;
  setBattleActionMenu(false);
  setBattleSkillPanel(false);
  closeMatchDetail();
  const outcome = resultOutcome();
  matchResultLayer.dataset.outcome = outcome;
  if (outcome === "draw") {
    matchResultHeading.textContent = "平局";
  } else if (bluetooth?.view) {
    matchResultHeading.textContent = outcome === "win" ? "胜利" : "失败";
  } else {
    matchResultHeading.textContent = gameState.winner === "red" ? "红方胜利" : "蓝方胜利";
  }
  matchResultType.textContent = gameState.drawReason === "mutual_destruction"
    ? "两败俱伤"
    : gameState.drawReason === "disconnect_timeout"
      ? "断线平局"
      : finishTitle();
  matchResultMessage.textContent = finishMessage();
  matchResultWinner.hidden = !gameState.winner;
  if (gameState.winner) {
    const winner = gameState.winner;
    const hero = battleHeroes()?.[winner];
    matchResultSide.textContent = winner === "red" ? "红方" : "蓝方";
    matchResultPlayer.textContent = resultPlayerName(winner);
    matchResultHero.textContent = hero ? heroCatalog[hero].name : "未启用英雄";
    matchResultAvatar.dataset.hero = hero ?? "none";
    matchResultAvatar.querySelector("span")!.textContent = hero ? heroCatalog[hero].name : "胜方";
  }
  matchResultLayer.hidden = false;
}

function returnFromMatchResult(): void {
  closeMatchResult();
  if (bluetooth) {
    nativeBluetooth()?.disconnect();
    bluetooth = undefined;
  }
  showMainMenu();
}

function startRematchFromResult(): void {
  if (bluetooth?.view) {
    requestBluetoothRematch();
    return;
  }
  closeMatchResult();
  resetMatch();
  beginLocalHeroSelection();
}

function renderGame(): void {
  if (!gameState || !rpsPublic.assignments) return;
  if (gameState.status === "finished" || gameState.status === "execution") {
    setBattleActionMenu(false);
    setBattleSkillPanel(false);
    closeMatchDetail();
  } else if (!matchMenuLayer.hidden) {
    setBattleActionMenu(true);
  }
  const remoteView = bluetooth?.view;
  const remotePreparation = remoteView?.phase === "hero_preparation";
  const remoteSide = remoteView?.viewerSide;
  const remoteIsHunter = Boolean(remoteSide && remoteView?.features?.heroes?.[remoteSide] === "hunter");
  const remoteReady = Boolean(remoteSide && remoteView?.features?.heroPreparation?.ready[remoteSide]);
  const preparationActive = Boolean(remotePreparation || localPreparationActive);
  const preparationDraft = remotePreparation ? bluetooth?.trapDraft ?? [] : localTrapDraft;
  const preparationDeadline = remotePreparation
    ? remoteView?.features?.heroPreparation?.deadlineAt
    : heroPreparationDeadlineAt;
  redPlayer.textContent = rpsPublic.assignments.red;
  blackPlayer.textContent = rpsPublic.assignments.black;
  const heroes = battleHeroes();
  statusBlueHeroName.textContent = heroes?.black ? battleHeroName("black") : "英雄";
  statusRedHeroName.textContent = heroes?.red ? battleHeroName("red") : "英雄";
  if (heroes) {
    element<HTMLElement>("black-hero-avatar").dataset.hero = heroes.black;
    element<HTMLElement>("red-hero-avatar").dataset.hero = heroes.red;
  }
  renderRuntimeStatusPanels(heroes);
  renderCaptureCounts();
  const mutation = remoteView?.features?.mutation ?? gameState.featureRules?.mutation;
  battleMutationName.textContent = mutation ? mutationName(mutation) : "无畸变";
  battleMutationName.parentElement?.setAttribute("aria-label", mutation ? `查看本局畸变：${mutationName(mutation)}` : "查看本局畸变");
  renderMessagePanel();
  heroPreparationPanel.hidden = !preparationActive;
  battleCanvas.classList.toggle("is-hero-preparation", preparationActive);
  if (preparationActive) {
    const remaining = secondsRemaining(preparationDeadline);
    heroPreparationTimer.textContent = String(remaining);
    heroPreparationTimer.classList.toggle("urgent", remaining <= 10);
    const canPrepare = remotePreparation ? Boolean(remoteSide && !remoteReady) : Boolean(trapSetupSide);
    const preparingHero = remotePreparation ? (remoteSide ? remoteView?.features?.heroes?.[remoteSide] : undefined) : trapSetupSide ? localHeroes[trapSetupSide] : undefined;
    const sideLabel = remotePreparation
      ? remoteSide === "red" ? "红方" : "蓝方"
      : trapSetupSide === "red" ? "红方" : "蓝方";
    const activeSide = canPrepare ? (remotePreparation ? remoteSide : trapSetupSide) : undefined;
    battleCanvas.classList.toggle("preparing-red", activeSide === "red");
    battleCanvas.classList.toggle("preparing-black", activeSide === "black");
    battleTurnTimer.setAttribute("aria-label", "英雄准备剩余秒数");
    heroPreparationTitle.textContent = canPrepare ? "猎人·布置陷阱" : "等待英雄准备";
    turnStatus.innerHTML = `<b>英雄准备中</b><span>${canPrepare ? `${sideLabel}陷阱 ${preparationDraft.length} / 2` : "等待对方"}</span>`;
    announcement.textContent = canPrepare ? "在己方半场布置两层陷阱；可同格叠加，也可放在棋子脚下。" : "你的英雄无需操作或已经完成，正在等待对方准备。";
    moveHint.textContent = canPrepare
      ? preparationDraft.length < 2 ? `还需布置 ${2 - preparationDraft.length} 层陷阱。` : "陷阱已布置完成，点击“锁定陷阱”确认。"
      : "对方准备完成后将自动开始正式行棋。";
    heroPreparationStatus.textContent = canPrepare
      ? `秘密草稿 ${preparationDraft.length}/2｜${preparationDraft.length < 2 ? "点击己方半场" : "可撤回或锁定"}`
      : "己方已完成；对方的陷阱位置不可见";
    trapUndoButton.hidden = !canPrepare || preparingHero !== "hunter";
    preparationConfirmButton.hidden = !canPrepare || preparingHero !== "hunter";
    if (canPrepare && preparingHero !== "hunter") { heroPreparationTitle.textContent = `${preparingHero ? heroCatalog[preparingHero].name : "英雄"}·准备`; heroPreparationStatus.textContent = "请在英雄准备面板中选择并确认。"; moveHint.textContent = "准备选项确认后再开始正式回合。"; announcement.textContent = "公开选择刃侧或征兵兵种。"; turnStatus.textContent = "英雄准备中"; }
    trapUndoButton.disabled = preparationDraft.length === 0 || Boolean(bluetooth?.pendingAction);
    preparationConfirmButton.disabled = preparationDraft.length !== 2 || Boolean(bluetooth?.pendingAction);
  } else if (openingActive || remoteView?.phase === "hero_intro") {
    battleCanvas.classList.remove("preparing-red", "preparing-black");
    battleTurnTimer.setAttribute("aria-label", "本回合剩余秒数");
    turnStatus.innerHTML = `<b>英雄入场</b><span>准备阶段尚未开始</span>`;
    announcement.textContent = "本局畸变与双方英雄正在公布。";
    moveHint.textContent = "动画结束、英雄头像落位后开始战斗准备。";
  } else if (gameState.status === "finished") {
    battleCanvas.classList.remove("preparing-red", "preparing-black");
    battleTurnTimer.setAttribute("aria-label", "本回合剩余秒数");
    turnStatus.innerHTML = `<b>对局结束</b><span>第 ${gameState.revision} 手</span>`;
    announcement.textContent = finishMessage();
    moveHint.textContent = "可以重新开始，再进行一局猜拳。";
  } else if (gameState.status === "execution") {
    battleCanvas.classList.remove("preparing-red", "preparing-black");
    battleTurnTimer.setAttribute("aria-label", "本回合剩余秒数");
    const title = finishTitle();
    turnStatus.innerHTML = `<b>${title}发动</b><span>终结演出中</span>`;
    announcement.textContent = "胜负已定，终结正在执行。";
    moveHint.textContent = "棋盘已锁定，终结动画播放完毕后公布结果。";
  } else {
    battleCanvas.classList.remove("preparing-red", "preparing-black");
    battleTurnTimer.setAttribute("aria-label", "本回合剩余秒数");
    const player = rpsPublic.assignments[gameState.turn];
    turnStatus.innerHTML = `<b>${gameState.turn === "red" ? "红方" : "蓝方"}行棋</b><span>${player} · 第 ${gameState.revision + 1} 手</span>`;
    const inCheck = isGeneralInCheck(gameState, gameState.turn);
    announcement.textContent = inCheck ? `${gameState.turn === "red" ? "红帅" : "黑将"}正在被将军，必须应将。` : latestAnnouncement;
    moveHint.textContent = selectedPieceId ? descriptionForPiece(selectedPieceId) : "点选当前方控制的棋子，再点选绿色落点。";
  }
  renderBoard();
  const remoteLocked = isBluetoothTransportInterrupted()
    || Boolean(bluetooth?.pendingAction)
    || (Boolean(remoteView) && remoteView?.viewerSide !== gameState.turn)
    || isMatchOverlayOpen();
  battleMoreButton.hidden = gameState.status === "finished" || gameState.status === "execution";
  battleMoreButton.disabled = isBluetoothTransportInterrupted();
  const detailControlsDisabled = isBluetoothTransportInterrupted() || gameState.status === "finished" || gameState.status === "execution";
  redCapturedButton.disabled = detailControlsDisabled;
  blackCapturedButton.disabled = detailControlsDisabled;
  element<HTMLButtonElement>("red-hero-avatar").disabled = detailControlsDisabled;
  element<HTMLButtonElement>("black-hero-avatar").disabled = detailControlsDisabled;
  resignButton.disabled = gameState.status !== "playing" || preparationActive || openingActive || remoteView?.phase === "hero_intro" || remoteLocked;
  const skill = gameState.assassination?.[gameState.turn];
  const active = skill?.activePieceId;
  const canAssassinate = Boolean(skill?.heroChargeAvailable || skill?.mutationChargeAvailable || active);
  const sourceSelect = element<HTMLSelectElement>("assassination-source");
  const availableSources = [
    ...(skill?.heroChargeAvailable ? ["hero" as const] : []),
    ...(skill?.mutationChargeAvailable ? ["mutation" as const] : []),
  ];
  sourceSelect.replaceChildren(...availableSources.map((source) => {
    const option = document.createElement("option");
    option.value = source;
    option.textContent = source === "hero" ? "英雄次数" : "暗影之舞";
    return option;
  }));
  sourceSelect.hidden = availableSources.length === 0;
  sourceSelect.disabled = gameState.status !== "playing" || Boolean(active) || preparationActive || openingActive || remoteView?.phase === "hero_intro" || remoteLocked;
  const assassinationButton = element<HTMLButtonElement>("assassination-button");
  assassinationButton.disabled = gameState.status !== "playing" || preparationActive || openingActive || remoteView?.phase === "hero_intro" || remoteLocked || !canAssassinate;
  assassinationButton.textContent = active
    ? "选择隐身棋行动"
    : assassinationArmed ? "刺杀：请选择明棋" : "发动刺杀";
  const strongButton = element<HTMLButtonElement>("strong-strike-button");
  const activeStrikeAvailable = Boolean(active && gameState.effectsByPieceId?.[active]?.stealth?.strongStrikeAvailable);
  strongButton.disabled = gameState.status !== "playing" || preparationActive || openingActive || remoteView?.phase === "hero_intro" || remoteLocked || !activeStrikeAvailable;
  strongButton.textContent = strongStrikeArmed ? "刺杀机会：请选择目标" : "发动刺杀机会";
  updateBattleTurnTimer();
  renderTransferredHeroControls();
}

function moveSummary(targetWasCovered: boolean, capturedLabel?: string, revealedLabel?: string): string {
  if (!gameState?.lastMove) return "已落子。";
  const actor = gameState.lastMove.actingSide === "red" ? "红方" : "蓝方";
  const details = [capturedLabel ? `${actor}吃掉${capturedLabel}` : "已落子", revealedLabel ? `翻出${revealedLabel}` : ""];
  const crushed = gameState.lastMove.pathCrushed ?? [];
  if (crushed.length > 0) {
    details.push(`路径碾碎${crushed.map((piece) => `${piece.color === "red" ? "红" : "黑"}${pieceLabel[piece.color][piece.type]}`).join("、")}`);
  }
  if (gameState.lastMove.bouncedAgainstPieceId) details.push("防护壁垒将攻击者弹回");
  if (targetWasCovered && capturedLabel) details.push("被吃暗子已揭开");
  if (gameState.status === "execution") return `${details.filter(Boolean).join("，")}。终结已触发。`;
  if (gameState.status === "finished") return `${details.filter(Boolean).join("，")}。${finishMessage()}`;
  return `${details.filter(Boolean).join("，")}。轮到${gameState.turn === "red" ? "红方" : "蓝方"}。`;
}

function beginAutomaticExecution(): void {
  if (!gameState || !gameSecret || gameState.status !== "execution") return;
  const plan = getAutomaticExecutionPlan(gameState);
  if (!plan) return showToast("终结动作生成失败，请重新开始对局。");
  const source = pieceAt(gameState, plan.from);
  if (!source || source.faceDown) return showToast("终结棋子状态异常。");
  const sourcePoint = boardPoints.querySelector<HTMLElement>(`.point[data-x="${plan.from.x}"][data-y="${plan.from.y}"]`);
  const targetPoint = boardPoints.querySelector<HTMLElement>(`.point[data-x="${plan.to.x}"][data-y="${plan.to.y}"]`);
  if (!sourcePoint || !targetPoint) return showToast("终结动画定位失败。");

  const boardRect = boardPlane.getBoundingClientRect();
  const sourceRect = sourcePoint.getBoundingClientRect();
  const targetRect = targetPoint.getBoundingClientRect();
  const reasonClass = gameState.reason === "ambush" ? "ambush" : "judgment";
  executionGhost.hidden = false;
  executionGhost.className = `execution-ghost piece ${source.color}`;
  executionGhost.style.setProperty("--ring-url", `url("${ringAsset(stableRingIndex(source.id))}")`);
  executionGhost.replaceChildren(createPieceGlyph(source.color, source.type));
  executionGhost.style.left = `${sourceRect.left - boardRect.left + sourceRect.width / 2}px`;
  executionGhost.style.top = `${sourceRect.top - boardRect.top + sourceRect.height / 2}px`;
  terminationEffect.textContent = gameState.reason === "ambush" ? "背刺" : "裁决";
  terminationEffect.className = `termination-effect active ${reasonClass}`;
  boardPlane.classList.add("executing", reasonClass);

  window.requestAnimationFrame(() => {
    executionGhost.classList.add("moving");
    executionGhost.style.left = `${targetRect.left - boardRect.left + targetRect.width / 2}px`;
    executionGhost.style.top = `${targetRect.top - boardRect.top + targetRect.height / 2}px`;
  });

  executionTimer = window.setTimeout(() => {
    if (!gameState || !gameSecret) return;
    try {
      const result = applyAutomaticExecution(gameState, gameSecret, nextActionId());
      gameState = result.state;
      gameSecret = result.secret;
      executionGhost.hidden = true;
      executionGhost.className = "execution-ghost";
      terminationEffect.className = "termination-effect";
      boardPlane.classList.remove("executing", "ambush", "judgment");
      renderGame();
      showMatchResult();
    } catch (error) {
      showToast(error instanceof RuleError ? error.message : "终结失败，请重新开始对局。");
    } finally {
      executionTimer = undefined;
    }
  }, 1150);
}

/** Remote rooms already applied the forced capture on the host.  Reuse the
 * same visual beat locally without attempting a second authoritative move. */
function playRemoteTerminalAnimation(terminal: NonNullable<PlayerRemoteRoomView["terminalAnimation"]>): void {
  if (!gameState) return;
  const source = gameState.pieces.find((piece) => piece.id === terminal.plan.pieceId);
  const sourcePoint = boardPoints.querySelector<HTMLElement>(`.point[data-x="${terminal.plan.from.x}"][data-y="${terminal.plan.from.y}"]`);
  const targetPoint = boardPoints.querySelector<HTMLElement>(`.point[data-x="${terminal.plan.to.x}"][data-y="${terminal.plan.to.y}"]`);
  if (!source || !sourcePoint || !targetPoint || source.faceDown) {
    showMatchResult();
    return;
  }
  const boardRect = boardPlane.getBoundingClientRect();
  const sourceRect = sourcePoint.getBoundingClientRect();
  const targetRect = targetPoint.getBoundingClientRect();
  const reasonClass = terminal.reason === "ambush" ? "ambush" : "judgment";
  executionGhost.hidden = false;
  executionGhost.className = `execution-ghost piece ${source.color}`;
  executionGhost.style.setProperty("--ring-url", `url("${ringAsset(stableRingIndex(source.id))}")`);
  executionGhost.replaceChildren(createPieceGlyph(source.color, source.type));
  executionGhost.style.left = `${sourceRect.left - boardRect.left + sourceRect.width / 2}px`;
  executionGhost.style.top = `${sourceRect.top - boardRect.top + sourceRect.height / 2}px`;
  terminationEffect.textContent = terminal.reason === "ambush" ? "背刺" : "裁决";
  terminationEffect.className = `termination-effect active ${reasonClass}`;
  boardPlane.classList.add("executing", reasonClass);
  window.requestAnimationFrame(() => {
    executionGhost.classList.add("moving");
    executionGhost.style.left = `${targetRect.left - boardRect.left + targetRect.width / 2}px`;
    executionGhost.style.top = `${targetRect.top - boardRect.top + targetRect.height / 2}px`;
  });
  if (executionTimer) window.clearTimeout(executionTimer);
  executionTimer = window.setTimeout(() => {
    executionGhost.hidden = true;
    executionGhost.className = "execution-ghost";
    terminationEffect.className = "termination-effect";
    boardPlane.classList.remove("executing", "ambush", "judgment");
    renderGame();
    showMatchResult();
    executionTimer = undefined;
  }, 1150);
}

function isOwnHalf(side: Side, position: Position): boolean {
  return side === "red" ? position.y >= 5 : position.y <= 4;
}

/** Local playground mirror of the private server trap resolution.  Online
 * games use the same rule through remote-room.ts, where coordinates never
 * enter the shared room document. */
function resolveLocalTrapsAfterAction(): string | undefined {
  if (!gameState || !gameSecret) return;
  localTraps = gameSecret.traps ?? [];
  const event = gameState.automaticEvents?.find(e => e.kind === "trap_trigger");
  return event?.side ? trapTriggerAnnouncement(event.side, gameState.reason === "trap_ambush") : undefined;
}

function placeLocalTrap(position: Position): void {
  if (!trapSetupSide || !gameState || !localPreparationActive) return;
  if (!isOwnHalf(trapSetupSide, position)) {
    showToast("陷阱只能布置在己方半场。");
    return;
  }
  if (localTrapDraft.length >= 2) return showToast("两层陷阱已经放完；可撤回上一步后重新布置。");
  localTrapDraft.push({ ...position });
  renderGame();
}

function onBoardClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>(".point");
  if (!target || !gameState) return;
  if (isMatchOverlayOpen()) return;
  if (isBluetoothTransportInterrupted()) return showToast("连接正在恢复，棋盘暂时锁定。");
  const to = { x: Number(target.dataset.x), y: Number(target.dataset.y) };
  if (openingActive || bluetooth?.view?.phase === "hero_intro") return;
  if (bluetooth?.view?.phase === "hero_preparation") {
    const side = bluetooth.view.viewerSide;
    const isHunter = Boolean(side && bluetooth.view.features?.heroes?.[side] === "hunter");
    const alreadyReady = Boolean(side && bluetooth.view.features?.heroPreparation?.ready[side]);
    if (!side || !isHunter || alreadyReady) return showToast("当前正在等待对方完成英雄准备。");
    if (!isOwnHalf(side, to)) return showToast("陷阱只能布置在己方半场。");
    if (bluetooth.trapDraft.length >= 2) return showToast("两层陷阱已经放完；可撤回上一步后重新布置。");
    bluetooth.trapDraft.push(to);
    handleBluetoothAction({ kind: "trap_draft", positions: bluetooth.trapDraft });
    renderGame();
    return;
  }
  if (localPreparationActive) {
    if (trapSetupSide && localHeroes[trapSetupSide] !== "hunter") return showToast("请在英雄准备面板中选择并确认。");
    placeLocalTrap(to);
    return;
  }
  if (gameState.status !== "playing") return;
  if (bluetooth?.view && bluetooth.view.viewerSide !== gameState.turn) {
    return showToast("现在轮到对方行棋。请等待房主同步。 ");
  }
  if (gameState.pendingDescent || gameState.pendingHeroChild || gameState.pendingShuffle) return showToast("请先完成英雄结算面板中的选择。");
  const atTarget = pieceAt(gameState, to);

  if (!selectedPieceId) {
    if (!atTarget) return showToast("请先点选当前方控制的棋子。");
    if (getController(atTarget) !== gameState.turn) return showToast("这枚棋子不由当前方控制。");
    const activeStealthSource = gameState.assassination?.[gameState.turn]?.activePieceId === atTarget.id;
    if (!assassinationArmed && (activeStealthSource ? getLegalAssassinationMoves(gameState, atTarget.id, false) : gameState.flowDance ? getFlowDanceMoves(gameState, atTarget.id) : getLegalMoves(gameState, atTarget.id)).length === 0) {
      return showToast(noLegalMoveMessage(atTarget.id));
    }
    selectedPieceId = atTarget.id;
    renderGame();
    return;
  }

  const selected = gameState.pieces.find((piece) => piece.id === selectedPieceId);
  if (atTarget?.id === selectedPieceId) {
    selectedPieceId = undefined;
    renderGame();
    return;
  }
  const activeStealth = gameState.assassination?.[gameState.turn]?.activePieceId === selectedPieceId;
  const usingAssassination = assassinationArmed || activeStealth;
  const targetIsLegal = usingAssassination
    ? getLegalAssassinationMoves(gameState, selectedPieceId, strongStrikeArmed).some(
      (move) => positionKey(move) === positionKey(to),
    )
    : (gameState.flowDance ? getFlowDanceMoves(gameState, selectedPieceId) : getLegalMoves(gameState, selectedPieceId)).some(
      (move) => positionKey(move) === positionKey(to),
    );
  if (atTarget && getController(atTarget) === gameState.turn && !targetIsLegal) {
    selectedPieceId = atTarget.id;
    renderGame();
    return;
  }
  if (!selected || !targetIsLegal) {
    return showToast("这个落点不合法，请选择绿色标记的位置。");
  }

  const targetWasCovered = Boolean(atTarget?.faceDown);
  if (bluetooth?.view) {
    const actionId = bluetoothActionId();
    const command = {
      from: { x: selected.x, y: selected.y }, pieceId: selected.id, to,
      expectedRevision: gameState.revision,
      actionId,
    };
    handleBluetoothAction(usingAssassination
      ? {
          kind: "assassination",
          command: {
            ...command,
            kind: "assassination",
            source: assassinationArmed ? element<HTMLSelectElement>("assassination-source").value as "hero" | "mutation" : undefined,
            useStrongStrike: strongStrikeArmed,
          },
        }
      : { kind: "move", command });
    latestAnnouncement = targetWasCovered ? "已请求吃子并揭开目标，等待房主裁定。" : "已请求落子，等待房主裁定。";
    selectedPieceId = undefined;
    assassinationArmed = false;
    strongStrikeArmed = false;
    renderGame();
    return;
  }
  if (!gameSecret) return;
  gameSecret.traps = structuredClone(localTraps);
  const wasFlowDance = Boolean(gameState.flowDance);
  try {
    const result = usingAssassination
      ? applyAuthoritativeAssassination(gameState, gameSecret, {
          kind: "assassination",
          from: { x: selected.x, y: selected.y }, pieceId: selected.id, to,
          source: assassinationArmed ? element<HTMLSelectElement>("assassination-source").value as "hero" | "mutation" : undefined,
          useStrongStrike: strongStrikeArmed,
          expectedRevision: gameState.revision, actionId: nextActionId(),
        })
      : applyAuthoritativeMove(gameState, gameSecret, {
      from: { x: selected.x, y: selected.y },
      pieceId: selected.id,
      to,
      expectedRevision: gameState.revision,
      actionId: nextActionId(),
        });
    gameState = result.state;
    gameSecret = result.secret;
    if (!gameState.flowDance && !wasFlowDance && !gameState.pendingHeroChild && !gameState.pendingShuffle) startFormalClock(gameState, Date.now(), gameSecret);
    const trapMessage = resolveLocalTrapsAfterAction();
    queueFormalEventCues(gameState, Boolean(trapMessage), usingAssassination ? strongStrikeArmed ? "刺杀机会发动" : "刺杀发动" : undefined);
    const captured = gameState.lastMove?.captured;
    const revealed = gameState.lastMove?.revealed;
    latestAnnouncement = trapMessage ?? moveSummary(
      targetWasCovered,
      captured ? `${captured.color === "red" ? "红" : "黑"}${pieceLabel[captured.color][captured.type]}` : undefined,
      revealed ? `${revealed.color === "red" ? "红" : "黑"}${pieceLabel[revealed.color][revealed.type]}` : undefined,
    );
    const actingSide = gameState.lastMove?.actingSide === "red" ? "红方" : "蓝方";
    const skillPrefix = usingAssassination ? `${actingSide}发动${strongStrikeArmed ? "刺杀机会" : "刺杀"}，` : "";
    appendLocalSystemMessage(`${skillPrefix}${latestAnnouncement}${gameState.status === "playing" ? ` 轮到${gameState.turn === "red" ? "红方" : "蓝方"}。` : " 对局结束。"}`);
    selectedPieceId = undefined;
    assassinationArmed = false;
    strongStrikeArmed = false;
    renderGame();
    if (gameState.status === "execution") beginAutomaticExecution();
    if (gameState.status === "finished") showMatchResult();
    else if (!wasFlowDance && !gameState.flowDance && !gameState.forcedDefense && gameState.status === "playing") localGameHandoff();
  } catch (error) {
    showToast(error instanceof RuleError ? error.message : "落子失败，请重试。");
  }
}

document.querySelectorAll<HTMLButtonElement>(".rps-choice").forEach((button) => {
  button.addEventListener("click", () => selectRpsChoice(button.dataset.choice as RpsChoice));
});
rpsConfirmButton.addEventListener("click", confirmRpsChoice);
element<HTMLButtonElement>("rps-back-button").addEventListener("click", handleSystemBack);
element<HTMLButtonElement>("hero-back-button").addEventListener("click", handleSystemBack);
heroConfirmButton.addEventListener("click", confirmHeroSelection);
trapUndoButton.addEventListener("click", undoTrapDraft);
preparationConfirmButton.addEventListener("click", confirmHeroPreparation);
element<HTMLButtonElement>("local-game-button").addEventListener("click", activateLocalGame);
element<HTMLButtonElement>("bluetooth-menu-button").addEventListener("click", showBluetoothLobby);
element<HTMLButtonElement>("online-game-button").addEventListener("click", () => showToast("联机对战尚未开放"));
element<HTMLButtonElement>("settings-menu-button").addEventListener("click", showSettings);
element<HTMLButtonElement>("rules-menu-button").addEventListener("click", showRules);
element<HTMLButtonElement>("rules-back-button").addEventListener("click", showMainMenu);
for (const tab of document.querySelectorAll<HTMLButtonElement>(".rule-tab")) {
  tab.addEventListener("click", () => showRulesTab(tab.dataset.ruleTab ?? "basic"));
}
for (const details of document.querySelectorAll<HTMLDetailsElement>(".rule-panel details")) {
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    const panel = details.closest<HTMLElement>(".rule-panel");
    for (const sibling of panel?.querySelectorAll<HTMLDetailsElement>("details[open]") ?? []) {
      if (sibling !== details) sibling.open = false;
    }
  });
}
renderMovementGuides();
element<HTMLButtonElement>("rule-diagram-close").addEventListener("click", closeRuleDiagram);
element<HTMLButtonElement>("rule-diagram-scrim").addEventListener("click", closeRuleDiagram);
element<HTMLButtonElement>("bluetooth-back-button").addEventListener("click", leaveBluetoothLobby);
element<HTMLButtonElement>("bluetooth-join-mode-button").addEventListener("click", () => {
  bluetoothInitialActions.hidden = true;
  bluetoothSessionPanel.hidden = true;
  bluetoothJoinPanel.hidden = false;
  setBluetoothStatus("请选择已配对的房主设备。");
  refreshBluetoothDevices();
});
element<HTMLButtonElement>("bluetooth-open-settings-button").addEventListener("click", () => nativeBluetooth()?.openBluetoothSettings());
element<HTMLButtonElement>("bluetooth-join-cancel-button").addEventListener("click", () => {
  resetBluetoothLobbyPanels();
  renderBluetoothAvailability();
});
bluetoothRetryButton.addEventListener("click", retryBluetoothConnection);
bluetoothRematchRequestButton.addEventListener("click", requestBluetoothRematch);
bluetoothRematchAcceptButton.addEventListener("click", () => respondBluetoothRematch(true));
bluetoothRematchDeclineButton.addEventListener("click", () => respondBluetoothRematch(false));
bluetoothCancelButton.addEventListener("click", cancelBluetoothSetup);
bluetoothReturnButton.addEventListener("click", cancelBluetoothSetup);
bluetoothEnableButton.addEventListener("click", () => nativeBluetooth()?.openBluetoothSettings());
bluetoothPermissionButton.addEventListener("click", () => nativeBluetooth()?.requestPermission());
bluetoothAppSettingsButton.addEventListener("click", () => nativeBluetooth()?.openAppSettings());
element<HTMLButtonElement>("settings-back-button").addEventListener("click", showMainMenu);
element<HTMLSelectElement>("game-mode-setting").addEventListener("change", (event) => {
  selectedGameMode = normalizeGameMode((event.target as HTMLSelectElement).value);
  try { localStorage.setItem(GAME_MODE_PREFERENCE_KEY, selectedGameMode); } catch { /* Session choice remains usable. */ }
  renderGameModeSetting();
});
element<HTMLButtonElement>("game-mode-preview-button").addEventListener("click", showBaseModePreview);
for (const id of ["sound-setting", "haptics-setting", "reduce-motion-setting"] as const) {
  element<HTMLInputElement>(id).addEventListener("change", saveUiPreferences);
}
element<HTMLButtonElement>("settings-reset-button").addEventListener("click", () => {
  try {
    localStorage.removeItem(UI_PREFERENCES_KEY);
  } catch {
    // The default state can still be applied for this session.
  }
  applyUiPreferences({ ...DEFAULT_UI_PREFERENCES });
  selectedGameMode = "jieqi";
  try { localStorage.removeItem(GAME_MODE_PREFERENCE_KEY); } catch { /* Reset current session regardless. */ }
  renderGameModeSetting();
  showToast("已恢复默认设置");
});
element<HTMLButtonElement>("bluetooth-host-button").addEventListener("click", beginBluetoothHost);
element<HTMLButtonElement>("bluetooth-refresh-button").addEventListener("click", refreshBluetoothDevices);
element<HTMLButtonElement>("bluetooth-join-button").addEventListener("click", joinBluetoothRoom);
boardPoints.addEventListener("click", onBoardClick);
messagePanelToggle.addEventListener("click", () => setMessageDrawer(true));
messageDrawerClose.addEventListener("click", () => setMessageDrawer(false));
messageNewButton.addEventListener("click", () => {
  messageHistory.scrollTop = messageHistory.scrollHeight;
  markMessagesRead();
});
messageHistory.addEventListener("scroll", () => {
  if (messageDrawerOpen && historyIsAtNewest()) markMessagesRead();
}, { passive: true });
messageInput.addEventListener("input", () => {
  const characters = Array.from(messageInput.value);
  if (characters.length > CHAT_MAX_CHARACTERS) messageInput.value = characters.slice(0, CHAT_MAX_CHARACTERS).join("");
  renderMessagePanel();
});
messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendBluetoothChat(messageInput.value, true);
});
document.querySelectorAll<HTMLButtonElement>("#quick-message-grid button").forEach((button) => {
  button.addEventListener("click", () => sendBluetoothChat(button.textContent ?? "", false));
});
let messageSwipeStartY: number | undefined;
messageDrawer.addEventListener("pointerdown", (event) => {
  messageSwipeStartY = event.clientY;
}, { passive: true });
messageDrawer.addEventListener("pointerup", (event) => {
  if (messageSwipeStartY !== undefined && event.clientY - messageSwipeStartY > 60) setMessageDrawer(false);
  messageSwipeStartY = undefined;
}, { passive: true });
const updateMessageKeyboardInset = () => {
  const viewport = window.visualViewport;
  const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
  document.documentElement.style.setProperty("--message-keyboard-inset", `${inset}px`);
};
window.visualViewport?.addEventListener("resize", updateMessageKeyboardInset);
window.visualViewport?.addEventListener("scroll", updateMessageKeyboardInset);
redCapturedButton.addEventListener("click", showCapturedDetails);
blackCapturedButton.addEventListener("click", showCapturedDetails);
element<HTMLButtonElement>("red-hero-avatar").addEventListener("click", () => showHeroDetails("red"));
element<HTMLButtonElement>("black-hero-avatar").addEventListener("click", () => showHeroDetails("black"));

type MatchMenuMode = "preplay" | "opening" | "playing";

function currentMatchMenuMode(): MatchMenuMode | undefined {
  if (!heroView.hidden || !rpsView.hidden) return "preplay";
  if (gameView.hidden || !gameState || gameState.status === "finished" || gameState.status === "execution") return undefined;
  if (openingActive || localPreparationActive || bluetooth?.view?.phase === "hero_intro" || bluetooth?.view?.phase === "hero_preparation") return "opening";
  return "playing";
}

function isMatchOverlayOpen(): boolean {
  return messageDrawerOpen || !matchMenuLayer.hidden || !matchDetailLayer.hidden || !matchResultLayer.hidden;
}

function setBattleActionMenu(open: boolean): void {
  const mode = currentMatchMenuMode();
  const shouldOpen = open && Boolean(mode) && disconnectLayer.hidden;
  if (shouldOpen) setBattleSkillPanel(false);
  matchMenuLayer.hidden = !shouldOpen;
  matchMenuLayer.dataset.placement = mode === "preplay" ? "top" : "bottom";
  matchMutationButton.hidden = mode === "preplay";
  matchExitButton.hidden = mode === "playing";
  resignButton.hidden = mode !== "playing";
  battleMoreButton.setAttribute("aria-expanded", String(shouldOpen));
  heroMoreButton.setAttribute("aria-expanded", String(shouldOpen));
  rpsMoreButton.setAttribute("aria-expanded", String(shouldOpen));
}

function setBattleSkillPanel(open: boolean): void {
  if (open) setBattleActionMenu(false);
  battleSkillPanel.hidden = !open;
}

function confirmExitMatch(): void {
  showMatchConfirmation(
    "退出对局",
    "确定要退出当前对局吗？进入英雄选择后主动退出，本局将立即判负。",
    "确认退出",
    () => {
      if (bluetooth?.view) {
        handleBluetoothAction({ kind: "forfeit", actionId: bluetoothActionId() });
        return;
      }
      showMainMenu();
    },
  );
}

function confirmResignation(): void {
  if (!gameState || gameState.status !== "playing") return;
  showMatchConfirmation(
    "认输",
    "确定要认输吗？认输后本局将立即结束。",
    "确认认输",
    () => {
      if (!gameState || gameState.status !== "playing") return;
      if (bluetooth?.view) {
        handleBluetoothAction({ kind: "resign", expectedRevision: gameState.revision, actionId: bluetoothActionId() });
        return;
      }
      if (!gameSecret) return;
      const result = applyResignation(gameState, gameSecret, gameState.turn, gameState.revision, nextActionId());
      gameState = result.state;
      gameSecret = result.secret;
      appendLocalSystemMessage(`${gameState.winner === "red" ? "蓝方" : "红方"}认输，对局结束。`);
      selectedPieceId = undefined;
      renderGame();
      showMatchResult();
    },
  );
}

for (const button of [battleMoreButton, heroMoreButton, rpsMoreButton]) {
  button.addEventListener("click", () => setBattleActionMenu(matchMenuLayer.hidden));
}
element<HTMLButtonElement>("match-menu-scrim").addEventListener("click", () => setBattleActionMenu(false));
element<HTMLButtonElement>("match-detail-close").addEventListener("click", closeMatchDetail);
element<HTMLButtonElement>("match-detail-cancel").addEventListener("click", closeMatchDetail);
matchDetailLayer.addEventListener("click", (event) => {
  if (event.target === matchDetailLayer) closeMatchDetail();
});
document.querySelectorAll<HTMLButtonElement>(".v4-skill-trigger").forEach((button) => {
  let pressTimer: number | undefined;
  const cancelTimer = () => {
    if (pressTimer) window.clearTimeout(pressTimer);
    pressTimer = undefined;
  };
  button.addEventListener("pointerdown", () => {
    cancelTimer();
    button.dataset.longPressed = "false";
    pressTimer = window.setTimeout(() => {
      button.dataset.longPressed = "true";
      showRuntimeSkillDetails(button);
    }, 550);
  });
  button.addEventListener("pointerup", cancelTimer);
  button.addEventListener("pointercancel", cancelTimer);
  button.addEventListener("pointerleave", cancelTimer);
  button.addEventListener("click", () => {
    if (button.dataset.longPressed === "true") {
      button.dataset.longPressed = "false";
      return;
    }
    activateRuntimeSkill(button);
  });
});
element<HTMLButtonElement>("battle-rules-button").addEventListener("click", showMatchRules);
matchMutationButton.addEventListener("click", showCurrentMutationDetails);
matchExitButton.addEventListener("click", confirmExitMatch);
resignButton.addEventListener("click", confirmResignation);
element<HTMLButtonElement>("battle-mutation-button").addEventListener("click", showCurrentMutationDetails);
matchResultRematch.addEventListener("click", startRematchFromResult);
matchResultMainMenu.addEventListener("click", returnFromMatchResult);
element<HTMLButtonElement>("restart-button").addEventListener("click", () => {
  if (!gameState || gameState.status === "finished" || window.confirm("重新开始会结束当前对局，确定吗？")) {
    nativeBluetooth()?.disconnect();
    bluetooth = undefined;
    showMainMenu();
  }
});
document.querySelector<HTMLAnchorElement>(".brand")!.addEventListener("click", (event) => {
  event.preventDefault();
  if (!gameState || gameState.status === "finished" || window.confirm("重新开始会结束当前对局，确定吗？")) {
    nativeBluetooth()?.disconnect();
    bluetooth = undefined;
    showMainMenu();
  }
});
element<HTMLButtonElement>("assassination-button").addEventListener("click", () => {
  setBattleSkillPanel(false);
  if (!gameState || gameState.status !== "playing") return;
  const activePieceId = gameState.assassination?.[gameState.turn]?.activePieceId;
  if (activePieceId) {
    assassinationArmed = false;
    strongStrikeArmed = false;
    selectedPieceId = activePieceId;
    latestAnnouncement = "请选择隐身棋的落点；普通行动会结束隐身并放弃未用刺杀机会。";
  } else {
    assassinationArmed = !assassinationArmed;
    strongStrikeArmed = false;
    selectedPieceId = undefined;
    latestAnnouncement = assassinationArmed ? "刺杀已准备：选择当前方的一枚非将帅明棋，再选择落点。" : latestAnnouncement;
  }
  renderGame();
});
element<HTMLButtonElement>("strong-strike-button").addEventListener("click", () => {
  setBattleSkillPanel(false);
  if (!gameState || gameState.status !== "playing") return;
  const activePieceId = gameState.assassination?.[gameState.turn]?.activePieceId;
  if (!activePieceId && !assassinationArmed) return showToast("请先发动刺杀，再选择是否立即刺杀机会。");
  if (activePieceId && !gameState.effectsByPieceId?.[activePieceId]?.stealth?.strongStrikeAvailable) {
    return showToast("本次刺杀的刺杀机会已经使用。");
  }
  strongStrikeArmed = !strongStrikeArmed;
  if (activePieceId) {
    selectedPieceId = activePieceId;
    assassinationArmed = false;
  }
  latestAnnouncement = strongStrikeArmed
    ? activePieceId
      ? "刺杀机会已准备：选择一个符合棋子走法的非将帅目标。"
      : "立即刺杀机会已准备：选择己方非将帅明棋，再选择合法目标。"
    : latestAnnouncement;
  renderGame();
});
flowDialog.addEventListener("cancel", (event) => event.preventDefault());
disconnectBluetoothButton.addEventListener("click", () => {
  nativeBluetooth()?.openBluetoothSettings();
  nativeBluetooth()?.reconnect();
});

window.setInterval(updateVisibleTimers, 250);

window.addEventListener("jieqi-bluetooth", ((event: CustomEvent<BluetoothEventDetail>) => {
  const detail = event.detail;
  if (!detail) return;
  if (detail.event === "state" || detail.type === "transport-state") {
    if (!bluetooth) return;
    const previousState = bluetooth.nativeState;
    const wasEstablished = Boolean(bluetooth.everConnected);
    bluetooth.nativeState = detail.state ?? bluetooth.nativeState;
    bluetooth.adapterEnabled = detail.adapterEnabled ?? bluetooth.adapterEnabled;

    if (detail.state === "LISTENING" && !wasEstablished) {
      setBluetoothStatus("房主正在监听。请让另一台已配对手机选择本机并加入。");
      showBluetoothSessionState({
        kicker: "创建对局",
        title: "等待对方加入",
        deviceName: bluetooth.localDeviceName,
        detail: detail.detail || "请让另一台已配对手机选择本机并加入。",
        cancel: true,
      });
    }

    if (detail.state === "CONNECTING" && !wasEstablished) {
      showBluetoothSessionState({
        kicker: "加入对局",
        title: "正在连接",
        deviceName: bluetooth.targetName,
        detail: detail.detail || "正在连接房主设备，请稍候。",
        cancel: true,
      });
    }

    if (detail.state === "CONNECTED") {
      const restoring = wasEstablished && previousState !== "CONNECTED";
      bluetooth.everConnected = true;
      bluetooth.pendingAction = false;
      setBluetoothStatus(restoring ? "连接已恢复。" : "蓝牙已连接，正在同步房间。");

      if (!restoring && !wasEstablished) {
        showBluetoothSessionState({
          kicker: "蓝牙房间",
          title: "连接成功",
          deviceName: bluetooth.role === "host" ? undefined : bluetooth.targetName,
          detail: "正在同步房间，即将进入英雄选择。",
          cancel: false,
        });
      }

      if (bluetooth.role === "host") {
        bluetooth.hostRoom ??= new BluetoothHostRoom({
          roomId: randomSessionText("bt-room"),
          admissionSecret: randomSessionText("physical"),
          mode: bluetoothModeConfig(),
        });
        if (restoring) {
          const disconnects = bluetooth.hostRoom.views().publicRoom.disconnects?.players ?? {};
          for (const playerId of [BLUETOOTH_HOST_PLAYER, BLUETOOTH_GUEST_PLAYER] as const) {
            if (disconnects[playerId]?.disconnectedAt !== undefined) bluetooth.hostRoom.reconnect(playerId);
          }
        }
        publishBluetoothViews();
      }

      const restoringPostGameLobby = restoring && bluetooth.view?.phase === "finished" && !bluetoothLobbyView.hidden;
      if (restoringPostGameLobby) {
        disconnectLayer.hidden = true;
        showBluetoothRematchLobby(bluetooth.view);
        showToast("蓝牙连接已恢复，可以再次邀请。 ");
      } else if (restoring) {
        bluetooth.localDisconnectStartedAt = undefined;
        bluetooth.localDisconnectPlayerId = undefined;
        resumeBluetoothUiClocks();
        disconnectTitle.textContent = "连接已恢复";
        disconnectCopy.textContent = "正在恢复原阶段与动画位置。";
        disconnectTimer.textContent = "";
        disconnectBluetoothButton.hidden = true;
        disconnectLayer.hidden = false;
        window.setTimeout(() => {
          if (bluetooth?.nativeState === "CONNECTED") disconnectLayer.hidden = true;
        }, 2_000);
      }
    }

    if ((detail.state === "DISCONNECTED" || detail.state === "ERROR") && wasEstablished) {
      bluetooth.pendingAction = false;
      const awaitingRematch = bluetooth.view?.phase === "finished" && !bluetoothLobbyView.hidden;
      if (awaitingRematch) {
        disconnectLayer.hidden = true;
        bluetoothRematchTimer.hidden = true;
        bluetoothRematchAcceptButton.hidden = true;
        bluetoothRematchDeclineButton.hidden = true;
        bluetoothRematchRequestButton.hidden = true;
        bluetoothSessionTitle.textContent = "对方已断线";
        bluetoothSessionDetail.textContent = "再战邀请已经停止；关闭提示后仍停留在蓝牙页。";
        showDialog("再战邀请", "对方已断线", "知道了", () => {
          if (bluetooth?.view) showBluetoothRematchLobby(bluetooth.view);
          bluetoothSessionKicker.textContent = "蓝牙房间";
          bluetoothSessionTitle.textContent = "对方已断线";
          bluetoothSessionDetail.textContent = "等待蓝牙连接恢复后，可以再次发起邀请。";
          bluetoothRematchTimer.hidden = true;
          bluetoothRematchRequestButton.hidden = true;
          bluetoothRematchAcceptButton.hidden = true;
          bluetoothRematchDeclineButton.hidden = true;
        });
      } else if (previousState === "CONNECTED") {
        bluetooth.localDisconnectStartedAt = Date.now();
        bluetooth.localDisconnectPlayerId = detail.adapterEnabled === false
          ? (bluetooth.role === "host" ? BLUETOOTH_HOST_PLAYER : BLUETOOTH_GUEST_PLAYER)
          : (bluetooth.role === "host" ? BLUETOOTH_GUEST_PLAYER : BLUETOOTH_HOST_PLAYER);
        pauseBluetoothUiClocks();
      }
      if (!awaitingRematch && bluetooth.role === "host" && bluetooth.hostRoom && bluetooth.localDisconnectPlayerId) {
        bluetooth.hostRoom.disconnect(bluetooth.localDisconnectPlayerId);
        refreshBluetoothHostViews(false);
      }
      const message = detail.adapterEnabled === false
        ? "请开启蓝牙；断线累计计时仍在继续。"
        : detail.detail || "蓝牙连接已断开，当前对局已暂停并自动重连。";
      setBluetoothStatus(message);
      if (!awaitingRematch) renderDisconnectLayer();
    } else if ((detail.state === "DISCONNECTED" || detail.state === "ERROR") && !wasEstablished) {
      const failure = detail.detail || (detail.state === "ERROR" ? "蓝牙连接失败，请重试。" : "已停止蓝牙连接。");
      bluetooth.lastFailure = failure;
      setBluetoothStatus(failure);
      showBluetoothSessionState({
        kicker: bluetooth.role === "host" ? "创建对局" : "加入对局",
        title: detail.state === "ERROR" ? "连接失败" : "连接已停止",
        deviceName: bluetooth.role === "host" ? bluetooth.localDeviceName : bluetooth.targetName,
        detail: failure,
        retry: detail.state === "ERROR",
        cancel: false,
        back: true,
      });
    }
  } else if ((detail.event === "message" || detail.type === "message") && detail.message) {
    handleIncomingBluetoothMessage(typeof detail.message === "string" ? detail.message : JSON.stringify(detail.message));
  } else if (detail.type === "permission-granted") {
    renderBluetoothAvailability();
    showToast("蓝牙权限已允许");
  } else if (detail.type === "permission-denied") {
    bluetoothStateActions.hidden = false;
    bluetoothPermissionButton.hidden = Boolean(detail.permanentlyDenied);
    bluetoothAppSettingsButton.hidden = !detail.permanentlyDenied;
    setBluetoothStatus(detail.permanentlyDenied
      ? "蓝牙权限已被永久拒绝，请前往系统设置重新允许。"
      : "蓝牙权限未允许；可以再次尝试授权。");
  } else if (detail.type === "transport-error") {
    const message = detail.detail ?? "无法使用蓝牙，请检查系统权限。";
    if (bluetooth && !bluetooth.everConnected) {
      bluetooth.lastFailure = message;
      setBluetoothStatus(message);
      showBluetoothSessionState({
        kicker: bluetooth.role === "host" ? "创建对局" : "加入对局",
        title: "连接失败",
        deviceName: bluetooth.role === "host" ? bluetooth.localDeviceName : bluetooth.targetName,
        detail: message,
        retry: true,
        cancel: false,
        back: true,
      });
    } else {
      showToast(message);
    }
  }
}) as EventListener);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !bluetoothLobbyView.hidden && !bluetooth) renderBluetoothAvailability();
});

(window as unknown as { handleLeziBack: () => boolean }).handleLeziBack = handleSystemBack;

const GAME_MODE_PREFERENCE_KEY = "lezi-base-game-mode";
let selectedGameMode: GameModeId = "jieqi";
try { selectedGameMode = normalizeGameMode(localStorage.getItem(GAME_MODE_PREFERENCE_KEY) ?? undefined); } catch { /* Invalid preferences use the existing mode. */ }

function renderGameModeSetting(): void {
  element<HTMLSelectElement>("game-mode-setting").value = selectedGameMode;
  const mode = GAME_MODES[selectedGameMode];
  element<HTMLElement>("game-mode-status").textContent = `${mode.description}${mode.featuresReady ? "" : " 英雄与畸变保留，独立适配完成后开放完整对局；当前可预览基础开局。"}`;
}

function showBaseModePreview(): void {
  const mode = GAME_MODES[selectedGameMode];
  const { state } = createInitialGame(undefined, selectedGameMode);
  showDialog(`${mode.name} · 基础开局`, `${mode.description}${mode.featuresReady ? " 此处只展示开局，不进行对局。" : " 英雄与畸变尚待独立适配，完整对局暂未开放。"}`, "关闭预览", () => undefined);
  flowDialog.classList.add("mode-preview-dialog");
  const table = document.createElement("table");
  table.id = "game-mode-preview-board";
  table.setAttribute("aria-label", `${mode.name}基础棋局预览`);
  table.style.cssText = "width:100%;table-layout:fixed;border-collapse:collapse;font-size:16px;text-align:center";
  for (let y = 0; y < 10; y += 1) {
    const row = table.insertRow();
    for (let x = 0; x < 9; x += 1) {
      const cell = row.insertCell();
      cell.dataset.x = String(x); cell.dataset.y = String(y);
      cell.style.cssText = "height:22px;padding:0;border:1px solid rgba(45,26,20,.2)";
      const piece = state.pieces.find(p => isBoardPiece(p) && p.x === x && p.y === y);
      if (!piece) continue;
      cell.dataset.faceDown = String(piece.faceDown);
      cell.textContent = piece.faceDown ? "暗" : pieceLabel[piece.color][piece.type];
      if (!piece.faceDown) cell.style.color = piece.color === "red" ? "#9b3028" : "#283c56";
    }
  }
  const extra = element<HTMLElement>("dialog-extra"); extra.append(table); extra.hidden = false;
}

applyUiPreferences(loadUiPreferences());
showMainMenu();

function openHeroAbility(ability: HeroAbilityCommand["ability"]): void {
  if (!gameState || gameState.status !== "playing") return;
  if (!["invoke", "destruction", "rewind", "hourglass", "bomb", "timeline_twist", "shadow"].includes(ability)) return openTransferredHeroAbility(ability);
  const controls = document.createElement("div");
  const piece = document.createElement("select");
  piece.setAttribute("aria-label", "技能对象");
  const ownWind = bluetooth ? bluetooth.view?.ownHeroSecrets?.wind : localPrivateViewerSide === gameState.turn ? gameSecret?.wind?.[gameState.turn] : undefined;
  const eligible = ability === "shadow"
    ? getShadowRevealedTargets(gameState, gameState.turn, ownWind?.hostId ?? ownWind?.decoyId)
    : ability === "bomb" ? getBombers(gameState, gameState.turn) : [];
  if (ability === "shadow") piece.add(new Option("随机己方真实阵营暗子", "random_covered"));
  for (const p of eligible) piece.add(new Option(`${p.faceDown ? "暗棋" : pieceLabel[p.color][p.type]} (${p.x},${p.y})`, p.id));
  if (ability === "shadow" || ability === "bomb") controls.append(piece);
  const x = document.createElement("input"), y = document.createElement("input");
  for (const [input, name, max] of [[x, "目标列（0–8）", 8], [y, "目标行（0–9）", 9]] as const) { input.type = "number"; input.min = "0"; input.max = String(max); input.value = "0"; input.setAttribute("aria-label", name); }
  if (ability === "bomb" || ability === "timeline_twist") controls.append(x, y);
  const detail = { invoke: "消耗整个正式行动，推进祈求。", unspeakable: "讳言在降临时自动结算。", destruction: "各非将帅棋独立50%毁灭；受将发动还会清除剩余己方明棋，然后结束回合。", rewind: "恢复上一己方行动前快照，并由同一棋重走。", hourglass: "依次回归/复活、结算落位、清除扭曲、补充无限龙弹药。", bomb: "选一名无限龙及距离3内目标格。", timeline_twist: "退回对手上一俗手的同一枚棋，再操控到指定落点。", shadow: "秘密选定承载者，己方正式行动继续。" };
  showDialog("英雄技能", detail[ability], "发动", () => {
    const command: HeroAbilityCommand = { kind: "hero_ability", ability, expectedRevision: gameState!.revision, actionId: nextActionId(), ...(piece.value && piece.value !== "random_covered" ? { pieceId: piece.value } : {}), ...(piece.value === "random_covered" ? { randomCovered: true } : {}), ...(ability === "bomb" || ability === "timeline_twist" ? { to: { x: Number(x.value), y: Number(y.value) } } : {}) };
    if (bluetooth) { handleBluetoothAction({ kind: "hero_ability", command }); return; }
    if (!gameSecret) return;
    try {
      gameSecret.traps = structuredClone(localTraps);
      const previousSide = gameState!.turn;
      const result = applyHeroAbility(gameState!, gameSecret, command);
      gameState = result.state; gameSecret = result.secret; localTraps = gameSecret.traps ?? [];
      if (gameSecret.replay) selectedPieceId = gameSecret.replay.pieceId;
      if (previousSide !== gameState.turn) startFormalClock(gameState, Date.now(), gameSecret);
      renderGame();
      if (gameState.status === "execution") beginAutomaticExecution();
      if (gameState.status === "finished") showMatchResult();
      else if (previousSide !== gameState.turn) localGameHandoff();
    } catch (error) { showToast(error instanceof RuleError ? error.message : "技能结算失败"); }
  });
  dialogText.append(controls);
}
function localGameHandoff(): void {
  if (bluetooth || !gameState || gameState.status !== "playing") return;
  localPrivateViewerSide = undefined;
  renderGame();
  showDialog("请交给下一位玩家", `请将设备交给${gameState.turn === "red" ? "红方" : "蓝方"}。上一位玩家的秘密信息已清除。`, "已接手", () => {
    localPrivateViewerSide = gameState?.turn;
    renderGame();
  });
}

function runTransferredHeroCommand(command: HeroAbilityCommand): void {
  if (!gameState) return;
  if (bluetooth) { handleBluetoothAction({ kind: "hero_ability", command }); return; }
  if (!gameSecret || localPrivateViewerSide !== gameState.turn) return showToast("请先由当前玩家接手设备。");
  try {
    gameSecret.traps = structuredClone(localTraps);
    const previousSide = gameState.turn, previousClock = gameState.turnDeadlineAt;
    const result = applyHeroAbility(gameState, gameSecret, command);
    gameState = result.state; gameSecret = result.secret; localTraps = gameSecret.traps ?? [];
    selectedPieceId = undefined;
    if (previousSide !== gameState.turn || previousClock === undefined && !gameState.pendingShuffle) startFormalClock(gameState, Date.now(), gameSecret);
    renderGame();
    if (gameState.status === "execution") beginAutomaticExecution();
    else if (gameState.status === "finished") showMatchResult();
    else if (previousSide !== gameState.turn) localGameHandoff();
  } catch (error) { showToast(error instanceof RuleError ? error.message : "技能结算失败"); }
}
function renderTransferredHeroControls(): void {
  let panel = document.getElementById("transferred-hero-controls");
  if (!panel) { panel = document.createElement("section"); panel.id = "transferred-hero-controls"; panel.setAttribute("aria-label", "英雄结算与私有信息"); panel.style.cssText = "padding:8px;max-height:22vh;overflow:auto"; gameView.append(panel); }
  panel.replaceChildren(); panel.hidden = true;
  if (!gameState) return;
  const prepSide = bluetooth?.view?.phase === "hero_preparation" ? bluetooth.view.viewerSide : localPreparationActive ? trapSetupSide : undefined;
  const side = prepSide ?? gameState.turn;
  const hero = gameState.featureRules?.heroes?.[side];
  const own = bluetooth ? bluetooth.view?.viewerSide === side : prepSide ? true : localPrivateViewerSide === side;
  if (!own) return;
  const addButton = (text: string, click: () => void) => { const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.disabled = Boolean(bluetooth?.pendingAction); b.onclick = click; panel!.append(b); panel!.hidden = false; };
  if (prepSide && (hero === "single_blade" || hero === "sky_admiral")) {
    panel.hidden = false;
    const select = document.createElement("select"); select.setAttribute("aria-label", hero === "single_blade" ? "公开刃侧" : "征兵兵种");
    const runtime = gameState.heroRuntime?.[side], ready = hero === "single_blade" ? runtime?.blade : runtime?.trainingType;
    if (!ready) {
      for (const [value, label] of hero === "single_blade" ? [["left","左刃"],["right","右刃"]] : [["pawn","兵/卒"],["advisor","士/仕"],["elephant","相/象"],["horse","马"],["cannon","炮"],["rook","车"]]) select.add(new Option(label,value));
      panel.append(select);
      addButton("确定英雄准备选项", () => {
        const choice = hero === "single_blade" ? { blade: select.value as "left" | "right" } : { trainingType: select.value as PieceType };
        if (bluetooth) return handleBluetoothAction({ kind: "hero_preparation_choice", ...choice });
        try { configureHeroPreparation(gameState!, gameSecret!, side, choice); renderGame(); } catch (e) { showToast(e instanceof RuleError ? e.message : "准备失败"); }
      });
    } else addButton("完成英雄准备", () => { if (bluetooth) handleBluetoothAction({ kind: "preparation_ready" }); else completeLocalHeroPreparation(); });
    return;
  }
  if (openingActive || localPreparationActive || bluetooth?.view?.phase === "hero_intro" || bluetooth?.view?.phase === "hero_preparation" || gameState.status !== "playing") return;
  const pending = gameState.pendingHeroChild, descent = gameState.pendingDescent;
  if (gameState.pendingShuffle) {
    addButton(`洗牌窗口${gameState.pendingShuffle.window}：发动`, () => runTransferredHeroCommand({ kind: "hero_ability", ability: "shuffle", actionId: nextActionId(), expectedRevision: gameState!.revision }));
    addButton("本窗口不发动", () => runTransferredHeroCommand({ kind: "hero_ability", ability: "shuffle", skip: true, actionId: nextActionId(), expectedRevision: gameState!.revision }));
  } else if (descent) addButton(descent.assaultIds ? "结算下一枚风暴元素突袭" : "完成迦拉克隆部署", () => openTransferredHeroAbility(descent.assaultIds ? "storm_assault" : "ascension"));
  else if (pending) {
    const abilities: Array<[HeroAbilityCommand["ability"],string]> = pending.kind === "blade" ? [["blade_shift","顺锋移置"]] : pending.kind === "inner_wave" ? [["wave_move","出河后额外移动"]] : [["charge_move","冲锋·逐"],["charge_attack","冲锋·斩"]];
    for (const [ability,label] of abilities) addButton(label, () => openTransferredHeroAbility(ability));
    addButton("放弃衍生行动", () => runTransferredHeroCommand({ kind: "hero_ability", ability: "skip_child", skip: true, expectedRevision: gameState!.revision, actionId: nextActionId() }));
  }
  const forced = gameState.pieces.find(p => p.layer === "air" && getController(p) === side && gameState!.effectsByPieceId?.[p.id]?.flight?.forcedLanding);
  if (forced) addButton("飞行期限已到：原地降落", () => runTransferredHeroCommand({ kind: "hero_ability", ability: "landing", pieceId: forced.id, expectedRevision: gameState!.revision, actionId: nextActionId() }));
  const secrets = bluetooth ? bluetooth.view?.ownHeroSecrets : { insights: gameSecret?.insights?.[side], training: gameSecret?.training?.[side] };
  if (hero === "night") {
    const p = document.createElement("p"); p.textContent = `瞳力 ${gameState.heroRuntime?.[side]?.pupil ?? 0}｜已成功洞察 ${gameState.heroRuntime?.[side]?.insightCount ?? 0} 次`;
    panel.append(p); panel.hidden = false;
    for (const insight of secrets?.insights ?? []) { const line = document.createElement("p"); line.textContent = `${insight.valid ? "洞察快照" : "历史情报（已失效）"}：第 ${insight.revision} 手时 ${insight.pieceId}，${insight.identity.color === "red" ? "红方" : "黑方"}${pieceLabel[insight.identity.color][insight.identity.type]}`; panel.append(line); }
  }
  if (secrets?.training) { const p = document.createElement("p"); p.textContent = secrets.training.failed ? "征兵无合法候选，培养失败" : `私有受训对象 ${secrets.training.pieceId ?? "无"}｜进度 ${secrets.training.progress}${secrets.training.graduated ? "｜已毕业" : ""}`; panel.append(p); panel.hidden = false; }
  if (hero === "berserker") { const p = document.createElement("p"); p.textContent = `战意 ${gameState.heroRuntime?.[side]?.will ?? 0}｜冲锋次数 ${gameState.heroRuntime?.[side]?.chargeCount ?? 0}`; panel.append(p); panel.hidden = false; }
  if (gameState.heroRuntime?.[side]?.omen) { const p = document.createElement("p"); p.textContent = "降临预兆：对方完成本次回应后，下一己方回合开始自动降临。"; panel.append(p); panel.hidden = false; }
  for (const flyer of gameState.pieces.filter(p => p.layer === "air" && getController(p) === side)) addButton(`选择飞行棋 ${flyer.id}`, () => { selectedPieceId = flyer.id; renderGame(); });
  const riverPieces = gameState.pieces.filter(p => p.layer === "river");
  if (riverPieces.length) { const p = document.createElement("p"); p.textContent = `河道：${riverPieces.map(q => `${q.id} 在第 ${Number(q.river?.cellId) + 1} 路，剩余 ${gameState!.effectsByPieceId?.[q.id]?.riverTurns ?? "—"} 回合`).join("；")}`; panel.append(p); panel.hidden = false; }
}
function openTransferredHeroAbility(ability: HeroAbilityCommand["ability"]): void {
  if (!gameState || gameState.status !== "playing") return;
  const controls = document.createElement("div"), side = gameState.turn, pending = gameState.pendingHeroChild;
  const piece = document.createElement("select"); piece.setAttribute("aria-label", "技能棋子");
  const pool = ability === "insight" ? gameState.pieces.filter(p => p.faceDown) : gameState.pieces.filter(p => getController(p) === side);
  for (const p of pool) piece.add(new Option(`${p.faceDown ? "暗棋" : pieceLabel[p.color][p.type]} ${p.id}${p.layer === "river" ? "（河道）" : `（${p.x},${p.y}）`}`, p.id));
  if (pending) piece.value = pending.pieceId;
  const targetAbilities = ["burning_flame","insight","landing","river_enter","river_move","river_exit","inner_wave","blade_shift","charge_move","charge_attack","wave_move"];
  if (targetAbilities.includes(ability)) controls.append(piece);
  const coordinates = () => {
    const x = document.createElement("input"), y = document.createElement("input");
    for (const [input,name,max] of [[x,"目标列（0–8）",8],[y,"目标行（0–9）",9]] as const) { input.type="number";input.min="0";input.max=String(max);input.value="0";input.setAttribute("aria-label",name); }
    return { x,y };
  };
  const to = coordinates();
  const moving = ["river_move","river_exit","inner_wave","blade_shift","charge_move","charge_attack","wave_move","storm_assault"].includes(ability);
  if (moving) controls.append(to.x,to.y);
  const secret = document.createElement("input"); secret.type="checkbox";
  if (ability === "insight") { const label=document.createElement("label");label.textContent="秘密洞察（费用7+6n，隐藏目标）";label.append(secret);controls.append(label); }
  const skip = document.createElement("input");skip.type="checkbox";
  if (ability === "storm_assault") {const label=document.createElement("label");label.textContent="不使用这枚元素的突袭";label.append(skip);controls.append(label);}
  const rows: Array<{ piece: HTMLSelectElement; to: ReturnType<typeof coordinates> }> = [];
  if (ability === "ascension") {
    const descent=gameState.pendingDescent;
    if (!descent) return;
    const items=descent.variant === "nightmare" ? [undefined,undefined,undefined,undefined] : descent.pieces;
    for (const generated of items) {
      const select=document.createElement("select");select.setAttribute("aria-label","待部署棋子");
      if (generated) select.add(new Option(pieceLabel[side][generated.type],generated.id));
      else { select.add(new Option("不选择此项",""));for(const p of pool.filter(p=>p.faceDown||p.type!=="general"))select.add(new Option(p.id,p.id)); }
      const pos=coordinates();controls.append(select,pos.x,pos.y);rows.push({piece:select,to:pos});
    }
  }
  const names: Partial<Record<HeroAbilityCommand["ability"], string>> = { burning_flame:"燃烧烈焰",insight:"洞察",inner_ghost_burst:"里·纠缠怨念",river_enter:"入河",river_move:"河道横移",river_exit:"出河",inner_wave:"里·清波",landing:"原地降落",blade_shift:"顺锋",charge_move:"冲锋·逐",charge_attack:"冲锋·斩",wave_move:"出河后额外移动",ascension:"迦拉克隆部署",storm_assault:"风暴元素突袭" };
  showDialog(names[ability] ?? "英雄结算", "选择本次技能的对象与落点。非法选择会保留当前棋局和资源，请按技能说明调整。", "确认", () => runTransferredHeroCommand({ kind:"hero_ability",ability,actionId:nextActionId(),expectedRevision:gameState!.revision,...(targetAbilities.includes(ability) && piece.value ? {pieceId:piece.value}:{}),...(moving?{to:{x:Number(to.x.value),y:Number(to.y.value)}}:{}),...(ability==="insight"?{secretInsight:secret.checked}:{}),...(ability==="storm_assault"?{skip:skip.checked}:{}),...(ability==="ascension"?{placements:rows.filter(row=>row.piece.value).map(row=>({pieceId:row.piece.value,to:{x:Number(row.to.x.value),y:Number(row.to.y.value)}}))}:{}) }));
  dialogText.append(controls);
}
