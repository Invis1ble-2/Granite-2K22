# NBA2K22 球场显示/比赛几何错位调查

更新：2026-10-13。修正已写入 Opal 源码并启动服务；游戏画面对齐尚未验收。Module 保持 **0x00010206**，未修改/重编译/部署 DLL。

## 结论与修正

错误不是已证明的 marker 平移，而是**船上普通公园球场的原生玩法类型映射错误**：旧 2v2 发送 CourtType=6，客户端实际选 PARK_3_ON_3 和 SHORT 几何；旧 3v3 发送 7，实际选 PROAM_3_ON_3。原生 AI 人数原先读到 3/3 与这个错误一致，但本次未移除已验收的单人初始化人数保护。

修正为：

| 船上球场 | COURT 字段20 | 字段22 IsHalfCourt | 原生模式 | 物理尺寸 |
| --- | --- | --- | --- | --- |
| HALF_CENTER_*，2v2 | **8** | **1** | 0x33 PARK_2_ON_2 | NBA |
| SHORT_*，3v3 | **6** | **0** | 0x34 PARK_3_ON_3 | SHORT |

不修改 marker Translate/Rotate、CourtTransform、队列锚点/间距、MatchId、名单或 Module 钩子；不以地面实例 pivot 或篮架 pivot 猜测补偿量。改变的是客户端选择的玩法和几何模板。普通公园修正不扩大到 Ante-Up/全部活动类型。

## 用户现象

用户提供三张比赛中截图并说明：
1. 图一人物已经踩到可见界线外，实际仍在比赛边界内。
2. 图二篮球的位置才是实际篮筐位置，未与可见篮圈重合。
3. 图三实际三分判定范围与可见三分线不同；整体场地向前偏移。

这支持比赛几何共同错位，而非单纯排队圈或人物站位问题。截图没有世界坐标读数，不作为修正距离的来源。

## 原生证据（已核对程序）

程序 `NBA2K22.exe.unpacked.exe`，基址 `0x140000000`，SHA256：
`14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0`。
Ghidra 程序信息与安装目录解包文件的独立 SHA256 一致。

### 1. COURT 类型 -> 原生玩法

`FUN_1416B4A30`（BuildGameInfo）读取 COURT 数据 `+0x1A0`；普通 Boulevard/公园分支：
- case 8：game-info[0]=0x33，game-info[0xBD]=0（普通公园；activity=5 的另一分支不在本次范围）。
- case 6：game-info[0]=0x34，game-info[0xBD]=1。
- case 7：game-info[0]=0x73，game-info[0xBD]=1。
- case 5：game-info[0]=0x35，不能凭旧代配置把它当 2K22 的普通 2v2。

`FUN_140B8AEB0` 返回 `uint32_t[mode] @ 0x142613F10`。已用 Ghidra 内存与安装 PE 原始字节分别核对，并匹配程序内 ASCII 模式名的 CRC32：

| mode | 表项地址 | CRC32 | 程序内名称 |
| --- | --- | --- | --- |
| 0x33 | 0x142613FDC | 0x20F92845 | PARK_2_ON_2 |
| 0x34 | 0x142613FE0 | 0x9CA2CB76 | PARK_3_ON_3 |
| 0x35 | 0x142613FE4 | 0x1FC36E6D | PARK_4_ON_4 |
| 0x73 | 0x1426140DC | 0xA50C18B8 | PROAM_3_ON_3 |

### 2. 为什么错误类型导致几何改变

`FUN_14169DA60`（InitPlayingGame）：
- Session+0xCB0 保存 game-info。
- 从 Session+0xFA4，即 game-info+0x2F4 / uint32_t[0xBD]，生成局部初始化 flags：非零时为 **0xC**，零时为 **0**。
- `FUN_14107AB50` 把这组参数复制到最终初始化设置；`FUN_1410CAB80 -> FUN_1419751D0 -> FUN_141AFFE70 -> FUN_141AE9310 -> FUN_14188C8F0` 创建比赛 AI 世界。
- `FUN_14188C8F0` 读取最终设置 uint32_t[1]：**0xC -> 物理类型2 SHORT**；默认值0 -> 物理类型0 NBA；传入 `FUN_14184B300 -> FUN_141866E40` 构造尺寸表。

旧版本实际日志 `granite-20261013-171006.log` 和 `granite-20261013-172649.log` 的完整 `PARKTRACE game-init-settings` 均确认：`+0=0x12451028`，**+4=0xC**。本次复用现有追踪，没有要求再做本地 Blacktop 采样。

`FUN_141866E40` 的模板常量：
- NBA half length：`0x14236B7EC`，1432.56005859375。
- SHORT half length：`0x142CF7D64`，1127.760009765625。
- 差为 304.800048828125（约10英尺）；尺寸表 translation.Z 同时由 `halfLength-NBAHalfLength` 生成，NBA为0，SHORT约-304.8。

这是模板差异的证据，不是从截图测得的共同世界平移量；本次没有把304.8写入任何坐标。

