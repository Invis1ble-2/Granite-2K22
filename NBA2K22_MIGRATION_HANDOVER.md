# NBA 2K22 交接

更新：2026-10-26。保留未完成事项、必要工程约束与简短复盘；已验收问题不保留冗长静态调查。

## 最近验收

- **Game Room / Ante-Up**：用户已验收各自独立进入及双向直接互切；内部玩法与设施仍待修复。
- **街区大厅**：补齐 2K22 世界表缺失项后，用户已验收进入修复。
- **Ante-Up Bet**：纯服务端调整首次球场下发时机后，用户截图确认本次进入的多场 500 VC 金额恢复；未实施客户端金额修复。
- **单人公园赛前模型/名牌**：2026-10-19 用户确认 `0001020D` 保序修复；此验收不包含所有座位、AI 行为或赛后清理。
- **单人公园赛后占位**：2026-10-19 用户确认单人 3v3 赛后残留修复“这次好了，验收”；不外推多人退队或重复开赛已全部通过。
- **增强人机开赛**：2026-10-20 用户确认 `00010211` 已开始比赛；本次单人 3v3 CPU 生成/校验阻断修复验收通过，不外推其他模式、双机同步或重复开赛已通过。
- **双真人公园对局**：2026-10-21 用户确认 00010213 配合修正后的 2K22 relay 已正常开赛并打完；双端上传记录同场比分 21:10、模拟帧数 22497。双方仍反馈画面顿挫和操作迟滞，不外推全部同步场景、重复开赛或赛后清理均已验收。
- **公园 120 FPS / 流畅度**：2026-10-21 用户在 relay 固定节拍/有限追帧修复后确认。本次 FPS 与主观流畅度获确认，不外推其他人数、完整时钟/物理、长期同步或连续重开已全部通过。
- **单人人机断线重连**：用户已确认客户端关闭后立即清理比赛、CPU/玩家占位及 `BestBodies` 玩家正文缓存，保持 Opal 不重启时重进街区不再自动站点。
- **MyCOURT 2v2 相机（用户已验收）**：菜单模式 7 改用 CourtType 6，保留真实四人、2+2 分队；用户确认相机修复、场地几何正常。Module 仅在 MyCOURT `0xD4D10`、setting/type `64/17`、实际名单 `2/2` 初始化期间复用人数 getter scope，避免默认 3/3 创建多余 AI；不改相机参数或人数全局值。
  - **收尾关闭**：`MyCourt2v2Fix.h` 独立保存专属条件及启用入口；`NativeMatchInit.h` 统一管理初始化/人数 getter 三个共用 Hook，`ParkCpu.h` 不再引用 MyCOURT 补丁或包含其专属判断，公园授权与人数 scope 保留。`Module.cpp` 负责接线，无重复 Hook。`MCCOUNT22-v1` 探测已删除；Release x64 编译、限定源码复核与差异检查通过，产物 `Granite/Build/Release/Module.dll`（579072 字节）。按用户决定结束进一步逆向；2K 适配问题未证实。未部署、注入、重启、运行单元测试或做本轮游戏内回归。

## 未完成 / 待确认
- **多人公园回归**：此前 120 FPS 和流畅度已获用户确认；本轮 00010217 支持只重启 Opal、保留游戏进程后重新协商 60/120，尚未游戏验收。完整比赛计时、其他人数/模式、重复开赛及长时间同步仍待专项确认，不与旧 60 Hz / 83 Hz 套件混搭。
- **MyCOURT 混编开赛（去桥接版本，2026-10-25）**：用户确认真人与 NBA 球员混编可正常开赛，profile-derived PUID 方案游戏内验收通过。慢加载、访客重进、换人重开、双真人及房主离房等场景仍需分别确认，不外推为全部运行场景通过。
  - **实现与产物**：Opal 按 host-authored room profile 复算并校验 NBA 球员 PUID；身份 HTTP 与客户端身份桥接已移除，真人/GAME/比赛流程保留。Release x64 产物 `Granite/Build/MyCourtPuidPort/Module.dll`，SHA256 `98103AFA7D67B17A8E0173951022170CFB504F3FA93B6E4D0F1083F30C2FF3DC`，586240 字节；原 `Granite/Build/Release/Module.dll` 未覆盖。JS 语法、限定 `git diff --check` 和 Release x64 编译通过。
  - **房主离房即时关闭（用户已验收）**：用户确认“可以验收”。房主离房后逐访客发送原生不可用更新，并清理旧房间、身份确认与比赛关联；连接级失效标记阻止迟到消息恢复旧房间。正常比赛结束及普通访客离开不触发关房。仅修改 Opal，无需更新 DLL；3 个 JS 文件语法、限定范围差异检查及一次只读复核已通过，游戏验收由用户完成。不外推所有人数、模式与长期同步场景均已逐项验证。
  - **移除桥接前取证（2026-10-25，v3 已回传）**：临时只读探针记录 Invite 来源、模型/外观、描述、CRC 输入、PUID、tuning 与 setter；不采 PlayerData，不新增 HTTP/配置或改变玩法。旧桥接保留，取证结束后删除探针接线。v3 四次文件齐全、meta 原生 CRC 均等于实体 PUID；来源均为 RVA `0x141D634`，Ghidra 汇编核准为 `14141C530` type-6 → `14170D880` 尾跳 Invite。模型 ID/key 可不同（8021/9867）；不能把来源/快照完整当作 raw 输入转换闭合。
  - **已验证来源与缺口**：`14144ED40` 从 roster 迭代器取既存 model，`14144EE03` 写入 owner `+0x5628[index]`，`14144EE0B` 递增 `+0x1078`，之后排序；不是 Invite 后置实体记录 `+0x56E0/+0x1080`。`140EA66B0` 经 `140F434A0` 取节点并读其 `+0x60`；节点地址公式为 `*(container+0x18)+index*0x4F0`。尚未定位 roster 槽位生产者/raw PlayerData 输入，不把无关联的 career 外观导出路径作为补采依据。v2 consume-only 构造关联失败；服务端复算及移除桥接未完成，暂不新增 v4 或要求重复邀请。
  - **存档球队线索与解包边界**：用户观察可邀请者均属房主当前 MyCAREER 存档球队；不据此假定默认球队资料。`1411D9DE0` 返回 `DAT_14634E8A0`（`14634E800+0xA0`，由 `14103D1B0` 设为对齐 backing 地址）；`1411B91C0 → 14104D920/14104DE10 → 140FC50B0` 为 roster 普通段解包分发。静态 `0x4F0` 注册项 hash `72D60754/68D0DD68` 共用 descriptor `143793840`；字段记录 `143793AC0` 的 member offset `+0x60`、hash `46AF64A7`、type `0x15`、selector `1` 已核内存。`14103735A` 调 `14121EC50` 将 token 经 selector/type/index 查表所得地址写入目标字段（`141037365`），不是 PUID。通用映射注册 `14100D360:14100D3A5` 为 selector 1/type 0 设置 stride `0x1258`，base/count 源自其根对象 `+0x88/+0x80`；尚未证明本次解包使用同一映射实例，未闭合至球队分类 model 槽或 raw PlayerData，不以此新增探针。
  - **v3 产物与检查**：`Granite/Build/MyCourtProbe22/Module.dll`，SHA256 `E31D53D3B6421E457B145BB8117EC46F1DB8AAF30BFAC0ED0FADF686E03CD797`；此前 Release x64 编译和限定差异检查通过，原 Release DLL 保留。本次仅日志/源码读取、Ghidra 只读调查与本文状态更新，未改功能代码、重新编译、部署、注入、重启或运行单元测试。
  - **v4.1 原生 profile 取证修复**：v4 拒绝安装的原因是 `1416E18E0` 签名校验字符串漏掉入口末尾 `0F 29` 两个字节，属于探针自身门禁错误，不是用户加载问题。v4.1 修正后保留同一只读采集范围：`1416E18E0` 序列化、`141ED1130` 压缩、五槽 key/buffer/length、raw profile 与压缩结果；不新增 HTTP、不主动生成 profile、不改变桥接或玩法。meta 使用 `MCAP22-v4.1`，关联仍明确标记 `invite_association=not_verified`。
  - **v4.1 产物与检查**：`Granite/Build/MyCourtProbe22/Module.dll`，SHA256 `112EA4158C9FD33DE2EC092B7872C3C8A6903C6AA5D2B751530BE89525ECAF79`，641024 字节；配套 PDB 8179712 字节。Release x64 编译通过，探针/文档 `git diff --check` 通过，原 Release DLL SHA256 仍为 `EDE4CAF677112D91655D54F4CD85EF75ED20D0DB8F7F3EC93E1B04A70FC7EC46`。用户需新启动进程加载 v4.1，确认 `MCAP22 v4.1`，触发一次 MyCOURT 名单发送后回传 `console logs\\MyCourtProbe22-v4.1-*`；无需开赛。
  - **v4.1 首次运行结果**：用户日志确认 `MCAP22 v4.1` 已安装；profile-1 `raw_ready=1`、`wire_ready=1`、`slot_context_ready=1`、`all_parts_saved=1`。slot `0`/key `4170` 与同目录 Invite-1 key `4170` 精确一致；raw 长度 `267720`、wire 长度 `4866`。raw `+0x118` 为 UTF-16 球员名区域，raw `+0x170` float 为 `284`，与已采 descriptor weight 一致；Invite model `+0x6C=4170`、`+0xF4=4170`。这已取代静态猜测成为首个真实 profile 对照样本，但仍需 model ID 与 slot key 不同的样本闭合该分支。
  - **v4.1 五样本字段闭合**：profile-1..5 全部 raw/wire/slotContext 完整；五组 raw `+0x184` 低 16 位分别等于 Invite model `+0x6C`，raw `+0x410` 低 16 位分别等于 slot key/model `+0xF4`。关键非相等样本为 profile-5：raw `+0x184=0x1D79`（7545）→ model ID 7545，raw `+0x410=0x1D98`（7576）→ slot key 7576；Invite meta 同时记录 model/key 为 7545/7576。此前的 model/key 不同分支已由运行态证据闭合，不再需要追加邀请。
  - **profile-derived PUID 实现**：Opal 现在直接对房主 native room 的每个 zlib profile 做有界解压和严格字段校验；已验证 raw `+0x170` weight、`+0x638` packed height、`+0x670` appearance byte、`+0x658` signed 3-bit appearance、`+0x210` position bits、`+0x188` model low bits、`+0x184` model ID、`+0x410` slot key 生成原生 1024 字节 PUID 输入并执行 CRC64。五份 v4.1 raw 样本全部与原生 PUID 精确匹配，包括 model/key `7545/7576`。
  - **桥接移除与产物**：删除 `/native-mycourt/v1/identity` HTTP handler、Listener 接线、客户端 `MyCourtIdentity.h`、临时 `MyCourtProbe22.h` 及项目项；保留 MyCOURT 真人/GAME/比赛流程。`VerifiedIds` 按 host-authored room profile 即时复算，并拒绝未知、重复、真人冲突或 profile key 不匹配的 ID。Release x64 产物 `Granite/Build/MyCourtPuidPort/Module.dll`，SHA256 `98103AFA7D67B17A8E0173951022170CFB504F3FA93B6E4D0F1083F30C2FF3DC`，586240 字节；原 Release DLL SHA256 仍为 `EDE4CAF677112D91655D54F4CD85EF75ED20D0DB8F7F3EC93E1B04A70FC7EC46`。真人与 NBA 球员混编开赛已由用户验收；慢加载、重进、换人重开及其他边界场景仍待验收。
