import assert from 'node:assert/strict';
import test from 'node:test';
import { commitShanAction, createShanState, ownerShanView, previewShanAction, shanDeathPercent } from '../src/shan-core.ts';
import type { ShanAction, ShanEnemyMove, ShanGuard, ShanOwnMove, ShanSide, ShanState, ShanThreat } from '../src/shan-core.ts';

// Synthetic trusted action facts, NOT production chess legality or wire tests.
const opponent = (s: ShanSide): ShanSide => s === 'red' ? 'black' : 'red';
const threat = (pieceId = 'rook', continuationKey = 'e-file') => ({ pieceId, continuationKey });
const neverRandom = () => { throw Error('unexpected RNG'); };
const frozen = <T>(v: T): T => {
  if (v && typeof v === 'object') { Object.freeze(v); for (const x of Object.values(v)) frozen(x); }
  return v;
};
function enemy(s: ShanState, incoming: ShanThreat[] = [], outgoing: ShanThreat[] = []): ShanEnemyMove {
  return { kind: 'enemy_move', source: 'ordinary_ground', actionId: `enemy-${s.revision}`, expectedRevision: s.revision,
    actor: opponent(s.owner), ordinaryMoveLegal: true, movesGeneral: false,
    threatsOnOwnerAfter: incoming, threatsOnEnemyAfter: outgoing };
}
function own(s: ShanState, overrides: Partial<ShanOwnMove> = {}): ShanOwnMove {
  return { kind: 'own_move', source: 'ordinary_ground', actionId: `own-${s.revision}`, expectedRevision: s.revision,
    actor: s.owner, ordinaryMoveLegal: true, movesGeneral: false, choice: 'normal', ordinaryCheckmate: false,
    threatsOnOwnerAfter: [], threatsOnEnemyAfter: [], ...overrides };
}
function step(s: ShanState, a: ShanAction, roll: (maxExclusive: number) => number = neverRandom): ShanState { return commitShanAction(s, a, roll).state; }
function checked(owner: ShanSide = 'red'): ShanState {
  const s = createShanState(owner, opponent(owner)); return step(s, enemy(s, [threat()]));
}
function die(owner: ShanSide = 'red'): ShanState {
  const s = checked(owner); return step(s, own(s, { choice: 'gamble', threatsOnOwnerAfter: [threat()] }), () => 0);
}
function nextReply(s: ShanState, incoming: ShanThreat[] = []): ShanState { return step(s, enemy(s, incoming)); }
function guard(s: ShanState, changes: Partial<ShanGuard> = {}): ShanGuard {
  return { pieceId: 'advisor', type: 'advisor', side: s.owner,
    position: { x: s.generalPosition.x - 1, y: s.generalPosition.y }, provenance: 'ordinary_revealed_ground', ...changes };
}
const code = (expected: string) => (e: unknown) => (e as { code?: string }).code === expected;
function rejectUnchanged(s: ShanState, a: ShanAction, expected: string) {
  const before = structuredClone(s), input = structuredClone(a); let calls = 0;
  assert.throws(() => commitShanAction(s, a, () => { calls++; return 0; }), code(expected));
  assert.equal(calls, 0); assert.deepEqual(s, before); assert.deepEqual(a, input);
}

test('A01 initial levels, six probability bands and levels beyond six', () => {
  assert.equal(createShanState('red').lethalLevel, 0);
  assert.equal(checked().lethalLevel, 1);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 100].map(shanDeathPercent), [10, 20, 35, 50, 65, 80, 80, 80]);
  for (const n of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => shanDeathPercent(n), code('NO_LETHAL_LEVEL'));
});

