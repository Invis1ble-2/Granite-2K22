# NBA2K22 私服迁移交接

更新：2026-10-13（补充用户验收与遗留问题）。当前Module **0x00010206**。用户已确认单人2v2开赛/打球；Opal原生玩法类型映射修正后，用户确认“完美，场地映射正确了”。本轮仅更新交接文档，不修改代码或继续排查。

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

根目录D:/download/Granite-main，Git仓库已初始化（main）；首次提交及GitHub私有仓库推送状态见本次交接更新。游戏目录D:/SteamLibrary/steamapps/common/NBA 2K22，日志console logs。HTTP源码Granite/Server（node Server.js，TLS21000）；Opal源码Opal（node Opal.js，TCP20054/UDP28091）；模块Granite/Module，构建DLL为Granite/Build/Release/Module.dll，加载DLL为游戏目录Module.dll。HTTP封包Granite/Server/Storage/Captures/Http，Opal/Capture仅保留历史文件，新流量帧捕获功能已移除。

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
| 多人同步、满员开赛 | 未验收 |
| 人数遮罩、实时比分 | 缺失 |
| 完整比赛结算、增强商品消耗、其他商店 | 未验收 |
| 公园比赛结束后的比赛数据展示 | 用户反馈结算数据未正常显示；详情及原因待查 |

## 当前遗留问题（仅记录，暂不处理）

- **篮筐与篮网动效缺失**：投篮入网后篮网不动；扣篮时篮筐没有被压下的动态效果。场地位置映射已通过，动效作为独立问题记录，原因未确认。
- **街区商店商品缺失**：衣服、球鞋等商店商品缺失；此前商店概览与BUY BOOST通过不代表这些商品完整。
- **自创球场无法正常进入**：用户反馈，原因未确认。
- **动画商店内容疑似不完整**：用户观察似乎缺失很多动画，尚未核对完整目录。
- **多件服装无法正常显示**：客户端仍向服务端请求衣服资源；截图包含 `/2k19/...` 的HEAD/GET请求。资源请求与显示异常的因果关系尚未确认，不能据截图直接认定缺文件、响应失败或版本路径错误。
 - **竞赛球场Ante-Up无法进入**：Opal日志为 `0110000142D875E1 is travelling to stage @ 19:58:03`。用户怀疑未做2K22适配，仅为待验证假设。
 - **公园比赛结束后的比赛数据展示异常**：用户反馈赛后比赛数据不会正常显示；尚未取得结算数据包、日志或截图，原因待查。

详细现象、截图请求路径和验收边界见 [NBA2K22_NEIGHBORHOOD_HANDOVER.md](NBA2K22_NEIGHBORHOOD_HANDOVER.md)“当前遗留问题与用户证据”。其中列出的问题仅记录、暂不处理；本次另按用户要求移除了Opal生产环境的自动帧捕获调试功能，历史抓包文件保留且由.gitignore排除。

生涯细节见NBA2K22_BADGE_BUDGET_HANDOVER.md、NBA2K22_PROGRESSION_HANDOVER_FINAL.md。保持已验收开赛、排队和场地映射实现，不再将比赛几何修正列为当前任务。
