import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyPublicPathAction, RuleError } from '../src/index.ts';
import { getClosedPublicPathQueryGap, projectClosedPublicPathAction, applyAuthoritativeMove, applyAuthoritativeAssassination } from '../src/game.ts';
import { validatePublicMove } from '../src/rules.ts';
import { captureMechanismEvents, emitMechanismEvent } from '../src/mechanism-observer.ts';
import { openDestructionBatches } from '../src/settlement-context.ts';
import { GAME_MODES } from '../src/modes.ts';
import { covered, revealed, move } from './helpers.ts';
import { symbolic, witnesses, kinds, checkingPath, earlyPair, inScope, session } from './public-path-query-fixtures.ts';
import type { ActionKind } from './public-path-query-fixtures.ts';
import type { PublicPathActionIntent } from '../src/public-path-qualification.ts';

const intent = (kind: ActionKind): PublicPathActionIntent => kind === 'move' ? { kind: 'move' } : {
  kind: 'assassination', useStrongStrike: kind === 'continuing', ...(kind === 'activation' ? { source: 'hero' as const } : {}),
};
function freeze(v: any): any { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function normalize(v: any, binding: any): any {
  if (typeof v === 'string') return v === binding.players.red ? '<red>' : v === binding.players.black ? '<black>' : v.replaceAll(binding.roomId, '<room>');
  if (Array.isArray(v)) return v.map(x => normalize(x, binding));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [normalize(k, binding), normalize(x, binding)]));
  return v;
}

for (const [n, w] of witnesses.entries()) for (const kind of kinds) test(`QUAL ${w.id}/${kind}: explicit covered decision agrees with existing authority`, () => {
  const a = symbolic(w, kind), before = structuredClone({ state: a.state, secret: a.secret });
  const q = qualifyPublicPathAction(freeze(a.state), a.move, 'red', intent(kind));
  assert.equal(q.status, n < 2 ? 'illegal' : 'legal'); assert.equal(q.basis, 'closed_authority_projection');
  if (q.status === 'illegal') assert.equal(q.code, 'SELF_CHECK');
  assert.deepEqual({ state: a.state, secret: a.secret }, before); assert(!('state' in q)); assert(!('secret' in q));
});
for (const shield of [false, true]) for (const kind of kinds) test(`QUAL safe checker removal/${kind}/scale=${shield}: legal is positive closure evidence`, () => {
  const a = symbolic(checkingPath(shield), kind);
  assert.deepEqual(qualifyPublicPathAction(a.state, a.move, 'red', intent(kind)), { status: 'legal', basis: 'closed_authority_projection' });
});
for (const [name, amend, code] of [
  ['off-board', (a: any) => ({ ...a.move, to: { x: 9, y: 4 } }), 'OUT_OF_BOARD'],
  ['same-square', (a: any) => ({ ...a.move, to: { ...a.move.from } }), 'SAME_SQUARE'],
  ['piece-from mismatch', (a: any) => ({ ...a.move, from: { x: 1, y: 5 } }), 'INVALID_SOURCE'],
  ['missing piece', (a: any) => ({ ...a.move, pieceId: 'absent' }), 'NO_PIECE'],
  ['diagonal rook', (a: any) => ({ ...a.move, to: { x: 1, y: 5 } }), 'ILLEGAL_MOVEMENT'],
] as const) test(`QUAL deterministic public preflight/${name}: illegal needs no full projection`, () => {
  const a = symbolic(witnesses[2]);
  assert.deepEqual(qualifyPublicPathAction(a.state, amend(a)), { status: 'illegal', basis: 'public_source_geometry', code });
});
test('QUAL wrong actor is public illegal before hidden-identity coverage', () => {
  const a = earlyPair([covered('actor', 0, 9)], 'war_chariot');
  assert.deepEqual(qualifyPublicPathAction(a.state, move({ x: 0, y: 9 }, { x: 0, y: 8 }), 'black'), { status: 'illegal', basis: 'public_source_geometry', code: 'WRONG_TURN' });
});
test('QUAL source charge and strong-strike availability retain the real authority errors', () => {
  const a = symbolic(witnesses[2], 'activation'); a.state.assassination!.red.heroChargeAvailable = false;
  const q = qualifyPublicPathAction(a.state, a.move, 'red', intent('activation'));
  assert.equal(q.status, 'illegal'); if (q.status === 'illegal') assert.equal(q.code, 'ASSASSINATION_UNAVAILABLE');
  const b = symbolic(witnesses[2], 'continuing'); b.state.effectsByPieceId![b.move.pieceId].stealth!.strongStrikeAvailable = false;
  const r = qualifyPublicPathAction(b.state, b.move, 'red', intent('continuing'));
  assert.equal(r.status, 'illegal'); if (r.status === 'illegal') assert.equal(r.code, 'STRONG_STRIKE_UNAVAILABLE');
});