test('A02 unchanged same-rook checking ray, double check and new additional threat', () => {
  let s = checked();
  s = step(s, own(s, { choice: 'gamble', threatsOnOwnerAfter: [threat()] }), () => 99);
  s = step(s, enemy(s, [threat()])); // Adapter keeps e3 -> e4 on the same e-file key.
  assert.equal(s.lethalLevel, 1);
  s = step(s, own(s, { choice: 'gamble', threatsOnOwnerAfter: [threat()] }), () => 99);
  s = step(s, enemy(s, [threat(), threat('horse', 'leg-d1')]));
  assert.equal(s.lethalLevel, 2, 'two resulting threats add at most one level');
  let d = createShanState('red', 'black');
  d = step(d, enemy(d, [threat(), threat('horse', 'leg-d1')]));
  assert.equal(d.lethalLevel, 1, 'one double check is one effective check');
});

test('A02 checking threat cleared on owner action can be recreated by the same rook', () => {
  let s = checked();
  s = step(s, own(s)); // Interposition clears before the next enemy sampling.
  s = step(s, enemy(s, [threat()]));
  assert.equal(s.lethalLevel, 2, 'sampling only enemy endpoints would incorrectly retain level one');
});

test('A03 no-check enemy action lowers exactly one level and floors at zero', () => {
  let s = checked();
  for (let i = 0; i < 2; i++) { s = step(s, own(s)); s = step(s, enemy(s, [threat()])); }
  assert.equal(s.lethalLevel, 3);
  s = step(s, own(s)); assert.equal(s.lethalLevel, 3, 'owner interposition is not enemy-end decay');
  s = nextReply(s); assert.equal(s.lethalLevel, 2);
  for (const expected of [1, 0, 0]) { s = step(s, own(s)); s = nextReply(s); assert.equal(s.lethalLevel, expected); }
});

for (const owner of ['red', 'black'] as const) {
  test(`A04 ${owner} diagonal adjacent advisor costs once without RNG or level reset`, () => {
    let s = checked(owner); const cmd = own(s, { choice: 'guard', guard: guard(s, {
      position: { x: 3, y: owner === 'red' ? 8 : 1 },
    }), threatsOnOwnerAfter: [threat()] });
    const result = commitShanAction(frozen(s), frozen(cmd), neverRandom);
    assert.equal(result.sacrificePieceId, 'advisor'); s = result.state;
    assert.equal(s.guardUsed, true); assert.equal(s.lethalLevel, 1); assert.equal(s.life, 'alive');
    s = nextReply(s, [threat()]);
    rejectUnchanged(s, own(s, { choice: 'guard', guard: guard(s, { pieceId: 'second-advisor' }) }), 'GUARD_UNAVAILABLE');
  });
}

test('A04 remote, enemy, non-advisor and missing guards are rejected atomically', () => {
  const s = checked();
  for (const g of [guard(s, { position: { x: 0, y: 9 } }), guard(s, { side: 'black' }), guard(s, { type: 'other' }),
    guard(s, { position: { ...s.generalPosition } })]) {
    rejectUnchanged(s, own(s, { choice: 'guard', guard: g }), 'GUARD_UNAVAILABLE');
  }
  rejectUnchanged(s, own(s, { choice: 'guard' }), 'GUARD_UNAVAILABLE');
  rejectUnchanged(s, own(s, { guard: guard(s) }), 'UNEXPECTED_GUARD');
  rejectUnchanged(s, own(s, { choice: 'gamble', guard: guard(s) }), 'UNEXPECTED_GUARD');
});

test('A04 action invalid after actual sacrifice cost does not consume guard', () => {
  const s = checked();
  rejectUnchanged(s, own(s, { choice: 'guard', guard: guard(s), ordinaryMoveLegal: false }), 'ILLEGAL_MOVE');
  assert.equal(s.guardUsed, false);
});

test('A05 every death threshold has exact boundary behavior and one draw', () => {
  let s = checked();
  for (let level = 1; level <= 7; level++) {
    const threshold = shanDeathPercent(level);
    for (const [roll, expected] of [[threshold - 1, 'dead'], [threshold, 'alive']] as const) {
      let calls = 0;
      const r = commitShanAction(s, own(s, { choice: 'gamble', threatsOnOwnerAfter: [threat()] }), max => {
        calls++; assert.equal(max, 100); return roll;
      });
      assert.equal(r.state.life, expected); assert.equal(calls, 1);
    }
    if (level < 7) { s = step(s, own(s)); s = nextReply(s, [threat()]); }
  }
});

