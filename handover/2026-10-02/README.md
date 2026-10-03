# 乐子象棋全新交接包 — 2026-10-02

> 最新纠正（2026-10-03）：本包 APK 的首页外观也已被用户否决。原图外观样稿已通过 Chromium 验证，尚未正式采用；续接先读根目录 `PROJECT_STATE.json`、`START_HERE.md` 与 `review/menu-reference/BROWSER_REVIEW.md`。本包原有“重做完成”描述不代表视觉审核通过。

这是 2026-10-02 非棋盘 UI 重做后的完整交接入口，取代此前所有交接入口中的视觉结论。

## 核心事实

- 用户明确要求：除棋盘外全部修改。
- 2026-10-01 APK 的非棋盘视觉已否决，原因是整体风格偏离确认稿、交互状态粗糙。
- 本轮保留 V4 棋盘本体，不改棋位、棋子锚点、墨圈和棋盘交互。
- 本轮重做所有页面与覆盖层的视觉语言，并增加防止误改棋盘核心的自动测试。

## 构建状态

| 项目 | 当前值 |
|---|---|
| GitHub 分支 | `codex/ui-android-apk-20261001` |
| UI 提交 | `30ddc5b352e7f8a714c15a2cbc5e8cb525d32525` |
| 草稿 PR | `#2`，未合并 |
| Actions run | `36969499661` |
| 自动测试 | 201 passed / 0 failed |
| Web/Android assets | 109 / 109 哈希一致 |
| APK 大小 | 8,181,509 bytes |
| APK SHA-256 | `35607da8eca3f8c1ecfc5028a78dd6c8ed2d893faea704b30115403e64bc2106` |

## 文件导航

- `HANDOVER.md`：项目级交接结论与实施边界。
- `UI_ACCEPTANCE_CHECKLIST.md`：真机视觉与双机功能验收顺序。
- `ARTIFACT_MANIFEST.json`：构建、提交、产物与哈希的机器可读清单。
- APK：`lezi-xiangqi-ui-refresh-debug-2026-10-02.apk`。

## 视觉来源顺序

1. 用户最新明确反馈。
2. `CONFIRMED_UI_PLAN.md`。
3. `UI_SOURCE_OF_TRUTH.md` 指定的确认参考图与批准透明组件。
4. 当前代码。
5. 历史截图与旧交接，仅可用于追溯。

任何旧 APK、旧截图或旧文档都不得覆盖以上顺序。

## 恢复工作时

先安装本包 APK 完成非棋盘视觉审核。只有视觉被用户接受后，才进入两台真实 Android 手机的 Bluetooth Classic 全链路检查。未经授权不合并 `main`。
