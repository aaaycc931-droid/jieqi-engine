# START HERE — 乐子象棋（2026-10-02）

## 一句话状态

旧 APK 的非棋盘 UI 已被用户否决。本轮只保留 V4 棋盘本体，重新统一了主菜单、蓝牙大厅、设置、规则、英雄选择、猜拳和全部对局覆盖层；当前代码与 APK 构建通过，但真实 Android WebView 视觉仍等待用户审核。

## 先读

1. `handover/2026-10-02/README.md`
2. `handover/2026-10-02/UI_ACCEPTANCE_CHECKLIST.md`
3. `UI_SOURCE_OF_TRUTH.md`
4. `CONFIRMED_UI_PLAN.md`
5. `PROJECT_STATE.json`

## 当前构建

- 分支：`codex/ui-android-apk-20261001`
- 提交：`30ddc5b352e7f8a714c15a2cbc5e8cb525d32525`
- 草稿 PR：`#2`，未合并
- Actions run：`36969499661`，两项 job 成功
- 测试：201 passed / 0 failed
- APK SHA-256：`35607da8eca3f8c1ecfc5028a78dd6c8ed2d893faea704b30115403e64bc2106`

## 关键边界

- 保留：棋盘、棋位、棋子锚点、棋子墨圈与棋盘交互。
- 已替换：除棋盘外的页面、外层控件、状态和覆盖层。
- 旧 2026-10-01 APK 已过时，不作为视觉依据。
- 当前仍是 debug APK；尚未完成真机视觉批准与双机物理验证。
- 不合并 `main`，除非用户明确授权。