- **Ante-Up 内部玩法**：Got Next 点位及左右选位已验收；排队推进与完整多人比赛未验收。本次金额修复后的退出重进、Game Room 双向互切与 Got Next 回归仍待验收。VC 仅练习值，不扣款或结算。
- **Ante-Up 1v1 开赛崩溃（2026-10-20）**：用户已批准的 `Playing` 前调用 `FUN_141A01A10` 预清理方案，经实施前复核后撤回，未改代码或生成新版 DLL。崩溃路径先以 `FUN_141A58990` 重建空容器再初始化名单，不能仅凭此前玩过 CPU 补位认定旧容器节点残留；析构还会改写节点 `+0xB10/+0xA18`，不应盲目调用。已确认 description 计数与 game-data roster 游标来自不同存储，游标耗尽后仍继续导致空指针；节点关联虚函数 `+0x110` 与游标填充来源尚未闭合。后续修法需重新确认；无探针、未部署或重启，不能标记崩溃已修复。
- **Game Room 内部设施**：设施不可用；用户反馈，待调查。
- **Gatorade 健身房（启动、成绩显示、结束恢复及启动延迟修复已验收）**：卧推11次、力量+3及周训练表已显示；腿举结束正常恢复，COURT版本递增后的启动延迟修复也获用户确认（§6.8–6.10）。当前调查额外Got Next圆点：用户确认官服仅踩紫色垫子出提示，不显示排队圆圈（§6.11）。奖励持久化、全部器材及独立重连残留不算已验收。
- **其他不可用场景/内容**：护城河场景缺少 got next 点，空心球蹦床球场存在进入问题。

## 工程入口与约束

- 工作区：`D:/download/Granite-main`；HTTP：`Granite/Server`；注入模块：`Granite/Module`、`Granite/Injector`；Opal：`Opal`。
- 项目仅面向 NBA 2K22；后续适配直接使用 2K22 协议，不再新增或单独维护 2K19 兼容分支。
- 游戏：`D:/SteamLibrary/steamapps/common/NBA 2K22`；日志：游戏目录下 `console logs`。
- 逆向目标：`NBA2K22.exe.unpacked.exe`，SHA-256 `14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0`，基址 `0x140000000`；固定地址仅适用于此版本。
- 街区 marker：`Opal/Source/Activity/StageSpots/ShipCourts2K22.markers.json`；几何分析：`NBA2K22_COURT_GEOMETRY_ANALYSIS.md`；名单崩溃分析：`NBA2K22_PARK_ROSTER_ANALYSIS.md`；MyCOURT 映射：`Opal/Source/Protocol/Shootaround.js`。
- 保留历史日志、抓包和崩溃 dump。未经明确要求，不重启服务、不终止游戏/服务、不部署 DLL、不覆盖运行配置。
- 修改后仅做编译或语法检查；单元测试及实际游戏/网络验收由用户执行，未运行的检查不得标为通过。

## Gatorade 健身房详细调查

### 1. 范围、状态与证据等级

- 调查日期：2026-10-24；现象为场景、器材模型、紫色垫和 NPC 规则说明正常，卧推、腿举等多种器材旁无开始训练提示。
- 仅适用上述 SHA-256 的 NBA 2K22 unpacked PE，image base `0x140000000`。本节地址均为该版本 VA；偏移默认以字节计。名称 `core/owner/source/record` 是便于描述的数据流代称，不等于已恢复的原始 C++ 类型。
- 器材提示/说明、卧推启动/本次成绩、腿举结束恢复及启动延迟版本修复已由用户验收（§6.8–6.10）。当前仅调查额外Got Next圆点的显示差异（§6.11）；重连缓存另案处理。
- 证据标记：**M**＝主代理直接用 Ghidra MCP 汇编/内存复核；**L**＝Luna 用 MCP 调查返回、主代理未逐项复核；**S**＝项目源码；**R**＝前轮资源提取/哈希及 JSON。反编译字段名和相邻表项只能作线索，不能替代指令/构造器证据。
- 每周训练属性增益与购买Gatorade消耗品是独立系统。本轮仅只读调查显示机制并更新本文，不改已验收功能、运行配置或DLL，不执行游戏/网络测试。

### 2. 服务端现状与不能直接复用的入口

| 证据 | 文件 / 位置 | 直接观察与边界 |
|:---|:---|:---|
| S1 | `Opal/Source/Protocol/Connection.js:583–601` | 初始化后启动 Requests；bitstream world 经 `require('./Courts').Publish(Client)` 发布对象，并安排刷新。 |
| S2 | `Opal/Source/Protocol/Courts.js:438–462` | `PublishPark` 遍历 `CourtTables.For(...).Courts`，按篮球场格式发布；当前没有独立健身器材对象发布链。 |
| S3 | `Opal/Source/Activity/CourtTables.js:173–177`；`StageSpots/ShipCourts2K22.js` | 2K22 neighborhood 使用 ship court 表；已查配置没有器材交互组发布。 |
| S4 | `Opal/Source/Protocol/CourtLayout2K22.js:2–22` | 148-bit dirty 布局：20 个继承位、128 个 COURT 位；全局 bit 20 为 `CourtType`，正文宽度 4 字节。 |
| S5 | `Opal/Source/Protocol/GotNext.js:18–38, 128–147` | 请求 packet `0xCE148FB1`、命令 `JOIN`；现有处理会执行 `ParkCpu.Stop(...,'queue changed')` 并写 `Connection.GotNext`，随后走篮球交付路径。不能不区分类型就复用给健身。 |
| S6 | `Granite/Server/Source/Services/MyCareer/Gatorade.js` | 当前为消耗品购买，不是器材近距/每周训练启动实现。 |
| S7 | `Granite/Server/Source/Services/Arbitration/Upload.js:18,189–190` | 存在 `UploadGymActivityResults = 0x58BD1CB0` 及 gym_activity 路由；前轮所查处理仅记录/返回 SUCCESS，不能当作 2K22 完整训练上传已实现。 |

