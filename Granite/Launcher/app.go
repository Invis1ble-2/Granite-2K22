// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows"
)

type App struct {
	ctx context.Context
	mu  sync.Mutex

	directory   string
	gamePath    string
	prefs       Preferences
	saved       SettingsData
	loadWarning *LocalizedText
	pathWarning *LocalizedText

	busy       bool
	dirty      bool
	gameHandle windows.Handle
	steamCache steamProfileCache
}

func NewApp() *App {
	dir, err := getLauncherDirectory()
	if err != nil {
		dir, _ = os.Getwd()
	}
	prefs := loadPreferences()
	iniPath := filepath.Join(dir, "Granite.ini")
	saved, loadWarn := loadSettings(iniPath)
	gamePath, pathWarn := resolveGamePath(dir, os.Args[1:])

	return &App{
		directory:   dir,
		gamePath:    gamePath,
		prefs:       prefs,
		saved:       saved,
		loadWarning: loadWarn,
		pathWarning: pathWarn,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.applyNativeWindowTheme(a.prefs.Dark)
	applyNativeWindowIcons()
	go refreshLauncherShellIcon()
}

func (a *App) applyNativeWindowTheme(dark bool) {
	if a.ctx == nil {
		return
	}
	if dark {
		runtime.WindowSetDarkTheme(a.ctx)
		runtime.WindowSetBackgroundColour(a.ctx, 11, 13, 18, 255)
	} else {
		runtime.WindowSetLightTheme(a.ctx)
		runtime.WindowSetBackgroundColour(a.ctx, 245, 243, 238, 255)
	}
}

func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	a.mu.Lock()
	busy := a.busy
	dirty := a.dirty
	locale := a.prefs.Locale
	a.mu.Unlock()

	if busy {
		_, _ = runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
			Type:    runtime.InfoDialog,
			Title:   "Granite",
			Message: L("启动流程仍在进行，请等待完成后关闭启动器。", "The launch is still in progress. Wait until it finishes before closing the launcher.").Get(locale),
		})
		return true
	}

	if dirty {
		choice, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
			Type:          runtime.QuestionDialog,
			Title:         "Granite",
			Message:       L("存在未保存的设置，是否放弃更改并关闭？", "Discard unsaved settings and close the launcher?").Get(locale),
			Buttons:       []string{"Yes", "No"},
			DefaultButton: "No",
			CancelButton:  "No",
		})
		if err == nil && choice != "Yes" {
			return true
		}
	}

	a.closeGameHandle()
	return false
}

func (a *App) closeGameHandle() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.gameHandle != 0 {
		_ = windows.CloseHandle(a.gameHandle)
		a.gameHandle = 0
	}
}

func (a *App) isGameRunningLocked() bool {
	if a.gameHandle == 0 {
		return false
	}
	state, _ := windows.WaitForSingleObject(a.gameHandle, 0)
	if state == uint32(windows.WAIT_TIMEOUT) {
		return true
	}
	_ = windows.CloseHandle(a.gameHandle)
	a.gameHandle = 0
	return false
}

func (a *App) fileStatusLocked() FileStatus {
	gameOk := a.gamePath != "" && strings.EqualFold(filepath.Base(a.gamePath), "NBA2K22.exe") && isRegularFile(a.gamePath)
	return FileStatus{
		LauncherDir: a.directory,
		GamePath:    a.gamePath,
		GameOk:      gameOk,
		InjectorOk:  isRegularFile(filepath.Join(a.directory, "Injector.exe")),
		ModuleOk:    isRegularFile(filepath.Join(a.directory, "Module.dll")),
		IniExists:   isRegularFile(filepath.Join(a.directory, "Granite.ini")),
		GameRunning: a.isGameRunningLocked(),
		Busy:        a.busy,
		Steam:       probeLiveSteamStatus(&a.steamCache),
	}
}

func (a *App) OpenSteam() *LocalizedText {
	steamDir, steamExe := findSteamExecutable()
	if steamExe == "" {
		m := L("未检测到 Steam 客户端", "Steam client not found")
		return &m
	}
	cmd := exec.Command(steamExe)
	if steamDir != "" {
		cmd.Dir = steamDir
	}
	if err := cmd.Start(); err != nil {
		detail := describeWindowsError(err)
		m := L("无法打开 Steam："+detail, "Could not open Steam: "+detail)
		return &m
	}
	if cmd.Process != nil {
		_ = cmd.Process.Release()
	}
	return nil
}

func (a *App) GetInitialState() InitialState {
	a.mu.Lock()
	defer a.mu.Unlock()

	togglesCopy := make([]bool, len(a.saved.Toggles))
	copy(togglesCopy, a.saved.Toggles)

	return InitialState{
		Preferences: a.prefs,
		Settings: SettingsData{
			Host:    a.saved.Host,
			Port:    a.saved.Port,
			Toggles: togglesCopy,
		},
		ToggleDefs:  ModuleToggles,
		Files:       a.fileStatusLocked(),
		LoadWarning: a.loadWarning,
		PathWarning: a.pathWarning,
	}
}

