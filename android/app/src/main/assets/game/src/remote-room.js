import { HERO_IDS } from "./heroes.js";
import { applyHeroAbility, ownerHeroSecrets, startFormalClock } from "./hero-actions.js";
import { copy, initializeFeatureSecret } from "./settlement.js";
import { RuleError } from "./errors.js";
import { equalHex, sha256Hex } from "./sha256.js";
import {
  applyAutomaticExecution,
  initializeFeatureGameState,
  getAutomaticExecutionPlan,
  publicStateSnapshot,
  reassessAfterTrapResolution,
} from "./game.js";
import {
  applyRoomAssassination,
  applyRoomMove,
  resignRoomGame,
  sideForPlayer,
} from "./room.js";
import {
  createRpsState,
  submitRpsChoice,
} from "./rps.js";
import { createInitialGame } from "./setup.js";
import { getController, isInsideBoard, otherSide } from "./slots.js";
import { isGeneralInCheck } from "./rules.js";
import {
  MUTATION_IDS,
  drawRuntimeMutation,
  mutationDefinition,

} from "./mutations.js";


























export const HERO_SELECTION_DURATION_MS = 60_000;
export const RPS_SELECTION_DURATION_MS = 30_000;
export const HERO_PREPARATION_DURATION_MS = 60_000;
export const DISCONNECT_TIMEOUT_MS = 60_000;
export const REMATCH_INVITATION_DURATION_MS = 30_000;
export const CHAT_COOLDOWN_MS = 2_000;
export const CHAT_MAX_CHARACTERS = 50;

export const DEFAULT_OPTIONAL_MODE_CONFIG                     = {
  heroesEnabled: false,
  mutationsEnabled: false,
};

const RPS_CHOICES                       = ["rock", "scissors", "paper"];






































































/** Kept server-side and returned only to its owner through playerRoomView. */







/** Public after a trigger only; untriggered coordinates never leave the server. */


















/** Never copy this object into a public room document or a shared watch. */






/**
 * The server-only room aggregate.  CloudBase should store `inviteTokenHash`,
 * `rpsSecret`, and `game.secret` in rooms_secret, never in rooms_public.
 */
























/** The only shape that may be returned from a cloud function or database watch. */



















/** A public room plus secrets belonging only to the authenticated viewer. */


















function requireText(value        , code        , message        )       {
  if (!value.trim()) throw new RuleError(code, message);
}

function appendMessage(room            , message              )             {
  return { ...room, messages: [...(room.messages ?? []), message] };
}

function appendSystemMessage(room            , text        , now        , id        )             {
  return appendMessage(room, { id, kind: "system", text, createdAt: now });
}

function sideName(side      )         {
  return side === "red" ? "红方" : "蓝方";
}

function pieceName(color      , type                                       )         {
  const names = {
    red: { general: "帅", advisor: "仕", elephant: "相", horse: "马", rook: "车", cannon: "炮", pawn: "兵" },
    black: { general: "将", advisor: "士", elephant: "象", horse: "馬", rook: "車", cannon: "砲", pawn: "卒" },
  }         ;
  return `${color === "red" ? "红" : "蓝"}${names[color][type]}`;
}

function actionHistoryText(state           , skill              )         {
  const lastMove = state.lastMove;
  if (!lastMove) return "棋局状态已更新。";
  const parts = [`${sideName(lastMove.actingSide)}${skill ? `发动${skill}` : "完成行棋"}`];
  if (lastMove.captured) parts.push(`吃掉${pieceName(lastMove.captured.color, lastMove.captured.type)}`);
  if (lastMove.pathCrushed?.length) parts.push(`碾碎${lastMove.pathCrushed.length}枚棋子`);
  if (lastMove.bouncedAgainstPieceId) parts.push("攻击被壁垒弹回");
  if (lastMove.revealed) parts.push(`揭示为${pieceName(lastMove.revealed.color, lastMove.revealed.type)}`);
  if (state.status === "playing") {
    if (isGeneralInCheck(state, state.turn)) parts.push(`${sideName(state.turn)}被将军`);
    parts.push(`轮到${sideName(state.turn)}`);
  } else {
    parts.push("对局结束");
  }
  return `${parts.join("，")}。`;
}

function withActionHistory(room            , now        , actionId        , skill              , preserveClock = false)             {
  if (!room.game) return room;
  if (!preserveClock && room.game.state.status === "playing" && !room.game.state.flowDance) startFormalClock(room.game.state, now);
  const trapTriggered = room.lastTrapTrigger?.actionId === actionId;
  const text = `${trapTriggered ? "猎人陷阱触发，" : ""}${actionHistoryText(room.game.state, skill)}`;
  return appendSystemMessage(room, text, now, `system:${actionId}`);
}

export function hashInviteToken(inviteToken        )         {
  requireText(inviteToken, "INVALID_INVITE", "邀请口令不能为空");
  return sha256Hex(inviteToken);
}

function hasMatchingInvite(room            , inviteToken        )          {
  return equalHex(hashInviteToken(inviteToken), room.inviteTokenHash);
}

function clonePublic   (value   )    {
  return JSON.parse(JSON.stringify(value))     ;
}

function normalizeModeConfig(
  mode                                         ,
)                     {
  return {
    heroesEnabled: mode?.heroesEnabled ?? DEFAULT_OPTIONAL_MODE_CONFIG.heroesEnabled,
    mutationsEnabled:
      mode?.mutationsEnabled ?? DEFAULT_OPTIONAL_MODE_CONFIG.mutationsEnabled,
  };
}

function isHeroId(value        )                  {
  return HERO_IDS.includes(value          );
}

function drawHero(randomInt            )         {
  const index = (randomInt ?? ((maxExclusive) => cryptoRandomInt(maxExclusive)))(HERO_IDS.length);
  if (!Number.isInteger(index) || index < 0 || index >= HERO_IDS.length) {
    throw new RangeError(`英雄随机数超出范围：${index}`);
  }
  return HERO_IDS[index];
}

function drawRpsChoice(randomInt            )            {
  const index = (randomInt ?? ((maxExclusive) => cryptoRandomInt(maxExclusive)))(RPS_CHOICES.length);
  if (!Number.isInteger(index) || index < 0 || index >= RPS_CHOICES.length) {
    throw new RangeError(`猜拳随机数超出范围：${index}`);
  }
  return RPS_CHOICES[index];
}

