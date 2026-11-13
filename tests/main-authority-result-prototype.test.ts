import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OfflineAuthorityResultPrototype, canonicalJson, type CoveredAction } from '../scripts/research/main-authority-result-prototype.ts';
import { createRemoteRoom, joinRemoteRoom, submitRemoteRps, submitRemoteMove } from '../src/remote-room.ts';
import { BluetoothHostRoom, BLUETOOTH_HOST_PLAYER as H, BLUETOOTH_GUEST_PLAYER as G } from '../src/bluetooth-host-room.ts';
import { encodeBluetoothEnvelope, parseBluetoothEnvelope } from '../src/bluetooth-protocol.ts';

const scope = { authorityId: 'offline-authority-1', roomId: 'offline-room', matchEpoch: 'match-1' };
const hero = (name: 'hunter' | 'shuffler' = 'hunter'): CoveredAction => ({ kind: 'hero', hero: name });
const resign: CoveredAction = { kind: 'resign', expectedRevision: 0, actionId: 'resign-1' };
function initial(heroes = true) {
  return joinRemoteRoom(createRemoteRoom(scope.roomId, H, 'fixture-secret', 100,
    { baseMode: 'jieqi', heroesEnabled: heroes, mutationsEnabled: false }), G, 'fixture-secret', 100).room;
}
function playing() {
  const first = submitRemoteRps(initial(false), H, 'rock', 1, () => 0, 100);
  return submitRemoteRps(first, G, 'scissors', 1, () => 0, 100);
}
const request = (transportId: string, action: CoveredAction, actor = H) => ({ transportId, action, actor });
const query = (transportId: string, action: unknown, s = scope) => ({ scope: s, transportId, action });
const accepted = { query: 'valid', outcome: 'accepted' };
const unknown = { query: 'valid', outcome: 'unknown' };

