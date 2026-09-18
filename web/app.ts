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
import { getController, otherSide } from "../src/slots.ts";
import {
  MUTATION_IDS,
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
  createBluetoothSnapshot,
  encodeBluetoothEnvelope,
  parseBluetoothEnvelope,
} from "../src/bluetooth-protocol.ts";
import {
  HERO_PREPARATION_DURATION_MS,
  HERO_SELECTION_DURATION_MS,
  type PlayerRemoteRoomView,
} from "../src/remote-room.ts";
import type {
  GameState,
  HeroId,
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
const HERO_IDS: readonly HeroId[] = ["hunter", "rogue", "warrior"];
const heroCatalog: Record<HeroId, { name: string; skills: Array<{ name: string; description: string; fullDescription: string }> }> = {
  hunter: {
    name: "猎人",
    skills: [{
      name: "陷阱",
      description: "战斗准备时在己方半场秘密布置两层陷阱；可放在棋子脚下，也可同格叠加。",
      fullDescription: "英雄入场后进入最多 60 秒的战斗准备。猎人在己方半场秘密布置两层陷阱，可放在棋子脚下或同格叠加。敌方棋子落入时消耗一层并直接死亡；未触发的层在十个敌方正式回合后消失。",
    }],
  },
  rogue: {
    name: "潜行者",
    skills: [
      { name: "刺杀", description: "每局一次，首次可移动到空位并保留强击，或立即强击。", fullDescription: "每局一次，选择己方一枚非将帅明棋：移动到合法空位并保留强击，或立即对合法目标发动强击。两种行动完成后都进入隐身。" },
      { name: "隐身", description: "隐身棋不阻挡、不能被普通吃子，也不触发普通将军。", fullDescription: "隐身持续到下一个己方正式回合结束。隐身棋仍占据落点，但不阻挡路线、不产生攻击和将军，也不能被普通吃子；主动行动或该回合结束后解除。" },
      { name: "强击", description: "直接击杀非将帅目标并清除其全部效果，每次刺杀限一次。", fullDescription: "沿来源棋子的合法移动与吃子几何直接击杀一个非将帅目标，并先清除目标效果。首次行动可立即使用；若移动到空位后保留，则可在下一个己方回合使用。" },
    ],
  },
  warrior: {
    name: "战士",
    skills: [{ name: "盔甲", description: "前两枚离开己方九宫的棋子获得一次防御；将帅另可免疫一次背刺。", fullDescription: "前两枚离开己方九宫的非将帅明棋获得一次防护壁垒，普通吃子会被弹回并消耗壁垒。将帅的铁甲可拦截一次背刺，并给予一次额外应将。" }],
  },
};
const choiceLabel: Record<RpsChoice, string> = { rock: "石头", scissors: "剪刀", paper: "布" };
const pieceLabel = {
  red: { general: "帅", advisor: "仕", elephant: "相", horse: "马", rook: "车", cannon: "炮", pawn: "兵" },
  black: { general: "将", advisor: "士", elephant: "象", horse: "馬", rook: "車", cannon: "砲", pawn: "卒" },
} as const;
const movementLabel = { general: "将帅", advisor: "仕/士", elephant: "相/象", horse: "马", rook: "车", cannon: "炮", pawn: "兵/卒" } as const;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`找不到界面元素：${id}`);
  return found as T;
}

const rpsView = element<HTMLElement>("rps-view");
const lobbyView = element<HTMLElement>("lobby-view");
const heroView = element<HTMLElement>("hero-view");
const gameView = element<HTMLElement>("game-view");
const rpsTitle = element<HTMLElement>("rps-title");
const rpsHelp = element<HTMLElement>("rps-help");
const rpsHistory = element<HTMLElement>("rps-history");
const boardPoints = element<HTMLElement>("board-points");
const boardPlane = document.querySelector<HTMLElement>(".board-plane");
if (!boardPlane) throw new Error("找不到棋盘");
const executionGhost = element<HTMLElement>("execution-ghost");
const terminationEffect = element<HTMLElement>("termination-effect");
const moveHint = element<HTMLElement>("move-hint");
const announcement = element<HTMLElement>("announcement");
const redPlayer = element<HTMLElement>("red-player");
const blackPlayer = element<HTMLElement>("black-player");
const turnStatus = element<HTMLElement>("turn-status");
const redCaptures = element<HTMLElement>("red-captures");
const blackCaptures = element<HTMLElement>("black-captures");
const battleTurnTimer = element<HTMLElement>("battle-turn-timer");
const battleMutationName = element<HTMLElement>("battle-mutation-name");
const capturedPanel = element<HTMLElement>("captured-panel");
const capturedToggle = element<HTMLButtonElement>("captured-toggle");
const battleMoreButton = element<HTMLButtonElement>("battle-more-button");
const battleActionMenu = element<HTMLElement>("battle-action-menu");
const statusBlueHeroName = element<HTMLElement>("status-blue-hero-name");
const statusRedHeroName = element<HTMLElement>("status-red-hero-name");
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
const heroPreparationStatus = element<HTMLElement>("hero-preparation-status");
const heroPreparationTimer = element<HTMLElement>("hero-preparation-timer");
const trapUndoButton = element<HTMLButtonElement>("trap-undo-button");
const preparationConfirmButton = element<HTMLButtonElement>("preparation-confirm-button");

interface BluetoothNativeBridge {
  status(): string;
  pairedDevices(): string;
  host(): void;
  join(address: string): void;
  send(message: string): void;
  disconnect(): void;
}

