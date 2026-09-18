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
import {
  MUTATION_IDS,
  mutationDefinition,

} from "./mutations.js";

























export const HERO_SELECTION_DURATION_MS = 60_000;
export const HERO_PREPARATION_DURATION_MS = 60_000;

export const DEFAULT_OPTIONAL_MODE_CONFIG                     = {
  heroesEnabled: false,
  mutationsEnabled: false,
};

const HERO_IDS                    = ["hunter", "rogue", "warrior"];































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

function drawHero(randomInt            )         {
  const index = (randomInt ?? ((maxExclusive) => cryptoRandomInt(maxExclusive)))(HERO_IDS.length);
  if (!Number.isInteger(index) || index < 0 || index >= HERO_IDS.length) {
    throw new RangeError(`英雄随机数超出范围：${index}`);
  }
  return HERO_IDS[index];
}

function drawMutation(randomInt            )             {
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

function ensurePhase(room            , phase                 )       {
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
  const mutation = room.mode.mutationsEnabled ? drawMutation(randomInt) : undefined;
  const features                         = {
    ...(heroes ? { heroes: { ...heroes } } : {}),
    ...(mutation ? { mutation, mutationRarity: mutationDefinition(mutation).rarity } : {}),
  };
  const playerIds = roomPlayerIds(room);
  return {
    ...room,
    phase: heroes ? "hero_intro" : "playing",
    game: {
      players: { red: assignments.red, black: assignments.black },
      state: initializeFeatureGameState(initial.state, heroes, mutation),
      secret: initial.secret,
    },
    features: heroes
      ? { ...features, heroIntro: { completed: Object.fromEntries(playerIds.map((id) => [id, false])) } }
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
      ...(heroSelection ? {
        features: { heroSelection },
        featureSecret: { heroSelection: { choices: {} }, traps: [] },
      } : {}),
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
    ? { ...waitingRoom, phase: "rps" }
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
    opponentTurnsRemaining: 10,
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
      features: { heroSelection: { ...selection, confirmed } },
      featureSecret: { ...room.featureSecret, heroSelection: { choices } },
      updatedAt: now,
    };
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
      opponentTurnsRemaining: 10,
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