test('SOURCE: all 36 imported production/package blobs match fixed PR22', () => {
  const manifest = JSON.parse(readFileSync(new URL('../review/main-result-prototype/source-manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.engineCommit, '71145df45ad17215a3731e53150b6728e079e375');
  for (const file of manifest.files) {
    const b = readFileSync(new URL('../' + file.path, import.meta.url));
    assert.equal(createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'), file.blob, file.path);
  }
});

test('hero attempt has no game action ID; exact attempt survives phase transition and repeated queries', () => {
  const p = new OfflineAuthorityResultPrototype({ scope, room: initial(), randomInt: () => 0 });
  p.handle(request('transport-host', hero()), 100);
  p.handle(request('transport-guest', hero('shuffler'), G), 100);
  assert.equal(p.inspectForResearch().phase, 'rps');
  for (let i = 0; i < 3; i++) assert.deepEqual(p.query(H, query('transport-host', hero())), accepted);
  assert.deepEqual(p.query(H, query('fabricated-id', hero())), unknown);
});

test('new hero attempt rejection does not replace the original accepted receipt', () => {
  const p = new OfflineAuthorityResultPrototype({ scope, room: initial(), randomInt: () => 0 });
  p.handle(request('first', hero()), 100);
  assert.throws(() => p.handle(request('later', hero('shuffler')), 100), { code: 'HERO_ALREADY_LOCKED' });
  assert.deepEqual(p.query(H, query('first', hero())), accepted);
  assert.deepEqual(p.query(H, query('later', hero('shuffler'))), { query: 'valid', outcome: 'rejected', ruleCode: 'HERO_ALREADY_LOCKED' });
});

test('hero expiry follows actual host dispatch ordering and never falsely accepts the late selection', () => {
  const room = initial(), deadline = room.features!.heroSelection!.deadlineAt;
  const p = new OfflineAuthorityResultPrototype({ scope, room, randomInt: () => 0 });
  assert.throws(() => p.handle(request('late', hero('shuffler')), deadline), { code: 'INVALID_PHASE' });
  assert.deepEqual(p.query(H, query('late', hero('shuffler'))), { query: 'valid', outcome: 'rejected', ruleCode: 'INVALID_PHASE' });
  assert.notDeepEqual(p.inspectForResearch(), room, 'clock settlement is independent of the command rejection');
});

test('same raw normal-return API would time out; a result is not inferred just from room changes', async () => {
  const { submitRemoteHeroSelection } = await import('../src/remote-room.ts');
  const room = initial(), deadline = room.features!.heroSelection!.deadlineAt;
  const returned = submitRemoteHeroSelection(room, H, 'shuffler', () => 0, deadline);
  assert.notEqual(returned.featureSecret?.heroSelection?.choices[H], 'shuffler');
  // This direct-call control does not grant a prototype receipt for an unrecorded request.
  const p = new OfflineAuthorityResultPrototype({ scope, room: returned, randomInt: () => 0 });
  assert.deepEqual(p.query(H, query('not-recorded', hero('shuffler'))), unknown);
});

test('natural RPS to resign to finished: old receipt remains accepted after a later INVALID_PHASE', () => {
  const p = new OfflineAuthorityResultPrototype({ scope, room: playing(), randomInt: () => 0 });
  p.handle(request('original', resign), 100);
  assert.equal(p.inspectForResearch().phase, 'finished');
  assert.throws(() => p.handle(request('later', resign), 100), { code: 'INVALID_PHASE' });
  assert.deepEqual(p.query(H, query('original', resign)), accepted);
  assert.deepEqual(p.query(H, query('later', resign)), { query: 'valid', outcome: 'rejected', ruleCode: 'INVALID_PHASE' });
});

test('postcommit projection fault is isolated from original action evidence', () => {
  const p = new OfflineAuthorityResultPrototype({ scope, room: playing(), projectionForTest: () => { throw Error('injected projection failure'); } });
  assert.throws(() => p.handle(request('original', resign), 100), /injected projection/);
  assert.equal(p.inspectForResearch().game!.state.reason, 'resign');
  assert.deepEqual(p.query(H, query('original', resign)), accepted);
});

test('pre-dispatch RNG fault has no fabricated rule rejection', () => {
  const room = initial(), deadline = room.features!.heroSelection!.deadlineAt;
  const p = new OfflineAuthorityResultPrototype({ scope, room, randomInt: () => { throw Error('injected RNG failure'); } });
  assert.throws(() => p.handle(request('broken', hero()), deadline), /injected RNG/);
  assert.deepEqual(p.query(H, query('broken', hero())), unknown);
});

test('query never advances expired clocks, consumes RNG, projects, or mutates the authority', () => {
  let draws = 0, projections = 0;
  const p = new OfflineAuthorityResultPrototype({ scope, room: initial(), randomInt: () => { draws++; return 0; },
    projectionForTest: () => { projections++; } });
  p.handle(request('original', hero()), 100);
  const before = p.inspectForResearch(), counts = [draws, projections];
  for (let i = 0; i < 20; i++) p.query(H, query('original', hero()));
  assert.deepEqual(p.inspectForResearch(), before); assert.deepEqual([draws, projections], counts);
});

test('actor authority: another bound player cannot look up this actor record; unknown caller is invalid', () => {
  const p = new OfflineAuthorityResultPrototype({ scope, room: initial() });
  p.handle(request('private', hero()), 100);
  assert.deepEqual(p.query(G, query('private', hero())), unknown);
  assert.deepEqual(p.query('outsider', query('private', hero())), { query: 'invalid' });
  assert.equal(JSON.stringify(p.query(G, query('private', hero()))).includes('hunter'), false);
});

test('JSON key ordering matches, but changed hero, omitted/null/default/extra fields cannot borrow a receipt', () => {
  const p = new OfflineAuthorityResultPrototype({ scope, room: initial() });
  p.handle(request('original', hero()), 100);
  assert.deepEqual(p.query(H, query('original', { hero: 'hunter', kind: 'hero' })), accepted);
  for (const action of [hero('shuffler'), { ...hero(), variant: null }, { ...hero(), form: 'front' }, { ...hero(), extra: 1 }])
    assert.deepEqual(p.query(H, query('original', action)), { query: 'invalid' });
});

test('authority restart / different match epoch / missing record cannot reconstruct prior outcomes', () => {
  const p = new OfflineAuthorityResultPrototype({ scope, room: initial() });
  p.handle(request('original', hero()), 100);
  for (const s of [{ ...scope, matchEpoch: 'match-2' }, { ...scope, authorityId: 'new-authority' }, { ...scope, roomId: 'other' }])
    assert.deepEqual(p.query(H, query('original', hero(), s)), unknown);
  const restarted = new OfflineAuthorityResultPrototype({ scope: { ...scope, authorityId: 'new-authority' }, room: p.inspectForResearch() });
  assert.deepEqual(restarted.query(H, query('original', hero())), unknown);
  assert.deepEqual(restarted.query(H, query('original', hero(), { ...scope, authorityId: 'new-authority' })), unknown);
});

test('FIFO count eviction and oversized binding leave unknown, never not-sent/rejected', () => {
  const p = new OfflineAuthorityResultPrototype({ scope, room: initial(), maxRecords: 1 });
  p.handle(request('first', hero()), 100); p.handle(request('second', hero(), G), 100);
  assert.deepEqual(p.query(H, query('first', hero())), unknown);
  assert.deepEqual(p.query(G, query('second', hero())), accepted);
  const b = new OfflineAuthorityResultPrototype({ scope, room: initial(), maxBindingBytes: 1 });
  b.handle(request('large', hero()), 100);
  assert.equal(b.inspectForResearch().featureSecret!.heroSelection!.choices[H], 'hunter');
  assert.deepEqual(b.query(H, query('large', hero())), unknown);
});

test('ID-only engine dedup cannot authenticate a new resign payload', () => {
  const moved = submitRemoteMove(playing(), H,
    { from: { x: 0, y: 9 }, to: { x: 0, y: 8 }, expectedRevision: 0, actionId: 'same-game-id' }, 100, () => 0).room;
  const p = new OfflineAuthorityResultPrototype({ scope, room: moved });
  const action: CoveredAction = { kind: 'resign', actionId: 'same-game-id', expectedRevision: moved.game!.state.revision };
  p.handle(request('different-attempt', action), 100);
  assert.equal(p.inspectForResearch().phase, 'playing');
  assert.deepEqual(p.query(H, query('different-attempt', action)), unknown);
});

test('unsupported action / same research attempt are refused before execution without changing old evidence', () => {
  const p = new OfflineAuthorityResultPrototype({ scope, room: initial() });
  p.handle(request('original', hero()), 100);
  const before = p.inspectForResearch();
  assert.throws(() => p.handle(request('original', hero()), 100), /Fresh research/);
  assert.throws(() => p.handle(request('uncovered', { kind: 'preparation_ready' } as any), 100), /not covered/);
  assert.deepEqual(p.inspectForResearch(), before);
  assert.deepEqual(p.query(H, query('original', hero())), accepted);
});

test('caller mutations to input, returned answer and research snapshot cannot rewrite saved evidence', () => {
  const action = hero(), room = initial();
  const p = new OfflineAuthorityResultPrototype({ scope, room });
  p.handle(request('original', action), 100);
  (action as any).hero = 'shuffler';
  const answer = p.query(H, query('original', hero())); (answer as any).outcome = 'rejected';
  p.inspectForResearch().phase = 'finished'; room.phase = 'finished';
  assert.deepEqual(p.query(H, query('original', hero())), accepted);
  assert.equal(p.inspectForResearch().phase, 'hero_selection');
});

test('prototype success output matches actual unchanged BluetoothHostRoom for same hero source', () => {
  const p = new OfflineAuthorityResultPrototype({ scope, room: initial(), randomInt: () => 0 });
  const host = new BluetoothHostRoom({ roomId: scope.roomId, admissionSecret: 'fixture-secret', now: () => 100,
    randomInt: () => 0, mode: { baseMode: 'jieqi', heroesEnabled: true, mutationsEnabled: false } });
  assert.deepEqual(p.handle(request('original', hero()), 100), host.handle(H, hero()));
});

test('prototype resign output matches unchanged host from the same natural RPS prefix', () => {
  const p = new OfflineAuthorityResultPrototype({ scope, room: playing(), randomInt: () => 0 });
  const host = new BluetoothHostRoom({ roomId: scope.roomId, admissionSecret: 'fixture-secret', now: () => 100,
    randomInt: () => 0, mode: { baseMode: 'jieqi', heroesEnabled: false, mutationsEnabled: false } });
  host.handle(H, { kind: 'rps', choice: 'rock', round: 1 });
  host.handle(G, { kind: 'rps', choice: 'scissors', round: 1 });
  assert.deepEqual(p.handle(request('original', resign), 100), host.handle(H, resign));
});

test('aggregate binding-byte limit evicts oldest even below count limit; queries do not renew retention', () => {
  const size = new TextEncoder().encode(canonicalJson(hero())).length;
  const p = new OfflineAuthorityResultPrototype({ scope, room: initial(), maxRecords: 20, maxBindingBytes: size * 2 - 1 });
  p.handle(request('first', hero()), 100);
  p.query(H, query('first', hero()));
  p.handle(request('second', hero(), G), 100);
  assert.deepEqual(p.query(H, query('first', hero())), unknown);
  assert.deepEqual(p.query(G, query('second', hero())), accepted);
});

test('canonical binding rejects lossy/non-data inputs without invoking accessors', () => {
  let calls = 0; const getter = { get a() { calls++; return 1; } };
  for (const v of [{ x: undefined }, { n: NaN }, getter, [ , 1], new Date(), { f() {} }]) assert.throws(() => canonicalJson(v));
  const cycle: any = {}; cycle.self = cycle; assert.throws(() => canonicalJson(cycle));
  assert.equal(calls, 0);
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('old v2 parser permits a namespaced hello but still rejects a v3/new-type upgrade', () => {
  const envelope = { v: 2 as const, type: 'hello' as const, payload: { leziResultQuery: { schema: 1, op: 'offer' } } };
  assert.deepEqual(parseBluetoothEnvelope(encodeBluetoothEnvelope(envelope)), envelope);
  assert.throws(() => parseBluetoothEnvelope(JSON.stringify({ ...envelope, v: 3, type: 'result_query' })));
  // Parser capability only: no negotiated protocol, bridge, or device run here.
});