### 3. 矩阵与字段语义

- `FUN_1416AD2B0` 把 COURT+0xB0 变换交 `FUN_140DBD7E0` 注册。
- BuildGameInfo 把同矩阵复制到 game-info+0x270。
- InitPlayingGame 最后把 Session+0xF20（game-info+0x270）的指针保存到比赛 AI 世界+0xDA8。
- `FUN_141A03930` 的显式公式确认行向量约定：世界 X=x*M[0]+y*M[4]+z*M[8]+M[12]，世界 Z=x*M[2]+y*M[6]+z*M[10]+M[14]。与项目 CourtTransform 布局一致。
- `FUN_140E125D0` 保存叠加资源变换，不是已证明的边界生成函数，不据此增加坐标钩子。
- `FUN_1416B8FA0`（PrintDirty）核实字段名/数据相邻布局：CourtType值+0x1A0，FlipDirectionOfPlay值+0x1A5，IsHalfCourt值+0x1A7，HasWaitingArea值+0x1AD。字段22的 IsHalfCourt 名称正确，不把+0x1A5误当半场标志。

## 只读资源比对

安装 marker archive SHA256 与项目 JSON 一致：
`b418800bbb36c412e248b095b6f295addd7883070356ae5dfafcfc9904720fa5`。

HALF_CENTER_BOTTOM_RIGHT：
- marker=(-660,0,-6213.3042)，Yaw≈1.57019842。
- 可见地面实例原点=(-1378.49561,-0.000459740026,-6214.09375)，来自 `levels/ship_deck1_park.iff / level.SCNE` 的 `Locator:court_ship_2v2_deuces` 实例。
- 篮架资产 pivot=(-1970.64001,0,-6213.3042)，来自同 archive 的 baskets.SCNE / basket0_8；pivot不是篮圈中心。
- 半场 marker 属性明确是 VC_CourtType=NBA，3v3则为SHORT。

共享篮架模型 `ship_deck1_park@GameObjects@court_markers@SHORT_BOTTOM_LEFT@basket0_basket.7d66e1a7789a9e9b.model` 的 rim 顶点已独立解码：
- POSITION0 float3 chunk 起始 byte39548、stride12；rim prim index CRC32=2116888697，与 SCNE 声明一致。
- 顶面前后径向顶点在 byte61028/62156：Z=12.3330078125 / 60.471923828125，Y=304.79998779296875。
- 中点 local Z≈36.4024658203125，骨架 net 链 Z≈36.4025656 交叉支持。
- 按篮架四分之一转矩阵，静态 rim 世界 X≈-1934.23754，而不是 pivot 的-1970.64001。

六个半场地面实例相对 marker 的 X 差为镜像约±718.495；六个3v3则只约-6至-12。说明地面模型与比赛 marker 并非同一原点语义，不能把该 pivot 差当偏移修正量。模型、资源包均未写回游戏目录。临时提取仅在本会话 scratch；以上 archive/member/model 名称和字节位置可重新只读提取复核。

## 实现、验证与生效状态

源码：
- `Opal/Source/Protocol/CourtLayout2K22.js`：导出普通公园类型常量 `{TwoOnTwo:8,ThreeOnThree:6}`，IsHalfCourt按类型8设置。
- `Opal/Source/Activity/StageSpots/ShipCourts2K22.js`：引用上述常量生成六个NBA半场和六个SHORT全场。

回归：
- `node --test --test-concurrency=1` 运行 CourtLayout2K22、ParkGame2K22、NativeSoloPark、CourtData、Courts、ParkSpots、NeighborhoodGame 七个文件，Node汇总 **25/25通过**，其中部分旧脚本内部另有自己的断言汇总。
- 新断言覆盖12场发布/空闲镜像/占位包、普通2v2与3v3开赛包、单人2v2开赛包的原生类型与半场标志。
- 完整64字节 marker矩阵保持、旧代排队与名单/队列行为相关测试通过。
- 五个改动JS文件 `node --check` 通过；NativeSoloPark.json测试前后SHA256相同（E230ED5CB4D72662F050481E20FB863FA53AA08E1D754D63483A0A65870F976E）。未运行全量测试。

本轮发现旧记录的HTTP/Opal进程都已退出，没有监听。执行现有 `StartServers.bat`，核验HTTP PID27632/TCP21000、Opal PID25316/TCP20054/UDP28091。脚本保留12帧/83Hz；未修改启动脚本、服务配置或DLL。PID仅为当时状态，后续需重查。

## 待验收（不能提前宣称对齐已解决）

重新进入街区并在同一 HALF_CENTER_BOTTOM_RIGHT 开赛，核对可见篮圈与投篮落点、可见边界与实际出界、可见三分线与得分判定。若仍有残余错位，补新比赛截图与日志，再追实际 NBA 模板几何；不能用旧SHORT模板的错位截图推导下一轮平移量。3v3本次只有服务器包与静态模式核验，未进行真实开赛验收。
