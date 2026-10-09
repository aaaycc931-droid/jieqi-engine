import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAuthoritativeAssassination, applyAuthoritativeMove, applyHeroAbility, initializeFeatureGameState, initializeFeatureSecret, submitRemoteAssassination } from '../src/index.ts';
import type { MoveResult, RemoteRoom } from '../src/index.ts';
import { gameState, move, revealed, secretState } from './helpers.ts';

function ordinaryReplay(mutation: "shadow_dance" | "war_chariot" = "shadow_dance") {
  const s = initializeFeatureGameState(gameState([revealed('mover', 'red', 'rook', 0, 7), revealed('other', 'red', 'rook', 2, 7), revealed('reply', 'black', 'pawn', 2, 3)]), { red: 'nozdormu', black: 'hunter' }, mutation);
  s.turnStartedAt = 0; s.turnDeadlineAt = 60_000;
  const k = secretState(); initializeFeatureSecret(s, k);
  const first = applyAuthoritativeMove(s, k, move({ x: 0, y: 7 }, { x: 0, y: 6 }, 'first'), false, 55_000);
  const reply = applyAuthoritativeMove(first.state, first.secret, move({ x: 2, y: 3 }, { x: 2, y: 4 }, 'reply', first.state.revision), false, 61_000);
  reply.state.turnStartedAt = 62_000; reply.state.turnDeadlineAt = 122_000;
  return applyHeroAbility(reply.state, reply.secret, { kind: 'hero_ability', ability: 'rewind', actionId: 'rewind', expectedRevision: reply.state.revision }, 63_000);
}
function stealthReplay() {
  const s = initializeFeatureGameState(gameState([revealed('mover', 'red', 'rook', 0, 7), revealed('victim', 'black', 'rook', 0, 3), revealed('reply', 'black', 'pawn', 2, 3)]), { red: 'nozdormu', black: 'hunter' }, 'shadow_dance');
  s.turnStartedAt = 0; s.turnDeadlineAt = 60_000;
  const k = secretState(); initializeFeatureSecret(s, k);
  const hidden = applyAuthoritativeAssassination(s, k, { ...move({ x: 0, y: 7 }, { x: 0, y: 6 }, 'conceal'), kind: 'assassination', source: 'mutation', useStrongStrike: false }, 55_000);
  const reply = applyAuthoritativeMove(hidden.state, hidden.secret, move({ x: 2, y: 3 }, { x: 2, y: 4 }, 'reply', hidden.state.revision), false, 61_000);
  reply.state.turnStartedAt = 62_000; reply.state.turnDeadlineAt = 122_000;
  const exit = applyAuthoritativeAssassination(reply.state, reply.secret, { ...move({ x: 0, y: 6 }, { x: 0, y: 5 }, 'exit', reply.state.revision), kind: 'assassination', useStrongStrike: false }, 65_000);
  const second = applyAuthoritativeMove(exit.state, exit.secret, move({ x: 2, y: 4 }, { x: 2, y: 5 }, 'second', exit.state.revision), false, 70_000);
  second.state.turnStartedAt = 71_000; second.state.turnDeadlineAt = 131_000;
  return applyHeroAbility(second.state, second.secret, { kind: 'hero_ability', ability: 'rewind', actionId: 'rewind', expectedRevision: second.state.revision }, 72_000);
}
const strike = (r: MoveResult, from: {x:number;y:number}, to: {x:number;y:number}, useStrongStrike = false) => ({ ...move(from, to, 'replay-strike', r.state.revision), kind: 'assassination' as const, useStrongStrike });

