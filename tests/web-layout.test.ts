import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/style.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../web/app.ts", import.meta.url), "utf8");
const androidActivity = readFileSync(new URL("../android/app/src/main/java/com/jieqi/bluetooth/MainActivity.java", import.meta.url), "utf8");
const androidBridge = readFileSync(new URL("../android/app/src/main/java/com/jieqi/bluetooth/GameWebBridge.java", import.meta.url), "utf8");

test("UI-MENU-01 主菜单与蓝牙大厅是两个独立页面", () => {
  assert.match(html, /id="main-menu-view"/);
  assert.match(html, /id="lobby-view"[^>]*hidden/);
  assert.match(app, /function showBluetoothLobby\(\)/);
  assert.match(app, /bluetooth-menu-button"\)\.addEventListener\("click", showBluetoothLobby\)/);
});

test("UI-MENU-02 主菜单保留四个现行入口和独立设置入口", () => {
  for (const label of ["本机双人", "蓝牙对局", "联机对战", "玩法说明"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.match(html, /id="settings-menu-button"/);
  assert.match(html, /id="online-game-button"[^>]*aria-disabled="true"/);
  assert.match(app, /联机对战尚未开放/);
});

test("UI-MENU-03 设置页只使用现行三项并即时保存", () => {
  for (const label of ["音效", "触感反馈", "减少动画"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.doesNotMatch(html, />语音</);
  assert.match(app, /UI_PREFERENCES_KEY/);
  assert.match(app, /addEventListener\("change", saveUiPreferences\)/);
});

test("UI-RULES-01 玩法说明使用独立四分类滚动页而非占位弹窗", () => {
  assert.match(html, /id="rules-view"[^>]*hidden/);
  for (const label of ["基础玩法", "英雄技能", "畸变规则", "联机规则"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.match(app, /function showRules\(\)/);
  assert.match(app, /rules-menu-button"\)\.addEventListener\("click", showRules\)/);
  assert.match(css, /\.rules-scroll\s*\{[^}]*overflow-y:\s*auto/s);
});

test("UI-MENU-04 首页采用批准的原图窗口，其余页面保留独立水墨组件", () => {
  assert.match(css, /paper-background\.png/);
  assert.match(css, /status-panel-frame\.png/);
  assert.doesNotMatch(html + css, /国风象棋主菜单按钮下移|乐子象棋三屏响应式菜单对比|乐子象棋主菜单\.png/);
});

test("UI-MENU-05 设置及其余页面继续复用已有独立透明组件", () => {
  const assets = [
    "label-bluetooth.png",
    "label-rules.png",
    "label-create.png",
    "label-join.png",
    "title-settings.png",
    "label-reset.png",
    "icon-settings.png",
    "icon-back.png",
    "decoration-footer.png",
  ];
  for (const asset of assets) {
    const png = readFileSync(new URL(`../web/assets/menu-v1/${asset}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.match(html, new RegExp(`assets/menu-v1/${asset.replace(".", "\\.")}`));
  }
});

test("UI-BT-01 蓝牙关闭、未授权和永久拒绝都有独立页面状态", () => {
  for (const id of ["bluetooth-enable-button", "bluetooth-permission-button", "bluetooth-app-settings-button"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /status\.enabled === false/);
  assert.match(app, /status\.permissionGranted === false/);
  assert.match(app, /detail\.permanentlyDenied/);
  assert.match(androidBridge, /permissionGranted/);
  assert.match(androidBridge, /permanentlyDenied/);
});

test("UI-BT-02 蓝牙大厅复用现行书法组件和无光晕返回控件", () => {
  assert.match(html, /id="lobby-title" class="visually-hidden">蓝牙对局/);
  assert.match(html, /label-create\.png/);
  assert.match(html, /label-join\.png/);
  assert.match(html, /id="bluetooth-back-button"[\s\S]*?icon-back\.png/);
});

test("UI-BT-03 创建、连接、失败与取消使用同页状态面板", () => {
  for (const id of [
    "bluetooth-session-panel",
    "bluetooth-session-title",
    "bluetooth-session-device",
    "bluetooth-retry-button",
    "bluetooth-cancel-button",
    "bluetooth-return-button",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /function showBluetoothSessionState\(/);
  assert.match(app, /detail\.state === "LISTENING"/);
  assert.match(app, /detail\.state === "CONNECTING"/);
  assert.match(app, /title: "连接失败"/);
  assert.match(app, /function retryBluetoothConnection\(/);
  assert.match(app, /function leaveBluetoothLobby\(\)/);
  assert.match(app, /没有找到已配对设备/);
  assert.match(app, /bluetooth-join-button"\)\.disabled = devices\.length === 0/);
  assert.match(androidBridge, /value\.put\("deviceName"/);
});

test("UI-SETTINGS-01 Android 本机允许保存现行设置", () => {
  assert.match(androidActivity, /setDomStorageEnabled\(true\)/);
  assert.match(app, /localStorage\.setItem\(UI_PREFERENCES_KEY/);
});

test("UI-SETTINGS-02 设置页使用书法标题、独立返回组件和水墨开关", () => {
  assert.match(html, /id="settings-title" class="visually-hidden">设置/);
  assert.match(html, /title-settings\.png/);
  assert.match(html, /label-reset\.png/);
  assert.match(css, /\.settings-row input\s*\{[^}]*appearance:\s*none/s);
  assert.match(css, /avatar-frame\.png/);
});

test("UI-NAV-01 Android 返回键先交给页面处理，主菜单再退出应用", () => {
  assert.match(androidActivity, /window\.handleLeziBack&&window\.handleLeziBack\(\)/);
  assert.match(app, /handleLeziBack = handleSystemBack/);
  assert.match(app, /if \(!settingsView\.hidden\)/);
  assert.match(app, /if \(!bluetoothLobbyView\.hidden\)/);
  assert.match(app, /return false;\s*\n\}/);
});

test("UI-HERO-01 英雄选择是猜拳前的独立整页流程", () => {
  assert.ok(html.indexOf('id="hero-view"') < html.indexOf('id="rps-view"'));
  assert.match(html, /id="hero-confirm-button"[^>]*disabled/);
  assert.match(app, /beginLocalHeroSelection\(\)/);
  assert.match(app, /HERO_SELECTION_DURATION_MS/);
});

test("UI-HERO-02 竖屏英雄页按四分之一详情与四分之三六列网格布局", () => {
  assert.match(css, /\.hero-selection-view\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) minmax\(0, 3fr\)/s);
  assert.match(css, /\.hero-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6,/s);
  assert.match(css, /\.hero-grid\s*\{[^}]*overflow:\s*hidden/s);
});

test("UI-HERO-03 英雄页使用宣纸与独立水墨框且不擅自定稿正式画像", () => {
  assert.match(html, /id="hero-back-button"[\s\S]*?icon-back\.png/);
  assert.match(html, /id="hero-detail-avatar"[^>]*英雄形象尚未定稿/);
  assert.match(css, /\.hero-selection-view\s*\{[^}]*paper-background\.png/s);
  assert.match(css, /\.hero-detail-panel\s*\{[^}]*status-panel-frame\.png/s);
  assert.match(css, /\.hero-art-placeholder\s*\{[^}]*avatar-frame\.png/s);
  assert.doesNotMatch(css, /\.hero-detail-panel[^}]*border-radius/s);
});

test("UI-HERO-04 本机双人逐人获得六十秒且超时只处理当前接手玩家", () => {
  assert.match(app, /showDialog\("英雄已确定"[\s\S]*?heroSelectionDeadlineAt = Date\.now\(\) \+ HERO_SELECTION_DURATION_MS/s);
  assert.match(app, /const timedOutActor = localHeroActor/);
  assert.match(app, /localHeroChoices\[timedOutActor\] = selected/);
  assert.doesNotMatch(app, /for \(const player of \[PLAYER_ONE, PLAYER_TWO\]\)[\s\S]*?localHeroChoices\[player\]/);
});

test("UI-HERO-05 入场后才开放带撤回与确定的六十秒战斗准备", () => {
  assert.ok(html.indexOf('id="opening-sequence"') < html.indexOf('id="hero-preparation-panel"'));
  assert.match(html, /id="trap-undo-button"[^>]*>撤回</);
  assert.match(html, /id="preparation-confirm-button"[^>]*>锁定陷阱</);
  assert.match(app, /HERO_PREPARATION_DURATION_MS/);
});

test("UI-HERO-06 英雄准备复用正式棋盘和顶部倒计时且不以圆角卡片遮挡棋盘", () => {
  assert.match(html, /id="battle-board" class="v4-board"/);
  assert.match(css, /\.hero-preparation-panel\s*\{[^}]*top:\s*61\.7%/s);
  assert.match(css, /\.hero-preparation-panel\s*\{[^}]*status-panel-frame\.png/s);
  assert.match(css, /\.hero-preparation-panel\s*\{[^}]*border-radius:\s*0/s);
  assert.doesNotMatch(html, /class="v4-captured-panel"/);
  assert.match(app, /battleTurnTimer\.setAttribute\("aria-label", "英雄准备剩余秒数"\)/);
  assert.match(app, /battleTurnTimer\.textContent = String\(remaining\)/);
});

test("UI-HERO-07 猎人准备只标示当前方合法半场并将陷阱保持为秘密草稿", () => {
  assert.match(app, /const activeTrapSetupSide = remoteCanPrepare \? remoteSide : localPreparationActive \? trapSetupSide : undefined/);
  assert.match(app, /activeTrapSetupSide && isOwnHalf\(activeTrapSetupSide, position\)/);
  assert.match(app, /localPreparationActive \? localTrapDraft : \[\]/);
  assert.doesNotMatch(app, /localPreparationActive \? localTraps/);
  assert.match(app, /对方的陷阱位置不可见/);
  assert.match(css, /\.v4-board\.trap-preparing-red::after\s*\{[^}]*bottom:\s*1%/s);
  assert.match(css, /\.v4-board\.trap-preparing-black::after\s*\{[^}]*top:\s*1%/s);
});

test("UI-HERO-08 本机双猎人交接会清除上一方可见草稿且共享准备时限", () => {
  assert.match(app, /commitLocalTrapDraft\(completedSide\);\s*trapSetupSide = trapSetupQueue\.shift\(\);\s*localTrapDraft = \[\];/s);
  assert.match(app, /heroPreparationDeadlineAt = Date\.now\(\) \+ HERO_PREPARATION_DURATION_MS/);
  assert.doesNotMatch(app, /completeLocalHeroPreparation[\s\S]*?heroPreparationDeadlineAt = Date\.now\(\) \+ HERO_PREPARATION_DURATION_MS/);
  assert.match(app, /for \(const side of trapSetupQueue\)[\s\S]*?randomOwnHalfPosition\(side\)/s);
});

test("UI-MATCH-MENU-01 三点菜单从英雄选择起存在并按阶段切换现行条目", () => {
  for (const id of ["hero-more-button", "rps-more-button", "battle-more-button", "battle-action-menu"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const label of ["对局规则", "本局畸变", "退出对局", "认输"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  const menu = html.match(/id="battle-action-menu"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.doesNotMatch(menu, /继续对局|快捷消息|英雄技能说明|臣服/);
  assert.match(app, /type MatchMenuMode = "preplay" \| "opening" \| "playing"/);
  assert.match(app, /matchMutationButton\.hidden = mode === "preplay"/);
  assert.match(app, /matchExitButton\.hidden = mode === "playing"/);
  assert.match(app, /resignButton\.hidden = mode !== "playing"/);
});

test("UI-MATCH-MENU-02 规则与畸变使用可滚动中央宣纸覆盖层而非跳转页面", () => {
  assert.match(html, /id="match-detail-layer"[^>]*aria-modal="true"/);
  assert.match(css, /\.match-detail-body\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.match-detail-panel\s*\{[^}]*status-panel-frame\.png/s);
  assert.match(css, /\.match-detail-panel\s*\{[^}]*border-radius:\s*0/s);
  assert.match(app, /function showMatchRules\(\)/);
  assert.match(app, /function showCurrentMutationDetails\(\)/);
  const detailsFunction = app.match(/function showMatchDetails\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(detailsFunction, /(battleTurnDeadlineAt|heroSelectionDeadlineAt|localRpsDeadlineAt)\s*=/);
});

test("UI-MATCH-MENU-03 菜单与详情锁定棋盘但返回键逐层关闭且断线层禁止打开", () => {
  assert.match(app, /if \(isMatchOverlayOpen\(\)\) return;/);
  assert.match(app, /if \(!disconnectLayer\.hidden\) return true;/);
  assert.match(app, /if \(!matchDetailLayer\.hidden\)[\s\S]*?closeMatchDetail\(\)/s);
  assert.match(app, /if \(!matchMenuLayer\.hidden\)[\s\S]*?setBattleActionMenu\(false\)/s);
  assert.match(app, /const shouldOpen = open && Boolean\(mode\) && disconnectLayer\.hidden/);
  assert.match(app, /battleMoreButton\.hidden = gameState\.status === "finished" \|\| gameState\.status === "execution"/);
});

test("UI-MATCH-MENU-04 认输和开局退出使用二次确认且联机退出立即权威判负", () => {
  assert.match(app, /确定要认输吗？认输后本局将立即结束。/);
  assert.match(app, /"确认认输"/);
  assert.match(app, /进入英雄选择后主动退出，本局将立即判负/);
  assert.match(app, /kind: "forfeit"/);
  assert.match(app, /forfeitOutcome\.loserPlayerId === ownPlayerId/);
  assert.doesNotMatch(app, /确定臣服吗/);
});

test("UI-MATCH-MENU-05 主动技能控件与三点菜单保持分离", () => {
  const actionMenu = html.match(/id="battle-action-menu"[\s\S]*?<\/nav>/)?.[0] ?? "";
  const skillPanel = html.match(/id="battle-skill-panel"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.doesNotMatch(actionMenu, /发动刺杀|发动强击|刺杀来源/);
  assert.match(skillPanel, /发动刺杀/);
  assert.match(skillPanel, /发动强击/);
  assert.match(app, /function activateRuntimeSkill/);
  assert.match(app, /assassination-button"\)\.click\(\)/);
});

test("UI-RESULT-01 正常终局保留棋盘并叠加非圆角水墨结果层", () => {
  assert.ok(html.indexOf('id="game-view"') < html.indexOf('id="match-result-layer"'));
  for (const id of ["match-result-heading", "match-result-type", "match-result-message", "match-result-winner", "match-result-rematch", "match-result-main-menu"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(css, /\.match-result-layer\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /\.match-result-panel\s*\{[^}]*status-panel-frame\.png/s);
  assert.match(css, /\.match-result-panel\s*\{[^}]*border-radius:\s*0/s);
  assert.match(app, /function showMatchResult\(\)/);
  assert.doesNotMatch(app, /showDialog\(finishTitle\(\), finishMessage\(\), "查看棋盘"/);
});

test("UI-RESULT-02 结果层区分胜负平并展示终局类型、胜方阵营玩家和英雄", () => {
  assert.match(app, /type resultOutcome|function resultOutcome\(\): "win" \| "loss" \| "draw"/);
  assert.match(app, /matchResultHeading\.textContent = outcome === "win" \? "胜利" : "失败"/);
  assert.match(app, /matchResultHeading\.textContent = "平局"/);
  assert.match(app, /matchResultType\.textContent/);
  assert.match(app, /matchResultPlayer\.textContent = resultPlayerName\(winner\)/);
  assert.match(app, /matchResultHero\.textContent = hero \? heroCatalog\[hero\]\.name/);
});

test("UI-RESULT-03 本机再来一局不等待第二人确认并完整重置到英雄选择", () => {
  assert.match(app, /function startRematchFromResult\(\)[\s\S]*?resetMatch\(\);\s*beginLocalHeroSelection\(\);/s);
  assert.doesNotMatch(app, /本机[\s\S]{0,80}等待对方确认/);
});

test("UI-RESULT-04 蓝牙再战离开旧棋盘并在已连接大厅进行三十秒邀请", () => {
  for (const id of ["bluetooth-rematch-timer", "bluetooth-rematch-request-button", "bluetooth-rematch-accept-button", "bluetooth-rematch-decline-button"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /showBluetoothRematchLobby/);
  assert.match(app, /kind: "rematch_request"/);
  assert.match(app, /kind: "rematch_response"/);
  assert.match(app, /对方已拒绝再战/);
  assert.match(app, /对方未响应再战请求/);
  assert.match(app, /重新选择英雄、猜拳，并重新随机本局畸变/);
  assert.doesNotMatch(app, /返回结果层/);
});

test("UI-RPS-01 猜拳使用三张独立透明水墨手势而非系统 emoji", () => {
  for (const asset of ["gesture-rock.png", "gesture-scissors.png", "gesture-paper.png"]) {
    const png = readFileSync(new URL(`../web/assets/rps-v1/${asset}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.match(html, new RegExp(`assets/rps-v1/${asset.replace(".", "\\.")}`));
  }
  assert.doesNotMatch(html, /✊|✌|✋/);
});

test("UI-RPS-02 选择与确认分离，确认后隐藏手势并保留三十秒权威倒计时", () => {
  assert.match(html, /id="rps-confirm-button"[^>]*disabled/);
  assert.match(html, /id="rps-selection-timer"[^>]*>30</);
  assert.match(app, /function selectRpsChoice\(/);
  assert.match(app, /function confirmRpsChoice\(/);
  assert.match(app, /RPS_SELECTION_DURATION_MS/);
  assert.match(css, /\.rps-choice\.locked img\s*\{[^}]*opacity:\s*0/s);
  assert.match(css, /\.rps-choice\.selected::before/);
});

test("UI-CHAT-01 收起消息条与半屏上展面板复用现行水墨战斗页", () => {
  for (const id of ["message-panel-toggle", "message-unread-dot", "message-drawer", "message-history", "message-drawer-close"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(css, /\.message-drawer\s*\{[\s\S]*?max-height:[^;]*50dvh/s);
  assert.match(css, /border-radius:\s*0/);
  assert.match(app, /messageDrawerOpen \|\| !matchMenuLayer\.hidden/);
  assert.match(app, /event\.clientY - messageSwipeStartY > 60/);
});

test("UI-CHAT-02 只保留最新版八条快捷语并与自定义消息共用两秒冷却", () => {
  const quickGrid = html.match(/id="quick-message-grid"[\s\S]*?<\/div>/)?.[0] ?? "";
  for (const message of ["你好！", "好棋！", "走得漂亮", "真险", "我再想想", "稍等一下", "谢谢", "承让"]) {
    assert.match(quickGrid, new RegExp(`>${message}<`));
  }
  assert.equal((quickGrid.match(/<button/g) ?? []).length, 8);
  for (const obsolete of ["轮到你了", "再来一局", "网络有点慢"]) assert.doesNotMatch(quickGrid, new RegExp(obsolete));
  assert.match(app, /CHAT_COOLDOWN_MS/);
  assert.match(app, /CHAT_MAX_CHARACTERS/);
  assert.match(app, /quickMessageArea\.hidden = !canChat/);
});

test("UI-CHAT-03 断线保留草稿、终局清空且键盘不重排棋盘", () => {
  assert.match(app, /const disconnected = isBluetoothTransportInterrupted\(\)/);
  assert.match(app, /disconnectOutcome[\s\S]*?messageInput\.value = ""/s);
  assert.match(app, /window\.visualViewport\?\.addEventListener\("resize", updateMessageKeyboardInset\)/);
  assert.match(css, /bottom:\s*var\(--message-keyboard-inset, 0px\)/);
  assert.match(html, /id="message-unread-dot" hidden/);
  assert.doesNotMatch(html, /message-unread-count/);
});

test("UI-CAPTURE-01 已吃入口已迁入双方状态栏且只统计对方离场棋子", () => {
  for (const id of ["red-captured-button", "black-captured-button", "red-captured-count", "black-captured-count"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /id="captured-panel"|id="captured-toggle"/);
  assert.match(app, /piece\.capturedBy === side && piece\.color !== side/);
  assert.match(app, /showCapturedDetails/);
  assert.match(css, /\.captured-detail-grid\s*\{[^}]*grid-template-columns:\s*repeat\(5,/s);
  assert.match(app, /尚未吃子/);
  assert.match(app, /红方.*蓝方/s);
});

test("UI-STATUS-01 英雄与技能详情展示固定规则和本局公开状态", () => {
  assert.match(html, /id="red-hero-avatar"[^>]*data-side="red"/);
  assert.match(html, /id="black-hero-avatar"[^>]*data-side="black"/);
  assert.match(app, /function showHeroDetails\(side: Side\)/);
  assert.match(app, /本局公开状态/);
  assert.match(app, /heroChargeAvailable/);
  assert.match(app, /mutationChargeAvailable/);
  assert.match(app, /ironArmorAvailable/);
  assert.doesNotMatch(app, /showHeroDetails[\s\S]{0,900}ownTraps/s);
});

test("UI-STATUS-02 主动技能单击发动、长按说明，对方与被动技能只开说明", () => {
  assert.match(app, /canActivateRuntimeSkill/);
  assert.match(app, /activateRuntimeSkill\(button\)/);
  assert.match(app, /showRuntimeSkillDetails\(button\)/);
  assert.match(app, /}, 550\)/);
  assert.match(app, /bluetooth\.view\.viewerSide !== side/);
  assert.match(app, /entry\.active/);
  assert.match(app, /英雄·刺杀/);
  assert.match(app, /畸变·刺杀/);
});

test("UI-EVENT-01 非终局事件按队列短暂显示且不锁棋盘或修改计时", () => {
  assert.match(html, /id="battle-event-cue"[^>]*hidden/);
  assert.match(app, /eventCueQueue\.push/);
  assert.match(app, /playNextEventCue\(\)/);
  assert.match(app, /}, 900\)/);
  for (const cue of ["碾碎", "防护壁垒破裂", "猎人陷阱触发", "将军", "强击发动", "刺杀发动"]) {
    assert.match(app, new RegExp(cue));
  }
  assert.match(css, /\.battle-event-cue\s*\{[^}]*pointer-events:\s*none/s);
  const queueFunction = app.match(/function queueFormalEventCues[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(queueFunction, /battleTurnDeadlineAt|pendingAction|isMatchOverlayOpen/);
});

test("UI-RULES-02 基础规则提供完整八阶段流程与七类棋子走法图", () => {
  const flow = html.match(/class="rule-flow"[\s\S]*?<\/ol>/)?.[0] ?? "";
  for (const stage of ["选择英雄", "猜拳定红方", "揭示畸变", "英雄入场", "英雄准备", "正式行棋", "终局结算", "再战或返回"]) {
    assert.match(flow, new RegExp(`>${stage}<`));
  }
  assert.equal((flow.match(/<li>/g) ?? []).length, 8);
  assert.match(html, /id="piece-movement-grid"[^>]*七类棋子走法图/);
  const guideDefinitions = app.match(/const movementGuides[\s\S]*?\] as const;/)?.[0] ?? "";
  for (const guide of ["rook", "horse", "cannon", "pawn", "general", "advisor", "elephant"]) {
    assert.match(guideDefinitions, new RegExp(`id: "${guide}"`));
  }
  assert.equal((guideDefinitions.match(/\bid: "/g) ?? []).length, 7);
});

test("UI-RULES-03 走法图反映现行乐子象棋规则而非传统规则占位", () => {
  for (const rule of ["马腿", "炮架", "真实阵营", "九宫", "明仕", "可离开九宫", "明相", "可以过河"]) {
    assert.match(app, new RegExp(rule));
  }
  assert.match(app, /document\.createElementNS\(SVG_NAMESPACE, "svg"\)/);
  assert.match(app, /svg\.setAttribute\("viewBox", "0 0 200 200"\)/);
  assert.match(css, /\.movement-card\s*\{[^}]*border-radius:\s*0/s);
  assert.match(css, /\.rule-diagram-panel\s*\{[^}]*status-panel-frame\.png/s);
});

test("UI-RULES-04 规则图支持卡片放大、显式关闭、遮罩关闭与系统返回逐层关闭", () => {
  for (const id of ["rule-diagram-layer", "rule-diagram-title", "rule-diagram-art", "rule-diagram-description", "rule-diagram-close", "rule-diagram-scrim"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /button\.addEventListener\("click", \(\) => openRuleDiagram\(guide\.id\)\)/);
  assert.match(app, /rule-diagram-close"\)\.addEventListener\("click", closeRuleDiagram\)/);
  assert.match(app, /rule-diagram-scrim"\)\.addEventListener\("click", closeRuleDiagram\)/);
  assert.match(app, /if \(!ruleDiagramLayer\.hidden\) \{\s*closeRuleDiagram\(\);\s*return true;/s);
  assert.match(css, /\.rule-diagram-layer\[hidden\]\s*\{\s*display:\s*none/);
});
