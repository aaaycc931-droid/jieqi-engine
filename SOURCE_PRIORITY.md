# Source Priority — 2026-09-29

处理当前实现/续接问题时，按以下优先级：

1. `PROJECT_STATE.json`：机器可读当前状态与 next_action。
2. `START_HERE.md`：跨账号启动入口。
3. `UI_SOURCE_OF_TRUTH.md`：UI 视觉来源、历史素材适用范围与当前候选状态。
4. `HANDOVER.md`：本轮完整交接。
5. `IMPLEMENTATION_STATUS.md`：已实现/未验证/旧冲突。
6. `PENDING_AND_RESUME.md`：后续实施顺序与暂缓项。
7. `CONFIRMED_UI_PLAN.md`：功能性 UI 与断线/再战等产品规则。
8. `BALANCE_AND_RULE_UPDATES.md` 与 `RULES-CHANGELOG.md`：规则与平衡增量。
9. 当前分支代码和测试：实现事实。
10. 更老的 handoff、旧规格、旧 APK：只作历史证据，不得覆盖上述来源。

发生冲突时必须先指出冲突，不得静默选择旧规则。
