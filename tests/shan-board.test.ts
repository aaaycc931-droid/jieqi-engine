import assert from 'node:assert/strict';
import test from 'node:test';
import { collectShanBoardFacts, collectShanBoardTransition, enumerateShanReplies, validateShanBoardChoice } from '../src/shan-board.ts';
import type { ShanBoardChoice, ShanBoardContext, ShanBoardQuery } from '../src/shan-board.ts';
import { commitShanAction, createShanState } from '../src/shan-core.ts';
import type { ShanState } from '../src/shan-core.ts';
import { openDestructionBatches } from '../src/settlement-context.ts';
import { canRevealedPieceAttack, validatePublicMove } from '../src/rules.ts';
import type { GameState, PieceType, RevealedPiece, Side } from '../src/types.ts';

const p = (id: string, color: Side, type: PieceType, x: number, y: number): RevealedPiece => ({ id, color, type, x, y, faceDown: false });
const paper = (file: string, row: number) => ({ x: file.charCodeAt(0) - 97, y: 9 - row });
function setup(extra: RevealedPiece[] = [], turn: Side = 'red', owner: Side = 'red') {
  const state: GameState = { gameMode: 'xiangqi', status: 'playing', turn, revision: 0, captured: [],
    pieces: [p('rg', 'red', 'general', 4, 9), p('bg', 'black', 'general', 3, 0), ...extra] };
  const context: ShanBoardContext = { closure: 'stable', generalIds: { red: 'rg', black: 'bg' }, ordinaryOriginalPieceIds: state.pieces.map(p => p.id) };
  const shan = createShanState(owner, turn, { x: owner === 'red' ? 4 : 3, y: owner === 'red' ? 9 : 0 });
  seed(state, shan, context);
  return { state, shan, context };
}
function value<T>(result: ShanBoardQuery<T>): T {
  assert.equal(result.status, 'known', JSON.stringify(result));
  if (result.status !== 'known') throw Error('unknown');
  return result.value;
}
function seed(state: GameState, shan: ShanState, context: ShanBoardContext) {
  const f = value(collectShanBoardFacts(state, shan, context));
  shan.threatsOnOwner = f.threatsOnOwner; shan.threatsOnEnemy = f.threatsOnEnemy;
  shan.lethalLevel = f.threatsOnOwner.length ? 1 : 0;
}
function command(state: GameState, id: string, x: number, y: number, choice: ShanBoardChoice['choice'] = 'normal', guardPieceId?: string): ShanBoardChoice {
  const source = state.pieces.find(p => p.id === id)!;
  return { actionId: `move-${state.revision}-${id}-${x}-${y}-${choice}`, expectedRevision: state.revision, pieceId: id,
    from: { x: source.x, y: source.y }, to: { x, y }, choice, ...(guardPieceId ? { guardPieceId } : {}) };
}
function accepted(state: GameState, shan: ShanState, context: ShanBoardContext, c: ShanBoardChoice) {
  const r = value(validateShanBoardChoice(state, shan, context, c));
  assert.equal(r.legal, true, JSON.stringify(r)); if (!r.legal) throw Error(r.code); return r;
}
function code(state: GameState, shan: ShanState, context: ShanBoardContext, c: ShanBoardChoice) {
  const r = value(validateShanBoardChoice(state, shan, context, c));
  assert.equal(r.legal, false); if (r.legal) throw Error('legal'); return r.code;
}
function step(f: ReturnType<typeof setup>, c: ShanBoardChoice, roll = 99) {
  const r = accepted(f.state, f.shan, f.context, c);
  f.shan = commitShanAction(f.shan, r.action, () => roll).state;
  f.state = r.candidate; f.state.revision++; f.state.turn = f.shan.turn;
  return r;
}
function dead(s: ShanState, evasions = 0) {
  s.life = 'dead'; s.deathActionId = 'prior-death'; s.remainingTurns = 6; s.remainingEvasions = evasions;
}
const checkRook = () => p('br', 'black', 'rook', 4, 4);

