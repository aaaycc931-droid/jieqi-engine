import { RuleError } from "./errors.ts";
import { selectedHeroId } from "./hero-forms.ts";
import { hasStealthEffect, isGeneralInCheck } from "./rules.ts";
import { isGround } from "./spaces.ts";
import { isInsideBoard } from "./slots.ts";
import { placementAllowed, queueLanding } from "./settlement.ts";
import type { GameState, HeroAbilityCommand, RevealedPiece, SecretState, Side } from "./types.ts";

export const RELAY_RANGE = 4;
export const RELAY_USES = 2;

/** Public-only candidates: never receives identities, traps or private history. */
export function getRelayTargets(state: GameState, side: Side): RevealedPiece[] {
  return state.pieces.filter((p): p is RevealedPiece => !p.faceDown && p.color === side &&
    p.type !== "general" && isGround(p) && isInsideBoard(p) && !hasStealthEffect(state, p.id));
}

/** Both occupied endpoints are vacated together; no intermediate traversal. */
function placementsFit(state: GameState, a: RevealedPiece, b: RevealedPiece): boolean {
  const vacant = { ...state, pieces: state.pieces.filter(p => p.id !== a.id && p.id !== b.id) };
  return placementAllowed(vacant, a, b) && placementAllowed(vacant, b, a);
}

export function getRelayPairs(state: GameState, side: Side = state.turn): Array<[string, string]> {
  if (selectedHeroId(state, side) !== "siheng" || state.status !== "playing" ||
      (state.heroRuntime?.[side]?.relayUses ?? 0) >= RELAY_USES ||
      state.forcedDefense || state.flowDance || state.pendingShuffle || state.pendingHeroChild ||
      state.pendingDescent || isGeneralInCheck(state, side) ||
      state.pieces.some(p => p.layer === "air" && !p.faceDown && p.color === side && state.effectsByPieceId?.[p.id]?.flight?.forcedLanding)) return [];
  const pool = getRelayTargets(state, side), pairs: Array<[string, string]> = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const a = pool[i], b = pool[j], distance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (distance > 0 && distance <= RELAY_RANGE && placementsFit(state, a, b)) pairs.push([a.id, b.id]);
  }
  return pairs;
}

/** Called only on applyHeroAbility's private candidate, after lifecycle guards.
 * Acceptance depends only on public facts. Hidden landing hazards are committed,
 * never speculatively rejected/refunded (which would reveal a secret trap).
 */
export function applyRelaySwap(state: GameState, _secret: SecretState, side: Side, command: HeroAbilityCommand): void {
  if (selectedHeroId(state, side) !== "siheng") throw new RuleError("WRONG_HERO", "英雄没有换轨技能");
  if (!getRelayPairs(state, side).some(([a, b]) =>
      a === command.pieceId && b === command.partnerId || b === command.pieceId && a === command.partnerId)) {
    throw new RuleError("RELAY_UNAVAILABLE", "换轨需要剩余次数、未受将军，以及距离4内可合法落位的两枚己方明置非将帅地面棋（不能无形）");
  }
  // Canonical ordering makes A/B and B/A identical even with landing effects.
  const ids = [command.pieceId!, command.partnerId!].sort();
  const a = state.pieces.find(p => p.id === ids[0])!, b = state.pieces.find(p => p.id === ids[1])!;
  const fromA = { x: a.x, y: a.y }, fromB = { x: b.x, y: b.y };
  a.x = fromB.x; a.y = fromB.y; b.x = fromA.x; b.y = fromA.y;
  const runtime = (state.heroRuntime ??= {})[side] ??= {};
  runtime.relayUses = (runtime.relayUses ?? 0) + 1;
  queueLanding(state, a, side, "hero:siheng:relay_swap", fromA);
  queueLanding(state, b, side, "hero:siheng:relay_swap", fromB);
  (state.automaticEvents ??= []).push(
    { kind: "relay_swap", pieceId: a.id, side, position: fromB },
    { kind: "relay_swap", pieceId: b.id, side, position: fromA },
  );
}
