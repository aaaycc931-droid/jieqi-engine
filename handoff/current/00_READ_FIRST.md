# 乐子象棋｜当前实现交接入口

现行规范 **LEZI-FUNCTION-2026-10-07-r5**；英雄原稿 **2026-10-07-r7-clean**。H01–H21确认部分已接入，本轮修复衍生进攻弹回漏计原正式回合与防御寿命，未新增规则。19表包、江鹤/死亡骑士两里包、虔信狂徒五固定形态保持。

读取顺序：

1. STATE.json、24_HERO_CHILD_BOUNDARY_2026-10-08.md：本轮产品与实际验证；23_HERO_CROSS_SETTLEMENT_2026-10-08.md：上一轮三处交叉修复；22_HERO_TRANSFER_2026-10-07.md、qa/HERO_TRANSFER_AUDIT.json：正式英雄移交与四项设计缺口。
2. 01_CURRENT_RULES.md → 02_CURRENT_HEROES.md → 03_CURRENT_MUTATIONS.md：现行玩法。
3. 09_CURRENT_GAME_MODES.md、04_CURRENT_UI_AND_FLOW.md：模式与UI边界。
4. 07_DESIGN_SCORING.md、08_SCORE_LEDGER.md：评分审计，不决定玩法。
5. SOURCE_REGISTER.json、MANIFEST.json、qa/INVARIANTS.json及review/invariants/LATEST.json：来源与实际合同证据。
6. 13–23号轮记录仅说明各轮历史时点，不覆盖本轮产品状态。

产品发布356ba577260bb4fd8228d134d5fd463c7e651919；本地执行a9cdcb57ddb853b1bb7e65e407fdf2a071564013；完整产品树0b87dbb00cd71c8f8681e215f04ecc75bb9b3992相同。481项测试通过（本轮新增3项）、Web成功、127文件资源一致。当前产品的9项英雄准备态DOM操作（新增冲锋弹回）及9项模式基础入口检查通过，零页面/请求错误；CI源码/合同摘要与本地相符。109合同仍106部分证据、3非运行时、0完整验收。22号轮470与23号轮478等结果属于历史。

本轮修复：衍生进攻被壁垒弹回后由上层统一结束原正式回合，避免底层先切对方回合而漏计；其他防御寿命恰好扣一次。三项引擎情景及一项新增实际DOM操作均通过。首次浏览器运行因准备态切换中断图片请求失败，评审等待修正后重跑；失败记录保留。

四处design-required仍待：双窃时镜像、燃烧烈焰将帅层级交叉、混乱乱斗首次发动/付费、龙鳞拦截后的落位。完整英雄/畸变交叉、自然完整局、旧存局语义迁移、实体双机、Android WebView未完整验收。规则/原始移交来源未改，不以测试数量冒充完整验收。

仓库aaaycc931-droid/jieqi-engine，分支codex/ui-android-apk-20261001。保留并发变更，不force/reset；PR #2保持open draft，不合main。批准首页/V4保持，最终视觉最后。无APK/互联网部署。继续已确认来源的其他定点交叉审计；四项design-required须由正式设计来源补齐后再实现。旧整盘、主动技能整盘、模式独立适配、APK和最终视觉队列保持暂停。
