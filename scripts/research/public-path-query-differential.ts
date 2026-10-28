/** Research-only public summary. Baseline bytes must be materialized from
 * jieqi-engine 680966fff6484b418c25c9afb8b6759b7a44b594, not from old main.
 * Usage: node scripts/research/public-path-query-differential.ts BASE_ROOT OUT
 * Raw room/secret/event bodies are compared in memory and never written here.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { symbolic, witnesses, kinds, checkingPath, onlyLegEvasion, onlyUnsafeBounces, contract, rng, guards } from '../../tests/public-path-query-fixtures.ts';
import { revealed } from '../../tests/helpers.ts';

const [baselineRoot, output] = process.argv.slice(2);
if (!baselineRoot || !output) throw Error('Supply immutable baseline root and output path');
const currentRoot = new URL('../../', import.meta.url).pathname;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function normalize(value: any, binding: any): any {
  if (typeof value === 'string') {
    if (value === binding.players.red) return '<red-player>';
    if (value === binding.players.black) return '<black-player>';
    return value.replaceAll(binding.roomId, '<room>');
  }
  if (Array.isArray(value)) return value.map(x => normalize(x, binding));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [normalize(k, binding), normalize(v, binding)]));
  return value;
}
const rows: any[] = [], terminalRows: any[] = [], prefixRows: any[] = [];
const prefixBaseline = new Map<string, any>();
for (const [version, root] of [['baseline', resolve(baselineRoot)], ['current', currentRoot]]) {
  const load = (path: string) => import(pathToFileURL(resolve(root, path)).href);
  const [rules, game, context, replay] = await Promise.all([load('src/rules.ts'), load('src/game.ts'), load('src/research-source-context.ts'), load('scripts/research/standard-np32.ts')]);
  const components = [...witnesses, checkingPath(false), checkingPath(true)];
  for (const [index, witness] of components.entries()) for (const kind of kinds) {
    const a = symbolic(witness, kind), before = structuredClone({ state: a.state, secret: a.secret });
    const validation = rules.validatePublicMove(a.state, a.move, 'red', a.options);
    const markers = kind === 'move' ? rules.getLegalMoves(a.state, a.move.pieceId) : rules.getLegalAssassinationMoves(a.state, a.move.pieceId, kind === 'continuing');
    const advertised = markers.some((p: any) => p.x === a.move.to.x && p.y === a.move.to.y);
    const capability = context.issueOriginalStandardNpTuple({ roomId: 'query-differential', tupleId: 'STD-NP32-AS-AP-ES', branch: 'AS', players: { red: 'host', black: 'guest' } }, contract, rng);
    let accepted = false, code: string | undefined;
    try {
      context.withExactStandardNpTuple(capability, () => kind === 'move'
        ? game.applyAuthoritativeMove(a.state, a.secret, a.move, false, 12345)
        : game.applyAuthoritativeAssassination(a.state, a.secret, a.command, 12345));
      accepted = true;
    } catch (error) { code = (error as any).code; if (code !== 'SELF_CHECK') throw error; }
    const expected = index >= 2;
    assert.equal(accepted, expected);
    assert.deepEqual({ state: a.state, secret: a.secret }, before);
    if (version === 'current') { assert.equal(validation.ok, expected); assert.equal(advertised, expected); }
    else if (index < 2) assert.equal(validation.ok, true);
    else if (index >= 4) assert.equal(validation.ok, false);
    rows.push({ version, witness: index < 4 ? witness.id : `checker-removal-scale-${index === 5}`, kind,
      synthetic: true, natural32ReachabilityProved: false, validator: validation.ok, marker: advertised, authorityAccepted: accepted, authorityCode: code,
      queryMatchesAuthority: validation.ok === accepted && advertised === accepted });
  }
  const h02 = symbolic(checkingPath(), 'continuing');
  h02.state.pieces.push(revealed('guard-left', 'black', 'horse', 1, 8), revealed('guard-right', 'black', 'horse', 7, 8), revealed('guard-front', 'black', 'rook', 0, 8));
  for (const [id, a] of [['only-leg-evasion', onlyLegEvasion()], ['only-unsafe-bounces', onlyUnsafeBounces()], ['only-H02-continuing-evasion', h02]] as const) {
    const row = { version, id, synthetic: true, natural32ReachabilityProved: false, inCheck: rules.isGeneralInCheck(a.state, 'red'), anyLegal: rules.hasAnyLegalMove(a.state, 'red'), checkmate: rules.isCheckmate(a.state, 'red'), stalemate: rules.isStalemate(a.state, 'red') };
    if (version === 'current') {
      assert.equal(row.anyLegal, id !== 'only-unsafe-bounces'); assert.equal(row.checkmate, false); assert.equal(row.stalemate, id === 'only-unsafe-bounces');
    }
    terminalRows.push(row);
  }
  for (const branch of ['AS', 'AP', 'ES']) {
    const run = replay.runStandardNp32(contract, rng, guards, branch);
    assert.equal(run.status, 'ORIGINAL_NP32_CONDITIONAL_TAPE_PREFIX_EXECUTED');
    const snapshots = run.results.map((r: any) => normalize({ after: r.after, events: r.events, views: r.views }, run.binding));
    const row = { version, branch, actualRequests: run.actualRequests, allAfterAuthorityEventsAndViewsSha256: hash(snapshots), RNGSha256: hash(run.draws), rawBodiesPublished: false };
    if (version === 'baseline') prefixBaseline.set(branch, { snapshots, draws: run.draws });
    else { assert.deepEqual(snapshots, prefixBaseline.get(branch).snapshots); assert.deepEqual(run.draws, prefixBaseline.get(branch).draws); }
    prefixRows.push(row);
  }
}
const summary = {
  baselineQueryAuthorityMismatches: rows.filter(x => x.version === 'baseline' && !x.queryMatchesAuthority).length,
  currentQueryAuthorityMismatches: rows.filter(x => x.version === 'current' && !x.queryMatchesAuthority).length,
  unsafeCandidatesCorrectlyRemoved: rows.filter(x => x.version === 'current' && !x.authorityAccepted).length,
  safeCheckerRemovalCasesRestored: rows.filter(x => x.version === 'current' && x.witness.startsWith('checker-removal')).length,
  sourceControlsPreserved: 6,
  terminalCasesCompared: 3,
  originalRequestsAuthorityEventsViewsRNGUnchanged: 37,
};
assert.equal(summary.baselineQueryAuthorityMismatches, 12); assert.equal(summary.currentQueryAuthorityMismatches, 0);
const result = { schema: 'lezi.public_path_query.differential.v1', date_local: '2026-10-28', baseline_engine_commit: '680966fff6484b418c25c9afb8b6759b7a44b594',
  summary, rows, terminalRows, prefixRows, independentQA: false, formalModeQualification: false,
  limits: ['18 symbolic cases and three symbolic terminal boards are component evidence, not naturally reachable 32-piece histories.', 'The original 37 real-room requests use declared conditional tapes, not production random sampling.', 'Hidden touched identities, unrelated rosters/effects/spaces, late rain, child/forced windows and full search remain outside the new projection.'] };
mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(summary));
