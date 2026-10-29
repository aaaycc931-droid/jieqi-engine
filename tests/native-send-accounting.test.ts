import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeBluetoothEnvelope, parseBluetoothEnvelope } from '../src/bluetooth-protocol.ts';
import { nativeResults,nativeChannelCase,callbackDetail,runNativeSendResearch } from '../scripts/research/native-send-channel.ts';

test('full Java source identity and16 recorded execution cases bind the production native methods',()=>{
  const r=nativeResults();assert.equal(r.cases.length,12);assert.equal(r.ping_cases.length,4);assert.equal(r.parent_native_fault_controls.length,3);
  const prior=r.parent_native_fault_controls.find((x:any)=>x.mode==='write_zero').actual;
  assert.equal(prior.result,null);assert.equal(prior.state,'CONNECTED');assert.equal(prior.writerCleared,false);
  assert.equal(parseBluetoothEnvelope(prior.wire.trim()).type,'ping');assert(prior.queuedCallbacksBeforeDrain>0);
});

test('checked written action and ordered ping interoperate with the actual eligible host and original snapshots',()=>{
  const c=nativeChannelCase('success');assert.deepEqual(c.calls.map(x=>[x.type,x.status]),[['action','written'],['ping','written']]);
  assert.equal(c.room.views().guest.ownHeroChoice,'shuffler');assert.equal(c.guest.bluetooth.pendingAction,false);assert.equal(c.guest.bluetooth.pendingActionWriteUnknown,false);
});

for(const mode of ['no_session','not_connected'])test(`${mode}: native known prewrite failure clears wait and never sends ping or a fallback action`,()=>{
  const c=nativeChannelCase(mode);assert.equal(c.guest.bluetooth.pendingAction,false);assert.equal(c.guest.bluetooth.pendingActionId,undefined);
  assert.equal(c.guest.attempted.length,1);assert.equal(c.calls.length,1);assert.equal(c.guest.emitted.length,0);assert.equal(c.room.views().guest.ownHeroChoice,undefined);
});

for(const mode of ['write_zero','partial','newline','flush','old_writer'])test(`${mode}: native unknown action suppresses ping/retry, retains uncertainty across authorized snapshots`,()=>{
  const c=nativeChannelCase(mode);assert.equal(c.guest.bluetooth.pendingAction,true);assert.equal(c.guest.bluetooth.pendingActionWriteUnknown,true);
  assert.equal(c.calls.length,1);assert.equal(c.guest.attempted.length,1);
  assert.equal(c.room.views().guest.ownHeroChoice,mode==='flush'?'shuffler':undefined);
  assert.match(c.guest.toasts.at(-1)!,/发送结果未知，未自动重试/);
  const n=c.guest.attempted.length;c.guest.action({kind:'hero',hero:'shuffler'});assert.equal(c.guest.attempted.length,n);
});

test('even a derived same-id pong control cannot unlock an unknown action result',()=>{
  const c=nativeChannelCase('write_zero'),id=c.guest.bluetooth.pendingActionId!;
  c.host.receive(encodeBluetoothEnvelope({v:2,type:'ping',id}));c.guest.receive(c.host.emitted.at(-1)!);
  assert.equal(c.guest.bluetooth.pendingAction,true);assert.equal(c.guest.bluetooth.pendingActionWriteUnknown,true);
});

for(const result of ['null','[]','{"status":"unexpected"}','broken-json'])test(`checked malformed result ${result}: no fallback send and no release of uncertainty`,()=>{
  const c=nativeChannelCase('success','success',()=>result);
  assert.equal(c.room.views().guest.ownHeroChoice,'shuffler');assert.equal(c.guest.bluetooth.pendingAction,true);assert.equal(c.guest.bluetooth.pendingActionWriteUnknown,true);
  assert.equal(c.calls.length,1);assert.equal(c.guest.attempted.length,1);
});

test('checked native exception leaves already-written action unknown without legacy fallback',()=>{
  const c=nativeChannelCase('success','success',()=>{throw Error('injected native result failure');});
  assert.equal(c.room.views().guest.ownHeroChoice,'shuffler');assert.equal(c.guest.bluetooth.pendingActionWriteUnknown,true);assert.equal(c.calls.length,1);
});

for(const mode of ['write_zero','not_connected'])test(`ping ${mode}: written action remains pending before connection events when no pong was received`,()=>{
  const c=nativeChannelCase('success',mode);assert.equal(c.room.views().guest.ownHeroChoice,'shuffler');assert.equal(c.guest.bluetooth.pendingAction,true);
  assert.equal(c.guest.bluetooth.pendingActionWriteUnknown,false);assert.equal(c.calls.length,2);
});

test('unknown ping after a known written action may still yield a real pong; this is ordered control, not acceptance status',()=>{
  const c=nativeChannelCase('success','flush');assert.equal(c.room.views().guest.ownHeroChoice,'shuffler');assert.equal(c.guest.bluetooth.pendingAction,false);
  assert.equal(c.calls[1].status,'unknown');assert.equal(c.host.emitted.map(parseBluetoothEnvelope).at(-1)!.type,'pong');
});

test('actual native state callback reaches production event listener, clears the UI lifecycle wait and keeps disconnected actions locked',()=>{
  const c=nativeChannelCase('partial');assert.equal(c.guest.bluetooth.pendingAction,true);c.deliverCallbacks();
  assert.equal(c.guest.bluetooth.nativeState,'DISCONNECTED');assert.equal(c.guest.bluetooth.pendingAction,false);assert.equal(c.guest.bluetooth.pendingActionId,undefined);
  const n=c.guest.attempted.length;c.guest.action({kind:'hero',hero:'shuffler'});assert.equal(c.guest.attempted.length,n);assert.match(c.guest.toasts.at(-1)!,/连接正在恢复/);
  c.guest.nativeEvent({type:'transport-state',state:'CONNECTED'});assert.equal(c.guest.bluetooth.nativeState,'CONNECTED');assert.equal(c.room.views().guest.ownHeroChoice,undefined);
  assert.equal(c.guest.attempted.length,n,'reconnect never retries the unknown action');
});

test('old native transport-error callback alone cannot release a different current unknown action',()=>{
  const c=nativeChannelCase('flush'),r=nativeResults();const callbacks=r.cases.find((x:any)=>x.mode==='legacy_failure').actual.callbacks;
  const error=callbacks.map(callbackDetail).find((x:any)=>x.type==='transport-error');assert(error);c.guest.nativeEvent(error);
  assert.equal(c.guest.bluetooth.pendingAction,true);assert.equal(c.guest.bluetooth.pendingActionWriteUnknown,true);
});

test('complete native/write/Web report retains unverified acceptance, device and mode boundaries',()=>{
  const r=runNativeSendResearch();assert.equal(r.channelCases.length,8);assert.equal(r.pingCases.length,3);assert.equal(r.JVMChecks,16);assert.equal(r.rawAuthorityPublished,false);
});
