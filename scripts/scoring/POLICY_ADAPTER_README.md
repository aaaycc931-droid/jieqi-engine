# 原揭棋研究策略适配器 v0.1

范围：EP-HH-01，稳定玩家A=H14夜、B=H11代号1，固定尖斜背景。四个整套来源世界与两个处理前猜拳分层均保留。此版本实现P0流程诊断，正式评分冻结；没有P1强度代理资格或群体采样资格。

## 运行

Node >=24；无额外依赖。

```sh
node --test --test-reporter=spec tests/scoring-policy-adapter.test.ts
node scripts/scoring/run-policy-qualification.ts /absolute/private-output
npm run check
```

诊断命令生成1个固定种子诊断簇的8条相关条件轨迹，每条最多8次决策。不能把8条轨迹计为8个独立样本。到上限仍未终局时记录censored，未知规则终局blocked，执行故障invalid_execution，不强记和棋，不输出q/H/I/B/J。原始权威/私有日志仅写入调用者指定的私有目录，不提交Git仓库。

## 接口与边界

- `PolicySession`：权威研究执行器，保存当前room、准备全过程、尝试、真实机制事件及显式收据时钟。策略不得取得它的引用。
- `ObservationBroker` / `policyProjection`：从产品玩家视图按EP-HH-01字段白名单重建。仅投递改变的授权投影及本人提交收据；玩家delivery_seq与权威审计序号分离。公开棋盘记录不投递原始动作ID，防止私有失败次数经ID序号成为旁路。
- `attemptCatalog`：仅使用公开棋盘、公开来源及本人合法观察。公共几何可过滤，秘密身份不参与真实合法性预筛。
- `decideIsolated`：固定已审P0程序运行在独立Node进程；空环境、仅允许读取worker文件、禁止子进程/写文件/扩展模块/动态字符串代码生成。工作程序不导入网络、权威或引擎，也不执行用户插件。本机制仅对该固定程序作权限隔离，不声称是任意不可信插件的安全沙箱。
- `PolicyInput`、记忆与4字节策略随机输入是唯一IPC载荷；输出intent、nextMemory、decisionUsage。同输入必须得到同三项结果。
- 策略记忆保留历史授权洞察的known_then及观察时mapping_epoch；洗牌后根据最新valid标记停止使用旧位置约束，不删除旧记忆。
- `SemanticRandom`：基于HMAC域的有界拒绝取样；初始29步Fisher-Yates与来源语义分域，失败/重放不提交来源随机事务；skip与wash分域。固定尖斜选择是条件输入，非畸变概率样本。算法提供给定均匀随机字的有界均匀性；固定诊断seed不是经验群体法则证明。
- `ClusterRegistry`：按本生成约定拒绝复用诊断簇/根到另一个计数或分区；每条件独立策略记忆。登记本身不证明统计独立或有效样本量。

## 来源开关的实现

`src/research-source-context.ts`提供受控、同步、房间限定且禁止嵌套的研究能力；不由客户端JSON或房间选项读取，也不从`src/index.ts`导出。产品默认行为保持两方正常选择。

关闭态在准备选择时移除对应有效选择，随后由既有初始化建立合法的部分来源锁：H11关闭不交换、不保存shuffleOpening、不开放窗口；H14关闭不产生瞳力/洞察状态或信号。不是清一次runtime、禁按钮、换英雄或全局heroesEnabled=false。产品英雄校验与新模式featuresReady保护继续执行。上下文只支持原揭棋H14/H11+尖斜；任何扩展需新验收。

研究路由登记每次ID的actor及载荷，冲突返回单独的`RESEARCH_ACTION_ID_CONFLICT`；同ID同载荷继续经实际权威入口重放。产品现有接口本身仅按ID去重，此版本没有改写该行为。失败仍经过单列的收据时间推进，不能靠失败永久冻结时钟。

## 支线接入

版本：`original_jieqi_P0_v0.1`。两条支线可沿用intent/收据/可见历史/确定性对照的结构，提出各自模式投影与合法局面加载器差分。当前`policyProjection`明确拒绝其他模式，不可直接移除检查来接入。普通/半混乱的模式资格、来源交互和时序需分别独立验收；主线通过不授予它们运行就绪。

未完成：P1信念搜索与预算资格、完整对局流程资格、经验群体生成法则/权重/n/alpha预注册、20维I编码，以及冻结解除。H03、H11×H15与M07预刷新秘密读取等原待确认规则继续阻断。P0的优先选择洞察/洗牌仅为覆盖流程，不代表竞技强度或最佳策略。
