import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAuthoritativeMove, applyHeroAbility, beginFormalTurn, initializeFeatureGameState, initializeFeatureSecret, getGhostObjects } from '../src/index.ts';
import type { GameState, HeroAbilityCommand } from '../src/types.ts';
import { gameState, revealed, secretState, move } from './helpers.ts';

function storm(wind = true, deathKnight = false) {
  let state = initializeFeatureGameState(gameState(wind ? [revealed('host', 'black', 'horse', 6, 4), revealed('target', 'black', 'pawn', 8, 4)]
    : [revealed('first-target', 'black', 'pawn', 0, 4), revealed('target', 'black', 'pawn', 2, 4)],
    { turn: wind ? 'black' : 'red', blackGeneral: wind ? { x: 4, y: 4 } : { x: 5, y: 0 } }),
    { red: 'devout_zealot', black: wind ? 'wind' : deathKnight ? 'death_knight' : 'hunter' }, 'expedition', undefined, { red: 'storm' });
  let secret = secretState();
  initializeFeatureSecret(state, secret);
  if (wind) {
    const shadow = applyHeroAbility(state, secret, { kind: 'hero_ability', ability: 'shadow', pieceId: 'host', actionId: 'shadow', expectedRevision: state.revision });
    state = shadow.state; secret = shadow.secret; state.turn = 'red';
  }
  state.heroRuntime!.red!.invokeCount = 4; state.heroRuntime!.red!.omen = true;
  beginFormalTurn(state, secret, () => 0);
  const ids = state.pendingDescent!.pieces.map(p => p.id);
  const r = applyHeroAbility(state, secret, { kind: 'hero_ability', ability: 'ascension', actionId: 'deploy', expectedRevision: state.revision,
    placements: ids.map((pieceId, i) => ({ pieceId, to: { x: wind ? (i ? 8 : 6) : i * 2, y: 5 } })) });
  return { ...r, ids };
}
function assault(state: GameState, actionId: string, to?: { x: number; y: number }): HeroAbilityCommand {
  return { kind: 'hero_ability', ability: 'storm_assault', actionId, expectedRevision: state.revision, ...(to ? { to } : { skip: true }) };
}

test('R5-DESCENT-ATOM-01 first assault destroys the Wind carrier but second committed opportunity completes before terminal closure', () => {
  const a = storm();
  const first = applyHeroAbility(a.state, a.secret, assault(a.state, 'first', { x: 6, y: 4 }));
  assert.equal(first.state.status, 'playing'); assert.deepEqual(first.state.pendingDescent!.assaultIds, [a.ids[1]]);
  assert.equal(first.state.turnLifecycle!.phase, 'turn_start');
  assert.equal(first.state.formalTurns!.red, 0);
  assert.throws(() => applyAuthoritativeMove(first.state, first.secret, move({ x: 8, y: 5 }, { x: 7, y: 5 }, 'premature-main', first.state.revision)), e => e.code === 'DESCENT_ACTION_REQUIRED');
  const final = applyHeroAbility(first.state, first.secret, assault(first.state, 'second', { x: 8, y: 4 }));
  assert.equal(final.state.status, 'finished'); assert.equal(final.state.winner, 'red'); assert.equal(final.state.pendingDescent, undefined);
  assert.equal(final.state.formalTurns!.red, 0); assert.equal(final.state.formalTurns!.black, 0);
  assert.deepEqual(final.state.captured.map(p => p.id), ['host', 'target']);
  assert.deepEqual(final.state.automaticEvents!.filter(e => e.kind.startsWith('destroy:')).map(e => e.pieceId), ['host', 'target']);
  const repeated = applyHeroAbility(final.state, final.secret, assault(first.state, 'second', { x: 8, y: 4 }));
  assert(repeated.duplicate); assert.deepEqual(repeated.state, final.state);
});

test('R5-DESCENT-ATOM-02 skipping the remaining assault closes a candidate terminal without advancing formal time', () => {
  const a = storm(); const first = applyHeroAbility(a.state, a.secret, assault(a.state, 'first', { x: 6, y: 4 }));
  const final = applyHeroAbility(first.state, first.secret, assault(first.state, 'skip-second'));
  assert.equal(final.state.status, 'finished'); assert.equal(final.state.winner, 'red'); assert.equal(final.state.pendingDescent, undefined);
  assert.equal(final.state.formalTurns!.red, 0); assert(final.state.pieces.some(p => p.id === 'target'));
});