### 3. 服务端对象进入客户端并注册区域包装

前轮已确认的静态链（M，未做游戏动态验证）：

```text
FUN_1416C5AC0  TK_WORLD::GAMEOBJECT::UpdateFromServerObject
  -> FUN_141617360
     141617401: snapshot+0x60 == 0x2C4D49E3
     141617416: CALL FUN_141619780
  -> FUN_141619780 创建 COURT 数据及区域包装
  -> FUN_1416F2450 -> FUN_14173B1C0 (COURT::UpdateFromObjectInternal)
  -> FUN_1416A1F30 后续对象注册（其完整交互/几何语义仍未知）
```

| 对象 / 字段 | 地址或布局 | 已确认行为 |
|:---|:---|:---|
| COURT 数据 | 分配大小 `0xC20`；vtable `0x142CA1A58`；class `0x2C4D49E3` | 数据对象，不应与区域包装混同。 |
| 区域包装 | vtable **`0x142CA1C00`**；class `0x2DA46A70` | `wrapper+0x18 = data`；`data+0x98 = wrapper`。 |
| 器材类型 | COURT DWORD `+0x1A0` | `FUN_1416DE580` 以 4 字节序列化；对应 dirty `+0x1A4`。 |
| dirty 序列 | `FUN_1416E6570` 先调用 base `FUN_1416E7A00` | 类型为首个派生 dirty，即全局 bit 20；dirty 地址不是值字段地址。 |

**表边界纠错：** `0x142CA1BE0/1BE8` 属数据表尾部，不是区域包装表首。不能因表相邻就把 serializer 归给 wrapper；也不能把 `0x142CA1C00` 表无限延伸到后面的 core 主表。

### 4. 提示消费者、类型和训练名称

提示组件由 `FUN_141610A50` 创建（前轮 M），class `0x68FC530A`，vtable `0x142CAE450`；本轮 M 内存复核：

| 虚槽 | 目标 | 证据与边界 |
|:---|:---|:---|
| `+0x78` | `FUN_14171AE80` | 读取 core 中的状态，进入提示分发。 |
| `+0xD0` | `FUN_14173E170` | 器材提示消费者。 |
| `+0xD8` | `FUN_141737CB0` | 前轮识别为出口提示。 |
| `+0xE0` | `FUN_1417357B0` | 前轮识别为电梯提示。 |
| `+0xE8` | `0x1417312F0` | M 读取机器码：读状态 `+0x98/+0xF4/+0x10`，改下游对象 `+0x2200` flags；不是已证实的状态 `+0x2C` 写入者，也不发送训练请求。Ghidra 未定义该短函数时直接读机器码。 |

关键指令与字段（M）：

```text
14171AF30: LEA RSI,[RCX+0x1960]      ; 状态结构实际起点
14171AF99: CALL [vtable+0xE8]        ; 上述 UI flags 更新
14171AFA8: CALL FUN_141744D50
141744DEF: CMP dword ptr [RDI+0x2C],ESI  ; 此处 ESI=0
141744EE0: CMP dword ptr [RDI+0x2C],ESI
141744EE8: LEA RDX,[RDI+0x2C]
141744EF2: CALL [vtable+0xD0]        ; 非零时把字段地址传给器材提示
```

- 因此状态 `+0x2C` 位于 core `+0x198C`；传入提示的参数是**字段地址**，不是其 DWORD 值。
- `FUN_14173E170` 用该参数 `+4` 查询实体，取得 `0x2DA46A70` region wrapper；无 wrapper 会返回。再从 owner 取 `0x2C4D49E3` 数据、读 DWORD `+0x1A0`。缺 data 时没有已确认的安全空检查，不能盲目构造半成品对象。
- `FUN_140DF0C80` 映射器材名称 CRC 到提示；`FUN_141709000` 接受类型 `0x0F–0x1E`。`FUN_1411E0940` 查询训练完成状态；`FUN_140E1E310` 为说明/训练流程共用 UI 入口，需区分第三参数 `0/1`（见 §6.6），不是网络启动请求。

| 器材 | 类型 `data+0x1A0` | workout ID | 名称 CRC | 提示 ID |
|:---|---:|---:|:---|---:|
| 卧推 | `0x11` | 3 | `0xEAFC0891` | `0x58` |
| 腿举 | `0x18` | 13 | `0x8F1490F1` | `0x5E` |
| 哑铃 | `0x15` | 9 | `0x4C0715DA` | `0x5B` |
| 跑步机 | `0x1E` | 12 | `0x89482226` | `0x63` |

`FUN_14171AE80` 还检查 owner/模式/玩家状态等条件；`FUN_141744D50` 存在通用距离判断分支，但未证实器材提示经过哪个距离分支，不能把其中阈值直接当健身使用半径。新 Luna 仅报告 `DAT_1422F890C` 比较线索，未闭合其与器材路径的关系，不作为修复参数。

**4.1 记录语义与名称 CRC（M，本轮新增）**

- 状态 `+0x2C..+0x3B` 的第一个 DWORD 只当“非零即有效”；第二个 DWORD（`+0x30`）被当作**名称**用：提示消费者先做世界哈希表查找 `FUN_141672520(world,&out,该值)`，而该表的键就是 `court data+0xA0`（`FUN_141617360` 插入处以 `*(uint *)(data+0xA0)` 为键）。所以记录内容是“附近器材的**名称 CRC**”，不是实体 id，也不是距离。
- `court data+0xA0` 是 COURT **全局 bit0**（dirty `+0xA4`，宽 4 字节）；`+0x13C` 是全局 **bit8**（dirty `+0x140`，宽 4 字节）＝Opal 的 `ArtBinding`；类型仍是 court bit20/`+0x1A0`。全局 20 位的偏移/宽度由 `FUN_1416E1080` 逐字段给出（M，与 `CourtLayout2K22.js` 的宽度表一致）。
- 名称 CRC 就是 `crc32(<训练项目名>)`；哈希函数已独立校验（`crc32("gym")=0x7F27DBED`，与既有记录一致）。`FUN_140DF0C80` 的完整表（M）：

| 名称 CRC | 训练项目名 | 提示文本 ID |
|:---|:---|---:|
| `0xBB35B65F` | `AGILITY_HURDLES` | `0x56` |
| `0xAABBA94D` | `BATTLE_ROPE` | `0x57` |
| `0xEAFC0891` | `BENCH_PRESS` | `0x58` |
| `0x9E0E0AB0` | `BOX` | `0x59` |
| `0xFE7D8902` | `CLEAN_WEIGHT` | `0x5A` |
| `0x4C0715DA` | `DUMBBELL` | `0x5B` |
| `0x6B45F0E9` | `GATORADE` | `0x5C` |
| `0xC7457BA3` | `LADDER` | `0x5D` |
| `0x8F1490F1` | `LEG_PRESS` | `0x5E` |
| `0x1AE760A6` | `MEDICINE_BALL` | `0x5F` |
| `0x1F789231` | `SPRINT` | `0x61` |
| `0x9F95BDF8` | `SQUATS` | `0x62` |
| `0x89482226` | `TREADMILLS` | `0x63` |

- 无匹配时返回 `0x4C`（默认提示）。`FUN_141709000` 只做“类型 ∈ `0x0F..0x1E`”判定；`FUN_14173E170` 的类型→训练 ID 表为 `0x0F→10, 0x10→7, 0x11→3, 0x12→2, 0x13→4, 0x15→9, 0x16→1, 0x17→6, 0x18→0xD, 0x19→0xB, 0x1C→8, 0x1D→5, 0x1E→0xC`（`0x14/0x1A/0x1B` 走特殊分支）。**已证实的类型↔名称配对只有**上一节 4 行（`0x11/0x15/0x18/0x1E`），其余 9 个类型对应哪个训练项目仍未证实，不能按顺序臆测。

**4.2 状态载体与门槛（M，本轮新增）**

