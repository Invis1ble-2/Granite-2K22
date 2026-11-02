# Granite — NBA 2K22 适配

中文 | [English](README.en.md)

基于 @vjei 与 glory（@beforeglory）开发的 Granite 原项目修改，适配 PC 版 NBA 2K22。原项目面向 NBA 2K19，本分支仅继续维护 2K22，非从零开发，目前仍在完善中。

## 当前进度

- **街区与场景**：街区大厅可进入；Game Room、Ante-Up 独立进入及双向互切已验收。
- **公园比赛**：单人 3v3 人机补位、赛前模型/名牌及赛后占位修复已验收；增强人机已能开赛。
- **双人联机**：双真人公园对局已完成整场比赛；120 FPS 与流畅度修复已获用户确认。
- **Ante-Up**：Got Next 点位，球场金额显示已恢复；不代表内部比赛可用。

以上仅代表已验收场景，其他人数/模式、连续重开、完整计时与长期同步仍待验证。

## 已知问题

- **MyCOURT**：好友加入与双方互见异常，联机玩法及离开流程未确认。
- **Ante-Up**：目前1v1无法开赛问题未修复；排队推进及完整多人比赛等未验收。已实现入场扣 VC、胜者 2 倍派彩（无抽成）及流局/整场取消退款，实际结算待游戏内验收；需关闭固定 VC。
- **场景设施**：Game Room 设施、健身房项目不可用；护城河缺少 Got Next 点，蹦床球场存在进入问题。
- **其他内容**：未列出的玩法不保证可用，项目尚非完整官方服务替代品。

## 特殊功能

| 功能 | 说明 |
| --- | --- |
| 可选总评人机补位 | 服务端可选随机 80–99 或固定 80–99 总评人机补齐公园空位，默认随机。 |
| 公园 120 FPS | 默认启用，根目录 `Config.json` 统一配置 6 帧缓冲和 120 FPS，两端自动使用相同参数，勿混用旧版。 |
| 动画限制解除 | 默认显示全部原生动画候选并跳过身高、属性、进度限制，仍走正常购买流程。 |
| 动画全部拥有 | `Granite.ini` 中 `EnableAnimationUnlockAll=1`，默认关闭；开启后无需购买。 |
| 永久物品自动拥有 | 服务端 `AutomaticOwnership=true`，默认开启；涵盖服装、鞋等永久物品，不含消耗品。 |
| 生涯快速解锁 | `InstantMaxProgression` / `InstantMaxBadges` 默认开启，解锁成长进度与徽章进度 |
| 固定 VC | 新钱包初始为 `888888` VC；默认正常扣款，`VirtualCurrencyStatic=true` 可固定余额。 |

客户端配置位于 `Module.dll` 同目录的 `Granite.ini`，下次启动游戏生效；Granite、Opal 与 `StartServers.bat` 共用项目根目录的 `Config.json`，原来的两份服务端配置已合并。

| 配置字段 | 用途 / 当前值 |
| --- | --- |
| `PublicHost` | 两端统一对外 IPv4；本机填 `127.0.0.1`，联机填服务器虚拟网卡 IPv4。 |
| `Host` / `RelayBind` | Granite HTTPS / Opal UDP relay 的监听地址，默认均为 `0.0.0.0`。 |
| `Port` / `WorldPort` / `RelayPort` | Granite HTTPS / Opal WSS / UDP relay 端口，当前为 `21000` / `20054` / `28091`。 |
| `LockstepBufferFrames` | 登录参数和 relay 共用的缓冲帧数，当前为 `6`，允许 `1..49`；无需再分别配置两端。 |
| `OnlineFrameRate.FrameRate` | 联机帧率，当前为 `120`，支持 `60` 或 `120`。 |
| `ParkCpu` | 人机补位开关、适用人数及总评设置，保留原 Opal 字段。 |

`Storage/...` 等存储相对路径仍以 `Granite/Server` 为基准。修改网络或同步参数后需重启两端；通过脚本或分别执行 `node Granite/Server/Server.js`、`node Opal/Opal.js` 均读取同一配置。原有端口、监听地址及缓冲帧数环境变量仍可覆盖配置；若同时设置两端缓冲帧数变量，其值必须一致。对外地址统一以 `PublicHost` 为准。

Opal 默认仅输出错误日志，正常连接、球场发布和比赛状态不刷屏。需要排查时可在根目录执行 `node Opal/Opal.js --verbose`，查看保留的调试信息；lockstep 周期汇总和 ParkCpu 成功阶段日志已移除。

## 启动与联机

