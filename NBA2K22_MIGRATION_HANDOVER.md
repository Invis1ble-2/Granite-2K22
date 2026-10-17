# NBA 2K22 交接

更新：2026-10-17。仅保留未完成事项与必要工程约束；已验收功能的实现细节不在此重复记录。

## 未完成 / 待确认

- **多人公园**：真人同步、比赛开赛与结算未完成；比分和人数显示未验收。已测单人公园对齐不外推到多人场景。
- **MyCOURT**：访客加入及 `RemovedPlayers` 语义待核实；新档首次属性预算时序未完整覆盖。
- **不可用场景/内容**：Game Room、Ante-Up、健身房项目不可用；护城河场景缺少 got next 点，空心球蹦床球场及街区大厅场景存在进入问题。后者新档初次出生时可进入，其他情形未解决。
- **可选玩法**：单人 3v3 及 2v2/3v3 等待 10 秒后以 AI 补位；增强 AI（总评 80–99、随机位置与体型）。

## 工程入口与约束

- 工作区：`D:/download/Granite-main`；HTTP：`Granite/Server`；注入模块：`Granite/Module`、`Granite/Injector`；Opal：`Opal`。
- 游戏：`D:/SteamLibrary/steamapps/common/NBA 2K22`；日志：游戏目录下 `console logs`。
- 逆向目标：`NBA2K22.exe.unpacked.exe`，SHA-256 `14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0`，基址 `0x140000000`；固定地址仅适用于此版本。
- 街区 marker：`Opal/Source/Activity/StageSpots/ShipCourts2K22.markers.json`；几何分析：`NBA2K22_COURT_GEOMETRY_ANALYSIS.md`；名单崩溃分析：`NBA2K22_PARK_ROSTER_ANALYSIS.md`；MyCOURT 映射：`Opal/Source/Protocol/Shootaround.js`。
- 保留历史日志、抓包和崩溃 dump。未经明确要求，不重启服务、不终止游戏/服务、不部署 DLL、不覆盖运行配置。
- 修改后仅做编译或语法检查；单元测试及实际游戏/网络验收由用户执行，未运行的检查不得标为通过。
- 进度专题交接：`NBA2K22_BADGE_BUDGET_HANDOVER.md`、`NBA2K22_PROGRESSION_HANDOVER_FINAL.md`。