test('REPLAY-ACTION-01 mutation assassination cannot substitute another piece during actual rewind', () => {
  const r = ordinaryReplay(), before = structuredClone(r);
  assert.throws(() => applyAuthoritativeAssassination(r.state, r.secret, { ...strike(r, {x:2,y:7}, {x:2,y:6}), source:'mutation' }, 64_000), e => e.code === 'REWIND_REPLAY');
  assert.deepEqual(r, before);
});
test('REPLAY-ACTION-02 restored stealth carrier cannot capture with strong strike during replay', () => {
  const r = stealthReplay(), before = structuredClone(r);
  assert.equal(r.secret.replay?.pieceId, 'mover'); assert(r.state.effectsByPieceId?.mover?.stealth);
  assert.throws(() => applyAuthoritativeAssassination(r.state, r.secret, strike(r, {x:0,y:6}, {x:0,y:3}, true), 73_000), e => e.code === 'REWIND_REPLAY');
  assert.deepEqual(r, before);
});
test('REPLAY-ACTION-03 restored stealth replay to empty square clears pending replay and preserves spent charge', () => {
  const r = stealthReplay();
  const command = strike(r, {x:0,y:6}, {x:1,y:6});
  const after = applyAuthoritativeAssassination(r.state, r.secret, command, 73_000);
  assert.equal(after.secret.replay, undefined); assert.equal(after.secret.rewindUsed?.red, true);
  assert.equal(after.state.assassination?.red.mutationChargeAvailable, false);
  assert.equal(after.state.effectsByPieceId?.mover?.stealth, undefined);
  assert.equal(after.state.turn, 'black');
  const duplicate = applyAuthoritativeAssassination(after.state, after.secret, command, 99_000);
  assert.equal(duplicate.duplicate, true); assert.deepEqual(duplicate.state, after.state); assert.deepEqual(duplicate.secret, after.secret);
});
test('REPLAY-ACTION-04 restored stealth cannot exit with a move that gives check during replay', () => {
  const r = stealthReplay(), before = structuredClone(r);
  assert.throws(() => applyAuthoritativeAssassination(r.state, r.secret, strike(r, {x:0,y:6}, {x:5,y:6}), 73_000), e => e.code === 'REWIND_REPLAY_CHECK');
  assert.deepEqual(r, before);
});
test('REPLAY-ACTION-05 same-piece empty assassination obeys replay completion and spends only mutation charge', () => {
  const r = ordinaryReplay();
  const after = applyAuthoritativeAssassination(r.state, r.secret, { ...strike(r, {x:0,y:7}, {x:1,y:7}), source:'mutation' }, 64_000);
  assert.equal(after.secret.replay, undefined); assert.equal(after.secret.rewindUsed?.red, true);
  assert.equal(after.state.assassination?.red.mutationChargeAvailable, false); assert(after.state.effectsByPieceId?.mover?.stealth);
});
test('REPLAY-ACTION-06 room receipt at exact replay deadline settles timeout before consuming assassination', () => {
  const r = ordinaryReplay();
  const room = {roomId:'replay-clock',phase:'playing',updatedAt:63_000,game:{players:{red:'alice',black:'bob'},state:r.state,secret:r.secret}} as RemoteRoom;
  const before = structuredClone(room);
  const after = submitRemoteAssassination(room, 'alice', { ...strike(r, {x:0,y:7}, {x:1,y:7}), source:'mutation' }, r.secret.replay!.deadlineAt).room;
  assert.equal(after.phase,'finished'); assert.equal(after.game!.state.reason,'timeout');
  assert.equal(after.game!.state.assassination?.red.mutationChargeAvailable, true);
  assert.equal(after.game!.state.pieces.find(p=>p.id==='mover')?.x,0);
  assert.deepEqual(room,before);
});

test('REPLAY-ACTION-07 malformed chariot replay destinations reject without path walk or state change', () => {
  const r=ordinaryReplay('war_chariot'), before=structuredClone(r);
  for(const to of [{x:1,y:8},{x:0.5,y:7},{x:0,y:10}]) {
    assert.throws(()=>applyAuthoritativeMove(r.state,r.secret,move({x:0,y:7},to,'malformed',r.state.revision),false,64_000));
    assert.deepEqual(r,before);
  }
});