function contact(where: 'path' | 'endpoint', shield = false) {
  const path = where === 'path' ? covered('path', 4, 6) : revealed('path', 'red', 'pawn', 4, 6);
  const target = where === 'endpoint' ? covered('target', 6, 6) : revealed('target', 'black', 'pawn', 6, 6);
  const a = earlyPair([revealed('actor', 'red', 'rook', 0, 6), path, target,
    revealed('second', 'red', 'pawn', 4, 8), revealed('ray', 'black', 'rook', 4, 2)], 'war_chariot');
  if (shield) a.state.effectsByPieceId![where === 'path' ? 'path' : 'target'] = { dragonScale: 1 };
  return { ...a, command: { ...move({ x: 0, y: 6 }, { x: 6, y: 6 }, 'hidden-component'), pieceId: 'actor' } };
}
for (const where of ['path', 'endpoint'] as const) for (const shield of [false, true]) test(`QUAL hidden ${where}/scale=${shield}: explicit unqualified, never secret or an invented approval`, () => {
  const a = contact(where, shield), before = structuredClone(a.state);
  const q = qualifyPublicPathAction(a.state, a.command);
  assert.deepEqual(q, { status: 'uncovered', reason: 'COVERED_CONTACT_NOT_QUALIFIED' });
  assert.equal(projectClosedPublicPathAction(a.state, a.command, 'red'), undefined);
  // A legacy boolean is deliberately retained, not used as qualified evidence.
  assert.equal(validatePublicMove(a.state, a.command).ok, true);
  for (const identity of [{ color: 'red', type: 'rook' }, { color: 'black', type: 'pawn' }] as const) {
    a.secret.identities[where === 'path' ? 'path' : 'target'] = identity;
    const secretBefore = structuredClone(a.secret);
    assert.deepEqual(qualifyPublicPathAction(a.state, a.command), q);
    if (where === 'path' && shield) assert.equal(applyAuthoritativeMove(a.state, a.secret, a.command).state.pieces.find(p => p.id === 'path')!.faceDown, true);
    else assert.throws(() => applyAuthoritativeMove(a.state, a.secret, a.command), (e: any) => e.code === 'SELF_CHECK');
    assert.deepEqual(a.secret, secretBefore);
  }
  assert.deepEqual(a.state, before);
});
test('QUAL a covered mover keeps public position geometry but its reveal is not qualified', () => {
  const a = earlyPair([covered('actor', 0, 9)], 'war_chariot'), command = move({ x: 0, y: 9 }, { x: 0, y: 8 });
  const piece = a.state.pieces.find(p => p.id === 'actor')!;
  Object.defineProperties(piece, { type: { get() { throw Error('hidden true type read'); } }, color: { get() { throw Error('hidden true side read'); } } });
  assert.deepEqual(qualifyPublicPathAction(a.state, command), { status: 'uncovered', reason: 'COVERED_MOVER_NOT_QUALIFIED' });
  assert.deepEqual(qualifyPublicPathAction(a.state, { ...command, to: { x: 1, y: 8 } }), { status: 'illegal', basis: 'public_source_geometry', code: 'ILLEGAL_MOVEMENT' });
});
test('QUAL undefined special-position identity is uncovered, without a hidden fallback', () => {
  const a = earlyPair([covered('actor', 4, 5)], 'war_chariot');
  Object.defineProperty(a.state.pieces.find(p => p.id === 'actor')!, 'type', { get() { throw Error('secret fallback'); } });
  assert.deepEqual(qualifyPublicPathAction(a.state, move({ x: 4, y: 5 }, { x: 4, y: 4 })), { status: 'uncovered', reason: 'PUBLIC_IDENTITY_UNDEFINED' });
});
test('QUAL unsupported roster, late window and public effect do not inherit a legacy legal result', () => {
  for (const amend of [
    (a: any) => { a.state.formalTurns = { red: 8, black: 8 }; },
    (a: any) => { a.state.effectsByPieceId[a.move.pieceId] = { infection: { owner: 'black', stacks: 2 } }; },
    (a: any) => { a.state.featureRules.heroes.red = 'hunter'; delete a.state.featureRules.heroSelections; delete a.state.heroFormLock; },
  ]) {
    const a = symbolic(witnesses[2]); amend(a);
    assert.equal(validatePublicMove(a.state, a.move).ok, true);
    assert.deepEqual(qualifyPublicPathAction(a.state, a.move), { status: 'uncovered', reason: 'SOURCE_BOUNDARY_NOT_QUALIFIED' });
  }
});
test('QUAL source-phase variants and incomplete/invalid context are reported without bypassing them', () => {
  const a = symbolic(witnesses[2]);
  assert.equal(getClosedPublicPathQueryGap(a.state, a.move, 'red', { allowIntermediateCheck: true }), 'QUERY_VARIANT_NOT_QUALIFIED');
  assert.deepEqual(qualifyPublicPathAction({ ...a.state, captured: undefined } as any, a.move), { status: 'uncovered', reason: 'PUBLIC_CONTEXT_INCOMPLETE' });
  const bad = structuredClone(a.state); bad.heroFormLock!.red!.packageId = 'wrong';
  assert.deepEqual(qualifyPublicPathAction(bad, a.move), { status: 'uncovered', reason: 'PUBLIC_CONTEXT_INVALID' });
  assert.deepEqual(qualifyPublicPathAction(a.state, a.move, 'red', { kind: 'skipSafety' } as any), { status: 'uncovered', reason: 'QUERY_INTENT_NOT_QUALIFIED' });
});
test('QUAL original open batch refuses before cloning for covered and uncovered inputs alike', () => {
  for (const a of [symbolic(witnesses[2]), { ...contact('path'), move: contact('path').command }]) {
    const clone = globalThis.structuredClone; let copies = 0;
    openDestructionBatches.set(a.state, { batchId: 'original', targets: [] }); globalThis.structuredClone = (() => { copies++; throw Error('clone'); }) as any;
    try { assert.throws(() => qualifyPublicPathAction(a.state, a.move), (e: any) => e.code === 'DESTRUCTION_BATCH_OPEN'); }
    finally { globalThis.structuredClone = clone; openDestructionBatches.delete(a.state); }
    assert.equal(copies, 0);
  }
});
test('QUAL unexpected private dependency is uncovered; unexpected runtime failure still propagates and restores observation', () => {
  const a = symbolic(witnesses[2]), clone = globalThis.structuredClone;
  for (const error of [new RuleError('MISSING_SECRET', 'injected coverage failure'), new Error('injected runtime failure')]) {
    globalThis.structuredClone = ((v: any, ...rest: any[]) => { if (v === a.state) throw error; return (clone as any)(v, ...rest); }) as any;
    try {
      const c = captureMechanismEvents(() => {
        if (error instanceof RuleError) assert.deepEqual(qualifyPublicPathAction(a.state, a.move), { status: 'uncovered', reason: 'PRIVATE_STATE_REQUIRED' });
        else assert.throws(() => qualifyPublicPathAction(a.state, a.move), /injected runtime failure/);
      });
      assert.deepEqual(c.events, []); assert.notEqual(c.evidenceValid, false);
    } finally { globalThis.structuredClone = clone; }
  }
  const c = captureMechanismEvents(() => { qualifyPublicPathAction(a.state, a.move); emitMechanismEvent('formal_turn_begin', a.state, a.secret, { after: true }); });
  assert.equal(c.events.length, 1); assert.equal(c.events[0].details.after, true);
});

