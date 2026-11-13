import assert from 'node:assert/strict';
import test from 'node:test';
import { BluetoothHostRoom, BLUETOOTH_HOST_PLAYER as H, BLUETOOTH_GUEST_PLAYER as G } from '../src/bluetooth-host-room.ts';
import { LocalPendingActions, LocalHostResults, type LocalResultContext } from '../src/bluetooth-local-results.ts';
import { encodeBluetoothEnvelope } from '../src/bluetooth-protocol.ts';
import { createReceiptChannel, currentWeb } from '../scripts/research/ch-generation-channel.ts';

const ctx = (role: 'HOST' | 'GUEST' = 'HOST', sequence = '0'): LocalResultContext => ({instance:'native-instance',generation:'1',sequence,role});
const hero = {kind:'hero',hero:'hunter'};
const raw = (action: unknown = hero, id = 'original') => encodeBluetoothEnvelope({v:2,type:'action',id,payload:action});
const accepted = {query:'valid',outcome:'accepted'};
const unknown = {query:'valid',outcome:'unknown'};
function fixture(options: {heroes?:boolean; maxRecords?:number; maxBytes?:number; ledgerRecords?:number; ledgerBytes?:number} = {}) {
  let time=100, clocks=0, randoms=0, current: unknown=ctx();
  const room = new BluetoothHostRoom({roomId:'local-room',admissionSecret:'fixture-only',
    mode:{heroesEnabled:options.heroes??true,mutationsEnabled:false},now:()=>{clocks++;return time;},randomInt:()=>{randoms++;return 0;},
    resultTracking:{authorityId:'original-owner',matchEpoch:'first-match',maxRecords:options.ledgerRecords,maxBindingBytes:options.ledgerBytes}});
  const session = new LocalHostResults(room,()=>current,options);
  return {room,session,counts:()=>({clocks,randoms}),inspect:()=>structuredClone((room as any).room),
    setTime:(v:number)=>{time=v;},setContext:(v:unknown)=>{current=v;},
    send:(body=raw())=>{const c=current as LocalResultContext;current={...c,sequence:String(BigInt(c.sequence)+1n)};return session.consume(body,current);},
    start:()=>{room.handle(H,{kind:'rps',choice:'rock',round:1});room.handle(G,{kind:'rps',choice:'scissors',round:1});}};
}
function token(result: ReturnType<LocalHostResults['consume']>) { assert.equal(result.handled,true); if(!result.handled)throw Error('unhandled');return result.token; }

