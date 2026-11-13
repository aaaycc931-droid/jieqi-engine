import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createReceiptPair,createReceiptChannel,currentWeb} from '../../scripts/research/ch-generation-channel.ts';
import {PendingMemory} from '../../scripts/research/ch-lifecycle-pending.ts';
const native=JSON.parse(readFileSync(new URL('../../review/ch-local-generation/NATIVE_RESULTS.json',import.meta.url),'utf8'));
const row=native.cases.find((r:any)=>r.mode==='eof'&&r.uiModel==='queued');
const initial=JSON.parse(row.context).context;
const ctx=(generation=initial.generation,sequence='999',instance=initial.instance)=>({...initial,generation,sequence,instance});
function setup(role:'host'|'guest'='guest'){
 let current:any=ctx(initial.generation,"0"),response:any=null;let calls=0,legacy=0;
 const bridge:any={localTransportContext:()=>JSON.stringify({v:1,scopedSend:true,context:current}),sendCheckedScoped:(raw:string,i:string,g:string)=>{calls++;return response?response(raw,i,g):JSON.stringify({status:'written',attemptedContext:{...current}});}};
 const p=createReceiptPair(),channel=createReceiptChannel(p.room,role,currentWeb(),()=>{legacy++;return '{"status":"written"}';},bridge);
 current=ctx();p.host.publish();channel.receive(p.host.emitted[0]);
 return{channel,room:p.room,bridge,set(c:any){current=c;},respond(f:any){response=f;},counts:()=>({calls,legacy}),current:()=>current};
}
for(const model of ['inline','queued'])test(model+' real old callback set rejected at final JS after native generation changed',()=>{
 const r=native.cases.find((r:any)=>r.mode==='eof'&&r.uiModel===model),s=setup('host');
 s.channel.bluetooth.pendingAction=true;s.channel.bluetooth.pendingActionId='new';const before=JSON.stringify(s.room.views());s.set(ctx('200'));
 for(const event of r.events)s.channel.nativeEvent(event);
 // ERROR and old CONNECTED/state share same actual origin snapshot; explicit adversarial state variant.
 s.channel.nativeEvent({...r.events[0],state:'ERROR'});
 assert.equal(s.channel.bluetooth.pendingAction,true);assert.equal(s.channel.bluetooth.pendingActionId,'new');assert.equal(JSON.stringify(s.room.views()),before);assert.deepEqual(s.counts(),{calls:0,legacy:0});
});
test('same-generation actual FIFO message survives latest native sequence ahead; duplicates rejected',()=>{
 const s=setup('host');s.set(JSON.parse(row.context).context);
 for(const e of row.events)s.channel.nativeEvent(e);
 assert.equal(s.room.views().guest.ownHeroChoice,'shuffler');const count=s.counts().calls;
 for(const e of row.events)s.channel.nativeEvent(e);assert.equal(s.counts().calls,count);
});
test('same-generation reverse sequence rejected (adversarial only)',()=>{const s=setup();s.channel.bluetooth.pendingAction=true;
 const c=ctx();s.channel.nativeEvent({type:'transport-state',state:'CONNECTED',localContext:{...c,sequence:'8'}});s.channel.bluetooth.pendingAction=true;
 s.channel.nativeEvent({type:'transport-state',state:'DISCONNECTED',localContext:{...c,sequence:'7'}});assert.equal(s.channel.bluetooth.pendingAction,true);
});
test('new native instance with same generation rejects old callbacks',()=>{const s=setup();s.set(ctx(initial.generation,'999','new-instance'));s.channel.bluetooth.pendingAction=true;s.channel.nativeEvent(row.events[1]);assert.equal(s.channel.bluetooth.pendingAction,true);});
test('new Web admits events generated after its initialization watermark',()=>{for(let k=0;k<2;k++){const s=setup();s.channel.bluetooth.pendingAction=true;s.channel.nativeEvent(row.events[1]);assert.equal(s.channel.bluetooth.pendingAction,false);}});
test('scoped send fixed selection makes one action plus ordinary ping; v2 bytes unchanged',()=>{const s=setup();const wires:string[]=[];s.respond((raw:string)=>{wires.push(raw);return JSON.stringify({status:'written',attemptedContext:s.current()});});s.channel.action({kind:'hero',hero:'shuffler'});assert.deepEqual(wires.map(w=>JSON.parse(w).type),['action','ping']);assert.equal(JSON.parse(wires[0]).v,2);assert.deepEqual(JSON.parse(wires[0]).payload,{kind:'hero',hero:'shuffler'});assert.equal(s.counts().legacy,0);});
for(const response of ['bad','throw','mismatch','not_sent'])test('scoped '+response+' never falls back or retries',()=>{const s=setup();s.respond(()=>{if(response==='throw')throw Error();if(response==='bad')return '{}';if(response==='mismatch')return JSON.stringify({status:'written',attemptedContext:ctx('wrong')});return '{"status":"not_sent","attemptedContext":null}';});s.channel.action({kind:'hero',hero:'shuffler'});assert.deepEqual(s.counts(),{calls:1,legacy:0});assert.equal(s.channel.bluetooth.pendingActionWriteUnknown,response!=='not_sent');});
test('late old scoped result does not mutate a new pending request',()=>{const s=setup();s.respond(()=>{const old=s.current();s.set(ctx('200'));s.channel.bluetooth.pendingActionId='new';s.channel.bluetooth.pendingActionWriteUnknown=false;return JSON.stringify({status:'unknown',attemptedContext:old});});s.channel.action({kind:'hero',hero:'shuffler'});assert.equal(s.channel.bluetooth.pendingActionId,'new');assert.equal(s.channel.bluetooth.pendingActionWriteUnknown,false);assert.deepEqual(s.counts(),{calls:1,legacy:0});});
test('bad capability performs zero sends and untagged callbacks cannot clear pending',()=>{const s=setup();s.set(null);s.channel.action({kind:'hero',hero:'shuffler'});assert.deepEqual(s.counts(),{calls:0,legacy:0});assert.equal(s.channel.bluetooth.pendingActionWriteUnknown,true);s.channel.nativeEvent({type:'transport-state',state:'DISCONNECTED'});assert.equal(s.channel.bluetooth.pendingAction,true);});
test('legacy bridge preserves one legacy action + ping path and untagged callbacks',()=>{const p=createReceiptPair();p.host.publish();p.guest.receive(p.host.emitted[0]);p.guest.action({kind:'hero',hero:'shuffler'});assert.deepEqual(p.guest.attempted.map(w=>JSON.parse(w).type),['action','ping']);p.guest.nativeEvent({type:'transport-state',state:'DISCONNECTED'});assert.equal(p.guest.bluetooth.pendingAction,false);});
test('only same-named scoped method without capability is not trusted',()=>{const p=createReceiptPair();let n=0;const c=createReceiptChannel(p.room,'guest',currentWeb(),()=>{n++;return '{}';},{sendCheckedScoped:()=>{n++;return '{}';}});p.host.publish();c.receive(p.host.emitted[0]);c.action({kind:'hero',hero:'shuffler'});assert.equal(n,0);});
test('current lifecycle clears UI without resolving independently retained C4 unknown',()=>{const s=setup(),m=new PendingMemory();s.respond((raw:string)=>{const t=m.capture(raw,{actor:'bluetooth:guest',authority:null,room:null,match:null,provenance:'production_missing'});m.local(t,'unknown');(s as any).token=t;return JSON.stringify({status:'unknown',attemptedContext:s.current()});});s.channel.action({kind:'hero',hero:'shuffler'});s.channel.nativeEvent({...row.events.at(-1),localContext:ctx(initial.generation,'100')});assert.equal(s.channel.bluetooth.pendingAction,false);assert.equal(m.inspect((s as any).token).outcome,'unknown');});

