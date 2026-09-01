// The browser playground must only load browser-safe modules.  In particular,
// `src/index.ts` also re-exports the room adapter, which depends on
// `node:crypto` for invite-token hashing.  Importing that server-only adapter
// prevented the whole browser module from evaluating, so even the RPS buttons
// had no click handlers.
import { RuleError } from "../src/errors.js";
import {
  applyAutomaticExecution,
  applyAuthoritativeAssassination,
  applyAuthoritativeMove,
  applyResignation,
  getAutomaticExecutionPlan,
  initializeFeatureGameState,
  reassessAfterTrapResolution,
} from "../src/game.js";
import { createRpsState, submitRpsChoice } from "../src/rps.js";
import {
  getLegalAssassinationMoves,
  getLegalMoves,
  getPseudoMoves,
  getPieceTypeForMovement,
  isGeneralInCheck,
  pieceAt,
  validatePublicMove,
} from "../src/rules.js";
import { createInitialGame } from "../src/setup.js";
import { getController, otherSide } from "../src/slots.js";
import {
  BLUETOOTH_GUEST_PLAYER,
  BLUETOOTH_HOST_PLAYER,
  BluetoothHostRoom,

} from "../src/bluetooth-host-room.js";
import {
  createBluetoothSnapshot,
  encodeBluetoothEnvelope,
  parseBluetoothEnvelope,
} from "../src/bluetooth-protocol.js";











const PLAYER_ONE = "玩家一";
const PLAYER_TWO = "玩家二";
const choiceLabel                            = { rock: "石头", scissors: "剪刀", paper: "布" };
const pieceLabel = {
  red: { general: "帅", advisor: "仕", elephant: "相", horse: "马", rook: "车", cannon: "炮", pawn: "兵" },
  black: { general: "将", advisor: "士", elephant: "象", horse: "馬", rook: "車", cannon: "砲", pawn: "卒" },
}         ;
const movementLabel = { general: "将帅", advisor: "仕/士", elephant: "相/象", horse: "马", rook: "车", cannon: "炮", pawn: "兵/卒" }         ;

function element                       (id        )    {
  const found = document.getElementById(id);
  if (!found) throw new Error(`找不到界面元素：${id}`);
  return found     ;
}

const rpsView = element             ("rps-view");
const lobbyView = element             ("lobby-view");
const gameView = element             ("game-view");
const rpsTitle = element             ("rps-title");
const rpsHelp = element             ("rps-help");
const rpsHistory = element             ("rps-history");
const boardPoints = element             ("board-points");
const boardPlane = document.querySelector             (".board-plane");
if (!boardPlane) throw new Error("找不到棋盘");
const executionGhost = element             ("execution-ghost");
const terminationEffect = element             ("termination-effect");
const moveHint = element             ("move-hint");
const announcement = element             ("announcement");
const redPlayer = element             ("red-player");
const blackPlayer = element             ("black-player");
const turnStatus = element             ("turn-status");
const redCaptures = element             ("red-captures");
const blackCaptures = element             ("black-captures");
const flowDialog = element                   ("flow-dialog");
const dialogTitle = element             ("dialog-title");
const dialogText = element             ("dialog-text");
const dialogAction = element                   ("dialog-action");
const toast = element             ("toast");
const bluetoothStatus = element             ("bluetooth-status");
const heroPicker = element             ("remote-hero-picker");







































let rpsPublic                ;
let rpsSecret                ;
let rpsActor = PLAYER_ONE;
let gameState                       ;
let gameSecret                         ;
let selectedPieceId                    ;
let latestAnnouncement = "红方先行。点选己方棋子，再点选落点。";
let toastTimer                    ;
let actionSequence = 0;
let executionTimer                    ;
let assassinationArmed = false;
let strongStrikeArmed = false;
let localHeroes                                = {};
let localTraps                   = [];
let trapSetupQueue         = [];
let trapSetupSide                  ;
let trapPlacementCount = 0;
let bluetooth                              ;

function nativeBluetooth()                                    {
  return (window                                                         ).JieqiBluetooth;
}

