import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHeroAbility, createRemoteRoom, destroyPiece, initializeFeatureGameState, initializeFeatureSecret, isGeneralInCheck, joinRemoteRoom, markRevealed, startFormalClock, submitRemoteHeroAbility } from '../src/index.ts';
import { closeDirectDeaths } from '../src/settlement.ts';
import { captureMechanismEvents, emitMechanismEvent, withIsolatedMechanismEvents } from '../src/mechanism-observer.ts';
import { openDestructionBatches } from '../src/settlement-context.ts';
import type { RemoteRoom } from '../src/remote-room.ts';
import type { GameState, HeroAbilityCommand, PublicPiece, Side } from '../src/types.ts';
import { gameState, revealed, secretState } from './helpers.ts';

// Public synthetic component states, not the half-chaos 12 natural replays.
function army(anchor = { x: 0, y: 6 }, ready = true, extras: PublicPiece[] = [], side: Side = 'red') {
  const flip = (p: PublicPiece): PublicPiece => side === 'red' ? p : { ...p, color: p.color === 'red' ? 'black' : 'red', x: 8 - p.x, y: 9 - p.y } as PublicPiece;
  const state = initializeFeatureGameState(gameState([
    revealed('warrior', 'red', 'pawn', anchor.x, anchor.y),
    revealed('dragon', 'black', 'pawn', 0, 3), ...extras,
  ].map(flip), { turn: side, redGeneral: side === 'red' ? { x: 4, y: 9 } : { x: 5, y: 9 }, blackGeneral: side === 'red' ? { x: 3, y: 0 } : { x: 4, y: 0 } }),
  side === 'red' ? { red: 'nozdormu', black: 'murozond' } : { red: 'murozond', black: 'nozdormu' }, 'end_time');
  const secret = secretState();
  initializeFeatureSecret(state, secret);
  for (const p of state.pieces) markRevealed(state, secret, p.id);
  if (ready) startFormalClock(state, 1_000, secret);
  return { state, secret };
}
function skill(state: GameState, actionId = 'hourglass-boundary'): HeroAbilityCommand {
  return { kind: 'hero_ability', ability: 'hourglass', actionId, expectedRevision: state.revision };
}
function exposure(ready = true, side: Side = 'red') {
  const a = army({ x: 0, y: 6 }, ready, [revealed('checker', 'black', 'rook', 4, 1)], side);
  const w = a.state.pieces.find(p => p.id === 'warrior')!;
  w.x = 4; w.y = side === 'red' ? 6 : 3;
  assert.equal(isGeneralInCheck(a.state, side), false);
  return a;
}
function roomFor(a: ReturnType<typeof army>): RemoteRoom {
  const room = joinRemoteRoom(createRemoteRoom('hourglass-components', 'red-player', 'unit-token', 100), 'black-player', 'unit-token', 200).room;
  return { ...room, phase: 'playing', game: { ...a, players: { red: 'red-player', black: 'black-player' } },
    mode: { heroesEnabled: true, mutationsEnabled: true }, features: { heroes: a.state.featureRules!.heroes, mutation: 'end_time' },
    featureSecret: { traps: a.secret.traps ?? [] }, updatedAt: 1_000 };
}
const errorCode = (code: string) => (e: unknown) => (e as { code?: string }).code === code;

