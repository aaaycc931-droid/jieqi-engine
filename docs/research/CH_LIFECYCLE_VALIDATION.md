# 混乱线：生产接收与连接生命周期离线验证

2026-11-13；任务 MAIN-CH-OFFLINE-LIFECYCLE-VALIDATION-20261113。
交接源 d5d05f92df1be0b3fef43b22245c0a0c5cc25fbf；生产源固定 PR22
71145df45ad17215a3731e53150b6728e079e375。只新增研究驱动和公开结果，未改生产代码。

## 复现

在固定基线及本分支新增文件上，使用 Node 24、Python 3、含 jdk.compiler 的 Java 21：

```sh
python3 scripts/research/ch-lifecycle-probe.py
node scripts/research/ch-lifecycle-web.ts
```

Java 编译通过 `java -m jdk.compiler/com.sun.tools.javac.Main`，不要求独立 javac 可执行文件。
生成类仅在临时目录，未提交。两条命令本轮实际执行成功，分别 7 和 8 个用例，最终失败 0。
旧 16 JVM/3 父控制/8 行动/3 ping/935 检查未重跑；只读取公开的精确 fixture 与结果。

## C1：生产接收 EOF 边界（5 用例）

未修改的 GameWebBridge.host → session.host → 单 io → accept → attach → readLoop，
使用真实 JDK BufferedReader/InputStreamReader；Android adapter/socket/input 与 JSON 为显式替身。
onMessage 是 readLoop 自己投递，再执行实际 Bridge.emit，未直接伪造 listener 调用。

| 接收流 | 实际 message 数 | 结束状态 |
|---|---:|---|
| 旧 newline 完整 JSON，无换行，正常 EOF | 1 | DISCONNECTED |
| 同字节随后 IOException | 0 | DISCONNECTED |
| 旧 partial 截断内容随后 EOF | 0 | ERROR |
| 旧 success 完整换行随后 EOF | 1 | DISCONNECTED |
| 完整 JSON，v=99，随后 EOF | 0 | ERROR |

正控消息与原公开 hero/shuffler 请求内容一致。JSON 替身继承旧研究，仅校验边界括号和所用 v/type；
本轮不声称 Android org.json 全语法一致。C3 另用真实 TypeScript parser 与房间检验有效输入。
输入 IOException 特意发生在一次完整字节读取之后的下一次读取；不是对无线断流方式的测量。

这补上旧 native-send-channel 丢弃末段的覆盖缺口：完整无换行末行在 EOF 下确实可被接收。
不撤销旧转接器输出，不代表发送缓冲必然交付，也不宣布线上故障。

## C2：真实执行器/锁、可控底层流（2 用例）

通过 join 进入生产路径；sendChecked 在独立 sender 线程执行实际 BufferedWriter/OutputStreamWriter，
在其底层 OutputStream.write 阻塞。旧 readLoop 从受控 EOF 走断连、关闭、排自动重连。
执行生产 postDelayed 所提交的 runnable，逻辑时钟推进 1000ms；并未睡眠测 Android 定时器。
新连接依旧通过原单线程 io 队列安装，未反射替换 writer、直接调用 attach 或替换执行器。

| 控制 | 真实记录顺序 | 旧发送返回 | 新流 |
|---|---|---|---|
| release_before | 旧写抛错/返回 → 新 writer 安装 | unknown | CONNECTED，未关闭 |
| release_after | 新 writer 安装/读入口 → 旧写抛错/返回 | unknown | CONNECTED，未关闭 |

第二例证明在明确流关闭语义下，生产方法可形成旧 send 晚于新 attach，而 PR22 当前 writer 身份保护保持新流。
本模型的 socket.close 释放输入，**不释放已阻塞输出**；输出由独立门闩释放并抛异常。
真实 BluetoothSocket 是否同样允许该顺序、同步 JNI/WebView 是否阻塞 UI，仍未验证。
记录旧输入 close、新 connect/writer-install/readLoop-entry、线程和回调提交/执行；没有插桩直接测量每次 monitor 获取或 finally 出口。
旧 readLoop finally 早于同一执行器新 connect 的结论来自未改生产调用结构及实际单执行器，不能把输入 close 一行单独当 finally 结束探针。

Handler 是线程安全 FIFO；旧立即任务按提交顺序 drain，实际延迟 runnable 单独在虚拟到期点执行。
MainActivity 仍沿用“总是排队”的替身，与 Android 已在 UI 时直接执行不同。
所以本轮不能证明跨真实 UI/JS 队列的陈旧回调越序，也不能声称 Android 自然竞态已经复现。

## C3：接收回调到真实 Web/房间（8 用例）

四种接收流各用“接收端先处理 / 发送端断连回调先处理”两个跨端记录回放顺序。
保持每端自身记录顺序；跨端次序是条件化回放，不是测量到的无线先后。
初始化接收方 CONNECTED 回调后才发原请求。使用实际生产 Web 函数、事件 listener、parser 和 jieqi 房间，
DOM 最终渲染与 native endpoint 仍是原记录替身。原 sender 的 unknown 返回和断连回调复用公开 JVM 记录，
不把新的接收侧 IOException 宣称为已测发送异常原因。

| 组合 | 房主最终 hero choice | guest 发出次数 | 最终 pending / unknown / requestId |
|---|---|---:|---|
| 完整无换行 EOF + 旧 newline unknown | shuffler | 1 | false / false / null |
| 同字节 IOException + 旧 newline unknown | null | 1 | false / false / null |
| partial EOF + 旧 partial unknown | null | 1 | false / false / null |
| 完整换行 EOF + 旧 flush unknown | shuffler | 1 | false / false / null |

每行两个顺序均通过。发送后均 pending=true/unknown=true；接收端先处理时，真实 host 返回帧仍不清 guest unknown，
直到发送方断连事件才清其瞬时请求编号与等待。两种权威结果都可得到同样 UI 清等待，故清等待不是结果确认。
实际仅一次 action、无自动重发、无 action ping。仅覆盖公开英雄选择 fixture，不外推全部 H15/H11/终局动作。

## 证据、失败与停止点

- `review/ch-lifecycle-validation/JVM_RESULTS.json`：7 用例、输入哈希、原始 JS 回调、线程因果轨迹、JDK 版本和生产源哈希。
- `review/ch-lifecycle-validation/WEB_RESULTS.json`：8 用例、每步 UI/权威观察、精确输入与 JVM 结果哈希。
- `review/ch-lifecycle-validation/SOURCE_AUDIT.json`：原有文件完整性、环境、源身份与初次失败记录。
- 第一次编译退出 1，错误摘要未打印编译器 stderr；修正研究 BluetoothServerSocket.close 的 throws IOException 声明，并增强错误输出后成功。原诊断未保留，不能宣称已独立确认其唯一根因。未改生产文件来使测试通过。

C1/C2/C3 有界离线阶段完成；W1 获得接收/房间证据，W2 仅上述流模型可达，W3 仅记录回放。
真实 Android/JNI/无线/完整 DOM、真实自动重连时延和跨实例身份仍未验；CH07 正式验收新增 0。
本轮不实现 A/B、结果账本或新的代际字段。剩余问题需主线方案/生产实现或真实设备环境；不扩大随机组合、不重复旧套件。
