/** Recorded production receiver callbacks -> actual Web functions / jieqi room.
 * Cross-end order is an explicit replay schedule, not Android/radio evidence.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createReceiptChannel, createReceiptPair, currentWeb, sourceHash } from './bluetooth-receipt-channel.ts';
import { callbackDetail, nativeResults } from './native-send-channel.ts';
import { parseBluetoothEnvelope } from '../../src/bluetooth-protocol.ts';

const native = nativeResults();
const received = JSON.parse(readFileSync(new URL('../../review/ch-lifecycle-validation/JVM_RESULTS.json',import.meta.url),'utf8'));
assert.deepEqual(received.production_source_sha256,native.source_sha256);
assert.equal(received.passed,7);assert.equal(received.failed,0);
const cases:any[]=[];
for(const mode of ['eof','ioexception','partial','newline']) {
  const receiver=received.cases.find((c:any)=>c.mode===mode);
  // newline is the normal complete-frame control; others reuse prior
  // failed-write status only. No claim that read-side injection caused it.
  const sendMode=mode==='newline'?'flush':mode==='partial'?'partial':'newline';
  const send=native.cases.find((c:any)=>c.mode===sendMode);
  assert.equal(receiver.input,send.actual.wire);
  for(const order of ['receiver_then_sender','sender_then_receiver']) {
    const p=createReceiptPair();const host=p.host;let calls=0;
    const guest=createReceiptChannel(p.room,'guest',currentWeb(),raw=>{
      assert.equal(sourceHash(raw),send.inputSha256);assert.equal(parseBluetoothEnvelope(raw).type,'action');
      calls++;return send.actual.result;
    });
    const connected=receiver.events.findIndex((e:any)=>e.state==='CONNECTED');assert(connected>=0);
    for(const e of receiver.events.slice(0,connected+1))host.nativeEvent(e);
    let delivered=0;
    function deliverHost(){while(delivered<host.emitted.length)guest.receive(host.emitted[delivered++]);}
    deliverHost();guest.action({kind:'hero',hero:'shuffler'});
    const snapshot=()=>({pending:guest.bluetooth.pendingAction,unknown:guest.bluetooth.pendingActionWriteUnknown,
      requestId:guest.bluetooth.pendingActionId??null,nativeState:guest.bluetooth.nativeState,
      authorityChoice:p.room.views().guest.ownHeroChoice??null,sendAttempts:guest.attempted.length});
    const afterSend=snapshot();assert(afterSend.pending&&afterSend.unknown);
    const observations:any[]=[];
    const senderEvents=send.actual.callbacks.map(callbackDetail);
    const deliverSender=()=>{for(const event of senderEvents){guest.nativeEvent(event);observations.push({endpoint:'sender',event:event.type,state:event.state??null,...snapshot()});}};
    if(order==='sender_then_receiver')deliverSender();
    for(const event of receiver.events.slice(connected+1)){
      if(event.type==='message')parseBluetoothEnvelope(JSON.stringify(event.message));
      host.nativeEvent(event);deliverHost();
      observations.push({endpoint:'receiver',event:event.type,state:event.state??null,...snapshot()});
    }
    if(order==='receiver_then_sender')deliverSender();
    const final=snapshot();
    assert.equal(final.authorityChoice,mode==='eof'||mode==='newline'?'shuffler':null);
    assert.equal(final.pending,false);assert.equal(final.unknown,false);assert.equal(final.requestId,null);
    assert.equal(calls,1);assert.equal(guest.attempted.length,1); // no retry or ping
    if(order==='receiver_then_sender'){
      const beforeSender=observations.filter(o=>o.endpoint==='receiver').at(-1);
      assert.equal(beforeSender.pending,true);assert.equal(beforeSender.unknown,true);
    }
    cases.push({mode,order,sendMode,afterSend,observations,final,attemptTypes:guest.attempted.map(r=>parseBluetoothEnvelope(r).type),
      inputSha256:receiver.input_sha256,receiverMessages:receiver.events.filter((e:any)=>e.type==='message').length,
      scope:'recorded production native events; actual Web functions and real jieqi room; no live JNI/socket/radio'});
  }
}
const result={schema:'lezi.chaos.lifecycle.web.v1',base:received.base,passed:cases.length,failed:0,cases,
  webSha256:sourceHash(currentWeb()),productionNativeSha256:received.production_source_sha256,
  receiverResultSha256:sourceHash(readFileSync(new URL('../../review/ch-lifecycle-validation/JVM_RESULTS.json',import.meta.url),'utf8')),
  interpretation:'EOF full JSON is received and chooses shuffler despite sender unknown; same bytes then IOException and partial EOF do not. UI reset erases transient request ID/unknown, not an authoritative result.',
  limits:['Two cross-end replay orders are conditional schedules, not measured Android/JNI timing.',
    'C1 uses narrow JSON shim; actual TypeScript envelope parser and actual room validate received fixture.',
    'Only public hero selection fixture. No all-action dedup, result ledger/protocol, full DOM, device or formal CH07 acceptance.']};
writeFileSync(new URL('../../review/ch-lifecycle-validation/WEB_RESULTS.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,failed:0}));
