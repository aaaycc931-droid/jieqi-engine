import { RuleError } from "./errors.ts";
import {
  applyAuthoritativeAssassination,
  applyAuthoritativeMove,
  applyResignation,
} from "./game.ts";
import type {
  AssassinationCommand,
  GameState,
  MoveCommand,
  SecretState,
  Side,
} from "./types.ts";

export interface RoomGame {
  players: { red: string; black: string };
  state: GameState;
  secret: SecretState;
}

export interface PublicRoomGame {
  players: { red: string; black: string };
  state: GameState;
}

export function sideForPlayer(room: RoomGame, playerId: string): Side {
  if (room.players.red === playerId) return "red";
  if (room.players.black === playerId) return "black";
  throw new RuleError("NOT_PLAYER", "该用户不在本房间");
}

export function applyRoomMove(
  room: RoomGame,
  playerId: string,
  command: MoveCommand,
): { room: RoomGame; duplicate: boolean } {
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
  room: RoomGame,
  playerId: string,
  command: AssassinationCommand,
): { room: RoomGame; duplicate: boolean } {
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
  room: RoomGame,
  playerId: string,
  expectedRevision: number,
  actionId: string,
): { room: RoomGame; duplicate: boolean } {
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

export function serializePublicRoom(room: RoomGame): string {
  const publicRoom: PublicRoomGame = {
    players: { ...room.players },
    state: JSON.parse(JSON.stringify(room.state)) as GameState,
  };
  return JSON.stringify(publicRoom);
}