function oldDrawMutation(randomInt            )             {
  // Transitional flat draw: exact outer rarity probabilities remain intentionally deferred.
  const index = (randomInt ?? ((maxExclusive) => cryptoRandomInt(maxExclusive)))(
    MUTATION_IDS.length,
  );
  if (!Number.isInteger(index) || index < 0 || index >= MUTATION_IDS.length) {
    throw new RangeError(`畸变随机数超出范围：${index}`);
  }
  return MUTATION_IDS[index];
}

function cryptoRandomInt(maxExclusive        )         {
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / maxExclusive) * maxExclusive;
  const value = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % maxExclusive;
}

function reserveServerActionId(actionId        )       {
  requireText(actionId, "INVALID_ACTION", "操作 ID 不能为空");
  if (actionId.startsWith("server:")) {
    throw new RuleError("RESERVED_ACTION", "操作 ID 使用了保留前缀");
  }
}

function hasActiveDisconnect(room            )          {
  return Object.values(room.disconnects?.players ?? {}).some((player) => player.disconnectedAt !== undefined);
}

function ensurePhase(room            , phase                 )       {
  if (phase !== "waiting" && hasActiveDisconnect(room)) {
    throw new RuleError("MATCH_PAUSED_DISCONNECT", "对局因断线暂停，等待连接恢复");
  }
  if (room.phase !== phase) {
    throw new RuleError("INVALID_PHASE", "房间当前阶段不能执行此操作");
  }
}

function makeSeat(playerId        , now        )             {
  requireText(playerId, "INVALID_PLAYER", "玩家 ID 不能为空");
  return { playerId, connectedAt: now, lastSeenAt: now };
}

function roomPlayerIds(room            )                   {
  const guest = room.seats.guest?.playerId;
  if (!guest) throw new RuleError("ROOM_NOT_READY", "房间尚未坐满两名玩家");
  return [room.seats.host.playerId, guest];
}

function cloneDisconnects(disconnects                                   )                                    {
  if (!disconnects) return undefined;
  return {
    players: Object.fromEntries(
      Object.entries(disconnects.players).map(([playerId, value]) => [playerId, { ...value }]),
    ),
    ...(disconnects.pausedAt !== undefined ? { pausedAt: disconnects.pausedAt } : {}),
  };
}

function disconnectTotalMs(player                             , now        )         {
  return player.accumulatedMs
    + (player.disconnectedAt === undefined ? 0 : Math.max(0, now - player.disconnectedAt));
}

function sideForDisconnectPlayer(room            , playerId        )                   {
  if (room.game) {
    if (room.game.players.red === playerId) return "red";
    if (room.game.players.black === playerId) return "black";
  }
  const assignments = room.rps?.assignments;
  if (assignments?.red === playerId) return "red";
  if (assignments?.black === playerId) return "black";
  return undefined;
}

function shiftPausedDeadlines(room            , pauseDurationMs        )             {
  if (pauseDurationMs <= 0) return room;
  const features = room.features
    ? {
        ...room.features,
        ...(room.features.heroSelection
          ? { heroSelection: { ...room.features.heroSelection, deadlineAt: room.features.heroSelection.deadlineAt + pauseDurationMs } }
          : {}),
        ...(room.features.heroPreparation
          ? { heroPreparation: { ...room.features.heroPreparation, deadlineAt: room.features.heroPreparation.deadlineAt + pauseDurationMs } }
          : {}),
      }
    : undefined;
  return {
    ...room,
    ...(features ? { features } : {}),
    ...(room.rpsDeadlineAt !== undefined ? { rpsDeadlineAt: room.rpsDeadlineAt + pauseDurationMs } : {}),
    ...(room.game ? {
      game: {
        ...room.game,
        state: {
          ...room.game.state,
          ...(room.game.state.turnStartedAt !== undefined ? { turnStartedAt: room.game.state.turnStartedAt + pauseDurationMs } : {}),
          ...(room.game.state.turnDeadlineAt !== undefined ? { turnDeadlineAt: room.game.state.turnDeadlineAt + pauseDurationMs } : {}),
        },
        secret: {
          ...room.game.secret,
          ...(room.game.secret.replay ? { replay: { ...room.game.secret.replay, deadlineAt: room.game.secret.replay.deadlineAt + pauseDurationMs } } : {}),
        },
      },
    } : {}),
  };
}

function finishByDisconnectTimeout(room            , timedOutPlayerIds          , now        )             {
  if (room.phase === "finished") return room;
  const [firstPlayer, secondPlayer] = roomPlayerIds(room);
  const timedOut = new Set(timedOutPlayerIds);
  const simultaneous = timedOut.has(firstPlayer) && timedOut.has(secondPlayer);
  const winnerPlayerId = simultaneous ? undefined : timedOut.has(firstPlayer) ? secondPlayer : firstPlayer;
  let game = room.game;
  if (game) {
    const state = JSON.parse(JSON.stringify(game.state))             ;
    state.status = "finished";
    state.revision += 1;
    delete state.winner;
    delete state.reason;
    delete state.drawReason;
    if (simultaneous) {
      state.drawReason = "disconnect_timeout";
    } else if (winnerPlayerId) {
      const winnerSide = sideForDisconnectPlayer(room, winnerPlayerId);
      if (winnerSide) {
        state.winner = winnerSide;
        state.reason = "disconnect";
      }
    }
    game = { players: { ...game.players }, state, secret: game.secret };
  }
  return {
    ...room,
    phase: "finished",
    ...(game ? { game } : {}),
    terminalAnimation: undefined,
    disconnectOutcome: {
      timedOutPlayerIds: [...timedOutPlayerIds],
      ...(winnerPlayerId ? { winnerPlayerId } : {}),
    },
    updatedAt: now,
  };
}

function disconnectThresholdAt(player                             )                     {
  if (player.disconnectedAt === undefined) {
    return player.accumulatedMs >= DISCONNECT_TIMEOUT_MS ? 0 : undefined;
  }
  return player.disconnectedAt + Math.max(0, DISCONNECT_TIMEOUT_MS - player.accumulatedMs);
}

function applyDisconnectTimeout(room            , now        )             {
  if (!room.disconnects || room.phase === "finished") return room;
  const thresholds = roomPlayerIds(room)
    .map((playerId) => {
      const player = room.disconnects .players[playerId];
      return { playerId, thresholdAt: player ? disconnectThresholdAt(player) : undefined };
    })
    .filter((entry)                                                     =>
      entry.thresholdAt !== undefined && entry.thresholdAt <= now,
    );
  if (thresholds.length === 0) return room;
  const earliest = Math.min(...thresholds.map((entry) => entry.thresholdAt));
  const timedOutPlayerIds = thresholds
    .filter((entry) => entry.thresholdAt === earliest)
    .map((entry) => entry.playerId);
  return finishByDisconnectTimeout(room, timedOutPlayerIds, now);
}

