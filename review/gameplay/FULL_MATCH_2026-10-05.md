# 真实浏览器完整对局抽样证据

源码 `e3e3da189f178496e229752b4ff5724194aae59f`；Chromium 145.0.7632.6；run37262023373；artifact11324822314。

补测13次开局：12局自然结果、1局观察上限。首轮12次开局：9局自然结果、3局观察上限；首轮CI失败完整保留。全部12个英雄席位场景均有自然结果样本，普通动作策略不覆盖主动英雄技能。

| 场景 | 红方 / 蓝方 | 尝试 | 畸变 | 行动数 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 1 | warrior / death_knight | 1 | jian_xie | 14 | ambush |
| 2 | qin_long / prince | 1 | war_chariot | 293 | stalemate |
| 3 | wind / hunter | 1 | jian_xie | 11 | ambush |
| 4 | rogue / devout_zealot | 1 | shadow_dance | 300 | 观察上限，未完成 |
| 5 | nozdormu / murozond | 1 | jian_xie | 95 | stalemate |
| 6 | murozond_minion / deathwing | 1 | shadow_dance | 97 | stalemate |
| 7 | death_knight / warrior | 1 | war_chariot | 93 | stalemate |
| 8 | prince / qin_long | 1 | iron_wall | 6 | ambush |
| 9 | hunter / wind | 1 | cavalry | 28 | ambush |
| 10 | devout_zealot / rogue | 1 | iron_wall | 109 | stalemate |
| 11 | murozond / nozdormu | 1 | chaos | 182 | stalemate |
| 12 | deathwing / murozond_minion | 1 | iron_steed | 21 | checkmate |
| 4 | rogue / devout_zealot | 2 | iron_steed | 181 | stalemate |

完整原始报告（含初始/末局公开状态、逐步动作、结果或未完成状态）以标准gzip无损保存：`full-match-browser-2026-10-05.json.gz`、`full-match-browser-2026-10-05-first.json.gz`；可用Python gzip.open读取JSON。报告SHA256分别记录在对应summary.json中。截图由CI artifact保存。

没有读取秘密身份、修改发牌/畸变概率、装载棋局、替换时钟、认输或强行注入终局。只读观察器仅存在于审核服务器响应，不在产品JS或Android中。所有正文规则和批准美术未改。

合同完整验收仍为0；主动技能完整对局、亲征抽样、全组合、时限终局、Android WebView及物理双机仍待。