function isBluetoothGame()          {
  return Boolean(bluetooth?.view || bluetooth?.hostRoom);
}

function ownBluetoothPlayerId()                                                                           {
  if (!bluetooth) return undefined;
  return bluetooth.role === "host" ? BLUETOOTH_HOST_PLAYER : BLUETOOTH_GUEST_PLAYER;
}

function bluetoothActionId()         {
  return `bt-${nextActionId()}`;
}

function nextActionId()         {
  const values = new Uint32Array(2);
  globalThis.crypto.getRandomValues(values);
  actionSequence += 1;
  return `local-${Date.now().toString(36)}-${values[0].toString(36)}-${values[1].toString(36)}-${actionSequence}`;
}

function randomSessionText(prefix        )         {
  const values = new Uint32Array(2);
  globalThis.crypto.getRandomValues(values);
  return `${prefix}-${Date.now().toString(36)}-${values[0].toString(36)}${values[1].toString(36)}`;
}

function bluetoothModeConfig()                                                        {
  return {
    heroesEnabled: element                   ("bluetooth-heroes").value === "on",
    mutationsEnabled: element                   ("bluetooth-mutations").value === "on",
  };
}

function setBluetoothStatus(message        )       {
  bluetoothStatus.textContent = message;
}

function showLobby()       {
  lobbyView.hidden = false;
  rpsView.hidden = true;
  gameView.hidden = true;
  heroPicker.hidden = true;
  const supported = Boolean(nativeBluetooth());
  element                   ("bluetooth-host-button").disabled = !supported;
  element                   ("bluetooth-refresh-button").disabled = !supported;
  element                   ("bluetooth-join-button").disabled = !supported;
  if (!supported) {
    setBluetoothStatus("当前为普通浏览器：可本机试玩。蓝牙双机功能仅在 Android 安装包中可用。");
  } else if (!bluetooth) {
    setBluetoothStatus("两台手机先在系统设置完成蓝牙配对；房主创建后，另一台选择房主设备加入。");
  }
}

function activateLocalGame()       {
  bluetooth?.role && nativeBluetooth()?.disconnect();
  bluetooth = undefined;
  resetRps();
}

