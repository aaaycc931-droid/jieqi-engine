# 现有运行时 → r4 差分映射｜2026-10-06

规则基线：LEZI-FUNCTION-2026-10-06-r4，规范摘要 cf831ebe7872cb9d8ed55fa3b4edb7f03492b3c90a06c8d9be494ac9a9e9284f。
核对远端工作分支 codex/ui-android-apk-20261001 的 c4db3cd55263f283fec0869a8252d8f3540ce70d；其产品源码仍为历史检查点 8b985a8f2bf8cd4ab96fdf63ab73894292cc6f7a。未回退或覆盖 r3/r4 文档。

本轮用户授权“进行下一步推进”，先实现公共【暗置身份】及现有普通兵种调用方。其他英雄设计在另一对话继续，未移交的英雄不导入；旧大规模浏览器采样队列继续暂停。

| 已确认规则 | 实现前源码事实 | 差分与本轮处理 |
| --- | --- | --- |
| 当前兵种默认读取暗置身份 | src/slots.ts 的 getMovementIdentity 已按当前位置查标准暗子棋位，但仅以走法接口暴露 | 本轮提取 getDarkIdentity / getCurrentPieceType；基础走法、战车/铁马资格与路径结算、毁灭非将帅候选、原走法提示接口共同使用；不接受 SecretState |
| 揭示后读公开真实兵种 | applyAuthoritativeMove 完成落位时读取秘密身份并公开；明棋走法读公开 type | 保留原揭示时机和控制方；新公共入口按 faceDown 分流，不写棋子或秘密状态 |
| 非标准位置由特殊来源定义 | requireCoveredSlot 遇非标准位置仅抛通用 Error；运行时没有来源身份策略字段 | 公共兵种入口抛 UNDEFINED_DARK_IDENTITY，不提供真实身份或统一兵种兜底；不擅自新增来源策略或修改移置规则 |
| 明确许可才读真实身份 | effectiveIdentity 用于权威端宿命真实兵初始化、影的真实阵营候选、死亡身份记录及毁灭将帅筛选；game.ts 在正式揭示时直接读取秘密身份 | 已核对02英雄正文：毁灭按普通非将帅身份锁定、仅暗子实际死亡才揭示。因此候选筛选改公共兵种；保留宿命真实兵、影真实阵营及死亡揭示的明确真实读取，不改变英雄其他规则 |
| 术士燃烧烈焰统一身份后映射等级 | 当前 HeroId / 12英雄运行时没有术士 | 只提供可复用基础入口；不新建术士逻辑、专属身份或统一暗子3级。术士接入与等级集成测试待完整移交 |
| 动作关键词与行动等级正交 | lastMove 有独立 tier / keywords，历史只有 tier；技能主行动有占步/耗费，流舞注明不计正式回合 | 已有部分结构，仍需统一动作来源、正式/子行动与历史合同；本轮不验收 ADD-ACTION-TIER-001 |
| 五阶段正式回合、持续即时计时、子行动不推进 | game.ts 与 hero-actions.ts 调用 finishFormalTurn；后者处理计数、持续、感染和周期刷新，forcedDefense / countsAsFormalTurn=false 有提前返回 | 需逐来源映射显式时序、开始窗口和周期推进权限；不能凭旧测试认定满足完整 r3 合同 |
| 河道特殊空间 | PieceBase.layer 目前只有 air，isGround 为非 air；pieceAt 忽略 air | 无河道状态及读取权限。本轮不添加英雄河道机制；后续需空间结构与棋盘读取审计 |
| 同批消灭先闭批次再派生 | destroyPiece 记录死亡；部分技能先锁目标再逐个消灭，后续 generateGhosts / resolveWindReturn 等分散于各入口 | 无统一批次对象或派生触发屏障；需逐来源确认同时语义再实现，不能以终局统一检查代替死亡批次闭合 |
| 亡魂 / 里·亡魂独立格对象 | GameState.ghosts 只有 owner / position / remaining，无精确对象种类 | 待对象类型及精确清除、叠层、资源接口；不导入未移交的里英雄 |
| 明确当前控制方不偷读秘密阵营 | getController 与 effectiveIdentity 已分开，目标判定主要调用 getController | 本轮公共兵种入口继续与控制方解耦；仍待各目标、资源、UI权限的全量来源审计，不宣称 ADD-CURRENT-CONTROL-001 通过 |
| 表/里完整英雄形态包 | featureRules.heroes 记录旧 HeroId，没有全局形态字段 | 待形态存储和开局选择合同；本轮不新增表/里英雄设计或选择UI |

实现顺序：先公共身份接口与现有调用方，再动作/历史与正式回合时序，随后死亡批次及空间/对象模型。任何完整英雄接入仍依赖正式移交；规则文本中的待设计项保持待设计。后三类运行时工程不能以本轮身份测试冒充完成。

新验证证据另记 DARK_IDENTITY_RUNTIME_2026-10-06.md；旧328 passed、旧96合同证据仅适用各自历史版本。本轮不生成APK、不合并main、不运行浏览器全局采样。