func (a *App) RefreshFileStatus() FileStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.fileStatusLocked()
}

func (a *App) SetDirty(dirty bool) {
	a.mu.Lock()
	a.dirty = dirty
	a.mu.Unlock()
}

func (a *App) UpdatePreferences(dark bool, locale string) *LocalizedText {
	if locale != "en" {
		locale = "zh"
	}
	prefs := Preferences{Dark: dark, Locale: locale}

	a.mu.Lock()
	a.prefs = prefs
	a.mu.Unlock()

	a.applyNativeWindowTheme(dark)
	return savePreferences(prefs)
}

func (a *App) SelectGameExecutable() SelectGameResult {
	a.mu.Lock()
	if a.busy {
		files := a.fileStatusLocked()
		a.mu.Unlock()
		return SelectGameResult{Cancelled: true, Files: files}
	}
	locale := a.prefs.Locale
	defaultDir := ""
	if a.gamePath != "" {
		if dir := filepath.Dir(a.gamePath); isDir(dir) {
			defaultDir = dir
		}
	}
	a.mu.Unlock()

	selected, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            L("选择 NBA2K22.exe", "Select NBA2K22.exe").Get(locale),
		DefaultDirectory: defaultDir,
		Filters: []runtime.FileFilter{
			{
				DisplayName: "NBA 2K22 (NBA2K22.exe)",
				Pattern:     "NBA2K22.exe",
			},
		},
	})
	if err != nil || selected == "" {
		a.mu.Lock()
		files := a.fileStatusLocked()
		a.mu.Unlock()
		return SelectGameResult{Cancelled: true, Files: files}
	}

	cleaned := filepath.Clean(selected)
	if !strings.EqualFold(filepath.Base(cleaned), "NBA2K22.exe") || !isRegularFile(cleaned) {
		a.mu.Lock()
		files := a.fileStatusLocked()
		a.mu.Unlock()
		msg := L("请选择有效的 NBA2K22.exe。", "Select a valid NBA2K22.exe.")
		return SelectGameResult{
			Cancelled: false,
			Ok:        false,
			Files:     files,
			Message:   &msg,
		}
	}

	a.mu.Lock()
	a.gamePath = cleaned
	a.pathWarning = nil
	dir := a.directory
	a.mu.Unlock()

	saveErr := rememberGamePath(dir, cleaned)

	a.mu.Lock()
	files := a.fileStatusLocked()
	a.mu.Unlock()

	if saveErr != nil {
		msg := L(
			"本次可使用该路径，但无法记住："+saveErr.Zh,
			"The path can be used now, but could not be saved: "+saveErr.En,
		)
		return SelectGameResult{
			Ok:       true,
			Saved:    false,
			GamePath: cleaned,
			Files:    files,
			Message:  &msg,
		}
	}

	msg := L("路径已保存", "Path saved")
	return SelectGameResult{
		Ok:       true,
		Saved:    true,
		GamePath: cleaned,
		Files:    files,
		Message:  &msg,
	}
}

func (a *App) SaveConnection(hostInput, portInput string) SaveConnectionResult {
	host := strings.TrimSpace(hostInput)
	port := strings.TrimSpace(portInput)

	var hostErr, portErr *LocalizedText
	if !IsServerIpv4(host) {
		m := L("无效的 IPv4 地址", "Invalid IPv4")
		hostErr = &m
	}
	if !IsServerPort(port) {
		m := L("端口范围 1–65535", "Port 1–65535")
		portErr = &m
	}
	if hostErr != nil || portErr != nil {
		return SaveConnectionResult{
			Ok:        false,
			Host:      host,
			Port:      port,
			HostError: hostErr,
			PortError: portErr,
			Message:   L("地址或端口无效", "Invalid address or port"),
		}
	}

	a.mu.Lock()
	if a.busy {
		iniExists := isRegularFile(filepath.Join(a.directory, "Granite.ini"))
		a.mu.Unlock()
		return SaveConnectionResult{
			Ok:        false,
			Host:      host,
			Port:      port,
			IniExists: iniExists,
			Message:   L("启动中，请稍候", "Launching, please wait"),
		}
	}
	iniPath := filepath.Join(a.directory, "Granite.ini")
	a.mu.Unlock()

	errText := saveIniChanges(iniPath, []IniChange{
		{Section: "Network", Key: "ServerHost", Value: host},
		{Section: "Network", Key: "ServerPort", Value: port},
	})
	if errText != nil {
		return SaveConnectionResult{
			Ok:        false,
			Host:      host,
			Port:      port,
			IniExists: isRegularFile(iniPath),
			Message:   *errText,
		}
	}

	a.mu.Lock()
	a.saved.Host = host
	a.saved.Port = port
	a.loadWarning = nil
	a.mu.Unlock()

	return SaveConnectionResult{
		Ok:        true,
		Host:      host,
		Port:      port,
		IniExists: isRegularFile(iniPath),
		Message:   L("已保存", "Saved"),
	}
}

