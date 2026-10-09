# NET-REF-001｜外部部署参考差异评估

日期：2026-10-09（北京时间）。文档性质：外部技术参考与调查结论，**非正式架构决策**。主任务仍为 NET-001；项目入口为 `00_READ_FIRST.md` 与 `STATE.json.networking_validation`。

## 1. 来源与增量核验（NET-REF-001.1 完成）

用户本轮粘贴的完整参考文本保存于 `net/input/NET-REF-001_USER_REFERENCE.md`；原文本中的连排表格保留，没有替换为本评估意见。本轮完整读取该文本。其“视频直接展示”条目是**用户提供的摘要陈述**；本轮没有独立观看或逐帧核查原视频，也没有视频哈希、作者、时间戳或演示项目源代码，不能升级为本轮直接观察。

重新核对先前 NET 包三份原文，逐字节匹配上传 ZIP；现有43份交接摘要核验通过。已完成的源码审计详见32号，不重复开发和重跑既有功能。

GitHub实时 PR3 为 open/draft/unmerged，NET分支 HEAD `bcecc8299b6d0342a33ec29f65b56b030c00a2ac`，base 为既有游戏分支 `8dadc67085ef8b4ff9b4bc7f5298dc857277c32d`。`git ls-remote` 同时确认 main 仍为 `c25749d4f21d394c3d94486cfba1d786864083b6`。本地工作区初始干净，无并发改动；这是本轮开始的检查点，不是本文档提交的自指SHA。

已确认：微信小游戏优先、APK/网页用于开发测试、权威后端与平台解耦、CF先测/香港回退候选、尽量≤50元、暂不正式发布/备案。已实现：独立echo探测工具与本地/CI功能证据。未完成：云部署、大陆测量、游戏互联网接入、微信适配、账单核验。该参考不更改这些状态。

## 2. 技术适配（NET-REF-001.2 文档评估完成，实验部分待验证）

| 组件 | 与当前实现的差异 | 可复用性结论与证据级别 | 实际状态 |
| --- | --- | --- | --- |
| GitHub | 已有仓库、分支与PR；已有独立探测CI，未连接云自动部署 | 直接沿用现有版本管理，不新建仓库。CI成功不能证明云部署成功 | 已使用；云Git连接未配置 |
| Workers | 已有 `net/probe/worker.mjs` 的入口/HTTP/WS；没有游戏鉴权、房间事务或匹配 | 官方支持相应执行环境；可复用探测入口。用于真实游戏需要可信身份、调用原引擎、裁决与私有视图、幂等/版本及恢复适配 | 本地/CI验证echo，公网及游戏接入未完成 |
| Durable Objects（视频组合未列为必需） | 当前已采用SQLite DO + Hibernation；`session` 路由同一对象；未存棋局 | [S1]支持多客户端协调与一致存储。推论：是本候选里适合房间串行状态的构件；并非全球唯一方案。香港服务也可另行实现单房间权威进程与持久化 | 探测实现已测；两玩家权威对弈、休眠后棋局恢复、并发事务未测 |
| Pages | 当前测试页面由 Workers Static Assets 同源提供；`public/page.mjs`主动拒绝跨源节点 | [S2]支持Worker带静态文件。Pages可托管网页，但当前无新增必要。若拆成Pages前端+Worker后端，要配置同源代理或改适配/CORS，不能直接套用当前页面 | Pages未创建；无迁移 |
| Pages Functions | 不等于“只有静态网页”，可绑定D1/R2/DO | [S3]明确DO仍需在独立Worker创建/部署；[S4]Functions计入Workers配额。不能声称Pages完全不支持实时相关后端，也不能声称其独立完成房间 | 未配置 |
| D1 | 当前无绑定；DO本身已有独立存储能力，不要求另设D1 | 账户/战绩查询的候选，需真实需求、索引/事务/数据边界后才引入。推论：SQL存储本身不提供两玩家推送、席位鉴权或权威裁决 | 候选；未建库、未接入 |
| R2 | 当前资源已随Web/Android打包；探测无对象存储依赖 | 大文件、动态资源或归档的候选；[S5/S6]为对象存储和独立计费服务，不能代替实时房间。目前不引入 | 未订阅、未建桶、未上传 |
| DNSHE / Cloudflare DNS | 当前仅准备workers.dev，未有测试域名 | 新的低成本自定义测试入口候选；NS/CF接入/TLS/续期与恢复仍要实验。域名并不指定执行地区 | 公开资料核对完成；注册/委派/证书未执行 |
| AI Agent | 当前协作方式已存在 | 辅助开发维护，不替代发布授权、真实网络或账单证据；不需要因此增加收费服务 | 沿用工作方式 |

