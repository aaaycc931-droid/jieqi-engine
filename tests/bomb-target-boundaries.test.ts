import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAuthoritativeMove, applyHeroAbility, createRemoteRoom, initializeFeatureGameState, initializeFeatureSecret, isGeneralInCheck, joinRemoteRoom, markRevealed, startFormalClock, submitRemoteHeroAbility, submitRemoteMove } from '../src/index.ts';
import type { RemoteRoom } from '../src/remote-room.ts';
import type { HeroAbilityCommand, Position, Side } from '../src/types.ts';
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

// Synthetic room/component fixtures; these are not the half-chaos MA-DS04
// natural opening or any of its 64 acceptance specifications.
function checkedBombRoom(side: Side = 'black'): RemoteRoom {
  const pieces = [
    revealed('dragon', 'black', 'pawn', 4, 1),
    revealed('evader', 'black', 'rook', 0, 0),
    revealed('checker', 'red', 'rook', 1, 0),
    revealed('waiting-pawn', 'red', 'pawn', 0, 6),
  ];
  const state = initializeFeatureGameState(gameState(side === 'black' ? pieces : pieces.map(p => ({
    ...p, color: p.color === 'black' ? 'red' as const : 'black' as const, x: 8 - p.x, y: 9 - p.y,
  })), { turn: side, redGeneral: { x: 4, y: 9 }, blackGeneral: { x: 4, y: 0 } }),
  side === 'black' ? { red: 'nozdormu', black: 'murozond' } : { red: 'murozond', black: 'nozdormu' }, 'end_time');
  const secret = secretState();
  initializeFeatureSecret(state, secret);
  markRevealed(state, secret, 'dragon');
  startFormalClock(state, 1_000, secret);
  const room = joinRemoteRoom(createRemoteRoom('r38-bomb-unit', 'red-player', 'unit-invite', 100), 'black-player', 'unit-invite', 200).room;
  return { ...room, phase: 'playing', game: { players: { red: 'red-player', black: 'black-player' }, state, secret },
    mode: { heroesEnabled: true, mutationsEnabled: true }, features: { heroes: state.featureRules!.heroes, mutation: 'end_time' },
    featureSecret: { traps: [] }, updatedAt: 1_000 };
}

test('R38-BOMB-CHECK-01 either checked side is refused before ammo, quota, pollution, history or clock changes', () => {
  for (const side of ['black', 'red'] as const) {
    const room = checkedBombRoom(side), before = structuredClone(room);
    assert.equal(isGeneralInCheck(room.game!.state, side), true);
    assert.equal(room.game!.state.effectsByPieceId!.dragon.ammunition, 1);
    const command = bomb(room.game!.state, { x: 4, y: side === 'black' ? 2 : 7 });
    assert.throws(() => submitRemoteHeroAbility(room, `${side}-player`, command, 1_100, () => {
      throw new Error('A refused bomb must not consume RNG');
    }), e => (e as { code?: string }).code === 'IN_CHECK');
    assert.deepEqual(room, before);
    assert.equal(room.game!.secret.processedActions[command.actionId], undefined);
    assert.equal(room.game!.secret.processedActions[`bomb:turn:${side}:0`], undefined);
  }
});

test('R38-BOMB-CHECK-02 ordinary evasion closes the old window and a later safe window can bomb without resetting its deadline', () => {
  const room = checkedBombRoom(), command = bomb(room.game!.state, { x: 4, y: 2 });
  assert.throws(() => submitRemoteHeroAbility(room, 'black-player', command, 1_100), e => (e as { code?: string }).code === 'IN_CHECK');
  const evaded = submitRemoteMove(room, 'black-player', move({ x: 0, y: 0 }, { x: 1, y: 0 }, 'r38-evade', room.game!.state.revision), 1_200).room;
  assert.equal(evaded.game!.state.turn, 'red');
  const afterEvasion = structuredClone(evaded);
  assert.throws(() => submitRemoteHeroAbility(evaded, 'black-player', { ...bomb(evaded.game!.state, { x: 4, y: 2 }), actionId: 'r38-old-window' }, 1_300), e => (e as { code?: string }).code === 'WRONG_TURN');
  assert.deepEqual(evaded, afterEvasion);
  const later = submitRemoteMove(evaded, 'red-player', move({ x: 0, y: 6 }, { x: 0, y: 5 }, 'r38-wait', evaded.game!.state.revision), 1_400).room;
  assert.equal(later.game!.state.turn, 'black');
  assert.equal(isGeneralInCheck(later.game!.state, 'black'), false);
  const before = structuredClone(later), deadline = later.game!.state.turnDeadlineAt;
  const hit = submitRemoteHeroAbility(later, 'black-player', { ...bomb(later.game!.state, { x: 4, y: 2 }), actionId: 'r38-safe-bomb' }, 1_500).room;
  assert.deepEqual(later, before);
  assert.equal(hit.game!.state.effectsByPieceId!.dragon.ammunition, 0);
  assert.equal(hit.game!.secret.processedActions['bomb:turn:black:1'], hit.game!.state.revision);
  assert.deepEqual(hit.game!.state.warps, [{ x: 4, y: 2 }]);
  assert.equal(hit.game!.state.turnLifecycle!.phase, 'before_main');
  assert.equal(hit.game!.state.turnDeadlineAt, deadline);
  assert.deepEqual(hit.game!.state.formalTurns, later.game!.state.formalTurns);
  const main = submitRemoteMove(hit, 'black-player', move({ x: 1, y: 0 }, { x: 2, y: 0 }, 'r38-after-bomb', hit.game!.state.revision), 1_600).room;
  assert.equal(main.game!.state.turn, 'red');
  assert.deepEqual(main.game!.state.formalTurns, { red: 1, black: 2 });
});

test('R38-BOMB-CHECK-03 original actor, revision, caster, quota and target refusals retain precedence', () => {
  const cases = [
    { code: 'NOT_PLAYER', actor: 'outsider' },
    { code: 'STALE_REVISION', revision: -1 },
    { code: 'INVALID_BOMBER', emptyAmmo: true },
    { code: 'BOMB_TURN_LIMIT', spentQuota: true },
    { code: 'INVALID_BOMB_TARGET', to: { x: 9, y: 2 } },
  ];
  for (const entry of cases) {
    const room = checkedBombRoom();
    if (entry.emptyAmmo) room.game!.state.effectsByPieceId!.dragon.ammunition = 0;
    if (entry.spentQuota) room.game!.secret.processedActions['bomb:turn:black:0'] = 1;
    const before = structuredClone(room), command = bomb(room.game!.state, entry.to ?? { x: 4, y: 2 });
    if (entry.revision !== undefined) command.expectedRevision = entry.revision;
    assert.throws(() => submitRemoteHeroAbility(room, entry.actor ?? 'black-player', command, 1_100), e => (e as { code?: string }).code === entry.code);
    assert.deepEqual(room, before);
  }
});

test('R38-BOMB-CHECK-04 an expired room request still follows the existing timeout path before the bomb gate', () => {
  const room = checkedBombRoom(), before = structuredClone(room);
  const result = submitRemoteHeroAbility(room, 'black-player', bomb(room.game!.state, { x: 4, y: 2 }), room.game!.state.turnDeadlineAt!);
  assert.equal(result.room.phase, 'finished');
  assert.equal(result.room.game!.state.reason, 'timeout');
  assert.equal(result.room.game!.state.winner, 'red');
  assert.equal(result.room.game!.state.effectsByPieceId!.dragon.ammunition, 1);
  assert.equal(result.room.game!.secret.processedActions['bomb:turn:black:0'], undefined);
  assert.deepEqual(room, before);
});