- `{0x17,2,0}` 的 `0x17` 是**实体类型**：`TK_WORLD::PLAYERMANAGER::Init`（`FUN_141698f40`，`tkworld_playermanager.vcc`）以 `FUN_141698bb0(...,0x17)` 注册本地玩家，值存于 `player+0x446B8`，再传给 `FUN_14188e430` → `AI_WORLD_2KWORLD_BASE`（CRC `0x98AD822F`）的 `vtable+0x88(kind,flag)` 创建 AI-world actor（`FUN_141639e60`，`TK_WORLD::PLAYER::CreateAIActor`）。远端/球场占位玩家用 `0x16`（`FUN_1416403a0` 以描述符 `param_2[6]` 传入）。因此 `{0x17,2,0}` = **本地玩家的 AI actor**，`+0x298`（器材）与 `+0x2B0`（出口/电梯）是它的两个记录 getter。
- `FUN_14171AE80` 的真实门槛（M）：`*(player+0x12C) == 0x9705BB0D`＝`crc32("WALKING")`，由 `FUN_141698f40` 在 Init 写入（`+0x12C`，dirty `+0x130`）；另要求 `player+0x25C != 0`、若干 vtable 检查为 0、`worldctx+0x10` 的 `[2] != 0xD`。
- 记录 `+0x14`（提示状态 `+0xC`）非零时调 `FUN_140E1E310(0,workoutId,0)` 打开说明 UI；2026-10-26 已证实它来自 RequestInstructions，不能由此推导「无需服务端训练状态」或「该位恒零是卡死根因」。真正训练控制器见 §6.6。
- **发布可行性（M/S）**：`CourtLayout2K22.js` 已能写 `Bit.Name`(4B)、`Bit.CourtType`(4B)、`Bit.ArtBinding`(4B)、`Bit.CourtTransform`(64B)，分别对应客户端 `+0xA0/+0x1A0/+0x13C/+0xB0`。若根因是“缺器材 COURT 对象”，现有协议位足够，不需要新增字段。

### 5. 已闭合的状态复制与实际虚调用

**主表起点与槽位（M）：** `FUN_1415F91C0` 中 `1415F91CF: LEA RAX,[0x142CA1CA0]`、`1415F91D9: MOV [RCX],RAX`，证明 core 主表起点是 `0x142CA1CA0`。`1415F9202` 取同一对象 `+0x1960`，`1415F9220` 调 `FUN_1415F2E60` 初始化。表项 `0x142CA1EA0 = FUN_1416CFC30`，故真实槽为 **`+0x200`，不是 `+0x40`**。首项 `FUN_14160A7C0` 是析构包装，涉及对象大小 `0x1FF0`。

`FUN_14172B060(owner,dt)` 的实际顺序（M）：

```text
owner+0x2E0 非空且其虚槽+0x78检查通过
  -> FUN_1415F3060(&stack)
  -> FUN_141713090(&stack)
  -> core.vtable+0x208(core,&stack,owner+0x20所存值)
  -> FUN_1416EE080(owner,&stack)
  -> [owner+0x2E0].vtable+0x1D8(context,&stack)
  -> FUN_14188F7A0(context,dt)
14172B12A -> FUN_1415F2E60(&stack)             ; 再次重置输出结构
14172B13E -> context.vtable+0x1E0(context,&stack) ; 重置后的填充候选
14172B150 -> core.vtable+0x200(core,&stack)    ; 此处 core=[owner+0x18]
  -> FUN_1416CFC30(core,source)
     -> FUN_1415FEB40(core+0x1960,source)
     -> FUN_1415FEB40(DAT_146774F20+0x3860,core+0x1960)
  -> FUN_141676B00(owner,&stack)
```

| 证据 | 精确指令 / 内存 | 结论 |
|:---|:---|:---|
| M1 | `14172B12F` 取 `[RDI+0x2E0]`；`14172B136` 令 RDX=`RSP+0x20`；`14172B13E: CALL [RAX+0x1E0]` | 不能漏掉 reset 后、复制前的虚回调。前面的输入处理不等于最终输出来源。 |
| M2 | `14172B144` 取 `[RDI+0x18]`；`14172B148` 令 RDX=`RSP+0x20`；`14172B150: CALL [RAX+0x200]` | 已找到实际间接调用点，不再停留于函数指针表引用。 |
| M3 | `1416CFCD4` 取 core `+0x1960`；`1416CFCDB` 调 `1415FEB40`；`1416CFCF5` 再复制至全局镜像 | 此函数是复制/同步入口，不能称为距离检测。 |
| M4 | `1415FEB7A: MOVUPS XMM0,[RDX+0x2C]`；`1415FEB7E: MOVUPS [RCX+0x2C],XMM0` | source `+0x2C..+0x3B` 整段复制至 core 对应状态字段，包含提示读取的 DWORD。 |
| M5 | `FUN_1415F2E60` 从 `0x142CC1AE0` 初始化 `+0x2C`；该地址前16字节全零 | 默认状态无该提示；但随后 `+0x1E0` 回调可能改写，不能由默认值推断最终输出恒零。 |

### 6. 上游组件输出与健身状态链路（最新结果见6.8/6.9）

**6.1 实例安装与父回调**

- `FUN_14163A780` 检查其参数 `+0x2E0`，为空则调用 `FUN_141B693B0`，于 `14163A93D` 存入返回值（函数体 M 复核；精确存储地址由 L 返回）。
- 工厂 vptr `0x142DAAF20` 由 L 在 `FUN_141B693B0` 中定位；表 `+0x1E0` 即 `0x142DAB100`，M 读到指针 `0x141B98690`。其他已查工厂类型也共享该回调（L），不能据共享槽推断所有运行时类型相同。
- **尚未闭合：** `FUN_14163A780` 与 `FUN_14172B060` 的函数指针出现在同一候选方法表序列（`0x142CA6750/0x142CA6500`），支持同 owner 类关联；尚缺该 owner 构造器 vptr 写入的独立确认。因此下面输出链与第5节 context 的连接保留为高相关候选，不报成完整动态链。
- `FUN_141B98690`（M）先检查查询 `{0x17,2,0}` 或 `FUN_141B76860` 的 gate，再遍历父对象 `+0x2A0` 链表；按 class/query key `0xE793889F` 查询每个条目，命中后调用 child `vtable+0x98(child,source)`。

**6.2 子组件与嵌套回调（构造/表关系为 L；函数行为已 M 复核）**

| 项目 | 地址 / 布局 | 证据与边界 |
|:---|:---|:---|
| 子组件工厂 | `FUN_141B538D0`；分配 `0x5B60`；vptr `0x142DA1CF8` | `FUN_14163A780` 确有分配、构造及注册代码（M）；具体 vptr 由 L 确认。 |
| 查询实现 | 表 `+0x18 = 0x141BC5950` | L 读短函数机器码，key `0xE793889F` 返回 this。 |
| registry key | `0x01DF5E96` | 与 class/query key `0xE793889F` 不同，禁止混同。父初始化在 `parent+0x298` registry 操作。 |
| 输出实现 | 表 `+0x98 = FUN_141B97DF0` | 函数行为已 M 复核，见下。 |
| 嵌套组件 | vptr `0x142DA2080`；`+0x78 = FUN_141B98430` | L 在构造器定位；配置 `0x1424B5810` 首 DWORD=1 时启用该嵌套组件。 |

`FUN_141B97DF0`（M）以 `{0x17,2,0}` 查询实体：非空时先调用实体 `+0x2B0`，把返回记录 `+8..+0x17` 写入 source `+0x3C..+0x4B`；再按索引顺序 `[2,0,1,3]`（顺序由 L 读表确认）调用四个嵌套组件 `+0xA0`，首个非零分类值写入 source `+0x10`。最后**遍历全部四个组件**，分别调用 `+0x78(component,source)` 填充输出，不能把分类首命中错误理解为只运行一个输出回调。

`FUN_141B98430` 的真实写指令（M）：

```text
141B98465: CALL FUN_141848840          ; 构造实体查询，descriptor={0x17,2,0}
141B9846F: CALL FUN_141861570          ; 取实体；非空后继续
141B9848B: CALL [RDX+0x298]           ; entity.vtable+0x298，返回 record
141B98491: TEST RAX,RAX               ; record非空才复制
141B98496: MOVUPS XMM0,[RAX+0x8]
141B9849A: MOVUPS [RBX+0x2C],XMM0     ; RBX为source
```

因此已确认的**局部字段关系**：`record+8..+0x17 → source+0x2C..+0x3B`；后续复制链移至 core 同偏移。提示消费者检查有效位、以该字段块 `+4`（机器哈希）查对象。`{0x17,2,0}` 对应本地玩家 actor；指针 getter/setter、创建与字段生产者见 §6.5/6.6。

**6.3 分类谓词（L，不能当器材距离证据）**

- `FUN_141B75A60`：调用同一实体虚槽 `+0x298`，用 `record+0x18` 作为 `DAT_144130680` 的 DWORD 索引；真实短汇编由新 Luna 再次确认。表中枚举含义未知。
- `FUN_141B75A90`：实体 `+0x2E0` 返回记录 `+0x20 == 2` 时返回 9。
- `FUN_141B759F0`：实体 `+0x2B0` 返回记录类别为 2/4/5 时，结合配置返回 4/5/6。
- 前轮仅确认类别筛选，未证明器材距离。2026-10-26 已找到 `record+8/+0xC/+0x10/+0x14` 生产者 `141BB4A40`，见 §6.6；无需重复把这些消费者当生产入口。

**6.4 健身房完整链路、当前结论与阻塞**

