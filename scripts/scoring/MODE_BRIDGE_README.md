# 两种新模式限定接入｜mode_scoped_P0_v0.3

基线：v0.2固定提交 f1c01585ade8b4e17618399901d7283f37271459；新增半混乱H11-B计数与倒计时确认，见 CONFIRMATION_HC_H11_B_COUNT_CLOCK.json 和 docs/HALF_CHAOS_H11_B_COUNT_CLOCK_2026-10-12.md。
用途：真实权威入口的模式专属机制与信息隔离验收；不是产品完整模式开放、P1强度资格、完整对局资格或评分解冻。

## 运行与支线入口

Node >=24，无额外依赖。

```sh
node --test --test-reporter=spec tests/scoring-mode-bridge.test.ts
node scripts/scoring/run-mode-qualification.ts /absolute/private-output
npm run check
```

`PolicySession` 新增可信驱动选项 `modeQualification`：模式、两个固定actor的来源、合法猎人准备位置。`mask` 仍表示两名玩家各自整套来源开/关，`stratum` 仍表示处理前猜拳分层；来源在英雄选择阶段生效，不能按交换后的黑方筛选经验总体。没有本选项时保持原揭棋H14/H11+尖斜的v0.1范围。

```ts
const session = new PolicySession({
  ruleSeed: "diagnostic-rule", policySeed: "separate-policy",
  mask: "01", stratum: "A_initial_black",
  modeQualification: {
    mode: "xiangqi", sources: { A: "shuffler", B: "shuffler" },
  },
});
const input = session.input("A"); // only approved player observation
const decision = session.decide("A");
const receipt = session.submit("A", decision.intent);
```

`sources`在普通象棋只接受hunter/rogue/shuffler，在半混乱只接受shuffler。未启用玩家仍完成选择确认，但其整套有效来源在开局前移除。两种新模式固定无畸变背景；M07未获得此版本资格。默认mask=11，因此无英雄基础局面必须显式使用mask=00。

## 已运行的限定范围

| 模式 | 范围 | 证据与边界 |
|---|---|---|
| 普通象棋 | STD-FX-01/02 | 固定32明棋、零开局随机；8步真实前缀及同前缀独立重放的士/象合法与非法探针 |
| 普通象棋 | STD-NI-01、H01 | 秘密陷阱位置同输入/同策略随机的独立进程确定性对照；一层消耗、实际死亡原因和第12敌回合末到期 |
| 普通象棋 | H02 | 发动正常移动、来源扣费、随后两个己方正式窗口、真实刺杀、不允许将帅目标 |
| 普通象棋 | H11 A/B | 固定初始32棋含双边死亡复原；无身份随机；B黑方计数1→2，普通begin/main/end均0 |
| 半混乱 | HC-F01/F02 | P/Q/R世界通过合法Fisher-Yates抽样见证输入产品准备流程；真实三步前缀；各阵营库存保持 |
| 半混乱 | 信息隔离 | P/Q与P/R揭示前、P/Q红揭示后黑揭示前，同目录、动作、nextMemory、decisionUsage和玩家历史；授权揭示后允许差异 |
| 半混乱 | HC-F03、HC-F05子项 | H11 A分阵营28次随机抽样；双边已死亡初始棋恢复、同ID重放和冲突重放；HC-F05地面来源子项未验收 |
| 半混乱 | HC-F04限定计数/计时 | B选择窗口启动既有倒计时，不触发普通begin；成功B黑方计数1→2、普通begin/main/end均0，红方按提交时间开新时钟；跳过承接剩余时间；到期与迟到提交、失败及重放分别验收。不授予HC-F04中未列联动资格 |

当前22项限定检查；相对v0.2替换HC-F04旧部分诊断并新增3项B计时边界检查。四世界×两分层×两模式的16条准备轨迹是相关诊断条件，不是16局完整对局或16个独立经验样本。

## 门禁和信息边界

`GAME_MODES.xiangqi/half_chaos.featuresReady`仍为false。门禁增加的是同步、可信、房间限定的来源白名单判定，不是全局忽略门禁；产品调用与客户端JSON不能建立这个上下文。错误房间、模式、背景、来源或关闭态来源仍拒绝。该能力未由`src/index.ts`导出，策略进程不能导入它。此版本只验证上表的路径；允许列出的来源组合不等于所有交互都已验收。

观察显式携带模式，保持普通象棋士/象区域规则；H02仅白名单保留公开刺杀/无形状态；H01仅给本方投递合法本方陷阱。权威暗池、敌方陷阱、抽样见证和审计日志不进入策略IPC。动作目录由重建玩家状态生成，绝不从权威秘密预筛。

`halfChaosFixtureRandom`从给定合法库存求出Fisher-Yates抽样见证，真实初始化仍由产品setup执行；不直接写secret/state来制造可行局面。固定见证被标为fixture，不代表经验总体采样法则。

新增被动`formal_main_action`事件与既有begin/end分开；v0.3以`shuffle_window_clock_start`单独记录B选择计时，不冒充普通begin。主行动事件记录公开状态及行动详情，不附伪造的秘密快照；仅权威研究记录接收。被动观察关闭后权威局面与随机流一致。认输路由修正为真实产品签名（revision/actionId/now）；P0不自动选择认输。

私有输出包括准备、真实动作收据、机制回调、authority/两actor分离记录和随机审计；每份archive均通过哈希复核。公开汇总不含实际私有轨迹。提交后重跑时`source_commit`为确定提交，`dirty_worktree=false`。

## 继续阻断与下一步

q/H/I/B/J全部null，正式评分冻结，经验参数未批准。H03候选、H11×H15、M07及刷新前秘密读取、风等未列来源、未确认重复局面/长将/长捉/和棋、P1、完整对局和总体采样继续阻断。

半混乱B的1→2与选择计时来自主线2026-10-12用户对两项提案的明确确认，不是引擎观察倒推，也不借原揭棋确认覆盖。收据时钟增量仍只说明测试中传入的时间，不是固定+1耗时规则。半混乱窗口A和其他模式窗口计时未在本次修改。

两条支线可以固定此提交独立复跑模式用例，填写自己逐字段observed_runtime；必须保留未运行字段和未确认字段的null/blocked/partial，不能批量标为全部通过。阶段完成或出现共享阻断再总回传，无需每条回复打包。
