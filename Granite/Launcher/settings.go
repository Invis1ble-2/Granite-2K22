// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/sys/windows/registry"
)

type docEncoding int

const (
	encUTF16LE docEncoding = iota
	encUTF8
	encUTF8BOM
	encANSI
)

type textDocument struct {
	Text   string
	Format docEncoding
	Exists bool
}

type IniChange struct {
	Section string
	Key     string
	Value   string
}

func readDocument(path string) (textDocument, *LocalizedText) {
	doc := textDocument{Format: encUTF16LE}
	info, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return doc, nil
		}
		detail := filepath.Base(path) + ": " + describeWindowsError(err)
		warn := L("无法读取 "+detail, "Could not read "+detail)
		return doc, &warn
	}
	if info.IsDir() || info.Size() > 1024*1024 {
		warn := L("配置文件不可读或超过 1 MB，已停止处理。", "The configuration is unreadable or larger than 1 MB.")
		return doc, &warn
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		detail := describeWindowsError(err)
		warn := L("读取文件失败："+detail, "Could not read the file: "+detail)
		return doc, &warn
	}
	doc.Exists = true

	if len(raw) >= 2 && raw[0] == 0xFF && raw[1] == 0xFE {
		if (len(raw) % 2) != 0 {
			warn := L("UTF-16 配置文件不完整，无法保存。", "The UTF-16 configuration is incomplete and cannot be saved.")
			return doc, &warn
		}
		doc.Format = encUTF16LE
		body := raw[2:]
		u16 := make([]uint16, len(body)/2)
		for i := range u16 {
			u16[i] = binary.LittleEndian.Uint16(body[i*2 : i*2+2])
		}
		doc.Text = string(utf16.Decode(u16))
		return doc, nil
	}

	hasBOM := bytes.HasPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
	if hasBOM {
		raw = raw[3:]
		doc.Format = encUTF8BOM
	} else {
		doc.Format = encUTF8
	}

	if len(raw) == 0 {
		return doc, nil
	}

	if utf8.Valid(raw) {
		doc.Text = string(raw)
		return doc, nil
	}

	if !hasBOM {
		if decoded, ok := decodeACP(raw); ok {
			doc.Format = encANSI
			doc.Text = decoded
			return doc, nil
		}
	}

	warn := L("配置文件编码无法读取。", "The configuration text encoding could not be read.")
	return doc, &warn
}

func writeDocument(path string, doc textDocument) *LocalizedText {
	var out []byte
	switch doc.Format {
	case encUTF16LE:
		u16 := utf16.Encode([]rune(doc.Text))
		out = make([]byte, 2+len(u16)*2)
		out[0] = 0xFF
		out[1] = 0xFE
		for i, v := range u16 {
			binary.LittleEndian.PutUint16(out[2+i*2:4+i*2], v)
		}
	case encANSI:
		encoded, ok := encodeACP(doc.Text)
		if !ok {
			errText := L("无法编码配置内容。", "Could not encode the configuration.")
			return &errText
		}
		out = encoded
	case encUTF8BOM:
		out = append([]byte{0xEF, 0xBB, 0xBF}, []byte(doc.Text)...)
	default:
		out = []byte(doc.Text)
	}

	if err := atomicReplaceFile(path, out, doc.Exists); err != nil {
		detail := describeWindowsError(err)
		errText := L("保存失败，原文件未替换："+detail, "Save failed; the original file was not replaced: "+detail)
		return &errText
	}
	return nil
}

func IsServerIpv4(text string) bool {
	if text == "" || text == "0.0.0.0" || text == "255.255.255.255" {
		return false
	}
	var octets, value, digits int
	for i := 0; i < len(text); i++ {
		ch := text[i]
		if ch >= '0' && ch <= '9' {
			value = value*10 + int(ch-'0')
			digits++
			if digits > 3 || value > 255 {
				return false
			}
		} else if ch == '.' && digits > 0 && octets < 3 {
			octets++
			value = 0
			digits = 0
		} else {
			return false
		}
	}
	return octets == 3 && digits != 0
}

func IsServerPort(text string) bool {
	if len(text) == 0 || len(text) > 5 {
		return false
	}
	val := 0
	for i := 0; i < len(text); i++ {
		ch := text[i]
		if ch < '0' || ch > '9' {
			return false
		}
		val = val*10 + int(ch-'0')
	}
	return val >= 1 && val <= 65535
}

