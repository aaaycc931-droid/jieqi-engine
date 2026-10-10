import type { GameState, SecretState } from "./types.ts";

export interface MechanismEvent {
  kind: "formal_turn_begin" | "formal_turn_end" | "formal_clock_start" | "pupil_grant" | "insight_spend" | "shuffle_reset";
  state: GameState;
  secret: SecretState;
  details: Record<string, unknown>;
}

// Opt-in, synchronous research capture. Nothing is attached to product state or
// player projections. Inactive hooks do not clone, read clocks or consume RNG.
const captures: MechanismEvent[][] = [];

function freezeTree(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeTree(child);
  Object.freeze(value);
}

export function emitMechanismEvent(kind: MechanismEvent["kind"], state: GameState, secret: SecretState, details: Record<string, unknown> = {}): void {
  const events = captures.at(-1);
  if (!events) return;
  const event = structuredClone({ kind, state, secret, details });
  freezeTree(event);
  events.push(event);
}

/** The operation must be synchronous; captured snapshots never alias the game. */
export function captureMechanismEvents<T>(operation: () => T): { result: T; events: readonly MechanismEvent[] } {
  const events: MechanismEvent[] = [];
  captures.push(events);
  try {
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === "function") throw new TypeError("Mechanism capture requires a synchronous operation");
    return { result, events: Object.freeze(events) };
  } finally {
    captures.pop();
  }
}
