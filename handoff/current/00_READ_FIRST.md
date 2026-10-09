# 乐子象棋｜当前实现交接入口

**当前任务（2026-10-09）：NET-001。** 完整来源为 `net/input/NET-001_WORK_HANDOFF.md` 与 `DECISIONS.json`；先读 [32_NET-001_NETWORK_VALIDATION_2026-10-09.md](32_NET-001_NETWORK_VALIDATION_2026-10-09.md)、`STATE.json.networking_validation`、独立06协作。未来主要正式方向微信小游戏，APK/网页当前用于开发测试；CF先测、香港备选、预算尽量≤50元。现状审计完成，独立工具已准备；云部署、大陆性能、生产选型未完成。NET分支从既有实现分支隔离，不改游戏规则；旧互联网绝对暂停仅在NET技术验证范围内被本轮明确授权替代。PR2、游戏入口、APK/main/完整对局/最终UI与模式适配边界保留。下文为已完成的游戏产品基线，不表示本轮主任务仍等待英雄移交。

现行规则 **LEZI-FUNCTION-2026-10-07-r5 + 2026-10-08四项明确确认增量**。H07双窃时标准60/60；H12普通中心至少3级消灭范围将帅，将帅中心消灭范围普通棋及另一将帅同批裁决；H16最终选择主动乱斗，先付6+5n、占主行动、己方控制暗子首刀、同棋暗子连斩；H21龙鳞目标留位、地面进攻者返回结算落位，飞行降落受阻仍按已有基础规则窒息。四项设计缺口已关闭并统一实现；原r7-clean保留原文，未新增整版r6。

先读独立06_COLLABORATION.md、STATE.json、30_RULE_GAP_RUNTIME_2026-10-08.md及qa/HERO_TRANSFER_AUDIT.json，再读01/02/03、04/09和四份rules/confirmed/RULE_UPDATE_2026-10-08_*增量。SOURCE_REGISTER登记来源，MANIFEST核对交接，qa/INVARIANTS合同与review/invariants/LATEST记录具体执行。13–29号记录为历史时点。

产品fd268f301cf8200993271bf1bc837fbbff7870ce，本地引擎执行f3ae349548970eaf94469c90d323b157777dbea8；组装后完整树2196ff13746ef6e00fc0a5b4820eae20d1a8a209与远端产品相同，引擎执行树因其后的文档/证据归档不同而不声称全树相同。源码、合同与编译app摘要均与实际CI一致。本轮514项引擎/静态通过（501已有、13新增）；Web成功、128个Android嵌入文件一致；CI中27项英雄准备态DOM通过（20已有、7新增）、错误0；共享web/app改动触发9项保留模式基础回归通过，非恢复模式独立适配。源码CI 37803496845、浏览器CI 37803496875实际作业均成功。

本地新增13项在旧产品上全部失败、新实现全部通过，最终本地全套只执行一次。本地浏览器缺Chromium且下载失败，没有实际DOM执行；本轮浏览器结果来自实际提交CI，不引用旧20项作为新增语义证据。详尽JSON为review/invariants/RULE_GAP_CI_2026-10-08.json，实际报告保留原执行版本；artifact索引已登记，没有下载ZIP验证归档字节。

109合同106项部分情景证据、3项非运行时，完整验收仍0。完整来源交叉、自然整盘、旧存局迁移、实体蓝牙与Android WebView未完整验收。

仓库aaaycc931-droid/jieqi-engine；工作分支codex/ui-android-apk-20261001，PR2保持open draft。不force/reset、不合main、无APK/部署，不恢复旧整盘、主动技能整盘、模式独立适配或最终视觉队列。统一收束完成，等待用户新的英雄正式移交，按确认差分继续。个人主协作文档独立，未改动。
