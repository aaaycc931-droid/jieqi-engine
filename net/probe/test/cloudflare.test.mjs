import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { runProbe } from '../public/runner.mjs';

test('actual local workerd: Worker, SQLite-backed DO and Hibernation WS echo interoperate', { timeout: 45000 }, async t => {
  const reservation = createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const token = 'local-test-token-000000000000000000';
  const preload = process.env.NET_TEST_OS_INTERFACE_WORKAROUND === '1' ? ['--import', './test/loopback-interfaces.mjs'] : [];
  const child = spawn(process.execPath, [...preload, 'node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0', '--var', `PROBE_TOKEN:${token}`],
    { cwd: new URL('..', import.meta.url), detached: process.platform !== 'win32', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  const kill = signal => { try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
  t.after(async () => {
    kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000, undefined, { ref: false })]);
    kill('SIGKILL'); // Also reap any remaining descendants in our own process group.
  });
  const baseURL = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw Error(`Wrangler exited ${child.exitCode}: ${output}`);
    try { const r = await fetch(baseURL + '/ping', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(300) }); if (r.status === 200) { ready = true; break; } }
    catch { /* local startup only */ }
    await delay(100);
  }
  assert.ok(ready, output);
  assert.equal((await fetch(baseURL + '/ping')).status, 401);
  assert.equal((await fetch(baseURL + '/')).status, 200);
  const control = {}; let reconnect = false;
  const report = await runProbe({ baseURL, token, control, durationSeconds: 1, wsIntervalMs: 80, httpIntervalMs: 200, timeoutMs: 500,
    onProgress: s => { if (!reconnect && s.ws.successes >= 2) { reconnect = true; control.reconnect(); } } });
  assert.ok(report.summary.http.successes >= 2); assert.ok(report.summary.ws.successes >= 3);
  assert.equal(report.summary.http.failures, 0, JSON.stringify(report)); assert.equal(report.summary.ws.failures, 0, JSON.stringify(report));
  assert.ok(report.summary.connections.successes >= 2);
  assert.equal(report.summary.unexpectedDisconnects, 0);
});