- `FUN_141B98430` / `FUN_141B97DF0` 是**消费者**，不是 getter：先 `FUN_141848840` 构造 `{0x17,2,0}` 描述符，经 `FUN_141861570`/`FUN_141861FE0` 查世界实体表，再 `CALL [RDX+0x298]`（或 `+0x2B0`）取 record 后整块复制。
- 实体表属于 `AI_WORLD::AI_WORLD`（`FUN_14188C8F0`，基类 vtable `0x142D218D8`）：为 29 类各建两套（`world+0x5A8+i*0x20` / `world+0x948+i*0x20`），表指针位于 `world+0x5C0+i*0x20` / `world+0x960+i*0x20`。`0x17` 即本地玩家 actor（`FUN_14188E430` → `world->vtable+0x88(kind,flag)` 创建；`FUN_141639E60` 是玩家侧包装）。
- `FUN_14171AE80` 的门槛链（M）：`world = *(ctx+0x18)`；要求 world `+0x25C != 0`、`world+0x10 != 0xD`、`player+0x12C == 0x9705BB0D`（WALKING）；`world+0x1970` 为 2/3/4/5/7/8/10/0x0B 时跳过，否则以 `world+0x1960` 为 ctx 走 `+0xE8` 与 `FUN_141744D50`。record 副本落在 `world+0x1960+0x2C`。
- `FUN_14173E170` 的完整门槛（M）：`req = ctx+0x2C`；`req+4` 是注册表键（先查 `*(*(*(handler+0x10)+0x18)+0x48)` 的哈希表，命中后取接口 `0x2DA46A70`，未命中直接退出）；`req+8` 作为下游 `+0xD8/+0x100/+0x108` 的索引参数；`req+0xC != 0` 是查看说明请求脉冲（旧「训练激活」解释作废）。取到 court 数据（接口 `0x2C4D49E3`）后分两支：
  - `+0xD8 = FUN_1416A5910` 返回 0 → **设备占用/训练中**分支：需 `+0x108 = FUN_1416F6E70` 非零（健身房里它只在 court 类型 `0x1B` 返回 1，否则走 `FUN_140E0EDA0` 空操作），然后按 `court+0xA5`（bit1 `IsActive`）出 `0x53`/`0x54`，或按类型映射类别 → `FUN_1411E0940` 有记录时出 `0x7C`。
  - `+0xD8` 非零 → **通用/训练提示分支**：类型 `0x0F..0x1E` 且 `FUN_1416790B0` 为 0 时，按机器哈希选文案并显示；`req+0xC != 0` 时调 `FUN_140E1E310(0,workoutId,0)` 开说明界面，**不是实际训练开始链**（见 §6.6）。
- `FUN_1416A5910` 尾句是 `return (FUN_1411E0940(cat,…) == 0)`：**无训练记录 → 返回 1 → 进通用/训练分支**。故私服不下发生涯训练数据是正确状态，不需要补 `0x281E490A`/`GYM_WORKOUT_TYPE`（上一版判断方向错误，已作废）。
- `FUN_1416790B0` 返回 0 的条件（M）：`FUN_14166EE00(*(manager+0x3F8), key) != 0`（该表即 `manager[0x7F]+0x48`，与 `FUN_1416A5910` 同表，能解析的对象必然命中）+ `courtData[0x348 + idx*0x48] == 0`（0=空闲 / 1=排队 / 2=特殊；该字段属 bit83/84/85 的 0x48 记录组，不发即为 0）。返回 5 = `DAT_146774F20` 名称需求表判定不满足（文本 `0x65`）；返回 3 = 未命中，落在 `switch(iVar9)` 的 `case 3` 空分支，不显示任何提示。
- **提示文本由 `court+0xA0`（bit0 `Bit.Name`）决定（M）**：`FUN_140DF0C80` 是 13 项硬表——`0xEAFC0891→0x58`(BENCH_PRESS)、`0x4C0715DA→0x5B`(DUMBBELL)、`0x8F1490F1→0x5E`(LEG_PRESS)、`0x89482226→0x63`(TREADMILLS)，其余 `0xBB35B65F→0x56`、`0xAABBA94D→0x57`、`0x9E0E0AB0→0x59`、`0xFE7D8902→0x5A`、`0x6B45F0E9→0x5C`、`0xC7457BA3→0x5D`、`0x1AE760A6→0x5F`、`0x1F789231→0x61`、`0x9F95BDF8→0x62`；其它哈希回落通用 `0x4C`。`+0xA0` 同时是世界哈希表键，必须以官方机器哈希发布，不能写锚点名 CRC。
- **发布基线（已实施，游戏内已验证出提示）**：`Opal/Source/Protocol/GymEquipment2K22.js` 的 4 个锚点带 `Name`（官方机器哈希，同时是 `court+0xA0` 世界哈希键与文案键）、`CourtObjectId=Name`、`CourtId/ObjectId`=锚点 CRC、`ArtBinding`=锚点名 CRC(bit8)、`Count=1`、一条零值 0x48 占位记录、一条 setup 记录、`GameState=0`。
- **游戏内逐轮结论（全部为用户实测反馈）**：
  | 轮 | 变更 | 结果 |
  |:---|:---|:---|
  | 1 | `bit0`=机器哈希、`Count=0` | 完全没有提示 |
  | 2 | + 全零 0x48 记录（bit83）、`Count=0` | 仍完全没有提示 |
  | 3 | `Count=1` + 零值 0x48 记录 + `ArtBinding` + 机器哈希 | **提示与说明面板正常**（卧推/哑铃） |
  | 4 | 方案 A：合成 gotnext 组 | 仍卡死；日志证明 `Deliver` 全绿、客户端不重发 JOIN |
  | 5 | + 占位记录补发 | 仍卡死；客户端活着但锁住移动 |
  | 6 | 客户端只读探针 | 定位到 `kind=2` 与 `decide flag(+0xC)=0` |
- **规则化结论（M）**：`Count=1`（bit82 队列组）决定对象能否成为距离交互目标（缺它则静默），`bit0` 决定文案；两者独立。
- **按 A 的表现（现象，M）**：客户端发 `Crc('JOIN')`（court key = 锚点 CRC `0xA8094F93`），画面活着但锁住移动，之后不再发任何请求；只有重启 Opal 才能恢复。
- **方案 A（服务端，已实施）**：新增 `Opal/Source/Protocol/GymSpots2K22.js`，由 `GymEquipment2K22.Regions` 合成单座 `gotnext` 组（`CourtId`=锚点 CRC、`SlotObjectId`=`0x47494D00<<32|CRC`、`Anchors`=[setup 记录 base = 垫子世界坐标]、`QueueFunction:0`、`TeamSize:1`）；`GotNext.GroupFor` 开头钩子命中即返回。`Slots` 对任意 SlotId 自动建状态，`Slots.Publish` 在 bitstream 世界直接返回，`BroadcastCourtGroup`/`MaybeStartMatch` 对未知 court 安全空转；公园/舞台路径不受影响。
- **JOIN 链路已验证无断点（M，探针全绿）**：组命中 `BENCH_PRESS_GROUP_0/0xA8094F93` → `occupy=0/1 freed=0` → `courtId=0xA8094F93` → 垫子坐标写入 `body+1212`(field 147) → `GOT_NEXT`(0xCA9B2162) 落 `body+69`、court id 落 `body+73` → 1296B 帧发出 → warp 到 (692,0,11743) facing 129 → `Ack=true`。
- **占位记录补发（已实施）**：公园由 `CourtData.LiveSpotRecord` 把 PUID 写进 0x48 记录 `+8+slot*8` 并经 `BroadcastCourtGroup` 回发；健身房组不在球场表，该函数返回 `{Court:0,Mirror:0}` 什么都不发。故新增 `GymEquipment2K22.OccupancyRecord` 与 `PublishSpot`，在 `GotNext.Seat`、`Release`、`Vacate` 各推一次。实测仍卡死。
- **客户端状态机（M，探针直读）**：
  - 正常：调度记录 `world+0x1970`(kind)=0、`world->vtbl+0xE8()`=0。
  - 按 A 后：外层 kind（`world+0x1970`）变 **2**（跳过集 `{2,3,4,5,7,8,10,0xB}`）、`vtbl+0xE8`=1；子记录 `world+0x1990` 写入卧推机器哈希 `0xEAFC0891`。随后这条提示调度不再执行。**这是旧探针观察，不等于真正训练控制器也未执行**。
  - 旧样本中 `FUN_14173E170` 入参 `+0xC` 恒 0、`+4` 为机器哈希。2026-10-26 已核明该位是说明脉冲；由其恒 0 推断「不能开始训练」的结论撤销，详见 §6.6。
  - `FUN_14171AE80` 前置门顺序：`param_1+0x20 != 0` → `world->vtbl+0xE8()`=0 → `courtManager+0x25C != 0` → `world+0x10 != 0xD` → `vtbl+0xB0/0x118` → `world+0x12C == 0x9705BB0D`(WALKING) → `world+0x1970` 不在跳过集。
