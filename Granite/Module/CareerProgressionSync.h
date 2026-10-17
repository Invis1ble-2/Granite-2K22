// Synchronize before the attribute menu registers callbacks, not inside OnInitElement.
#pragma once
#include <windows.h>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include "MinHook/include/MinHook.h"

namespace CareerProgressionSync
{
// NBA2K22.exe.unpacked.exe, image base 0x140000000, SHA256:
// 14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0
// GOOEY_MENU::Init 14086DDC0 registers Self+88 at 14086DE17, then calls
// OnInitElement 1406E97D0 at 14086E115. Waiting inside OnInitElement pumps UI
// text handlers against an uninitialized player copy (observed crash 1411D1C81).
// Wait before registration, only for the fixed attribute menu, then initialize once.
// Reuse GetAndApplyServerData(1, player, wait=1, 0), as 140EA8400 does.
// NEW_SAVE skips progression application with CloudSaveId=0; never fabricate an ID.
constexpr size_t MenuRva = 0x86ddc0, CompletionRva = 0x11fbe70;
constexpr size_t AttributeMenuRva = 0x525bd30, AttributeMenuVtableRva = 0x243e490;
using MenuFn = void(__fastcall*)(void*, void*);
using CompletionFn = void(__fastcall*)(void*, uint32_t, void*);
using GetFn = void(__fastcall*)(int, void*, int, uint32_t);
using PlayerFn = void*(__fastcall*)();
using MainThreadFn = bool(__fastcall*)();
using WaitCallback = int(__fastcall*)(void*);
using WaitFn = void(__fastcall*)(void*, uint32_t, WaitCallback, void*, uint32_t, uint32_t);
using ContextFn = void(__fastcall*)(void*);
inline unsigned char* Base = nullptr;
inline MenuFn OriginalMenu = nullptr;
inline CompletionFn OriginalCompletion = nullptr;
inline std::atomic_bool InstallStarted = false;
inline thread_local bool InMenuSync = false;

struct Scope
{
    void* Mode;
    unsigned char* ModeData;
    unsigned char* Progression;
    void* Player;
    uint64_t SaveId;
    uint32_t Slot;
    uint16_t PlayerIndex;
};

// POD-only SEH: invalid/unloaded career state means leave the native menu alone.
inline bool ReadScope(Scope& Result)
{
    __try
    {
        Result.Mode = *reinterpret_cast<void**>(Base + 0x632f0d8);
        Result.ModeData = *reinterpret_cast<unsigned char**>(Base + 0x63325f0);
        Result.Progression = *reinterpret_cast<unsigned char**>(Base + 0x6332628);
        // Mode 3's online career implementation, not offline career or other modes.
        if (Result.Mode != Base + 0x3fa6500 || !Result.ModeData || !Result.Progression ||
            *reinterpret_cast<void**>(Result.Mode) != Base + 0x2d0dcf8 ||
            *reinterpret_cast<int*>(Result.ModeData + 0x134) != 1) return false;
        Result.Slot = *reinterpret_cast<uint32_t*>(Result.ModeData + 0x120);
        Result.SaveId = *reinterpret_cast<uint64_t*>(Result.ModeData + 0x118);
        Result.PlayerIndex = *reinterpret_cast<uint16_t*>(Result.Progression);
        if (!Result.Slot || Result.Slot == UINT32_MAX || Result.PlayerIndex == UINT16_MAX) return false;
        // 140EA5A80 bounds-checks the roster index and returns null if unavailable.
        Result.Player = reinterpret_cast<PlayerFn>(Base + 0xea5a80)();
        return Result.Player != nullptr;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}
inline bool SameScope(const Scope& Expected)
{
    Scope Current{};
    return ReadScope(Current) && Current.Mode == Expected.Mode && Current.ModeData == Expected.ModeData &&
        Current.Progression == Expected.Progression && Current.Player == Expected.Player &&
        Current.SaveId == Expected.SaveId && Current.Slot == Expected.Slot &&
        Current.PlayerIndex == Expected.PlayerIndex;
}
inline int GetState()
{
    return *reinterpret_cast<volatile int*>(Base + 0x63589c8);
}

// Only protect requests issued inside this blocking menu sync. Copy the scope
// under a lock; never hold the lock across native calls or the waiting popup.
inline std::mutex ScopeMutex;
inline bool HaveActiveScope = false;
inline Scope ActiveScope{};
struct ActiveSync
{
    explicit ActiveSync(const Scope& Current)
    {
        std::scoped_lock Lock(ScopeMutex);
        ActiveScope = Current;
        HaveActiveScope = true;
    }
    ~ActiveSync()
    {
        std::scoped_lock Lock(ScopeMutex);
        HaveActiveScope = false;
    }
};
inline bool CancelChangedScope(void* Job, const Scope& Expected)
{
    __try
    {
        auto* Bytes = static_cast<unsigned char*>(Job);
        if (Bytes && *reinterpret_cast<int*>(Bytes + 0x20) == 1 &&
            *reinterpret_cast<void**>(Bytes + 0x28) == Expected.Player && !SameScope(Expected))
        {
            // 1411FBF1D checks +34 before applying; its native cancellation path
            // sets job/global failure state and completes the task without writes.
            *reinterpret_cast<int*>(Bytes + 0x34) = 1;
            return true;
        }
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {}
    return false;
}
inline void __fastcall Completion(void* Reply, uint32_t Status, void* Job)
{
    Scope Expected{};
    bool Protect = false;
    {
        std::scoped_lock Lock(ScopeMutex);
        Protect = HaveActiveScope;
        if (Protect) Expected = ActiveScope;
    }
    if (Status == 0x504521a8 && Protect && CancelChangedScope(Job, Expected))
        Log(LogLevel::Error, L"PROGRESSION22 cancelled stale progression reply after career/slot changed");
    OriginalCompletion(Reply, Status, Job);
}

struct PendingWait
{
    Scope Expected;
    ULONGLONG Started;
};
inline int __fastcall PendingComplete(void* Context)
{
    auto& Pending = *static_cast<PendingWait*>(Context);
    return GetState() != 1 || !SameScope(Pending.Expected) || GetTickCount64() - Pending.Started >= 30'000;
}
inline bool WaitForExisting(const Scope& Expected)
{
    if (GetState() != 1) return true;
    PendingWait Pending{Expected, GetTickCount64()};
    // Same 96-byte native context and TASK_BLOCKER used by GetAndApplyServerData.
    alignas(16) unsigned char Context[96]{};
    reinterpret_cast<ContextFn>(Base + 0xe99380)(Context);
    reinterpret_cast<WaitFn>(Base + 0xf6e210)(Context, 0, &PendingComplete, &Pending, 0x4afb37e4, 0x297);
    reinterpret_cast<ContextFn>(Base + 0x299ec0)(Context);
    return GetState() != 1 && SameScope(Expected);
}

// False means the popup changed modes/slots: the old menu may be retired.
inline bool Synchronize()
{
    if (!reinterpret_cast<MainThreadFn>(Base + 0xbb0f90)()) return true;
    Scope Current{};
    if (!ReadScope(Current)) return true;
    if (!WaitForExisting(Current))
    {
        Log(LogLevel::Error, L"PROGRESSION22 deferred: progression request active or career changed; reopen upgrades to retry");
        return SameScope(Current);
    }
    // Do not trust global success=2 from a different career, or cache success by
    // slot/SaveId=0. Fetch the current scope on each menu entry, not every frame.
    ActiveSync Protect(Current);
    reinterpret_cast<GetFn>(Base + 0x11c8030)(1, Current.Player, 1, 0);
    if (!SameScope(Current))
    {
        Log(LogLevel::Error, L"PROGRESSION22 career changed during wait; abandoned old menu initialization");
        return false;
    }
    if (GetState() == 2)
        Log(LogLevel::Info, L"PROGRESSION22 server progression applied before upgrades; slot=" + std::to_wstring(Current.Slot));
    else
        Log(LogLevel::Error, L"PROGRESSION22 sync failed; native menu retained, reopen upgrades to retry");
    return true;
}
inline bool MenuNotRegistered(void* Self)
{
    __try
    {
        auto* Bytes = static_cast<unsigned char*>(Self);
        auto* Listener = Bytes + 0x88;
        // 140CA29F0 removes the listener and restores both links to itself.
        return *reinterpret_cast<void**>(Bytes) == Base + AttributeMenuVtableRva &&
            *reinterpret_cast<void**>(Listener + 8) == Listener &&
            *reinterpret_cast<void**>(Listener + 0x10) == Listener;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}
inline void __fastcall Menu(void* Self, void* Element)
{
    // This is a shared GOOEY_MENU entry. Never delay unrelated menus/popups.
    if (Self != Base + AttributeMenuRva)
    {
        OriginalMenu(Self, Element);
        return;
    }
    // A native waiting popup pumps UI. Only the outer call may register/init
    // this same page; other menus above still pass through during the wait.
    if (InMenuSync) return;
    struct Guard
    {
        Guard() { InMenuSync = true; }
        ~Guard() { InMenuSync = false; }
    } Guard;
    if (MenuNotRegistered(Self))
    {
        if (!Synchronize()) return;
        if (!MenuNotRegistered(Self))
        {
            Log(LogLevel::Error, L"PROGRESSION22 menu lifecycle changed during wait; abandoned old initialization");
            return;
        }
    }
    else
        Log(LogLevel::Error, L"PROGRESSION22 deferred: menu listener already registered; native initialization retained");
    // Native registration, player copies, caches and UI setup run exactly once.
    // Ordinary sync failure does not force caps; the next menu entry retries.
    OriginalMenu(Self, Element);
}

struct Signature { size_t Rva; const char* Bytes; size_t Size; };
inline constexpr Signature Signatures[] = {
    {MenuRva, "\x48\x89\x5c\x24\x10\x48\x89\x74\x24\x18\x55\x57\x41\x54\x41\x56\x41\x57", 18},
    {0x86de09, "\x48\x8d\x93\x88\x00\x00\x00\x48\x8d\x0d\xf9\x08\xa1\x05\xe8\x64\xe1\x7b\x00", 19},
    {0x86e10f, "\x48\x8b\xd7\x48\x8b\xcb\xff\x90\xc0\x00\x00\x00", 12},
    {0x6e97d0, "\x48\x8b\xc4\x55\x41\x56\x48\x83\xec\x78\x48\x89\x58\x08\x45\x33\xf6", 17},
    {CompletionRva, "\x81\xfa\x38\x26\x48\x75\x0f\x84\x58\x01\x00\x00\x48\x89\x5c\x24\x08", 17},
    {0x11fbf1d, "\x41\x83\x78\x34\x00\x74\x22\xb8\x03\x00\x00\x00\x41\xc7\x40\x18\xc0\xba\x2d\x11", 20},
    {0x11c8030, "\x48\x89\x5c\x24\x08\x48\x89\x74\x24\x10\x48\x89\x7c\x24\x18\x55\x41\x54", 18},
    {0xea5a80, "\x40\x53\x48\x83\xec\x20\x48\x8b\x05\x9b\xcb\x48\x05\x0f\xb7\x08", 16},
    {0xbb0f90, "\x48\x83\xec\x28\xe8\x97\x72\x2b\x01\x33\xc9\x3b\x05\x8f\xd1\xe4\x02\x0f\x94\xc1", 20},
    {0xe99380, "\x33\xd2\x48\xc7\x41\x58\xcf\x00\x90\x7f\x48\x8d\x05\x47\x9e\xba\x01", 17},
    {0x299ec0, "\x48\x8d\x05\x51\x1d\xf8\x01\x48\x89\x01\xc3", 11},
    {0xf6e210, "\x4c\x8b\xdc\x49\x89\x5b\x08\x49\x89\x6b\x10\x56\x57\x41\x54\x41\x56\x41\x57", 19},
};
inline bool CheckSignatures(HMODULE Executable, size_t& FailedRva)
{
    auto* Address = reinterpret_cast<unsigned char*>(Executable);
    for (const auto& Site : Signatures)
    {
        unsigned char Bytes[32]{};
        SIZE_T Read = 0;
        if (!ReadProcessMemory(GetCurrentProcess(), Address + Site.Rva, Bytes, Site.Size, &Read) ||
            Read != Site.Size || memcmp(Bytes, Site.Bytes, Site.Size) != 0)
        {
            FailedRva = Site.Rva;
            return false;
        }
    }
    return true;
}
inline bool InstallHooks(HMODULE Executable)
{
    Base = reinterpret_cast<unsigned char*>(Executable);
    void* MenuTarget = Base + MenuRva;
    void* CompletionTarget = Base + CompletionRva;
    auto Status = MH_CreateHook(CompletionTarget, reinterpret_cast<void*>(&Completion), reinterpret_cast<void**>(&OriginalCompletion));
    if (Status != MH_OK) goto Failed;
    Status = MH_CreateHook(MenuTarget, reinterpret_cast<void*>(&Menu), reinterpret_cast<void**>(&OriginalMenu));
    if (Status != MH_OK) { MH_RemoveHook(CompletionTarget); goto Failed; }
    // Enable reply protection before any menu can start a new sync.
    Status = MH_EnableHook(CompletionTarget);
    if (Status == MH_OK)
    {
        Status = MH_EnableHook(MenuTarget);
        if (Status == MH_OK)
        {
            Log(LogLevel::Info, L"PROGRESSION22 enabled: native sync before upgrade menu text-handler registration");
            return true;
        }
        MH_DisableHook(CompletionTarget);
    }
    MH_RemoveHook(MenuTarget);
    MH_RemoveHook(CompletionTarget);
Failed:
    Log(LogLevel::Error, L"PROGRESSION22 hook installation failed; status=" + std::to_wstring(Status));
    return false;
}
inline DWORD WINAPI WaitAndInstall(void* Context)
{
    const auto Executable = static_cast<HMODULE>(Context);
    const ULONGLONG Started = GetTickCount64();
    for (;;)
    {
        size_t FailedRva = 0;
        if (CheckSignatures(Executable, FailedRva)) return InstallHooks(Executable) ? 0 : 1;
        if (GetTickCount64() - Started >= 30'000)
        {
            Log(LogLevel::Error, L"PROGRESSION22 refused: unsupported native signature at RVA " + std::to_wstring(FailedRva));
            return 1;
        }
        Sleep(250);
    }
}
inline void Install(HMODULE Executable)
{
    if (!Executable || GetModuleHandleW(L"NBA2K22.exe") != Executable || InstallStarted.exchange(true)) return;
    size_t FailedRva = 0;
    if (CheckSignatures(Executable, FailedRva)) { InstallHooks(Executable); return; }
    // Worker only waits for unpacked code and installs hooks; never runs game tasks.
    if (HANDLE Thread = CreateThread(nullptr, 0, WaitAndInstall, Executable, 0, nullptr)) CloseHandle(Thread);
    else Log(LogLevel::Error, L"PROGRESSION22 could not start native readiness worker");
}
}