interface BluetoothEventDetail {
  event?: string;
  type?: string;
  state?: string;
  message?: unknown;
  address?: string;
  detail?: string;
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
let gameState: GameState | undefined;
let gameSecret: SecretState | undefined;
let selectedPieceId: string | undefined;
let latestAnnouncement = "红方先行。点选己方棋子，再点选落点。";
let toastTimer: number | undefined;
let actionSequence = 0;
let executionTimer: number | undefined;
let assassinationArmed = false;
let strongStrikeArmed = false;
let localHeroes: Partial<Record<Side, HeroId>> = {};
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
let battleTurnRevision: number | undefined;
let battleTurnDeadlineAt: number | undefined;
let bluetooth: BluetoothSession | undefined;

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
  glyph.src = glyphAsset(color, type);
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

function randomMutation(): MutationId {
  // Transitional flat draw until the four outer rarity probabilities are confirmed.
  return MUTATION_IDS[randomIndex(MUTATION_IDS.length)];
}

function randomOwnHalfPosition(side: Side): Position {
  const index = randomIndex(45);
  return { x: index % 9, y: (side === "red" ? 5 : 0) + Math.floor(index / 9) };
}

function setBluetoothStatus(message: string): void {
  bluetoothStatus.textContent = message;
}

function showLobby(): void {
  lobbyView.hidden = false;
  heroView.hidden = true;
  rpsView.hidden = true;
  gameView.hidden = true;
  openingSequence.hidden = true;
  const supported = Boolean(nativeBluetooth());
  element<HTMLButtonElement>("bluetooth-host-button").disabled = !supported;
  element<HTMLButtonElement>("bluetooth-refresh-button").disabled = !supported;
  element<HTMLButtonElement>("bluetooth-join-button").disabled = !supported;
  if (!supported) {
    setBluetoothStatus("当前为普通浏览器：可本机试玩。蓝牙双机功能仅在 Android 安装包中可用。");
  } else if (!bluetooth) {
    setBluetoothStatus("两台手机先在系统设置完成蓝牙配对；房主创建后，另一台选择房主设备加入。");
  }
}

function activateLocalGame(): void {
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

  const heroSelectionTimedOut = prior?.phase === "hero_selection"
    && view.phase === "rps"
    && Date.now() >= (prior.features?.heroSelection?.deadlineAt ?? Number.POSITIVE_INFINITY)
    && Boolean(view.ownHeroChoice);
  if (heroSelectionTimedOut) {
    lobbyView.hidden = true;
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
    lobbyView.hidden = true;
    heroView.hidden = false;
    rpsView.hidden = true;
    gameView.hidden = true;
    renderHeroSelection();
  } else if (view.phase === "rps") {
    lobbyView.hidden = true;
    heroView.hidden = true;
    rpsView.hidden = false;
    gameView.hidden = true;
    renderRps();
  } else if (view.state) {
    lobbyView.hidden = true;
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

  if (view.terminalAnimation && bluetooth.playedTerminalEventId !== view.terminalAnimation.eventId) {
    bluetooth.playedTerminalEventId = view.terminalAnimation.eventId;
    playRemoteTerminalAnimation(view.terminalAnimation);
  } else if (view.state?.status === "finished" && prior?.state?.revision !== view.state.revision
    && bluetooth.shownFinishRevision !== view.state.revision) {
    bluetooth.shownFinishRevision = view.state.revision;
    window.setTimeout(() => showDialog(finishTitle(), finishMessage(), "查看棋盘", () => undefined), 50);
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
    showDialog("本局畸变", "本局没有启用畸变。", "关闭", () => undefined);
    return;
  }
  const definition = mutationDefinition(mutation);
  showDialog(
    `本局畸变 · ${MUTATION_RARITY_LABELS[definition.rarity]}`,
    `${definition.name}：${definition.summary}\n\n${definition.rules}`,
    "关闭",
    () => undefined,
  );
}

function sendBluetoothEnvelope<T>(envelope: { v: 1; type: "hello" | "action" | "snapshot" | "error" | "ping" | "pong"; id?: string; payload?: T }): void {
  const bridge = nativeBluetooth();
  if (!bridge) throw new Error("此设备没有蓝牙桥接能力");
  bridge.send(encodeBluetoothEnvelope(envelope));
}

function publishBluetoothViews(): void {
  if (!bluetooth?.hostRoom) return;
  const views = bluetooth.hostRoom.views();
  applyBluetoothView(views.host);
  sendBluetoothEnvelope(createBluetoothSnapshot(`snapshot-${views.publicRoom.updatedAt}-${views.publicRoom.phase}`, views.guest));
}

function handleBluetoothAction(action: BluetoothRoomAction): void {
  if (!bluetooth) return;
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
    sendBluetoothEnvelope({ v: 1, type: "action", id: bluetoothActionId(), payload: action });
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
      try {
        bluetooth.hostRoom!.handle(BLUETOOTH_GUEST_PLAYER, envelope.payload as BluetoothRoomAction);
        publishBluetoothViews();
      } catch (error) {
        const message = error instanceof RuleError ? error.message : "房主拒绝了此操作。";
        sendBluetoothEnvelope({ v: 1, type: "error", id: envelope.id, payload: { message } });
        showToast(message);
      }
    } else if (bluetooth.role === "guest" && envelope.type === "snapshot") {
      applyBluetoothView(envelope.payload as PlayerRemoteRoomView);
    } else if (envelope.type === "error") {
      bluetooth.pendingAction = false;
      const payload = envelope.payload as { message?: string } | undefined;
      showToast(payload?.message ?? "房主拒绝了此操作。");
    } else if (envelope.type === "ping") {
      sendBluetoothEnvelope({ v: 1, type: "pong", id: envelope.id });
    }
  } catch (error) {
    showToast(error instanceof RuleError ? error.message : "收到的蓝牙消息无效。");
  }
}

function beginBluetoothHost(): void {
  const bridge = nativeBluetooth();
  if (!bridge) return showToast("蓝牙双机模式只能在 Android 安装包内使用。");
  bluetooth = {
    role: "host",
    nativeState: "STARTING",
    pendingAction: false,
    trapDraft: [],
  };
  setBluetoothStatus("正在开启房主监听，请让另一台已配对手机选择本机并加入。");
  bridge.host();
}

