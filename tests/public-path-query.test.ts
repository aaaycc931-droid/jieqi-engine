import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePublicMove, getLegalMoves, getLegalAssassinationMoves, isGeneralInCheck, isCheckmate, isStalemate, hasAnyLegalMove, canRevealedPieceAttack, isSquareAttacked } from '../src/rules.ts';
import { projectClosedPublicPathAction, supportsClosedPublicPathQuery, applyAuthoritativeMove } from '../src/game.ts';
import { captureMechanismEvents, emitMechanismEvent, withoutMechanismEvents } from '../src/mechanism-observer.ts';
import { openDestructionBatches } from '../src/settlement-context.ts';
import { GAME_MODES } from '../src/modes.ts';
import { revealed, move } from './helpers.ts';
import { symbolic, witnesses, kinds, checkingPath, earlyPair, onlyLegEvasion, onlyUnsafeBounces, session } from './public-path-query-fixtures.ts';
import type { GameState } from '../src/types.ts';

const has = (positions: { x: number; y: number }[], to: { x: number; y: number }) => positions.some(p => p.x === to.x && p.y === to.y);
function freeze(value: any): any { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function normalize(value: any, binding: any): any {
  if (typeof value === 'string') {
    if (value === binding.players.red) return '<red-player>';
    if (value === binding.players.black) return '<black-player>';
    return value.replaceAll(binding.roomId, '<room>');
  }
  if (Array.isArray(value)) return value.map(x => normalize(x, binding));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [normalize(k, binding), normalize(v, binding)]));
  return value;
}