test('R5-DESCENT-ATOM-03 both assaults retain one source event history and do not tick formal durations', () => {
  const a = storm(false);
  a.secret.traps = [{ id: 'untouched', owner: 'black', position: { x: 8, y: 9 }, opponentTurnsRemaining: 12 }];
  const first = applyHeroAbility(a.state, a.secret, assault(a.state, 'first', { x: 0, y: 4 }));
  const final = applyHeroAbility(first.state, first.secret, assault(first.state, 'second', { x: 2, y: 4 }));
  assert.equal(final.state.status, 'playing'); assert.equal(final.state.pendingDescent, undefined);
  assert.equal(final.state.turnLifecycle!.phase, 'before_main'); assert.equal(final.state.formalTurns!.red, 0);
  assert.deepEqual(final.state.automaticEvents!.filter(e => e.kind.startsWith('destroy:')).map(e => e.pieceId), ['first-target', 'target']);
  assert.equal(final.secret.traps![0].opponentTurnsRemaining, 12);
  assert.equal(final.state.actionRecords!.filter(r => r.keywords.includes('进攻')).length, 2);
  assert(final.state.actionRecords!.filter(r => r.keywords.includes('进攻')).every(r => r.keywords.includes('额外') && r.parentActionId === a.state.pendingDescent!.atom));
  assert(final.state.actionRecords!.every(r => !r.countsAsFormalTurn));
});

test('R5-DESCENT-ATOM-04 surviving enemy check is still rejected atomically and the parent window is preserved', () => {
  const a = storm(false);
  a.state.pieces.find(p => p.id === 'black-general')!.x = 0; a.state.pieces.find(p => p.id === 'black-general')!.y = 3;
  const before = structuredClone(a);
  assert.throws(() => applyHeroAbility(a.state, a.secret, assault(a.state, 'illegal-check', { x: 0, y: 4 })), e => e.code === 'ASSAULT_CHECK');
  assert.deepEqual(a, before);
});

test('R5-DESCENT-ATOM-05 assault deaths generate each Death Knight ghost exactly once without ticking its lifetime', () => {
  const a = storm(false, true);
  const first = applyHeroAbility(a.state, a.secret, assault(a.state, 'first', { x: 0, y: 4 }));
  assert.equal(getGhostObjects(first.state, { kind: 'ghost', owner: 'black' }).length, 1);
  const final = applyHeroAbility(first.state, first.secret, assault(first.state, 'second', { x: 2, y: 4 }));
  const ghosts = getGhostObjects(final.state, { kind: 'ghost', owner: 'black' });
  assert.equal(ghosts.length, 2); assert(ghosts.every(g => g.remaining === 3));
  assert.deepEqual(ghosts.map(g => g.position.x).sort(), [0, 2]);
  assert.equal(final.state.effectsByPieceId?.[a.ids[0]]?.infection, undefined, 'ghost born underfoot is not an entry');
});

test('R5-DESCENT-ATOM-06 storm may settle while checked and leaves legal check response to the normal main action', () => {
  const a = storm(false);
  a.state.pieces.push(revealed('checking-rook', 'black', 'rook', 3, 0));
  const first = applyHeroAbility(a.state, a.secret, assault(a.state, 'first', { x: 0, y: 4 }));
  const final = applyHeroAbility(first.state, first.secret, assault(first.state, 'second', { x: 2, y: 4 }));
  assert.equal(final.state.status, 'playing'); assert.equal(final.state.turnLifecycle!.phase, 'before_main');
  assert.equal(final.state.formalTurns!.red, 0);
  const escaped = applyAuthoritativeMove(final.state, final.secret, move({ x: 3, y: 9 }, { x: 4, y: 9 }, 'normal-response', final.state.revision));
  assert.equal(escaped.state.formalTurns!.red, 1);
});

test('R5-DESCENT-ATOM-07 checkmate after both assault skips is evaluated at source closure instead of leaving an unusable main window', () => {
  let state = initializeFeatureGameState(gameState([2, 3, 4].map(x => revealed(`rook-${x}`, 'black', 'rook', x, 0))),
    { red: 'devout_zealot', black: 'hunter' }, undefined, undefined, { red: 'storm' });
  let secret = secretState(); initializeFeatureSecret(state, secret);
  state.heroRuntime!.red!.invokeCount = 4; state.heroRuntime!.red!.omen = true; beginFormalTurn(state, secret, () => 0);
  let r = applyHeroAbility(state, secret, { kind: 'hero_ability', ability: 'ascension', actionId: 'deploy', expectedRevision: state.revision,
    placements: state.pendingDescent!.pieces.map((p, i) => ({ pieceId: p.id, to: { x: i, y: 7 } })) });
  r = applyHeroAbility(r.state, r.secret, assault(r.state, 'skip-first')); assert.equal(r.state.status, 'playing');
  r = applyHeroAbility(r.state, r.secret, assault(r.state, 'skip-last'));
  assert.equal(r.state.status, 'execution'); assert.equal(r.state.winner, 'black'); assert.equal(r.state.reason, 'checkmate');
  assert.equal(r.state.pendingDescent, undefined); assert.equal(r.state.formalTurns!.red, 0);
});