test('A05 missing or malformed random sampler never mutates the input', () => {
  const s = checked(), before = structuredClone(s), a = own(s, { choice: 'gamble' });
  assert.throws(() => commitShanAction(s, a), code('RNG_REQUIRED'));
  for (const roll of [-1, 100, .5, NaN, Infinity]) {
    let calls = 0;
    assert.throws(() => commitShanAction(s, a, () => { calls++; return roll; }), code('INVALID_RANDOM_VALUE'));
    assert.equal(calls, 1, 'invalid injected RNG is an integration error, not a legal draw');
    assert.deepEqual(s, before);
  }
  assert.throws(() => commitShanAction(s, a, () => { throw Error('sampler failed'); }), /sampler failed/);
  assert.deepEqual(s, before);
});

test('A06 death establishes 6/2/0 once; replay never refreshes or resamples', () => {
  const s = checked(), a = own(s, { choice: 'gamble', threatsOnOwnerAfter: [threat()] });
  const d = step(s, a, () => 0);
  assert.deepEqual([d.remainingTurns, d.remainingEvasions, d.executionChecks], [6, 2, 0]);
  assert.equal(d.deathActionId, a.actionId);
  let later = nextReply(d, [threat()]);
  later = step(later, own(later, { choice: 'gamble', threatsOnOwnerAfter: [threat()] }));
  assert.deepEqual([later.remainingTurns, later.remainingEvasions], [5, 1]);
  const replay = commitShanAction(later, a, neverRandom);
  assert.equal(replay.duplicate, true); assert.deepEqual(replay.state, later);
});

test('A06 previously used guard stays used after death', () => {
  let s = checked(); s = step(s, own(s, { choice: 'guard', guard: guard(s), threatsOnOwnerAfter: [threat()] }));
  s = nextReply(s, [threat()]); s = step(s, own(s, { choice: 'gamble', threatsOnOwnerAfter: [threat()] }), () => 0);
  assert.equal(s.guardUsed, true); assert.deepEqual([s.remainingTurns, s.remainingEvasions], [6, 2]);
});

test('A07 death-triggering countercheck is excluded; ordinary checkmate still wins', () => {
  const s = checked(), a = own(s, { choice: 'gamble', threatsOnEnemyAfter: [threat('our-rook')] });
  const d = step(s, a, () => 0);
  assert.equal(d.executionChecks, 0); assert.equal(d.remainingTurns, 6); assert.equal(d.remainingEvasions, 2);
  assert.equal(step(s, { ...a, ordinaryCheckmate: true }, () => 0).outcome, 'won_by_checkmate');
});

test('A08 third special attempt rejected; no-reply adjudication terminates before another move', () => {
  let s = die();
  for (let n = 0; n < 2; n++) { s = nextReply(s, [threat()]); s = step(s, own(s, { choice: 'gamble', threatsOnOwnerAfter: [threat()] })); }
  assert.deepEqual([s.remainingTurns, s.remainingEvasions, s.outcome], [4, 0, null]);
  s = nextReply(s, [threat()]);
  rejectUnchanged(s, own(s, { choice: 'gamble', threatsOnOwnerAfter: [threat()] }), 'NO_SPECIAL_EVASION');
  const noReply: ShanAction = { kind: 'no_reply', actor: s.owner, source: 'ordinary_ground', actionId: 'no-reply', expectedRevision: s.revision,
    normalReplyExists: false, specialReplyExists: false };
  rejectUnchanged(s, { ...noReply, normalReplyExists: true }, 'REPLY_STILL_AVAILABLE');
  rejectUnchanged(s, { ...noReply, specialReplyExists: true }, 'REPLY_STILL_AVAILABLE');
  const lost = step(s, noReply); assert.equal(lost.outcome, 'lost_no_reply'); assert.equal(lost.remainingTurns, 4);
});

