import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {PendingMemory,type Scope} from '../../scripts/research/ch-lifecycle-pending.ts';
import {createReceiptPair,createReceiptChannel,currentWeb,sourceHash} from '../../scripts/research/bluetooth-receipt-channel.ts';
import {callbackDetail,nativeResults} from '../../scripts/research/native-send-channel.ts';
const jvm=JSON.parse(readFileSync(new URL('../../review/ch-lifecycle-validation/JVM_RESULTS.json',import.meta.url),'utf8'));
const native=nativeResults(),sender=native.cases.find((r:any)=>r.mode==='newline'),raw=sender.actual.wire;
const scope:Scope={actor:'bluetooth:guest',authority:'fixture-authority',room:'receipt-source',match:'fixture-match',provenance:'research_fixture_only'};
const missing:Scope={actor:'bluetooth:guest',authority:null,room:null,match:null,provenance:'production_missing'};
for(const mode of ['eof','ioexception'])test('recorded '+mode+' UI clear retains original unknown',()=>{
 const p=createReceiptPair(),memory=new PendingMemory();let token="",calls=0;
 const guest=createReceiptChannel(p.room,'guest',currentWeb(),wire=>{
  assert.equal(sourceHash(wire),sender.inputSha256);calls++;
  // Research wrapper is before the recorded native return, NOT production persistence.
  token=memory.capture(wire,missing);memory.local(token,JSON.parse(sender.actual.result).status);return sender.actual.result;
 });
 p.host.publish();guest.receive(p.host.emitted[0]);guest.action({kind:'hero',hero:'shuffler'});
 const before=memory.inspect(token);assert.equal(before.transportId,'recorded:1');assert.equal(before.raw,raw);
 for(const e of jvm.cases.find((r:any)=>r.mode===mode).events.filter((e:any)=>e.type==='message'))p.host.nativeEvent(e);
 for(const s of p.host.emitted.slice(1))guest.receive(s);
 assert.equal(p.room.views().guest.ownHeroChoice??null,mode==='eof'?'shuffler':null);
 for(const script of sender.actual.callbacks){const e=callbackDetail(script);guest.nativeEvent(e);assert.equal(memory.lifecycle(e).covered,false);}
 assert.equal(guest.bluetooth.pendingAction,false);assert.equal(guest.bluetooth.pendingActionId,undefined);
 assert.deepEqual(memory.inspect(token),before);assert.equal(before.outcome,'unknown');assert.equal(calls,1);assert.equal(guest.attempted.length,1);
});
for(const status of ['not_sent','written','unknown'] as const)test(status+' does not imply authority outcome',()=>{
 const m=new PendingMemory(),t=m.capture(raw,scope);m.local(t,status);assert.equal(m.inspect(t).outcome,'unknown');
 if(status!=='not_sent'){assert.equal(m.fixtureAnswer(t,{raw,scope},'accepted'),'accepted');assert.equal(m.inspect(t).local,status);}
 else {assert.equal(m.fixtureAnswer(t,{raw,scope},'accepted'),'conflict');assert.equal(m.inspect(t).outcome,'unknown');}
});
for(const field of ['actor','authority','room','match','raw'])test('reject wrong '+field+' binding',()=>{
 const m=new PendingMemory(),t=m.capture(raw,scope),b={raw,scope:{...scope}};
 if(field==='raw')b.raw=raw.replace('shuffler','assassin');else b.scope[field as 'actor']='other';
 assert.equal(m.fixtureAnswer(t,b,'accepted'),'binding_mismatch');assert.equal(m.inspect(t).outcome,'unknown');
});
test('missing historical scope cannot be filled in by a reply',()=>{const m=new PendingMemory(),t=m.capture(raw,missing);assert.equal(m.fixtureAnswer(t,{raw,scope},'accepted'),'unknown');assert.equal(m.inspect(t).scope.authority,null);});
test('late old evidence and untagged callback do not resolve a new attempt',()=>{
 const m=new PendingMemory(),old=m.capture(raw,scope),newer=m.capture(raw.replace('recorded:1','recorded:2'),scope);
 assert.equal(m.fixtureAnswer(old,{raw,scope},'accepted'),'accepted');assert.equal(m.lifecycle({state:'DISCONNECTED'}).covered,false);assert.equal(m.inspect(newer).outcome,'unknown');
});
test('FIFO eviction and new memory instance are unknown',()=>{const m=new PendingMemory(1),t=m.capture(raw,scope);m.capture(raw.replace('recorded:1','recorded:2'),scope);assert.equal(m.inspect(t).reason,'not_retained');assert.equal(m.fixtureAnswer(t,{raw,scope},'accepted'),'unknown');const restarted=new PendingMemory();restarted.capture(raw,scope);assert.equal(restarted.inspect(t).outcome,'unknown');assert.equal(restarted.fixtureAnswer(t,{raw,scope},'accepted'),'unknown');});
test('caller mutations cannot change retained binding or answer',()=>{const m=new PendingMemory(),s={...scope},t=m.capture(raw,s);s.actor='wrong';const r=m.inspect(t);r.raw='wrong';assert.equal(m.fixtureAnswer(t,{raw,scope},'rejected'),'rejected');assert.equal(m.inspect(t).local,'unknown');});
test('conflicting accepted/rejected evidence remains conflict',()=>{const m=new PendingMemory(),t=m.capture(raw,scope);m.fixtureAnswer(t,{raw,scope},'accepted');assert.equal(m.fixtureAnswer(t,{raw,scope},'rejected'),'conflict');assert.equal(m.inspect(t).outcome,'unknown');});
test('missing transport ID never becomes attributable',()=>{const m=new PendingMemory(),wire=JSON.stringify({v:2,type:'action',payload:{kind:'hero',hero:'shuffler'}}),t=m.capture(wire,scope);assert.equal(m.fixtureAnswer(t,{raw:wire,scope},'accepted'),'unknown');});
