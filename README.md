# Granite

This project was developed by me (@vjei) and glory (@beforeglory), this is the base of every project above 2K18, and since everyone decided to leak this source and profit, we're going to release it for free. It was developed in four days, and matchmaking took nearly 4 hours, this is the FIRST proper above 2K18 server in the world. It doesn't matter who it is, this is the base for everyone's work above 2K18.

Join discord.gg/celestialclient

A private server stack for NBA 2K19 on PC.

| Component | Path | Description |
| --- | --- | --- |
| Granite Server | `Granite/Server` | HTTPS web services: login, sessions, store, virtual currency, MyCareer, MyTeam, Pro-Am, user content and matchmaking. |
| Opal | `Opal` | Secure websocket world server for the neighborhood, stage, MyCourt and squads, plus the UDP game relay. |
| Module | `Granite/Module` | Native DLL loaded into the game. Redirects 2K web traffic to Granite and installs the crash handler. |
| Injector / Launcher | `Granite/Injector`, `Granite/Launcher` | Native tools that start the game and load `Module.dll`. |
| Shared | `Shared` | Ante-Up court pricing used by both servers. |

## Requirements

- Node.js 18 or newer
- Visual Studio 2022 with the C++ desktop workload to build the native projects

A self-signed TLS certificate is included in `Granite/Server/Storage/Certificate` and is used by both Granite and Opal.

## Running

```bat
StartServers.bat
```

Or start each server on its own:

```bat
cd Granite\Server
npm start

cd Opal
npm start
```

### NBA 2K22：虚拟局域网联机

1. 服务器电脑和朋友加入同一个虚拟局域网，记下**服务器电脑的虚拟网卡 IPv4**。
2. 服务器只修改 `Granite/Server/Config.json` 的 `PublicHost` 为这个 IPv4；`Host` 保持 `0.0.0.0`。默认端口：`Port=21000`、`WorldPort=20054`、`RelayPort=28091`。
3. 使用 `StartServers.bat` 启动：脚本读取上述配置，统一设置 Opal 切场景与比赛 relay 地址，替换旧的 `OPAL_PUBLIC_HOST` / `OPAL_RELAY_HOST` 环境变量。无需修改 JS、C++ 或脚本内的 IP。
4. 每台客户端（包括服务器电脑上运行的游戏）使用新版 `Module.dll`，在 **DLL 同目录**的 `Granite.ini` 中添加/修改下面的配置。保留已有 Features/Logging 等设置，不要覆盖整份运行配置。

```ini
[Network]
ServerHost = 服务器电脑的虚拟网卡IPv4
ServerPort = 21000
```

`ServerHost` 只接受 IPv4，不含协议、端口或路径；`ServerPort` 是 Granite HTTPS 端口，不是街区端口。缺失/非法值回退为 `127.0.0.1:21000` 对应的默认字段值，下次启动游戏生效。新建 ini 会自动包含 Network；旧 ini 不会被重写。HTTP 重定向、属性价格直连和多人公园控制请求复用同一个服务器地址。

仅服务器电脑运行 Granite/Opal；朋友只运行客户端。服务器防火墙应允许虚拟网卡上的 TCP `21000`、TCP `20054`、UDP `28091`（自定义端口则对应调整），无需为此公开路由器端口。此步骤只配置连接地址，不代表多人比赛已验收：请双方依次验证登录、进入同一街区、移动互见、切场景、排队开赛、结束和退出重进，且玩家 ID 必须不同。

分开 `npm start` 时，Granite 仍读取 Config.json；启动 Opal 前需手动将 `OPAL_PUBLIC_HOST`、`OPAL_RELAY_HOST` 设置为同一个 PublicHost，并同步 `OPAL_PORT=WorldPort`、`OPAL_RELAY_PORT=RelayPort`。推荐使用启动脚本避免遗漏。保留默认 `127.0.0.1` 即继续本机使用。

Granite reads `Granite/Server/Config.json`. Environment overrides:

| Variable | Purpose |
| --- | --- |
| `GRANITE_PORT`, `GRANITE_HOST` | Granite listen address |
| `OPAL_PORT` | Opal websocket port |
| `OPAL_RELAY_PORT`, `OPAL_RELAY_HOST`, `OPAL_RELAY_BIND`, `OPAL_PUBLIC_HOST` | Relay and advertised addresses |
| `OPAL_SSL`, `OPAL_KEY_NAME`, `OPAL_CERT_NAME` | Certificate used by Opal |
| `GRANITE_LOCKSTEP_BUFFER_FRAMES`, `OPAL_LOCKSTEP_DELAY_FRAMES`, `OPAL_LOCKSTEP_HZ` | Lockstep tuning (the two frame counts must match) |
| `GRANITE_VC_STATIC` | Use a fixed 100000 VC wallet |

Pass `--verbose` for detailed logging and `--capture` to record traffic.

Stage court placement is tuned in `Opal/Source/Activity/StageSpots/StageSpots.txt`.

## Data

The repository ships the endpoint table and the store catalog. Runtime state is created on first use and is not tracked: sessions, owned items, career progress, user content, arbitration results and captures. CDN files belong in `Granite/Server/Storage/Cdn`.

`Granite/Server/Tools/ImportStoreCatalog.py` rebuilds `Storage/Inventory/AutomaticCatalog.json` from a game manifest:

```bat
python Granite\Server\Tools\ImportStoreCatalog.py <manifest> Granite\Server\Storage\Inventory\AutomaticCatalog.json
```

## Building the native projects

```bat
msbuild Granite\Granite.sln -p:Configuration=Release -p:Platform=x64
```

Output is written to `Granite/Build`.

## Tests

```bat
cd Granite\Server
npm test

cd Opal
npm test
```

The native test project is `Granite/Module/Tests/CrashHandlerTests.vcxproj`. It expects a Release `Module.dll` in `Granite/Build/Release`.

## License

Copyright (c) 2026 Celestial. Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You may use, modify and share this project for personal, hobby, research and other noncommercial purposes. Commercial use is not permitted.

MinHook (`Granite/Module/MinHook`) is copyright Tsuda Kageyu and is distributed under its own BSD 2-Clause license, included in `MinHook.h`.
