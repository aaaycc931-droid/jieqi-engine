const sleep = (ms, signal) => new Promise(resolve => {
  if (signal?.aborted) { resolve(); return; }
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, Math.max(0, ms)); signal?.addEventListener('abort', done, { once: true });
});
const stamp = () => new Date().toISOString();
const now = () => performance.now();

export function summarize(samples) {
  const values = samples.filter(x => x.ok).map(x => x.ms);
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  const deltas = values.slice(1).map((x, i) => Math.abs(x - values[i]));
  return { attempts: samples.length, successes: values.length, failures: samples.length - values.length,
    successRate: samples.length ? values.length / samples.length : null,
    medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) ?? null,
    maxConsecutiveSuccessfulDeltaMs: deltas.length ? Math.max(...deltas) : null };
}

export function validateTarget(raw) {
  const u = new URL(raw);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('Endpoint must be an origin without path, query or credentials');
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw Error('Use HTTPS; HTTP is allowed only for loopback checks');
  return u;
}

export async function runProbe({ baseURL, token, metadata = {}, durationSeconds = 600,
  wsIntervalMs = 5000, httpIntervalMs = 60000, timeoutMs = 10000, payloadBytes = 64,
  signal: externalSignal, onProgress = () => {}, control = {} }) {
  const base = validateTarget(baseURL);
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(token ?? '')) throw Error('A 24–128 character probe token is required');
  if (!(durationSeconds > 0 && durationSeconds <= 3600) || wsIntervalMs < 50 || httpIntervalMs < 50 || timeoutMs < 50) throw Error('Invalid test duration or intervals');
  if (![64, 2048, 16384].includes(payloadBytes)) throw Error('Payload padding must be 64, 2048 or 16384 bytes');
  const stop = new AbortController();
  const abort = () => stop.abort(); externalSignal?.addEventListener('abort', abort, { once: true });
  if (externalSignal?.aborted) abort();
  const started = now(), deadline = started + durationSeconds * 1000;
  const report = { schema: 'LEZI-NET-PROBE-v1', startedAt: stamp(), endpoint: base.origin,
    metadata, config: { durationSeconds, wsIntervalMs, httpIntervalMs, timeoutMs, payloadPaddingBytes: payloadBytes },
    evidenceScope: base.protocol === 'http:' ? 'loopback_functional_only' : 'tester_supplied_network_observation',
    session: crypto.randomUUID(), http: [], ws: [], cancelledProbes: [], connections: [], events: [], recoveries: [], resourceTimings: [],
    limitations: ['Echo latency is not game-engine latency.', 'Echo timeouts are not measured TCP packet loss.',
      'Carrier, location and VPN state are tester supplied.', 'Browser DNS/TLS timings may be unobservable or reused.',
      'HTTPS success proves the combined path; it does not isolate DNS/TLS success rates.',
      'Wi-Fi/mobile changes and background scheduling can alter observations.'] };
  const pending = new Map(), plannedSockets = new WeakSet(); let ws, sequence = 0, outage, nextRetryMs = 500;
  const elapsed = () => now() - started;
  const emit = () => onProgress({ elapsedMs: elapsed(), http: summarize(report.http), ws: summarize(report.ws), connections: report.connections.length });
  const event = (kind, extra = {}) => report.events.push({ at: stamp(), elapsedMs: elapsed(), kind, ...extra });
  const message = () => ({ v: 1, kind: 'echo', id: `m${++sequence}`, sentAt: Date.now(), padding: 'x'.repeat(payloadBytes) });
  const check = (r, m) => r?.v === 1 && r.kind === 'echo' && r.id === m.id && r.sentAt === m.sentAt && r.padding === m.padding && Number.isFinite(r.serverAt);
  const canRun = () => !stop.signal.aborted && now() < deadline;
  const api = path => new URL(`${path}?session=${report.session}`, base);

  control.reconnect = () => { if (ws?.readyState !== 1) return; plannedSockets.add(ws); event('planned_reconnect_requested'); ws.close(4000, 'planned reconnect'); };
  control.mark = kind => {
    event(kind);
    if (kind === 'network_restored_by_tester') report.recoveries.push({ kind: 'tester_reported_restore', markedElapsedMs: elapsed(), firstEchoAfterMs: null });
  };

  async function httpLoop() {
    while (canRun()) {
      const m = message(), at = stamp(), begin = now(), controller = new AbortController();
      const cancel = () => controller.abort(); stop.signal.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, timeoutMs);
      try {
        const response = await fetch(api('/echo'), { method: 'POST', redirect: 'error', cache: 'no-store',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(m), signal: controller.signal });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        if (!check(await response.json(), m)) throw Error('invalid echo reply');
        report.http.push({ at, ok: true, ms: now() - begin });
      } catch (e) { if (!stop.signal.aborted) report.http.push({ at, ok: false, ms: now() - begin, error: String(e.message) }); }
      finally { clearTimeout(timer); stop.signal.removeEventListener('abort', cancel); }
      emit(); await sleep(Math.min(httpIntervalMs, deadline - now()), stop.signal);
    }
  }

  async function connect() {
    const begin = now(), sample = { at: stamp(), ok: false, ms: null, openElapsedMs: null, closedElapsedMs: null };
    report.connections.push(sample);
    const url = api('/ws'); url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, ['lezi-net-v1', `probe.${token}`]); ws = socket;
    socket.addEventListener('message', e => {
      try {
        const value = JSON.parse(e.data), p = pending.get(value.id);
        if (!p) { event('unsolicited_or_late_reply'); return; }
        if (!check(value, p.message)) { p.reject(Error('invalid echo reply')); return; }
        p.resolve();
      } catch { event('malformed_reply'); }
    });
    socket.addEventListener('close', e => {
      sample.closedElapsedMs = elapsed();
      if (!canRun() || !sample.ok) return;
      const isPlanned = plannedSockets.has(socket), kind = isPlanned ? 'planned_close' : 'unexpected_close';
      event(kind, { code: e.code });
      outage ??= { kind, detectedElapsedMs: elapsed(), firstEchoAfterMs: null };
      for (const p of pending.values()) if (p.socket === socket) {
        const error = Error('socket closed'); error.planned = isPlanned; p.reject(error);
      }
    });
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); stop.signal.removeEventListener('abort', aborted); socket.removeEventListener('open', opened); socket.removeEventListener('error', failed); socket.removeEventListener('close', failed); };
      const opened = () => { cleanup(); sample.ok = true; sample.ms = now() - begin; sample.openElapsedMs = elapsed(); resolve(); };
      const failed = () => { cleanup(); sample.ms = now() - begin; sample.error = 'WS connection failed'; reject(Error(sample.error)); };
      const aborted = () => { cleanup(); reject(Error('stopped')); };
      const timer = setTimeout(() => { failed(); socket.close(); }, timeoutMs);
      socket.addEventListener('open', opened, { once: true }); socket.addEventListener('error', failed, { once: true }); socket.addEventListener('close', failed, { once: true });
      stop.signal.addEventListener('abort', aborted, { once: true });
    });
    return socket;
  }

  async function wsLoop() {
    while (canRun()) {
      if (!ws || ws.readyState !== 1) {
        try { await connect(); }
        catch {
          ws?.close(); if (!canRun()) break;
          outage ??= { kind: 'connection_failure', detectedElapsedMs: elapsed(), firstEchoAfterMs: null };
          emit(); await sleep(Math.min(nextRetryMs, deadline - now()), stop.signal); nextRetryMs = Math.min(5000, nextRetryMs * 2); continue;
        }
      }
      if (!canRun()) break;
      const m = message(), at = stamp(), begin = now();
      try {
        await new Promise((resolve, reject) => {
          const cleanup = () => { clearTimeout(timer); pending.delete(m.id); stop.signal.removeEventListener('abort', aborted); };
          const aborted = () => { cleanup(); reject(Error('stopped')); };
          const timer = setTimeout(() => { cleanup(); event('echo_timeout'); reject(Error('echo timeout')); ws?.close(4001, 'echo timeout'); }, timeoutMs);
          pending.set(m.id, { message: m, socket: ws, resolve: () => { cleanup(); resolve(); }, reject: e => { cleanup(); reject(e); } });
          stop.signal.addEventListener('abort', aborted, { once: true });
          try { ws.send(JSON.stringify(m)); } catch (e) { cleanup(); e.planned = plannedSockets.has(ws); reject(e); }
        });
        report.ws.push({ at, ok: true, ms: now() - begin }); nextRetryMs = 500;
        if (outage) { outage.firstEchoAfterMs = elapsed() - outage.detectedElapsedMs; report.recoveries.push(outage); outage = null; }
        for (const recovery of report.recoveries) if (recovery.kind === 'tester_reported_restore' && recovery.firstEchoAfterMs === null) recovery.firstEchoAfterMs = elapsed() - recovery.markedElapsedMs;
      } catch (e) { if (!stop.signal.aborted) {
        if (e.planned) report.cancelledProbes.push({ at, ms: now() - begin, kind: 'ws', reason: 'planned_reconnect' });
        else { report.ws.push({ at, ok: false, ms: now() - begin, error: String(e.message) }); outage ??= { kind: 'echo_failure', detectedElapsedMs: elapsed(), firstEchoAfterMs: null }; }
      } }
      emit(); await sleep(Math.min(wsIntervalMs, deadline - now()), stop.signal);
    }
  }

  try { await Promise.all([httpLoop(), wsLoop()]); }
  finally {
    stop.abort(); externalSignal?.removeEventListener('abort', abort);
    for (const p of pending.values()) p.reject(Error('finished')); ws?.close(1000, 'finished');
    delete control.reconnect; delete control.mark;
  }
  if (outage) report.recoveries.push(outage);
  for (const c of report.connections) if (c.ok && c.closedElapsedMs === null) c.closedElapsedMs = elapsed();
  report.endedAt = stamp(); report.actualDurationMs = elapsed(); report.stoppedByTester = externalSignal?.aborted ?? false;
  if (typeof performance.getEntriesByType === 'function') report.resourceTimings = performance.getEntriesByType('resource')
    .filter(e => e.name.startsWith(base.origin + '/echo') && e.startTime >= started).map(e => ({
      atPerformanceMs: e.startTime, dnsMs: e.domainLookupEnd > e.domainLookupStart ? e.domainLookupEnd - e.domainLookupStart : null,
      tlsMs: e.secureConnectionStart > 0 && e.connectEnd > e.secureConnectionStart ? e.connectEnd - e.secureConnectionStart : null,
      absentReason: 'null means hidden/reused/not observable; not zero latency' }));
  report.summary = { http: summarize(report.http), ws: summarize(report.ws), connections: summarize(report.connections),
    unexpectedDisconnects: report.events.filter(e => e.kind === 'unexpected_close').length,
    plannedCancelledProbes: report.cancelledProbes.length,
    longestObservedConnectionMs: Math.max(0, ...report.connections.filter(c => c.ok).map(c => c.closedElapsedMs - c.openElapsedMs)),
    recoveryIncomplete: report.recoveries.filter(r => r.firstEchoAfterMs === null).length };
  emit(); return report;
}
