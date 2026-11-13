import assert from 'node:assert/strict';
import test from 'node:test';
import { BluetoothHostRoom, BLUETOOTH_HOST_PLAYER as H, BLUETOOTH_GUEST_PLAYER as G } from '../src/bluetooth-host-room.ts';
import { canonicalJson, HostResultLedger, type HostResultScope } from '../src/host-result-ledger.ts';
import { RuleError } from '../src/errors.ts';
const scope: HostResultScope = {authorityId:'adapter-authority', roomId:'adapter-room', matchEpoch:'match-1'};
const hero = () => ({kind:'hero' as const,hero:'hunter' as const});
const resign = () => ({kind:'resign' as const,actionId:'resign-action',expectedRevision:0});
const accepted = {query:'valid',outcome:'accepted'};
const unknown = {query:'valid',outcome:'unknown'};
function fixture(options: {heroes?:boolean; tracking?:boolean; maxRecords?:number; maxBindingBytes?:number; random?: (n:number)=>number} = {}) {
  let time=100, clockCalls=0, rngCalls=0;
  const room=new BluetoothHostRoom({roomId:scope.roomId,admissionSecret:'local-fixture',mode:{heroesEnabled:options.heroes??true,mutationsEnabled:false},
    resultTracking:options.tracking===false?undefined:{...scope,maxRecords:options.maxRecords,maxBindingBytes:options.maxBindingBytes},
    now:()=>{clockCalls++;return time;},randomInt:n=>{rngCalls++;return options.random?.(n)??0;}});
  return {room,setTime:(n:number)=>{time=n;},counts:()=>({clockCalls,rngCalls}),
    query:(id:string,action:unknown,actor=H,s:unknown=scope)=>room.queryResult(actor,{scope:s,transportId:id,action}),
    inspect:()=>structuredClone((room as any).room),
    start:()=>{room.handle(H,{kind:'rps',choice:'rock',round:1});room.handle(G,{kind:'rps',choice:'scissors',round:1});}};
}

