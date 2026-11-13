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
try {
  // Production module unchanged. Added hooks expose snapshots and install a named
  // synthetic midgame fixture; all tested actions still use production handlers.
  writeFileSync(temporary, readFileSync("web/app.ts", "utf8") + `\nexport function smokeSnapshot(){ return structuredClone(gameState); }
export function smokeFixture(s,k){
  if(openingTimer) window.clearTimeout(openingTimer); openingTimer=undefined; openingCompletion=undefined; openingActive=false; localPreparationActive=false;
  gameState=s; gameSecret=k; localHeroes={red:"siheng",black:"warrior"};
  localPrivateViewerSide=s.turn; openingSequence.hidden=true;
  if(flowDialog.open) flowDialog.close(); renderGame();
}
export { renderHeroSelection };\n`);
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
  click("#dialog-action"); click("#resign-button"); click("#match-detail-confirm");
  assert.equal(app.smokeSnapshot().status, "finished");
  assert.equal(doc.querySelector("#match-result-layer").hidden, false);
  checks.push("actual resignation and result panel");
  const report = { kind: "jsdom_production_module_interaction", checks, passed: checks.length, layout_and_browser_verified: false, fixture_boundary: "Full opening is real UI initialization. Skill and resignation start from explicitly installed synthetic midgame; not a naturally played game." };
  writeFileSync("review/hero-pilot/DOM_SMOKE.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { unlinkSync(temporary); window.close(); }
