import assert from "node:assert/strict";
import test from "node:test";
import { applyAutomaticExecution, applyHeroAbility, beginFormalTurn, closeDirectDeaths, destroyPieceBatch, finishFormalTurn, initializeFeatureGameState, initializeFeatureSecret, isGeneralInCheck, putGhostObject, recordAction, closeMainActionAtom, settleHeroDeathResources } from "../src/index.ts";
import { openDestructionBatches } from "../src/settlement-context.ts";
import { gameState, revealed, secretState } from "./helpers.ts";

test("R5-CROSS-01 river expiry records opponent Berserker will before the next action clears events", () => {
  const state = initializeFeatureGameState(gameState([{ ...revealed("river", "red", "rook", 0, 4), layer: "river", river: { source: "jiang_he:front", spaceId: "jiang_he:river", cellId: "0" } }]), { red: "jiang_he", black: "berserker" });
  const secret = secretState(); state.effectsByPieceId!.river = { riverTurns: 1 };
  beginFormalTurn(state, secret, () => 0);
  recordAction(state, { actionId: "river-turn", actingSide: "red", tier: 2, keywords: ["移置"], source: "hero", opportunity: "main", countsAsFormalTurn: true });
  closeMainActionAtom(state, "river-turn"); finishFormalTurn(state, secret, "red", () => 0);
  assert.equal(state.pieces.some(p => p.id === "river"), false);
  assert.equal(state.heroRuntime!.black!.will, 3);
  closeDirectDeaths(state, secret, "red");
  assert.equal(state.heroRuntime!.black!.will, 3, "repeated closure cannot pay twice");
});

test("R5-CROSS-02 one closed destruction batch credits 3+2+1 to the public opponent only once", () => {
  const state = initializeFeatureGameState(gameState([revealed("a", "black", "pawn", 0, 3), revealed("b", "black", "horse", 1, 3), revealed("c", "black", "rook", 2, 3)]), { red: "berserker", black: "hunter" });
  const secret = secretState(); initializeFeatureSecret(state, secret);
  destroyPieceBatch(state, secret, "closed", "test:confirmed_batch", ["a", "b", "c"].map(pieceId => ({ pieceId, by: "red", cause: "destruction" })));
  assert.equal(closeDirectDeaths(state, secret, "red"), false);
  assert.equal(state.heroRuntime!.red!.will, 6);
  closeDirectDeaths(state, secret, "red"); assert.equal(state.heroRuntime!.red!.will, 6);
});

test("R5-CROSS-03 open batch forbids Wind return and resource settlement without mutation", () => {
  const state = initializeFeatureGameState(gameState(), { red: "berserker", black: "wind" });
  const secret = secretState(); initializeFeatureSecret(state, secret);
  openDestructionBatches.set(state, { batchId: "open", targets: [] });
  const before = structuredClone({ state, secret });
  assert.throws(() => closeDirectDeaths(state, secret, "red"), e => e.code === "DESTRUCTION_BATCH_OPEN");
  assert.throws(() => settleHeroDeathResources(state), e => e.code === "DESTRUCTION_BATCH_OPEN");
  assert.deepEqual({ state, secret }, before); openDestructionBatches.delete(state);
});

