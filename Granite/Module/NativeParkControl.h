// NBA 2K22 mixed park: bounded v3 control channel and deterministic CPU templates.
#pragma once

namespace NativePark
{
inline constexpr uint32_t Version = 3, ModuleVersion = 0x0001020f;
inline constexpr uint32_t ManifestMagic = 0x3232504d, ReportMagic = 0x3352504d;
inline constexpr uint64_t CpuMask = 0xfffff00000000000ULL, CpuPrefix = 0x0222c00000000000ULL;
inline constexpr uint32_t MaxTemplates = 72, MaxLeaseMs = 8000;
struct Manifest
{
    uint32_t Magic, Protocol;
    uint64_t Epoch, Match;
    uint32_t LeaseMs, Phase;
    uint64_t LocalPuid;
    uint32_t TeamSize, HumanMask, PoolCount, Reserved;
    unsigned char Digest[32];
    uint64_t Players[6];
    uint32_t Seeds[6], Templates[6];
};
struct Report
{
    uint32_t Magic = ReportMagic, Protocol = Version, Module = ModuleVersion, Flags = 0;
    uint64_t Instance = 0, Epoch = 0, Match = 0;
    uint32_t PoolCount = 0, Created = 0, Error = 0, Reserved = 0;
    unsigned char Digest[32]{};
};
static_assert(sizeof(Manifest) == 184 && offsetof(Manifest, Digest) == 56 && offsetof(Manifest, Players) == 88);
static_assert(offsetof(Manifest, Seeds) == 136 && offsetof(Manifest, Templates) == 160);
static_assert(sizeof(Report) == 88 && offsetof(Report, Digest) == 56);
inline bool IsCpu(uint64_t Id) { return (Id & CpuMask) == CpuPrefix; }
inline unsigned char* ExeBase = nullptr;
inline std::atomic_bool Installed = false;
inline std::mutex StateMutex;
struct StateData
{
    Manifest Request{};
    ULONGLONG Deadline = 0;
    uint32_t Created = 0, Error = 0;
    bool Active = false, Started = false;
};
inline StateData State;
struct ControlData
{
    std::wstring Session;
    INTERNET_PORT Port = 0;
    uint64_t Generation = 1;
};
inline std::mutex ControlMutex;
inline ControlData Control;
inline constexpr wchar_t ControlPath[] = L"/native-park/v3/poll";

inline bool Read(const void* Address, void* Out, size_t Size)
{
    SIZE_T N = 0;
    return Address && ReadProcessMemory(GetCurrentProcess(), Address, Out, Size, &N) && N == Size;
}
template<class T> inline bool At(const void* Base, size_t Offset, T& Value)
{
    return Base && Read(static_cast<const unsigned char*>(Base) + Offset, &Value, sizeof(Value));
}
inline bool Sha256(const std::vector<unsigned char>& Bytes, unsigned char (&Digest)[32])
{
    struct Algorithm
    {
        BCRYPT_ALG_HANDLE Handle = nullptr;
        ~Algorithm() { if (Handle) BCryptCloseAlgorithmProvider(Handle, 0); }
    } Algorithm;
    // BCryptDestroyHash must run before its backing object buffer is freed.
    std::vector<unsigned char> Object;
    struct Hash
    {
        BCRYPT_HASH_HANDLE Handle = nullptr;
        ~Hash() { if (Handle) BCryptDestroyHash(Handle); }
    } Hash;
    DWORD Size = 0, Got = 0;
    if (BCryptOpenAlgorithmProvider(&Algorithm.Handle, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0 ||
        BCryptGetProperty(Algorithm.Handle, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&Size), sizeof(Size), &Got, 0) < 0)
        return false;
    Object.resize(Size);
    return BCryptCreateHash(Algorithm.Handle, &Hash.Handle, Object.data(), Size, nullptr, 0, 0) >= 0 &&
        BCryptHashData(Hash.Handle, const_cast<PUCHAR>(Bytes.data()), static_cast<ULONG>(Bytes.size()), 0) >= 0 &&
        BCryptFinishHash(Hash.Handle, Digest, sizeof(Digest), 0) >= 0;
}
inline bool Pool(uint32_t& Count, unsigned char (&Digest)[32], unsigned char*& Entries)
{
    void* Owner = nullptr;
    if (!ExeBase || !Read(ExeBase + 0x63325e8, &Owner, sizeof(Owner)) || !Owner ||
        !At(Owner, 0x451808, Count) || !Count || Count > MaxTemplates) return false;
    Entries = static_cast<unsigned char*>(Owner) + 0x451810;
    std::vector<unsigned char> Bytes(static_cast<size_t>(Count) * 0x560);
    if (!Read(Entries, Bytes.data(), Bytes.size())) return false;
    constexpr size_t ZeroSlots[] = {0x60, 0x78, 0x80, 0x98, 0xa0, 0xa8, 0xb0, 0xb8, 0xc0, 0xc8, 0xd0, 0xd8, 0xe0};
    for (uint32_t I = 0; I < Count; ++I)
    {
        auto* Row = Bytes.data() + static_cast<size_t>(I) * 0x560;
        uint64_t Value = 0;
        for (const auto Offset : ZeroSlots)
        {
            memcpy(&Value, Row + Offset, sizeof(Value));
            if (Value) return false;
        }
        for (unsigned J = 0; J < 2; ++J)
        {
            const size_t Offset = J ? 0x90 : 0x88;
            const uint64_t Relative = J ? 0x520 : 0x4f0;
            memcpy(&Value, Row + Offset, sizeof(Value));
            if (Value != reinterpret_cast<uint64_t>(Entries + static_cast<size_t>(I) * 0x560) + Relative) return false;
            // Only these two exact, checked interior pointers are normalized.
            memcpy(Row + Offset, &Relative, sizeof(Relative));
        }
    }
    void* After = nullptr; uint32_t AfterCount = 0;
    return Read(ExeBase + 0x63325e8, &After, sizeof(After)) && After == Owner &&
        At(Owner, 0x451808, AfterCount) && AfterCount == Count && Sha256(Bytes, Digest);
}
inline uint32_t ActiveMask(const Manifest& M) { return M.TeamSize == 2 ? 0x1bU : 0x3fU; }
inline uint32_t CpuSlots(const Manifest& M) { return ActiveMask(M) & ~M.HumanMask; }
inline bool SameRoster(Manifest A, Manifest B)
{
    A.LeaseMs = B.LeaseMs = 0; A.Phase = B.Phase = 0;
    return memcmp(&A, &B, sizeof(A)) == 0;
}
inline bool ValidManifest(const Manifest& M)
{
    if (M.Magic != ManifestMagic || M.Protocol != Version || !M.Epoch || !M.Match || !M.LocalPuid ||
        !M.LeaseMs || M.LeaseMs > MaxLeaseMs || M.Phase < 1 || M.Phase > 4 || M.Reserved ||
        (M.TeamSize != 2 && M.TeamSize != 3) || !M.PoolCount || M.PoolCount > MaxTemplates ||
        (M.HumanMask & ~ActiveMask(M))) return false;
    unsigned Humans = 0, Local = 0;
    for (unsigned I = 0; I < 6; ++I)
    {
        const bool Used = (ActiveMask(M) & (1U << I)) != 0;
        const bool Human = (M.HumanMask & (1U << I)) != 0;
        if (!Used)
        {
            if (M.Players[I] || M.Seeds[I] || M.Templates[I] != UINT32_MAX) return false;
            continue;
        }
        if (!M.Players[I] || IsCpu(M.Players[I]) == Human) return false;
        for (unsigned J = 0; J < I; ++J) if (M.Players[I] == M.Players[J]) return false;
        if (Human)
        {
            ++Humans; Local += M.Players[I] == M.LocalPuid;
            if (M.Seeds[I] || M.Templates[I] != UINT32_MAX) return false;
        }
        else if (!M.Seeds[I] || M.Templates[I] >= M.PoolCount || M.Templates[I] != M.Seeds[I] % M.PoolCount)
            return false;
    }
    return Local == 1 && Humans >= 2 && Humans < M.TeamSize * 2;
}
inline bool LiveLocked(const Manifest& M)
{
    return State.Active && !State.Error && GetTickCount64() < State.Deadline && SameRoster(State.Request, M);
}
inline bool ForMatch(uint64_t Match, Manifest& M)
{
    std::lock_guard<std::mutex> Lock(StateMutex);
    if (!Match || State.Request.Match != Match) return false;
    M = State.Request; return true;
}
inline bool Authorized(const Manifest& M)
{
    std::lock_guard<std::mutex> Lock(StateMutex); return LiveLocked(M);
}
inline void Fail(const Manifest& M, uint32_t Error)
{
    std::lock_guard<std::mutex> Lock(StateMutex);
    if (State.Request.Epoch == M.Epoch && State.Request.Match == M.Match && !State.Error) State.Error = Error;
}
inline void Revoke()
{
    std::lock_guard<std::mutex> Lock(StateMutex);
    // Retain the last match identity so delayed native starts are still rejected.
    State.Active = false; State.Created = 0; State.Started = false; State.Error = 0; State.Deadline = 0;
}
inline void Accept(const Manifest& M)
{
    uint32_t Count = 0; unsigned char Digest[32]{}; unsigned char* Entries = nullptr;
    const bool Shape = ValidManifest(M), Ready = Shape && Pool(Count, Digest, Entries);
    std::lock_guard<std::mutex> Lock(StateMutex);
    if (!Shape || !Ready || Count != M.PoolCount || memcmp(Digest, M.Digest, sizeof(Digest)))
    {
        if (Shape) { State = StateData{}; State.Request = M; State.Error = Ready ? 2 : 8; }
        else if (State.Request.Match) State.Error = 1;
        State.Active = false; return;
    }
    const bool Same = State.Request.Epoch == M.Epoch && State.Request.Match == M.Match;
    if ((Same && (!SameRoster(State.Request, M) || M.Phase < State.Request.Phase)) || (!Same && M.Phase != 1))
    { State.Active = false; State.Error = 1; return; }
    if (!Same) State = StateData{};
    State.Request = M; State.Deadline = GetTickCount64() + M.LeaseMs; State.Active = true;
}
using LookupFn = void*(__fastcall*)(void*, uint64_t);
inline bool HasRoster(void* Player, uint64_t Id, bool Cpu)
{
    uint64_t Puid = 0; void* Container = nullptr; void* Roster = nullptr; uint32_t Flags = 0, Value = 0;
    return At(Player, 0xf0, Puid) && Puid == Id && At(Player, 0x2200, Flags) && (!Cpu || (Flags & 8)) &&
        At(Player, 0x446c0, Container) && At(Container, 0x28, Roster) && At(Roster, 0xf8, Value);
}
inline bool Validate(void* Session, void* Info, const Manifest& M, bool Prepared, LookupFn Lookup)
{
    if (!Authorized(M) || !Lookup) return false;
    {
        std::lock_guard<std::mutex> Lock(StateMutex);
        if ((State.Created & CpuSlots(M)) != CpuSlots(M)) return false;
    }
    int Home = 0, Away = 0; uint32_t Online = 0; uint64_t Ids[6]{};
    if (!At(Info, 0x118, Home) || !At(Info, 0x11c, Away) || Home != static_cast<int>(M.TeamSize) ||
        Away != static_cast<int>(M.TeamSize) || !At(Info, 0x304, Online) || !Online ||
        !Read(static_cast<unsigned char*>(Info) + 0x48, Ids, M.TeamSize * sizeof(uint64_t)) ||
        !Read(static_cast<unsigned char*>(Info) + 0xb0, Ids + 3, M.TeamSize * sizeof(uint64_t))) return false;
    for (unsigned I = 0; I < 6; ++I)
    {
        if (!(ActiveMask(M) & (1U << I))) continue;
        uint32_t Source = 0; void* Player = Lookup(Session, M.Players[I]);
        if (Ids[I] != M.Players[I] || !HasRoster(Player, M.Players[I], IsCpu(M.Players[I])) ||
            (Prepared && (!At(Player, 0x21f0, Source) || Source != 1))) return false;
    }
    return Authorized(M);
}
inline void Started(const Manifest& M, bool Ok)
{
    std::lock_guard<std::mutex> Lock(StateMutex);
    if (!SameRoster(State.Request, M)) return;
    State.Started = Ok;
    if (!Ok && !State.Error) State.Error = 7;
}
struct Generation
{
    Manifest Request{};
    void* Session = nullptr;
    unsigned Slot = 0;
    bool Valid = false, Seen = false;
};
inline thread_local Generation* Generating = nullptr;
struct GenerationScope
{
    Generation* Previous;
    explicit GenerationScope(Generation& G) : Previous(Generating) { Generating = &G; }
    ~GenerationScope() { Generating = Previous; }
    GenerationScope(const GenerationScope&) = delete;
    GenerationScope& operator=(const GenerationScope&) = delete;
};
inline bool ForCpu(void* Session, uint64_t Id, Generation& G)
{
    std::lock_guard<std::mutex> Lock(StateMutex);
    for (unsigned I = 0; I < 6; ++I) if (Id && State.Request.Players[I] == Id && IsCpu(Id))
    {
        G.Request = State.Request; G.Session = Session; G.Slot = I; G.Valid = LiveLocked(G.Request); return true;
    }
    return false;
}
inline void Generated(const Generation& G, void* Player)
{
    const bool Ok = G.Valid && G.Seen && HasRoster(Player, G.Request.Players[G.Slot], true);
    std::lock_guard<std::mutex> Lock(StateMutex);
    if (!SameRoster(State.Request, G.Request)) return;
    if (Ok && LiveLocked(G.Request)) State.Created |= 1U << G.Slot;
    else if (!State.Error) State.Error = 4;
}
using CreateFn = void*(__fastcall*)(void*, void*);
inline CreateFn OriginalCreate = nullptr;
inline void* __fastcall CreatePlayer(void* Session, void* Descriptor)
{
    auto* G = Generating;
    if (!G || _ReturnAddress() != ExeBase + 0x166b5f2) return OriginalCreate(Session, Descriptor);
    const DWORD EntryError = GetLastError();
    uint64_t Id = 0, Seed = 0; void* Previous = nullptr;
    uint32_t Count = 0; unsigned char Digest[32]{}; unsigned char* Entries = nullptr;
    bool Ok = false;
    try
    {
        Ok = G->Valid && Session == G->Session && _ReturnAddress() == ExeBase + 0x166b5f2 &&
            At(Descriptor, 0, Id) && Id == G->Request.Players[G->Slot] &&
            At(Descriptor, 0x50, Seed) && Seed == G->Request.Seeds[G->Slot] &&
            At(Descriptor, 0x18, Previous) && Authorized(G->Request) && Pool(Count, Digest, Entries) &&
            Count == G->Request.PoolCount && !memcmp(Digest, G->Request.Digest, sizeof(Digest));
        if (Ok && Previous)
        {
            const auto Offset = reinterpret_cast<uintptr_t>(Previous) - reinterpret_cast<uintptr_t>(Entries);
            Ok = Offset < static_cast<size_t>(Count) * 0x560 && Offset % 0x560 == 0;
        }
    }
    catch (...) { Ok = false; }
    if (!Ok)
    {
        G->Valid = false; Fail(G->Request, 3); SetLastError(EntryError); return nullptr;
    }
    struct TemplateScope
    {
        void** Field; void* Previous;
        TemplateScope(void* D, void* P, void* T) : Field(reinterpret_cast<void**>(static_cast<unsigned char*>(D) + 0x18)), Previous(P) { *Field = T; }
        ~TemplateScope() { *Field = Previous; }
        TemplateScope(const TemplateScope&) = delete;
        TemplateScope& operator=(const TemplateScope&) = delete;
    } Scope(Descriptor, Previous, Entries + static_cast<size_t>(G->Request.Templates[G->Slot]) * 0x560);
    SetLastError(EntryError);
    void* Player = OriginalCreate(Session, Descriptor);
    G->Seen = Player != nullptr;
    return Player;
}
inline Report Snapshot(uint64_t Instance)
{
    Report R; R.Instance = Instance;
    unsigned char* Entries = nullptr;
    const bool Ready = Installed && Pool(R.PoolCount, R.Digest, Entries);
    if (!Ready) { R.PoolCount = 0; memset(R.Digest, 0, sizeof(R.Digest)); }
    std::lock_guard<std::mutex> Lock(StateMutex);
    R.Epoch = State.Request.Epoch; R.Match = State.Request.Match;
    R.Created = State.Created; R.Error = State.Error;
    if (Ready) R.Flags |= 1;
    if (State.Active && !Ready && !R.Error) State.Error = R.Error = 8;
    if (State.Active && Ready && (R.PoolCount != State.Request.PoolCount ||
        memcmp(R.Digest, State.Request.Digest, sizeof(R.Digest))) && !R.Error) State.Error = R.Error = 2;
    if (LiveLocked(State.Request)) R.Flags |= 2;
    if (State.Started) R.Flags |= 4;
    return R;
}
struct InternetHandle
{
    HINTERNET Value = nullptr;
    ~InternetHandle() { if (Value) WinHttpCloseHandle(Value); }
    InternetHandle() = default;
    explicit InternetHandle(HINTERNET V) : Value(V) {}
    InternetHandle(const InternetHandle&) = delete;
    InternetHandle& operator=(const InternetHandle&) = delete;
};
inline void ResetLogin(uint64_t Generation)
{
    std::lock_guard<std::mutex> Lock(ControlMutex);
    Control.Session.clear(); Control.Port = 0; Control.Generation = Generation;
    Revoke();
}
inline void ObserveResponse(HINTERNET Request, uint64_t Generation)
{
    // Called before the game's existing WinHTTP close, never on our own polls.
    // Failed/cancelled requests simply have no usable response headers.
    try
    {
        DWORD Status = 0, Size = sizeof(Status);
        if (!WinHttpQueryHeaders(Request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            WINHTTP_HEADER_NAME_BY_INDEX, &Status, &Size, WINHTTP_NO_HEADER_INDEX) || Status != 200) return;
        wchar_t Session[32]{}, Port[8]{};
        Size = sizeof(Session);
        if (!WinHttpQueryHeaders(Request, WINHTTP_QUERY_CUSTOM, L"X-Granite-Native-Park-Session",
            Session, &Size, WINHTTP_NO_HEADER_INDEX)) return;
        Size = sizeof(Port);
        if (!WinHttpQueryHeaders(Request, WINHTTP_QUERY_CUSTOM, L"X-Granite-Native-Park-Port",
            Port, &Size, WINHTTP_NO_HEADER_INDEX)) return;
        Session[_countof(Session) - 1] = Port[_countof(Port) - 1] = L'\0';
        const std::wstring Key(Session), PortText(Port);
        if (Key.empty() || Key.size() > 19 || Key[0] == L'0' || PortText.empty() || PortText.size() > 5) return;
        uint64_t SessionValue = 0;
        for (const wchar_t C : Key)
        {
            if (C < L'0' || C > L'9' || SessionValue > (0x7fffffffffffffffULL - (C - L'0')) / 10) return;
            SessionValue = SessionValue * 10 + (C - L'0');
        }
        unsigned PortValue = 0;
        for (const wchar_t C : PortText)
        {
            if (C < L'0' || C > L'9') return;
            PortValue = PortValue * 10 + (C - L'0');
        }
        if (!PortValue || PortValue > 65535) return;
        bool Changed = false;
        {
            std::lock_guard<std::mutex> Lock(ControlMutex);
            if (Generation != Control.Generation) return; // An old login's late response.
            Changed = Control.Session != Key || Control.Port != PortValue;
            if (Changed)
            {
                Revoke();
                Control.Session = Key; Control.Port = static_cast<INTERNET_PORT>(PortValue);
            }
        }
        if (Changed) Log(LogLevel::Info, L"PARK22 using the current game login session; no separate park configuration");
    }
    catch (...) { /* Optional park discovery must not change the game's HTTP close. */ }
}
inline bool CurrentControl(const ControlData& C)
{
    // Caller holds ControlMutex. A new login must not accept an old poll's reply.
    return C.Generation == Control.Generation && C.Port == Control.Port && C.Session == Control.Session;
}
inline bool Poll(HINTERNET Connection, const Report& R, const ControlData& C)
{
    InternetHandle Request(WinHttpOpenRequest(Connection, L"POST", ControlPath, nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE));
    if (!Request.Value) return false;
    DWORD Policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
    // Use the existing Granite self-signed TLS policy, not a second CA setup.
    DWORD Security = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_CN_INVALID |
        SECURITY_FLAG_IGNORE_CERT_DATE_INVALID | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
    if (!WinHttpSetOption(Request.Value, WINHTTP_OPTION_REDIRECT_POLICY, &Policy, sizeof(Policy)) ||
        !WinHttpSetOption(Request.Value, WINHTTP_OPTION_SECURITY_FLAGS, &Security, sizeof(Security))) return false;
    const std::wstring Headers = L"Content-Type: application/octet-stream\r\nCache-Control: no-store\r\nX-Granite-Session: " + C.Session + L"\r\n";
    if (!WinHttpSendRequest(Request.Value, Headers.c_str(), static_cast<DWORD>(Headers.size()),
        const_cast<Report*>(&R), sizeof(R), sizeof(R), 0) || !WinHttpReceiveResponse(Request.Value, nullptr)) return false;
    DWORD Status = 0, Size = sizeof(Status);
    if (!WinHttpQueryHeaders(Request.Value, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &Status, &Size, WINHTTP_NO_HEADER_INDEX)) return false;
    if (Status == 204 || Status == 401 || Status == 409)
    {
        std::lock_guard<std::mutex> Lock(ControlMutex);
        if (CurrentControl(C)) Revoke();
        return Status == 204;
    }
    if (Status != 200) return false;
    unsigned char Bytes[sizeof(Manifest) + 1]{}; DWORD Total = 0, Got = 0;
    do
    {
        if (Total == sizeof(Bytes) || !WinHttpReadData(Request.Value, Bytes + Total, static_cast<DWORD>(sizeof(Bytes) - Total), &Got)) return false;
        Total += Got;
    } while (Got);
    if (Total != sizeof(Manifest)) return false;
    Manifest M{}; memcpy(&M, Bytes, sizeof(M));
    std::lock_guard<std::mutex> Lock(ControlMutex);
    if (CurrentControl(C)) Accept(M);
    return true;
}
inline DWORD WINAPI Worker(void*)
{
    uint64_t Instance = 0;
    if (BCryptGenRandom(nullptr, reinterpret_cast<PUCHAR>(&Instance), sizeof(Instance), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0 || !Instance)
    { Installed = false; Log(LogLevel::Error, L"PARK22 disabled: control instance nonce unavailable"); return 1; }
    InternetHandle Session(WinHttpOpen(L"Granite-NativePark/3", WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!Session.Value || !WinHttpSetTimeouts(Session.Value, 2000, 2000, 2000, 2000))
    { Installed = false; return 1; }
    bool Failed = false;
    for (;;)
    {
        ControlData C;
        { std::lock_guard<std::mutex> Lock(ControlMutex); C = Control; }
        if (C.Session.empty() || !C.Port) { Failed = false; Sleep(500); continue; }
        bool Ok = false;
        try
        {
            // Same host as the game's existing Granite redirect; no user-supplied URL.
            InternetHandle Connection(WinHttpConnect(Session.Value, RedirectHost, C.Port, 0));
            Ok = Connection.Value && Poll(Connection.Value, Snapshot(Instance), C);
        }
        catch (...) { Ok = false; }
        if (!Ok && !Failed) Log(LogLevel::Error, L"PARK22 control unavailable: current game login or Opal connection is not ready; expired authorization cannot start a game");
        else if (Ok && Failed) Log(LogLevel::Info, L"PARK22 control connection recovered");
        Failed = !Ok;
        Sleep(Ok ? 500 : 1500);
    }
}
inline void Install(HMODULE Executable)
{
    if (!OriginalConnect || !OriginalOpenRequest || !OriginalCloseHandle)
    { Log(LogLevel::Error, L"PARK22 disabled: existing Granite HTTP redirect unavailable"); return; }
    ExeBase = reinterpret_cast<unsigned char*>(Executable);
    constexpr unsigned char Signature[] = {0x48,0x89,0x5c,0x24,0x08,0x55,0x56,0x57,0x41,0x54,0x41,0x55,0x41,0x56,0x41,0x57,0x48,0x8d,0xac,0x24,0x10,0xf5,0xff,0xff,0x48,0x81,0xec,0xf0,0x0b,0x00,0x00};
    unsigned char Actual[sizeof(Signature)]{};
    void* Target = ExeBase + 0x16403a0;
    if (!Read(Target, Actual, sizeof(Actual)) || memcmp(Actual, Signature, sizeof(Actual)))
    { Log(LogLevel::Error, L"PARK22 disabled: CreatePlayer build signature mismatch; solo remains available"); return; }
    MH_STATUS Status = MH_CreateHook(Target, reinterpret_cast<void*>(&CreatePlayer), reinterpret_cast<void**>(&OriginalCreate));
    if (Status != MH_OK) { Log(LogLevel::Error, L"PARK22 CreatePlayer hook could not be created"); return; }
    Status = MH_EnableHook(Target);
    if (Status != MH_OK) { MH_RemoveHook(Target); Log(LogLevel::Error, L"PARK22 CreatePlayer hook could not be enabled"); return; }
    Installed = true;
    if (HANDLE Thread = CreateThread(nullptr, 0, Worker, nullptr, 0, nullptr)) CloseHandle(Thread);
    else
    {
        Installed = false; MH_DisableHook(Target); MH_RemoveHook(Target);
        Log(LogLevel::Error, L"PARK22 disabled: control worker could not start"); return;
    }
    Log(LogLevel::Info, L"PARK22 v3 enabled: scoped CPU templates; waiting for the game's existing login session");
}
}
