import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
const app = await readFile(new URL("../web/app.ts", import.meta.url), "utf8");

test("UI-V4-01 正式对战页只从透明组件拼接，不引用最终整图", () => {
  assert.match(html, /battle-v4-canvas/);
  assert.doesNotMatch(html + css, /gameplay-final-example-v4/);
});

test("UI-V4-02 棋盘上的三十二颗棋子逐颗放置", () => {
  assert.match(app, /for \(let y = 0; y <= 9; y \+= 1\)/);
  assert.match(app, /token\.style\.setProperty\("--ring-url"/);
  assert.doesNotMatch(css, /row-of-pieces|piece-row-image/);
});

test("UI-V4-03 页面按最终 852×1846 母版等比缩放", () => {
  assert.match(css, /aspect-ratio:\s*852\s*\/\s*1846/);
  assert.match(css, /width:\s*min\(100vw, 852px\)/);
});

test("UI-V4-04 必需的 V4 组件均已接入网页资源目录", async () => {
  const required = [
    "../web/assets/gameplay-v4/components/board/board-clean-no-pieces-transparent.png",
    "../web/assets/gameplay-v4/components/controls/avatar-frame.png",
    "../web/assets/gameplay-v4/components/controls/captured-expand-arrow.png",
    "../web/assets/gameplay-v4/components/controls/more-button.png",
    "../web/assets/gameplay-v4/runtime/player-blue-frame.png",
    "../web/assets/gameplay-v4/runtime/player-red-frame.png",
    "../web/assets/gameplay-v4/runtime/board-clean-no-center.png",
    "../web/assets/gameplay-v4/runtime/captured-panel-frame.png",
    "../web/assets/gameplay-v4/runtime/more-button-clean.png",
    "../web/assets/gameplay-v4/runtime/glyphs/red-general.png",
    "../web/assets/gameplay-v4/runtime/glyphs/black-general.png",
    "../web/assets/gameplay-v4/runtime/glyphs/red-pawn.png",
    "../web/assets/gameplay-v4/runtime/glyphs/black-pawn.png",
  ];
  await Promise.all(required.map((path) => access(new URL(path, import.meta.url))));
});

test("UI-V4-05 正式 game-view 已绑定 V4 棋盘和全部功能区", () => {
  for (const id of ["captured-panel", "captured-toggle", "battle-more-button", "battle-action-menu", "red-captures", "black-captures"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("UI-V4-06 运行时棋位使用审核母版的精确交叉点而非平均铺排", () => {
  assert.match(app, /BOARD_X_CENTERS = \[81, 162, 242, 322, 402, 482, 562, 642, 722\]/);
  assert.match(app, /BOARD_Y_CENTERS = \[57, 134, 212, 289, 367, 444, 522, 599, 677, 755\]/);
  assert.doesNotMatch(app, /\(x \/ 8\) \* 100/);
});

test("UI-V4-07 棋子、已吃棋子和终结残影都复用独立墨圈", () => {
  assert.match(app, /RING_ASSETS/);
  assert.equal((app.match(/ringAsset\(stableRingIndex/g) ?? []).length, 4);
  assert.doesNotMatch(app, /piece\.faceDown \? "◇"/);
});

test("UI-V4-08 六十秒显示、已吃棋子展开和三点菜单已接入事件", () => {
  assert.match(app, /battleTurnDeadlineAt = Date\.now\(\) \+ NORMAL_FORMAL_TURN_DURATION_MS/);
  assert.match(app, /capturedToggle\.addEventListener/);
  assert.match(app, /battleMoreButton\.addEventListener/);
  assert.match(app, /v4-skill-trigger/);
});

test("UI-V4-13 畸变揭示显示文字稀有度，顶部入口点击后才展示详情", () => {
  assert.match(html, /id="battle-mutation-button"/);
  assert.match(app, /rarity\.textContent = MUTATION_RARITY_LABELS\[mutationInfo\.rarity\]/);
  assert.match(app, /battle-mutation-button"\)\.addEventListener\("click", showCurrentMutationDetails\)/);
  assert.match(css, /mutation-reveal\[data-rarity="common"\]/);
  assert.match(css, /mutation-reveal\[data-rarity="rare"\]/);
  assert.match(css, /mutation-reveal\[data-rarity="epic"\]/);
  assert.match(css, /mutation-reveal\[data-rarity="legendary"\]/);
  assert.equal((css.match(/@keyframes mutation-ink/g) ?? []).length, 1);
});

test("UI-V4-09 棋子使用审核字形、外圈放大 15% 且不再显示黄色几何框", () => {
  assert.match(app, /runtime\/glyphs\/\$\{color\}-\$\{type\}\.png/);
  assert.match(app, /createPieceGlyph\(piece\.color, piece\.type\)/);
  assert.match(css, /\.v4-board \.piece::before[\s\S]*?inset:\s*-7\.5%/);
  assert.match(css, /v4-selected-ink-ring/);
  assert.match(css, /\.v4-board \.point\.selected::before \{ display: none; \}/);
  assert.match(css, /\.v4-board \.point\.legal-capture \.piece \{ box-shadow: none; \}/);
});

test("UI-V4-10 修复后的棋盘、已吃棋子栏和三点框逐层接入，不覆盖原图", () => {
  assert.match(css, /runtime\/board-clean-no-center\.png/);
  assert.match(css, /runtime\/captured-panel-frame\.png/);
  assert.match(css, /runtime\/more-button-clean\.png/);
  assert.doesNotMatch(css, /background:\s*url\("\.\/assets\/gameplay-v4\/components\/board\/board-clean-no-pieces-transparent\.png"\)/);
});

test("UI-V4-11 已吃棋子、棋盘字形共用居中透明母件", async () => {
  for (const side of ["red", "black"]) {
    for (const piece of ["general", "advisor", "elephant", "horse", "rook", "cannon", "pawn"]) {
      const png = await readFile(new URL(`../web/assets/gameplay-v4/runtime/glyphs/${side}-${piece}.png`, import.meta.url));
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      assert.equal(png.readUInt32BE(16), 180);
      assert.equal(png.readUInt32BE(20), 180);
    }
  }
});

test("UI-V4-12 墨圈一周 4.6 秒，头像名字在方框内部，安卓底部为宣纸底色", async () => {
  assert.match(css, /v4-selected-ink-ring\s+4\.6s linear infinite/);
  assert.match(css, /\.v4-status-name\s*\{[^}]*top:\s*35%/);
  assert.match(css, /#game-view\s*\{[^}]*background:\s*#eee9dd/);
  const theme = await readFile(new URL("../android/app/src/main/res/values/styles.xml", import.meta.url), "utf8");
  assert.match(theme, /android:navigationBarColor">#eee9dd/);
  assert.match(theme, /android:windowLightNavigationBar">true/);
});