function expireRematchInvitation(room            , now        )             {
  if (room.rematch?.status !== "pending" || now < room.rematch.deadlineAt) return room;
  return {
    ...room,
    rematch: { ...room.rematch, status: "expired" },
    updatedAt: now,
  };
}

export function disconnectRemotePlayer(room            , playerId        , now = Date.now())             {
  requireRemotePlayer(room, playerId);
  if (room.phase === "waiting" || room.phase === "finished" || !room.disconnects) return room;
  const current = room.disconnects.players[playerId];
  if (!current || current.disconnectedAt !== undefined) return room;
  const disconnects = cloneDisconnects(room.disconnects) ;
  disconnects.players[playerId] = { ...current, disconnectedAt: now };
  disconnects.pausedAt ??= now;
  const disconnected = { ...room, disconnects, updatedAt: now };
  return room.phase === "playing"
    ? appendSystemMessage(disconnected, `${sideName(sideForAssignedPlayer(room, playerId))}连接中断，对局暂停。`, now, `system:disconnect:${playerId}:${now}`)
    : disconnected;
}

export function reconnectRemotePlayer(room            , playerId        , now = Date.now())             {
  requireRemotePlayer(room, playerId);
  if (!room.disconnects) return room;
  const timed = applyDisconnectTimeout(room, now);
  const current = timed.disconnects?.players[playerId];
  if (!current || current.disconnectedAt === undefined) return timed;
  const disconnects = cloneDisconnects(timed.disconnects) ;
  const segmentMs = Math.max(0, now - current.disconnectedAt);
  disconnects.players[playerId] = {
    accumulatedMs: current.accumulatedMs + segmentMs,
    reconnectCount: current.reconnectCount + 1,
  };
  const anyStillDisconnected = Object.values(disconnects.players).some((player) => player.disconnectedAt !== undefined);
  if (timed.phase === "finished" || anyStillDisconnected) {
    return { ...timed, disconnects, updatedAt: now };
  }
  const pauseDurationMs = disconnects.pausedAt === undefined ? 0 : Math.max(0, now - disconnects.pausedAt);
  delete disconnects.pausedAt;
  const reconnected = { ...shiftPausedDeadlines(timed, pauseDurationMs), disconnects, updatedAt: now };
  return timed.phase === "playing"
    ? appendSystemMessage(reconnected, `${sideName(sideForAssignedPlayer(timed, playerId))}已重新连接，对局继续。`, now, `system:reconnect:${playerId}:${now}`)
    : reconnected;
}

function assignmentsFor(room            )                                 {
  const assignments = room.rps?.assignments;
  if (!assignments) {
    throw new RuleError("MISSING_ASSIGNMENT", "房间尚未确定红黑方分配");
  }
  return { ...assignments };
}

function sideForAssignedPlayer(room            , playerId        )       {
  const assignments = assignmentsFor(room);
  if (assignments.red === playerId) return "red";
  if (assignments.black === playerId) return "black";
  throw new RuleError("NOT_PLAYER", "该用户不在本房间");
}

function hunterSides(features                                    )         {
  const heroes = features?.heroes;
  if (!heroes) return [];
  return (["red", "black"]         ).filter((side) => heroes[side] === "hunter");
}

function randomOwnHalfPosition(side      , randomInt            )           {
  const index = (randomInt ?? ((maxExclusive) => cryptoRandomInt(maxExclusive)))(45);
  if (!Number.isInteger(index) || index < 0 || index >= 45) {
    throw new RangeError(`陷阱随机数超出范围：${index}`);
  }
  return {
    x: index % 9,
    y: (side === "red" ? 5 : 0) + Math.floor(index / 9),
  };
}

function publicFeaturesAfterPreparation(features                        )                         {
  return {
    ...(features.heroes ? { heroes: { ...features.heroes } } : {}),
    ...(features.mutation ? { mutation: features.mutation } : {}),
    ...(features.mutationRarity ? { mutationRarity: features.mutationRarity } : {}),
  };
}

function beginHeroPreparation(room            , now        )             {
  const heroes = room.features?.heroes;
  if (!heroes) return { ...room, phase: "playing", updatedAt: now };
  const ready                        = {
    red: heroes.red !== "hunter",
    black: heroes.black !== "hunter",
  };
  if (ready.red && ready.black) {
    return {
      ...room,
      phase: "playing",
      features: publicFeaturesAfterPreparation(room.features ),
      updatedAt: now,
    };
  }
  return {
    ...room,
    phase: "hero_preparation",
    features: {
      ...publicFeaturesAfterPreparation(room.features ),
      heroPreparation: { ready, deadlineAt: now + HERO_PREPARATION_DURATION_MS },
    },
    featureSecret: {
      ...(room.featureSecret ?? { traps: [] }),
      trapDrafts: {},
    },
    updatedAt: now,
  };
}

function createGameAfterSetup(
  room            ,
  randomInt                       ,
  now        ,
  heroes                       ,
)             {
  const assignments = assignmentsFor(room);
  const initial = createInitialGame(randomInt);
  const mutation = room.mode.mutationsEnabled ? drawRuntimeMutation(randomInt ?? cryptoRandomInt, heroes) : undefined;
  const features                         = {
    ...(heroes ? { heroes: { ...heroes } } : {}),
    ...(mutation ? { mutation, mutationRarity: mutationDefinition(mutation).rarity } : {}),
  };
  const playerIds = roomPlayerIds(room);
  const featureState = initializeFeatureGameState(initial.state, heroes, mutation);
  initializeFeatureSecret(featureState, initial.secret, randomInt ?? cryptoRandomInt);
  return {
    ...room,
    phase: heroes ? "hero_intro" : "playing",
    game: {
      players: { red: assignments.red, black: assignments.black },
      state: featureState,
      secret: initial.secret,
    },
    features: heroes
      ? { ...features, heroIntro: { completed: Object.fromEntries(playerIds.map((id) => [id, false])) } }
      : features,
    featureSecret: { traps: [] },
    messages: [{ id: `system:start:${now}`, kind: "system", text: "对局开始，红方先行。", createdAt: now }],
    chatLastSentAt: {},
    updatedAt: now,
  };
}

