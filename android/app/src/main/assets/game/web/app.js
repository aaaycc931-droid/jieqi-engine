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

function nextActionId()         {
  const values = new Uint32Array(2);
  globalThis.crypto.getRandomValues(values);
  actionSequence += 1;
  return `local-${Date.now().toString(36)}-${values[0].toString(36)}-${values[1].toString(36)}-${actionSequence}`;
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
  const tie = rpsPublic.lastResult?.tie;
  rpsTitle.textContent = `${rpsActor}，请秘密出拳`;
  rpsHelp.textContent = rpsActor === PLAYER_ONE
    ? `第 ${rpsPublic.round} 轮：选择后把设备交给${PLAYER_TWO}。胜者执红并先走。`
    : `第 ${rpsPublic.round} 轮：${PLAYER_ONE} 已锁定选择。请出拳，随后揭晓。`;
  rpsHistory.textContent = tie && rpsPublic.lastResult
    ? `上一轮平局：${PLAYER_ONE}${choiceLabel[rpsPublic.lastResult.choices[PLAYER_ONE]]}，${PLAYER_TWO}${choiceLabel[rpsPublic.lastResult.choices[PLAYER_TWO]]}。`
    : "";
}

function submitChoice(choice           )       {
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
  redPlayer.textContent = rpsPublic.assignments.red;
  blackPlayer.textContent = rpsPublic.assignments.black;
  if (trapSetupSide) {
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
  element                   ("resign-button").disabled = gameState.status !== "playing" || Boolean(trapSetupSide);
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
  sourceSelect.disabled = gameState.status !== "playing" || Boolean(active);
  const assassinationButton = element                   ("assassination-button");
  assassinationButton.disabled = gameState.status !== "playing" || Boolean(trapSetupSide) || !canAssassinate;
  assassinationButton.textContent = active
    ? "选择隐身棋行动"
    : assassinationArmed ? "刺杀：请选择明棋" : "发动刺杀";
  const strongButton = element                   ("strong-strike-button");
  strongButton.disabled = gameState.status !== "playing" || Boolean(trapSetupSide) || !canAssassinate;
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
  if (!target || !gameState || !gameSecret || gameState.status !== "playing") return;
  const to = { x: Number(target.dataset.x), y: Number(target.dataset.y) };
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
boardPoints.addEventListener("click", onBoardClick);
element                   ("restart-button").addEventListener("click", () => {
  if (!gameState || gameState.status === "finished" || window.confirm("重新开始会结束当前对局，确定吗？")) resetRps();
});
document.querySelector                   (".brand") .addEventListener("click", (event) => {
  event.preventDefault();
  if (!gameState || gameState.status === "finished" || window.confirm("重新开始会结束当前对局，确定吗？")) resetRps();
});
element                   ("resign-button").addEventListener("click", () => {
  if (!gameState || !gameSecret || gameState.status !== "playing") return;
  const player = rpsPublic.assignments?.[gameState.turn] ?? "当前方";
  if (!window.confirm(`${player}确定臣服吗？`)) return;
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

resetRps();
