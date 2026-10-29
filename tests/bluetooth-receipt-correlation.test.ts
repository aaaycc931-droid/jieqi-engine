import assert from 'node:assert/strict';
import test from 'node:test';
import { createReceiptChannel, createReceiptPair, currentWeb, parentWeb } from '../scripts/research/bluetooth-receipt-channel.ts';
import { createH15H11ChannelFixture } from '../scripts/research/committed-output-channel.ts';
import { encodeBluetoothEnvelope, parseBluetoothEnvelope } from '../src/bluetooth-protocol.ts';

const types=(packets:string[])=>packets.map(x=>parseBluetoothEnvelope(x).type);
const choose={kind:'hero',hero:'shuffler'}as const;

test('parent actual complete applyBluetoothView clears pending on a FIFO-delayed periodic snapshot before host sees action',()=>{
  const p=createReceiptPair(parentWeb());p.host.publish();p.nextHost();
  p.host.publish();p.guest.action(choose);assert.equal(p.guest.bluetooth.pendingAction,true);
  p.nextHost();assert.equal(p.guest.bluetooth.pendingAction,false);
  assert.equal(p.room.views().guest.ownHeroChoice,undefined);assert.equal(p.outstanding().toHost,1);
});

test('current actual applyBluetoothView keeps pending through FIFO-delayed periodic and committed snapshots until matching pong',()=>{
  const p=createReceiptPair();p.host.publish();p.nextHost();p.host.publish();p.guest.action(choose);
  const [action,ping]=p.guest.emitted.map(parseBluetoothEnvelope);assert.deepEqual([action.type,ping.type],['action','ping']);assert.equal(action.id,ping.id);
  p.nextHost();assert.equal(p.guest.bluetooth.pendingAction,true);assert.equal(p.room.views().guest.ownHeroChoice,undefined);
  p.nextGuest();p.nextGuest();p.nextHost();assert.equal(p.guest.bluetooth.pendingAction,true);assert.equal(p.guest.bluetooth.view!.ownHeroChoice,'shuffler');
  p.nextHost();assert.equal(p.guest.bluetooth.pendingAction,false);assert.equal(p.guest.bluetooth.pendingActionId,undefined);
  assert.equal(p.guest.renders.at(-1).pending,false);assert.deepEqual(p.outstanding(),{toHost:0,toGuest:0});
});

for(const hostSource of [currentWeb,parentWeb])test(`new guest interoperates with ${hostSource===currentWeb?'current':'PR20'} v2 host without changing wire schema`,()=>{
  const p=createReceiptPair(currentWeb(),hostSource());p.host.publish();p.drain();p.guest.action(choose);p.drain();
  assert.equal(p.guest.bluetooth.pendingAction,false);assert.equal(p.guest.bluetooth.view!.ownHeroChoice,'shuffler');
  assert.deepEqual(types(p.guest.emitted),['action','ping']);assert.deepEqual(types(p.host.emitted),['snapshot','snapshot','pong']);
  const pong=parseBluetoothEnvelope(p.host.emitted.at(-1)!);assert.deepEqual(Object.keys(pong),['v','type','id']);
});

test('PR20 guest and new host retain their existing one-action/one-snapshot exchange',()=>{
  const p=createReceiptPair(parentWeb());p.host.publish();p.drain();p.guest.action(choose);p.drain();
  assert.deepEqual(types(p.guest.emitted),['action']);assert.deepEqual(types(p.host.emitted),['snapshot','snapshot']);assert.equal(p.guest.bluetooth.pendingAction,false);
});

for(const recruit of [0,1]as const)for(const delta of [0,1])test(`natural H15/H11 ${recruit}/deadline+${delta}: refusal, latest committed view, then ordered pong`,()=>{
  const f=createH15H11ChannelFixture(recruit),host=createReceiptChannel(f.room,'host'),guest=createReceiptChannel(f.room,'guest');
  host.publish();guest.receive(host.emitted[0]);f.setTime(f.deadline+delta);guest.action(f.shuffle().action);
  host.receive(guest.emitted[0]);host.receive(guest.emitted[1]);assert.deepEqual(types(host.emitted.slice(1)),['error','snapshot','pong']);
  guest.receive(host.emitted[1]);assert.equal(guest.bluetooth.pendingAction,true);assert.equal(guest.bluetooth.view!.state!.pendingShuffle!.window,'A');
  guest.receive(host.emitted[2]);assert.equal(guest.bluetooth.pendingAction,true);assert.equal(guest.bluetooth.view!.state!.turn,'red');assert.equal(guest.bluetooth.view!.state!.pendingShuffle,undefined);
  guest.receive(host.emitted[3]);assert.equal(guest.bluetooth.pendingAction,false);assert.equal(guest.renders.at(-1).pending,false);
  assert.equal(f.authority().game!.state.heroRuntime!.black!.used,false);
});

test('a prior actual error and ping/pong control cannot unlock a different pending request',()=>{
  const f=createH15H11ChannelFixture(0),host=createReceiptChannel(f.room,'host'),guest=createReceiptChannel(f.room,'guest');
  f.setTime(f.deadline);host.receive(f.shuffle('prior').raw);const error=host.emitted.find(x=>parseBluetoothEnvelope(x).type==='error')!;
  // Explicit delayed-frame control derived from actual output, not an original FIFO replay.
  guest.action(f.shuffle('next').action);guest.receive(error);assert.equal(guest.bluetooth.pendingAction,true);
  host.receive(encodeBluetoothEnvelope({v:2,type:'ping',id:'prior-ping'}));guest.receive(host.emitted.at(-1)!);assert.equal(guest.bluetooth.pendingAction,true);
});