function isOwnHalf(side      , position          )          {
  return side === "red" ? position.y >= 5 : position.y <= 4;
}

function cloneTrap(layer           )            {
  return {
    id: layer.id,
    owner: layer.owner,
    position: { ...layer.position },
    opponentTurnsRemaining: layer.opponentTurnsRemaining,
  };
}

function cloneTrapTrigger(trigger             )              {
  return { ...trigger, position: { ...trigger.position } };
}

function resolveTrapsAfterAction(room            , moved          )                                                                {
  const traps = moved.secret.traps?.map(cloneTrap) ?? [];
  const event = moved.state.automaticEvents?.find(e => e.kind === "trap_trigger");
  const consumed = event && room.featureSecret?.traps.find(t => t.owner === event.side && t.position.x === event.position?.x && t.position.y === event.position?.y);
  return { game: moved, traps, ...(event && consumed ? { trigger: { actionId: moved.state.lastMove?.actionId ?? "skill", trapId: consumed.id, owner: consumed.owner, victimPieceId: event.pieceId , position: { ...consumed.position } } } : {}) };
}
function gameWithPrivateTraps(room            )           {
  const game = copy(room.game );
  game.secret.traps = (room.featureSecret?.traps ?? game.secret.traps ?? []).map(cloneTrap);
  return game;
}

function roomWithResolvedTraps(
  room            ,
  moved          ,
  now        ,
)                                              {
  const resolved = resolveTrapsAfterAction(room, moved);
  return {
    room: {
      ...room,
      game: resolved.game,
      featureSecret: { ...(room.featureSecret ?? { traps: [] }), traps: resolved.traps },
      lastTrapTrigger: resolved.trigger,
      phase: resolved.game.state.status === "finished" ? "finished" : room.phase,
      updatedAt: now,
    },
    trigger: resolved.trigger,
  };
}

export function createRemoteRoom(
  roomId        ,
  hostPlayerId        ,
  inviteToken        ,
  now = Date.now(),
  mode                              ,
)             {
  requireText(roomId, "INVALID_ROOM", "房间 ID 不能为空");
  return {
    roomId,
    inviteTokenHash: hashInviteToken(inviteToken),
    seats: { host: makeSeat(hostPlayerId, now) },
    mode: normalizeModeConfig(mode),
    phase: "waiting",
    updatedAt: now,
  };
}

export function joinRemoteRoom(
  room            ,
  guestPlayerId        ,
  inviteToken        ,
  now = Date.now(),
)                 {
  requireText(guestPlayerId, "INVALID_PLAYER", "玩家 ID 不能为空");
  if (!hasMatchingInvite(room, inviteToken)) {
    throw new RuleError("INVALID_INVITE", "邀请链接无效");
  }
  if (room.seats.host.playerId === guestPlayerId) {
    throw new RuleError("HOST_CANNOT_JOIN", "房主不能占用好友席位");
  }
  if (room.seats.guest) {
    if (room.seats.guest.playerId === guestPlayerId) {
      return { room, alreadyJoined: true };
    }
    throw new RuleError("ROOM_FULL", "房间已满");
  }
  ensurePhase(room, "waiting");

  const guest = makeSeat(guestPlayerId, now);
  const rps = createRpsState(room.seats.host.playerId, guest.playerId);
  const playerIds = [room.seats.host.playerId, guest.playerId];
  const heroSelection = room.mode.heroesEnabled
    ? {
        confirmed: Object.fromEntries(playerIds.map((id) => [id, false])),
        deadlineAt: now + HERO_SELECTION_DURATION_MS,
      }
    : undefined;
  return {
    room: {
      ...room,
      seats: { host: { ...room.seats.host }, guest },
      phase: heroSelection ? "hero_selection" : "rps",
      rps: rps.publicState,
      rpsSecret: rps.secretState,
      ...(!heroSelection ? { rpsDeadlineAt: now + RPS_SELECTION_DURATION_MS } : {}),
      ...(heroSelection ? {
        features: { heroSelection },
        featureSecret: { heroSelection: { choices: {} }, traps: [] },
      } : {}),
      disconnects: {
        players: Object.fromEntries(
          playerIds.map((playerId) => [playerId, { accumulatedMs: 0, reconnectCount: 0 }]),
        ),
      },
      updatedAt: now,
    },
    alreadyJoined: false,
  };
}

export function submitRemoteRps(
  room            ,
  playerId        ,
  choice           ,
  round        ,
  randomInt            ,
  now = Date.now(),
)             {
  ensurePhase(room, "rps");
  if (!room.rps || !room.rpsSecret) {
    throw new RuleError("MISSING_RPS", "房间缺少猜拳状态");
  }
  if (room.rpsDeadlineAt !== undefined && now >= room.rpsDeadlineAt) {
    return advanceRemoteRoomTime(room, randomInt, now);
  }
  const nextRps = submitRpsChoice(room.rps, room.rpsSecret, playerId, choice, round);
  if (nextRps.publicState.status !== "resolved") {
    return {
      ...room,
      rps: nextRps.publicState,
      rpsSecret: nextRps.secretState,
      rpsDeadlineAt: nextRps.publicState.round > room.rps.round
        ? now + RPS_SELECTION_DURATION_MS
        : room.rpsDeadlineAt ?? now + RPS_SELECTION_DURATION_MS,
      updatedAt: now,
    };
  }

  const assignments = nextRps.publicState.assignments;
  if (!assignments) throw new RuleError("MISSING_ASSIGNMENT", "猜拳结果缺少红黑方分配");
  const resolvedRoom             = {
    ...room,
    rps: nextRps.publicState,
    rpsSecret: nextRps.secretState,
    rpsDeadlineAt: undefined,
    updatedAt: now,
  };
  let heroes                                  ;
  if (room.mode.heroesEnabled) {
    const choices = room.featureSecret?.heroSelection?.choices;
    const redHero = choices?.[assignments.red];
    const blackHero = choices?.[assignments.black];
    if (!redHero || !blackHero) {
      throw new RuleError("MISSING_HERO_SELECTION", "猜拳前双方必须先确定英雄");
    }
    heroes = { red: redHero, black: blackHero };
  }
  return createGameAfterSetup(
    { ...resolvedRoom, features: undefined, featureSecret: undefined },
    randomInt,
    now,
    heroes,
  );
}

