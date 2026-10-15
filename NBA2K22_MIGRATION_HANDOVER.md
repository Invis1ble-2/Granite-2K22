# NBA 2K22 私服交接

更新：2026-10-15。本文合并原迁移与街区交接；仅记录当前状态、关键契约及待办。自动化测试、静态检查与用户游戏验收分别表述。

## 当前状态

| 功能 | 状态 |
| --- | --- |
| 登录、生涯/属性与徽章、BOOST、街区队列 | 用户此前验收通过 |
| MyCOURT进入/返回、请求延迟、已映射菜单玩法及个人实训 | 用户验收通过；名单按请求顺序保留，不支持多人真人同步 |
| 单人公园2v2开赛、已测球场对齐 | 用户验收通过；模块版本`0x00010206` |
| 公园与MyCOURT篮筐/篮网动效 | 补齐`ArtBinding`后用户确认验收通过 |
| 早期注入签名等待修复 | 已实现；游戏验收状态待确认 |
| 动画 | CE补全表情商店列表及Module三项配置均已通过用户游戏验收 |
| 多人真人比赛、沙发/街机入口、完整结算 | 未支持或未验收 |

## 关键实现

- 2K22公园COURT类型：2v2=`8`/半场，3v3=`6`/全场；船上12个marker的场地绑定与排队布局已保留，未改坐标。
- 篮架动效：原生按`court_marker`名称CRC查找图形篮架。公园发送各marker名称CRC；MyCOURT零售资源`s656/s657`使用`main`，绑定CRC=`0xBF28CD64`。修复仅增加2K22 bit8 `ArtBinding`，不改变Name、场地映射、名单或2K19协议。
- MyCOURT菜单类型与COURT类型不同；个人实训要求Home/Away各一份名单，本机位置须符合请求。未克隆AI资料或伪造玩家。
- 单人公园补丁仅对受校验的Playing调用临时提供原生AI人数2/2；其他比赛/线程维持原值。注入器与模块均检查NBA2K22原生代码签名，避免过早注入。

## 动画功能与配置

- 用户已验收CE开关3补全街区动作表情商店列表。原类别1受`FUN_14068BBE0`排除/赛季过滤；不是资源缺失。
- Module新增`AnimationUnlock.h`：列表挂钩`0x14068BBE0`仅作用于原生动画商店对象，保留候选分组/顺序及无商品占位处理；资格`0x1412011D0`和拥有`0x1411F98D0`分别处理身高、属性、进度等条件及直接可用。自定义动画商店路径保留原逻辑，不增加非原生候选。
- `Module.dll`同级`Granite.ini`的`[Features]`配置（0关闭、1开启，下次启动生效）：
  ```ini
  EnableAnimationShopAll = 1
  EnableAnimationRequirementBypass = 1
  EnableAnimationUnlockAll = 0
  ```
- 前两项默认开启，保留正常价格/购买流程；全解锁默认关闭，开启后自动放行资格，即使第二项为0也能直接装备。全解锁仅虚拟拥有、不批写库存；关闭不撤销真实购买或已保存的装备选择。全部为0则不安装动画挂钩。价格仍为临时值。
- 保留用户要求的CT/只读快照工具，但不要与Module动画挂钩同时使用；启动前取消CE的1/2/3，签名不匹配会拒绝覆盖。只读快照要求原生代码未被动画列表挂钩修改。
- 本次MSVC `/Zs`语法检查、6处EXE签名/配置一致性检查及只读代码审查通过；未构建/部署DLL，未改运行配置或重启进程。原生版本见下述SHA256。
- 用户已确认动画功能游戏验收通过；配置项与行为边界见上文。原生地址仅适用于所列SHA256版本。

## 未完成 / 边界

- 多人同步/开赛、比分与人数显示、比赛结算未验收；MyCOURT访客/`RemovedPlayers`语义未核实。
- 街区服饰/鞋类商品与显示、Ante-Up进入问题待查；动画目录静态结论及尚未验收边界见上节。
- 新档首次属性预算时序未完整覆盖。已验收的公园对齐只适用于用户测试范围，不外推至所有场地/多人赛。

## 工程约束与入口

- 工作区：`D:/download/Granite-main`；Opal源码：`Opal`；HTTP源码：`Granite/Server`；Module/Injector源码：`Granite/Module`、`Granite/Injector`。
- 游戏：`D:/SteamLibrary/steamapps/common/NBA 2K22`；日志：游戏目录`console logs`。Opal代码更新由用户退出游戏后重启Opal加载；不需要重启HTTP或更新DLL。
- 原生分析目标`NBA2K22.exe.unpacked.exe`，SHA256=`14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0`，基址`0x140000000`；Ghidra固定地址仅适用于该版本。
- 街区绑定及场地映射数据：`Opal/Source/Activity/StageSpots/ShipCourts2K22.markers.json`；几何分析：`NBA2K22_COURT_GEOMETRY_ANALYSIS.md`；名单崩溃证据：`NBA2K22_PARK_ROSTER_ANALYSIS.md`。MyCOURT菜单映射与限制见`Opal/Source/Protocol/Shootaround.js`。
- 历史日志、抓包、崩溃dump保留原位；不得恢复生产自动帧捕获或删除证据。未经明确要求，不重启服务、不终止游戏/服务、不部署DLL、不覆盖运行配置。
- 代码修改后仅做静态代码错误检查；功能测试与游戏内验收由用户执行，不能把未运行的测试标为通过。
- 进度相关交接仍见`NBA2K22_BADGE_BUDGET_HANDOVER.md`与`NBA2K22_PROGRESSION_HANDOVER_FINAL.md`。
