# 已提交房间输出与H11到期拒绝同步修复

任务`MAIN-ROOM-COMMITTED-OUTPUT-CHANNEL-20261029`，父源PR19 `760caf57d454af0db3be92d5b52ffc3cc9078d06`。实际执行2026-10-29。接收半混乱HC54输出调用链审计、混乱`CH-CHANNEL-01-A-EXPIRE-REJECT-NO-PUSH`原来源探针及普通PR18接收报告；主线实际复现并修复了到期拒绝后对端仍保留旧房间的消费者问题。

## 实际故障与最小改动

真实`BluetoothHostRoom`沿原CH06/PR14 H15红/H11黑、开局seed476与合法招募seed0/1进入32棋房间。红1在5000行动，黑方正式时钟由此开始；黑1在10000完成后H11 A沿用原截止，**本例实测截止65000**。这不是独立H11示例的70000，不能硬套。

在截止或截止+1送来宾的旧A指令：房主`handle`先调用`advanceRemoteRoomTime`，A已自动放弃并轮到红方，再提交旧黑方指令抛`WRONG_TURN`。旧实际`web/app.ts`处理函数只发`error {message}`，没有发已经推进的房间：房主权威红方/无A，而接收端仍持黑方/A。

本轮只改`web/app.ts`的行动完成后发布安排：

- 接受或拒绝之后，都通过已有公开/本人投影发布当前**已提交**房间。
- 来宾拒绝保持原错误消息/请求编号，随后发送现有snapshot；房主本地拒绝也同步自身和对端。
- 发送/编码失败从规则裁定catch中分离，不再把已接受行动错误地改报成一次规则拒绝或再次提交。同步失败只提示，不重复游戏动作。

协议仍v2，snapshot、error和`{message}`形状不改，没有新增`code`或重复ACK字段。不发送中间原子/未提交状态，不扩张公开权限；引擎玩法、模式门禁、英雄设计和UI素材字节保持。

## 可复验的输出证据

`committed-output-channel.ts`提取并执行实际生产WebView通道函数，调用真实`BluetoothHostRoom`。旧版完整函数片段原样取自固定PR19并绑定hash，保存在`PR19_WEB_CHANNEL.txt`；未另写一套消息处理逻辑。

原生发送端点和最终`applyBluetoothView`渲染端点是记录用替身，**不是实际蓝牙无线或完整DOM**。可证明实际控制器选用的消息类型、先后顺序、编解码和交给渲染端的状态；不能据此宣称真机网络或像素验证。

| 同一原来源下的请求 | 旧版 | 本版 |
|---|---|---|
| 截止-1合法使用A | snapshot | snapshot |
| 恰到截止的旧A | 仅error，对端旧状态 | error→snapshot，对端红方/无A |
| 截止+1的旧A | 同上 | 同上 |
| 已接受指令原字节重传 | 当前snapshot，无显式重复ACK | 保持，权威/时钟/RNG不再消费 |
| 再次送已拒绝的旧A | 规则拒绝 | 拒绝后同步；不重开红方时钟 |

两种合法私密招募×三个时点共6对旧/新比较：权威、全部事件、抽数及重试后权威一致；只有故障路径输出新鲜度修复。三个时点的两私密世界，实际snapshot/error原字节与交给渲染端的数据一致；训练载体、进度与失败不进入这些输出。合法A仍按原29/30抽完成，迟到A零洗牌抽数，机会不消耗。原本已合法公开的被吃红炮真身保留。

Java原生链路已定向读源：`GameWebBridge.send`调用`BluetoothGameSession.send`，JSON逐行写/flush；入站回调转`jieqi-bluetooth`事件。原生IOException由Java捕获后发`transport-error`，本轮没有在真机执行；同步发送替身抛错的测试不等于覆盖全部原生失败路径。

## 原半混乱完整提交返回

保持原12世界/110请求/RPS/随机与动作输入，实际取得110公共和220玩家的**请求提交后**JSON，含真实消息、updatedAt及下一回合状态。100次正常主行动都带其实际系统历史消息；英雄前置技能沿原返回语义，不强行要求相同历史格式。

4次原`IN_CHECK`拒绝定位为原请求：DS01-02 R4 pre1/pre2、DS03 R4 pre1、DS04 B3 pre1，保存的是服务端RuleError，不冒充玩家已收到的错误包。

另在106次接受之后，以**完全相同的原command，包括旧expectedRevision**重复请求，确认`duplicate:true`、事件空、权威/历史/截止保持；4个原拒绝另做同载荷拒绝对照。这110次新增研究探针明确不是原110请求或原PD-S35/DS-S12自然客户端刺激，不将原规格全部标PASS。

`BluetoothHostRoom`仍以`MODE_TRANSPORT_PENDING`拒绝half_chaos和xiangqi。因此半混乱完整提交JSON属于服务器序列化证据，不能声称其110条经过实际蓝牙或4个错误已交给半混乱玩家；完整56义务、64正式验收和真机送达仍0。其返回只带views，`duplicate`并无显式线上ACK；`views()`本身推进时间，不是被动的中间时点观察。

## 验证、复现与限制

新增20项检查，58相关文件895项通过、0失败；另2个现有Web静态文件50项通过。4个未改二进制素材的存在/像素检查明确未运行。37个src/web模块通过与生产脚本相同的代码转换；没有打含全部素材的完整网页包、APK、全TypeScript类型检查或真机/独立QA。

```sh
node --test tests/committed-output-channel.test.ts tests/committed-room-serialization.test.ts
node scripts/research/committed-output-research.ts --output=review/committed-output-channel/RESULTS_20261029.json
```

`--owner-raw=/private/path/trace.jsonl`可生成仅供所有者的私密权威/原始回执对照。公开RESULTS、SOURCE_AUDIT、PREPATCH_SOURCE、BASELINE_INTEGRITY及命令/TAP只保存摘要和hash。新的owner包与旧HC56/NP32包分开保存。

下一核来宾pendingAction、error编号与延迟/重复snapshot的真实关联，沿现有v2格式先复现；不得把任意快照当作某个请求的已确认凭据。NET暂停、评分/原账本冻结，三线工作稿、山/风/UI素材及H03断点保护，无合并、部署或APK。
