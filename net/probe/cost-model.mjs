// Scenario assumptions, NOT measured player load or an approved production design.
// Rates checked 2026-10-09; URLs and exclusions are documented in README.md.
export function estimate(dau, { fx = 7.2, activeMsPerEvent = 10 } = {}) {
  const days = 30, matches = dau, roomSeconds = matches * 1200;
  const incomingMessages = dau * 2 * 1200 / 30 + matches * 60;
  const workerRequests = dau * (10 + 2), doRequests = dau * 2 + incomingMessages / 20;
  const doWrites = matches * 60 * 2, d1Writes = matches * 2 + dau * 2, d1Reads = dau * 20;
  const activeLower = (incomingMessages + dau * 2) * activeMsPerEvent / 1000 * 0.128;
  const activeUpper = roomSeconds * 0.128;
  const paid = gb => 5 + Math.ceil(Math.max(0, doRequests * days - 1e6) / 1e6) * 0.15
    + Math.ceil(Math.max(0, gb * days - 400000) / 1e6) * 12.5;
  return { dau, assumption: '2 matches/player/day, 20 min/match, 60 actions/match, 30s app heartbeat, 2 participants/match',
    daily: { matches, incomingMessages, workerRequests, doRequests, doRowsWritten: doWrites, d1RowsWritten: d1Writes, d1RowsRead: d1Reads,
      doGBSecondsHibernationIllustration: activeLower, doGBSecondsAlwaysActiveUpper: activeUpper },
    monthly: { outgoingPayloadGBAt2KBPerPlayerAction: matches * 60 * 2 * 2048 * days / 1e9,
      newEventLogGBAt1KBPerAction: matches * 60 * 1024 * days / 1e9,
      workersPlusDOUSDHibernationIllustration: paid(activeLower), workersPlusDOUSDAlwaysActiveUpper: paid(activeUpper),
      workersPlusDOCNYHibernationIllustration: paid(activeLower) * fx, workersPlusDOCNYAlwaysActiveUpper: paid(activeUpper) * fx },
    freeLimitChecks: { workerRequests: workerRequests <= 100000, doRequests: doRequests <= 100000,
      doRowsWritten: doWrites <= 100000, d1RowsWritten: d1Writes <= 100000, d1RowsRead: d1Reads <= 5000000,
      durationIfHibernateIllustration: activeLower <= 13000, durationIfAlwaysActive: activeUpper <= 13000 },
    assumptions: { fxCNYPerUSD: fx, fxIsIllustrativeNotLiveQuote: true, activeMsPerEvent, storageAndIndexAmplificationUnmeasured: true },
    exclusions: ['Real rule-engine CPU/wall time and transactions', 'Peak-day load and retries', 'Accumulated storage above 5GB',
      'Email provider, domain purchase/renewal, taxes and FX fees', 'Operations, backups and alerts', 'Any other usage sharing the Cloudflare account'],
    domainAndEmailUSD: null, mainlandPerformanceMeasured: false };
}
if (process.argv[1]?.endsWith('/cost-model.mjs')) console.log(JSON.stringify({ schema: 'LEZI-NET-COST-v1', checkedAt: '2026-10-09',
  scenarios: [50, 200, 1000].map(dau => estimate(dau)), note: 'A free plan rejects over-limit operations. Paid duration is rounded to billing units; USD 5 is not a spending cap.' }, null, 2));