test('B01 paper coordinates and red/black rook geometry use y=9-row', () => {
  assert.deepEqual(paper('e', 0), { x: 4, y: 9 }); assert.deepEqual(paper('e', 9), { x: 4, y: 0 });
  assert.deepEqual(paper('e', 3), { x: 4, y: 6 });
  const a = setup([checkRook()]); assert.equal(value(collectShanBoardFacts(a.state, a.shan, a.context)).threatsOnOwner[0].pieceId, 'br');
  a.state.pieces = a.state.pieces.map(q => ({ ...q, color: q.color === 'red' ? 'black' : 'red', y: 9 - q.y }));
  a.context.generalIds = { red: 'bg', black: 'rg' };
  const shan = createShanState('black', 'red', { x: 4, y: 0 });
  assert.equal(value(collectShanBoardFacts(a.state, shan, a.context)).threatsOnOwner[0].pieceId, 'br');
});
test('B01 actual horse leg, pawn direction, palace advisor and elephant eye/river', () => {
  const f = setup([p('rh', 'red', 'horse', 1, 7), p('leg', 'red', 'pawn', 1, 6), p('ra', 'red', 'advisor', 3, 9), p('re', 'red', 'elephant', 2, 9)]);
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'rh', 2, 5)), 'ILLEGAL_MOVEMENT');
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'leg', 1, 7)), 'ILLEGAL_TARGET');
  assert.equal(accepted(f.state, f.shan, f.context, command(f.state, 'leg', 1, 5)).action.kind, 'own_move');
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'ra', 2, 8)), 'ILLEGAL_MOVEMENT');
  accepted(f.state, f.shan, f.context, command(f.state, 'ra', 4, 8));
  accepted(f.state, f.shan, f.context, command(f.state, 're', 4, 7));
  const e = f.state.pieces.find(q => q.id === 're')!; e.x = 2; e.y = 5;
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 're', 4, 3)), 'ILLEGAL_MOVEMENT');
  const h = setup([p('bh', 'black', 'horse', 3, 7), p('block', 'red', 'pawn', 3, 8)]);
  assert.equal(value(collectShanBoardFacts(h.state, h.shan, h.context)).threatsOnOwner.length, 0);
  h.state.pieces = h.state.pieces.filter(q => q.id !== 'block');
  assert.equal(value(collectShanBoardFacts(h.state, h.shan, h.context)).threatsOnOwner[0].pieceId, 'bh');
});
test('B02 intervening real advisor block clears a ray; recapture rechecks and enemy quiet step lowers once', () => {
  const f = setup([checkRook(), p('ra', 'red', 'advisor', 3, 9)]);
  step(f, command(f.state, 'ra', 4, 8)); assert.equal(f.shan.threatsOnOwner.length, 0);
  step(f, command(f.state, 'br', 4, 5)); assert.equal(f.shan.lethalLevel, 0);
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'ra', 5, 9)), 'SELF_CHECK');
});
test('B02 cleared/recreated ray is counted from both-side samples, not enemy-only snapshots', () => {
  const f = setup([checkRook(), p('ra', 'red', 'advisor', 3, 9)]);
  step(f, command(f.state, 'ra', 4, 8));
  step(f, command(f.state, 'br', 4, 8));
  assert.equal(f.shan.lethalLevel, 2); assert.equal(f.shan.threatsOnOwner.length, 1);
});
test('B03 W02 quiet pawn and W09 same rook ray keep identical generated key and lethal level', () => {
  const f = setup([checkRook(), p('rp', 'red', 'pawn', 0, 6), p('bp', 'black', 'pawn', 8, 3)]);
  const key = f.shan.threatsOnOwner[0].continuationKey;
  step(f, command(f.state, 'rp', 0, 5, 'gamble'));
  step(f, command(f.state, 'br', 4, 5));
  assert.equal(f.shan.lethalLevel, 1); assert.equal(f.shan.threatsOnOwner[0].continuationKey, key);
  step(f, command(f.state, 'rp', 0, 4, 'gamble'));
  step(f, command(f.state, 'bp', 8, 4)); assert.equal(f.shan.lethalLevel, 1);
});
test('B03 same-ray dedup is also used for dead-owner execution progress', () => {
  const f = setup([p('rr', 'red', 'rook', 3, 6)], 'red'); dead(f.shan, 2);
  assert.equal(f.shan.threatsOnEnemy.length, 1);
  step(f, command(f.state, 'rr', 3, 5)); assert.equal(f.shan.executionChecks, 0);
});
test('B04 horse uncovers rook and simultaneously checks: two real sources, one level increment', () => {
  const f = setup([checkRook(), p('bh', 'black', 'horse', 4, 7)], 'black');
  assert.equal(f.shan.threatsOnOwner.length, 0);
  step(f, command(f.state, 'bh', 2, 8));
  assert.deepEqual(f.shan.threatsOnOwner.map(t => t.pieceId), ['bh', 'br']); assert.equal(f.shan.lethalLevel, 1);
});
test('B05 persistent rook plus a genuinely new horse source adds exactly one', () => {
  const f = setup([checkRook(), p('bh', 'black', 'horse', 0, 7)], 'black');
  step(f, command(f.state, 'bh', 2, 8)); assert.equal(f.shan.threatsOnOwner.length, 2); assert.equal(f.shan.lethalLevel, 2);
});
test('B06 owner general fixed; enemy general still uses normal palace movement', () => {
  for (const owner of ['red', 'black'] as const) {
    const f = setup([], owner, owner); const id = f.context.generalIds[owner];
    assert.equal(code(f.state, f.shan, f.context, command(f.state, id, owner === 'red' ? 5 : 3, owner === 'red' ? 9 : 1)), 'GENERAL_FIXED');
  }
  const f = setup([], 'black'); accepted(f.state, f.shan, f.context, command(f.state, 'bg', 3, 1));
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'bg', 2, 0)), 'ILLEGAL_MOVEMENT');
});
test('B06 normal self-check rejected; gamble only relaxes final self-check and keeps geometry/targets', () => {
  const f = setup([checkRook(), p('rp', 'red', 'pawn', 0, 6)]);
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'rp', 0, 5)), 'SELF_CHECK');
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'rp', 1, 5, 'gamble')), 'ILLEGAL_MOVEMENT');
  accepted(f.state, f.shan, f.context, command(f.state, 'rp', 0, 5, 'gamble'));
  const ordinary = validatePublicMove(f.state, command(f.state, 'rp', 0, 5)); assert.equal(ordinary.code, 'SELF_CHECK');
});
test('B06 special choice when not checked is rejected', () => {
  const f = setup([p('rp', 'red', 'pawn', 0, 6)]);
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'rp', 0, 5, 'gamble')), 'NOT_IN_CHECK');
});
test('B07 remote advisor, enemy advisor and non-advisor cannot pay guard', () => {
  const f = setup([checkRook(), p('ra', 'red', 'advisor', 3, 7), p('ba', 'black', 'advisor', 3, 8), p('rp', 'red', 'pawn', 5, 8)]);
  for (const id of ['ra', 'ba', 'rp', 'missing']) assert.equal(code(f.state, f.shan, f.context,
    command(f.state, 'rp', 5, 7, 'guard', id)), 'GUARD_UNAVAILABLE');
});
test('B07 covered, temporary-control, absent provenance and live revived IDs propagate unknown', () => {
  const f = setup([checkRook(), p('ra', 'red', 'advisor', 3, 8), p('rp', 'red', 'pawn', 0, 6)]);
  for (const alter of [
    (s: GameState) => { s.pieces[2] = { id: 'br', x: 4, y: 4, faceDown: true }; },
    (s: GameState) => { s.effectsByPieceId = { ra: { controlTrap: { controller: 'red', blockedFormalTurn: 1 } } }; },
    (s: GameState) => { s.captured.push({ id: 'ra', color: 'red', type: 'advisor', capturedBy: 'black', moveNumber: 1 }); },
  ]) { const s = structuredClone(f.state); alter(s); assert.equal(enumerateShanReplies(s, f.shan, f.context).status, 'unknown'); }
  assert.equal(collectShanBoardFacts(f.state, f.shan, { ...f.context, ordinaryOriginalPieceIds: ['rg', 'bg', 'br', 'rp'] }).status, 'unknown');
});
test('B08 diagonal guard works for each color and is removed only in returned occupancy candidate', () => {
  for (const owner of ['red', 'black'] as const) {
    const f = owner === 'red' ? setup([checkRook(), p('ra', 'red', 'advisor', 3, 8), p('rp', 'red', 'pawn', 0, 6)]) :
      setup([p('rr', 'red', 'rook', 3, 5), p('ba', 'black', 'advisor', 4, 1), p('bp', 'black', 'pawn', 8, 3)], 'black', 'black');
    const id = owner === 'red' ? 'rp' : 'bp', guard = owner === 'red' ? 'ra' : 'ba';
    const original = structuredClone(f);
    const r = accepted(f.state, f.shan, f.context, command(f.state, id, owner === 'red' ? 0 : 8, owner === 'red' ? 5 : 4, 'guard', guard));
    assert.equal(r.candidate.pieces.some(p => p.id === guard), false); assert.equal(r.preview.sacrificePieceId, guard);
    assert.deepEqual(f, original);
  }
});
test('B08 removing guard really opens a rook path before validating the move', () => {
  const f = setup([checkRook(), p('ra', 'red', 'advisor', 3, 8), p('rr', 'red', 'rook', 2, 8)]);
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'rr', 5, 8, 'gamble')), 'ILLEGAL_MOVEMENT');
  accepted(f.state, f.shan, f.context, command(f.state, 'rr', 5, 8, 'guard', 'ra'));
});
test('B08 removal changes actual horse leg; invalid or sacrificed source leaves all originals unchanged', () => {
  const f = setup([checkRook(), p('ra', 'red', 'advisor', 3, 8), p('rh', 'red', 'horse', 3, 9)]);
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'rh', 2, 7, 'gamble')), 'ILLEGAL_MOVEMENT');
  accepted(f.state, f.shan, f.context, command(f.state, 'rh', 2, 7, 'guard', 'ra'));
  const original = structuredClone(f);
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'rh', 1, 7, 'guard', 'ra')), 'ILLEGAL_MOVEMENT');
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'ra', 4, 7, 'guard', 'ra')), 'NO_PIECE');
  assert.deepEqual(f, original);
});
test('B08 removing an advisor can expose a second real attack; guard cost never keeps its old blocking square', () => {
  const f = setup([checkRook(), p('ra', 'red', 'advisor', 3, 8), p('bh', 'black', 'horse', 3, 7), p('rp', 'red', 'pawn', 0, 6)]);
  assert.equal(f.shan.threatsOnOwner.length, 1);
  const r = accepted(f.state, f.shan, f.context, command(f.state, 'rp', 0, 5, 'guard', 'ra'));
  if (r.action.kind === 'no_reply') throw Error('move');
  assert.deepEqual(r.action.threatsOnOwnerAfter.map(t => t.pieceId), ['bh', 'br']);
});
test('B09 quota zero still permits a genuine rook block; query does not manufacture no_reply', () => {
  const f = setup([checkRook(), p('rr', 'red', 'rook', 0, 8)]); dead(f.shan);
  const replies = value(enumerateShanReplies(f.state, f.shan, f.context));
  assert.ok(replies.normal.some(c => c.pieceId === 'rr' && c.to.x === 4 && c.to.y === 8));
  assert.equal(replies.special.length, 0); assert.equal(replies.noReply, undefined);
});
test('B09 exhausted quota and no ordinary evasion yields a preview-validated no_reply fact', () => {
  const f = setup([checkRook(), p('rp', 'red', 'pawn', 0, 6)]); dead(f.shan);
  const replies = value(enumerateShanReplies(f.state, f.shan, f.context));
  assert.equal(replies.normal.length, 0); assert.equal(replies.special.length, 0); assert.ok(replies.noReply);
  assert.equal(commitShanAction(f.shan, replies.noReply!).state.outcome, 'lost_no_reply');
});
test('B10 resources alone cannot create an action when only fixed general remains', () => {
  for (const life of ['alive', 'dead'] as const) {
    const f = setup([checkRook()]); if (life === 'dead') dead(f.shan, 2);
    const r = value(enumerateShanReplies(f.state, f.shan, f.context)); assert.ok(r.noReply); assert.equal(r.special.length, 0);
  }
});
test('B10 actual pawn action creates special replies, while no-check immobility is not no_reply', () => {
  const f = setup([checkRook(), p('rp', 'red', 'pawn', 0, 6)]); dead(f.shan, 2);
  const r = value(enumerateShanReplies(f.state, f.shan, f.context)); assert.ok(r.special.length > 0); assert.equal(r.noReply, undefined);
  const quiet = setup(); const q = value(enumerateShanReplies(quiet.state, quiet.shan, quiet.context));
  assert.equal(q.normal.length, 0); assert.equal(q.noReply, undefined);
});
test('B11 static ordinary cannon check recognized; changed screen is unknown even if final check clears', () => {
  const f = setup([p('bc', 'black', 'cannon', 4, 3), p('screen', 'red', 'rook', 4, 7)]);
  assert.equal(f.shan.threatsOnOwner[0].pieceId, 'bc');
  const s = structuredClone(f.state); s.pieces.find(p => p.id === 'screen')!.x = 3;
  const r = collectShanBoardTransition(f.state, s, f.shan, f.context); assert.equal(r.status, 'unknown');
  assert.equal(enumerateShanReplies(f.state, f.shan, f.context).status, 'unknown');
});
test('B11 static cannon and unchanged screen keep continuity on unrelated ordinary moves', () => {
  const f = setup([p('bc', 'black', 'cannon', 4, 3), p('screen', 'red', 'pawn', 4, 7), p('rp', 'red', 'pawn', 0, 6)]);
  const r = accepted(f.state, f.shan, f.context, command(f.state, 'rp', 0, 5, 'gamble'));
  assert.equal(r.action.kind === 'own_move' && r.action.threatsOnOwnerAfter[0].continuationKey, f.shan.threatsOnOwner[0].continuationKey);
});
test('B11 open original WeakMap batch is caught before clone; context cannot bless an open batch', () => {
  const f = setup([checkRook(), p('rp', 'red', 'pawn', 0, 6)]);
  openDestructionBatches.set(f.state, { batchId: 'open', targets: [] });
  try {
    const r = validateShanBoardChoice(f.state, f.shan, f.context, command(f.state, 'rp', 0, 5, 'gamble'));
    assert.deepEqual(r, { status: 'unknown', reasons: ['OPEN_DESTRUCTION_BATCH'] });
    assert.equal(enumerateShanReplies(f.state, f.shan, f.context).status, 'unknown');
  } finally { openDestructionBatches.delete(f.state); }
});
test('B11 special layer, effects, mode, pending atom and unattested closure never mean safe or no replies', () => {
  const f = setup([checkRook()]);
  for (const alter of [
    (s: GameState) => { s.pieces[2].layer = 'air'; },
    (s: GameState) => { s.featureRules = { mutation: 'iron_steed' }; },
    (s: GameState) => { s.featureRules = { heroes: { red: 'wind' } }; },
    (s: GameState) => { s.gameMode = 'half_chaos'; },
    (s: GameState) => { s.landingEvents = [{ pieceId: 'br', beforeController: 'black', position: { x: 4, y: 4 }, source: 'pending' }]; },
  ]) { const s = structuredClone(f.state); alter(s); assert.equal(collectShanBoardFacts(s, f.shan, f.context).status, 'unknown'); assert.equal(enumerateShanReplies(s, f.shan, f.context).status, 'unknown'); }
  assert.equal(collectShanBoardFacts(f.state, f.shan, { ...f.context, closure: 'open' as 'stable' }).status, 'unknown');
});
test('B11 invalid/missing/duplicate generals and moved owner general are not ordinary safety proofs', () => {
  const f = setup();
  for (const pieces of [f.state.pieces.slice(1), [...f.state.pieces, p('rg2', 'red', 'general', 5, 9)],
    f.state.pieces.map(q => q.id === 'rg' ? { ...q, x: 5 } : q)]) {
    assert.equal(collectShanBoardFacts({ ...f.state, pieces }, f.shan, f.context).status, 'unknown');
  }
});
test('B12 adapter ignores forged client facts and calls core using freshly derived threats', () => {
  const f = setup([checkRook(), p('rp', 'red', 'pawn', 0, 6)]);
  const c = { ...command(f.state, 'rp', 0, 5), ordinaryMoveLegal: true, continuationKey: 'fake', threatsOnOwnerAfter: [], normalReplyExists: true };
  assert.equal(code(f.state, f.shan, f.context, c), 'SELF_CHECK');
  const r = accepted(f.state, f.shan, f.context, { ...c, choice: 'gamble' });
  assert.equal(r.preview.requiresRandom, true); assert.equal(r.preview.deathPercent, 10);
  let calls = 0; const committed = commitShanAction(f.shan, r.action, max => { calls++; assert.equal(max, 100); return 0; });
  assert.equal(calls, 1); assert.equal(committed.state.life, 'dead'); assert.equal(committed.state.remainingTurns, 6);
});
test('B12 queries leave board, private component and unrelated secret unchanged and consume no random/time', () => {
  const f = setup([checkRook(), p('ra', 'red', 'advisor', 3, 8), p('rp', 'red', 'pawn', 0, 6)]);
  const secret = { identities: {}, processedActions: {}, unrelated: 'preserve' }, original = structuredClone({ ...f, secret });
  const random = Math.random, now = Date.now; let calls = 0;
  Math.random = () => { calls++; throw Error('unexpected random'); }; Date.now = () => { calls++; throw Error('unexpected clock'); };
  try { collectShanBoardFacts(f.state, f.shan, f.context); enumerateShanReplies(f.state, f.shan, f.context);
    accepted(f.state, f.shan, f.context, command(f.state, 'rp', 0, 5, 'guard', 'ra'));
  } finally { Math.random = random; Date.now = now; }
  assert.equal(calls, 0); assert.deepEqual({ ...f, secret }, original);
});
test('B12 stale board revision, stale threat snapshots and used guard are rejected without consumption', () => {
  const f = setup([checkRook(), p('ra', 'red', 'advisor', 3, 8), p('rp', 'red', 'pawn', 0, 6)]);
  const c = command(f.state, 'rp', 0, 5, 'guard', 'ra');
  assert.equal(code(f.state, f.shan, f.context, { ...c, expectedRevision: 99 }), 'STALE_BOARD_REVISION');
  f.shan.guardUsed = true; assert.equal(code(f.state, f.shan, f.context, c), 'GUARD_UNAVAILABLE');
  f.shan.threatsOnOwner = []; assert.equal(validateShanBoardChoice(f.state, f.shan, f.context, c).status, 'unknown');
});
test('B12 ordinary attack query differs from ordinary capture-general eligibility', () => {
  const f = setup([p('rr', 'red', 'rook', 3, 6)]);
  const rook = f.state.pieces.find(p => p.id === 'rr') as RevealedPiece;
  assert.equal(canRevealedPieceAttack(f.state, rook, { x: 3, y: 0 }), true);
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'rr', 3, 0)), 'ILLEGAL_TARGET');
});

