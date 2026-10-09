import { readFile } from 'node:fs/promises';
import { summarize } from './public/runner.mjs';
const files = process.argv.slice(2);
if (!files.length) throw Error('Usage: node analyze.mjs results/*.json');
const groups = new Map();
for (const file of files) {
  const r = JSON.parse(await readFile(file, 'utf8'));
  if (r.schema !== 'LEZI-NET-PROBE-v1') throw Error(`Not a probe report: ${file}`);
  const key = JSON.stringify([r.endpoint, r.metadata.region, r.metadata.carrier, r.metadata.network, r.metadata.vpn, r.config.payloadPaddingBytes]);
  if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r);
}
console.log(JSON.stringify({ schema: 'LEZI-NET-AGGREGATE-v1', acceptanceThresholdsApproved: false,
  caveat: 'Grouped raw observations, not player acceptance. Metadata is self-reported; browser-only samples cannot isolate DNS/TLS failures. A/B must use the same tester and time window.',
  groups: [...groups].map(([key, reports]) => ({ group: JSON.parse(key), reportCount: reports.length,
    sessions: reports.map(r => ({ id: r.session, startedAt: r.startedAt, durationMs: r.actualDurationMs, scope: r.evidenceScope,
      containsBackgroundEvent: r.events.some(e => e.kind === 'visibility_hidden'), stoppedByTester: r.stoppedByTester })),
    http: summarize(reports.flatMap(r => r.http)), ws: summarize(reports.flatMap(r => r.ws)),
    connections: summarize(reports.flatMap(r => r.connections)),
    unexpectedDisconnects: reports.reduce((n, r) => n + r.summary.unexpectedDisconnects, 0),
    recoveryObservations: reports.flatMap(r => r.recoveries),
    hasLoopbackOnlyData: reports.some(r => r.evidenceScope === 'loopback_functional_only'),
    hasUnknownOrEnabledVPN: reports.some(r => !['off', '关闭（自行确认）'].includes(r.metadata.vpn)),
    has60MinuteConnectionObservation: reports.some(r => r.summary.longestObservedConnectionMs >= 3599000),
  })) }, null, 2));
