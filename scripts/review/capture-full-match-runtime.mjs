import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(root, 'review-results/full-match-runtime');
await mkdir(output, { recursive: true });
// Read-only observation in the review server response only. No state loader,
// secret access, RNG override, clock override or programmatic action submission.
const observer = `
globalThis.__fullMatchReview = {
  snapshot() { return structuredClone({ state: gameState, viewer: localPrivateViewerSide,
    opening: openingActive, preparation: localPreparationActive, trapSide: trapSetupSide,
    draftCount: localTrapDraft.length, selected: selectedPieceId }); },
  candidates() {
    if (!gameState || gameState.status !== 'playing') return [];
    return gameState.pieces.flatMap(piece => {
      if (getController(piece) !== gameState.turn) return [];
      const moves = gameState.flowDance ? getFlowDanceMoves(gameState, piece.id) : getLegalMoves(gameState, piece.id);
      return moves.map(to => ({ pieceId: piece.id, from: {x:piece.x,y:piece.y}, to,
        capture: Boolean(pieceAt(gameState, to)), covered: piece.faceDown }));
    });
  }
};`;
const types = { '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const base = resolve(root, 'dist');
    let path = resolve(base, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(base + '/')) throw new Error('Invalid path');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    let bytes = await readFile(path);
    if (path === resolve(base, 'web/app.js')) bytes = Buffer.concat([bytes, Buffer.from(observer)]);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true });