test('LOCAL-01 pending captures exact pre-send raw and never takes native written as game acceptance',()=>{
  const p=new LocalPendingActions(),c=ctx('GUEST'),body=raw(),t=p.remember(body,c);
  c.instance='mutated';p.noteScopedWrite(t,{status:'written',attemptedContext:ctx('GUEST')},ctx('GUEST'));
  assert.equal(p.original(t),body);assert.equal(p.inspect(t).local,'written');assert.equal(p.inspect(t).outcome,'unknown');
});
test('LOCAL-02 explicit null proves not_sent; Android omitted key and mismatched contexts remain unknown',()=>{
  for(const [value,expected] of [
    [{status:'not_sent',attemptedContext:null},'not_sent'],[{status:'not_sent'},'unknown'],
    [{status:'written',attemptedContext:{...ctx('GUEST'),generation:'2'}},'unknown'],
    [{status:'unknown',attemptedContext:ctx('GUEST')},'unknown'],[null,'unknown']] as const){
    const p=new LocalPendingActions(),t=p.remember(raw(),ctx('GUEST'));p.noteScopedWrite(t,value,ctx('GUEST'));
    assert.equal(p.inspect(t).local,expected);assert.equal(p.inspect(t).outcome,'unknown');
  }
});
test('LOCAL-03 old response and lifecycle cannot restore applicability or resolve game outcome',()=>{
  const p=new LocalPendingActions(),t=p.remember(raw(),ctx('GUEST'));
  p.noteScopedWrite(t,{status:'written',attemptedContext:ctx('GUEST')},{...ctx('GUEST'),generation:'2'});
  p.noteScopedWrite(t,{status:'not_sent',attemptedContext:null},ctx('GUEST'));
  assert.equal(p.inspect(t).local,'unknown');assert.equal(p.inspect(t).historical,true);
  p.retire();assert.throws(()=>p.remember(raw(),ctx('GUEST')),/retired/);assert.equal(p.original(t),raw());
});
test('LOCAL-04 duplicate wire IDs retain separate opaque attempts, forged token and eviction stay unknown',()=>{
  const p=new LocalPendingActions({maxRecords:1}),a=p.remember(raw(),ctx('GUEST')),b=p.remember(raw(),ctx('GUEST'));
  assert.notEqual(a,b);assert.equal(p.original(a),undefined);assert.equal(p.original(b),raw());
  p.noteScopedWrite(a,{status:'written',attemptedContext:ctx('GUEST')},ctx('GUEST'));
  assert.equal(p.inspect(a).retained,false);assert.equal(p.inspect({}).retained,false);
  const tiny=new LocalPendingActions({maxBytes:1});assert.equal(tiny.inspect(tiny.remember(raw(),ctx('GUEST'))).retained,false);
});
test('LOCAL-05 contradictory local callbacks fail to unknown permanently',()=>{
  const p=new LocalPendingActions(),t=p.remember(raw(),ctx('GUEST'));
  p.noteScopedWrite(t,{status:'not_sent',attemptedContext:null},ctx('GUEST'));
  p.noteScopedWrite(t,{status:'written',attemptedContext:ctx('GUEST')},ctx('GUEST'));
  p.noteScopedWrite(t,{status:'not_sent',attemptedContext:null},ctx('GUEST'));
  assert.equal(p.inspect(t).local,'unknown');assert.equal(p.inspect(t).conflict,true);
});
test('LOCAL-06 malformed request and legacy or bad native capability never acquire trusted scope',()=>{
  const p=new LocalPendingActions();
  for(const body of ['bad',JSON.stringify({v:2,type:'action',payload:hero}),JSON.stringify({v:2,type:'pong',id:'original'})])assert.throws(()=>p.remember(body,ctx('GUEST')));
  for(const c of [undefined,{},ctx('HOST')]){const t=p.remember(raw(),c);p.noteScopedWrite(t,{status:'written',attemptedContext:ctx('GUEST')},ctx('GUEST'));assert.equal(p.inspect(t).local,'unknown');}
});
test('LOCAL-07 real guest hero result binds original room, raw and local event, not peer actor labels',()=>{
  const f=fixture(),body=raw({...hero,actor:H}),r=f.send(body),t=token(r);
  assert.equal(f.session.original(t),body);assert.deepEqual(f.session.inspect(t).answer,accepted);
  assert.equal(f.inspect().featureSecret.heroSelection.choices[G],'hunter');assert.equal(f.inspect().featureSecret.heroSelection.choices[H],undefined);
});
test('LOCAL-08 later same wire ID is a new native arrival, original acceptance survives its rule rejection',()=>{
  const f=fixture(),a=token(f.send()),r=f.send(raw({kind:'hero',hero:'shuffler'})),b=token(r);
  assert.equal(r.handled&&r.failed,true);assert.deepEqual(f.session.inspect(a).answer,accepted);
  assert.deepEqual(f.session.inspect(b).answer,{query:'valid',outcome:'rejected',ruleCode:'HERO_ALREADY_LOCKED'});
});
test('LOCAL-09 same event is not dispatched twice after raw cache eviction',()=>{
  const f=fixture({maxRecords:1}),a=token(f.send()),b=token(f.send(raw({kind:'hero',hero:'shuffler'},'second'))),before=f.inspect(),counts=f.counts();
  assert.equal(f.session.inspect(a).retained,false);assert.equal(f.session.inspect(b).retained,true);
  assert.deepEqual(f.session.consume(raw(),ctx('HOST','1')),{handled:false,reason:'stale'});
  assert.deepEqual(f.inspect(),before);assert.deepEqual(f.counts(),counts);
});
test('LOCAL-10 query uses no game clock/RNG/views and exposes no private raw or board',()=>{
  const f=fixture(),t=token(f.send()),before=f.inspect(),counts=f.counts();f.setTime(99999999);
  (f.room as any).projectViews=()=>{throw Error('forbidden projection');};
  for(let i=0;i<3;i++)assert.deepEqual(f.session.inspect(t),{retained:true,historical:false,answer:accepted});
  assert.deepEqual(f.inspect(),before);assert.deepEqual(f.counts(),counts);
  assert.deepEqual(Object.keys(f.session.inspect(t)).sort(),['answer','historical','retained']);
});
test('LOCAL-11 native generation/instance/role change, rollback or capability loss retires original owner',()=>{
  for(const change of [{...ctx('HOST','2'),generation:'2'},{...ctx('HOST','2'),instance:'new'},ctx('GUEST','2'),ctx(),{},undefined]){
    const f=fixture(),t=token(f.send()),before=f.inspect(),counts=f.counts();f.setContext(change);
    assert.equal(f.session.inspect(t).historical,true);assert.deepEqual(f.session.inspect(t).answer,accepted);
    f.setContext(ctx('HOST','2'));assert.deepEqual(f.session.consume(raw(),ctx('HOST','2')),{handled:false,reason:'stale'});
    assert.deepEqual(f.inspect(),before);assert.deepEqual(f.counts(),counts);
  }
});
test('LOCAL-12 actual host disconnect/reconnect closes new delivery; original result remains local history',()=>{
  const f=fixture(),t=token(f.send());f.room.disconnect(G);f.room.reconnect(G);const before=f.inspect(),counts=f.counts();
  assert.equal(f.room.resultTrackingActive(),false);assert.deepEqual(f.send(),{handled:false,reason:'stale'});
  assert.deepEqual(f.session.inspect(t),{retained:true,historical:true,answer:accepted});assert.deepEqual(f.inspect(),before);assert.deepEqual(f.counts(),counts);
});
test('LOCAL-13 natural resign and rematch retire same-room authority without restoring tracking',()=>{
  const f=fixture({heroes:false});f.start();const t=token(f.send(raw({kind:'resign',expectedRevision:0,actionId:'resign'})));
  assert.equal(f.inspect().phase,'finished');assert.deepEqual(f.session.inspect(t).answer,accepted);
  f.room.handle(H,{kind:'rematch_request',actionId:'again'});f.room.handle(G,{kind:'rematch_response',accept:true});
  assert.equal(f.inspect().phase,'rps');assert.deepEqual(f.send(),{handled:false,reason:'stale'});assert.equal(f.session.inspect(t).historical,true);
});
test('LOCAL-14 local owner cannot be reconstructed on the same room; new room has no old token history',()=>{
  const a=fixture(),t=token(a.send());assert.throws(()=>new LocalHostResults(a.room,()=>ctx()),/already/);
  const b=fixture();assert.equal(b.session.inspect(t).retained,false);assert.deepEqual(b.session.inspect(t).answer,unknown);
});
test('LOCAL-15 startup watermark, queued FIFO and sequences above 2^53 retain exact ordering',()=>{
  const f=fixture();f.setContext(ctx('HOST','9007199254740994'));
  const t=token(f.session.consume(raw(),ctx('HOST','9007199254740993')));assert.deepEqual(f.session.inspect(t).answer,accepted);
  assert.deepEqual(f.session.consume(raw(),ctx('HOST','9007199254740993')),{handled:false,reason:'stale'});
  assert.deepEqual(f.session.consume(raw(),ctx('HOST','9007199254740995')),{handled:false,reason:'stale'});
  const g=fixture(),c=ctx('HOST','100');g.session.retire();
  const room=new BluetoothHostRoom({roomId:'new',admissionSecret:'fixture',now:()=>100,resultTracking:{authorityId:'new',matchEpoch:'new'}});
  const s=new LocalHostResults(room,()=>c);assert.deepEqual(s.consume(raw(),c),{handled:false,reason:'stale'});
});
test('LOCAL-16 uncovered and malformed envelopes have no host mutation and consume only their event',()=>{
  const f=fixture(),before=f.inspect(),counts=f.counts();
  assert.deepEqual(f.send(raw({kind:'rps',choice:'rock',round:1})),{handled:false,reason:'uncovered'});
  assert.deepEqual(f.send('bad'),{handled:false,reason:'invalid'});
  assert.deepEqual(f.inspect(),before);assert.deepEqual(f.counts(),counts);
  assert.deepEqual(f.session.consume(raw(),ctx('HOST','2')),{handled:false,reason:'stale'});
});
test('LOCAL-17 late invalid-phase rejection and unknown clock/RNG fault are not successful outcomes',()=>{
  const f=fixture();f.setTime(f.inspect().features.heroSelection.deadlineAt);const t=token(f.send());
  assert.deepEqual(f.session.inspect(t).answer,{query:'valid',outcome:'rejected',ruleCode:'INVALID_PHASE'});
  const g=fixture();(g.room as any).now=()=>{throw Error('clock fault');};const r=g.send(),u=token(r);
  assert.equal(r.handled&&r.failed,true);assert.deepEqual(g.session.inspect(u).answer,unknown);
});
test('LOCAL-18 postcommit projection error retains acceptance without re-executing request',()=>{
  const f=fixture();(f.room as any).projectViews=()=>{throw Error('projection fault');};const r=f.send(),t=token(r);
  assert.equal(r.handled&&r.failed,true);assert.deepEqual(f.session.inspect(t).answer,accepted);
  assert.equal(f.inspect().featureSecret.heroSelection.choices[G],'hunter');
});
test('LOCAL-19 host ledger eviction and byte overflow never reconstruct proof from board state',()=>{
  for(const options of [{ledgerRecords:1},{ledgerBytes:1}]){
    const f=fixture(options),t=token(f.send());f.send(raw({kind:'hero',hero:'shuffler'},'second'));
    assert.deepEqual(f.session.inspect(t).answer,unknown);assert.equal(f.inspect().featureSecret.heroSelection.choices[G],'hunter');
  }
  const tiny=fixture({maxBytes:1}),t=token(tiny.send());assert.equal(tiny.session.inspect(t).retained,false);
});
test('LOCAL-20 no implicit activation, invalid limits and malformed native context fail construction',()=>{
  const room=new BluetoothHostRoom({roomId:'disabled',admissionSecret:'fixture'});
  assert.throws(()=>new LocalHostResults(room,()=>ctx()),/Active/);
  for(const n of [0,-1,Infinity,1.5])assert.throws(()=>new LocalPendingActions({maxRecords:n}),/Positive/);
  let getters=0;const f=fixture();f.setContext({get instance(){getters++;return 'native';}});
  assert.deepEqual(f.session.consume('bad',ctx('HOST','1')),{handled:false,reason:'stale'});assert.equal(getters,0);
});
test('LOCAL-21 reentrant delivery is refused and a native change during dispatch marks historical only',()=>{
  const f=fixture(),dispatch=(f.room as any).dispatch.bind(f.room);let nested:unknown;
  (f.room as any).dispatch=(...args:any[])=>{nested=f.session.consume(raw(),ctx('HOST','2'));f.setContext({...ctx('HOST','2'),generation:'2'});return dispatch(...args);};
  const t=token(f.send());assert.deepEqual(nested,{handled:false,reason:'stale'});
  assert.deepEqual(f.session.inspect(t),{retained:true,historical:true,answer:accepted});
});
test('LOCAL-22 actual Web scoped sender feeds retained raw and real host result while guest unknown stays unknown',()=>{
  const f=fixture(),pending=new LocalPendingActions(),gc=ctx('GUEST');let p:object|undefined,h:object|undefined,calls=0;
  const guest=createReceiptChannel(f.room,'guest',currentWeb(),undefined,{
    localTransportContext:()=>JSON.stringify({v:1,scopedSend:true,context:gc}),
    sendCheckedScoped:(body:string,instance:string,generation:string)=>{
      calls++;assert.equal(instance,gc.instance);assert.equal(generation,gc.generation);
      p=pending.remember(body,gc);h=token(f.send(body));
      const result={status:'unknown',attemptedContext:gc};pending.noteScopedWrite(p,result,gc);return JSON.stringify(result);
    }});
  guest.action(hero as any);assert.equal(calls,1);assert.equal(guest.bluetooth.pendingActionWriteUnknown,true);
  assert.equal(pending.original(p!),f.session.original(h!));assert.deepEqual(f.session.inspect(h!).answer,accepted);
  assert.equal(pending.inspect(p!).outcome,'unknown');
  guest.receive(JSON.stringify({v:2,type:'pong',id:'recorded:1'}));
  guest.receive(JSON.stringify({v:2,type:'error',id:'recorded:1',payload:{outcome:'accepted'}}));
  assert.equal(guest.bluetooth.pendingActionWriteUnknown,true);assert.equal(pending.inspect(p!).outcome,'unknown');assert.equal(calls,1);
});
test('LOCAL-23 actual Web not_sent clears waiting but cannot create a host result',()=>{
  const f=fixture(),pending=new LocalPendingActions(),gc=ctx('GUEST');let p:object|undefined,calls=0;
  const guest=createReceiptChannel(f.room,'guest',currentWeb(),undefined,{
    localTransportContext:()=>JSON.stringify({v:1,scopedSend:true,context:gc}),
    sendCheckedScoped:(body:string)=>{calls++;p=pending.remember(body,gc);const r={status:'not_sent',attemptedContext:null};pending.noteScopedWrite(p,r,gc);return JSON.stringify(r);}});
  const before=f.inspect();guest.action(hero as any);assert.equal(calls,1);assert.equal(guest.bluetooth.pendingAction,false);
  assert.equal(pending.inspect(p!).local,'not_sent');assert.equal(pending.inspect(p!).outcome,'unknown');assert.deepEqual(f.inspect(),before);
});