export function submitRemoteHeroSelection(
  room            ,
  playerId        ,
  hero        ,
  randomInt            ,
  now = Date.now(),
)             {
  ensurePhase(room, "hero_selection");
  requireRemotePlayer(room, playerId);
  if (!isHeroId(hero)) {
    throw new RuleError("INVALID_HERO", "英雄选择无效");
  }
  const publicSelection = room.features?.heroSelection;
  const secretSelection = room.featureSecret?.heroSelection;
  if (!publicSelection || !secretSelection) {
    throw new RuleError("MISSING_HERO_SELECTION", "房间缺少英雄选择状态");
  }
  if (now >= publicSelection.deadlineAt) {
    return advanceRemoteRoomTime(room, randomInt, now);
  }
  if (publicSelection.confirmed[playerId] || secretSelection.choices[playerId]) {
    throw new RuleError("HERO_ALREADY_LOCKED", "该玩家已经确定英雄");
  }

  const confirmed = { ...publicSelection.confirmed, [playerId]: true };
  const choices = { ...secretSelection.choices, [playerId]: hero };
  const waitingRoom             = {
    ...room,
    features: { heroSelection: { ...publicSelection, confirmed } },
    featureSecret: { ...room.featureSecret, heroSelection: { choices } },
    updatedAt: now,
  };
  return roomPlayerIds(room).every((id) => confirmed[id])
    ? { ...waitingRoom, phase: "rps", rpsDeadlineAt: now + RPS_SELECTION_DURATION_MS }
    : waitingRoom;
}

export function completeRemoteHeroIntro(
  room            ,
  playerId        ,
  now = Date.now(),
)             {
  ensurePhase(room, "hero_intro");
  requireRemotePlayer(room, playerId);
  const intro = room.features?.heroIntro;
  if (!intro) throw new RuleError("MISSING_HERO_INTRO", "房间缺少英雄入场状态");
  if (intro.completed[playerId]) return room;
  const completed = { ...intro.completed, [playerId]: true };
  const nextRoom             = {
    ...room,
    features: { ...room.features, heroIntro: { completed } },
    updatedAt: now,
  };
  return roomPlayerIds(room).every((id) => completed[id])
    ? beginHeroPreparation(nextRoom, now)
    : nextRoom;
}

function validateTrapDraft(side      , positions                     )       {
  if (positions.length > 2) {
    throw new RuleError("INVALID_TRAP_COUNT", "猎人最多布置两个陷阱层");
  }
  if (positions.some((position) => !isInsideBoard(position) || !isOwnHalf(side, position))) {
    throw new RuleError("INVALID_TRAP_POSITION", "陷阱只能布置在己方半场");
  }
}

export function updateRemoteTrapDraft(
  room            ,
  playerId        ,
  positions                     ,
  now = Date.now(),
)             {
  ensurePhase(room, "hero_preparation");
  if (!room.game) throw new RuleError("MISSING_GAME", "房间尚未创建棋局");
  const side = sideForPlayer(room.game, playerId);
  if (room.features?.heroes?.[side] !== "hunter") {
    throw new RuleError("NOT_HUNTER", "只有猎人可以布置陷阱");
  }
  const preparation = room.features.heroPreparation;
  if (!preparation || !room.featureSecret) {
    throw new RuleError("MISSING_HERO_PREPARATION", "房间缺少英雄准备状态");
  }
  if (now >= preparation.deadlineAt) return advanceRemoteRoomTime(room, undefined, now);
  if (preparation.ready[side]) {
    throw new RuleError("HERO_ALREADY_READY", "该英雄已经完成准备");
  }
  validateTrapDraft(side, positions);
  return {
    ...room,
    featureSecret: {
      ...room.featureSecret,
      trapDrafts: {
        ...room.featureSecret.trapDrafts,
        [side]: positions.map((position) => ({ ...position })),
      },
    },
    updatedAt: now,
  };
}

export function completeRemoteHeroPreparation(
  room            ,
  playerId        ,
  now = Date.now(),
)             {
  ensurePhase(room, "hero_preparation");
  if (!room.game) throw new RuleError("MISSING_GAME", "房间尚未创建棋局");
  const side = sideForPlayer(room.game, playerId);
  const preparation = room.features?.heroPreparation;
  const featureSecret = room.featureSecret;
  if (!preparation || !featureSecret) {
    throw new RuleError("MISSING_HERO_PREPARATION", "房间缺少英雄准备状态");
  }
  if (now >= preparation.deadlineAt) return advanceRemoteRoomTime(room, undefined, now);
  if (preparation.ready[side]) return room;
  const draft = featureSecret.trapDrafts?.[side] ?? [];
  if (room.features?.heroes?.[side] === "hunter" && draft.length !== 2) {
    throw new RuleError("INVALID_TRAP_COUNT", "猎人必须布置两个陷阱层后才能完成准备");
  }
  const addedTraps = draft.map((position, index)            => ({
    id: `trap:${side}:${index}`,
    owner: side,
    position: { ...position },
    opponentTurnsRemaining: 12,
  }));
  const ready = { ...preparation.ready, [side]: true };
  const allReady = ready.red && ready.black;
  const nextSecret                         = {
    traps: [...featureSecret.traps.map(cloneTrap), ...addedTraps],
    trapDrafts: { ...featureSecret.trapDrafts, [side]: [] },
  };
  return {
    ...room,
    phase: allReady ? "playing" : "hero_preparation",
    features: allReady
      ? publicFeaturesAfterPreparation(room.features )
      : { ...room.features, heroPreparation: { ...preparation, ready } },
    featureSecret: nextSecret,
    updatedAt: now,
  };
}

/** Compatibility helper for callers that already submit both layers at once. */
export function submitRemoteTrapSetup(
  room            ,
  playerId        ,
  positions                     ,
  now = Date.now(),
)             {
  return completeRemoteHeroPreparation(
    updateRemoteTrapDraft(room, playerId, positions, now),
    playerId,
    now,
  );
}

