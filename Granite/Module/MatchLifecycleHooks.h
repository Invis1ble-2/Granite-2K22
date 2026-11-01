// Shared NBA 2K22 initialization hooks; feature policy belongs to their callers.
#pragma once
#include <Windows.h>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <sstream>
#include <string>
#include "MinHook/include/MinHook.h"

namespace MatchLifecycleHooks
{
using PlayingFn = uint64_t(__fastcall*)(void*);
using CountFn = int(__fastcall*)();
using StartFn = void(__fastcall*)(void*, void*);
inline StartFn OriginalStart = nullptr;
inline std::atomic<StartFn> StartHandler = nullptr;
inline void (*BeforeStart)(void*, void*) = nullptr;
inline void CallStart(void* Session, void* Info)
{
    const DWORD Error = GetLastError();
    if (BeforeStart) BeforeStart(Session, Info);
    SetLastError(Error);
    OriginalStart(Session, Info);
}
inline void __fastcall Start(void* Session, void* Info)
{
    const auto Handler = StartHandler.load();
    if (Handler) Handler(Session, Info);
    else CallStart(Session, Info);
}
inline PlayingFn OriginalPlaying = nullptr;
inline CountFn OriginalHomeCount = nullptr, OriginalAwayCount = nullptr;
inline std::atomic<PlayingFn> PlayingHandler = nullptr;
inline uint32_t (*ResolveTeamSize)(void*) = nullptr;
inline void (*OnReady)(HMODULE) = nullptr;
inline thread_local bool InitializingMatch = false;
inline thread_local uint32_t InitializingTeamSize = 0;
struct InitScope
{
    bool Previous = InitializingMatch;
    uint32_t PreviousSize = InitializingTeamSize;
    explicit InitScope(uint32_t TeamSize) { InitializingMatch = true; InitializingTeamSize = TeamSize; }
    ~InitScope() { InitializingMatch = Previous; InitializingTeamSize = PreviousSize; }
};
inline int __fastcall HomeCount() { return InitializingMatch ? static_cast<int>(InitializingTeamSize) : OriginalHomeCount(); }
inline int __fastcall AwayCount() { return InitializingMatch ? static_cast<int>(InitializingTeamSize) : OriginalAwayCount(); }
inline uint64_t CallNative(void* Session)
{
    const DWORD Error = GetLastError();
    // An explicit scope from a validated caller takes precedence over optional policy.
    const uint32_t TeamSize = !InitializingMatch && ResolveTeamSize ? ResolveTeamSize(Session) : 0;
    SetLastError(Error);
    if (TeamSize)
    {
        InitScope Scope(TeamSize);
        return OriginalPlaying(Session);
    }
    return OriginalPlaying(Session);
}
inline uint64_t __fastcall Playing(void* Session)
{
    const auto Handler = PlayingHandler.load();
    return Handler ? Handler(Session) : CallNative(Session);
}

// NBA2K22.exe.unpacked.exe, image base 0x140000000. One owner per native hook.
struct Site { size_t Rva; const char* Bytes; size_t Size; void* Detour; void** Original; };
inline const Site Sites[] = {
    {0x169da60, "\x40\x55\x56\x41\x56\x48\x8d\xac\x24\x40\xfa\xff\xff\x48\x81\xec\xc0\x06\x00\x00", 20,
        reinterpret_cast<void*>(&Playing), reinterpret_cast<void**>(&OriginalPlaying)},
    {0x10d3e80, "\x8b\x05\x0a\x06\x1b\x05\xc3", 7,
        reinterpret_cast<void*>(&HomeCount), reinterpret_cast<void**>(&OriginalHomeCount)},
    {0x10d3e70, "\x8b\x05\x1e\x06\x1b\x05\xc3", 7,
        reinterpret_cast<void*>(&AwayCount), reinterpret_cast<void**>(&OriginalAwayCount)},
    {0x16ff0c0, "\x40\x55\x56\x41\x54\x41\x56\x48\x8d\xac\x24\x48\xfd\xff\xff\x48\x81\xec\xb8\x03\x00\x00", 22,
        reinterpret_cast<void*>(&Start), reinterpret_cast<void**>(&OriginalStart)},
};
inline constexpr unsigned HookCount = 4;
inline constexpr DWORD ReadinessTimeoutMs = 30'000, ReadinessPollMs = 250;
inline std::atomic_bool InstallStarted = false;
inline bool CheckSignatures(HMODULE Executable, size_t& FailedRva)
{
    auto* Base = reinterpret_cast<unsigned char*>(Executable);
    for (const auto& S : Sites)
    {
        unsigned char Actual[32]{}; SIZE_T N = 0;
        if (!ReadProcessMemory(GetCurrentProcess(), Base + S.Rva, Actual, S.Size, &N) ||
            N != S.Size || memcmp(Actual, S.Bytes, S.Size))
        { FailedRva = S.Rva; return false; }
    }
    return true;
}
inline void InstallHooks(HMODULE Executable)
{
    auto* Base = reinterpret_cast<unsigned char*>(Executable);
    unsigned Made = 0, Enabled = 0;
    MH_STATUS Status = MH_OK;
    for (const auto& S : Sites)
    {
        Status = MH_CreateHook(Base + S.Rva, S.Detour, S.Original);
        if (Status != MH_OK) break;
        ++Made;
    }
    if (Made == HookCount)
        for (const auto& S : Sites)
        {
            Status = MH_EnableHook(Base + S.Rva);
            if (Status != MH_OK) break;
            ++Enabled;
        }
    if (Made != HookCount || Enabled != HookCount)
    {
        for (unsigned I = 0; I < Enabled; ++I) MH_DisableHook(Base + Sites[I].Rva);
        for (unsigned I = 0; I < Made; ++I) MH_RemoveHook(Base + Sites[I].Rva);
        std::wostringstream Text;
        Text << L"NATIVEINIT22 refused: hook installation failed rva=0x" << std::hex
             << Sites[Made != HookCount ? Made : Enabled].Rva << std::dec << L" status=" << Status;
        Log(LogLevel::Error, Text.str());
        return;
    }
    Log(LogLevel::Info, L"NATIVEINIT22 enabled: shared initialization and scoped player counts");
    if (OnReady) OnReady(Executable);
}
inline DWORD WINAPI WaitAndInstall(void* Context)
{
    const auto Executable = static_cast<HMODULE>(Context);
    const ULONGLONG Started = GetTickCount64();
    try
    {
        for (;;)
        {
            size_t FailedRva = 0;
            if (CheckSignatures(Executable, FailedRva))
            { InstallHooks(Executable); return 0; }
            const ULONGLONG Elapsed = GetTickCount64() - Started;
            if (Elapsed >= ReadinessTimeoutMs)
            {
                std::wostringstream Text;
                Text << L"NATIVEINIT22 refused: native build signature mismatch after " << Elapsed
                     << L" ms waiting; rva=0x" << std::hex << FailedRva;
                Log(LogLevel::Error, Text.str());
                return 1;
            }
            const DWORD Remaining = static_cast<DWORD>(ReadinessTimeoutMs - Elapsed);
            Sleep(Remaining < ReadinessPollMs ? Remaining : ReadinessPollMs);
        }
    }
    catch (...) { Log(LogLevel::Error, L"NATIVEINIT22 refused: readiness worker failed"); return 1; }
}
inline void Install(HMODULE Executable)
{
    if (!Executable || GetModuleHandleW(L"nba2k22.exe") != Executable) return;
    if (InstallStarted.exchange(true)) return;
    size_t FailedRva = 0;
    if (CheckSignatures(Executable, FailedRva)) { InstallHooks(Executable); return; }
    // The packed executable restores .text during startup. Wait outside Initialise.
    Log(LogLevel::Info, L"NATIVEINIT22 waiting for native code signatures (up to " +
        std::to_wstring(ReadinessTimeoutMs) + L" ms)");
    if (HANDLE Thread = CreateThread(nullptr, 0, WaitAndInstall, Executable, 0, nullptr)) CloseHandle(Thread);
    else
    {
        const DWORD Error = GetLastError();
        InstallStarted = false;
        Log(LogLevel::Error, L"NATIVEINIT22 refused: readiness thread could not start: " + std::to_wstring(Error));
    }
}
} // namespace MatchLifecycleHooks