test('LOCAL-24 actual Web sender retains its own pre-send request; written and pong never settle it',()=>{
  const f=fixture(),gc=ctx('GUEST');let sends=0;
  const guest=createReceiptChannel(f.room,'guest',currentWeb(),undefined,{
    localTransportContext:()=>JSON.stringify({v:1,scopedSend:true,context:gc}),
    sendCheckedScoped:()=>{sends++;return JSON.stringify({status:'written',attemptedContext:gc});}});
  guest.action(hero as any);const b=guest.bluetooth as any,p=b.requestHistory,t=b.pendingRequestToken;
  assert.equal(p.original(t),raw(hero,'recorded:1'));assert.equal(p.inspect(t).local,'written');
  guest.receive(JSON.stringify({v:2,type:'pong',id:'recorded:1'}));assert.equal(b.pendingAction,false);
  assert.equal(p.inspect(t).outcome,'unknown');assert.equal(sends,2,'action plus legacy ping, no retry');
});

function webHost(heroes=true) {
  let current=ctx();
  const room=new BluetoothHostRoom({roomId:'web-owner',admissionSecret:'fixture',now:()=>100,randomInt:()=>0,
    mode:{heroesEnabled:heroes,mutationsEnabled:false},resultTracking:{authorityId:'web-owner',matchEpoch:'web-match'}});
  const host=createReceiptChannel(room,'host',currentWeb(),undefined,{
    localTransportContext:()=>JSON.stringify({v:1,scopedSend:true,context:current}),
    sendCheckedScoped:()=>JSON.stringify({status:'written',attemptedContext:current})});
  return {room,host,set:(c:LocalResultContext)=>{current=c;},
    event:(sequence:string,detail:object)=>host.nativeEvent({...detail,localContext:{...current,sequence}})};
}
test('LOCAL-25 actual final Web listener initializes from CONNECTED event and accepts already queued later action',()=>{
  const f=webHost();f.set(ctx('HOST','3'));f.event('1',{type:'transport-state',state:'CONNECTED'});
  f.event('2',{type:'message',message:raw()});const results=(f.host.bluetooth as any).hostResults;
  assert.equal(results.tokens().length,1);assert.deepEqual(results.inspect(results.tokens()[0]).answer,accepted);
  f.event('2',{type:'message',message:raw()});assert.equal(results.tokens().length,1,'C5 final listener drops duplicate');
  assert.equal(f.room.views().guest.ownHeroChoice,'hunter');
});
test('LOCAL-26 actual Web unsupported action still uses legacy dispatcher exactly once',()=>{
  const f=webHost(false);f.set(ctx('HOST','2'));f.event('1',{type:'transport-state',state:'CONNECTED'});
  f.event('2',{type:'message',message:raw({kind:'rps',choice:'rock',round:1})});
  assert.equal(f.room.views().guest.rps?.submitted[G],true);assert.equal((f.host.bluetooth as any).hostResults.tokens().length,0);
});
test('LOCAL-27 actual Web disconnect/reconnect retires tracking while keeping legacy play available',()=>{
  const f=webHost();f.set(ctx('HOST','1'));f.event('1',{type:'transport-state',state:'CONNECTED'});
  f.set(ctx('HOST','2'));f.event('2',{type:'transport-state',state:'DISCONNECTED',adapterEnabled:true});
  const results=(f.host.bluetooth as any).hostResults;assert.equal(results.active(),false);
  f.set({...ctx('HOST','3'),generation:'2'});f.event('1',{type:'transport-state',state:'CONNECTED'});
  f.event('2',{type:'message',message:raw()});assert.equal(f.room.views().guest.ownHeroChoice,'hunter');
  assert.equal(results.tokens().length,0,'no new result proof after lifecycle retirement');
});
test('LOCAL-28 actual guest lifecycle retains historical request and allows a fresh memory entry',()=>{
  const f=fixture();let current=ctx('GUEST');const guest=createReceiptChannel(f.room,'guest',currentWeb(),undefined,{
    localTransportContext:()=>JSON.stringify({v:1,scopedSend:true,context:current}),
    sendCheckedScoped:()=>JSON.stringify({status:'unknown',attemptedContext:current})});
  guest.action(hero as any);const b=guest.bluetooth as any,history=b.requestHistory,first=b.pendingRequestToken;
  current=ctx('GUEST','1');guest.nativeEvent({type:'transport-state',state:'DISCONNECTED',localContext:current});
  assert.equal(history.inspect(first).historical,true);assert.equal(history.original(first),raw(hero,'recorded:1'));
  current={...ctx('GUEST','1'),generation:'2'};guest.nativeEvent({type:'transport-state',state:'CONNECTED',localContext:current});
  guest.action(hero as any);assert.notEqual(b.pendingRequestToken,first);assert.equal(history.tokens().length,2);
  assert.equal(history.inspect(first).outcome,'unknown');assert.equal(history.inspect(b.pendingRequestToken).historical,false);
});
