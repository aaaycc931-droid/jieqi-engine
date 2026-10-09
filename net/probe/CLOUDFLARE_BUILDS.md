# NET-001 Cloudflare Git 构建记录与排障

记录日期：2026-10-09。范围：专用网络探测 Worker 的受控技术部署；不是游戏正式发布，也不是新的架构决策。

## 配置目标

| 控制台项目 | 值 |
| --- | --- |
| Worker 名称 | `lezi-net-001-probe`，与 `wrangler.jsonc` 一致 |
| Git 仓库 | `aaaycc931-droid/jieqi-engine` |
| Production branch | `codex/net-001-validation-20261009` |
| Root directory | `net/probe` |
| Build command | `npm ci --no-fund --no-audit` |
| Deploy command | `npx wrangler deploy` |
| Build variable | 普通变量 `NODE_VERSION=24` |
| Disable builds | 关闭 |
| Preview builds | 本轮建议关闭；实际保存状态尚未独立核验 |

控制台的 Production 指这个专用探测 Worker 的部署环境，不代表游戏正式运营。上述分支、命令、目录来自用户截图；是否持久保存、是否成功监听新提交，需要下一条构建记录证明。

## 已观察到的失败

证据来源：用户提供的控制台截图与构建日志；未直接访问其 Cloudflare 账号。

1. 首次构建 `8ec22a59` 使用 `main`、根目录 `/`、构建命令 `exit 1`，在 Building 阶段终止。这是初次连接仓库时的停止配置，不是探测代码报错。
2. 保存新的配置后，重试构建 `0daa36f9` 使用了新的安装命令、`net/probe` 与 `NODE_VERSION`，但详情页仍标注 **main**。
3. 该重试的日志：

   ```text
   2026-10-09T10:54:10.071Z Initializing build environment...
   2026-10-09T10:54:22.669Z Success: Finished initializing build environment
   2026-10-09T10:54:23.163Z Cloning repository...
   2026-10-09T10:54:24.089Z Failed: root directory not found
   ```

4. Git 仓库核验：`main` 的 `c25749d4f21d394c3d94486cfba1d786864083b6` 没有 `net/probe`；NET 分支的 `ecf12a9a05bfd135d968dfdc8944ff88e90c6389` 有该目录、安装锁文件、Worker 代码与 Wrangler 配置。

结论：本次重试仍取旧的 main 构建来源，目标目录不存在；失败早于依赖安装与 Wrangler 部署。它没有证明游戏代码、Node 24 或 Durable Objects 不兼容。不要把 Root directory 改回 `/` 绕过问题，也不要为此合并测试代码到 main。

控制台另有 GitHub 用户或组织信息读取警告；当前日志不足以把它认定为这次目录错误的原因。若正确分支的新构建仍有授权错误，再依据新日志排查。

## 下一条构建的核验方式

在保存配置后，向 NET 分支提交此部署记录，让所监听的分支出现新提交。刷新 Deployments，检查新记录的分支、提交 SHA、Root directory 与构建日志。不要继续用旧 main 记录的 Retry build 作为切换分支的验证方法。

官方说明：保存后的配置用于后续构建，重试也使用当前配置；Git branch 决定监听哪个分支的新提交。官方这一说明没有保证重试旧记录会改取另一个分支；本次截图明确显示它仍取 main。

只有看到正确分支的新提交被 Cloudflare 读取，才能登记自动构建触发成功。还需看到依赖安装、部署完成、实际 URL 与版本对应，才能登记 NET 探测代码部署成功。当前控制台已有 Active deployment 并不足以证明该版本就是 NET 探测代码。

## 部署后仍待验证

- 实际 Workers Free 状态、账户共享额度与监控。
- Worker Production 的运行时 **Secret** `PROBE_TOKEN`；不是 Build variable，也不是构建 API token。不把口令提交到 Git、日志或聊天。
- 无有效运行时口令时，现有代码在创建 DO 前返回 503；这只限制 echo 探测准入，不代表账户费用封顶。
- 实际 HTTPS 地址、`/ping` 响应、带口令的 HTTP/WS echo 与版本对应。
- 中国大陆关闭 VPN 的真机测量，以及后续必要的香港直连对照；当前没有大陆测量结果，也没有证据证明执行地点固定在香港。

## 官方参考

2026-10-09 核验：

- [Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)：配置生效、分支监听、构建目录、构建变量与运行时变量的区别。

本记录不登记新构建或云端部署已完成；下一轮应根据实际控制台记录补充结果。
