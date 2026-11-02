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
- **Ante-Up**: Starting 1v1 is still unavailable. Queue progression and complete multiplayer matches are unverified. Entry debits, 2x winner payouts with no house cut, and refunds for void/cancelled games are implemented but await in-game verification; static VC must be disabled.
- **Facilities**: Game Room facilities and gym activities are unavailable. The moat area lacks Got Next spots, and trampoline courts have entry issues.
- **Other content**: Unlisted modes are not guaranteed to work. This is not yet a complete replacement for official services.

## Special Features

| Feature | Details |
| --- | --- |
| CPU fill / enhanced CPUs | Fills empty Park slots. |
| 120 FPS Park | Enabled by default. The root `Config.json` selects a shared 6-frame buffer and 120 FPS for both services. Use matching client/server versions. |
| Animation restriction bypass | Shows all native animation candidates and bypasses height, attribute, and progression requirements by default. Normal purchases still apply. |
| All animations owned | Set `EnableAnimationUnlockAll=1` in `Granite.ini` to equip without purchasing. Disabled by default. |
| Automatic permanent-item ownership | Server option `AutomaticOwnership=true`, enabled by default. Covers permanent items such as clothing and shoes, not consumables. |
| Instant career unlocks | `InstantMaxProgression` / `InstantMaxBadges` are enabled by default, unlocking progression and badge budgets |
| Fixed VC | New wallets start with `888888` VC. Purchases deduct VC by default; `VirtualCurrencyStatic=true` keeps the balance fixed. |

Client settings are in `Granite.ini` beside `Module.dll` and apply on the next game launch. Granite, Opal, and `StartServers.bat` share the project-root `Config.json`, replacing the two separate server configuration files.

| Setting | Purpose / current value |
| --- | --- |
| `PublicHost` | Shared advertised IPv4. Use `127.0.0.1` locally or the server's virtual-LAN IPv4 for multiplayer. |
| `Host` / `RelayBind` | Granite HTTPS / Opal UDP relay bind addresses; both default to `0.0.0.0`. |
| `Port` / `WorldPort` / `RelayPort` | Granite HTTPS / Opal WSS / UDP relay ports; currently `21000` / `20054` / `28091`. |
| `LockstepBufferFrames` | One buffer frame count for login parameters and the relay; currently `6`, allowed range `1..49`. |
| `OnlineFrameRate.FrameRate` | Online frame rate; currently `120`, supports `60` or `120`. |
| `ParkCpu` | CPU fill switches, team sizes, and overall settings; retains the original Opal fields. |

Relative storage paths such as `Storage/...` still resolve from `Granite/Server`. Restart both services after changing network or timing settings. The batch script and separate commands `node Granite/Server/Server.js` and `node Opal/Opal.js` all read this configuration. Existing port, bind-address, and buffer-frame environment overrides remain supported; if both buffer variables are set, they must match. Advertised addresses always use `PublicHost`.

Opal logs errors only by default; normal connections, court publication, and match state changes stay quiet. For troubleshooting, run `node Opal/Opal.js --verbose` from the project root to see the remaining diagnostics. Periodic lockstep summaries and successful ParkCpu stage logs have been removed.

## Setup and Multiplayer

Requirements: Windows 10/11 (with built-in Edge WebView2 runtime) and Node.js 18.20.8+. Building native components requires Visual Studio 2022 with the Desktop development with C++ workload; building the GUI launcher requires Go 1.22+ and the Wails v2 CLI.

1. Set `PublicHost` in the root `Config.json` to `127.0.0.1` for local use, or the server's virtual-LAN IPv4 for multiplayer. Keep `Host` at `0.0.0.0`.
2. Run `StartServers.bat` to start Granite and Opal with matching advertised addresses.
3. Use the matching `Module.dll` on every client. Update these fields in `Granite.ini` beside the DLL, preserving other settings:

```ini
[Network]
ServerHost = 127.0.0.1
ServerPort = 21000
```

For multiplayer, replace `ServerHost` with the server's virtual-LAN IPv4, without a scheme or port. All players must join the same virtual LAN and use distinct player IDs. Only the server PC runs the services. Allow TCP `21000`, TCP `20054`, and UDP `28091` through its firewall; adjust these for custom ports.

Address configuration alone does not verify multiplayer. Check mutual visibility, travel, match start/end, and leaving/rejoining in-game.

### GUI Launcher

Keep `Launcher.exe`, the matching `Module.dll`, and your existing `Granite.ini` together, then open the launcher. Injection is built in; `Injector.exe` is no longer required:

1. Browse for `NBA2K22.exe` on the home page. The selected path is saved in `Path.txt` beside the launcher. Legacy directory/executable paths and `Launcher.exe --game "absolute\path\NBA2K22.exe"` remain supported; a supplied path pre-fills the GUI without launching the game.
2. Save the server IPv4 and HTTPS port under connection settings. Only the two `[Network]` fields are updated.
3. Adjust toggles on the Module settings feature/logging tabs and save. Editable fields and defaults follow the actual load definitions in `Granite/Module/ModuleConfig.h`: currently 6 feature switches, 11 logging/output switches, and the 2 network fields on the connection page. The list is not derived from an INI template. Existing values still use the Module's configuration-reading rules. Only changed toggles are saved; other settings and comments are preserved. Changes apply on the next game launch.
4. Start the game and follow the launch stages. Failures expand the copyable log. Module injection completion only means the DLL was loaded successfully; verify Neighborhood access and multiplayer in-game yourself.
5. Use the bottom sidebar buttons to switch light/dark themes and Chinese/English instantly. Initial preferences follow the system appearance and UI language; manual choices are remembered for the current Windows user. Switching preserves pending edits and does not write Module configuration.

The launcher supports NBA 2K22 only and does not manage services. Manually verify theme/language changes and persistence after reopening, saved game paths, connection/Module settings, player identity, game launch, and display scaling.

## Layout and Build

- `Granite/Server`: HTTPS APIs, login, saves, stores, and VC.
- `Opal`: Neighborhood, travel, queues, and match relay.
- `Granite/Module`: Client injection DLL (C++).
- `Granite/Launcher`: Lightweight GUI launcher with built-in DLL injection, built with Wails v2 (Go + React + TypeScript + WebView2).
- `Granite/Server/Storage`: Runtime data; place CDN assets in its `Cdn` subdirectory.

Build the native module from a Visual Studio developer command prompt:

```bat
msbuild Granite\Granite.sln -p:Configuration=Release -p:Platform=x64
```

Build the Wails GUI launcher:

```bat
cd Granite\Launcher
wails build -clean -trimpath -platform windows/amd64 -o ..\..\..\Build\Release\Launcher.exe
```

Outputs go to `Granite/Build/Release`: `Module.dll` and a single-file `Launcher.exe` with built-in injection. A separate `Injector.exe` is no longer built or distributed. Client hooks target the currently supported 2K22 executable; other versions are not guaranteed to work.

## Credits and License

Original authors: @vjei and glory (@beforeglory). Copyright (c) 2026 Celestial.
Original repository: https://github.com/ztpd/Granite/

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md), for noncommercial use only. MinHook retains its BSD 2-Clause license; see `Granite/Module/MinHook/MinHook.h`.
