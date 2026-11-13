# C5 本机连接代次隔离草稿

2026-11-13；任务 MAIN-CH-C5-LOCAL-CONNECTION-GENERATION-20261113。
基线5cb3df526e1d41d60332b2b1f5c946f41126a720；专属分支codex/ch-local-generation-draft-20261113。
不是生产采用、远端认证、结果查询协议或设备验证。

## 实现与所有权

BluetoothGameSession为每实例生成UUID，以BigInteger产生十进制字符串generation/sequence。
每次host/join/自动重连attempt，以及disconnect/close明确失效，替换Attempt；其socket（包括connecting）、server、writer均只属于本Attempt。
旧connect/accept回到attach时检查所有权，旧readLoop/finally只关闭自己的资源；延迟reconnect捕获原Attempt，不允许重标新代。
所有权检查和writer捕获使用session monitor，串行发送仍用writeLock；阻塞connect/accept/read/write不占session monitor，close沿用监视器内关闭语义。
EOF/发送失败到下一attempt之前保留原代次，保证已经产生的同代合法末行消息可消费，不把EOF当成未送达。

事件在产生处捕获不可变instance/generation/sequence/role，跨Handler、GameWebBridge和evaluateJavascript保持同一快照。
GenerationListener是新增可选接口；旧Listener签名保留，分支只通知其中一种路径一次。
旧send/sendChecked保留；新增localTransportContext(v=1, scopedSend=true)只读查询；sendCheckedScoped在捕获实际writer的同一锁边界比较上下文。
错代、未连接、写前无效输入返回not_sent且attemptedContext=null；已捕获旧writer晚回仍携原上下文，status仅written/unknown，不是ACK。
没有改src、v2 wire、payload、规则或结果adapter。

## Web最终消费与兼容

实际Web发送边界只读本机能力/上下文，固定期望代次后调用一次scoped send；选新路径后坏返回/异常不降级重发。
返回时再查当前上下文；旧结果不能改新pending，旧异常同样不能。C4独立内存未知不被本机上下文转换为accepted。
无新方法的旧桥维持原sendChecked/send路径，缺代次标未覆盖；出现新方法但无有效v1能力不盲信，保持unknown。

最终事件listener在处理state/message/transport-error之前查询当前本机上下文，拒绝跨instance/generation及重复/倒序事件。
同代以已消费sequence判断，而不以native最新sequence丢弃全部排队消息；十进制字符串比较避免JS整数精度和BigInt浏览器依赖。
页面初始化时仅采样一次当前sequence作为重建水位，拒绝新页面创建之前已产生的同代事件；之后产生的合法FIFO继续。
这不重建旧UI/房间：页面重建前状态恢复未实现，需新的明确连接流程；没有自动重发/自动重建权威。

## 实跑

```
python3 scripts/research/ch-generation-native.py
node --test --test-reporter=tap tests/research/ch-generation-web.test.ts
```

Node24.22.1/JDK21 compiler/Python3.12；最终native16例、Web19项通过，0失败。
完整app.ts使用Node stripTypeScriptTypes成功；git diff --check通过。不是完整TypeScript语义检查或APK构建。

Native每种情况分别运行MainActivity inline/queued两个显式模型：EOF/IOException，取消connect后旧完成，取消accept后旧完成，旧延迟重连，旧send晚回，scoped错instance/代次/断连零写与合法一次写/旧send等字节，legacy listener单通知。
实际生产入口和真实JDK读写/执行器，不反射安装writer、不直接调用attach。原始trace、JS脚本、上下文保存在NATIVE_RESULTS.json。

Web19项使用实际生产函数/事件listener和jieqi房间，测试驱动是原receipt driver增加可选native方法注入的测试副本，原文件不动。
消费真实native回调；已提交JS但尚未消费前切代，旧state/message无权改变pending/房间；ERROR变体及倒序是明确adversarial注入，不声称Android自然发生。
合法同代FIFO、重复、native重建、Web重建水位、超过2^53的相邻序号、scoped正确/错误/异常/错绑定、晚结果/晚异常、旧桥和坏能力、C4未知保留均有控制。
旧action+ping正常路径保留；unknown不发ping或重发action。

## 失败与局限

初版native14/Web16通过。新增取消accept控制时，测试替身变量与参数重名导致编译失败（未跑该轮native用例）；仅修替身命名，最终native16通过。
额外转译命令误导入默认Node未导出的SourceTextModule导致工具命令失败；删无用导入后完整strip成功，未改生产来规避。
之后增加页面重建水位、字符串序号比较及旧异常检查；最终Web19通过，native源哈希重新生成。原C1—C4和主线29例未全套重跑。

JSON继承限定替身，非Android org.json完整一致性；socket.close释放输入但未必解除输出的模型沿用C2，真实BluetoothSocket/JNI仍未证。
Handler FIFO和虚拟1000ms重连不代表真实Android排程；inline/queued分别是可控模型，非真实线程认证。最终Web是VM函数执行，不是浏览器/WebView。
无可信远端actor连续性、authority/match绑定、hello查询、全动作结果、持久化、独立QA、CH07正式验收；评分/NET/模式门禁不变。
完成本有限草稿，后续由主线审查采用并结合其结果adapter；不自行合并部署或扩大样本。