“不适合实时联网”的准确范围：**仅静态Pages文件、单独D1数据库、单独R2存储、DNS解析**均不能独立构成实时权威双人服务。这是功能角色比较，并非否定它们作为配套组件的价值。普通Worker的跨请求全局变量也不能充当可靠房间存储；有状态协调仍需DO或其他服务。采用DO的具体游戏实现须另行审阅，当前不移植引擎。

## 3. 地域、免费域名与微信证据缺口

Cloudflare普通全球网络的Worker入口与DO状态所在地是两个概念。[S7]说明首次访问影响对象位置、位置提示不保证命中；当前 `/ping` 返回的colo只描述入口，不能证明房间位于香港。香港VM即使合同明确香港机房，也不能保证大陆回程质量。香港A/B应先使用直连测试域名；若通过CF代理，要单列“CF入口+香港源站”，不得冒充直连香港。

DNSHE [S8] 当前列出 `.cc.cd`、支持改NS，FAQ写明默认1年、到期前180天免费续期，另有升级机制。这是服务商说明，不是已取得域名或续期保障。[S9]注册页链接的域名专项条款称其为主域下的免费子域服务，保留主域及服务调整权；[S10]较新总条款以具体产品约定为准，并允许到期/长期未用/违规等情况下暂停。两页适用关系还需在实际注册时确认。无需在本阶段办理产品合规手续，但不能把宣传“永久免费”推成永久控制权。

[S11]当前PSL的PRIVATE部分包含 `cc.cd`；[S12]Cloudflare full setup要求apex在PSL后缀下一层。**推论**：`自选名.cc.cd`具备被作为独立zone识别的文档依据，不能与任意普通子域需要Enterprise的情况混同；CF账号实际识别、注册可用名、权威NS生效、DNSSEC/CAA、TLS证书及续期均尚未验证。未注册，不保证任何具体名字能取得。

迁移成本不只购买新域名：更换访问地址/证书、客户端配置、微信网络域名设置（要求待核实）、可能的账号Cookie/邮件发信域身份、旧入口重定向与DNS缓存切换均需处理；免费子域的父域控制不在项目手中，不假设可把同一名字转到另一注册商。当前独立页面使用 `location.origin`、CLI接受节点URL，替换探测入口无需重写游戏规则。没有承诺游戏客户端已有完整配置迁移能力。

微信小游戏官方 `wx.connectSocket` 文档[S13]再次读取失败。JSON/HTTPS/WSS作为协议候选具有移植思路，**没有平台兼容通过证据**。未来需核对小游戏特有合法域名/证书/子协议或header支持、socket数量/连接生命周期、前后台与重连、真机；本地HTML和Node验证不能替代。此次不建立微信客户端，也不依据普通小程序资料推定小游戏条件。

## 4. 大陆验证（NET-REF-001.3 待执行）

继续复用 `net/probe/README.md` 和原始JSON/聚合器，不添加重复echo工程。先获授权Free账号部署口令节点，由目标测试者首次创建session；在多个省市的电信/移动/联通网络，无VPN前台测试，普通时段及北京时间20–23时分别采样，记录1/10/60分钟及真实断网恢复。三网各至少一条样本是开始收集的操作建议，不是已经批准的统计验收门槛或全国代表性保证。

