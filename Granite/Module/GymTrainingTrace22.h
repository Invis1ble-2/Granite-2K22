// Temporary, observation-only NBA 2K22 gym tracing. Built only with GymTrace22=true.
#pragma once
#include <Windows.h>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <sstream>
#include <unordered_map>
#include <unordered_set>
#include "MinHook/include/MinHook.h"

namespace GymTrainingTrace22
{
using AreaFn = void(__fastcall*)(void*, const void*, void*);
using ControllerFn = void(__fastcall*)(void*);
// The native gate writes EAX (0/1); preserve that result, not a recomputed gate.
using GateFn = uint32_t(__fastcall*)();
inline AreaFn OriginalArea = nullptr;
inline ControllerFn OriginalController = nullptr;
inline GateFn OriginalGate = nullptr;
inline uintptr_t ImageBase = 0;
inline std::atomic_bool InstallStarted = false;

inline bool Read(const void* Address, void* Out, size_t Size) noexcept
{
    SIZE_T Copied = 0;
    return Address && ReadProcessMemory(GetCurrentProcess(), Address, Out, Size, &Copied) && Copied == Size;
}
template<class T> inline bool At(const void* Address, size_t Offset, T& Out) noexcept
{
    return Address && Read(static_cast<const unsigned char*>(Address) + Offset, &Out, sizeof(Out));
}
struct RecordData
{
    uintptr_t Vptr;
    uint32_t Near, Name, Index, Instructions, State;
};
static_assert(offsetof(RecordData, State) == 0x18);
struct RecordView
{
    bool Valid = false;
    uintptr_t ActorVptr = 0, Record = 0, RecordVptr = 0;
    uint32_t Near = 0, Name = 0, Index = 0, State = 0;
    bool operator==(const RecordView&) const = default;
};
inline RecordView CaptureRecord(void* Actor) noexcept
{
    RecordView Result;
    // Only the proven local-actor layout: remote actors need not share +0xCD0.
    if (!At(Actor, 0, Result.ActorVptr) || Result.ActorVptr != ImageBase + 0x2d61750 ||
        !At(Actor, 0xcd0, Result.Record)) return Result;
    RecordData Data{};
    if (!Read(reinterpret_cast<const void*>(Result.Record), &Data, sizeof(Data))) return Result;
    Result.RecordVptr = Data.Vptr;
    if (Data.Vptr != ImageBase + 0x2d35ae0) return Result;
    Result.Valid = true;
    Result.Near = Data.Near;
    Result.Name = Data.Name;
    Result.Index = Data.Index;
    Result.State = Data.State;
    return Result;
}
inline bool IsGym(const RecordView& Record) noexcept
{
    return Record.Valid && (Record.Name == 0xeafc0891 || Record.Name == 0x4c0715da ||
        Record.Name == 0x8f1490f1 || Record.Name == 0x89482226);
}
struct GateObservation
{
    uint32_t Calls = 0, Result = 0;
    bool operator==(const GateObservation&) const = default;
};
inline thread_local GateObservation* ActiveGate = nullptr;
struct GateScope
{
    GateObservation* Previous;
    explicit GateScope(GateObservation* Observation) noexcept : Previous(ActiveGate) { ActiveGate = Observation; }
    ~GateScope() { ActiveGate = Previous; }
};
inline uint32_t __fastcall Gate()
{
    const uint32_t Result = OriginalGate();
    if (ActiveGate)
    {
        ++ActiveGate->Calls;
        ActiveGate->Result = Result;
    }
    return Result;
}
struct AreaEvent
{
    const void* Info = nullptr;
    void* Actor = nullptr;
    bool InputValid = false;
    uint32_t Input = 0;
    RecordView Before, After;
    GateObservation Mode;
    bool operator==(const AreaEvent& Other) const
    {
        // The scratch input buffer can move without changing native state.
        return Actor == Other.Actor && InputValid == Other.InputValid && Input == Other.Input &&
            Before == Other.Before && After == Other.After && Mode == Other.Mode;
    }
};
struct ControllerView
{
    bool Valid = false, SelectionValid = false, ListReadable = false;
    uint32_t Enabled118 = 0, Enabled11c = 0, WorkoutId = 0, Stage = 0;
    uint32_t State180 = 0, Pending210 = 0, Match1b8 = 0, Match1bc = 0;
    uintptr_t Workout = 0, List = 0, First = 0;
    bool operator==(const ControllerView&) const = default;
};
inline ControllerView CaptureController(void* Controller) noexcept
{
    ControllerView Result;
    unsigned char Fields[0x28]{};
    uint32_t Enabled[2]{};
    if (!Controller || !Read(static_cast<const unsigned char*>(Controller) + 0x24, Fields, sizeof(Fields)) ||
        !Read(static_cast<const unsigned char*>(Controller) + 0x118, Enabled, sizeof(Enabled))) return Result;
    Result.Valid = true;
    memcpy(&Result.Stage, Fields, sizeof(Result.Stage));
    memcpy(&Result.Workout, Fields + 0xc, sizeof(Result.Workout));
    memcpy(&Result.WorkoutId, Fields + 0x24, sizeof(Result.WorkoutId));
    Result.Enabled118 = Enabled[0];
    Result.Enabled11c = Enabled[1];
    uint32_t Match[2]{};
    Result.SelectionValid = At(Controller, 0x180, Result.State180) &&
        At(Controller, 0x210, Result.Pending210) &&
        Read(static_cast<const unsigned char*>(Controller) + 0x1b8, Match, sizeof(Match)) &&
        At(Controller, 0x60, Result.List);
    if (Result.SelectionValid)
    {
        Result.Match1b8 = Match[0];
        Result.Match1bc = Match[1];
        if (Result.List)
            Result.ListReadable = At(reinterpret_cast<const void*>(Result.List), 0, Result.First);
    }
    return Result;
}
struct ControllerEvent
{
    ControllerView Before, After;
    bool operator==(const ControllerEvent&) const = default;
};
inline std::mutex TraceMutex;
inline std::unordered_map<void*, AreaEvent> LastAreas;
struct ControllerProgress
{
    ControllerEvent Last;
    uint64_t Calls = 0, ReportedCalls = 0;
    ULONGLONG ReportedAt = 0;
    bool Seen = false;
};
inline std::unordered_map<void*, ControllerProgress> Controllers;
inline std::unordered_set<uintptr_t> RejectedLayouts;
inline unsigned Lines = 0;
inline constexpr unsigned LineLimit = 512;
inline constexpr ULONGLONG ControllerHeartbeatMs = 2'000;

template<class T> inline bool Changed(std::unordered_map<void*, T>& Cache, void* Key, const T& Value)
{
    if (Lines >= LineLimit) return false;
    const auto Found = Cache.find(Key);
    if (Found != Cache.end() && Found->second == Value) return false;
    Cache.insert_or_assign(Key, Value);
    ++Lines;
    return true;
}
inline void FinishLine(const std::wostringstream& Text)
{
    Log(LogLevel::Info, Text.str(), true);
    if (Lines == LineLimit)
        Log(LogLevel::Info, L"GYMTRACE22-v1.1 event limit reached (512); further snapshots suppressed", true);
}
inline void PrintRecord(std::wostream& Text, const RecordView& View)
{
    Text << L"{ok=" << View.Valid << L" record=0x" << std::hex << View.Record
         << L" actor_vptr=0x" << View.ActorVptr << L" record_vptr=0x" << View.RecordVptr
         << L" name=0x" << View.Name << std::dec << L" near=" << View.Near
         << L" index=" << View.Index << L" state=" << View.State << L"}";
}
inline void ReportArea(void* Detector, const AreaEvent& Event) noexcept
{
    const bool Gym = IsGym(Event.Before) || IsGym(Event.After);
    const bool Rejected = !Event.Before.Valid || !Event.After.Valid;
    if (!Gym && !Rejected) return;
    try
    {
        std::scoped_lock Lock(TraceMutex);
        // A missing gym event must not silently masquerade as a state-machine result.
        if (!Gym && (Lines >= LineLimit || !RejectedLayouts.insert(Event.Before.ActorVptr).second)) return;
        if (!Changed(LastAreas, Detector, Event)) return;
        std::wostringstream Text;
        Text << (Gym ? L"GYMTRACE22-v1.1 area tick=" : L"GYMTRACE22-v1.1 area-layout-rejected tick=")
             << GetTickCount64() << L" tid=" << GetCurrentThreadId()
             << L" detector=" << Detector << L" info=" << Event.Info << L" actor=" << Event.Actor
             << L" input_ok=" << Event.InputValid << L" input=" << Event.Input << L" before=";
        PrintRecord(Text, Event.Before);
        Text << L" after=";
        PrintRecord(Text, Event.After);
        Text << L" gate_calls=" << Event.Mode.Calls << L" gate=";
        if (Event.Mode.Calls) Text << Event.Mode.Result;
        else Text << L"not-called";
        FinishLine(Text);
    }
    catch (...) { /* Observation failures must not replace the native call. */ }
}
inline void PrintController(std::wostream& Text, const ControllerView& View)
{
    Text << L"{ok=" << View.Valid << L" enabled118=" << View.Enabled118
         << L" enabled11c=" << View.Enabled11c << L" workout_id=" << View.WorkoutId
         << L" stage=" << View.Stage << L" workout=0x" << std::hex << View.Workout << std::dec
         << L" selection_ok=" << View.SelectionValid << L" state180=" << View.State180
         << L" pending210=" << View.Pending210 << L" match1b8=0x" << std::hex << View.Match1b8
         << L" match1bc=0x" << View.Match1bc << L" list=0x" << View.List << L" first=0x" << View.First
         << std::dec << L" list_readable=" << View.ListReadable << L" list_status=";
    if (!View.SelectionValid) Text << L"unknown";
    else if (!View.List) Text << L"null";
    else if (!View.ListReadable) Text << L"unreadable";
    else if (View.First == View.List) Text << L"empty";
    else if (!View.First) Text << L"null-link";
    else Text << L"nonempty";
    Text << L"}";
}
inline void ReportController(void* Controller, const ControllerEvent& Event) noexcept
{
    try
    {
        std::scoped_lock Lock(TraceMutex);
        if (Lines >= LineLimit) return;
        auto& Progress = Controllers[Controller];
        ++Progress.Calls;
        const ULONGLONG Now = GetTickCount64();
        const bool Change = !Progress.Seen || !(Progress.Last == Event);
        if (!Change && Now - Progress.ReportedAt < ControllerHeartbeatMs) return;
        const uint64_t SinceReport = Progress.Calls - Progress.ReportedCalls;
        Progress.Last = Event;
        Progress.Seen = true;
        Progress.ReportedAt = Now;
        Progress.ReportedCalls = Progress.Calls;
        ++Lines;
        std::wostringstream Text;
        Text << L"GYMTRACE22-v1.1 controller tick=" << Now << L" tid=" << GetCurrentThreadId()
             << L" controller=" << Controller << L" reason=" << (Change ? L"change" : L"heartbeat")
             << L" calls=" << Progress.Calls << L" calls_since_report=" << SinceReport << L" before=";
        PrintController(Text, Event.Before);
        Text << L" after=";
        PrintController(Text, Event.After);
        FinishLine(Text);
    }
    catch (...) { /* Only probe-owned formatting and logging are caught. */ }
}
inline void __fastcall Area(void* Detector, const void* Info, void* Actor)
{
    const DWORD EntryError = GetLastError();
    AreaEvent Event;
    Event.Info = Info;
    Event.Actor = Actor;
    Event.InputValid = At(Info, 0, Event.Input);
    Event.Before = CaptureRecord(Actor);
    {
        GateScope Scope(&Event.Mode);
        SetLastError(EntryError);
        OriginalArea(Detector, Info, Actor);
    }
    const DWORD NativeError = GetLastError();
    Event.After = CaptureRecord(Actor);
    ReportArea(Detector, Event);
    SetLastError(NativeError);
}
inline void __fastcall Controller(void* Self)
{
    const DWORD EntryError = GetLastError();
    ControllerEvent Event;
    Event.Before = CaptureController(Self);
    SetLastError(EntryError);
    OriginalController(Self);
    const DWORD NativeError = GetLastError();
    Event.After = CaptureController(Self);
    ReportController(Self, Event);
    SetLastError(NativeError);
}

// Entry bytes checked against NBA2K22.exe.unpacked.exe (base 0x140000000).
struct Site { size_t Rva; const char* Bytes; size_t Size; void* Detour; void** Original; };
inline const Site Sites[] = {
    {0x170d200, "\x48\x83\xec\x28\x48\x8b\x0d\x15\x7d\x06\x05\x48\x85\xc9\x74\x1f", 16,
        reinterpret_cast<void*>(&Gate), reinterpret_cast<void**>(&OriginalGate)},
    {0x1bc2090, "\x48\x89\x5c\x24\x18\x48\x89\x74\x24\x20\x55\x57\x41\x55\x41\x56\x41\x57\x48\x8d\x6c\x24\xc9", 23,
        reinterpret_cast<void*>(&Area), reinterpret_cast<void**>(&OriginalArea)},
    {0x1bb4cb0, "\x48\x8b\xc4\x55\x53\x48\x8d\xa8\x18\xff\xff\xff\x48\x81\xec\xd8\x01\x00\x00", 19,
        reinterpret_cast<void*>(&Controller), reinterpret_cast<void**>(&OriginalController)},
};
inline constexpr unsigned HookCount = 3;
inline bool CheckSignatures(size_t& FailedRva) noexcept
{
    for (const auto& S : Sites)
    {
        unsigned char Actual[32]{};
        if (!Read(reinterpret_cast<const void*>(ImageBase + S.Rva), Actual, S.Size) ||
            memcmp(Actual, S.Bytes, S.Size))
        { FailedRva = S.Rva; return false; }
    }
    return true;
}
inline void InstallHooks()
{
    unsigned Made = 0, Enabled = 0;
    MH_STATUS Status = MH_OK;
    for (const auto& S : Sites)
    {
        Status = MH_CreateHook(reinterpret_cast<void*>(ImageBase + S.Rva), S.Detour, S.Original);
        if (Status != MH_OK) break;
        ++Made;
    }
    if (Made == HookCount)
        for (const auto& S : Sites)
        {
            Status = MH_EnableHook(reinterpret_cast<void*>(ImageBase + S.Rva));
            if (Status != MH_OK) break;
            ++Enabled;
        }
    if (Made != HookCount || Enabled != HookCount)
    {
        for (unsigned I = 0; I < Enabled; ++I) MH_DisableHook(reinterpret_cast<void*>(ImageBase + Sites[I].Rva));
        for (unsigned I = 0; I < Made; ++I) MH_RemoveHook(reinterpret_cast<void*>(ImageBase + Sites[I].Rva));
        std::wostringstream Text;
        Text << L"GYMTRACE22-v1.1 refused: hook installation failed rva=0x" << std::hex
             << Sites[Made != HookCount ? Made : Enabled].Rva << std::dec << L" status=" << Status;
        Log(LogLevel::Error, Text.str());
        return;
    }
    Log(LogLevel::Info, L"GYMTRACE22-v1.1 installed=3 observation_only=1; area=1BC2090 controller=1BB4CB0 gate=170D200; selection fields, controller heartbeat=2000ms, limit=512", true);
}
inline DWORD WINAPI WaitAndInstall(void*)
{
    const ULONGLONG Started = GetTickCount64();
    try
    {
        for (;;)
        {
            size_t FailedRva = 0;
            if (CheckSignatures(FailedRva)) { InstallHooks(); return 0; }
            if (GetTickCount64() - Started >= 30'000)
            {
                std::wostringstream Text;
                Text << L"GYMTRACE22-v1.1 refused: native signature mismatch after 30000 ms; rva=0x"
                     << std::hex << FailedRva;
                Log(LogLevel::Error, Text.str());
                return 1;
            }
            Sleep(250);
        }
    }
    catch (...) { Log(LogLevel::Error, L"GYMTRACE22-v1.1 refused: installer failed"); return 1; }
}
inline void Install(HMODULE Executable)
{
    if (!Executable || GetModuleHandleW(L"nba2k22.exe") != Executable || InstallStarted.exchange(true)) return;
    ImageBase = reinterpret_cast<uintptr_t>(Executable);
    size_t FailedRva = 0;
    if (CheckSignatures(FailedRva)) { InstallHooks(); return; }
    // Packed .text is restored during startup; mirror the existing hook readiness wait.
    Log(LogLevel::Info, L"GYMTRACE22-v1.1 waiting for native signatures (up to 30000 ms)", true);
    if (HANDLE Thread = CreateThread(nullptr, 0, WaitAndInstall, nullptr, 0, nullptr)) CloseHandle(Thread);
    else Log(LogLevel::Error, L"GYMTRACE22-v1.1 refused: readiness thread could not start");
}
} // namespace GymTrainingTrace22
