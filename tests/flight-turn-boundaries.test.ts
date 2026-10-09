import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAuthoritativeMove, applyHeroAbility, configureHeroPreparation, getLegalMoves, initializeFeatureGameState } from '../src/index.ts';
import type { HeroAbilityCommand } from '../src/types.ts';
import { covered, gameState, move, revealed, secretState } from './helpers.ts';

function dueFlight(flyerMoves = false) {
  const state = initializeFeatureGameState(gameState([
    covered('trainee', 0, 6), revealed('mover', 'red', 'rook', 2, 7), revealed('reply', 'black', 'rook', 6, 2),
    ...(flyerMoves ? [revealed('return-ground', 'red', 'horse', 0, 4), revealed('destination-ground', 'black', 'pawn', 1, 4)] : []),
  ]), { red: 'sky_admiral', black: 'murozond' });
  const secret = secretState({ trainee: { color: 'red', type: 'pawn' } });
  configureHeroPreparation(state, secret, 'red', { trainingType: 'pawn' }, () => 0);
  let r = applyAuthoritativeMove(state, secret, move({ x: 2, y: 7 }, { x: 2, y: 6 }, 'training-first'));
  r = applyAuthoritativeMove(r.state, r.secret, move({ x: 6, y: 2 }, { x: 6, y: 3 }, 'training-reply', r.state.revision));
  assert.equal(r.secret.training!.red!.graduated, true);
  for (let i = 0; i < 3; i++) {
    r = applyAuthoritativeMove(r.state, r.secret, {
      ...move(flyerMoves ? { x: 0, y: 6 - i } : { x: 2, y: i % 2 === 0 ? 6 : 7 }, flyerMoves ? { x: 0, y: 5 - i } : { x: 2, y: i % 2 === 0 ? 7 : 6 }, `flight-turn-${i}`, r.state.revision),
      pieceId: flyerMoves ? 'trainee' : 'mover',
    });
    if (i < 2) r = applyAuthoritativeMove(r.state, r.secret, move({ x: 6, y: i % 2 === 0 ? 3 : 2 }, { x: 6, y: i % 2 === 0 ? 2 : 3 }, `flight-reply-${i}`, r.state.revision));
  }
  assert.equal(r.state.turn, 'black');
  assert.deepEqual(r.state.formalTurns, { red: 4, black: 3 });
  assert.equal(r.state.effectsByPieceId!.trainee.flight!.remainingOwnerTurns, 0);
  assert.equal(r.state.effectsByPieceId!.trainee.flight!.forcedLanding, true);
  return r;
}
const skill = (s: ReturnType<typeof dueFlight>['state'], ability: HeroAbilityCommand['ability'], rest: Partial<HeroAbilityCommand> = {}): HeroAbilityCommand => ({ kind: 'hero_ability', ability, actionId: `flight:${ability}:${s.revision}`, expectedRevision: s.revision, ...rest });

test('R5-FLIGHT-TURN-01 next-turn landing obligation does not cancel the opponent timeline ground-piece child', () => {
  const a = dueFlight();
  const command = skill(a.state, 'timeline_twist', { to: { x: 2, y: 5 } });
  const r = applyHeroAbility(a.state, a.secret, command);
  assert.deepEqual(r.state.pieces.find(p => p.id === 'mover'), revealed('mover', 'red', 'rook', 2, 5));
  assert.deepEqual(r.state.formalTurns, { red: 4, black: 4 });
  assert.equal(r.state.turn, 'red');
  assert.equal(r.state.turnLifecycle!.number, 5);
  assert.equal(r.state.effectsByPieceId!.trainee.flight!.forcedLanding, true);
  assert.equal(r.secret.training!.red!.progress, 2);
  assert.equal(getLegalMoves(r.state, 'mover').length, 0);
  const before = structuredClone(r);
  assert.throws(() => applyAuthoritativeMove(r.state, r.secret, move({ x: 2, y: 5 }, { x: 2, y: 6 }, 'blocked-main', r.state.revision)), e => (e as { code?: string }).code === 'FORCED_LANDING_REQUIRED');
  assert.deepEqual(r, before);
  const landed = applyHeroAbility(r.state, r.secret, skill(r.state, 'landing', { pieceId: 'trainee' }));
  assert.equal(landed.state.pieces.find(p => p.id === 'trainee')!.layer, undefined);
  assert.equal(landed.state.effectsByPieceId!.trainee.flight, undefined);
  assert.deepEqual(landed.state.formalTurns, { red: 5, black: 4 });
  assert.equal(landed.state.turn, 'black');
  const duplicate = applyHeroAbility(landed.state, landed.secret, command);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.state, landed.state); assert.deepEqual(duplicate.secret, landed.secret);
});

test('R5-FLIGHT-TURN-02 timeline child may move the due flyer without restarting its lifetime or consuming its next main', () => {
  const a = dueFlight(true);
  const r = applyHeroAbility(a.state, a.secret, skill(a.state, 'timeline_twist', { to: { x: 1, y: 4 } }));
  const flyer = r.state.pieces.find(p => p.id === 'trainee')!;
  assert.equal(flyer.x, 1); assert.equal(flyer.y, 4); assert.equal(flyer.layer, 'air');
  assert.deepEqual(r.state.pieces.find(p => p.id === 'return-ground'), revealed('return-ground', 'red', 'horse', 0, 4));
  assert.deepEqual(r.state.pieces.find(p => p.id === 'destination-ground'), revealed('destination-ground', 'black', 'pawn', 1, 4));
  assert.deepEqual(r.state.effectsByPieceId!.trainee.flight, { remainingOwnerTurns: 0, source: 'sky_admiral', forcedLanding: true });
  assert.deepEqual(r.state.formalTurns, { red: 4, black: 4 });
  assert.equal(r.state.actionRecords!.some(a => a.opportunity === 'child' && a.pieceId === 'trainee' && !a.countsAsFormalTurn), true);
  assert.equal(getLegalMoves(r.state, 'trainee').length, 0);
  const landed = applyHeroAbility(r.state, r.secret, skill(r.state, 'landing', { pieceId: 'trainee' }));
  assert.deepEqual(landed.state.pieces.find(p => p.id === 'trainee'), revealed('trainee', 'red', 'pawn', 1, 4));
  assert.equal(landed.state.captured.some(p => p.id === 'destination-ground' && p.cause === 'crush'), true);
  assert.deepEqual(landed.state.formalTurns, { red: 5, black: 4 });
});

test('R5-FLIGHT-TURN-03 linked-control exemption still rejects illegal geometry and occupied air destinations transactionally', () => {
  const ground = dueFlight(), beforeGround = structuredClone(ground);
  assert.throws(() => applyHeroAbility(ground.state, ground.secret, skill(ground.state, 'timeline_twist', { to: { x: 3, y: 5 } })), e => (e as { code?: string }).code === 'INVALID_CONTROLLED_MOVE');
  assert.deepEqual(ground, beforeGround);
  const air = dueFlight(true);
  air.state.pieces.push({ ...revealed('air-blocker', 'black', 'rook', 1, 4), layer: 'air' });
  const beforeAir = structuredClone(air);
  assert.throws(() => applyHeroAbility(air.state, air.secret, skill(air.state, 'timeline_twist', { to: { x: 1, y: 4 } })), e => (e as { code?: string }).code === 'INVALID_CONTROLLED_MOVE');
  assert.deepEqual(air, beforeAir);
});
