import { RuleError } from "./errors.js";
import {
  applyAuthoritativeAssassination,
  applyAuthoritativeMove,
  applyResignation,
} from "./game.js";



















export function sideForPlayer(room          , playerId        )       {
  if (room.players.red === playerId) return "red";
  if (room.players.black === playerId) return "black";
  throw new RuleError("NOT_PLAYER", "该用户不在本房间");
}

export function applyRoomMove(
  room          ,
  playerId        ,
  command             ,
)                                         {
  const side = sideForPlayer(room, playerId);
  const alreadyProcessed =
    room.secret.processedActions[command.actionId] !== undefined;
  if (!alreadyProcessed && room.state.turn !== side) {
    throw new RuleError("WRONG_TURN", "还没有轮到该玩家");
  }
  const result = applyAuthoritativeMove(room.state, room.secret, command);
  return {
    room: {
      players: { ...room.players },
      state: result.state,
      secret: result.secret,
    },
    duplicate: result.duplicate,
  };
}

export function applyRoomAssassination(
  room          ,
  playerId        ,
  command                      ,
)                                         {
  const side = sideForPlayer(room, playerId);
  const alreadyProcessed = room.secret.processedActions[command.actionId] !== undefined;
  if (!alreadyProcessed && room.state.turn !== side) {
    throw new RuleError("WRONG_TURN", "还没有轮到该玩家");
  }
  const result = applyAuthoritativeAssassination(room.state, room.secret, command);
  return {
    room: {
      players: { ...room.players },
      state: result.state,
      secret: result.secret,
    },
    duplicate: result.duplicate,
  };
}

export function resignRoomGame(
  room          ,
  playerId        ,
  expectedRevision        ,
  actionId        ,
)                                         {
  const side = sideForPlayer(room, playerId);
  const result = applyResignation(
    room.state,
    room.secret,
    side,
    expectedRevision,
    actionId,
  );
  return {
    room: {
      players: { ...room.players },
      state: result.state,
      secret: result.secret,
    },
    duplicate: result.duplicate,
  };
}

export function serializePublicRoom(room          )         {
  const publicRoom                 = {
    players: { ...room.players },
    state: JSON.parse(JSON.stringify(room.state))             ,
  };
  return JSON.stringify(publicRoom);
}
