/** Research-only qualification/differential summary; no raw room/secret bodies.
 * Materialize BASE_ROOT from765a6bc6799ac823c9ba6e1ed6b10fd0c0705608.
 * node scripts/research/public-path-qualification.ts BASE_ROOT OUT
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as currentRules from '../../src/rules.ts';
import { qualifyPublicPathAction } from '../../src/public-path-qualification.ts';
import { runStandardNp32 } from './standard-np32.ts';
import { symbolic, witnesses, kinds, checkingPath, earlyPair, contract, rng, guards } from '../../tests/public-path-query-fixtures.ts';
import { covered, revealed, move } from '../../tests/helpers.ts';

const [baselineRoot, output] = process.argv.slice(2);
if (!baselineRoot || !output) throw Error('Supply pinned baseline root and output');
const baselineRules = await import(pathToFileURL(resolve(baselineRoot, 'src/rules.ts')).href);
const baselineReplay = await import(pathToFileURL(resolve(baselineRoot, 'scripts/research/standard-np32.ts')).href);
const intent = (kind: string): any => kind === 'move' ? { kind: 'move' } : { kind: 'assassination', useStrongStrike: kind === 'continuing', ...(kind === 'activation' ? { source: 'hero' } : {}) };
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function normalize(v: any, binding: any): any {
  if (typeof v === 'string') return v === binding.players.red ? '<red>' : v === binding.players.black ? '<black>' : v.replaceAll(binding.roomId, '<room>');
  if (Array.isArray(v)) return v.map(x => normalize(x, binding));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [normalize(k, binding), normalize(x, binding)]));
  return v;
}
let destinations = 0; const statusCounts: Record<string, number> = {}, qualifiedBoards: any[] = [];
for (const [index, w] of [...witnesses, checkingPath(false), checkingPath(true)].entries()) for (const kind of kinds) {
  const a = symbolic(w, kind), before = structuredClone({ state: a.state, secret: a.secret }), rows: any[] = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const command = { ...a.move, to: { x, y } };
    assert.deepEqual(currentRules.validatePublicMove(a.state, command, 'red', a.options), baselineRules.validatePublicMove(a.state, command, 'red', a.options));
    const q = qualifyPublicPathAction(a.state, command, 'red', intent(kind)); assert.notEqual(q.status, 'uncovered');
    statusCounts[q.status] = (statusCounts[q.status] ?? 0) + 1; rows.push({ x, y, ...q }); destinations++;
  }
  const markers = (rules: any) => kind === 'move' ? rules.getLegalMoves(a.state, a.move.pieceId) : rules.getLegalAssassinationMoves(a.state, a.move.pieceId, kind === 'continuing');
  assert.deepEqual(markers(currentRules), markers(baselineRules));
  assert.deepEqual({ state: a.state, secret: a.secret }, before);
  qualifiedBoards.push({ witness: index < 4 ? w.id : 'checker-scale-' + (index === 5), kind, destinations: rows.length, resultsSha256: hash(rows), synthetic: true, naturalReachabilityProved: false });
}
const gapRows: any[] = [];
for (const where of ['path', 'endpoint']) for (const shield of [false, true]) {
  const path = where === 'path' ? covered('path', 4, 6) : revealed('path', 'red', 'pawn', 4, 6);
  const target = where === 'endpoint' ? covered('target', 6, 6) : revealed('target', 'black', 'pawn', 6, 6);
  const a = earlyPair([revealed('actor', 'red', 'rook', 0, 6), path, target, revealed('second', 'red', 'pawn', 4, 8), revealed('ray', 'black', 'rook', 4, 2)], 'war_chariot');
  if (shield) a.state.effectsByPieceId![where === 'path' ? 'path' : 'target'] = { dragonScale: 1 };
  const command = { ...move({ x: 0, y: 6 }, { x: 6, y: 6 }), pieceId: 'actor' };
  const old = baselineRules.validatePublicMove(a.state, command), current = currentRules.validatePublicMove(a.state, command), q = qualifyPublicPathAction(a.state, command);
  assert.deepEqual(current, old); assert.equal(old.ok, true); assert.equal(q.status, 'uncovered');
  gapRows.push({ id: `hidden-${where}-scale-${shield}`, legacyBoolean: old.ok, qualification: q, synthetic: true, naturalReachabilityProved: false,
    boundary: shield ? 'Protected hidden state does not expand the revealed-only confirmation.' : 'Real destruction/reveal is not simulated with a fabricated private identity.' });
}
const dark = earlyPair([covered('actor', 0, 9)], 'war_chariot');
const darkMove = move({ x: 0, y: 9 }, { x: 0, y: 8 });
assert.deepEqual(currentRules.validatePublicMove(dark.state, darkMove), baselineRules.validatePublicMove(dark.state, darkMove));
gapRows.push({ id: 'hidden-mover', legacyBoolean: true, qualification: qualifyPublicPathAction(dark.state, darkMove), synthetic: true, naturalReachabilityProved: false });
assert.equal(gapRows[4].qualification.status, 'uncovered');
const prefixRows = [];
for (const branch of ['AS', 'AP', 'ES'] as const) {
  const a = baselineReplay.runStandardNp32(contract, rng, guards, branch), b = runStandardNp32(contract, rng, guards, branch);
  assert.equal(a.status, 'ORIGINAL_NP32_CONDITIONAL_TAPE_PREFIX_EXECUTED'); assert.equal(b.status, a.status);
  const traces = (r: any) => r.results.map((x: any) => normalize({ after: x.after, events: x.events, views: x.views }, r.binding));
  const before = traces(a), after = traces(b); assert.deepEqual(after, before); assert.deepEqual(b.draws, a.draws);
  prefixRows.push({ branch, requests: b.actualRequests, oldNewAuthorityEventsViewsEqual: true, oldNewRNGEqual: true, traceSha256: hash(after), RNGSha256: hash(b.draws), rawBodiesPublished: false });
}
const summary = { qualifiedSymbolicSources: 18, destinationsCompared: destinations, newDecisions: statusCounts, existingValidationAndMarkersUnchanged: true,
  explicitUncoveredLegacyTrueExamples: gapRows.length, originalFullOpeningRequestsComparedOldNew: 37, originalAuthorityEventsViewsAndRNGEqual: true };
assert.equal(destinations, 1620);
const report = { schema: 'lezi.public_path_qualification.differential.v1', date_local: '2026-10-28', baseline_engine_commit: '765a6bc6799ac823c9ba6e1ed6b10fd0c0705608',
  summary, qualifiedBoards, gapRows, prefixRows, independentQA: false, formalModeQualification: false,
  limits: ['The1620 destinations share18 symbolic sources; they are not1620 independent samples or naturally reachable histories.', 'Public preflight error code identifies its own basis, not the authoritative command first-error ordering.', 'The new API does not migrate room/UI/terminal consumers or change actual submission/reveal policy.', 'Original37 requests use declared conditional tapes, not production random sampling.', 'Covered movers/contacts, special effects/windows/spaces and broader source qualification remain open.'] };
mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(summary));
