# 第二自主英雄｜EXP-HERO-002｜岑缨
本线只制作第二名自主英雄，与司衡同属 WORLD-EXP-01／世界 E「悬衡界」。第一名司衡仍归 `worklines/hero-pilot/` 及 PR23；旧启动词中的分支、任务和断点不在本线接续。
## 开始／继续
1. 核本库 main 与 `jieqi-engine/codex/autonomous-hero-02-20261114` 最新 HEAD；读取 [TASK_FROM_USER](TASK_FROM_USER.json)、[DESIGNER_BRIEF](DESIGNER_BRIEF.md)、[CURRENT_STATE](CURRENT_STATE.json)、[SESSION_CLOSEOUT](SESSION_CLOSEOUT.json)、[RETURN_TO_MAIN](RETURN_TO_MAIN.json)、[READ_RECEIPTS](READ_RECEIPTS.json)。
2. 这是2026-11-14用户直接委托的新任务；没有伪造主线派发或主线已接收。后续若主线发来任务，实际读取后再登记。
3. 按 `collaboration/CURRENT.json`、`docs/WORKFLOW.md` 和 [PROJECT_INSTRUCTIONS](PROJECT_INSTRUCTIONS.txt) 恢复来源、有效授权、并发保护与中断断点。先核关联分支的实际成果，不因旧文件未更新重做。
4. 世界观读取独立分支 `ui/restart-asof-20261104-1119` 当前原文，并结合司衡的 `worklines/hero-pilot/DESIGN.md`。同世界不等于同职业、同画风、同技能。
5. 沿 [DESIGN](DESIGN.md) 完成真实引擎、可选择的本机完整对局、美术、反制与强度验证。自主作本英雄的创意和工程决定，不逐项向用户问参数。
## 所有权与交付
交接仅写 `worklines/hero-pilot-02/`；工程仅写第二英雄专属分支。共同开发底座采用 PR22 `71145df45ad17215a3731e53150b6728e079e375`，与司衡为同底座兄弟增量，不依赖PR23未合并资产，也不把较旧engine/main当现行工程。
只在显式 `?heroPilot2=1` 的本机混乱象棋入口加入岑缨；默认英雄池、其他模式门禁和NET保持。产物为可审工程候选，保留draft；合并、部署、APK仍不在本任务范围。
阶段成果按最新父树、expected_sha、force=false保存并读回。具体状态以CURRENT_STATE与实际分支为准；独立QA、真人强度、真实设备验证分别记录，不用自测替代。

