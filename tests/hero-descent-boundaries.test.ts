import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, applyHeroAbility, beginFormalTurn, initializeFeatureGameState, isGeneralInCheck } from "../src/index.ts";
import type { GalakrondForm, GameState, HeroAbilityCommand, MutationId } from "../src/types.ts";
import { gameState, move, revealed, secretState } from "./helpers.ts";

function descent(variant: GalakrondForm, pieces: GameState["pieces"] = [], mutation?: MutationId) {
  const state = initializeFeatureGameState(gameState(pieces), { red: "devout_zealot", black: "hunter" }, mutation, undefined, { red: variant });
  const secret = secretState();
  state.heroRuntime!.red!.invokeCount = 4;
  state.heroRuntime!.red!.omen = true;
  beginFormalTurn(state, secret, () => 0);
  return { state, secret };
}
function deploy(state: GameState, placements: HeroAbilityCommand["placements"]): HeroAbilityCommand {
  return { kind: "hero_ability", ability: "ascension", actionId: "deploy", expectedRevision: state.revision, placements };
}

test("R5-DESCENT-01 nightmare cannot enter a fortress-sealed opposing palace; rejection is atomic", () => {
  const a = descent("nightmare", [revealed("actor", "red", "horse", 0, 6)], "iron_wall");
  const before = structuredClone(a);
  assert.throws(() => applyHeroAbility(a.state, a.secret, deploy(a.state, [{ pieceId: "actor", to: { x: 4, y: 1 } }])), e => e.code === "INVALID_DESCENT_SPACE");
  assert.deepEqual(a, before);
  const outside = applyHeroAbility(a.state, a.secret, deploy(a.state, [{ pieceId: "actor", to: { x: 0, y: 3 } }]));
  assert.equal(outside.state.pendingDescent, undefined);
  assert.equal(outside.state.turnLifecycle!.phase, "before_main");
});

test("R5-DESCENT-02 fortress still permits a piece already inside the opposing palace to redeploy inside", () => {
  const a = descent("nightmare", [revealed("actor", "red", "horse", 3, 2)], "iron_wall");
  const r = applyHeroAbility(a.state, a.secret, deploy(a.state, [{ pieceId: "actor", to: { x: 4, y: 1 } }]));
  assert.deepEqual(r.state.pieces.find(p => p.id === "actor"), revealed("actor", "red", "horse", 4, 1));
  assert.equal(r.state.formalTurns!.red, 0);
});

test("R5-DESCENT-03 nightmare checks the final landing state: a checking rook destroyed by a landing trap does not invalidate deployment", () => {
  const a = descent("nightmare", [revealed("actor", "red", "rook", 0, 6)]);
  a.secret.traps = [{ id: "landing-trap", owner: "black", position: { x: 5, y: 3 }, opponentTurnsRemaining: 12 }];
  const command = deploy(a.state, [{ pieceId: "actor", to: { x: 5, y: 3 } }]);
  const r = applyHeroAbility(a.state, a.secret, command);
  assert.equal(r.state.captured.find(p => p.id === "actor")!.cause, "trap_ambush");
  assert.equal(r.state.pieces.some(p => p.id === "actor"), false);
  assert.equal(isGeneralInCheck(r.state, "black"), false);
  assert.equal(r.state.pendingDescent, undefined);
  assert.equal(r.state.status, "playing");
  assert.equal(r.state.turnLifecycle!.phase, "before_main");
  assert.equal(r.state.formalTurns!.red, 0);
  const duplicate = applyHeroAbility(r.state, r.secret, command);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.state, r.state);
  assert.deepEqual(duplicate.secret, r.secret);
});

test("R5-DESCENT-04 nightmare still rejects a surviving final check without consuming the pending deployment", () => {
  const a = descent("nightmare", [revealed("actor", "red", "rook", 0, 6)]);
  const before = structuredClone(a);
  assert.throws(() => applyHeroAbility(a.state, a.secret, deploy(a.state, [{ pieceId: "actor", to: { x: 5, y: 3 } }])), e => e.code === "DESCENT_CHECK");
  assert.deepEqual(a, before);
});

test("R5-DESCENT-05 storm with both summons killed on landing closes its empty assault window and permits the normal main action", () => {
  const a = descent("storm", [revealed("main", "red", "rook", 0, 7)]);
  a.secret.traps = [0, 1].map(x => ({ id: `trap-${x}`, owner: "black" as const, position: { x, y: 6 }, opponentTurnsRemaining: 12 }));
  const command = deploy(a.state, a.state.pendingDescent!.pieces.map((p, x) => ({ pieceId: p.id, to: { x, y: 6 } })));
  const r = applyHeroAbility(a.state, a.secret, command);
  assert.equal(r.state.captured.length, 2);
  assert.equal(r.state.pendingDescent, undefined);
  assert.equal(r.state.turnLifecycle!.phase, "before_main");
  assert.equal(r.state.formalTurns!.red, 0);
  const next = applyAuthoritativeMove(r.state, r.secret, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "normal-main", r.state.revision));
  assert.equal(next.state.formalTurns!.red, 1);
  assert.equal(next.state.turn, "black");
});

test("R5-DESCENT-06 storm with one surviving summon retains exactly its one optional assault", () => {
  const a = descent("storm");
  a.secret.traps = [{ id: "one-trap", owner: "black", position: { x: 0, y: 6 }, opponentTurnsRemaining: 12 }];
  const pieces = a.state.pendingDescent!.pieces;
  const r = applyHeroAbility(a.state, a.secret, deploy(a.state, pieces.map((p, x) => ({ pieceId: p.id, to: { x, y: 6 } }))));
  assert.deepEqual(r.state.pendingDescent!.assaultIds, [pieces[1].id]);
  assert.equal(r.state.turnLifecycle!.phase, "turn_start");
  const skipped = applyHeroAbility(r.state, r.secret, { kind: "hero_ability", ability: "storm_assault", skip: true, actionId: "skip-survivor", expectedRevision: r.state.revision });
  assert.equal(skipped.state.pendingDescent, undefined);
  assert.equal(skipped.state.turnLifecycle!.phase, "before_main");
  assert.equal(skipped.state.formalTurns!.red, 0);
});
