# 规则合同逐项运行证据

规则：LEZI-FUNCTION-2026-10-07-r5；运行时：v24.19.0；时间：2026-10-08T15:40:19.585Z。

测试 514 通过 / 0 失败。109 项合同：106 项有部分通过证据，0 项缺专属测试，3 项属于规范/概念检查；完整验收仍为 0 项。

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
| INV-SECRET-001 | partial_evidence_passed | tests/setup-rps.test.ts, tests/check-end-network.test.ts, tests/bluetooth-private-contracts.test.ts, tests/public-target-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-LEGALITY-001 | partial_evidence_passed | tests/check-end-network.test.ts, tests/public-target-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CONTROL-001 | partial_evidence_passed | tests/movement.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CAPTURE-001 | partial_evidence_passed | tests/movement.test.ts, tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CAPTURE-002 | partial_evidence_passed | tests/movement.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CAPTURE-003 | partial_evidence_passed | tests/movement.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-ACTION-001 | non_runtime_contract | — | 术语分类约束需要规范/记录字段检查，不能通过一条执行用例证明。 |
| INV-ACTION-002 | partial_evidence_passed | tests/check-end-network.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-KEYWORD-001 | non_runtime_contract | — | 术语退役约束需要规范/日志静态检查，尚未完成。 |
| INV-ACTION-PLAN-001 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-DISPLACEMENT-001 | partial_evidence_passed | tests/time-line-contracts.test.ts, tests/remote-room.test.ts, tests/hero-descent-boundaries.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-REWIND-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/time-line-contracts.test.ts, tests/snapshot-resource-contracts.test.ts, tests/rewind-action-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-REVIVE-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/cross-rule-contracts.test.ts | 沙漏复活逐项不继承临时状态已验证；仍缺技能资源与名额保留、落位交叉边界。 |
| INV-DESTROY-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-TERMINAL-001 | partial_evidence_passed | tests/check-end-network.test.ts, tests/exception-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-ATOMIC-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/public-target-contracts.test.ts, tests/hero-descent-atom.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-ATOMIC-002 | partial_evidence_passed | tests/mutation.test.ts, tests/confirmed-runtime.test.ts, tests/cross-rule-contracts.test.ts, tests/hero-cross-settlement.test.ts, tests/hero-child-boundaries.test.ts, tests/hero-descent-boundaries.test.ts, tests/hero-descent-atom.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-ATOMIC-003 | partial_evidence_passed | tests/mutation.test.ts, tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-END-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-REASON-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-IDEMPOTENCY-001 | partial_evidence_passed | tests/check-end-network.test.ts, tests/time-line-contracts.test.ts, tests/rewind-action-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-PHASE-001 | partial_evidence_passed | tests/check-end-network.test.ts, tests/bluetooth-disconnect.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-INTANGIBLE-001 | partial_evidence_passed | tests/assassination.test.ts, tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-INTANGIBLE-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-INTANGIBLE-003 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/assassination.test.ts, tests/public-target-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-FLIGHT-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/flight-turn-boundaries.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-FLIGHT-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/flight-turn-boundaries.test.ts, tests/design-gap-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CRUSH-001 | partial_evidence_passed | tests/mutation.test.ts, tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-SUFFOCATION-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-INFECTION-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-INFECTION-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-WARRIOR-001 | partial_evidence_passed | tests/warrior.test.ts, tests/exception-contracts.test.ts | 已验证三个不同ID上限、死亡不返还与复入宫不重复；复活资格只用重新插入同ID的状态恢复夹具验证，不能冒充完整复活来源流程。 |
| INV-WARRIOR-002 | partial_evidence_passed | tests/warrior.test.ts, tests/assassination.test.ts, tests/flow-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-WARRIOR-003 | partial_evidence_passed | tests/remote-room.test.ts, tests/exception-contracts.test.ts, tests/flow-contracts.test.ts | 堡垒原位弹回、普通封锁及流·舞返回陷阱已有专属运行用例；当前普通弹回保留原格，尚未找到可达的返回格被占链。混合壁垒/陷阱夹具只隔离落点派发，不声称自然英雄组合。 |
| INV-WARRIOR-004 | partial_evidence_passed | tests/warrior.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-IRONARMOR-001 | partial_evidence_passed | tests/warrior.test.ts, tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-ROGUE-001 | partial_evidence_passed | tests/assassination.test.ts, tests/hero-transfer-r5.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-ROGUE-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/hero-transfer-r5.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-STRIKE-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/assassination.test.ts, tests/public-target-contracts.test.ts, tests/hero-transfer-r5.test.ts, tests/design-gap-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-TRAP-001 | partial_evidence_passed | tests/remote-room.test.ts, tests/time-line-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-TRAP-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/time-line-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-IRONSTEED-001 | partial_evidence_passed | tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-IRONSTEED-002 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-WARCHARIOT-001 | partial_evidence_passed | tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-WARCHARIOT-002 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 单独验证该车的双将同死路线不构成威胁；不否定局面中其他棋或照面的独立将军。 |
| INV-CAVALRY-001 | partial_evidence_passed | tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CAVALRY-002 | partial_evidence_passed | tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-FORTRESS-001 | partial_evidence_passed | tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-MUROZOND-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/time-line-contracts.test.ts, tests/exception-contracts.test.ts, tests/flight-turn-boundaries.test.ts | 已验证返回陷阱、返回失败跳过控制并占步、无合法重走拒绝事务；占位与无合法着法为明确构造状态，尚未穷尽真实行动历史的可达组合。 |
| INV-NOZDORMU-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/time-line-contracts.test.ts, tests/exception-contracts.test.ts, tests/snapshot-resource-contracts.test.ts, tests/rewind-action-contracts.test.ts | 已补毁灭/祈求/刺杀资源、战士名额防御、暗子身份与亡魂回溯；另有風与陷阱寿命证据。全部持续时序、重复回溯交叉、本机私有交接与设备流程仍未穷尽。本轮补暗影之舞/恢复隐身重走的同棋、禁止进攻/将军、完成清理及重复命令；不外推全部组合。 |
| INV-TIME-COLLAPSE-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/bomb-target-boundaries.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-TIME-COLLAPSE-002 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-HOURGLASS-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-MANIFESTED-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CAREFREE-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-CAREFREE-002 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| INV-VISIBILITY-001 | partial_evidence_passed | tests/remote-room.test.ts, tests/setup-rps.test.ts, tests/public-target-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
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
| REJ-011 | partial_evidence_passed | tests/assassination.test.ts, tests/hero-transfer-r5.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-012 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-013 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-014 | partial_evidence_passed | tests/warrior.test.ts, tests/exception-contracts.test.ts | 三回合衰减已覆盖；三名额上限专属用例仍缺。 |
| REJ-015 | partial_evidence_passed | tests/confirmed-runtime.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-016 | partial_evidence_passed | tests/mutation.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-017 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 单独验证该车的双将同死路线不构成威胁；不否定局面中其他棋或照面的独立将军。 |
| REJ-018 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-019 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/time-line-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| REJ-020 | non_runtime_contract | — | 该合同是防止代码替代规则的协作约束；原反例中“尚未实现”属于历史文字，不能用于推断本轮具体缺陷。 |
| ADD-SECRET-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/public-target-contracts.test.ts | 引擎与玩家视图已验证；敌方按钮/动画和本机交接仍缺真实浏览器证据。 |
| ADD-WIND-001 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/bluetooth-private-contracts.test.ts, tests/public-target-contracts.test.ts | 已补公开进攻/强击/随机目标与隐藏承载者死亡、敌方编码视图不变；明子直接指定无形拒绝。部分阶段为明确构造夹具，完整随机对局与物理双机尚待。 |
| ADD-WIND-002 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/hero-cross-settlement.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| ADD-WIND-003 | partial_evidence_passed | tests/confirmed-runtime.test.ts, tests/flow-contracts.test.ts | 已补实际裁决归位两步脱困、错误第一步继续裁决、亲征九宫限制、普通壁垒、陷阱终止、亡魂及房间计时；浏览器为预置状态操作，完整随机对局与实机仍待验证。 |
| ADD-JIANXIE-001 | partial_evidence_passed | tests/cross-rule-contracts.test.ts | 已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。 |
| ADD-CLOCK-001 | partial_evidence_passed | tests/time-line-contracts.test.ts, tests/exception-contracts.test.ts, tests/flow-contracts.test.ts, tests/rewind-action-contracts.test.ts | 3/10/42秒历史预算、房间权威接收及到期已验证；浏览器显示与WebView尚未验收。 |
| ADD-TWIST-001 | partial_evidence_passed | tests/time-line-contracts.test.ts, tests/flight-turn-boundaries.test.ts | 真实倒戈棋返回猎人陷阱、下一正式回合封锁和耗尽已验证；其他来源状态组合尚缺。 |
| ADD-ACTION-TIER-001 | partial_evidence_passed | tests/action-turn-contracts.test.ts, tests/hero-descent-atom.test.ts, tests/flight-turn-boundaries.test.ts, tests/design-gap-runtime.test.ts | 已覆盖普通移动/进攻、弹回、时间线衍生、额外应将、流舞和回溯重走的独立分类，以及上一正式回合无Ⅰ级动作时拒绝跨回合搜索。未移交英雄和其他未来来源尚未接入；旧无classification历史仅兼容有明确tier且无已知子行动标志的快照。 |
| ADD-TURN-PHASE-001 | partial_evidence_passed | tests/action-turn-contracts.test.ts, tests/hero-cross-settlement.test.ts, tests/hero-child-boundaries.test.ts, tests/hero-descent-boundaries.test.ts, tests/hero-descent-atom.test.ts, tests/flight-turn-boundaries.test.ts, tests/design-gap-runtime.test.ts | 现有普通主行动、占步、主行动前窗口、回溯、终局与开始效果幂等已有具体执行证据；未包含未来英雄的资源/训练钩子、同批消灭屏障、浏览器与实体设备全流程，不是全称合同证明。 |
| ADD-DURATION-001 | partial_evidence_passed | tests/action-turn-contracts.test.ts, tests/confirmed-runtime.test.ts, tests/hero-child-boundaries.test.ts, tests/design-gap-runtime.test.ts | 现有陷阱、防御、飞行、亡魂、潜行者明确例外及子行动计数已覆盖具体执行情景；风5回合冷却、时间崩坏下一己回合末等既有来源例外保留。未移交培养/周期资源不自动实现，尚待完整来源审计。 |
| ADD-RIVER-001 | partial_evidence_passed | tests/river-space.test.ts | 公共河道空间、地面/飞行互斥、默认路径/目标/技能/落位隔离、来源定义暗身份与控制、出河及序列化有专属情景证据。只提供可信来源调用接口，不开放普通客户端河道操作；江鹤等英雄进出资格、容量、连通、停留/超时、里形态仍未正式移交/集成。无浏览器或实体设备新增验收。 |
| ADD-BATCH-001 | partial_evidence_passed | tests/destruction-batch.test.ts, tests/hero-cross-settlement.test.ts, tests/design-gap-runtime.test.ts | 公共批次入口与毁灭已锁定成功结果的闭合、死亡揭示/记录、触发屏障、风归位、亡魂单次派生、双将同死、批后移入/复活及公共协议序列化有专属情景证据。未移交英雄的同时范围来源、召回/复活/生成/资源钩子、河道与里亡魂仍未集成；不得将普通顺序攻击统一改同批。无浏览器或实体设备新增验收。 |
| ADD-GHOST-OBJECT-001 | partial_evidence_passed | tests/ghost-objects.test.ts, tests/hero-descent-atom.test.ts | 两类公共对象独立、共格、来源/归属/层数/寿命、精确清除和资源查询、普通死亡刷新/感染/计时、批次屏障及公共协议/实际回溯有17项具体情景证据。无种类旧快照仅兼容普通亡魂；未移交里英雄的生成、叠层、寿命时点、收益/爆发不自动定义，基础资源接口只返回点名类且指定公开归属的对象副本。无浏览器或实机新增验收，完整合同验收仍为0。 |
| ADD-CURRENT-CONTROL-001 | partial_evidence_passed | tests/current-control.test.ts, tests/design-gap-runtime.test.ts | 现有调用完成源码权限映射，15项情景验证当前位置/揭示/移置控制、普通及强击目标和错误、陷阱前后时点、亡魂死亡快照、感染/持续、资源/双方房间视图、真实读取来源约束和风/宿命许可例外。真实网页投弹/影菜单函数在轻量DOM执行，不能当作浏览器、换手机或实体蓝牙验收。无限龙公开单棋资格共用，但正式窗口和全军每回合限制仍由权威入口验证；来源标记是可信代码调用约束，不是客户端授权令牌。未移交来源及全部可达交叉组合未穷尽，完整验收仍0。 |
| ADD-HERO-FORM-001 | partial_evidence_passed | tests/hero-forms.test.ts, tests/hero-transfer-r5.test.ts | 18项专属情景覆盖十二表完整包、表/里命名、未知/未移交里包明确拒绝、旧快照表兼容、公开/权威独立整局锁、别名/技能包冲突、主被动分派、重复请求、实际回溯及历史篡改、实际蓝牙房间编码/重连/新局再战。只有表包已经注册；未移交里包未实现，不假造技能/数值。锁为可信权威状态约束，不是客户端密码凭证。无新形态选择UI、浏览器或实机新增验收，未来完整里包及全称交叉仍需移交后验证。 |
| ADD-DARK-IDENTITY-001 | partial_evidence_passed | tests/dark-identity.test.ts, tests/design-gap-runtime.test.ts | 基础棋位、当前位置变化及普通走法已验证；未来特殊来源身份策略尚未接入。 |
| ADD-DARK-IDENTITY-002 | partial_evidence_passed | tests/dark-identity.test.ts, tests/design-gap-runtime.test.ts | 公共入口不接受秘密状态；走法与毁灭候选覆盖具体情景。未覆盖所有英雄目标/资源/UI来源权限，影真实阵营与宿命真实兵保持明确许可读取。 |
| ADD-DARK-IDENTITY-003 | partial_evidence_passed | tests/dark-identity.test.ts | 普通落子揭示与明棋身份切换已验证；未扩展或验收其他特殊揭示来源。 |
| ADD-DARK-IDENTITY-004 | partial_evidence_passed | tests/dark-identity.test.ts | 公共入口在无法确定基础棋位时明确报错、不秘密兜底；来源专属非标准位置身份处理仍待相应来源定义。 |
| ADD-DARK-IDENTITY-005 | partial_evidence_passed | tests/dark-identity.test.ts, tests/hero-transfer-r5.test.ts | 现有基础走法、战车/铁马和毁灭候选共用入口已验证；术士未移交运行时，因此燃烧烈焰中心/目标等级集成仍待验证，不宣称英雄技能完成。 |
