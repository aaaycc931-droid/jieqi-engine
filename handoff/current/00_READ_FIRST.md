# 乐子象棋｜当前实现交接入口

现行规范 **LEZI-FUNCTION-2026-10-07-r5**；英雄原稿 **2026-10-07-r7-clean**。H01–H21确认部分已接入；本轮修复三处降临结算偏差，未新增规则。19表包、江鹤/死亡骑士两里包、虔信狂徒五固定形态保持。

读取顺序：

1. STATE.json、25_HERO_DESCENT_BOUNDARY_2026-10-08.md：本轮产品与证据；24_HERO_CHILD_BOUNDARY_2026-10-08.md、23_HERO_CROSS_SETTLEMENT_2026-10-08.md：此前修复；22_HERO_TRANSFER_2026-10-07.md、qa/HERO_TRANSFER_AUDIT.json：正式移交及四项设计缺口。
2. 01_CURRENT_RULES.md → 02_CURRENT_HEROES.md → 03_CURRENT_MUTATIONS.md：现行玩法。
3. 09_CURRENT_GAME_MODES.md、04_CURRENT_UI_AND_FLOW.md：模式与UI边界。
4. 07_DESIGN_SCORING.md、08_SCORE_LEDGER.md：评分审计，不决定玩法。
5. SOURCE_REGISTER.json、MANIFEST.json、qa/INVARIANTS.json及review/invariants/LATEST.json：来源与实际合同证据。
6. 13–24号轮记录只说明历史时点，不覆盖本轮状态。

产品发布70f19144f399b6fcf3742d4d49188fb17d78a9d7；本地执行73ba243830a45268532e93da072134b6890d0b49；完整产品树39b9d71a905dd3e6041842202f4cec60fdc06117相同。487项测试通过（6新增）、Web成功、127文件资源一致。12项英雄准备态DOM（3新增）与9项模式基础入口检查通过，页面/请求错误为0；当前CI源码/合同摘要与本地一致。109合同仍106部分证据、3非运行时、0完整验收。此前481等证据保留为历史。

本轮修复：梦魇使用公共空间判定遵守堡垒封锁；梦魇的将军限制按落点死亡等闭合后的最终局面检查；风暴无存活元素时关闭空突袭窗口，恢复正常主行动前。六项引擎情景及三项新增真实DOM操作通过。

四处design-required仍待：双窃时镜像、燃烧烈焰将帅层级交叉、混乱乱斗首次发动/付费、龙鳞拦截后的落位。完整英雄/畸变交叉、自然完整局、旧存局语义迁移、实体双机及Android WebView仍未完整验收。正式规则与原始移交来源未改，不以测试数量冒充完整验收。

仓库aaaycc931-droid/jieqi-engine，分支codex/ui-android-apk-20261001。保留并发变更，不force/reset；PR #2保持open draft，不合main；最终视觉最后，无APK/互联网部署。继续已确认来源的其他定点交叉审计；四项design-required须由正式设计来源补齐后再实现。旧整盘、主动技能整盘、模式独立适配、APK和最终视觉队列保持暂停。
