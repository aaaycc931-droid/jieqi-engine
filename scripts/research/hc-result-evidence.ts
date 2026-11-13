import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { BluetoothHostRoom, BLUETOOTH_HOST_PLAYER as H, BLUETOOTH_GUEST_PLAYER as G } from '../../src/bluetooth-host-room.ts';
import { createRemoteRoom, joinRemoteRoom, submitRemoteHeroSelection, playerRoomView, publicRemoteRoom, forfeitRemoteRoom } from '../../src/remote-room.ts';
import { encodeBluetoothEnvelope, parseBluetoothEnvelope } from '../../src/bluetooth-protocol.ts';
import { createReceiptChannel } from './bluetooth-receipt-channel.ts';

// Only public, synthetic, already-admitted jieqi fixtures. No authority secret
// dumps, no half_chaos admission, no source patching or new result protocol.
const base = '71145df45ad17215a3731e53150b6728e079e375';
const sourcePaths = ['src/bluetooth-host-room.ts','src/remote-room.ts','src/room.ts','src/game.ts','src/heroes.ts','src/bluetooth-protocol.ts','web/app.ts','scripts/research/bluetooth-receipt-channel.ts','tests/bluetooth-host-room.test.ts','tests/remote-room.test.ts','tests/hero-forms.test.ts'];
const sourceHashes = Object.fromEntries(sourcePaths.map(path => {
  const bytes=readFileSync(path), pinned=execFileSync('git',['show',`${base}:${path}`]);
  assert.deepEqual(bytes,pinned,`pinned source ${path}`);
  return [path,createHash('sha256').update(bytes).digest('hex')];
}));
const cases:any[]=[];
const out='review/hc-result-evidence/RESULTS_20261113.json';
function save(){mkdirSync('review/hc-result-evidence',{recursive:true});writeFileSync(out,JSON.stringify({
  schema:'lezi.hc.authority_result_evidence.v1', base, node:process.version,
  command:'node scripts/research/hc-result-evidence.ts',sourceHashes,
  limits:['offline production TypeScript functions','recording DOM/native endpoint from existing receipt channel','explicit test-only projection/serialization injection','not device/JNI/radio/independent QA','not half_chaos 56/64 acceptance'],
  passed:cases.filter(c=>c.status==='PASS').length,failed:cases.filter(c=>c.status==='FAIL').length,cases,
},null,2)+'\n');}
function run(id:string,fn:()=>unknown){try{cases.push({id,status:'PASS',evidence:fn()});}catch(e){cases.push({id,status:'FAIL',error:String(e),stack:(e as Error).stack});process.exitCode=1;}save();}
function errorCode(fn:()=>unknown){try{fn();return null;}catch(e){return (e as any).code??(e as Error).message;}}
function summary(v:any){return {phase:v.phase,revision:v.state?.revision??null,status:v.state?.status??null,reason:v.state?.reason??null,
  winner:v.state?.winner??null,updatedAt:v.updatedAt??null,messageIds:(v.messages??[]).map((x:any)=>x.id),
  automaticEventCount:v.state?(v.state.automaticEvents??[]).length:null,
  landingEventCount:v.state?(v.state.landingEvents??[]).length:null,
  destructionBatchCount:v.state?(v.state.destructionBatches??[]).length:null};}
function fixture(heroes=false){
  let time=100,calls=0; const clockReads:number[]=[];
  const room=new BluetoothHostRoom({roomId:'hc-result-public-fixture',admissionSecret:'offline-only',
    now:()=>{clockReads.push(time);return time;},randomInt:()=>{calls++;return 0;},
    mode:{baseMode:'jieqi',heroesEnabled:heroes,mutationsEnabled:false}});
  return {room,clockReads,time:(t:number)=>{time=t;},rng:()=>calls};
}
function playing(){const f=fixture();f.room.handle(H,{kind:'rps',choice:'rock',round:1});f.room.handle(G,{kind:'rps',choice:'scissors',round:1});assert.equal(f.room.views().publicRoom.phase,'playing');return f;}
const resign={kind:'resign',expectedRevision:0,actionId:'hc-resign-original'} as const;