for (const side of ['red', 'black'] as const) {
  test(`R38-HG01-${side} return itself resolves check and preserves the original opportunity/deadline`, () => {
    const a = army({ x: 4, y: 6 }, true, [revealed('checker', 'black', 'rook', 4, 1)], side);
    const w = a.state.pieces.find(p => p.id === 'warrior')!;
    w.x = side === 'red' ? 0 : 8;
    const before = structuredClone(a), cmd = skill(a.state);
    assert.equal(isGeneralInCheck(a.state, side), true);
    const r = applyHeroAbility(a.state, a.secret, cmd, 1_100, () => { throw Error('no RNG'); });
    assert.equal(isGeneralInCheck(r.state, side), false);
    assert.equal(r.state.hourglasses, 4);
    assert.equal(r.state.revision, before.state.revision + 1);
    assert.equal(r.secret.processedActions[cmd.actionId], r.state.revision);
    assert.equal(r.state.turn, side);
    assert.equal(r.state.turnLifecycle!.phase, 'before_main');
    assert.deepEqual(r.state.formalTurns, before.state.formalTurns);
    assert.equal(r.state.turnDeadlineAt, before.state.turnDeadlineAt);
    assert.deepEqual(a, before);
  });
  test(`R38-HG02-${side} return exposing the royal rejects the entire candidate on each new request`, () => {
    const a = exposure(true, side);
    a.state.warps = [{ x: 8, y: 5 }];
    a.state.effectsByPieceId!.dragon.ammunition = 0;
    a.state.effectsByPieceId!.warrior.timeCollapse = { expiresAtOwnerTurnEnd: 2 };
    const before = structuredClone(a);
    for (const actionId of ['unsafe-first', 'unsafe-new-request']) {
      assert.throws(() => applyHeroAbility(a.state, a.secret, skill(a.state, actionId), 1_100), errorCode('IN_CHECK'));
      assert.deepEqual(a, before);
      assert.equal(a.secret.processedActions[actionId], undefined);
    }
  });
}

test('R38-HG01-revival a shown dead warrior can itself resolve check without inheriting temporary effects', () => {
  const a = army({ x: 4, y: 6 }, true, [revealed('checker', 'black', 'rook', 4, 1)]);
  a.state.effectsByPieceId!.warrior = { destiny: 'time_warrior', intangible: true, infection: { owner: 'black', stacks: 2 } };
  destroyPiece(a.state, a.secret, 'warrior', 'black', 'destruction');
  assert.equal(isGeneralInCheck(a.state, 'red'), true);
  const r = applyHeroAbility(a.state, a.secret, skill(a.state), 1_100);
  assert.equal(isGeneralInCheck(r.state, 'red'), false);
  assert.deepEqual(r.state.effectsByPieceId!.warrior, { destiny: 'time_warrior' });
  assert.equal(r.state.captured.some(p => p.id === 'warrior'), false);
  assert.equal(r.secret.destinyIdentities!.warrior.shown, true);
});

test('R38-HG02 a still-checked result cannot cleanse now and rely on another skill or the main action', () => {
  const a = army({ x: 0, y: 6 }, true, [revealed('checker', 'black', 'rook', 4, 1)]);
  a.state.warps = [{ x: 8, y: 5 }]; a.state.effectsByPieceId!.dragon.ammunition = 0;
  const before = structuredClone(a);
  assert.equal(isGeneralInCheck(a.state, 'red'), true);
  assert.throws(() => applyHeroAbility(a.state, a.secret, skill(a.state), 1_100), errorCode('IN_CHECK'));
  assert.deepEqual(a, before);
});

test('R38-HG03 landing death reopens check: no trap, death, cleansing or ammunition result is committed', () => {
  const a = army({ x: 4, y: 5 }, true, [revealed('checker', 'black', 'rook', 4, 1)]);
  a.state.pieces.find(p => p.id === 'warrior')!.y = 6;
  a.secret.traps = [{ id: 'landing-trap', owner: 'black', position: { x: 4, y: 5 }, opponentTurnsRemaining: 2 }];
  a.state.warps = [{ x: 8, y: 5 }]; a.state.effectsByPieceId!.dragon.ammunition = 0;
  const room = roomFor(a), before = structuredClone(room);
  assert.equal(isGeneralInCheck(a.state, 'red'), false);
  assert.throws(() => submitRemoteHeroAbility(room, 'red-player', skill(a.state), 1_100), errorCode('IN_CHECK'));
  assert.deepEqual(room, before);
});

