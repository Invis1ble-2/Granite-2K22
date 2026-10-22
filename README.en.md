# Granite — NBA 2K22 Modified

[中文](README.md) | English

Modified from the original Granite project by @vjei and glory (@beforeglory) to support NBA 2K22 on PC. Originally built for NBA 2K19, this fork now focuses on 2K22 only. It is not a from-scratch project and remains a work in progress.

## Current Progress

- **Neighborhood and travel**: Neighborhood entry, Game Room and Ante-Up entry, and travel between the latter two have passed user verification.
- **Park games**: Solo 3v3 CPU fill, pregame models/nameplates, and postgame spot cleanup have passed user verification. Games with enhanced CPUs can now start.
- **Two-player online play**: A Park match with two human players was completed. The 120 FPS and smoothness fixes have been confirmed by the user.
- **Ante-Up**: Got Next spots and left/right positioning have passed user verification; court bet displays are restored. This does not confirm playable matches.

These results cover only the verified scenarios. Other player counts/modes, repeated matches, full game timing, and long-term synchronization still need verification.

## Known Issues

- **MyCOURT**: Friend joining and mutual visibility are broken; online gameplay and leaving behavior remain unverified.
- **Ante-Up**: Starting 1v1 still unavailable. Queue progression and complete multiplayer matches are unverified. VC amounts are for practice display only, with no deductions or payouts.
- **Facilities**: Game Room facilities and gym activities are unavailable. The moat area lacks Got Next spots, and trampoline courts have entry issues.
- **Other content**: Unlisted modes are not guaranteed to work. This is not yet a complete replacement for official services.

## Special Features

| Feature | Details |
| --- | --- |
| CPU fill / enhanced CPUs | Fills empty Park slots. |
| 120 FPS Park | Enable by default, and the launch script's `6/6/120` synchronization settings. |
| Animation restriction bypass | Shows all native animation candidates and bypasses height, attribute, and progression requirements by default. Normal purchases still apply. |
| All animations owned | Set `EnableAnimationUnlockAll=1` in `Granite.ini` to equip without purchasing. Disabled by default. |
| Automatic permanent-item ownership | Server option `AutomaticOwnership=true`, enabled by default. Covers permanent items such as clothing and shoes, not consumables. |
| Instant career unlocks | `InstantMaxProgression` / `InstantMaxBadges` are enabled by default, unlocking progression and badge budgets |
| Fixed VC | New wallets start with `888888` VC. Purchases deduct VC by default; `VirtualCurrencyStatic=true` keeps the balance fixed. |

Client configs are in `Granite.ini` beside `Module.dll` and apply on the next game launch. Server configs are in `Granite/Server/Config.json`. 

## Setup and Multiplayer

Requirements: Windows and Node.js 18.20.8+. Building native components requires Visual Studio 2022 with the Desktop development with C++ workload.

1. Set `PublicHost` in `Granite/Server/Config.json` to `127.0.0.1` for local use, or the server's virtual-LAN IPv4 for multiplayer. Keep `Host` at `0.0.0.0`.
2. Run `StartServers.bat` to start Granite and Opal with matching advertised addresses.
3. Use the matching `Module.dll` on every client. Update these fields in `Granite.ini` beside the DLL, preserving other settings:

```ini
[Network]
ServerHost = 127.0.0.1
ServerPort = 21000
```

For multiplayer, replace `ServerHost` with the server's virtual-LAN IPv4, without a scheme or port. All players must join the same virtual LAN and use distinct player IDs. Only the server PC runs the services. Allow TCP `21000`, TCP `20054`, and UDP `28091` through its firewall; adjust these for custom ports.

Address configuration alone does not verify multiplayer. Check mutual visibility, travel, match start/end, and leaving/rejoining in-game.

## Layout and Build

- `Granite/Server`: HTTPS APIs, login, saves, stores, and VC.
- `Opal`: Neighborhood, travel, queues, and match relay.
- `Granite/Module`: Client DLL; `Granite/Injector` and `Granite/Launcher`: injection and launch tools.
- `Granite/Server/Storage`: Runtime data; place CDN assets in its `Cdn` subdirectory.

Run from a Visual Studio developer command prompt:

```bat
msbuild Granite\Granite.sln -p:Configuration=Release -p:Platform=x64
```

Output goes to `Granite/Build`. Client hooks target the currently supported 2K22 executable; other versions are not guaranteed to work.

## Credits and License

Original authors: @vjei and glory (@beforeglory). Copyright (c) 2026 Celestial.
Original repository: https://github.com/ztpd/Granite/

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md), for noncommercial use only. MinHook retains its BSD 2-Clause license; see `Granite/Module/MinHook/MinHook.h`.