test('B11 same-ID color/type changes are unknown even when ordinary-looking final occupancy is supplied', () => {
  const f = setup([p('rr', 'red', 'rook', 0, 8)]);
  for (const patch of [{ color: 'black' as const }, { type: 'horse' as const }]) {
    const s = structuredClone(f.state); Object.assign(s.pieces.find(p => p.id === 'rr')!, patch);
    const r = collectShanBoardTransition(f.state, s, f.shan, f.context);
    assert.deepEqual(r, { status: 'unknown', reasons: ['UNRESOLVED_IDENTITY_OR_CONTROL_CHANGE'] });
  }
});
test('B01 black pawn direction and black advisor palace are read from engine rules', () => {
  const f = setup([p('bp', 'black', 'pawn', 8, 3), p('ba', 'black', 'advisor', 5, 0)], 'black', 'black');
  accepted(f.state, f.shan, f.context, command(f.state, 'bp', 8, 4));
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'bp', 8, 2)), 'ILLEGAL_MOVEMENT');
  accepted(f.state, f.shan, f.context, command(f.state, 'ba', 4, 1));
  assert.equal(code(f.state, f.shan, f.context, command(f.state, 'ba', 6, 1)), 'ILLEGAL_MOVEMENT');
});
test('B12 real ordinary checkmate is derived rather than accepted as a client flag', () => {
  const f = setup([p('rr', 'red', 'rook', 0, 2), p('support', 'red', 'rook', 4, 4), p('pawn', 'red', 'pawn', 2, 1)]);
  const r = accepted(f.state, f.shan, f.context, command(f.state, 'rr', 3, 2));
  assert.equal(r.action.kind === 'own_move' && r.action.ordinaryCheckmate, true);
  assert.equal(commitShanAction(f.shan, r.action).state.outcome, 'won_by_checkmate');
});
test('B12 core-invalid state cannot be accepted as an empty exhaustive reply proof', () => {
  const f = setup([checkRook()]); f.shan.life = 'dead';
  assert.deepEqual(enumerateShanReplies(f.state, f.shan, f.context), { status: 'unknown', reasons: ['INVALID_SHAN_STATE'] });
});
