import { applyAuthoritativeMove, applyAutomaticExecution, applyHeroAbility, initializeFeatureGameState } from "../src/index.ts";
import { gameState, move, revealed, secretState } from "./helpers.ts";
import type { GameState, HeroId, MutationId } from "../src/index.ts";

/** Prepared special phase. No claim that every arbitrary fixture is reachable. */
export function flowFixture(extras: GameState["pieces"] = [], mutation?: MutationId, opponent: HeroId = "warrior") {
  const state = initializeFeatureGameState(gameState(extras), { red: "wind", black: opponent }, mutation);
  state.flowDance = { side: "red", pieceId: "red-general", steps: 0, resumeTurn: "red" };
  state.turnStartedAt = 1_000; state.turnDeadlineAt = 61_000;
  return { state, secret: secretState() };
}

/** Uses the actual shadow, ordinary move and automatic execution entry points. */
export function executedWindFixture() {
  const s = initializeFeatureGameState(gameState([
    revealed("host", "red", "pawn", 0, 6),
    revealed("executor", "black", "rook", 3, 6),
    revealed("file-lock", "black", "rook", 4, 5),
    revealed("general-screen", "black", "pawn", 5, 3),
  ]), { red: "wind", black: "hunter" });
  const shadow = applyHeroAbility(s, secretState(), { kind: "hero_ability", ability: "shadow", pieceId: "host", actionId: "shadow", expectedRevision: 0 }, 1_000);
  // The prepared board starts at the opponent's formal action.
  shadow.state.turn = "black";
  const checked = applyAuthoritativeMove(shadow.state, shadow.secret, move({ x: 3, y: 6 }, { x: 3, y: 7 }, "check", 0), false, 2_000);
  if (checked.state.status !== "execution") throw new Error("Fixture must reach actual engine checkmate");
  return applyAutomaticExecution(checked.state, checked.secret, "execute");
}
