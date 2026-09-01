# 揭棋联机版交接说明（2026-08-31）

## 当前状态

- 本地试玩：`v0.4.0` 基线已扩展为英雄与畸变可选模式；
- Android 第二阶段（蓝牙完整链路）：已新增 Bluetooth Classic RFCOMM 单连接、主机/来宾状态机、断线回报、48 KiB 版本化 JSON 消息上限与受限 WebView 桥；网页大厅已经接入房主权威结算，完整支持猜拳、英雄、私有陷阱、走子、刺杀、臣服与终局演出；
- 联机准备：已完成纯 TypeScript 的服务端房间契约、权威结算、私有陷阱视图与公开状态净化；尚未创建或连接任何云环境；
- 依赖：Node.js 24+，无第三方依赖；
- 验证：`node --test --test-reporter=spec tests/*.test.ts`，当前应通过 116 项测试；`node scripts/build-web.ts` 与 `node android/scripts/sync-web-assets.mjs` 均已验证；
- GitHub `aaaycc931-droid/jieqi-engine` 的 `main` 为唯一代码源；后续开始前应先核对远端 HEAD。

## 入口文件

| 文件 | 用途 |
|---|---|
| `README.md` | 本地试玩与项目概览 |
| `RULES-CHANGELOG.md` | 已确认规则的变更记录 |
| `ONLINE-ARCHITECTURE.md` | 中国玩家联机的 CloudBase 架构与数据边界 |
| `HERO-MUTATION-SPEC.md` | 三名英雄、六项畸变、复合结算与新增测试的下一版本代码规格 |
| `src/remote-room.ts` | 可迁入云函数的房间、猜拳、权威操作契约 |
| `tests/remote-room.test.ts` | 邀请口令、公开数据、猜拳与自动终局的联机边界测试 |
| `android/` | Android WebView 外壳、Bluetooth Classic RFCOMM 通信基础、桥接与资源同步脚本 |
| `src/bluetooth-protocol.ts` | 原生 RFCOMM 与网页共享的版本化 JSON 协议校验 |
| `tests/bluetooth-protocol.test.ts` | 协议版本、类型、大小限制与快照边界测试 |
| `src/bluetooth-host-room.ts` | 仅在房主 WebView 运行的权威房间协调器 |
| `tests/bluetooth-host-room.test.ts` | 跨端 SHA-256、猜拳隐私与公开棋盘边界测试 |
| `../jieqi_rules_spec_v1.md` | 随交接包附带的规则冻结稿 |

## 已冻结的关键规则

- 双方将/帅明牌，其余 30 枚棋子全局混洗；
- 首次暗子移动遵循其初始位置兵种走法，移动后翻开；翻开后按真实颜色与兵种控制；
- 暗子可吃任意暗子（含己方），已揭同方棋子不可吃；将/帅不允许普通吃掉；
- 猜拳胜者为红方并先走，平局重猜；
- 暗子翻出对方棋并直接将军为「背刺」；普通将死为「裁决」；困毙为「无处可逃」；认输为「臣服」；
- 背刺与裁决自动播放终结吃将动画，再显示胜利文案；
- 断线结算名称为「虚空放逐」，但超时规则尚未决定，因此尚未实现。

## 英雄与畸变（已实现）

- 房间可分别开启英雄与畸变，基础模式默认全部关闭；
- 猜拳后双方可秘密锁定英雄，同英雄合法，双方锁定后才公开；
- 畸变开启时服务器随机公开唯一畸变；
- 猎人在开局前可在己方半场私下布置两层陷阱，重叠合法；
- `playerRoomView(room, playerId)` 只返回调用者自己的未公开英雄选择和陷阱，`publicRemoteRoom` 不包含这些秘密；
- `GameState.effectsByPieceId` 与 `GameState.assassination` 是公开、按棋子 ID 持久化的通用效果框架；旧棋局缺省时等同于空状态；
- 潜行者“刺杀”与“暗影之舞”次数来源相互独立；`submitRemoteAssassination` 在房间事务中完成首次走子、隐身或强击；
- 隐身棋占据落点但不阻挡路线，也不产生攻击/将军；普通行动不能捕获或移动隐身棋，强击可以清除效果并击杀；
- 隐身在之后两个己方正式回合递减；隐身棋主动行动后解除，普通行动会放弃强击；
- 猎人陷阱会在权威落位后按行动前后控制权触发；同格叠层逐层消耗，第十个敌方正式回合结算后失效；将帅踩中即为“伏击”。
- 战士前两枚离开己方九宫的非将帅明棋获得防护壁垒；普通吃子弹回；进入敌方半场后两次成功移动衰减；铁甲会挡一次背刺并给予额外应将。
- 六项畸变均已进入走法、将军与终局：铁马、铁壁、暗影之舞、战车、出征、骑兵。
- 路径碾碎按顺序公开记录，支持隐身路径棋、普通防御无效、乱杀、两败俱伤与“碾碎他们！”。
- 本地网页已增加英雄/畸变下拉选择、猎人私下布置、刺杀来源选择与强击按钮；它仍是同设备轮流试玩，未接入真正的远程数据库。

## 当前可玩状态与下一步

Android 通信基础已就绪：`BluetoothGameSession` 使用固定 UUID 的 RFCOMM 服务，房主监听、来宾连接；`GameWebBridge` 仅公开 `host`、`join`、`pairedDevices`、`send`、`disconnect` 和状态事件。用户先在系统设置配对，应用只读取已配对设备，故不扫描周边设备也不申请定位权限。

`BluetoothHostRoom` 已复用现有 `RemoteRoom` 权威事务：物理连接建立后自动进入秘密猜拳，房主保存完整状态和 admission secret；来宾只能提交操作并读取 `playerRoomView`，暗子身份、未触发陷阱和未锁定的英雄选择不会进入其快照。`remote-room.ts` 的 SHA-256 已替换为浏览器可运行的同步实现，因此后续 WebView 不再受 `node:crypto` 阻塞。

网页 UI 已接入该通道：房主 WebView 维护完整 `RemoteRoom` 与随机源，来宾以 `action` 提交猜拳/英雄/陷阱/移动/刺杀/臣服；房主以 `playerRoomView` 生成公开快照和各自私有视图后广播。两台已配对 Android 手机可完整对局；双方的未揭身份、未触发陷阱和未锁定英雄不会跨端传输。

下一步应在两台真实 Android 手机上各装一次 APK，完整走一局并记录 Bluetooth Classic 在目标机型上的连接表现。当前工作区没有 Android SDK、Gradle 或真机，故不能在这里生成 APK 或完成射频层实测。

远程互联网联机仍可在另一条路线中接入 CloudBase 云函数、房间公开文档与每位玩家私有陷阱子文档；这需要实际腾讯云/CloudBase 账号和部署权限。其余纯规则工作应以新增英雄、畸变或对局回放为主，并保持 `npm run check` 全绿。
