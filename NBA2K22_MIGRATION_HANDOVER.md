# NBA2K22 私服迁移交接

更新：2026-10-13（MyCOURT进出用户通过；1v1、比拼十投、投篮机正常游玩已获用户确认；玩法适配仍不完整，玩法开始和退出各有约10秒延迟待查）。当前Module **0x00010206**。单人2v2开赛/打球与当前测试场地映射保持用户已通过状态。代理未重启服务、未改运行配置、未编译或部署DLL。

## 当前状态与任务

游戏日志 `granite-20261013-171006.log` 确认0x00010206、StartGame/Playing校验通过、两队四个有效AI名单、InitPlayingGame returned 1。用户实际开赛及打球通过，因此不再把单人开赛、名单绑定或本轮闪退列为待验收。该验收仅限本轮单人2v2，不代表多人同步、全部球场或完整结算已通过。

实际测试球场HALF_CENTER_BOTTOM_RIGHT。修正前用户三张截图确认实际边界、篮圈和三分判定相对可见场地共同偏移，不是单纯排队位置问题；修正后用户已确认场地映射正确，该错位问题不再列为待验收。

Ghidra和安装PE模式表共同核实：旧2v2 CourtType=6实际选择PARK_3_ON_3/SHORT几何，旧3v3=7实际选择PROAM_3_ON_3。已修正船上普通公园 **2v2=8（NBA半场）、3v3=6（SHORT全场）**，IsHalfCourt分别1/0。marker、变换、队列坐标和DLL均未改，不使用猜测平移量。

旧比赛日志最终初始化flags=0xC，原生AI世界将其映射到SHORT；NBA与SHORT纵向半长相差约304.8，且模板原点不同。修正的是模板选择，现已有用户真实游戏对齐通过反馈；未新增修正后日志采样。

完整模式表地址、原生调用链、资源篮圈顶点与回归证据见 [NBA2K22_COURT_GEOMETRY_ANALYSIS.md](NBA2K22_COURT_GEOMETRY_ANALYSIS.md)。不再安排重复场地对齐验收或本地Blacktop采样；保留当前映射、marker、队列坐标和已验收单人保护。

## 当前实现与部署

单人用PLAYER字段91 ServerGenerated、144 UserGenerationSettings原生生成三个CPU，各有自身资料。按实际QueueFor(Court,Slot)确定真人队伍，保留座位。MatchId为game-info+0x2D8（uint32_t[0xB6]），随机种子+0x340；两处校验已修正。Playing钩子保留原生返回值/GetLastError，原生返回成功后写started=true。

此前GameData名单2/2但AI设置3/3导致第三个AI空roster崩溃。0x00010206只在已校验单人初始化当前线程期间让人数getter返回2/2，其他线程及普通比赛使用原getter。本轮真实开赛/打球证明该修正在本次测试中工作，不扩展验收到完整AI/控制器功能。

DLL保持0x00010206及原部署SHA256=`C4454ACF0065FF590BD5EE41C1F8DA0B053F1D9703118DF5CD5CF3BAF115DDFC`。本次修改仅Opal类型映射及相关测试。发现旧服务进程已退出，执行现有StartServers.bat，核验Opal PID25316（TCP20054/UDP28091）、HTTP PID27632（TCP21000），保留12帧/83Hz；PID需接手重查。

上轮七个相关服务端测试文件Node汇总25/25通过，五个JS语法检查通过，配置文件恢复核验。NativeSoloPark.json Enabled=true，单人2v2人数保护保留，未重编译/部署DLL。此前C++局部验证与用户单人开赛验收仍为历史记录；新类型的真实对齐现已由用户确认，3v3/多人开赛仍未验收。本轮仅文档更新，未重新运行测试或核验服务进程。

## 工程与运行