test('an actual previous pong replay does not release a later request; duplicate current pong is inert',()=>{
  const p=createReceiptPair();p.host.publish();p.drain();p.guest.action(choose);p.drain();const old=p.host.emitted.at(-1)!;
  p.guest.action(choose);assert.equal(p.guest.bluetooth.pendingAction,true);p.guest.receive(old);assert.equal(p.guest.bluetooth.pendingAction,true);
  p.drain();assert.equal(p.guest.bluetooth.pendingAction,false);const n=p.guest.renders.length;p.guest.receive(p.host.emitted.at(-1)!);assert.equal(p.guest.renders.length,n);
});

test('guest remains single-flight when a periodic snapshot arrives before pong',()=>{
  const p=createReceiptPair();p.host.publish();p.drain();p.guest.action(choose);p.host.publish();p.nextHost();
  const n=p.guest.emitted.length;p.guest.action(choose);assert.equal(p.guest.emitted.length,n);assert.equal(p.guest.toasts.at(-1),'正在等待房主确认上一项操作。');
  p.drain();assert.equal(p.guest.bluetooth.pendingAction,false);
});

test('exact accepted H11 wire replay does not consume RNG or authority twice, and pong carries no duplicate ACK',()=>{
  const f=createH15H11ChannelFixture(0),host=createReceiptChannel(f.room,'host'),guest=createReceiptChannel(f.room,'guest');
  f.useShuffleTape();f.setTime(f.deadline-1);guest.action(f.shuffle().action);for(const raw of guest.emitted)host.receive(raw);
  const before=f.authority(),draws=f.draws.length,start=host.emitted.length;
  for(const raw of guest.emitted)host.receive(raw);assert.deepEqual(f.authority(),before);assert.equal(f.draws.length,draws);
  assert.deepEqual(types(host.emitted.slice(start)),['snapshot','pong']);assert.deepEqual(Object.keys(parseBluetoothEnvelope(host.emitted.at(-1)!)),['v','type','id']);
});

test('synchronous action send throw clears its pending identity without sending a ping',()=>{
  const p=createReceiptPair();p.guest.failWith(()=> 'throw');p.guest.action(choose);
  assert.equal(p.guest.bluetooth.pendingAction,false);assert.equal(p.guest.bluetooth.pendingActionId,undefined);assert.deepEqual(p.guest.emitted,[]);assert.equal(p.guest.attempted.length,1);
});

test('synchronous ping send throw keeps uncertain action pending; committed snapshot cannot unlock it',()=>{
  const p=createReceiptPair();p.host.publish();p.drain();p.guest.failWith(raw=>parseBluetoothEnvelope(raw).type==='ping'?'throw':undefined);p.guest.action(choose);p.drain();
  assert.equal(p.room.views().guest.ownHeroChoice,'shuffler');assert.equal(p.guest.bluetooth.pendingAction,true);
  assert.equal(p.guest.toasts.at(-1),'操作已发送，确认消息发送失败，请等待连接恢复。');assert.deepEqual(types(p.guest.emitted),['action']);
});

test('explicit native-like swallowed action-send failure is a known boundary: pong alone is not proof of acceptance',()=>{
  const p=createReceiptPair();p.host.publish();p.drain();p.guest.failWith(raw=>parseBluetoothEnvelope(raw).type==='action'?'drop':undefined);p.guest.action(choose);p.drain();
  assert.equal(p.guest.bluetooth.pendingAction,false);assert.equal(p.room.views().guest.ownHeroChoice,undefined);assert.equal(p.guest.bluetooth.view!.ownHeroChoice,undefined);
  assert.deepEqual(types(p.guest.attempted),['action','ping']);assert.deepEqual(types(p.guest.emitted),['ping']);
});

test('host local action path does not acquire guest wait identity or emit receipt-control ping',()=>{
  const p=createReceiptPair();p.host.action({kind:'hero',hero:'sky_admiral'});assert.equal(p.host.bluetooth.pendingAction,false);
  assert.deepEqual(types(p.host.emitted),['snapshot']);assert.equal(p.host.bluetooth.pendingActionId,undefined);
});

for(const old of [true,false])test(`${old?'parent':'current'}: real chat caller cooldown plus FIFO network delay produces unrelated error during pending game action`,()=>{
  const f=createH15H11ChannelFixture(0),source=old?parentWeb():currentWeb(),host=createReceiptChannel(f.room,'host'),guest=createReceiptChannel(f.room,'guest',source);
  host.publish();guest.receive(host.emitted[0]);
  // Two locally lawful chats, separated by the real 2s client cooldown, wait in
  // the input queue. Host receives both at20001: second hits its own cooldown.
  guest.setUiTime(10000);guest.chat('第一条');guest.setUiTime(12001);guest.chat('第二条');
  guest.action(f.shuffle().action);assert.equal(guest.bluetooth.pendingAction,true);
  assert.equal(guest.emitted.length,old?3:4);f.setTime(20001);host.receive(guest.emitted[0]);host.receive(guest.emitted[1]);
  const error=host.emitted.find(x=>parseBluetoothEnvelope(x).type==='error')!;assert(error);
  // Release outputs in their actual order. The game action is still withheld.
  for(const raw of host.emitted.slice(1)){guest.receive(raw);if(raw===error)assert.equal(guest.bluetooth.pendingAction,!old);}
  assert.equal(f.authority().game!.state.heroRuntime!.black!.used,false);
  assert.equal(guest.bluetooth.pendingAction,!old);assert.equal(guest.toasts.filter(x=>x==='消息发送过快').length,0);
});
