# 当前控制权限源码审计与定点修复｜2026-10-07

用户2026-10-07 10:18:37（Asia/Shanghai）确认“同意”，继续上一轮保存的当前控制权限审计。实现前远端与本地均为23d764a4046752c4ea0408afec460473f3b77efa，无并发差异，未force/reset；同一工作分支codex/ui-android-apk-20261001。

规则保持LEZI-FUNCTION-2026-10-06-r4，规范摘要cf831ebe7872cb9d8ed55fa3b4edb7f03492b3c90a06c8d9be494ac9a9e9284f。01–04、09和rules/confirmed未改。源码af5e411d49099c2f5b936e6dde004b6f5e50059d，上一源码364b711f522be18c6c636e59a3df5e02844092c7；本地执行14de414e76862d2adb8d014f66eae6f80bc8da3c与发布源码完整树均为d9b682eaae0de8dc497296af1d2784f0eeca66ad，文档另行提交。现有12英雄/9畸变规则及明确真实读取例外保留，未接入其他对话的设计。

## 审计结论与差分

现有getController只读公开棋位控制、揭示后color及来源定义的河道coveredIdentity.controller，不接受SecretState。此次源码检查没有发现现有普通控制调用偷读【混乱】秘密阵营的确定缺陷；不能把补测或来源标记写成“修复了已经泄露的阵营”。两项具体工程差分：

1. effectiveIdentity原本没有来源参数，后续调用不能在接口处判断是否明确获准。现在必须传入TrueIdentityReadSource，缺失/未知来源在接触秘密前拒绝；批次预检及实际死亡使用death:reveal，宿命初始化使用mutation:end_time:initialization，风暗子池使用hero:wind:covered_carrier。普通当前兵种继续调用getCurrentPieceType，控制继续调用getController。
2. 网页无限龙候选只看已现身/公开颜色/宿命标签，遗漏弹药；权威入口已经要求一枚弹药。新getBombers按公开已现身、当前控制、宿命类型和ammunition=1筛单棋资格，网页菜单与权威共用。旧真实菜单函数在轻量DOM实跑显示[bomber, spent]，新函数仅[bomber]，复现记录review/invariants/CURRENT_CONTROL_UI_REPRO_2026-10-07.json。没有改弹药数、距离、全军一次限制或技能效果。

来源标记是可信权威代码的调用约束，不是安全令牌：掌握SecretState的代码仍须经过规范审计，不能靠伪造已知标签获得新玩法许可。普通客户端HeroAbilityCommand没有这个身份读取参数。增加新来源前必须正式移交并核对明确许可；本轮不开放未来英雄自动读取。

## 现有源码读取映射

