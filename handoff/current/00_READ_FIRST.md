# 乐子象棋｜当前实现交接入口

现行规范 **LEZI-FUNCTION-2026-10-07-r5**；英雄原稿 **2026-10-07-r7-clean**。H01–H21已正式移交，19英雄表包、江鹤/死亡骑士两里包、虔信狂徒五固定形态已接入确认部分。四个设计缺项及完整验收仍开放。

读取顺序：

1. STATE.json、22_HERO_TRANSFER_2026-10-07.md、qa/HERO_TRANSFER_AUDIT.json：实际源码、进度、每英雄证据与缺项。
2. 01_CURRENT_RULES.md → 02_CURRENT_HEROES.md → 03_CURRENT_MUTATIONS.md：现行玩法。
3. 09_CURRENT_GAME_MODES.md、04_CURRENT_UI_AND_FLOW.md：模式与UI边界。
4. 07_DESIGN_SCORING.md、08_SCORE_LEDGER.md：评分审计，不决定玩法。
5. SOURCE_REGISTER.json、MANIFEST.json、qa/INVARIANTS.json及review/invariants/LATEST.json：来源与实际合同证据。
6. 13–21号轮记录及qa/ACCEPTANCE_GAPS.json只保留历史；旧“未移交/等待”不覆盖本轮。

本轮产品发布eb27de059ccf7c5e91ca9bef8e0d0c5d103ea3e2；本地实际执行43e0b02fa622da8981edf514f956ce82061e3530；完整树7b7045a5390bf620956caf2b47de3c02e2df409e一致。470项测试通过，Web成功，127文件资源一致，8项准备态英雄浏览器操作通过；另9项模式基础入口回归通过。109既有合同106项有部分情景证据、3项规范检查，完整验收仍0。原始7份移交文件逐字节保存在rules/transferred/2026-10-07-r7-clean。

四处design-required：双窃时镜像；燃烧烈焰将帅与普通层级交叉；混乱乱斗首次发动/付费边界；龙鳞拦截后的落位。相应动作原子拒绝、不猜规则。其他英雄/畸变交叉、旧版本存局语义迁移、自然完整局、Android WebView和实体双机仍未完整验收。完整合同不由测试数量自动验收。

仓库aaaycc931-droid/jieqi-engine，分支codex/ui-android-apk-20261001。保留并发变更，不force/reset。PR #2仍open draft、不合main；批准首页/V4未改，最终视觉最后。无APK/互联网部署/未确认概率；旧整盘采样和模式独立英雄适配仍暂停。下一步先冻结四处缺项的正式定义，再按来源实现。
