import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReceiptPair, createReceiptChannel, currentWeb } from '../../scripts/research/ch-generation-channel.ts';

// Real production Java response strings, not independently hand-written JSON.
const native = JSON.parse(execFileSync('python3', [fileURLToPath(new URL(
  '../../scripts/research/ch-generation-null-context.py', import.meta.url))], { encoding: 'utf8' }));

function consume(row: any) {
  let scopedCalls = 0, legacyCalls = 0;
  const pair = createReceiptPair();
  const channel = createReceiptChannel(pair.room, 'guest', currentWeb(), () => {
    legacyCalls++; return '{"status":"written"}';
  }, {
    localTransportContext: () => row.context,
    sendCheckedScoped: () => { scopedCalls++; return row.response; },
  });
  pair.host.publish(); channel.receive(pair.host.emitted[0]);
  channel.action({ kind: 'hero', hero: 'shuffler' });
  return { channel, scopedCalls, legacyCalls };
}

test('C5 null model distinguishes key removal from the explicit Android JSON sentinel', () => {
  assert.equal(native.javaNullRemoves, '{}');
  assert.equal(native.sentinelPreservesNull, '{"x":null}');
  assert.equal(native.refusals.length, 4);
  for (const row of native.refusals) assert.equal(row.bytesBefore, row.bytesAfter, row.id);
});

for (const row of native.refusals) test(`C5 real native ${row.id} not_sent clears Web pending without retry`, () => {
  assert.deepEqual(JSON.parse(row.response), { status: 'not_sent', attemptedContext: null });
  const result = consume(row);
  assert.equal(result.channel.bluetooth.pendingAction, false);
  assert.equal(result.channel.bluetooth.pendingActionWriteUnknown, false);
  assert.equal(result.channel.bluetooth.pendingActionId, undefined);
  assert.equal(result.scopedCalls, 1); // No action retry or receipt ping.
  assert.equal(result.legacyCalls, 0);
});

test('C5 actual native written context keeps the existing one-action one-ping path', () => {
  const answer = JSON.parse(native.written.response);
  assert.equal(answer.status, 'written');
  assert.equal(answer.attemptedContext.instance, JSON.parse(native.written.context).context.instance);
  assert.equal(native.wire.split('\n').length, 2);
  const result = consume(native.written);
  assert.equal(result.channel.bluetooth.pendingAction, true);
  assert.equal(result.channel.bluetooth.pendingActionWriteUnknown, false);
  assert.equal(result.scopedCalls, 2);
  assert.equal(result.legacyCalls, 0);
});
