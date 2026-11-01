// NBA 2K22 online-match 60/120 Hz, selected by authenticated server timing. No executable-file patches.
#pragma once
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <mutex>

namespace OnlineMatchFrameRateHooks
{
inline constexpr float Rate = 120.0f, Step = 1.0f / Rate;
inline constexpr size_t ParameterRva = 0x3fa3b78, GameInfoOffset = 0xcb0;
using SyncFn = uint64_t(__fastcall*)();
using EndFn = void(__fastcall*)(int);
using BeginFn = int(__fastcall*)(void*);
using RequestFn = void(__fastcall*)(int, int, int);
using RecomputeFn = void(__fastcall*)();
inline SyncFn OriginalSync = nullptr;
inline EndFn OriginalEnd = nullptr;
inline BeginFn OriginalBegin = nullptr;
inline RequestFn OriginalRequest = nullptr;
inline RecomputeFn OriginalRecompute = nullptr;
inline unsigned char* Base = nullptr;
inline std::atomic_bool Ready = false, InstallStarted = false;
inline thread_local bool InSupportedSync = false;
inline std::recursive_mutex TimingMutex;
// All mutable timing ownership is serialized, including nested setter -> recompute calls.
inline bool Armed = false, OwnRate = false, OwnTiming = false, OwnDelay = false;
inline float SavedRate = 60.0f, SavedStep = 0.0f, SavedDelay = 0.0f, AppliedDelay = 0.0f;
inline uint64_t SavedPeriod = 0, TargetPeriod = 0;
struct MatchContext { unsigned char* Session = nullptr; uint64_t Match = 0; int Home = 0, Away = 0; };
inline MatchContext Candidate{};
inline unsigned ServerRate = 0, ServerBuffer = 0;
inline bool ServerVerified = false;
inline bool IsReady()
{
    std::lock_guard<std::recursive_mutex> Lock(TimingMutex);
    return Ready && ServerVerified && (ServerRate == 60 || ServerRate == 120);
}
inline void ClearLogin()
{
    std::lock_guard<std::recursive_mutex> Lock(TimingMutex);
    // Do not alter a running match's owned native timing; End still restores it.
    ServerRate = ServerBuffer = 0; ServerVerified = false;
}
inline bool ConfigureServer(unsigned Hz, unsigned Buffer)
{
    std::lock_guard<std::recursive_mutex> Lock(TimingMutex);
    if ((Hz != 60 && Hz != 120) || Buffer < 1 || Buffer > 49) return false;
    if (ServerRate == Hz && ServerBuffer == Buffer) return true;
    // Opal restart interrupts the match. Retry until native teardown has released our fields.
    if (Armed || OwnRate || OwnTiming || OwnDelay) return false;
    ServerRate = Hz; ServerBuffer = Buffer; ServerVerified = false;
    return true;
}
inline bool VerifyServer(unsigned Hz, unsigned Buffer)
{
    std::lock_guard<std::recursive_mutex> Lock(TimingMutex);
    const bool Match = (Hz == 60 || Hz == 120) && Hz == ServerRate && Buffer == ServerBuffer;
    if (Match && !ServerVerified)
        Log(LogLevel::Info, L"FPS22 server timing confirmed: " + std::to_wstring(Hz) +
            L" Hz; configured buffer " + std::to_wstring(Buffer) + L" frames; applies to the next park match");
    ServerVerified = Match;
    return Match;
}

template<class T> inline T& At(size_t Rva) { return *reinterpret_cast<T*>(Base + Rva); }
inline bool Read(const void* Address, void* Out, size_t Size)
{
    SIZE_T N = 0;
    return Address && ReadProcessMemory(GetCurrentProcess(), Address, Out, Size, &N) && N == Size;
}
template<class T> inline T Value(const unsigned char* Bytes, size_t Offset)
{
    T Result{}; memcpy(&Result, Bytes + Offset, sizeof(Result)); return Result;
}
// FUN_1416B4A30: type 49..54/59/61 -> these game/rule pairs, practice family 5.
// Only MyCOURT's verified single-side multiplayer lineups bypass the symmetric-team guard.
inline bool IsMyCourtTogether(const unsigned char* Bytes, int Count)
{
    if (Value<uint32_t>(Bytes, 4) != 5) return false;
    uint32_t Rule = 0; int Min = 2, Max = 5;
    switch (Value<uint32_t>(Bytes, 0))
    {
    case 0x25: Rule = 0x1b; Max = 4; break; // Best of ten
    case 0x20: Rule = 0x14; Max = 4; break; // Around the world
    case 0x24: Rule = 0x19; Max = 2; break; // Partner shooting
    case 0x26: Rule = 0x1d; break;          // Seven on board
    case 0x27: Rule = 0x1e; break;          // HORSE
    case 0x21: Rule = 0x15; break;          // Sign out
    case 0x2b: Rule = 0x22; Min = Max = 3; break; // Fullcourt press
    case 0x2d: Rule = 0x24; Min = Max = 3; break; // Defensive press
    default: return false;
    }
    return Value<uint32_t>(Bytes, 8) == Rule && Count >= Min && Count <= Max;
}
// These are the same game-info fields used by the existing guarded park roster code.
inline bool Describe(const void* Info, uint64_t& Match, int& Home, int& Away)
{
    std::array<unsigned char, 0x308> Bytes{};
    if (!Read(Info, Bytes.data(), Bytes.size())) return false;
    Home = Value<int>(Bytes.data(), 0x118); Away = Value<int>(Bytes.data(), 0x11c);
    Match = Value<uint64_t>(Bytes.data(), 0x2d8);
    if (!Match || Home < 1 || Home > 5 || Away < 0 || Away > 5 || !Value<uint32_t>(Bytes.data(), 0x304)) return false;
    if (Away != Home && (Away != 0 || !IsMyCourtTogether(Bytes.data(), Home))) return false;
    uint64_t Ids[10]{};
    for (int I = 0; I < Home + Away; ++I)
    {
        const size_t Offset = I < Home ? 0x48 + I * sizeof(uint64_t) : 0xb0 + (I - Home) * sizeof(uint64_t);
        Ids[I] = Value<uint64_t>(Bytes.data(), Offset);
        if (!Ids[I]) return false;
        for (int J = 0; J < I; ++J) if (Ids[J] == Ids[I]) return false;
    }
    return true;
}
inline bool IsSupportedSyncCaller(void* Caller)
{
    if (Caller == Base + 0xca1ae8) return true;
    if (Caller != Base + 0x169db15) return false;
    using IsParkFn = int(__fastcall*)();
    return reinterpret_cast<IsParkFn>(Base + 0x170d910)() != 0;
}
inline bool CurrentMatch()
{
    if (!Candidate.Session) return false;
    uint64_t Match = 0; int Home = 0, Away = 0;
    return Describe(Candidate.Session + GameInfoOffset, Match, Home, Away) &&
        Match == Candidate.Match && Home == Candidate.Home && Away == Candidate.Away;
}
inline void RestoreTiming()
{
    if (!OwnTiming) return;
    // Do not overwrite a later native/third-party owner of either field.
    if (At<uint64_t>(0x5e12228) == TargetPeriod) At<uint64_t>(0x5e12228) = SavedPeriod;
    if (At<float>(0x5e12220) == Step) At<float>(0x5e12220) = SavedStep;
    OwnTiming = false;
}
inline void __fastcall Recompute()
{
    std::lock_guard<std::recursive_mutex> Lock(TimingMutex);
    const uint64_t Before = At<uint64_t>(0x5e12228);
    RestoreTiming();
    OriginalRecompute();
    // A native request from another slot for 30 FPS, etc. always wins. Never clear its slot.
    if (Armed && At<int>(0x5e121d8) != 0 && At<int>(0x5e121fc) == 1 &&
        At<int>(0x5e1221c) == 1 && At<uint64_t>(0x5e12228) != 0 &&
        At<float>(0x5e12220) == 1.0f / 60.0f)
    {
        SavedPeriod = At<uint64_t>(0x5e12228); SavedStep = At<float>(0x5e12220);
        At<uint64_t>(0x5e12228) = TargetPeriod; At<float>(0x5e12220) = Step;
        OwnTiming = true;
    }
    if (Before != At<uint64_t>(0x5e12228)) At<uint64_t>(0x5e12238) = 0;
}
inline void Reset(bool ForgetMatch)
{
    std::lock_guard<std::recursive_mutex> Lock(TimingMutex);
    const bool HadTiming = Armed || OwnTiming;
    Armed = false;
    if (OwnRate && At<float>(ParameterRva + 0xc) == Rate) At<float>(ParameterRva + 0xc) = SavedRate;
    OwnRate = false;
    if (OwnDelay && At<float>(ParameterRva + 0x10) == AppliedDelay) At<float>(ParameterRva + 0x10) = SavedDelay;
    OwnDelay = false;
    if (HadTiming && Ready && OriginalRecompute) Recompute();
    if (ForgetMatch) Candidate = {};
}
// Called only immediately before the already-validated original StartGame call.
inline void ObserveMatch(void* Session, void* Info)
{
    std::lock_guard<std::recursive_mutex> Lock(TimingMutex);
    Reset(true);
    uint64_t Match = 0; int Home = 0, Away = 0;
    if (Session && Describe(Info, Match, Home, Away))
        Candidate = {static_cast<unsigned char*>(Session), Match, Home, Away};
}
inline void __fastcall Request(int Slot, int Multiplier, int Fixed)
{
    std::lock_guard<std::recursive_mutex> Lock(TimingMutex);
    if (Slot == 2)
    {
        Armed = Ready && ServerVerified && ServerRate == 120 && InSupportedSync && Fixed == 1 && Multiplier == 1 &&
            _ReturnAddress() == Base + 0x17af365 && At<int>(ParameterRva) == 3 &&
            At<float>(ParameterRva + 0xc) == 60.0f;
    }
    OriginalRequest(Slot, Multiplier, Fixed);
}
inline int __fastcall Begin(void* Parameters)
{
    unsigned ActiveHz = 0;
    {
        std::lock_guard<std::recursive_mutex> Lock(TimingMutex);
        if (InSupportedSync && Parameters == Base + ParameterRva && At<int>(ParameterRva) == 3 &&
            At<float>(ParameterRva + 0xc) == 60.0f)
        {
            if (!IsReady() || !CurrentMatch() || (ServerRate == 120 && (!Armed || !OwnTiming)))
            {
                Reset(false);
                Log(LogLevel::Error, L"FPS22 refused setup: server timing is unconfirmed or native match timing changed");
                return 0;
            }
            ActiveHz = ServerRate;
            const float Delay = static_cast<float>(ServerBuffer) / static_cast<float>(ActiveHz);
            if (static_cast<unsigned>(std::ceil(Delay * static_cast<float>(ActiveHz))) != ServerBuffer)
            {
                Reset(false);
                Log(LogLevel::Error, L"FPS22 refused setup: configured buffer does not round-trip at the selected rate");
                return 0;
            }
            // Granite may still have the previous login's seconds after only Opal restarts.
            // Rewrite just this supported Begin's delay, and restore it on failure/End.
            SavedDelay = At<float>(ParameterRva + 0x10); AppliedDelay = Delay;
            At<float>(ParameterRva + 0x10) = Delay; OwnDelay = true;
            if (ActiveHz == 120)
            {
                SavedRate = At<float>(ParameterRva + 0xc);
                At<float>(ParameterRva + 0xc) = Rate; OwnRate = true;
            }
        }
    }
    const int Result = OriginalBegin(Parameters);
    const DWORD Error = GetLastError();
    if (ActiveHz)
    {
        if (!Result) Reset(false);
        else
        {
            const float Delay = At<float>(ParameterRva + 0x10);
            Log(LogLevel::Info, L"FPS22 active: online match " + std::to_wstring(ActiveHz) +
                (ActiveHz == 60 ? L" Hz, native timing retained; configured input lookahead " :
                    L" Hz, fixed dt 1/120; configured input lookahead ") +
                std::to_wstring(static_cast<int>(std::ceil(Delay * static_cast<float>(ActiveHz)))) + L" frames (" +
                std::to_wstring(static_cast<int>(std::lround(Delay * 1000.0f))) + L" ms)");
        }
    }
    SetLastError(Error); return Result;
}
inline uint64_t __fastcall Synchronize()
{
    const bool Previous = InSupportedSync;
    {
        std::lock_guard<std::recursive_mutex> Lock(TimingMutex);
        InSupportedSync = Ready && IsSupportedSyncCaller(_ReturnAddress()) &&
            At<int>(0x3fa424c) == 0 && CurrentMatch();
    }
    const bool Supported = InSupportedSync;
    if (Supported && !IsReady())
    {
        InSupportedSync = Previous;
        Log(LogLevel::Error, L"FPS22 refused sync: waiting for confirmed Opal timing after reconnect");
        return 0;
    }
    const uint64_t Result = OriginalSync();
    const DWORD Error = GetLastError();
    InSupportedSync = Previous;
    if (Supported && !Result) Reset(false);
    SetLastError(Error); return Result;
}
inline void __fastcall End(int Upload)
{
    OriginalEnd(Upload);
    const DWORD Error = GetLastError();
    bool WasActive = false;
    {
        std::lock_guard<std::recursive_mutex> Lock(TimingMutex);
        WasActive = OwnRate;
        Reset(true);
    }
    if (WasActive) Log(LogLevel::Info, L"FPS22 ended: original timing restored; other native limiter slots retained");
    SetLastError(Error);
}
struct Site { size_t Rva; const char* Bytes; size_t Size; void* Detour; void** Original; };
inline const Site Sites[] = {
    {0xb71a70, "\x48\x89\x5c\x24\x08\x48\x89\x74\x24\x10\x57\x48\x81\xec\xa0\x00\x00\x00", 18,
        reinterpret_cast<void*>(&Recompute), reinterpret_cast<void**>(&OriginalRecompute)},
    {0xb71d40, "\x48\x63\xc1\x48\x8d\x0d\x86\x04\x2a\x05\x89\x54\x81\x24\x44\x89\x04\x81\xe9\x19\xfd\xff\xff", 23,
        reinterpret_cast<void*>(&Request), reinterpret_cast<void**>(&OriginalRequest)},
    {0x18866b0, "\x48\x89\x5c\x24\x10\x48\x89\x6c\x24\x18\x48\x89\x74\x24\x20", 15,
        reinterpret_cast<void*>(&Begin), reinterpret_cast<void**>(&OriginalBegin)},
    {0x17afd40, "\x40\x56\x41\x57\x48\x83\xec\x38\x83\x3d\xfd\x44\x7f\x02\x00", 15,
        reinterpret_cast<void*>(&End), reinterpret_cast<void**>(&OriginalEnd)},
    {0x17ae9b0, "\x40\x55\x53\x41\x56\x48\x8d\x6c\x24\xe0\x48\x81\xec\x20\x01\x00\x00", 17,
        reinterpret_cast<void*>(&Synchronize), reinterpret_cast<void**>(&OriginalSync)},
    {0x170d910, "\x8b\x05\xbe\x3d\x87\x02\xc3", 7, nullptr, nullptr},
    {0x17af360, "\xe8\xdb\x29\x3c\xff", 5, nullptr, nullptr},
    {0x2261ee4, "\x00\x00\x70\x42", 4, nullptr, nullptr},
    {0x225b034, "\x89\x88\x88\x3c", 4, nullptr, nullptr},
};
inline bool CheckSignatures(size_t& FailedRva)
{
    for (const auto& S : Sites)
    {
        unsigned char Bytes[32]{};
        if (!Read(Base + S.Rva, Bytes, S.Size) || memcmp(Bytes, S.Bytes, S.Size))
        { FailedRva = S.Rva; return false; }
    }
    return true;
}
inline bool InstallHooks()
{
    LARGE_INTEGER Frequency{};
    if (!QueryPerformanceFrequency(&Frequency) || Frequency.QuadPart < 120) return false;
    TargetPeriod = static_cast<uint64_t>(Frequency.QuadPart) / 120;
    size_t Made = 0, Enabled = 0;
    MH_STATUS Status = MH_OK;
    for (; Made < 5; ++Made)
    {
        Status = MH_CreateHook(Base + Sites[Made].Rva, Sites[Made].Detour, Sites[Made].Original);
        if (Status != MH_OK) break;
    }
    if (Made == 5)
        for (; Enabled < 5; ++Enabled)
        {
            Status = MH_EnableHook(Base + Sites[Enabled].Rva);
            if (Status != MH_OK) break;
        }
    if (Made != 5 || Enabled != 5)
    {
        for (size_t I = Enabled; I-- > 0;) MH_DisableHook(Base + Sites[I].Rva);
        for (size_t I = Made; I-- > 0;) MH_RemoveHook(Base + Sites[I].Rva);
        Log(LogLevel::Error, L"FPS22 unavailable: hook installation failed, status=" + std::to_wstring(Status));
        return false;
    }
    Ready = true;
    Log(LogLevel::Info, L"FPS22 hooks ready: authenticated online match callsites; native 30 Hz lockstep is not promoted");
    return true;
}
inline DWORD WINAPI WaitAndInstall(void*)
{
    constexpr DWORD TimeoutMs = 30'000, PollMs = 250;
    const ULONGLONG Started = GetTickCount64();
    try
    {
        for (;;)
        {
            size_t FailedRva = 0;
            if (CheckSignatures(FailedRva)) return InstallHooks() ? 0 : 1;
            const ULONGLONG Elapsed = GetTickCount64() - Started;
            if (Elapsed >= TimeoutMs)
            {
                Log(LogLevel::Error, L"FPS22 unavailable: native signature mismatch at RVA " + std::to_wstring(FailedRva));
                return 1;
            }
            const DWORD Remaining = static_cast<DWORD>(TimeoutMs - Elapsed);
            Sleep(Remaining < PollMs ? Remaining : PollMs);
        }
    }
    catch (...) { Log(LogLevel::Error, L"FPS22 unavailable: native hook initialization failed"); return 1; }
}
inline void Install(HMODULE Executable)
{
    if (!Executable || GetModuleHandleW(L"NBA2K22.exe") != Executable || InstallStarted.exchange(true)) return;
    Base = reinterpret_cast<unsigned char*>(Executable);
    size_t FailedRva = 0;
    if (CheckSignatures(FailedRva)) { InstallHooks(); return; }
    if (HANDLE Worker = CreateThread(nullptr, 0, WaitAndInstall, nullptr, 0, nullptr)) CloseHandle(Worker);
    else Log(LogLevel::Error, L"FPS22 unavailable: could not start native readiness worker");
}
}
