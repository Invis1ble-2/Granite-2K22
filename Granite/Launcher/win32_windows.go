// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modKernel32                  = windows.NewLazySystemDLL("kernel32.dll")
	procGetModuleHandleW         = modKernel32.NewProc("GetModuleHandleW")
	procGetUserDefaultUILanguage = modKernel32.NewProc("GetUserDefaultUILanguage")
	procGetPrivateProfileStringW = modKernel32.NewProc("GetPrivateProfileStringW")
	procMultiByteToWideChar      = modKernel32.NewProc("MultiByteToWideChar")
	procWideCharToMultiByte      = modKernel32.NewProc("WideCharToMultiByte")
	procReplaceFileW             = modKernel32.NewProc("ReplaceFileW")

	modUser32                    = windows.NewLazySystemDLL("user32.dll")
	procFindWindowExW            = modUser32.NewProc("FindWindowExW")
	procGetWindowThreadProcessId = modUser32.NewProc("GetWindowThreadProcessId")
	procGetSystemMetrics         = modUser32.NewProc("GetSystemMetrics")
	procLoadImageW               = modUser32.NewProc("LoadImageW")
	procSendMessageW             = modUser32.NewProc("SendMessageW")

	modShell32         = windows.NewLazySystemDLL("shell32.dll")
	procSHChangeNotify = modShell32.NewProc("SHChangeNotify")
)

const (
	cpACP      = 0
	langZhPrim = 0x04

	wailsAppIconResID = 3
	winImageIcon      = 1
	winWmSetIcon      = 0x0080
	winIconSmall      = 0
	winIconBig        = 1
	winSmCxIcon       = 11
	winSmCyIcon       = 12
	winSmCxSmIcon     = 49
	winSmCySmIcon     = 50

	shcneUpdateItem = 0x00002000
	shcnfPathW      = 0x0005
)

func describeWindowsError(err error) string {
	if err == nil {
		return ""
	}
	var errno syscall.Errno
	if errors.As(err, &errno) {
		msg := strings.TrimSpace(errno.Error())
		if msg != "" {
			return fmt.Sprintf("Windows %d：%s", uint32(errno), msg)
		}
		return fmt.Sprintf("Windows %d", uint32(errno))
	}
	return strings.TrimSpace(err.Error())
}

func isSystemUIChinese() bool {
	ret, _, _ := procGetUserDefaultUILanguage.Call()
	primary := uint16(ret) & 0x03FF
	return primary == langZhPrim
}

func getPrivateProfileString(section, key, def, filePath string) string {
	secPtr, err := windows.UTF16PtrFromString(section)
	if err != nil {
		return def
	}
	keyPtr, err := windows.UTF16PtrFromString(key)
	if err != nil {
		return def
	}
	defPtr, err := windows.UTF16PtrFromString(def)
	if err != nil {
		return def
	}
	pathPtr, err := windows.UTF16PtrFromString(filePath)
	if err != nil {
		return def
	}

	buf := make([]uint16, 128)
	n, _, _ := procGetPrivateProfileStringW.Call(
		uintptr(unsafe.Pointer(secPtr)),
		uintptr(unsafe.Pointer(keyPtr)),
		uintptr(unsafe.Pointer(defPtr)),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		uintptr(unsafe.Pointer(pathPtr)),
	)
	if int(n) >= len(buf)-1 {
		return ""
	}
	return windows.UTF16ToString(buf[:n])
}

func decodeACP(data []byte) (string, bool) {
	if len(data) == 0 {
		return "", true
	}
	r1, _, _ := procMultiByteToWideChar.Call(
		uintptr(cpACP),
		0,
		uintptr(unsafe.Pointer(&data[0])),
		uintptr(len(data)),
		0,
		0,
	)
	count := int(r1)
	if count <= 0 {
		return "", false
	}
	wide := make([]uint16, count)
	r2, _, _ := procMultiByteToWideChar.Call(
		uintptr(cpACP),
		0,
		uintptr(unsafe.Pointer(&data[0])),
		uintptr(len(data)),
		uintptr(unsafe.Pointer(&wide[0])),
		uintptr(count),
	)
	if int(r2) <= 0 {
		return "", false
	}
	return string(utf16.Decode(wide[:r2])), true
}

