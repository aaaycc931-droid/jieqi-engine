import { lookup } from 'node:dns/promises';
import { connect } from 'node:tls';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runProbe, validateTarget } from './public/runner.mjs';

export async function coldPreflight(baseURL, count = 3, timeoutMs = 10000) {
  const u = validateTarget(baseURL);
  if (u.protocol !== 'https:') return { scope: 'skipped_loopback_http', samples: [] };
  const samples = [];
  for (let i = 0; i < count; i++) {
    const sample = { at: new Date().toISOString(), dnsOK: false, tlsOK: false, dnsMs: null, tcpMs: null, tlsMs: null };
    const begin = performance.now();
    try {
      let timer;
      const address = await Promise.race([lookup(u.hostname), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('DNS timeout')), timeoutMs);
      })]).finally(() => clearTimeout(timer));
      sample.dnsOK = true; sample.dnsMs = performance.now() - begin;
      await new Promise((resolve, reject) => {
        const start = performance.now(); let tcpAt;
        const socket = connect({ host: address.address, port: Number(u.port || 443), servername: u.hostname, rejectUnauthorized: true });
        const timer = setTimeout(() => { socket.destroy(); reject(Error('TLS timeout')); }, timeoutMs);
        socket.once('connect', () => { tcpAt = performance.now(); sample.tcpMs = tcpAt - start; });
        socket.once('secureConnect', () => { clearTimeout(timer); sample.tlsOK = true; sample.tlsMs = performance.now() - (tcpAt ?? start); socket.destroy(); resolve(); });
        socket.once('error', e => { clearTimeout(timer); socket.destroy(); reject(e); });
      });
    } catch (e) { sample.error = e.message; }
    samples.push(sample);
  }
  return { scope: 'separate_OS_DNS_and_new_TLS_connections_not_HTTP_request_timing',
    caveat: 'OS DNS may be cached; three samples are diagnostic only; failed DNS leaves TLS unattempted.', samples,
    dnsAttempts: samples.length, dnsSuccesses: samples.filter(s => s.dnsOK).length,
    tlsAttempts: samples.filter(s => s.dnsOK).length, tlsSuccesses: samples.filter(s => s.tlsOK).length };
}

async function main() {
  const args = process.argv.slice(2), baseURL = args.shift();
  const options = {};
  while (args.length) {
    const key = args.shift(), value = args.shift();
    if (!['--duration', '--region', '--carrier', '--network', '--vpn', '--payload', '--out'].includes(key) || !value) throw Error('Unknown or missing CLI option');
    options[key.slice(2)] = value;
  }
  if (!baseURL || !options.region || !options.carrier) throw Error('Usage: PROBE_TOKEN=<token> node cli.mjs https://test-host --region city --carrier carrier --duration 600 [--network wifi] [--vpn off] [--out results/report.json]');
  validateTarget(baseURL);
  const token = process.env.PROBE_TOKEN;
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(token ?? '')) throw Error('PROBE_TOKEN must contain the tester token');
  const durationSeconds = Number(options.duration ?? 600);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600) throw Error('Duration must be 1–3600 seconds');
  const diagnostics = await coldPreflight(baseURL);
  const abort = new AbortController(); process.once('SIGINT', () => abort.abort());
  const report = await runProbe({ baseURL, token, durationSeconds, payloadBytes: Number(options.payload ?? 64), signal: abort.signal,
    metadata: { region: options.region, carrier: options.carrier, network: options.network ?? 'unknown', vpn: options.vpn ?? 'unknown',
      runtime: `Node ${process.version}`, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    onProgress: s => process.stderr.write(`\rHTTP ${s.http.successes}/${s.http.attempts}; WS ${s.ws.successes}/${s.ws.attempts}; ${Math.round(s.elapsedMs / 1000)}s   `) });
  report.coldPreflight = diagnostics;
  const out = options.out ?? `results/NET-001-${report.session}.json`;
  await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`\nSaved ${out}`); console.log(JSON.stringify(report.summary, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
