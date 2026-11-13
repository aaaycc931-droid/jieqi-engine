// DOM interaction test, NOT a browser/layout/device test. Optional jsdom 31.0.1
// installed outside the project: npm install --prefix /tmp/hero-pilot-dom jsdom@31.0.1
// HERO_PILOT_JSDOM=/tmp/hero-pilot-dom/node_modules/jsdom/lib/api.js node scripts/hero-pilot/dom-smoke.ts
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { initializeFeatureGameState, initializeFeatureSecret } from "../../src/index.ts";
import { gameState, revealed, secretState } from "../../tests/helpers.ts";

const { JSDOM } = await import(pathToFileURL(process.env.HERO_PILOT_JSDOM ?? "/tmp/hero-pilot-dom/node_modules/jsdom/lib/api.js").href);
const dom = new JSDOM(readFileSync("web/index.html", "utf8"), { url: "http://unit.test/web/?heroPilot=1", pretendToBeVisual: true });
const { window } = dom;
for (const key of ["window", "document", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "HTMLDialogElement", "Option", "location", "localStorage", "CustomEvent", "Element"]) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true });
}
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
window.confirm = () => true;
const temporary = resolve(`web/.hero-pilot-dom-${process.pid}.ts`);
const checks: string[] = [];
const click = (selector: string) => { const e = window.document.querySelector(selector) as HTMLButtonElement; assert(e, selector); assert.equal(e.disabled, false, selector); e.click(); };
const doc = window.document;
const markers = () => Array.from(doc.querySelectorAll(".point.last-from, .point.last-to, .point.last-relay"))
  .map((e: any) => ({ x: Number(e.dataset.x), y: Number(e.dataset.y), from: e.classList.contains("last-from"), to: e.classList.contains("last-to"), relay: e.classList.contains("last-relay"), text: e.querySelector(".relay-marker")?.textContent, label: e.getAttribute("aria-label") }));
