// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
package main

import (
	"bytes"
	"debug/pe"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	injectorExitValidation       = 21
	injectorExitProcessAccess    = 22
	injectorExitModuleInspection = 23
	injectorExitInjection        = 24
	injectorExitTargetExited     = 26

	nativeReadinessTimeout = 30 * time.Second
	nativeReadinessPoll    = 250 * time.Millisecond
	initialLoadWaitMs      = 30_000
)

var (
	procVirtualAllocEx     = modKernel32.NewProc("VirtualAllocEx")
	procVirtualFreeEx      = modKernel32.NewProc("VirtualFreeEx")
	procCreateRemoteThread = modKernel32.NewProc("CreateRemoteThread")
	procGetExitCodeThread  = modKernel32.NewProc("GetExitCodeThread")
	procLoadLibraryW       = modKernel32.NewProc("LoadLibraryW")
	procIsWow64Process2    = modKernel32.NewProc("IsWow64Process2")
)

type remoteModule struct {
	base uintptr
	size uintptr
	name string
	path string
}

// NBA2K22 starts with encrypted .text. Preserve the supported native signatures
// from the original injector and wait for them before creating a remote thread.
var nativeCodeSignatures = [...]struct {
	rva   uintptr
	bytes string
}{
	{0x166b330, "\x48\x8b\xc4\x55\x53\x56\x41\x55\x41\x56\x48\x8d\x68\x88\x48\x81\xec\x50\x01\x00\x00"},
	{0x16ff0c0, "\x40\x55\x56\x41\x54\x41\x56\x48\x8d\xac\x24\x48\xfd\xff\xff\x48\x81\xec\xb8\x03\x00\x00"},
	{0x169da60, "\x40\x55\x56\x41\x56\x48\x8d\xac\x24\x40\xfa\xff\xff\x48\x81\xec\xc0\x06\x00\x00"},
	{0x10d3e80, "\x8b\x05\x0a\x06\x1b\x05\xc3"},
	{0x10d3e70, "\x8b\x05\x1e\x06\x1b\x05\xc3"},
	{0x167d3c0, "\x48\x89\x5c\x24\x18\x48\x89\x6c\x24\x20\x57\x48\x83\xec\x20"},
}

func logInjection(sink launchSink, text LocalizedText) {
	sink(false, L("[注入器] "+text.Zh, "[Injector] "+text.En))
}

func injectionFailure(code int, text LocalizedText, err error) (int, *LocalizedText) {
	if err != nil {
		detail := describeWindowsError(err)
		text = L(text.Zh+"："+detail, text.En+": "+detail)
	}
	return code, &text
}

func windowsCallError(err error) error {
	if err == nil || errors.Is(err, windows.ERROR_SUCCESS) {
		return windows.ERROR_GEN_FAILURE
	}
	return err
}

func runInjector(directory string, pid uint32, sink launchSink) (int, *LocalizedText) {
	logInjection(sink, L(
		fmt.Sprintf("内置注入已启动，目标 PID：%d", pid),
		fmt.Sprintf("Built-in injection started for game PID: %d", pid),
	))
	code, message := injectModule(directory, pid, sink)
	if message != nil {
		logInjection(sink, *message)
		if code != injectorExitTargetExited {
			summary := L("模块注入失败："+message.Zh, "Module injection failed: "+message.En)
			return code, &summary
		}
	}
	return code, message
}

