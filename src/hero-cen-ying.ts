import { selectedHeroId } from "./hero-forms.ts";
import { hasStealthEffect, isGeneralInCheck } from "./rules.ts";
import { requireClosedDestructionBatch } from "./settlement-context.ts";
import { placementAllowed } from "./settlement.ts";
import { isGround } from "./spaces.ts";
import { getController, isInsideBoard, otherSide } from "./slots.ts";
import type { GameState, Position, PublicPiece, Side } from "./types.ts";

export const CEN_YING_MAX_PULLS = 2;
export const CEN_YING_MAX_DISTANCE = 3;

export interface CenYingPullOption {
  anchorPieceId: string;
  pieceId: string;
  from: Position;
  to: Position;
}

/** Both ends are direct public designations. A concealed royal host is not probed. */
function canDesignate(state: GameState, piece: PublicPiece, owner: Side): boolean {
  return isGround(piece) && isInsideBoard(piece) && !piece.faceDown && piece.color === owner &&
    piece.type !== "general" && !hasStealthEffect(state, piece.id);
}

/**
 * Public legality only: no SecretState, trap query, hidden identity or action execution.
 * A valid landing may still trigger hidden hazards when the authority commits it.
 */
export function getCenYingPullOptions(state: GameState, side: Side = state.turn): CenYingPullOption[] {
  if ((state.gameMode ?? "jieqi") !== "jieqi" || selectedHeroId(state, side) !== "cen_ying" ||
      state.status !== "playing" || state.turn !== side || state.forcedDefense || state.flowDance ||
      state.pendingShuffle || state.pendingHeroChild || state.pendingDescent ||
      state.turnLifecycle?.side === side && state.turnLifecycle.phase !== "before_main" ||
      (state.heroRuntime?.[side]?.tetherPullUses ?? 0) >= CEN_YING_MAX_PULLS ||
      state.pieces.some(p => p.layer === "air" && getController(p) === side && state.effectsByPieceId?.[p.id]?.flight?.forcedLanding) ||
      isGeneralInCheck(state, side)) return [];

  requireClosedDestructionBatch(state);
  const anchors = state.pieces.filter(p => canDesignate(state, p, side));
  const targets = state.pieces.filter(p => canDesignate(state, p, otherSide(side)));
  const options: CenYingPullOption[] = [];
  for (const anchor of anchors) for (const target of targets) {
    const dx = anchor.x - target.x, dy = anchor.y - target.y;
    const distance = Math.abs(dx) + Math.abs(dy);
    if (dx !== 0 && dy !== 0 || distance < 2 || distance > CEN_YING_MAX_DISTANCE) continue;
    const step = { x: Math.sign(dx), y: Math.sign(dy) };
    const blocked = state.pieces.some(p => isGround(p) && p.id !== anchor.id && p.id !== target.id &&
      Array.from({ length: distance - 1 }, (_, i) => i + 1).some(i =>
        p.x === target.x + i * step.x && p.y === target.y + i * step.y));
    if (blocked) continue;
    const to = { x: target.x + step.x, y: target.y + step.y };
    if (!placementAllowed(state, target, to)) continue;
    const projected: GameState = { ...state, pieces: state.pieces.map(p => p.id === target.id ? { ...p, ...to } : p) };
    if (isGeneralInCheck(projected, side)) continue;
    options.push({ anchorPieceId: anchor.id, pieceId: target.id, from: { x: target.x, y: target.y }, to });
  }
  return options;
}
