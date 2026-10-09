import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(root, 'review-results/game-modes');
await mkdir(output, { recursive: true });
// Read-only review observer, appended in this local server response only.
// No fixture loading, secret identities, clock changes or product debug API.
const observer = `globalThis.__modeReview = () => ({
  hasGame: Boolean(gameState), hasSecret: Boolean(gameSecret),
  heroChoices: Object.keys(localHeroChoices).length,
  heroDeadline: heroSelectionDeadlineAt ?? null,
  battleDeadline: battleTurnDeadlineAt ?? null,
  openingActive, bluetoothActive: Boolean(bluetooth)
});`;
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
  browser: browser.version(), cases: [], errors: [],
  limits: ['New modes are real base opening previews; complete hero/mutation matches remain gated pending independent adaptation.', 'This is not new-mode full-match, Bluetooth transport, Android physical-device or competition-rule acceptance.', 'The previous full-match validation queue remains paused.'],
};
const idle = { hasGame: false, hasSecret: false, heroChoices: 0, heroDeadline: null, battleDeadline: null, openingActive: false, bluetoothActive: false };
try {
  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 845 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('requestfailed', request => report.errors.push(request.url()));
    page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(`http://127.0.0.1:${server.address().port}/web/`, { waitUntil: 'networkidle' });
    await page.locator('#settings-menu-button').click();
    assert.equal(await page.locator('#game-mode-setting').inputValue(), 'jieqi');
    for (const mode of ['jieqi', 'half_chaos', 'xiangqi']) {
      const select = page.locator('#game-mode-setting');
      await select.scrollIntoViewIfNeeded();
      const box = await select.boundingBox();
      assert(box && box.width >= 48 && box.height >= 48 && box.x >= 0 && box.x + box.width <= viewport.width, 'Mode control clipped or too small');
      await select.selectOption(mode);
      assert.deepEqual(await page.evaluate(() => globalThis.__modeReview()), idle);
      if (mode !== 'jieqi') assert.match(await page.locator('#game-mode-status').textContent(), /英雄与畸变保留.*独立适配/);
      await page.locator('#game-mode-preview-button').scrollIntoViewIfNeeded();
      const previewButton = await page.locator('#game-mode-preview-button').boundingBox();
      const resetButton = await page.locator('#settings-reset-button').boundingBox();
      assert(previewButton.height >= 48 && previewButton.y + previewButton.height <= resetButton.y, 'Mode preview overlaps reset');
      await page.locator('#game-mode-preview-button').click();
      const table = page.locator('#game-mode-preview-board');
      assert.equal(await table.locator('tr').count(), 10);
      assert.equal(await table.locator('td').count(), 90);
      assert.equal(await table.locator('[data-face-down]').count(), 32);
      assert.equal(await table.locator('[data-face-down="true"]').count(), mode === 'xiangqi' ? 0 : 30);
      assert.equal(await table.locator('[data-face-down="false"]').count(), mode === 'xiangqi' ? 32 : 2);
      assert(await table.locator('[data-face-down="true"]').evaluateAll(cells => cells.every(cell => cell.textContent === '暗' && [...cell.attributes].every(a => ['data-x', 'data-y', 'data-face-down', 'style'].includes(a.name)))));
      if (mode === 'xiangqi') {
        assert.equal(await table.locator('[data-x="0"][data-y="9"]').textContent(), '车');
        assert.equal(await table.locator('[data-x="4"][data-y="0"]').textContent(), '将');
      }
      const tableBox = await table.boundingBox();
      assert(tableBox.x >= 0 && tableBox.x + tableBox.width <= viewport.width, 'Preview board overflows');
      const closeBox = await page.locator('#dialog-action').boundingBox();
      assert(closeBox.y >= 0 && closeBox.y + closeBox.height <= viewport.height, 'Preview close action clipped');
      assert.deepEqual(await page.evaluate(() => globalThis.__modeReview()), idle);
      await page.screenshot({ path: resolve(output, `${mode}-${viewport.width}x${viewport.height}.png`) });
      await page.locator('#dialog-action').click();
      assert(await page.locator('#settings-view').isVisible());
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#settings-menu-button').click();
      assert.equal(await select.inputValue(), mode, 'Mode not persisted');
      if (mode !== 'jieqi') {
        await page.locator('#settings-back-button').click();
        for (const entry of ['local-game-button', 'bluetooth-menu-button']) {
          await page.locator('#' + entry).click();
          assert.match(await page.locator('#dialog-text').textContent(), /英雄与畸变尚待独立适配/);
          assert(await table.isVisible());
          for (const id of ['hero-view', 'rps-view', 'game-view', 'lobby-view']) assert(!(await page.locator('#' + id).isVisible()), `${id} activated prematurely`);
          assert.deepEqual(await page.evaluate(() => globalThis.__modeReview()), idle);
          assert.equal(await page.evaluate(() => window.handleLeziBack()), true);
          assert(!(await page.locator('#flow-dialog').isVisible()));
        }
        await page.locator('#settings-menu-button').click();
      }
      report.cases.push({ viewport, mode, publicBoard: true, coveredCount: mode === 'xiangqi' ? 0 : 30, persistence: true, previewLeavesSessionIdle: true, pendingEntriesGuarded: mode !== 'jieqi', selectorBox: box, previewButtonBox: previewButton });
    }
    await page.locator('#settings-reset-button').click();
    assert.equal(await page.locator('#game-mode-setting').inputValue(), 'jieqi');
    await page.locator('#settings-back-button').click();
    await page.locator('#bluetooth-menu-button').click();
    assert(await page.locator('#lobby-view').isVisible());
    await page.locator('#bluetooth-back-button').click();
    await page.locator('#local-game-button').click();
    await page.locator('#hero-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#hero-grid button').count(), 19);
    assert(!(await page.locator('#game-mode-preview-board').isVisible()), 'Preview leaked into hero selection');
    await page.evaluate(() => localStorage.setItem('lezi-base-game-mode', 'corrupt'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#settings-menu-button').click();
    assert.equal(await page.locator('#game-mode-setting').inputValue(), 'jieqi');
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  throw error;
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  await new Promise(done => server.close(done));
}
console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, appDigest: report.appDigest }));
console.log(JSON.stringify({ evidenceFile: 'review-results/game-modes/report.json', report }));