func injectModule(directory string, pid uint32, sink launchSink) (int, *LocalizedText) {
	if runtime.GOARCH != "amd64" {
		return injectionFailure(injectorExitValidation, L("启动器必须编译为 x64。", "The launcher must be built for x64."), nil)
	}
	modulePath, err := filepath.Abs(filepath.Join(directory, "Module.dll"))
	if err != nil {
		return injectionFailure(injectorExitValidation, L("无法解析 Module.dll 路径", "Could not resolve the Module.dll path"), err)
	}
	if !isRegularFile(modulePath) {
		return injectionFailure(injectorExitValidation, L("启动器旁缺少 Module.dll："+modulePath, "Missing Module.dll beside the launcher: "+modulePath), nil)
	}
	image, err := pe.Open(modulePath)
	if err != nil {
		return injectionFailure(injectorExitValidation, L("无法校验 Module.dll", "Could not validate Module.dll"), err)
	}
	_, isPE64 := image.OptionalHeader.(*pe.OptionalHeader64)
	validModule := image.Machine == pe.IMAGE_FILE_MACHINE_AMD64 && image.Characteristics&pe.IMAGE_FILE_DLL != 0 && isPE64
	_ = image.Close()
	if !validModule {
		return injectionFailure(injectorExitValidation, L("Module.dll 必须是有效的 x64 Windows DLL。", "Module.dll must be a valid x64 Windows DLL."), nil)
	}

	const access = windows.PROCESS_CREATE_THREAD | windows.PROCESS_QUERY_INFORMATION | windows.PROCESS_VM_OPERATION |
		windows.PROCESS_VM_WRITE | windows.PROCESS_VM_READ | windows.SYNCHRONIZE
	process, err := windows.OpenProcess(access, false, pid)
	if err != nil {
		return injectionFailure(injectorExitProcessAccess, L(
			fmt.Sprintf("无法打开目标 PID %d", pid), fmt.Sprintf("Could not open target PID %d", pid),
		), err)
	}
	defer windows.CloseHandle(process)

	state, err := windows.WaitForSingleObject(process, 0)
	if err != nil {
		return injectionFailure(injectorExitProcessAccess, L("无法查询目标进程状态", "Could not query the target process state"), err)
	}
	if state == uint32(windows.WAIT_OBJECT_0) {
		return injectionFailure(injectorExitTargetExited, L("目标进程已退出。", "The target process has already exited."), nil)
	}
	targetPath, err := queryProcessImagePath(process)
	if err != nil {
		return injectionFailure(injectorExitProcessAccess, L("无法识别目标进程", "Could not identify the target process"), err)
	}
	if !strings.EqualFold(filepath.Base(targetPath), "NBA2K22.exe") {
		return injectionFailure(injectorExitValidation, L("目标不是 NBA2K22.exe："+targetPath, "The target is not NBA2K22.exe: "+targetPath), nil)
	}
	machine, err := effectiveProcessMachine(process)
	if err != nil {
		return injectionFailure(injectorExitValidation, L("无法确定目标架构", "Could not determine the target architecture"), err)
	}
	if machine != pe.IMAGE_FILE_MACHINE_AMD64 {
		return injectionFailure(injectorExitValidation, L("NBA2K22 目标进程必须是 x64。", "The NBA2K22 target process must be x64."), nil)
	}
	logInjection(sink, L(
		fmt.Sprintf("已验证目标 PID %d 为 x64：%s", pid, targetPath),
		fmt.Sprintf("Validated target PID %d as x64: %s", pid, targetPath),
	))
	logInjection(sink, L("模块路径："+modulePath, "Module path: "+modulePath))

	modules, code, message := waitForNativeCode(process, pid, filepath.Base(targetPath), modulePath, sink)
	if message != nil {
		return code, message
	}
	if findRemoteModule(modules, "Module.dll") != nil {
		return 0, nil // The readiness check already validated the loaded path.
	}
	loader, owner, err := remoteLoadLibraryAddress(modules)
	if err != nil {
		return injectionFailure(injectorExitModuleInspection, L("无法解析目标进程的 LoadLibraryW", "Could not resolve LoadLibraryW in the target"), err)
	}
	logInjection(sink, L(
		fmt.Sprintf("已通过 %s 解析远程 LoadLibraryW：0x%X", owner, loader),
		fmt.Sprintf("Resolved remote LoadLibraryW through %s at 0x%X", owner, loader),
	))

	pathUTF16, err := windows.UTF16FromString(modulePath)
	if err != nil {
		return injectionFailure(injectorExitValidation, L("Module.dll 路径无效", "Invalid Module.dll path"), err)
	}
	pathBytes := uintptr(len(pathUTF16)) * unsafe.Sizeof(pathUTF16[0])
	remotePath, _, callErr := procVirtualAllocEx.Call(uintptr(process), 0, pathBytes, windows.MEM_COMMIT|windows.MEM_RESERVE, windows.PAGE_READWRITE)
	if remotePath == 0 {
		return injectionFailure(injectorExitInjection, L("无法分配目标内存", "Could not allocate target memory"), windowsCallError(callErr))
	}
	canFree := true
	defer func() {
		if remotePath != 0 && canFree {
			procVirtualFreeEx.Call(uintptr(process), remotePath, 0, windows.MEM_RELEASE)
		}
	}()

	var written uintptr
	if err := windows.WriteProcessMemory(process, remotePath, (*byte)(unsafe.Pointer(&pathUTF16[0])), pathBytes, &written); err != nil {
		return injectionFailure(injectorExitInjection, L("无法写入 Module.dll 路径", "Could not write the Module.dll path"), err)
	}
	if written != pathBytes {
		return injectionFailure(injectorExitInjection, L("Module.dll 路径未完整写入", "Could not write the complete Module.dll path"), windows.ERROR_WRITE_FAULT)
	}
	threadValue, _, callErr := procCreateRemoteThread.Call(uintptr(process), 0, 0, loader, remotePath, 0, 0)
	if threadValue == 0 {
		return injectionFailure(injectorExitInjection, L("无法创建目标 LoadLibraryW 线程", "Could not create the target LoadLibraryW thread"), windowsCallError(callErr))
	}
	thread := windows.Handle(threadValue)
	defer windows.CloseHandle(thread)
	// Once the thread starts, its path buffer must stay alive until it finishes.
	canFree = false
	logInjection(sink, L("已启动远程 LoadLibraryW，正在等待 Module.dll 加载。", "Started remote LoadLibraryW; waiting for Module.dll to load."))
	state, err = windows.WaitForSingleObject(thread, initialLoadWaitMs)
	if err == nil && state == uint32(windows.WAIT_TIMEOUT) {
		logInjection(sink, L("Module.dll 加载已超过 30 秒，继续等待以安全清理内存。", "Module.dll loading is taking longer than 30 seconds; continuing to wait for safe cleanup."))
		state, err = windows.WaitForSingleObject(thread, windows.INFINITE)
	}
	if err != nil || state != uint32(windows.WAIT_OBJECT_0) {
		return injectionFailure(injectorExitInjection, L("等待远程 LoadLibraryW 失败", "Waiting for remote LoadLibraryW failed"), windowsCallError(err))
	}
	canFree = true

	var loadResult uint32
	readResult, _, resultErr := procGetExitCodeThread.Call(uintptr(thread), uintptr(unsafe.Pointer(&loadResult)))
	freed, _, freeErr := procVirtualFreeEx.Call(uintptr(process), remotePath, 0, windows.MEM_RELEASE)
	if freed == 0 {
		return injectionFailure(injectorExitInjection, L("远程模块路径缓冲区清理失败", "Could not free the remote module path buffer"), windowsCallError(freeErr))
	}
	remotePath = 0
	if readResult == 0 {
		return injectionFailure(injectorExitInjection, L("无法读取 LoadLibraryW 结果", "Could not read the LoadLibraryW result"), windowsCallError(resultErr))
	}
	if loadResult == 0 {
		return injectionFailure(injectorExitInjection, L("LoadLibraryW 返回空值，Module.dll 未加载。", "LoadLibraryW returned null; Module.dll was not loaded."), nil)
	}
	logInjection(sink, L("Module.dll 已成功加载到目标进程。", "Module.dll loaded successfully into the target process."))
	return 0, nil
}