根目录D:/download/Granite-main，Git仓库已初始化，分支main；GitHub私有仓库：[Invis1ble-2/Granite-NBA2K22](https://github.com/Invis1ble-2/Granite-NBA2K22)。首次项目提交`c8256db`，补入服务所需TLS私钥的提交`357428f`；`Granite/Server/Storage/Certificate/Granite.key`按用户要求一并保留在私有仓库。游戏目录D:/SteamLibrary/steamapps/common/NBA 2K22，日志console logs。HTTP源码Granite/Server（node Server.js，TLS21000）；Opal源码Opal（node Opal.js，TCP20054/UDP28091）；模块Granite/Module，构建DLL为Granite/Build/Release/Module.dll，加载DLL为游戏目录Module.dll。HTTP封包Granite/Server/Storage/Captures/Http，Opal/Capture仅保留历史文件，新流量帧捕获功能已移除。

构建工具C:/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe，Module.vcxproj，Release/x64/v145。Git Bash需MSYS_NO_PATHCONV=1。部署DLL须游戏退出，覆盖磁盘文件不会替换已注入模块。

Ghidra程序NBA2K22.exe.unpacked.exe，基址0x140000000，SHA256=`14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0`；固定偏移只对已核对构建成立。

## 验收范围

| 项目 | 状态 |
| --- | --- |
| 登录、生涯、属性预算/购买/保存 | 用户通过；新档首次预算未覆盖全部时序 |
| 徽章预算、分配、保存 | 用户通过 |
| 商店概览、checkpoint刷屏 | 用户确认解决 |
| BUY BOOST展示、购买、到账 | 用户通过 |
| 6个3v3、6个2v2布局与排队圈 | 用户确认正常 |
| 入队/退出/离开区域延迟 | ACK修复后用户确认解决 |
| 单人2v2开赛、打球 | 0x00010206用户通过 |
| 比赛场地对齐 | 原生类型映射修正后，用户确认通过（当前测试场地） |
| 进入自己的MyCOURT、退出返回街区 | 用户确认成功；移动未单独确认 |
| MyCOURT球场玩法 | 用户确认1v1、比拼十投、投篮机及实际游玩正常；玩法适配不完整，玩法开始和退出各约10秒延迟待查；自由投篮、淘汰及其他模式不扩展验收 |
| 多人同步、满员开赛 | 未验收 |
| 人数遮罩、实时比分 | 缺失 |
| 完整比赛结算、增强商品消耗、其他商店 | 未验收 |
| 公园比赛结束后的比赛数据展示 | 用户反馈结算数据未正常显示；详情及原因待查 |

## 当前遗留问题（自创球场三种玩法已通过，适配完整性与开始/退出延迟待处理，其余暂不处理）

- **篮筐与篮网动效缺失**：投篮入网后篮网不动；扣篮时篮筐没有被压下的动态效果。场地位置映射已通过，动效作为独立问题记录，原因未确认。
- **街区商店商品缺失**：衣服、球鞋等商店商品缺失；此前商店概览与BUY BOOST通过不代表这些商品完整。
- **自创球场玩法适配不完整、开始/退出延迟**：进入、退出返回街区及邀请AI进入已获用户确认；最新反馈确认1v1、比拼十投、投篮机及实际游玩正常，不再将这三项历史故障列为待验收。玩法适配仍不完整，玩法开始和退出各有约10秒延迟，原因未确认；这是玩法切换延迟，不撤销已通过的MyCOURT进出验收。自由投篮、淘汰、其余模式及访客/多人不扩展验收，详见下节。
- **动画商店内容疑似不完整**：用户观察似乎缺失很多动画，尚未核对完整目录。
- **多件服装无法正常显示**：客户端仍向服务端请求衣服资源；截图包含 `/2k19/...` 的HEAD/GET请求。资源请求与显示异常的因果关系尚未确认，不能据截图直接认定缺文件、响应失败或版本路径错误。
- **竞赛球场Ante-Up无法进入**：Opal日志为 `0110000142D875E1 is travelling to stage @ 19:58:03`。用户怀疑未做2K22适配，仅为待验证假设。
- **公园比赛结束后的比赛数据展示异常**：用户反馈赛后比赛数据不会正常显示；尚未取得结算数据包、日志或截图，原因待查。

详细现象、截图请求路径和此前验收边界见 [NBA2K22_NEIGHBORHOOD_HANDOVER.md](NBA2K22_NEIGHBORHOOD_HANDOVER.md)“当前遗留问题与用户证据”。自创球场最新进展以下节为准，其余问题继续暂不处理。此前已按用户要求移除Opal生产自动帧捕获功能；本轮不恢复捕获、不删除历史证据。

生涯细节见NBA2K22_BADGE_BUDGET_HANDOVER.md、NBA2K22_PROGRESSION_HANDOVER_FINAL.md。保持已验收开赛、排队和场地映射实现，不再将比赛几何修正列为当前任务。

## MyCOURT 2K22适配（2026-10-13，进出及三种玩法通过，适配完整性与切换延迟待处理）

### 修复依据与实现

- 用户22:24:34旅行日志及截图错误727e66ac；历史HTTP抓包 `20261013142624416_32176_000033_POST__nba_2k19_DebugLogs_pushdebuglog_gz_x_2096467289657195082.bin`（Storage/Captures/Http）解压内容显示换服地址为空，继而 `HTTP MATCH_SERVER service 0 (null)`，约15秒后MyCOURT CONNECTING→TIMEOUT、ENTERING→NONE。旅行日志仅证明发送回包，不证明客户端连接成功。
- Ghidra仍为本文记录SHA256的 `NBA2K22.exe.unpacked.exe`。`FUN_1416871F0`确认2K22换服正文偏移：WorldKey=0x48、TicketLength=0xB2、URL=0xB4；旧2K19为0xB0/0xE0/0xE2。`ChangeServer.js`现按Generation选择布局，保留旧默认和1024字节路由窗口；`Connection.OnTravelRequest`传入已识别PLAYER代际，不根据共享Boulevard activity ID猜版本。
- MyCOURT新连接从同一PUID的活动连接继承唯一、已识别的PLAYER代际；无确定来源则沿用默认并由其自身PLAYER握手识别。普通公园连接逻辑不变。
- `FUN_141655790`/`FUN_1416E7E50`核实30位房间位图；`FUN_1416E18E0`核实StadiumData=0x12FC（4860）、StadiumSetup=0xAE0（2784），末尾bit29为OwnerCloudSaveId/u64。`MyCourt.js`新增独立2K22 schema，旧29字段及4856/2712字节校验保留；现代ObjectFrame房间类30字段，旧Nineteen布局保留29字段，房间正文按明确代际重新解码。
- 最小ownership bootstrap仍仅发送WorldTime/OwnerId/State：两版位图均4字节，保留兼容字节，不捏造OwnerCloudSaveId。已有原生ownership时跳过延迟bootstrap；缺ownership时合并最小字段，保留缓存内容和版本。普通快照与模板共用字段缓存，后续部分更新保留球场/guest/云存档字段并返回较新版本；2K22带序号的房间更新另发送正文前完整BE U64请求ID ACK。缓存回放和转发按代际隔离。
- 未修改HTTP MyCOURT占位接口：本次故障证据没有这些接口的实际调用。未改普通公园名单、队列、AI保护、CourtType/几何映射、DLL或服务运行配置。

### 检查与验收边界

- 四个生产JS及两个现有测试文件均 `node --check` 通过，`git diff --check`通过。完成一次只读代码审查并修正延迟bootstrap覆盖快照、模板遗漏字段缓存两项缺陷，修正后重新检查语法。Travel.test.js补充2K22偏移与共享Boulevard入口用例；MyCourtRooms.test.js补充完整schema、兼容bootstrap、完整请求ACK、部分更新保留、新连接代际继承、延迟bootstrap和模板保留用例。**这些用例本轮未执行**；历史测试通过记录不代表本次改动已通过功能测试。
- 代理未启动/重启HTTP或Opal、未终止游戏或服务、未编译/部署DLL。
- 源码修复后用户明确反馈“进入自创球场成功”“退出返回街区成功”，因此进入自己的MyCOURT、退出返回街区已通过游戏实测；不再将进出失败或必须重启Opal列为当前阻塞。此次反馈未附新的协议日志，不据此额外宣称具体bootstrap/回执已核验。
- 玩法最新实测：用户明确反馈“1v1、比拼十投、投篮机都正常，游玩也正常”，因此这三种玩法已通过用户实际游玩验证，历史投篮机/比拼十投崩溃、1v1误启为3v3不再列为当前待验收问题。用户同时报告玩法适配不完全、玩法开始和退出各约10秒延迟，尚无对应新日志或计时证据，原因未确认。不扩展为全部模式、完整结算或多人同步已通过；23:49:53菜单模式11结束请求仍只是历史协议证据。

### 玩法故障排查与修复（2026-10-13，历史修复记录，最新验收见上节）

- 复现：用户可邀请AI进入MyCOURT，但“淘汰”开始按钮无反应，自由投篮也不可用。新Opal日志23:20:28进入并bootstrap、23:20:30重连及PLAYER发布，房间Customization/PlayerState/UserData更新返回revision 3、5；23:20:58记录 `asked for a MyCourt court type 11 (players 2, count 2, soloFlag 0, type 11)`，确认开赛请求被识别，但不证明游戏启动。
- Ghidra此前两次调用返回不可用；用户重启PI-Desktop后恢复，`get_program_info`核对当前`NBA2K22.exe.unpacked.exe` SHA256与本文一致。此连接阻塞已解除。
- 原生证据：`FUN_14045B590`构造命令0xAB153D7E及四个既有参数，并检查房间State=0x9712981B（SCRIMMAGE）；`FUN_14045A970`检查比赛结束与房间状态。`FUN_1416A5580`仅在PLAYER为PLAYING且CourtName非零时查询COURT。`FUN_1416BD430`命名确认PLAYER前四字段为Puid/MachineId/MiniGameId/MiniObjectId，field4=State、field5=CourtName；不再把51/55当作2K22状态偏移。
- COURT类型表本身仍有效：`FUN_141484770`使用0x142C41E70的64项表，ONE_V_ONE=9、SHOOTAROUND=33等。本轮内存核对另确认BEST_OF_TEN=49、SIGN_OUT=54、GUN=55。但这不是START_CRIB_GAME菜单枚举；**撤销上轮“type11原样发送为COURT 11”的结论**，原因与最新适配范围见后节。
- `Shootaround.js`新增2K22版本分支：COURT用148位图/19字节（旧116位图/15字节保留），复用现有`CourtLayout2K22.Bit`，发送Name0/IsActive1/SetupGate11/MatchId17/CourtType20/AwayCount28、AwayPlayers30起/HomeCount55、HomePlayers56起。继承20字段在本轮`FUN_1416E7A00`复核；后128字段沿用已分析`FUN_1416E6570/FUN_1416E1080/FUN_1416DE580`的项目布局记录。不改公园布局或几何映射。
- `PlayerBody2K22.SetGameState`按已解码字段插入/替换field4/5，保留身份字段、其他字段和尾部；开始/重应用/结束均按代际处理。2K19固定偏移路径保留。**已撤销上轮“现代请求值1..63原样保留”的错误策略**；当前菜单值须经下节显式映射，未知模式不回退。
- 148位COURT编码、PLAYER字段修复、房间schema与ownership/cache逻辑保留；仍不生成替代AI、不克隆USERDATA，不改公园或DLL。分队已改为模式专用，不再对所有训练模式均分两队；日志明确区分menu mode与COURT type，不增加自动抓帧或测试开关。
- 上轮三个永久用例中“现代值原样保留”的断言同样错误，已修正为五项菜单转换，并新增非法人数/重复及缺失ID/未核实模式拒绝时不产生COURT、PLAYING、SCRIMMAGE的用例。语法检查及差异检查通过；**功能用例未执行**。
- 最新用户验收与遗留问题以下节为准；三种玩法正常来自用户实际游玩反馈，不以源码修正或静态检查代替游戏验收。

### 菜单模式混用及崩溃修正（2026-10-13，部分适配，三种玩法用户通过）

- 用户Opal时间线：23:44:29菜单值12/单人被错发成COURT 12（ONE_V_ONE_V_ONE）；23:46:41菜单值1/两人被错发成COURT 1（FIVE_V_FIVE）；23:50:24用户选择1v1，菜单值6/两人被错发成COURT 6（THREE_V_THREE）。不能用增加或克隆AI补齐错误模式人数。
- 原生请求：`FUN_14161A1B0`把MyCOURT活动对象+0x388的菜单模式写入0xBA4BBA9D，+0x38C人数写入0xA8357302、+0x384标志写入0x07BC2A56，ID列表+0x390写入0x190BBDBC；命令仍0xAB153D7E。`FUN_14168C4B0`确认菜单模式0..18与校验规则：0/12/13/18仅本机1人；6/15/16为2人；7为4人；8为6人；14/17接受3、4或6人；1..5/11是变动人数并统计非AI参与者。菜单编号不是COURT.Type，不能按数值直通。
- 崩溃证据：`console logs/granite-crash-20261013-234641-29260.txt`时间23:46:41.780，0xC0000005在`0x140979200`读0xF8，RCX=0。调用栈`0x14197D643 → 0x14197E05E → ... → 0x14169F214`；栈扫描有`AI_InitRosterData`、`rosterPlayer != null`及“Settings ... expect 5 on-court + 0 bench players on the HOME Team, but we have 1”。本轮Ghidra确认`FUN_140979200`读取roster+0xF8，`FUN_14197D550`在准备阵容时调用此读取。与该次错发FIVE_V_FIVE相符；不能据此宣称其他全部崩溃都是同一原因。
- 当前显式适配：菜单0→COURT33/SHOOTAROUND（1人）；1→49/BEST_OF_TEN；6→9/ONE_V_ONE（严格2人，1/1）；11→54/SIGN_OUT；12→55/GUN（1人）。输入模式关联依据用户菜单操作与对应日志，输出类型名/值依据本文同SHA256二进制的0x142C41E70表；尚未找到全部19项统一转换路径，不把其余编号猜成COURT类型。1/11目前使用同侧训练名单，上限5是COURT单队容量保护，不代表所有人数组合已获游戏验收。
- 开赛前校验声明人数=ID数量、非零且唯一、包含本机ID、符合模式人数范围；未知模式（2..5、7..10、13..18及越界值）记录`MyCourt start rejected`并在任何比赛对象/PLAYER状态/房间状态写入之前返回。不是“已经支持这些模式”，也不是运行配置开关。房间GameType保留原菜单ID，COURT字段20写转换后的类型；日志显示两者。
- 当前仍未完成：其余菜单模式映射、模式特有名单/训练设置与未验收玩法的游戏验证；五项源码映射中仅1v1、比拼十投、投篮机已获最新用户正常游玩确认，自由投篮和淘汰仍未验收。AI原请求ID与原生房间UserData/PlayerState缓存保持，不部署新增CPU或修改已验收单人公园人数保护。
- 当前延迟问题：用户报告玩法开始和退出各有约10秒延迟，原因尚未分析；后续排查需对照操作时间与Opal/客户端现有日志，不能直接认定为ACK、超时或固定等待导致。本轮按用户要求仅记录，不修改代码、不启动排查或要求重复验收已通过的三种玩法。
- 本轮只改`Shootaround.js`、现有`Shootaround.test.js`和本主文档；保留其他用户改动、历史日志及dump。两项JS `node --check`通过，命令级`git -c core.safecrlf=false diff --check`通过；未执行功能测试、未重启服务或终止游戏。
- 最新反馈记录轮仅更新本主交接文档，记录三种玩法正常游玩验收及上述两项遗留问题；未运行功能测试、未操作游戏或服务、未修改源码/运行配置或部署DLL。