function pulseWind(hostY: number) {
  const state = initializeFeatureGameState(gameState([revealed("host", "black", "rook", hostY === 1 ? 5 : 4, hostY)], { redGeneral: { x: 5, y: 9 }, blackGeneral: { x: 4, y: 0 } }), { red: "death_knight", black: "wind" }, undefined, { red: "inner" });
  const secret = secretState(); initializeFeatureSecret(state, secret);
  secret.wind!.black!.hostId = "host"; secret.wind!.black!.uses = 1;
  putGhostObject(state, { kind: "inner_ghost", source: "death_knight:inner_death", owner: "red", position: { x: 4, y: 0 }, remaining: 0, persistent: true, layers: 3 }, "add_layers");
  return { state, secret };
}
test("R5-CROSS-04 inner pulse closes Wind return before judging whether the skill relieved check", () => {
  const { state, secret } = pulseWind(1); assert.equal(isGeneralInCheck(state, "red"), true);
  const r = applyHeroAbility(state, secret, { kind: "hero_ability", ability: "inner_ghost_burst", actionId: "pulse", expectedRevision: 0 }, 0, () => 0);
  assert.equal(r.state.status, "playing"); assert.equal(r.state.turn, "black");
  assert.equal(r.secret.wind!.black!.hostId, undefined); assert.equal(r.secret.trueGenerals!.black, "host");
  const general = r.state.pieces.find(p => p.id === "host")!;
  assert.equal(general.faceDown, false); assert.equal(general.type, "general"); assert.deepEqual({ x: general.x, y: general.y }, { x: 4, y: 0 });
  assert.equal(isGeneralInCheck(r.state, "red"), false); assert.equal(r.state.formalTurns!.red, 1);
});
test("R5-CROSS-05 pulse destroying decoy and carrier in one batch never resurrects a true general", () => {
  const { state, secret } = pulseWind(0);
  // Put the carrier on the adjacent cross cell, with two legal ground cells.
  state.pieces.find(p => p.id === "host")!.y = 1;
  const r = applyHeroAbility(state, secret, { kind: "hero_ability", ability: "inner_ghost_burst", actionId: "both", expectedRevision: 0 }, 0, () => 0);
  assert.equal(r.state.status, "finished"); assert.equal(r.state.winner, "red");
  assert.equal(r.state.pieces.some(p => p.id === "host"), false);
  assert.equal(r.state.automaticEvents!.some(e => e.kind === "wind_flow"), false);
  assert.deepEqual(new Set(r.state.destructionBatches![0].destroyedIds), new Set(["host", "black-general"]));
});

function executionWind(uses: number, noEscape: boolean) {
  const state = initializeFeatureGameState(gameState([revealed("host", "red", "rook", 0, 7), revealed("executor", "black", "rook", 3, 0), ...(noEscape ? [revealed("guard", "black", "rook", 4, 0)] : [])]), { red: "wind", black: "hunter" });
  const secret = secretState(); initializeFeatureSecret(state, secret);
  secret.wind!.red!.hostId = "host"; secret.wind!.red!.uses = uses;
  state.status = "execution"; state.turn = "black"; state.winner = "black"; state.reason = "checkmate";
  return { state, secret };
}
test("R5-CROSS-06 first execution return retains dance; second safe return resumes a normal turn without dance", () => {
  const first = executionWind(1, false), second = executionWind(2, false);
  const a = applyAutomaticExecution(first.state, first.secret, "first"); assert.equal(a.state.flowDance!.steps, 0);
  const b = applyAutomaticExecution(second.state, second.secret, "second");
  assert.equal(b.state.flowDance, undefined); assert.equal(b.state.status, "playing"); assert.equal(b.state.turn, "red");
  assert.equal(b.secret.trueGenerals!.red, "host"); assert.equal(b.state.formalTurns!.red, 0);
});
test("R5-CROSS-07 second return with no legal reply finishes execution and deduplicates the original command", () => {
  const a = executionWind(2, true), result = applyAutomaticExecution(a.state, a.secret, "outer-execution");
  assert.equal(result.state.status, "finished"); assert.equal(result.state.winner, "black"); assert.equal(result.state.flowDance, undefined);
  const duplicate = applyAutomaticExecution(result.state, result.secret, "outer-execution");
  assert.equal(duplicate.duplicate, true); assert.deepEqual(duplicate.state, result.state); assert.deepEqual(duplicate.secret, result.secret);
});
test("R5-CROSS-08 failed first dance also records the outer execution command for retries", () => {
  const a = executionWind(1, true), result = applyAutomaticExecution(a.state, a.secret, "failed-first-dance");
  assert.equal(result.state.status, "finished"); assert.equal(result.state.winner, "black");
  assert.equal(result.state.flowDance, undefined);
  const duplicate = applyAutomaticExecution(result.state, result.secret, "failed-first-dance");
  assert.equal(duplicate.duplicate, true); assert.deepEqual(duplicate.state, result.state); assert.deepEqual(duplicate.secret, result.secret);
});
