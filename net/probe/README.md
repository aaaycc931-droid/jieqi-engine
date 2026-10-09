# NET-001 最小网络探测工具

状态（2026-10-09）：代码与本地功能验证；**未部署云节点、未取得中国大陆线路测量、未确定生产服务商**。当前任务与仓库审计见 [32_NET-001](../../handoff/current/32_NET-001_NETWORK_VALIDATION_2026-10-09.md)。游戏本体、已确认规则与既有蓝牙成果保持原样。

## 1. 工具与证据范围

| 文件 | 作用 |
| --- | --- |
| `worker.mjs` / `wrangler.jsonc` | Worker HTTPS 入口 + SQLite 类型 DO + Hibernation WebSocket；echo 真正经过 DO |
| `server.mjs` | 同协议 Node 服务；用于已有香港测试节点，通过 TLS 反向代理暴露 |
| `public/` | 独立中文测试页面；不是现有游戏 UI 或微信小游戏客户端 |
| `cli.mjs` | Node 24 测量；另做三次 OS DNS 与新建 TLS 握手诊断 |
| `analyze.mjs` | 按节点、地区、运营商、网络、VPN、消息大小分组，合并原始样本计算统计 |
| `cost-model.mjs` | 明示假设的 50 / 200 / 1000 DAU 场景，不是实测成本 |
| `test/` / `test-browser.mjs` | 本地 HTTP/WS、Cloudflare workerd 与独立页面 DOM 验证 |

接口为 `GET /ping`（入口诊断）、`POST /echo?session=<id>`、`WSS /ws?session=<id>`。后两者在 CF 上都经过同一 session 的 DO。消息 `{v:1,kind:'echo',id,sentAt,padding}`，响应回显这些字段并附 `serverAt,node`；RTT 使用客户端单调时钟，不相减服务端/客户端时钟。消息填充支持 64 B、2 KB、16 KB；合成消息不代表真实棋局负载。

HTTP 的测试口令放在 `Authorization`；浏览器 WS 用两个 subprotocol：`lezi-net-v1` 与 `probe.<口令>`，服务端选择前者。口令不放 URL、JSON 报告或 Git。它只是受控探测准入，**不是玩家账号体系**。无有效口令返回 503；无权限请求返回 401。session 与载荷有边界，WS 有连接/消息次数上限；没有全账户硬限流，勿因口令而认定费用已封顶。