test('QUAL 18 original symbolic sources x90 destinations:1620 explicit decisions match actual unchanged authority', () => {
  let count = 0;
  for (const w of [...witnesses, checkingPath(false), checkingPath(true)]) for (const kind of kinds) {
    const a = symbolic(w, kind), before = structuredClone({ state: a.state, secret: a.secret });
    inScope(() => {
      for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
        const command = { ...a.move, to: { x, y } }, request = { ...a.command, to: { x, y } };
        const q = qualifyPublicPathAction(a.state, command, 'red', intent(kind)); assert.notEqual(q.status, 'uncovered');
        let accepted = false, code: string | undefined;
        try {
          if (kind === 'move') applyAuthoritativeMove(a.state, a.secret, command, false, 12345);
          else applyAuthoritativeAssassination(a.state, a.secret, request, 12345);
          accepted = true;
        } catch (error) { if (!(error instanceof RuleError)) throw error; code = error.code; }
        assert.equal(q.status === 'legal', accepted, `${w.id}/${kind}/${x},${y}`);
        // Public preflight can find a different independently fatal condition
        // before the authority's source checks; it is not its error-priority API.
        if (q.status === 'illegal' && q.basis === 'closed_authority_projection') assert.equal(q.code, code);
        count++;
      }
    });
    assert.deepEqual({ state: a.state, secret: a.secret }, before);
  }
  assert.equal(count, 1620);
});
for (const branch of ['AS', 'AP', 'ES'] as const) test(`QUAL ${branch}: read-only qualification interleaved with every original request preserves full evidence`, () => {
  const a = session(branch), b = session(branch);
  for (const declaration of a.declarations) {
    const snapshot = a.snapshot(), state = freeze(snapshot.game!.state), before = structuredClone(snapshot), clone = globalThis.structuredClone;
    let randomCalls = 0, clockCalls = 0; const random = Math.random, now = Date.now;
    Math.random = () => { randomCalls++; throw Error('query RNG'); }; Date.now = () => { clockCalls++; throw Error('query clock'); };
    try {
      const c = captureMechanismEvents(() => {
        for (const p of state.pieces) {
          qualifyPublicPathAction(state, { from: p, to: { x: p.x, y: p.y - 1 }, pieceId: p.id });
          if (state.assassination?.[state.turn]?.activePieceId === p.id) qualifyPublicPathAction(state, { from: p, to: { x: p.x, y: p.y - 1 }, pieceId: p.id }, state.turn, { kind: 'assassination', useStrongStrike: true });
        }
      });
      assert.deepEqual(c.events, []); assert.notEqual(c.evidenceValid, false);
    } finally { Math.random = random; Date.now = now; globalThis.structuredClone = clone; }
    assert.equal(randomCalls, 0); assert.equal(clockCalls, 0); assert.deepEqual(snapshot, before);
    const x = a.step(declaration.id), y = b.step(declaration.id);
    assert.equal(x.disposition, 'accepted');
    assert.deepEqual(normalize({ after: x.after, events: x.events, views: x.views }, a.binding), normalize({ after: y.after, events: y.events, views: y.views }, b.binding));
    assert.deepEqual(a.draws(), b.draws());
  }
  assert.equal(GAME_MODES.xiangqi.featuresReady, false); assert.equal(GAME_MODES.half_chaos.featuresReady, false);
});
