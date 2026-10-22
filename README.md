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
- **Ante-Up**：目前1v1无法开赛问题未修复；排队推进及完整多人比赛等未验收。VC 仅为练习显示，不扣款、不结算。
- **场景设施**：Game Room 设施、健身房项目不可用；护城河缺少 Got Next 点，蹦床球场存在进入问题。
- **其他内容**：未列出的玩法不保证可用，项目尚非完整官方服务替代品。

## 特殊功能

| 功能 | 说明 |
| --- | --- |
| 随机80-99总评人机补位 | 公园人数不足时补位，单人或者少人也能开赛 |
| 公园 120 FPS | 默认已启用，并配置启动脚本中已知可行的 `6/6/120` 同步参数，勿混用旧版。 |
| 动画限制解除 | 默认显示全部原生动画候选并跳过身高、属性、进度限制，仍走正常购买流程。 |
| 动画全部拥有 | `Granite.ini` 中 `EnableAnimationUnlockAll=1`，默认关闭；开启后无需购买。 |
| 永久物品自动拥有 | 服务端 `AutomaticOwnership=true`，默认开启；涵盖服装、鞋等永久物品，不含消耗品。 |
| 生涯快速解锁 | `InstantMaxProgression` / `InstantMaxBadges` 默认开启，解锁成长进度与徽章进度 |
| 固定 VC | 新钱包初始为 `888888` VC；默认正常扣款，`VirtualCurrencyStatic=true` 可固定余额。 |

客户端配置位于 `Module.dll` 同目录的 `Granite.ini`，下次启动游戏生效；服务端配置位于 `Granite/Server/Config.json`。

## 启动与联机

环境：Windows、Node.js 18.20.8+；编译原生模块需 Visual Studio 2022 的 C++ 桌面开发组件。

1. 本机使用时，将 `Granite/Server/Config.json` 的 `PublicHost` 设为 `127.0.0.1`；虚拟局域网联机则设为服务器虚拟网卡 IPv4。`Host` 保持 `0.0.0.0`。
2. 运行 `StartServers.bat`，统一启动 Granite 与 Opal，并同步对外地址。
3. 每台客户端使用配套 `Module.dll`，修改其同目录 `Granite.ini` 的以下字段，保留其他已有设置：

```ini
[Network]
ServerHost = 127.0.0.1
ServerPort = 21000
```

联机时将 `ServerHost` 改为服务器虚拟网卡 IPv4（不含协议或端口），所有玩家加入同一虚拟局域网且使用不同玩家 ID。仅服务器电脑运行服务端；防火墙放行 TCP `21000`、TCP `20054`、UDP `28091`，自定义端口时对应调整。

配置地址不代表联机已验收，请自行验证互见、切场景、开赛、结束及退出重进。

## 目录与编译

- `Granite/Server`：HTTPS 接口、登录、存档、商店与 VC。
- `Opal`：街区、场景、排队与比赛 relay。
- `Granite/Module`：客户端注入 DLL；`Granite/Injector`、`Granite/Launcher`：注入与启动工具。
- `Granite/Server/Storage`：运行数据；CDN 资源放入其 `Cdn` 子目录。

在 VS 开发者命令行执行：

```bat
msbuild Granite\Granite.sln -p:Configuration=Release -p:Platform=x64
```

产物位于 `Granite/Build`。客户端 Hook 仅适用于当前适配的 2K22 可执行文件，不保证兼容其他版本。

## 致谢与许可

原项目作者：@vjei、glory（@beforeglory）。Copyright (c) 2026 Celestial。
原项目仓库：https://github.com/ztpd/Granite/

采用 [PolyForm Noncommercial License 1.0.0](LICENSE.md)，仅限非商业用途。MinHook 保留其 BSD 2-Clause 许可（见 `Granite/Module/MinHook/MinHook.h`）。
