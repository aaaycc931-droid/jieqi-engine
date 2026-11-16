# 岑缨 EXP-HERO-002｜历史归档续做核验（2026-11-16）

本记录仅覆盖本次可验证的恢复包取回与公开发布前检查；不是补传完成回执。

- 原包：cen-ying-recovery-20261114.zip，12,722,717 bytes，SHA-256 2ace4d651b35e0e6b8f8f2923632c07e8ead800c805e66e72ba7dad2d7d89ea5。
- 本轮从已授权 Library 文件恢复原包，实核 SHA-256 一致，ZIP 59 个成员 CRC 全部通过。
- 54 项清单原件按原分类：36 项工程增量、3 张生成原图、9 份旧交接快照、5 份原日志、1 份依赖记录；另 5 个恢复附属文件：README_RECOVERY.md、RECOVERY_MANIFEST.json、RECOVERY_OBSERVATION.json、source-git-status.txt、tracked-changes.patch。
- 正式工程候选 38/38 已在原 PR #31 专属分支，正式 PNG 母版已归位；原包中两张生成原图与正式母版重复，不重新发布为运行资源。
- 待补公开档案 8 项：generated-originals/exec-780d0d86-9934-4bf6-84b7-de60497b913a.png（未采用初稿）；original-logs/core-02-final.log、core-02-root-verification.log、core-02-targeted.log、full-02-test.log、web-02-regression.log；source-git-status.txt；tracked-changes.patch。
- 上述 8 项仍保留在完整原包中，本轮没有宣称已逐项上传工程仓库。原始旧交接快照、依赖记录、未脱敏元数据原件及恢复附属文件的保存去向为「完整原包（Library）」；公开工程内的现行状态不可由旧快照覆盖。
- 本轮对 5 份原日志、旧补丁和 Git 状态文本进行常见凭据、私人目录、账号路径模式检查，未发现明显命中；该筛查不等于完整安全审计。原补丁禁止应用，旧测试日志不冒充本轮新测试。
- 本轮本地 GitHub 直连因 DNS 解析失败，无法从恢复包上传 2,288,094 字节未采用 PNG 原件；未用生成图或文本重构代替。剩余原件需通过支持原始二进制上传的渠道完成，随后核远端字节/哈希及全清单去向。
- 继续复用 jieqi-engine PR #31，保持 draft、不合并、不部署、不生成 APK。主线接收仍 UNKNOWN，真实浏览器/触摸、真人或更强策略平衡、独立 QA、完整类型检查仍未完成。
