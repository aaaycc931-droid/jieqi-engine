# START HERE — 乐子象棋（2026-10-03 首页还原审核）

## 一句话状态

2026-10-02 APK 的首页外观也已被用户否决。原图外观交互样稿已经通过 Chromium 多屏截图和真实按钮检查；原图尺寸下，排除新增设置入口后，1,567,727 个对比像素差异为 0。样稿尚未进入正式运行时，先等待用户根据对比图确认首页素材约束调整，再构建 APK。

## 先读

1. `PROJECT_STATE.json`
2. `review/menu-reference/BROWSER_REVIEW.md`
3. `UI_SOURCE_OF_TRUTH.md`
4. `CONFIRMED_UI_PLAN.md`
5. `handover/2026-10-02/README.md`（构建与历史交接信息）

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