test('A08 zero special quota preserves ordinary evasion and an already unused guard cannot add quota', () => {
  let s = die();
  for (let i = 0; i < 2; i++) { s = nextReply(s, [threat()]); s = step(s, own(s, { choice: 'gamble', threatsOnOwnerAfter: [threat()] })); }
  s = nextReply(s, [threat()]);
  rejectUnchanged(s, own(s, { choice: 'guard', guard: guard(s) }), 'NO_SPECIAL_EVASION');
  const r = step(s, own(s));
  assert.deepEqual([r.remainingTurns, r.remainingEvasions, r.outcome], [3, 0, null]);
});

test('A08 post-death guard costs one special evasion, one turn and no random draw', () => {
  let s = nextReply(die(), [threat()]);
  s = step(s, own(s, { choice: 'guard', guard: guard(s), threatsOnOwnerAfter: [threat()] }));
  assert.deepEqual([s.remainingTurns, s.remainingEvasions, s.guardUsed, s.lethalLevel], [5, 1, true, 1]);
});

function finalTurn(checks: number): ShanState {
  let s = die();
  for (let n = 0; n < 5; n++) {
    s = nextReply(s);
    s = step(s, own(s, { threatsOnEnemyAfter: n < checks ? [threat('our-rook')] : [] }));
  }
  assert.equal(s.remainingTurns, 1); return nextReply(s);
}

test('A09 sixth own turn fourth effective check wins before timeout, double check adds one', () => {
  const s = finalTurn(3);
  const r = step(s, own(s, { threatsOnEnemyAfter: [threat('our-rook'), threat('our-horse', 'leg')] }));
  assert.deepEqual([r.executionChecks, r.remainingTurns, r.outcome], [4, 0, 'won_by_checks']);
});

test('A09 sixth-turn normal checkmate wins even without four checks', () => {
  const s = finalTurn(0), r = step(s, own(s, { ordinaryCheckmate: true, threatsOnEnemyAfter: [threat('our-rook')] }));
  assert.deepEqual([r.executionChecks, r.remainingTurns, r.outcome], [1, 0, 'won_by_checkmate']);
});

test('A09 no winning result on sixth turn loses; neither side can play after terminal', () => {
  let s = finalTurn(3); s = step(s, own(s));
  assert.equal(s.outcome, 'lost_timeout');
  rejectUnchanged(s, enemy(s), 'FINISHED');
});

test('A09 four early checks win immediately without waiting until turn six', () => {
  let s = die();
  for (let i = 0; i < 4; i++) { s = nextReply(s); s = step(s, own(s, { threatsOnEnemyAfter: [threat('our-rook')] })); }
  assert.deepEqual([s.executionChecks, s.remainingTurns, s.outcome], [4, 2, 'won_by_checks']);
});

test('A10 preview is pure, retry at a later revision is duplicate, reused ID cannot change payload', () => {
  const s = frozen(checked()), a = frozen(own(s, { choice: 'gamble' }));
  assert.deepEqual(previewShanAction(s, a), { duplicate: false, requiresRandom: true, deathPercent: 10, sacrificePieceId: null });
  const r = step(s, a, () => 99);
  assert.equal(previewShanAction(r, a).requiresRandom, false);
  assert.deepEqual(commitShanAction(r, a, neverRandom).state, r);
  rejectUnchanged(r, { ...a, choice: 'normal' }, 'ACTION_ID_REUSED');
});

test('A10 stale revision, wrong actor, bad geometry, general movement and normal self-check reject before RNG', () => {
  const s = checked();
  rejectUnchanged(s, own(s, { choice: 'gamble', expectedRevision: 0 }), 'STALE_REVISION');
  rejectUnchanged(s, own(s, { actor: 'black' }), 'WRONG_TURN');
  rejectUnchanged(s, enemy(s), 'WRONG_TURN');
  rejectUnchanged(s, own(s, { choice: 'gamble', ordinaryMoveLegal: false }), 'ILLEGAL_MOVE');
  rejectUnchanged(s, own(s, { choice: 'gamble', movesGeneral: true }), 'GENERAL_FIXED');
  rejectUnchanged(s, own(s, { threatsOnOwnerAfter: [threat()] }), 'SELF_CHECK');
  rejectUnchanged(createShanState('red'), own(createShanState('red'), { choice: 'gamble' }), 'NOT_IN_CHECK');
  rejectUnchanged(s, own(s, { ordinaryCheckmate: true }), 'INVALID_CHECKMATE_FACT');
});