test('R38-HG04 frozen polluted anchors require a separate paid use; fifth use completes and sixth rejects', () => {
  const a = army(); destroyPiece(a.state, a.secret, 'warrior', 'black', 'attack');
  a.state.warps = [{ x: 0, y: 6 }]; a.state.hourglasses = 2;
  a.state.effectsByPieceId!.dragon.ammunition = 0;
  const first = applyHeroAbility(a.state, a.secret, skill(a.state, 'fourth'), 1_100);
  assert.equal(first.state.hourglasses, 1);
  assert.equal(first.state.pieces.some(p => p.id === 'warrior'), false);
  assert.deepEqual(first.state.warps, []);
  assert.equal(first.state.effectsByPieceId!.dragon.ammunition, 1);
  const fifth = applyHeroAbility(first.state, first.secret, skill(first.state, 'fifth'), 1_200);
  assert.equal(fifth.state.hourglasses, 0);
  assert.equal(fifth.state.pieces.some(p => p.id === 'warrior'), true);
  const before = structuredClone(fifth);
  assert.throws(() => applyHeroAbility(fifth.state, fifth.secret, skill(fifth.state, 'sixth'), 1_300), errorCode('SKILL_USED'));
  assert.deepEqual(fifth, before);
});

test('R38-HG04 occupied anchors stay ineligible even when that occupant also returns', () => {
  const a = army({ x: 0, y: 6 }, true, [revealed('second', 'red', 'pawn', 2, 6)]);
  a.state.pieces.find(p => p.id === 'warrior')!.x = 2;
  a.state.pieces.find(p => p.id === 'second')!.x = 0;
  const r = applyHeroAbility(a.state, a.secret, skill(a.state), 1_100);
  assert.equal(r.state.pieces.find(p => p.id === 'warrior')!.x, 2);
  assert.equal(r.state.pieces.find(p => p.id === 'second')!.x, 0);
  assert.equal(r.state.hourglasses, 4);
});

test('R38-HG05 empty appeared set still spends and cleanses/reloads without reviving unshown/dead objects', () => {
  const a = army(); a.secret.destinyIdentities!.warrior.shown = false;
  a.state.pieces = a.state.pieces.map(p => p.id === 'warrior' ? { id: p.id, x: p.x, y: p.y, faceDown: true } : p);
  a.secret.identities.warrior = { color: 'red', type: 'pawn' };
  delete a.state.effectsByPieceId!.warrior;
  destroyPiece(a.state, a.secret, 'dragon', 'red', 'attack');
  a.state.warps = [{ x: 2, y: 2 }];
  const r = applyHeroAbility(a.state, a.secret, skill(a.state), 1_100);
  assert.equal(r.state.hourglasses, 4); assert.deepEqual(r.state.warps, []);
  assert.equal(r.secret.destinyIdentities!.warrior.shown, false);
  assert.equal(r.state.pieces.some(p => p.id === 'dragon'), false);
  assert.equal(r.state.effectsByPieceId?.dragon, undefined);
});

test('R38-HG06 living return preserves effects and crossing the same ghost region does not add infection', () => {
  const a = army(); a.state.pieces.find(p => p.id === 'warrior')!.x = 1;
  a.state.ghosts = [0, 1].map(x => ({ owner: 'black', position: { x, y: 6 }, remaining: 3 }));
  a.state.effectsByPieceId!.warrior = { destiny: 'time_warrior', intangible: true, immuneCrush: true,
    barrier: { owner: 'red', enemyTurnsRemaining: 2 }, infection: { owner: 'black', stacks: 2 }, timeCollapse: { expiresAtOwnerTurnEnd: 2 } };
  const r = applyHeroAbility(a.state, a.secret, skill(a.state), 1_100);
  assert.deepEqual(r.state.effectsByPieceId!.warrior, { destiny: 'time_warrior', intangible: true, immuneCrush: true,
    barrier: { owner: 'red', enemyTurnsRemaining: 2 }, infection: { owner: 'black', stacks: 2 } });
});

test('R38-HG06 newly entering a ghost region still applies its landing effect exactly once', () => {
  const a = army(); a.state.pieces.find(p => p.id === 'warrior')!.x = 1;
  a.state.ghosts = [{ owner: 'black', position: { x: 0, y: 6 }, remaining: 3 }];
  const r = applyHeroAbility(a.state, a.secret, skill(a.state), 1_100);
  assert.deepEqual(r.state.effectsByPieceId!.warrior.infection, { owner: 'black', stacks: 1 });
  assert.equal(r.state.automaticEvents!.filter(e => e.kind === 'ghost_entry').length, 1);
});

