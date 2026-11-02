// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	steamID64Base            uint64 = 76561197960265728
	defaultGoldbergAccountID uint32 = 22202
	nba2k22SteamAppID        string = "1644960"
	steamRelaunchExitCode           = 53
	win32StillActive                = 259
	maxRelaunchHops                 = 3
)

type launchSink func(isStage bool, text LocalizedText)

type steamIdentity struct {
	AccountID uint32
	UserName  string
	FromLive  bool
	FromSteam bool
}

func sanitizePersonaName(raw string) string {
	if raw == "" {
		return ""
	}
	valid := strings.ToValidUTF8(raw, "")
	var b strings.Builder
	b.Grow(len(valid))
	for _, r := range valid {
		if r == '\r' || r == '\n' || r == 0 {
			continue
		}
		if r < 0x20 {
			b.WriteByte(' ')
			continue
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

func nextVDFToken(s string, pos int) (tok string, quoted bool, next int, ok bool) {
	if pos == 0 && strings.HasPrefix(s, "\xEF\xBB\xBF") {
		pos = 3
	}
	n := len(s)
	for pos < n {
		c := s[pos]
		if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
			pos++
			continue
		}
		if c == '/' && pos+1 < n && s[pos+1] == '/' {
			pos += 2
			for pos < n && s[pos] != '\n' {
				pos++
			}
			continue
		}
		break
	}
	if pos >= n {
		return "", false, n, false
	}
	if s[pos] == '{' || s[pos] == '}' {
		return s[pos : pos+1], false, pos + 1, true
	}
	if s[pos] == '"' {
		pos++
		var b strings.Builder
		for pos < n {
			c := s[pos]
			if c == '\\' && pos+1 < n {
				esc := s[pos+1]
				switch esc {
				case '"', '\\', '/':
					b.WriteByte(esc)
				case 'n':
					b.WriteByte('\n')
				case 'r':
					b.WriteByte('\r')
				case 't':
					b.WriteByte('\t')
				default:
					b.WriteByte('\\')
					b.WriteByte(esc)
				}
				pos += 2
				continue
			}
			if c == '"' {
				return b.String(), true, pos + 1, true
			}
			b.WriteByte(c)
			pos++
		}
		return b.String(), true, n, true
	}
	start := pos
	for pos < n {
		c := s[pos]
		if c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '{' || c == '}' || c == '"' {
			break
		}
		pos++
	}
	return s[start:pos], false, pos, true
}

func parseLoginUsersVDF(vdfPath string, targetAccountID uint32) (uint32, string) {
	raw, err := os.ReadFile(vdfPath)
	if err != nil || len(raw) == 0 {
		return 0, ""
	}
	content := string(raw)
	pos := 0
	depth := 0

	var firstAcct, recentAcct uint32
	var firstName, recentName string

	var curAcct uint32
	var curPersona, curAccountName string
	var curMostRecent bool
	var pendingKey string
	var hasPendingKey bool

	for {
		tok, quoted, nextPos, ok := nextVDFToken(content, pos)
		if !ok {
			break
		}
		pos = nextPos

		if !quoted && tok == "{" {
			depth++
			if depth == 2 && hasPendingKey {
				curAcct = 0
				curPersona = ""
				curAccountName = ""
				curMostRecent = false
				if val, parseErr := strconv.ParseUint(pendingKey, 10, 64); parseErr == nil && val >= steamID64Base && (val-steamID64Base) <= math.MaxUint32 {
					curAcct = uint32(val - steamID64Base)
				}
			}
			hasPendingKey = false
			continue
		}
		if !quoted && tok == "}" {
			if depth == 2 && curAcct != 0 {
				chosenName := curPersona
				if chosenName == "" {
					chosenName = curAccountName
				}
				if targetAccountID != 0 && curAcct == targetAccountID {
					return curAcct, chosenName
				}
				if firstAcct == 0 {
					firstAcct = curAcct
					firstName = chosenName
				}
				if curMostRecent && recentAcct == 0 {
					recentAcct = curAcct
					recentName = chosenName
				}
				curAcct = 0
			}
			if depth > 0 {
				depth--
			}
			hasPendingKey = false
			continue
		}

		if depth == 1 {
			pendingKey = tok
			hasPendingKey = true
		} else if depth == 2 {
			if !hasPendingKey {
				pendingKey = tok
				hasPendingKey = true
			} else {
				if strings.EqualFold(pendingKey, "PersonaName") {
					curPersona = sanitizePersonaName(tok)
				} else if strings.EqualFold(pendingKey, "AccountName") {
					curAccountName = sanitizePersonaName(tok)
				} else if strings.EqualFold(pendingKey, "MostRecent") && tok == "1" {
					curMostRecent = true
				}
				hasPendingKey = false
			}
		} else {
			hasPendingKey = false
		}
	}

	if targetAccountID != 0 {
		return 0, ""
	}
	if recentAcct != 0 {
		return recentAcct, recentName
	}
	return firstAcct, firstName
}

func personaFromLocalConfigVDF(vdfPath string) string {
	raw, err := os.ReadFile(vdfPath)
	if err != nil || len(raw) == 0 {
		return ""
	}
	content := string(raw)
	pos := 0
	depth := 0
	friendsDepth := -1

	var pendingKey string
	var hasPendingKey bool
	var fallbackPersona string

	for {
		tok, quoted, nextPos, ok := nextVDFToken(content, pos)
		if !ok {
			break
		}
		pos = nextPos

		if !quoted && tok == "{" {
			depth++
			if hasPendingKey && friendsDepth < 0 && strings.EqualFold(pendingKey, "friends") {
				friendsDepth = depth
			}
			hasPendingKey = false
			continue
		}
		if !quoted && tok == "}" {
			if friendsDepth >= 0 && depth == friendsDepth {
				friendsDepth = -1
			}
			if depth > 0 {
				depth--
			}
			hasPendingKey = false
			continue
		}

		if !hasPendingKey {
			pendingKey = tok
			hasPendingKey = true
		} else {
			if strings.EqualFold(pendingKey, "PersonaName") {
				if clean := sanitizePersonaName(tok); clean != "" {
					if friendsDepth > 0 && depth == friendsDepth {
						return clean
					}
					if fallbackPersona == "" {
						fallbackPersona = clean
					}
				}
			}
			hasPendingKey = false
		}
	}
	return fallbackPersona
}

func readRegistrySteamPath() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Valve\Steam`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	steamPath, _, err := k.GetStringValue("SteamPath")
	if err != nil || steamPath == "" {
		return ""
	}
	return filepath.Clean(strings.ReplaceAll(steamPath, "/", `\`))
}

func readRegistryLastGameNameUsed() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Valve\Steam`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	name, _, err := k.GetStringValue("LastGameNameUsed")
	if err != nil {
		return ""
	}
	return sanitizePersonaName(name)
}

func resolveSteamPersonaForAccount(steamDir string, acct uint32) string {
	if steamDir != "" && acct != 0 {
		acctStr := strconv.FormatUint(uint64(acct), 10)
		localCfg := filepath.Join(steamDir, "userdata", acctStr, "config", "localconfig.vdf")
		if name := personaFromLocalConfigVDF(localCfg); name != "" {
			return name
		}
		loginUsers := filepath.Join(steamDir, "config", "loginusers.vdf")
		if _, name := parseLoginUsersVDF(loginUsers, acct); name != "" {
			return name
		}
	}
	return readRegistryLastGameNameUsed()
}

type steamProfileCache struct {
	accountID     uint32
	steamDir      string
	localCfgMtime int64
	loginVdfMtime int64
	avatarMtime   int64
	avatarPath    string
	personaName   string
	accountName   string
	avatarDataURL string
}

func findSteamExecutable() (steamDir string, steamExe string) {
	tryDir := func(raw string) (string, string, bool) {
		if raw == "" {
			return "", "", false
		}
		clean := filepath.Clean(strings.ReplaceAll(raw, "/", `\`))
		exe := filepath.Join(clean, "steam.exe")
		if isRegularFile(exe) {
			return clean, exe, true
		}
		return "", "", false
	}

	if k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Valve\Steam`, registry.QUERY_VALUE); err == nil {
		regExe, _, exeErr := k.GetStringValue("SteamExe")
		regDir, _, dirErr := k.GetStringValue("SteamPath")
		_ = k.Close()
		if exeErr == nil && regExe != "" {
			cleanExe := filepath.Clean(strings.ReplaceAll(regExe, "/", `\`))
			if isRegularFile(cleanExe) {
				return filepath.Dir(cleanExe), cleanExe
			}
		}
		if dirErr == nil {
			if d, e, ok := tryDir(regDir); ok {
				return d, e
			}
		}
	}

	for _, sub := range []string{`SOFTWARE\WOW6432Node\Valve\Steam`, `SOFTWARE\Valve\Steam`} {
		if k, err := registry.OpenKey(registry.LOCAL_MACHINE, sub, registry.QUERY_VALUE); err == nil {
			instDir, _, dirErr := k.GetStringValue("InstallPath")
			_ = k.Close()
			if dirErr == nil {
				if d, e, ok := tryDir(instDir); ok {
					return d, e
				}
			}
		}
	}

	if _, liveDir := inspectRunningSteamProcess(0); liveDir != "" {
		if d, e, ok := tryDir(liveDir); ok {
			return d, e
		}
		return liveDir, ""
	}
	if regDir := readRegistrySteamPath(); regDir != "" && isDir(regDir) {
		return regDir, ""
	}
	return "", ""
}

func lookupLoginUserAccount(vdfPath string, targetAccountID uint32) (personaName string, accountName string) {
	if targetAccountID == 0 {
		return "", ""
	}
	raw, err := os.ReadFile(vdfPath)
	if err != nil || len(raw) == 0 {
		return "", ""
	}
	content := string(raw)
	pos := 0
	depth := 0

	var curAcct uint32
	var curPersona, curAccount string
	var pendingKey string
	var hasPendingKey bool

	for {
		tok, quoted, nextPos, ok := nextVDFToken(content, pos)
		if !ok {
			break
		}
		pos = nextPos

		if !quoted && tok == "{" {
			depth++
			if depth == 2 && hasPendingKey {
				curAcct = 0
				curPersona = ""
				curAccount = ""
				if val, parseErr := strconv.ParseUint(pendingKey, 10, 64); parseErr == nil && val >= steamID64Base && (val-steamID64Base) <= math.MaxUint32 {
					curAcct = uint32(val - steamID64Base)
				}
			}
			hasPendingKey = false
			continue
		}
		if !quoted && tok == "}" {
			if depth == 2 && curAcct == targetAccountID {
				return curPersona, curAccount
			}
			if depth > 0 {
				depth--
			}
			hasPendingKey = false
			continue
		}

		if depth == 1 {
			pendingKey = tok
			hasPendingKey = true
		} else if depth == 2 {
			if !hasPendingKey {
				pendingKey = tok
				hasPendingKey = true
			} else {
				if strings.EqualFold(pendingKey, "PersonaName") {
					curPersona = sanitizePersonaName(tok)
				} else if strings.EqualFold(pendingKey, "AccountName") {
					curAccount = sanitizePersonaName(tok)
				}
				hasPendingKey = false
			}
		} else {
			hasPendingKey = false
		}
	}
	return "", ""
}

func fileModUnixNano(p string) int64 {
	if p == "" {
		return 0
	}
	info, err := os.Stat(p)
	if err != nil || !info.Mode().IsRegular() {
		return 0
	}
	return info.ModTime().UnixNano()
}

func findCachedSteamAvatarPath(steamDir, steamID64 string) (string, int64) {
	if steamDir == "" || steamID64 == "" {
		return "", 0
	}
	avatarDir := filepath.Join(steamDir, "config", "avatarcache")
	for _, ext := range []string{".png", ".jpg", ".jpeg", ".webp"} {
		candidate := filepath.Join(avatarDir, steamID64+ext)
		info, err := os.Stat(candidate)
		if err == nil && info.Mode().IsRegular() && info.Size() > 16 && info.Size() <= 2*1024*1024 {
			return candidate, info.ModTime().UnixNano()
		}
	}
	return "", 0
}

func readSteamAvatarDataURL(p string) string {
	if p == "" {
		return ""
	}
	raw, err := os.ReadFile(p)
	if err != nil || len(raw) <= 16 || len(raw) > 2*1024*1024 {
		return ""
	}
	mime := ""
	switch {
	case bytes.HasPrefix(raw, []byte("\x89PNG\r\n\x1a\n")):
		mime = "image/png"
	case bytes.HasPrefix(raw, []byte("\xff\xd8\xff")):
		mime = "image/jpeg"
	case len(raw) >= 12 && bytes.Equal(raw[:4], []byte("RIFF")) && bytes.Equal(raw[8:12], []byte("WEBP")):
		mime = "image/webp"
	default:
		return ""
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(raw)
}

func probeLiveSteamStatus(cache *steamProfileCache) SteamStatus {
	var status SteamStatus
	var steamDir string

	if k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Valve\Steam\ActiveProcess`, registry.QUERY_VALUE); err == nil {
		activeUser, _, userErr := k.GetIntegerValue("ActiveUser")
		activePID, _, pidErr := k.GetIntegerValue("pid")
		_ = k.Close()

		if pidErr == nil && activePID > 0 && activePID <= math.MaxUint32 {
			if alive, liveDir := inspectRunningSteamProcess(uint32(activePID)); alive {
				status.Running = true
				status.Installed = true
				steamDir = liveDir
				if userErr == nil && activeUser > 0 && activeUser <= math.MaxUint32 {
					status.LoggedIn = true
					status.AccountID = uint32(activeUser)
					status.SteamID64 = strconv.FormatUint(steamID64Base+uint64(status.AccountID), 10)
				}
			}
		}
	}

	if !status.Running {
		if anyAlive, liveDir := inspectRunningSteamProcess(0); anyAlive {
			status.Running = true
			status.Installed = true
			steamDir = liveDir
		}
	}

	if steamDir == "" {
		dir, exe := findSteamExecutable()
		steamDir = dir
		if exe != "" || dir != "" {
			status.Installed = true
		}
	}

	if !status.LoggedIn {
		return status
	}

	acctStr := strconv.FormatUint(uint64(status.AccountID), 10)
	var localCfgPath, loginVdfPath string
	if steamDir != "" {
		localCfgPath = filepath.Join(steamDir, "userdata", acctStr, "config", "localconfig.vdf")
		loginVdfPath = filepath.Join(steamDir, "config", "loginusers.vdf")
	}
	localCfgMtime := fileModUnixNano(localCfgPath)
	loginVdfMtime := fileModUnixNano(loginVdfPath)
	avatarPath, avatarMtime := findCachedSteamAvatarPath(steamDir, status.SteamID64)

	if cache != nil &&
		cache.accountID == status.AccountID &&
		cache.steamDir == steamDir &&
		cache.localCfgMtime == localCfgMtime &&
		cache.loginVdfMtime == loginVdfMtime &&
		cache.avatarMtime == avatarMtime &&
		cache.avatarPath == avatarPath {
		status.PersonaName = cache.personaName
		status.AccountName = cache.accountName
		status.AvatarURL = cache.avatarDataURL
		return status
	}

	vdfPersona, vdfAccount := lookupLoginUserAccount(loginVdfPath, status.AccountID)
	persona := ""
	if localCfgMtime != 0 {
		persona = personaFromLocalConfigVDF(localCfgPath)
	}
	if persona == "" {
		persona = vdfPersona
	}
	if persona == "" {
		persona = readRegistryLastGameNameUsed()
	}
	if persona == "" {
		persona = vdfAccount
	}

	avatarURL := readSteamAvatarDataURL(avatarPath)

	status.PersonaName = persona
	status.AccountName = vdfAccount
	status.AvatarURL = avatarURL

	if cache != nil {
		*cache = steamProfileCache{
			accountID:     status.AccountID,
			steamDir:      steamDir,
			localCfgMtime: localCfgMtime,
			loginVdfMtime: loginVdfMtime,
			avatarMtime:   avatarMtime,
			avatarPath:    avatarPath,
			personaName:   persona,
			accountName:   vdfAccount,
			avatarDataURL: avatarURL,
		}
	}
	return status
}

func resolveSteamIdentity(existingAccount uint32, existingName string) steamIdentity {
	// 1. Prefer live running steam.exe process (ActiveProcess.pid + ActiveUser)
	if k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Valve\Steam\ActiveProcess`, registry.QUERY_VALUE); err == nil {
		activeUser, _, userErr := k.GetIntegerValue("ActiveUser")
		activePID, _, pidErr := k.GetIntegerValue("pid")
		_ = k.Close()

		var pidToCheck uint32
		if pidErr == nil && activePID > 0 && activePID <= math.MaxUint32 {
			pidToCheck = uint32(activePID)
		}
		if userErr == nil && activeUser > 0 && activeUser <= math.MaxUint32 {
			if alive, liveDir := inspectRunningSteamProcess(pidToCheck); alive {
				acct := uint32(activeUser)
				steamDir := liveDir
				if steamDir == "" {
					steamDir = readRegistrySteamPath()
				}
				name := resolveSteamPersonaForAccount(steamDir, acct)
				return steamIdentity{
					AccountID: acct,
					UserName:  name,
					FromLive:  true,
					FromSteam: true,
				}
			}
		}
	}

	// 2. Fallback to Steam's loginusers.vdf / localconfig.vdf when Steam client is closed
	steamDir := readRegistrySteamPath()
	if steamDir == "" {
		if _, liveDir := inspectRunningSteamProcess(0); liveDir != "" {
			steamDir = liveDir
		}
	}
	if steamDir != "" {
		acct, name := parseLoginUsersVDF(filepath.Join(steamDir, "config", "loginusers.vdf"), 0)
		if acct != 0 {
			if name == "" {
				name = resolveSteamPersonaForAccount(steamDir, acct)
			}
			return steamIdentity{
				AccountID: acct,
				UserName:  name,
				FromLive:  false,
				FromSteam: true,
			}
		}
	}

	// 3. Preserve existing non-default AccountId in Goldberg settings
	if existingAccount != 0 {
		return steamIdentity{
			AccountID: existingAccount,
			UserName:  existingName,
		}
	}

	// 4. Deterministic MachineGuid fallback
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Cryptography`, registry.QUERY_VALUE|registry.WOW64_64KEY); err == nil {
		guid, _, err := k.GetStringValue("MachineGuid")
		_ = k.Close()
		if err == nil && guid != "" {
			var hash uint32 = 2166136261
			for _, ch := range utf16.Encode([]rune(guid)) {
				hash ^= uint32(byte(ch & 0x7F))
				hash *= 16777619
			}
			if hash == 0 || hash == defaultGoldbergAccountID {
				hash += 7
			}
			return steamIdentity{
				AccountID: hash,
				UserName:  existingName,
			}
		}
	}

	return steamIdentity{}
}

type goldbergTarget struct {
	Found        bool
	SettingsDir  string
	UseModernIni bool
	UseLegacyTxt bool
}

func detectGoldbergTarget(gameDir string) goldbergTarget {
	candidates := []string{
		filepath.Join(gameDir, "data", "steam"),
		gameDir,
	}
	for _, dllDir := range candidates {
		dllPath := filepath.Join(dllDir, "steam_api64.dll")
		settingsDir := filepath.Join(dllDir, "steam_settings")
		dirExists := isDir(settingsDir)

		var hasSteamSettings, hasModernIni, hasLegacyTxt bool
		if info, err := os.Stat(dllPath); err == nil && info.Mode().IsRegular() && info.Size() <= 64*1024*1024 {
			if raw, readErr := os.ReadFile(dllPath); readErr == nil {
				hasSteamSettings = bytes.Contains(raw, []byte("steam_settings"))
				hasModernIni = bytes.Contains(raw, []byte("configs.user.ini"))
				hasLegacyTxt = bytes.Contains(raw, []byte("force_steamid.txt"))
			}
		}

		if !dirExists && !hasSteamSettings && !hasModernIni && !hasLegacyTxt {
			continue
		}

		modernExists := isRegularFile(filepath.Join(settingsDir, "configs.user.ini"))
		legacyExists := isRegularFile(filepath.Join(settingsDir, "force_steamid.txt")) ||
			isRegularFile(filepath.Join(settingsDir, "force_account_name.txt"))

		useModern := hasModernIni || modernExists || (!hasLegacyTxt && !legacyExists)
		useLegacy := (hasLegacyTxt && !hasModernIni) || legacyExists

		return goldbergTarget{
			Found:        true,
			SettingsDir:  settingsDir,
			UseModernIni: useModern,
			UseLegacyTxt: useLegacy,
		}
	}
	return goldbergTarget{}
}

func parseIniSettingLine(line, keyName string) (matched bool, commented bool, val string) {
	trimmed := strings.TrimSuffix(line, "\r")
	trimmed = strings.TrimLeft(trimmed, " \t")
	if trimmed == "" {
		return false, false, ""
	}
	if trimmed[0] == '#' || trimmed[0] == ';' {
		commented = true
		trimmed = strings.TrimLeft(trimmed[1:], " \t")
	}
	if len(trimmed) < len(keyName) || !strings.EqualFold(trimmed[:len(keyName)], keyName) {
		return false, false, ""
	}
	rest := strings.TrimLeft(trimmed[len(keyName):], " \t")
	if rest == "" || rest[0] != '=' {
		return false, false, ""
	}
	val = strings.TrimSpace(rest[1:])
	return true, commented, val
}

func findSectionSettingLine(lines []string, sectionName, keyName string) (sectionIdx int, activeIdx int, commentIdx int, activeVal string) {
	sectionIdx = -1
	activeIdx = -1
	commentIdx = -1

	inTargetSection := false
	for i, line := range lines {
		t := strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if i == 0 {
			t = strings.TrimPrefix(t, "\xEF\xBB\xBF")
		}
		if strings.HasPrefix(t, "[") && strings.Contains(t, "]") {
			end := strings.IndexByte(t, ']')
			sec := strings.TrimSpace(t[1:end])
			inTargetSection = strings.EqualFold(sec, sectionName)
			if inTargetSection && sectionIdx < 0 {
				sectionIdx = i
			}
			continue
		}
		if !inTargetSection {
			continue
		}

		ok, commented, value := parseIniSettingLine(t, keyName)
		if !ok {
			continue
		}
		if !commented && activeIdx < 0 {
			activeIdx = i
			activeVal = value
		} else if commented && commentIdx < 0 {
			commentIdx = i
		}
	}
	return sectionIdx, activeIdx, commentIdx, activeVal
}

func upsertSectionSettingLine(lines []string, sectionName, keyName, formattedLine, cr string) []string {
	sectionIdx, activeIdx, commentIdx, _ := findSectionSettingLine(lines, sectionName, keyName)
	if activeIdx >= 0 {
		if activeIdx == 0 && strings.HasPrefix(lines[0], "\xEF\xBB\xBF") {
			lines[0] = "\xEF\xBB\xBF" + formattedLine
		} else {
			lines[activeIdx] = formattedLine
		}
		return lines
	}
	if commentIdx >= 0 {
		if commentIdx == 0 && strings.HasPrefix(lines[0], "\xEF\xBB\xBF") {
			lines[0] = "\xEF\xBB\xBF" + formattedLine
		} else {
			lines[commentIdx] = formattedLine
		}
		return lines
	}
	if sectionIdx >= 0 {
		insertIdx := sectionIdx + 1
		out := make([]string, 0, len(lines)+1)
		out = append(out, lines[:insertIdx]...)
		out = append(out, formattedLine)
		out = append(out, lines[insertIdx:]...)
		return out
	}

	header := "[" + sectionName + "]" + cr
	if len(lines) > 0 && strings.TrimSpace(strings.TrimSuffix(lines[len(lines)-1], "\r")) != "" {
		lines = append(lines, cr)
	}
	lines = append(lines, header, formattedLine)
	return lines
}

func parseSteamIDToAccountID(s string) uint32 {
	s = strings.TrimSpace(s)
	end := 0
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0
	}
	val, err := strconv.ParseUint(s[:end], 10, 64)
	if err != nil || val == 0 {
		return 0
	}
	if val >= steamID64Base && (val-steamID64Base) <= math.MaxUint32 {
		return uint32(val - steamID64Base)
	}
	if val <= math.MaxUint32 {
		return uint32(val)
	}
	return 0
}

func isDefaultGoldbergName(name string) bool {
	n := strings.TrimSpace(name)
	return strings.EqualFold(n, "Goldberg") || strings.EqualFold(n, "gbe_fork")
}

func readTrimmedFirstLine(p string) string {
	raw, err := os.ReadFile(p)
	if err != nil || len(raw) == 0 {
		return ""
	}
	s := strings.TrimPrefix(string(raw), "\xEF\xBB\xBF")
	if idx := strings.IndexAny(s, "\r\n"); idx >= 0 {
		s = s[:idx]
	}
	return strings.TrimSpace(s)
}

func readExistingGoldbergIdentity(settingsDir string) (uint32, string) {
	var acct uint32
	var name string

	cfgPath := filepath.Join(settingsDir, "configs.user.ini")
	if raw, err := os.ReadFile(cfgPath); err == nil {
		lines := strings.Split(string(raw), "\n")
		if _, activeIdx, _, val := findSectionSettingLine(lines, "user::general", "account_steamid"); activeIdx >= 0 {
			acct = parseSteamIDToAccountID(val)
		}
		if _, activeIdx, _, val := findSectionSettingLine(lines, "user::general", "account_name"); activeIdx >= 0 {
			name = sanitizePersonaName(val)
		}
	}

	if acct == 0 {
		acct = parseSteamIDToAccountID(readTrimmedFirstLine(filepath.Join(settingsDir, "force_steamid.txt")))
	}
	if name == "" {
		name = sanitizePersonaName(readTrimmedFirstLine(filepath.Join(settingsDir, "force_account_name.txt")))
	}
	return acct, name
}

func defaultSteamLanguage() string {
	if isSystemUIChinese() {
		return "schinese"
	}
	return "english"
}

func patchSteamIdentity(gameDir string, sink launchSink) {
	target := detectGoldbergTarget(gameDir)
	if !target.Found {
		sink(false, L(
			"[身份] 检测到原版 Steam 接口，直接使用当前 Steam 登录身份。",
			"[Identity] Genuine Steam API detected; using active Steam login directly.",
		))
		return
	}

	existingAcct, existingName := readExistingGoldbergIdentity(target.SettingsDir)
	fallbackAcct := existingAcct
	if fallbackAcct == defaultGoldbergAccountID {
		fallbackAcct = 0
	}
	fallbackName := existingName
	if isDefaultGoldbergName(fallbackName) {
		fallbackName = ""
	}

	ident := resolveSteamIdentity(fallbackAcct, fallbackName)
	if ident.AccountID == 0 {
		sink(false, L(
			"[身份] 无法获取 Steam 或稳定本机 ID，保留现有 Goldberg 配置。",
			"[Identity] No Steam or stable local ID is available; keeping existing Goldberg settings.",
		))
		return
	}

	targetName := sanitizePersonaName(ident.UserName)
	if targetName == "" {
		targetName = sanitizePersonaName(fallbackName)
	}
	if targetName == "" {
		targetName = "Player"
	}

	steamID64 := steamID64Base + uint64(ident.AccountID)
	steamID64Text := strconv.FormatUint(steamID64, 10)

	if err := os.MkdirAll(target.SettingsDir, 0755); err != nil {
		sink(false, L(
			"[身份] 无法创建 Goldberg steam_settings 目录，请检查目录权限。",
			"[Identity] Could not create Goldberg steam_settings folder; check folder permissions.",
		))
		return
	}

	wroteAny := false
	appIDPath := filepath.Join(target.SettingsDir, "steam_appid.txt")
	appIDExists := isRegularFile(appIDPath)
	if !appIDExists || readTrimmedFirstLine(appIDPath) == "" {
		if err := atomicReplaceFile(appIDPath, []byte(nba2k22SteamAppID+"\r\n"), appIDExists); err != nil {
			sink(false, L(
				"[身份] 写入 steam_appid.txt 失败，继续启动；请检查目录权限。",
				"[Identity] Could not write steam_appid.txt; continuing. Check folder permissions.",
			))
			return
		}
		wroteAny = true
	}

	if target.UseModernIni {
		cfgPath := filepath.Join(target.SettingsDir, "configs.user.ini")
		if raw, err := os.ReadFile(cfgPath); err == nil {
			content := string(raw)
			lines := strings.Split(content, "\n")
			_, activeNameIdx, _, curName := findSectionSettingLine(lines, "user::general", "account_name")
			_, activeIDIdx, _, curID := findSectionSettingLine(lines, "user::general", "account_steamid")

			idNeedsWrite := activeIDIdx < 0 || strings.TrimSpace(curID) != steamID64Text
			nameNeedsWrite := false
			if ident.FromSteam && sanitizePersonaName(ident.UserName) != "" {
				nameNeedsWrite = activeNameIdx < 0 || sanitizePersonaName(curName) != targetName
			} else if activeNameIdx < 0 || sanitizePersonaName(curName) == "" || isDefaultGoldbergName(curName) {
				nameNeedsWrite = true
			}

			if idNeedsWrite || nameNeedsWrite {
				cr := "\r"
				if !strings.Contains(content, "\r\n") && strings.Contains(content, "\n") {
					cr = ""
				}
				if nameNeedsWrite {
					lines = upsertSectionSettingLine(lines, "user::general", "account_name", "account_name="+targetName+cr, cr)
				}
				if idNeedsWrite {
					lines = upsertSectionSettingLine(lines, "user::general", "account_steamid", "account_steamid="+steamID64Text+cr, cr)
				}
				updated := strings.Join(lines, "\n")
				if err := atomicReplaceFile(cfgPath, []byte(updated), true); err != nil {
					sink(false, L(
						"[身份] Goldberg configs.user.ini 写入失败，继续启动；请检查目录权限。",
						"[Identity] Could not write Goldberg configs.user.ini; continuing. Check folder permissions.",
					))
					return
				}
				wroteAny = true
			}
		} else {
			initial := fmt.Sprintf(
				"[user::general]\r\naccount_name=%s\r\naccount_steamid=%s\r\nlanguage=%s\r\n",
				targetName,
				steamID64Text,
				defaultSteamLanguage(),
			)
			if err := atomicReplaceFile(cfgPath, []byte(initial), false); err != nil {
				sink(false, L(
					"[身份] Goldberg configs.user.ini 创建失败，继续启动；请检查目录权限。",
					"[Identity] Could not create Goldberg configs.user.ini; continuing. Check folder permissions.",
				))
				return
			}
			wroteAny = true
		}
	}

	if target.UseLegacyTxt {
		idPath := filepath.Join(target.SettingsDir, "force_steamid.txt")
		idExists := isRegularFile(idPath)
		if !idExists || readTrimmedFirstLine(idPath) != steamID64Text {
			if err := atomicReplaceFile(idPath, []byte(steamID64Text+"\r\n"), idExists); err != nil {
				sink(false, L(
					"[身份] Goldberg force_steamid.txt 写入失败，继续启动；请检查目录权限。",
					"[Identity] Could not write Goldberg force_steamid.txt; continuing. Check folder permissions.",
				))
				return
			}
			wroteAny = true
		}

		namePath := filepath.Join(target.SettingsDir, "force_account_name.txt")
		nameExists := isRegularFile(namePath)
		curTxtName := sanitizePersonaName(readTrimmedFirstLine(namePath))
		txtNameNeedsWrite := false
		if ident.FromSteam && sanitizePersonaName(ident.UserName) != "" {
			txtNameNeedsWrite = !nameExists || curTxtName != targetName
		} else if !nameExists || curTxtName == "" || isDefaultGoldbergName(curTxtName) {
			txtNameNeedsWrite = true
		}
		if txtNameNeedsWrite {
			if err := atomicReplaceFile(namePath, []byte(targetName+"\r\n"), nameExists); err != nil {
				sink(false, L(
					"[身份] Goldberg force_account_name.txt 写入失败，继续启动；请检查目录权限。",
					"[Identity] Could not write Goldberg force_account_name.txt; continuing. Check folder permissions.",
				))
				return
			}
			wroteAny = true
		}

		langPath := filepath.Join(target.SettingsDir, "language.txt")
		if !isRegularFile(langPath) {
			_ = atomicReplaceFile(langPath, []byte(defaultSteamLanguage()+"\r\n"), false)
		}
	}

	if !wroteAny {
		if ident.FromLive {
			sink(false, L(
				fmt.Sprintf("[身份] Goldberg 已匹配运行中 Steam 账号：%s（SteamID64=%s）", targetName, steamID64Text),
				fmt.Sprintf("[Identity] Goldberg matched active Steam account: %s (SteamID64=%s)", targetName, steamID64Text),
			))
		} else {
			sink(false, L(
				fmt.Sprintf("[身份] Goldberg 当前玩家身份：%s（SteamID64=%s）", targetName, steamID64Text),
				fmt.Sprintf("[Identity] Current Goldberg identity: %s (SteamID64=%s)", targetName, steamID64Text),
			))
		}
		return
	}

	if ident.FromLive {
		sink(false, L(
			fmt.Sprintf("[身份] 已从运行中的 Steam 同步 Goldberg 身份：%s（SteamID64=%s）", targetName, steamID64Text),
			fmt.Sprintf("[Identity] Synced Goldberg identity from running Steam: %s (SteamID64=%s)", targetName, steamID64Text),
		))
	} else if ident.FromSteam {
		sink(false, L(
			fmt.Sprintf("[身份] 已从本机 Steam 配置同步 Goldberg 身份：%s（SteamID64=%s）", targetName, steamID64Text),
			fmt.Sprintf("[Identity] Synced Goldberg identity from local Steam profile: %s (SteamID64=%s)", targetName, steamID64Text),
		))
	} else {
		sink(false, L(
			fmt.Sprintf("[身份] Goldberg 玩家身份已更新：%s（SteamID64=%s）", targetName, steamID64Text),
			fmt.Sprintf("[Identity] Goldberg player identity updated: %s (SteamID64=%s)", targetName, steamID64Text),
		))
	}
}

func waitForLoader(proc windows.Handle, pid uint32) (targetExited bool, exitCode uint32, errMsg *LocalizedText) {
	deadline := time.Now().Add(30 * time.Second)
	var lastProbeErr error

	for time.Now().Before(deadline) {
		state, waitErr := windows.WaitForSingleObject(proc, 0)
		if state != uint32(windows.WAIT_TIMEOUT) {
			var code uint32
			_ = windows.GetExitCodeProcess(proc, &code)
			if state == uint32(windows.WAIT_OBJECT_0) {
				return true, code, nil
			}
			detail := describeWindowsError(waitErr)
			msg := L("无法查询游戏进程："+detail, "Could not query the game process: "+detail)
			return false, 0, &msg
		}

		loaded, err := processHasModule(pid, "kernel32.dll")
		if err == nil && loaded {
			return false, 0, nil
		}
		lastProbeErr = err
		_, _ = windows.WaitForSingleObject(proc, 250)
	}

	detail := ""
	if lastProbeErr != nil {
		detail = " " + describeWindowsError(lastProbeErr)
	}
	msg := L(
		"等待游戏初始化超过 30 秒。"+detail,
		"Game initialization timed out after 30 seconds."+detail,
	)
	return false, 0, &msg
}

func waitForRelaunchedGame(gamePath string, seenPIDs map[uint32]bool, timeout time.Duration) (windows.Handle, uint32) {
	if h, pid := findRelaunchedGameProcess(gamePath, seenPIDs); h != 0 {
		return h, pid
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
		if h, pid := findRelaunchedGameProcess(gamePath, seenPIDs); h != 0 {
			return h, pid
		}
	}
	return 0, 0
}

func startGameProcess(gamePath string) (windows.Handle, uint32, error) {
	appPtr, err := windows.UTF16PtrFromString(gamePath)
	if err != nil {
		return 0, 0, err
	}
	cmdLine, err := windows.UTF16PtrFromString(`"` + gamePath + `"`)
	if err != nil {
		return 0, 0, err
	}
	workDir, err := windows.UTF16PtrFromString(filepath.Dir(gamePath))
	if err != nil {
		return 0, 0, err
	}

	var startup windows.StartupInfo
	startup.Cb = uint32(unsafe.Sizeof(startup))
	var procInfo windows.ProcessInformation

	err = windows.CreateProcess(
		appPtr,
		cmdLine,
		nil,
		nil,
		false,
		windows.CREATE_UNICODE_ENVIRONMENT,
		nil,
		workDir,
		&startup,
		&procInfo,
	)
	if err != nil {
		return 0, 0, err
	}
	_ = windows.CloseHandle(procInfo.Thread)
	return procInfo.Process, procInfo.ProcessId, nil
}

func launchGame(gamePath, directory string, sink launchSink) (windows.Handle, bool, LocalizedText) {
	sink(true, L("正在检查启动文件…", "Checking launch files…"))
	if !strings.EqualFold(filepath.Base(gamePath), "NBA2K22.exe") || !isRegularFile(gamePath) {
		return 0, false, L("请选择有效的 NBA2K22.exe。", "Select a valid NBA2K22.exe.")
	}
	if !isRegularFile(filepath.Join(directory, "Module.dll")) {
		return 0, false, L(
			"启动器目录缺少 Module.dll。请将配套文件放在 Launcher.exe 旁。",
			"Missing Module.dll. Place the matching file beside Launcher.exe.",
		)
	}
	steam := probeLiveSteamStatus(nil)
	if !steam.LoggedIn {
		return 0, false, L("请先启动并登录 Steam 后再开始游戏。", "Sign in to Steam before starting the game.")
	}

	seenPIDs := snapshotGamePIDs()
	if len(seenPIDs) > 0 {
		sink(false, L(
			"[游戏] 检测到已有 NBA2K22.exe 进程在运行；若启动异常请先关闭已有游戏进程。",
			"[Game] An existing NBA2K22.exe process is already running; close it first if launching fails.",
		))
	}

	sink(false, L("[游戏] "+gamePath, "[Game] "+gamePath))
	sink(true, L("正在准备玩家身份并启动游戏…", "Preparing player identity and starting the game…"))
	patchSteamIdentity(filepath.Dir(gamePath), sink)

	handle, pid, err := startGameProcess(gamePath)
	if err != nil {
		detail := describeWindowsError(err)
		return 0, false, L("无法启动游戏："+detail, "Could not start the game: "+detail)
	}
	seenPIDs[pid] = true

	pidText := strconv.FormatUint(uint64(pid), 10)
	sink(false, L("[游戏] 已启动，PID："+pidText, "[Game] Started with PID: "+pidText))

	for hop := 0; ; hop++ {
		sink(true, L("正在等待游戏初始化…", "Waiting for game initialization…"))
		loaderExited, targetExitCode, loaderErr := waitForLoader(handle, pid)
		if loaderErr != nil {
			return handle, false, *loaderErr
		}

		targetExited := loaderExited
		var injErr *LocalizedText

		if !targetExited {
			sink(true, L("正在等待模块注入…", "Waiting for module injection…"))
			injCode, errMsg := runInjector(directory, pid, sink)
			if errMsg == nil {
				return handle, true, L("模块注入完成", "Module injection completed")
			}
			injErr = errMsg

			state, _ := windows.WaitForSingleObject(handle, 0)
			if injCode == injectorExitTargetExited || state == uint32(windows.WAIT_OBJECT_0) {
				targetExited = true
				if state != uint32(windows.WAIT_OBJECT_0) {
					state, _ = windows.WaitForSingleObject(handle, 500)
				}
				if state == uint32(windows.WAIT_OBJECT_0) {
					_ = windows.GetExitCodeProcess(handle, &targetExitCode)
				} else {
					targetExitCode = win32StillActive
				}
			} else {
				return handle, false, *injErr
			}
		}

		_ = windows.CloseHandle(handle)
		handle = 0

		codeStr := strconv.FormatUint(uint64(targetExitCode), 10)
		if hop >= maxRelaunchHops {
			if injErr != nil {
				return 0, false, *injErr
			}
			return 0, false, L(
				"游戏进程多次重启后仍未完成初始化，最后退出码："+codeStr,
				"The game process restarted multiple times without completing initialization. Last exit code: "+codeStr,
			)
		}

		isSteamRelaunch := targetExitCode == steamRelaunchExitCode || targetExitCode == win32StillActive
		waitTimeout := 3 * time.Second
		if isSteamRelaunch {
			waitTimeout = 30 * time.Second
			sink(true, L(
				"检测到 Steam 重新拉起游戏，正在等待新进程…",
				"Steam is relaunching the game; waiting for the new process…",
			))
			sink(false, L(
				"[游戏] 引导进程已退出（退出码 "+codeStr+"），正在等待 Steam 启动游戏进程…",
				"[Game] Stub process exited (code "+codeStr+"); waiting for Steam to start the game process…",
			))
		}

		newHandle, newPID := waitForRelaunchedGame(gamePath, seenPIDs, waitTimeout)
		if newHandle == 0 {
			if targetExitCode == steamRelaunchExitCode {
				return 0, false, L(
					"等待 Steam 重新启动游戏超时（退出码 53）。请确认 Steam 已登录并允许启动 NBA 2K22。",
					"Timed out waiting for Steam to relaunch the game (exit code 53). Make sure Steam is signed in and allowed to start NBA 2K22.",
				)
			}
			if injErr != nil {
				return 0, false, *injErr
			}
			return 0, false, L(
				"游戏在准备完成前退出，退出码："+codeStr,
				"The game exited before initialization. Exit code: "+codeStr,
			)
		}

		handle = newHandle
		pid = newPID
		seenPIDs[newPID] = true
		newPidText := strconv.FormatUint(uint64(newPID), 10)
		sink(false, L(
			"[游戏] 已接管新游戏进程，PID："+newPidText,
			"[Game] Attached to relaunched game process, PID: "+newPidText,
		))
	}
}
