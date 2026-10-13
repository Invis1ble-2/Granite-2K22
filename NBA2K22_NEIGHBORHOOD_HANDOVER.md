# NBA2K22 街区与单人开赛交接

更新：2026-10-13（补充用户验收与遗留问题）。当前Module **0x00010206**；单人2v2开赛/打球用户已通过。Opal原生玩法类型映射修正后，用户确认“完美，场地映射正确了”。后续调整：SoloParkNative随模块初始化自动安装，不再需要enabled文件；用户已确认“不放置 .enabled 文件的情况下正常进入单人 2v2”，自动启用验收通过。

## 已解决的场地对齐问题

修正前用户补充三张比赛截图：人物站在可见界线外但实际未出界；篮球位置才是实际篮筐位置；实际三分判定与地面画线不同，整体向前偏移。截图补齐现象证据，但没有世界坐标读数，未从透视截图猜补偿量。修正后用户已确认场地映射正确，当前测试场地的错位问题验收通过。

根因证据：FUN_1416B4A30将旧2v2 CourtType=6转为game-mode0x34/PARK_3_ON_3，game-info[0xBD]=1。InitPlayingGame将其转成最终flags=0xC（两份实际日志已确认），FUN_14188C8F0据此选SHORT尺寸。资源半场声明NBA。旧3v3类型7选PROAM_3_ON_3，也不是普通3v3。

已修正船上普通公园 **2v2 CourtType=8、IsHalfCourt=1；3v3 CourtType=6、IsHalfCourt=0**。原生模式表核实分别为0x33/PARK_2_ON_2与0x34/PARK_3_ON_3。不修改marker、CourtTransform或队列锚点，不改DLL，不移除单人初始化人数保护。七个相关Node测试文件汇总25/25通过，五个JS语法检查通过。

只读资源继续核实了地面原点和实际rim模型顶点，篮架pivot不能当篮圈中心；NBA/SHORT模板纵向半长相差约304.8，但没有加任何平移常量。详见 [NBA2K22_COURT_GEOMETRY_ANALYSIS.md](NBA2K22_COURT_GEOMETRY_ANALYSIS.md)。现已收到用户真实游戏对齐通过反馈；未新增修正后日志采样，不将该验收扩大到所有球场、3v3或多人比赛。新反馈的篮筐/篮网动效缺失单独记录，不再归为位置映射错误。

## 已解决的AI人数不一致：原生契约

用户反馈排队后未响应并闪退。证据：

- 游戏日志：游戏目录 `console logs/granite-20261013-164918.log`。
- 崩溃：`granite-crash-20261013-164956-33576.txt`及同名.dmp，进程33576。
- Module0x00010205依次记录三个CPU生成、StartGame validated、InitPlayingGame validated、PARKTRACE game-init，随后在AI名单排序读取空指针。没有InitPlayingGame returned 1，回执started=false、error=null。后续退出码0不能推翻已捕获的未处理访问违规。
- 异常0xC0000005，RCX=0，读0xF8。故障位于MinHook原生函数跳板（指令 `8B 81 F8 00 00 00`），返回地址 `nba2k22.exe+0x197D643`，对应FUN_14197D550调用FUN_140979200。堆栈经过AI_InitRosterData→比赛初始化，不能归因于请求匹配或CPU分座。
- dump读取GameData：home/away两队上场名单数量均为2，各前两个roster指针非空，其他槽空。home为0x7FF49B485950、0x7FF49B10E3C0；away为0x7FF4C49681B0、0x7FF49F4A85F0。指针仅为该进程证据，不能复用。
- 同一dump的原生AI上场人数设置（exe+0x6284490/+0x6284494）为 **3/3**。PARKTRACE home队已有3个AI节点，前两人绑定有效roster，第三人为空。

结论：WORLD资料和GameData四个名单已创建，但AI要求每队3人，超过2v2实际名单。前置名单校验通过不代表AI绑定成功；这次与旧“两队名单数量0”的崩溃不同。

