// Native generated-player readiness and 2v2/3v3 validation. No roster-pointer patching.
#pragma once
#include <atomic>
#include <cstddef>
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
inline thread_local uint32_t InitializingTeamSize = 0;
struct InitScope
{
    bool Previous = InitializingSolo;
    uint32_t PreviousSize = InitializingTeamSize;
    explicit InitScope(uint32_t TeamSize = 2) { InitializingSolo = true; InitializingTeamSize = TeamSize; }
    ~InitScope() { InitializingSolo = Previous; InitializingTeamSize = PreviousSize; }
};
struct RosterOrderScope
{
    uint32_t* SortFlag;
    uint32_t Previous;
    RosterOrderScope(uint32_t* Flag, uint32_t Value) noexcept : SortFlag(Flag), Previous(Value)
    {
        *SortFlag = 0;
    }
    ~RosterOrderScope() { *SortFlag = Previous; }
    RosterOrderScope(const RosterOrderScope&) = delete;
    RosterOrderScope& operator=(const RosterOrderScope&) = delete;
};
inline int __fastcall HomeCount() { return InitializingSolo ? static_cast<int>(InitializingTeamSize) : OriginalHomeCount(); }
inline int __fastcall AwayCount() { return InitializingSolo ? static_cast<int>(InitializingTeamSize) : OriginalAwayCount(); }
using LookupFn = void*(__fastcall*)(void*, uint64_t);
// FUN_1416B4A30 writes MatchId at uint32_t[0xb6], RandomSeed at [0xd0].
inline constexpr size_t MatchOffset = 0xb6 * sizeof(uint32_t);
static_assert(MatchOffset == 0x2d8);
inline constexpr size_t RosterSortOffset = 0x2bc;
static_assert(0xcb0 + RosterSortOffset == 0xf6c);
inline GenerateFn OriginalGenerate = nullptr;
inline StartFn OriginalStart = nullptr;
inline PlayingFn OriginalPlaying = nullptr;
inline void (*BeforeStart)(void*, void*) = nullptr;
inline bool (*FrameTimingReady)() = nullptr;
inline void StartPrepared(void* Session, void* Info)
{
    const DWORD Error = GetLastError();
    if (BeforeStart) BeforeStart(Session, Info);
    SetLastError(Error);
    OriginalStart(Session, Info);
}
inline LookupFn Lookup = nullptr;
inline constexpr uint64_t CpuMask = 0xfffff00000000000ULL;
inline constexpr uint64_t CpuPrefix = 0x0222c00000000000ULL;
inline constexpr unsigned MaxCpu = 5;
struct Request
{
    uint32_t Magic, Version;
    uint64_t Match, Owner;
    uint32_t TeamSize, CpuCount;
    uint64_t Cpu[MaxCpu];
    uint32_t Seeds[MaxCpu];
    uint32_t Reserved;
};
static_assert(sizeof(Request) == 96 && offsetof(Request, TeamSize) == 24 && offsetof(Request, Cpu) == 32 && offsetof(Request, Seeds) == 72);
inline Request Current{};
inline bool Created[MaxCpu]{};
inline std::array<CpuEnhancement::Snapshot, MaxCpu> Profiles{};
inline std::string GenerationError;
inline std::mutex ReceiptMutex;
inline bool NetworkManaged = false, ReceiptStarted = false;
inline Request NetworkRequest{};
inline uint64_t NetworkEpoch = 0;
inline ULONGLONG NetworkDeadline = 0;
struct NetworkEnvelope
{
    uint64_t Instance, Epoch;
    uint32_t LeaseMs, Reserved;
    Request Data;
};
static_assert(sizeof(NetworkEnvelope) == 120 && offsetof(NetworkEnvelope, Data) == 24);

