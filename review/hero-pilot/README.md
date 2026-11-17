# EXP-HERO-001 司衡 v1

真实代码、专项测试与局部实验的绑定证据。VALIDATION.json区分通过、曾失败和未验证。PLAYOUTS.json包含一局30动作自然终局、技能发动的完整回放，以及18局的种子/紧凑动作记录。SCENARIOS.json是合成局面见证；DOM_SMOKE.json不是浏览器截图或真机试玩。

完整设计/运行/强度和最新回传：[固定入口](https://github.com/aaaycc931-droid/lezi-handoff-packages/tree/main/worklines/hero-pilot)。默认产品池不变，需 /web/?heroPilot=1。未合并、未部署。

2026-11-13追加：主线指出的换轨(0,0)标记问题已修复，见VISUAL_REPAIR.json；新增双端动作元数据及DOM断言。原18局与1025项仍绑定v1，不冒充本轮重跑。

美术恢复：七个实现文件、两张生成母版、四张WebP和原日志完整找回，见ART_RECOVERY.json。原日志与本轮56项Web、14项DOM、构建和4个HTTP资产检查的完整日志在art-recovery-logs/；所有原实现及导出保持原字节。真实浏览器/触摸及独立QA仍未完成。先运行DOM检查，待其删除临时测试模块后再构建。