## Ghidra原生契约与本轮修正

`FUN_141978AC0`（AI_FillInGameDescription）通过FUN_1410D3E80/FUN_1410D3E70读取home/away上场人数，写描述[0]/[2]；FUN_141B23120据此创建AI球员。FUN_14197DA80迭代GameData名单给AI球员绑定，名单耗尽则中断绑定；之后FUN_14197D550仍遍历AI链并在FUN_140979200读取空roster+0xF8而崩溃。

两个getter读取DAT_146284490/DAT_146284494；分别RVA0x10D3E80/0x10D3E70，签名此前核对。本次已证实旧2v2错误使用PARK_3_ON_3，与原生人数3/3一致；Opal类型已修正，原getter是否恢复2/2需新游戏日志确认，暂保留已验收的线程作用域保护。

`Granite/Module/SoloParkNative.h`增加两个getter钩子。在已通过MatchId、唯一ID、2v2人数、注册WORLD资料及USERDATA BuildSource检查的Playing调用中，用thread_local作用域使getter返回 **2/2**。只在该线程原生InitPlayingGame调用期间生效，调用结束及异常展开后恢复；其他线程、普通比赛继续原getter。保留原生AI创建/绑定/返回值，不写全局设置、不替换空名单、不补虚假指针、不跳过崩溃读取。新增日志 `SOLO22 AI initialization counts: native=.../... roster=2/2`。

全部5个钩子与Lookup签名核验后安装；部分安装失败会移除本组钩子。两个小getter的MinHook安装及本轮开赛均已有0x00010206真实日志和用户游戏通过证据。

模块版本/导出/回执升0x00010206，Opal只接受该版回执。原生InitPlayingGame返回非零后才写started=true，返回0写错误回执。若原生调用崩溃，没有返回成功回执。

## 验证与部署

- 现有C++局部验证通过：单人初始化人数2/2、普通调用保留原值、其他线程隔离、嵌套作用域及异常恢复；MatchId原生布局、名单拒绝、原生返回值/GetLastError保持仍通过。
- `node --test Opal/Tests/NativeSoloPark.test.js`相关6项通过，包含两侧队列真人原座位及三个CPU分配；未运行全量测试或启动游戏。
- Release/x64构建成功，游戏退出后部署 `D:/SteamLibrary/steamapps/common/NBA 2K22/Module.dll`。构建/部署SHA256一致：`C4454ACF0065FF590BD5EE41C1F8DA0B053F1D9703118DF5CD5CF3BAF115DDFC`。本轮测试构建输出及测试临时目录清理完成。
- 上述DLL构建/部署及以下服务启动均为此前记录：旧服务已退出，按现有StartServers.bat启动HTTP PID27632/TCP21000及Opal PID25316/TCP20054/UDP28091，保留12帧/83Hz。PID仅当时状态，接手须重查。
- `Opal/NativeSoloPark.json` Enabled=true。SoloParkNative在支持的NBA2K22版本中自动安装，不再读取`SoloParkNative.enabled`；保留游戏模块、Hook指令签名及名单校验。`LogSoloPark`仅控制日志，不控制补丁安装。ParkRosterTrace改由DLL同目录`Granite.ini`中的`EnableParkRosterTrace`控制，默认0，旧enabled文件不再生效。单人仅支持普通2v2；旧SoloParkTest已撤回，不能恢复重复真人USERDATA方案。
- 本次自动启用改动：Release/x64编译链接、SoloParkNativeTests源码编译、git diff --check通过；未运行测试程序或游戏。新产物`Granite/Build/Release/Module.dll`，时间2026-10-13 23:08:33，SHA256=`47A2F3A6E9986DA9D6E047073CC3FD8C2EFD30B74C4F25AB2933815C4C90745B`；未部署游戏目录、未重启服务。Ghidra返回当前加载目标`NBA2K22.exe.unpacked.exe`（SHA256=`14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0`）后连接断开，未重新反编译人数getter；原生地址、指令校验及2v2保护沿用上述已记录实现，本次只取消enabled文件门槛。
- 用户后续验收：不放置`.enabled`文件正常进入单人2v2，自动启用通过。同时反馈`Attributes/get`请求下的`Body bytes: 96`仍输出；已定位为通用SendRequestHook详情日志未受`LogBadgeBudget`控制，本次补齐该请求的Body bytes和Headers详情开关，关闭徽章上报功能时日志开关也独立生效。Release/x64编译链接与git diff --check通过，最新`Granite/Build/Release/Module.dll`时间2026-10-13 23:21:08，SHA256=`C49A421C349BE5C932C8BF4F9FA286D146751B8D160FFE700D41F3DA8D48F84D`；未部署游戏目录或重启服务。用户最新反馈“验收，全部通过”，本轮INI开关、自动启用与徽章请求详情日志隐藏均已由用户验收。

