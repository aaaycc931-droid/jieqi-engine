import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/style.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../web/app.ts", import.meta.url), "utf8");

test("UI-HERO-01 英雄选择是猜拳前的独立整页流程", () => {
  assert.ok(html.indexOf('id="hero-view"') < html.indexOf('id="rps-view"'));
  assert.match(html, /id="hero-confirm-button"[^>]*disabled/);
  assert.match(app, /beginLocalHeroSelection\(\)/);
  assert.match(app, /HERO_SELECTION_DURATION_MS/);
});

test("UI-HERO-02 竖屏英雄页按四分之一详情与四分之三六列网格布局", () => {
  assert.match(css, /\.hero-selection-view\s*\{[^}]*grid-template-rows:\s*1fr 3fr/s);
  assert.match(css, /\.hero-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6,/s);
  assert.match(css, /\.hero-grid\s*\{[^}]*overflow:\s*hidden/s);
});

test("UI-HERO-03 入场后才开放带撤回与确定的六十秒战斗准备", () => {
  assert.ok(html.indexOf('id="opening-sequence"') < html.indexOf('id="hero-preparation-panel"'));
  assert.match(html, /id="trap-undo-button"[^>]*>撤回上一步</);
  assert.match(html, /id="preparation-confirm-button"[^>]*>完成准备</);
  assert.match(app, /HERO_PREPARATION_DURATION_MS/);
});
