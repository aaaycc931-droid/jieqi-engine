import assert from 'node:assert/strict';
import test from 'node:test';
import { BluetoothHostRoom } from '../src/bluetooth-host-room.ts';
import { createReceiptChannel, currentWeb } from '../scripts/research/ch-generation-channel.ts';

// Actual final Web listener, actual room/dispatcher; DOM and native bridge are
// explicit recording substitutes. These are not browser or Android tests.
const context = (sequence = '0') => ({ instance: 'alias-fixture', generation: '1', sequence, role: 'HOST' });
const action = JSON.stringify({ v: 2, type: 'action', id: 'alias-action', payload: { kind: 'hero', hero: 'hunter' } });
function setup(scoped = true) {
  const room = new BluetoothHostRoom({ roomId: 'alias-room', admissionSecret: 'synthetic',
    now: () => 100, randomInt: () => 0, mode: { heroesEnabled: true, mutationsEnabled: false } });
  let current = context(), dispatches = 0;
  const original = room.handle.bind(room);
  room.handle = (...args: Parameters<typeof room.handle>) => { dispatches++; return original(...args); };
  const channel = createReceiptChannel(room, 'host', currentWeb(), undefined, scoped ? {
    localTransportContext: () => JSON.stringify({ v: 1, scopedSend: true, context: current }),
    sendCheckedScoped: () => JSON.stringify({ status: 'written', attemptedContext: current }),
  } : {});
  current = context('10');
  return { room, channel, calls: () => dispatches };
}

for (const [name, supplied] of [
  ['missing context', undefined],
  ['old generation', { ...context('1'), generation: '0' }],
  ['old native instance', { ...context('1'), instance: 'old-instance' }],
  ['wrong role', { ...context('1'), role: 'GUEST' }],
  ['before module watermark', context('0')],
  ['not yet produced sequence', context('11')],
] as const) {
  test(`event message alias rejects ${name} before host dispatch`, () => {
    const s = setup();
    s.channel.nativeEvent({ event: 'message', message: action, localContext: supplied });
    assert.equal(s.calls(), 0);
    assert.equal(s.room.views().guest.ownHeroChoice, undefined);
  });
}

for (const field of ['event', 'type'] as const) {
  test(`${field} message admits a fresh native event once and drops its duplicate`, () => {
    const s = setup(); const event = { [field]: 'message', message: action, localContext: context('1') };
    s.channel.nativeEvent(event); s.channel.nativeEvent(event);
    assert.equal(s.calls(), 1);
    assert.equal(s.room.views().guest.ownHeroChoice, 'hunter');
  });
  test(`${field} message keeps an untagged legacy bridge callback compatible`, () => {
    const s = setup(false);
    s.channel.nativeEvent({ [field]: 'message', message: action });
    assert.equal(s.calls(), 1);
    assert.equal(s.room.views().guest.ownHeroChoice, 'hunter');
  });
}

test('mixed alias/type names cannot consume one native event twice', () => {
  const s = setup();
  s.channel.nativeEvent({ type: 'message', message: action, localContext: context('1') });
  s.channel.nativeEvent({ event: 'message', message: action, localContext: context('1') });
  assert.equal(s.calls(), 1);
});

test('stale event-only pong does not release guest pending action', () => {
  const room = new BluetoothHostRoom({ roomId: 'guest-room', admissionSecret: 'synthetic', now: () => 100 });
  const current = { ...context('0'), role: 'GUEST' };
  const channel = createReceiptChannel(room, 'guest', currentWeb(), undefined, {
    localTransportContext: () => JSON.stringify({ v: 1, scopedSend: true, context: current }),
    sendCheckedScoped: () => JSON.stringify({ status: 'written', attemptedContext: current }),
  });
  channel.action({ kind: 'hero', hero: 'hunter' });
  const id = channel.bluetooth.pendingActionId;
  channel.nativeEvent({ event: 'message', message: JSON.stringify({ v: 2, type: 'pong', id }),
    localContext: { ...current, generation: '0', sequence: '1' } });
  assert.equal(channel.bluetooth.pendingAction, true);
  assert.equal(channel.bluetooth.pendingActionId, id);
});
