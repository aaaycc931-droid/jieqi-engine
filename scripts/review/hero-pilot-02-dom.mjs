import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { SourceTextModule } from 'node:vm';
import { initializeFeatureGameState } from '../../src/game.ts';
import { gameState, revealed, secretState } from '../../tests/helpers.ts';

// Optional reviewer dependency only: npm install --prefix /tmp/lezi-dom --no-save --ignore-scripts jsdom@26.1.0
// JSDOM_MODULE=/tmp/lezi-dom/node_modules/jsdom/lib/api.js node --experimental-vm-modules scripts/review/hero-pilot-02-dom.mjs
// This is a DOM execution check, not browser rendering, touch testing, or human playtesting.
const { JSDOM, VirtualConsole } = await import(process.env.JSDOM_MODULE ? pathToFileURL(process.env.JSDOM_MODULE).href : 'jsdom');
const root = resolve(import.meta.dirname, '../..');
const report = {
  authority: 'prepared_dom_execution_non_normative',
  runtime: 'jsdom 26.1.0 / Node VM modules',
  node: process.version,
  sourceCommitAtRun: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTreeDirty: true,
  sourceHashes: {},
  cases: [], errors: [], passed: false,
  limits: [
    'Actual built web/app.js and its module graph execute against a simulated DOM; fixtures are appended in memory only.',
    'No browser layout, CSS pixel rendering, native touch, image decoding, physical device, Bluetooth or online acceptance.',
    'Chromium was blocked by socket EPERM; the separate cloud browser could not reach the local server.',
    'Prepared positions are interface checks, not human playtesting or a balance proof.',
  ],
};
for (const path of ['web/app.ts', 'web/hero-pilot-02.ts', 'web/hero-pilot-02.css', 'src/hero-cen-ying.ts', 'src/hero-actions.ts', 'dist/web/app.js', 'scripts/review/hero-pilot-02-dom.mjs']) {
  report.sourceHashes[path] = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
}
const fixture = `
export const __pilot2Review = {
  load(s,k) {
    resetMatch();
    gameState=structuredClone(s);gameSecret=structuredClone(k);
    localHeroes=gameState.featureRules.heroes;localTraps=gameSecret.traps??[];
    localPrivateViewerSide=gameState.turn;rpsPublic.assignments={red:PLAYER_ONE,black:PLAYER_TWO};
    openingActive=false;localPreparationActive=false;trapSetupSide=undefined;
    selectedPieceId=undefined;assassinationArmed=false;strongStrikeArmed=false;
    heroView.hidden=true;rpsView.hidden=true;mainMenuView.hidden=true;gameView.hidden=false;
    disconnectLayer.hidden=true;matchResultLayer.hidden=true;flowDialog.close();
    startFormalClock(gameState,Date.now(),gameSecret);renderGame();
  },
  read:()=>structuredClone({state:gameState,secret:gameSecret,messages:localMessages,viewer:localPrivateViewerSide}),
  run:runTransferredHeroCommand,
  open:openCenYingPull,
  advanceRevision:()=>{gameState.revision+=1;},
  arm:()=>{assassinationArmed=true;strongStrikeArmed=true;},
  armed:()=>({assassinationArmed,strongStrikeArmed}),
  selectMode:(mode)=>{selectedGameMode=mode;renderHeroSelection();},
};
`;
const instances = [];
async function app(search) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.stack ?? String(e)));
  const dom = new JSDOM(await readFile(resolve(root, 'dist/web/index.html'), 'utf8'), {
    url: `http://localhost/web/${search}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
  });
  instances.push(dom);
  const w = dom.window;
  w.structuredClone = structuredClone;
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const context = dom.getInternalVMContext(), modules = new Map();
  async function moduleAt(id) {
    if (modules.has(id)) return modules.get(id);
    const path = fileURLToPath(id);
    if (!path.startsWith(resolve(root, 'dist') + '/')) throw new Error(`Module escaped build: ${id}`);
    const source = await readFile(path, 'utf8');
    const module = new SourceTextModule(source + (path === resolve(root, 'dist/web/app.js') ? fixture : ''), {
      context, identifier: id, initializeImportMeta(meta) { meta.url = id; },
    });
    modules.set(id, module); return module;
  }
  const entry = await moduleAt(pathToFileURL(resolve(root, 'dist/web/app.js')).href);
  await entry.link((specifier, referencing) => moduleAt(new URL(specifier, referencing.identifier).href));
  await entry.evaluate();
  const helpers = modules.get(pathToFileURL(resolve(root, 'dist/web/hero-pilot-02.js')).href).namespace;
  return { dom, w, d: w.document, api: entry.namespace.__pilot2Review, helpers, errors };
}
const plain = x => JSON.parse(JSON.stringify(x));
const click = (a, selector) => { const e = a.d.querySelector(selector); assert(e, `Missing ${selector}`); assert(!e.disabled, `Disabled ${selector}`); e.click(); };
const pair = (side = 'red', extras = [], mutation) => {
  const other = side === 'red' ? 'black' : 'red';
  return {
    state: initializeFeatureGameState(gameState([
      revealed('anchor', side, 'pawn', side === 'red' ? 0 : 8, side === 'red' ? 6 : 3),
      revealed('target', other, 'horse', side === 'red' ? 0 : 8, side === 'red' ? 3 : 6), ...extras,
    ], { turn: side }), { [side]: 'cen_ying', [other]: 'hunter' }, mutation),
    secret: secretState(),
  };
};
const mount = (a, p) => a.api.load(p.state, p.secret);
const snapshot = a => plain(a.api.read());
function check(name, fn) { fn(); report.cases.push({ name, passed: true }); }
try {
  const regular = await app('');
  click(regular, '#local-game-button');
  check('Default selection stays at 19 heroes and loads no trial stylesheet', () => {
    assert.equal(regular.d.querySelectorAll('#hero-grid button').length, 19);
    assert.equal(regular.d.querySelector('[aria-label="选择岑缨"]'), null);
    assert(![...regular.d.querySelectorAll('link')].some(e => e.href.includes('hero-pilot-02.css')));
  });
  const a = await app('?heroPilot2=1');
  click(a, '#local-game-button');
  check('Opt-in offline selection exposes the twentieth hero, portrait and detail figure', () => {
    assert.equal(a.d.querySelectorAll('#hero-grid button').length, 20);
    click(a, '[aria-label="选择岑缨"]');
    assert(a.d.querySelector('.hero-detail-avatar [data-hero-pilot2-art="figure"]') || a.d.querySelector('[data-hero="cen_ying"] [data-hero-pilot2-art="figure"]'));
    assert(a.d.querySelector('#hero-grid [data-hero="cen_ying"] img').srcset.includes('2x'));
    assert(a.d.querySelector('#hero-skill-description').textContent.includes('2'));
  });
  check('Changing hero clears the figure and failed-image fallback', () => {
    const figure = a.d.querySelector('[data-hero-pilot2-art="figure"]');
    const parent = figure.parentElement; figure.dispatchEvent(new a.w.Event('error'));
    assert.equal(parent.dataset.artFallback, '岑缨');
    a.d.querySelector('#hero-grid button:not(.selected)').click();
    assert.equal(parent.querySelector('img'), null); assert.equal(parent.dataset.artFallback, undefined);
  });
  check('Non-jieqi modes and remote hero pools do not gain the trial hero', () => {
    a.api.selectMode('xiangqi'); assert.equal(a.d.querySelectorAll('#hero-grid button').length, 19);
    a.api.selectMode('jieqi'); assert.equal(a.d.querySelectorAll('#hero-grid button').length, 20);
    assert.deepEqual(plain(a.helpers.pilot2HeroPool(['hunter'], true, true, 'jieqi')), ['hunter']);
    assert.equal(a.helpers.heroPilot2Enabled('?heroPilot2=0'), false);
  });
  mount(a, pair());
  check('Runtime control opens a public 90-cell preview with real coordinates and explicit turn cost', () => {
    click(a, '[data-skill-key="ability:tether_pull"]');
    assert(a.d.querySelector('#flow-dialog').open);
    assert.equal(a.d.querySelectorAll('.cen-ying-preview-board > span').length, 90);
    assert.equal(a.d.querySelector('select[aria-label="引缆的己方锚点"]').value, 'anchor');
    assert.match(a.d.querySelector('.cen-ying-pull-preview').textContent, /1路4行 → 1路5行/);
    assert.match(a.d.querySelector('#dialog-action').textContent, /消耗本回合/);
  });
  check('Cancellation leaves the board, turn, charge and secret state unchanged', () => {
    const before = snapshot(a); click(a, '[aria-label="取消引缆"]');
    assert.deepEqual(snapshot(a), before); assert.equal(a.d.querySelector('#flow-dialog').open, false);
  });
  check('Actual confirmation commits the pull, correct markers, public charge and private handoff', () => {
    a.api.arm(); click(a, '[data-skill-key="ability:tether_pull"]'); click(a, '#dialog-action');
    const after = snapshot(a); assert.equal(after.state.revision, 1); assert.equal(after.state.turn, 'black');
    assert.equal(after.state.pieces.find(p => p.id === 'target').y, 4);
    assert.equal(after.state.heroRuntime.red.tetherPullUses, 1);
    assert(a.d.querySelector('.point.last-from[data-x="0"][data-y="3"]'));
    assert(a.d.querySelector('.point.last-to[data-x="0"][data-y="4"]'));
    assert.equal(a.d.querySelector('.point.last-from[data-x="0"][data-y="0"]'), null);
    assert.match(a.d.querySelector('[data-skill-key="ability:tether_pull"]').textContent, /剩余 1\/2/);
    assert.equal(after.viewer, undefined); assert.match(a.d.querySelector('#dialog-title').textContent, /交给下一位/);
    assert.deepEqual(plain(a.api.armed()), { assassinationArmed: false, strongStrikeArmed: false });
    assert.equal(after.messages.filter(m => m.text?.includes('岑缨发动引缆')).length, 1);
  });
  check('Repeated submission after handoff cannot spend another charge or announce another success', () => {
    click(a, '#dialog-action'); const before = snapshot(a), last = before.state.lastMove;
    a.api.run({ kind: 'hero_ability', ability: 'tether_pull', anchorPieceId: 'anchor', pieceId: 'target', actionId: last.actionId, expectedRevision: 0 });
    assert.deepEqual(snapshot(a), before); assert.match(a.d.querySelector('#toast').textContent, /已经处理/);
  });
  check('Opponent can make a normal board move after a successful pull and equipment handoff', () => {
    click(a, '.point[data-x="5"][data-y="0"]'); click(a, '.point[data-x="4"][data-y="0"]');
    const after = snapshot(a); assert.equal(after.state.revision, 2); assert.equal(after.state.turn, 'red');
    assert.equal(after.state.pieces.find(p => p.id === 'black-general').x, 4);
  });
  check('Black-side UI mirror commits the same one-square displacement and two-use resource', () => {
    mount(a, pair('black')); click(a, '[data-skill-key="ability:tether_pull"]'); click(a, '#dialog-action');
    const after = snapshot(a); assert.equal(after.state.turn, 'red'); assert.equal(after.state.heroRuntime.black.tetherPullUses, 1);
    assert.equal(after.state.pieces.find(p => p.id === 'target').y, 5);
    assert(a.d.querySelector('.point.last-from[data-x="8"][data-y="6"]'));
    assert(a.d.querySelector('.point.last-to[data-x="8"][data-y="5"]'));
  });
  check('A stale open picker is rejected atomically without success messages or charge consumption', () => {
    mount(a, pair()); click(a, '[data-skill-key="ability:tether_pull"]'); a.api.advanceRevision();
    const before = snapshot(a); click(a, '#dialog-action');
    assert.deepEqual(snapshot(a), before); assert.equal(before.state.heroRuntime.red.tetherPullUses ?? 0, 0);
  });
  check('Blocked geometry shows an explanation and offers no actionable target picker', () => {
    mount(a, pair('red', [revealed('blocker', 'black', 'pawn', 0, 5)]));
    // The blocker is adjacent to the anchor, and the original target is screened.
    const before = snapshot(a); a.api.open();
    assert.match(a.d.querySelector('#dialog-text').textContent, /没有合法引缆/);
    assert.equal(a.d.querySelector('.cen-ying-picker'), null); click(a, '#dialog-action');
    assert.deepEqual(snapshot(a), before);
  });
  check('Exhaustion is explained and never creates a third activation', () => {
    const p = pair(); p.state.heroRuntime.red.tetherPullUses = 2; mount(a, p);
    const before = snapshot(a); a.api.open(); assert.match(a.d.querySelector('#dialog-text').textContent, /两次引缆已用完/);
    click(a, '#dialog-action'); assert.deepEqual(snapshot(a), before);
  });
  check('Multiple public anchors and targets update the derived preview instead of accepting coordinates', () => {
    const p = pair('red', [revealed('anchor-two', 'red', 'rook', 2, 6), revealed('target-two', 'black', 'pawn', 2, 3)]);
    mount(a, p); a.api.open(); const select = a.d.querySelector('select[aria-label="引缆的己方锚点"]');
    select.value = 'anchor-two'; select.dispatchEvent(new a.w.Event('change'));
    assert.equal(a.d.querySelector('select[aria-label="引缆的敌方目标"]').value, 'target-two');
    assert.match(a.d.querySelector('.cen-ying-pull-preview').textContent, /3路4行 → 3路5行/);
    assert.equal(a.d.querySelectorAll('.cen-ying-picker input').length, 0);
    click(a, '[aria-label="取消引缆"]');
  });
  check('Picker output is independent of secret identities and traps', () => {
    const p = pair(); mount(a, p); a.api.open(); const first = a.d.querySelector('.cen-ying-picker').outerHTML;
    p.secret.identities.hidden = { color: 'black', type: 'rook' };
    p.secret.traps = [{ id: 'private', owner: 'red', position: { x: 0, y: 4 }, opponentTurnsRemaining: 2 }];
    mount(a, p); a.api.open(); assert.equal(a.d.querySelector('.cen-ying-picker').outerHTML, first);
    assert(!first.includes('private')); click(a, '[aria-label="取消引缆"]');
  });
  report.errors.push(...regular.errors, ...a.errors); assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error); process.exitCode = 1;
} finally {
  for (const dom of instances) dom.window.close();
  await mkdir(resolve(root, 'review/hero-pilot-02'), { recursive: true });
  await writeFile(resolve(root, 'review/hero-pilot-02/dom-results.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, errors: report.errors, failure: report.failure }, null, 2));