test('Web rebuild rejects previously produced same-generation events',()=>{const p=createReceiptPair();const c=createReceiptChannel(p.room,'host',currentWeb(),undefined,{localTransportContext:()=>JSON.stringify({v:1,scopedSend:true,context:JSON.parse(row.context).context}),sendCheckedScoped:()=>'{"status":"unknown","attemptedContext":null}'});c.bluetooth.pendingAction=true;for(const e of row.events)c.nativeEvent(e);assert.equal(c.bluetooth.pendingAction,true);assert.equal(p.room.views().guest.ownHeroChoice,undefined);});
test('decimal sequence beyond JS integer range keeps adjacent event order',()=>{const s=setup();s.set(ctx(initial.generation,'9007199254740995'));s.channel.nativeEvent({type:'transport-state',state:'CONNECTED',localContext:ctx(initial.generation,'9007199254740993')});s.channel.bluetooth.pendingAction=true;s.channel.nativeEvent({type:'transport-state',state:'DISCONNECTED',localContext:ctx(initial.generation,'9007199254740994')});assert.equal(s.channel.bluetooth.pendingAction,false);});
test('exception after context switch cannot mark a new attempt unknown',()=>{const s=setup();s.respond(()=>{s.set(ctx('200'));s.channel.bluetooth.pendingActionId='new';s.channel.bluetooth.pendingActionWriteUnknown=false;throw Error('late');});s.channel.action({kind:'hero',hero:'shuffler'});assert.equal(s.channel.bluetooth.pendingActionId,'new');assert.equal(s.channel.bluetooth.pendingActionWriteUnknown,false);assert.deepEqual(s.counts(),{calls:1,legacy:0});});
