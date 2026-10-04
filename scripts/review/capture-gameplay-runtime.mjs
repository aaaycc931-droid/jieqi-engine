import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { applyAuthoritativeMove, initializeFeatureGameState, initializeFeatureSecret, destroyPiece, markRevealed } from '../../src/index.ts';
import { gameState, revealed, secretState, move } from '../../tests/helpers.ts';

const root = resolve(import.meta.dirname, '../..');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(root, 'review-results/gameplay-runtime');
await mkdir(output, { recursive: true });
// Fixture access exists ONLY in this local review server's response. Neither
// web/app.ts, dist, Android assets nor a deployed application gains a debug API.
// Interactions then use the actual application's buttons, dialog and board.
const fixtureAccess = `
globalThis.__gameplayReview = {
  load(state, secret) {
    resetMatch(); bluetooth = undefined;
    gameState = structuredClone(state); gameSecret = structuredClone(secret);
    rpsPublic = { assignments: { red: '红方测试', black: '蓝方测试' } };
    localHeroes = gameState.featureRules.heroes;
    localTraps = gameSecret.traps ?? []; localPrivateViewerSide = gameState.turn;
    selectedPieceId = undefined; gameView.hidden = false;
    renderGame(); updateBattleTurnTimer();
  },
  snapshot() { return structuredClone({ state: gameState, secret: gameSecret, viewer: localPrivateViewerSide }); }
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
    if (path === resolve(base, 'web/app.js')) bytes = Buffer.concat([bytes, Buffer.from(fixtureAccess)]);
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
  fixtureMethod: 'Review-only response suffix supplies prepared authoritative states; all tested actions use original application DOM handlers.',
  limits: ['These prepared-state interactions do not certify a full random match or every hero combination.', 'Local handoff visibility is tested; Bluetooth private-message transport and physical devices remain pending.', 'Local timer display is tested; formal network timeout/late-command/idempotency have separate engine tests. Local timeout outcome is unconfirmed.', 'No APK, deployment, UI artwork change or normative rule change.'],
  cases: [], errors: [],
};
const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('pageerror', e => report.errors.push(e.message));
page.on('requestfailed', r => report.errors.push(r.url()));
page.on('response', r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
const snapshot = () => page.evaluate(() => globalThis.__gameplayReview.snapshot());
const point = (x, y) => page.locator(`.point[data-x="${x}"][data-y="${y}"]`);
const skill = (ability, side = 'red') => page.locator(`${side === 'red' ? '.v4-status-red' : '.v4-status-blue'} [data-skill-key="ability:${ability}"]`);
const load = async (state, secret = secretState()) => {
  initializeFeatureSecret(state, secret, () => 0);
  const now = Date.now(); state.turnStartedAt ??= now; state.turnDeadlineAt ??= now + 60_000;
  await page.evaluate(({ state, secret }) => globalThis.__gameplayReview.load(state, secret), { state, secret });
};
const run = async (name, action) => {
  try {
    await action(); assert.deepEqual(report.errors, []);
    await page.screenshot({ path: resolve(output, `${name}.png`) });
    report.cases.push({ name, passed: true });
  } catch (e) {
    report.cases.push({ name, passed: false, error: e.stack ?? String(e) });
    await page.screenshot({ path: resolve(output, `${name}-failed.png`) }).catch(() => {});
    throw e;
  }
};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/web/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(globalThis.__gameplayReview));
  await run('invoke-cancel-confirm-handoff', async () => {
    await load(initializeFeatureGameState(gameState(), { red: 'devout_zealot', black: 'hunter' }));
    const before = await snapshot();
    await skill('invoke').click();
    assert.equal(await page.locator('#dialog-title').textContent(), '英雄技能');
    await page.evaluate(() => window.handleLeziBack());
    assert.deepEqual(await snapshot(), before);
    await skill('invoke').click(); await page.locator('#dialog-action').click();
    const after = await snapshot();
    assert.equal(after.state.heroRuntime.red.invokeCount, 1);
    assert.equal(after.state.formalTurns.red, 1); assert.equal(after.state.turn, 'black');
    assert.equal(await page.locator('#dialog-title').textContent(), '请交给下一位玩家');
    assert.equal(after.viewer, undefined);
    await page.locator('#dialog-action').click(); assert.equal((await snapshot()).viewer, 'black');
  });
  await run('timeline-invalid-rollback-then-control', async () => {
    const s = initializeFeatureGameState(gameState([revealed('mover', 'red', 'rook', 0, 7)]), { red: 'hunter', black: 'murozond' });
    const h = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }, 'first'));
    await load(h.state, h.secret); const before = await snapshot();
    await skill('timeline_twist', 'black').click();
    await page.getByLabel('目标列（0–8）').fill('1'); await page.getByLabel('目标行（0–9）').fill('8');
    await page.locator('#dialog-action').click();
    assert.deepEqual(await snapshot(), before);
    assert.match(await page.locator('.toast').textContent(), /重走/);
    await skill('timeline_twist', 'black').click();
    await page.getByLabel('目标列（0–8）').fill('0'); await page.getByLabel('目标行（0–9）').fill('8');
    await page.locator('#dialog-action').click();
    const after = await snapshot(); assert.equal(after.state.pieces.find(p => p.id === 'mover').y, 8);
    assert.equal(after.state.heroRuntime.black.used, true); assert.equal(after.state.lastMove.tier, 3);
    await page.locator('#dialog-action').click();
  });
  await run('rewind-three-second-display-and-same-piece', async () => {
    const now = Date.now();
    const s = initializeFeatureGameState(gameState([revealed('mover', 'red', 'rook', 0, 7), revealed('reply', 'black', 'pawn', 2, 3)]), { red: 'nozdormu', black: 'hunter' });
    s.turnStartedAt = now - 60_000; s.turnDeadlineAt = now;
    const first = applyAuthoritativeMove(s, secretState(), move({ x: 0, y: 7 }, { x: 0, y: 6 }, 'first'), false, now - 3_000);
    const h = applyAuthoritativeMove(first.state, first.secret, move({ x: 2, y: 3 }, { x: 2, y: 4 }, 'reply', first.state.revision), false, now);
    h.state.turnStartedAt = now; h.state.turnDeadlineAt = now + 60_000;
    await load(h.state, h.secret); await skill('rewind').click(); await page.locator('#dialog-action').click();
    const replay = await snapshot();
    assert.equal(replay.secret.replay.pieceId, 'mover'); assert.equal(replay.secret.rewindUsed.red, true);
    assert.equal(replay.state.turnDeadlineAt - replay.state.turnStartedAt, 3_000);
    await page.waitForFunction(() => Number(document.querySelector('#battle-turn-timer').textContent) <= 3);
    assert(Number(await page.locator('#battle-turn-timer').textContent()) >= 1);
    await point(0, 8).click();
    const after = await snapshot(); assert.equal(after.secret.replay, undefined);
    assert.equal(after.state.pieces.find(p => p.id === 'mover').y, 8);
    await page.locator('#dialog-action').click();
  });
  await run('destiny-bomb-and-hourglass-revival', async () => {
    const s = initializeFeatureGameState(gameState([revealed('warrior', 'red', 'pawn', 0, 6), revealed('dragon', 'black', 'pawn', 2, 3)]), { red: 'nozdormu', black: 'murozond' }, 'end_time');
    const k = secretState(); initializeFeatureSecret(s, k); markRevealed(s, k, 'warrior'); markRevealed(s, k, 'dragon');
    destroyPiece(s, k, 'warrior', 'black', 'test_fixture'); s.turn = 'black';
    await load(s, k); await skill('bomb', 'black').click();
    await page.getByLabel('技能对象').selectOption('dragon');
    await page.getByLabel('目标列（0–8）').fill('1'); await page.getByLabel('目标行（0–9）').fill('3');
    await page.locator('#dialog-action').click();
    const bomb = await snapshot(); assert.deepEqual(bomb.state.warps, [{ x: 1, y: 3 }]);
    assert.equal(bomb.state.effectsByPieceId.dragon.ammunition, 0); assert.equal(bomb.state.turn, 'black');
    await point(2, 3).click(); await point(2, 4).click(); await page.locator('#dialog-action').click();
    await skill('hourglass').click(); await page.locator('#dialog-action').click();
    const returned = await snapshot(); assert.equal(returned.state.hourglasses, 4);
    assert.equal(returned.state.pieces.find(p => p.id === 'warrior').y, 6);
    assert.deepEqual(returned.state.warps, []); assert.equal(returned.state.effectsByPieceId.dragon.ammunition, 1);
    assert.equal(returned.state.turn, 'red');
  });
  await run('wind-secret-shadow-and-private-trap-handoff', async () => {
    const s = initializeFeatureGameState(gameState([revealed('host', 'red', 'rook', 0, 7), revealed('reply', 'black', 'pawn', 2, 3)]), { red: 'wind', black: 'hunter' });
    const k = secretState(); k.traps = [{ id: 'red-private', owner: 'red', position: { x: 1, y: 7 }, opponentTurnsRemaining: 6 }, { id: 'black-private', owner: 'black', position: { x: 1, y: 2 }, opponentTurnsRemaining: 6 }];
    await load(s, k); const before = await snapshot();
    assert.equal(await page.locator('.own-trap[data-x="1"][data-y="7"]').count(), 1);
    await skill('shadow').click(); await page.getByLabel('技能对象').selectOption('host'); await page.locator('#dialog-action').click();
    const shadow = await snapshot(); assert.deepEqual(shadow.state, before.state);
    assert.equal(shadow.secret.wind.red.hostId, 'host'); assert.equal(shadow.secret.wind.red.uses, 1);
    await point(0, 7).click(); await point(0, 6).click();
    assert.equal(await page.locator('#dialog-title').textContent(), '请交给下一位玩家');
    assert.equal(await page.locator('.own-trap').count(), 0);
    await page.locator('#dialog-action').click();
    assert.equal(await page.locator('.own-trap[data-x="1"][data-y="2"]').count(), 1);
    assert.equal(await page.locator('.own-trap[data-x="1"][data-y="7"]').count(), 0);
    await point(2, 3).click(); await point(2, 4).click();
    assert.equal(await page.locator('.own-trap').count(), 0);
    await page.locator('#dialog-action').click();
    assert.equal(await page.locator('.own-trap[data-x="1"][data-y="7"]').count(), 1);
    assert.equal(await page.locator('.own-trap[data-x="1"][data-y="2"]').count(), 0);
  });
  await run('deathwing-skill-settles-locked-targets', async () => {
    await load(initializeFeatureGameState(gameState([revealed('victim', 'black', 'pawn', 2, 3), revealed('friend', 'red', 'pawn', 0, 6)]), { red: 'deathwing', black: 'hunter' }));
    await page.evaluate(() => { Math.random = () => 0; });
    await skill('destruction').click(); await page.locator('#dialog-action').click();
    const r = await snapshot(); assert.equal(r.state.heroRuntime.red.used, true);
    assert.equal(r.state.captured.filter(p => p.cause === 'destruction').length, 2);
    assert.equal(r.state.pieces.filter(p => p.type === 'general').length, 2);
    assert.equal(r.state.formalTurns.red, 1); await page.locator('#dialog-action').click();
  });
  assert.equal(report.cases.length, 6); assert.deepEqual(report.errors, []);
} finally {
  await writeFile(resolve(output, 'browser-review.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cases: report.cases, errors: report.errors }));
  await context.close(); await browser.close(); await new Promise(done => server.close(done));
}
