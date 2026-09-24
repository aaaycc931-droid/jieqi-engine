# START HERE — 乐子象棋（2026-09-24）

## 当前一句话状态
累计断线 60 秒阶段已经实现并通过 150/150 自动测试、Web 构建与 Android APK CI；**当前下一步不是继续写功能，而是用两台 Android 真机验证断线/自动重连。**

## 当前分支
`codex/phase3-cumulative-disconnect-20260923`

## 当前关键提交
- 断线测试：`4ce7c425745dc8a5bc92f5eb161b19de725a91ae`
- 权威断线账本：`a591f1d1d084fd0920f682450768aad13bb51873`
- Android 自动重连基础：`bf66e7b273d3c026b226334183d2f463b74e4103`
- Web 重连/断线 UI：`9267487a320434bad2512c3c15ceee6b2ca79cbd`
- UI 边界修复：`070d7dfaf0214750ab8d6e6b83da26e725d91563`
- 超时阈值先后修复：`05e4cb5679d1c98130782d17e9a7da2f85017604`
- APK 构建前同步当前 Web：`af9bb642f0d570285a55de2ef58577005b1fd622`
- 恢复 main-only CI push：`c331a0a6128ab8c2f977a4163a31acb8001f8f67`
- 状态文档检查点：`045042cc0bc7e64dbd493e4052cdaebd9f0a0d89`

## 验证
- `npm run check`: 150 passed / 0 failed
- Web build: passed
- Android APK build: passed
- GitHub Actions run: `35950543824`
- 真机双机 RFCOMM: **未验证**

## 下一动作
执行 `PROJECT_STATE.json -> next_action = two_phone_disconnect_reconnect_validation`。

测试真机前先读 `HANDOVER.md` 的“当前唯一优先下一步”。

## 不要做
- 不要重新实现累计断线。
- 不要从旧交接包恢复“断线只暂停”的旧逻辑。
- 不要合并 main。
- 不要先去做聊天、再战、菜单或互联网联机。
- 不要把自动测试通过当成两台真机已经通过。
