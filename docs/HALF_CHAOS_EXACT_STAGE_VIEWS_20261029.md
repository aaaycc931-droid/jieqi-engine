# 半混乱原56槽位的精确棋局时点投影

任务`MAIN-HC56-EXACT-STAGE-VIEW-20261029`，父版本PR18 `099eca44dbaab39bdedb02a9986f7d54e9761121`，实际执行2026-10-29。取得原12真实序列/110请求中的200个精确棋局时点投影，以及原56个双世界、双玩家比较槽位的服务器投影组成部分。**完整原56槽位验收仍0，客户端实际送达仍未验证。**

## 改动和时点

`captureMechanismEvents`增加可选的同步`projectCheckpoint`。只在真实`main_action_atom_closed`/`formal_turn_settled`发射时调用；输入是已经复制、冻结的真实权威快照，输出也复制并冻结。查询抑制期间不运行回调，候选失败丢弃其证据；投影抛错、修改冻结输入、返回Promise或不可复制结果，只使该次研究证据失效，不改变成功的游戏结果。关闭研究捕获或不提供回调时没有新投影；新字段只在研究事件中，不进入游戏或玩家协议。

原半混乱驱动可选`stageProjections:true`，仍从原不可变真实32棋初始化、选角/RPS/私密世界与精确tuple自然执行全部原请求。每个阶段通过实际`serializePublicRemoteRoom`和双方经`playerRoomView`身份验证的函数生成JSON，发生在下一begin和请求返回之前，不拿返回后的棋盘冒充此前时点。

存在必须保留的结构边界：`remote-room`在整次请求完成后才创建新的房间、消息历史和`updatedAt`。本轮使用真实请求入口房间外壳，替换其中的游戏部分为真实阶段快照，用于纯服务器投影。阶段棋局/私密状态是精确的，**外层消息、房间时间、错误/回执和客户端通道不是该中间时点的新提交包**。报告标记`ACTUAL_REQUEST_ENTRY_METADATA_NOT_COMMITTED_ROOM_DELIVERY`，不宣称已经向客户端发布中间帧。

## 原来源和实测

原HC51合同原字节作为`tests/fixtures/half-chaos-original/HC51_PAIR_VIEW_CONTRACT.json`复用，Git blob为`22abe23c22ab0032aa014e6a4afbf6f3f128b66f`，SHA256为`5080e34bb93a640827acefb79d60a57f58049eef630d1e918b6ba3836c1388f0`。原初始化和请求输入不改，不新增刺激。原56槽位的两世界演员/起终点/主行动绑定112项已对照实际保存的权威阶段动作，全部一致。

| 实际取得 | 数量 |
|---|---:|
| 原序列 / 请求 | 12 / 110 |
| 主原子 / 正式结算 | 100 / 100 |
| 精确棋局时点公共JSON / 玩家JSON | 200 / 400 |
| 原双世界玩家比较槽位 / 底层玩家JSON | 56 / 112 |
| 窄范围编号映射后可见字段一致 | 56 |
| 完整原56义务 / 实际客户端送达 | 0 / 0 |

两组初始私密世界各有2个真身槽位不同，公开初始状态相同。比较只在明确的房间、玩家、请求和系统消息编号字段，按真实驱动发行的精确值映射；玩家字典键也只映射对应真实席位。不删除或忽略时间、版本、截止、消息正文、棋子、效果或合法揭示值；未发行编号及其他位置上的相同字符串不替换。56次实际比较没有剩余可见差异；这只支持原两组对照，不是普遍无泄露证明。若以后有差异，必须按来源许可分类，不能因同语义输入预设所有输出相同。

投影检查还核对公开棋局等于该事件的公开快照、玩家侧正确、未携带内部secret/身份表/processedActions/凭据和未揭示棋真身。400份玩家JSON是函数生成和序列化证据，不是400次网络送达。

## 验证和复现

25项新检查，相关针对性52项通过；最终55文件873项通过、0失败。同作者测试不是独立QA。

110条原请求分别对照固定父版、新默认无投影、新同步投影及完全关闭观察：权威、秘密、事件、历史、请求结果、视图、时钟和RNG一致；事件对照只剥离本轮新加的`checkpointProjection`字段，其他完整比较。同步投影版本全部110请求在真实`Math.random`和`Date.now`抛错保护下执行，实际调用均0；原条件随机来源不变。观察开/关或祖先失败也不生成玩家状态字段。

```sh
node --test --test-reporter=tap tests/half-chaos-stage-views.test.ts tests/original-half-chaos-research.test.ts tests/research-evidence-validity.test.ts
node scripts/research/half-chaos-stage-views.ts --output=review/half-chaos-stage-views/RESULTS_20261029.json
node scripts/research/half-chaos-stage-differential.ts --baseline-root=/path/to/blob-verified-pr18-parent --output=review/half-chaos-stage-views/DIFFERENTIAL_20261029.json
```

`--owner-raw=/private/path/trace.jsonl`可另存实际原始证据；它含私密权威内容，只供所有者，禁止混入公开报告或玩家消息。公开仓库的RESULTS、SOURCE_AUDIT、DIFFERENTIAL、BASELINE_INTEGRITY、COMMAND和TAP仅保存核证结论、公开元数据和哈希。本轮新的owner包与以前原始轨迹是不同产物，不能重命名或覆盖原NP32包。

## 仍开放

原56槽位要求完整房间消息/成功或重复/错误回执以及实际应用通道；本轮只补精确棋局的服务器投影组成部分，完整义务未解除。下一核清实际提交包、序列化调用方和错误/重传送达路径，先形成已有通道的真实证据；不为凑验收擅自向产品发送中间阶段或改公开政策。

原64规格正式验收仍0，缺原刺激/完整终局、暗子完整来源、其他英雄/空间/阶段、公开三态消费者、全类型编译和UI/设备/独立QA均保留。玩法、模式门禁、山/风、UI、H03与评分冻结账本不改，NET暂停；无合并、部署或APK。