DO 不开启定时器、不执行数据库写入，用 `ctx.acceptWebSocket`，连接附件保存计数。这验证 Hibernation API 的接入；实际休眠与账单须在云端核验。session 首次请求应由目标大陆测试者发起，避免预创建 DO 固定在不代表目标用户的地点。没有宣称 DO 固定在香港，也没有把 Worker 入口位置当作 DO 位置。[官方位置机制](https://developers.cloudflare.com/durable-objects/reference/data-location/)说明首次访问与位置提示的局限。

浏览器页面只测同源节点。CF、香港分别打开各自测试页；不在一个页面跨域测另一个节点，以免 CORS 被误认成线路失败。

## 2. 本地检查（不部署、不付费）

```bash
cd net/probe
npm ci --no-fund --no-audit
npm test
WRANGLER_SEND_METRICS=false npm run cf:check
```

Work Mode 本地容器不能枚举 OS 网卡，Wrangler 首次默认集成检查因此失败。这里的本地复核明确采用：

```bash
NET_TEST_OS_INTERFACE_WORKAROUND=1 npm test
```

这只在本地测试子进程中将不可读取的网卡枚举处理为空；仍强制绑定 `127.0.0.1`，不伪造地址，不改变网络性能数据。普通环境和 CI 不需要此标志。若默认检查失败于其他原因，应诊断，不自动跳过或套用此处理。

Node 服务测试口令使用随机、临时值。下面命令仅启动回环 HTTP：

```bash
export PROBE_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))')"
npm start
```

另一个终端保留同一个 `PROBE_TOKEN` 后运行：

```bash
node cli.mjs http://127.0.0.1:8788 --region loopback --carrier none --duration 10 --vpn unknown
```

本地报告标注 `loopback_functional_only`，不计入大陆线路达标。WS 连接的是 `ws://` 回环地址，不能写为已测公网 HTTPS/WSS。

## 3. Cloudflare 技术测试部署准备

前置依赖：用户的 Cloudflare 测试账号授权；核对该账号仍为 Workers **Free**、其他服务共享配额、可用 workers.dev 子域与控制台设置。本轮未获得这些条件，故未执行以下云端命令。不开通 Paid，不绑定付款方式，不创建 D1，不接入游戏或公开运营。

账号就绪后，仅部署受口令保护的 echo 技术服务：

```bash
cd net/probe
npx wrangler login
npx wrangler secret put PROBE_TOKEN
WRANGLER_SEND_METRICS=false npx wrangler deploy
```

`secret put` 未部署时可能建立 Worker；默认没有口令的服务拒绝探测。部署前确认目标账号、项目名、Free 状态与已批准的技术测试范围。完成后从 CLI 返回值记录实际 HTTPS 地址与版本，测试三种载荷，不预写虚构域名。

`workers.dev` 是初期浏览器/脚本测量地址，不等于已满足微信域名配置或大陆可达性。若 workers.dev 不通，应将“此主机名不可达”和“整个 Cloudflare 方案不可用”分开：有现成可控域名时才测 custom domain，不默认购域名。

测试结束撤销/轮换口令，或执行 `npx wrangler delete` 删除专用探测 Worker，并在控制台核验 DO 命名空间/资源清理。命令执行前核对专用项目名，避免删除游戏或其他 Worker。

## 4. 香港同协议节点准备

提供商、主机、报价与授权尚未确定。优先已有香港机器/短期试用；本轮没有购买套餐。已有机器可用 Node 24：

```bash
cd net/probe
npm ci --omit=dev --no-fund --no-audit
PROBE_NODE=hong-kong-test-node PROBE_HOST=127.0.0.1 PORT=8788 npm start
```

口令通过环境或权限受限的服务配置提供。使用 `Caddyfile.example` 或已有代理终止 TLS；反向代理必须支持 WS Upgrade，长连接空闲超时应覆盖测试，不启用包含准入口令的访问日志。TLS 链、服务监控与重启需要实际验证。

香港测试域名使用直连香港的 DNS 解析，**不要经过 Cloudflare 代理**；否则 A/B 仍共享 CF 入口，无法判断香港直连效果。Node 8788 默认仅回环，公网仅开放已配置的 HTTPS 入口。域名、证书与实际归属节点都要登记；不把这份配置样例当作已部署。

## 5. 中国大陆测量方法

以下是本轮建议的采样计划，**不是用户锁定的验收阈值**：

1. 先 CF：电信/移动/联通各至少一个真实测点，尽量跨两省；普通时段与北京时间 20:00–23:00 各一次。记录省市、网络类型、运营商、设备、VPN 状态、时间。
2. 每组先做 10 分钟、64 B 消息测试；做 60 分钟前台长连接测试；补 2 KB 与 16 KB 载荷参考。不要混合不同载荷的 P95。
3. 做一次“练习断开再连”，再做一次真实断网约 10 秒、恢复网络并按恢复按钮；程序检测到的中断、人工恢复标记与首个有效 echo 分别记录。重连到打开 socket 不等于首个有效 echo。
4. CF 不达参考体验或测点覆盖不足，再用同设备、同线路、相近时段跑香港相同协议，交换先后顺序减少时间偏差。确切通过/淘汰阈值留待确认。
5. 页面对有效响应计算 RTT 中位数、P95、最大值、相邻成功 RTT 的最大绝对变化；失败留在成功率分母，保留原始样本。主动重连取消的在途探测保存在 `cancelledProbes`，与真实失败分开，不暗中丢弃。报告还有 WS 连接成功率、意外断开次数、连接持续时间、检测到首个有效 echo 的恢复耗时。

网页开启前无法回传“页面完全打不开”的结果：另记失败时间、错误与网络信息，或改用 Node CLI。HTTP 成功只证明组合路径；浏览器 Resource Timing 的 DNS/TLS `null` 表示未观测/连接复用，不是零延迟。三次 CLI DNS/TLS 冷连接诊断是小样本诊断，不能包装成三大运营商长期成功率。这里测的是应用 echo 丢失/超时，**不是 TCP 包级丢包率**；需要包级结论时另做有授权的网络诊断。

页面不自动上传结果。测试者下载 JSON 后交回；CLI 示例（口令已在环境中）：

```bash
node cli.mjs https://ACTUAL_TEST_HOST --region 广东深圳 --carrier 中国电信 --network wifi --vpn off --duration 600 --payload 64 --out results/cf-sz-telecom.json
node analyze.mjs results/*.json
```

上述主机是占位符。不要将省市/运营商自述提升为独立核验，不用非大陆云容器结果代替大陆真机。P95 小样本只能探索，单个 60 分钟样本不能证明普遍稳定。

## 6. 配额与成本（官方资料核对 2026-10-09）

| 项目 | Free | Paid / 超额行为 | 本轮实际使用 |
| --- | --- | --- | --- |
| Workers 动态请求 | 100,000/日；10 ms CPU/调用 | $5/月基础；10M 请求/月后 $0.30/M；30M CPU ms/月后 $0.02/M | 本地；未启用云账号 |
| 静态文件 | 直接 assets 请求免费 | `run_worker_first` 匹配路径会进入 Worker | 三个独立探测页面文件 |
| DO 请求 | 100,000/日 | 1M/月后 $0.15/M；WS 入站应用消息计费 20:1，连接建立计一次；出站消息无请求费 | 本地，无云账单 |
| DO duration | 13,000 GB-s/日 | 400,000 GB-s/月后 $12.50/M GB-s，超额按计费单位向上取整 | 使用 Hibernation；云端时长未测 |
| SQLite DO 存储 | 5M 行读/日，100K 行写/日，5GB | 25B 行读/月后 $0.001/M；50M 行写/月后 $1/M；5GB 后 $0.20/GB月 | 无应用读写，空命名空间仍可能有少量元数据 |
| D1（可选，未接入） | 5M 行读/日，100K 行写/日，5GB | 同行读写额度；5GB 后 $0.75/GB月 | 0 |
| 邮件 | 未选服务商 | 实际服务区域、免费条款、域名、投递与防滥用待核验 | 0 次；不构建账号 |
| 域名 / DNS / TLS | CF 探测可先用 workers.dev | 自定义域名购置/续费、香港域名和 DNS 服务以实际配置计；不是一律零成本 | 未购域名，未部署证书 |
| 微信接入 | 未创建或适配客户端 | 账号类别、域名条件、平台费用待核验 | 仅协议可移植性设计约束 |

Free 超额会使对应操作失败，日额度 UTC 00:00 重置；Paid 会产生超额费用。预算告警只发通知，不暂停/封顶使用。本轮建议先 Free 技术试验，依据用量再讨论；≤50 元不是已保证结论。官方普通全球网络与 China Network 是不同服务，不以“有中国网络”证明免费候选大陆低延迟。

成本模型命令 `node cost-model.mjs`。假设每 DAU 每天 2 局、每局 20 分钟、两人、总 60 个操作、30 秒应用心跳，每操作 2 行 DO 写、每局/账号少量 D1 元数据。DAU 不是峰值在线人数。估算全月 30 天、CPU/活跃处理 10 ms 为说明性假设，未测规则引擎；按汇率 **7.2 CNY/USD 假设值**换算，非实时汇率：

| DAU 假设 | DO 行写/日 | Free 风险 | Paid Workers+DO：可休眠说明值 | Paid Workers+DO：整局持续活跃边界值 |
| --- | ---: | --- | ---: | ---: |
| 50 | 6,000 | 示例平均量在主要额度内；峰值/CPU/累计存储仍待测 | $5（约36元） | $5（约36元） |
| 200 | 24,000 | 持续活跃 duration 超日额度 | $5（约36元） | $17.50（约126元） |
| 1,000 | 120,000 | 持续活跃 duration、示例行写超日额度 | $5（约36元） | $67.50（约486元） |

以上是候选实现的说明模型，不是完整报价或承诺；不含邮件、域名、税费、账户其他用量、数据库累计超额、真实引擎 CPU/存储放大或运维。示例 1 KB/操作日志每月约 0.09/0.37/1.84 GB，长期积累可能超 5 GB，必须单独考虑留存；2 KB/玩家/操作的出站量只是说明假设，真实私有视图大小与瞬时带宽待测。DO 常驻/不可休眠是主要成本分叉。

香港：阿里云国际站官方价目有 Linux $3.5/月起、香港超额出站 $0.153/GB 的参考，但**不代表用户当前账号可购买的香港套餐**。官方文档明确以购买页为准；还需核对地域、内存、续费、流量、可用库存、税/币种，不能把约40多元/月写为已确认。未取得报价时总月成本为未知，不用全局起价兜底。

## 7. 一手来源与待核验边界

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Hibernation WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Durable Object data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)
- [Static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
- [Cloudflare China Network](https://developers.cloudflare.com/china-network/)
- [Alibaba Cloud official reference pricing](https://www.alibabacloud.com/en/product/swas/pricing)
- [Alibaba Cloud billable items](https://www.alibabacloud.com/help/en/simple-application-server/product-overview/billable-items)
- [ws upstream API](https://github.com/websockets/ws/blob/master/doc/ws.md)

微信小游戏原生文档入口 [wx.request](https://developers.weixin.qq.com/minigame/dev/api/network/request/wx.request.html)、[wx.connectSocket](https://developers.weixin.qq.com/minigame/dev/api/network/websocket/wx.connectSocket.html) 本轮检索无法读取，**没有用普通小程序、海外 Mini Program 或第三方转载冒充已核验的小游戏条件**。HTTPS/WSS、JSON、平台适配层为本轮实现选择；SDK、合法域名/证书要求、子协议可用性、前后台行为需未来回到官方文档与目标真机核验。该 HTML/Node runner 不能直接当作已完成微信小游戏适配。

完成 NET-001.2 的大陆实测和 .3 的真实账单/香港报价后，才能做 .4 推荐方案与回退决策。本轮不启动正式发布、备案、账号/匹配或游戏云端迁移。
