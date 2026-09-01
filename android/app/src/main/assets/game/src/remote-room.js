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
import { getController, isInsideBoard } from "./slots.js";
























export const DEFAULT_OPTIONAL_MODE_CONFIG                     = {
  heroesEnabled: false,
  mutationsEnabled: false,
};

const HERO_IDS                    = ["hunter", "rogue", "warrior"];

const MUTATION_IDS                        = [
  "iron_steed",
  "iron_wall",
  "shadow_dance",
  "war_chariot",
  "expedition",
  "cavalry",
];

























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

function drawMutation(randomInt            )             {
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

function ensurePhase(room            , phase                 )       {
  if (room.phase !== phase) {
    throw new RuleError("INVALID_PHASE", "房间当前阶段不能执行此操作");
  }
}

function makeSeat(playerId        , now        )             {
  requireText(playerId, "INVALID_PLAYER", "玩家 ID 不能为空");
  return { playerId, connectedAt: now, lastSeenAt: now };
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

function createGameAfterSetup(
  room            ,
  randomInt                       ,
  now        ,
  heroes                       ,
)             {
  const assignments = assignmentsFor(room);
  const initial = createInitialGame(randomInt);
  const mutation = room.mode.mutationsEnabled ? drawMutation(randomInt) : undefined;
  const features                         = {
    ...(heroes ? { heroes: { ...heroes } } : {}),
    ...(mutation ? { mutation } : {}),
  };
  const hunters = hunterSides(features);
  return {
    ...room,
    phase: hunters.length > 0 ? "trap_setup" : "playing",
    game: {
      players: { red: assignments.red, black: assignments.black },
      state: initializeFeatureGameState(initial.state, heroes, mutation),
      secret: initial.secret,
    },
    features: hunters.length > 0
      ? { ...features, trapSetup: { submitted: {} } }
      : features,
    featureSecret: { traps: [] },
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

function advanceTrapLifetimes(traps             , actingSide      , countsAsFormalTurn         )              {
  if (!countsAsFormalTurn) return traps;
  return traps.flatMap((trap) => {
    if (trap.owner === actingSide) return [trap];
    const next = { ...trap, opponentTurnsRemaining: trap.opponentTurnsRemaining - 1 };
    return next.opponentTurnsRemaining > 0 ? [next] : [];
  });
}

/**
 * Applies exactly one layer after a successful formal move.  The action-side
 * is deliberately checked both before and after reveal/control transfer.
 */
function resolveTrapsAfterAction(
  room            ,
  moved          ,
)                                                                {
  const traps = room.featureSecret?.traps.map(cloneTrap) ?? [];
  const lastMove = moved.state.lastMove;
  if (!lastMove) return { game: moved, traps };
  const landed = moved.state.pieces.find((piece) => piece.id === lastMove.pieceId);
  const eligible = lastMove.landed !== false && landed && getController(landed) === lastMove.actingSide;
  const index = eligible
    ? traps.findIndex((trap) => trap.owner !== lastMove.actingSide && trap.position.x === landed.x && trap.position.y === landed.y)
    : -1;
  if (index >= 0 && landed) {
    const [trap] = traps.splice(index, 1);
    const nextState = JSON.parse(JSON.stringify(moved.state))             ;
    const nextSecret = JSON.parse(JSON.stringify(moved.secret))                      ;
    nextState.pieces = nextState.pieces.filter((piece) => piece.id !== landed.id);
    delete nextState.effectsByPieceId?.[landed.id];
    for (const side of ["red", "black"]         ) {
      if (nextState.assassination?.[side].activePieceId === landed.id) {
        delete nextState.assassination[side].activePieceId;
      }
    }
    if (!landed.faceDown) {
      nextState.captured.push({ id: landed.id, color: landed.color, type: landed.type, capturedBy: trap.owner, moveNumber: nextState.revision });
    }
    // Landing dark pieces have already been revealed by the authoritative move.
    if (!landed.faceDown && landed.type === "general") {
      nextState.status = "finished";
      nextState.winner = trap.owner;
      nextState.reason = "trap_ambush";
    } else {
      reassessAfterTrapResolution(nextState);
    }
    return {
      game: { players: { ...moved.players }, state: nextState, secret: nextSecret },
      traps: advanceTrapLifetimes(traps, lastMove.actingSide, lastMove.countsAsFormalTurn !== false),
      trigger: { actionId: lastMove.actionId, trapId: trap.id, owner: trap.owner, victimPieceId: landed.id, position: { x: landed.x, y: landed.y } },
    };
  }
  // 铁甲提供的额外应将仍可踩中陷阱，但不作为十回合寿命中的正式敌方回合。
  // The tenth enemy move remains valid; remove a layer only after that move resolves.
  return {
    game: moved,
    traps: advanceTrapLifetimes(traps, lastMove.actingSide, lastMove.countsAsFormalTurn !== false),
  };
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
  return {
    room: {
      ...room,
      seats: { host: { ...room.seats.host }, guest },
      phase: "rps",
      rps: rps.publicState,
      rpsSecret: rps.secretState,
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
  const nextRps = submitRpsChoice(room.rps, room.rpsSecret, playerId, choice, round);
  if (nextRps.publicState.status !== "resolved") {
    return {
      ...room,
      rps: nextRps.publicState,
      rpsSecret: nextRps.secretState,
      updatedAt: now,
    };
  }

  const assignments = nextRps.publicState.assignments;
  if (!assignments) throw new RuleError("MISSING_ASSIGNMENT", "猜拳结果缺少红黑方分配");
  const resolvedRoom             = {
    ...room,
    rps: nextRps.publicState,
    rpsSecret: nextRps.secretState,
    updatedAt: now,
  };
  if (room.mode.heroesEnabled) {
    return {
      ...resolvedRoom,
      phase: "hero_selection",
      features: {
        heroSelection: { locked: { red: false, black: false } },
      },
      featureSecret: { heroSelection: { choices: {} }, traps: [] },
    };
  }
  return createGameAfterSetup(resolvedRoom, randomInt, now);
}

export function submitRemoteHeroSelection(
  room            ,
  playerId        ,
  hero        ,
  randomInt            ,
  now = Date.now(),
)             {
  ensurePhase(room, "hero_selection");
  if (!isHeroId(hero)) {
    throw new RuleError("INVALID_HERO", "英雄选择无效");
  }
  const side = sideForAssignedPlayer(room, playerId);
  const publicSelection = room.features?.heroSelection;
  const secretSelection = room.featureSecret?.heroSelection;
  if (!publicSelection || !secretSelection) {
    throw new RuleError("MISSING_HERO_SELECTION", "房间缺少英雄选择状态");
  }
  if (publicSelection.locked[side] || secretSelection.choices[side]) {
    throw new RuleError("HERO_ALREADY_LOCKED", "该方已经锁定英雄");
  }

  const locked = { ...publicSelection.locked, [side]: true };
  const choices = { ...secretSelection.choices, [side]: hero };
  const waitingRoom             = {
    ...room,
    features: { heroSelection: { locked } },
    featureSecret: { ...room.featureSecret, heroSelection: { choices } },
    updatedAt: now,
  };
  if (!locked.red || !locked.black) return waitingRoom;

  const redHero = choices.red;
  const blackHero = choices.black;
  if (!redHero || !blackHero) {
    throw new RuleError("MISSING_HERO_SELECTION", "双方英雄选择不完整");
  }
  return createGameAfterSetup(
    {
      ...waitingRoom,
      features: undefined,
      featureSecret: undefined,
    },
    randomInt,
    now,
    { red: redHero, black: blackHero },
  );
}

export function submitRemoteTrapSetup(
  room            ,
  playerId        ,
  positions                     ,
  now = Date.now(),
)             {
  ensurePhase(room, "trap_setup");
  if (!room.game) throw new RuleError("MISSING_GAME", "房间尚未创建棋局");
  const side = sideForPlayer(room.game, playerId);
  if (room.features?.heroes?.[side] !== "hunter") {
    throw new RuleError("NOT_HUNTER", "只有猎人可以布置陷阱");
  }
  if (positions.length !== 2) {
    throw new RuleError("INVALID_TRAP_COUNT", "猎人必须一次布置两个陷阱层");
  }
  if (positions.some((position) => !isInsideBoard(position) || !isOwnHalf(side, position))) {
    throw new RuleError("INVALID_TRAP_POSITION", "陷阱只能布置在己方半场");
  }
  const publicSetup = room.features.trapSetup;
  const featureSecret = room.featureSecret;
  if (!publicSetup || !featureSecret) {
    throw new RuleError("MISSING_TRAP_SETUP", "房间缺少陷阱布置状态");
  }
  if (publicSetup.submitted[side]) {
    throw new RuleError("TRAPS_ALREADY_SET", "该猎人已经完成陷阱布置");
  }

  const addedTraps = positions.map((position, index)            => ({
    id: `trap:${side}:${index}`,
    owner: side,
    position: { ...position },
    opponentTurnsRemaining: 10,
  }));
  const submitted = { ...publicSetup.submitted, [side]: true };
  const nextSecret                         = {
    traps: [...featureSecret.traps.map(cloneTrap), ...addedTraps],
  };
  const hunters = hunterSides(room.features);
  const allSubmitted = hunters.every((hunter) => submitted[hunter] === true);
  return {
    ...room,
    phase: allSubmitted ? "playing" : "trap_setup",
    features: allSubmitted
      ? {
          ...(room.features.heroes ? { heroes: { ...room.features.heroes } } : {}),
          ...(room.features.mutation ? { mutation: room.features.mutation } : {}),
        }
      : { ...room.features, trapSetup: { submitted } },
    featureSecret: nextSecret,
    updatedAt: now,
  };
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

  const moved = applyRoomMove(room.game, playerId, command);
  if (moved.duplicate) return { room, duplicate: true };
  const trapped = roomWithResolvedTraps(room, moved.room, now);
  if (trapped.room.game?.state.status === "finished") return { room: trapped.room, duplicate: false };

  if (trapped.room.game?.state.status !== "execution") {
    return {
      room: {
        ...trapped.room,
        phase: trapped.room.game?.state.status === "finished" ? "finished" : "playing",
        updatedAt: now,
      },
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
    room: {
      ...trapped.room,
      phase: "finished",
      game: { players: { ...trapped.room.game.players }, state: finished.state, secret: finished.secret },
      terminalAnimation: { eventId: executionActionId, reason, plan },
      updatedAt: now,
    },
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

  const moved = applyRoomAssassination(room.game, playerId, command);
  if (moved.duplicate) return { room, duplicate: true };
  const trapped = roomWithResolvedTraps(room, moved.room, now);
  if (trapped.room.game?.state.status === "finished") return { room: trapped.room, duplicate: false };
  if (trapped.room.game?.state.status !== "execution") {
    return {
      room: {
        ...trapped.room,
        phase: trapped.room.game?.state.status === "finished" ? "finished" : "playing",
        updatedAt: now,
      },
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
    room: {
      ...trapped.room,
      phase: "finished",
      game: { players: { ...trapped.room.game.players }, state: finished.state, secret: finished.secret },
      terminalAnimation: { eventId: executionActionId, reason, plan },
      updatedAt: now,
    },
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
    room: { ...room, game: result.room, phase: "finished", updatedAt: now },
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
    state: room.game ? publicStateSnapshot(room.game.state) : undefined,
    features: room.features ? clonePublic(room.features) : undefined,
    terminalAnimation: room.terminalAnimation
      ? clonePublic(room.terminalAnimation)
      : undefined,
    lastTrapTrigger: room.lastTrapTrigger ? cloneTrapTrigger(room.lastTrapTrigger) : undefined,
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
  const ownHeroChoice = viewerSide
    ? room.featureSecret?.heroSelection?.choices[viewerSide]
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
    ...(ownTraps ? { ownTraps } : {}),
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