export function advanceRemoteRoomTime(
  room            ,
  randomInt            ,
  now = Date.now(),
)             {
  if (room.phase === "playing" && room.game && room.disconnects?.pausedAt === undefined) {
    const timed = copy(room);
    if (timed.game .state.turnDeadlineAt === undefined) startFormalClock(timed.game .state, now);
    if (timed.game .state.status === "playing" && now >= (timed.game .state.turnDeadlineAt ?? Infinity)) {
      timed.game .state.status = "finished"; timed.game .state.winner = otherSide(timed.game .state.turn); timed.game .state.reason = "timeout"; timed.game .state.revision += 1; timed.phase = "finished";
    }
    room = timed;
  }

  room = applyDisconnectTimeout(room, now);
  room = expireRematchInvitation(room, now);
  if (room.phase === "finished" || hasActiveDisconnect(room)) return room;
  if (room.phase === "hero_selection") {
    const selection = room.features?.heroSelection;
    const secret = room.featureSecret?.heroSelection;
    if (!selection || !secret || now < selection.deadlineAt) return room;
    const choices = { ...secret.choices };
    const confirmed = { ...selection.confirmed };
    for (const playerId of roomPlayerIds(room)) {
      if (!confirmed[playerId]) choices[playerId] = drawHero(randomInt);
      confirmed[playerId] = true;
    }
    return {
      ...room,
      phase: "rps",
      rpsDeadlineAt: now + RPS_SELECTION_DURATION_MS,
      features: { heroSelection: { ...selection, confirmed } },
      featureSecret: { ...room.featureSecret, heroSelection: { choices } },
      updatedAt: now,
    };
  }
  if (room.phase === "rps") {
    if (!room.rps || !room.rpsSecret) return room;
    if (room.rpsDeadlineAt === undefined) {
      return { ...room, rpsDeadlineAt: now + RPS_SELECTION_DURATION_MS, updatedAt: now };
    }
    if (now < room.rpsDeadlineAt) return room;
    let nextRoom = room;
    for (const playerId of roomPlayerIds(room)) {
      if (nextRoom.rps?.submitted[playerId]) continue;
      nextRoom = submitRemoteRps(
        nextRoom,
        playerId,
        drawRpsChoice(randomInt),
        nextRoom.rps .round,
        randomInt,
        room.rpsDeadlineAt - 1,
      );
      if (nextRoom.phase !== "rps") break;
    }
    return nextRoom.phase === "rps"
      ? { ...nextRoom, rpsDeadlineAt: now + RPS_SELECTION_DURATION_MS, updatedAt: now }
      : nextRoom;
  }
  if (room.phase !== "hero_preparation") return room;
  const preparation = room.features?.heroPreparation;
  const featureSecret = room.featureSecret;
  if (!preparation || !featureSecret || now < preparation.deadlineAt) return room;
  const traps = featureSecret.traps.map(cloneTrap);
  const trapDrafts = { ...featureSecret.trapDrafts };
  const ready = { ...preparation.ready };
  for (const side of hunterSides(room.features)) {
    if (ready[side]) continue;
    const draft = [...(trapDrafts[side] ?? [])];
    while (draft.length < 2) draft.push(randomOwnHalfPosition(side, randomInt));
    draft.forEach((position, index) => traps.push({
      id: `trap:${side}:${index}`,
      owner: side,
      position: { ...position },
      opponentTurnsRemaining: 12,
    }));
    trapDrafts[side] = [];
    ready[side] = true;
  }
  return {
    ...room,
    phase: "playing",
    features: publicFeaturesAfterPreparation(room.features ),
    featureSecret: { traps, trapDrafts },
    updatedAt: now,
  };
}

function beginRematch(room            , now        )             {
  const playerIds = roomPlayerIds(room);
  const rps = createRpsState(playerIds[0], playerIds[1]);
  const heroSelection = room.mode.heroesEnabled
    ? {
        confirmed: Object.fromEntries(playerIds.map((id) => [id, false])),
        deadlineAt: now + HERO_SELECTION_DURATION_MS,
      }
    : undefined;
  return {
    roomId: room.roomId,
    inviteTokenHash: room.inviteTokenHash,
    seats: clonePublic(room.seats),
    mode: clonePublic(room.mode),
    phase: heroSelection ? "hero_selection" : "rps",
    rps: rps.publicState,
    rpsSecret: rps.secretState,
    ...(!heroSelection ? { rpsDeadlineAt: now + RPS_SELECTION_DURATION_MS } : {}),
    ...(heroSelection ? {
      features: { heroSelection },
      featureSecret: { heroSelection: { choices: {} }, traps: [] },
    } : {}),
    disconnects: {
      players: Object.fromEntries(
        playerIds.map((playerId) => [playerId, { accumulatedMs: 0, reconnectCount: 0 }]),
      ),
    },
    updatedAt: now,
  };
}

export function requestRemoteRematch(
  room            ,
  playerId        ,
  invitationId        ,
  now = Date.now(),
)                     {
  requireRemotePlayer(room, playerId);
  reserveServerActionId(invitationId);
  if (room.phase !== "finished") {
    throw new RuleError("INVALID_PHASE", "只有已经结束的对局可以邀请再战");
  }
  const timed = expireRematchInvitation(room, now);
  if (timed.rematch?.invitationId === invitationId) return { room: timed, duplicate: true };
  if (timed.rematch?.status === "pending") {
    throw new RuleError("REMATCH_PENDING", "已有一项再战邀请正在等待回应");
  }
  return {
    room: {
      ...timed,
      rematch: {
        invitationId,
        requestedBy: playerId,
        deadlineAt: now + REMATCH_INVITATION_DURATION_MS,
        status: "pending",
      },
      updatedAt: now,
    },
    duplicate: false,
  };
}

export function respondRemoteRematch(
  room            ,
  playerId        ,
  accept         ,
  now = Date.now(),
)             {
  requireRemotePlayer(room, playerId);
  if (room.phase !== "finished") {
    throw new RuleError("INVALID_PHASE", "当前没有可以回应的再战邀请");
  }
  const timed = expireRematchInvitation(room, now);
  const invitation = timed.rematch;
  if (!invitation || invitation.status !== "pending") {
    throw new RuleError("REMATCH_UNAVAILABLE", "再战邀请已失效");
  }
  if (invitation.requestedBy === playerId) {
    throw new RuleError("REMATCH_SELF_RESPONSE", "邀请发起者不能回应自己的邀请");
  }
  if (accept) return beginRematch(timed, now);
  return {
    ...timed,
    rematch: { ...invitation, status: "declined", respondedBy: playerId },
    updatedAt: now,
  };
}

/** A late command cannot reset the authority clock before timeout settlement. */
function expiredFormalAction(room            , playerId        , actionId        , now        )                                 {
  if (!room.game) return undefined;
  sideForPlayer(room.game, playerId);
  if (room.game.secret.processedActions[actionId] !== undefined) return undefined;
  if (room.disconnects?.pausedAt !== undefined || room.game.state.turnDeadlineAt === undefined || now < room.game.state.turnDeadlineAt) return undefined;
  const timed = advanceRemoteRoomTime(room, undefined, now);
  return timed.phase === "finished" ? { room: timed, duplicate: false } : undefined;
}

