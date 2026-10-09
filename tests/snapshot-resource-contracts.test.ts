import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeAssassination, applyAuthoritativeMove, applyHeroAbility, initializeFeatureGameState, initializeFeatureSecret } from "../src/index.ts";
import type { GameState, HeroAbilityCommand, HeroId, MoveResult, SecretState } from "../src/index.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";

const skill = (ability: HeroAbilityCommand["ability"], state: GameState) => ({ kind: "hero_ability" as const, ability, actionId: `resource:${ability}:${state.revision}`, expectedRevision: state.revision });
function firstMove(hero: HeroId, extras: GameState["pieces"] = [], secret: SecretState = secretState()) {
  const state = initializeFeatureGameState(gameState([revealed("mover", "red", "rook", 0, 7), ...extras]), { red: "nozdormu", black: hero });
  state.turnStartedAt = 0; state.turnDeadlineAt = 60_000;
  initializeFeatureSecret(state, secret);
  const before = structuredClone({ state, secret });
  return { before, first: applyAuthoritativeMove(state, secret, move({ x: 0, y: 7 }, { x: 0, y: 6 }, "first"), false, 55_000) };
}
function rewind(reply: MoveResult, before: { state: GameState; secret: SecretState }) {
  reply.state.turnStartedAt = 63_000; reply.state.turnDeadlineAt = 123_000;
  const r = applyHeroAbility(reply.state, reply.secret, skill("rewind", reply.state), 64_000);
  assert.deepEqual(r.state.pieces, before.state.pieces);
  assert.deepEqual(r.state.captured, before.state.captured);
  assert.deepEqual(r.state.heroRuntime, before.state.heroRuntime);
  assert.deepEqual(r.state.assassination, before.state.assassination);
  assert.deepEqual(r.state.warrior, before.state.warrior);
  assert.deepEqual(r.state.effectsByPieceId, before.state.effectsByPieceId);
  assert.deepEqual(r.state.ghosts, before.state.ghosts);
  assert.deepEqual(r.state.formalTurns, before.state.formalTurns);
  assert.deepEqual(r.secret.identities, before.secret.identities);
  assert.equal(r.secret.rewindUsed?.red, true);
  assert.equal(r.secret.replay?.deadlineAt, 69_000);
  // Transport deduplication remains outside the restored game timeline.
  for (const id of Object.keys(reply.secret.processedActions)) assert.equal(r.secret.processedActions[id], reply.secret.processedActions[id]);
  assert.deepEqual(r.state.landingEvents ?? [], []);
  assert.deepEqual(r.state.automaticEvents ?? [], []);
  return r;
}

test("SNAP-RESOURCE-01 rewind restores destruction charge, deaths and reveal after a committed random set", () => {
  const { first, before } = firstMove("deathwing", [covered("hidden", 2, 3), revealed("reply", "black", "pawn", 4, 3)], secretState({ hidden: { color: "black", type: "horse" } }));
  const destroyed = applyHeroAbility(first.state, first.secret, skill("destruction", first.state), 62_000, () => 0);
  assert.equal(destroyed.state.heroRuntime!.black!.used, true);
  assert.equal(destroyed.state.captured.length, 3);
  const r = rewind(destroyed, before);
  assert.equal(r.state.heroRuntime!.black!.used, false);
  // Replaying the same command is still a transport duplicate, not another destruction.
  const duplicate = applyHeroAbility(r.state, r.secret, skill("destruction", first.state), 65_000);
  assert.equal(duplicate.duplicate, true); assert.deepEqual(duplicate.state, r.state);
});

test("SNAP-RESOURCE-02 rewind restores invocation progress and formal counts", () => {
  const { first, before } = firstMove("devout_zealot");
  const invoked = applyHeroAbility(first.state, first.secret, skill("invoke", first.state), 62_000);
  assert.equal(invoked.state.heroRuntime!.black!.invokeCount, 1);
  rewind(invoked, before);
});

test("SNAP-RESOURCE-03 rewind restores assassination charge and removes newly activated stealth", () => {
  const { first, before } = firstMove("rogue", [revealed("striker", "black", "rook", 2, 2)]);
  const hidden = applyAuthoritativeAssassination(first.state, first.secret, { ...move({ x: 2, y: 2 }, { x: 2, y: 3 }, "conceal", first.state.revision), kind: "assassination", source: "hero", useStrongStrike: false }, 62_000);
  assert.equal(hidden.state.assassination!.black.heroChargeAvailable, false);
  assert.ok(hidden.state.effectsByPieceId?.striker?.stealth);
  const r = rewind(hidden, before);
  assert.equal(r.state.assassination!.black.heroChargeAvailable, true);
  assert.equal(r.state.assassination!.black.activePieceId, undefined);
});

test("SNAP-RESOURCE-04 rewind restores Warrior qualification IDs and removes a newly earned barrier", () => {
  const { first, before } = firstMove("warrior", [revealed("guard", "black", "rook", 4, 2)]);
  const out = applyAuthoritativeMove(first.state, first.secret, move({ x: 4, y: 2 }, { x: 4, y: 3 }, "leave-palace", first.state.revision), false, 62_000);
  assert.deepEqual(out.state.warrior!.black.barrierPieceIds, ["guard"]);
  assert.equal(out.state.effectsByPieceId?.guard?.barrier?.enemyTurnsRemaining, 3);
  rewind(out, before);
});

test("SNAP-RESOURCE-05 rewind restores self-captured covered identity and erases a newly generated ghost", () => {
  const { first, before } = firstMove("death_knight", [revealed("captor", "black", "rook", 2, 2), covered("sacrifice", 2, 3)], secretState({ sacrifice: { color: "black", type: "pawn" } }));
  const died = applyAuthoritativeMove(first.state, first.secret, move({ x: 2, y: 2 }, { x: 2, y: 3 }, "self-capture", first.state.revision), false, 62_000);
  assert.equal(died.state.captured[0].id, "sacrifice");
  assert.deepEqual(died.state.ghosts, [{ kind: "ghost", source: "death_knight:death", owner: "black", position: { x: 2, y: 3 }, remaining: 2 }]);
  rewind(died, before);
});
