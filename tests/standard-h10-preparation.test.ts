import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runStandardH10Preparation } from '../scripts/research/standard-h10-preparation.ts';
import { issueOriginalStandardH10Preparation, withExactStandardH10Preparation, registerExactResearchRoom, modeResearchPermits } from '../src/research-source-context.ts';
import { beginWindPreparation, sampleThreeDistinctBodies, chooseWindPreparation } from '../src/wind-preparation.ts';
import { createRemoteRoom, joinRemoteRoom, submitRemoteHeroSelection, submitRemoteRps, completeRemoteHeroIntro, completeRemoteHeroPreparation,
  submitRemoteHeroPreparationChoice, advanceRemoteRoomTime, playerRoomView, submitRemoteMove, submitRemoteHeroAbility, submitRemoteAssassination, type RemoteRoom } from '../src/remote-room.ts';
import { GAME_MODES } from '../src/modes.ts';
import { disconnectRemotePlayer, reconnectRemotePlayer, forfeitRemoteRoom, surrenderRemoteRoom, requestRemoteRematch, respondRemoteRematch, submitRemoteChat } from '../src/remote-room.ts';
import { BluetoothHostRoom } from '../src/bluetooth-host-room.ts';
const base = new URL('./fixtures/standard-h10/', import.meta.url);
const prefix = readFileSync(new URL('PREFIX_CONTRACT.json', base), 'utf8');
const confirmation = readFileSync(new URL('FIRST_SAMPLING_CONFIRMATION.json', base), 'utf8');
const ctx = { roomId: 'h10-test', tupleId: 'STD-H10-PREPARATION' as const, players: { red: 'red', black: 'black' } };
const issue = () => issueOriginalStandardH10Preparation(ctx, prefix, confirmation);
const code = (code: string) => (e: any) => e.code === code;
const coverage = (e: any) => e.name === 'WindPreparationCoverageError';
function prepare(stopAtIntro = false) {
  const cap = issue(); let room: RemoteRoom;
  const call = (f: () => RemoteRoom) => withExactStandardH10Preparation(cap, () => { const next = f(); registerExactResearchRoom(next); room = next; return next; });
  call(() => createRemoteRoom(ctx.roomId, 'red', 'token', 1000, { baseMode: 'xiangqi', heroesEnabled: true, mutationsEnabled: true }));
  call(() => joinRemoteRoom(room, 'black', 'token', 1100).room);
  call(() => submitRemoteHeroSelection(room, 'red', 'rogue', () => 3, 1200));
  call(() => submitRemoteHeroSelection(room, 'black', 'wind', () => 3, 1300));
  call(() => submitRemoteRps(room, 'red', 'rock', 1, () => 3, 1400));
  call(() => submitRemoteRps(room, 'black', 'scissors', 1, () => 3, 1500));
  call(() => completeRemoteHeroIntro(room, 'red', 1600));
  if (!stopAtIntro) call(() => completeRemoteHeroIntro(room, 'black', 1700)); // actual default crypto RNG
  return { cap, call, get room() { return room; } };
}

