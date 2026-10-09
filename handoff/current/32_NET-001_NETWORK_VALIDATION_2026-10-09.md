# NET-001｜现状核验与最小联网验证接续

文档 ID：LEZI-NET-001-2026-10-09。主要读取者：AI 与项目开发者。最新状态入口：`STATE.json.networking_validation`；本文件是审计/证据说明，不替换游戏总规则。更新日期：2026-10-09。

## A. 接续来源与授权差分

完整读取上传包的 `NET-001_WORK_HANDOFF.md`、`DECISIONS.json`、`WORK_START_PROMPT.txt`，原文保留在 `net/input/`。用户本轮明确接受其中平台规划、联网约束与优先级，要求从 NET-001.1 开始。主协作文档 `X_Collaboration_System` v1.8.0 单独激活，不写入本公开仓库；项目独立 `06_COLLABORATION.md` v1.1 不变。

| 分类 | 已确认差分 | 应用边界 |
| --- | --- | --- |
| 平台规划修改 | 未来微信生态为主要正式入口，优先研究小游戏，可能仅微信端 | APK/独立网页当前用于开发测试；不是必须三端同时正式运营 |
| 架构约束确认 | 游戏规则与平台 UI 解耦，服务端权威裁决，身份来源可替换 | 复用现有纯引擎/房间；尚未实现云端认证与存储 |
| 优先级修改 | 当前主任务 NET-001，Cloudflare 先测，香港备选；月成本尽量≤50元 | 允许独立可逆技术验证；不锁定生产服务商 |
| 阶段恢复 | 旧“互联网不实现/不部署”的绝对暂停改为允许 NET 技术准备与受控探测 | 游戏入口仍禁用；无公开游戏运营、正式发布、备案办理或收费订阅 |
| 保留 | 英雄/畸变/棋局、批准首页/V4、已有蓝牙成果 | 不删蓝牙，不改规则，不恢复整盘/UI/APK/模式独立适配队列 |
| 未确认 | 账号细节、匹配规则、香港服务商、验收阈值、微信平台具体能力 | 不能由本轮代码或参考模型补成产品决定 |

旧 `ONLINE-ARCHITECTURE.md` 上海 CloudBase + database watch + 匿名登录属于历史候选规划；没有云适配已交付证据。以新交接为当前候选方向，不再将 CloudBase 认作锁定首版。该调整没有游戏规则差分。

## B. NET-001.1 远端与交接核验：完成