func encodeACP(text string) ([]byte, bool) {
	if text == "" {
		return nil, true
	}
	wide := utf16.Encode([]rune(text))
	if len(wide) == 0 {
		return nil, true
	}
	r1, _, _ := procWideCharToMultiByte.Call(
		uintptr(cpACP),
		0,
		uintptr(unsafe.Pointer(&wide[0])),
		uintptr(len(wide)),
		0,
		0,
		0,
		0,
	)
	count := int(r1)
	if count <= 0 {
		return nil, false
	}
	out := make([]byte, count)
	r2, _, _ := procWideCharToMultiByte.Call(
		uintptr(cpACP),
		0,
		uintptr(unsafe.Pointer(&wide[0])),
		uintptr(len(wide)),
		uintptr(unsafe.Pointer(&out[0])),
		uintptr(count),
		0,
		0,
	)
	if int(r2) <= 0 {
		return nil, false
	}
	return out[:r2], true
}

func atomicReplaceFile(targetPath string, content []byte, targetExists bool) error {
	dir := filepath.Dir(targetPath)
	tmpFile, err := os.CreateTemp(dir, "GNT*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := tmpFile.Write(content); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	dstPtr, err := windows.UTF16PtrFromString(targetPath)
	if err != nil {
		return err
	}
	srcPtr, err := windows.UTF16PtrFromString(tmpPath)
	if err != nil {
		return err
	}

	if targetExists {
		r1, _, callErr := procReplaceFileW.Call(
			uintptr(unsafe.Pointer(dstPtr)),
			uintptr(unsafe.Pointer(srcPtr)),
			0,
			0,
			0,
			0,
		)
		if r1 == 0 {
			if callErr != nil && !errors.Is(callErr, syscall.Errno(0)) {
				return callErr
			}
			return errors.New("ReplaceFileW failed")
		}
	} else {
		if err := windows.MoveFileEx(srcPtr, dstPtr, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH); err != nil {
			return err
		}
	}

	cleanup = false
	return nil
}

func processHasModule(pid uint32, wantModule string) (bool, error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPMODULE|windows.TH32CS_SNAPMODULE32, pid)
	if err != nil {
		return false, err
	}
	defer windows.CloseHandle(snap)

	var entry windows.ModuleEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Module32First(snap, &entry); err != nil {
		return false, err
	}
	for {
		name := windows.UTF16ToString(entry.Module[:])
		if strings.EqualFold(name, wantModule) {
			return true, nil
		}
		if err := windows.Module32Next(snap, &entry); err != nil {
			if errors.Is(err, windows.ERROR_NO_MORE_FILES) {
				return false, nil
			}
			return false, err
		}
	}
}

func snapshotGamePIDs() map[uint32]bool {
	seen := make(map[uint32]bool)
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return seen
	}
	defer windows.CloseHandle(snap)

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snap, &entry); err != nil {
		return seen
	}
	for {
		name := windows.UTF16ToString(entry.ExeFile[:])
		if strings.EqualFold(name, "NBA2K22.exe") {
			seen[entry.ProcessID] = true
		}
		entry.Size = uint32(unsafe.Sizeof(entry))
		if err := windows.Process32Next(snap, &entry); err != nil {
			break
		}
	}
	return seen
}

func queryProcessImagePath(proc windows.Handle) (string, error) {
	buf := make([]uint16, 512)
	for len(buf) <= 32768 {
		size := uint32(len(buf))
		err := windows.QueryFullProcessImageName(proc, 0, &buf[0], &size)
		if err == nil {
			return windows.UTF16ToString(buf[:size]), nil
		}
		if !errors.Is(err, windows.ERROR_INSUFFICIENT_BUFFER) {
			return "", err
		}
		buf = make([]uint16, len(buf)*2)
	}
	return "", windows.ERROR_BUFFER_OVERFLOW
}

func sameFilePath(a, b string) bool {
	if strings.EqualFold(filepath.Clean(a), filepath.Clean(b)) {
		return true
	}
	ia, errA := os.Stat(a)
	ib, errB := os.Stat(b)
	return errA == nil && errB == nil && os.SameFile(ia, ib)
}

func findRelaunchedGameProcess(gamePath string, seenPIDs map[uint32]bool) (windows.Handle, uint32) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0, 0
	}
	defer windows.CloseHandle(snap)

	var fallbackHandle windows.Handle
	var fallbackPID uint32

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snap, &entry); err != nil {
		return 0, 0
	}
	for {
		pid := entry.ProcessID
		name := windows.UTF16ToString(entry.ExeFile[:])
		if pid != 0 && !seenPIDs[pid] && strings.EqualFold(name, "NBA2K22.exe") {
			h, openErr := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, pid)
			if openErr == nil && h != 0 {
				state, _ := windows.WaitForSingleObject(h, 0)
				if state == uint32(windows.WAIT_TIMEOUT) {
					imgPath, pathErr := queryProcessImagePath(h)
					if pathErr == nil && sameFilePath(imgPath, gamePath) {
						if fallbackHandle != 0 {
							_ = windows.CloseHandle(fallbackHandle)
						}
						return h, pid
					}
					if fallbackHandle == 0 && (pathErr != nil || strings.EqualFold(filepath.Base(imgPath), "NBA2K22.exe")) {
						fallbackHandle = h
						fallbackPID = pid
					} else {
						_ = windows.CloseHandle(h)
					}
				} else {
					_ = windows.CloseHandle(h)
				}
			}
		}

		entry.Size = uint32(unsafe.Sizeof(entry))
		if err := windows.Process32Next(snap, &entry); err != nil {
			break
		}
	}
	return fallbackHandle, fallbackPID
}

