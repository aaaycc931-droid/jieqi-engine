import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(root, 'review-results/active-match-runtime');
await mkdir(output, { recursive: true });
// Read-only observation in the review server response only. No state loader,
// opponent secret access, RNG/clock override or programmatic action submission.
// Owner-only Wind/replay information mirrors information the acting player owns.
const observer = `
globalThis.__activeMatchReview = {
  snapshot() { return structuredClone({ state: gameState, viewer: localPrivateViewerSide,
    opening: openingActive, preparation: localPreparationActive, trapSide: trapSetupSide,
    draftCount: localTrapDraft.length, selected: selectedPieceId, assassinationArmed, strongStrikeArmed,
    inCheck: gameState ? isGeneralInCheck(gameState, gameState.turn) : false,
    ownWind: localPrivateViewerSide && gameSecret?.wind?.[localPrivateViewerSide],
    ownReplay: localPrivateViewerSide === gameState?.turn ? gameSecret?.replay : undefined }); },
  candidates() {
    if (!gameState || gameState.status !== 'playing') return [];
    return gameState.pieces.flatMap(piece => {
      if (getController(piece) !== gameState.turn || gameSecret?.replay && piece.id !== gameSecret.replay.pieceId) return [];
      if (selectedPieceId && piece.id !== selectedPieceId) return [];
      const using = assassinationArmed || gameState.assassination?.[gameState.turn]?.activePieceId === piece.id;
      const moves = gameState.flowDance ? getFlowDanceMoves(gameState, piece.id) : using ? getLegalAssassinationMoves(gameState, piece.id, strongStrikeArmed) : getLegalMoves(gameState, piece.id);
      return moves.map(to => ({ pieceId: piece.id, from: {x:piece.x,y:piece.y}, to,
        capture: Boolean(pieceAt(gameState, to)), covered: piece.faceDown, assassination: using, strongStrike: strongStrikeArmed }));
    });
  },
  assassinationCandidates(strong = false) {
    return gameState.pieces.filter(p => getController(p) === gameState.turn && !p.faceDown && p.type !== 'general')
      .flatMap(p => getLegalAssassinationMoves(gameState, p.id, strong).map(to => ({pieceId:p.id,from:{x:p.x,y:p.y},to,capture:Boolean(pieceAt(gameState,to))})));
  },
  timelineCandidates() {
    const previous = gameState?.lastMove;
    const p = gameState?.pieces.find(p => p.id === previous?.pieceId);
    if (!previous || previous.tier !== 1 || previous.actingSide === gameState.turn || !p || p.faceDown || pieceAt(gameState, previous.from)) return [];
    const sample = structuredClone(gameState); const moved = sample.pieces.find(q => q.id === p.id);
    moved.x = previous.from.x; moved.y = previous.from.y; sample.turn = getController(moved);
    return getLegalMoves(sample, moved.id, sample.turn, {allowLinkedControl:true});
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
  method: 'Actual homepage, hero selection, locked RPS, original random mutation/deal, hunter preparation and DOM board actions to natural result. Review response exposes public legal candidates and current viewer own Wind/replay information; opponent secrets and history are inaccessible.',
  policy: 'Random public legal action; prefer captures with probability 0.85, otherwise prefer unrepeated moves. Skill choices use public legality or the acting player own own Wind/replay information. Fixed rock versus scissors assigns player one red. Five active-skill scenarios; a capped trial is incomplete and retried from a fresh real setup, at most three trials per scenario.',
  actionCap: 300,
  limits: ['Active-skill randomly dealt local matches are sampled execution evidence, not exhaustive hero/mutation acceptance.', 'Required skill entry/commit is sampled in real matches; this does not certify every legal target or every lifecycle combination.', 'Bluetooth transport, Android WebView, physical two-phone execution and timeout outcomes remain pending.', 'No APK, normative rule, production debug API or artwork change.'],
  matches: [], errors: [],
};
const definitions = [
  {heroes:['wind','hunter'], required:['shadow']},
  {heroes:['devout_zealot','hunter'], required:['invoke','unspeakable']},
  {heroes:['deathwing','warrior'], required:['destruction']},
  {heroes:['nozdormu','prince'], required:['rewind']},
  {heroes:['murozond','rogue'], required:['timeline_twist','assassination']},
];
try {
  const scenarios = definitions;
  const queue = scenarios.map(({heroes,required}, scenario) => ({ heroes, required, scenario: scenario + 1, attempt: 1 }));
  for (const [index, trial] of queue.entries()) {
    const { heroes, required, scenario, attempt } = trial;
    const entry = { index: index + 1, scenario, attempt, heroes, passed: false, incomplete: false, skills: [], required, trace: [] };
    report.matches.push(entry);
    const context = await browser.newContext({ viewport: report.viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => errors.push(r.url()));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    const snapshot = () => page.evaluate(() => globalThis.__activeMatchReview.snapshot());
    const point = p => page.locator(`.point[data-x="${p.x}"][data-y="${p.y}"]`);
    const dialog = async () => {
      assert(await page.locator('#flow-dialog').evaluate(e => e.open), 'Expected actual flow dialog');
      entry.trace.push({ dialog: await page.locator('#dialog-title').textContent() });
      await page.locator('#dialog-action').click();
    };
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/web/`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean(globalThis.__activeMatchReview));
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
      const opening = await snapshot();
      assert.equal(opening.opening,true);
      assert.equal(opening.state.turnStartedAt,undefined,'Formal clock must not run in hero intro');
      entry.clockAtOpening={start:opening.state.turnStartedAt,deadline:opening.state.turnDeadlineAt};
      await page.waitForFunction(() => !globalThis.__activeMatchReview.snapshot().opening, undefined, { timeout: 15_000 });
      let before = await snapshot();
      while (before.preparation) {
        assert.equal(before.state.turnStartedAt,undefined,'Hunter preparation must not consume formal clock');
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
      assert(before.state.turnStartedAt && before.state.turnDeadlineAt>before.state.turnStartedAt,'Clock starts only when ready');
      const visits = new Map(), rejected = new Set();
      const used = ability => entry.skills.filter(x => x.ability === ability && x.committed).length;
      const skillButton = (key, side) => page.locator(`${side === 'red' ? '.v4-status-red' : '.v4-status-blue'} [data-skill-key="${key}"]`);
      const useAbility = async (ability, args = {}) => {
        const prior = await snapshot();
        const open = () => skillButton(`ability:${ability}`, prior.state.turn).click();
        await open();
        assert.equal(await page.locator('#dialog-title').textContent(), '英雄技能');
        if (!entry.skills.some(x => x.ability === ability)) {
          await page.evaluate(() => window.handleLeziBack());
          assert.deepEqual(await snapshot(), prior, 'Cancelling skill is atomic');
          await open();
        }
        if (args.pieceId) await page.getByLabel('技能对象').selectOption(args.pieceId);
        if (args.to) {
          await page.getByLabel('目标列（0–8）').fill(String(args.to.x));
          await page.getByLabel('目标行（0–9）').fill(String(args.to.y));
        }
        await page.locator('#dialog-action').click();
        const after = await snapshot();
        const committed = ability === 'shadow' ? after.ownWind?.uses === (prior.ownWind?.uses ?? 0) + 1 : after.state.revision > prior.state.revision;
        entry.skills.push({ability,side:prior.state.turn,revision:prior.state.revision,afterRevision:after.state.revision,committed,args,clockBefore:{start:prior.state.turnStartedAt,deadline:prior.state.turnDeadlineAt},clockAfter:{start:after.state.turnStartedAt,deadline:after.state.turnDeadlineAt}, rejection:committed ? undefined : await page.locator('.toast').textContent()});
        if (!committed) assert.deepEqual(after, prior, 'Rejected skill rolls back state and owner information');
        if (committed && ['shadow','hourglass','bomb'].includes(ability)) {
          assert.equal(after.state.turnStartedAt,prior.state.turnStartedAt); assert.equal(after.state.turnDeadlineAt,prior.state.turnDeadlineAt);
        }
        if (committed && ability === 'shadow') assert.deepEqual(after.state,prior.state,'Secret skill does not change public state');
        if (committed && ability === 'rewind') {
          assert(after.ownReplay); assert.equal(after.selected,after.ownReplay.pieceId);
          assert(after.state.turnDeadlineAt-after.state.turnStartedAt <= 10_000);
          assert(after.state.turnDeadlineAt-after.state.turnStartedAt > 0);
        }
        return {after,committed};
      };
      const trySkill = async current => {
        const state = current.state, side = state.turn, hero = state.featureRules.heroes[side];
        if (state.flowDance || state.forcedDefense || current.ownReplay) return false;
        let ability, args;
        if (hero === 'wind' && !used('shadow')) ability='shadow';
        if (hero === 'deathwing' && !used('destruction')) ability='destruction';
        if (hero === 'devout_zealot') {
          if ((state.heroRuntime[side]?.invokeCount ?? 0) < 4 && !current.inCheck) ability='invoke';
          else if (state.heroRuntime[side]?.invokeCount === 4 && !used('unspeakable') && state.pieces.some(p=>!p.faceDown && p.color!==side && p.type!=='general')) ability='unspeakable';
        }
        if (hero === 'nozdormu' && !used('rewind') && !current.inCheck && entry.trace.some(x=>x.turn===side && x.pieceId)) ability='rewind';
        if (hero === 'murozond' && !used('timeline_twist')) {
          const moves=await page.evaluate(()=>globalThis.__activeMatchReview.timelineCandidates());
          if(moves.length) {ability='timeline_twist';args={to:moves[randomInt(moves.length)]};}
        }
        if(ability) {
          const attemptKey=`skill:${side}:${state.revision}:${ability}`;
          if(!rejected.has(attemptKey)) {
            const result=await useAbility(ability,args); if(!result.committed) rejected.add(attemptKey);
            return result.committed;
          }
        }
        if(hero==='rogue') {
          const active=state.assassination[side]?.activePieceId;
          if(active) {
            const captures=await page.evaluate(()=>globalThis.__activeMatchReview.assassinationCandidates(true));
            await skillButton(captures.some(m=>m.capture)?'strong-strike':'assassination-hero',side).click();
          } else if(!used('assassination') && state.assassination[side]?.heroChargeAvailable) {
            const legal=await page.evaluate(()=>globalThis.__activeMatchReview.assassinationCandidates(false));
            if(legal.length) await skillButton('assassination-hero',side).click();
          }
        }
        return false;
      };
      let actions = 0;
      while (before.state.status !== 'finished' && actions < report.actionCap) {
        if (before.state.status === 'execution') {
          await page.waitForFunction(() => globalThis.__activeMatchReview.snapshot().state.status !== 'execution', undefined, { timeout: 15_000 });
          before = await snapshot(); continue;
        }
        if (await page.locator('#flow-dialog').evaluate(e => e.open)) {
          assert.equal(before.viewer, undefined, 'Handoff must clear private viewer');
          assert.equal(await page.locator('.own-trap').count(), 0, 'Handoff must hide private traps');
          await dialog(); before = await snapshot();
          assert.equal(before.viewer, before.state.turn);
        }
        assert.equal(before.viewer, before.state.turn, 'Only current player private view remains visible');
        if (await trySkill(before)) {before=await snapshot(); actions++; continue;}
        before=await snapshot();
        const candidates = (await page.evaluate(() => globalThis.__activeMatchReview.candidates())).filter(m=>!rejected.has(`${before.state.revision}:${m.pieceId}:${m.to.x},${m.to.y}`));
        assert(candidates.length > 0, 'Playing state has no legal DOM action');
        const key = m => `${before.state.turn}:${m.pieceId}:${m.from.x},${m.from.y}:${m.to.x},${m.to.y}`;
        const captures = candidates.filter(m => m.capture);
        let pool = captures.length && randomInt(100) < 85 ? captures : candidates;
        const minimum = Math.min(...pool.map(m => visits.get(key(m)) ?? 0));
        pool = pool.filter(m => (visits.get(key(m)) ?? 0) === minimum);
        const action = pool[randomInt(pool.length)];
        visits.set(key(action), (visits.get(key(action)) ?? 0) + 1);
        if(before.selected!==action.pieceId) await point(action.from).click();
        assert.equal((await snapshot()).selected, action.pieceId, 'Source selected by DOM');
        assert(await point(action.to).evaluate(e => e.classList.contains('legal-empty') || e.classList.contains('legal-capture')), 'Public legal marker visible');
        await point(action.to).click();
        const after = await snapshot();
        if(after.state.revision===before.state.revision && before.ownReplay) {
          assert.match(await page.locator('.toast').textContent(), /回溯重走/);
          assert.deepEqual(after.state,before.state); assert.deepEqual(after.ownReplay,before.ownReplay);
          rejected.add(`${before.state.revision}:${action.pieceId}:${action.to.x},${action.to.y}`);
          entry.trace.push({rejectedReplay:action,reason:await page.locator('.toast').textContent()});
          before=after; continue;
        }
        assert(after.state.revision > before.state.revision, `DOM action failed: ${await page.locator('.toast').textContent()}`);
        if(action.assassination) entry.skills.push({ability:action.strongStrike?'strong-strike':'assassination',side:before.state.turn,committed:true,revision:before.state.revision,afterRevision:after.state.revision});
        if(before.ownReplay) assert.equal(after.ownReplay,undefined,'Successful replay clears pending action');
        entry.trace.push({ action: ++actions, turn: before.state.turn, revision: before.state.revision, ...action,
          afterRevision: after.state.revision, afterStatus: after.state.status, afterTurn: after.state.turn,
          lastMove: after.state.lastMove, stateDigest: createHash('sha256').update(JSON.stringify(after.state)).digest('hex') });
        before = after;
      }
      entry.actions = actions;
      entry.finalState = before.state;
      if (before.state.status !== 'finished') {
        entry.incomplete = true;
        entry.incompleteReason = `Observation capped after ${actions} legal actions; no terminal injected. Current rules do not guarantee a finite random match.`;
        await page.screenshot({ path: resolve(output, `match-${entry.index}-incomplete.png`) });
        if (attempt < 3) queue.push({ heroes, required, scenario, attempt: attempt + 1 });
        continue;
      }
      assert(!['resign', 'timeout', 'disconnect'].includes(before.state.reason), 'No administrative terminal allowed');
      assert(await page.locator('#match-result-layer').isVisible(), 'Natural terminal result displayed');
      entry.result = { winner: before.state.winner, reason: before.state.reason, drawReason: before.state.drawReason,
        title: await page.locator('#match-result-type').textContent(), message: await page.locator('#match-result-message').textContent() };
      assert(entry.result.title && entry.result.message);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, `match-${entry.index}-result.png`) });
      await page.locator('#match-result-main-menu').click();
      assert(await page.locator('#local-game-button').isVisible(), 'Return to homepage after result');
      entry.skillCoverageComplete=required.every(ability=>used(ability)>0);
      entry.passed = entry.skillCoverageComplete;
      if(!entry.skillCoverageComplete) {
        entry.incomplete=true; entry.incompleteReason='Natural terminal reached before all requested skill commits; retain this sample and retry actual setup.';
        if(attempt<3) queue.push({heroes,required,scenario,attempt:attempt+1});
      }
    } catch (e) {
      entry.error = e.stack ?? String(e);
      entry.failureSnapshot = await snapshot().catch(() => undefined);
      await page.screenshot({ path: resolve(output, `match-${entry.index}-failed.png`) }).catch(() => {});
    } finally {
      entry.errors = errors; report.errors.push(...errors);
      console.log(JSON.stringify({ index: entry.index, heroes, mutation: entry.mutation, scenario, attempt, passed: entry.passed, incomplete: entry.incomplete, actions: entry.actions, result: entry.result, error: entry.error }));
      await writeFile(resolve(output, 'active-match-review.json'), JSON.stringify(report, null, 2) + '\n');
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  assert(report.matches.every(m => m.passed || m.incomplete), 'Actual full-match browser interaction failure');
  assert(scenarios.every((_, i) => report.matches.some(m => m.scenario === i + 1 && m.passed)), 'Each required active-skill scenario needs committed skills and a natural result; capped or early-terminal trials do not count');
} finally {
  await writeFile(resolve(output, 'active-match-review.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close(); await new Promise(done => server.close(done));
}