for (const remote of [false, true]) test(`R38-HG07 ${remote ? 'room' : 'direct'} checks the original batch context before copying`, () => {
  const a = army(), room = roomFor(a), before = structuredClone(room);
  openDestructionBatches.set(a.state, { batchId: 'still-open', targets: [] });
  try {
    assert.throws(() => remote ? submitRemoteHeroAbility(room, 'red-player', skill(a.state), 1_100) : applyHeroAbility(a.state, a.secret, skill(a.state), 1_100), errorCode('DESTRUCTION_BATCH_OPEN'));
    assert.deepEqual(room, before);
  } finally { openDestructionBatches.delete(a.state); }
});

test('R38-HG08 successful duplicate returns the original room even when a later batch is open', () => {
  const a = army(), cmd = skill(a.state), first = submitRemoteHeroAbility(roomFor(a), 'red-player', cmd, 1_100).room;
  openDestructionBatches.set(first.game!.state, { batchId: 'later-batch', targets: [] });
  try {
    const duplicate = submitRemoteHeroAbility(first, 'red-player', cmd, 1_200);
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.room, first);
  } finally { openDestructionBatches.delete(first.game!.state); }
});

for (const remote of [false, true]) test(`R38-HG07 ${remote ? 'room' : 'direct'} preserves stale/phase/special-window errors even with an open original batch`, () => {
  for (const code of ['STALE_REVISION', 'INVALID_PHASE', 'NO_SHUFFLE_WINDOW', 'HERO_FORM_LOCKED'] as const) {
    const a = army(), room = roomFor(a), cmd = skill(a.state);
    if (code === 'STALE_REVISION') cmd.expectedRevision = -1;
    if (code === 'INVALID_PHASE') a.state.status = 'finished';
    if (code === 'NO_SHUFFLE_WINDOW') a.state.pendingShuffle = { window: 'A', side: 'red' };
    if (code === 'HERO_FORM_LOCKED') a.secret.heroFormLock = {};
    const before = structuredClone(room);
    openDestructionBatches.set(a.state, { batchId: 'still-open', targets: [] });
    try {
      assert.throws(() => remote ? submitRemoteHeroAbility(room, 'red-player', cmd, 1_100) : applyHeroAbility(a.state, a.secret, cmd, 1_100), errorCode(code));
      assert.deepEqual(room, before);
    } finally { openDestructionBatches.delete(a.state); }
  }
});

test('R38-HG09 explicit death RNG is consumed once instead of falling back to Math.random', () => {
  const state = gameState([revealed('replacement', 'red', 'horse', 0, 6)]), secret = secretState();
  secret.training = { red: { type: 'horse', pieceId: 'dead-trainee', progress: 4 } };
  let explicit = 0, production = 0; const previous = Math.random;
  Math.random = () => { production++; return 0; };
  try {
    closeDirectDeaths(state, secret, 'red', max => { explicit++; assert.equal(max, 1); return 0; });
  } finally { Math.random = previous; }
  assert.equal(explicit, 1); assert.equal(production, 0);
  assert.equal(secret.training.red!.pieceId, 'replacement');
});

for (const ready of [true, false]) test(`R38-HG09 unsupported training context ${ready ? 'after' : 'during'} begin cannot draw production RNG or commit a candidate`, () => {
  const a = army({ x: 0, y: 6 }, ready);
  a.secret.training = { red: { type: 'pawn', pieceId: 'dead-trainee', progress: 1 } };
  const before = structuredClone(a); let draws = 0; const previous = Math.random;
  Math.random = () => { draws++; return 0; };
  try {
    assert.throws(() => applyHeroAbility(a.state, a.secret, skill(a.state), 1_100, () => { draws++; return 0; }), e => (e as Error).name === 'HourglassCoverageError');
  } finally { Math.random = previous; }
  assert.equal(draws, 0); assert.deepEqual(a, before);
});

