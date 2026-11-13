import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { issueOriginalStandardH10Preparation, withExactStandardH10Preparation, registerExactResearchRoom } from '../../src/research-source-context.ts';
import { createRemoteRoom, joinRemoteRoom, submitRemoteHeroSelection, submitRemoteRps, completeRemoteHeroIntro, submitRemoteHeroPreparationChoice, playerRoomView, publicRemoteRoom, type RemoteRoom } from '../../src/remote-room.ts';

const fixture = new URL('../fixtures/standard-h10/', import.meta.url);
const prefix = readFileSync(new URL('PREFIX_CONTRACT.json', fixture), 'utf8');
const confirmation = readFileSync(new URL('FIRST_SAMPLING_CONFIRMATION.json', fixture), 'utf8');
const context = { roomId: 'std-review-t0', tupleId: 'STD-H10-PREPARATION' as const, players: { red: 'red', black: 'black' } };
function setup(offer = true) {
  const cap = issueOriginalStandardH10Preparation(context, prefix, confirmation);
  let room: RemoteRoom;
  const call = (op: () => RemoteRoom) => withExactStandardH10Preparation(cap, () => {
    const result = op(); registerExactResearchRoom(result); room = result; return result;
  });
  const mutation = (bound: number) => { assert.equal(bound, 8); return 3; };
  call(() => createRemoteRoom(context.roomId, 'red', 'token', 1000, { baseMode: 'xiangqi', heroesEnabled: true, mutationsEnabled: true }));
  call(() => joinRemoteRoom(room, 'black', 'token', 1100).room);
  call(() => submitRemoteHeroSelection(room, 'red', 'rogue', mutation, 1200));
  call(() => submitRemoteHeroSelection(room, 'black', 'wind', mutation, 1300));
  call(() => submitRemoteRps(room, 'red', 'rock', 1, mutation, 1400));
  call(() => submitRemoteRps(room, 'black', 'scissors', 1, mutation, 1500));
  call(() => completeRemoteHeroIntro(room, 'red', 1600));
  if (offer) call(() => completeRemoteHeroIntro(room, 'black', 1700));
  return { cap, call, get room() { return room; } };
}

test('STD-R01 late second/third RNG failure leaves authority intact and permits clean actual retry', () => {
  // Fault injection affects entropy only; never installs a board, host or offer.
  for (const failAt of [2, 3]) for (const kind of ['range', 'throw']) {
    const s = setup(false), before = structuredClone(s.room); let draws = 0;
    assert.throws(() => s.call(() => completeRemoteHeroIntro(s.room, 'black', 1700, bound => {
      if (++draws === failAt) { if (kind === 'throw') throw new Error('review entropy failure'); return bound; }
      return 0;
    })), kind === 'range' ? RangeError : /review entropy failure/);
    assert.equal(draws, failAt); assert.deepEqual(s.room, before);
    assert.equal(s.room.game!.secret.windPreparation, undefined);
    s.call(() => completeRemoteHeroIntro(s.room, 'black', 1700)); // default production crypto
    assert.equal(new Set(playerRoomView(s.room, 'black').ownWindPreparation!.candidates.map(c => c.pieceId)).size, 3);
    assert.equal(s.room.game!.secret.wind!.black!.uses, 0);
  }
});

test('STD-R02 mutating owner projections cannot rewrite offer; all three actual choices clear locators', () => {
  const s = setup(), original = s.room, before = structuredClone(original);
  const view = playerRoomView(original, 'black');
  const ids = view.ownWindPreparation!.candidates.map(c => c.pieceId);
  view.ownWindPreparation!.candidates[0].pieceId = 'red_general';
  view.ownWindPreparation!.candidates[0].x = 99;
  view.ownHeroSecrets!.wind!.uses = 99;
  assert.deepEqual(original, before);
  assert.throws(() => s.call(() => submitRemoteHeroPreparationChoice(original, 'black', {windCandidateId: view.ownWindPreparation!.candidates[0].pieceId}, 1800)), (e: any) => e.code === 'INVALID_SHADOW_TARGET');
  assert.deepEqual(original, before);
  // Three alternative returns from the same original offer, NOT wire retries.
  const results = ids.map(id => s.call(() => submitRemoteHeroPreparationChoice(original, 'black', {windCandidateId: id}, 1800)));
  for (let i = 0; i < results.length; i++) {
    const result = results[i], owner = playerRoomView(result, 'black');
    assert.equal(result.game!.secret.wind!.black!.hostId, ids[i]);
    assert.equal(owner.ownWindPreparation, undefined);
    assert.equal(Object.hasOwn(owner.ownHeroSecrets!.wind!, 'hostId'), false);
    assert.deepEqual(result.game!.state, before.game!.state);
    assert.deepEqual(publicRemoteRoom(result), publicRemoteRoom(results[0]));
    assert.deepEqual(playerRoomView(result, 'red'), playerRoomView(results[0], 'red'));
    assert.equal(result.game!.secret.wind!.black!.uses, 1);
  }
  assert.deepEqual(original, before);
});

test('STD-R03 separately issued capability with identical room/players cannot consume another authority', () => {
  const a = setup(), b = setup();
  const beforeA = structuredClone(a.room), beforeB = structuredClone(b.room);
  const id = playerRoomView(a.room, 'black').ownWindPreparation!.candidates[0].pieceId;
  assert.throws(() => withExactStandardH10Preparation(b.cap, () => submitRemoteHeroPreparationChoice(a.room, 'black', {windCandidateId:id}, 1800)), (e: any) => e.code === 'RESEARCH_SCOPE_INVALID');
  assert.deepEqual(a.room, beforeA); assert.deepEqual(b.room, beforeB);
  a.call(() => submitRemoteHeroPreparationChoice(a.room, 'black', {windCandidateId:id}, 1800));
  assert.equal(a.room.game!.secret.wind!.black!.hostId, id);
});