- **重连残留（现象已确认，根因未完全闭合）**：用户此前实测重启游戏仍判「在 got next」，须重启 Opal。2026-10-26 源码复核：`Close` 先置 Closed/State.Closed（`Connection.js:145–158`），`Vacate` **已有** `Slots.Release(Puid)`（`GotNext.js:1105`），但 `PublishSpot` 仅向该关闭连接发送、必被拒绝；其他在线玩家未收到此处的设备清零通知。`BestBodies` 仅单人 CPU Pending 断线分支清理（`ParkCpu.js:452–463`），普通健身房断线没有清理；重连握手仅以更长正文替换旧缓存（`PlayerObject.js:290–294`）。**旧正文恢复 GOT_NEXT 是嫌疑，尚未采到该次缓存内容；不能断言 Slots 没释放，也不能宣称已修复。**
- **记录结构关系（M，2026-10-26 纠正语义）**：`FUN_141744D50` 将 `ctx+0x2C` 交给 `FUN_14173E170`，入参即 `world+0x198C`：`+0`=附近记录有效、`+4`=机器哈希（卧推 `0xEAFC0891`）、`+8`=区域索引、`+0xC`（`world+0x1998`）=查看说明脉冲。`FUN_14171AE80` 的 `+0xE8` 是另一前置检查，接收整条 `world+0x1960`；勿与实际 actor `record+0x18` 训练状态混同。
- **已作废，勿重走**：① 早期把 `world+0x196C` 的 `unlock(+0xC)`（19460/32756）当成 `FUN_14173E170` 的 `+0xC`——**偏移不同、不是同一字段**（后者在 `world+0x1998`），「+0xC 已非零却不弹 UI」的判断作废。② 补生涯训练字段（`0x281E490A`/`GYM_WORKOUT_TYPE`）方向作废：`FUN_1416A5910` 在无训练记录时返回 1，进入提示分支才是正确状态。③ 把 `has next on court` 日志当「已落座证据」作废（它在 `Deliver` 之前打印）。
- **当前下一步（2026-10-26）**：启动延迟与结束恢复已验收；调查如何保留紫垫交互而不显示额外Got Next圆点（§6.11），不盲改Count=0。断线缓存/通知另案处理。
- **临时调试资产（问题闭合后全部删除）**：
  | 位置 | 内容 | 关闭方式 |
  |:---|:---|:---|
  | `Opal/Source/Protocol/GotNext.js` | `Probe()`；`Handle→Deliver→Seat` 各出口、`Deliver` 异常栈 | `OPAL_PROBE=0` |
  | `Opal/Source/Protocol/Connection.js` | 收包切换、未处理包日志 | `OPAL_PROBE=0` |
  | `Opal/Source/Protocol/GymEquipment2K22.js` | A/B 阶梯：每次「有占用」的发布推进一档（A spot0/game0、B spot1/game0、C spot0/game2、D spot1/game2、E spot2/game0） | 删除 `Variants`/`VariantIndex`，固定为 A 档 |
  | `Granite/Module/GymProbe.h` 及 `EnableGymProbe`/`LogGymProbe`、Module 接线、项目项 | **已移除**；2026-10-26 文件检索及 `Granite/Module` 内容搜索均无相关项 | 不恢复旧探针；若确有静态阻塞，另提最小取证方案 |
  | `Granite/Module/GymTrainingTrace22.h` + Module 条件接线、独立 vcxproj 构建项 | 新观测点：状态机 `141BC2090`、实际训练控制器 `141BB4CB0`、mode gate `14170D200`；标记 `GYMTRACE22-v1` | 仅 `GymTrace22=true` 构建启用；普通构建不安装，取证结束删除头/接线/构建项 |
- 未验证：真正训练控制器能否进入小游戏；训练完成上报（`UploadGymActivityResults = 0x58BD1CB0`）与每周属性增益仍未开始。说明脉冲非零不作为训练验收标准。

**6.5 本地 actor 与记录创建（2026-10-26，M；Ghidra 汇编/内存 + IDA 同 VA 核对）**

- 两工具均加载目标 unpacked EXE，Ghidra SHA-256 与 §工程入口一致；以下是静态类型路径，未读取本轮游戏进程的实际 vptr。
- world 构造链：`14188C8F0 → 14188D400 → 141B54DF0`；最终 `141B54E17/25` 安装表 `142D9D548`。其查询槽 `+0x18 = 141BC5E60` 接受 `0x98AD822F`，工厂槽 `+0x88 = 141B8ED40`。不能使用基类表 `142D218D8` 的空工厂作实际 actor 结论。
- 工厂 type `0x17` 经 `141B8EEAA` 分配 `0xD00`、`141B8EEE4` 调 `141967770`；后者 `1419677CA/D1` 最终安装 actor 表 `142D61750`。

| 静态证据 | VA / 指令 | 含义 |
|:---|:---|:---|
| getter / setter | 表 `+0x298/+0x2A0 = 141A273E0`：`MOV RAX,[RCX+0xCD0]; RET`；`+0x2A8 = 141AAC6C0`：`MOV [RCX+0xCD0],RDX; RET` | actor `+0xCD0` 保存记录指针，不是记录内嵌起点。Ghidra 未定义短函数，已直接核机器码并以 IDA 交叉确认。 |
| 创建与接线 | 表 `+0x148`（`142D61898`）=`1419E6D70`；`1419E6DAD` 大小 `0x2A8`；`1419E6DC1` 调 `141936130`；`1419E6DD4` 调 actor `+0x2A8` | 记录创建后通过 setter 接入本地 actor；不是前轮已查的提示消费者。 |
| 记录身份 | `141936130/141936137` 安装表 `142D35AE0`；查询实现 `1419369B0` 接受 `0x3F2FC3D8` | 可用于后续运行态对象核对；创建记录不等于开始训练。 |

- 字段关系：`*(actor+0xCD0)+0x14 → 141B98430` 的 `MOVUPS [record+8] → [source+0x2C]` → `source+0x38` → `world+0x1998` → `14173E170` 入参 `+0xC`。记录指针创建链与该字段生产者均已找到；**其语义现确认为查看说明脉冲**，实际训练入口见 §6.6。

**6.6 重要纠错与真正训练门槛（2026-10-26，M；Ghidra 汇编/内存 + IDA 辅助）**

- **旧根因撤销**：`record+0x14`（提示入参 `+0xC`）是 **RequestInstructions / 查看说明脉冲**，不是「正在训练」或 A 键开始训练的必需位。未按说明键时为 0 不能证明训练故障；旧探针只观测提示消费者，不能覆盖实际训练控制器。

| 已核证据 | 精确点位 / 行为 |
|:---|:---|
| 说明请求与生产者 | `141B4C310` 日志名 `GOTNEXT_AREA_DETECTOR::RequestInstructions`；`141B4C42D` 写组件 `+0x3428=3`。`141BB4BDC` 每次更新先清 `record+0x14`；状态 3 分支 `141BB4C0E` 将其置 1，`141BB4C15` 清请求状态。 |
| UI 参数区分 | 提示消费者 `14173E6AD/B6` 令 `R8D=0` 后调 `140E1E310`；真正训练控制器 `141BB4CF4` 设 `R14D=1`，`141BB4EA2/A7` 以 `R8D=1` 调同函数。不能因共用 UI 入口就混同两条启动链。 |
| PLAYER 状态映射 | `141754090`（Update_AIWorldDescription）在 `1417541DD–14175422C` 读 PLAYER `+0x12C`：`GOT_NEXT/CA9B2162→2`、`PLAYING/ECBCCDF8→3`，写描述 `+0x50`。**`141754222/228` 还会在所引用对象 `+0x400` 非零时覆盖为 1**，不能忽略此门槛。 |
| actor 训练状态 | `141BC2090` 在 `141BC21A1` 读取输入**首 DWORD**（不是 `+0x970`）；输入 2 走 Got Next 等待分支，输入 3 且 record `+0x18!=6`、`14170D200()==0`，才在 `141BC21ED` 写 `record+0x18=6`，继而 `141BC21FC/2204` 调 `1418F28D0/1419370D0`。`+0x970/+0x974` 是另外的输入字段，勿混为状态。 |
| 真正训练控制器 | `141BB4CB0` 首先要求自身 `+0x118/+0x11C` 非零；workout id `+0x48` 非零且 `+0x30` 对象为空时创建对象并写 stage `+0x24=2`。`141BB4DDA` 检查 actor record `+0x18==6`，满足后进入 stage 3；`141B892B0` 放行后才调用 UI（flag=1），后续 stage 5 调 workout 对象 `+0x78` 开始流程。 |