## 早期注入导致Solo22签名检查失败（已实现修复，待游戏验收）

- 用户报告：游戏窗口出现前注入容易出现`SOLO22 refused: native build signature mismatch`。`granite-20261013-231844.log`第4行确认拒绝安装，第6行才出现游戏`FUN_14182FDD4 → FUN_141830170 → SetUnhandledExceptionFilter(FUN_141830180)`初始化调用。修正前`SoloParkNative::Install`只在`Module.cpp`初始化中调用一次，任意一处签名读取失败或字节不符便退出，不会稍后重试；因此该失败启动中本组五个钩子没有安装，WinHTTP重定向继续工作。
- Ghidra恢复后重新核对`NBA2K22.exe.unpacked.exe`，SHA256=`14741E908C9C586FB0A32A9B17F59A0E53F586CDAB6B841E6AA056859116ACE0`。Generate/Start/Playing/home-count/away-count/Lookup的RVA分别为`0x166B330/0x16FF0C0/0x169DA60/0x10D3E80/0x10D3E70/0x167D3C0`；六处字节全部与源码签名一致。两个getter重新反编译确认读取`DAT_146284490/DAT_146284494`。
- 只读PE文件对比：实际启动`NBA2K22.exe`的SHA256=`2036621D953D381433779D7E545F2C8DFE25402E7383D673C95927456FF80D56`，TimeDateStamp=`0x62E4BCE6`，入口RVA=`0x6D86310`（`.bind`段）；六处磁盘代码全部不匹配原生签名，例如Generate为`A6 26 87 A2 27 C2 A6 D8 61 6C 8E 06 8D 4C 94 D9 13 00 C0 DD 04`。解包文件时间戳相同、入口RVA=`0x182FF64`，六处磁盘代码全部匹配Ghidra与源码。这表明实际启动文件需在启动阶段恢复目标代码。
- 启动器`WaitForGameReadiness`仅等待`kernel32.dll`出现，不检查游戏原生代码就绪；修复前Injector发现`NBA2K22.exe`进程后立即远程调用`LoadLibraryW`。此前失败日志`231549/231844/232446`的崩溃记录器初始化均为`chained: none yet`；成功日志`231603/232451`已为`chained: yes`并记录`SOLO22 enabled`，与启动时序差异一致。
- 调查结论：证据高度支持早期注入与启动解包竞争，单次检查把尚未就绪的代码作为签名不匹配而永久放弃。旧失败日志没有实际内存字节、ReadProcessMemory状态或失败RVA，尚未直接捕获失败瞬间的加密代码，不能指定当次究竟哪处检查失败。修复保留全部签名约束；窗口出现只作为现象，不作为代码就绪判据。
- 已按用户授权修改`Granite/Module/SoloParkNative.h`：签名已就绪则立即安装；首次不匹配时在独立线程中每250ms检查六处签名，最多等待30秒，全部匹配才安装一次。等待不阻塞其余模块初始化；原子标志防止重复安装，线程句柄及时关闭，就绪、超时或安装失败后结束本次工作。保留五个钩子的失败回滚和原生名单保护；Lookup在启用钩子前设置，初始回执写入使用现有ReceiptMutex。
- 日志：首次不匹配记录`SOLO22 waiting for native code signatures`及失败详情，就绪记录`SOLO22 native code ready after ... ms`，安装成功继续记录`SOLO22 enabled`；超时记录`native build signature mismatch after ... ms waiting`。详情包含首个失败RVA、ReadProcessMemory成功状态、错误码、读取字节数、期望/实际字节；不会按250ms刷屏，所有Solo22日志仍受`LogSoloPark`控制。线程创建失败与MinHook失败也记录原因。
- 代码检查：Release/x64编译链接通过，无编译警告；现有SoloParkNativeTests.cpp仅编译通过，未运行测试程序。六处签名地址、字节和长度与既有版本一致，本轮涉及文件的`git diff --check`通过。Ghidra目标哈希及Generate入口指令再次核对一致。新产物`Granite/Build/Release/Module.dll`，时间2026-10-13 23:44:24，大小460800字节，SHA256=`C8EDBFEEDC0031B4FFAED80BB5ADF2789A62C90FD87B8A08A7147DD99934A935`；`Module_v2.pdb`一并保留，模块/回执版本保持0x00010206。本轮构建临时文件清理，未部署游戏目录、修改运行INI、运行游戏或重启服务。
- 待用户游戏验收：游戏退出后换用上述DLL，DLL同目录Granite.ini设置`LogSoloPark = 1`，按此前容易触发的时机在游戏窗口出现前注入，重复几次启动。签名未就绪时应先waiting、再ready和enabled，不再立即永久拒绝；签名已经就绪时直接enabled。确认正常进入街区并完成一次单人2v2开赛；若失败，提供新日志中带RVA/字节的超时或钩子错误记录。验收后可恢复`LogSoloPark = 0`；设置均在下一次游戏启动生效。本轮修复尚未游戏验收。