func effectiveProcessMachine(process windows.Handle) (uint16, error) {
	if procIsWow64Process2.Find() == nil {
		var processMachine, nativeMachine uint16
		if err := windows.IsWow64Process2(process, &processMachine, &nativeMachine); err != nil {
			return 0, err
		}
		if processMachine == pe.IMAGE_FILE_MACHINE_UNKNOWN {
			return nativeMachine, nil
		}
		return processMachine, nil
	}
	// Older Windows versions running this amd64 launcher are native amd64.
	var wow64 bool
	if err := windows.IsWow64Process(process, &wow64); err != nil {
		return 0, err
	}
	if wow64 {
		return pe.IMAGE_FILE_MACHINE_I386, nil
	}
	return pe.IMAGE_FILE_MACHINE_AMD64, nil
}

func snapshotRemoteModules(pid uint32) ([]remoteModule, error) {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPMODULE|windows.TH32CS_SNAPMODULE32, pid)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(snapshot)
	var entry windows.ModuleEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Module32First(snapshot, &entry); err != nil {
		return nil, err
	}
	var modules []remoteModule
	for {
		modules = append(modules, remoteModule{
			base: entry.ModBaseAddr,
			size: uintptr(entry.ModBaseSize),
			name: windows.UTF16ToString(entry.Module[:]),
			path: windows.UTF16ToString(entry.ExePath[:]),
		})
		entry.Size = uint32(unsafe.Sizeof(entry))
		if err := windows.Module32Next(snapshot, &entry); err != nil {
			if errors.Is(err, windows.ERROR_NO_MORE_FILES) {
				return modules, nil
			}
			return nil, err
		}
	}
}

