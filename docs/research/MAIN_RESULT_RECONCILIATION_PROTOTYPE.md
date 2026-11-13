# 权威结果记录离线原型（主线）

基准：PR22 `71145df45ad17215a3731e53150b6728e079e375`。状态：**研究代码和本地验证已完成，生产接入/线上查询/跨重连恢复未完成**。

## 本次解决的具体设计问题

现有 host.handle 返回视图会混合时钟推进、命令处置和投影失败。本原型独占一份通过真实建房/入场/猜拳得到的房间，调用未改的生产英雄选择与认输函数；在已核明确分支内识别结果。成功房间与本次记录先以一个同步 owner 引用发布，随后再推进输出时钟和生成真实玩家/公共视图。此为内存同步边界，不承诺进程崩溃原子性、磁盘持久化或Android调度。

代码在 `scripts/research/main-authority-result-prototype.ts`，应用没有导入。原型不是BluetoothHostRoom的生产替换，也不是对所有RemoteActionResult正常返回签发accepted。无ID英雄选择使用显式研究transportId；认输从真实RPS前缀进入finished。同ID底层去重没有actor/内容凭据，返回unknown。只有明确审过的原规则拒绝记录rejected；未知异常不伪装规则拒绝。

## 确定的研究合同

- scope为authorityId/roomId/matchEpoch，actor由可信离线调用方提供；**不是已实现的远端认证**。
- 请求保存排序对象键、保留数组/额外字段/null的完整JSON绑定；不补默认值，不把缺字段和显式默认当相同；不支持无损表示的对象拒绝。未来wire digest/canonical互通仍待定向实现验证。
- 查询不调用clock、RNG、views、handle或submit；原记录不会因查询变duplicate。返回不含私密原载荷。
- 默认最多256条、1MiB UTF-8绑定内容，FIFO，不因查询续期；这是绑定字节预算而非精确JS堆上限。单条过大不保留，淘汰/缺记录/身份换代均unknown；没有跨重启恢复。
- 每次研究执行须新transportId；保留记录内重用ID作为harness输入错误拒绝。**这不定义生产重传/冲突策略**，已淘汰ID也不提供永续去重，调用方仍须遵守新尝试前提。
- 第二阶段才能把记录接到生产host与明确协商通道。此原型不接入准备、移动、特殊技能或再战，不证明其结果语义，也不提供duplicate认证。

## 实际验证

命令：`node --test --test-reporter=tap tests/main-authority-result-prototype.test.ts tests/bluetooth-host-room.test.ts`

Node v24.22.1，**29通过/0失败**：新21项（含36个生产/package Git blob锁定检查）及未改旧host8项。两个成功路径的输出与真实未改BluetoothHostRoom比较一致。完整输出在 `review/main-result-prototype/tests.tap`；源身份见source-manifest.json；阶段结果见RESULTS.json。

验证涵盖：无游戏actionId选择/phase改变；旧接受与新拒绝分开；到期处理；认输终局；提交后投影故障；预派发RNG故障；查询零引擎副作用；actor隔离；内容错绑；权威/局次换代；计数和字节淘汰；底层ID-only去重；输入/结果防变更；JSON规范化反例；旧v2 parser接受hello而拒绝v3新type。投影/RNG失败均是明确注入，不声称生产自然故障。旧parser检查不等于旧Web/Android/设备完整互通。

首轮19项3通过/16失败：原型错误要求room.mode显式等于jieqi，而生产规范化存储省略默认jieqi。改为调用现有normalizeGameMode，未修改生产源；19项再跑全通过，补2项有效控制并带旧8项后最终29通过。未跑全项目935/原56/64，也没有独立QA。

## 方案取舍与后续

主线采用**A作为后续草稿方向**：v2外壳、hello明确命名空间协商；B需v3与双端原生验证升级，本轮不并行实现B。A仍是待生产接入的协议语义扩展，v2名称不免除对差分的明确审查。原型没有发送新协议消息。

旧桥不含可信连接代次，不能仅凭sendChecked或hello可解析宣称跨重连安全。生产A须补可信本机事件代次、当前协商、原请求身份与actor连续性；缺其中任一项，结果核对保持禁用/unknown，旧游戏路径保留。未来允许查询也只读旧记录，绝不自动重发行动。重连身份、协商与客户端原请求保存仍是剩余实质工作。

混乱C1—C3与半混乱H1—H3继续各自固定基线，不要求重跑本29项或改本分支；本原型只作新增输入，不代替它们对真实路径的验证。普通H10准备/准入不因此解锁，独立英雄试点及评分/NET/模式门禁/合并部署边界保持。