try {
  // Production module unchanged. Added hooks expose snapshots and install a named
  // synthetic midgame fixture; all tested actions still use production handlers.
  writeFileSync(temporary, readFileSync("web/app.ts", "utf8") + `\nexport function smokeSnapshot(){ return structuredClone(gameState); }
export function smokeFixture(s,k){
  if(openingTimer) window.clearTimeout(openingTimer); openingTimer=undefined; openingCompletion=undefined; openingActive=false; localPreparationActive=false;
  gameState=s; gameSecret=k; localTraps=k.traps??[]; localHeroes={red:"siheng",black:"warrior"};
  localPrivateViewerSide=s.turn; openingSequence.hidden=true;
  if(flowDialog.open) flowDialog.close(); renderGame();
}
export function smokeMessages(){return structuredClone(localMessages);}
export function smokeClearEvents(){gameState.automaticEvents=[];renderGame();}
export { renderHeroSelection, runTransferredHeroCommand };\n`);
  const app = await import(pathToFileURL(temporary).href);
  dom.reconfigure({ url: "http://unit.test/web/" }); app.renderHeroSelection();
  assert.equal(doc.querySelector('[aria-label="选择司衡"]'), null); checks.push("default pool excludes pilot");
  dom.reconfigure({ url: "http://unit.test/web/?heroPilot=1" });
  click("#local-game-button");
  click('[aria-label="选择司衡"]'); click("#hero-confirm-button"); click("#dialog-action");
  click('[aria-label="选择战士"]'); click("#hero-confirm-button");
  click('[data-choice="rock"]'); click("#rps-confirm-button"); click("#dialog-action");
  click('[data-choice="scissors"]'); click("#rps-confirm-button"); click("#dialog-action");
  assert.equal(app.smokeSnapshot().pieces.length, 32);
  assert.equal(app.smokeSnapshot().featureRules.heroes.red, "siheng");
  checks.push("real selection → RPS → 32-piece engine initialization");
  const state = initializeFeatureGameState(gameState([revealed("a", "red", "rook", 0, 6), revealed("b", "red", "horse", 2, 6), revealed("enemy", "black", "pawn", 8, 4)]), { red: "siheng", black: "warrior" }, "iron_wall", undefined, undefined, true);
  const secret = secretState(); initializeFeatureSecret(state, secret);
  app.smokeFixture(state, secret);
  click('.v4-status-red [data-skill-key="ability:relay_swap"]');
  assert.equal(doc.querySelector('[aria-label="换轨搭档"]').options.length, 1);
  assert.match(doc.querySelector("#dialog-action").textContent, /换轨并结束本手/);
  click("#dialog-action");
  const after = app.smokeSnapshot();
  assert.equal(after.turn, "black"); assert.equal(after.heroRuntime.red.relayUses, 1);
  assert.equal(after.pieces.find(p => p.id === "a").x, 2);
  assert.match(doc.querySelector('.v4-status-red [data-skill-key="ability:relay_swap"]').textContent, /剩余 1\/2/);
  assert.match(doc.querySelector("#dialog-title").textContent, /交给下一位玩家/);
  checks.push("synthetic midgame: actual skill button → pair selector → authority → resource display → handoff");
  const swappedMarkers = markers();
  assert.deepEqual(swappedMarkers.map(p => [p.x, p.y]), [[0, 6], [2, 6]]);
  assert(swappedMarkers.every(p => p.relay && !p.from && !p.to && p.text === "换轨 ↔" && p.label.includes("两枚棋交换位置")));
  assert.equal(after.lastMove.tier, 2); assert.equal(after.lastMove.countsAsFormalTurn, true);
  assert.equal(after.lastMove.relaySwap.length, 2);
  assert.match(app.smokeMessages().at(-1).text, /两枚棋交换位置（1列7行 ↔ 3列7行）/);
  checks.push("actual endpoints (0,6)/(2,6) display explicit two-piece labels; no false origin/ordinary markers");
  app.smokeClearEvents(); assert.deepEqual(markers(), swappedMarkers);
  checks.push("action-bound markers survive transient event clearing");
  click("#dialog-action");
  const duplicateBefore = { state: app.smokeSnapshot(), markers: markers(), messages: app.smokeMessages() };
  app.runTransferredHeroCommand({ kind: "hero_ability", ability: "relay_swap", pieceId: "a", partnerId: "b", actionId: after.lastMove.actionId, expectedRevision: state.revision });
  assert.deepEqual({ state: app.smokeSnapshot(), markers: markers(), messages: app.smokeMessages() }, duplicateBefore);
  checks.push("duplicate command adds no marker, message, cost or handoff");
  click('.point[data-x="8"][data-y="4"]'); click('.point[data-x="8"][data-y="5"]');
  const ordinary = app.smokeSnapshot(); assert.equal(ordinary.turn, "red");
  assert.equal(ordinary.lastMove.relaySwap, undefined);
  assert.deepEqual(markers().map(p => [p.x, p.y, p.from, p.to, p.relay]), [[8, 4, true, false, false], [8, 5, false, true, false]]);
  checks.push("next ordinary move clears swap labels and preserves normal from/to markers");
  click("#dialog-action");
  const failureBefore = { state: app.smokeSnapshot(), markers: markers(), messages: app.smokeMessages() };
  for (const rest of [{ partnerId: "enemy" }, { partnerId: "a" }, { expectedRevision: 9999 }]) {
    app.runTransferredHeroCommand({ kind: "hero_ability", ability: "relay_swap", pieceId: "a", partnerId: "b", actionId: `invalid:${JSON.stringify(rest)}`, expectedRevision: ordinary.revision, ...rest });
    assert.deepEqual({ state: app.smokeSnapshot(), markers: markers(), messages: app.smokeMessages() }, failureBefore);
  }
  checks.push("enemy target, same-piece no-op and stale command keep prior feedback and state unchanged");
  const unavailable = structuredClone(ordinary); unavailable.pieces = unavailable.pieces.filter(p => p.id !== "b");
  app.smokeFixture(unavailable, structuredClone(secret)); const unavailableBefore = app.smokeSnapshot();
  click('.v4-status-red [data-skill-key="ability:relay_swap"]');
  assert.equal(doc.querySelector("#dialog-title").textContent, "换轨暂不可用");
  click("#dialog-action"); assert.deepEqual(app.smokeSnapshot(), unavailableBefore);
  assert.deepEqual(markers(), failureBefore.markers);
  checks.push("no available partner opens explanation without invented success feedback");
  click("#resign-button"); click("#match-detail-confirm");
  assert.equal(app.smokeSnapshot().status, "finished");
  assert.equal(doc.querySelector("#match-result-layer").hidden, false);
  checks.push("actual resignation and result panel");
  const report = { kind: "jsdom_production_module_interaction", checks, passed: checks.length, swapMarkers: swappedMarkers, layout_and_browser_verified: false, fixture_boundary: "Full opening is real UI initialization. Skill and resignation start from explicitly installed synthetic midgame; not a naturally played game. Invalid/duplicate commands call the exported production handler; transient-event reset is a test hook." };
  writeFileSync("review/hero-pilot/DOM_SMOKE.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { unlinkSync(temporary); window.close(); }