- 用户提供的`granite-crash-20261013-235154-16584.txt`与`granite-crash-20261013-235203-3708.txt`显示两次相同结果：`Trigger=TerminateProcess`、退出码`0x35 (53)`、请求地址均为`NBA2K22.exe+0x6D8996E`，没有访问违规或Module异常。`Module.dll+0x143D5/0x1B46A`只是`CrashHandler::TerminateHook`和`OnSelfExit`记录游戏退出的栈帧；对应日志显示Module只完成初始化、CrashHandler安装和`SOLO22 waiting`，随后游戏在解包阶段退出，未进入Solo22安装钩子。实际`NBA2K22.exe`磁盘`.bind`段的`+0x6D8996E`是退出路径中的间接调用；Ghidra当前解包目标不映射`.bind`，不能从现有转储确定退出码53内部的具体校验原因，但可以确认触发发生在DLL加载后的游戏早期阶段。
- 已按用户授权修改`Granite/Injector/Injector.cpp`：针对`NBA2K22.exe`，在远程`LoadLibraryW`前每250ms读取目标进程主模块的六处原生签名；全部匹配后才开始Module注入，最多等待30秒。目标进程提前退出时记录PID和退出码并跳过注入；自动无PID模式继续等待后续游戏进程；显式PID模式返回目标已退出。已加载同路径Module会沿用原有成功返回，不会因MinHook改写入口而误判超时；NBA2K19/20/21继续使用原注入流程。SoloParkNative自身的注入后30秒重试仍保留，作为直接注入时的第二层保护。
- Injector Release/x64使用本机可用的`v145`工具集编译链接通过；项目原配置仍为`v143`，本机未安装v143，本次未修改项目配置。六处Injector签名与SoloParkNative逐项一致，`git diff --check`通过。新产物`Granite/Build/Release/Injector.exe`，时间2026-10-14 00:12:23，大小88064字节，SHA256=`7C50BC54769E528A7AE361379B69C7C6D57FFAD6848367D9411F7C5BFDCB9160`；配套Module仍为2026-10-13 23:44:24、460800字节、SHA256=`C8EDBFEEDC0031B4FFAED80BB5ADF2789A62C90FD87B8A08A7147DD99934A935`。本轮未部署游戏目录、未修改运行INI、未运行游戏或重启服务。
- 待用户验收：将`Granite/Build/Release/Injector.exe`与同目录Module.dll一起使用，提前打开Injector后启动游戏。Injector日志应先出现`Waiting for NBA2K22 native code ... before loading Module.dll`，游戏解包完成后出现`NBA2K22 native code ready for injection`，然后Module才初始化；不应再在游戏解包阶段看到Module已加载后由游戏退出码53终止。确认游戏能正常启动并完成一次单人2v2；若Injector超时或目标退出，请提供Injector控制台输出及对应的新Granite日志。
## 已解决的前置代码错误