function applyBluetoothView(view                      )       {
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
  const assignments = view.rps?.assignments;
  if (assignments) {
    rpsPublic = view.rps ;
  }

  if (view.phase === "rps" || view.phase === "hero_selection") {
    lobbyView.hidden = true;
    rpsView.hidden = false;
    gameView.hidden = true;
    renderRps();
  } else if (view.state) {
    lobbyView.hidden = true;
    rpsView.hidden = true;
    gameView.hidden = false;
    latestAnnouncement = bluetoothAnnouncement(view);
    renderGame();
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

function bluetoothAnnouncement(view                      )         {
  if (view.lastTrapTrigger) return "猎物已踏入陷阱！伏击触发。";
  if (view.features?.mutation) return `本局畸变：${mutationName(view.features.mutation)}。`;
  return "房主正在权威裁定本局；双方只会收到各自允许看到的信息。";
}

function mutationName(mutation            )         {
  return { iron_steed: "铁马", iron_wall: "铁壁", shadow_dance: "暗影之舞", war_chariot: "战车", expedition: "出征", cavalry: "骑兵" }[mutation];
}

function sendBluetoothEnvelope   (envelope                                                                                                       )       {
  const bridge = nativeBluetooth();
  if (!bridge) throw new Error("此设备没有蓝牙桥接能力");
  bridge.send(encodeBluetoothEnvelope(envelope));
}

function publishBluetoothViews()       {
  if (!bluetooth?.hostRoom) return;
  const views = bluetooth.hostRoom.views();
  applyBluetoothView(views.host);
  sendBluetoothEnvelope(createBluetoothSnapshot(`snapshot-${views.publicRoom.updatedAt}-${views.publicRoom.phase}`, views.guest));
}

function handleBluetoothAction(action                     )       {
  if (!bluetooth) return;
  if (bluetooth.pendingAction) return showToast("正在等待房主确认上一项操作。");
  if (bluetooth.role === "host") {
    try {
      bluetooth.hostRoom .handle(BLUETOOTH_HOST_PLAYER, action);
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

function handleIncomingBluetoothMessage(raw        )       {
  if (!bluetooth) return;
  try {
    const envelope = parseBluetoothEnvelope(raw);
    if (bluetooth.role === "host" && envelope.type === "action") {
      try {
        bluetooth.hostRoom .handle(BLUETOOTH_GUEST_PLAYER, envelope.payload                       );
        publishBluetoothViews();
      } catch (error) {
        const message = error instanceof RuleError ? error.message : "房主拒绝了此操作。";
        sendBluetoothEnvelope({ v: 1, type: "error", id: envelope.id, payload: { message } });
        showToast(message);
      }
    } else if (bluetooth.role === "guest" && envelope.type === "snapshot") {
      applyBluetoothView(envelope.payload                        );
    } else if (envelope.type === "error") {
      bluetooth.pendingAction = false;
      const payload = envelope.payload                                    ;
      showToast(payload?.message ?? "房主拒绝了此操作。");
    } else if (envelope.type === "ping") {
      sendBluetoothEnvelope({ v: 1, type: "pong", id: envelope.id });
    }
  } catch (error) {
    showToast(error instanceof RuleError ? error.message : "收到的蓝牙消息无效。");
  }
}

function beginBluetoothHost()       {
  const bridge = nativeBluetooth();
  if (!bridge) return showToast("蓝牙双机模式只能在 Android 安装包内使用。");
  bluetooth = {
    role: "host",
    nativeState: "STARTING",
    hostRoom: new BluetoothHostRoom({
      roomId: randomSessionText("bt-room"),
      admissionSecret: randomSessionText("physical"),
      mode: bluetoothModeConfig(),
    }),
    pendingAction: false,
    trapDraft: [],
  };
  setBluetoothStatus("正在开启房主监听，请让另一台已配对手机选择本机并加入。");
  bridge.host();
}

function joinBluetoothRoom()       {
  const bridge = nativeBluetooth();
  const address = element                   ("bluetooth-device").value;
  if (!bridge) return showToast("蓝牙双机模式只能在 Android 安装包内使用。");
  if (!address) return showToast("请先刷新并选择已配对的房主设备。");
  bluetooth = { role: "guest", nativeState: "CONNECTING", pendingAction: false, trapDraft: [] };
  setBluetoothStatus("正在连接房主设备，请稍候。");
  bridge.join(address);
}

function refreshBluetoothDevices()       {
  const bridge = nativeBluetooth();
  if (!bridge) return showToast("蓝牙双机模式只能在 Android 安装包内使用。");
  try {
    const devices = JSON.parse(bridge.pairedDevices())                                             ;
    const select = element                   ("bluetooth-device");
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

function resetRps()       {
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
  localTraps = [];
  trapSetupQueue = [];
  trapSetupSide = undefined;
  trapPlacementCount = 0;
  if (executionTimer) window.clearTimeout(executionTimer);
  executionTimer = undefined;
  executionGhost.hidden = true;
  executionGhost.className = "execution-ghost";
  terminationEffect.className = "termination-effect";
  lobbyView.hidden = true;
  rpsView.hidden = false;
  gameView.hidden = true;
  renderRps();
}

function showDialog(title        , text        , actionLabel        , action            )       {
  dialogTitle.textContent = title;
  dialogText.textContent = text;
  dialogAction.textContent = actionLabel;
  dialogAction.onclick = () => {
    flowDialog.close();
    action();
  };
  if (!flowDialog.open) flowDialog.showModal();
}

function showToast(message        )       {
  toast.textContent = message;
  toast.classList.add("visible");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function renderRps()       {
  if (bluetooth?.view?.phase === "hero_selection") {
    const side = bluetooth.view.viewerSide;
    const locked = side ? bluetooth.view.features?.heroSelection?.locked[side] : false;
    rpsTitle.textContent = locked ? "英雄已锁定" : "选择你的英雄";
    rpsHelp.textContent = locked ? "等待对方锁定英雄；双方选择完成后一起公开。" : "英雄选择为私有信息，对方选择完成前不会公开。";
    rpsHistory.textContent = "";
    heroPicker.hidden = Boolean(locked);
    document.querySelectorAll                   (".rps-choice").forEach((button) => { button.hidden = true; });
    element             ("red-hero").closest(".mode-picker") .hidden = true;
    return;
  }
  heroPicker.hidden = true;
  document.querySelectorAll                   (".rps-choice").forEach((button) => { button.hidden = false; });
  element             ("red-hero").closest(".mode-picker") .hidden = Boolean(bluetooth);
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
    document.querySelectorAll                   (".rps-choice").forEach((button) => { button.disabled = ownSubmitted || Boolean(bluetooth.pendingAction); });
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

function submitChoice(choice           )       {
  if (bluetooth?.view?.phase === "rps") {
    handleBluetoothAction({ kind: "rps", choice, round: bluetooth.view.rps .round });
    return;
  }
  const beforeRound = rpsPublic.round;
  const result = submitRpsChoice(rpsPublic, rpsSecret, rpsActor, choice, beforeRound);
  rpsPublic = result.publicState;
  rpsSecret = result.secretState;

  if (rpsPublic.status === "resolved") {
    const resolved = rpsPublic.lastResult ;
    const winner = resolved.winner ;
    const summary = `${PLAYER_ONE}出${choiceLabel[resolved.choices[PLAYER_ONE]]}，${PLAYER_TWO}出${choiceLabel[resolved.choices[PLAYER_TWO]]}。${winner}获胜，执红先走。`;
    showDialog("先手已决定", summary, "开始对局", startGame);
    return;
  }

  if (rpsPublic.round > beforeRound) {
    const tie = rpsPublic.lastResult ;
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

function startGame()       {
  const session = createInitialGame();
  const redHero = element                   ("red-hero").value               ;
  const blackHero = element                   ("black-hero").value               ;
  const mutation = element                   ("mutation").value                   ;
  localHeroes = {
    ...(redHero ? { red: redHero } : {}),
    ...(blackHero ? { black: blackHero } : {}),
  };
  gameState = initializeFeatureGameState(
    session.state,
    Object.keys(localHeroes).length > 0 ? localHeroes : undefined,
    mutation || undefined,
  );
  gameSecret = session.secret;
  selectedPieceId = undefined;
  assassinationArmed = false;
  strongStrikeArmed = false;
  localTraps = [];
  trapSetupQueue = (["red", "black"]         ).filter((side) => localHeroes[side] === "hunter");
  trapSetupSide = trapSetupQueue.shift();
  trapPlacementCount = 0;
  latestAnnouncement = `${rpsPublic.assignments .red}执红，红方先行。`;
  rpsView.hidden = true;
  gameView.hidden = false;
  renderGame();
  if (trapSetupSide) {
    showDialog(
      `${trapSetupSide === "red" ? "红方" : "黑方"}猎人布置陷阱`,
      "请在自己的半场点选两个位置。坐标只在本机当前交接阶段可见，允许重叠与放在棋子脚下。",
      "开始布置",
      () => renderGame(),
    );
  }
}

function positionKey(position          )         {
  return `${position.x},${position.y}`;
}

function descriptionForPiece(pieceId        )         {
  if (!gameState) return "";
  const piece = gameState.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) return "";
  if (piece.faceDown) return `暗子首步按${movementLabel[getPieceTypeForMovement(piece)]}位走，落子后翻开。`;
  return `${piece.color === "red" ? "红" : "黑"}${pieceLabel[piece.color][piece.type]}，明子按本身走法行动。`;
}

function noLegalMoveMessage(pieceId        )         {
  if (!gameState) return "这枚棋子当前没有合法落点。";
  const piece = gameState.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) return "这枚棋子当前没有合法落点。";
  const pseudoMoves = getPseudoMoves(gameState, pieceId);
  const everyMoveExposesGeneral = pseudoMoves.length > 0 && pseudoMoves.every(
    (to) => validatePublicMove(gameState , { from: piece, to }, gameState .turn).code === "SELF_CHECK",
  );
  if (everyMoveExposesGeneral) {
    return "这枚棋子正在挡住将帅照面；移开会让己方将帅受将。请先用其他棋子补住中路。";
  }
  return "这枚棋子当前没有合法落点。";
}

function renderBoard()       {
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
  const ownTrapKeys = new Set((bluetooth?.view?.ownTraps ?? localTraps)
    .map((trap) => positionKey(trap.position)));
  const fragment = document.createDocumentFragment();

  for (let y = 0; y <= 9; y += 1) {
    for (let x = 0; x <= 8; x += 1) {
      const position = { x, y };
      const key = positionKey(position);
      const piece = pieces.get(key);
      const point = document.createElement("button");
      point.type = "button";
      point.className = "point";
      point.style.left = `${(x / 8) * 100}%`;
      point.style.top = `${(y / 9) * 100}%`;
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
      if (ownTrapKeys.has(key)) point.classList.add("own-trap");

      if (piece) {
        const token = document.createElement("span");
        token.className = `piece ${piece.faceDown ? "covered" : piece.color}`;
        token.setAttribute("aria-hidden", "true");
        token.textContent = piece.faceDown ? "◇" : pieceLabel[piece.color][piece.type];
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
      fragment.append(point);
    }
  }
  boardPoints.replaceChildren(fragment);
}

function renderCaptures(container             , side      )       {
  if (!gameState) return;
  const captured = gameState.captured.filter((piece) => piece.capturedBy === side);
  if (captured.length === 0) {
    container.innerHTML = '<span class="empty-captures">尚无</span>';
    return;
  }
  container.replaceChildren(...captured.map((piece) => {
    const token = document.createElement("span");
    token.className = `captured-token ${piece.color}`;
    token.textContent = pieceLabel[piece.color][piece.type];
    token.title = `${piece.color === "red" ? "红" : "黑"}${pieceLabel[piece.color][piece.type]}`;
    return token;
  }));
}

function finishMessage()         {
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

function finishTitle()         {
  if (!gameState?.reason) return "对局结束";
  return { ambush: "背刺", checkmate: "裁决", stalemate: "无处可逃", resign: "臣服", trap_ambush: "伏击", crush_them: "碾碎他们！", rampage: "乱杀失败" }[gameState.reason];
}

function renderGame()       {
  if (!gameState || !rpsPublic.assignments) return;
  const remoteView = bluetooth?.view;
  const remoteTrapSetup = remoteView?.phase === "trap_setup";
  const remoteSide = remoteView?.viewerSide;
  const remoteIsHunter = Boolean(remoteSide && remoteView?.features?.heroes?.[remoteSide] === "hunter");
  const remoteTrapDone = Boolean(remoteSide && remoteView?.features?.trapSetup?.submitted[remoteSide]);
  redPlayer.textContent = rpsPublic.assignments.red;
  blackPlayer.textContent = rpsPublic.assignments.black;
  if (remoteTrapSetup) {
    turnStatus.innerHTML = `<b>${remoteIsHunter ? "猎人布置" : "等待猎人布置"}</b><span>${bluetooth .trapDraft.length} / 2</span>`;
    announcement.textContent = remoteIsHunter ? "在己方半场点选两个陷阱位置。落点与叠层仅对你可见。" : "对方正在私下布置陷阱，请等待。";
    moveHint.textContent = remoteTrapDone ? "你的陷阱已锁定，等待另一名猎人。" : remoteIsHunter ? `请选择第 ${bluetooth .trapDraft.length + 1} 个陷阱位置。` : "等待布置完成。";
  } else if (trapSetupSide) {
    turnStatus.innerHTML = `<b>${trapSetupSide === "red" ? "红方" : "黑方"}猎人布置</b><span>陷阱 ${trapPlacementCount} / 2</span>`;
    announcement.textContent = "陷阱坐标仅对布置方可见；两层可以重叠，也可放在棋子脚下。";
    moveHint.textContent = `请在${trapSetupSide === "red" ? "红方" : "黑方"}半场点选第 ${trapPlacementCount + 1} 个陷阱位置。`;
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
    turnStatus.innerHTML = `<b>${gameState.turn === "red" ? "红方" : "黑方"}行棋</b><span>${player} · 第 ${gameState.revision + 1} 手</span>`;
    const inCheck = isGeneralInCheck(gameState, gameState.turn);
    announcement.textContent = inCheck ? `${gameState.turn === "red" ? "红帅" : "黑将"}正在被将军，必须应将。` : latestAnnouncement;
    moveHint.textContent = selectedPieceId ? descriptionForPiece(selectedPieceId) : "点选当前方控制的棋子，再点选绿色落点。";
  }
  renderBoard();
  renderCaptures(redCaptures, "red");
  renderCaptures(blackCaptures, "black");
  const remoteLocked = Boolean(bluetooth?.pendingAction) || (Boolean(remoteView) && remoteView?.viewerSide !== gameState.turn);
  element                   ("resign-button").disabled = gameState.status !== "playing" || Boolean(trapSetupSide) || Boolean(remoteTrapSetup) || remoteLocked;
  const skill = gameState.assassination?.[gameState.turn];
  const active = skill?.activePieceId;
  const canAssassinate = Boolean(skill?.heroChargeAvailable || skill?.mutationChargeAvailable || active);
  const sourceSelect = element                   ("assassination-source");
  const availableSources = [
    ...(skill?.heroChargeAvailable ? ["hero"         ] : []),
    ...(skill?.mutationChargeAvailable ? ["mutation"         ] : []),
  ];
  sourceSelect.replaceChildren(...availableSources.map((source) => {
    const option = document.createElement("option");
    option.value = source;
    option.textContent = source === "hero" ? "英雄次数" : "暗影之舞";
    return option;
  }));
  sourceSelect.hidden = availableSources.length === 0;
  sourceSelect.disabled = gameState.status !== "playing" || Boolean(active) || remoteLocked;
  const assassinationButton = element                   ("assassination-button");
  assassinationButton.disabled = gameState.status !== "playing" || Boolean(trapSetupSide) || Boolean(remoteTrapSetup) || remoteLocked || !canAssassinate;
  assassinationButton.textContent = active
    ? "选择隐身棋行动"
    : assassinationArmed ? "刺杀：请选择明棋" : "发动刺杀";
  const strongButton = element                   ("strong-strike-button");
  strongButton.disabled = gameState.status !== "playing" || Boolean(trapSetupSide) || Boolean(remoteTrapSetup) || remoteLocked || !canAssassinate;
  strongButton.textContent = strongStrikeArmed ? "强击：请选择目标" : "发动强击";
}

function moveSummary(targetWasCovered         , capturedLabel         , revealedLabel         )         {
  if (!gameState?.lastMove) return "已落子。";
  const actor = gameState.lastMove.actingSide === "red" ? "红方" : "黑方";
  const details = [capturedLabel ? `${actor}吃掉${capturedLabel}` : "已落子", revealedLabel ? `翻出${revealedLabel}` : ""];
  const crushed = gameState.lastMove.pathCrushed ?? [];
  if (crushed.length > 0) {
    details.push(`路径碾碎${crushed.map((piece) => `${piece.color === "red" ? "红" : "黑"}${pieceLabel[piece.color][piece.type]}`).join("、")}`);
  }
  if (gameState.lastMove.bouncedAgainstPieceId) details.push("防护壁垒将攻击者弹回");
  if (targetWasCovered && capturedLabel) details.push("被吃暗子已揭开");
  if (gameState.status === "execution") return `${details.filter(Boolean).join("，")}。终结已触发。`;
  if (gameState.status === "finished") return `${details.filter(Boolean).join("，")}。${finishMessage()}`;
  return `${details.filter(Boolean).join("，")}。轮到${gameState.turn === "red" ? "红方" : "黑方"}。`;
}

function beginAutomaticExecution()       {
  if (!gameState || !gameSecret || gameState.status !== "execution") return;
  const plan = getAutomaticExecutionPlan(gameState);
  if (!plan) return showToast("终结动作生成失败，请重新开始对局。");
  const source = pieceAt(gameState, plan.from);
  if (!source || source.faceDown) return showToast("终结棋子状态异常。");
  const sourcePoint = boardPoints.querySelector             (`.point[data-x="${plan.from.x}"][data-y="${plan.from.y}"]`);
  const targetPoint = boardPoints.querySelector             (`.point[data-x="${plan.to.x}"][data-y="${plan.to.y}"]`);
  if (!sourcePoint || !targetPoint) return showToast("终结动画定位失败。");

  const boardRect = boardPlane.getBoundingClientRect();
  const sourceRect = sourcePoint.getBoundingClientRect();
  const targetRect = targetPoint.getBoundingClientRect();
  const reasonClass = gameState.reason === "ambush" ? "ambush" : "judgment";
  executionGhost.hidden = false;
  executionGhost.className = `execution-ghost piece ${source.color}`;
  executionGhost.textContent = pieceLabel[source.color][source.type];
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
function playRemoteTerminalAnimation(terminal                                                        )       {
  if (!gameState) return;
  const source = gameState.pieces.find((piece) => piece.id === terminal.plan.pieceId);
  const sourcePoint = boardPoints.querySelector             (`.point[data-x="${terminal.plan.from.x}"][data-y="${terminal.plan.from.y}"]`);
  const targetPoint = boardPoints.querySelector             (`.point[data-x="${terminal.plan.to.x}"][data-y="${terminal.plan.to.y}"]`);
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
  executionGhost.textContent = pieceLabel[source.color][source.type];
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

function isOwnHalf(side      , position          )          {
  return side === "red" ? position.y >= 5 : position.y <= 4;
}

/** Local playground mirror of the private server trap resolution.  Online
 * games use the same rule through remote-room.ts, where coordinates never
 * enter the shared room document. */
function resolveLocalTrapsAfterAction()                     {
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
    for (const side of ["red", "black"]         ) {
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
    return `猎物已踏入陷阱！伏击触发，${trap.owner === "red" ? "红方" : "黑方"}获得胜利。`;
  }
  if (lastMove.countsAsFormalTurn !== false) {
    localTraps = localTraps
      .map((layer) => layer.owner === lastMove.actingSide ? layer : { ...layer, opponentTurnsRemaining: layer.opponentTurnsRemaining - 1 })
      .filter((layer) => layer.opponentTurnsRemaining > 0);
  }
  return undefined;
}

function placeLocalTrap(position          )       {
  if (!trapSetupSide || !gameState) return;
  if (!isOwnHalf(trapSetupSide, position)) {
    showToast("陷阱只能布置在己方半场。");
    return;
  }
  localTraps.push({
    id: `local-trap:${trapSetupSide}:${trapPlacementCount}`,
    owner: trapSetupSide,
    position: { ...position },
    opponentTurnsRemaining: 10,
  });
  trapPlacementCount += 1;
  if (trapPlacementCount < 2) {
    renderGame();
    return;
  }
  const completedSide = trapSetupSide;
  trapSetupSide = trapSetupQueue.shift();
  trapPlacementCount = 0;
  renderGame();
  if (trapSetupSide) {
    showDialog(
      `${completedSide === "red" ? "红方" : "黑方"}陷阱已锁定`,
      `请将设备交给${trapSetupSide === "red" ? "红方" : "黑方"}猎人布置其两个私有陷阱。`,
      "继续布置",
      () => renderGame(),
    );
  } else {
    showDialog("陷阱布置完成", "双方陷阱已私下锁定，红方开始行棋。", "开始对局", () => renderGame());
  }
}

function onBoardClick(event            )       {
  const target = (event.target               ).closest                   (".point");
  if (!target || !gameState) return;
  const to = { x: Number(target.dataset.x), y: Number(target.dataset.y) };
  if (bluetooth?.view?.phase === "trap_setup") {
    const side = bluetooth.view.viewerSide;
    const isHunter = Boolean(side && bluetooth.view.features?.heroes?.[side] === "hunter");
    const alreadySubmitted = Boolean(side && bluetooth.view.features?.trapSetup?.submitted[side]);
    if (!side || !isHunter || alreadySubmitted) return showToast("当前正在等待对方完成陷阱布置。");
    if (!isOwnHalf(side, to)) return showToast("陷阱只能布置在己方半场。");
    bluetooth.trapDraft.push(to);
    if (bluetooth.trapDraft.length < 2) {
      renderGame();
      return;
    }
    const positions = bluetooth.trapDraft;
    bluetooth.trapDraft = [];
    handleBluetoothAction({ kind: "traps", positions });
    renderGame();
    return;
  }
  if (gameState.status !== "playing") return;
  if (bluetooth?.view && bluetooth.view.viewerSide !== gameState.turn) {
    return showToast("现在轮到对方行棋。请等待房主同步。 ");
  }
  if (trapSetupSide) {
    placeLocalTrap(to);
    return;
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
            source: assassinationArmed ? element                   ("assassination-source").value                        : undefined,
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
          source: assassinationArmed ? element                   ("assassination-source").value                        : undefined,
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

document.querySelectorAll                   (".rps-choice").forEach((button) => {
  button.addEventListener("click", () => submitChoice(button.dataset.choice             ));
});
document.querySelectorAll                   (".hero-choices button").forEach((button) => {
  button.addEventListener("click", () => {
    if (!bluetooth?.view || bluetooth.view.phase !== "hero_selection") return;
    handleBluetoothAction({ kind: "hero", hero: button.dataset.hero           });
  });
});
element                   ("local-game-button").addEventListener("click", activateLocalGame);
element                   ("bluetooth-host-button").addEventListener("click", beginBluetoothHost);
element                   ("bluetooth-refresh-button").addEventListener("click", refreshBluetoothDevices);
element                   ("bluetooth-join-button").addEventListener("click", joinBluetoothRoom);
boardPoints.addEventListener("click", onBoardClick);
element                   ("restart-button").addEventListener("click", () => {
  if (!gameState || gameState.status === "finished" || window.confirm("重新开始会结束当前对局，确定吗？")) {
    nativeBluetooth()?.disconnect();
    bluetooth = undefined;
    showLobby();
  }
});
document.querySelector                   (".brand") .addEventListener("click", (event) => {
  event.preventDefault();
  if (!gameState || gameState.status === "finished" || window.confirm("重新开始会结束当前对局，确定吗？")) {
    nativeBluetooth()?.disconnect();
    bluetooth = undefined;
    showLobby();
  }
});
element                   ("resign-button").addEventListener("click", () => {
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
element                   ("assassination-button").addEventListener("click", () => {
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
element                   ("strong-strike-button").addEventListener("click", () => {
  if (!gameState || gameState.status !== "playing") return;
  const activePieceId = gameState.assassination?.[gameState.turn]?.activePieceId;
  strongStrikeArmed = !strongStrikeArmed;
  if (activePieceId) {
    selectedPieceId = activePieceId;
    assassinationArmed = false;
  } else {
    assassinationArmed = strongStrikeArmed;
    selectedPieceId = undefined;
  }
  latestAnnouncement = strongStrikeArmed
    ? "强击已准备：选择可用刺杀棋，再选择一个非将帅目标。"
    : latestAnnouncement;
  renderGame();
});
flowDialog.addEventListener("cancel", (event) => event.preventDefault());

window.addEventListener("jieqi-bluetooth", ((event                                   ) => {
  const detail = event.detail;
  if (!detail) return;
  if (detail.event === "state" || detail.type === "transport-state") {
    if (bluetooth) bluetooth.nativeState = detail.state ?? bluetooth.nativeState;
    if (detail.state === "LISTENING") setBluetoothStatus("房主正在监听。请让另一台已配对手机选择本机并加入。");
    if (detail.state === "CONNECTED") {
      setBluetoothStatus("蓝牙已连接，正在同步房间。");
      if (bluetooth?.role === "host") publishBluetoothViews();
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
})                 );

showLobby();
