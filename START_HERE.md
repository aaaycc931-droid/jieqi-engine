# START HERE — 乐子象棋（2026-10-04 首页接入）

## 当前任务

用户已同意原图外观方案接入正式首页，明确要求暂不生成 APK，继续修改其余非棋盘页面。首页使用 `web/home-menu.css` 与未重绘的 `web/assets/menu-original/approved-menu.png`，真实入口保持接通。保留 V4 棋盘。不要重新请求已获得的首页采用授权。

## 先读

1. `PROJECT_STATE.json`
2. `UI_SOURCE_OF_TRUTH.md`
3. `CONFIRMED_UI_PLAN.md`
4. `PENDING_AND_RESUME.md`
5. `review/menu-reference/BROWSER_REVIEW.md`（历史样稿验证）

## 验证与构建边界

- 本地测试 201 passed / 0 failed；Web 构建完成，Android 内置网页资源已同步，未生成 APK。
- 正式首页的浏览器检查脚本：`scripts/review/capture-home-runtime.mjs`。
- `.github/workflows/verify.yml` 的自动 APK job 已暂停，只有用户明确恢复后才允许手动选择 `build_apk: true`。
- 2026-10-01 与 2026-10-02 APK 外观被否决，不代表当前源码，也不作为视觉依据。
- Android WebView 真机视觉、安全区和实体双机行为尚未验证。
- 分支 `codex/ui-android-apk-20261001`；草稿 PR #2 未合并。无授权不合并 `main`。
