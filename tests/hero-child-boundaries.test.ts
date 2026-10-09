import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, applyHeroAbility, initializeFeatureGameState } from "../src/index.ts";
import { gameState, move, revealed, secretState } from "./helpers.ts";

function chargeWindow() {
  const state = initializeFeatureGameState(gameState([
    revealed("actor", "red", "rook", 0, 7),
    revealed("first", "black", "pawn", 0, 6),
    revealed("defender", "black", "horse", 1, 6),
    revealed("other-defender", "black", "horse", 7, 3),
  ]), { red: "berserker", black: "warrior" });
  state.heroRuntime!.red!.will = 6;
  state.effectsByPieceId!.defender = { barrier: { owner: "black", enemyTurnsRemaining: 3 } };
  state.effectsByPieceId!["other-defender"] = { barrier: { owner: "black", enemyTurnsRemaining: 3 } };
  return applyAuthoritativeMove(state, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }, "parent"));
}

test("R5-CHILD-01 charge attack bounced by barrier closes its parent formal turn exactly once", () => {
  const pending = chargeWindow();
  assert.equal(pending.state.pendingHeroChild!.kind, "charge");
  const command = { kind: "hero_ability" as const, ability: "charge_attack" as const, to: { x: 1, y: 6 }, actionId: "child-bounce", expectedRevision: pending.state.revision };
  const result = applyHeroAbility(pending.state, pending.secret, command);
  assert.deepEqual(result.state.formalTurns, { red: 1, black: 0 });
  assert.equal(result.state.turn, "black");
  assert.equal(result.state.turnLifecycle!.side, "black");
  assert.equal(result.state.turnLifecycle!.phase, "before_main");
  assert.equal(result.state.lastCompletedFormalTurn!.mainActionId, "parent");
  assert.equal(result.state.lastCompletedFormalTurn!.phases.at(-1), "turn_end");
  assert.equal(result.state.pendingHeroChild, undefined);
  assert.equal(result.state.heroRuntime!.red!.will, 3);
  assert.equal(result.state.heroRuntime!.red!.chargeCount, 1);
  assert.equal(result.state.lastMove!.countsAsFormalTurn, false);
  assert.equal(result.state.lastMove!.bouncedAgainstPieceId, "defender");
  assert.equal(result.state.effectsByPieceId!.defender?.barrier, undefined);
  assert.equal(result.state.effectsByPieceId!["other-defender"].barrier!.enemyTurnsRemaining, 2);
  assert.deepEqual(result.state.pieces.find(p => p.id === "actor"), revealed("actor", "red", "rook", 0, 6));
  assert.equal(result.state.pieces.some(p => p.id === "defender"), true);
  assert.equal(result.secret.history!.length, 1);
  const duplicate = applyHeroAbility(result.state, result.secret, command);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.state, result.state);
  assert.deepEqual(duplicate.secret, result.secret);
});

test("R5-CHILD-02 deferred barrier bounce never starts the next formal turn inside the move primitive", () => {
  const pending = chargeWindow();
  delete pending.state.pendingHeroChild;
  const result = applyAuthoritativeMove(pending.state, pending.secret, move({ x: 0, y: 6 }, { x: 1, y: 6 }, "deferred", pending.state.revision), true, 0, { parentActionId: "parent" });
  assert.equal(result.state.turn, "red");
  assert.deepEqual(result.state.formalTurns, { red: 0, black: 0 });
  assert.equal(result.state.turnLifecycle!.mainActionId, "parent");
  assert.equal(result.state.turnLifecycle!.phase, "atom_closure");
  assert.equal(result.state.lastCompletedFormalTurn, undefined);
  assert.equal(result.state.effectsByPieceId!["other-defender"].barrier!.enemyTurnsRemaining, 3);
  assert.equal(result.state.lastMove!.classification!.opportunity, "child");
});

test("R5-CHILD-03 ordinary barrier bounce still completes one ordinary formal turn", () => {
  const state = initializeFeatureGameState(gameState([revealed("actor", "red", "rook", 0, 7), revealed("defender", "black", "horse", 0, 6)]), { red: "hunter", black: "warrior" });
  state.effectsByPieceId!.defender = { barrier: { owner: "black", enemyTurnsRemaining: 3 } };
  const result = applyAuthoritativeMove(state, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }, "ordinary"));
  assert.deepEqual(result.state.formalTurns, { red: 1, black: 0 });
  assert.equal(result.state.turn, "black");
  assert.equal(result.state.lastMove!.countsAsFormalTurn, true);
  assert.equal(result.state.lastCompletedFormalTurn!.mainActionId, "ordinary");
});
