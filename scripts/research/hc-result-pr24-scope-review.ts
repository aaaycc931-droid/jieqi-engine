import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Explicit read-only dependency. Run in the hc research checkout; do not copy
// PR24 into this branch or merge it. Caller must check out this exact revision.
const dependency = process.env.HC_PR24_ROOT;
assert(dependency, 'Set HC_PR24_ROOT to a separate fixed PR24 checkout');
const root = resolve(dependency);
const expected = 'f30f1f5541fd84ebbf6aa298a4bcc3e446adeb80';
assert.equal(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), expected);
assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }), '');
const source = 'scripts/research/main-authority-result-prototype.ts';
const bytes = readFileSync(resolve(root, source));
assert.deepEqual(bytes, execFileSync('git', ['-C', root, 'show', `${expected}:${source}`]));
const { OfflineAuthorityResultPrototype } = await import(pathToFileURL(resolve(root, source)).href);
const { createRemoteRoom, joinRemoteRoom } = await import(pathToFileURL(resolve(root, 'src/remote-room.ts')).href);
const H = 'bluetooth:host', G = 'bluetooth:guest';
const fullScope = { authorityId: 'hc-r59-authority', roomId: 'hc-r59-room', matchEpoch: 'match-1' };
const action = { kind: 'hero', hero: 'hunter' };
const cases: any[] = [];
for (const variant of ['complete', 'missing-authority', 'missing-match', 'empty-authority']) {
  const scope: any = { ...fullScope };
  if (variant === 'missing-authority') delete scope.authorityId;
  if (variant === 'missing-match') delete scope.matchEpoch;
  if (variant === 'empty-authority') scope.authorityId = '';
  const room = joinRemoteRoom(createRemoteRoom(fullScope.roomId, H, 'synthetic-local-only', 100,
    { baseMode: 'jieqi', heroesEnabled: true, mutationsEnabled: false }), G, 'synthetic-local-only', 100).room;
  let p: any, constructionError: string | null = null;
  try { p = new OfflineAuthorityResultPrototype({ scope, room, randomInt: () => 0 }); }
  catch (e) { constructionError = (e as Error).message; }
  if (variant === 'empty-authority') {
    assert.equal(constructionError, 'Exact jieqi scope required');
    cases.push({ variant, scopeKeys: Object.keys(scope), constructed: false, constructionError,
      findingReproduced: false, classification: 'existing empty-string guard control' });
    continue;
  }
  assert.equal(constructionError, null);
  p.handle({ actor: H, transportId: 'hc-r59-original', action }, 100);
  const stateBeforeQuery = p.inspectForResearch();
  const answer = p.query(H, { scope: { ...scope }, transportId: 'hc-r59-original', action });
  assert.deepEqual(answer, { query: 'valid', outcome: 'accepted' });
  assert.deepEqual(p.inspectForResearch(), stateBeforeQuery);
  cases.push({ variant, scopeKeys: Object.keys(scope), constructed: true, answer,
    queryChangedAuthority: false, findingReproduced: variant !== 'complete',
    classification: variant === 'complete' ? 'valid-scope positive control' : 'runtime missing-field guard gap; deliberately outside ResultScope static type' });
}
const output = { schema: 'lezi.hc.pr24.scope_review.v1', dependencyCommit: expected,
  dependencySource: source, dependencySourceSha256: createHash('sha256').update(bytes).digest('hex'),
  node: process.version, command: 'HC_PR24_ROOT=/absolute/path/to/pr24-checkout node scripts/research/hc-result-pr24-scope-review.ts',
  casesRun: 4, observationChecksPassed: 4, guardGapReproductions: 2, cases,
  limits: ['Not a network or cross-actor exploit; caller/scope are trusted offline inputs in PR24.',
    'Missing fields are intentional malformed runtime inputs, not correctly typed ResultScope inputs.',
    'One structural validation issue; two missing-field variants do not count as two defects.',
    'No PR24 implementation, production source, old 13/29 suites or mode gates changed.'] };
mkdirSync('review/hc-result-evidence', { recursive: true });
writeFileSync('review/hc-result-evidence/PR24_SCOPE_RESULTS_20261113.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ casesRun: 4, observationChecksPassed: 4, guardGapReproductions: 2 }));