func inspectRunningSteamProcess(expectedPID uint32) (alive bool, steamDir string) {
	checkPID := func(pid uint32) (bool, string, bool) {
		if pid == 0 {
			return false, "", false
		}
		if h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, pid); err == nil && h != 0 {
			defer windows.CloseHandle(h)
			state, _ := windows.WaitForSingleObject(h, 0)
			if state != uint32(windows.WAIT_TIMEOUT) {
				return false, "", false
			}
			imgPath, pathErr := queryProcessImagePath(h)
			if pathErr != nil || !strings.EqualFold(filepath.Base(imgPath), "steam.exe") {
				return false, "", false
			}
			return true, filepath.Dir(imgPath), false
		} else if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			if hLim, limErr := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid); limErr == nil && hLim != 0 {
				defer windows.CloseHandle(hLim)
				var code uint32
				if codeErr := windows.GetExitCodeProcess(hLim, &code); codeErr != nil || code != win32StillActive {
					return false, "", false
				}
				imgPath, pathErr := queryProcessImagePath(hLim)
				if pathErr != nil || !strings.EqualFold(filepath.Base(imgPath), "steam.exe") {
					return false, "", false
				}
				return true, filepath.Dir(imgPath), false
			}
			return false, "", true
		}
		return false, "", false
	}

	if expectedPID != 0 {
		ok, dir, needSnap := checkPID(expectedPID)
		if ok || !needSnap {
			return ok, dir
		}
	}

	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false, ""
	}
	defer windows.CloseHandle(snap)

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snap, &entry); err != nil {
		return false, ""
	}
	for {
		name := windows.UTF16ToString(entry.ExeFile[:])
		if strings.EqualFold(name, "steam.exe") && (expectedPID == 0 || entry.ProcessID == expectedPID) {
			ok, dir, needSnap := checkPID(entry.ProcessID)
			if ok {
				return true, dir
			}
			if needSnap {
				return true, ""
			}
		}
		entry.Size = uint32(unsafe.Sizeof(entry))
		if err := windows.Process32Next(snap, &entry); err != nil {
			break
		}
	}
	return false, ""
}

func applyNativeWindowIcons() {
	hMod, _, _ := procGetModuleHandleW.Call(0)
	if hMod == 0 {
		return
	}
	cxSm, _, _ := procGetSystemMetrics.Call(winSmCxSmIcon)
	cySm, _, _ := procGetSystemMetrics.Call(winSmCySmIcon)
	cxLg, _, _ := procGetSystemMetrics.Call(winSmCxIcon)
	cyLg, _, _ := procGetSystemMetrics.Call(winSmCyIcon)

	hSmall, _, _ := procLoadImageW.Call(hMod, wailsAppIconResID, winImageIcon, cxSm, cySm, 0)
	hBig, _, _ := procLoadImageW.Call(hMod, wailsAppIconResID, winImageIcon, cxLg, cyLg, 0)
	if hSmall == 0 && hBig == 0 {
		return
	}

	selfPID := windows.GetCurrentProcessId()
	var hwnd uintptr
	for {
		next, _, _ := procFindWindowExW.Call(0, hwnd, 0, 0)
		if next == 0 {
			break
		}
		hwnd = next
		var winPID uint32
		procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&winPID)))
		if winPID == selfPID {
			if hSmall != 0 {
				procSendMessageW.Call(hwnd, winWmSetIcon, winIconSmall, hSmall)
			}
			if hBig != 0 {
				procSendMessageW.Call(hwnd, winWmSetIcon, winIconBig, hBig)
			}
		}
	}
}

func refreshLauncherShellIcon() {
	exe, err := os.Executable()
	if err != nil || exe == "" {
		return
	}
	ptr, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		return
	}
	procSHChangeNotify.Call(shcneUpdateItem, shcnfPathW, uintptr(unsafe.Pointer(ptr)), 0)
}

func getLauncherDirectory() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}

func isRegularFile(p string) bool {
	if p == "" {
		return false
	}
	info, err := os.Stat(p)
	return err == nil && info.Mode().IsRegular()
}
