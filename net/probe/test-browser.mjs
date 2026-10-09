import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createProbeServer } from './server.mjs';
const token = 'local-test-token-000000000000000000';
const probe = createProbeServer({ token, node: 'browser-loopback-test' });
await new Promise(resolve => probe.server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${probe.server.address().port}`);
  await page.locator('#token').fill(token); await page.locator('#region').fill('CI loopback — no mainland location');
  await page.locator('#carrier').selectOption({ label: '其他／未知' }); await page.locator('#vpn').selectOption({ label: '未知' });
  await page.locator('#start').click();
  await page.waitForFunction(() => { try { return JSON.parse(document.getElementById('status').textContent).ws.successes >= 1; } catch { return false; } });
  await page.locator('#reconnect').click();
  await page.waitForFunction(() => { try { const s = JSON.parse(document.getElementById('status').textContent); return s.ws.successes >= 2 && s.connections >= 2; } catch { return false; } }, { timeout: 20000 });
  await page.locator('#restore').click(); await page.locator('#stop').click();
  await page.locator('#download').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.getElementById('download').disabled);
  const downloading = page.waitForEvent('download'); await page.locator('#download').click(); const download = await downloading;
  const raw = await readFile(await download.path(), 'utf8'), report = JSON.parse(raw);
  assert.ok(report.summary.http.successes >= 1); assert.ok(report.summary.ws.successes >= 2);
  assert.equal(report.summary.unexpectedDisconnects, 0); assert.equal(report.stoppedByTester, true);
  assert.ok(report.events.some(e => e.kind === 'planned_close'));
  assert.ok(report.events.some(e => e.kind === 'network_restored_by_tester'));
  assert.ok(report.connections.every(c => c.closedElapsedMs <= report.actualDurationMs));
  assert.equal(raw.includes(token), false); assert.equal(await page.locator('#token').inputValue(), '');
  assert.deepEqual(errors, []);
  const out = new URL('../../review/net/', import.meta.url); await mkdir(out, { recursive: true });
  const sourcePaths = [];
  async function walk(url, prefix = 'net/probe') {
    for (const entry of await readdir(url, { withFileTypes: true })) {
      if (['node_modules', '.wrangler', '.worker-build', 'results'].includes(entry.name)) continue;
      const path = `${prefix}/${entry.name}`, child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
      if (entry.isDirectory()) await walk(child, path);
      else if (/\.(mjs|json|jsonc|html)$/.test(entry.name)) sourcePaths.push({ path, url: child });
    }
  }
  await walk(new URL('./', import.meta.url));
  const digest = createHash('sha256');
  for (const file of sourcePaths.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    digest.update(file.path + '\0'); digest.update(await readFile(file.url)); digest.update('\0');
  }
  const evidence = { checkedAt: new Date().toISOString(), scope: 'actual_probe_page_DOM_on_CI_loopback_not_mainland_or_WeChat', sourceDigest: digest.digest('hex'), errors, report };
  await writeFile(new URL('BROWSER_REPORT.json', out), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: new URL('BROWSER_PAGE.png', out).pathname, fullPage: true });
  console.log('Probe DOM: start, real HTTP/WS, planned reconnect, restore marker, stop and token-free JSON download passed.');
  console.log(JSON.stringify({ evidenceFile: 'review/net/BROWSER_REPORT.json', content: evidence }));
} finally { await browser?.close(); await probe.close(); }