域名路径可增加“同一CF服务：workers.dev与DNSHE自定义域名”的对照；两者都要返回实际JSON，分别标注endpoint/地区/运营商/载荷/VPN/前后台，不能将改域名前后同一DO的位置或网络波动误认为纯DNS因果。自定义域名优先取实际有控制权的测试入口，不因DNSHE未准备好而跳过NET-001顺序。CF不足时才推进同协议香港A/B。

云账号、实际域名、大陆测点仍缺失；**新增公网部署0，大陆样本0**。未登记任何RTT、成功率、断线率或成本达标。已有源摘要 `231a7f050879c7d0cb976ce3afa6b17c308259d1e4dbaf1071d9616b0b387353` 与 `CI_PROBE_2026-10-09.json` 为回环功能证据，保持原执行范围与失败历史，不将视频或本轮文档调查标为现实联网成功。

## 5. 分阶段成本（NET-REF-001.4 部分完成）

沿用 `review/net/COST_SCENARIOS_2026-10-09.json`，没有另设游戏规则或玩家负载。汇率7.2仅假设，非实时报价。50/200/1000为日活，不是峰值并发。每玩家每天2局、20分钟/局、60操作/局、30秒应用心跳、2行DO写/操作、事件活跃10ms均为说明假设，CPU、实际休眠和存储放大未实测。

| 阶段 | 说明性估算 | 未计入/真实限制 | 实际完成 |
| --- | --- | --- | --- |
| 当前本地准备 | 本轮没有购买或部署云资源；没有云账单 | 不能将未部署称为“公网0元运行” | 已完成工具 |
| 假设技术探测：10人每日各2次60分钟 | 20个独立session；默认WS每5秒、HTTP每60秒：近14,400入站WS、约1,200 HTTP；无重试时DO计费请求约1,940/日；填充载荷大小不影响该请求计数。最保守20对象全程活跃约9,216 GB-s/日 | 默认64B，亦可2/16KB；上式忽略RTT等待，属上界近似。其他账号用量、重试、长驻未释放、元数据、实际用量仍待查；不使用D1/R2/发信 | 模型在Free主要日额度内，非部署证明 |
| 假设50 DAU双人对弈 | DO写6,000行/日；Paid Workers+DO说明值约36元/月，两种活跃分支在此模型均同值 | 只包含模型中的计算服务，非完整总价；Free主要平均量在额度内不等于峰值/CPU/长期存储满足 | 未进行游戏云测试 |
| 假设200 DAU | 可休眠说明值36元；整局常驻边界126元/月 | 常驻Free duration超额；需要实测Hibernation与服务端定时器/事务 | 未测 |
| 假设1000 DAU | 可休眠说明值36元；整局常驻边界486元/月 | 示例120,000行写/日超Free；累计日志、CPU和业务访问可能另超限 | 未测 |
| 香港候选 | 当前可买地域/库存/续费/流量/税费总价未知 | 不把全球最低起价作为香港最终价格；直连和CF代理成本分列 | 未购买/未部署 |

技术探测请求近似：20×(60 HTTP + 1 WS升级 + 720 WS消息÷20)=1,940；保守duration=20×3,600×0.128=9,216。[S14/S15]Free超限受限，Paid存在基础和超额费。模型没有引擎、D1和应用存储，因此“可满足Free限额”只针对说明条件；最终以账号面板和真实用量为准。

补充组件费用：Pages Free构建500次/月、单文件25MiB等限制，Functions计入Workers，不是第二套免费后端额度[S4]。D1 Free 5M行读/日、100K行写/日、5GB；Paid写额度50M/月、存储超额$0.75/GB月[S16]。R2 Standard含10GB-month、1M A类/10M B类月额度，超额按存储/操作计费，向上取计费单位；出口不收费不等于存取免费[S5]。R2开通需要订阅结算[S6]，本轮未开通。当前额外组件实际使用均0，不用理论免费额度冲抵未知总价。

