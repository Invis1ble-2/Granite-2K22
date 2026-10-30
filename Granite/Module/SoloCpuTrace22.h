// Temporary NBA 2K22 multiplayer disconnect observation; remove after diagnosis.
// Retains the existing diagnostic build switch/output directory, not the old solo probes.
#pragma once

namespace SoloCpuTrace22
{
inline constexpr ULONGLONG DurationMs = 120'000, PeriodicMs = 4'000, ProcessMs = 8'000;
inline constexpr unsigned MaxPlayers = 6, QueueSize = 128, MaxRecords = 1200;
inline constexpr size_t SubmitCallerRva = 0x1d9087c;
enum Site : unsigned { ArmSite, ProcessSite, UnbindSite, RemoveSite, UpdateSite, HitSite, SiteCount };
inline constexpr const wchar_t* Names[] = {L"arm", L"process-objects", L"unbind", L"remove-world", L"update", L"update-identity"};
inline constexpr unsigned Limits[] = {1, 32, 8, 12, 30, 12};
enum StopReason : unsigned { Running, Complete, AuthorizationEnded, SessionEnded, WorldChanged, IdleTimeout };
inline constexpr const wchar_t* Reasons[] = {L"running", L"120s-complete", L"authorization-ended",
    L"session-ended-or-changed", L"observed-world-changed", L"idle-timeout"};
using UpdateFn = void(__fastcall*)();
using SubmitFn = uint32_t(__fastcall*)(void*, void*);
using ProcessFn = void(__fastcall*)(void*, void*);
using BoundaryFn = void(__fastcall*)(void*, int32_t, int32_t);
inline UpdateFn OriginalUpdate = nullptr;
inline SubmitFn OriginalSubmit = nullptr;
inline ProcessFn OriginalProcess = nullptr;
inline BoundaryFn OriginalUnbind = nullptr, OriginalRemove = nullptr;
inline unsigned char* Base = nullptr;
inline std::atomic_bool Ready = false, Used = false, Live = false;
inline std::atomic_uint64_t LockDrops = 0, QueueDrops = 0, BudgetDrops = 0, InFlight = 0;
inline std::atomic_uint64_t ArmRefusals = 0;
inline std::atomic_uint LastArmReject = 0;
inline SRWLOCK StateLock = SRWLOCK_INIT;
inline thread_local unsigned UpdateDepth = 0, ParentSequence = 0;
inline thread_local void* UpdateWorld = nullptr;

struct Player
{
    uint64_t Puid = 0, Key = 0;
    unsigned Slot = 0;
    bool Cpu = false;
    void* Wrapper = nullptr;
    void* WrapperTable = nullptr;
    void* Container = nullptr;
    void* Data = nullptr;
    void* InitialWorld = nullptr;
    void* MappedActor = nullptr;
    void* LastInput = nullptr;
    void* LastHitWorld = nullptr;
    uint64_t Hits = 0, Rejects = 0, LastHitStep = 0;
    ULONGLONG LastHitTick = 0;
    int32_t LastController = -999;
};
struct ActorView
{
    void* Actor = nullptr;
    void* Table = nullptr;
    void* Data = nullptr;
    void* Input = nullptr;
    void* Moves = nullptr;
    void* State = nullptr;
    void* StateTable = nullptr;
    int32_t Controller = -999;
    uint32_t C44 = 0;
    bool Layout = false, ValuesReadable = false, StateReadable = false;
};
struct PlayerView
{
    Player Identity{};
    void* CurrentContainer = nullptr;
    void* CurrentData = nullptr;
    void* WrapperWorld = nullptr;
    void* WrapperWorldTable = nullptr;
    void* InitialWorldTable = nullptr;
    void* WorldActor = nullptr;
    void* InitialWorldActor = nullptr;
    void* BackActor = nullptr;
    void* MappedTable = nullptr;
    void* MappedData = nullptr;
    uint32_t WrapperFlags = 0, DataFlags = 0;
    int32_t WrapperState = -999;
    uint8_t Seen = 0;
    bool WrapperIdentity = false, WrapperFields = false, DataReadable = false, MappedReadable = false;
    bool WorldLookup = false, InitialWorldLookup = false;
    ActorView Current{};
};
struct Stamp
{
    uint64_t Match = 0;
    int32_t State = -999, Locked = -999;
    bool Readable = false;
    bool operator==(const Stamp&) const = default;
};
struct Event
{
    Site Where = ArmSite;
    bool Exit = false;
    unsigned Sequence = 0, Parent = 0, Thread = 0, Depth = 0;
    int Subject = -1;
    int32_t Arg2 = 0, Arg3 = 0;
    void* Context = nullptr;
    void* View = nullptr;
    uint64_t Caller = 0, Step = 0;
    ULONGLONG Tick = 0;
    void* SessionTable = nullptr;
    void* Server = nullptr;
    void* World = nullptr;
    Stamp SessionStamp{};
    int32_t HomeCount = -999, AwayCount = -999;
    uint64_t Home[3]{}, Away[3]{};
    bool SessionIdentity = false, RosterReadable = false, WorldReadable = false;
    std::array<PlayerView, MaxPlayers> Players{};
    unsigned StackCount = 0;
    uintptr_t Stack[12]{};
};
struct Counters
{
    uint64_t Calls = 0, Filtered = 0, Throttled = 0, Capped = 0, Entries = 0, Exits = 0;
    uint64_t BeforeDropped = 0, AfterDropped = 0, SkippedExits = 0;
    unsigned Attempts = 0;
};
struct Token
{
    Site Where = ArmSite;
    unsigned Sequence = 0, Parent = 0;
    int Subject = -1;
    int32_t Arg2 = 0, Arg3 = 0;
    void* Context = nullptr;
    void* View = nullptr;
    uint64_t Caller = 0;
};
inline std::array<Player, MaxPlayers> Players{};
inline std::array<Event, QueueSize> Queue{};
inline std::array<Counters, SiteCount> Counts{};
inline ParkCpu::Multiplayer::Manifest Authority{};
inline unsigned Count = 0, Head = 0, Queued = 0, Records = 0, Sequence = 0;
inline uint64_t Match = 0, WorldCalls = 0;
inline void* Session = nullptr;
inline void* InitialUpdateWorld = nullptr;
inline ULONGLONG Started = 0, NextUpdate = 0, NextProcess = 0;
inline Stamp LastProcess{};
inline StopReason Reason = Running;

inline uint64_t Rva(const void* Address)
{
    const auto V = reinterpret_cast<uintptr_t>(Address), B = reinterpret_cast<uintptr_t>(Base);
    return V >= B && V - B < 0x6d86000 ? V - B : 0;
}
inline Stamp ReadStamp()
{
    Stamp S{};
    S.Readable = ParkCpu::At(Session, 0xcb0 + ParkCpu::MatchOffset, S.Match) &&
        ParkCpu::At(Session, 0x1fd8, S.State) && ParkCpu::At(Session, 0x1250, S.Locked);
    return S;
}
inline void Stop(StopReason Why)
{
    // StateLock protects the reason and published observation state.
    if (Live) { Reason = Why; Live = false; }
}
inline uint32_t HashKey(uint64_t Key)
{
    // 141EDFA50: unsigned products, rotate, end-around carry, then fold.
    const uint64_t Low = static_cast<uint32_t>(Key) * uint64_t{0xfaa3f140};
    const uint64_t High = (Key >> 32) * uint64_t{0xfaa3f140};
    const uint64_t Rotated = (High << 32) | (High >> 32);
    uint64_t Sum = Rotated + Low;
    Sum += Sum < Low;
    if (Sum == UINT64_MAX) Sum = 0;
    return static_cast<uint32_t>(Sum >> 32) ^ static_cast<uint32_t>(Sum);
}
inline bool FindWorldActor(void* World, uint64_t Key, void*& Table, void*& Actor)
{
    Actor = nullptr;
    if (!World) return true;
    void* Map = nullptr;
    void* Buckets = nullptr;
    int32_t Mask = 0, Size = 0;
    if (!ParkCpu::At(World, 0, Table) ||
        (Table != Base + 0x2d218d8 && Table != Base + 0x2d8ce48) ||
        !ParkCpu::At(World, 0xe60, Map) || !ParkCpu::At(Map, 0x18, Buckets) ||
        !ParkCpu::At(Map, 0x20, Mask) || !ParkCpu::At(Map, 0x24, Size) || Mask < 0 || Size <= 0) return false;
    uint32_t Index = HashKey(Key) & static_cast<uint32_t>(Mask);
    if (Index >= static_cast<uint32_t>(Size)) Index &= static_cast<uint32_t>(Mask >> 1);
    if (Index >= static_cast<uint32_t>(Size)) return false;
    void* Node = nullptr;
    if (!ParkCpu::At(Buckets, static_cast<size_t>(Index) * 8, Node)) return false;
    for (unsigned I = 0; Node && I < 64; ++I)
    {
        uint32_t Hash = 0;
        uint64_t Id = 0;
        if (!ParkCpu::At(Node, 0x18, Hash) || !ParkCpu::At(Node, 8, Id)) return false;
        if (Hash == HashKey(Key) && Id == Key) return ParkCpu::At(Node, 0x10, Actor);
        if (!ParkCpu::At(Node, 0, Node)) return false;
    }
    return Node == nullptr; // A read failure or chain limit is not an absent Actor.
}
inline bool WrapperIdentity(const Player& P, PlayerView& V)
{
    uint64_t Id = 0, Key = 0;
    void* Table = nullptr;
    return ParkCpu::At(P.Wrapper, 0, Table) && Table == P.WrapperTable &&
        ParkCpu::At(P.Wrapper, 0xf0, Id) && Id == P.Puid &&
        ParkCpu::At(P.Wrapper, 0x44bd0, Key) && Key == P.Key &&
        ParkCpu::At(P.Wrapper, 0x2200, V.WrapperFlags) && ((V.WrapperFlags & 8) != 0) == P.Cpu &&
        ParkCpu::At(P.Wrapper, 0x446c0, V.CurrentContainer) && V.CurrentContainer == P.Container &&
        ParkCpu::At(V.CurrentContainer, 0x28, V.CurrentData) && V.CurrentData == P.Data;
}
inline ActorView ReadActor(void* Actor, void* Data, uint32_t DataFlags)
{
    ActorView V{}; V.Actor = Actor;
    void* InputTable = nullptr;
    void* MovesTable = nullptr;
    void* Host = nullptr;
    V.Layout = Actor && (DataFlags & 0x20000) &&
        ParkCpu::At(Actor, 0, V.Table) && V.Table == Base + 0x2d5e1c8 &&
        ParkCpu::At(Actor, 0xaf0, V.Data) && V.Data == Data &&
        ParkCpu::At(Actor, 0x988, V.Input) && ParkCpu::At(V.Input, 0, InputTable) && InputTable == Base + 0x225b350 &&
        ParkCpu::At(Actor, 0x990, V.Moves) && ParkCpu::At(V.Moves, 0, MovesTable) && MovesTable == Base + 0x2d311c0 &&
        ParkCpu::At(V.Moves, 0xf0, Host) && Host == Actor;
    if (V.Layout)
    {
        V.ValuesReadable = ParkCpu::At(V.Input, 8, V.Controller) && ParkCpu::At(Actor, 0xc44, V.C44);
        V.StateReadable = ParkCpu::At(V.Moves, 0x108, V.State) && (!V.State || ParkCpu::At(V.State, 0, V.StateTable));
    }
    return V;
}
inline PlayerView Snapshot(const Player& P)
{
    PlayerView V{}; V.Identity = P;
    V.WrapperIdentity = WrapperIdentity(P, V);
    if (V.WrapperIdentity)
    {
        V.WrapperFields = ParkCpu::At(P.Wrapper, 0x446b0, V.WrapperWorld) &&
            ParkCpu::At(P.Wrapper, 0x446dc, V.WrapperState) && ParkCpu::At(P.Wrapper, 0x44b86, V.Seen);
        if (V.WrapperFields) V.WorldLookup = FindWorldActor(V.WrapperWorld, P.Key, V.WrapperWorldTable, V.WorldActor);
    }
    // Keep the authorized data anchor separate from wrapper liveness; never reassign its identity.
    V.DataReadable = ParkCpu::At(P.Data, 0xf8, V.DataFlags) && ParkCpu::At(P.Data, 0x4f0, V.BackActor);
    if (V.DataReadable) V.Current = ReadActor(V.BackActor, P.Data, V.DataFlags);
    if (P.MappedActor)
        V.MappedReadable = ParkCpu::At(P.MappedActor, 0, V.MappedTable) && ParkCpu::At(P.MappedActor, 0xaf0, V.MappedData);
    if (V.WrapperFields && V.WrapperWorld == P.InitialWorld)
    {
        V.InitialWorldTable = V.WrapperWorldTable; V.InitialWorldActor = V.WorldActor;
        V.InitialWorldLookup = V.WorldLookup;
    }
    else V.InitialWorldLookup = FindWorldActor(P.InitialWorld, P.Key, V.InitialWorldTable, V.InitialWorldActor);
    return V;
}
inline Event Capture(Site Where, bool Exit, unsigned Seq, unsigned Parent, void* Context = nullptr,
    void* View = nullptr, int32_t Arg2 = 0, int32_t Arg3 = 0, int Subject = -1, uint64_t Caller = 0)
{
    Event E{};
    E.Where = Where; E.Exit = Exit; E.Sequence = Seq; E.Parent = Parent;
    E.Context = Context; E.View = View; E.Arg2 = Arg2; E.Arg3 = Arg3; E.Subject = Subject; E.Caller = Caller;
    E.Thread = GetCurrentThreadId(); E.Depth = UpdateDepth; E.Tick = GetTickCount64(); E.Step = WorldCalls;
    E.SessionIdentity = ParkCpu::At(Session, 0, E.SessionTable) && E.SessionTable == Base + 0x2cbace0;
    if (E.SessionIdentity)
    {
        E.SessionStamp = ReadStamp();
        ParkCpu::At(Session, 0x70, E.Server);
        E.RosterReadable = ParkCpu::At(Session, 0xdc8, E.HomeCount) && ParkCpu::At(Session, 0xdcc, E.AwayCount) &&
            ParkCpu::At(Session, 0xcf8, E.Home) && ParkCpu::At(Session, 0xd60, E.Away);
    }
    E.WorldReadable = ParkCpu::Read(Base + 0x6832aa0, &E.World, sizeof(E.World));
    for (unsigned I = 0; I < Count; ++I) E.Players[I] = Snapshot(Players[I]);
    if (!Exit && (Where == UnbindSite || Where == RemoveSite) && Counts[Where].Attempts <= 4)
    {
        void* Frames[12]{};
        E.StackCount = CaptureStackBackTrace(1, 12, Frames, nullptr);
        for (unsigned I = 0; I < E.StackCount; ++I) E.Stack[I] = static_cast<uintptr_t>(Rva(Frames[I]));
    }
    return E;
}
inline bool Push(const Event& E)
{
    auto& Dropped = E.Exit ? Counts[E.Where].AfterDropped : Counts[E.Where].BeforeDropped;
    if (Queued == QueueSize) { ++QueueDrops; ++Dropped; return false; }
    if (Records + Count + 1 > MaxRecords) { ++BudgetDrops; ++Dropped; return false; }
    Queue[(Head + Queued) % QueueSize] = E; ++Queued; Records += Count + 1;
    if (E.Exit) ++Counts[E.Where].Exits; else ++Counts[E.Where].Entries;
    return true;
}
inline void CheckEnd(const Event& E)
{
    if (!E.SessionIdentity || !E.SessionStamp.Readable || E.SessionStamp.Match != Match) Stop(SessionEnded);
    else if (!E.WorldReadable || E.World != InitialUpdateWorld) Stop(WorldChanged);
    else if (E.Tick - Started >= DurationMs) Stop(Complete);
}
inline Token Begin(Site Where, void* Context, void* View, int32_t Arg2, int32_t Arg3, uint64_t Caller)
{
    Token T{};
    if (!Live.load()) return T;
    if (!TryAcquireSRWLockExclusive(&StateLock)) { ++LockDrops; return T; }
    if (Live)
    {
        auto& C = Counts[Where]; ++C.Calls;
        bool Selected = true;
        int Subject = -1;
        if (Where == ProcessSite)
        {
            if (Context != Session) { ++C.Filtered; Selected = false; }
            else
            {
                const auto S = ReadStamp();
                const auto Now = GetTickCount64();
                if (S == LastProcess && Now < NextProcess) { ++C.Throttled; Selected = false; }
                else { LastProcess = S; NextProcess = Now + ProcessMs; }
            }
        }
        else if (Where == RemoveSite)
        {
            for (unsigned I = 0; I < Count; ++I) if (Players[I].Wrapper == Context) Subject = static_cast<int>(I);
            if (Subject < 0) { ++C.Filtered; Selected = false; }
        }
        if (Selected && C.Attempts >= Limits[Where]) { ++C.Capped; Selected = false; }
        if (Selected)
        {
            ++C.Attempts;
            T = {Where, ++Sequence, ParentSequence, Subject, Arg2, Arg3, Context, View, Caller};
            auto E = Capture(Where, false, T.Sequence, T.Parent, Context, View, Arg2, Arg3, Subject, Caller);
            Push(E); CheckEnd(E);
            ParentSequence = T.Sequence; ++InFlight;
        }
    }
    ReleaseSRWLockExclusive(&StateLock);
    return T;
}
inline void End(const Token& T)
{
    if (!T.Sequence) return;
    ParentSequence = T.Parent;
    if (TryAcquireSRWLockExclusive(&StateLock))
    {
        if (Live)
        {
            const auto E = Capture(T.Where, true, T.Sequence, T.Parent, T.Context, T.View, T.Arg2, T.Arg3, T.Subject, T.Caller);
            Push(E);
            if (T.Where == ProcessSite) LastProcess = E.SessionStamp;
            CheckEnd(E);
        }
        else ++Counts[T.Where].SkippedExits;
        ReleaseSRWLockExclusive(&StateLock);
    }
    else ++LockDrops;
    --InFlight;
}
inline void __fastcall Process(void* NativeSession, void* View)
{
    const DWORD Error = GetLastError();
    const auto T = Begin(ProcessSite, NativeSession, View, 0, 0, Rva(_ReturnAddress()));
    SetLastError(Error); OriginalProcess(NativeSession, View);
    const DWORD ResultError = GetLastError(); End(T); SetLastError(ResultError);
}
inline void __fastcall Unbind(void* Context, int32_t Controller, int32_t RawReason)
{
    const DWORD Error = GetLastError();
    const auto T = Begin(UnbindSite, Context, nullptr, Controller, RawReason, Rva(_ReturnAddress()));
    SetLastError(Error); OriginalUnbind(Context, Controller, RawReason);
    const DWORD ResultError = GetLastError(); End(T); SetLastError(ResultError);
}
inline void __fastcall Remove(void* Wrapper, int32_t DetachOnly, int32_t Cleanup)
{
    const DWORD Error = GetLastError();
    const auto T = Begin(RemoveSite, Wrapper, nullptr, DetachOnly, Cleanup, Rva(_ReturnAddress()));
    SetLastError(Error); OriginalRemove(Wrapper, DetachOnly, Cleanup);
    const DWORD ResultError = GetLastError(); End(T); SetLastError(ResultError);
}
inline uint32_t __fastcall Submit(void* Actor, void* Input)
{
    const DWORD Error = GetLastError();
    const auto Caller = Rva(_ReturnAddress());
    if (Live && UpdateDepth && Caller == SubmitCallerRva)
    {
        if (TryAcquireSRWLockExclusive(&StateLock))
        {
            if (Live && UpdateWorld == InitialUpdateWorld)
            {
                void* Data = nullptr;
                ParkCpu::At(Actor, 0xaf0, Data);
                for (unsigned I = 0; I < Count; ++I)
                {
                    auto& P = Players[I];
                    if (!Data || P.Data != Data) continue;
                    void* Back = nullptr;
                    uint32_t Flags = 0;
                    const bool Bound = ParkCpu::At(Data, 0xf8, Flags) && (Flags & 0x20000) &&
                        ParkCpu::At(Data, 0x4f0, Back) && Back == Actor;
                    const auto A = Bound ? ReadActor(Actor, Data, Flags) : ActorView{};
                    PlayerView W{};
                    const bool First = !P.MappedActor;
                    if (!A.Layout || !A.ValuesReadable || A.Input != Input ||
                        (First ? !WrapperIdentity(P, W) : P.MappedActor != Actor)) { ++P.Rejects; break; }
                    bool DuplicateInput = false;
                    if (First || P.LastInput != Input)
                        for (unsigned J = 0; J < Count; ++J)
                            DuplicateInput |= J != I && Players[J].LastInput == Input;
                    if (DuplicateInput) { ++P.Rejects; break; }
                    const bool Changed = First || P.LastController != A.Controller;
                    P.MappedActor = Actor; P.LastInput = Input; P.LastHitWorld = UpdateWorld;
                    ++P.Hits; P.LastHitStep = WorldCalls; P.LastHitTick = GetTickCount64(); P.LastController = A.Controller;
                    if (Changed)
                    {
                        auto& C = Counts[HitSite]; ++C.Calls;
                        if (C.Attempts < Limits[HitSite])
                        {
                            ++C.Attempts;
                            const auto E = Capture(HitSite, false, ++Sequence, ParentSequence, Actor, Input, 0, 0, static_cast<int>(I), Caller);
                            Push(E); CheckEnd(E);
                        }
                        else ++C.Capped;
                    }
                    break;
                }
            }
            ReleaseSRWLockExclusive(&StateLock);
        }
        else ++LockDrops;
    }
    SetLastError(Error);
    return OriginalSubmit(Actor, Input);
}
inline void __fastcall Update()
{
    if (!Live) { OriginalUpdate(); return; }
    const DWORD Error = GetLastError();
    void* PreviousWorld = UpdateWorld;
    UpdateWorld = nullptr;
    ParkCpu::Read(Base + 0x6832aa0, &UpdateWorld, sizeof(UpdateWorld));
    ++UpdateDepth;
    SetLastError(Error); OriginalUpdate();
    const DWORD ResultError = GetLastError();
    --UpdateDepth; UpdateWorld = PreviousWorld;
    if (TryAcquireSRWLockExclusive(&StateLock))
    {
        if (Live)
        {
            ++WorldCalls;
            const auto Now = GetTickCount64();
            if (Now >= NextUpdate)
            {
                NextUpdate = Now + PeriodicMs;
                auto& C = Counts[UpdateSite]; ++C.Calls;
                if (C.Attempts < Limits[UpdateSite])
                {
                    ++C.Attempts;
                    const auto E = Capture(UpdateSite, false, ++Sequence, ParentSequence);
                    Push(E); CheckEnd(E);
                }
                else ++C.Capped;
            }
        }
        ReleaseSRWLockExclusive(&StateLock);
    }
    else ++LockDrops;
    SetLastError(ResultError);
}
inline void Arm(void* NativeSession, const ParkCpu::Multiplayer::Manifest& M)
{
    const DWORD Error = GetLastError();
    if (Used.load()) { SetLastError(Error); return; }
    const auto Reject = [Error](unsigned Code) { LastArmReject = Code; ++ArmRefusals; SetLastError(Error); };
    unsigned Humans = 0;
    for (unsigned I = 0; I < MaxPlayers; ++I) Humans += (M.HumanMask >> I) & 1;
    void* Table = nullptr;
    void* World = nullptr;
    uint64_t NativeMatch = 0;
    if (!Ready || M.TeamSize * 2 > MaxPlayers || Humans != 2 || !ParkCpu::Multiplayer::ValidManifest(M) || !ParkCpu::Multiplayer::Authorized(M) ||
        !ParkCpu::Lookup || !ParkCpu::At(NativeSession, 0, Table) || Table != Base + 0x2cbace0 ||
        !ParkCpu::At(NativeSession, 0xcb0 + ParkCpu::MatchOffset, NativeMatch) || NativeMatch != M.Match ||
        !ParkCpu::Read(Base + 0x6832aa0, &World, sizeof(World)) || !World)
    { Reject(1); return; }
    std::array<Player, MaxPlayers> Prepared{};
    unsigned N = 0;
    for (unsigned I = 0; I < MaxPlayers; ++I) if (M.Players[I])
    {
        auto& P = Prepared[N++];
        uint32_t DataFlags = 0;
        P.Puid = M.Players[I]; P.Slot = I; P.Cpu = (M.HumanMask & (1U << I)) == 0;
        P.Wrapper = ParkCpu::Lookup(NativeSession, P.Puid);
        if (!ParkCpu::At(P.Wrapper, 0, P.WrapperTable) || !ParkCpu::At(P.Wrapper, 0x44bd0, P.Key) || !P.Key ||
            !ParkCpu::At(P.Wrapper, 0x446c0, P.Container) || !ParkCpu::At(P.Container, 0x28, P.Data) || !P.Data ||
            !ParkCpu::At(P.Data, 0xf8, DataFlags) || !(DataFlags & 0x20000) ||
            !ParkCpu::At(P.Wrapper, 0x446b0, P.InitialWorld)) { Reject(2); return; }
        PlayerView V{};
        if (!WrapperIdentity(P, V)) { Reject(3); return; }
        for (unsigned J = 0; J + 1 < N; ++J)
            if (Prepared[J].Data == P.Data || Prepared[J].Wrapper == P.Wrapper) { Reject(4); return; }
    }
    bool Expected = false;
    if (!Used.compare_exchange_strong(Expected, true)) { SetLastError(Error); return; }
    AcquireSRWLockExclusive(&StateLock);
    if (Ready)
    {
        Players = Prepared; Count = N; Authority = M; Match = M.Match; Session = NativeSession;
        InitialUpdateWorld = World; Started = GetTickCount64(); NextUpdate = Started + PeriodicMs;
        NextProcess = Started + ProcessMs; LastProcess = ReadStamp(); Live = true;
        ++Counts[ArmSite].Calls; ++Counts[ArmSite].Attempts;
        Push(Capture(ArmSite, false, ++Sequence, 0));
    }
    ReleaseSRWLockExclusive(&StateLock);
    SetLastError(Error);
}
inline void WriteEvent(const Event& E)
{
    std::wostringstream T;
    T << L"DISCONNECTTRACE22-v1 event site=" << Names[E.Where] << L" phase=" << (E.Exit ? L"after" : L"before")
      << L" seq=" << E.Sequence << L" parent=" << E.Parent << L" ms=" << E.Tick - Started
      << L" thread=" << E.Thread << L" update-call=" << E.Step << L" in-update=" << E.Depth
      << L" match=0x" << std::hex << Match << L" local-puid=0x" << Authority.LocalPuid << std::dec
      << L" session=" << Session << L" session-vtable-rva=0x" << std::hex << Rva(E.SessionTable) << std::dec
      << L" session-valid=" << E.SessionIdentity << L" stamp-readable=" << E.SessionStamp.Readable
      << L" current-match=0x" << std::hex << E.SessionStamp.Match << std::dec
      << L" state=" << E.SessionStamp.State << L" locked=" << E.SessionStamp.Locked
      << L" server=" << E.Server << L" context=" << E.Context << L" view=" << E.View
      << L" subject-index=" << E.Subject << L" arg2=" << E.Arg2 << L" arg3=" << E.Arg3
      << L" caller-rva=0x" << std::hex << E.Caller << std::dec
      << L" initial-update-world=" << InitialUpdateWorld << L" current-world=" << E.World << L" world-readable=" << E.WorldReadable
      << L" roster-readable=" << E.RosterReadable << L" counts=" << E.HomeCount << L"/" << E.AwayCount;
    T << L" home=" << std::hex;
    for (unsigned I = 0; I < 3; ++I) T << (I ? L"," : L"") << E.Home[I];
    T << L" away=";
    for (unsigned I = 0; I < 3; ++I) T << (I ? L"," : L"") << E.Away[I];
    if (E.StackCount)
    {
        T << L" stack-rvas=";
        for (unsigned I = 0; I < E.StackCount; ++I) T << (I ? L"," : L"") << L"0x" << E.Stack[I];
    }
    Log(LogLevel::Info, T.str(), true);
    for (unsigned I = 0; I < Count; ++I)
    {
        const auto& V = E.Players[I]; const auto& P = V.Identity; const auto& A = V.Current;
        std::wostringstream L;
        L << L"DISCONNECTTRACE22-v1 player seq=" << E.Sequence << L" phase=" << (E.Exit ? L"after" : L"before")
          << L" roster-index=" << I << L" authorized-slot=" << P.Slot << L" role=" << (P.Cpu ? L"cpu" : L"human")
          << L" puid=0x" << std::hex << P.Puid << L" key=0x" << P.Key << std::dec
          << L" wrapper=" << P.Wrapper << L" wrapper-valid=" << V.WrapperIdentity << L" wrapper-fields=" << V.WrapperFields
          << L" wrapper-flags=0x" << std::hex << V.WrapperFlags << std::dec << L" wrapper-state=" << V.WrapperState << L" seen=" << unsigned{V.Seen}
          << L" container=" << P.Container << L" current-container=" << V.CurrentContainer
          << L" data=" << P.Data << L" current-data=" << V.CurrentData << L" data-readable=" << V.DataReadable
          << L" data-flags=0x" << std::hex << V.DataFlags << std::dec
          << L" wrapper-world=" << V.WrapperWorld << L" world-vtable-rva=0x" << std::hex << Rva(V.WrapperWorldTable) << std::dec
          << L" world-lookup-complete=" << V.WorldLookup << L" world-actor=" << V.WorldActor
          << L" initial-wrapper-world=" << P.InitialWorld << L" initial-world-vtable-rva=0x" << std::hex << Rva(V.InitialWorldTable) << std::dec
          << L" initial-world-lookup-complete=" << V.InitialWorldLookup << L" initial-world-actor-now=" << V.InitialWorldActor
          << L" roster-back-actor=" << V.BackActor << L" world-equals-roster=" << (V.WorldLookup && V.DataReadable && V.BackActor && V.WorldActor == V.BackActor)
          << L" actor-vtable-rva=0x" << std::hex << Rva(A.Table) << std::dec << L" actor-data=" << A.Data
          << L" actor-layout=" << A.Layout << L" values-readable=" << A.ValuesReadable << L" controller=" << A.Controller << L" actor-C44=" << A.C44
          << L" input=" << A.Input << L" moves=" << A.Moves << L" state=" << A.State
          << L" state-vtable-rva=0x" << std::hex << Rva(A.StateTable) << std::dec << L" state-readable=" << A.StateReadable
          << L" mapped-actor=" << P.MappedActor << L" mapped-readable=" << V.MappedReadable
          << L" mapped-vtable-rva=0x" << std::hex << Rva(V.MappedTable) << std::dec << L" mapped-data=" << V.MappedData
          << L" mapped-equals-roster=" << (P.MappedActor && V.DataReadable && P.MappedActor == V.BackActor)
          << L" update-hits=" << P.Hits << L" identity-rejects=" << P.Rejects << L" last-hit-input=" << P.LastInput
          << L" last-hit-world=" << P.LastHitWorld << L" last-hit-update=" << P.LastHitStep
          << L" last-hit-ms=" << (P.LastHitTick ? P.LastHitTick - Started : 0);
        Log(LogLevel::Info, L.str(), true);
    }
}
inline void Drain()
{
    // Drain one copied batch at a time; never read game pointers on the logger thread.
    for (;;)
    {
        Event E{};
        AcquireSRWLockExclusive(&StateLock);
        if (!Queued) { ReleaseSRWLockExclusive(&StateLock); break; }
        E = Queue[Head]; Head = (Head + 1) % QueueSize; --Queued;
        ReleaseSRWLockExclusive(&StateLock);
        WriteEvent(E);
    }
}
struct HookSite { size_t Rva; const char* Bytes; size_t Size; void* Hook; void** Original; };
inline const HookSite Sites[] = {
    {0x1d22e90, "\x40\x57\x48\x83\xec\x70\x48\x89\x9c\x24\x80\x00\x00\x00\x0f\x29\x74\x24\x60", 19,
        reinterpret_cast<void*>(&Update), reinterpret_cast<void**>(&OriginalUpdate)},
    {0x19e0890, "\x40\x53\x48\x83\xec\x30\x48\x8b\x42\x30\x48\x8b\xda\x48\x89\x44\x24\x48", 18,
        reinterpret_cast<void*>(&Submit), reinterpret_cast<void**>(&OriginalSubmit)},
    {0x16c3180, "\x48\x85\xd2\x0f\x84\xa9\x10\x00\x00\x48\x8b\xc4\x48\x89\x48\x08", 16,
        reinterpret_cast<void*>(&Process), reinterpret_cast<void**>(&OriginalProcess)},
    {0x17afc80, "\x85\xd2\x0f\x88\xa9\x00\x00\x00\x48\x89\x5c\x24\x08\x48\x89\x74\x24\x10", 18,
        reinterpret_cast<void*>(&Unbind), reinterpret_cast<void**>(&OriginalUnbind)},
    {0x16cdb50, "\x4c\x8b\xdc\x49\x89\x5b\x08\x49\x89\x73\x10\x57\x48\x83\xec\x70", 16,
        reinterpret_cast<void*>(&Remove), reinterpret_cast<void**>(&OriginalRemove)},
    {0x1d90871, "\x49\x8b\xd5\x49\x8b\xce\xe8\x14\x00\xc5\xff", 11, nullptr, nullptr},
    {0x1aad22c, "\x48\x89\xbb\xf0\x0a\x00\x00\x48\x8b\xcf\xe8\x55\xcb\xec\xfe", 15, nullptr, nullptr},
    {0x979d95, "\xf7\x81\xf8\x00\x00\x00\x00\x00\x02\x00\x74\x08\x48\x89\x91\xf0\x04\x00\x00", 19, nullptr, nullptr},
    {0x1b775da, "\x48\x8b\xb9\x60\x0e\x00\x00", 7, nullptr, nullptr},
    {0x1edfa50, "\x8b\xc1\xba\x40\xf1\xa3\xfa\x48\x0f\xaf\xc2\x48\xc1\xe9\x20", 15, nullptr, nullptr},
};
inline bool Signatures(size_t& Failed)
{
    for (const auto& S : Sites)
    {
        unsigned char Bytes[24]{};
        if (!ParkCpu::Read(Base + S.Rva, Bytes, S.Size) || memcmp(Bytes, S.Bytes, S.Size)) { Failed = S.Rva; return false; }
    }
    void* Setter = nullptr;
    if (!ParkCpu::At(Base + 0x2d5e1c8, 0x1b0, Setter) || Setter != Base + 0x1aad1e0) { Failed = 0x2d5e378; return false; }
    return true;
}
inline bool InstallHooks()
{
    unsigned Made = 0, Enabled = 0;
    MH_STATUS Status = MH_OK;
    constexpr unsigned HookCount = 5;
    for (; Made < HookCount; ++Made)
    {
        const auto& S = Sites[Made]; Status = MH_CreateHook(Base + S.Rva, S.Hook, S.Original);
        if (Status != MH_OK) break;
    }
    if (Made == HookCount) for (; Enabled < HookCount; ++Enabled)
    { Status = MH_EnableHook(Base + Sites[Enabled].Rva); if (Status != MH_OK) break; }
    if (Made != HookCount || Enabled != HookCount)
    {
        for (unsigned I = 0; I < Enabled; ++I) MH_DisableHook(Base + Sites[I].Rva);
        for (unsigned I = 0; I < Made; ++I) MH_RemoveHook(Base + Sites[I].Rva);
        Log(LogLevel::Error, L"DISCONNECTTRACE22-v1 hook installation failed status=" + std::to_wstring(Status)); return false;
    }
    Ready = true; ParkCpu::Multiplayer::AfterPlaying.store(&Arm);
    Log(LogLevel::Info, L"DISCONNECTTRACE22-v1 ready; first authorized two-human mixed park match; <=120s/1200 records; observation only", true);
    return true;
}
inline DWORD WINAPI Worker(void*)
{
    const ULONGLONG WaitUntil = GetTickCount64() + 30'000;
    size_t Failed = 0;
    while (!Signatures(Failed))
    {
        if (GetTickCount64() >= WaitUntil)
        {
            std::wostringstream T; T << L"DISCONNECTTRACE22-v1 signature mismatch rva=0x" << std::hex << Failed << L"; disabled";
            Log(LogLevel::Error, T.str()); return 1;
        }
        Sleep(250);
    }
    if (!InstallHooks()) return 1;
    const ULONGLONG IdleUntil = GetTickCount64() + 15 * 60'000;
    uint64_t ReportedRefusals = 0;
    for (;;)
    {
        Sleep(250); Drain();
        if (const auto N = ArmRefusals.load(); N != ReportedRefusals)
        {
            ReportedRefusals = N;
            Log(LogLevel::Info, L"DISCONNECTTRACE22-v1 arm-refused count=" + std::to_wstring(N) +
                L" code=" + std::to_wstring(LastArmReject.load()) +
                L" (1=authority/session/world,2=roster-read/flags,3=wrapper-identity,4=duplicate-anchor)", true);
        }
        AcquireSRWLockShared(&StateLock);
        const auto BeginTick = Started; const auto M = Authority;
        ReleaseSRWLockShared(&StateLock);
        const auto Now = GetTickCount64();
        if (!BeginTick)
        {
            if (Now < IdleUntil) continue;
            AcquireSRWLockExclusive(&StateLock); Reason = IdleTimeout; ReleaseSRWLockExclusive(&StateLock); break;
        }
        const bool Authorized = ParkCpu::Multiplayer::Authorized(M);
        AcquireSRWLockExclusive(&StateLock);
        if (Live && Now - BeginTick >= DurationMs) Stop(Complete);
        if (Live && !Authorized) Stop(AuthorizationEnded);
        const bool Done = !Live;
        ReleaseSRWLockExclusive(&StateLock);
        if (Done) break;
    }
    AcquireSRWLockExclusive(&StateLock);
    Ready = false; Live = false; ParkCpu::Multiplayer::AfterPlaying.store(nullptr);
    const auto Final = Players; const auto Stats = Counts; const auto Why = Reason;
    const auto Pending = InFlight.load(); const auto Steps = WorldCalls; const auto Lines = Records;
    ReleaseSRWLockExclusive(&StateLock);
    Drain();
    for (unsigned I = 0; I < Count; ++I)
    {
        const auto& P = Final[I];
        std::wostringstream T; T << L"DISCONNECTTRACE22-v1 counts roster-index=" << I << L" authorized-slot=" << P.Slot
            << L" role=" << (P.Cpu ? L"cpu" : L"human") << L" update-hits=" << P.Hits << L" identity-rejects=" << P.Rejects
            << L" mapped-actor=" << P.MappedActor << L" last-controller=" << P.LastController;
        Log(LogLevel::Info, T.str(), true);
    }
    for (unsigned I = 0; I < SiteCount; ++I)
    {
        const auto& C = Stats[I];
        std::wostringstream T; T << L"DISCONNECTTRACE22-v1 site-counts site=" << Names[I] << L" calls=" << C.Calls
            << L" filtered=" << C.Filtered << L" throttled=" << C.Throttled << L" capped=" << C.Capped
            << L" attempts=" << C.Attempts << L" before-queued=" << C.Entries << L" after-queued=" << C.Exits
            << L" before-dropped=" << C.BeforeDropped << L" after-dropped=" << C.AfterDropped << L" skipped-exits=" << C.SkippedExits;
        Log(LogLevel::Info, T.str(), true);
    }
    Log(LogLevel::Info, std::wstring(L"DISCONNECTTRACE22-v1 stopped reason=") + Reasons[Why] +
        L" records=" + std::to_wstring(Lines) + L" lock-drops=" + std::to_wstring(LockDrops.load()) +
        L" queue-drops=" + std::to_wstring(QueueDrops.load()) + L" budget-drops=" + std::to_wstring(BudgetDrops.load()) +
        L" in-flight-at-stop=" + std::to_wstring(Pending) + L" update-calls=" + std::to_wstring(Steps) +
        L"; hooks pass-through; pointer equality is not lifetime/AI proof; missing samples are not absence", true);
    return 0;
}
inline void Install(HMODULE Executable)
{
    Base = reinterpret_cast<unsigned char*>(Executable);
    if (HANDLE Thread = CreateThread(nullptr, 0, Worker, nullptr, 0, nullptr)) CloseHandle(Thread);
    else Log(LogLevel::Error, L"DISCONNECTTRACE22-v1 worker could not be started");
}
}
