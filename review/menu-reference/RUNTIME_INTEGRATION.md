# 首页正式接入与验证（2026-10-04）

当前功能优先边界见 `handoff/current/05_PROGRESS_AND_NEXT.md`；2026-10-05源码b64a2ca的首页run37253111329通过。以下为接入历史记录，UI最终整理仍在功能收束之后，APK暂停。

用户已审核原图/旧首页/还原样稿对比并同意接入，明确要求暂不生成 APK，继续修改其余非棋盘 UI。

## 当前源码与运行时

- 接入提交：`bb5b78b8263cf8ef4e03e662f0644dd52d4fa516`。
- 验证提交：`e3ad1be1fb0ebc14304945b68b13ec2cff155e4e`（随后只修正验证服务目录，未改首页效果）。
- 首页：`web/index.html`、`web/home-menu.css`、`web/assets/menu-original/approved-menu.png`。
- 原图 941×1672；SHA-256 `5c0dae37bb4dd84054d566c5ae5da98545ca73f23544ded5090ec80f1fbe211e`，未重绘。
- 页面使用原图上部、宣纸留白、下部显示窗口，真实 HTML 按钮接原有事件与无障碍名称；设置入口独立保留。
- 只修改首页视觉；V4 棋盘及其他页面未被这层 CSS 覆盖。其余页面视觉仍待后续修改。
- 112 个 Web 文件与 Android 内置网页资源完全一致。资源同步不等于 APK 打包。

## 实际验证

- 本地及 CI 规则检查：201 passed / 0 failed；Web 构建通过。
- 规则/Web run：[37170254145](https://github.com/aaaycc931-droid/jieqi-engine/actions/runs/37170254145)，成功，`android-apk` 明确 skipped，无 APK 产物。
- 正式首页浏览器 run：[37170251516](https://github.com/aaaycc931-droid/jieqi-engine/actions/runs/37170251516)，成功；Chromium 145.0.7632.6，运行 `dist/web/index.html` 的实际项目 JavaScript。
- 7 个尺寸：360×640、390×845、360×800、320×568、941×1672、412×915、800×600。
- 各入口无越界，触控目标至少 48 CSS 像素，各场景无控制台错误、失败请求或 HTTP 错误。
- 真实入口检查：本机进入英雄选择，蓝牙进入大厅，玩法说明打开/返回，设置打开/返回，减少动画刷新后保留，联机禁用说明。
- 在原图尺寸排除新增设置入口及周边 8 像素后，对比 1,567,727 像素，差异 0。此结论不外推为所有设备或 Android WebView 的逐像素一致。
- 原始机器可读结果：`runtime-browser-review-2026-10-04.json`。

## 下一步边界

1. 继续蓝牙大厅、设置、玩法说明及其余非棋盘页面与状态层的修改；复用现行功能规划。
2. 用户恢复打包前不生成 APK。自动打包已暂停；手动 `workflow_dispatch` 的 `build_apk` 默认 false，未经用户恢复不得改 true。
3. 真机 WebView、安全区、字体缩放与实体双机蓝牙尚未验证。
4. 此时不把项目或本轮所有 UI 标记为收束完成，不生成宣称全量完成的最终交接包。
5. 不合并 `main`。正式英雄画像、技能图标等既有暂缓项仍保持暂缓。