func applyIniChange(text string, change IniChange) string {
	newline := "\n"
	if strings.Contains(text, "\r\n") {
		newline = "\r\n"
	}
	inSection := false
	insertAt := -1

	for start := 0; start < len(text); {
		nl := strings.IndexByte(text[start:], '\n')
		var end int
		if nl < 0 {
			end = len(text)
		} else {
			end = start + nl
		}
		line := strings.TrimSpace(text[start:end])
		if len(line) > 0 && line[0] == '[' {
			if inSection {
				insertAt = start
				break
			}
			if closeIdx := strings.IndexByte(line, ']'); closeIdx >= 0 {
				secName := strings.TrimSpace(line[1:closeIdx])
				inSection = strings.EqualFold(secName, change.Section)
			}
		} else if inSection && len(line) > 0 && line[0] != ';' && line[0] != '#' {
			eqRel := strings.IndexByte(text[start:end], '=')
			if eqRel >= 0 {
				eq := start + eqRel
				keyName := strings.TrimSpace(text[start:eq])
				if strings.EqualFold(keyName, change.Key) {
					valStart := eq + 1
					for valStart < end && (text[valStart] == ' ' || text[valStart] == '\t') {
						valStart++
					}
					valEnd := end
					for valEnd > valStart && (text[valEnd-1] == '\r' || text[valEnd-1] == ' ' || text[valEnd-1] == '\t') {
						valEnd--
					}
					// Move inline comments to a standalone line above so Windows profile APIs don't read them as values.
					var savedComment string
					if cRel := strings.IndexAny(text[valStart:valEnd], ";#"); cRel >= 0 {
						cPos := valStart + cRel
						savedComment = text[cPos:valEnd] + newline
					}
					updated := text[:valStart] + change.Value + text[valEnd:]
					if savedComment != "" {
						updated = updated[:start] + savedComment + updated[start:]
					}
					return updated
				}
			}
		}
		if nl < 0 {
			break
		}
		start = end + 1
	}

	if insertAt < 0 {
		insertAt = len(text)
	}
	var addition strings.Builder
	if insertAt > 0 && text[insertAt-1] != '\n' {
		addition.WriteString(newline)
	}
	if !inSection {
		addition.WriteString("[")
		addition.WriteString(change.Section)
		addition.WriteString("]")
		addition.WriteString(newline)
	}
	addition.WriteString(change.Key)
	addition.WriteString(" = ")
	addition.WriteString(change.Value)
	addition.WriteString(newline)

	return text[:insertAt] + addition.String() + text[insertAt:]
}

func readNetworkValue(key, iniPath string) string {
	return strings.Trim(getPrivateProfileString("Network", key, "", iniPath), " \t")
}

func readToggleValue(section, key string, def bool, iniPath string) bool {
	val := strings.Trim(getPrivateProfileString(section, key, "", iniPath), " \t")
	if val == "1" {
		return true
	}
	if val == "0" {
		return false
	}
	return def
}

func loadSettings(iniPath string) (SettingsData, *LocalizedText) {
	result := DefaultSettings()
	doc, warn := readDocument(iniPath)
	if warn != nil {
		return result, warn
	}
	if !doc.Exists {
		msg := L("默认配置", "Defaults")
		return result, &msg
	}

	host := readNetworkValue("ServerHost", iniPath)
	port := readNetworkValue("ServerPort", iniPath)
	if IsServerIpv4(host) {
		result.Host = host
	}
	if IsServerPort(port) {
		result.Port = port
	}
	var loadWarn *LocalizedText
	if (host != "" && !IsServerIpv4(host)) || (port != "" && !IsServerPort(port)) {
		msg := L("无效配置已回退默认值", "Invalid values reset to defaults")
		loadWarn = &msg
	}

	for i, def := range ModuleToggles {
		result.Toggles[i] = readToggleValue(def.Section, def.Key, def.Default, iniPath)
	}
	return result, loadWarn
}

func saveIniChanges(iniPath string, changes []IniChange) *LocalizedText {
	if len(changes) == 0 {
		return nil
	}
	doc, errText := readDocument(iniPath)
	if errText != nil {
		return errText
	}
	for _, ch := range changes {
		doc.Text = applyIniChange(doc.Text, ch)
	}
	return writeDocument(iniPath, doc)
}