func (a *App) SaveModuleSettings(toggles []bool) SaveModuleResult {
	a.mu.Lock()
	if a.busy {
		cur := make([]bool, len(a.saved.Toggles))
		copy(cur, a.saved.Toggles)
		iniExists := isRegularFile(filepath.Join(a.directory, "Granite.ini"))
		a.mu.Unlock()
		return SaveModuleResult{
			Ok:        false,
			IniExists: iniExists,
			Toggles:   cur,
			Message:   L("启动中，请稍候", "Launching, please wait"),
		}
	}
	iniPath := filepath.Join(a.directory, "Granite.ini")
	missing := !isRegularFile(iniPath)

	normalized := make([]bool, len(ModuleToggles))
	for i := range ModuleToggles {
		if i < len(toggles) {
			normalized[i] = toggles[i]
		} else {
			normalized[i] = a.saved.Toggles[i]
		}
	}

	var changes []IniChange
	for i, def := range ModuleToggles {
		if missing || a.saved.Toggles[i] != normalized[i] {
			val := "0"
			if normalized[i] {
				val = "1"
			}
			changes = append(changes, IniChange{
				Section: def.Section,
				Key:     def.Key,
				Value:   val,
			})
		}
	}
	a.mu.Unlock()

	if len(changes) == 0 {
		return SaveModuleResult{
			Ok:        true,
			Changed:   0,
			IniExists: !missing,
			Toggles:   normalized,
			Message:   L("无更改", "No changes"),
		}
	}

	if errText := saveIniChanges(iniPath, changes); errText != nil {
		return SaveModuleResult{
			Ok:        false,
			Changed:   0,
			IniExists: isRegularFile(iniPath),
			Toggles:   normalized,
			Message:   *errText,
		}
	}

	a.mu.Lock()
	copy(a.saved.Toggles, normalized)
	if missing {
		a.loadWarning = nil
	}
	a.mu.Unlock()

	return SaveModuleResult{
		Ok:        true,
		Changed:   len(changes),
		IniExists: isRegularFile(iniPath),
		Toggles:   normalized,
		Message:   L("已保存", "Saved"),
	}
}

func (a *App) StartGame() StartLaunchResult {
	a.mu.Lock()
	if a.busy {
		a.mu.Unlock()
		msg := L("启动流程仍在进行中。", "A launch is already in progress.")
		return StartLaunchResult{Started: false, Message: &msg}
	}
	if a.isGameRunningLocked() {
		a.mu.Unlock()
		msg := L("游戏已在运行中。", "The game is already running.")
		return StartLaunchResult{Started: false, Message: &msg}
	}
	files := a.fileStatusLocked()
	if !files.Steam.LoggedIn {
		a.mu.Unlock()
		msg := L("请先登录 Steam 后再启动游戏。", "Sign in to Steam before launching.")
		return StartLaunchResult{Started: false, Files: &files, Message: &msg}
	}
	a.busy = true
	gamePath := a.gamePath
	dir := a.directory
	a.mu.Unlock()

	go a.runLaunchWorker(gamePath, dir)
	return StartLaunchResult{Started: true}
}

func (a *App) runLaunchWorker(gamePath, dir string) {
	stamp := func() string {
		return time.Now().Format("15:04:05")
	}

	sink := func(isStage bool, text LocalizedText) {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "launch:update", LaunchUpdatePayload{
				Stage:     isStage,
				Timestamp: stamp(),
				Text:      text,
			})
		}
	}

	handle, success, message := launchGame(gamePath, dir, sink)

	a.mu.Lock()
	a.busy = false
	if a.gameHandle != 0 {
		_ = windows.CloseHandle(a.gameHandle)
		a.gameHandle = 0
	}
	running := false
	if handle != 0 {
		state, _ := windows.WaitForSingleObject(handle, 0)
		if state == uint32(windows.WAIT_TIMEOUT) {
			a.gameHandle = handle
			running = true
		} else {
			_ = windows.CloseHandle(handle)
		}
	}
	a.mu.Unlock()

	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "launch:complete", LaunchCompletePayload{
			Success:     success,
			Timestamp:   stamp(),
			Message:     message,
			GameRunning: running,
		})
	}

	if running {
		go a.watchGameExit(handle, success)
	}
}

func (a *App) watchGameExit(watched windows.Handle, wasSuccess bool) {
	_, _ = windows.WaitForSingleObject(watched, windows.INFINITE)

	a.mu.Lock()
	if a.gameHandle == watched {
		_ = windows.CloseHandle(a.gameHandle)
		a.gameHandle = 0
	}
	a.mu.Unlock()

	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "game:exited", map[string]any{
			"wasSuccess": wasSuccess,
			"timestamp":  time.Now().Format("15:04:05"),
			"message":    L("游戏已退出", "Game exited"),
		})
	}
}

func isDir(p string) bool {
	if p == "" {
		return false
	}
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}