| 范围/入口 | 读取语义和时点 | 权限/结论 |
| --- | --- | --- |
| slots.getController/getMovementIdentity；rules走法、目标、将军、提示 | 暗子当前棋位控制，揭示后公开color，河道来源公开controller；每次判定当前状态 | 普通公开，不读identities；暗目标可吃包括己方暗子，不以隐藏颜色限制 |
| 普通移动/刺杀/战车/铁马、战士资格、太子/雨夜 | 当前行动控制；公开身份/正式历史；真实揭示后重新按公开色判定 | 保留已有来源条件及公开保护，无新增秘密分支；不能把所有“己方/敌方”强行改成统一新含义 |
| game.requireIdentity | 成功落位的暗来源普通移动/刺杀正式揭示 | 明确揭示许可，私有函数只在已提交落位路径调用；拒绝/弹回不提前读取公开身份 |
| settlement.destroyPiece及批次预检 | 实际死亡对象身份；先冻结当时公开controller，再执行死亡揭示 | 明确死亡许可；混乱记录兵种而秘密颜色隐藏，public color为冻结控制；automaticEvents.side保存该时点 |
| generateGhosts；ghosts精确资源/感染 | 生成读死亡事件side快照；感染读当前地面敌棋控制；资源必须种类+公开归属 | 不重读秘密或当前重用同ID对象，普通/里独立，不新增数值收益 |
| queueLanding/settleLandings与控制陷阱 | event.beforeController与落位/揭示后的getController | 两时点按既有规则都检查，不沿用隐藏原色；移置后按新棋位重新判定 |
| 回合开始、飞行/崩坏/感染等持续 | 当前作用时点控制；开始混乱只在秘密层刷新阵营；全局正式次数公开 | 不以秘密刷新改变普通控制，当前方计时及死亡归属有情景验证 |
| 风明子候选/暗子随机池 | 明子公开阵营及拥有者私有承载ID；暗子隐藏真实归属 | 暗池为02 §9.3明确许可，保留；普通目标提示不读真正主帅身份，公共状态/敌方视图不因影发动变化 |
| 风真实主帅终局、流归位 | 权威trueGenerals/wind身份锚点，仅用于实际主帅死亡/归位 | 02 §9明确许可，不借其限制公开普通棋子的合法目标；旧专属TARGET-WIND/BATCH/FLOW证据保留 |
| 宿命初始化、沙漏、补弹与投弹 | 初始化真实兵/归属；之后只作用已现身宿命对象，锚点和身份留在权威缓存；投弹单棋资格读公开当前控制/弹药 | 03宿命明确初始化许可，不能改为暗置兵或棋位色；UI不列未现身棋、零弹药棋、另一控制方或河道棋 |
| 历史/回溯、请求去重 | 完整权威私有快照及传输去重，不用秘密阵营决定普通目标 | 原权限保存；私有history/identities不进入公共Room/View，不能将复制恢复当作新公开读取 |
| publicRemoteRoom/playerRoomView/BluetoothHostRoom | 公共state；玩家座位映射的ownTraps及ownerHeroSecrets | 只给拥有者自己的秘密；对同一公开状态、不同未授权隐藏颜色，公开及双方编码一致 |
| web/app棋盘、目标、技能状态/菜单、吃子、换手 | 公开GameState及共享公开目标函数；风只读自己许可私有标记；混乱死亡未知色独立显示 | 未用identities筛UI；投弹资格定点修复；实际菜单函数执行有证据，但没有新增浏览器/换手机/实机验收 |
| setup/modes、RPS和准备阶段 | 权威生成/分配身份与当前确认模式开局，不作为行棋时当前控制读取 | 保留模式基础方案，半混乱/普通象棋完整英雄畸变适配队列仍暂停 |

源码范围为当前src、web的SecretState/identities/effectiveIdentity/getController/color引用及房间私有视图，不包括未来未移交来源。current-control源码审计范围已完成，不声称每种交叉或全称信息安全合同已证明。

## 执行证据与限制

新增15项R4-CONTROL-01–15，覆盖当前位置控制、普通/强击提示与非法错误、混乱进攻死亡记录、陷阱前后控制、暗置移置新控制、亡魂死亡时点快照、感染与持续计时、资源/双方编码、真实来源缺失/未知拒绝、风/宿命真实许可，以及真实投弹/影菜单函数执行。测试夹具中的暗置移置或已附着持续不冒作已移交英雄自然流程；真实菜单在轻量DOM里执行，不冒作Chromium浏览器或布局验收。

npm run check：416 passed、0 failed，Web构建成功；合同执行器416通过。109合同105部分情景证据、1缺专属测试（ADD-HERO-FORM-001）、3规范检查，完整验收0。121个Android内置资源与dist逐字节一致，未构建APK。LATEST保留实际执行HEAD和源码/合同摘要，与GitHub发布完整树一致。

未改首页/V4的HTML、CSS和美术；只是技能对象判定共用。没有新增浏览器、实体WebView/双机验收，旧CI不适用于新源码。getBombers只表示公开单棋资格，主行动前窗口、全军每回合次数及权威宿命缓存一致性仍在applyHeroAbility检查，不将“在菜单里”当作整条命令保证成功。

下一项：完整表/里形态公共模型与整局所选形态合同；未移交的里英雄技能包、数值和新选择UI不自动导入。现有源码已审计不等于未来来源自动获准。旧完整实战/新模式独立适配保持暂停，UI最后、APK暂停、不合并main、不部署互联网、不自设评分/概率/稀有度、不发选项卡。