function joinBluetoothRoom(): void {
  const bridge = nativeBluetooth();
  const address = element<HTMLSelectElement>("bluetooth-device").value;
  if (!bridge) return showToast("蓝牙双机模式只能在 Android 安装包内使用。");
  if (!address) return showToast("请先刷新并选择已配对的房主设备。");
  bluetooth = { role: "guest", nativeState: "CONNECTING", pendingAction: false, trapDraft: [] };
  setBluetoothStatus("正在连接房主设备，请稍候。");
  bridge.join(address);
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
      option.textContent = `${device.name || "未命名设备"} · ${device.address}`;
      return option;
    }));
    if (devices.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "没有已配对设备";
      select.append(option);
    }
    setBluetoothStatus(`已读取 ${devices.length} 台已配对设备。`);
  } catch {
    showToast("读取已配对设备失败，请检查蓝牙权限。");
  }
}

function resetMatch(): void {
  const session = createRpsState(PLAYER_ONE, PLAYER_TWO);
  rpsPublic = session.publicState;
  rpsSecret = session.secretState;
  rpsActor = PLAYER_ONE;
  gameState = undefined;
  gameSecret = undefined;
  selectedPieceId = undefined;
  assassinationArmed = false;
  strongStrikeArmed = false;
  localHeroes = {};
  localHeroChoices = {};
  localHeroConfirmed = { [PLAYER_ONE]: false, [PLAYER_TWO]: false };
  localHeroActor = PLAYER_ONE;
  heroDraft = undefined;
  activeSkillIndex = 0;
  heroSelectionDeadlineAt = undefined;
  localTraps = [];
  trapSetupQueue = [];
  trapSetupSide = undefined;
  localTrapDraft = [];
  heroPreparationDeadlineAt = undefined;
  localPreparationActive = false;
  openingActive = false;
  battleTurnRevision = undefined;
  battleTurnDeadlineAt = undefined;
  if (executionTimer) window.clearTimeout(executionTimer);
  if (openingTimer) window.clearTimeout(openingTimer);
  executionTimer = undefined;
  openingTimer = undefined;
  executionGhost.hidden = true;
  executionGhost.className = "execution-ghost";
  terminationEffect.className = "termination-effect";
  capturedPanel.classList.remove("expanded");
  capturedToggle.setAttribute("aria-expanded", "false");
  battleActionMenu.hidden = true;
  battleMoreButton.setAttribute("aria-expanded", "false");
  lobbyView.hidden = true;
  heroView.hidden = true;
  rpsView.hidden = true;
  gameView.hidden = true;
}

function beginLocalHeroSelection(): void {
  localHeroActor = PLAYER_ONE;
  heroSelectionDeadlineAt = Date.now() + HERO_SELECTION_DURATION_MS;
  lobbyView.hidden = true;
  heroView.hidden = false;
  rpsView.hidden = true;
  gameView.hidden = true;
  renderHeroSelection();
}

