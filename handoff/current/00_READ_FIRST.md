# 乐子象棋｜当前实现交接入口

现行规范 **LEZI-FUNCTION-2026-10-07-r5**；英雄原稿 **2026-10-07-r7-clean**。H01–H21确认部分已接入，本轮继续修复三处英雄交叉结算偏差，未新增规则。19表包、江鹤/死亡骑士两里包、虔信狂徒五固定形态保持。

读取顺序：

1. STATE.json、23_HERO_CROSS_SETTLEMENT_2026-10-08.md：本轮产品、三处修复与实际验证；22_HERO_TRANSFER_2026-10-07.md、qa/HERO_TRANSFER_AUDIT.json：正式英雄移交与四项设计缺口。
2. 01_CURRENT_RULES.md → 02_CURRENT_HEROES.md → 03_CURRENT_MUTATIONS.md：现行玩法。
3. 09_CURRENT_GAME_MODES.md、04_CURRENT_UI_AND_FLOW.md：模式与UI边界。
4. 07_DESIGN_SCORING.md、08_SCORE_LEDGER.md：评分审计，不决定玩法。
5. SOURCE_REGISTER.json、MANIFEST.json、qa/INVARIANTS.json及review/invariants/LATEST.json：来源与实际合同证据。
6. 13–22号轮记录仅说明各轮历史时点，不覆盖本轮产品状态。

产品发布e67590bd578b2c40d89faa6b1214c9d213c56043；本地执行3ff88a44c8808a792e65becd988174e2d98ae686；完整产品树4c748fa19e5fe44115aa27992b2f9eac15bc6756相同。478项测试通过（本轮新增8项）、Web成功、127文件资源一致。当前产品的8项英雄准备态DOM操作及9项模式基础入口检查重新通过，零页面/请求错误；CI源码/合同摘要与本地相符。109合同仍106部分证据、3非运行时、0完整验收。22号轮470等结果属于历史。

本轮修复：河道等自动死亡的狂意在公共闭合入账；风复归在技能安全/终局判断前闭合；递归裁决结果记录外层指令防止重复指令报错。详见23号轮八项引擎情景；浏览器准备态回归不宣称覆盖全部新边界。

四处design-required仍待：双窃时镜像、燃烧烈焰将帅层级交叉、混乱乱斗首次发动/付费、龙鳞拦截后的落位。完整英雄/畸变交叉、自然完整局、旧存局语义迁移、实体双机、Android WebView未完整验收。规则/原始移交来源未改，不以测试数量冒充完整验收。

仓库aaaycc931-droid/jieqi-engine，分支codex/ui-android-apk-20261001。保留并发变更，不force/reset；PR #2保持open draft，不合main。批准首页/V4保持，最终视觉最后。无APK/互联网部署。继续已确认来源的其他定点交叉审计；四项design-required须由正式设计来源补齐后再实现。旧整盘、主动技能整盘、模式独立适配、APK和最终视觉队列保持暂停。
