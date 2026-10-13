// Native generated-player readiness and 2v2 start validation. No roster-pointer patching.
#pragma once
#include <atomic>
#include <cstdint>
#include <sstream>

namespace SoloParkNative
{
using GenerateFn = void*(__fastcall*)(void*, void*, void*);
using StartFn = void(__fastcall*)(void*, void*);
using PlayingFn = uint64_t(__fastcall*)(void*);
using CountFn = int(__fastcall*)();
inline CountFn OriginalHomeCount = nullptr, OriginalAwayCount = nullptr;
inline thread_local bool InitializingSolo = false;
struct InitScope
{
    bool Previous = InitializingSolo;
    InitScope() { InitializingSolo = true; }
    ~InitScope() { InitializingSolo = Previous; }
};
inline int __fastcall HomeCount() { return InitializingSolo ? 2 : OriginalHomeCount(); }
inline int __fastcall AwayCount() { return InitializingSolo ? 2 : OriginalAwayCount(); }
using LookupFn = void*(__fastcall*)(void*, uint64_t);
// FUN_1416B4A30 writes MatchId at uint32_t[0xb6], RandomSeed at [0xd0].
inline constexpr size_t MatchOffset = 0xb6 * sizeof(uint32_t);
static_assert(MatchOffset == 0x2d8);
inline GenerateFn OriginalGenerate = nullptr;
inline StartFn OriginalStart = nullptr;
inline PlayingFn OriginalPlaying = nullptr;
inline LookupFn Lookup = nullptr;
inline constexpr uint64_t CpuMask = 0xfffff00000000000ULL;
inline constexpr uint64_t CpuPrefix = 0x0222c00000000000ULL;
struct Request { uint32_t Magic, Version; uint64_t Match, Owner, Cpu[3]; };
static_assert(sizeof(Request) == 48);
inline Request Current{};
inline bool Created[3]{};
inline std::mutex ReceiptMutex;
inline std::wstring Root;

inline bool Read(const void* Address, void* Out, size_t Size)
{
    SIZE_T N = 0;
    return Address && ReadProcessMemory(GetCurrentProcess(), Address, Out, Size, &N) && N == Size;
}
template<class T> inline bool At(const void* Base, size_t Offset, T& Value)
{
    return Base && Read(static_cast<const unsigned char*>(Base) + Offset, &Value, sizeof(Value));
}
inline bool LoadRequest(Request& R)
{
    HANDLE File = CreateFileW((Root + L"\\SoloParkNative.request").c_str(), GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, 0, nullptr);
    if (File == INVALID_HANDLE_VALUE) return false;
    DWORD N = 0;
    const bool Ok = GetFileSize(File, nullptr) == sizeof(R) && ReadFile(File, &R, sizeof(R), &N, nullptr) && N == sizeof(R);
    CloseHandle(File);
    if (!Ok || R.Magic != 0x32325053 || R.Version != 1 || !R.Match || !R.Owner) return false;
    for (unsigned I = 0; I < 3; ++I)
    {
        if ((R.Cpu[I] & CpuMask) != CpuPrefix || R.Cpu[I] == R.Owner) return false;
        for (unsigned J = 0; J < I; ++J) if (R.Cpu[J] == R.Cpu[I]) return false;
    }
    return true;
}
inline void Select(const Request& R)
{
    if (memcmp(&Current, &R, sizeof(R))) { Current = R; memset(Created, 0, sizeof(Created)); }
}
inline void Receipt(const char* Error = nullptr, bool Started = false)
{
    std::ostringstream Text;
    Text << "{\"version\":1,\"module\":\"00010206\",\"installed\":true,\"pid\":" << GetCurrentProcessId()
         << ",\"match\":\"" << std::hex << Current.Match << "\",\"created\":[";
    bool First = true;
    for (unsigned I = 0; I < 3; ++I) if (Created[I])
    {
        if (!First) Text << ',';
        Text << '\"' << Current.Cpu[I] << '\"'; First = false;
    }
    Text << "],\"started\":" << (Started ? "true" : "false") << ",\"error\":";
    if (Error) Text << '\"' << Error << '\"'; else Text << "null";
    Text << "}\n";
    const auto Bytes = Text.str();
    const auto Temp = Root + L"\\SoloParkNative.ready.tmp";
    HANDLE File = CreateFileW(Temp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, 0, nullptr);
    if (File == INVALID_HANDLE_VALUE) return;
    DWORD N = 0;
    const bool Ok = WriteFile(File, Bytes.data(), static_cast<DWORD>(Bytes.size()), &N, nullptr) && N == Bytes.size();
    CloseHandle(File);
    if (Ok) MoveFileExW(Temp.c_str(), (Root + L"\\SoloParkNative.ready.json").c_str(), MOVEFILE_REPLACE_EXISTING);
    else DeleteFileW(Temp.c_str());
}
inline bool HasRoster(void* Player, uint64_t Id, bool Cpu)
{
    uint64_t Puid = 0; void* Container = nullptr; void* Roster = nullptr; uint32_t Flags = 0, Value = 0;
    return At(Player, 0xf0, Puid) && Puid == Id && At(Player, 0x2200, Flags) && (!Cpu || (Flags & 8)) &&
        At(Player, 0x446c0, Container) && At(Container, 0x28, Roster) && At(Roster, 0xf8, Value);
}
inline bool Validate(void* Session, void* Info, const Request& R, bool Prepared)
{
    int Home = 0, Away = 0; uint64_t Ids[4]{};
    bool Ok = At(Info, 0x118, Home) && At(Info, 0x11c, Away) && Home == 2 && Away == 2 &&
        Read(static_cast<unsigned char*>(Info) + 0x48, Ids, 16) &&
        Read(static_cast<unsigned char*>(Info) + 0xb0, Ids + 2, 16);
    Log(LogLevel::Info, L"SOLO22 roster check home=" + std::to_wstring(Home) + L" away=" + std::to_wstring(Away));
    const uint64_t Expected[] = {R.Owner, R.Cpu[0], R.Cpu[1], R.Cpu[2]};
    for (unsigned I = 0; Ok && I < 4; ++I)
    {
        unsigned Matches = 0; uint32_t Source = 0;
        for (auto Id : Ids) Matches += Id == Expected[I];
        void* Player = Lookup ? Lookup(Session, Expected[I]) : nullptr;
        Ok = Matches == 1 && HasRoster(Player, Expected[I], I != 0) &&
            (!Prepared || (At(Player, 0x21f0, Source) && Source == 1));
    }
    return Ok;
}
inline void* __fastcall Generate(void* Session, void* ActorManager, void* Object)
{
    void* Player = OriginalGenerate(Session, ActorManager, Object);
    const DWORD NativeError = GetLastError();
    try
    {
        Request R{}; uint64_t Id = 0;
        if (LoadRequest(R) && At(Object, 0xa0, Id))
        {
            std::lock_guard<std::mutex> Lock(ReceiptMutex);
            Select(R);
            for (unsigned I = 0; I < 3; ++I) if (Id == R.Cpu[I])
            {
                Created[I] = HasRoster(Player, Id, true);
                Receipt(Created[I] ? nullptr : "native-cpu-roster-missing");
                Log(LogLevel::Info, L"SOLO22 generated CPU " + std::to_wstring(I) +
                    (Created[I] ? L" with native roster" : L" refused: native roster missing"));
            }
        }
    }
    catch (...) { Log(LogLevel::Error, L"SOLO22 readiness receipt failed"); }
    SetLastError(NativeError);
    return Player;
}
// StartGame receives the native 0x590-byte game-info, before session/AI init.
// Reject only our nonce. Normal local games and multiplayer retain their original calls.
inline void __fastcall Start(void* Session, void* Info)
{
    const DWORD NativeError = GetLastError();
    Request R{}; uint64_t Match = 0, Slots[10]{};
    const bool HasMatch = At(Info, MatchOffset, Match);
    bool Generated = false;
    if (Info && Read(static_cast<unsigned char*>(Info) + 0x48, Slots, 40) &&
        Read(static_cast<unsigned char*>(Info) + 0xb0, Slots + 5, 40))
        for (auto Id : Slots) Generated |= (Id & CpuMask) == CpuPrefix;
    bool PreviousMatch = false;
    { std::lock_guard<std::mutex> Lock(ReceiptMutex); PreviousMatch = HasMatch && Current.Match && Match == Current.Match; }
    const bool Loaded = LoadRequest(R);
    const bool Requested = Loaded && HasMatch && Match == R.Match;
    if (!Requested)
    {
        if (Generated || PreviousMatch)
        {
            std::wostringstream Detail;
            Detail << L"SOLO22 refused StartGame: request-loaded=" << Loaded
                   << L" match-readable=" << HasMatch << std::hex
                   << L" game-match=0x" << Match << L" request-match=0x" << R.Match;
            Log(LogLevel::Error, Detail.str());
            { std::lock_guard<std::mutex> Lock(ReceiptMutex);
              Receipt(Loaded ? "native-start-match-mismatch" : "native-start-request-unavailable"); }
            SetLastError(NativeError); return;
        }
        SetLastError(NativeError); OriginalStart(Session, Info); return;
    }
    bool Ok = false;
    try
    {
        Ok = Validate(Session, Info, R, false);
        std::lock_guard<std::mutex> Lock(ReceiptMutex);
        Select(R); Receipt(Ok ? nullptr : "native-start-roster-validation-failed");
    }
    catch (...) { Ok = false; }
    if (!Ok)
    {
        Log(LogLevel::Error, L"SOLO22 refused StartGame: expected registered 2v2 players with native rosters");
        SetLastError(NativeError); return;
    }
    Log(LogLevel::Info, L"SOLO22 StartGame validated: one human and three native CPU rosters");
    SetLastError(NativeError); OriginalStart(Session, Info);
}
inline uint64_t __fastcall Playing(void* Session)
{
    const DWORD NativeError = GetLastError();
    uint64_t Match = 0; Request R{};
    void* Info = Session ? static_cast<unsigned char*>(Session) + 0xcb0 : nullptr;
    bool Ours = false;
    if (At(Info, MatchOffset, Match))
    {
        std::lock_guard<std::mutex> Lock(ReceiptMutex);
        Ours = Current.Match && Match == Current.Match;
    }
    if (!Ours) { SetLastError(NativeError); return OriginalPlaying(Session); }
    bool Ok = false;
    try
    {
        Ok = LoadRequest(R) && R.Match == Match && Validate(Session, Info, R, true);
        std::lock_guard<std::mutex> Lock(ReceiptMutex);
        if (!Ok) Receipt("native-playing-roster-validation-failed");
    }
    catch (...) { Ok = false; }
    if (!Ok)
    {
        Log(LogLevel::Error, L"SOLO22 refused InitPlayingGame: prepared 2v2 roster is incomplete");
        SetLastError(NativeError); return 0;
    }
    Log(LogLevel::Info, L"SOLO22 InitPlayingGame validated: four prepared native player rosters");
    Log(LogLevel::Info, L"SOLO22 AI initialization counts: native=" +
        std::to_wstring(OriginalHomeCount()) + L"/" + std::to_wstring(OriginalAwayCount()) + L" roster=2/2");
    SetLastError(NativeError);
    uint64_t Result = 0;
    {
        // AI_FillInGameDescription reads these getters before creating AI players.
        // Restrict the roster-derived counts to this validated solo initialization thread.
        InitScope Scope;
        Result = OriginalPlaying(Session);
    }
    const DWORD PlayingError = GetLastError();
    { std::lock_guard<std::mutex> Lock(ReceiptMutex);
      Receipt(Result ? nullptr : "native-playing-init-failed", Result != 0); }
    Log(LogLevel::Info, L"SOLO22 InitPlayingGame returned " + std::to_wstring(Result));
    SetLastError(PlayingError);
    return Result;
}
struct Site { size_t Rva; const char* Bytes; size_t Size; void* Detour; void** Original; };
inline const Site Sites[] = {
    {0x166b330, "\x48\x8b\xc4\x55\x53\x56\x41\x55\x41\x56\x48\x8d\x68\x88\x48\x81\xec\x50\x01\x00\x00", 21,
        reinterpret_cast<void*>(&Generate), reinterpret_cast<void**>(&OriginalGenerate)},
    {0x16ff0c0, "\x40\x55\x56\x41\x54\x41\x56\x48\x8d\xac\x24\x48\xfd\xff\xff\x48\x81\xec\xb8\x03\x00\x00", 22,
        reinterpret_cast<void*>(&Start), reinterpret_cast<void**>(&OriginalStart)},
    {0x169da60, "\x40\x55\x56\x41\x56\x48\x8d\xac\x24\x40\xfa\xff\xff\x48\x81\xec\xc0\x06\x00\x00", 20,
        reinterpret_cast<void*>(&Playing), reinterpret_cast<void**>(&OriginalPlaying)},
    {0x10d3e80, "\x8b\x05\x0a\x06\x1b\x05\xc3", 7,
        reinterpret_cast<void*>(&HomeCount), reinterpret_cast<void**>(&OriginalHomeCount)},
    {0x10d3e70, "\x8b\x05\x1e\x06\x1b\x05\xc3", 7,
        reinterpret_cast<void*>(&AwayCount), reinterpret_cast<void**>(&OriginalAwayCount)},
    {0x167d3c0, "\x48\x89\x5c\x24\x18\x48\x89\x6c\x24\x20\x57\x48\x83\xec\x20", 15, nullptr, nullptr},
};
inline constexpr DWORD ReadinessTimeoutMs = 30'000, ReadinessPollMs = 250;
inline std::atomic_bool InstallStarted = false;
struct SignatureFailure
{
    const Site* Where = nullptr;
    unsigned char Bytes[32]{};
    SIZE_T ReadSize = 0;
    bool ReadOk = false;
    DWORD Error = ERROR_SUCCESS;
};
inline bool CheckSignatures(HMODULE Executable, SignatureFailure& Failure)
{
    auto* Base = reinterpret_cast<unsigned char*>(Executable);
    for (const auto& S : Sites)
    {
        SignatureFailure Probe{};
        Probe.Where = &S;
        Probe.ReadOk = ReadProcessMemory(GetCurrentProcess(), Base + S.Rva, Probe.Bytes,
            S.Size, &Probe.ReadSize) != FALSE;
        Probe.Error = Probe.ReadOk ? ERROR_SUCCESS : GetLastError();
        if (!Probe.ReadOk || Probe.ReadSize != S.Size || memcmp(Probe.Bytes, S.Bytes, S.Size))
        { Failure = Probe; return false; }
    }
    return true;
}
inline std::wstring SignatureDetail(const SignatureFailure& Failure)
{
    const auto& S = *Failure.Where;
    std::wostringstream Text;
    Text << L"rva=0x" << std::hex << S.Rva << L" read=" << (Failure.ReadOk ? L"ok" : L"failed")
         << L" error=0x" << Failure.Error << std::dec << L" read-bytes=" << Failure.ReadSize << L"/" << S.Size;
    Text << std::hex << L" expected=[";
    Text.fill(L'0');
    for (size_t I = 0; I < S.Size; ++I)
    {
        if (I) Text << L' ';
        Text.width(2); Text << static_cast<unsigned>(static_cast<unsigned char>(S.Bytes[I]));
    }
    Text << L"] actual=[";
    for (size_t I = 0; I < Failure.ReadSize && I < S.Size; ++I)
    {
        if (I) Text << L' ';
        Text.width(2); Text << static_cast<unsigned>(Failure.Bytes[I]);
    }
    Text << L"]";
    return Text.str();
}
inline void InstallHooks(HMODULE Executable)
{
    auto* Base = reinterpret_cast<unsigned char*>(Executable);
    size_t Made = 0, Enabled = 0;
    MH_STATUS Status = MH_OK;
    for (unsigned I = 0; I < 5; ++I)
    {
        Status = MH_CreateHook(Base + Sites[I].Rva, Sites[I].Detour, Sites[I].Original);
        if (Status != MH_OK) break;
        ++Made;
    }
    // Hooks can be called as soon as they are enabled; publish Lookup first.
    if (Made == 5)
    {
        Lookup = reinterpret_cast<LookupFn>(Base + Sites[5].Rva);
        for (unsigned I = 0; I < 5; ++I)
        {
            Status = MH_EnableHook(Base + Sites[I].Rva);
            if (Status != MH_OK) break;
            ++Enabled;
        }
    }
    if (Made != 5 || Enabled != 5)
    {
        for (unsigned I = 0; I < Enabled; ++I) MH_DisableHook(Base + Sites[I].Rva);
        for (unsigned I = 0; I < Made; ++I) MH_RemoveHook(Base + Sites[I].Rva);
        std::wostringstream Detail;
        Detail << L"SOLO22 refused: hook installation failed rva=0x" << std::hex
               << Sites[Made != 5 ? Made : Enabled].Rva << std::dec << L" status=" << Status;
        Log(LogLevel::Error, Detail.str()); return;
    }
    { std::lock_guard<std::mutex> Lock(ReceiptMutex); Receipt(); }
    Log(LogLevel::Info, L"SOLO22 enabled: native generated-player receipts and guarded 2v2 start");
}
inline DWORD WINAPI WaitAndInstall(void* Context)
{
    const auto Executable = static_cast<HMODULE>(Context);
    const ULONGLONG Started = GetTickCount64();
    try
    {
        for (;;)
        {
            SignatureFailure Failure{};
            if (CheckSignatures(Executable, Failure))
            {
                Log(LogLevel::Info, L"SOLO22 native code ready after " +
                    std::to_wstring(GetTickCount64() - Started) + L" ms; installing hooks");
                InstallHooks(Executable); return 0;
            }
            const ULONGLONG Elapsed = GetTickCount64() - Started;
            if (Elapsed >= ReadinessTimeoutMs)
            {
                Log(LogLevel::Error, L"SOLO22 refused: native build signature mismatch after " +
                    std::to_wstring(Elapsed) + L" ms waiting; " + SignatureDetail(Failure));
                return 1;
            }
            const DWORD Remaining = static_cast<DWORD>(ReadinessTimeoutMs - Elapsed);
            Sleep(Remaining < ReadinessPollMs ? Remaining : ReadinessPollMs);
        }
    }
    catch (...) { Log(LogLevel::Error, L"SOLO22 refused: native readiness worker failed"); return 1; }
}
inline void Install(HMODULE Executable)
{
    // Always install for the supported NBA2K22 build; no opt-in flag file.
    if (!Executable || GetModuleHandleW(L"nba2k22.exe") != Executable) return;
    if (InstallStarted.exchange(true)) return;
    Root = ModuleDirectory();
    DeleteFileW((Root + L"\\SoloParkNative.ready.json").c_str());
    SignatureFailure Failure{};
    if (CheckSignatures(Executable, Failure)) { InstallHooks(Executable); return; }

    // The packed executable restores .text during startup. Wait outside Initialise
    // so WinHTTP redirection and the other enabled features remain available.
    Log(LogLevel::Info, L"SOLO22 waiting for native code signatures (up to " +
        std::to_wstring(ReadinessTimeoutMs) + L" ms); " + SignatureDetail(Failure));
    if (HANDLE Thread = CreateThread(nullptr, 0, WaitAndInstall, Executable, 0, nullptr)) CloseHandle(Thread);
    else
    {
        const DWORD Error = GetLastError();
        InstallStarted = false;
        Log(LogLevel::Error, L"SOLO22 refused: native readiness thread could not start: " + std::to_wstring(Error));
    }
}
}