func loadPreferences() Preferences {
	prefs := Preferences{
		Dark:   false,
		Locale: "en",
	}
	if isSystemUIChinese() {
		prefs.Locale = "zh"
	}

	if k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.QUERY_VALUE); err == nil {
		if val, _, err := k.GetIntegerValue("AppsUseLightTheme"); err == nil {
			prefs.Dark = (val == 0)
		}
		_ = k.Close()
	}

	if k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Granite\Launcher`, registry.QUERY_VALUE); err == nil {
		if val, _, err := k.GetIntegerValue("DarkTheme"); err == nil && val <= 1 {
			prefs.Dark = (val != 0)
		}
		if val, _, err := k.GetIntegerValue("English"); err == nil && val <= 1 {
			if val == 1 {
				prefs.Locale = "en"
			} else {
				prefs.Locale = "zh"
			}
		}
		_ = k.Close()
	}

	return prefs
}

func savePreferences(prefs Preferences) *LocalizedText {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Granite\Launcher`, registry.SET_VALUE)
	if err != nil {
		detail := describeWindowsError(err)
		msg := L("外观已切换，但无法保存偏好："+detail, "Appearance changed, but preferences could not be saved: "+detail)
		return &msg
	}
	defer k.Close()

	var darkVal uint32
	if prefs.Dark {
		darkVal = 1
	}
	var engVal uint32
	if prefs.Locale == "en" {
		engVal = 1
	}

	if err := k.SetDWordValue("DarkTheme", darkVal); err != nil {
		detail := describeWindowsError(err)
		msg := L("外观已切换，但无法保存偏好："+detail, "Appearance changed, but preferences could not be saved: "+detail)
		return &msg
	}
	if err := k.SetDWordValue("English", engVal); err != nil {
		detail := describeWindowsError(err)
		msg := L("外观已切换，但无法保存偏好："+detail, "Appearance changed, but preferences could not be saved: "+detail)
		return &msg
	}
	return nil
}

func resolveGamePath(directory string, args []string) (string, *LocalizedText) {
	if len(args) > 0 {
		if len(args) != 2 || !strings.EqualFold(args[0], "--game") || !filepath.IsAbs(args[1]) {
			warn := L(
				`命令行格式：Launcher.exe --game "NBA2K22.exe 的绝对路径"`,
				`Usage: Launcher.exe --game "absolute path to NBA2K22.exe"`,
			)
			return "", &warn
		}
		return filepath.Clean(args[1]), nil
	}

	pathTxt := filepath.Join(directory, "Path.txt")
	doc, warn := readDocument(pathTxt)
	if warn != nil {
		return "", warn
	}
	if !doc.Exists {
		candidate := filepath.Join(directory, "NBA2K22.exe")
		if isRegularFile(candidate) {
			return candidate, nil
		}
		msg := L("请选择 NBA2K22.exe", "Select NBA2K22.exe")
		return "", &msg
	}

	firstLine := doc.Text
	if idx := strings.IndexAny(firstLine, "\r\n"); idx >= 0 {
		firstLine = firstLine[:idx]
	}
	line := strings.TrimSpace(firstLine)
	if len(line) >= 2 && line[0] == '"' && line[len(line)-1] == '"' {
		line = line[1 : len(line)-1]
	}
	if line == "" {
		msg := L("Path.txt 的首行为空，请重新选择游戏。", "The first line of Path.txt is empty. Select the game again.")
		return "", &msg
	}

	resolved := line
	if !filepath.IsAbs(resolved) {
		resolved = filepath.Join(directory, resolved)
	}
	resolved = filepath.Clean(resolved)
	if !strings.EqualFold(filepath.Ext(resolved), ".exe") {
		resolved = filepath.Join(resolved, "NBA2K22.exe")
	}
	return resolved, nil
}

func rememberGamePath(directory, gamePath string) *LocalizedText {
	pathTxt := filepath.Join(directory, "Path.txt")
	doc, errText := readDocument(pathTxt)
	if errText != nil {
		return errText
	}
	doc.Format = encUTF16LE
	doc.Text = gamePath + "\r\n"
	return writeDocument(pathTxt, doc)
}
