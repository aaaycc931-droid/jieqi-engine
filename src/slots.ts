import type {
  CoveredSlot,
  PieceType,
  Position,
  PublicPiece,
  RevealedPiece,
  Side,
} from "./types.ts";

const backRank: Array<Exclude<PieceType, "general"> | "general"> = [
  "rook",
  "horse",
  "elephant",
  "advisor",
  "general",
  "advisor",
  "elephant",
  "horse",
  "rook",
];

function sideSlots(side: Side): CoveredSlot[] {
  const backY = side === "black" ? 0 : 9;
  const cannonY = side === "black" ? 2 : 7;
  const pawnY = side === "black" ? 3 : 6;
  const slots: CoveredSlot[] = [];

  backRank.forEach((type, x) => {
    if (type !== "general") slots.push({ x, y: backY, side, type });
  });

  for (const x of [1, 7]) {
    slots.push({ x, y: cannonY, side, type: "cannon" });
  }

  for (const x of [0, 2, 4, 6, 8]) {
    slots.push({ x, y: pawnY, side, type: "pawn" });
  }

  return slots;
}

export const COVERED_SLOTS: readonly CoveredSlot[] = [
  ...sideSlots("black"),
  ...sideSlots("red"),
];

export const GENERAL_START: Record<Side, Position> = {
  black: { x: 4, y: 0 },
  red: { x: 4, y: 9 },
};

const slotMap = new Map(
  COVERED_SLOTS.map((slot) => [`${slot.x},${slot.y}`, slot] as const),
);

export function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

export function getCoveredSlot(
  x: number,
  y: number,
): CoveredSlot | undefined {
  return slotMap.get(`${x},${y}`);
}

export function requireCoveredSlot(x: number, y: number): CoveredSlot {
  const slot = getCoveredSlot(x, y);
  if (!slot) {
    throw new Error(`暗子不在标准暗子位置：(${x},${y})`);
  }
  return slot;
}

export function getController(piece: PublicPiece): Side {
  return piece.faceDown
    ? requireCoveredSlot(piece.x, piece.y).side
    : piece.color;
}

export function getMovementIdentity(piece: PublicPiece): {
  side: Side;
  type: PieceType;
} {
  if (piece.faceDown) {
    const slot = requireCoveredSlot(piece.x, piece.y);
    return { side: slot.side, type: slot.type };
  }
  return { side: piece.color, type: piece.type };
}

export function createGeneral(side: Side): RevealedPiece {
  return {
    id: `${side}-general`,
    ...GENERAL_START[side],
    faceDown: false,
    color: side,
    type: "general",
  };
}

export function isInsideBoard(position: Position): boolean {
  return (
    Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    position.x >= 0 &&
    position.x <= 8 &&
    position.y >= 0 &&
    position.y <= 9
  );
}

export function otherSide(side: Side): Side {
  return side === "red" ? "black" : "red";
}

export function isInPalace(position: Position, side: Side): boolean {
  if (position.x < 3 || position.x > 5) return false;
  return side === "red"
    ? position.y >= 7 && position.y <= 9
    : position.y >= 0 && position.y <= 2;
}

export function isAcrossRiver(position: Position, side: Side): boolean {
  return side === "red" ? position.y <= 4 : position.y >= 5;
}
