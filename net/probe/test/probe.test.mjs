import test from 'node:test';
import assert from 'node:assert/strict';
import { createProbeServer } from '../server.mjs';
import { runProbe, summarize, validateTarget } from '../public/runner.mjs';
import { estimate } from '../cost-model.mjs';
import { echo, validReply } from '../protocol.mjs';

const token = 'local-test-token-000000000000000000';
const message = { v: 1, kind: 'echo', id: 'test1', sentAt: 123, padding: 'test' };
async function start(t, options = {}) {
  const probe = createProbeServer({ token, node: 'local-functional-test', ...options });
  await new Promise(resolve => probe.server.listen(0, '127.0.0.1', resolve));
  t.after(() => probe.close());
  return { ...probe, baseURL: `http://127.0.0.1:${probe.server.address().port}` };
}

test('measurement keeps failures and uses nearest-rank P95, not averages', () => {
  const samples = [{ ok: true, ms: 10 }, { ok: false, ms: 999 }, { ok: true, ms: 50 }, { ok: true, ms: 30 }];
  assert.deepEqual(summarize(samples), { attempts: 4, successes: 3, failures: 1, successRate: 0.75, medianMs: 30, p95Ms: 50, maxMs: 50, maxConsecutiveSuccessfulDeltaMs: 40 });
  assert.equal(summarize([]).successRate, null);
  assert.throws(() => validateTarget('http://public.example'));
  assert.throws(() => validateTarget('https://host.example?token=secret'));
  assert.throws(() => echo(JSON.stringify({ ...message, id: '../bad' }), 'local'));
  assert.equal(validReply(echo(JSON.stringify(message), 'local'), message), true);
});

test('missing token disables the service; HTTP requires authorization and rejects oversized echo', async t => {
  const disabled = await start(t, { token: undefined });
  assert.equal((await fetch(disabled.baseURL + '/ping')).status, 503);
  const probe = await start(t);
  const path = probe.baseURL + '/echo?session=test_session_00000000';
  assert.equal((await fetch(path, { method: 'POST', body: JSON.stringify(message) })).status, 401);
  const headers = { authorization: `Bearer ${token}` };
  const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(message) });
  assert.equal(response.status, 200); assert.equal(validReply(await response.json(), message), true);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(path, { method: 'POST', headers, body: 'x'.repeat(65537) })).status, 413);
});

test('same runner uses real HTTP and WS; reports do not contain the tester token', async t => {
  const probe = await start(t);
  const report = await runProbe({ baseURL: probe.baseURL, token, durationSeconds: 0.4, wsIntervalMs: 60, httpIntervalMs: 100, timeoutMs: 150 });
  assert.ok(report.summary.http.successes >= 2); assert.ok(report.summary.ws.successes >= 2);
  assert.equal(report.summary.http.failures, 0); assert.equal(report.summary.ws.failures, 0);
  assert.equal(report.summary.connections.successes, 1);
  assert.equal(JSON.stringify(report).includes(token), false);
  assert.equal(report.evidenceScope, 'loopback_functional_only');
  const large = await runProbe({ baseURL: probe.baseURL, token, durationSeconds: 0.2, payloadBytes: 16384, wsIntervalMs: 60, httpIntervalMs: 100, timeoutMs: 150 });
  assert.ok(large.summary.ws.successes >= 1); assert.equal(large.summary.ws.failures, 0);
});

test('actual socket termination triggers automatic reconnection and preserves outage evidence', async t => {
  const probe = await start(t); let terminated = false;
  const report = await runProbe({ baseURL: probe.baseURL, token, durationSeconds: 0.8, wsIntervalMs: 60, httpIntervalMs: 200, timeoutMs: 150,
    onProgress: s => { if (!terminated && s.ws.successes >= 1) { terminated = true; for (const ws of probe.sockets.clients) ws.terminate(); } } });
  assert.equal(terminated, true); assert.ok(report.summary.connections.successes >= 2);
  assert.equal(report.summary.unexpectedDisconnects, 1);
  assert.ok(report.recoveries.some(r => r.firstEchoAfterMs !== null));
});

test('planned reconnect during an in-flight echo preserves a cancellation instead of a fake network failure', async t => {
  const probe = await start(t), control = {}; let requested = false;
  const report = await runProbe({ baseURL: probe.baseURL, token, control, durationSeconds: 0.7, wsIntervalMs: 60, httpIntervalMs: 200, timeoutMs: 150,
    onProgress: s => { if (!requested && s.ws.successes >= 1) {
      requested = true;
      // Next response deliberately triggers manual reconnect while the client
      // is still awaiting that echo. This reproduces the CI timing race.
      for (const socket of probe.sockets.clients) socket.send = () => control.reconnect();
    } } });
  assert.ok(report.summary.connections.successes >= 2);
  assert.equal(report.summary.unexpectedDisconnects, 0);
  assert.equal(report.summary.ws.failures, 0);
  assert.equal(report.summary.plannedCancelledProbes, 1);
  assert.ok(report.events.some(e => e.kind === 'planned_close'));
});

test('WS and HTTP authentication failures stay failures rather than fake zero latency', async t => {
  const probe = await start(t);
  const report = await runProbe({ baseURL: probe.baseURL, token: 'wrong-token-000000000000000000', durationSeconds: 0.25, wsIntervalMs: 60, httpIntervalMs: 100, timeoutMs: 100 });
  assert.equal(report.summary.http.successes, 0); assert.ok(report.summary.http.failures > 0);
  assert.equal(report.summary.connections.successes, 0); assert.ok(report.summary.connections.failures > 0);
  assert.equal(report.summary.ws.p95Ms, null); assert.equal(report.summary.http.p95Ms, null);
});

test('stopping an active run preserves completed observations and cleans timers', async t => {
  const probe = await start(t), controller = new AbortController();
  const report = await runProbe({ baseURL: probe.baseURL, token, durationSeconds: 30, signal: controller.signal,
    wsIntervalMs: 60, httpIntervalMs: 100, timeoutMs: 150, onProgress: s => { if (s.ws.successes >= 1) controller.abort(); } });
  assert.equal(report.stoppedByTester, true); assert.ok(report.actualDurationMs < 2000);
  assert.ok(report.summary.ws.successes > 0);
});

test('cost model exposes free duration limits and paid duration billing-unit rounding', () => {
  const small = estimate(50), medium = estimate(200), large = estimate(1000);
  assert.equal(small.freeLimitChecks.durationIfAlwaysActive, true);
  assert.equal(medium.freeLimitChecks.durationIfAlwaysActive, false);
  assert.equal(large.freeLimitChecks.doRowsWritten, false);
  assert.equal(medium.monthly.workersPlusDOUSDAlwaysActiveUpper, 17.5);
  assert.equal(medium.monthly.workersPlusDOUSDHibernationIllustration, 5);
  assert.equal(medium.domainAndEmailUSD, null);
});
