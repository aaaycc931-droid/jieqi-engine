import { COVERED_SLOTS, createGeneral } from "./slots.ts";
import type {
  GameState,
  PieceType,
  RandomInt,
  SecretIdentity,
  SecretState,
  Side,
} from "./types.ts";

const nonGeneralCounts: ReadonlyArray<
  readonly [Exclude<PieceType, "general">, number]
> = [
  ["rook", 2],
  ["horse", 2],
  ["elephant", 2],
  ["advisor", 2],
  ["cannon", 2],
  ["pawn", 5],
];

export function createIdentityPool(): SecretIdentity[] {
  const pool: SecretIdentity[] = [];
  for (const color of ["red", "black"] as const) {
    for (const [type, count] of nonGeneralCounts) {
      for (let index = 0; index < count; index += 1) {
        pool.push({ color, type });
      }
    }
  }
  return pool;
}

export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError("maxExclusive 必须是正整数");
  }

  const range = 0x1_0000_0000;
  const limit = Math.floor(range / maxExclusive) * maxExclusive;
  const value = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % maxExclusive;
}

export function shuffleIdentities(
  identities: readonly SecretIdentity[],
  randomInt: RandomInt,
): SecretIdentity[] {
  const shuffled = identities.map((identity) => ({ ...identity }));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    if (
      !Number.isInteger(swapIndex) ||
      swapIndex < 0 ||
      swapIndex > index
    ) {
      throw new RangeError(`随机数超出范围：${swapIndex}`);
    }
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

export function createInitialGame(
  randomInt: RandomInt = secureRandomInt,
): { state: GameState; secret: SecretState } {
  const shuffled = shuffleIdentities(createIdentityPool(), randomInt);
  const identities: Record<string, SecretIdentity> = {};
  const coveredPieces = COVERED_SLOTS.map((slot, index) => {
    const id = `covered-${String(index).padStart(2, "0")}`;
    identities[id] = { ...shuffled[index] };
    return { id, x: slot.x, y: slot.y, faceDown: true as const };
  });

  return {
    state: {
      status: "playing",
      turn: "red",
      revision: 0,
      pieces: [createGeneral("black"), createGeneral("red"), ...coveredPieces],
      captured: [],
    },
    secret: {
      identities,
      processedActions: {},
    },
  };
}

export function countPoolByColorAndType(
  identities: readonly SecretIdentity[],
): Record<Side, Record<Exclude<PieceType, "general">, number>> {
  const result = {
    red: { rook: 0, horse: 0, elephant: 0, advisor: 0, cannon: 0, pawn: 0 },
    black: { rook: 0, horse: 0, elephant: 0, advisor: 0, cannon: 0, pawn: 0 },
  };
  for (const identity of identities) {
    if (identity.type !== "general") result[identity.color][identity.type] += 1;
  }
  return result;
}
