import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, changedPaths, selectScope, previousSuccess } from './select-scope.mjs';
const before = 'a'.repeat(40), after = 'b'.repeat(40);
const event = { action: 'synchronize', before, after, number: 2 };
const select = (paths, ok = true, e = event) => selectScope({ eventName: 'pull_request', event: e,
  git: () => paths.join('\0') + '\0', priorSuccess: async () => ok });

test('docs-only update carries a successful predecessor without new heavy checks', async () => {
  const s = await select(['handoff/current/STATE.json', 'handoff/current/06_COLLABORATION.md', 'review/invariants/LATEST.json']);
  assert.deepEqual([s.engine, s.hero, s.mode], [false, false, false]);
});
test('docs-only update cannot hide failed, missing, running or unavailable checks', async () => {
  assert.deepEqual(Object.values(classify(['src/hero-descent.ts'])), [true, true, false]);
  for (const ok of [false, undefined]) { const s = await select(['README.md'], ok === true); assert(s.engine && s.hero && s.mode); }
  const s = await selectScope({ eventName: 'pull_request', event, git: () => 'README.md\0', priorSuccess: async () => { throw Error('network'); } });
  assert(s.engine && s.hero && s.mode);
});
test('formal rules and invariant mappings still select the engine suite', async () => {
  for (const p of ['rules/confirmed/new.md', 'handoff/current/01_CURRENT_RULES.md', 'handoff/current/02_CURRENT_HEROES.md',
    'handoff/current/qa/INVARIANTS.json', 'review/invariants/CASE_MAP.json', 'tests/hero-descent-boundaries.test.ts']) {
    const s = await select([p]); assert(s.engine, p);
  }
});
test('runtime keeps hero controls; preview dependencies keep mode checks; workflow changes keep all', async () => {
  assert.deepEqual(Object.values(classify(['src/hero-descent.ts'])), [true, true, false]);
  for (const p of ['src/modes.ts', 'src/setup.ts', 'src/types.ts', 'web/app.ts', '.github/workflows/verify.yml', 'scripts/ci/select-scope.mjs']) {
    const s = await select([p]); assert(s.engine && s.hero && s.mode, p);
  }
});
test('manual events and missing ranges conservatively run all; reopened PR reviews whole diff', async () => {
  const s = await selectScope({ eventName: 'workflow_dispatch', event: {}, priorSuccess: async () => true }); assert(s.engine && s.hero && s.mode);
  const missing = await selectScope({ eventName: 'push', event: { before: '0'.repeat(40), after }, priorSuccess: async () => true }); assert(missing.engine && missing.hero && missing.mode);
  const reopened = await select(['src/hero-descent.ts'], false, { action: 'reopened', pull_request: { base: { sha: before }, head: { sha: after } } });
  assert.equal(reopened.reason, 'whole-pr-review'); assert(reopened.engine && reopened.hero);
});
test('real git diff detects runtime deletion even when renamed to a documentation path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lezi-ci-scope-'));
  const git = args => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(['init']); git(['config', 'user.name', 'Scope test']); git(['config', 'user.email', 'scope@example.invalid']);
    writeFileSync(join(dir, 'runtime.ts'), 'runtime'); git(['add', '.']); git(['commit', '-m', 'before']); const b = git(['rev-parse', 'HEAD']).trim();
    git(['mv', 'runtime.ts', 'README.md']); git(['commit', '-m', 'rename']); const a = git(['rev-parse', 'HEAD']).trim();
    assert.deepEqual(changedPaths({ before: b, after: a }, git).sort(), ['README.md', 'runtime.ts']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('predecessor lookup requires exact head, PR, completed success and latest attempt', async () => {
  const success = { id: 10, head_sha: before, pull_requests: [{ number: 2 }], created_at: '2026-10-08T00:00:00Z', run_attempt: 1, status: 'completed', conclusion: 'success' };
  const lookup = runs => previousSuccess({ eventName: 'pull_request', event, before, workflowRef: 'aaaycc931-droid/jieqi-engine/.github/workflows/verify.yml@ref',
    token: 'test-token', runId: 20, repository: 'aaaycc931-droid/jieqi-engine', fetcher: async () => ({ ok: true, json: async () => ({ workflow_runs: runs }) }) });
  assert(await lookup([success]));
  for (const altered of [{ head_sha: after }, { pull_requests: [{ number: 3 }] }, { status: 'in_progress', conclusion: null }, { conclusion: 'failure' }]) assert.equal(await lookup([{ ...success, ...altered }]), false);
  assert.equal(await lookup([success, { ...success, run_attempt: 2, conclusion: 'failure' }]), false);
  assert.equal(await lookup([]), false);
});