MatchId读取：COURT+0x180为字段17 MatchId，+0x170为字段16 RandomSeed。FUN_14173D480传入BuildGameInfo参数3/13；FUN_1416B4A30将MatchId写uint32_t[0xB6]即 **game-info+0x2D8**，RandomSeed写[0xD0]即+0x340。StartGame复制game-info到Session+0xCB0。模块已修正两处MatchId；+0x2E8是此前错误位置。0x00010205此次实际通过StartGame/Playing前置校验，不能继续把本次崩溃归为MatchId错误。

CPU座位：GotNext.Court用于球场关联、GotNext.Slot选择实际队列。TryStart/Commit改用QueueFor(Court,Slot)及实际SlotObjectId确定真人球队，保留真人原座位；此轮已发送完整球队及PLAYING，座位错误不再是本次阻塞。

## 当前验收边界

用户说明正式服赛前4人（2v2）或6人（3v3）站位锁定，等待约5–10秒，随后动画、开球。0x00010206已由用户确认单人2v2开赛及打球正常；本次映射修正后的场地对齐也已由用户确认通过。不能扩大到3v3、多人同步、全场结算或所有AI行为；无需重复将正常开赛或场地对齐列为前置验收任务。

## 街区其他状态与保留契约

| 项目 | 状态 |
| --- | --- |
| 六个3v3、六个2v2布局和排队圈 | 用户确认正常 |
| 入队、退出、离开区域延迟 | 自身PLAYER更新完整U64 ACK修复后用户确认解决 |
| 原生CPU对象和WORLD名单 | 客户端日志证实生成；本轮GameData两队各2名单 |
| 单人2v2开赛及打球 | 0x00010206用户通过 |
| 比赛场地对齐 | 原生类型映射修正后，用户确认通过（当前测试场地） |
| 多人同步、实际开赛 | 未验收 |
| 空场人数遮罩、实时比分 | 缺失 |
| 结算 | 未验收 |

协议由PLAYER正文识别Connection.ProtocolGeneration；2K22可能使用旧Boulevard activity=0x3CF672C2。PLAYER165位/21字节位图；COURT148位/19字节。目的地156、Facing157，压缩位置/Warp为世界坐标1/3。自身完整PLAYER更新立即确认请求头+16完整BE U64，即使对象回包限频。

COURT继承0=Name、1=IsActive、4=Transform、8=ArtBinding、9=ObjectState、11=IsLockstep、12–15=relay、17=MatchId；20=CourtType，普通公园 **2v2=8/3v3=6**，旧6/7映射已证实错误；22=IsHalfCourt，分别1/0；球队28/30–34/50–54及55/56–60/76–80；站点82–88，赛后89–94。比赛期间禁止空闲镜像覆盖同ID球队。markers已提取；ArtBinding、REGION仍有未核验部分。

