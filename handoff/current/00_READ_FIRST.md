# 乐子象棋｜当前实现交接入口

已收到2026-10-07英雄设计正式实现移交。当前规范为 **LEZI-FUNCTION-2026-10-07-r5**；英雄原稿为2026-10-07-r7-clean。H01–H21已经移交，本包内英雄/里形态可按确认稿实现；其他未移交规则不自动导入。

读取顺序：

1. 22_HERO_TRANSFER_2026-10-07.md、STATE.json、qa/HERO_TRANSFER_AUDIT.json：本轮范围、差分、实际进度。
2. 01_CURRENT_RULES.md → 02_CURRENT_HEROES.md → 03_CURRENT_MUTATIONS.md：现行玩法。
3. 09_CURRENT_GAME_MODES.md、04_CURRENT_UI_AND_FLOW.md：模式与已确认UI边界。
4. 07_DESIGN_SCORING.md、08_SCORE_LEDGER.md：评分审计，不决定玩法。
5. SOURCE_REGISTER.json、MANIFEST.json、qa/INVARIANTS.json：来源与合同。
6. 13–21号文件及review/invariants/LATEST.json：历史实际执行证据。

远端起点333c94e；本轮差分与实现推进中。此前434通过/122资源来自20号产品树，不能证明新英雄语义。新规范登记不等于运行时验收。源码提交、实际执行提交、发布提交与完整树身份分别记录，禁止force/reset覆盖并发变更。

仓库aaaycc931-droid/jieqi-engine，分支codex/ui-android-apk-20261001。Draft PR #2保持open draft，不合main。保留批准首页/V4；功能UI达到可操作，最终视觉最后。无APK/互联网部署/未确认概率/评分驱动平衡设计。三个模式专项独立英雄畸变适配及旧完整随机对局采样继续暂停。

H07双方爪牙镜像、H21龙鳞阻止致死后的最终落位保持未决；不要从旧版本填空。继续其他已确认能力，无需反复请求例行批准。