inline bool Read(const void* Address, void* Out, size_t Size)
{
    SIZE_T N = 0;
    return Address && ReadProcessMemory(GetCurrentProcess(), Address, Out, Size, &N) && N == Size;
}
template<class T> inline bool At(const void* Base, size_t Offset, T& Value)
{
    return Base && Read(static_cast<const unsigned char*>(Base) + Offset, &Value, sizeof(Value));
}
inline bool ValidRequest(const Request& R)
{
    if (R.Magic != 0x32325053 || R.Version != 3 || R.Reserved || !R.Match || !R.Owner ||
        (R.Owner & CpuMask) == CpuPrefix || (R.TeamSize != 2 && R.TeamSize != 3) ||
        R.CpuCount != R.TeamSize * 2 - 1) return false;
    for (unsigned I = R.CpuCount; I < MaxCpu; ++I) if (R.Cpu[I] || R.Seeds[I]) return false;
    for (unsigned I = 0; I < R.CpuCount; ++I)
    {
        if ((R.Cpu[I] & CpuMask) != CpuPrefix || R.Cpu[I] == R.Owner || !R.Seeds[I]) return false;
        for (unsigned J = 0; J < I; ++J) if (R.Cpu[J] == R.Cpu[I]) return false;
    }
    return true;
}
inline bool LoadRequest(Request& R)
{
    std::lock_guard<std::mutex> Lock(ReceiptMutex);
    if (!NetworkManaged || GetTickCount64() >= NetworkDeadline) return false;
    R = NetworkRequest;
    return ValidRequest(R);
}
inline void Select(const Request& R)
{
    if (memcmp(&Current, &R, sizeof(R)))
    { Current = R; memset(Created, 0, sizeof(Created)); Profiles = {}; GenerationError.clear(); ReceiptStarted = false; }
}
inline std::string BuildReceipt(const char* Error = nullptr, bool Started = false, uint64_t Instance = 0)
{
    if (Error && GenerationError.empty()) GenerationError = Error;
    ReceiptStarted |= Started;
    std::ostringstream Text;
    Text << "{\"version\":3,\"module\":\"00010215\",\"installed\":" <<
        (CpuEnhancement::Ready && (!FrameTimingReady || FrameTimingReady()) ? "true" : "false") << ",\"pid\":" << GetCurrentProcessId()
         << ",\"match\":\"" << std::hex << Current.Match << "\",\"teamSize\":" << std::dec << Current.TeamSize
         << ",\"cpuCount\":" << Current.CpuCount << ",\"created\":[";
    bool First = true;
    for (unsigned I = 0; I < Current.CpuCount; ++I) if (Created[I])
    {
        if (!First) Text << ',';
        Text << '\"' << std::hex << Current.Cpu[I] << '\"'; First = false;
    }
    Text << "],\"profiles\":["; First = true;
    for (unsigned I = 0; I < Current.CpuCount; ++I) if (Created[I])
    {
        if (!First) Text << ',';
        const auto& P = Profiles[I];
        Text << "{\"id\":\"" << std::hex << Current.Cpu[I] << "\",\"seed\":" << std::dec << Current.Seeds[I]
             << ",\"overall\":" << P.Rating << ",\"height\":" << P.Height / 100 << ",\"shape\":[";
        for (size_t J = 0; J < P.Shape.size(); ++J)
        {
            if (J) Text << ',';
            float Value = 0; memcpy(&Value, &P.Shape[J], sizeof(Value)); Text << Value;
        }
        Text << "]}"; First = false;
    }
    Text << "],\"started\":" << (ReceiptStarted ? "true" : "false") << ",\"error\":";
    if (!GenerationError.empty()) Text << '"' << GenerationError << '"'; else Text << "null";
    Text << ",\"instance\":\"" << std::hex << Instance << "\",\"epoch\":\"" << NetworkEpoch
         << "\",\"armed\":" << (NetworkManaged && GetTickCount64() < NetworkDeadline ? "true" : "false") << "}\n";
    return Text.str();
}
inline void Receipt(const char* Error = nullptr, bool Started = false)
{
    if (Error && GenerationError.empty()) GenerationError = Error;
    ReceiptStarted |= Started;
}
inline std::string NetworkReceipt(uint64_t Instance)
{
    std::lock_guard<std::mutex> Lock(ReceiptMutex);
    return BuildReceipt(nullptr, false, Instance);
}
inline void RevokeNetwork()
{
    std::lock_guard<std::mutex> Lock(ReceiptMutex);
    NetworkDeadline = 0; // Expire the active request lease; hooks refuse the request after this point.
}
inline bool NetworkReply(const void* Bytes, size_t Size, uint64_t Instance)
{
    NetworkEnvelope E{};
    if (Size != sizeof(E)) { RevokeNetwork(); return false; }
    memcpy(&E, Bytes, sizeof(E));
    if (E.Instance != Instance || !E.Epoch || E.Reserved || !E.LeaseMs || E.LeaseMs > 8000 || !ValidRequest(E.Data))
    { RevokeNetwork(); return false; }
    std::lock_guard<std::mutex> Lock(ReceiptMutex);
    if (NetworkManaged && NetworkEpoch == E.Epoch && NetworkRequest.Match == E.Data.Match &&
        memcmp(&NetworkRequest, &E.Data, sizeof(E.Data))) { NetworkDeadline = 0; return false; }
    NetworkManaged = true; NetworkRequest = E.Data; NetworkEpoch = E.Epoch;
    NetworkDeadline = GetTickCount64() + E.LeaseMs;
    Select(E.Data);
    return true;
}
inline bool HasRoster(void* Player, uint64_t Id, bool Cpu)
{
    uint64_t Puid = 0; void* Container = nullptr; void* Roster = nullptr; uint32_t Flags = 0, Value = 0;
    return At(Player, 0xf0, Puid) && Puid == Id && At(Player, 0x2200, Flags) && (!Cpu || (Flags & 8)) &&
        At(Player, 0x446c0, Container) && At(Container, 0x28, Roster) && At(Roster, 0xf8, Value);
}
inline bool Validate(void* Session, void* Info, const Request& R, bool Prepared)
{
    if ((R.TeamSize != 2 && R.TeamSize != 3) || R.CpuCount != R.TeamSize * 2 - 1) return false;
    std::array<CpuEnhancement::Snapshot, MaxCpu> ExpectedProfiles{};
    {
        std::lock_guard<std::mutex> Lock(ReceiptMutex);
        if (memcmp(&Current, &R, sizeof(R)) || !GenerationError.empty()) return false;
        for (unsigned I = 0; I < R.CpuCount; ++I) if (!Created[I]) return false;
        ExpectedProfiles = Profiles;
    }
    int Home = 0, Away = 0; uint64_t Ids[6]{};
    const unsigned Count = R.TeamSize * 2;
    const size_t SideBytes = R.TeamSize * sizeof(uint64_t);
    bool Ok = At(Info, 0x118, Home) && At(Info, 0x11c, Away) &&
        Home == static_cast<int>(R.TeamSize) && Away == static_cast<int>(R.TeamSize) &&
        Read(static_cast<unsigned char*>(Info) + 0x48, Ids, SideBytes) &&
        Read(static_cast<unsigned char*>(Info) + 0xb0, Ids + R.TeamSize, SideBytes);
    Log(LogLevel::Info, L"SOLO22 roster check home=" + std::to_wstring(Home) + L" away=" + std::to_wstring(Away));
    for (unsigned I = 0; Ok && I < Count; ++I)
    {
        const uint64_t Expected = I ? R.Cpu[I - 1] : R.Owner;
        unsigned Matches = 0; uint32_t Source = 0;
        for (unsigned J = 0; J < Count; ++J) Matches += Ids[J] == Expected;
        void* Player = Lookup ? Lookup(Session, Expected) : nullptr;
        Ok = Matches == 1 && HasRoster(Player, Expected, I != 0) &&
            (!I || CpuEnhancement::Verify(Player, Expected, ExpectedProfiles[I - 1])) &&
            (!Prepared || (At(Player, 0x21f0, Source) && Source == 1));
    }
    return Ok;
}
inline bool AuthorizeProfile(const void* RequestData)
{
    Request Live{};
    return LoadRequest(Live) && !memcmp(&Live, RequestData, sizeof(Live));
}
inline void* __fastcall Generate(void* Session, void* ActorManager, void* Object)
{
    const DWORD EntryError = GetLastError();
    NativePark::Generation G{}; uint64_t GeneratedId = 0;
    if (At(Object, 0xa0, GeneratedId) && NativePark::ForCpu(Session, GeneratedId, G))
    {
        if (!G.Valid) { NativePark::Fail(G.Request, 4); SetLastError(EntryError); return nullptr; }
        void* Player = nullptr;
        {
            NativePark::GenerationScope Scope(G);
            SetLastError(EntryError);
            Player = OriginalGenerate(Session, ActorManager, Object);
        }
        const DWORD Error = GetLastError();
        NativePark::Generated(G, Player);
        SetLastError(Error); return Player;
    }
    Request R{};
    if (GeneratedId && LoadRequest(R)) for (unsigned I = 0; I < R.CpuCount; ++I) if (GeneratedId == R.Cpu[I])
    {
        CpuEnhancement::Generation P{};
        P.Session = Session; P.Id = GeneratedId; P.Seed = R.Seeds[I];
        P.Authority = &R; P.Authorized = &AuthorizeProfile;
        unsigned char* Entries = nullptr;
        P.Valid = CpuEnhancement::Ready && NativePark::Pool(P.PoolCount, P.PoolDigest, Entries);
        if (P.Valid) P.Template = P.Seed % P.PoolCount;
        else P.Error = CpuEnhancement::Ready ? "generation-pool" : "enhancement-not-ready";
        void* Player = nullptr;
        if (P.Valid)
        {
            CpuEnhancement::Scope Scope(P);
            SetLastError(EntryError);
            Player = OriginalGenerate(Session, ActorManager, Object);
        }
        const DWORD NativeError = GetLastError();
        try
        {
            const bool Ok = CpuEnhancement::Finish(P, Player);
            if (AuthorizeProfile(&R))
            {
                std::lock_guard<std::mutex> Lock(ReceiptMutex);
                Select(R); Created[I] = Ok;
                if (Ok) Profiles[I] = P.Expected;
                const std::string Error = Ok ? std::string{} : "native-cpu-enhancement-" + P.Error;
                Receipt(Ok ? nullptr : Error.c_str());
                Log(Ok ? LogLevel::Info : LogLevel::Error, L"SOLO22 CPU " + std::to_wstring(I) + (Ok ?
                    L" verified: OVR=" + std::to_wstring(P.Expected.Rating) + L" height-cm=" + std::to_wstring(P.Expected.Height / 100) :
                    L" refused: " + std::wstring(P.Error.begin(), P.Error.end())));
            }
        }
        catch (...) { Log(LogLevel::Error, L"SOLO22 enhanced CPU receipt failed"); }
        SetLastError(NativeError); return Player;
    }
    SetLastError(EntryError);
    return OriginalGenerate(Session, ActorManager, Object);
}
// StartGame receives the native 0x590-byte game-info, before session/AI init.
// Reject only our nonce. Normal local games and multiplayer retain their original calls.
inline void __fastcall Start(void* Session, void* Info)
{
    const DWORD NativeError = GetLastError();
    Request R{}; uint64_t Match = 0, Slots[10]{};
    const bool HasMatch = At(Info, MatchOffset, Match);
    NativePark::Manifest Mixed{};
    if (HasMatch && NativePark::ForMatch(Match, Mixed))
    {
        bool Ok = false;
        try { Ok = NativePark::Validate(Session, Info, Mixed, false, Lookup); } catch (...) { Ok = false; }
        if (!Ok)
        {
            NativePark::Fail(Mixed, 5);
            Log(LogLevel::Error, L"PARK22 refused StartGame: authorization, online setup or exact roster validation failed");
            SetLastError(NativeError); return;
        }
        Log(LogLevel::Info, L"PARK22 validated native mixed roster before StartGame");
        SetLastError(NativeError); StartPrepared(Session, Info); return;
    }
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
        SetLastError(NativeError); StartPrepared(Session, Info); return;
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
        Log(LogLevel::Error, L"SOLO22 refused StartGame: expected complete 2v2/3v3 native rosters");
        SetLastError(NativeError); return;
    }
    Log(LogLevel::Info, L"SOLO22 StartGame validated: one human and " + std::to_wstring(R.CpuCount) + L" native CPU rosters");
    SetLastError(NativeError); StartPrepared(Session, Info);
}
inline uint64_t __fastcall Playing(void* Session)
{
    const DWORD NativeError = GetLastError();
    uint64_t Match = 0; Request R{};
    uint32_t SortRoster = 0;
    void* Info = Session ? static_cast<unsigned char*>(Session) + 0xcb0 : nullptr;
    NativePark::Manifest Mixed{};
    if (At(Info, MatchOffset, Match) && NativePark::ForMatch(Match, Mixed))
    {
        bool Ok = false;
        try { Ok = NativePark::Validate(Session, Info, Mixed, true, Lookup) && At(Info, RosterSortOffset, SortRoster); }
        catch (...) { Ok = false; }
        if (!Ok)
        {
            NativePark::Fail(Mixed, 6);
            Log(LogLevel::Error, L"PARK22 refused InitPlayingGame: prepared mixed roster or authorization invalid");
            SetLastError(NativeError); return 0;
        }
        uint64_t Result = 0;
        SetLastError(NativeError);
        {
            InitScope Scope(Mixed.TeamSize);
            RosterOrderScope Order(reinterpret_cast<uint32_t*>(static_cast<unsigned char*>(Info) + RosterSortOffset), SortRoster);
            Result = OriginalPlaying(Session);
        }
        const DWORD Error = GetLastError();
        NativePark::Started(Mixed, Result != 0);
        Log(LogLevel::Info, L"PARK22 InitPlayingGame returned " + std::to_wstring(Result));
        SetLastError(Error); return Result;
    }
    bool Ours = false;
    if (At(Info, MatchOffset, Match))
    {
        std::lock_guard<std::mutex> Lock(ReceiptMutex);
        Ours = Current.Match && Match == Current.Match;
    }
    if (!Ours)
    {
        uint64_t Ids[10]{}; int Home = 0, Away = 0;
        if (At(Info, 0x118, Home) && At(Info, 0x11c, Away) && Home > 0 && Home <= 5 && Away > 0 && Away <= 5 &&
            Read(static_cast<unsigned char*>(Info) + 0x48, Ids, static_cast<size_t>(Home) * sizeof(uint64_t)) &&
            Read(static_cast<unsigned char*>(Info) + 0xb0, Ids + 5, static_cast<size_t>(Away) * sizeof(uint64_t)))
            for (const auto Id : Ids) if (NativePark::IsCpu(Id))
            {
                Log(LogLevel::Error, L"PARK22 refused delayed generated roster without its match authorization");
                SetLastError(NativeError); return 0;
            }
        SetLastError(NativeError); return OriginalPlaying(Session);
    }
    bool Ok = false;
    try
    {
        Ok = LoadRequest(R) && R.Match == Match && Validate(Session, Info, R, true) &&
            At(Info, RosterSortOffset, SortRoster);
        std::lock_guard<std::mutex> Lock(ReceiptMutex);
        if (!Ok) Receipt("native-playing-roster-validation-failed");
    }
    catch (...) { Ok = false; }
    if (!Ok)
    {
        Log(LogLevel::Error, L"SOLO22 refused InitPlayingGame: prepared 2v2/3v3 roster is incomplete");
        SetLastError(NativeError); return 0;
    }
    Log(LogLevel::Info, L"SOLO22 InitPlayingGame validated: " + std::to_wstring(R.TeamSize * 2) + L" prepared native player rosters");
    Log(LogLevel::Info, L"SOLO22 AI initialization counts: native=" +
        std::to_wstring(OriginalHomeCount()) + L"/" + std::to_wstring(OriginalAwayCount()) +
        L" roster=" + std::to_wstring(R.TeamSize) + L"/" + std::to_wstring(R.TeamSize));
    SetLastError(NativeError);
    uint64_t Result = 0;
    {
        // AI_FillInGameDescription reads these getters before creating AI players.
        // Restrict the roster-derived counts to this validated solo initialization thread.
        InitScope Scope(R.TeamSize);
        // Park nameplates retain court order; keep model slots in that same order.
        RosterOrderScope Order(reinterpret_cast<uint32_t*>(
            static_cast<unsigned char*>(Info) + RosterSortOffset), SortRoster);
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
    {CpuEnhancement::ApiSites[0].Rva, CpuEnhancement::ApiSites[0].Bytes, CpuEnhancement::ApiSites[0].Size, nullptr, nullptr},
    {CpuEnhancement::ApiSites[1].Rva, CpuEnhancement::ApiSites[1].Bytes, CpuEnhancement::ApiSites[1].Size, nullptr, nullptr},
    {CpuEnhancement::ApiSites[2].Rva, CpuEnhancement::ApiSites[2].Bytes, CpuEnhancement::ApiSites[2].Size, nullptr, nullptr},
    {CpuEnhancement::ApiSites[3].Rva, CpuEnhancement::ApiSites[3].Bytes, CpuEnhancement::ApiSites[3].Size, nullptr, nullptr},
    {CpuEnhancement::ApiSites[4].Rva, CpuEnhancement::ApiSites[4].Bytes, CpuEnhancement::ApiSites[4].Size, nullptr, nullptr},
    {CpuEnhancement::ApiSites[5].Rva, CpuEnhancement::ApiSites[5].Bytes, CpuEnhancement::ApiSites[5].Size, nullptr, nullptr},
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
    try { NativePark::Install(Executable); }
    catch (...) { Log(LogLevel::Error, L"PARK22 enhanced CPU hook installation failed"); }
    { std::lock_guard<std::mutex> Lock(ReceiptMutex); Receipt(); }
    Log(LogLevel::Info, CpuEnhancement::Ready ?
        L"SOLO22 enabled: protocol v3 enhanced CPU receipts and guarded 2v2/3v3 start" :
        L"SOLO22 unavailable: enhanced CPU hook is not ready");
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