test('H10-01 actual full32 preparation, stable private candidates, immediate T0 first use', () => {
  const result = runStandardH10Preparation(prefix, confirmation), prepared = result.prepared.authority;
  assert.equal(prepared.phase, 'hero_preparation');
  assert.equal(prepared.game!.state.pieces.length, 32); assert(prepared.game!.state.pieces.every(p => !p.faceDown));
  assert.deepEqual(prepared.game!.secret.identities, {});
  assert.deepEqual(result.draws.map(x => x.bound), [15, 14, 13]);
  const candidates = result.prepared.views.black.ownWindPreparation!.candidates;
  assert.equal(new Set(candidates.map(x => x.pieceId)).size, 3);
  for (const c of candidates) { const p = prepared.game!.state.pieces.find(p => p.id === c.pieceId)!; assert.equal(p.color, 'black'); assert.notEqual(p.type, 'general'); assert.equal(p.x, c.x); assert.equal(p.y, c.y); }
  for (const c of result.controls) {
    const wind = c.authority.game!.secret.wind!.black!;
    assert.equal(c.authority.phase, 'playing'); assert.equal(wind.hostId, c.chosen);
    assert.equal(wind.uses, 1); assert.equal(wind.activatedOnTurn, 0); assert.equal(wind.readyOnTurn, 8);
    assert.deepEqual(c.authority.game!.state, prepared.game!.state);
    assert.equal(c.authority.game!.state.revision, 0); assert.equal(c.authority.game!.state.turnLifecycle, undefined);
    assert.equal(c.authority.game!.state.turnDeadlineAt, undefined);
    assert.equal(c.views.black.ownWindPreparation, undefined); assert.equal(c.views.black.ownHeroSecrets?.wind?.hostId, undefined);
    assert.deepEqual(c.authority.game!.secret.windPreparation!.black, { candidateIds: [], poolBinding: '', completed: true });
  }
});
test('H10-02 actual offer is owner-only; two choices have equal public/opponent views at T0', () => {
  const r = runStandardH10Preparation(prefix, confirmation);
  assert.equal('ownWindPreparation' in r.prepared.views.public, false); assert.equal(r.prepared.views.red.ownWindPreparation, undefined);
  assert.deepEqual(r.controls[0].views.public, r.controls[1].views.public);
  assert.deepEqual(r.controls[0].views.red, r.controls[1].views.red);
  assert.notEqual(r.controls[0].chosen, r.controls[1].chosen);
  assert.equal(r.limits.originalR1R5Executed, false);
});
test('H10-03 exhaustive five-body kernel has 60 ordered triples, six orders per three-body subset', () => {
  const triples = new Set<string>(), subsets = new Map<string, number>();
  for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 3; c++) {
    const tape = [a,b,c], bounds: number[] = [];
    const result = sampleThreeDistinctBodies(['a','b','c','d','e'], max => { bounds.push(max); return tape.shift()!; });
    assert.deepEqual(bounds, [5,4,3]); assert.equal(new Set(result).size, 3);
    triples.add(result.join(',')); const key = result.sort().join(','); subsets.set(key, (subsets.get(key) ?? 0) + 1);
  }
  assert.equal(triples.size, 60); assert.equal(subsets.size, 10); assert([...subsets.values()].every(n => n === 6));
});
test('H10-04 shortages/duplicate bodies stop without defining product compensation', () => {
  for (const ids of [[], ['a'], ['a','b'], ['a','a','b']]) assert.throws(() => sampleThreeDistinctBodies(ids, () => { throw new Error('must not draw'); }), coverage);
});
test('H10-05 RNG failures are atomic at actual final intro API', () => {
  for (const bad of [-1,15,0.5,NaN,Infinity]) {
    const s = prepare(true), before = structuredClone(s.room);
    assert.throws(() => s.call(() => completeRemoteHeroIntro(s.room, 'black', 1700, () => bad)), RangeError);
    assert.deepEqual(s.room, before);
  }
});
test('H10-06 re-entering the same private preparation does not reroll', () => {
  const s = prepare(), before = structuredClone(s.room);
  withExactStandardH10Preparation(s.cap, () => beginWindPreparation(s.room.game!.state, s.room.game!.secret, 'black', () => { throw new Error('must not draw'); }));
  assert.deepEqual(s.room, before);
});
test('H10-07 non-candidate and wrong actor are rejected without state or charge changes', () => {
  const s = prepare(), before = structuredClone(s.room);
  assert.throws(() => s.call(() => submitRemoteHeroPreparationChoice(s.room, 'black', { windCandidateId: 'red_general' }, 1800)), code('INVALID_SHADOW_TARGET'));
  assert.throws(() => s.call(() => submitRemoteHeroPreparationChoice(s.room, 'red', { windCandidateId: s.room.game!.secret.windPreparation!.black!.candidateIds[0] }, 1800)), code('RESEARCH_SOURCE_MISMATCH'));
  assert.deepEqual(s.room, before);
});
test('H10-08 deadline choice/clock/ready skip do not silently select a candidate', () => {
  const s = prepare(), before = structuredClone(s.room), deadline = s.room.features!.heroPreparation!.deadlineAt;
  assert.throws(() => s.call(() => submitRemoteHeroPreparationChoice(s.room, 'black', { windCandidateId: before.game!.secret.windPreparation!.black!.candidateIds[0] }, deadline)), coverage);
  assert.throws(() => s.call(() => advanceRemoteRoomTime(s.room, undefined, deadline)), coverage);
  assert.throws(() => s.call(() => completeRemoteHeroPreparation(s.room, 'black', 1800)), coverage);
  assert.deepEqual(s.room, before);
});
test('H10-09 candidate movement/invalidation stops; negative probe is not an actual preparation fixture', () => {
  const s = prepare(), clone = structuredClone(s.room.game!), candidate = clone.secret.windPreparation!.black!.candidateIds[0];
  clone.state.pieces.find(p => p.id === candidate)!.x += 1;
  const before = structuredClone(clone);
  assert.throws(() => withExactStandardH10Preparation(s.cap, () => chooseWindPreparation(clone.state, clone.secret, 'black', candidate)), coverage);
  assert.deepEqual(clone, before);
});
test('H10-10 successful preparation cannot grant formal moves, assassination, shadow, or clock', () => {
  const s = prepare(); s.call(() => submitRemoteHeroPreparationChoice(s.room, 'black', { windCandidateId: s.room.game!.secret.windPreparation!.black!.candidateIds[0] }, 1800));
  const before = structuredClone(s.room), command = { actionId: 'unqualified', expectedRevision: 0, from: {x:0,y:6}, to: {x:0,y:5} };
  const ops = [() => submitRemoteMove(s.room, 'red', command, 1900), () => submitRemoteAssassination(s.room, 'red', {...command, kind:'assassination', activate:true} as any, 1900),
    () => submitRemoteHeroAbility(s.room, 'black', {kind:'hero_ability',ability:'shadow',actionId:'shadow',expectedRevision:0}, 1900), () => advanceRemoteRoomTime(s.room, undefined, 1900),
    () => submitRemoteHeroPreparationChoice(s.room, 'black', {windCandidateId:'anything'}, 1900)];
  for (const op of ops) assert.throws(() => withExactStandardH10Preparation(s.cap, op), coverage);
  assert.deepEqual(s.room, before);
});
test('H10-11 source bytes, tuple, frozen issued identity and synchronous scope are enforced', () => {
  assert.throws(() => issueOriginalStandardH10Preparation(ctx, prefix+' ', confirmation), code('RESEARCH_SCOPE_INVALID'));
  assert.throws(() => issueOriginalStandardH10Preparation(ctx, prefix, confirmation+' '), code('RESEARCH_SCOPE_INVALID'));
  assert.throws(() => issueOriginalStandardH10Preparation({...ctx,tupleId:'other'} as any, prefix, confirmation), code('RESEARCH_SCOPE_INVALID'));
  const cap = issue(); assert(Object.isFrozen(cap)); assert(Object.isFrozen(cap.players));
  assert.throws(() => withExactStandardH10Preparation({...cap}, () => true), code('RESEARCH_SCOPE_INVALID'));
  assert.throws(() => withExactStandardH10Preparation(cap, () => withExactStandardH10Preparation(cap, () => true)), code('RESEARCH_SCOPE_INVALID'));
  assert.throws(() => withExactStandardH10Preparation(cap, () => Promise.resolve()), TypeError);
  assert.equal(modeResearchPermits('xiangqi'), false);
});
test('H10-12 wrong room/mode/source and copied authority cannot borrow preparation admission', () => {
  const s = prepare(), mode = {baseMode:'xiangqi' as const,heroesEnabled:true,mutationsEnabled:true};
  assert.throws(() => withExactStandardH10Preparation(s.cap, () => createRemoteRoom('wrong', 'red','token',1000,mode)), code('RESEARCH_SCOPE_INVALID'));
  assert.throws(() => withExactStandardH10Preparation(s.cap, () => createRemoteRoom(ctx.roomId,'red','token',1000,{...mode,baseMode:'half_chaos'})), code('MODE_ADAPTATION_PENDING'));
  assert.equal(withExactStandardH10Preparation(s.cap, () => modeResearchPermits('xiangqi', {heroes:{red:'rogue',black:'wind'}, mutation:'iron_steed'})), false);
  assert.throws(() => withExactStandardH10Preparation(s.cap, () => submitRemoteHeroPreparationChoice(structuredClone(s.room),'black',{},1800)), code('RESEARCH_SCOPE_INVALID'));
  assert.throws(() => submitRemoteHeroPreparationChoice(s.room,'black',{},1800), code('MODE_ADAPTATION_PENDING'));
});
test('H10-13 ordinary product and Bluetooth gates remain closed; non-player cannot read candidates', () => {
  assert.equal(GAME_MODES.xiangqi.featuresReady, false);
  assert.throws(() => createRemoteRoom('ordinary','red','token',1000,{baseMode:'xiangqi',heroesEnabled:true,mutationsEnabled:true}), code('MODE_ADAPTATION_PENDING'));
  assert.throws(() => new BluetoothHostRoom({roomId:'bt',admissionSecret:'token',mode:{baseMode:'xiangqi',heroesEnabled:true,mutationsEnabled:true}}), code('MODE_TRANSPORT_PENDING'));
  assert.throws(() => playerRoomView(prepare().room,'outsider'), code('NOT_PLAYER'));
});
test('H10-14 preparation capability does not grant unqualified transport, exit, chat or rematch lifecycle', () => {
  const s = prepare(), before = structuredClone(s.room);
  for (const op of [() => disconnectRemotePlayer(s.room, 'black', 1800), () => reconnectRemotePlayer(s.room, 'black', 1800),
    () => forfeitRemoteRoom(s.room, 'black', 'exit', 1800), () => surrenderRemoteRoom(s.room, 'black', 0, 'resign', 1800),
    () => requestRemoteRematch(s.room, 'black', 'rematch', 1800), () => respondRemoteRematch(s.room, 'black', true, 1800),
    () => submitRemoteChat(s.room, 'black', 'chat', 'message', 1800)]) assert.throws(() => withExactStandardH10Preparation(s.cap, op), coverage);
  assert.deepEqual(s.room, before);
});
