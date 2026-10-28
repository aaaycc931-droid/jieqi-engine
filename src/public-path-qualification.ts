import { RuleError } from "./errors.ts";
import { getClosedPublicPathQueryGap, projectClosedPublicPathAction } from "./game.ts";
import type { ClosedPublicPathQueryGap } from "./game.ts";
import { validatePublicMoveSourceGeometry, pieceAt, pieceById } from "./rules.ts";
import type { PublicMoveOptions } from "./rules.ts";
import { getController, getCurrentPieceType } from "./slots.ts";
import { requireClosedDestructionBatch } from "./settlement-context.ts";
import type { GameState, MoveCommand, Side, SkillSource } from "./types.ts";

export type PublicPathActionIntent =
  | { kind: "move" }
  | { kind: "assassination"; source?: SkillSource; useStrongStrike: boolean };

export type PublicPathQualification =
  | { status: "legal"; basis: "closed_authority_projection" }
  | { status: "illegal"; basis: "public_source_geometry" | "closed_authority_projection"; code: string }
  | { status: "uncovered"; reason: ClosedPublicPathQueryGap | "PRIVATE_STATE_REQUIRED" | "PUBLIC_IDENTITY_UNDEFINED" | "PUBLIC_CONTEXT_INCOMPLETE" | "PUBLIC_CONTEXT_INVALID" | "QUERY_INTENT_NOT_QUALIFIED" };

/** Qualification of one proposed public action, not mode/terminal admission.
 * This API never promotes a legacy boolean result into closed legality. Its
 * uncovered result leaves actual submission and disclosure policy unchanged.
 * No secret, private insight, room credential, action ID or clock is accepted.
 */
export function qualifyPublicPathAction(
  state: GameState,
  move: Pick<MoveCommand, "from" | "to" | "pieceId">,
  side: Side = state.turn,
  intent: PublicPathActionIntent = { kind: "move" },
): PublicPathQualification {
  if (!Array.isArray(state.pieces) || !Array.isArray(state.captured) || !Number.isInteger(state.revision) ||
      !["red", "black"].includes(state.turn) || !["playing", "execution", "finished"].includes(state.status)) {
    return { status: "uncovered", reason: "PUBLIC_CONTEXT_INCOMPLETE" };
  }
  requireClosedDestructionBatch(state);
  if (!intent || !["move", "assassination"].includes(intent.kind) ||
      intent.kind === "assassination" && (typeof intent.useStrongStrike !== "boolean" || intent.source !== undefined && !["hero", "mutation"].includes(intent.source))) {
    return { status: "uncovered", reason: "QUERY_INTENT_NOT_QUALIFIED" };
  }
  try {
    const source = move.pieceId ? pieceById(state, move.pieceId) : pieceAt(state, move.from);
    if (source?.faceDown) {
      // Resolve only the existing current-position definition. An undefined
      // special position remains uncovered; it never falls back to a secret.
      getCurrentPieceType(source); getController(source);
    }
    const continuing = Boolean(source && state.assassination?.[side]?.activePieceId === source.id);
    const options: PublicMoveOptions = intent.kind === "move" ? {} : {
      allowStealthSource: continuing,
      allowStealthTarget: intent.useStrongStrike,
      requireCapture: intent.useStrongStrike,
      assassination: { useStrongStrike: intent.useStrongStrike, ...(intent.source === undefined ? {} : { source: intent.source }) },
    };
    const preflight = validatePublicMoveSourceGeometry(state, move, side, options);
    if (!preflight.ok) return { status: "illegal", basis: "public_source_geometry", code: preflight.code ?? "INVALID_MOVE" };
    const gap = getClosedPublicPathQueryGap(state, move, side, options);
    if (gap) return { status: "uncovered", reason: gap };
    const projection = projectClosedPublicPathAction(state, move, side, options);
    if (!projection) throw new Error("Public path coverage changed during a synchronous query");
    if (projection.validation.code === "MISSING_SECRET") return { status: "uncovered", reason: "PRIVATE_STATE_REQUIRED" };
    return projection.validation.ok
      ? { status: "legal", basis: "closed_authority_projection" }
      : { status: "illegal", basis: "closed_authority_projection", code: projection.validation.code ?? "INVALID_MOVE" };
  } catch (error) {
    if (error instanceof RuleError) {
      if (["UNDEFINED_DARK_IDENTITY", "UNDEFINED_RIVER_CONTROL"].includes(error.code)) return { status: "uncovered", reason: "PUBLIC_IDENTITY_UNDEFINED" };
      if (["INVALID_HERO_SELECTION", "HERO_FORM_LOCKED", "HERO_FORM_UNAVAILABLE"].includes(error.code)) return { status: "uncovered", reason: "PUBLIC_CONTEXT_INVALID" };
    }
    throw error;
  }
}