function showDialog(title: string, text: string, actionLabel: string, action: () => void): void {
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
  heroSelectionTimer.textContent = String(remaining);
  heroSelectionTimer.classList.toggle("urgent", remaining <= 10);
  heroOpponentStatus.textContent = state.opponentConfirmed ? "对方已确定" : "对方选择中";
  heroConfirmButton.textContent = state.confirmed ? "已确定" : "确定";
  heroConfirmButton.disabled = state.confirmed || !selected || Boolean(bluetooth?.pendingAction);

  if (!selected) {
    heroSelectionName.textContent = "请选择英雄";
    heroDetailAvatar.dataset.hero = "";
    heroSkillList.replaceChildren();
    heroSkillDescription.textContent = "选择下方英雄后查看技能。";
  } else {
    const hero = heroCatalog[selected];
    heroSelectionName.textContent = hero.name;
    heroDetailAvatar.dataset.hero = selected;
    activeSkillIndex = Math.min(activeSkillIndex, hero.skills.length - 1);
    heroSkillList.replaceChildren(...hero.skills.map((skill, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `hero-skill-button${index === activeSkillIndex ? " active" : ""}`;
      button.innerHTML = `<i aria-hidden="true">◌</i><span>${skill.name}</span>`;
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
  }

  heroGrid.replaceChildren(...HERO_IDS.map((heroId) => {
    const hero = heroCatalog[heroId];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hero-grid-item${selected === heroId ? " selected" : ""}`;
    button.disabled = state.confirmed;
    button.innerHTML = `<span class="hero-art-placeholder grid-avatar" aria-hidden="true"><span>形象<br>待绘</span></span><span class="hero-grid-name${hero.name.length > 4 ? " long-name" : ""}">${hero.name}</span>`;
    button.setAttribute("aria-label", `选择${hero.name}`);
    button.addEventListener("click", () => {
      if (state.confirmed) return;
      heroDraft = heroId;
      activeSkillIndex = 0;
      renderHeroSelection();
    });
    return button;
  }));
}

function confirmHeroSelection(): void {
  if (!heroDraft) return;
  if (bluetooth?.view?.phase === "hero_selection") {
    handleBluetoothAction({ kind: "hero", hero: heroDraft });
    return;
  }
  localHeroChoices[localHeroActor] = heroDraft;
  localHeroConfirmed[localHeroActor] = true;
  if (localHeroConfirmed[PLAYER_ONE] && localHeroConfirmed[PLAYER_TWO]) {
    beginLocalRps();
    return;
  }
  const completed = localHeroActor;
  localHeroActor = completed === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE;
  heroDraft = undefined;
  activeSkillIndex = 0;
  showDialog("英雄已确定", `请将设备交给${localHeroActor}继续选择英雄。`, `${localHeroActor}已接手`, renderHeroSelection);
  renderHeroSelection();
}

function handleLocalHeroSelectionTimeout(): void {
  if (heroSelectionDeadlineAt === undefined) return;
  heroSelectionDeadlineAt = undefined;
  for (const player of [PLAYER_ONE, PLAYER_TWO]) {
    if (!localHeroConfirmed[player]) localHeroChoices[player] = randomHero();
    localHeroConfirmed[player] = true;
  }
  heroDraft = localHeroChoices[localHeroActor];
  renderHeroSelection();
  if (flowDialog.open) flowDialog.close();
  showToast(`选择超时，系统已为未确认玩家随机英雄。`);
  window.setTimeout(beginLocalRps, 800);
}

function beginLocalRps(): void {
  if (flowDialog.open) flowDialog.close();
  heroSelectionDeadlineAt = undefined;
  heroView.hidden = true;
  rpsView.hidden = false;
  gameView.hidden = true;
  rpsActor = PLAYER_ONE;
  renderRps();
}

function renderRps(): void {
  const tie = rpsPublic.lastResult?.tie;
  if (bluetooth?.view?.phase === "rps") {
    const submitted = bluetooth.view.rps?.submitted ?? {};
    const own = ownBluetoothPlayerId();
    const ownSubmitted = own ? Boolean(submitted[own]) : false;
    rpsTitle.textContent = ownSubmitted ? "出拳已锁定" : "请秘密出拳";
    rpsHelp.textContent = ownSubmitted
      ? `第 ${rpsPublic.round} 轮：已发送，等待对方出拳。`
      : `第 ${rpsPublic.round} 轮：双方各自在自己的手机上秘密出拳，胜者执红先走。`;
    rpsHistory.textContent = tie && rpsPublic.lastResult
      ? `上一轮平局：双方再次出拳。`
      : "";
    document.querySelectorAll<HTMLButtonElement>(".rps-choice").forEach((button) => { button.disabled = ownSubmitted || Boolean(bluetooth.pendingAction); });
    return;
  }
  rpsTitle.textContent = `${rpsActor}，请秘密出拳`;
  rpsHelp.textContent = rpsActor === PLAYER_ONE
    ? `第 ${rpsPublic.round} 轮：选择后把设备交给${PLAYER_TWO}。胜者执红并先走。`
    : `第 ${rpsPublic.round} 轮：${PLAYER_ONE} 已锁定选择。请出拳，随后揭晓。`;
  rpsHistory.textContent = tie && rpsPublic.lastResult
    ? `上一轮平局：${PLAYER_ONE}${choiceLabel[rpsPublic.lastResult.choices[PLAYER_ONE]]}，${PLAYER_TWO}${choiceLabel[rpsPublic.lastResult.choices[PLAYER_TWO]]}。`
    : "";
}

function submitChoice(choice: RpsChoice): void {
  if (bluetooth?.view?.phase === "rps") {
    handleBluetoothAction({ kind: "rps", choice, round: bluetooth.view.rps!.round });
    return;
  }
  const beforeRound = rpsPublic.round;
  const result = submitRpsChoice(rpsPublic, rpsSecret, rpsActor, choice, beforeRound);
  rpsPublic = result.publicState;
  rpsSecret = result.secretState;

  if (rpsPublic.status === "resolved") {
    const resolved = rpsPublic.lastResult!;
    const winner = resolved.winner!;
    const summary = `${PLAYER_ONE}出${choiceLabel[resolved.choices[PLAYER_ONE]]}，${PLAYER_TWO}出${choiceLabel[resolved.choices[PLAYER_TWO]]}。${winner}获胜，执红先走。`;
    showDialog("先手已决定", summary, "开始对局", startGame);
    return;
  }

  if (rpsPublic.round > beforeRound) {
    const tie = rpsPublic.lastResult!;
    const summary = `${PLAYER_ONE}出${choiceLabel[tie.choices[PLAYER_ONE]]}，${PLAYER_TWO}出${choiceLabel[tie.choices[PLAYER_TWO]]}。平局，再来一轮。`;
    showDialog("平局", summary, "下一轮", () => {
      rpsActor = PLAYER_ONE;
      renderRps();
    });
    return;
  }

  showDialog("选择已锁定", `请将设备交给${PLAYER_TWO}，不要让${PLAYER_ONE}看到对方的选择。`, `${PLAYER_TWO}已接手`, () => {
    rpsActor = PLAYER_TWO;
    renderRps();
  });
}

function startGame(): void {
  const session = createInitialGame();
  const assignments = rpsPublic.assignments!;
  const redHero = localHeroChoices[assignments.red];
  const blackHero = localHeroChoices[assignments.black];
  if (!redHero || !blackHero) return showToast("双方英雄选择不完整，请重新开始。");
  const mutation = randomMutation();
  localHeroes = {
    red: redHero,
    black: blackHero,
  };
  gameState = initializeFeatureGameState(
    session.state,
    localHeroes,
    mutation,
  );
  gameSecret = session.secret;
  selectedPieceId = undefined;
  assassinationArmed = false;
  strongStrikeArmed = false;
  localTraps = [];
  trapSetupQueue = [];
  trapSetupSide = undefined;
  localTrapDraft = [];
  localPreparationActive = false;
  heroPreparationDeadlineAt = undefined;
  latestAnnouncement = `${rpsPublic.assignments!.red}执红，红方先行。`;
  heroView.hidden = true;
  rpsView.hidden = true;
  gameView.hidden = false;
  renderGame();
  runOpeningSequence(beginLocalHeroPreparation);
}

function battleHeroes(): Record<Side, HeroId> | undefined {
  const remote = bluetooth?.view?.features?.heroes;
  if (remote) return remote;
  if (localHeroes.red && localHeroes.black) return { red: localHeroes.red, black: localHeroes.black };
  return undefined;
}

function setBattleHeroAvatars(heroes: Record<Side, HeroId>, visible: boolean): void {
  for (const side of ["red", "black"] as const) {
    const avatar = element<HTMLElement>(`${side}-hero-avatar`);
    avatar.hidden = !visible;
    avatar.dataset.hero = heroes[side];
    avatar.title = heroCatalog[heroes[side]].name;
  }
}

function runOpeningSequence(onComplete: () => void): void {
  const heroes = battleHeroes();
  const mutation = bluetooth?.view?.features?.mutation ?? gameState?.featureRules?.mutation;
  if (!heroes) return onComplete();
  openingActive = true;
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
  if (openingTimer) window.clearTimeout(openingTimer);
  openingTimer = window.setTimeout(() => {
    mutationReveal.hidden = true;
    const blackHero = element<HTMLElement>("intro-black-hero");
    const redHero = element<HTMLElement>("intro-red-hero");
    blackHero.querySelector("b")!.textContent = heroCatalog[heroes.black].name;
    redHero.querySelector("b")!.textContent = heroCatalog[heroes.red].name;
    heroIntroStage.hidden = false;
    heroIntroStage.classList.add("playing");
    openingTimer = window.setTimeout(() => {
      heroIntroStage.classList.remove("playing");
      heroIntroStage.hidden = true;
      openingSequence.hidden = true;
      openingActive = false;
      setBattleHeroAvatars(heroes, true);
      openingTimer = undefined;
      onComplete();
    }, 2_000);
  }, 1_200);
}

function beginLocalHeroPreparation(): void {
  trapSetupQueue = (["red", "black"] as const).filter((side) => localHeroes[side] === "hunter");
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
    "猎人需要在己方半场布置两层陷阱；可以同格叠加，也可放在棋子脚下。",
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
    opponentTurnsRemaining: 10,
  }));
}

function completeLocalHeroPreparation(): void {
  if (!localPreparationActive || !trapSetupSide) return;
  if (localTrapDraft.length !== 2) return showToast("请先布置完两层陷阱。");
  const completedSide = trapSetupSide;
  commitLocalTrapDraft(completedSide);
  trapSetupSide = trapSetupQueue.shift();
  localTrapDraft = [];
  if (!trapSetupSide) {
    finishLocalHeroPreparation();
    return;
  }
  renderGame();
  showDialog(
    `${completedSide === "red" ? "红方" : "蓝方"}准备完成`,
    `请将设备交给${trapSetupSide === "red" ? "红方" : "蓝方"}猎人继续准备。`,
    "继续准备",
    renderGame,
  );
}

function handleLocalPreparationTimeout(): void {
  if (!localPreparationActive) return;
  if (trapSetupSide) {
    while (localTrapDraft.length < 2) localTrapDraft.push(randomOwnHalfPosition(trapSetupSide));
    commitLocalTrapDraft(trapSetupSide);
  }
  if (flowDialog.open) flowDialog.close();
  for (const side of trapSetupQueue) {
    localTrapDraft = [randomOwnHalfPosition(side), randomOwnHalfPosition(side)];
    commitLocalTrapDraft(side);
  }
  showToast("准备时间结束，系统已随机补齐剩余陷阱。");
  finishLocalHeroPreparation();
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

function updateVisibleTimers(): void {
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
  const waitingForOpening = openingActive
    || localPreparationActive
    || bluetooth?.view?.phase === "hero_intro"
    || bluetooth?.view?.phase === "hero_preparation";
  if (gameState.status !== "playing" || waitingForOpening) {
    battleTurnDeadlineAt = undefined;
    battleTurnRevision = undefined;
    battleTurnTimer.textContent = gameState.status === "finished" ? "0" : "60";
    battleTurnTimer.classList.remove("urgent");
    return;
  }
  if (battleTurnRevision !== gameState.revision || battleTurnDeadlineAt === undefined) {
    battleTurnRevision = gameState.revision;
    battleTurnDeadlineAt = Date.now() + NORMAL_FORMAL_TURN_DURATION_MS;
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
  const activeStealth = selectedPieceId && gameState.assassination?.[gameState.turn]?.activePieceId === selectedPieceId;
  const usingAssassination = Boolean(selectedPieceId && (assassinationArmed || activeStealth));
  const legalMoves = selectedPieceId
    ? usingAssassination
      ? getLegalAssassinationMoves(gameState, selectedPieceId, strongStrikeArmed)
      : getLegalMoves(gameState, selectedPieceId)
    : [];
  const legalKeys = new Set(legalMoves.map(positionKey));
  const pieces = new Map(gameState.pieces.map((piece) => [positionKey(piece), piece]));
  const lastMove = gameState.lastMove;
  const executionPlan = gameState.status === "execution"
    ? getAutomaticExecutionPlan(gameState)
    : undefined;
  const visibleTrapPositions = bluetooth?.view
    ? bluetooth.view.phase === "hero_preparation"
      ? (bluetooth.view.ownTrapDraft ?? bluetooth.trapDraft)
      : (bluetooth.view.ownTraps ?? []).map((trap) => trap.position)
    : localPreparationActive ? localTrapDraft : [];
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
      const piece = pieces.get(key);
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
        const badge = effects?.stealth ? "隐" : effects?.barrier ? "盾" : effects?.cavalry ? "骑" : undefined;
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

function renderCaptures(container: HTMLElement, side: Side): void {
  if (!gameState) return;
  const captured = gameState.captured.filter((piece) => piece.capturedBy === side);
  if (captured.length === 0) {
    container.innerHTML = '<span class="empty-captures">尚无</span>';
    return;
  }
  container.replaceChildren(...captured.map((piece) => {
    const token = document.createElement("span");
    token.className = `captured-token ${piece.color}`;
    token.style.setProperty("--ring-url", `url("${ringAsset(stableRingIndex(piece.id))}")`);
    token.append(createPieceGlyph(piece.color, piece.type));
    token.title = `${piece.color === "red" ? "红" : "黑"}${pieceLabel[piece.color][piece.type]}`;
    return token;
  }));
}

function finishMessage(): string {
  if (gameState?.drawReason === "mutual_destruction") return "双方将帅同归于尽，两败俱伤！";
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
    return "您已战败。";
  }
  if (reason === "ambush") return "暗中潜行，破影而袭！您获得胜利！";
  if (reason === "checkmate") return "圣光的正义终结了敌人！您获得胜利！";
  if (reason === "stalemate") return "对方已无路可走。您获得胜利！";
  if (reason === "resign") return "对方已臣服于您，获得胜利！";
  if (reason === "trap_ambush") return "猎物已踏入陷阱！伏击得手，您获得胜利！";
  if (reason === "crush_them") return "碾碎他们！您获得胜利！";
  if (reason === "rampage") return "误伤己方将帅，乱杀失败！";
  return "您获得胜利！";
}

function finishTitle(): string {
  if (!gameState?.reason) return "对局结束";
  return { ambush: "背刺", checkmate: "裁决", stalemate: "无处可逃", resign: "臣服", trap_ambush: "伏击", crush_them: "碾碎他们！", rampage: "乱杀失败" }[gameState.reason];
}

function renderGame(): void {
  if (!gameState || !rpsPublic.assignments) return;
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
  statusBlueHeroName.textContent = heroes?.black ? heroCatalog[heroes.black].name : "英雄";
  statusRedHeroName.textContent = heroes?.red ? heroCatalog[heroes.red].name : "英雄";
  if (heroes) {
    element<HTMLElement>("black-hero-avatar").dataset.hero = heroes.black;
    element<HTMLElement>("red-hero-avatar").dataset.hero = heroes.red;
  }
  const mutation = remoteView?.features?.mutation ?? gameState.featureRules?.mutation;
  battleMutationName.textContent = mutation ? mutationName(mutation) : "无畸变";
  battleMutationName.parentElement?.setAttribute("aria-label", mutation ? `查看本局畸变：${mutationName(mutation)}` : "查看本局畸变");
  heroPreparationPanel.hidden = !preparationActive;
  if (preparationActive) {
    const remaining = secondsRemaining(preparationDeadline);
    heroPreparationTimer.textContent = String(remaining);
    heroPreparationTimer.classList.toggle("urgent", remaining <= 10);
    const canPrepare = remotePreparation ? remoteIsHunter && !remoteReady : Boolean(trapSetupSide);
    const sideLabel = remotePreparation
      ? remoteSide === "red" ? "红方" : "蓝方"
      : trapSetupSide === "red" ? "红方" : "蓝方";
    turnStatus.innerHTML = `<b>战斗准备</b><span>${canPrepare ? `${sideLabel}陷阱 ${preparationDraft.length} / 2` : "等待对方"}</span>`;
    announcement.textContent = canPrepare ? "在己方半场布置两层陷阱；可同格叠加，也可放在棋子脚下。" : "你的英雄无需操作或已经完成，正在等待对方准备。";
    moveHint.textContent = canPrepare
      ? preparationDraft.length < 2 ? `还需布置 ${2 - preparationDraft.length} 层陷阱。` : "陷阱已布置完成，点击“完成准备”锁定。"
      : "对方准备完成后将自动开始正式行棋。";
    heroPreparationStatus.textContent = canPrepare
      ? `陷阱 ${preparationDraft.length}/2｜对方${remotePreparation && remoteSide ? remoteView.features?.heroPreparation?.ready[otherSide(remoteSide)] ? "已完成" : "准备中" : "准备中"}`
      : "已完成，等待对方";
    trapUndoButton.hidden = !canPrepare;
    preparationConfirmButton.hidden = !canPrepare;
    trapUndoButton.disabled = preparationDraft.length === 0 || Boolean(bluetooth?.pendingAction);
    preparationConfirmButton.disabled = preparationDraft.length !== 2 || Boolean(bluetooth?.pendingAction);
  } else if (openingActive || remoteView?.phase === "hero_intro") {
    turnStatus.innerHTML = `<b>英雄入场</b><span>准备阶段尚未开始</span>`;
    announcement.textContent = "本局畸变与双方英雄正在公布。";
    moveHint.textContent = "动画结束、英雄头像落位后开始战斗准备。";
  } else if (gameState.status === "finished") {
    turnStatus.innerHTML = `<b>对局结束</b><span>第 ${gameState.revision} 手</span>`;
    announcement.textContent = finishMessage();
    moveHint.textContent = "可以重新开始，再进行一局猜拳。";
  } else if (gameState.status === "execution") {
    const title = finishTitle();
    turnStatus.innerHTML = `<b>${title}发动</b><span>终结演出中</span>`;
    announcement.textContent = "胜负已定，终结正在执行。";
    moveHint.textContent = "棋盘已锁定，终结动画播放完毕后公布结果。";
  } else {
    const player = rpsPublic.assignments[gameState.turn];
    turnStatus.innerHTML = `<b>${gameState.turn === "red" ? "红方" : "蓝方"}行棋</b><span>${player} · 第 ${gameState.revision + 1} 手</span>`;
    const inCheck = isGeneralInCheck(gameState, gameState.turn);
    announcement.textContent = inCheck ? `${gameState.turn === "red" ? "红帅" : "黑将"}正在被将军，必须应将。` : latestAnnouncement;
    moveHint.textContent = selectedPieceId ? descriptionForPiece(selectedPieceId) : "点选当前方控制的棋子，再点选绿色落点。";
  }
  renderBoard();
  renderCaptures(redCaptures, "red");
  renderCaptures(blackCaptures, "black");
  const remoteLocked = Boolean(bluetooth?.pendingAction) || (Boolean(remoteView) && remoteView?.viewerSide !== gameState.turn);
  element<HTMLButtonElement>("resign-button").disabled = gameState.status !== "playing" || preparationActive || openingActive || remoteView?.phase === "hero_intro" || remoteLocked;
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
  strongButton.disabled = gameState.status !== "playing" || preparationActive || openingActive || remoteView?.phase === "hero_intro" || remoteLocked || !(activeStrikeAvailable || assassinationArmed);
  strongButton.textContent = strongStrikeArmed ? "强击：请选择目标" : "发动强击";
  updateBattleTurnTimer();
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
      showDialog(finishTitle(), finishMessage(), "查看棋盘", () => undefined);
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
    showDialog(finishTitle(), finishMessage(), "查看棋盘", () => undefined);
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
    showDialog(finishTitle(), finishMessage(), "查看棋盘", () => undefined);
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
  if (!gameState || !gameSecret?.processedActions || !gameState.lastMove) return undefined;
  const lastMove = gameState.lastMove;
  const landed = lastMove.landed !== false
    ? gameState.pieces.find((piece) => piece.id === lastMove.pieceId)
    : undefined;
  const index = landed && getController(landed) === lastMove.actingSide
    ? localTraps.findIndex((trap) => trap.owner !== lastMove.actingSide && trap.position.x === landed.x && trap.position.y === landed.y)
    : -1;
  if (index >= 0 && landed) {
    const [trap] = localTraps.splice(index, 1);
    gameState.pieces = gameState.pieces.filter((piece) => piece.id !== landed.id);
    delete gameState.effectsByPieceId?.[landed.id];
    for (const side of ["red", "black"] as const) {
      if (gameState.assassination?.[side].activePieceId === landed.id) delete gameState.assassination[side].activePieceId;
    }
    if (!landed.faceDown) {
      gameState.captured.push({ id: landed.id, color: landed.color, type: landed.type, capturedBy: trap.owner, moveNumber: gameState.revision });
    }
    if (!landed.faceDown && landed.type === "general") {
      gameState.status = "finished";
      gameState.winner = trap.owner;
      gameState.reason = "trap_ambush";
    } else {
      reassessAfterTrapResolution(gameState);
    }
    localTraps = localTraps
      .map((layer) => layer.owner === lastMove.actingSide || lastMove.countsAsFormalTurn === false
        ? layer
        : { ...layer, opponentTurnsRemaining: layer.opponentTurnsRemaining - 1 })
      .filter((layer) => layer.opponentTurnsRemaining > 0);
    return trapTriggerAnnouncement(trap.owner, gameState.reason === "trap_ambush");
  }
  if (lastMove.countsAsFormalTurn !== false) {
    localTraps = localTraps
      .map((layer) => layer.owner === lastMove.actingSide ? layer : { ...layer, opponentTurnsRemaining: layer.opponentTurnsRemaining - 1 })
      .filter((layer) => layer.opponentTurnsRemaining > 0);
  }
  return undefined;
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
    placeLocalTrap(to);
    return;
  }
  if (gameState.status !== "playing") return;
  if (bluetooth?.view && bluetooth.view.viewerSide !== gameState.turn) {
    return showToast("现在轮到对方行棋。请等待房主同步。 ");
  }
  const atTarget = pieceAt(gameState, to);

  if (!selectedPieceId) {
    if (!atTarget) return showToast("请先点选当前方控制的棋子。");
    if (getController(atTarget) !== gameState.turn) return showToast("这枚棋子不由当前方控制。");
    if (!assassinationArmed && getLegalMoves(gameState, atTarget.id).length === 0) {
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
    : getLegalMoves(gameState, selectedPieceId).some(
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
      from: { x: selected.x, y: selected.y }, to,
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
  try {
    const result = usingAssassination
      ? applyAuthoritativeAssassination(gameState, gameSecret, {
          kind: "assassination",
          from: { x: selected.x, y: selected.y }, to,
          source: assassinationArmed ? element<HTMLSelectElement>("assassination-source").value as "hero" | "mutation" : undefined,
          useStrongStrike: strongStrikeArmed,
          expectedRevision: gameState.revision, actionId: nextActionId(),
        })
      : applyAuthoritativeMove(gameState, gameSecret, {
      from: { x: selected.x, y: selected.y },
      to,
      expectedRevision: gameState.revision,
      actionId: nextActionId(),
        });
    gameState = result.state;
    gameSecret = result.secret;
    const trapMessage = resolveLocalTrapsAfterAction();
    const captured = gameState.lastMove?.captured;
    const revealed = gameState.lastMove?.revealed;
    latestAnnouncement = trapMessage ?? moveSummary(
      targetWasCovered,
      captured ? `${captured.color === "red" ? "红" : "黑"}${pieceLabel[captured.color][captured.type]}` : undefined,
      revealed ? `${revealed.color === "red" ? "红" : "黑"}${pieceLabel[revealed.color][revealed.type]}` : undefined,
    );
    selectedPieceId = undefined;
    assassinationArmed = false;
    strongStrikeArmed = false;
    renderGame();
    if (gameState.status === "execution") beginAutomaticExecution();
    if (gameState.status === "finished") showDialog(finishTitle(), finishMessage(), "查看棋盘", () => undefined);
  } catch (error) {
    showToast(error instanceof RuleError ? error.message : "落子失败，请重试。");
  }
}

document.querySelectorAll<HTMLButtonElement>(".rps-choice").forEach((button) => {
  button.addEventListener("click", () => submitChoice(button.dataset.choice as RpsChoice));
});
heroConfirmButton.addEventListener("click", confirmHeroSelection);
trapUndoButton.addEventListener("click", undoTrapDraft);
preparationConfirmButton.addEventListener("click", confirmHeroPreparation);
element<HTMLButtonElement>("local-game-button").addEventListener("click", activateLocalGame);
element<HTMLButtonElement>("bluetooth-host-button").addEventListener("click", beginBluetoothHost);
element<HTMLButtonElement>("bluetooth-refresh-button").addEventListener("click", refreshBluetoothDevices);
element<HTMLButtonElement>("bluetooth-join-button").addEventListener("click", joinBluetoothRoom);
boardPoints.addEventListener("click", onBoardClick);
capturedToggle.addEventListener("click", () => {
  const expanded = !capturedPanel.classList.contains("expanded");
  capturedPanel.classList.toggle("expanded", expanded);
  capturedToggle.setAttribute("aria-expanded", String(expanded));
});

function setBattleActionMenu(open: boolean): void {
  battleActionMenu.hidden = !open;
  battleMoreButton.setAttribute("aria-expanded", String(open));
}

battleMoreButton.addEventListener("click", () => setBattleActionMenu(battleActionMenu.hidden));
document.querySelectorAll<HTMLButtonElement>(".v4-skill-trigger").forEach((button) => {
  button.addEventListener("click", () => setBattleActionMenu(true));
});
element<HTMLButtonElement>("battle-rules-button").addEventListener("click", () => {
  setBattleActionMenu(false);
  showDialog(
    "本局要点",
    "暗子首步按所在兵种位置行动后揭开；暗子可以被任意一方吃，己方明子不可自残。翻出敌方棋子并直接将军会触发背刺。",
    "知道了",
    () => undefined,
  );
});
element<HTMLButtonElement>("battle-mutation-button").addEventListener("click", showCurrentMutationDetails);
element<HTMLButtonElement>("restart-button").addEventListener("click", () => {
  if (!gameState || gameState.status === "finished" || window.confirm("重新开始会结束当前对局，确定吗？")) {
    nativeBluetooth()?.disconnect();
    bluetooth = undefined;
    showLobby();
  }
});
document.querySelector<HTMLAnchorElement>(".brand")!.addEventListener("click", (event) => {
  event.preventDefault();
  if (!gameState || gameState.status === "finished" || window.confirm("重新开始会结束当前对局，确定吗？")) {
    nativeBluetooth()?.disconnect();
    bluetooth = undefined;
    showLobby();
  }
});
element<HTMLButtonElement>("resign-button").addEventListener("click", () => {
  setBattleActionMenu(false);
  if (!gameState || gameState.status !== "playing") return;
  const player = rpsPublic.assignments?.[gameState.turn] ?? "当前方";
  if (!window.confirm(`${player}确定臣服吗？`)) return;
  if (bluetooth?.view) {
    handleBluetoothAction({ kind: "resign", expectedRevision: gameState.revision, actionId: bluetoothActionId() });
    return;
  }
  if (!gameSecret) return;
  const result = applyResignation(gameState, gameSecret, gameState.turn, gameState.revision, nextActionId());
  gameState = result.state;
  gameSecret = result.secret;
  selectedPieceId = undefined;
  renderGame();
  showDialog(finishTitle(), finishMessage(), "查看棋盘", () => undefined);
});
element<HTMLButtonElement>("assassination-button").addEventListener("click", () => {
  setBattleActionMenu(false);
  if (!gameState || gameState.status !== "playing") return;
  const activePieceId = gameState.assassination?.[gameState.turn]?.activePieceId;
  if (activePieceId) {
    assassinationArmed = false;
    strongStrikeArmed = false;
    selectedPieceId = activePieceId;
    latestAnnouncement = "请选择隐身棋的落点；普通行动会结束隐身并放弃未用强击。";
  } else {
    assassinationArmed = !assassinationArmed;
    strongStrikeArmed = false;
    selectedPieceId = undefined;
    latestAnnouncement = assassinationArmed ? "刺杀已准备：选择当前方的一枚非将帅明棋，再选择落点。" : latestAnnouncement;
  }
  renderGame();
});
element<HTMLButtonElement>("strong-strike-button").addEventListener("click", () => {
  setBattleActionMenu(false);
  if (!gameState || gameState.status !== "playing") return;
  const activePieceId = gameState.assassination?.[gameState.turn]?.activePieceId;
  if (!activePieceId && !assassinationArmed) return showToast("请先发动刺杀，再选择是否立即强击。");
  if (activePieceId && !gameState.effectsByPieceId?.[activePieceId]?.stealth?.strongStrikeAvailable) {
    return showToast("本次刺杀的强击已经使用。");
  }
  strongStrikeArmed = !strongStrikeArmed;
  if (activePieceId) {
    selectedPieceId = activePieceId;
    assassinationArmed = false;
  }
  latestAnnouncement = strongStrikeArmed
    ? activePieceId
      ? "强击已准备：选择一个符合棋子走法的非将帅目标。"
      : "立即强击已准备：选择己方非将帅明棋，再选择合法目标。"
    : latestAnnouncement;
  renderGame();
});
flowDialog.addEventListener("cancel", (event) => event.preventDefault());
window.setInterval(updateVisibleTimers, 250);

window.addEventListener("jieqi-bluetooth", ((event: CustomEvent<BluetoothEventDetail>) => {
  const detail = event.detail;
  if (!detail) return;
  if (detail.event === "state" || detail.type === "transport-state") {
    if (bluetooth) bluetooth.nativeState = detail.state ?? bluetooth.nativeState;
    if (detail.state === "LISTENING") setBluetoothStatus("房主正在监听。请让另一台已配对手机选择本机并加入。");
    if (detail.state === "CONNECTED") {
      setBluetoothStatus("蓝牙已连接，正在同步房间。");
      if (bluetooth?.role === "host") {
        bluetooth.hostRoom ??= new BluetoothHostRoom({
          roomId: randomSessionText("bt-room"),
          admissionSecret: randomSessionText("physical"),
          mode: bluetoothModeConfig(),
        });
        publishBluetoothViews();
      }
    }
    if (detail.state === "DISCONNECTED" || detail.state === "ERROR") {
      if (bluetooth) bluetooth.pendingAction = false;
      const message = detail.detail || (detail.state === "ERROR" ? "蓝牙连接发生错误，请检查配对后重新创建或加入。" : "蓝牙连接已断开。当前对局已暂停。");
      setBluetoothStatus(message);
      showToast(message);
    }
  } else if ((detail.event === "message" || detail.type === "message") && detail.message) {
    handleIncomingBluetoothMessage(typeof detail.message === "string" ? detail.message : JSON.stringify(detail.message));
  } else if (detail.type === "transport-error" || detail.type === "permission-denied") {
    showToast(detail.detail ?? "无法使用蓝牙，请检查系统权限。");
  }
}) as EventListener);

showLobby();
