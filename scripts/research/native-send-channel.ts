import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseBluetoothEnvelope } from '../../src/bluetooth-protocol.ts';
import { createReceiptChannel, createReceiptPair, currentWeb, sourceHash } from './bluetooth-receipt-channel.ts';

export function nativeResults(){
  const r=JSON.parse(readFileSync(new URL('../../review/native-send-accounting/JVM_RESULTS_20261030.json',import.meta.url),'utf8'));
  for(const[name,sha]of Object.entries(r.source_sha256))assert.equal(sourceHash(readFileSync(new URL('../../android/app/src/main/java/com/jieqi/bluetooth/'+name,import.meta.url),'utf8')),sha,'actual JVM source identity');
  assert.equal(r.passed,16);assert.equal(r.failed,0);return r;
}

export function callbackDetail(script:string){
  const m=script.match(/detail:JSON\.parse\((.*)\)\}\)\);$/);assert(m,'actual GameWebBridge emit expression');return JSON.parse(JSON.parse(m[1]));
}

/** Replays exact full-class JVM method results/writer bytes at the recorded
 * native boundary of actual Web functions. Not a live JNI or socket bridge. */
export function nativeChannelCase(actionMode:string,pingMode='success',overrideResult?: (result:string)=>string){
  const results=nativeResults(),p=createReceiptPair(),host=p.host,calls:any[]=[];
  const guest=createReceiptChannel(p.room,'guest',currentWeb(),raw=>{
    const envelope=parseBluetoothEnvelope(raw),mode=envelope.type==='ping'?pingMode:actionMode;
    const row=(envelope.type==='ping'?results.ping_cases:results.cases).find((x:any)=>x.mode===mode);assert(row,mode);
    assert.equal(row.inputSha256,sourceHash(raw),'exact actual JVM input bytes');calls.push({type:envelope.type,mode,status:row.status,callbacks:row.actual.callbacks});
    for(const line of row.actual.wire.split('\n').slice(0,-1)){parseBluetoothEnvelope(line);guest.emitted.push(line);}
    return overrideResult?overrideResult(row.actual.result):row.actual.result;
  });
  host.publish();guest.receive(host.emitted[0]);guest.action({kind:'hero',hero:'shuffler'});
  const afterSend={pending:guest.bluetooth.pendingAction,unknown:guest.bluetooth.pendingActionWriteUnknown,attempts:guest.attempted.length};
  for(const raw of guest.emitted)host.receive(raw);for(const raw of host.emitted.slice(1))guest.receive(raw);
  return{guest,host,room:p.room,calls,afterSend,
    deliverCallbacks(){for(const call of calls)for(const script of call.callbacks)guest.nativeEvent(callbackDetail(script));},
  };
}

export function runNativeSendResearch(){
  const native=nativeResults(),cases=[];
  for(const mode of ['success','no_session','not_connected','write_zero','partial','newline','flush','old_writer']){
    const c=nativeChannelCase(mode),choice=c.room.views().guest.ownHeroChoice??null;
    const unknown=['write_zero','partial','newline','flush','old_writer'].includes(mode);
    assert.equal(c.guest.bluetooth.pendingAction,unknown);assert.equal(c.guest.bluetooth.pendingActionWriteUnknown,unknown);
    if(mode==='success')assert.equal(choice,'shuffler');if(mode==='flush')assert.equal(choice,'shuffler');
    if(mode==='write_zero'||mode==='partial'||mode==='newline')assert.equal(choice,null);
    const beforeEvents={pending:c.guest.bluetooth.pendingAction,unknown:c.guest.bluetooth.pendingActionWriteUnknown};c.deliverCallbacks();
    cases.push({mode,kind:'EXPLICIT_JVM_WRITER_FAULT_AND_RECORDED_WEB_BOUNDARY',afterSend:c.afterSend,afterHostFrames:beforeEvents,
      nativeCalls:c.calls.map(x=>({type:x.type,status:x.status,mode:x.mode})),authorityChoice:choice,afterNativeCallbacks:{pending:c.guest.bluetooth.pendingAction,nativeState:c.guest.bluetooth.nativeState},
      uncertainActionAutomaticallyRetried:false,actualAndroidOrRadio:false});
  }
  const pingCases=[];for(const mode of ['write_zero','flush','not_connected']){
    const c=nativeChannelCase('success',mode);assert.equal(c.room.views().guest.ownHeroChoice,'shuffler');
    pingCases.push({mode,actionWasWritten:true,afterSend:c.afterSend,pendingAfterActualHostFrames:c.guest.bluetooth.pendingAction,
      meaning:mode==='flush'?'complete ping may produce an actual matching pong; prior action write was known':'missing pong keeps pending before native lifecycle callbacks',actualAcceptanceACK:false});
  }
  return{schema:'lezi.main.native_send_accounting.v1',id:'MAIN-BLUETOOTH-SEND-FAILURE-ACCOUNTING-20261030',date_local:'2026-10-30',
    engine_parent:'96fa7394f0371ab966b8b3572bf3f21b9bfe0da3',sourceWebSha256:sourceHash(currentWeb()),nativeProductionSourceSha256:native.source_sha256,
    JVMChecks:16,parentActualNativeFaultControls:3,channelCases:cases,pingCases,
    actualBoundary:'full production Java classes with explicit Android/JSON/writer/UI substitutes; actual Web functions + true room use exact recorded input/result/complete writer lines, not live JNI',
    resultMeaning:{not_sent:'write not attempted',written:'local write/newLine/flush returned, not remote acceptance',unknown:'write may have partially or fully reached peer; no automatic retry, action ping suppressed'},
    compatibility:'old void send remains; missing sendChecked preserves legacy path with original delivery-knowledge gap. Checked result malformed/throw never falls back to void send.',
    remaining:['Actual Android/WebView callback scheduling, socket/radio/device and complete DOM/QA unverified.','Disconnect/reconnect resets UI wait under existing policy; not a receipt for prior unknown action. Cross-connection stale callbacks and true result reconciliation remain open.',
      'Original half/ordinary gates and complete56/64 acceptance unchanged; no APK/merge/deployment, scoring frozen/NET paused.'],rawAuthorityPublished:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=runNativeSendResearch(),out=process.argv.find(x=>x.startsWith('--output='))?.slice(9);if(out)writeFileSync(out,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({JVM:r.JVMChecks,parentControls:r.parentActualNativeFaultControls,channelCases:r.channelCases.length,pingCases:r.pingCases.length}));}