/**
 * Applies one move as a cloud-function transaction would.  A 背刺/裁决 is
 * completed immediately, while its safe visual route is retained for both
 * clients to animate from the same public update.
 */
export function submitRemoteMove(
  room            ,
  playerId        ,
  command             ,
  now = Date.now(),
)                     {
  ensurePhase(room, "playing");
  reserveServerActionId(command.actionId);
  if (!room.game) throw new RuleError("MISSING_GAME", "房间尚未开始棋局");
  const expired = expiredFormalAction(room, playerId, command.actionId, now);
  if (expired) return expired;

  const moved = applyRoomMove(gameWithPrivateTraps(room), playerId, command, now);
  if (moved.duplicate) return { room, duplicate: true };
  const trapped = roomWithResolvedTraps(room, moved.room, now);
  if (trapped.room.game?.state.status === "finished") {
    return { room: withActionHistory(trapped.room, now, command.actionId), duplicate: false };
  }

  if (trapped.room.game?.state.status !== "execution") {
    const nextRoom = {
      ...trapped.room,
      phase: trapped.room.game?.state.status === "finished" ? "finished"          : "playing"         ,
      updatedAt: now,
    };
    return {
      room: withActionHistory(nextRoom, now, command.actionId, undefined, Boolean(room.game.state.flowDance)),
      duplicate: false,
    };
  }

  const plan = getAutomaticExecutionPlan(trapped.room.game.state);
  const reason = trapped.room.game.state.reason;
  if (!plan || (reason !== "ambush" && reason !== "checkmate")) {
    throw new RuleError("MISSING_EXECUTION", "找不到自动终结路线");
  }
  const executionActionId = `server:${command.actionId}:terminal`;
  const finished = applyAutomaticExecution(
    trapped.room.game.state,
    trapped.room.game.secret,
    executionActionId,
  );
  return {
    room: withActionHistory({
      ...trapped.room,
      phase: finished.state.status === "finished" ? "finished" : "playing",
      game: { players: { ...trapped.room.game.players }, state: finished.state, secret: finished.secret },
      terminalAnimation: { eventId: executionActionId, reason, plan },
      updatedAt: now,
    }, now, command.actionId),
    duplicate: false,
  };
}

/** Applies a Rogue/Shadow Dance skill action through the same room transaction. */
export function submitRemoteAssassination(
  room            ,
  playerId        ,
  command                      ,
  now = Date.now(),
)                     {
  ensurePhase(room, "playing");
  reserveServerActionId(command.actionId);
  if (!room.game) throw new RuleError("MISSING_GAME", "房间尚未开始棋局");
  const expired = expiredFormalAction(room, playerId, command.actionId, now);
  if (expired) return expired;

  const moved = applyRoomAssassination(gameWithPrivateTraps(room), playerId, command, now);
  if (moved.duplicate) return { room, duplicate: true };
  const trapped = roomWithResolvedTraps(room, moved.room, now);
  const skill = command.useStrongStrike ? "强击"          : "刺杀"         ;
  if (trapped.room.game?.state.status === "finished") {
    return { room: withActionHistory(trapped.room, now, command.actionId, skill), duplicate: false };
  }
  if (trapped.room.game?.state.status !== "execution") {
    const nextRoom = {
      ...trapped.room,
      phase: trapped.room.game?.state.status === "finished" ? "finished"          : "playing"         ,
      updatedAt: now,
    };
    return {
      room: withActionHistory(nextRoom, now, command.actionId, skill),
      duplicate: false,
    };
  }
  const plan = getAutomaticExecutionPlan(trapped.room.game.state);
  const reason = trapped.room.game.state.reason;
  if (!plan || (reason !== "ambush" && reason !== "checkmate")) {
    throw new RuleError("MISSING_EXECUTION", "找不到自动终结路线");
  }
  const executionActionId = `server:${command.actionId}:terminal`;
  const finished = applyAutomaticExecution(trapped.room.game.state, trapped.room.game.secret, executionActionId);
  return {
    room: withActionHistory({
      ...trapped.room,
      phase: finished.state.status === "finished" ? "finished" : "playing",
      game: { players: { ...trapped.room.game.players }, state: finished.state, secret: finished.secret },
      terminalAnimation: { eventId: executionActionId, reason, plan },
      updatedAt: now,
    }, now, command.actionId, skill),
    duplicate: false,
  };
}

export function surrenderRemoteRoom(
  room            ,
  playerId        ,
  expectedRevision        ,
  actionId        ,
  now = Date.now(),
)                     {
  ensurePhase(room, "playing");
  reserveServerActionId(actionId);
  if (!room.game) throw new RuleError("MISSING_GAME", "房间尚未开始棋局");
  const result = resignRoomGame(room.game, playerId, expectedRevision, actionId);
  if (result.duplicate) return { room, duplicate: true };
  return {
    room: appendSystemMessage(
      { ...room, game: result.room, phase: "finished", updatedAt: now },
      `${sideName(sideForPlayer(room.game, playerId))}认输，对局结束。`,
      now,
      `system:${actionId}`,
    ),
    duplicate: false,
  };
}

export function submitRemoteChat(
  room            ,
  playerId        ,
  messageId        ,
  text        ,
  now = Date.now(),
)                     {
  ensurePhase(room, "playing");
  reserveServerActionId(messageId);
  requireRemotePlayer(room, playerId);
  if (room.messages?.some((message) => message.id === messageId)) return { room, duplicate: true };
  if (/\r|\n/.test(text)) throw new RuleError("CHAT_NEWLINE", "消息不能包含换行");
  const normalized = text.trim();
  if (!normalized) throw new RuleError("CHAT_EMPTY", "消息不能为空");
  if (Array.from(normalized).length > CHAT_MAX_CHARACTERS) {
    throw new RuleError("CHAT_TOO_LONG", `消息不能超过 ${CHAT_MAX_CHARACTERS} 个字符`);
  }
  const lastSentAt = room.chatLastSentAt?.[playerId];
  if (lastSentAt !== undefined && now - lastSentAt < CHAT_COOLDOWN_MS) {
    throw new RuleError("CHAT_COOLDOWN", "消息发送过快");
  }
  const senderSide = sideForAssignedPlayer(room, playerId);
  const next = appendMessage(room, {
    id: messageId,
    kind: "chat",
    text: normalized,
    createdAt: now,
    senderPlayerId: playerId,
    senderSide,
  });
  return {
    room: {
      ...next,
      chatLastSentAt: { ...(room.chatLastSentAt ?? {}), [playerId]: now },
      updatedAt: now,
    },
    duplicate: false,
  };
}

