import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createH15H11ChannelFixture, createRecordedWebChannel } from '../scripts/research/committed-output-channel.ts';
import { parseBluetoothEnvelope } from '../src/bluetooth-protocol.ts';
import { BLUETOOTH_HOST_PLAYER, BluetoothHostRoom } from '../src/bluetooth-host-room.ts';

const old=readFileSync(new URL('./fixtures/committed-output/PR19_WEB_CHANNEL.txt',import.meta.url),'utf8');
const packets=(f:ReturnType<typeof createH15H11ChannelFixture>,start:number)=>f.channel.emitted.slice(start).map(parseBluetoothEnvelope);
function noTrainingLeak(v:any){
  if(!v||typeof v!=='object')return;
  for(const[k,x]of Object.entries(v)){assert(!['secret','training','failed','progress','identities','trainingOriginalSides','processedActions','featureSecret','inviteTokenHash'].includes(k),k);noTrainingLeak(x);}
}

for(const recruit of [0,1]as const)for(const delta of [0,1]){
  test(`CH channel parent ${recruit}/deadline+${delta}: authentic old handler reproduces error-only stale peer while authority advances`,()=>{
    const f=createH15H11ChannelFixture(recruit,old),n=f.channel.emitted.length,prior=f.channel.applied.at(-1)!;
    assert.equal(prior.state!.pendingShuffle!.window,'A');f.setTime(f.deadline+delta);f.channel.receive(f.shuffle().raw);
    assert.equal(f.authority().game!.state.turn,'red');assert.equal(f.authority().game!.state.pendingShuffle,undefined);
    assert.deepEqual(packets(f,n).map(x=>x.type),['error']);assert.equal(f.channel.applied.at(-1)!.state!.pendingShuffle!.window,'A');
  });
  test(`CH channel fixed ${recruit}/deadline+${delta}: error then committed snapshot updates both sinks without private training leak`,()=>{
    const f=createH15H11ChannelFixture(recruit),n=f.channel.emitted.length,draws=f.draws.length;
    f.setTime(f.deadline+delta);f.channel.receive(f.shuffle().raw);const out=packets(f,n),authority=f.authority();
    assert.deepEqual(out.map(x=>x.type),['error','snapshot']);assert.deepEqual(Object.keys(out[0].payload as any),['message']);
    assert.equal(f.channel.attempts.at(-1).code,'WRONG_TURN');
    assert.equal(out[0].id,'request:wire-shuffle');assert.equal((out[1].payload as any).viewerSide,'black');
    const peer=out[1].payload as any;assert.equal(peer.state.turn,'red');assert.equal(peer.state.pendingShuffle,undefined);
    assert.equal(peer.state.formalTurns.black,1);assert.equal(peer.state.heroRuntime.black.used,false);
    assert.equal(peer.state.turnDeadlineAt,f.deadline+delta+60000);assert.equal(authority.game!.state.reason,undefined);
    assert.equal(f.channel.applied.at(-1)!.state!.turn,'red');assert.equal(f.draws.length,draws);noTrainingLeak(peer);noTrainingLeak(f.channel.applied.at(-1));
    const guest=createRecordedWebChannel(f.room,undefined,'guest');for(const raw of f.channel.emitted.slice(n))guest.receive(raw);
    assert.equal(guest.applied.at(-1)!.state!.turn,'red');assert.equal(guest.toasts.length,1);
  });
}