const report = {
  authority: 'browser_execution_evidence_non_normative',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  appDigest: createHash('sha256').update(await readFile(resolve(root, 'dist/web/app.js'))).digest('hex'),
  browser: browser.version(), viewport: { width: 390, height: 845 },
  method: 'Actual homepage, hero selection, locked RPS, original random mutation/deal, hunter preparation and DOM board actions to natural result. Review response exposes public read-only snapshot/legal candidates only.',
  policy: 'Random public legal action; prefer captures with probability 0.85, otherwise prefer unrepeated moves. No secret-informed choices. Fixed rock versus scissors assigns player one red. Hero pairs each tested twice with swapped seats.',
  actionCap: 300,
  limits: ['Twelve randomly dealt local matches are sampled execution evidence, not exhaustive hero/mutation acceptance.', 'Active hero skills are not exercised by this match policy; prepared-state reviews cover selected skills separately.', 'Bluetooth transport, Android WebView, physical two-phone execution and timeout outcomes remain pending.', 'No APK, normative rule, production debug API or artwork change.'],
  matches: [], errors: [],
};
const pairs = [['warrior','death_knight'],['qin_long','prince'],['wind','hunter'],['rogue','devout_zealot'],['nozdormu','murozond'],['murozond_minion','deathwing']];
try {
  for (const [index, heroes] of [...pairs, ...pairs.map(pair => [...pair].reverse())].entries()) {
    const entry = { index: index + 1, heroes, passed: false, trace: [] };
    report.matches.push(entry);
    const context = await browser.newContext({ viewport: report.viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => errors.push(r.url()));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    const snapshot = () => page.evaluate(() => globalThis.__fullMatchReview.snapshot());
    const point = p => page.locator(`.point[data-x="${p.x}"][data-y="${p.y}"]`);
    const dialog = async () => {
      assert(await page.locator('#flow-dialog').evaluate(e => e.open), 'Expected actual flow dialog');
      entry.trace.push({ dialog: await page.locator('#dialog-title').textContent() });
      await page.locator('#dialog-action').click();
    };
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/web/`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean(globalThis.__fullMatchReview));
      await page.locator('#local-game-button').click();
      for (let player = 0; player < 2; player++) {
        await page.locator(`.hero-grid-item:has([data-hero="${heroes[player]}"])`).click();
        await page.locator('#hero-confirm-button').click();
        if (player === 0) await dialog();
      }
      for (const choice of ['rock', 'scissors']) {
        await page.locator(`.rps-choice[data-choice="${choice}"]`).click();
        await page.locator('#rps-confirm-button').click();
        await dialog();
      }
      await page.waitForFunction(() => !globalThis.__fullMatchReview.snapshot().opening, undefined, { timeout: 15_000 });
      let before = await snapshot();
      while (before.preparation) {
        await dialog();
        const y = before.trapSide === 'red' ? 6 : 3;
        await point({ x: 4, y }).click(); await point({ x: 4, y }).click();
        assert.equal((await snapshot()).draftCount, 2);
        await page.locator('#preparation-confirm-button').click();
        before = await snapshot();
      }
      entry.initialState = before.state;
      entry.mutation = before.state.featureRules.mutation ?? 'none';
      assert.equal(before.state.pieces.length, 32);
      assert.equal(before.state.pieces.filter(p => p.faceDown).length, 30);
      assert.deepEqual(before.state.featureRules.heroes, { red: heroes[0], black: heroes[1] });
      assert.equal(before.viewer, 'red');
      const visits = new Map();
      let actions = 0;
      while (before.state.status !== 'finished' && actions < report.actionCap) {
        if (before.state.status === 'execution') {
          await page.waitForFunction(() => globalThis.__fullMatchReview.snapshot().state.status !== 'execution', undefined, { timeout: 15_000 });
          before = await snapshot(); continue;
        }
        if (await page.locator('#flow-dialog').evaluate(e => e.open)) {
          assert.equal(before.viewer, undefined, 'Handoff must clear private viewer');
          assert.equal(await page.locator('.own-trap').count(), 0, 'Handoff must hide private traps');
          await dialog(); before = await snapshot();
          assert.equal(before.viewer, before.state.turn);
        }
        const candidates = await page.evaluate(() => globalThis.__fullMatchReview.candidates());
        assert(candidates.length > 0, 'Playing state has no legal DOM action');
        const key = m => `${before.state.turn}:${m.pieceId}:${m.from.x},${m.from.y}:${m.to.x},${m.to.y}`;
        const captures = candidates.filter(m => m.capture);
        let pool = captures.length && randomInt(100) < 85 ? captures : candidates;
        const minimum = Math.min(...pool.map(m => visits.get(key(m)) ?? 0));
        pool = pool.filter(m => (visits.get(key(m)) ?? 0) === minimum);
        const action = pool[randomInt(pool.length)];
        visits.set(key(action), (visits.get(key(action)) ?? 0) + 1);
        await point(action.from).click();
        assert.equal((await snapshot()).selected, action.pieceId, 'Source selected by DOM');
        assert(await point(action.to).evaluate(e => e.classList.contains('legal-empty') || e.classList.contains('legal-capture')), 'Public legal marker visible');
        await point(action.to).click();
        const after = await snapshot();
        assert(after.state.revision > before.state.revision, `DOM action failed: ${await page.locator('.toast').textContent()}`);
        entry.trace.push({ action: ++actions, turn: before.state.turn, revision: before.state.revision, ...action,
          afterRevision: after.state.revision, afterStatus: after.state.status, afterTurn: after.state.turn,
          lastMove: after.state.lastMove, stateDigest: createHash('sha256').update(JSON.stringify(after.state)).digest('hex') });
        before = after;
      }
      entry.actions = actions;
      entry.finalState = before.state;
      assert.equal(before.state.status, 'finished', `No natural result after ${actions} actions`);
      assert(!['resign', 'timeout', 'disconnect'].includes(before.state.reason), 'No administrative terminal allowed');
      assert(await page.locator('#match-result-layer').isVisible(), 'Natural terminal result displayed');
      entry.result = { winner: before.state.winner, reason: before.state.reason, drawReason: before.state.drawReason,
        title: await page.locator('#match-result-type').textContent(), message: await page.locator('#match-result-message').textContent() };
      assert(entry.result.title && entry.result.message);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, `match-${entry.index}-result.png`) });
      await page.locator('#match-result-main-menu').click();
      assert(await page.locator('#local-game-button').isVisible(), 'Return to homepage after result');
      entry.passed = true;
    } catch (e) {
      entry.error = e.stack ?? String(e);
      entry.failureSnapshot = await snapshot().catch(() => undefined);
      await page.screenshot({ path: resolve(output, `match-${entry.index}-failed.png`) }).catch(() => {});
    } finally {
      entry.errors = errors; report.errors.push(...errors);
      console.log(JSON.stringify({ index: entry.index, heroes, mutation: entry.mutation, passed: entry.passed, actions: entry.actions, result: entry.result, error: entry.error }));
      await writeFile(resolve(output, 'full-match-review.json'), JSON.stringify(report, null, 2) + '\n');
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  assert(report.matches.every(m => m.passed), 'Full-match browser failures');
} finally {
  await writeFile(resolve(output, 'full-match-review.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close(); await new Promise(done => server.close(done));
}