export function forfeitRemoteRoom(
  room            ,
  playerId        ,
  actionId        ,
  now = Date.now(),
)                     {
  if (room.phase === "finished" && room.forfeitOutcome?.actionId === actionId) {
    return { room, duplicate: true };
  }
  if (room.phase === "waiting" || room.phase === "finished") {
    throw new RuleError("INVALID_PHASE", "房间当前阶段不能退出对局");
  }
  if (hasActiveDisconnect(room)) {
    throw new RuleError("MATCH_PAUSED_DISCONNECT", "对局因断线暂停，等待连接恢复");
  }
  reserveServerActionId(actionId);
  requireRemotePlayer(room, playerId);
  const [firstPlayer, secondPlayer] = roomPlayerIds(room);
  const winnerPlayerId = playerId === firstPlayer ? secondPlayer : firstPlayer;
  let game = room.game;
  if (game) {
    const loserSide = sideForPlayer(game, playerId);
    const state = JSON.parse(JSON.stringify(game.state))             ;
    state.status = "finished";
    state.winner = otherSide(loserSide);
    state.reason = "resign";
    state.revision += 1;
    delete state.drawReason;
    game = { players: { ...game.players }, state, secret: game.secret };
  }
  return {
    room: {
      ...room,
      phase: "finished",
      ...(game ? { game } : {}),
      terminalAnimation: undefined,
      forfeitOutcome: { actionId, loserPlayerId: playerId, winnerPlayerId },
      updatedAt: now,
    },
    duplicate: false,
  };
}

export function publicRemoteRoom(room            )                   {
  const publicRoom                   = {
    roomId: room.roomId,
    seats: clonePublic(room.seats),
    mode: clonePublic(room.mode),
    phase: room.phase,
    rps: room.rps ? clonePublic(room.rps) : undefined,
    rpsDeadlineAt: room.rpsDeadlineAt,
    state: room.game ? publicStateSnapshot(room.game.state) : undefined,
    features: room.features ? clonePublic(room.features) : undefined,
    terminalAnimation: room.terminalAnimation
      ? clonePublic(room.terminalAnimation)
      : undefined,
    lastTrapTrigger: room.lastTrapTrigger ? cloneTrapTrigger(room.lastTrapTrigger) : undefined,
    disconnects: cloneDisconnects(room.disconnects),
    disconnectOutcome: room.disconnectOutcome ? clonePublic(room.disconnectOutcome) : undefined,
    forfeitOutcome: room.forfeitOutcome ? clonePublic(room.forfeitOutcome) : undefined,
    rematch: room.rematch ? clonePublic(room.rematch) : undefined,
    messages: room.messages ? clonePublic(room.messages) : undefined,
    updatedAt: room.updatedAt,
  };
  return publicRoom;
}

export function serializePublicRemoteRoom(room            )         {
  return JSON.stringify(publicRemoteRoom(room));
}

export function playerRoomView(
  room            ,
  playerId        ,
)                       {
  requireRemotePlayer(room, playerId);
  const viewerSide = room.game
    ? sideForPlayer(room.game, playerId)
    : room.rps?.assignments
      ? sideForAssignedPlayer(room, playerId)
      : undefined;
  const ownHeroChoice = room.featureSecret?.heroSelection?.choices[playerId]
    ?? (viewerSide ? room.features?.heroes?.[viewerSide] : undefined);
  const ownTrapDraft = viewerSide
    ? room.featureSecret?.trapDrafts?.[viewerSide]?.map((position) => ({ ...position }))
    : undefined;
  const ownTraps = viewerSide && room.features?.heroes?.[viewerSide] === "hunter"
    ? room.featureSecret?.traps
      .filter((trap) => trap.owner === viewerSide)
      .map(cloneTrap) ?? []
    : undefined;
  return {
    ...publicRemoteRoom(room),
    viewerSide,
    ...(ownHeroChoice ? { ownHeroChoice } : {}),
    ...(ownTrapDraft ? { ownTrapDraft } : {}),
    ...(ownTraps ? { ownTraps } : {}),
    ...(viewerSide && room.game ? { ownHeroSecrets: ownerHeroSecrets(room.game.secret, viewerSide) } : {}),
  };
}

/** Throws if a caller is not one of the two authenticated room participants. */
export function requireRemotePlayer(room            , playerId        )       {
  if (!room.game) {
    const players = [room.seats.host.playerId, room.seats.guest?.playerId];
    if (!players.includes(playerId)) throw new RuleError("NOT_PLAYER", "该用户不在本房间");
    return;
  }
  sideForPlayer(room.game, playerId);
}

export function submitRemoteHeroAbility(room            , playerId        , command                    , now = Date.now(), randomInt            )                     {
  ensurePhase(room, "playing"); reserveServerActionId(command.actionId);
  if (!room.game) throw new RuleError("MISSING_GAME", "房间尚未开始棋局");
  const expired = expiredFormalAction(room, playerId, command.actionId, now);
  if (expired) return expired;
  const side = sideForPlayer(room.game, playerId);
  if (room.game.secret.processedActions[command.actionId] === undefined && room.game.state.turn !== side) throw new RuleError("WRONG_TURN", "还没有轮到该玩家");
  const game = gameWithPrivateTraps(room);
  const result = applyHeroAbility(game.state, game.secret, command, now, randomInt);
  if (result.duplicate) return { room, duplicate: true };
  let next             = { ...room, game: { ...game, state: result.state, secret: result.secret }, updatedAt: now };
  if (command.ability === "shadow") return { room: { ...next, updatedAt: room.updatedAt }, duplicate: false };
  next.featureSecret = { ...(room.featureSecret ?? { traps: [] }), traps: result.secret.traps ?? [] };
  if (result.state.status === "execution") {
    const finished = applyAutomaticExecution(result.state, result.secret, `server:${command.actionId}:terminal`);
    next.game = { ...game, state: finished.state, secret: finished.secret };
  }
  next.phase = next.game .state.status === "finished" ? "finished" : "playing";
  if (next.game .state.turn !== room.game.state.turn) startFormalClock(next.game .state, now);
  return { room: next, duplicate: false };
}
