// Requires a local Playwright installation and an environment that can launch
// Chromium. Run the repository's build-web.ts first. This is not Android/radio QA.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(root, 'review/main-browser-boundary/BROWSER_SMOKE_RUNTIME.json');
const dist = resolve(root, 'dist');
const report = { status: 'NOT_RUN', scope: 'actual unmodified built Web entry; module boot and Bluetooth menu navigation only',
  browser: null, pageErrors: [], requestFailures: [], missingAssets: [], assertions: [], error: null };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const path = resolve(dist, '.' + pathname);
  if (!path.startsWith(dist + sep)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(path);
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
      '.png': 'image/png', '.webp': 'image/webp' }[extname(path)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
let browser;
try {
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || '/usr/bin/chromium', headless: true });
  report.browser = browser.version();
  const page = await browser.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('requestfailed', request => report.requestFailures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
  page.on('response', response => {
    if (response.status() === 404 && response.url().includes('/assets/')) report.missingAssets.push(new URL(response.url()).pathname);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/web/index.html`, { waitUntil: 'load' });
  assert.equal(await page.evaluate(() => typeof window.handleLeziBack), 'function');
  report.assertions.push('actual app module evaluated through its final back handler');
  await page.locator('#bluetooth-menu-button').click();
  assert.equal(await page.locator('#bluetooth-host-button').isVisible(), true);
  report.assertions.push('actual Bluetooth menu click opened host/join navigation');
  assert.deepEqual(report.pageErrors, []);
  assert.equal(report.requestFailures.filter(x => /\.js$/.test(x.path)).length, 0);
  report.assertions.push('no page errors or failed JavaScript module requests');
  report.status = 'PASS_BOUNDED_ENTRY_ONLY';
} catch (error) {
  report.status = browser ? 'FAIL' : 'BLOCKED_BROWSER_LAUNCH';
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
  await mkdir(resolve(root, 'review/main-browser-boundary'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
