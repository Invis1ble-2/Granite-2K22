// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
package main

type LocalizedText struct {
	Zh string `json:"zh"`
	En string `json:"en"`
}

func L(zh, en string) LocalizedText {
	return LocalizedText{Zh: zh, En: en}
}

func LiteralText(s string) LocalizedText {
	return LocalizedText{Zh: s, En: s}
}

func (t LocalizedText) Empty() bool {
	return t.Zh == "" && t.En == ""
}

func (t LocalizedText) Get(locale string) string {
	if locale == "en" {
		return t.En
	}
	return t.Zh
}

type ToggleDef struct {
	Index       int           `json:"index"`
	Category    string        `json:"category"` // "features" | "logging"
	Section     string        `json:"section"`
	Key         string        `json:"key"`
	Label       LocalizedText `json:"label"`
	Description LocalizedText `json:"description"`
	Default     bool          `json:"defaultValue"`
}

// Mirrors Granite/Module/ModuleConfig.h Load() definitions and defaults.
var ModuleToggles = []ToggleDef{
	{0, "features", "Features", "EnableCrashHandler", L("崩溃报告", "Crash Reports"), L("保存崩溃转储", "Save crash dumps"), true},
	{1, "features", "Features", "EnableBadgeBudgets", L("徽章预算", "Badge Budgets"), L("同步生涯徽章预算", "Sync badge budgets"), true},
	{2, "features", "Features", "EnableAnimationShopAll", L("全部商店动画", "All Animations in shop"), L("显示全部动画", "List all animations available"), true},
	{3, "features", "Features", "EnableAnimationRequirementBypass", L("解除动画限制", "Bypass Requirements"), L("忽略身高与属性门槛", "Ignore attribute & height gates"), true},
	{4, "features", "Features", "EnableAnimationUnlockAll", L("获得全动画", "Own All Animations"), L("无需购买直接装备", "Own without buying"), false},
	{5, "logging", "Logging", "EnableFileLogging", L("写入日志文件", "Write Log Files"), L("输出至 console logs", "Write to console logs"), true},
	{6, "logging", "Logging", "EnableConsole", L("控制台窗口", "Console Window"), L("显示独立调试窗口", "Show debug console"), true},
	{7, "logging", "Logging", "LogModule", L("所有模块日志", "Module"), L("控制所有除了Http模块的输出日志", "Control output logs for all modules except Http"), false},
	{8, "logging", "Logging", "LogHttp", L("HTTP日志", "HTTP"), L("记录 HTTP 请求和响应", "Log HTTP requests and responses"), true},
	{9, "logging", "Logging", "LogOnlineFrameRate", L("联机帧率解锁日志", "Online Frame Rate Unlock"), L("记录联机帧率解锁相关信息", "Log online frame rate information"), false},
	{10, "logging", "Logging", "LogSoloPark", L("单人公园日志", "Solo Park"), L("记录单人公园相关活动", "Log solo park activities"), false},
}

const (
	DefaultServerHost = "127.0.0.1"
	DefaultServerPort = "21000"
)

type SettingsData struct {
	Host    string `json:"host"`
	Port    string `json:"port"`
	Toggles []bool `json:"toggles"`
}

func DefaultSettings() SettingsData {
	toggles := make([]bool, len(ModuleToggles))
	for i, def := range ModuleToggles {
		toggles[i] = def.Default
	}
	return SettingsData{
		Host:    DefaultServerHost,
		Port:    DefaultServerPort,
		Toggles: toggles,
	}
}

type Preferences struct {
	Dark   bool   `json:"dark"`
	Locale string `json:"locale"` // "zh" | "en"
}

type SteamStatus struct {
	Installed   bool   `json:"installed"`
	Running     bool   `json:"running"`
	LoggedIn    bool   `json:"loggedIn"`
	AccountID   uint32 `json:"accountId"`
	SteamID64   string `json:"steamId64"`
	PersonaName string `json:"personaName"`
	AccountName string `json:"accountName"`
	AvatarURL   string `json:"avatarUrl"`
}

type FileStatus struct {
	LauncherDir string      `json:"launcherDir"`
	GamePath    string      `json:"gamePath"`
	GameOk      bool        `json:"gameOk"`
	ModuleOk    bool        `json:"moduleOk"`
	IniExists   bool        `json:"iniExists"`
	GameRunning bool        `json:"gameRunning"`
	Busy        bool        `json:"busy"`
	Steam       SteamStatus `json:"steam"`
}

type InitialState struct {
	Preferences Preferences    `json:"preferences"`
	Settings    SettingsData   `json:"settings"`
	ToggleDefs  []ToggleDef    `json:"toggleDefs"`
	Files       FileStatus     `json:"files"`
	LoadWarning *LocalizedText `json:"loadWarning,omitempty"`
	PathWarning *LocalizedText `json:"pathWarning,omitempty"`
}

type SaveConnectionResult struct {
	Ok        bool           `json:"ok"`
	Host      string         `json:"host"`
	Port      string         `json:"port"`
	IniExists bool           `json:"iniExists"`
	HostError *LocalizedText `json:"hostError,omitempty"`
	PortError *LocalizedText `json:"portError,omitempty"`
	Message   LocalizedText  `json:"message"`
}

type SaveModuleResult struct {
	Ok        bool          `json:"ok"`
	Changed   int           `json:"changed"`
	IniExists bool          `json:"iniExists"`
	Toggles   []bool        `json:"toggles"`
	Message   LocalizedText `json:"message"`
}

type SelectGameResult struct {
	Cancelled bool           `json:"cancelled"`
	Ok        bool           `json:"ok"`
	Saved     bool           `json:"saved"`
	GamePath  string         `json:"gamePath"`
	Files     FileStatus     `json:"files"`
	Message   *LocalizedText `json:"message,omitempty"`
}

type StartLaunchResult struct {
	Started bool           `json:"started"`
	Files   *FileStatus    `json:"files,omitempty"`
	Message *LocalizedText `json:"message,omitempty"`
}

type LaunchUpdatePayload struct {
	Stage     bool          `json:"stage"`
	Timestamp string        `json:"timestamp"`
	Text      LocalizedText `json:"text"`
}

type LaunchCompletePayload struct {
	Success     bool          `json:"success"`
	Timestamp   string        `json:"timestamp"`
	Message     LocalizedText `json:"message"`
	GameRunning bool          `json:"gameRunning"`
}
