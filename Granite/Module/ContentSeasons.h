// NBA2K22 content-season reference time; never changes the global/server clock.
#pragma once
#include <windows.h>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <string>
#include "ModuleConfig.h"
#include "MinHook/include/MinHook.h"

namespace ContentSeasons
{
// NBA2K22.exe.unpacked.exe SHA256:
// 14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0
// FUN_140422E30 loads CONTENT_SEASONS into DAT_144F12170.
// +0x170/+0x178 are its native local-time override, read by FUN_140423640,
// FUN_1404237C0 and the other season queries, NOT by the global clock.
// Keep the previously working content_season/08 resources and their native
// checks. After the schedule's last entry, INT64_MAX + 500 in FUN_141ECE2E0
// overflows and incorrectly triggers the transition gate in FUN_1404230F0.
inline constexpr size_t LoadRva = 0x422e30;
inline constexpr size_t DataRva = 0x4f12170;
inline constexpr size_t EnabledOffset = 0x170, TimeOffset = 0x178;
inline constexpr int64_t ReferenceTime = 212524300800000LL; // 2022-07-11 12:00 UTC, VCDate
using LoadFn = void(__fastcall*)(void*);
inline LoadFn OriginalLoad = nullptr;
inline void* SeasonData = nullptr;
inline std::atomic_bool InstallStarted = false;

inline void Apply(void* Data)
{
    auto* Bytes = static_cast<unsigned char*>(Data);
    // Publish the aligned time first, then enable it. Do not touch the schedule,
    // content versions, global date service, save metadata or native gate.
    InterlockedExchange64(reinterpret_cast<volatile LONG64*>(Bytes + TimeOffset), ReferenceTime);
    InterlockedExchange(reinterpret_cast<volatile LONG*>(Bytes + EnabledOffset), 1);
}
inline void __fastcall Load(void* Data)
{
    OriginalLoad(Data);
    // The config manager can reload this object after login/manifest updates.
    if (Data == SeasonData) Apply(Data);
}

struct Signature { size_t Rva; const char* Bytes; size_t Size; };
inline constexpr Signature Signatures[] = {
    {LoadRva, "\x40\x53\x41\x55\x41\x56\x48\x83\xec\x40\x48\x8b\xd9\xe8\xee\x49\x7c\x00\x48\x8b\xc8\xba\x5a\xcf\x67\xf1\xe8\x41\xe8\xa4\x01\x45\x33\xc0\xba\x82\x51\x4f\xb6", 39},
    {0x422e6d, "\xc7\x83\x70\x01\x00\x00\x01\x00\x00\x00", 10},
    {0x422e86, "\x48\x89\x83\x78\x01\x00\x00", 7},
    {0x422e8f, "\x44\x89\xab\x70\x01\x00\x00\x4c\x89\xab\x78\x01\x00\x00", 14},
    // Prove both the singleton address and the fields used by resource selection.
    {0x423656, "\x83\x3d\x83\xec\xae\x04\x00\x48\x8d\x0d\x8c\xeb\xae\x04\x48\x8b\x44\x24\x30\x48\x0f\x45\x05\x77\xec\xae\x04", 27},
    {0x4238e0, "\x48\x8d\x5f\xd0\x48\x8b\xcb\xe8\x44\xf5\xff\xff", 12},
};
inline bool CheckSignatures(HMODULE Executable, size_t& FailedRva)
{
    const auto* Base = reinterpret_cast<const unsigned char*>(Executable);
    for (const auto& S : Signatures)
    {
        unsigned char Bytes[48]{};
        SIZE_T Read = 0;
        if (!Executable || !ReadProcessMemory(GetCurrentProcess(), Base + S.Rva, Bytes, S.Size, &Read) ||
            Read != S.Size || memcmp(Bytes, S.Bytes, S.Size) != 0)
        {
            FailedRva = S.Rva;
            return false;
        }
    }
    return true;
}
inline bool DataWritable(void* Data)
{
    MEMORY_BASIC_INFORMATION Info{};
    if (!VirtualQuery(Data, &Info, sizeof(Info)) || Info.State != MEM_COMMIT ||
        (Info.Protect & (PAGE_GUARD | PAGE_NOACCESS)) ||
        !(Info.Protect & (PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY)))
        return false;
    const auto End = reinterpret_cast<uintptr_t>(Data) + TimeOffset + sizeof(int64_t);
    return End <= reinterpret_cast<uintptr_t>(Info.BaseAddress) + Info.RegionSize;
}
inline bool InstallHooks(HMODULE Executable)
{
    auto* Base = reinterpret_cast<unsigned char*>(Executable);
    SeasonData = Base + DataRva;
    if (!DataWritable(SeasonData))
    {
        Log(LogLevel::Error, L"SEASON22 refused: content-season data is not writable");
        return false;
    }
    void* Target = Base + LoadRva;
    MH_STATUS Status = MH_CreateHook(Target, reinterpret_cast<void*>(&Load), reinterpret_cast<void**>(&OriginalLoad));
    if (Status == MH_OK)
    {
        Status = MH_EnableHook(Target);
        if (Status != MH_OK) { MH_RemoveHook(Target); OriginalLoad = nullptr; }
    }
    if (Status != MH_OK)
    {
        Log(LogLevel::Error, L"SEASON22 hook installation failed; status=" + std::to_wstring(Status));
        return false;
    }
    // Handle injection after initialization, but do not write an uninitialized
    // singleton: its constructor would reset the date. The loader hook covers it.
    int64_t FirstTime = 0;
    memcpy(&FirstTime, Base + DataRva + 0x80, sizeof(FirstTime));
    if (FirstTime > 0) Apply(SeasonData);
    if (ModuleConfig::LogContentSeasons)
        Log(LogLevel::Info, L"SEASON22 active: content reference 2022-07-11 UTC; global/server/save clock retained");
    return true;
}
inline DWORD WINAPI WaitAndInstall(void* Context)
{
    const auto Executable = static_cast<HMODULE>(Context);
    const ULONGLONG Started = GetTickCount64();
    constexpr DWORD TimeoutMs = 30'000, PollMs = 250;
    for (;;)
    {
        size_t FailedRva = 0;
        if (CheckSignatures(Executable, FailedRva)) return InstallHooks(Executable) ? 0 : 1;
        const ULONGLONG Elapsed = GetTickCount64() - Started;
        if (Elapsed >= TimeoutMs)
        {
            Log(LogLevel::Error, L"SEASON22 refused: native signature mismatch at RVA " + std::to_wstring(FailedRva));
            return 1;
        }
        const DWORD Remaining = static_cast<DWORD>(TimeoutMs - Elapsed);
        Sleep(Remaining < PollMs ? Remaining : PollMs);
    }
}
inline void Install(HMODULE Executable)
{
    if (!Executable || GetModuleHandleW(L"NBA2K22.exe") != Executable || InstallStarted.exchange(true)) return;
    size_t FailedRva = 0;
    if (CheckSignatures(Executable, FailedRva)) { InstallHooks(Executable); return; }
    if (ModuleConfig::LogContentSeasons)
        Log(LogLevel::Info, L"SEASON22 waiting for native signatures (up to 30 seconds)");
    if (HANDLE Thread = CreateThread(nullptr, 0, WaitAndInstall, Executable, 0, nullptr)) CloseHandle(Thread);
    else
    {
        InstallStarted = false;
        Log(LogLevel::Error, L"SEASON22 could not start native readiness worker");
    }
}
}