test('ADAPTER-01 default disabled legacy dispatch remains available, no tracking implicit',()=>{
  const f=fixture({tracking:false}); assert.equal(f.room.resultScope(),undefined);
  assert.throws(()=>f.room.handleTracked(H,'a',hero()),/disabled/);
  f.room.handle(H,hero()); assert.deepEqual(f.query('a',hero()),unknown);
});
test('ADAPTER-02 actual host hero commits one source-bound result before phase transition',()=>{
  const f=fixture();f.room.handleTracked(H,'host-first',hero());f.room.handleTracked(G,'guest-first',{kind:'hero',hero:'shuffler'});
  assert.equal(f.inspect().phase,'rps');assert.deepEqual(f.query('host-first',hero()),accepted);
  assert.deepEqual(f.query('guest-first',{kind:'hero',hero:'shuffler'},G),accepted);
  assert.deepEqual(f.query('never-recorded',hero()),unknown);
});
test('ADAPTER-03 later refusal is separate from original hero acceptance',()=>{
  const f=fixture();f.room.handleTracked(H,'first',hero());
  assert.throws(()=>f.room.handleTracked(H,'later',{kind:'hero',hero:'shuffler'}),{code:'HERO_ALREADY_LOCKED'});
  assert.deepEqual(f.query('first',hero()),accepted);
  assert.deepEqual(f.query('later',{kind:'hero',hero:'shuffler'}),{query:'valid',outcome:'rejected',ruleCode:'HERO_ALREADY_LOCKED'});
});
test('ADAPTER-04 query neither calls clock/RNG/views nor returns private input or board',()=>{
  const f=fixture();f.room.handleTracked(H,'first',hero());const before=f.inspect(),counts=f.counts();
  (f.room as any).projectViews=()=>{throw Error('query must not project');};f.setTime(999999999);
  for(let i=0;i<3;i++)assert.deepEqual(f.query('first',hero()),accepted);
  assert.deepEqual(f.counts(),counts);assert.deepEqual(f.inspect(),before);assert.deepEqual(Object.keys(f.query('first',hero())).sort(),['outcome','query']);
});
test('ADAPTER-05 pre-dispatch hero expiry advances real authority but rejects the late command',()=>{
  const f=fixture();f.setTime(f.inspect().features.heroSelection.deadlineAt);
  assert.throws(()=>f.room.handleTracked(H,'late',{kind:'hero',hero:'shuffler'}),{code:'INVALID_PHASE'});
  assert.notEqual(f.inspect().phase,'hero_selection');
  assert.deepEqual(f.query('late',{kind:'hero',hero:'shuffler'}),{query:'valid',outcome:'rejected',ruleCode:'INVALID_PHASE'});
});
test('ADAPTER-06 natural RPS/resign/finished records acceptance and preserves later refusal distinction',()=>{
  const f=fixture({heroes:false});f.start();f.room.handleTracked(H,'first',resign());
  assert.equal(f.inspect().phase,'finished');assert.equal(f.inspect().game.state.reason,'resign');
  assert.throws(()=>f.room.handleTracked(H,'later',resign()),{code:'INVALID_PHASE'});
  assert.deepEqual(f.query('first',resign()),accepted);
  assert.deepEqual(f.query('later',resign()),{query:'valid',outcome:'rejected',ruleCode:'INVALID_PHASE'});
});
test('ADAPTER-07 explicit postcommit projection fault cannot change accepted into rejected',()=>{
  const f=fixture({heroes:false});f.start();(f.room as any).projectViews=()=>{throw Error('injected output fault');};
  assert.throws(()=>f.room.handleTracked(H,'first',resign()),/injected output/);
  assert.equal(f.inspect().phase,'finished');assert.deepEqual(f.query('first',resign()),accepted);
});
test('ADAPTER-08 explicit clock RNG failure before dispatch produces no command result',()=>{
  const f=fixture({random:()=>{throw Error('injected RNG fault');}});const before=f.inspect();f.setTime(before.features.heroSelection.deadlineAt);
  assert.throws(()=>f.room.handleTracked(H,'first',hero()),/injected RNG/);
  assert.deepEqual(f.inspect(),before);assert.deepEqual(f.query('first',hero()),unknown);
});
test('ADAPTER-09 unreviewed dispatch exception stays unknown with unchanged command authority',()=>{
  const f=fixture(),before=f.inspect();(f.room as any).dispatch=()=>{throw new RuleError('UNREVIEWED_RULE','injected');};
  assert.throws(()=>f.room.handleTracked(H,'first',hero()),{code:'UNREVIEWED_RULE'});
  assert.deepEqual(f.inspect(),before);assert.deepEqual(f.query('first',hero()),unknown);
});
test('ADAPTER-10 stale resign preserves actual refusal without accepting the command',()=>{
  const f=fixture({heroes:false});f.start();const action={...resign(),expectedRevision:999};
  assert.throws(()=>f.room.handleTracked(H,'stale',action),{code:'STALE_REVISION'});
  assert.equal(f.inspect().phase,'playing');assert.deepEqual(f.query('stale',action),{query:'valid',outcome:'rejected',ruleCode:'STALE_REVISION'});
});
test('ADAPTER-11 ID-only duplicate from earlier move does not prove a resign attempt',()=>{
  const f=fixture({heroes:false});f.start();
  f.room.handle(H,{kind:'move',command:{from:{x:0,y:9},to:{x:0,y:8},expectedRevision:0,actionId:'old-move'}});
  const action={kind:'resign' as const,expectedRevision:f.inspect().game.state.revision,actionId:'old-move'};
  f.room.handleTracked(H,'new-attempt',action);assert.equal(f.inspect().phase,'playing');assert.deepEqual(f.query('new-attempt',action),unknown);
});
test('ADAPTER-12 retained attempt ID reuse and unsupported actions reject before clock or mutation',()=>{
  const f=fixture();f.room.handleTracked(H,'first',hero());const before=f.inspect(),counts=f.counts();
  assert.throws(()=>f.room.handleTracked(H,'first',hero()),/Fresh internal/);
  assert.throws(()=>f.room.handleTracked(H,'other',{kind:'rps',choice:'rock',round:1} as any),/not covered/);
  assert.deepEqual(f.inspect(),before);assert.deepEqual(f.counts(),counts);assert.deepEqual(f.query('first',hero()),accepted);
});
test('ADAPTER-13 actor, content, authority and match are independently bound',()=>{
  const f=fixture();f.room.handleTracked(H,'first',hero());
  assert.deepEqual(f.query('first',hero(),G),unknown);
  assert.deepEqual(f.room.queryResult('outsider',{scope,transportId:'first',action:hero()}),{query:'invalid'});
  assert.deepEqual(f.query('first',{...hero(),extra:true}),{query:'invalid'});
  assert.deepEqual(f.query('first',hero(),H,{...scope,authorityId:'other'}),unknown);
  assert.deepEqual(f.query('first',hero(),H,{...scope,matchEpoch:'next'}),unknown);
  assert.deepEqual(f.query('first',hero(),H,{...scope,roomId:'other-room'}),unknown);
});
test('ADAPTER-14 mandatory scope own data fields reject F1 missing/undefined/empty/wrong type/accessors/inheritance',()=>{
  let accessorCalls=0;
  const malformed:any[]=[{}, {roomId:scope.roomId}, {...scope,authorityId:undefined}, {...scope,matchEpoch:''}, {...scope,matchEpoch:7},
    Object.create(scope), {...scope,get authorityId(){accessorCalls++;return scope.authorityId;}}, null];
  for(const invalid of malformed)assert.throws(()=>new HostResultLedger(invalid,[H,G],scope),TypeError);
  for(const invalid of [{}, {authorityId:undefined,matchEpoch:'m'}, Object.create({authorityId:'a',matchEpoch:'m'}),
    {get authorityId(){accessorCalls++;return 'a';},matchEpoch:'m'}])assert.throws(()=>new BluetoothHostRoom({roomId:scope.roomId,admissionSecret:'fixture',resultTracking:invalid as any}),TypeError);
  assert.equal(accessorCalls,0);
});
test('ADAPTER-15 malformed query never equates absent scope fields and never invokes getters',()=>{
  const f=fixture();f.room.handleTracked(H,'first',hero());let calls=0;
  const scopes:any[]=[null,{}, {roomId:scope.roomId}, {...scope,authorityId:undefined}, {...scope,matchEpoch:''}, {...scope,matchEpoch:7},
    Object.create(scope), {...scope,get authorityId(){calls++;return scope.authorityId;}}];
  for(const invalid of scopes)assert.deepEqual(f.query('first',hero(),H,invalid),{query:'invalid'});
  for(const invalid of [null,undefined,{}, {get scope(){calls++;return scope;}}])assert.deepEqual(f.room.queryResult(H,invalid),{query:'invalid'});
  assert.equal(calls,0);assert.deepEqual(f.query('first',hero()),accepted);
});
test('ADAPTER-16 caller and returned objects cannot rewrite scope or results',()=>{
  const f=fixture(),action:any=hero();f.room.handleTracked(H,'first',action);action.hero='shuffler';
  const result:any=f.query('first',hero());result.outcome='rejected';const copy=f.room.resultScope()!;copy.authorityId='other';
  assert.deepEqual(f.query('first',hero()),accepted);assert.deepEqual(f.room.resultScope(),scope);
});
test('ADAPTER-17 FIFO eviction and byte overflow retain unknown without undoing actual commitment',()=>{
  const f=fixture({maxRecords:1});f.room.handleTracked(H,'first',hero());f.query('first',hero());f.room.handleTracked(G,'second',hero());
  assert.deepEqual(f.query('first',hero()),unknown);assert.deepEqual(f.query('second',hero(),G),accepted);
  const b=fixture({maxBindingBytes:1});b.room.handleTracked(H,'first',hero());assert.equal(b.inspect().featureSecret.heroSelection.choices[H],'hunter');assert.deepEqual(b.query('first',hero()),unknown);
});
test('ADAPTER-18 disconnect/reconnect retires tracking; old scope query is local history only',()=>{
  const f=fixture();f.room.handleTracked(H,'first',hero());f.room.disconnect(G);f.room.reconnect(G);
  const before=f.inspect();assert.throws(()=>f.room.handleTracked(G,'new',hero()),/lifecycle closed/);assert.deepEqual(f.inspect(),before);
  assert.deepEqual(f.query('first',hero()),accepted);assert.deepEqual(f.query('new',hero(),G),unknown);
  f.room.handle(G,hero());assert.equal(f.inspect().phase,'rps','legacy play remains usable');
});
test('ADAPTER-19 actual same-room rematch retires tracking and never reuses original match authority',()=>{
  const f=fixture({heroes:false});f.start();f.room.handleTracked(H,'first',resign());
  f.room.handle(H,{kind:'rematch_request',actionId:'rematch'});f.room.handle(G,{kind:'rematch_response',accept:true});
  assert.equal(f.inspect().roomId,scope.roomId);assert.equal(f.inspect().phase,'rps');
  assert.throws(()=>f.room.handleTracked(H,'new',resign()),/lifecycle closed/);assert.deepEqual(f.query('first',resign()),accepted);
  assert.deepEqual(f.query('first',resign(),H,{...scope,matchEpoch:'new-match'}),unknown);
});
test('ADAPTER-20 new owner cannot reconstruct old receipts from same caller labels',()=>{
  const a=fixture();a.room.handleTracked(H,'first',hero());const b=fixture();assert.deepEqual(b.query('first',hero()),unknown);
});
test('ADAPTER-21 tracked hero and resign output equal legacy actual host for identical natural setup',()=>{
  for(const heroes of [true,false]){const tracked=fixture({heroes}),legacy=fixture({heroes,tracking:false});if(!heroes){tracked.start();legacy.start();}
    const action=heroes?hero():resign();assert.deepEqual(tracked.room.handleTracked(H,'first',action),legacy.room.handle(H,action));assert.deepEqual(tracked.inspect(),legacy.inspect());}
});
test('ADAPTER-22 legacy and tracked paths both read a later second clock for output',()=>{
  function build(tracking:boolean){let calls=0;const r=new BluetoothHostRoom({roomId:scope.roomId,admissionSecret:'fixture',mode:{heroesEnabled:true},randomInt:()=>0,
    resultTracking:tracking?scope:undefined,now:()=>++calls<=3?100:60100});return{r,count:()=>calls};}
  const a=build(true),b=build(false);const av=a.r.handleTracked(H,'first',hero()),bv=b.r.handle(H,hero());
  assert.equal(a.count(),4);assert.equal(b.count(),4);assert.deepEqual(av,bv);assert.notEqual(av.publicRoom.phase,'hero_selection');
  assert.deepEqual(a.r.queryResult(H,{scope,transportId:'first',action:hero()}),accepted);
});
test('ADAPTER-23 reentrant mutating host calls are refused, read-only query remains safe',()=>{
  const f=fixture();const original=(f.room as any).dispatch.bind(f.room);let entered=false;
  (f.room as any).dispatch=(...args:any[])=>{if(!entered){entered=true;assert.throws(()=>f.room.handle(G,hero()),/reentrant/);assert.deepEqual(f.query('first',hero()),unknown);}return original(...args);};
  f.room.handleTracked(H,'first',hero());assert.deepEqual(f.query('first',hero()),accepted);
});
test('ADAPTER-24 canonical body binding rejects lossy/accessor inputs before clock',()=>{
  const f=fixture(),counts=f.counts();let getters=0;const action={kind:'hero',get hero(){getters++;return 'hunter';}};
  assert.throws(()=>f.room.handleTracked(H,'first',action as any),/accessor/);
  for(const value of [{x:undefined},{x:NaN},[ ,1],new Date()])assert.throws(()=>canonicalJson(value));
  assert.equal(getters,0);assert.deepEqual(f.counts(),counts);
});
test('ADAPTER-25 advance preserves baseline two clock reads in both legacy and tracked configurations',()=>{
  for(const tracking of [false,true]) {
    const f=fixture({tracking}), control=fixture({tracking});
    const deadline=f.inspect().features.heroSelection.deadlineAt;
    f.setTime(deadline);control.setTime(deadline);
    const before=f.counts(),actual=f.room.advance();
    control.room.views();const expected=control.room.views();
    assert.equal(f.counts().clockCalls-before.clockCalls,2);
    assert.deepEqual(actual,expected);assert.deepEqual(f.inspect(),control.inspect());
    assert.equal(f.inspect().phase,'rps','same automatic hero expiry as the original advance plus views');
  }
});
test('ADAPTER-26 reentrant advance is rejected before another clock read or authority mutation',()=>{
  const f=fixture(),original=(f.room as any).dispatch.bind(f.room);let attempted=false;
  (f.room as any).dispatch=(...args:any[])=>{
    attempted=true;
    const before=f.inspect(),counts=f.counts();
    f.setTime(before.features.heroSelection.deadlineAt);
    assert.throws(()=>f.room.advance(),/reentrant/);
    assert.deepEqual(f.inspect(),before);assert.deepEqual(f.counts(),counts);
    f.setTime(100);
    return original(...args);
  };
  f.room.handleTracked(H,'first',hero());
  assert.equal(attempted,true);assert.deepEqual(f.query('first',hero()),accepted);
});
