# NBA 2K22 交接

更新：2026-10-19。保留未完成事项、必要工程约束与简短复盘；已验收问题不保留冗长静态调查。

## 最近验收

- **Game Room / Ante-Up**：用户已验收各自独立进入及双向直接互切；内部玩法与设施仍待修复。
- **街区大厅**：补齐 2K22 世界表缺失项后，用户已验收进入修复。
- **Ante-Up Bet**：纯服务端调整首次球场下发时机后，用户截图确认本次进入的多场 500 VC 金额恢复；未实施客户端金额修复。

## 未完成 / 待确认

- **多人公园**：真人同步、比赛开赛与结算未完成；比分和人数显示未验收。已测单人公园对齐不外推到多人场景。
- **MyCOURT**：访客加入及 `RemovedPlayers` 语义待核实；新档首次属性预算时序未完整覆盖。
- **Ante-Up 内部玩法**：Got Next 点位及左右选位已验收；排队推进与完整多人比赛未验收。本次金额修复后的退出重进、Game Room 双向互切与 Got Next 回归仍待验收。VC 仅练习值，不扣款或结算。
- **Game Room 内部设施**：设施不可用；用户反馈，待调查。
- **其他不可用场景/内容**：健身房项目不可用；护城河场景缺少 got next 点，空心球蹦床球场存在进入问题。
- **可选玩法**：单人 3v3 及 2v2/3v3 等待 10 秒后以 AI 补位；增强 AI（总评 80–99、随机位置与体型）。

## 本次复盘：先查下发时序，再查客户端

- **故障链**：服务端收到 Connect 后立即下发 8 场；球场注册成功后，客户端仍在 `rawMode=1` 时将条目清空。实际进入 Ante-Up 后 `rawMode=3`、helper 与对象标签均为 1，但列表已经为空，原生刷新不能恢复丢失的 ID。价格数据本身正确。
- **最终修复**：`Opal/Source/Protocol/Connection.js` 等待有效 PLAYER 握手；`PlayerObject.js` 在成功处理末尾首次发布，之后才安排 4/20 秒刷新；`Courts.js`、`Position.js`、`CourtData.js` 阻断等待期的重发及其他玩家广播。不改模式、价格、球场身份或 Got Next。
- **调查绕路**：未先核对服务端发送顺序，把客户端清缓存现象过早归因于模式标签错误，长时间追赋值点、虚表和资源查找，并增加临时 Hook。普通公园也有相同清空现象，不能单凭该现象判断 Ante-Up 异常；注册成功也不等于能绘制。
- **以后优先顺序**：先核对 Connect、有效握手、场景加载与首次对象创建，再查 Init/Deinit、注册/刷新、最后才查绘制或考虑客户端 Hook。服务端的 `has entered stage` 日志不代表客户端加载完成；重复发送相同对象也不保证重新 Init。用对照场景和最小改动验证，严格区分事实与假设。
- **收尾**：删除 Module 的 BETTRACE、独立临时 PARKTRACE、对应开关及专用测试；保留正常功能日志和崩溃捕获，不清理用户历史日志或抓包。

## 工程入口与约束

- 工作区：`D:/download/Granite-main`；HTTP：`Granite/Server`；注入模块：`Granite/Module`、`Granite/Injector`；Opal：`Opal`。
- 项目仅面向 NBA 2K22；后续适配直接使用 2K22 协议，不再新增或单独维护 2K19 兼容分支。
- 游戏：`D:/SteamLibrary/steamapps/common/NBA 2K22`；日志：游戏目录下 `console logs`。
- 逆向目标：`NBA2K22.exe.unpacked.exe`，SHA-256 `14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0`，基址 `0x140000000`；固定地址仅适用于此版本。
- 街区 marker：`Opal/Source/Activity/StageSpots/ShipCourts2K22.markers.json`；几何分析：`NBA2K22_COURT_GEOMETRY_ANALYSIS.md`；名单崩溃分析：`NBA2K22_PARK_ROSTER_ANALYSIS.md`；MyCOURT 映射：`Opal/Source/Protocol/Shootaround.js`。
- 保留历史日志、抓包和崩溃 dump。未经明确要求，不重启服务、不终止游戏/服务、不部署 DLL、不覆盖运行配置。
- 修改后仅做编译或语法检查；单元测试及实际游戏/网络验收由用户执行，未运行的检查不得标为通过。
