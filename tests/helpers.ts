import type {
  CoveredPiece,
  GameState,
  MoveCommand,
  PieceType,
  Position,
  PublicPiece,
  RevealedPiece,
  SecretIdentity,
  SecretState,
  Side,
} from "../src/types.ts";

export function covered(id: string, x: number, y: number): CoveredPiece {
  return { id, x, y, faceDown: true };
}

export function revealed(
  id: string,
  color: Side,
  type: PieceType,
  x: number,
  y: number,
): RevealedPiece {
  return { id, color, type, x, y, faceDown: false };
}

export function gameState(
  extras: PublicPiece[] = [],
  options: {
    turn?: Side;
    redGeneral?: Position;
    blackGeneral?: Position;
    revision?: number;
    status?: "playing" | "execution" | "finished";
  } = {},
): GameState {
  const red = options.redGeneral ?? { x: 3, y: 9 };
  const black = options.blackGeneral ?? { x: 5, y: 0 };
  return {
    status: options.status ?? "playing",
    turn: options.turn ?? "red",
    revision: options.revision ?? 0,
    pieces: [
      revealed("red-general", "red", "general", red.x, red.y),
      revealed("black-general", "black", "general", black.x, black.y),
      ...extras,
    ],
    captured: [],
  };
}

export function secretState(
  identities: Record<string, SecretIdentity> = {},
  processedActions: Record<string, number> = {},
): SecretState {
  return {
    identities: Object.fromEntries(
      Object.entries(identities).map(([id, identity]) => [id, { ...identity }]),
    ),
    processedActions: { ...processedActions },
  };
}

export function move(
  from: Position,
  to: Position,
  actionId = "action-1",
  expectedRevision = 0,
): MoveCommand {
  return { from: { ...from }, to: { ...to }, actionId, expectedRevision };
}

export function seededRandomInt(seed: number): (maxExclusive: number) => number {
  let value = seed >>> 0;
  return (maxExclusive: number) => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value % maxExclusive;
  };
}