test('A10 equivalent threat-array order is retry-equivalent and accepted inputs stay immutable', () => {
  const s = createShanState('red', 'black'), a = enemy(s, [threat('b'), threat('a')]);
  const before = structuredClone(a), r = step(frozen(s), frozen(a));
  assert.deepEqual(a, before);
  assert.equal(commitShanAction(r, { ...a, threatsOnOwnerAfter: [...a.threatsOnOwnerAfter].reverse() }, neverRandom).duplicate, true);
});

test('A11 live/dead paired branches expose no module projection to opponent', () => {
  const s = checked(), a = own(s, { choice: 'gamble', threatsOnOwnerAfter: [threat()] });
  const live = step(s, a, () => 99), dead = step(s, a, () => 0);
  assert.notDeepEqual(ownerShanView(live, 'red'), ownerShanView(dead, 'red'));
  assert.equal(ownerShanView(live, 'black'), undefined); assert.equal(ownerShanView(dead, 'black'), undefined);
  const wireStub = (state: ShanState) => JSON.stringify({ board: 'identical authority-supplied board', shan: ownerShanView(state, 'black') });
  assert.equal(wireStub(live), wireStub(dead)); // Component projection only; not actual room/BT wire.
  assert.equal(ownerShanView(live, 'red')!.gambleDeathPercent, 10);
  assert.equal(ownerShanView(dead, 'red')!.gambleDeathPercent, null);
});

test('A11 owner projection contains no action history, IDs or mutable state reference', () => {
  const s = die(), view = ownerShanView(s, 'red')!;
  assert.deepEqual(Object.keys(view).sort(), ['lethalLevel', 'life', 'guardAvailable', 'gambleDeathPercent', 'remainingTurns', 'remainingEvasions', 'executionChecks', 'executionTarget'].sort());
  view.remainingTurns = 0; assert.equal(s.remainingTurns, 6);
});

test('A12 unknown effects, unconfirmed guard sources and malformed facts fail without consumption', () => {
  const s = checked();
  rejectUnchanged(s, { ...own(s), source: 'extra_action' } as unknown as ShanAction, 'UNSUPPORTED_SOURCE');
  rejectUnchanged(s, own(s, { choice: 'guard', guard: guard(s, { provenance: 'unsupported' }) }), 'UNSUPPORTED_GUARD');
  rejectUnchanged(s, own(s, { threatsOnOwnerAfter: [threat(), threat()] }), 'INVALID_THREATS');
  rejectUnchanged(s, own(s, { threatsOnOwnerAfter: [{ pieceId: '', continuationKey: 'x' }] }), 'INVALID_THREATS');
  const safe = createShanState('red');
  rejectUnchanged(safe, { kind: 'no_reply', source: 'ordinary_ground', actionId: 'false-no-reply', expectedRevision: 0, actor: 'red', normalReplyExists: false, specialReplyExists: false }, 'REPLY_STILL_AVAILABLE');
});

test('A12 malformed state or facts cannot manufacture death resources', () => {
  const s = checked();
  for (const changed of [{ ...s, remainingTurns: 6 }, { ...s, executionChecks: 1 }, { ...s, revision: 100 }, { ...s, lethalLevel: -1 }]) {
    assert.throws(() => previewShanAction(changed, own(s)), code('INVALID_STATE'));
  }
  assert.throws(() => createShanState('purple' as ShanSide), code('INVALID_STATE'));
  assert.throws(() => previewShanAction(s, { ...own(s), ordinaryMoveLegal: undefined } as unknown as ShanAction), code('INVALID_ACTION'));
});