test('R38-HG09 legacy three-argument death closure retains its default RNG behavior', () => {
  const state = gameState([revealed('replacement', 'red', 'horse', 0, 6)]), secret = secretState();
  secret.training = { red: { type: 'horse', pieceId: 'dead-trainee', progress: 4 } };
  let draws = 0; const previous = Math.random;
  Math.random = () => { draws++; return 0; };
  try { closeDirectDeaths(state, secret, 'red'); } finally { Math.random = previous; }
  assert.equal(draws, 1); assert.equal(secret.training.red!.pieceId, 'replacement');
});

test('R38-HG10 rejected lazy-begin events stay isolated; the next accepted begin is captured once', () => {
  const rejected = exposure(false), accepted = army({ x: 0, y: 6 }, false);
  const captured = captureMechanismEvents(() => {
    assert.throws(() => applyHeroAbility(rejected.state, rejected.secret, skill(rejected.state), 1_100), errorCode('IN_CHECK'));
    return applyHeroAbility(accepted.state, accepted.secret, skill(accepted.state), 1_100);
  });
  assert.deepEqual(captured.events.map(e => e.kind), ['formal_turn_begin']);
  assert.equal(captured.events[0].state.hourglasses, 5);
  assert.equal(captured.result.state.hourglasses, 4);
  assert.equal(Object.isFrozen(captured.events[0].state.pieces[0]), true);
});

for (const failure of ['clone', 'freeze'] as const) test(`R38-HG10 observer ${failure} failure invalidates evidence without changing accepted business output`, () => {
  const a = army({ x: 0, y: 6 }, false), expected = applyHeroAbility(a.state, a.secret, skill(a.state), 1_100);
  const originalClone = globalThis.structuredClone, originalFreeze = Object.freeze;
  const isEvent = (v: any) => v?.kind === 'formal_turn_begin';
  if (failure === 'clone') globalThis.structuredClone = ((v: any, options?: any) => { if (isEvent(v)) throw Error('observer clone fault'); return originalClone(v, options); }) as typeof structuredClone;
  else Object.freeze = ((v: any) => { if (isEvent(v)) throw Error('observer freeze fault'); return originalFreeze(v); }) as typeof Object.freeze;
  try {
    const captured = captureMechanismEvents(() => applyHeroAbility(a.state, a.secret, skill(a.state), 1_100));
    assert.deepEqual(captured.result, expected);
    assert.deepEqual(captured.events, []);
    assert.equal((captured as any).evidenceValid, false);
  } finally { globalThis.structuredClone = originalClone; Object.freeze = originalFreeze; }
  assert.deepEqual(captureMechanismEvents(() => 'next'), { result: 'next', events: [] });
});

test('R38-HG10 business failures still propagate and restore the enclosing capture', () => {
  const a = army({ x: 0, y: 6 }, false), failure = new Error('business clone failure'), original = globalThis.structuredClone;
  globalThis.structuredClone = ((v: any, options?: any) => { if (v === a.state) throw failure; return original(v, options); }) as typeof structuredClone;
  try { assert.throws(() => captureMechanismEvents(() => applyHeroAbility(a.state, a.secret, skill(a.state), 1_100)), e => e === failure); }
  finally { globalThis.structuredClone = original; }
  const c = captureMechanismEvents(() => { emitMechanismEvent('formal_turn_begin', a.state, a.secret); return 'after'; });
  assert.equal(c.result, 'after'); assert.equal(c.events.length, 1);
});

test('R38-HG10 nested candidate failure discards only its buffered events and restores both parents', () => {
  const a = army(), failure = new Error('discard outer');
  const emit = (label: string) => emitMechanismEvent('formal_turn_begin', a.state, a.secret, { label });
  const captured = captureMechanismEvents(() => {
    emit('before');
    assert.throws(() => withIsolatedMechanismEvents(() => {
      emit('discarded-outer');
      withIsolatedMechanismEvents(() => emit('discarded-inner'));
      throw failure;
    }), e => e === failure);
    withIsolatedMechanismEvents(() => {
      emit('accepted-outer');
      assert.throws(() => withIsolatedMechanismEvents(() => { emit('discarded-child'); throw failure; }), e => e === failure);
      withIsolatedMechanismEvents(() => emit('accepted-child'));
    });
    emit('after');
  });
  assert.deepEqual(captured.events.map(e => e.details.label), ['before', 'accepted-outer', 'accepted-child', 'after']);
});

