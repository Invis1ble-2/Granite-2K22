# NBA 2K22 私服迁移交接

更新：2026-10-14。本文汇总当前状态，取代重复的历史过程记录；保留关键证据路径和待办边界。

## 当前状态

| 范围 | 状态 |
| --- | --- |
| MyCOURT 进入、返回街区、邀请AI | 用户验收通过 |
| MyCOURT 开始/退出延迟 | 用户确认已解决 |
| MyCOURT 16个可见玩法（含个人实训） | 修复完成，用户验收通过 |
| 单人公园2v2及当前测试球场对齐 | 用户验收通过；模块版本0x00010206 |
| 登录、生涯/属性与徽章、BOOST购买、街区排队布局 | 用户此前验收通过，详见对应历史交接 |
| 多人真人同步、沙发/街机入口 | 未支持；不属于本轮验收 |

### MyCOURT 可见玩法

菜单编号与COURT类型不同。下表列出菜单编号→COURT类型、支持人数及名单分侧；全部玩法均已由用户验收。

| 玩法 | 菜单→COURT | 人数 | 名单 |
| --- | --- | ---: | --- |
| 投篮训练 | 0→33 | 1 | Home |
| 发球机（此前称投篮机） | 12→55 | 1 | Home |
| 比拼10投 | 1→49 | 2–4 | Home |
| 环游世界 | 2→50 | 2–4 | Home |
| 淘汰 | 11→54 | 2–5 | Home |
| 限时搭档三分球 | 3→51 | 2 | Home |
| 7分投篮 | 4→52 | 2–5 | Home |
| H-O-R-S-E | 5→53 | 2–5 | Home |
| 1对1 | 6→9 | 2 | Home 1 / Away 1 |
| 2对2 | 7→8 | 4 | Home 2 / Away 2 |
| 3对3 | 8→6 | 6 | Home 3 / Away 3 |
| 无限制罚球 | 13→58 | 1 | Home |
| 个人实训进攻 | 15→56 | 2 | Home 1 / Away 1，本机在第1位 |
| 个人实训防守 | 16→57 | 2 | Home 1 / Away 1，本机在第2位 |
| 全场封锁训练 | 17→59 | 3 | Home |
| 接球投篮 | 18→60 | 1 | Home |
| 防守压力训练 | 14→61 | 3 | Home |

菜单9/10沙发/街机使用另一入口，当前不支持；多人真人同步也未实现。名单ID按请求顺序保留，不克隆AI或伪造玩家资料。非零多人真人标志会被拒绝。

## 关键实现与证据

- **代际兼容**：NBA 2K22换服正文偏移为WorldKey `0x48`、TicketLength `0xB2`、URL `0xB4`；NBA 2K19旧偏移保留。代际依据已识别的PLAYER布局，不以共享活动ID猜测。
- **MyCOURT对象**：2K22房间使用独立30字段schema（StadiumData 4860字节、StadiumSetup 2784字节）；2K19旧schema保留。2K22 COURT为148位布局，PLAYER状态按解码字段更新，避免破坏身份字段。
- **请求延迟**：MyCOURT开始、连接完成、结束命令使用完整u64请求ID及时ACK；需同时推进关联对象版本。重试不会重复开赛，连接完成只重发当前COURT，不重建比赛状态。修复后用户确认延迟问题解决。
- **个人实训崩溃**：历史崩溃由Home2/Away0名单与客户端AI阵容要求Home1/Away1不匹配引起。菜单15/16现按原顺序写Home1/Away1，并校验本机所在位置；用户已确认修复通过。
- **公园保护**：单人2v2仍使用模块 `0x00010206` 的已验收保护和Court映射；未修改其场地marker、变换或排队坐标。
- **原生分析适用版本**：Ghidra程序 `NBA2K22.exe.unpacked.exe`，SHA256 `14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0`，基址 `0x140000000`。固定地址仅适用于该二进制。

主要证据：菜单表 `0x142432A20`（`FUN_140640F60`）；个人实训AI阵容断言见 `FUN_141978AC0`/`FUN_14197DA80`；崩溃报告 `console logs/granite-crash-20261014-174034-25320.txt`，同次客户端调试包 `Granite/Server/Storage/Captures/Http/20261014094034858_9080_000184_POST__nba_2k19_DebugLogs_pushdebuglog_gz_x_5801954931915208528.bin`。历史证据保留原位。

## 其他未完成项

以下不是本轮MyCOURT玩法验收的一部分：

- 多人真人同步、满员多人比赛、沙发/街机入口。
- 比分/人数显示、完整比赛结算；用户曾反馈公园赛后数据展示异常，原因待查。
- MyCOURT访客及房间 `RemovedPlayers` 字段的客户端消费语义仍未核实。
- 篮筐/篮网动效、部分街区商店商品及动画目录完整性、服装显示、Ante-Up进入问题仍待调查；Ante-Up的2K22兼容性目前只是待验证假设。
- 新档首次属性预算的全部时序尚未覆盖。

## 工程与操作约束

- 工作区：`D:/download/Granite-main`。HTTP服务源码：`Granite/Server`（TLS 21000）；Opal源码：`Opal`（TCP 20054、UDP 28091）。游戏：`D:/SteamLibrary/steamapps/common/NBA 2K22`；控制台日志位于 `console logs`。
- DLL源码/构建位置：`Granite/Module`、`Granite/Build/Release/Module.dll`；游戏加载文件为游戏目录下的 `Module.dll`。当前部署模块版本为 `0x00010206`，历史SHA256 `C4454ACF0065FF590BD5EE41C1F8DA0B053F1D9703118DF5CD5CF3BAF115DDFC`。
- Opal源码更新由用户退出游戏后重启Opal加载；不需要HTTP重启或DLL更新。未经明确要求，不重启服务、不终止游戏/服务、不部署DLL、不覆盖运行配置。
- 代码改动只做语法/差异等静态检查；功能测试及游戏内验证由用户执行。用户验收与自动化测试分别记录，不以静态检查代替游戏结果。
- 不恢复生产自动帧捕获，不删除历史日志、抓包、崩溃dump或用户数据。HTTP抓包位于 `Granite/Server/Storage/Captures/Http`；Opal只保留历史捕获。
- 项目其他交接：`NBA2K22_NEIGHBORHOOD_HANDOVER.md`（街区）、`NBA2K22_BADGE_BUDGET_HANDOVER.md`及`NBA2K22_PROGRESSION_HANDOVER_FINAL.md`（生涯进度）。