for(const offset of [-1,0,1])run(`H1-DIRECT-HERO-${offset}`,()=>{
  let rng=0;const random=()=>{rng++;return 2;};
  const before=joinRemoteRoom(createRemoteRoom('hc-direct-hero',H,'offline-only',100,{baseMode:'jieqi',heroesEnabled:true,mutationsEnabled:false}),G,'offline-only',200).room;
  const deadline=before.features!.heroSelection!.deadlineAt;
  const after=submitRemoteHeroSelection(before,G,'hunter',random,deadline+offset);
  const own=playerRoomView(after,G).ownHeroChoice;
  assert.equal(own,offset<0?'hunter':'warrior');assert.equal(rng,offset<0?0:2);
  assert.equal(after.phase,offset<0?'hero_selection':'rps');
  assert.equal(before.featureSecret!.heroSelection!.choices[G],undefined,'input authority unchanged');
  return {path:'submitRemoteHeroSelection',actor:G,requestedHero:'hunter',deadline,now:deadline+offset,returnedNormally:true,
    requestedEffectApplied:offset<0,syntheticOwnChoice:own,rngCalls:rng,before:summary(publicRemoteRoom(before)),after:summary(publicRemoteRoom(after)),
    dispositionFieldPresent:false,source:'tests/remote-room.test.ts MODE-05 (fixedWarrior), plus deadline-1/at/+1 controls'};
});
for(const offset of [-1,0,1])run(`H1-HOST-HERO-${offset}`,()=>{
  // Same production selection boundary, now through host.handle's pre-advance.
  const f=fixture(true);const before=f.room.views();const deadline=before.publicRoom.features!.heroSelection!.deadlineAt;
  f.time(deadline+offset);const code=errorCode(()=>f.room.handle(G,{kind:'hero',hero:'hunter'}));
  assert.equal(code,offset<0?null:'INVALID_PHASE');const after=f.room.views();
  assert.equal(after.publicRoom.phase,offset<0?'hero_selection':'rps');
  assert.equal(f.rng(),offset<0?0:2);
  assert.equal(after.guest.ownHeroChoice,'hunter','fixed-zero timeout may pick the same hero as the rejected command');
  return {path:'BluetoothHostRoom.handle',actor:G,requestedHero:'hunter',now:deadline+offset,deadline,errorCode:code,
    requestedEffectApplied:offset<0,syntheticOwnChoice:after.guest.ownHeroChoice,finalChoiceEqualsRequest:true,rngCalls:f.rng(),clockReads:f.clockReads,before:summary(before.publicRoom),after:summary(after.publicRoom),
    reason:'host pre-advance commits timeout before original action phase check'};
});
run('H1-HOST-PREPARATION-FIRST-AND-ALREADY-READY',()=>{
  const f=fixture(true),r=f.room;
  r.handle(H,{kind:'hero',hero:'hunter'});r.handle(G,{kind:'hero',hero:'hunter'});
  r.handle(H,{kind:'rps',choice:'rock',round:1});r.handle(G,{kind:'rps',choice:'scissors',round:1});
  r.handle(H,{kind:'hero_intro_complete'});r.handle(G,{kind:'hero_intro_complete'});
  assert.equal(r.views().publicRoom.phase,'hero_preparation');
  r.handle(H,{kind:'trap_draft',positions:[{x:0,y:5},{x:0,y:5}]});
  const before=r.views(),n=f.rng();f.time(200);
  const first=r.handle(H,{kind:'preparation_ready'});f.time(201);
  const again=r.handle(H,{kind:'preparation_ready'});
  assert.equal(before.host.ownTraps?.length,0);assert.equal(first.host.ownTraps?.length,2);
  assert.deepEqual(again,first,'no second effect, including revision/events/traps');assert.equal(f.rng(),n);
  assert.equal(first.publicRoom.phase,'hero_preparation');assert.equal(first.publicRoom.features?.heroPreparation?.ready.red,true);
  return {path:'BluetoothHostRoom.handle → completeRemoteHeroPreparation',actor:H,action:{kind:'preparation_ready'},
    firstTime:200,secondTime:201,before:summary(before.publicRoom),first:summary(first.publicRoom),again:summary(again.publicRoom),
    firstTrapCount:2,secondTrapCount:2,exactViewsEqual:true,rngDelta:0,returnedNormallyBoth:true,
    noTransportOrActionIdAtThisAPI:true,duplicateDispositionExposed:false,
    source:'tests/bluetooth-host-room.test.ts BTHOST-04; second call is new controlled probe, not original half_chaos stimulus'};
});
run('H2-RESIGN-THEN-SAME-ID',()=>{
  const f=playing(),r=f.room;const before=r.views();const n=f.rng();f.time(200);
  const committed=r.handle(G,resign);assert.equal(committed.publicRoom.phase,'finished');assert.equal(committed.publicRoom.state?.reason,'resign');
  assert.equal(committed.publicRoom.state?.revision,1);assert.equal(committed.publicRoom.state?.winner,'red');
  assert(committed.publicRoom.messages?.some(m=>m.id==='system:'+resign.actionId));
  f.time(201);const code=errorCode(()=>r.handle(G,resign));assert.equal(code,'INVALID_PHASE');
  const after=r.views();assert.deepEqual(after,committed);assert.equal(f.rng(),n);
  return {actor:G,action:resign,firstTime:200,retryTime:201,before:summary(before.publicRoom),committed:summary(committed.publicRoom),
    retryError:code,after:summary(after.publicRoom),rngDelta:0,actionCategory:'legal resignation, no capture-terminal claim',
    source:'BTHOST-03 legal RPS prefix; tests/hero-forms.test.ts resignation/rematch caller'};
});
run('H2-FORFEIT-COUNTERCONTROL-AND-ACTOR',()=>{
  const initial=joinRemoteRoom(createRemoteRoom('hc-forfeit',H,'offline-only',100,{heroesEnabled:true}),G,'offline-only',100).room;
  const first=forfeitRemoteRoom(initial,G,'hc-forfeit-original',200);
  const duplicate=forfeitRemoteRoom(first.room,G,'hc-forfeit-original',201);
  const otherActor=forfeitRemoteRoom(first.room,H,'hc-forfeit-original',201);
  assert.equal(first.duplicate,false);assert.equal(duplicate.duplicate,true);assert.equal(otherActor.duplicate,true);
  assert.equal(otherActor.room.forfeitOutcome?.loserPlayerId,G);
  const f=fixture(true);f.time(200);const a={kind:'forfeit',actionId:'hc-forfeit-original'} as const;
  const committed=f.room.handle(G,a);f.time(201);const again=f.room.handle(G,a);assert.deepEqual(again,committed);
  return {first:summary(publicRemoteRoom(first.room)),sameIdDuplicate:true,differentActorSameIdDuplicate:true,
    originalLoser:G,otherActor:H,hostReturnsSameViews:true,
    interpretation:'forfeit has an explicit finished duplicate branch before actor check; differs from resign. Boolean cannot attest actor binding.',
    source:'tests/remote-room.test.ts forfeit-before-board duplicate; BTHOST-06; actor variation is additional bounded identity control'};
});
for(const injection of ['none','views','serialization'] as const)run(`H2-WEB-COMMIT-${injection}`,()=>{
  const f=playing(),r=f.room,channel=createReceiptChannel(r,'host');const n=f.rng();f.time(200);
  const originalViews=r.views;let injected=0,viewCalls=0;
  r.views=function(){
    viewCalls++;
    if(injection==='views'&&injected===0){injected++;throw new Error('HC_TEST_ONLY_POST_COMMIT_VIEW_FAULT');}
    const v=originalViews.call(this);
    // handle returns its first projection; Web's publish creates a second.
    if(injection==='serialization'&&viewCalls===2){
      Object.defineProperty(v.guest,'toJSON',{value(){injected++;throw new Error('HC_TEST_ONLY_SERIALIZATION_FAULT');}});
    }
    return v;
  };
  const transportId=`hc-wire-${injection}`;
  try{channel.receive(encodeBluetoothEnvelope({v:2,type:'action',id:transportId,payload:resign}));}finally{r.views=originalViews;}
  const actual=r.views(),frames=channel.emitted.map(raw=>parseBluetoothEnvelope(raw));
  assert.equal(actual.publicRoom.phase,'finished');assert.equal(actual.publicRoom.state?.revision,1);
  assert(actual.publicRoom.messages?.some(m=>m.id==='system:'+resign.actionId));assert.equal(f.rng(),n);
  assert.equal(injected,injection==='none'?0:1);
  if(injection==='views'){
    assert.deepEqual(frames.map(e=>e.type),['error','snapshot']);
    assert.equal(frames[0].id,transportId);assert.equal((frames[0].payload as any).message,'房主拒绝了此操作。');
  }else if(injection==='serialization'){
    assert.equal(frames.length,0);assert(channel.toasts.includes('房间同步失败，请重试。'));
  }else assert.deepEqual(frames.map(e=>e.type),['snapshot']);
  const code=errorCode(()=>r.handle(G,resign));assert.equal(code,'INVALID_PHASE');
  return {action:resign,actor:G,transportId,now:200,injection,explicitTestBoundaryInjection:injection!=='none',
    authority:summary(actual.publicRoom),rngDelta:0,viewCalls,injected,
    emitted:frames.map(e=>({type:e.type,id:e.id,...(e.type==='error'?{payload:e.payload}:{})})),toasts:channel.toasts,
    attemptedFrameTypes:channel.attempted.map(raw=>parseBluetoothEnvelope(raw).type),retryError:code,
    channelSource:{web:channel.sourceSha256,apply:channel.applySha256,channel:channel.channelSha256},
    naturalProductionFaultReproduced:false,automaticResend:false,
    interpretation:injection==='views'?'post-commit injected view exception is exposed as error although resignation committed':injection==='serialization'?'publication serialization failure leaves committed authority intact':'uninjected positive control'};
});
run('H3-REMATCH-IDENTITY-CONTROL',()=>{
  const f=fixture(true),r=f.room;
  const end=r.handle(G,{kind:'forfeit',actionId:'hc-prior-match-exit'});f.time(200);
  r.handle(H,{kind:'rematch_request',actionId:'hc-next-match'});f.time(300);
  const next=r.handle(G,{kind:'rematch_response',accept:true});
  assert.equal(end.publicRoom.roomId,next.publicRoom.roomId);assert.equal(next.publicRoom.phase,'hero_selection');
  assert.equal(next.publicRoom.forfeitOutcome,undefined);assert.equal(next.publicRoom.state,undefined);
  return {roomIdUnchanged:true,oldPhase:end.publicRoom.phase,newPhase:next.publicRoom.phase,oldOutcomeRemoved:true,
    matchEpochExposed:false,source:'BTHOST-07',meaning:'roomId alone cannot identify the original match'};
});
console.log(JSON.stringify({passed:cases.filter(c=>c.status==='PASS').length,failed:cases.filter(c=>c.status==='FAIL').length,out}));