- **修正前服务端差异（S）**：gym合成组只授GOT_NEXT、不在普通MaybeStartMatch两队表中；仅健身的状态/机器键修正现已实施并通过本次卧推验证，见 §6.8，不为健身创建公园GAME/名单。
- **证据边界**：描述 `+0x50` 到 `141BC2090` 输入首DWORD的完整静态分发尚未闭合，但本次动态input3/actor6/gate0及实际训练已验证入口和卧推列表匹配。无需为此重复启动调查；结束状态问题见 §6.9。

**6.7 启动修正前取证摘要（v1 / v1.1，2026-10-26）**

- 旧日志：JOIN/Seat/Ack成功；区域input2/actor状态3（Got Next等待），gate未调用而非返回0。v1.1确认controller持续更新、列表头可读非空；state180停2，workout_id/stage/workout=0，状态2后8秒内调用增加1119次。`selection_ok`只表示字段读取成功，不表示选择通过。
- 原生选择：`141BB4D53/66` 要求controller `+0x180==3` 后调 `141B64840`；还需 `+0x210` 标记与列表两次匹配。首选entry `+0x74==3`、entry `+0x70` 索引 `142DB7728` 匹配 `+0x1BC`；第二entry `+0x88` 匹配首选 `+0x78`、entry `+0xA0` 匹配controller `+0x1B8`，再写workout_id `+0x48`。新日志已证明卧推能完成该匹配，无需重复旧采集。

**6.8 启动生产链与已实施修正（2026-10-26，卧推用户验收）**

- **关键证据（Ghidra汇编/内存，IDA同VA核对）**：`141B50A80` 将单例 `144139910` 存wrapper `+0xD0`；表 `142D9E6D0+0x68→141BC2DC0` 接收描述。`141BC2DD5–141BC2DFE` 在旧状态非3、新描述 `+0x50==3` 时置controller `+0x210=1`，离开3时清零；`141BC2E08–141BC2E8B` 复制描述 `+0x10..+0xDF→controller+0x140..+0x20F`，故 `desc+0x50→+0x180`，`desc+0x88/+0x8C→+0x1B8/+0x1BC`。pending不是描述+E0副本。
- **身份来源**：`141754437/43B` 在描述状态3分支，经 `141754441/447` 将PLAYER `+0x134`（CourtName）写描述 `+0x8C`；`+0x88` 是COURT名单PUID匹配索引，缺匹配默认0。机器表 `142DB7728` 的卧推条目3=`EAFC0891`，不是锚点 `A8094F93`。
- **已实施（原批准的三份JS）**：`GymSpots2K22.js` PLAYER CourtId用Region.Name，锚点/机器双键解析同组；JOIN/ObjectId/SlotObjectId及几何保留。`GotNext.js` 仅2K22 neighborhood健身在占位/目的地/Warp/Ack成功后升PLAYING，跳过普通MaybeStartMatch，Reapply保持状态与机器键。`GymEquipment2K22.js` 去A–E阶梯，固定spot0/game0、Count1及占位PUID。三份node --check/差异检查已通过；DLL及暂存区未改。
- **本次已验证**：用户五张截图及客户端 `561dbff2` 第82–96行确认workout_id3、pending1被消费、match1bc=`EAFC0891`、input3/actor6/gate0及stage2→3→1→5→6；截图完成11次、力量+3、周训练表已显示。仅确认本次客户端结果，不证明重登持久化/其他器材/普通球场回归。

**6.9 完成后状态释放（2026-10-26，腿举用户验收）**

- **根因/修复**：旧HandleGameEnd仅查普通两队球场，健身结束只Ack、未释放，Reapply继续维持PLAYING。现已在Ack后限定2K22 neighborhood、当前GotNext.Playing及已识别健身组，复用Release恢复WALKING、清机器键/占位/GotNext并发PLAYER，跳过普通比赛结果流程。无新Hook、定时器或奖励规则；实施时语法/差异检查通过。
- **用户验收与日志**：客户端 `97ae5abc` 第141–145行tick33781421清workout并回stage0，33781515时state180=0、机器键清零、input0/actor0，间隔约94毫秒。服务端 `fb956e24` 第185行21:39:33记录 `ended gym workout LEG_PRESS_GROUP_0Shape; WALKING restored`；用户确认“训练结束后正常恢复了”。仅确认本次腿举退出恢复，不外推全部器材、普通球场或奖励持久化均通过。
- **原生边界**：`141B993FA/401/474` 清workout；session+6C8经 `1411F3500→140856690→140856430` 是自动存档，不是结束发包。完整健身→结束命令发送链及Court/Result/Score语义仍未闭合，不影响已验收的当前上下文Release方案。独立断线清理不在此范围。

**6.10 按A后启动等待（2026-10-26，版本修正用户验收）**

- **修正前现象**：卧推561dbff2与腿举97ae5abc的input1→3分别20.094/20.766秒；控制器持续更新但停state180=1。服务端收到JOIN后同步授PLAYING，没有人为20秒等待。
- **根因证据（M/S）**：`1417458DA`发JOIN并置manager+400；`141745527–52F` 的SESSION+E8门控经 `1416A44D0→1416A4410` 检查未完成请求。`141617F50` 保存目标COURT和发送前版本；`141694340` 收ACK仅置标记；`141746ED0` 在 `141747031/035、1417470E3–E9` 同时要求ACK和目标版本严格增长，否则等超时。COURT版本getter/setter为表142CA1A58的+78/+80→`140243540/140465890`（对象+48）；`1404637B0/7BB` 将正文第二个64位值读入版本。共享布局参数虽名OwnerId，实际是正文+8版本；旧健身发布一直为0。
- **修正/验收**：仅GymEquipment2K22.js增加可选Version及PublishRegion，初次/占位/释放发布复用Connection.CourtVersions按锚点递增；未改身份、几何、PLAYING、ACK、Release或原生计时。Node v24.18.0语法/差异检查通过，暂存内容与两份DLL哈希未变。用户最新明确“修复完成”；启动延迟修复记为用户验收，不虚构修后精确毫秒值或未提交的新日志。仍使用v1.1 DLL。
- **计时边界**：请求键A0F10AA4默认10.0f，实际运行配置/时间单位及旧样本超时分支未采；不能称其为已证实的20秒常量。detector的100.0f失败计时和20项历史环均未修改。

**6.11 健身区域与额外Got Next圆点（2026-10-26，仅调查）**

- **官服显示基线（用户确认）**：不直接显示额外Got Next排队圆圈；踩在紫色垫子上出现训练提示。不再重复查实录，内部GOT_NEXT标签不能等同可见圆点。
- **当前源码事实**：健身仍发Count1及0x48/0x90记录，Layout22固定HasWaitingArea=1；通用setup默认+80=count1、+84=0、+85=1、+88=function0。Count0曾导致无提示，不得据此直接清Count隐藏圆点。
- **调查结果/边界**：交互判定、HasWaitingArea的PrintDirty引用均不能证明显隐开关。L定位 `1416AD2B0::COURT::Object_Init→1416403A0`；主代理反编译复核其+640/+67D循环涉及PLAYER/演员字段，未证明是圆点，不作为修复点。末尾直接调用 `140DBD7E0` 也未闭合到圆点绘制。真实圆点资源/创建/显隐消费者仍未知，无可靠字段修改方案；本轮不改显示字段、Count或已验收启动链。

### 7. 训练完成状态与结算边界（前轮静态证据）

| 函数 / 字段 | 已观察行为 | 未证明内容 |
|:---|:---|:---|
| `FUN_141193580` | 逐项解析 `0x281E490A`(类别)、`0xC4182747`(训练类型)、`0x1752DE86`(奖牌)：`+0x17AC8[类别]=类型序号`、`+0x17AB0[类别]=奖牌序号`；随后 `0x9A53ECCA → +0x17AF8`(上次重置日期)。类别表 6 项、类型表 14 项、奖牌表 5 项，均以 `NONE=0x4905ED7B` 打头。 | 不等于已实现训练启动/上传协议。 |
| `1411939F8 → 141193CA8` | 类别字段不存在时跳过日期处理、保留原状态。 | 缺字段只等于“无训练记录”，不等于清空存档。 |
| `DAT_146332628` | 全局槽存放 progression 结构指针；结构内 `+0x17AB0`(奖牌序号)、`+0x17AC8`(类型序号)、`+0x17AE0`(进度)、`+0x17AF8`(日期)。 | 禁止对全局槽地址直接加上述偏移找字段引用。 |
| `FUN_1411E0940` | `+0x17AB0[cat] == 0` 立即返回 0；否则返回 1 并导出类型/奖牌/进度。**0 = 无记录**。 | 全零生涯数据 = 无记录，是提示可用状态。 |
| `FUN_141954580` | 日期零按过期/无有效冷却处理；有效天数取运行时 `DAT_146842745`。 | 未静态确认固定7天；NPC规则文字不等于二进制参数。 |
| `FUN_14195B6D0` / `FUN_14123FF10` | 前者检查索引1–5完成状态，后者处理到期清理。 | 未游戏验收每周增益与清理行为。 |

