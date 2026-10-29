import type { GameState, SecretState, Side } from "./types.ts";

export interface MechanismEvent {
  kind: "formal_turn_begin" | "formal_main_action" | "formal_turn_end" | "formal_clock_start" | "shuffle_window_clock_start" | "pupil_grant" | "insight_spend" | "shuffle_reset" | "main_action_atom_closed" | "formal_turn_settled" | "authority_random_draw";
  state: GameState;
  secret?: SecretState;
  details: Record<string, unknown>;
  /** Opt-in research output from this immutable checkpoint, never player wire state. */
  checkpointProjection?: unknown;
}

export type AuthorityCheckpointProjector = (checkpoint: Readonly<MechanismEvent>) => unknown;

// Opt-in, synchronous research capture. Nothing is attached to product state or
// player projections. Inactive hooks do not clone, read clocks or consume RNG.
interface Capture {
  events: MechanismEvent[];
  evidenceValid: boolean;
  isolateFailures: boolean;
  projectCheckpoint?: AuthorityCheckpointProjector;
}
const captures: Capture[] = [];

/** Read-only candidate queries must neither publish nor invalidate evidence. */
export function withoutMechanismEvents<T>(operation: () => T): T {
  captures.push({ events: [], evidenceValid: false, isolateFailures: true });
  try {
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === "function") throw new TypeError("Mechanism suppression requires a synchronous operation");
    return result;
  } finally {
    captures.pop();
  }
}

function freezeTree(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeTree(child);
  Object.freeze(value);
}

export function emitMechanismEvent(kind: MechanismEvent["kind"], state: GameState, secret: SecretState | undefined, details: Record<string, unknown> = {}): void {
  const capture = captures.at(-1);
  if (!capture || !capture.evidenceValid) return;
  try {
    const event = structuredClone({ kind, state, secret, details });
    freezeTree(event);
    if (capture.projectCheckpoint && (kind === "main_action_atom_closed" || kind === "formal_turn_settled")) {
      const projected = withoutMechanismEvents(() => capture.projectCheckpoint!(event));
      if (projected && typeof (projected as { then?: unknown }).then === "function") throw new TypeError("Checkpoint projection must be synchronous");
      const projection = structuredClone(projected);
      freezeTree(projection);
      capture.events.push(Object.freeze({ ...event, checkpointProjection: projection }));
    } else capture.events.push(event);
  } catch (error) {
    if (!capture.isolateFailures) throw error;
    capture.events.length = 0;
    capture.evidenceValid = false;
  }
}

/** New authority checkpoints are passive even if their snapshot cannot be made. */
export function emitAuthorityCheckpoint(kind: "main_action_atom_closed" | "formal_turn_settled" | "authority_random_draw", state: GameState, secret: SecretState, details: Record<string, unknown>): void {
  if (!captures.at(-1)?.evidenceValid) return;
  withIsolatedMechanismEvents(() => emitMechanismEvent(kind, state, secret, details));
}

/** Call only after this main source's direct aftermath/children have closed. */
export function emitMainActionAtomClosed(state: GameState, secret: SecretState, side: Side, sourceTerminal = false): void {
  const action = state.lastMove;
  if (!action?.countsAsFormalTurn || action.classification?.opportunity !== "main") return;
  emitAuthorityCheckpoint("main_action_atom_closed", state, secret, { side, actionId: action.actionId, sourceTerminal });
}

/** Buffer candidate events until the same synchronous operation succeeds. */
export function withIsolatedMechanismEvents<T>(operation: () => T): T {
  const parent = captures.at(-1);
  if (!parent) {
    const result = operation(); // Disabled capture does not create snapshots.
    if (result && typeof (result as { then?: unknown }).then === "function") throw new TypeError("Mechanism isolation requires a synchronous operation");
    return result;
  }
  const candidate: Capture = { events: [], evidenceValid: true, isolateFailures: true,
    ...(parent.evidenceValid && parent.projectCheckpoint ? { projectCheckpoint: parent.projectCheckpoint } : {}) };
  captures.push(candidate);
  try {
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === "function") throw new TypeError("Mechanism isolation requires a synchronous operation");
    if (!candidate.evidenceValid) {
      parent.events.length = 0;
      parent.evidenceValid = false;
    } else if (parent.evidenceValid) {
      for (const event of candidate.events) parent.events.push(event);
    }
    return result;
  } finally {
    captures.pop();
  }
}

/** The operation must be synchronous; captured snapshots never alias the game. */
export function captureMechanismEvents<T>(operation: () => T, options: { projectCheckpoint?: AuthorityCheckpointProjector } = {}): { result: T; events: readonly MechanismEvent[]; evidenceValid?: false } {
  const capture: Capture = { events: [], evidenceValid: true, isolateFailures: false, projectCheckpoint: options.projectCheckpoint };
  captures.push(capture);
  try {
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === "function") throw new TypeError("Mechanism capture requires a synchronous operation");
    return { result, events: Object.freeze(capture.events), ...(!capture.evidenceValid ? { evidenceValid: false as const } : {}) };
  } finally {
    captures.pop();
  }
}
