import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const all = () => ({ engine: true, hero: true, mode: true });
const controls = p => p.startsWith('scripts/ci/') || p.startsWith('.github/workflows/');
const product = p => /^(src\/|web\/|android\/|tests\/|scripts\/)/.test(p)
  || /^(package(?:-lock)?\.json|npm-shrinkwrap\.json|tsconfig[^/]*\.json)$/.test(p);
const rules = p => p.startsWith('rules/') || /^handoff\/current\/(?:0[12349]_[^/]+\.md|qa\/INVARIANTS\.json)$/.test(p)
  || p === 'review/invariants/CASE_MAP.json';
const browser = p => /^(src\/|web\/|scripts\/ci\/)/.test(p)
  || /^(package(?:-lock)?\.json|npm-shrinkwrap\.json)$/.test(p)
  || ['tests/helpers.ts', 'tests/flow-fixtures.ts', 'scripts/build-web.ts'].includes(p)
  || /^scripts\/review\/capture-(?:hero-transfer|mode|gameplay|full-match|active-match)-runtime\.mjs$/.test(p);
// Mode previews read setup, slots, types and modes; hero-only modules are not executed there.
const mode = p => p.startsWith('web/') || p.startsWith('scripts/ci/')
  || ['src/modes.ts', 'src/setup.ts', 'src/slots.ts', 'src/types.ts', 'src/rps.ts', 'src/sha256.ts',
    'tests/helpers.ts', 'tests/flow-fixtures.ts', 'scripts/build-web.ts',
    'scripts/review/capture-mode-runtime.mjs', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json'].includes(p);

export function classify(paths) {
  return { engine: paths.some(p => product(p) || rules(p) || controls(p)),
    hero: paths.some(p => browser(p) || controls(p)), mode: paths.some(p => mode(p) || controls(p)) };
}
export function selectRange(eventName, event) {
  if (eventName === 'workflow_dispatch') return null;
  if (eventName === 'push') return { before: event.before, after: event.after };
  if (eventName === 'pull_request') {
    if (event.action === 'synchronize') return { before: event.before, after: event.after ?? event.pull_request?.head?.sha };
    // Open/reopen/ready checks the current PR against its base, not merely the last commit.
    return { before: event.pull_request?.base?.sha, after: event.pull_request?.head?.sha, fullPR: true };
  }
  return null;
}
export function changedPaths(range, git = args => execFileSync('git', args, { encoding: 'utf8' })) {
  const sha = /^[0-9a-f]{40}$/;
  if (!range || !sha.test(range.before ?? '') || !sha.test(range.after ?? '') || /^0+$/.test(range.before)) throw Error('No usable change range');
  // --no-renames includes old and new paths, so moving runtime code into docs cannot hide its deletion.
  return git(['diff', '--name-only', '--no-renames', '-z', range.fullPR ? `${range.before}...${range.after}` : range.before, ...(range.fullPR ? [] : [range.after]), '--']).split('\0').filter(Boolean);
}
export async function previousSuccess({ eventName, event, before, workflowRef, token, runId, fetcher = fetch, api = 'https://api.github.com', repository }) {
  // Only a completed successful run for the exact preceding head may carry evidence forward.
  // Failed, missing or running evidence forces checks; we never erase a failure with a docs-only green skip.
  if (!token || !repository || !before) return false;
  const workflow = workflowRef?.split('@')[0]?.split('/').at(-1);
  if (!workflow) return false;
  const url = `${api}/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=${encodeURIComponent(eventName)}&head_sha=${before}&per_page=100`;
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (!response.ok) return false;
  const runs = (await response.json()).workflow_runs ?? [];
  const relevant = runs.filter(r => String(r.id) !== String(runId) && r.head_sha === before
    && (eventName !== 'pull_request' || (r.pull_requests ?? []).some(p => p.number === event.number)))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.run_attempt - a.run_attempt || b.id - a.id);
  return relevant[0]?.status === 'completed' && relevant[0]?.conclusion === 'success';
}
export async function selectScope({ eventName, event, git, priorSuccess }) {
  const range = selectRange(eventName, event);
  if (!range) return { ...all(), reason: 'manual-or-unknown-event', paths: [] };
  let paths;
  try { paths = changedPaths(range, git); }
  catch { return { ...all(), reason: 'unavailable-change-range', paths: [] }; }
  const selected = classify(paths);
  if (range.fullPR) return { ...selected, reason: 'whole-pr-review', paths };
  if (Object.values(selected).every(Boolean)) return { ...selected, reason: 'affected-checks', paths };
  // If any subset would be skipped, retain previous failures and unknown/uncompleted checks.
  let safe = false;
  try { safe = await priorSuccess(range.before); } catch { /* conservative full run */ }
  return safe ? { ...selected, reason: 'affected-checks-with-successful-predecessor', paths }
    : { ...all(), reason: 'previous-checks-not-confirmed-successful', paths };
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const scope = await selectScope({ eventName, event, priorSuccess: before => previousSuccess({ eventName, event, before,
    workflowRef: process.env.GITHUB_WORKFLOW_REF, token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID,
    api: process.env.GITHUB_API_URL }) });
  console.log(JSON.stringify(scope));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, ['engine', 'hero', 'mode'].map(k => `${k}=${scope[k]}\n`).join(''));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### CI scope\n\nReason: ${scope.reason}\n\nEngine: ${scope.engine}; hero browser: ${scope.hero}; mode browser: ${scope.mode}.\n\nSkipped checks are carried from a successful predecessor, not newly executed evidence.\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
