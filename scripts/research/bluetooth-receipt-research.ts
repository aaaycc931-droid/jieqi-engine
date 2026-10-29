import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseBluetoothEnvelope } from '../../src/bluetooth-protocol.ts';
import { createH15H11ChannelFixture } from './committed-output-channel.ts';
import { createReceiptChannel, createReceiptPair, currentWeb, parentWeb, sourceHash } from './bluetooth-receipt-channel.ts';

export function runReceiptResearch(){
  const periodic=[];
  for(const old of [true,false]){
    const p=createReceiptPair(old?parentWeb():currentWeb());p.host.publish();p.nextHost();p.host.publish();p.guest.action({kind:'hero',hero:'shuffler'});
    const before=p.guest.bluetooth.pendingAction;p.nextHost();const delayed=p.guest.bluetooth.pendingAction;
    assert.equal(delayed,!old);assert.equal(p.room.views().guest.ownHeroChoice,undefined);p.drain();
    periodic.push({source:old?'PR20':'current',schedule:'FIFO delayed periodic snapshot, before any action delivery',pendingBefore:before,pendingAfterDelayedSnapshot:delayed,
      authorityHadChoiceAtDelayedSnapshot:false,pendingAfterDrain:p.guest.bluetooth.pendingAction,delivered:p.delivered});
  }
  const channelCases=[];
  for(const recruit of [0,1]as const)for(const delta of [-1,0,1]){
    const runs=[];
    for(const old of [true,false]){
      const f=createH15H11ChannelFixture(recruit),source=old?parentWeb():currentWeb(),host=createReceiptChannel(f.room,'host',source),guest=createReceiptChannel(f.room,'guest',source);
      host.publish();guest.receive(host.emitted[0]);f.useShuffleTape();f.setTime(f.deadline+delta);guest.action(f.shuffle().action);
      for(const raw of guest.emitted)host.receive(raw);
      const timeline=[];
      for(const raw of host.emitted.slice(1)){const e=parseBluetoothEnvelope(raw);guest.receive(raw);timeline.push({type:e.type,id:e.id,pendingAfter:guest.bluetooth.pendingAction});}
      assert.equal(guest.bluetooth.pendingAction,false);
      runs.push({old,authority:f.authority(),draws:f.draws,frames:host.emitted.filter(x=>parseBluetoothEnvelope(x).type!=='pong'),view:guest.bluetooth.view,timeline,
        guestSendTypes:guest.emitted.map(x=>parseBluetoothEnvelope(x).type)});
    }
    const [a,b]=runs;assert.deepEqual(a.authority,b.authority);assert.deepEqual(a.draws,b.draws);assert.deepEqual(a.frames,b.frames);assert.deepEqual(a.view,b.view);
    assert.equal(b.timeline.at(-1)!.type,'pong');assert(b.timeline.slice(0,-1).every(x=>x.pendingAfter));
    channelCases.push({source:'original CH06/PR14 H15/H11 seed476, source-qualified recruitment0/1',recruit,deadline:65000,delta,
      authorityAndRngUnchanged:true,originalSnapshotErrorBytesUnchanged:true,lastAuthorizedViewUnchanged:true,
      authoritySha256:sourceHash(JSON.stringify(b.authority)),drawsSha256:sourceHash(JSON.stringify(b.draws)),parentTimeline:a.timeline,currentTimeline:b.timeline,
      parentGuestSendTypes:a.guestSendTypes,currentGuestSendTypes:b.guestSendTypes,actualRadioOrDOM:false});
  }
  const chat=[];
  for(const old of [true,false]){
    const f=createH15H11ChannelFixture(0),host=createReceiptChannel(f.room,'host'),guest=createReceiptChannel(f.room,'guest',old?parentWeb():currentWeb());
    host.publish();guest.receive(host.emitted[0]);guest.setUiTime(10000);guest.chat('第一条');guest.setUiTime(12001);guest.chat('第二条');guest.action(f.shuffle().action);
    f.setTime(20001);host.receive(guest.emitted[0]);host.receive(guest.emitted[1]);const timeline=[];
    for(const raw of host.emitted.slice(1)){const e=parseBluetoothEnvelope(raw);guest.receive(raw);timeline.push({type:e.type,id:e.id,pendingAfter:guest.bluetooth.pendingAction});}
    assert.equal(guest.bluetooth.pendingAction,!old);
    chat.push({source:old?'PR20':'current',schedule:'two actual locally valid sendBluetoothChat calls at10000/12001; FIFO host delivery at20001; following game action withheld',
      realClientCooldownMs:2000,serverOutcome:'first accepted; second CHAT_COOLDOWN (message-only wire error)',gameActionHadReachedAuthority:false,
      pendingWhileGameActionWithheld:guest.bluetooth.pendingAction,timeline});
  }
  const p=createReceiptPair();p.host.publish();p.drain();p.guest.failWith(raw=>parseBluetoothEnvelope(raw).type==='action'?'drop':undefined);p.guest.action({kind:'hero',hero:'shuffler'});p.drain();
  assert.equal(p.guest.bluetooth.pendingAction,false);assert.equal(p.room.views().guest.ownHeroChoice,undefined);
  return{schema:'lezi.main.bluetooth_receipt_correlation.v1',id:'MAIN-BLUETOOTH-RECEIPT-CORRELATION-20261029',executed_local_date:'2026-10-30',engine_parent:'8161c348abeba3a99fa5a5b514252e69218f28fd',
    sourceIdentity:{currentWebSha256:sourceHash(currentWeb()),parentFixtureSha256:sourceHash(parentWeb())},
    implementation:'Only current-id pong releases single-flight wait; action then same-id ping in the inspected ordered v2 caller. Snapshot/error payloads and IDs unchanged.',
    compatibility:['new guest / current host','new guest / PR20 host','PR20 guest / current host'],periodic,chat,channelCases,
    knownFailureControl:{kind:'EXPLICIT_FAULT_INJECTION_NOT_NATURAL_SOURCE_REPLAY',injected:'recording bridge silently drops action but sends ping, modeling native swallowed send failure only',
      pendingCleared:true,actionReachedAuthority:false,pongIsAcceptanceAck:false,actualNativeErrorCallbackExecuted:false},
    evidenceTotals:{naturalFifoParentCurrentSchedules:4,H15H11ParentCurrentComparisons:6,complete56Discharged:0,formal64Accepted:0,actualDevices:0},
    limits:['Actual complete production applyBluetoothView executes, final DOM render functions are recorders. Native send is a FIFO recording endpoint, not Java/radio runtime.',
      'No acceptance or duplicate ACK added. A pong orders delivered messages only; swallowed/partial native send, cross-connection delivery, arbitrary replay resistance and full client QA remain open.',
      'No half-chaos or ordinary transport admission, gameplay/scoring/NET/hero/assets changes. Prior owner evidence artifacts remain unchanged.'],rawAuthorityPublished:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=runReceiptResearch(),out=process.argv.find(x=>x.startsWith('--output='))?.slice(9);
  if(out)writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.evidenceTotals));
}