for (const w of witnesses) for (const kind of kinds) test(`QUERY original ${w.id}/${kind}: marker, validator and authority agree`, () => {
  const a = symbolic(w, kind), before = structuredClone(a.state), unsafe = witnesses.indexOf(w) < 2;
  const captured = captureMechanismEvents(() => {
    const result = validatePublicMove(a.state, a.move, 'red', a.options);
    const markers = kind === 'move' ? getLegalMoves(a.state, a.move.pieceId, 'red') : getLegalAssassinationMoves(a.state, a.move.pieceId, kind === 'continuing', 'red');
    assert.equal(result.ok, !unsafe); assert.equal(has(markers, a.move.to), !unsafe);
    if (unsafe) assert.equal(result.code, 'SELF_CHECK');
  });
  assert.deepEqual(captured.events, []); assert.deepEqual(a.state, before);
  if (unsafe) assert.throws(a.execute, (e: any) => e.code === 'SELF_CHECK');
  else assert.equal(isGeneralInCheck(a.execute().state, 'red'), false);
});
for (const shield of [false, true]) for (const kind of kinds) test(`QUERY checker crushed/${kind}/endpoint scale=${shield}: safe evasion is advertised`, () => {
  const a = symbolic(checkingPath(shield), kind);
  assert.equal(isGeneralInCheck(a.state, 'red'), true);
  assert.equal(validatePublicMove(a.state, a.move, 'red', a.options).ok, true);
  const markers = kind === 'move' ? getLegalMoves(a.state, a.move.pieceId) : getLegalAssassinationMoves(a.state, a.move.pieceId, kind === 'continuing');
  assert(has(markers, a.move.to)); assert.equal(isGeneralInCheck(a.execute().state, 'red'), false);
});
test('QUERY terminal search: the only iron-steed leg evasion prevents false checkmate', () => {
  const a = onlyLegEvasion(), before = structuredClone(a);
  assert.equal(isGeneralInCheck(a.state, 'red'), true); assert.deepEqual(getLegalMoves(a.state, 'red-general'), []);
  assert(has(getLegalMoves(a.state, 'actor'), { x: 5, y: 8 }));
  assert.equal(hasAnyLegalMove(a.state, 'red'), true); assert.equal(isCheckmate(a.state, 'red'), false); assert.equal(isStalemate(a.state, 'red'), false);
  assert.deepEqual(a, before);
});
test('QUERY terminal search: only unsafe shield returns do not prevent stalemate', () => {
  const a = onlyUnsafeBounces(), before = structuredClone(a.state);
  assert.equal(isGeneralInCheck(a.state, 'red'), false);
  for (const id of ['red-general', 'actor', 'leg-screen']) assert.deepEqual(getLegalMoves(a.state, id), []);
  assert.equal(hasAnyLegalMove(a.state, 'red'), false); assert.equal(isCheckmate(a.state, 'red'), false); assert.equal(isStalemate(a.state, 'red'), true);
  assert.deepEqual(a.state, before);
});
test('QUERY terminal search includes a real H02 continuing main instead of ordinary-only markers', () => {
  const a = symbolic(checkingPath(), 'continuing');
  a.state.pieces.push(revealed('guard-left', 'black', 'horse', 1, 8), revealed('guard-right', 'black', 'horse', 7, 8), revealed('guard-front', 'black', 'rook', 0, 8));
  for (const id of ['red-general', 'screen']) assert.deepEqual(getLegalMoves(a.state, id), []);
  assert.deepEqual(getLegalMoves(a.state, a.move.pieceId), []);
  assert(has(getLegalAssassinationMoves(a.state, a.move.pieceId, true), a.move.to));
  const before = structuredClone(a.state); assert.equal(hasAnyLegalMove(a.state, 'red'), true); assert.equal(isCheckmate(a.state, 'red'), false); assert.deepEqual(a.state, before);
  a.state.effectsByPieceId![a.move.pieceId].stealth!.strongStrikeAvailable = false;
  assert.deepEqual(getLegalAssassinationMoves(a.state, a.move.pieceId, true), []);
});
test('QUERY H02 activation requires its real charge and continuing requires its real stealth opportunity', () => {
  const a = symbolic(witnesses[2], 'activation'); a.state.assassination!.red.heroChargeAvailable = false;
  assert.deepEqual(getLegalAssassinationMoves(a.state, a.move.pieceId, false), []);
  const b = symbolic(witnesses[2], 'continuing'); delete b.state.effectsByPieceId![b.move.pieceId].stealth;
  assert.deepEqual(getLegalAssassinationMoves(b.state, b.move.pieceId, true), []);
});
test('QUERY exact projection matches authoritative atom state, before counters and next begin', () => {
  for (const kind of kinds) for (const w of witnesses.slice(2)) {
    const a = symbolic(w, kind), projection = projectClosedPublicPathAction(a.state, a.move, 'red', a.options)!;
    assert.equal(projection.validation.ok, true);
    const captured = captureMechanismEvents(a.execute), atom = captured.events.find(e => e.kind === 'main_action_atom_closed')!;
    assert(atom);
    for (const key of ['pieces', 'effectsByPieceId', 'assassination', 'captured', 'formalTurns', 'turnStartedAt', 'turnDeadlineAt'] as const)
      assert.deepEqual(projection.state![key], atom.state[key], key);
    assert.deepEqual({ ...projection.state!.lastMove, actionId: a.move.actionId }, atom.state.lastMove);
  }
});
test('QUERY exact early M01 and M04 royal threats preserve path/endpoint terminal semantics', () => {
  const leg = earlyPair([revealed('attacker', 'black', 'horse', 3, 9)]);
  const rook = earlyPair([revealed('attacker', 'black', 'rook', 4, 3), revealed('screen', 'red', 'pawn', 4, 6)], 'war_chariot');
  for (const a of [leg, rook]) {
    const p: any = a.state.pieces.find(p => p.id === 'attacker'), before = structuredClone(a);
    assert.equal(canRevealedPieceAttack(a.state, p, { x: 4, y: 9 }), true);
    assert.equal(isSquareAttacked(a.state, { x: 4, y: 9 }, 'black'), true); assert.equal(isGeneralInCheck(a.state, 'red'), true);
    assert.deepEqual(a, before);
  }
});
test('QUERY explicit own-general path death remains legal terminal, not a safe ordinary board', () => {
  const a = earlyPair([revealed('actor', 'red', 'rook', 0, 8), revealed('target', 'black', 'pawn', 6, 8)], 'war_chariot', { x: 4, y: 8 });
  const cmd = { ...move({ x: 0, y: 8 }, { x: 6, y: 8 }), pieceId: 'actor' };
  const projection = projectClosedPublicPathAction(a.state, cmd, 'red')!;
  assert.equal(validatePublicMove(a.state, cmd).ok, true); assert.equal(projection.state!.status, 'finished'); assert.equal(projection.state!.winner, 'black');
  assert.equal(applyAuthoritativeMove(a.state, a.secret, cmd).state.winner, 'black');
});
test('QUERY open original batch refuses before any clone, including terminal search', () => {
  const a = symbolic(witnesses[2]), original = globalThis.structuredClone; let copies = 0;
  openDestructionBatches.set(a.state, { batchId: 'original', targets: [] });
  globalThis.structuredClone = (() => { copies++; throw Error('copied before batch barrier'); }) as any;
  try {
    for (const f of [() => validatePublicMove(a.state, a.move), () => getLegalMoves(a.state, a.move.pieceId), () => hasAnyLegalMove(a.state, 'red')])
      assert.throws(f, (e: any) => e.code === 'DESTRUCTION_BATCH_OPEN');
  } finally { globalThis.structuredClone = original; openDestructionBatches.delete(a.state); }
  assert.equal(copies, 0);
});
test('QUERY public-only coverage refuses hidden touched identities and unrelated effects without inventing a secret', () => {
  const a = symbolic(witnesses[2]);
  const victim: any = a.state.pieces.find(p => p.id === witnesses[2].input.victimId); victim.faceDown = true; delete victim.color; delete victim.type;
  assert.equal(projectClosedPublicPathAction(a.state, a.move, 'red'), undefined);
  const b = symbolic(witnesses[2]); b.state.effectsByPieceId![b.move.pieceId] = { infection: { owner: 'black', stacks: 2 } };
  assert.equal(supportsClosedPublicPathQuery(b.state, b.move.pieceId), false);
  const c = symbolic(witnesses[2]); c.state.formalTurns = { red: 8, black: 8 };
  assert.equal(projectClosedPublicPathAction(c.state, c.move, 'red'), undefined);
});
test('QUERY suppression restores the outer observer after errors and never invalidates it', () => {
  const a = symbolic(witnesses[2]);
  const capture = captureMechanismEvents(() => {
    emitMechanismEvent('formal_turn_begin', a.state, a.secret, { marker: 'before' });
    assert.throws(() => withoutMechanismEvents(() => { throw Error('query-error'); }), /query-error/);
    assert.throws(() => withoutMechanismEvents(() => Promise.resolve()), /synchronous/);
    validatePublicMove(a.state, a.move); emitMechanismEvent('formal_turn_begin', a.state, a.secret, { marker: 'after' });
  });
  assert.deepEqual(capture.events.map(e => e.details.marker), ['before', 'after']); assert.notEqual(capture.evidenceValid, false);
});
test('QUERY suppression avoids event snapshots, including direct terminal checkpoints', () => {
  const a = earlyPair([revealed('actor', 'red', 'rook', 0, 8), revealed('target', 'black', 'pawn', 6, 8)], 'war_chariot', { x: 4, y: 8 });
  const cmd = { ...move({ x: 0, y: 8 }, { x: 6, y: 8 }), pieceId: 'actor' }, clone = globalThis.structuredClone; let snapshots = 0;
  globalThis.structuredClone = ((value: any, ...rest: any[]) => {
    if (value?.kind && value?.state) { snapshots++; throw Error('query emitted an observer snapshot'); }
    return (clone as any)(value, ...rest);
  }) as any;
  try { const c = captureMechanismEvents(() => validatePublicMove(a.state, cmd)); assert.equal(c.result.ok, true); assert.deepEqual(c.events, []); assert.notEqual(c.evidenceValid, false); }
  finally { globalThis.structuredClone = clone; }
  assert.equal(snapshots, 0);
});
test('QUERY unrelated rosters, late rain, child windows and special spaces retain their old query route', () => {
  for (const change of [
    (s: GameState) => { s.formalTurns = { red: 15, black: 15 }; },
    (s: GameState) => { s.pendingShuffle = { owner: 'red' } as any; },
    (s: GameState) => { s.pendingHeroChild = { owner: 'red' } as any; },
    (s: GameState) => { s.pieces.find(p => p.id === 'actor')!.layer = 'air'; },
    (s: GameState) => { s.ghosts = [{ owner: 'black', position: { x: 5, y: 8 } }] as any; },
  ]) {
    const a = onlyLegEvasion(); change(a.state);
    assert.equal(projectClosedPublicPathAction(a.state, { from: { x: 3, y: 7 }, to: { x: 5, y: 8 }, pieceId: 'actor' }, 'red'), undefined);
  }
  const a = onlyLegEvasion(); a.state.featureRules!.heroes!.red = 'hunter'; delete a.state.featureRules!.heroSelections; delete a.state.heroFormLock;
  assert.equal(validatePublicMove(a.state, { from: { x: 3, y: 7 }, to: { x: 5, y: 8 }, pieceId: 'actor' }).code, 'SELF_CHECK');
});
for (const branch of ['AS', 'AP', 'ES'] as const) test(`QUERY ${branch}: interleaved public search preserves all original real requests, RNG and evidence`, () => {
  const a = session(branch), b = session(branch);
  for (const d of a.declarations) {
    const snapshot = a.snapshot(), before = structuredClone(snapshot), draws = a.draws();
    const state = freeze(snapshot.game!.state) as GameState;
    let randomCalls = 0, clockCalls = 0; const random = Math.random, clock = Date.now;
    Math.random = () => { randomCalls++; throw Error('real RNG consumed by query'); };
    Date.now = () => { clockCalls++; throw Error('wall clock consumed by query'); };
    try {
      const c = captureMechanismEvents(() => {
        for (const piece of state.pieces) {
          getLegalMoves(state, piece.id);
          if (state.assassination?.[state.turn]?.activePieceId === piece.id) {
            getLegalAssassinationMoves(state, piece.id, false); getLegalAssassinationMoves(state, piece.id, true);
          }
        }
        for (const side of ['red', 'black'] as const) { isGeneralInCheck(state, side); hasAnyLegalMove(state, side); isCheckmate(state, side); isStalemate(state, side); }
      });
      assert.deepEqual(c.events, []); assert.notEqual(c.evidenceValid, false);
    } finally { Math.random = random; Date.now = clock; }
    assert.equal(randomCalls, 0); assert.equal(clockCalls, 0); assert.deepEqual(snapshot, before); assert.deepEqual(a.draws(), draws);
    const x = a.step(d.id), y = b.step(d.id);
    assert.equal(x.disposition, 'accepted'); assert.deepEqual(normalize(x.after, a.binding), normalize(y.after, b.binding));
    assert.deepEqual(normalize(x.events, a.binding), normalize(y.events, b.binding)); assert.deepEqual(normalize(x.views, a.binding), normalize(y.views, b.binding)); assert.deepEqual(a.draws(), b.draws());
  }
  assert.equal(GAME_MODES.xiangqi.featuresReady, false); assert.equal(GAME_MODES.half_chaos.featuresReady, false);
});
