// NBA 2K22 mixed park: bounded v4 control and verified enhanced CPU profiles.
#pragma once

namespace SoloParkNative
{
inline std::string NetworkReceipt(uint64_t Instance);
inline bool NetworkReply(const void* Bytes, size_t Size, uint64_t Instance);
inline void RevokeNetwork();
}

namespace NativePark
{
inline constexpr uint32_t Version = 4, ModuleVersion = CpuEnhancement::ModuleVersion;
inline constexpr uint32_t ManifestMagic = 0x3232504d, ReportMagic = 0x3452504d;
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
    unsigned char ProfileDigest[32]{};
};
static_assert(sizeof(Manifest) == 184 && offsetof(Manifest, Digest) == 56 && offsetof(Manifest, Players) == 88);
static_assert(offsetof(Manifest, Seeds) == 136 && offsetof(Manifest, Templates) == 160);
static_assert(sizeof(Report) == 120 && offsetof(Report, Digest) == 56 && offsetof(Report, ProfileDigest) == 88);
inline bool IsCpu(uint64_t Id) { return (Id & CpuMask) == CpuPrefix; }
inline unsigned char* ExeBase = nullptr;
inline std::atomic_bool Installed = false, OnlineHookReady = false;
inline std::mutex StateMutex;
struct StateData
{
    Manifest Request{};
    ULONGLONG Deadline = 0;
    uint32_t Created = 0, Error = 0;
    bool Active = false, Started = false;
    std::array<CpuEnhancement::Snapshot, 6> Profiles{};
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
inline constexpr wchar_t ControlPath[] = L"/native-park/v4/poll";

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
    State.Profiles = {};
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
    std::array<CpuEnhancement::Snapshot, 6> Profiles{};
    {
        std::lock_guard<std::mutex> Lock(StateMutex);
        if ((State.Created & CpuSlots(M)) != CpuSlots(M)) return false;
        Profiles = State.Profiles;
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
            (IsCpu(M.Players[I]) && !CpuEnhancement::Verify(Player, M.Players[I], Profiles[I])) ||
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
inline bool AuthorizeProfile(const void* Request) { return Authorized(*static_cast<const Manifest*>(Request)); }
struct Generation
{
    Manifest Request{};
    void* Session = nullptr;
    unsigned Slot = 0;
    bool Valid = false;
    CpuEnhancement::Generation Profile{};
};
struct GenerationScope
{
    CpuEnhancement::Scope Enhance;
    explicit GenerationScope(Generation& G) : Enhance(G.Profile) {}
};
inline bool ForCpu(void* Session, uint64_t Id, Generation& G)
{
    std::lock_guard<std::mutex> Lock(StateMutex);
    for (unsigned I = 0; I < 6; ++I) if (Id && State.Request.Players[I] == Id && IsCpu(Id))
    {
        G.Request = State.Request; G.Session = Session; G.Slot = I; G.Valid = LiveLocked(G.Request);
        auto& P = G.Profile;
        P.Session = Session; P.Id = Id; P.Seed = G.Request.Seeds[I]; P.Template = G.Request.Templates[I];
        P.PoolCount = G.Request.PoolCount; memcpy(P.PoolDigest, G.Request.Digest, sizeof(P.PoolDigest));
        P.Authority = &G.Request; P.Authorized = &AuthorizeProfile; P.Valid = G.Valid;
        return true;
    }
    return false;
}
inline void Generated(Generation& G, void* Player)
{
    const bool Ok = G.Valid && CpuEnhancement::Finish(G.Profile, Player);
    if (!Ok)
    {
        const auto& Error = G.Profile.Error;
        Log(LogLevel::Error, L"PARK22 CPU " + std::to_wstring(G.Slot) + L" refused: " +
            (Error.empty() ? std::wstring(L"generation-invalid") : std::wstring(Error.begin(), Error.end())));
    }
    std::lock_guard<std::mutex> Lock(StateMutex);
    if (!SameRoster(State.Request, G.Request)) return;
    if (Ok && LiveLocked(G.Request))
    {
        State.Profiles[G.Slot] = G.Profile.Expected;
        State.Created |= 1U << G.Slot;
        Log(LogLevel::Info, L"PARK22 CPU " + std::to_wstring(G.Slot) + L" verified: OVR=" +
            std::to_wstring(G.Profile.Expected.Rating) + L" height-cm=" +
            std::to_wstring(G.Profile.Expected.Height / 100));
    }
    else if (!State.Error) State.Error = 9;
}
using CreateFn = void*(__fastcall*)(void*, void*);
inline CreateFn OriginalCreate = nullptr;
inline void* __fastcall CreatePlayer(void* Session, void* Descriptor)
{
    auto* G = CpuEnhancement::Generating;
    if (!G || _ReturnAddress() != ExeBase + 0x166b5f2) return OriginalCreate(Session, Descriptor);
    const DWORD EntryError = GetLastError();
    uint64_t Id = 0, Seed = 0; void* Previous = nullptr;
    uint32_t Count = 0; unsigned char Digest[32]{}; unsigned char* Entries = nullptr;
    bool Ok = false;
    try
    {
        const auto Check = [&](bool Value, const std::string& Reason)
        { return Value || CpuEnhancement::Reject(&G->Error, Reason); };
        const bool First = !G->Entered; G->Entered = true;
        Ok = Check(First && !G->Seen, "create-reentered") &&
            Check(CpuEnhancement::Authorized(*G), "create-authorization") &&
            Check(Session == G->Session, "create-session") &&
            Check(At(Descriptor, 0, Id) && Id == G->Id, "create-identity") &&
            Check(At(Descriptor, 0x50, Seed), "create-seed-unreadable") &&
            Check(Seed == G->Seed, "create-seed:expected=" + std::to_string(G->Seed) + ":actual=" + std::to_string(Seed)) &&
            Check(At(Descriptor, 0x18, Previous), "create-template-unreadable") &&
            Check(Pool(Count, Digest, Entries), "create-pool") &&
            Check(Count == G->PoolCount, "create-pool-count") &&
            Check(G->Template < Count && G->Template == G->Seed % Count, "create-template-index") &&
            Check(!memcmp(Digest, G->PoolDigest, sizeof(Digest)), "create-pool-digest");
        if (Ok && Previous)
        {
            const auto Offset = reinterpret_cast<uintptr_t>(Previous) - reinterpret_cast<uintptr_t>(Entries);
            Ok = Check(Offset < static_cast<size_t>(Count) * 0x560 && Offset % 0x560 == 0, "create-template-outside-pool");
        }
        if (Ok) Ok = CpuEnhancement::Build(*G, Entries + static_cast<size_t>(G->Template) * 0x560);
    }
    catch (...) { CpuEnhancement::Reject(&G->Error, "create-exception"); Ok = false; }
    if (!Ok)
    {
        G->Valid = false; SetLastError(EntryError); return nullptr;
    }
    struct TemplateScope
    {
        void** Field; void* Previous;
        TemplateScope(void* D, void* P, void* T) : Field(reinterpret_cast<void**>(static_cast<unsigned char*>(D) + 0x18)), Previous(P) { *Field = T; }
        ~TemplateScope() { *Field = Previous; }
        TemplateScope(const TemplateScope&) = delete;
        TemplateScope& operator=(const TemplateScope&) = delete;
    } Scope(Descriptor, Previous, G->Data);
    SetLastError(EntryError);
    void* Player = OriginalCreate(Session, Descriptor);
    G->Seen = Player != nullptr;
    if (!Player) CpuEnhancement::Reject(&G->Error, "create-returned-null");
    return Player;
}
// NBA2K22 VCSPORTS_ONLINE_SESSION::Create copies a 0x958-byte descriptor to this+0x48.
// Only its PREBUILT network view is filtered; court/gameplay rosters are never edited.
namespace Online
{
inline constexpr uint32_t RelayId = 0x0a, GameTag = 0x15bedc38, Success = 0x504521a8;
inline constexpr size_t DescriptorBytes = 0x958, Capacity = 10;
inline constexpr size_t MatchOffset = 0x70, PrebuiltOffset = 0x244, SelfOffset = 0x248, CountOffset = 0x250;
inline constexpr size_t UsersOffset = 0x258, MachinesOffset = 0x2a8, TokenOffset = 0x910, EndpointOffset = 0x920, RelayOffset = 0x928;
using Descriptor = std::array<unsigned char, DescriptorBytes>;
using CreateFn = uint32_t*(__fastcall*)(void*, uint32_t*, const void*);
inline CreateFn Original = nullptr;
struct Column { size_t Offset, Width; };
// Values at owner+0x340/+0x368, userdata pointers, extra-data size and inline names.
inline constexpr Column Columns[] = {
    {UsersOffset, 8}, {MachinesOffset, 8}, {0x2f8, 4}, {0x320, 4},
    {0x348, 8}, {0x398, 8}, {0x3e8, 4}, {0x410, 0x80},
};
static_assert(0x410 + Capacity * 0x80 == TokenOffset && RelayOffset + 4 <= DescriptorBytes);
template<class T> inline T Value(const Descriptor& D, size_t Offset)
{
    T V{}; memcpy(&V, D.data() + Offset, sizeof(V)); return V;
}
template<class T> inline void Set(Descriptor& D, size_t Offset, T V)
{
    memcpy(D.data() + Offset, &V, sizeof(V));
}
inline bool Prepare(const Descriptor& Input, const Manifest& M, Descriptor& Output, std::string& Error)
{
    const auto Check = [&](bool Ok, const char* Why) { if (!Ok && Error.empty()) Error = Why; return Ok; };
    uint32_t Humans = 0;
    for (unsigned I = 0; I < 6; ++I) if (M.HumanMask & (1U << I)) ++Humans;
    const auto Count = Value<uint32_t>(Input, CountOffset);
    if (!Check(Value<uint32_t>(Input, 0) == GameTag && Value<uint32_t>(Input, PrebuiltOffset) != 0, "online-session-kind") ||
        !Check(Value<uint64_t>(Input, MatchOffset) == M.Match, "online-match") ||
        !Check(Count == M.TeamSize * 2 || Count == Humans, "online-user-count")) return false;
    // Accept the original full view or an already-filtered retry, never a partial roster.
    const uint32_t Expected = Count == M.TeamSize * 2 ? ActiveMask(M) : M.HumanMask;
    std::array<unsigned, 6> Source{};
    uint32_t Seen = 0;
    for (unsigned I = 0; I < Count; ++I)
    {
        const auto Id = Value<uint64_t>(Input, UsersOffset + I * 8);
        unsigned Slot = 0;
        while (Slot < 6 && (!(Expected & (1U << Slot)) || M.Players[Slot] != Id)) ++Slot;
        if (!Check(Slot < 6, "online-unexpected-user") ||
            !Check(!(Seen & (1U << Slot)), "online-duplicate-user")) return false;
        Seen |= 1U << Slot; Source[Slot] = I;
    }
    if (!Check(Seen == Expected && Humans >= 2 && Humans < M.TeamSize * 2, "online-incomplete-roster")) return false;
    const auto EndpointId = Value<uint16_t>(Input, EndpointOffset + 6);
    const auto Id = Value<uint32_t>(Input, RelayOffset);
    if (!Check(Value<uint32_t>(Input, EndpointOffset) && Value<uint16_t>(Input, EndpointOffset + 4), "online-relay-endpoint") ||
        !Check((Id == 0 || Id == RelayId) && (EndpointId == 0 || EndpointId == RelayId), "online-relay-id")) return false;
    unsigned char Token = 0;
    for (size_t I = 0; I < 16; ++I) Token |= Input[TokenOffset + I];
    if (!Check(Token != 0, "online-relay-token")) return false;
    Output = Input;
    for (const auto& C : Columns) memset(Output.data() + C.Offset, 0, C.Width * Capacity);
    uint32_t Next = 0; bool Local = false;
    std::array<uint64_t, 6> Machines{};
    for (unsigned I = 0; I < 6; ++I) if (M.HumanMask & (1U << I))
    {
        const auto From = Source[I];
        const auto Machine = Value<uint64_t>(Input, MachinesOffset + From * 8);
        if (!Check(Machine != 0, "online-human-machine") ||
            !Check(Value<uint64_t>(Input, 0x348 + From * 8) != 0, "online-human-userdata") ||
            !Check(!Value<uint32_t>(Input, 0x3e8 + From * 4) || Value<uint64_t>(Input, 0x398 + From * 8), "online-human-extra-data") ||
            !Check(memchr(Input.data() + 0x410 + From * 0x80, 0, 0x80) != nullptr, "online-human-name")) return false;
        for (unsigned J = 0; J < Next; ++J) if (!Check(Machines[J] != Machine, "online-duplicate-machine")) return false;
        Machines[Next] = Machine;
        if (M.Players[I] == M.LocalPuid)
        {
            if (!Check(Machine == Value<uint64_t>(Input, SelfOffset), "online-local-machine")) return false;
            Local = true;
        }
        // The source buffers stay native-owned; Create synchronously packages them into its own FieldList.
        for (const auto& C : Columns)
            memcpy(Output.data() + C.Offset + Next * C.Width, Input.data() + C.Offset + From * C.Width, C.Width);
        ++Next;
    }
    if (!Check(Local && Next == Humans, "online-local-user")) return false;
    Set(Output, CountOffset, Next);
    Set(Output, RelayOffset, RelayId);
    Set(Output, EndpointOffset + 6, static_cast<uint16_t>(RelayId));
    return true;
}
inline uint32_t* Refuse(const Manifest& M, uint32_t* Result, const std::string& Why)
{
    Fail(M, 10);
    Log(LogLevel::Error, L"PARK22 refused online session: " + std::wstring(Why.begin(), Why.end()));
    if (Result)
    {
        const uint32_t Error = 0x135e11fb; SIZE_T N = 0;
        if (!WriteProcessMemory(GetCurrentProcess(), Result, &Error, sizeof(Error), &N) || N != sizeof(Error)) return nullptr;
    }
    return Result;
}
inline uint32_t* __fastcall Create(void* Owner, uint32_t* Result, const void* Input)
{
    const DWORD EntryError = GetLastError();
    uint64_t Match = 0; Manifest M{};
    if (!At(Input, MatchOffset, Match) || !ForMatch(Match, M))
    { SetLastError(EntryError); return Original(Owner, Result, Input); }
    alignas(16) Descriptor Source{}, Filtered{};
    std::string Error;
    bool Ready = false;
    try
    {
        {
            std::lock_guard<std::mutex> Lock(StateMutex);
            Ready = LiveLocked(M) && M.Phase >= 2 && (State.Created & CpuSlots(M)) == CpuSlots(M);
        }
        if (!Ready) Error = "online-authorization";
        else if (!Read(Input, Source.data(), Source.size())) Error = "online-descriptor-unreadable";
        else Ready = Prepare(Source, M, Filtered, Error);
    }
    catch (...) { Ready = false; Error = "online-descriptor-exception"; }
    if (!Ready || !Error.empty() || !Authorized(M))
    {
        auto* Rejected = Refuse(M, Result, Error.empty() ? "online-authorization-expired" : Error);
        SetLastError(EntryError); return Rejected;
    }
    SetLastError(EntryError);
    auto* Returned = Original(Owner, Result, Filtered.data());
    const DWORD NativeError = GetLastError();
    uint32_t Status = 0;
    if (!Read(Returned, &Status, sizeof(Status)) || Status != Success)
    {
        Fail(M, 11);
        std::wostringstream Text;
        Text << L"PARK22 online session creation failed: status=0x" << std::hex << Status;
        Log(LogLevel::Error, Text.str());
    }
    else Log(LogLevel::Info, L"PARK22 online session prepared: network humans=" +
        std::to_wstring(Value<uint32_t>(Filtered, CountOffset)) + L" gameplay players=" +
        std::to_wstring(M.TeamSize * 2) + L" relay-id=" + std::to_wstring(RelayId));
    SetLastError(NativeError); return Returned;
}
inline bool Install()
{
    constexpr unsigned char Signature[] = {0x48,0x89,0x54,0x24,0x10,0x48,0x89,0x4c,0x24,0x08,0x55,0x53,0x41,0x54,0x41,0x55,0x41,0x56,0x48,0x8d,0xac,0x24,0xa0,0xfd,0xff,0xff,0x48,0x81,0xec,0x60,0x03,0x00,0x00};
    unsigned char Actual[sizeof(Signature)]{};
    void* Target = ExeBase + 0xc08510;
    if (!Read(Target, Actual, sizeof(Actual)) || memcmp(Actual, Signature, sizeof(Actual)))
    { Log(LogLevel::Error, L"PARK22 mixed online sessions disabled: Create build signature mismatch"); return false; }
    auto Status = MH_CreateHook(Target, reinterpret_cast<void*>(&Create), reinterpret_cast<void**>(&Original));
    if (Status != MH_OK) { Log(LogLevel::Error, L"PARK22 online session hook could not be created"); return false; }
    Status = MH_EnableHook(Target);
    if (Status != MH_OK)
    { MH_RemoveHook(Target); Log(LogLevel::Error, L"PARK22 online session hook could not be enabled"); return false; }
    return true;
}
}
inline Report Snapshot(uint64_t Instance)
{
    Report R; R.Instance = Instance;
    unsigned char* Entries = nullptr;
    const bool Ready = Installed && OnlineHookReady && CpuEnhancement::Ready && Pool(R.PoolCount, R.Digest, Entries);
    if (!Ready) { R.PoolCount = 0; memset(R.Digest, 0, sizeof(R.Digest)); }
    std::lock_guard<std::mutex> Lock(StateMutex);
    R.Epoch = State.Request.Epoch; R.Match = State.Request.Match;
    R.Created = State.Created; R.Error = State.Error;
    if (Ready) R.Flags |= 1;
    if (State.Active && !Ready && !R.Error) State.Error = R.Error = 8;
    if (State.Active && Ready && (R.PoolCount != State.Request.PoolCount ||
        memcmp(R.Digest, State.Request.Digest, sizeof(R.Digest))) && !R.Error) State.Error = R.Error = 2;
    if (State.Created && (State.Created & CpuSlots(State.Request)) == CpuSlots(State.Request))
    {
        std::vector<unsigned char> Bytes;
        for (unsigned I = 0; I < 6; ++I) if (CpuSlots(State.Request) & (1U << I))
            CpuEnhancement::Append(Bytes, State.Request.Players[I], State.Profiles[I]);
        if (!Sha256(Bytes, R.ProfileDigest) && !R.Error) State.Error = R.Error = 9;
    }
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
    Revoke(); SoloParkNative::RevokeNetwork();
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
                Revoke(); SoloParkNative::RevokeNetwork();
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
inline bool Poll(HINTERNET Connection, const Report& R, const ControlData& C, bool Solo = false)
{
    const auto SoloText = Solo ? SoloParkNative::NetworkReceipt(R.Instance) : std::string{};
    const void* Body = Solo ? static_cast<const void*>(SoloText.data()) : static_cast<const void*>(&R);
    const DWORD BodyBytes = Solo ? static_cast<DWORD>(SoloText.size()) : sizeof(R);
    InternetHandle Request(WinHttpOpenRequest(Connection, L"POST", Solo ? L"/native-solo/v3/poll" : ControlPath,
        nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE));
    if (!Request.Value) return false;
    DWORD Policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
    // Use the existing Granite self-signed TLS policy, not a second CA setup.
    DWORD Security = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_CN_INVALID |
        SECURITY_FLAG_IGNORE_CERT_DATE_INVALID | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
    if (!WinHttpSetOption(Request.Value, WINHTTP_OPTION_REDIRECT_POLICY, &Policy, sizeof(Policy)) ||
        !WinHttpSetOption(Request.Value, WINHTTP_OPTION_SECURITY_FLAGS, &Security, sizeof(Security))) return false;
    const std::wstring Headers = std::wstring(L"Content-Type: ") + (Solo ? L"application/json" : L"application/octet-stream") +
        L"\r\nCache-Control: no-store\r\nX-Granite-Session: " + C.Session + L"\r\n";
    if (!WinHttpSendRequest(Request.Value, Headers.c_str(), static_cast<DWORD>(Headers.size()),
        const_cast<void*>(Body), BodyBytes, BodyBytes, 0) || !WinHttpReceiveResponse(Request.Value, nullptr)) return false;
    DWORD Status = 0, Size = sizeof(Status);
    if (!WinHttpQueryHeaders(Request.Value, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &Status, &Size, WINHTTP_NO_HEADER_INDEX)) return false;
    if (Status == 204 || Status == 401 || Status == 409)
    {
        std::lock_guard<std::mutex> Lock(ControlMutex);
        if (CurrentControl(C)) { if (Solo) SoloParkNative::RevokeNetwork(); else Revoke(); }
        return Status == 204;
    }
    if (Status != 200) return false;
    unsigned char Bytes[sizeof(Manifest) + 1]{}; DWORD Total = 0, Got = 0;
    do
    {
        if (Total == sizeof(Bytes) || !WinHttpReadData(Request.Value, Bytes + Total, static_cast<DWORD>(sizeof(Bytes) - Total), &Got)) return false;
        Total += Got;
    } while (Got);
    std::lock_guard<std::mutex> Lock(ControlMutex);
    if (!CurrentControl(C)) return true;
    if (Solo) return SoloParkNative::NetworkReply(Bytes, Total, R.Instance);
    if (Total != sizeof(Manifest)) return false;
    Manifest M{}; memcpy(&M, Bytes, sizeof(M));
    Accept(M);
    return true;
}
inline DWORD WINAPI Worker(void*)
{
    uint64_t Instance = 0;
    if (BCryptGenRandom(nullptr, reinterpret_cast<PUCHAR>(&Instance), sizeof(Instance), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0 || !Instance)
    { Installed = false; Log(LogLevel::Error, L"PARK22 disabled: control instance nonce unavailable"); return 1; }
    InternetHandle Session(WinHttpOpen(L"Granite-NativePark/4", WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
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
            if (Connection.Value)
            {
                const auto R = Snapshot(Instance);
                const bool ParkOk = Poll(Connection.Value, R, C);
                const bool SoloOk = Poll(Connection.Value, R, C, true);
                Ok = ParkOk && SoloOk;
            }
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
    ExeBase = reinterpret_cast<unsigned char*>(Executable);
    CpuEnhancement::Bind(ExeBase);
    constexpr unsigned char Signature[] = {0x48,0x89,0x5c,0x24,0x08,0x55,0x56,0x57,0x41,0x54,0x41,0x55,0x41,0x56,0x41,0x57,0x48,0x8d,0xac,0x24,0x10,0xf5,0xff,0xff,0x48,0x81,0xec,0xf0,0x0b,0x00,0x00};
    unsigned char Actual[sizeof(Signature)]{};
    void* Target = ExeBase + 0x16403a0;
    if (!Read(Target, Actual, sizeof(Actual)) || memcmp(Actual, Signature, sizeof(Actual)))
    { Log(LogLevel::Error, L"PARK22 disabled: enhanced CPU CreatePlayer build signature mismatch"); return; }
    MH_STATUS Status = MH_CreateHook(Target, reinterpret_cast<void*>(&CreatePlayer), reinterpret_cast<void**>(&OriginalCreate));
    if (Status != MH_OK) { Log(LogLevel::Error, L"PARK22 CreatePlayer hook could not be created"); return; }
    Status = MH_EnableHook(Target);
    if (Status != MH_OK) { MH_RemoveHook(Target); Log(LogLevel::Error, L"PARK22 CreatePlayer hook could not be enabled"); return; }
    CpuEnhancement::Ready = true;
    OnlineHookReady = Online::Install();
    if (!OriginalConnect || !OriginalOpenRequest || !OriginalCloseHandle)
    { Log(LogLevel::Error, L"PARK22 control disabled: HTTP redirect unavailable; enhanced solo remains available"); return; }
    Installed = true;
    if (HANDLE Thread = CreateThread(nullptr, 0, Worker, nullptr, 0, nullptr)) CloseHandle(Thread);
    else
    {
        Installed = false;
        Log(LogLevel::Error, L"PARK22 control worker could not start; enhanced solo remains available"); return;
    }
    Log(LogLevel::Info, OnlineHookReady ?
        L"PARK22 v4 enabled: verified CPU profiles and guarded mixed online sessions; waiting for the game's login" :
        L"PARK22 mixed sessions unavailable; remote solo control remains available");
}
}
