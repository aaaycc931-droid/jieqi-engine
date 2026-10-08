import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAuthoritativeMove, applyHeroAbility, initializeFeatureGameState, initializeFeatureSecret, markRevealed } from '../src/index.ts';
import type { HeroAbilityCommand, Position } from '../src/types.ts';
import { gameState, move, revealed, secretState } from './helpers.ts';

function army() {
  const state = initializeFeatureGameState(gameState([
    revealed('dragon', 'black', 'pawn', 0, 3),
    revealed('second-dragon', 'black', 'pawn', 2, 3),
    revealed('warrior', 'red', 'pawn', 0, 6),
  ], { turn: 'black' }), { red: 'nozdormu', black: 'murozond' }, 'end_time');
  const secret = secretState();
  initializeFeatureSecret(state, secret);
  markRevealed(state, secret, 'dragon');
  markRevealed(state, secret, 'second-dragon');
  return { state, secret };
}
function bomb(state: ReturnType<typeof army>['state'], to: unknown, pieceId = 'dragon'): HeroAbilityCommand {
  return { kind: 'hero_ability', ability: 'bomb', pieceId, to: to as Position, expectedRevision: state.revision, actionId: 'bomb-boundary' };
}
function rejectsWithoutChange(to: unknown) {
  const { state, secret } = army(), beforeState = structuredClone(state), beforeSecret = structuredClone(secret);
  assert.throws(() => applyHeroAbility(state, secret, bomb(state, to)), e => (e as { code?: string }).code === 'INVALID_BOMB_TARGET');
  assert.deepEqual(state, beforeState);
  assert.deepEqual(secret, beforeSecret);
}

test('R5-BOMB-TARGET-01 fractional columns and rows never create off-grid warps or consume a bomb', () => {
  rejectsWithoutChange({ x: 0.5, y: 3 });
  rejectsWithoutChange({ x: 0, y: 3.5 });
});

test('R5-BOMB-TARGET-02 coerced, incomplete and non-finite wire coordinates are rejected transactionally', () => {
  for (const to of [{ x: '1', y: 3 }, { x: 1, y: '3' }, { x: null, y: 4 }, { x: false, y: 4 }, { y: 4 }, { x: NaN, y: 4 }, { x: Infinity, y: 4 }]) rejectsWithoutChange(to);
});

test('R5-BOMB-TARGET-03 board, range, self and existing-warp boundaries reject without consuming the turn quota', () => {
  for (const to of [{ x: -1, y: 3 }, { x: 9, y: 3 }, { x: 0, y: -1 }, { x: 0, y: 10 }, { x: 0, y: 3 }, { x: 0, y: 7 }]) rejectsWithoutChange(to);
  const { state, secret } = army(); state.warps = [{ x: 0, y: 6 }];
  const before = structuredClone({ state, secret });
  assert.throws(() => applyHeroAbility(state, secret, bomb(state, { x: 0, y: 6 })), e => (e as { code?: string }).code === 'INVALID_BOMB_TARGET');
  assert.deepEqual({ state, secret }, before);
  const accepted = applyHeroAbility(state, secret, bomb(state, { x: 1, y: 3 }));
  assert.equal(accepted.state.effectsByPieceId!.dragon.ammunition, 0);
  assert.deepEqual(accepted.state.warps, [{ x: 0, y: 6 }, { x: 1, y: 3 }]);
});

test('R5-BOMB-TARGET-04 exact range-three hit preserves normal main action, replay is free and army quota is shared', () => {
  const { state, secret } = army();
  const command = bomb(state, { x: 0, y: 6 });
  const hit = applyHeroAbility(state, secret, command, 1000);
  assert.deepEqual(hit.state.warps, [{ x: 0, y: 6 }]);
  assert.equal(hit.state.effectsByPieceId!.dragon.ammunition, 0);
  assert.equal(hit.state.effectsByPieceId!['second-dragon'].ammunition, 1);
  assert.equal(hit.state.effectsByPieceId!.warrior.timeCollapse!.expiresAtOwnerTurnEnd, 1);
  assert.deepEqual(hit.state.formalTurns, { red: 0, black: 0 });
  assert.equal(hit.state.turn, 'black');
  assert.equal(hit.state.turnLifecycle!.phase, 'before_main');
  const duplicate = applyHeroAbility(hit.state, hit.secret, command, 1000);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.state, hit.state); assert.deepEqual(duplicate.secret, hit.secret);
  assert.throws(() => applyHeroAbility(hit.state, hit.secret, { ...bomb(hit.state, { x: 2, y: 4 }, 'second-dragon'), actionId: 'second-bomb' }), e => (e as { code?: string }).code === 'BOMB_TURN_LIMIT');
  const main = applyAuthoritativeMove(hit.state, hit.secret, move({ x: 0, y: 3 }, { x: 0, y: 4 }, 'normal-main', hit.state.revision));
  assert.equal(main.state.turn, 'red');
  assert.deepEqual(main.state.formalTurns, { red: 0, black: 1 });
  assert.equal(main.state.effectsByPieceId!['second-dragon'].ammunition, 1);
});
