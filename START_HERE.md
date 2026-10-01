# START HERE — 乐子象棋（2026-10-01）

## 当前一句话状态

用户已明确把本轮优先级切换为 UI。主菜单、蓝牙大厅、设置页、玩法说明页、八阶段流程、七类可放大走法图、英雄选择页、猜拳页、英雄准备/猎人陷阱、阶段三点菜单、规则/畸变覆盖层、终局结果/再战、消息/按局历史、已吃棋子、英雄/技能实时详情以及非终局事件提示已完成第一阶段重构。最新 Web 资源已同步到 Android assets，权限与连接取消桥接也已修正；当前通过 **200/200** 自动测试与 Web 构建，但尚未重新编译当前 APK，也未经过真实 Android WebView/双机最终批准。

## 当前分支与工作树

- 分支：`codex/phase3-cumulative-disconnect-20260923`
- 本轮 UI 改动仍在工作树中，未合并 `main`、未推送、未部署。
- 旧断线阶段的最近提交仍是 2026-09-24 检查点；不要把它误当成本轮 UI 的提交点。

## 必读顺序

1. `PROJECT_STATE.json`
2. `UI_SOURCE_OF_TRUTH.md`
3. `HANDOVER.md`
4. `IMPLEMENTATION_STATUS.md`
5. `PENDING_AND_RESUME.md`
6. `CONFIRMED_UI_PLAN.md`

## 本轮验证

- `npm run check`：200 passed / 0 failed
- Web build：passed
- `dist` 与 `android/app/src/main/assets/game`：108 个文件一致
- Android 静态检查：权限前置、阻塞连接可取消、`adjustResize` 均通过
- `git diff --check`：passed
- 9:16、19.5:9、20:9 主菜单静态分层检查：未见标题、署名、入口文字裁切
- 当前环境没有可用 Chromium，本地页面也不能由云浏览器访问，因此没有真实浏览器截图
- 当前环境缺少 Android SDK、Gradle 命令和 wrapper 运行文件；本轮 Android Java 与最新 assets 未重新编译，2026-09-24 的 Android CI 只能证明旧检查点

## 下一动作

1. 在具备 Android SDK/Gradle 的环境构建当前 debug APK，确认最新 Web assets 被打包。
2. 在 Android WebView 中审核全部已改页面，特别是规则图放大层、消息半屏上展、软键盘、字体缩放和触控锁定。
3. 两台真实 Android 设备验证蓝牙权限、创建/加入/取消、权威聊天、断线草稿、断线累计与自动重连。
4. 仅根据真机复现结果修正问题并重新执行完整检查。

## 不要做

- 不把历史整页图设为运行时背景或从中抠取正式组件。
- 不把新增候选素材称为最终批准素材。
- 不把互联网联机入口变为可用；它仍保留并禁用。
- 不把自动测试通过等同于 Android WebView 或双机 RFCOMM 已验证。
- 不合并 `main`、不推送、不部署，除非获得明确授权。