func enumerateRemoteModules(pid uint32) ([]remoteModule, error) {
	for attempt := 0; attempt < 8; attempt++ {
		modules, err := snapshotRemoteModules(pid)
		if !errors.Is(err, windows.ERROR_BAD_LENGTH) {
			return modules, err
		}
		time.Sleep(10 * time.Millisecond)
	}
	return nil, windows.ERROR_BAD_LENGTH
}

func findRemoteModule(modules []remoteModule, name string) *remoteModule {
	for i := range modules {
		if strings.EqualFold(modules[i].name, name) {
			return &modules[i]
		}
	}
	return nil
}

func checkNativeCode(process windows.Handle, image *remoteModule) (uintptr, error) {
	for _, signature := range nativeCodeSignatures {
		size := uintptr(len(signature.bytes))
		if signature.rva > image.size || size > image.size-signature.rva {
			return signature.rva, windows.ERROR_BAD_EXE_FORMAT
		}
		var buffer [32]byte
		var read uintptr
		if err := windows.ReadProcessMemory(process, image.base+signature.rva, &buffer[0], size, &read); err != nil {
			return signature.rva, err
		}
		if read != size {
			return signature.rva, windows.ERROR_PARTIAL_COPY
		}
		if !bytes.Equal(buffer[:size], []byte(signature.bytes)) {
			return signature.rva, windows.ERROR_REVISION_MISMATCH
		}
	}
	return 0, nil
}