- GitHub：[仓库](https://github.com/aaaycc931-droid/jieqi-engine)，默认 `main`，SHA `c25749d4f21d394c3d94486cfba1d786864083b6`。
- 实际开发分支 `codex/ui-android-apk-20261001`，SHA `8dadc67085ef8b4ff9b4bc7f5298dc857277c32d`；与旧交接观察一致。
- [PR #2](https://github.com/aaaycc931-droid/jieqi-engine/pull/2) 实时核验 `open / draft / unmerged`，HEAD 同上；不合并或更新其内容。
- 通过 GitHub 连接器元数据与 `git ls-remote`，随后克隆既有开发分支；没有 reset/force，克隆初始工作区干净；未发现适用 AGENTS.md。
- 旧上传交接包 `repository_snapshot/handoff/current` 中 15 个对应文件逐字节核对一致，差异 0。阅读现行入口、独立协作、STATE、相关 UI/进度、源码/协议与旧 ONLINE 规划；旧包未覆盖仓库。
- NET 新工作隔离在 `codex/net-001-validation-20261009`，从上述开发 HEAD 派生；避免和英雄实现分支并发写入。

### 实现清单

| 模块 | 核验状态 | 直接证据与实际限制 |
| --- | --- | --- |
| 权威玩法/裁决 | 已实现，部分场景验证；非全部验收 | `src/game.ts`、`room.ts`、`hero-*.ts`、`settlement*.ts`；当前 r5 + 四增量；本轮原有514项通过，0新增玩法用例 |
| 房间/两席/邀请口令 | 核心已实现，互联网服务部分未实现 | `src/remote-room.ts` `createRemoteRoom` / `joinRemoteRoom` / `hashInviteToken`；纯状态函数，无数据库事务执行器 |
| 幂等与版本检查 | 已实现引擎契约 | `src/room.ts`、`remote-room.ts` 中 actionId / expectedRevision；真实云并发事务、重试交付未实现 |
| 私有信息边界 | 已实现公共/本人视图 | `publicRemoteRoom` / `playerRoomView`、`src/game.ts` 公共净化；真实网络部署的鉴权/日志隔离待接入验证 |
| 断线、计时、恢复、再战 | 房间函数与蓝牙接入已实现 | `disconnectRemotePlayer` / `reconnectRemotePlayer` / `advanceRemoteRoomTime`；需要互联网传输检测与服务端调度适配，不能直接从旧蓝牙判定整个互联网行为完成 |
| 蓝牙通信 | 实现与序列化情景证据；真机待验收 | `src/bluetooth-host-room.ts` 复用核心；`bluetooth-protocol.ts` v2 + Android RFCOMM；房主持有秘密，非云端权威 |
| 互联网客户端 | 未接入 | `web/index.html` online 按钮不可用；`web/app.ts` 点击仅提示尚未开放，没有游戏 fetch/WebSocket 适配 |
| Android Internet 权限 | 未加入 | `android/app/src/main/AndroidManifest.xml` 只含蓝牙权限；NET 独立工具不生成 APK |
| 云托管/WS/持久化 | 本轮前未实现 | 无 Cloudflare/Wrangler/D1/香港适配；只有旧 CloudBase 规划；本轮新增的 echo 服务不等于游戏后端 |
| 登录/邮件/微信身份 | 未实现 | 无玩家认证入口/发送模块；核心 playerId 是调用参数，未来服务端必须从可信会话取得身份，不能信任客户端传入值 |
| 陌生匹配/好友账号体系 | 未实现 | 邀请加入房间契约可复用；无互联网匹配队列、好友关系或跨端身份映射 |
| 微信小游戏适配 | 未实现 | 尚无小游戏工程/SDK/官方真机验收；消息协议可移植是架构选择，不是平台通过 |
| NET 实测工具 | 本轮新增；本地功能已验证 | `net/probe/`，与游戏本体分离；没有大陆真实数据 |

根 README 中旧12英雄/298测试、ONLINE 中断线“待定”均不能覆盖现行 STATE 与源码；不顺手全局重写历史。当前19基础英雄/21来源条目、规则 r5+四增量、游戏完整验收0保持原值。

## C. NET-001.2：本地工具完成，部署与大陆实测待执行

实现 `net/probe/`：HTTPS 服务配置准备、HTTP echo、WS echo、共享协议、Hibernation DO、香港 Node 服务、中文页面、Node CLI、结果 JSON、原始样本聚合、不同载荷参考、自动重连与人工恢复标记。配置与操作见 [工具说明](../../net/probe/README.md)。本地检查用回环 HTTP/WS，不冒充公网 HTTPS/WSS。

测量保留成功/失败分母，RTT 单调时钟、中位数/P95/最大值、相邻成功 RTT 最大变化、WS 建连统计、意外断开、每连接持续时间、恢复到首个有效 echo。浏览器 DNS/TLS 不能完全隔离，缺值为 null；CLI另做小样本 DNS/TLS 检查。应用超时不等于包级丢包。不同地区/运营商/VPN/载荷分开汇总。

### 本轮实际证据

- `review/net/BASELINE_AUDIT_2026-10-09.json`：原有 514 引擎/静态通过，0新增游戏用例；Web 构建成功。未重写旧产品验证报告，不将本轮检查提升为新玩法/真机验收。
- 新探测测试：HTTP鉴权/大小边界、真实HTTP/WS、P95失败分母、意外断开自动恢复、主动重连分类、无效凭证失败、停止保留、成本边界，以及实际 workerd Worker+DO+Hibernation 互通。
- 默认 Wrangler 本地启动因容器 `uv_interface_addresses` 枚举权限失败；显式回环网卡枚举处理后，真实 workerd HTTP/WS 与重连通过。该环境处理不是大陆线路证据；默认 CI 不使用此标志。
- `wrangler deploy --dry-run` 打包成功；没有云端 deploy、没有账号写入、没有付款/套餐。
- 本地 Chromium 不存在，下载返回损坏归档；未在本地执行页面 DOM。独立 CI 中的真实页面检查另记录实际状态与提交，不把脚本存在视为通过。

最新检查结果读取 `review/net/PROBE_VALIDATION_2026-10-09.json`；CI / DOM 若稍后完成，以单独证据条目为准，不刷新旧游戏报告。

### 阻塞条件

| 待完成工作 | 需要的实际条件 |
| --- | --- |
| CF Free 技术节点部署 | 用户测试账号授权、确认为 Free、实际测试域名/子域配置；本轮没有可用凭证或已连接 CF 工具 |
| 大陆真实测试 | 电信/移动/联通真实用户设备或有说明的测点；本环境所在地及其代理不代表目标线路 |
| 香港 A/B | CF 结果/覆盖不足时，提供已有/获准的香港节点与直连域名；禁止自行付费购买 |
| 微信兼容性 | 原生小游戏官方资料、目标账号配置与真机；本轮官方 request/connectSocket 文档读取失败，不以普通小程序转载替代 |

未采集到大陆报告时 `mainland_samples=0`、`mainland_performance_measured=false`。验收参考500ms/60分钟/5秒依旧未锁定。

## D. NET-001.3：官方条款与模型部分完成

2026-10-09核对 Workers、DO、D1、静态资产、预算告警、DO位置、香港官方参考价。详见 `net/probe/README.md` 的一手链接与 `review/net/COST_SCENARIOS_2026-10-09.json`。

已核实：CF Free 有操作限额、超额受限；Paid有基础与超额费用；Hibernation能影响DO持续计费；预算告警不封顶。未核实：真实云用量、当前可买香港套餐/续费/线路、实际游戏快照大小、邮箱服务/投递、域名续费、微信平台费用/域名条件。人民币换算仅7.2假设值，不是实时价格保证。月成本≤50元尚未得到现实验证。

50/200/1000 DAU 是假设场景，不是已有玩家或峰值并发；同样人数因休眠能力不同可能跨预算，不能把 $5 直接写成固定总成本。探测阶段无发信/D1；账户/匹配实现服从先验证网络的顺序。

## E. NET-001.4：待实测，不作生产选型

已确认的是“CF先验证，香港同协议回退候选”；**尚无依据推荐任何一家为生产后端**。下一步以授权Free账号部署口令保护的技术echo节点，让大陆测试者首次访问并返回报告；再核对云用量，决定是否开展香港A/B。需要改游戏规则时停止依赖部分并请用户确认；当前没有规则改动。

## F. 局限检查与交接

协作门禁：L3_LIMITATION（依赖变化的外部配额/价格与跨端能力）。风险 medium；主张来源为用户已确认的NET交接、实际仓库源码/远端元数据、一手官方条款、本地测试。来源核验 V2，回环功能为限域现实验证，**不构成大陆线路/完整平台V4结论**。

关键反例：网页本身可达但DO路径慢；workers.dev失败而可控域名路径不同；HTTP被CORS阻断而WS可达；后台调度假装网络抖动；Paid告警存在但仍超预算。工具因此测DO路径、同源服务、记录前后台与真实恢复，成本同时列休眠与持续活跃分支。

未知：大陆真实表现、服务端真实游戏运算负载、生产账单和微信条件。验证状态 partial。授权边界：当前仓库独立分支和可逆探测准备；不购买、不公开运营、不合main、不恢复其他暂停工作。失败条件：秘密字段暴露、默认凭证开放、测量丢失败分母、把回环数据当大陆数据或将费用未知写成≤50保证，须停下修正。

本轮不修改个人主协作文档。已有游戏数据、规则、合同、UI、蓝牙源码与PR2保留。交接下一行动以 `STATE.networking_validation.next_action` 为准；游戏旧“等待新英雄”只属于玩法队列，不再冒充本轮总任务。
