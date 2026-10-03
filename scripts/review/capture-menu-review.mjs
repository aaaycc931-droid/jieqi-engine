import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(root, 'review-results/menu-reference');
await mkdir(output, { recursive: true });
const types = { '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const mode = url.pathname.split('/')[1];
    const base = resolve(root, mode === 'reference' ? 'review-output' : 'dist');
    let path = resolve(base, '.' + decodeURIComponent(url.pathname.replace(/^\/(current|reference)/, '')));
    if (!path.startsWith(base + '/')) throw new Error('Invalid path');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const report = { browser: browser.version(), render: 'Chromium / live application JS', prototypeOnly: true, cases: [], pixelComparison: null };
const cases = [
  { name: '9x16', width: 360, height: 640 },
  { name: '19.5x9', width: 390, height: 845 },
  { name: '20x9', width: 360, height: 800 },
  { name: 'short-320', width: 320, height: 568 },
  { name: 'source-pixels', width: 941, height: 1672 },
];
try {
  for (const viewport of cases) {
    for (const mode of ['current', 'reference']) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const failures = [];
      page.on('pageerror', error => failures.push(error.message));
      page.on('requestfailed', request => failures.push(request.url()));
      const response = await page.goto(`${base}/${mode}/web/`, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      await page.locator('#main-menu-view').waitFor({ state: 'visible' });
      await page.evaluate(async () => {
        await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
        await document.fonts.ready;
      });
      const screenshot = await page.screenshot({ path: resolve(output, `${mode}-${viewport.name}.png`) });
      const ids = ['local-game-button', 'bluetooth-menu-button', 'online-game-button', 'rules-menu-button', 'settings-menu-button'];
      const boxes = {};
      for (const id of ids) {
        const box = await page.locator('#' + id).boundingBox();
        assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, id + ' clipped');
        boxes[id] = box;
      }
      report.cases.push({ mode, viewport, boxes, failures });
      assert.deepEqual(failures, []);
      if (mode === 'reference' && viewport.name === 'source-pixels') {
        report.pixelComparison = await page.evaluate(async ({ screenshot, setting }) => {
          const load = src => new Promise((done, reject) => { const img = new Image(); img.onload = () => done(img); img.onerror = reject; img.src = src; });
          const [original, rendered] = await Promise.all([
            load('../review/menu-reference/approved-menu.png'),
            load('data:image/png;base64,' + screenshot),
          ]);
          const pixels = img => {
            const canvas = document.createElement('canvas'); canvas.width = 941; canvas.height = 1672;
            const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); return ctx.getImageData(0, 0, 941, 1672).data;
          };
          const a = pixels(original), b = pixels(rendered);
          let compared = 0, changed = 0, totalDifference = 0, maximumDifference = 0;
          for (let y = 0; y < 1672; y++) for (let x = 0; x < 941; x++) {
            if (x >= setting.x - 8 && x <= setting.x + setting.width + 8 && y >= setting.y - 8 && y <= setting.y + setting.height + 8) continue;
            let difference = 0;
            for (let channel = 0; channel < 3; channel++) difference += Math.abs(a[(y * 941 + x) * 4 + channel] - b[(y * 941 + x) * 4 + channel]);
            compared++; if (difference) changed++; totalDifference += difference; maximumDifference = Math.max(maximumDifference, difference);
          }
          return { excluded: 'confirmed later-added settings control', comparedPixels: compared, changedPixels: changed, changedFraction: changed / compared, meanChannelDifference: totalDifference / (compared * 3), maximumPixelDifference: maximumDifference };
        }, { screenshot: screenshot.toString('base64'), setting: boxes['settings-menu-button'] });
      }
      if (mode === 'reference' && viewport.name === '20x9') {
        const visible = id => page.locator('#' + id).isVisible();
        // Physical tapping is permitted so the unavailable entry can show its
        // explanation. Playwright's locator.click intentionally refuses any
        // aria-disabled control, so tap its measured screen location instead.
        const online = boxes['online-game-button'];
        await page.touchscreen.tap(online.x + online.width / 2, online.y + online.height / 2);
        await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('联机对战尚未开放'));
        await page.locator('#settings-menu-button').click();
        assert(await visible('settings-view'));
        await page.locator('#reduce-motion-setting').check();
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('#settings-menu-button').click();
        assert(await page.locator('#reduce-motion-setting').isChecked());
        await page.locator('#settings-back-button').click();
        await page.locator('#rules-menu-button').click();
        assert(await visible('rules-view'));
        await page.locator('#rules-back-button').click();
        await page.locator('#bluetooth-menu-button').click();
        assert(await visible('lobby-view'));
        await page.locator('#bluetooth-back-button').click();
        await page.locator('#local-game-button').click();
        assert(await visible('hero-selection-view'));
        report.interactions = { onlineUnavailable: true, settings: true, settingsPersist: true, rules: true, bluetoothLobby: true, localHeroSelection: true };
      }
      await context.close();
    }
  }
  // Compose retrieved browser screenshots in a web page; no art is regenerated.
  const sheets = [
    { file: 'appearance-comparison.png', columns: [
      { title: '确认稿', bytes: await readFile(resolve(root, 'review/menu-reference/approved-menu.png')) },
      { title: '被否决的当前首页', bytes: await readFile(resolve(output, 'current-9x16.png')) },
      { title: '原图外观交互样稿', bytes: await readFile(resolve(output, 'reference-9x16.png')) },
    ] },
    { file: 'screen-adaptation.png', columns: [
      { title: '9:16', bytes: await readFile(resolve(output, 'reference-9x16.png')) },
      { title: '19.5:9', bytes: await readFile(resolve(output, 'reference-19.5x9.png')) },
      { title: '20:9', bytes: await readFile(resolve(output, 'reference-20x9.png')) },
    ] },
  ];
  for (const sheet of sheets) {
    const context = await browser.newContext({ viewport: { width: 1168, height: sheet.file === 'screen-adaptation.png' ? 902 : 742 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><meta charset="UTF-8"><style>body{margin:0;padding:24px;background:#e8e5dd;color:#201b17;font:20px sans-serif}main{display:flex;gap:20px}section{width:360px}h2{font-size:20px;margin:0 0 16px}img{width:360px;height:auto;display:block}</style><main>${sheet.columns.map(column => `<section><h2>${column.title}</h2><img src="data:image/png;base64,${column.bytes.toString('base64')}"></section>`).join('')}</main>`);
    await page.evaluate(async () => { await Promise.all([...document.images].map(img => img.decode())); await document.fonts.ready; });
    await page.screenshot({ path: resolve(output, sheet.file) });
    await context.close();
  }
  await writeFile(resolve(output, 'browser-review.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ browser: report.browser, cases: report.cases.length, interactions: report.interactions, pixelComparison: report.pixelComparison }));
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
