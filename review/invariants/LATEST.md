# 规则合同逐项运行证据

规则：LEZI-FUNCTION-2026-10-04-r1；运行时：v24.19.0；时间：2026-10-05T01:50:52.804Z。

测试 298 通过 / 0 失败。96 项合同：93 项有部分通过证据，0 项缺专属测试，3 项属于规范/概念检查；完整验收仍为 0 项。

本表关联具体情景用例，不把相关用例通过写成整条规则的完整证明。精确用例名称、源码摘要与限制见 LATEST.json。

| 合同 ID | 状态 | 证据文件 | 剩余限制 |
| --- | --- | --- | --- |
| INV-BOARD-001 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 移动/移置越界、非整数和非有限坐标拒绝已有证据；完整棋盘全入口保持性仍缺。 |
| INV-BOARD-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 仅地面/空中同格与空中目标占用；还缺移置层标准化及全入口验证。 |
| INV-SETUP-001 | partial_evidence_passed | tests/setup-rps.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-COVERED-001 | partial_evidence_passed | tests/movement.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-COVERED-002 | partial_evidence_passed | tests/movement.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-REVEAL-001 | partial_evidence_passed | tests/movement.test.ts, tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-REVEAL-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-DESTROYED-RECORD-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-SECRET-001 | partial_evidence_passed | tests/setup-rps.test.ts, tests/check-end-network.test.ts, tests/bluetooth-private-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-LEGALITY-001 | partial_evidence_passed | tests/check-end-network.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CONTROL-001 | partial_evidence_passed | tests/movement.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CAPTURE-001 | partial_evidence_passed | tests/movement.test.ts, tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CAPTURE-002 | partial_evidence_passed | tests/movement.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CAPTURE-003 | partial_evidence_passed | tests/movement.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-ACTION-001 | non_runtime_contract | — | 术语分类约束需要规范/记录字段检查，不能通过一条执行用例证明。 |
| INV-ACTION-002 | partial_evidence_passed | tests/check-end-network.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-KEYWORD-001 | non_runtime_contract | — | 术语退役约束需要规范/日志静态检查，尚未完成。 |
| INV-ACTION-PLAN-001 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-DISPLACEMENT-001 | partial_evidence_passed | tests/time-line-contracts.test.ts, tests/remote-room.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-REWIND-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/time-line-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-REVIVE-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/cross-rule-contracts.test.ts | 沙漏复活逐项不继承临时状态已验证；仍缺技能资源与名额保留、落位交叉边界。 |
| INV-DESTROY-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-TERMINAL-001 | partial_evidence_passed | tests/check-end-network.test.ts, tests/exception-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-ATOMIC-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-ATOMIC-002 | partial_evidence_passed | tests/mutation.test.ts, tests/confirmed-runtime.test.ts, tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-ATOMIC-003 | partial_evidence_passed | tests/mutation.test.ts, tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-END-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-REASON-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-IDEMPOTENCY-001 | partial_evidence_passed | tests/check-end-network.test.ts, tests/time-line-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-PHASE-001 | partial_evidence_passed | tests/check-end-network.test.ts, tests/bluetooth-disconnect.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-INTANGIBLE-001 | partial_evidence_passed | tests/assassination.test.ts, tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-INTANGIBLE-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-INTANGIBLE-003 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/assassination.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-FLIGHT-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-FLIGHT-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CRUSH-001 | partial_evidence_passed | tests/mutation.test.ts, tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-SUFFOCATION-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-INFECTION-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-INFECTION-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-WARRIOR-001 | partial_evidence_passed | tests/warrior.test.ts, tests/exception-contracts.test.ts | 已验证三个不同ID上限、死亡不返还与复入宫不重复；复活资格只用重新插入同ID的状态恢复夹具验证，不能冒充完整复活来源流程。 |
| INV-WARRIOR-002 | partial_evidence_passed | tests/warrior.test.ts, tests/assassination.test.ts, tests/flow-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-WARRIOR-003 | partial_evidence_passed | tests/remote-room.test.ts, tests/exception-contracts.test.ts, tests/flow-contracts.test.ts | 堡垒原位弹回、普通封锁及流·舞返回陷阱已有专属运行用例；当前普通弹回保留原格，尚未找到可达的返回格被占链。混合壁垒/陷阱夹具只隔离落点派发，不声称自然英雄组合。 |
| INV-WARRIOR-004 | partial_evidence_passed | tests/warrior.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-IRONARMOR-001 | partial_evidence_passed | tests/warrior.test.ts, tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-ROGUE-001 | partial_evidence_passed | tests/assassination.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-ROGUE-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-STRIKE-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/assassination.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-TRAP-001 | partial_evidence_passed | tests/remote-room.test.ts, tests/time-line-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-TRAP-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/time-line-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-IRONSTEED-001 | partial_evidence_passed | tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-IRONSTEED-002 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-WARCHARIOT-001 | partial_evidence_passed | tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-WARCHARIOT-002 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 单独验证该车的双将同死路线不构成威胁；不否定局面中其他棋或照面的独立将军。 |
| INV-CAVALRY-001 | partial_evidence_passed | tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CAVALRY-002 | partial_evidence_passed | tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-FORTRESS-001 | partial_evidence_passed | tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-MUROZOND-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/time-line-contracts.test.ts, tests/exception-contracts.test.ts | 已验证返回陷阱、返回失败跳过控制并占步、无合法重走拒绝事务；占位与无合法着法为明确构造状态，尚未穷尽真实行动历史的可达组合。 |
| INV-NOZDORMU-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/time-line-contracts.test.ts, tests/exception-contracts.test.ts | 已有快照资源与计时案例；全部英雄资源、持续效果及回溯后的保密交接尚缺。 |
| INV-TIME-COLLAPSE-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-TIME-COLLAPSE-002 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-HOURGLASS-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-MANIFESTED-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CAREFREE-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CAREFREE-002 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-VISIBILITY-001 | partial_evidence_passed | tests/remote-room.test.ts, tests/setup-rps.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-TRAP-VISIBILITY-001 | partial_evidence_passed | tests/remote-room.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-DISCONNECT-001 | partial_evidence_passed | tests/bluetooth-disconnect.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-DISCONNECT-002 | partial_evidence_passed | tests/bluetooth-disconnect.test.ts, tests/exception-contracts.test.ts | 已覆盖普通正式回合、回溯重走、双方重叠断线后全员恢复的一次性顺延及精确到期；视觉动画、蓝牙WebView和设备恢复仍待。 |
| INV-DISCONNECT-003 | partial_evidence_passed | tests/bluetooth-disconnect.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-001 | partial_evidence_passed | tests/movement.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-003 | partial_evidence_passed | tests/movement.test.ts, tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-004 | partial_evidence_passed | tests/mutation.test.ts, tests/remote-room.test.ts, tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-005 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-006 | partial_evidence_passed | tests/mutation.test.ts, tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-007 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-008 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-009 | partial_evidence_passed | tests/assassination.test.ts, tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-010 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-011 | partial_evidence_passed | tests/assassination.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-012 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-013 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-014 | partial_evidence_passed | tests/warrior.test.ts, tests/exception-contracts.test.ts | 三回合衰减已覆盖；三名额上限专属用例仍缺。 |
| REJ-015 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-016 | partial_evidence_passed | tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-017 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 单独验证该车的双将同死路线不构成威胁；不否定局面中其他棋或照面的独立将军。 |
| REJ-018 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-019 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/time-line-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-020 | non_runtime_contract | — | 该合同是防止代码替代规则的协作约束；原反例中“尚未实现”属于历史文字，不能用于推断本轮具体缺陷。 |
| ADD-SECRET-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 引擎与玩家视图已验证；敌方按钮/动画和本机交接仍缺真实浏览器证据。 |
| ADD-WIND-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/bluetooth-private-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| ADD-WIND-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| ADD-WIND-003 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/flow-contracts.test.ts | 已补实际裁决归位两步脱困、错误第一步继续裁决、亲征九宫限制、普通壁垒、陷阱终止、亡魂及房间计时；浏览器为预置状态操作，完整随机对局与实机仍待验证。 |
| ADD-JIANXIE-001 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| ADD-CLOCK-001 | partial_evidence_passed | tests/time-line-contracts.test.ts, tests/exception-contracts.test.ts, tests/flow-contracts.test.ts | 3/10/42秒历史预算、房间权威接收及到期已验证；浏览器显示与WebView尚未验收。 |
| ADD-TWIST-001 | partial_evidence_passed | tests/time-line-contracts.test.ts | 真实倒戈棋返回猎人陷阱、下一正式回合封锁和耗尽已验证；其他来源状态组合尚缺。 |