本地Blacktop 2v2采样已完成，无需重复；原生名单链及旧零名单崩溃证据见NBA2K22_PARK_ROSTER_ANALYSIS.md。该文旧失败结论不替代本轮两队各2名单证据。

## 当前遗留问题与用户证据（仅记录，暂不处理）

以下为场地映射验收通过后的用户反馈。本轮不排查、不改代码、不重编译或部署DLL、不重启服务，保留已验收的开赛、排队及场地映射实现。下列原因均未确认。

| 问题 | 用户观察 / 证据 | 当前边界 |
| --- | --- | --- |
| 篮筐与篮网动效缺失 | 球投进后篮网不会动；扣篮时篮筐没有被压下的动态效果 | 位置映射已通过；动效缺失独立记录，未定位原因 |
| 街区衣服、球鞋等商店商品缺失 | 用户反馈商品不完整 | 商店概览及BUY BOOST此前通过，不代表服装/球鞋商品完整 |
| 自创球场无法正常进入 | 用户反馈无法正常进入 | 未采集进入流程或错误详情，原因未确认 |
| 动画商店疑似缺失很多动画 | 用户观察“似乎缺失了很多动画” | 尚未核对完整动画目录，不写成已确认的具体缺失清单 |
| 很多服装无法正常显示 | 客户端仍会向服务端请求衣服资源，用户提供Hook控制台截图 | 请求可见，但响应内容、状态码与显示异常的因果关系未确认 |
| 竞赛球场Ante-Up无法进入 | Opal日志：`0110000142D875E1 is travelling to stage @ 19:58:03` | 用户怀疑没有做2K22适配；仅为假设，日志不证明旅行已成功完成 |
| 公园比赛结束后的比赛数据展示 | 用户反馈比赛结束后数据不会正常显示 | 未取得结算数据包、日志或截图，原因未确认 |

### 服装资源请求截图摘录

用户截图为“NBA2K Granite Hook Module”控制台，可见 `nba-cdn3.2ksports.com:443` 被重定向至 `127.0.0.1:21000`，以及以下服装资源的HEAD/GET请求示例：

```text
HEAD /2k19/jersey_013_45_05_fox
GET /2k19/jersey_013_45_05_fox
HEAD /2k19/hoodie_pullover_nike_swooshsplit_wht
GET /2k19/hoodie_pullover_nike_swooshsplit_wht
HEAD /2k19/jersey_019_54_11_boykins
GET /2k19/jersey_019_54_11_boykins
HEAD /2k19/tshirt_sleeveless_citypop_miami_blk
GET /2k19/tshirt_sleeveless_citypop_miami_blk
HEAD /2k19/hoodie_pullover_ruffles_be_all_in_gry
GET /2k19/hoodie_pullover_ruffles_be_all_in_gry
HEAD /2k19/jersey_013_36_35_bagley_iii
GET /2k19/jersey_013_36_35_bagley_iii
```

截图还包含 `POST /nba/2k19/StoreV4/v4/get_owned_items?x=4002785463958415741` 和 `POST /nba/2k19/DebugLogs/pushdebuglog.gz?x=4002785463958415741`。以上为截图文字摘录，不是本轮重新采集的日志；未另存原图为项目文件。

用户怀疑衣服资源请求与无法显示有关，作为后续线索保留。截图没有HTTP响应状态、返回体或资源加载结果，不能据此断言服务端缺文件、返回错误，或仅凭 `/2k19/` 路径认定2K22适配错误。服装显示异常与商店商品缺失分别记录，不预设为同一根因。

### Ante-Up旅行日志

```text
0110000142D875E1 is travelling to stage @ 19:58:03
```

此行为用户提供的Opal日志；本轮没有读取对应日志文件或核查目的地stage标识。仅确认用户报告无法进入且出现旅行日志，未验证是否缺2K22场景/协议适配。按用户要求，这些问题先记录，其他暂不处理。