func waitForNativeCode(process windows.Handle, pid uint32, imageName, modulePath string, sink launchSink) ([]remoteModule, int, *LocalizedText) {
	started := time.Now()
	announced := false
	for {
		state, err := windows.WaitForSingleObject(process, 0)
		if err != nil {
			code, message := injectionFailure(injectorExitModuleInspection, L("无法查询目标就绪状态", "Could not query target readiness"), err)
			return nil, code, message
		}
		if state == uint32(windows.WAIT_OBJECT_0) {
			var exitCode uint32
			_ = windows.GetExitCodeProcess(process, &exitCode)
			message := L(
				fmt.Sprintf("目标 PID %d 在原生代码就绪前退出，未执行注入。退出码：%d", pid, exitCode),
				fmt.Sprintf("Target PID %d exited before native code became ready; no injection performed. Exit code: %d", pid, exitCode),
			)
			return nil, injectorExitTargetExited, &message
		}
		modules, probeErr := enumerateRemoteModules(pid)
		var failedRVA uintptr
		if probeErr == nil {
			if loaded := findRemoteModule(modules, "Module.dll"); loaded != nil {
				if strings.EqualFold(filepath.Clean(loaded.path), modulePath) {
					logInjection(sink, L("Module.dll 已从指定路径加载。", "Module.dll is already loaded from the requested path."))
					return modules, 0, nil
				}
				message := L("已加载来自其他路径的 Module.dll："+loaded.path, "A different Module.dll is already loaded: "+loaded.path)
				return nil, injectorExitModuleInspection, &message
			}
			if image := findRemoteModule(modules, imageName); image != nil {
				failedRVA, probeErr = checkNativeCode(process, image)
			} else {
				probeErr = windows.ERROR_MOD_NOT_FOUND
			}
		}
		elapsed := time.Since(started)
		if probeErr == nil {
			logInjection(sink, L(
				fmt.Sprintf("PID %d 原生代码已就绪，耗时 %d 毫秒。", pid, elapsed.Milliseconds()),
				fmt.Sprintf("NBA2K22 native code ready in PID %d after %d ms.", pid, elapsed.Milliseconds()),
			))
			return modules, 0, nil
		}
		if elapsed >= nativeReadinessTimeout {
			code, message := injectionFailure(injectorExitModuleInspection, L(
				fmt.Sprintf("NBA2K22 原生代码在 30 秒内未就绪，未执行注入。PID=%d rva=0x%X", pid, failedRVA),
				fmt.Sprintf("NBA2K22 native code did not become ready within 30 seconds; no injection performed. PID=%d rva=0x%X", pid, failedRVA),
			), probeErr)
			return nil, code, message
		}
		if !announced {
			logInjection(sink, L(
				fmt.Sprintf("正在等待 PID %d 的 NBA2K22 原生代码就绪，最多 30 秒。", pid),
				fmt.Sprintf("Waiting for NBA2K22 native code in PID %d before loading Module.dll (up to 30 seconds).", pid),
			))
			announced = true
		}
		waitMs := uint32(min(nativeReadinessTimeout-elapsed, nativeReadinessPoll).Milliseconds())
		if _, err := windows.WaitForSingleObject(process, waitMs); err != nil {
			code, message := injectionFailure(injectorExitModuleInspection, L("等待目标就绪失败", "Waiting for target readiness failed"), err)
			return nil, code, message
		}
	}
}

func remoteLoadLibraryAddress(modules []remoteModule) (uintptr, string, error) {
	if err := procLoadLibraryW.Find(); err != nil {
		return 0, "", err
	}
	localAddress := procLoadLibraryW.Addr()
	var memory windows.MemoryBasicInformation
	if err := windows.VirtualQuery(localAddress, &memory, unsafe.Sizeof(memory)); err != nil {
		return 0, "", err
	}
	if memory.AllocationBase == 0 {
		return 0, "", windows.ERROR_INVALID_ADDRESS
	}
	// LoadLibraryW can belong to KernelBase rather than kernel32. Resolve its
	// actual owning module before applying the offset to the target's ASLR base.
	var ownerPath string
	for size := 512; size <= 32768; size *= 2 {
		buffer := make([]uint16, size)
		n, err := windows.GetModuleFileName(windows.Handle(memory.AllocationBase), &buffer[0], uint32(size))
		if err != nil {
			return 0, "", err
		}
		if n < uint32(size) {
			ownerPath = windows.UTF16ToString(buffer[:n])
			break
		}
	}
	if ownerPath == "" {
		return 0, "", windows.ERROR_BUFFER_OVERFLOW
	}
	owner := filepath.Base(ownerPath)
	remoteOwner := findRemoteModule(modules, owner)
	if remoteOwner == nil {
		return 0, owner, windows.ERROR_MOD_NOT_FOUND
	}
	if localAddress < memory.AllocationBase {
		return 0, owner, windows.ERROR_INVALID_ADDRESS
	}
	offset := localAddress - memory.AllocationBase
	if offset >= remoteOwner.size || remoteOwner.base > ^uintptr(0)-offset {
		return 0, owner, windows.ERROR_INVALID_ADDRESS
	}
	return remoteOwner.base + offset, owner, nil
}