域名续期、邮箱/短信（当前未选）、税费/汇兑、备份/运维、长期日志、账号其他使用、微信平台条件均未知；总月成本是否≤50仍未证实。没有付费授权，不升级Paid、不新增R2订阅。参考中的“Cloudflare Free”必须按Workers套餐与每项产品分别核对，不能从DNS站点Free推断全部云产品免费。

## 6. 评估产出（NET-REF-001.5 已完成限域结论）

可直接复用：既有GitHub、独立echo/CLI/测量流程、Workers静态资源能力与DO候选验证。需要改造：真正的权威房间/认证/匹配/持久化恢复、微信通信适配、如确有需求的Pages拆分/D1/R2。不能单独承担实时权威对弈：静态文件、数据库、对象存储、DNS。待实验：自定义域名委派/TLS/恢复、大陆三网/晚高峰、香港A/B、两玩家业务并发、真实云账单、微信真机。

新增价值：DNSHE是具体免费测试入口候选；视频部署流程可作操作对照；R2补充资源成本边界。GitHub/Workers/D1已属现有体系，DO已实现探测，Pages此时重复，故**没有足够证据或必要性改选架构**。本轮新增仅登记与评估，原NET-001状态不提升，下一步仍部署独立CF探测并收集真实报告。未正式发布、备案、迁移、付费、合main或恢复其他游戏队列。

协作门禁 L3_LIMITATION，风险medium、状态partial。一手资料支持服务能力，代码支持功能实现，CI支持回环操作；个人同一AI调查不当作独立评审。失败条件：以官网/视频可达推成大陆网络数据，以PSL记录推成委派已成功，以免费额度推成总成本达标，或把数据库当权威实时房间；遇到时回到对应待验证项。

## 7. 本轮一手来源（均于2026-10-09读取）

- S1 [DO overview](https://developers.cloudflare.com/durable-objects/)：多客户端协调/游戏、一致存储、Free SQLite。
- S2 [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)：同次部署代码与资源。
- S3 [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/)：绑定DO/D1/R2；DO不能在Pages内创建部署。
- S4 [Pages limits](https://developers.cloudflare.com/pages/platform/limits/)：构建/文件/Functions共享配额。
- S5 [R2 pricing](https://developers.cloudflare.com/r2/pricing/)：Standard免费额度、操作费、取整及出口边界。
- S6 [R2 get started](https://developers.cloudflare.com/r2/get-started/)：subscription/checkout。
- S7 [DO data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)：首次位置、hint非保证；非指定香港。
- S8 [DNSHE官网/FAQ](https://www.dnshe.com/)：后缀、NS、默认有效期/续期，属于服务商自述。
- S9 [DNSHE注册页所链接域名条款](https://my.dnshe.com/announcements/10/DNSHE-Domain-Name-Service-Terms-of-Service.html)：2025-12-20免费子域专项条款。
- S10 [DNSHE总条款](https://www.dnshe.com/tos.html)：2026-06-11，具体产品补充与暂停边界；适用关系待实际注册核对。
- S11 [PSL官方列表](https://publicsuffix.org/list/public_suffix_list.dat)：PRIVATE部分DNSHE的cc.cd；不是注册可用性或CF控制台证据。
- S12 [Cloudflare Full setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)：PSL及apex要求。
- S13 [微信小游戏wx.connectSocket](https://developers.weixin.qq.com/minigame/dev/api/network/websocket/wx.connectSocket.html)：读取失败，未核验平台条件。
- S14 [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)：账户套餐/静态/Functions/CPU。
- S15 [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)：配额/休眠/请求20:1/计费取整。
- S16 [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)：行扫描/写/存储计费；读与写单位不同。