for(const recruit of [0,1]as const){
  test(`CH channel ${recruit}: accepted at deadline-1 uses original shuffle source once; exact replay emits current snapshot without second action`,()=>{
    const f=createH15H11ChannelFixture(recruit),n=f.channel.emitted.length,beforeDraws=f.draws.length,wire=f.shuffle();
    f.useShuffleTape();f.setTime(f.deadline-1);f.channel.receive(wire.raw);
    assert.deepEqual(packets(f,n).map(x=>x.type),['snapshot']);assert.equal(f.authority().game!.state.heroRuntime!.black!.used,true);
    assert.equal(f.draws.length-beforeDraws,recruit===0?29:30);
    const before=f.authority(),draws=f.draws.length,retryStart=f.channel.emitted.length;f.channel.receive(wire.raw);
    assert.deepEqual(packets(f,retryStart).map(x=>x.type),['snapshot']);assert.deepEqual(f.authority(),before);assert.equal(f.draws.length,draws);
    assert(!('duplicate'in(packets(f,retryStart)[0].payload as any)));noTrainingLeak(packets(f,retryStart)[0].payload);
  });
  test(`CH channel ${recruit}: repeated old late request cannot restart red clock or consume H11`,()=>{
    const f=createH15H11ChannelFixture(recruit),wire=f.shuffle();f.setTime(f.deadline);f.channel.receive(wire.raw);
    const before=f.authority(),n=f.channel.emitted.length;f.setTime(f.deadline+1);f.channel.receive(wire.raw);
    assert.deepEqual(packets(f,n).map(x=>x.type),['error','snapshot']);
    assert.equal(f.authority().game!.state.turnDeadlineAt,before.game!.state.turnDeadlineAt);
    assert.deepEqual(f.authority().game!.state.formalTurns,before.game!.state.formalTurns);assert.equal(f.authority().game!.state.heroRuntime!.black!.used,false);
  });
}

test('CH channel both private recruitment worlds retain identical complete snapshot/error bytes at the observed deadline',()=>{
  const fs=([0,1]as const).map(r=>createH15H11ChannelFixture(r));
  for(const f of fs){f.setTime(f.deadline);f.channel.receive(f.shuffle().raw);}
  assert.deepEqual(fs[0].channel.emitted,fs[1].channel.emitted);assert.deepEqual(fs[0].channel.applied,fs[1].channel.applied);
  assert.notDeepEqual(fs[0].authority().game!.secret.training,fs[1].authority().game!.secret.training);
});

test('CH channel local host refusal also publishes a time-advanced committed room to its peer',()=>{
  const f=createH15H11ChannelFixture(0),n=f.channel.emitted.length;f.setTime(f.deadline);
  f.channel.hostAction({kind:'hero_ability',command:{kind:'hero_ability',ability:'training',trainingType:'cannon',actionId:'used-training',expectedRevision:f.open.game!.state.revision}});
  assert.deepEqual(packets(f,n).map(x=>x.type),['snapshot']);assert.equal((packets(f,n)[0].payload as any).state.turn,'red');
  assert.equal(f.channel.applied.at(-1)!.state!.pendingShuffle,undefined);assert(f.channel.toasts.length>=1);
});

test('CH channel accepted action with native send failure is not recast as a rule refusal or submitted twice',()=>{
  const f=createH15H11ChannelFixture(0);f.useShuffleTape();f.setTime(f.deadline-1);f.channel.failSending(true);
  const start=f.channel.sendAttempts.length;f.channel.receive(f.shuffle().raw);
  assert.equal(f.authority().game!.state.heroRuntime!.black!.used,true);
  assert.deepEqual(f.channel.sendAttempts.slice(start).map(x=>parseBluetoothEnvelope(x).type),['snapshot']);
  assert.equal(f.channel.toasts.at(-1),'房间同步失败，请重试。');
});

test('CH channel invalid envelope is rejected before touching room, and no success/error response is invented',()=>{
  const f=createH15H11ChannelFixture(0),before=f.authority(),n=f.channel.emitted.length;
  f.channel.receive('not-json');assert.deepEqual(f.authority(),before);assert.deepEqual(packets(f,n),[]);assert.equal(f.channel.toasts.at(-1),'蓝牙消息不是有效 JSON');
});

test('half-chaos and ordinary retain their real Bluetooth mode gate; original half-chaos errors are not claimed as client wire',()=>{
  for(const baseMode of ['half_chaos','xiangqi']as const)assert.throws(()=>new BluetoothHostRoom({roomId:'gate',admissionSecret:'test',mode:{baseMode},now:()=>1000}),(e:any)=>e.code==='MODE_TRANSPORT_PENDING');
});