环境：Windows 10/11（自带 Edge WebView2 运行时）、Node.js 18.20.8+；编译原生模块需 Visual Studio 2022 的 C++ 桌面开发组件，编译 GUI 启动器需 Go 1.22+ 与 Wails v2 CLI。

1. 本机使用时，将根目录 `Config.json` 的 `PublicHost` 设为 `127.0.0.1`；虚拟局域网联机则设为服务器虚拟网卡 IPv4。`Host` 保持 `0.0.0.0`。
2. 运行 `StartServers.bat`，统一启动 Granite 与 Opal，并同步对外地址。
3. 每台客户端使用配套 `Module.dll`，修改其同目录 `Granite.ini` 的以下字段，保留其他已有设置：

```ini
[Network]
ServerHost = 127.0.0.1
ServerPort = 21000
```

联机时将 `ServerHost` 改为服务器虚拟网卡 IPv4（不含协议或端口），所有玩家加入同一虚拟局域网且使用不同玩家 ID。仅服务器电脑运行服务端；防火墙放行 TCP `21000`、TCP `20054`、UDP `28091`，自定义端口时对应调整。

配置地址不代表联机已验收，请自行验证互见、切场景、开赛、结束及退出重进。

### GUI 启动器

将 `Launcher.exe`、配套 `Module.dll` 和已有的 `Granite.ini` 放在同一目录，然后打开启动器。注入功能已内置，无需 `Injector.exe`：

1. 在“开始游戏”中浏览选择 `NBA2K22.exe`，路径会保存到启动器旁的 `Path.txt`。仍兼容旧文件中的目录或可执行文件路径，以及 `Launcher.exe --game "绝对路径\NBA2K22.exe"`；指定路径只会预填界面，不自动启动游戏。
2. 在“连接设置”中填写服务器 IPv4 和 HTTPS 端口，点击保存。只更新 `[Network]` 下的两个连接字段。
3. 在“Module 设置”的“功能”“日志与输出”页调整开关并保存。设置项和默认值以 `Granite/Module/ModuleConfig.h` 的实际读取定义为准，当前为 6 个功能开关、11 个日志与输出开关，以及连接页的 2 个网络字段；不从 INI 模板推导设置列表。现有值仍按 Module 自身的规则从运行配置读取；只保存改动的开关，保留其他配置与注释，下次启动游戏生效。
4. 点击“启动游戏”，界面会显示启动阶段；失败时自动展开日志，可复制错误详情。“模块注入完成”仅代表 DLL 已成功加载，仍需自行确认进入街区和联机表现。
5. 侧栏底部可即时切换浅色/深色主题及中文/English。首次跟随系统外观和界面语言，手动选择后按当前 Windows 用户记住偏好；切换不会丢弃未保存的设置，也不会改写 Module 配置。

启动器仅支持 NBA 2K22，不管理服务端进程。首次使用请手动验收主题和语言切换、关闭重开后的偏好保留、路径保存与重开读取、连接和 Module 设置保存、玩家身份及游戏启动；界面缩放和游戏内效果也需实际确认。

## 目录与编译

- `Granite/Server`：HTTPS 接口、登录、存档、商店与 VC。
- `Opal`：街区、场景、排队与比赛 relay。
- `Granite/Module`：客户端注入 DLL（C++）。
- `Granite/Launcher`：基于 Wails v2（Go + React + TypeScript + WebView2）的轻量化 GUI 启动器，内置 DLL 注入功能。
- `Granite/Server/Storage`：运行数据；CDN 资源放入其 `Cdn` 子目录。

编译原生模块（在 VS 开发者命令行执行）：

```bat
msbuild Granite\Granite.sln -p:Configuration=Release -p:Platform=x64
```

编译 Wails GUI 启动器：

```bat
cd Granite\Launcher
wails build -clean -trimpath -platform windows/amd64 -o ..\..\..\Build\Release\Launcher.exe
```

产物统一位于 `Granite/Build/Release`（`Module.dll` 与内置注入功能的单文件 `Launcher.exe`），不再构建或分发独立 `Injector.exe`。客户端 Hook 仅适用于当前适配的 2K22 可执行文件，不保证兼容其他版本。

## 致谢与许可

原项目作者：@vjei、glory（@beforeglory）。Copyright (c) 2026 Celestial。
原项目仓库：https://github.com/ztpd/Granite/

采用 [PolyForm Noncommercial License 1.0.0](LICENSE.md)，仅限非商业用途。MinHook 保留其 BSD 2-Clause 许可（见 `Granite/Module/MinHook/MinHook.h`）。
