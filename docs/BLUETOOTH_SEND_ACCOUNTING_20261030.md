# 蓝牙发送结果核算｜2026-10-30

实施前兼容设计：保留原`GameWebBridge.send(String):void`，新增可选的本机接口`sendChecked(String):String`。新Web优先读取其同步JSON结果；旧Web继续原send，新Web遇旧桥仍走原路径并明确保留其吞错缺口。蓝牙线上仍v2，既有action/snapshot/error/ping/pong字段及公开权限不改。

本机结果只有三类：`not_sent`为JSON/协议/大小/未连接等写入前失败；`written`仅表示当前输出流write/newLine/flush返回；`unknown`为已尝试写入时IOException、无法解析/缺失本机结果或桥接口异常，不能据此断定权威是否收到/接受。接口调用本身同步关联当前发送，无需在无线消息增加字段。未知结果不退回旧send、不发该行动后的ping、不自动重放；保留等待并提示恢复连接后核对棋盘。只有已知未发送才清本次等待。ping自身失败仍保留等待。

写入中失败需隔离该流，禁止把后续ping/聊天拼到可能残留的半行后；只隔离仍为本次writer的连接，不能误关已经替换的新连接。沿用原断连/重连处理，不把断连事件或重连快照记为旧行动接受凭据，不自动补交未知行动。正式接受/拒绝/去重结果与跨连接核对继续独立。

离线核证计划：编译执行完整生产BluetoothGameSession/GameWebBridge，Android、org.json、UI调度与writer使用明确的最小替身；分别注入写入前、半行、换行、flush失败和旧writer竞态。再把其真实方法返回/原字节与生产Web函数及真实jieqi房间接合。此证据是JVM代码和离线调用链运行，不是Android JNI/WebView、真实radio/设备、完整DOM或独立QA。

保护src玩法/模式门禁、英雄/UI/H03、旧owner包、三线工作稿与真实回执；评分冻结、NET暂停，不打APK、不合并/部署。


实际证据：21项新增Node检查通过。完整生产Java类在OpenJDK17编译执行，16项当前代码检查覆盖本地成功、无设备/未连接、JSON/版本/大小写前失败、首字节前IOException、半行、换行、flush后未知、旧writer替换控制及旧void入口；另将PR21父版原两类编译执行3项明确writer故障控制。旧版首写失败后仍能送同编号ping、半行后拼ping均实际出现，新版则隔离当前失败流。替换writer用反射明确注入，不宣称Android中已自然复现该竞态。

8组行动、3组ping边界把JVM方法的精确输入/返回和完整writer行接到实际生产Web函数与真实jieqi房间；实际GameWebBridge产生的回调脚本解码后，传给实际Web原生事件监听器。这里只是记录边界接合，Android/JNI、org.json真实解析、Handler真实调度和radio并未执行。最小JSON替身仅提取合法fixture头部、保留输入字节，不是通用解析器验收。

flush故障时完整行动帧可能已被权威接受，同时本机返回unknown；首字节前/半行故障时权威未收到完整行动。这两类未知都不自动重放或发送行动后的ping。未知行动即使收到额外同编号pong控制也不解锁；原断连回调则沿既有生命周期清UI等待、继续锁断连操作，重连不补交旧行动。它不代表旧行动已接受/拒绝，完整结果核对仍开放。旧桥没有sendChecked时沿原兼容路径，不能声称已解决旧APK的吞错知识缺口；本轮没有打包或更新设备。

复现当前JVM：`python scripts/research/native_send_jvm.py --output=/tmp/current-native-results.json`。重建用于Node测试的完整JVM_RESULTS文件，须额外用`--parent-source-root=/path/to/engine-at-96fa739`提供不可变父版两类；完整阶段记录同时保存当前16项与父版3项，不能用缺父版的输出覆盖后再声称父版已跑。Node测试只消费并核对已生成且绑定源码哈希的记录，不要求每次Node回归启动JVM。

下一MAIN-BLUETOOTH-UNKNOWN-RESULT-RECONCILIATION-20261030：先核已写/未知行动在断连前后真实可达的顺序和各动作幂等来源，再设计兼容的当前请求结果核对。显式区分单I/O执行器/主线程排队保证与仅反射可造的旧回调；不能把重连或新快照当旧行动接受凭据，不自动重发未知行动。

验证完成：21新增Node、60相关文件935项最终串行、另50现有Web静态、16项JVM及3项父版故障控制通过，37模块生产转换通过。首轮完整回归934/935，未改评分隔离项invalid_policy_execution；21项孤立复核和完整935项再跑均通过，根因未证，评分源/预算均未改。4旧素材检查、全资产包/全类型/Android SDK/JNI/radio/真机/完整DOM/独立QA未验。