test('R38-HG10 disabled observation creates no event snapshots and matches observed business output', () => {
  const a = army({ x: 0, y: 6 }, false), original = globalThis.structuredClone;
  let eventClones = 0;
  globalThis.structuredClone = ((v: any, options?: any) => { if (v?.kind === 'formal_turn_begin') eventClones++; return original(v, options); }) as typeof structuredClone;
  try {
    const plain = applyHeroAbility(a.state, a.secret, skill(a.state), 1_100);
    assert.equal(eventClones, 0);
    const captured = captureMechanismEvents(() => applyHeroAbility(a.state, a.secret, skill(a.state), 1_100));
    assert.deepEqual(captured.result, plain); assert.equal(eventClones, 1);
  } finally { globalThis.structuredClone = original; }
});

test('R38-HG10 isolation rejects asynchronous use with and without an enclosing capture', () => {
  assert.throws(() => withIsolatedMechanismEvents(() => Promise.resolve('no')), /synchronous/);
  assert.throws(() => captureMechanismEvents(() => withIsolatedMechanismEvents(() => Promise.resolve('no'))), /synchronous/);
  assert.deepEqual(captureMechanismEvents(() => 'clean'), { result: 'clean', events: [] });
});

test('R38-HG11 original actor/revision/window/expiry gates retain their ordering and do not commit skill resources', () => {
  for (const code of ['NOT_PLAYER', 'WRONG_TURN', 'STALE_REVISION', 'INVALID_PRE_MAIN_WINDOW', 'INVALID_PHASE'] as const) {
    const a = army(), room = roomFor(a), cmd = skill(a.state);
    let actor = 'red-player';
    if (code === 'NOT_PLAYER') actor = 'outsider';
    if (code === 'WRONG_TURN') actor = 'black-player';
    if (code === 'STALE_REVISION') cmd.expectedRevision = -1;
    if (code === 'INVALID_PRE_MAIN_WINDOW') a.state.turnLifecycle!.phase = 'main_action';
    if (code === 'INVALID_PHASE') a.state.status = 'finished';
    const before = structuredClone(room);
    assert.throws(() => submitRemoteHeroAbility(room, actor, cmd, 1_100), errorCode(code));
    assert.deepEqual(room, before);
  }
  const a = army(), room = roomFor(a), before = structuredClone(room);
  const timed = submitRemoteHeroAbility(room, 'red-player', skill(a.state), a.state.turnDeadlineAt!).room;
  assert.equal(timed.phase, 'finished'); assert.equal(timed.game!.state.reason, 'timeout');
  assert.equal(timed.game!.state.hourglasses, 5); assert.deepEqual(room, before);
});

test('R38-HG12 original direct-death terminal remains a separate source path, not a royal-safety verdict', () => {
  const a = army(); destroyPiece(a.state, a.secret, 'black-general', 'red', 'destruction');
  const r = applyHeroAbility(a.state, a.secret, skill(a.state), 1_100);
  assert.equal(r.state.status, 'finished'); assert.equal(r.state.reason, 'general_destroyed');
  assert.equal(r.state.hourglasses, 4); assert.equal(r.secret.processedActions['hourglass-boundary'], r.state.revision);
});

test('R38-HG12 unsupported royal space cannot be treated as a safe candidate', () => {
  const a = army(); a.state.pieces.find(p => p.id === 'red-general')!.layer = 'air';
  const before = structuredClone(a);
  assert.throws(() => applyHeroAbility(a.state, a.secret, skill(a.state), 1_100), e => (e as Error).name === 'HourglassCoverageError');
  assert.deepEqual(a, before);
});