### 8. 资源、摆位与几何证据

- 提取读取器：`Granite/Server/Tools/ImportStoreCatalog2K22.py:32–145`；manifest size 单位乘4得到字节数；physical offset=`(row.offset-archive最低offset)*4`。ZIP local records 支持 deflate，前轮用 size/CRC 校验提取。
- `levels/gatorade_training_facility_markers.iff`：archive `2Q`，physical byte offset `395331312`，1592字节；SHA-256 `8185f3e4d29cbdec6b596fb187d43c6cbd359fc3e34da105fa2e170bca83c21d`。`markers.SCNE` SHA-256 `782542ed64f3cf6fbd98cc14e5ac19274000663e4b2011973276e91b65d3084e`（R，本轮重读 JSON 元数据）。
- 前轮统计54节点、13个 `GOT_NEXT` 分组锚点；器材 `UserText` 关联组，未发现 parent/明确边界。不能将 UserText 当已验证的网络字段或把组锚点当每台机器的使用点。

| 组锚点 | Translate `[x,y,z]` | 对应器材 marker 数 |
|:---|:---|---:|
| `BENCH_PRESS_GROUP_0` | `[692.478149,0,11742.625]` | 5 |
| `LEG_PRESS_GROUP_0Shape` | `[2188.03125,0,12277.7295]` | 5 |
| `DUMBBELL_GROUP_0` | `[2322.35425,0,11616.2891]` | 3 |
| `TREADMILLS_GROUP_0Shape` | `[1060.63623,0,8960.65234]` | 4 |

- 一组可含多台器材（如5台卧推）；不能按每个模型直接创建独立篮球场，也不能由一个组 marker 推出完整槽位/几何网络结构。
- `gym.iff/gym.ACTIVITY`：整体活动 `GYM_EXERCISE_ROOM`，origin marker `gatorade_training_facility_animation_origin`，入口 `EP_GYM`；整体 bounds 与 `DRAW_RADIUS_IN_FEET=150` 不是器材使用范围证据。
- `ptsm_gatorade_training_facility.iff`：9040字节二进制 PTSM、无可打印字符串，尚未解码。
- 主场景 `levels/gatorade_training_facility.iff`：`2Q` physical `366773076`，28553860字节；SHA-256 `dcdd3abb7147e6622277a7d2e252c39df26fb8eac274ebebe883367959325e2c`。前轮1178成员 size/CRC 校验通过；`level.SCNE` 3956617字节，已查器材组名/交互关键词无命中，主要为静态对象/LOD/矩阵。此检索结果不证明所有资源都没有交互定义，但不应反复重做同一关键词搜索。
- 当前仅保留 scratch `C:/Users/haerin/.pi-desktop/scratch/7d06707b-5c65-4c7b-b791-7ad3d3d4a96b/` 下 `gatorade_gym_markers.json`（16608字节）和 `gym_config_candidates.json`（6542字节）。scratch 随会话清理，不是永久工程资源；可依上述 archive/offset/hash 重新提取。前轮临时脚本/原始切片已清理。

### 9. 必须保留的纠错与已排除方向

| 误读 / 死路 | 已确认纠正 |
|:---|:---|
| `plVar3+0x32C` 当字节偏移、得到字段 `+0x358` | plVar3 是 qword 指针；真实 `LEA +0x1960`，目标字段 `+0x198C`。以汇编为准。 |
| 把 `0x142CA1E60` 当 core 表首、CFC30 当 `+0x40` | 真正表首 `0x142CA1CA0`，构造器写 vptr 已确认；CFC30 为 `+0x200`。 |
| 默认初始化后立即复制，推断来源一直零 | 中间还有 `14172B13E` 的 `+0x1E0` 输出回调，禁止遗漏。 |
| `FUN_14171CA10` 及 `1417488F0/141750B80` 当生成入口 | 属 OUTDOOREVENT 比赛等待/结束旁路；CA10先调用提示消费者再处理比赛；不能据传入额外参数认定函数会写该状态。 |
| `+0x67D` 是器材区域数量，`+0x687/+0x698/+0x6E0` 是几何字段 | `FUN_1416AD2B0` 的此循环创建 type `0x16` PLAYER/CPU；不是器材碰撞区域。具体 ID 身份仍未知。 |
| dirty flags 是值字段、序列化长度是位数 | 值与 dirty 偏移分开；有关 serializer 长度按字节核对。 |
| `FUN_1415F7CA0/1415F78B0` 大对象是碰撞 group/shape | 仅确认创建 `0x1D30/0x1D10` 对象，未证实碰撞语义；撤回该命名。 |
| `FUN_14172D9C0` 是器材提示 | 是场景入口 UI；`gym` CRC `0x7F27DBED` 隐藏提示，不是器材近距链。 |
| 名称表/动画即可找到请求 | `0x142C41EE0/0x142CC4B00` ACTIVITY 名称表、`141B8F220/141B8F5E0` 动画回调已查，未闭合启动请求，不应重复盲搜。 |

保留的宽度事实：全局 bit98=`+0x679` byte、bit99=`+0x67B` byte，其和供 `FUN_1416AD0A0` 返回 count，具体含义未知；bit100=`+0x67D` byte；101–108=`+0x687` 8×byte；109–116=`+0x698` 8×qword；117–124=`+0x6E0` 8×qword。对应 dirty 为 `+0x67A/+0x67C/+0x67E/+0x67F/+0x68F/+0x6D8`。PLAYER生成中 `+0x687` 选 stride `0x560` 配置、`+0x698` 进实体描述符、`+0x6E0` 写新实体 `+0x100`，不能据此补发“器材几何”。

扫描复盘：前轮 `.text` 的 `0x198C/0x1960` 原始字节命中分别14/82个，只有经指令及基址归属验证的结果才能引用；相同位移可能来自全局配置、栈帧或其他对象。后续 `+0x2E0` 扫描36个 MOV 候选也包含大量32位字段/嵌入vtable/栈写入。`0x141768820` 虽为真实 setter `MOV [RCX+0x2E0],RDX`，其对象身份未确认，禁止并入目标 owner 链。无需把原始候选列表当作已证实的调用链。

### 10. 当前阻塞、下一步与实施边界

1. **当前结论**：卧推启动/11次/+3显示、腿举结束恢复、COURT版本递增后的启动延迟修复均由用户验收。当前调查额外Got Next圆点（§6.11），不外推奖励持久化或全部器材均已通过。
2. **独立未解决项**：健身房重连缓存/设备占用通知尚未修复。`Vacate` 已有 `Slots.Release(Puid)`，不要重复添加；关闭连接收不到设备清零帧是源码事实，旧缓存恢复GOT_NEXT仍是待运行态证实的嫌疑，详见 §6.4。
3. **不再盲试**：A–E设备阶梯已移除，固定已验收的提示/几何基线；说明脉冲不能用于判断训练根因。
4. **最新日志**：客户端97ae5abc（156行）、服务端fb956e24（198行）；腿举workout13/机器8F1490F1启动、完成并退出PLAYING。旧卧推561dbff2/afa33edf及截图保留作对照，勿混为同一运行。
   - **构建隔离**：仅 `/p:Configuration=Release /p:Platform=x64 /p:GymTrace22=true` 启用 `GRANITE_GYM_TRACE22`；普通 Release 不编入/安装取证 Hook，不新增 INI 开关，不改 Opal。构建中间产物已清理。
   - **当前产物 v1.1**：`Granite/Build/GymTrace22/Module.dll`，594944 字节，SHA256 `269248D78E57053C67E84D77F4C011AEFA43FF3FD76099933B560C994E56C6DA`；同目录 `Module.pdb` 8114176 字节。已替换独立目录中的 v1 产物，原普通 Release DLL 未覆盖。
   - **当前下一步**：定位额外圆点绘制/显隐门槛；保留紫垫触发提示及已验收训练链，证据确认后先提交最小方案，未经批准不改功能代码。
5. **修复边界**：当前只读调查显示侧，不改共享ACK/布局、Count或原生计时。游戏内/网络回归由用户操作，奖励重登持久化和每周属性效果未验收。
6. **本轮边界**：只更新本文，未改功能代码/暂存内容，未部署/注入/重启/改配置/构建或运行单元/游戏测试。v1.1 DLL SHA256 `269248D78E57053C67E84D77F4C011AEFA43FF3FD76099933B560C994E56C6DA`、普通Release SHA256 `70FB30D99A905637DD7FF993EF5D8F9338EFE34D08FBB2DE5FBCD06B1468C0DA` 为前轮核对值。
