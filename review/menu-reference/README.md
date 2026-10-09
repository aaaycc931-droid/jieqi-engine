# 首页原图外观对照与采用记录

2026-10-04 用户审核确认稿、旧首页、还原样稿的对比图后，批准将还原方案接入正式首页；同时明确暂停 APK 生成，继续修改其余非棋盘页面。

历史样稿的浏览器记录：`BROWSER_REVIEW.md`。原图是未重绘的 941×1672 `国风象棋主菜单按钮下移.png`。

正式入口改用 `web/home-menu.css` 和 `web/assets/menu-original/approved-menu.png`。页面保留真实、可访问 HTML 控件与已有处理函数。标题、墨环、装饰与按钮图案保持等比，长屏只扩展空白宣纸带。设置入口单独保留；触控目标至少 48 CSS 像素。

本次批准是首页例外，不改变棋盘或其他页面的素材约束。

```sh
node scripts/build-web.ts
node scripts/review/capture-home-runtime.mjs
```

最后一步要求 Playwright 与 Chromium，输出为正式运行时截图与入口检查。`prepare-menu-review.mjs` 仅复制已采用的运行时，不再注入重复图案。旧 `capture-menu-review.mjs` 仅保留历史样稿脚本，不作为本轮验证入口。

Android WebView、安全区与双机验证仍待后续。用户恢复打包前不生成 APK。
