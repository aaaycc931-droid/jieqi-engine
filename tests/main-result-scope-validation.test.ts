import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineAuthorityResultPrototype } from '../scripts/research/main-authority-result-prototype.ts';
import { createRemoteRoom, joinRemoteRoom } from '../src/remote-room.ts';
const scope = { authorityId: 'main-F1', roomId: 'F1-room', matchEpoch: 'match-1' };
const action = { kind: 'hero' as const, hero: 'hunter' as const };
function initial() { return joinRemoteRoom(createRemoteRoom(scope.roomId, 'host', 'test', 100,
  { heroesEnabled: true, mutationsEnabled: false }), 'guest', 'test', 100).room; }
function malformed() {
  const cases: Array<{ label: string; value: any }> = [];
  for (const field of ['authorityId', 'roomId', 'matchEpoch']) {
    const missing: any = { ...scope }; delete missing[field]; cases.push({label:field+' omitted',value:missing});
    for (const value of [undefined, null, '', ' ', 0, false]) cases.push({label:field+' '+String(value),value:{...scope,[field]:value}});
    cases.push({label:field+' inherited', value:Object.assign(Object.create({[field]:scope[field as keyof typeof scope]}),missing)});
    cases.push({label:field+' accessor',value:Object.defineProperty({...missing},field,{enumerable:true,get(){throw Error('must not evaluate');}})});
  }
  cases.push(...[null,undefined,[],42].map(value=>({label:'non-object '+String(value),value})));
  cases.push({label:'extra key',value:{...scope,ignored:'not part of scope'}});
  return cases;
}
test('F1 missing authority/match plus malformed required fields are rejected before room mutation',()=>{
  const room=initial(),before=structuredClone(room);
  for(const c of malformed()) assert.throws(()=>new OfflineAuthorityResultPrototype({scope:c.value,room}), {message:'Exact jieqi scope required'}, c.label);
  assert.deepEqual(room,before);
});
test('F1 query validates scope without accessing getters or advancing authority/RNG/projection',()=>{
  let draws=0,projections=0;
  const p=new OfflineAuthorityResultPrototype({scope,room:initial(),randomInt:()=>{draws++;return 0;},projectionForTest:()=>{projections++;}});
  p.handle({actor:'host',transportId:'first',action},100);
  const before=p.inspectForResearch(),counts=[draws,projections];
  for(const c of malformed())assert.deepEqual(p.query('host',{scope:c.value,transportId:'first',action}),{query:'invalid'},c.label);
  for(const q of [null,undefined,{},Object.defineProperty({},'scope',{get(){throw Error('must not evaluate');}})])
    assert.deepEqual(p.query('host',q as any),{query:'invalid'});
  assert.deepEqual(p.query('host',{scope:{...scope,matchEpoch:'other'},transportId:'first',action}),{query:'valid',outcome:'unknown'});
  assert.deepEqual(p.query('host',{scope:{...scope},transportId:'first',action}),{query:'valid',outcome:'accepted'});
  assert.deepEqual(p.query('outsider',{scope,transportId:'first',action}),{query:'invalid'});
  assert.deepEqual(p.inspectForResearch(),before);assert.deepEqual([draws,projections],counts);
});
test('complete own-data scope, including null prototype, keeps legitimate acceptance',()=>{
  for(const s of [{...scope},Object.assign(Object.create(null),scope)]){
    const p=new OfflineAuthorityResultPrototype({scope:s,room:initial()});
    p.handle({actor:'host',transportId:'first',action},100);
    assert.deepEqual(p.query('host',{scope:{...scope},transportId:'first',action}),{query:'valid',outcome:'accepted'});
  }
});
