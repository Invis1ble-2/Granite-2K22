// NBA 2K22 park CPUs: shared profile execution and hooks, with solo/multiplayer authority adapters.
#pragma once
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <sstream>
#include <string>
#include <xmmintrin.h>
#include "MatchLifecycleHooks.h"
#include "GameSessionDiscovery.h"

namespace ParkCpu
{
inline constexpr uint32_t ModuleVersion = 0x00010226;
inline constexpr uint64_t CpuMask = 0xfffff00000000000ULL, CpuPrefix = 0x0222c00000000000ULL;
inline constexpr uint32_t MaxTemplates = 72, MaxLeaseMs = 8000;
inline constexpr unsigned MaxPlayers = 10;
inline bool SupportedTeamSize(uint32_t Size) { return Size == 2 || Size == 3 || Size == 5; }
inline unsigned SideStride(uint32_t TeamSize) { return TeamSize == 5 ? 5 : 3; }
inline unsigned char* ExeBase = nullptr;
using GenerateFn = void*(__fastcall*)(void*, void*, void*);
using LookupFn = void*(__fastcall*)(void*, uint64_t);
inline bool IsCpu(uint64_t Id) { return (Id & CpuMask) == CpuPrefix; }
inline bool Read(const void* Address, void* Out, size_t Size)
{
    SIZE_T N = 0;
    return Address && ReadProcessMemory(GetCurrentProcess(), Address, Out, Size, &N) && N == Size;
}
template<class T> inline bool At(const void* Base, size_t Offset, T& Value)
{
    return Base && Read(static_cast<const unsigned char*>(Base) + Offset, &Value, sizeof(Value));
}
inline uint32_t ActiveMask(uint32_t TeamSize) { return TeamSize == 5 ? 0x3ffU : TeamSize == 2 ? 0x1bU : 0x3fU; }

// Profile: apply server-authored parameters and verify native data. No local generation policy.
namespace Profile
{
inline constexpr size_t TemplateBytes = 0x560, DataBytes = 0x4f0, AttributeCount = 0x39, BadgeCount = 99;
// PLAYERDATA_ATTRIBUTE mappings verified against native getter/setter cases.
inline constexpr unsigned ThreePointAbility = 0x07;
inline constexpr unsigned ShotTendencyIndices[] = {0x53, 0x54};
inline constexpr size_t ShapeOffsets[] = {4, 8, 0xc, 0x10, 0x14};
inline std::atomic_bool Ready = false;
struct ApiSite { size_t Rva; const char* Bytes; size_t Size; };
// NBA2K22.exe.unpacked.exe, image base 0x140000000. Checked before installing hooks.
inline constexpr ApiSite ApiSites[] = {
    {0x97c340, "\x48\x85\xc9\x0f\x84\x8a\x07\x00\x00\x81\xfa\x9e\x00\x00\x00", 15},
    {0x9949f0, "\x48\x89\x5c\x24\x08\x48\x89\x6c\x24\x10\x48\x89\x74\x24\x18\x57\x48\x83\xec\x20", 20},
    {0x99f650, "\x48\x8b\xc4\x55\x53\x57\x41\x54\x48\x8d\xa8\x58\xfd\xff\xff", 15},
    {0x979130, "\x48\x83\xec\x28\xe8\x07\xfa\x00\x00\x48\x83\xc4\x28\xe9", 14},
    {0x11010d0, "\x48\x8b\xc4\x48\x89\x58\x08\x57\x48\x83\xec\x60\xf3\x0f\x10\x41\x14", 17},
    {0x16403a0, "\x48\x89\x5c\x24\x08\x55\x56\x57\x41\x54\x41\x55\x41\x56\x41\x57\x48\x8d\xac\x24\x10\xf5\xff\xff\x48\x81\xec\xf0\x0b\x00\x00", 31},
    {0x9800a0, "\x45\x32\xc9\x45\x33\xd2\x83\xfa\x62\x0f\x87\x12\x06\x00\x00\x48\x63\xc2\x4c\x8d", 20},
    {0x996d20, "\x40\x53\x55\x56\x41\x55\x48\x83\xec\x78\x4c\x63\xea\x41\x0f\xb6\xe8\x41\x8b\xd5", 20},
    {0x19544e0, "\x83\xf9\x62\x77\x24\x48\x63\xc1\x48\x8d\x15\x11\xbb\x6a\xfe\x0f\xb6\x84\x02\x14", 20},
};
using GetAttributeFn = int(__fastcall*)(void*, unsigned);
using SetAttributeFn = void(__fastcall*)(void*, unsigned, int);
using RecalculateFn = void(__fastcall*)(void*, int);
using OverallFn = int(__fastcall*)(void*);
using DeriveBodyFn = void(__fastcall*)(void*, float);
using GetBadgeFn = uint8_t(__fastcall*)(void*, unsigned, int);
using SetBadgeFn = void(__fastcall*)(void*, unsigned, uint8_t, int);
using BadgeLimitFn = uint8_t(__fastcall*)(unsigned);
inline GetAttributeFn GetAttribute = nullptr;
inline SetAttributeFn SetAttribute = nullptr;
inline RecalculateFn Recalculate = nullptr;
inline OverallFn Overall = nullptr;
inline DeriveBodyFn DeriveBody = nullptr;
inline GetBadgeFn GetBadge = nullptr;
inline SetBadgeFn SetBadge = nullptr;
inline BadgeLimitFn BadgeLimit = nullptr;
inline void Bind(unsigned char* Base)
{
    GetAttribute = reinterpret_cast<GetAttributeFn>(Base + ApiSites[0].Rva);
    SetAttribute = reinterpret_cast<SetAttributeFn>(Base + ApiSites[1].Rva);
    Recalculate = reinterpret_cast<RecalculateFn>(Base + ApiSites[2].Rva);
    Overall = reinterpret_cast<OverallFn>(Base + ApiSites[3].Rva);
    DeriveBody = reinterpret_cast<DeriveBodyFn>(Base + ApiSites[4].Rva);
    GetBadge = reinterpret_cast<GetBadgeFn>(Base + ApiSites[6].Rva);
    SetBadge = reinterpret_cast<SetBadgeFn>(Base + ApiSites[7].Rva);
    BadgeLimit = reinterpret_cast<BadgeLimitFn>(Base + ApiSites[8].Rva);
}
template<class T> inline T Load(const unsigned char* Data, size_t Offset)
{
    T Value{}; memcpy(&Value, Data + Offset, sizeof(Value)); return Value;
}
template<class T> inline void Store(unsigned char* Data, size_t Offset, T Value)
{
    memcpy(Data + Offset, &Value, sizeof(Value));
}
// Fixed LE wire layout shared by both control protocols; no pointers or padding.
struct Parameters
{
    uint32_t Rating = 0, Position = 0, Type = 0, Height = 0, Weight = 0;
    std::array<uint32_t, 5> Shape{};
    std::array<uint32_t, AttributeCount> Attributes{};
    std::array<uint32_t, BadgeCount> Badges{};
    std::array<uint32_t, 2> ShotTendencies{};
    bool operator==(const Parameters&) const = default;
};
static_assert(sizeof(Parameters) == 672 && offsetof(Parameters, Attributes) == 40);
struct Snapshot
{
    uint32_t Rating = 0, Position = 0, Type = 0, Height = 0, DerivedHeight = 0, Weight = 0;
    // Weight and Shape store raw float bits for exact profile comparison/hashing.
    std::array<uint32_t, 5> Shape{};
    std::array<uint32_t, AttributeCount> Attributes{};
    std::array<uint32_t, BadgeCount> Badges{};
    std::array<uint32_t, 2> ShotTendencies{};
    bool operator==(const Snapshot&) const = default;
};
inline Parameters ParametersFor(const Snapshot& S)
{
    Parameters P{};
    P.Rating = S.Rating; P.Position = S.Position; P.Type = S.Type; P.Height = S.Height; P.Weight = S.Weight;
    P.Shape = S.Shape; P.Attributes = S.Attributes; P.Badges = S.Badges; P.ShotTendencies = S.ShotTendencies;
    return P;
}
inline bool ValidParameters(const Parameters& P)
{
    float Weight = 0; memcpy(&Weight, &P.Weight, sizeof(Weight));
    if (P.Rating < 80 || P.Rating > 99 || P.Position > 4 || P.Type > 8 ||
        P.Height < 17500 || P.Height > 22000 || P.Height % 100 ||
        !std::isfinite(Weight) || Weight < 165 || Weight > 325 || std::floor(Weight) != Weight) return false;
    for (uint32_t Bits : P.Shape)
    {
        float Value = 0; memcpy(&Value, &Bits, sizeof(Value));
        if (!std::isfinite(Value) || Value <= 0) return false;
    }
    for (uint32_t Value : P.Attributes) if (Value < 25 || Value > 99) return false;
    for (unsigned I = 0; I < BadgeCount; ++I)
    {
        const bool Flag = I == 0x24 || (I < 0x24 && (I & 3) < 2);
        if (P.Badges[I] > (Flag ? 1U : 4U)) return false;
    }
    for (uint32_t Value : P.ShotTendencies) if (Value > 100) return false;
    return true;
}
struct Generation
{
    // Lives through the whole Generate call, not merely the nested Create call.
    alignas(16) unsigned char Data[TemplateBytes]{};
    Snapshot Expected{};
    Parameters Command{};
    const Parameters* Candidates = nullptr;
    unsigned CandidateCount = 1, Candidate = 0;
    std::string Error; // First failure within an attempt; terminal failure reaches the receipt.
    void* Session = nullptr;
    uint64_t Id = 0;
    const void* Authority = nullptr;
    bool (*Authorized)(const void*) = nullptr;
    uint32_t Seed = 0, PoolCount = 0, Template = 0;
    unsigned char PoolDigest[32]{};
    uint32_t Valid : 1 = 0;
    uint32_t Seen : 1 = 0;
    uint32_t Entered : 1 = 0;
};
inline thread_local Generation* Generating = nullptr;
struct Scope
{
    Generation* Previous;
    explicit Scope(Generation& G) : Previous(Generating) { Generating = &G; }
    ~Scope() { Generating = Previous; }
    Scope(const Scope&) = delete;
    Scope& operator=(const Scope&) = delete;
};
inline bool Authorized(const Generation& G)
{
    return Ready && G.Valid && G.Id && G.Seed && G.Authorized && G.Authorized(G.Authority);
}
inline bool Reject(std::string* Error, const std::string& Reason)
{
    if (Error && Error->empty()) *Error = Reason;
    return false;
}
inline bool WriteBadge(void* Data, unsigned Index, uint8_t Level, std::string* Error)
{
    if (Index >= BadgeCount || BadgeLimit(Index) != 4 || Level > 4)
        return Reject(Error, "badge-write-range:index=" + std::to_string(Index));
    // fixupFlag=1: write only this graded badge, without personality fixups.
    SetBadge(Data, Index, Level, 1);
    return GetBadge(Data, Index, 0) == Level ||
        Reject(Error, "badge-write-mismatch:index=" + std::to_string(Index));
}
inline bool Capture(void* Data, Snapshot& S, std::string* Error = nullptr)
{
    unsigned char Bytes[DataBytes]{}, Appearance[0x40]{};
    if (!Ready || !Read(Data, Bytes, sizeof(Bytes))) return Reject(Error, "data-unreadable");
    S.Position = (Load<uint32_t>(Bytes, 0xf8) >> 8) & 7;
    S.Type = (Load<uint32_t>(Bytes, 0x168) >> 26) & 0x1f;
    if (S.Position > 4) return Reject(Error, "position-range:actual=" + std::to_string(S.Position));
    if (S.Type > 8) return Reject(Error, "type-range:actual=" + std::to_string(S.Type));
    if (!Read(Load<void*>(Bytes, 0x90), Appearance, sizeof(Appearance)))
        return Reject(Error, "appearance-unreadable");
    S.Height = Load<uint16_t>(Appearance, 0) & 0x7fff;
    S.DerivedHeight = Load<uint16_t>(Appearance, 2) & 0x7fff;
    S.Weight = Load<uint32_t>(Bytes, 0x58);
    const float Weight = Load<float>(Bytes, 0x58);
    if (!std::isfinite(Weight) || Weight < 165.0f || Weight > 325.0f || std::floor(Weight) != Weight)
        return Reject(Error, "weight-range:actual=" + std::to_string(Weight));
    if (S.Height < 17500 || S.Height > 22000)
        return Reject(Error, "height-range:actual=" + std::to_string(S.Height));
    if (!S.DerivedHeight) return Reject(Error, "derived-height-zero");
    for (size_t I = 0; I < S.Shape.size(); ++I)
    {
        const float Value = Load<float>(Appearance, ShapeOffsets[I]);
        if (!std::isfinite(Value) || Value <= 0.0f)
            return Reject(Error, "shape-range:index=" + std::to_string(I) + ":actual=" + std::to_string(Value));
        S.Shape[I] = Load<uint32_t>(Appearance, ShapeOffsets[I]);
    }
    for (unsigned I = 0; I < AttributeCount; ++I)
    {
        const int Value = GetAttribute(Data, I);
        if (Value < 25 || Value > 99)
            return Reject(Error, "attribute-range:index=" + std::to_string(I) + ":actual=" + std::to_string(Value));
        S.Attributes[I] = static_cast<uint32_t>(Value);
    }
    for (size_t I = 0; I < S.ShotTendencies.size(); ++I)
    {
        const int Value = GetAttribute(Data, ShotTendencyIndices[I]);
        if (Value < 0 || Value > 100)
            return Reject(Error, "shot-tendency-range:index=" + std::to_string(I));
        S.ShotTendencies[I] = static_cast<uint32_t>(Value);
    }
    for (unsigned I = 0; I < BadgeCount; ++I)
    {
        const unsigned Limit = BadgeLimit(I), Level = GetBadge(Data, I, 0);
        if ((Limit != 1 && Limit != 4) || Level > Limit)
            return Reject(Error, "badge-range:index=" + std::to_string(I) + ":actual=" + std::to_string(Level));
        S.Badges[I] = Level;
    }
    const int Rating = Overall(Data); // 0x140979130 -> 0x140988b40 -> display conversion.
    if (Rating < 80 || Rating > 99) return Reject(Error, "overall-range:actual=" + std::to_string(Rating));
    S.Rating = static_cast<uint32_t>(Rating);
    return true;
}
inline bool Compare(const Snapshot& Actual, const Snapshot& Expected, std::string* Error)
{
    struct Field { const char* Name; uint32_t Actual, Expected; };
    const Field Fields[] = {
        {"overall", Actual.Rating, Expected.Rating}, {"position", Actual.Position, Expected.Position},
        {"type", Actual.Type, Expected.Type}, {"height", Actual.Height, Expected.Height},
        {"derived-height", Actual.DerivedHeight, Expected.DerivedHeight}, {"weight", Actual.Weight, Expected.Weight},
    };
    for (const auto& F : Fields) if (F.Actual != F.Expected)
        return Reject(Error, std::string(F.Name) + ":expected=" + std::to_string(F.Expected) + ":actual=" + std::to_string(F.Actual));
    for (size_t I = 0; I < Actual.Shape.size(); ++I) if (Actual.Shape[I] != Expected.Shape[I])
        return Reject(Error, "shape-bits:index=" + std::to_string(I) + ":expected=" + std::to_string(Expected.Shape[I]) + ":actual=" + std::to_string(Actual.Shape[I]));
    for (size_t I = 0; I < Actual.Attributes.size(); ++I) if (Actual.Attributes[I] != Expected.Attributes[I])
        return Reject(Error, "attribute:index=" + std::to_string(I) + ":expected=" + std::to_string(Expected.Attributes[I]) + ":actual=" + std::to_string(Actual.Attributes[I]));
    for (size_t I = 0; I < Actual.Badges.size(); ++I) if (Actual.Badges[I] != Expected.Badges[I])
        return Reject(Error, "badge:index=" + std::to_string(I) + ":expected=" + std::to_string(Expected.Badges[I]) + ":actual=" + std::to_string(Actual.Badges[I]));
    for (size_t I = 0; I < Actual.ShotTendencies.size(); ++I) if (Actual.ShotTendencies[I] != Expected.ShotTendencies[I])
        return Reject(Error, "shot-tendency:index=" + std::to_string(I) + ":expected=" + std::to_string(Expected.ShotTendencies[I]) +
            ":actual=" + std::to_string(Actual.ShotTendencies[I]));
    return true;
}
inline bool Apply(Generation& G, const unsigned char* Source)
{
    if (!Authorized(G)) return Reject(&G.Error, "apply-authorization");
    // Server emulates SSE round-to-nearest-even. Never silently use another mode.
    if ((_mm_getcsr() & _MM_ROUND_MASK) != _MM_ROUND_NEAREST)
        return Reject(&G.Error, "unsupported-rating-rounding-mode");
    const auto& P = G.Command;
    if (!ValidParameters(P)) return Reject(&G.Error, "invalid-server-profile");
    if (!Read(Source, G.Data, sizeof(G.Data))) return Reject(&G.Error, "template-unreadable");
    constexpr size_t ZeroSlots[] = {0x60, 0x78, 0x80, 0x98, 0xa0, 0xa8, 0xb0, 0xb8, 0xc0, 0xc8, 0xd0, 0xd8, 0xe0};
    for (size_t Offset : ZeroSlots) if (Load<uint64_t>(G.Data, Offset))
        return Reject(&G.Error, "template-nonzero-slot:offset=" + std::to_string(Offset));
    if (Load<const void*>(G.Data, 0x88) != Source + 0x4f0 ||
        Load<const void*>(G.Data, 0x90) != Source + 0x520) return Reject(&G.Error, "template-pointer-layout");
    Store(G.Data, 0x88, G.Data + 0x4f0);
    Store(G.Data, 0x90, G.Data + 0x520);
    const uint32_t Position = (Load<uint32_t>(G.Data, 0xf8) >> 8) & 7;
    if (Position > 5 || P.Position != (Position == 5 ? 4 : Position))
        return Reject(&G.Error, "server-template-position-mismatch");
    Store(G.Data, 0xf8, (Load<uint32_t>(G.Data, 0xf8) & ~0x700U) | (P.Position << 8));
    auto* Appearance = G.Data + 0x520;
    for (size_t I = 0; I < P.Shape.size(); ++I)
        if (Load<uint32_t>(Appearance, ShapeOffsets[I]) != P.Shape[I])
            return Reject(&G.Error, "server-template-shape-mismatch");
    // Potential and personality flags are immutable template fields, not server overrides.
    if (GetAttribute(G.Data, 0x22) != static_cast<int>(P.Attributes[0x22]))
        return Reject(&G.Error, "server-template-potential-mismatch");
    Store(Appearance, 0, static_cast<uint16_t>((Load<uint16_t>(Appearance, 0) & 0x8000) | P.Height));
    Store(G.Data, 0x58, P.Weight);
    DeriveBody(Appearance, Load<float>(Appearance, 0xc));
    for (unsigned I = 0; I < AttributeCount; ++I) if (I != 0x22)
        SetAttribute(G.Data, I, static_cast<int>(P.Attributes[I]));
    for (unsigned I = 0; I < BadgeCount; ++I)
    {
        const unsigned Limit = BadgeLimit(I);
        if (Limit == 1)
        {
            if (GetBadge(G.Data, I, 0) != P.Badges[I])
                return Reject(&G.Error, "server-template-personality-mismatch");
        }
        else if (Limit != 4 || !WriteBadge(G.Data, I, static_cast<uint8_t>(P.Badges[I]), &G.Error)) return false;
    }
    // Native cache/type/body maintenance only; no local search or attribute decisions.
    Recalculate(G.Data, 0);
    for (size_t I = 0; I < P.ShotTendencies.size(); ++I)
        SetAttribute(G.Data, ShotTendencyIndices[I], static_cast<int>(P.ShotTendencies[I]));
    if (!Capture(G.Data, G.Expected, &G.Error)) return false;
    auto Actual = ParametersFor(G.Expected);
    if (!(Actual == P))
    {
        // Body, type, badges and tendencies must match before retrying a scoring mismatch.
        Actual.Rating = P.Rating; Actual.Attributes = P.Attributes;
        if (!(Actual == P)) return Reject(&G.Error, "server-profile-readback-mismatch");
        if (G.Expected.Rating != P.Rating)
            return Reject(&G.Error, "server-profile-overall:expected=" + std::to_string(P.Rating) +
                ":actual=" + std::to_string(G.Expected.Rating));
        for (size_t I = 0; I < P.Attributes.size(); ++I) if (G.Expected.Attributes[I] != P.Attributes[I])
            return Reject(&G.Error, "server-profile-attribute:index=" + std::to_string(I) +
                ":expected=" + std::to_string(P.Attributes[I]) + ":actual=" + std::to_string(G.Expected.Attributes[I]));
    }
    return Authorized(G) || Reject(&G.Error, "apply-authorization-expired");
}
inline bool ApplyCandidates(Generation& G, const unsigned char* Source)
{
    if (!G.Candidates) return Apply(G, Source);
    for (G.Candidate = 0; G.Candidate < G.CandidateCount; ++G.Candidate)
    {
        G.Command = G.Candidates[G.Candidate]; G.Expected = {}; G.Error.clear();
        // Apply always copies Source anew. No native player exists until a candidate passes.
        if (Apply(G, Source)) return true;
        const bool Retryable = G.Error.starts_with("overall-range:") ||
            G.Error.starts_with("server-profile-overall:") || G.Error.starts_with("server-profile-attribute:");
        const bool Again = Retryable && G.Candidate + 1 < G.CandidateCount;
        std::wostringstream Text;
        Text << L"SOLO22 CPU id=0x" << std::hex << G.Id << std::dec << L" template=" << G.Template <<
            L" seed=" << G.Seed << L" candidate=" << G.Candidate + 1 << L"/" << G.CandidateCount <<
            L" target=" << G.Command.Rating << L" refused: " << std::wstring(G.Error.begin(), G.Error.end()) <<
            (Again ? L"; trying next authorized candidate" : L"; generation stopped");
        Log(Again ? LogLevel::Info : LogLevel::Error, Text.str());
        if (!Again)
        {
            G.Error += ":template=" + std::to_string(G.Template) + ":seed=" + std::to_string(G.Seed) +
                ":candidate=" + std::to_string(G.Candidate + 1) + "/" + std::to_string(G.CandidateCount) +
                ":target=" + std::to_string(G.Command.Rating);
            return false;
        }
    }
    return false;
}
// OverallRating is the U8 at ServerObject+0x14d; TK_WORLD::PLAYER embeds it at +0x50.
// Player+0x1b4 and PLAYERDATA+0x70 bits 13..19 are JerseyNumber, not overall.
inline constexpr size_t DisplayOffset = 0x50 + 0x14d, DisplayDirtyOffset = 0x50 + 0x14e;
static_assert(DisplayOffset == 0x19d && DisplayDirtyOffset == 0x19e);
inline bool VerifyData(void* Player, uint64_t Id, const Snapshot& Expected, std::string* Error)
{
    uint64_t Puid = 0; uint32_t Flags = 0; void* Container = nullptr; void* Data = nullptr;
    if (!Expected.Rating) return Reject(Error, "expected-profile-missing");
    if (!At(Player, 0xf0, Puid) || Puid != Id) return Reject(Error, "player-identity");
    if (!At(Player, 0x2200, Flags) || !(Flags & 8)) return Reject(Error, "player-not-cpu");
    if (!At(Player, 0x446c0, Container) || !At(Container, 0x28, Data) || !Data)
        return Reject(Error, "roster-unavailable");
    Snapshot Actual{}, Embedded{}; std::string Detail;
    // 0x140fbcfb0 -> 0x1410e9990: validate both real data sources before
    // touching any display field. Overall() always derives from attributes.
    if (!Capture(static_cast<unsigned char*>(Player) + 0x2208, Embedded, &Detail) || !Compare(Embedded, Expected, &Detail))
        return Reject(Error, "embedded-" + Detail);
    if (!Capture(Data, Actual, &Detail) || !Compare(Actual, Expected, &Detail))
        return Reject(Error, "roster-" + Detail);
    return true;
}
inline bool VerifyDisplay(void* Player, const Snapshot& Expected, std::string* Error)
{
    uint8_t Display = 0;
    if (!At(Player, DisplayOffset, Display)) return Reject(Error, "display-unreadable");
    if (Display != Expected.Rating)
        return Reject(Error, "display:expected=" + std::to_string(Expected.Rating) + ":actual=" + std::to_string(Display));
    return true;
}
inline bool Verify(void* Player, uint64_t Id, const Snapshot& Expected, std::string* Error = nullptr)
{
    return VerifyData(Player, Id, Expected, Error) && VerifyDisplay(Player, Expected, Error);
}
inline bool Finish(Generation& G, void* Player)
{
    if (!G.Valid) return Reject(&G.Error, "generation-invalid");
    if (!G.Seen) return Reject(&G.Error, G.Entered ? "create-returned-null" : "create-hook-not-reached");
    if (!Authorized(G)) return Reject(&G.Error, "generation-authorization");
    if (!VerifyData(Player, G.Id, G.Expected, &G.Error)) return false;
    // Native Create initializes OverallRating to 60 for generated CPUs.
    // Synchronize only this authorized CPU, after both real profiles match.
    auto* Base = static_cast<unsigned char*>(Player);
    if (!Authorized(G)) return Reject(&G.Error, "display-sync-authorization");
    const auto Write = [&](void* Address, const void* Bytes, size_t Size)
    {
        SIZE_T N = 0;
        return WriteProcessMemory(GetCurrentProcess(), Address, Bytes, Size, &N) && N == Size;
    };
    const uint8_t Rating = static_cast<uint8_t>(G.Expected.Rating), Dirty = 1;
    if (!Write(Base + DisplayOffset, &Rating, sizeof(Rating)) ||
        !Write(Base + DisplayDirtyOffset, &Dirty, sizeof(Dirty))) return Reject(&G.Error, "display-sync-write");
    return (Authorized(G) || Reject(&G.Error, "display-sync-authorization-expired")) &&
        Verify(Player, G.Id, G.Expected, &G.Error);
}
inline void Append(std::vector<unsigned char>& Bytes, uint64_t Id, const Snapshot& S)
{
    const auto U32 = [&](uint32_t V) { for (unsigned I = 0; I < 4; ++I) Bytes.push_back(static_cast<unsigned char>(V >> (I * 8))); };
    for (unsigned I = 0; I < 8; ++I) Bytes.push_back(static_cast<unsigned char>(Id >> (I * 8)));
    U32(S.Rating); U32(S.Position); U32(S.Type); U32(S.Height); U32(S.Weight);
    for (uint32_t V : S.Shape) U32(V);
    for (uint32_t V : S.Attributes) U32(V);
    for (uint32_t V : S.Badges) U32(V);
    for (uint32_t V : S.ShotTendencies) U32(V);
}
} // namespace Profile

// Shared native roster primitives. Solo keeps unordered membership; multiplayer keeps exact court slots.
inline bool HasRoster(void* Player, uint64_t Id, bool Cpu)
{
    uint64_t Puid = 0; void* Container = nullptr; void* Roster = nullptr; uint32_t Flags = 0, Value = 0;
    return At(Player, 0xf0, Puid) && Puid == Id && At(Player, 0x2200, Flags) && (!Cpu || (Flags & 8)) &&
        At(Player, 0x446c0, Container) && At(Container, 0x28, Roster) && At(Roster, 0xf8, Value);
}
struct RosterExpectation
{
    uint32_t TeamSize = 0;
    std::array<uint64_t, MaxPlayers> Players{}; // Preserve the six-slot 2v2/3v3 order; 5v5 uses stride five.
    std::array<Profile::Snapshot, MaxPlayers> Profiles{};
    bool ExactSlots = false, RequireOnline = false;
};
inline bool ValidateRoster(void* Session, void* Info, const RosterExpectation& E, bool Prepared, LookupFn Lookup)
{
    if (!Lookup || !SupportedTeamSize(E.TeamSize)) return false;
    int Home = 0, Away = 0; uint32_t Online = 0;
    std::array<uint64_t, MaxPlayers> Ids{};
    const size_t SideBytes = E.TeamSize * sizeof(uint64_t);
    const bool Ok = At(Info, 0x118, Home) && At(Info, 0x11c, Away) &&
        Home == static_cast<int>(E.TeamSize) && Away == static_cast<int>(E.TeamSize) &&
        (!E.RequireOnline || (At(Info, 0x304, Online) && Online)) &&
        Read(static_cast<unsigned char*>(Info) + 0x48, Ids.data(), SideBytes) &&
        Read(static_cast<unsigned char*>(Info) + 0xb0, Ids.data() + SideStride(E.TeamSize), SideBytes);
    if (!E.ExactSlots)
        Log(LogLevel::Info, L"SOLO22 roster check home=" + std::to_wstring(Home) + L" away=" + std::to_wstring(Away));
    if (!Ok) return false;
    for (unsigned I = 0; I < MaxPlayers; ++I)
    {
        if (!(ActiveMask(E.TeamSize) & (1U << I))) continue;
        const uint64_t Expected = E.Players[I];
        if (E.ExactSlots) { if (Ids[I] != Expected) return false; }
        else
        {
            unsigned Matches = 0;
            for (unsigned J = 0; J < MaxPlayers; ++J)
                if (ActiveMask(E.TeamSize) & (1U << J)) Matches += Ids[J] == Expected;
            if (Matches != 1) return false;
        }
        uint32_t Source = 0; void* Player = Lookup(Session, Expected);
        const bool Cpu = IsCpu(Expected);
        if (!HasRoster(Player, Expected, Cpu) || (Cpu && !Profile::Verify(Player, Expected, E.Profiles[I])) ||
            (Prepared && (!At(Player, 0x21f0, Source) || Source != 1))) return false;
    }
    return true;
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
inline bool HashProfiles(const uint64_t* Players, const Profile::Snapshot* Profiles, unsigned Count,
    uint32_t Mask, unsigned char (&Digest)[32])
{
    std::vector<unsigned char> Bytes;
    for (unsigned I = 0; I < Count; ++I) if (Mask & (1U << I)) Profile::Append(Bytes, Players[I], Profiles[I]);
    if (Sha256(Bytes, Digest)) return true;
    memset(Digest, 0, sizeof(Digest)); return false;
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
// Both modes execute the same native generator and retain its LastError across verification/receipts.
inline void* GeneratePlayer(Profile::Generation& P, GenerateFn Original, void* Session,
    void* ActorManager, void* Object, DWORD EntryError, DWORD& NativeError)
{
    void* Player = nullptr;
    if (P.Valid)
    {
        Profile::Scope Scope(P);
        SetLastError(EntryError);
        Player = Original(Session, ActorManager, Object);
    }
    NativeError = GetLastError();
    return Player;
}
using CreateFn = void*(__fastcall*)(void*, void*);
inline CreateFn OriginalCreate = nullptr;
inline void* __fastcall CreatePlayer(void* Session, void* Descriptor)
{
    auto* G = Profile::Generating;
    if (!G || _ReturnAddress() != ExeBase + 0x166b5f2) return OriginalCreate(Session, Descriptor);
    const DWORD EntryError = GetLastError();
    uint64_t Id = 0, Seed = 0; void* Previous = nullptr;
    uint32_t Count = 0; unsigned char Digest[32]{}; unsigned char* Entries = nullptr;
    bool Ok = false;
    try
    {
        const auto Check = [&](bool Value, const std::string& Reason)
        { return Value || Profile::Reject(&G->Error, Reason); };
        const bool First = !G->Entered; G->Entered = true;
        Ok = Check(First && !G->Seen, "create-reentered") &&
            Check(Profile::Authorized(*G), "create-authorization") &&
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
        if (Ok) Ok = Profile::ApplyCandidates(*G, Entries + static_cast<size_t>(G->Template) * 0x560);
    }
    catch (...) { Profile::Reject(&G->Error, "create-exception"); Ok = false; }
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
    if (!Player) Profile::Reject(&G->Error, "create-returned-null");
    return Player;
}

namespace Solo
{
inline constexpr unsigned MaxCpu = 9, MaxCandidates = 4;
inline constexpr size_t RequestBytes = 144 + MaxCpu * MaxCandidates * sizeof(Profile::Parameters);
inline constexpr size_t EnvelopeBytes = 24 + RequestBytes;
inline std::string NetworkReceipt(uint64_t Instance);
inline bool NetworkReply(const void* Bytes, size_t Size, uint64_t Instance);
inline void RevokeNetwork();
}

// Multiplayer: exact court slots, online-session filtering and phase-bound authorization.
namespace Multiplayer
{
inline constexpr uint32_t Version = 6;
inline constexpr uint32_t ManifestMagic = 0x3232504d, ReportMagic = 0x3452504d;
struct Manifest
{
    uint32_t Magic, Protocol;
    uint64_t Epoch, Match;
    uint32_t LeaseMs, Phase;
    uint64_t LocalPuid;
    uint32_t TeamSize, HumanMask, PoolCount, Reserved;
    unsigned char Digest[32];
    uint64_t Players[MaxPlayers];
    uint32_t Seeds[MaxPlayers], Templates[MaxPlayers];
    Profile::Parameters Profiles[MaxPlayers];
};
#if defined(GRANITE_SOLO_CPU_TRACE)
using PlayingObserver = void(*)(void*, const Manifest&);
inline std::atomic<PlayingObserver> AfterPlaying = nullptr;
#endif
struct Report
{
    uint32_t Magic = ReportMagic, Protocol = Version, Module = ModuleVersion, Flags = 0;
    uint64_t Instance = 0, Epoch = 0, Match = 0;
    uint32_t PoolCount = 0, Created = 0, Error = 0, Reserved = 0;
    unsigned char Digest[32]{};
    unsigned char ProfileDigest[32]{};
};
struct ManifestLease
{
    uint32_t Magic, Protocol;
    uint64_t Epoch, Match;
    uint32_t LeaseMs, Phase;
};
struct ControlReply
{
    uint32_t Magic, Version, ParkBytes, SoloBytes;
};
static_assert(sizeof(ManifestLease) == 32 && sizeof(ControlReply) == 16);
static_assert(sizeof(Manifest) == 6968 && offsetof(Manifest, Digest) == 56 && offsetof(Manifest, Players) == 88);
static_assert(offsetof(Manifest, Seeds) == 168 && offsetof(Manifest, Templates) == 208 && offsetof(Manifest, Profiles) == 248);
static_assert(sizeof(Report) == 120 && offsetof(Report, Digest) == 56 && offsetof(Report, ProfileDigest) == 88);
inline std::atomic_bool Installed = false, OnlineHookReady = false;
inline std::mutex StateMutex;
struct StateData
{
    Manifest Request{};
    ULONGLONG Deadline = 0;
    uint32_t Created = 0, Error = 0;
    bool Active = false, Started = false;
    std::array<Profile::Snapshot, MaxPlayers> Profiles{};
    unsigned char ProfileDigest[32]{};
};
inline StateData State;
inline constexpr wchar_t ControlPath[] = L"/native-cpu/v7/poll";
inline uint32_t ActiveMask(const Manifest& M) { return ParkCpu::ActiveMask(M.TeamSize); }
inline uint32_t CpuSlots(const Manifest& M) { return ActiveMask(M) & ~M.HumanMask; }
inline bool SameRoster(const Manifest& A, const Manifest& B)
{
    // Lease and phase may advance without changing the authorized roster.
    return A.Magic == B.Magic && A.Protocol == B.Protocol && A.Epoch == B.Epoch && A.Match == B.Match &&
        !memcmp(&A.LocalPuid, &B.LocalPuid, sizeof(Manifest) - offsetof(Manifest, LocalPuid));
}
inline bool ValidManifest(const Manifest& M)
{
    if (M.Magic != ManifestMagic || M.Protocol != Version || !M.Epoch || !M.Match || !M.LocalPuid ||
        !M.LeaseMs || M.LeaseMs > MaxLeaseMs || M.Phase < 1 || M.Phase > 4 || M.Reserved ||
        !SupportedTeamSize(M.TeamSize) || !M.PoolCount || M.PoolCount > MaxTemplates ||
        (M.HumanMask & ~ActiveMask(M))) return false;
    unsigned Humans = 0, Local = 0;
    for (unsigned I = 0; I < MaxPlayers; ++I)
    {
        const bool Used = (ActiveMask(M) & (1U << I)) != 0;
        const bool Human = (M.HumanMask & (1U << I)) != 0;
        if (!Used)
        {
            if (M.Players[I] || M.Seeds[I] || M.Templates[I] != UINT32_MAX ||
                !(M.Profiles[I] == Profile::Parameters{})) return false;
            continue;
        }
        if (!M.Players[I] || IsCpu(M.Players[I]) == Human) return false;
        for (unsigned J = 0; J < I; ++J) if (M.Players[I] == M.Players[J]) return false;
        if (Human)
        {
            ++Humans; Local += M.Players[I] == M.LocalPuid;
            if (M.Seeds[I] || M.Templates[I] != UINT32_MAX ||
                !(M.Profiles[I] == Profile::Parameters{})) return false;
        }
        else if (!M.Seeds[I] || M.Templates[I] >= M.PoolCount || M.Templates[I] != M.Seeds[I] % M.PoolCount ||
            !Profile::ValidParameters(M.Profiles[I])) return false;
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
    State.Profiles = {}; memset(State.ProfileDigest, 0, sizeof(State.ProfileDigest));
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
inline bool Renew(const ManifestLease& L)
{
    std::lock_guard<std::mutex> Lock(StateMutex);
    if (L.Magic != ManifestMagic || L.Protocol != Version || !L.LeaseMs || L.LeaseMs > MaxLeaseMs ||
        L.Phase < 1 || L.Phase > 4 || !State.Active ||
        State.Request.Epoch != L.Epoch || State.Request.Match != L.Match || L.Phase < State.Request.Phase) return false;
    // Snapshot still verifies the live template pool on every poll.
    State.Request.LeaseMs = L.LeaseMs; State.Request.Phase = L.Phase;
    State.Deadline = GetTickCount64() + L.LeaseMs;
    return true;
}
inline bool Validate(void* Session, void* Info, const Manifest& M, bool Prepared, LookupFn Lookup)
{
    if (!Authorized(M) || !Lookup) return false;
    RosterExpectation E{}; E.TeamSize = M.TeamSize; E.ExactSlots = E.RequireOnline = true;
    std::copy(std::begin(M.Players), std::end(M.Players), E.Players.begin());
    {
        std::lock_guard<std::mutex> Lock(StateMutex);
        if ((State.Created & CpuSlots(M)) != CpuSlots(M)) return false;
        E.Profiles = State.Profiles;
    }
    return ValidateRoster(Session, Info, E, Prepared, Lookup) && Authorized(M);
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
    unsigned Slot = 0;
    bool Valid = false;
    Profile::Generation Profile{};
};
inline bool ForCpu(void* Session, uint64_t Id, Generation& G)
{
    std::lock_guard<std::mutex> Lock(StateMutex);
    for (unsigned I = 0; I < MaxPlayers; ++I) if (Id && State.Request.Players[I] == Id && IsCpu(Id))
    {
        G.Request = State.Request; G.Slot = I; G.Valid = LiveLocked(G.Request);
        auto& P = G.Profile;
        P.Session = Session; P.Id = Id; P.Seed = G.Request.Seeds[I]; P.Template = G.Request.Templates[I];
        P.PoolCount = G.Request.PoolCount; memcpy(P.PoolDigest, G.Request.Digest, sizeof(P.PoolDigest));
        P.Command = G.Request.Profiles[I];
        P.Authority = &G.Request; P.Authorized = &AuthorizeProfile; P.Valid = G.Valid;
        return true;
    }
    return false;
}
inline void Generated(Generation& G, void* Player)
{
    const bool Ok = G.Valid && Profile::Finish(G.Profile, Player);
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
        const bool Changed = !(State.Created & (1U << G.Slot)) || !(State.Profiles[G.Slot] == G.Profile.Expected);
        State.Profiles[G.Slot] = G.Profile.Expected;
        State.Created |= 1U << G.Slot;
        const uint32_t Mask = CpuSlots(G.Request);
        if (Changed && (State.Created & Mask) == Mask &&
            !HashProfiles(G.Request.Players, State.Profiles.data(), MaxPlayers, Mask, State.ProfileDigest) && !State.Error)
            State.Error = 9;
        Log(LogLevel::Info, L"PARK22 CPU " + std::to_wstring(G.Slot) + L" verified: OVR=" +
            std::to_wstring(G.Profile.Expected.Rating) + L" height-cm=" +
            std::to_wstring(G.Profile.Expected.Height / 100));
    }
    else if (!State.Error) State.Error = 9;
}
// Only the PREBUILT network view is filtered; court/gameplay rosters are never edited.
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
    for (unsigned I = 0; I < MaxPlayers; ++I) if (M.HumanMask & (1U << I)) ++Humans;
    const auto Count = Value<uint32_t>(Input, CountOffset);
    if (!Check(Value<uint32_t>(Input, 0) == GameTag && Value<uint32_t>(Input, PrebuiltOffset) != 0, "online-session-kind") ||
        !Check(Value<uint64_t>(Input, MatchOffset) == M.Match, "online-match") ||
        !Check(Count == M.TeamSize * 2 || Count == Humans, "online-user-count")) return false;
    // Accept the original full view or an already-filtered retry, never a partial roster.
    const uint32_t Expected = Count == M.TeamSize * 2 ? ActiveMask(M) : M.HumanMask;
    std::array<unsigned, MaxPlayers> Source{};
    uint32_t Seen = 0;
    for (unsigned I = 0; I < Count; ++I)
    {
        const auto Id = Value<uint64_t>(Input, UsersOffset + I * 8);
        unsigned Slot = 0;
        while (Slot < MaxPlayers && (!(Expected & (1U << Slot)) || M.Players[Slot] != Id)) ++Slot;
        if (!Check(Slot < MaxPlayers, "online-unexpected-user") ||
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
    std::array<uint64_t, MaxPlayers> Machines{};
    for (unsigned I = 0; I < MaxPlayers; ++I) if (M.HumanMask & (1U << I))
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
} // namespace Online
inline Report Snapshot(uint64_t Instance)
{
    Report R; R.Instance = Instance;
    unsigned char* Entries = nullptr;
    const bool Ready = Installed && OnlineHookReady && Profile::Ready && Pool(R.PoolCount, R.Digest, Entries);
    if (!Ready) { R.PoolCount = 0; memset(R.Digest, 0, sizeof(R.Digest)); }
    std::lock_guard<std::mutex> Lock(StateMutex);
    R.Epoch = State.Request.Epoch; R.Match = State.Request.Match;
    R.Created = State.Created; R.Error = State.Error;
    if (Ready) R.Flags |= 1;
    if (State.Active && !Ready && !R.Error) State.Error = R.Error = 8;
    if (State.Active && Ready && (R.PoolCount != State.Request.PoolCount ||
        memcmp(R.Digest, State.Request.Digest, sizeof(R.Digest))) && !R.Error) State.Error = R.Error = 2;
    memcpy(R.ProfileDigest, State.ProfileDigest, sizeof(R.ProfileDigest));
    if (LiveLocked(State.Request)) R.Flags |= 2;
    if (State.Started) R.Flags |= 4;
    return R;
}
// One authenticated poll carries both CPU reports and mode-specific lease replies.
using GameSessionDiscovery::InternetHandle;
inline bool Poll(HINTERNET Connection, const Report& R, const GameSessionDiscovery::SessionData& C)
{
    const auto SoloText = Solo::NetworkReceipt(R.Instance);
    std::vector<unsigned char> Body(sizeof(R) + SoloText.size());
    memcpy(Body.data(), &R, sizeof(R)); memcpy(Body.data() + sizeof(R), SoloText.data(), SoloText.size());
    const DWORD BodyBytes = static_cast<DWORD>(Body.size());
    InternetHandle Request(WinHttpOpenRequest(Connection, L"POST", ControlPath,
        nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE));
    if (!Request.Value) return false;
    DWORD Policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
    // Use the existing Granite self-signed TLS policy, not a second CA setup.
    DWORD Security = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_CN_INVALID |
        SECURITY_FLAG_IGNORE_CERT_DATE_INVALID | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
    if (!WinHttpSetOption(Request.Value, WINHTTP_OPTION_REDIRECT_POLICY, &Policy, sizeof(Policy)) ||
        !WinHttpSetOption(Request.Value, WINHTTP_OPTION_SECURITY_FLAGS, &Security, sizeof(Security))) return false;
    const std::wstring Headers = L"Content-Type: application/octet-stream\r\nCache-Control: no-store\r\nX-Granite-Session: " + C.Session + L"\r\n";
    if (!WinHttpSendRequest(Request.Value, Headers.c_str(), static_cast<DWORD>(Headers.size()),
        Body.data(), BodyBytes, BodyBytes, 0) || !WinHttpReceiveResponse(Request.Value, nullptr)) return false;
    DWORD Status = 0, Size = sizeof(Status);
    if (!WinHttpQueryHeaders(Request.Value, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &Status, &Size, WINHTTP_NO_HEADER_INDEX)) return false;
    if (Status == 204 || Status == 401 || Status == 409)
    {
        std::lock_guard<std::mutex> Lock(GameSessionDiscovery::Mutex);
        if (GameSessionDiscovery::Current(C)) { Revoke(); Solo::RevokeNetwork(); }
        return Status == 204;
    }
    if (Status != 200) return false;
    DWORD ContentBytes = 0; Size = sizeof(ContentBytes);
    if (!WinHttpQueryHeaders(Request.Value, WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX, &ContentBytes, &Size, WINHTTP_NO_HEADER_INDEX) || ContentBytes < sizeof(ControlReply) ||
        ContentBytes > sizeof(ControlReply) + sizeof(Manifest) + Solo::EnvelopeBytes) return false;
    std::vector<unsigned char> Bytes(static_cast<size_t>(ContentBytes) + 1);
    DWORD Total = 0, Got = 0;
    do
    {
        if (Total == Bytes.size() || !WinHttpReadData(Request.Value, Bytes.data() + Total,
            static_cast<DWORD>(Bytes.size() - Total), &Got)) return false;
        Total += Got;
    } while (Got);
    std::lock_guard<std::mutex> Lock(GameSessionDiscovery::Mutex);
    if (!GameSessionDiscovery::Current(C)) return true;
    ControlReply Reply{};
    if (Total != ContentBytes) { Revoke(); Solo::RevokeNetwork(); return false; }
    memcpy(&Reply, Bytes.data(), sizeof(Reply));
    if (Reply.Magic != 0x3743504e || Reply.Version != 7 ||
        (Reply.ParkBytes && Reply.ParkBytes != sizeof(ManifestLease) && Reply.ParkBytes != sizeof(Manifest)) ||
        (Reply.SoloBytes && Reply.SoloBytes != 32 && Reply.SoloBytes != Solo::EnvelopeBytes) ||
        sizeof(Reply) + static_cast<size_t>(Reply.ParkBytes) + Reply.SoloBytes != Total)
    { Revoke(); Solo::RevokeNetwork(); return false; }
    const auto* Park = Bytes.data() + sizeof(Reply);
    bool ParkOk = true;
    if (!Reply.ParkBytes) Revoke();
    else if (Reply.ParkBytes == sizeof(ManifestLease))
    {
        ManifestLease L{}; memcpy(&L, Park, sizeof(L)); ParkOk = Renew(L);
        if (!ParkOk) Revoke();
    }
    else { Manifest M{}; memcpy(&M, Park, sizeof(M)); Accept(M); }
    bool SoloOk = true;
    if (Reply.SoloBytes) SoloOk = Solo::NetworkReply(Park + Reply.ParkBytes, Reply.SoloBytes, R.Instance);
    else Solo::RevokeNetwork();
    return ParkOk && SoloOk;
}
inline DWORD WINAPI Worker(void*)
{
    uint64_t Instance = 0;
    if (BCryptGenRandom(nullptr, reinterpret_cast<PUCHAR>(&Instance), sizeof(Instance), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0 || !Instance)
    { Installed = false; Log(LogLevel::Error, L"PARK22 disabled: control instance nonce unavailable"); return 1; }
    InternetHandle Session(WinHttpOpen(L"Granite-NativePark/7", WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!Session.Value || !WinHttpSetTimeouts(Session.Value, 2000, 2000, 2000, 2000))
    { Installed = false; return 1; }
    ULONGLONG FailedSince = 0;
    bool ReportedFailure = false;
    for (;;)
    {
        const auto C = GameSessionDiscovery::Snapshot();
        if (C.Session.empty() || !C.Port) { FailedSince = 0; ReportedFailure = false; Sleep(500); continue; }
        bool Ok = false;
        try
        {
            // Same host as the game's existing Granite redirect; no user-supplied URL.
            InternetHandle Connection(WinHttpConnect(Session.Value, RedirectHost, C.Port, 0));
            if (Connection.Value)
            {
                const auto R = Snapshot(Instance);
                Ok = Poll(Connection.Value, R, C);
            }
        }
        catch (...) { Ok = false; }
        if (!Ok)
        {
            const auto Now = GetTickCount64();
            if (!FailedSince)
            {
                FailedSince = Now;
                Log(LogLevel::Info, L"PARK22 control poll retrying; existing authorization remains bounded by its lease");
            }
            else if (!ReportedFailure && Now - FailedSince >= MaxLeaseMs)
            {
                Log(LogLevel::Error, L"PARK22 control unavailable for at least 8 seconds; valid authorization is required before starting a game");
                ReportedFailure = true;
            }
        }
        else
        {
            if (FailedSince) Log(LogLevel::Info, L"PARK22 control connection recovered");
            FailedSince = 0; ReportedFailure = false;
        }
        Sleep(Ok ? 500 : 1500);
    }
}
} // namespace Multiplayer

// Solo: one-human request lease and JSON receipts, with room for nine generated CPUs.
namespace Solo
{
struct Request
{
    uint32_t Magic, Version;
    uint64_t Match, Owner;
    uint32_t TeamSize, CpuCount;
    uint64_t Cpu[MaxCpu];
    uint32_t Seeds[MaxCpu];
    uint32_t CandidateCount;
    Profile::Parameters Candidates[MaxCpu][MaxCandidates];
};
static_assert(sizeof(Request) == RequestBytes && offsetof(Request, TeamSize) == 24 && offsetof(Request, Cpu) == 32 &&
    offsetof(Request, Seeds) == 104 && offsetof(Request, CandidateCount) == 140 && offsetof(Request, Candidates) == 144);
inline Request Current{};
inline bool Created[MaxCpu]{};
inline std::array<int, MaxCpu> SelectedCandidates{};
inline std::array<Profile::Snapshot, MaxCpu> Profiles{};
inline unsigned char ProfileDigest[32]{};
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
static_assert(sizeof(NetworkEnvelope) == EnvelopeBytes && offsetof(NetworkEnvelope, Data) == 24);
inline bool ValidRequest(const Request& R)
{
    if (R.Magic != 0x32325053 || R.Version != 6 || R.CandidateCount != MaxCandidates || !R.Match || !R.Owner ||
        IsCpu(R.Owner) || !SupportedTeamSize(R.TeamSize) || R.CpuCount != R.TeamSize * 2 - 1) return false;
    for (unsigned I = 0; I < MaxCpu; ++I)
    {
        if (I >= R.CpuCount)
        {
            if (R.Cpu[I] || R.Seeds[I]) return false;
            for (const auto& P : R.Candidates[I]) if (!(P == Profile::Parameters{})) return false;
            continue;
        }
        if (!IsCpu(R.Cpu[I]) || R.Cpu[I] == R.Owner || !R.Seeds[I]) return false;
        const auto& First = R.Candidates[I][0];
        for (const auto& P : R.Candidates[I])
            if (!Profile::ValidParameters(P) || P.Position != First.Position || P.Height != First.Height ||
                P.Weight != First.Weight || P.Shape != First.Shape) return false;
        if (R.Candidates[I][1].Rating != First.Rating) return false;
        for (unsigned J = 0; J < I; ++J) if (R.Cpu[J] == R.Cpu[I]) return false;
    }
    return true;
}
inline bool LoadRequest(Request& R)
{
    std::lock_guard<std::mutex> Lock(ReceiptMutex);
    if (!NetworkManaged || GetTickCount64() >= NetworkDeadline) return false;
    R = NetworkRequest;
    return true; // NetworkReply validates the immutable request at the boundary.
}
inline void Select(const Request& R)
{
    if (memcmp(&Current, &R, sizeof(R)))
    {
        Current = R; memset(Created, 0, sizeof(Created)); SelectedCandidates.fill(-1);
        Profiles = {}; memset(ProfileDigest, 0, sizeof(ProfileDigest)); GenerationError.clear(); ReceiptStarted = false;
    }
}
inline void RefreshProfileDigest()
{
    memset(ProfileDigest, 0, sizeof(ProfileDigest));
    if (!Current.CpuCount) return;
    for (unsigned I = 0; I < Current.CpuCount; ++I) if (!Created[I]) return;
    if (!HashProfiles(Current.Cpu, Profiles.data(), Current.CpuCount, (1U << Current.CpuCount) - 1, ProfileDigest) &&
        GenerationError.empty()) GenerationError = "profile-digest-failed";
}
inline std::string BuildReceipt(const char* Error = nullptr, bool Started = false, uint64_t Instance = 0)
{
    if (Error && GenerationError.empty()) GenerationError = Error;
    ReceiptStarted |= Started;
    std::ostringstream Text;
    Text << "{\"version\":6,\"module\":\"00010226\",\"installed\":" <<
        (Profile::Ready ? "true" : "false") << ",\"pid\":" << GetCurrentProcessId()
         << ",\"match\":\"" << std::hex << Current.Match << "\",\"teamSize\":" << std::dec << Current.TeamSize
         << ",\"cpuCount\":" << Current.CpuCount << ",\"created\":[";
    bool First = true;
    for (unsigned I = 0; I < Current.CpuCount; ++I) if (Created[I])
    {
        if (!First) Text << ',';
        Text << '\"' << std::hex << Current.Cpu[I] << '\"'; First = false;
    }
    constexpr char Hex[] = "0123456789abcdef";
    Text << "],\"candidates\":[" << std::dec;
    for (unsigned I = 0; I < Current.CpuCount; ++I)
    {
        if (I) Text << ',';
        Text << SelectedCandidates[I];
    }
    Text << "],\"profileDigest\":\"";
    for (unsigned char Byte : ProfileDigest) Text << Hex[Byte >> 4] << Hex[Byte & 15];
    Text << "\",\"started\":" << (ReceiptStarted ? "true" : "false") << ",\"error\":";
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
    NetworkDeadline = 0; // Hooks refuse the request after this point.
}
inline bool NetworkReply(const void* Bytes, size_t Size, uint64_t Instance)
{
    if (Size == 32)
    {
        struct Lease { uint64_t Instance, Epoch; uint32_t LeaseMs, Reserved; uint64_t Match; };
        static_assert(sizeof(Lease) == 32);
        Lease L{}; memcpy(&L, Bytes, sizeof(L));
        std::lock_guard<std::mutex> Lock(ReceiptMutex);
        if (L.Instance != Instance || !L.Epoch || L.Reserved || !L.LeaseMs || L.LeaseMs > MaxLeaseMs ||
            !NetworkManaged || !NetworkDeadline || NetworkEpoch != L.Epoch || NetworkRequest.Match != L.Match)
        { NetworkDeadline = 0; return false; }
        NetworkDeadline = GetTickCount64() + L.LeaseMs;
        return true;
    }
    NetworkEnvelope E{};
    if (Size != sizeof(E)) { RevokeNetwork(); return false; }
    memcpy(&E, Bytes, sizeof(E));
    if (E.Instance != Instance || !E.Epoch || E.Reserved || !E.LeaseMs || E.LeaseMs > MaxLeaseMs || !ValidRequest(E.Data))
    { RevokeNetwork(); return false; }
    std::lock_guard<std::mutex> Lock(ReceiptMutex);
    if (NetworkManaged && NetworkEpoch == E.Epoch && NetworkRequest.Match == E.Data.Match &&
        memcmp(&NetworkRequest, &E.Data, sizeof(E.Data))) { NetworkDeadline = 0; return false; }
    NetworkManaged = true; NetworkRequest = E.Data; NetworkEpoch = E.Epoch;
    NetworkDeadline = GetTickCount64() + E.LeaseMs;
    Select(E.Data);
    return true;
}
inline bool Validate(void* Session, void* Info, const Request& R, bool Prepared, LookupFn Lookup)
{
    if (!SupportedTeamSize(R.TeamSize) || R.CpuCount != R.TeamSize * 2 - 1) return false;
    RosterExpectation E{}; E.TeamSize = R.TeamSize;
    {
        std::lock_guard<std::mutex> Lock(ReceiptMutex);
        if (memcmp(&Current, &R, sizeof(R)) || !GenerationError.empty()) return false;
        for (unsigned I = 0; I < R.CpuCount; ++I) if (!Created[I]) return false;
        for (unsigned I = 0; I <= R.CpuCount; ++I)
        {
            const unsigned Slot = I < R.TeamSize ? I : I + SideStride(R.TeamSize) - R.TeamSize;
            E.Players[Slot] = I ? R.Cpu[I - 1] : R.Owner;
            if (I) E.Profiles[Slot] = Profiles[I - 1];
        }
    }
    return ValidateRoster(Session, Info, E, Prepared, Lookup);
}
inline bool AuthorizeProfile(const void* RequestData)
{
    std::lock_guard<std::mutex> Lock(ReceiptMutex);
    return NetworkManaged && GetTickCount64() < NetworkDeadline && !memcmp(&NetworkRequest, RequestData, sizeof(NetworkRequest));
}
} // namespace Solo

// Shared hooks: generated player construction, guarded start, roster order and AI defense.
struct RosterOrderScope
{
    uint32_t* SortFlag;
    uint32_t Previous;
    RosterOrderScope(uint32_t* Flag, uint32_t Value) noexcept : SortFlag(Flag), Previous(Value) { *SortFlag = 0; }
    ~RosterOrderScope() { *SortFlag = Previous; }
    RosterOrderScope(const RosterOrderScope&) = delete;
    RosterOrderScope& operator=(const RosterOrderScope&) = delete;
};
// FUN_1416B4A30 writes MatchId at uint32_t[0xb6], RandomSeed at [0xd0].
inline constexpr size_t MatchOffset = 0xb6 * sizeof(uint32_t);
static_assert(MatchOffset == 0x2d8);
inline constexpr size_t RosterSortOffset = 0x2bc;
static_assert(0xcb0 + RosterSortOffset == 0xf6c);
inline GenerateFn OriginalGenerate = nullptr;
inline LookupFn Lookup = nullptr;
// FUN_141de3450 resolves per-matchup AI settings, including template fallbacks.
// Override only its final output in an authenticated generated-CPU park match.
using DefenseFn = void(__fastcall*)(void*, int, void*);
inline DefenseFn OriginalDefense = nullptr;
struct DefenseContext
{
    void* Session = nullptr;
    uint64_t Match = 0, Epoch = 0;
    uint32_t TeamSize = 0;
    bool Mixed = false;
    std::array<uint64_t, MaxPlayers> Players{};
};
inline std::mutex DefenseMutex;
inline DefenseContext Defense;
inline void ClearDefense()
{
    std::lock_guard<std::mutex> Lock(DefenseMutex); Defense = {};
}
inline bool DefenseRoster(const DefenseContext& C)
{
    if (!C.Session || !C.Match || !C.Epoch || !SupportedTeamSize(C.TeamSize)) return false;
    auto* Info = static_cast<unsigned char*>(C.Session) + 0xcb0;
    uint64_t Match = 0; int Home = 0, Away = 0;
    std::array<uint64_t, MaxPlayers> Players{};
    const size_t SideBytes = C.TeamSize * sizeof(uint64_t);
    return At(Info, MatchOffset, Match) && Match == C.Match &&
        At(Info, 0x118, Home) && At(Info, 0x11c, Away) &&
        Home == static_cast<int>(C.TeamSize) && Away == static_cast<int>(C.TeamSize) &&
        Read(Info + 0x48, Players.data(), SideBytes) &&
        Read(Info + 0xb0, Players.data() + SideStride(C.TeamSize), SideBytes) && Players == C.Players;
}
// Caller holds the matching multiplayer or solo authorization mutex.
inline bool DefenseAuthorizedLocked(const DefenseContext& C)
{
    if (!DefenseRoster(C)) return false;
    if (C.Mixed)
    {
        const auto& M = Multiplayer::State.Request;
        return M.Match == C.Match && M.Epoch == C.Epoch && M.TeamSize == C.TeamSize &&
            std::equal(C.Players.begin(), C.Players.end(), M.Players) && Multiplayer::LiveLocked(M);
    }
    return Solo::NetworkManaged && GetTickCount64() < Solo::NetworkDeadline && Solo::NetworkEpoch == C.Epoch &&
        Solo::NetworkRequest.Match == C.Match && Solo::Current.Match == C.Match &&
        Solo::NetworkRequest.TeamSize == C.TeamSize && Solo::GenerationError.empty();
}
inline bool DefenseAuthorized(const DefenseContext& C)
{
    std::lock_guard<std::mutex> Lock(C.Mixed ? Multiplayer::StateMutex : Solo::ReceiptMutex);
    return DefenseAuthorizedLocked(C);
}
inline bool ArmDefense(void* Session, uint64_t Match, uint32_t TeamSize, bool Mixed)
{
    DefenseContext C{}; C.Session = Session; C.Match = Match; C.TeamSize = TeamSize; C.Mixed = Mixed;
    if (!Session || !SupportedTeamSize(TeamSize)) return false;
    if (Mixed)
    {
        Multiplayer::Manifest M{};
        if (!Multiplayer::ForMatch(Match, M)) return false;
        C.Epoch = M.Epoch;
    }
    else
    {
        std::lock_guard<std::mutex> Lock(Solo::ReceiptMutex); C.Epoch = Solo::NetworkEpoch;
    }
    auto* Info = static_cast<unsigned char*>(Session) + 0xcb0;
    const size_t SideBytes = TeamSize * sizeof(uint64_t);
    if (!Read(Info + 0x48, C.Players.data(), SideBytes) ||
        !Read(Info + 0xb0, C.Players.data() + SideStride(TeamSize), SideBytes) ||
        std::none_of(C.Players.begin(), C.Players.end(), IsCpu) || !DefenseAuthorized(C)) return false;
    std::lock_guard<std::mutex> Lock(DefenseMutex); Defense = C; return true;
}
inline void __fastcall BuildDefense(void* Strategy, int Index, void* Template)
{
    const bool FromMatch = ExeBase && _ReturnAddress() == ExeBase + 0x1ddd28d;
    OriginalDefense(Strategy, Index, Template);
    const DWORD NativeError = GetLastError();
    if (FromMatch && Strategy && Index >= 0 && Index < 6)
    {
        std::lock_guard<std::mutex> Lock(DefenseMutex);
        if (Defense.Session)
        {
            // Serialize validation and writes with lease/epoch updates and revoke.
            std::lock_guard<std::mutex> AuthorityLock(Defense.Mixed ? Multiplayer::StateMutex : Solo::ReceiptMutex);
            if (DefenseAuthorizedLocked(Defense))
            {
                // Native marks a non-default setting with 0x20. Leave the
                // other 10 value/source pairs and all cached/menu settings alone.
                struct Setting { size_t FlagOffset; uint32_t Value; };
                constexpr Setting Settings[] = {{0x634, 1}, {0x63c, 1}, {0x664, 2}, {0x66c, 2}};
                auto* Row = static_cast<unsigned char*>(Strategy) + static_cast<size_t>(Index) * 0x70;
                std::array<std::array<uint32_t, 2>, 4> Previous{};
                bool Ok = true; size_t Touched = 0;
                for (size_t I = 0; I < Previous.size(); ++I)
                    if (!Read(Row + Settings[I].FlagOffset, Previous[I].data(), sizeof(Previous[I])))
                    { Ok = false; break; }
                for (size_t I = 0; Ok && I < Previous.size(); ++I)
                {
                    const std::array<uint32_t, 2> Pair = {0x20, Settings[I].Value};
                    std::array<uint32_t, 2> Actual{}; SIZE_T Written = 0;
                    Touched = I + 1;
                    Ok = WriteProcessMemory(GetCurrentProcess(), Row + Settings[I].FlagOffset,
                        Pair.data(), sizeof(Pair), &Written) && Written == sizeof(Pair) &&
                        Read(Row + Settings[I].FlagOffset, Actual.data(), sizeof(Actual)) && Actual == Pair;
                }
                if (!Ok)
                {
                    bool Restored = true;
                    for (size_t I = 0; I < Touched; ++I)
                    {
                        std::array<uint32_t, 2> Actual{}; SIZE_T Written = 0;
                        const bool RestoredPair = WriteProcessMemory(GetCurrentProcess(), Row + Settings[I].FlagOffset,
                            Previous[I].data(), sizeof(Previous[I]), &Written) && Written == sizeof(Previous[I]) &&
                            Read(Row + Settings[I].FlagOffset, Actual.data(), sizeof(Actual)) && Actual == Previous[I];
                        Restored = RestoredPair && Restored;
                    }
                    if (Defense.Mixed) Multiplayer::State.Error = 12;
                    else Solo::Receipt(Restored ? "native-defense-strategy-write-failed" : "native-defense-strategy-rollback-failed");
                    Defense = {};
                    Log(LogLevel::Error, Restored ?
                        L"PARK22 defense write/readback failed; native settings restored and failure reported" :
                        L"PARK22 defense rollback verification failed; override disabled and failure reported");
                }
            }
        }
    }
    SetLastError(NativeError);
}
inline void* __fastcall Generate(void* Session, void* ActorManager, void* Object)
{
    const DWORD EntryError = GetLastError();
    Multiplayer::Generation G{}; uint64_t GeneratedId = 0;
    if (At(Object, 0xa0, GeneratedId) && Multiplayer::ForCpu(Session, GeneratedId, G))
    {
        if (!G.Valid) { Multiplayer::Fail(G.Request, 4); SetLastError(EntryError); return nullptr; }
        DWORD Error = EntryError;
        void* Player = GeneratePlayer(G.Profile, OriginalGenerate, Session, ActorManager, Object, EntryError, Error);
        Multiplayer::Generated(G, Player);
        SetLastError(Error); return Player;
    }
    Solo::Request R{};
    if (GeneratedId && Solo::LoadRequest(R)) for (unsigned I = 0; I < R.CpuCount; ++I) if (GeneratedId == R.Cpu[I])
    {
        Profile::Generation P{};
        P.Session = Session; P.Id = GeneratedId; P.Seed = R.Seeds[I];
        P.Authority = &R; P.Authorized = &Solo::AuthorizeProfile;
        P.Command = R.Candidates[I][0]; P.Candidates = R.Candidates[I]; P.CandidateCount = R.CandidateCount;
        unsigned char* Entries = nullptr;
        P.Valid = Profile::Ready && Pool(P.PoolCount, P.PoolDigest, Entries);
        if (P.Valid) P.Template = P.Seed % P.PoolCount;
        else P.Error = Profile::Ready ? "generation-pool" : "enhancement-not-ready";
        DWORD NativeError = EntryError;
        void* Player = GeneratePlayer(P, OriginalGenerate, Session, ActorManager, Object, EntryError, NativeError);
        try
        {
            const bool Ok = Profile::Finish(P, Player);
            if (Solo::AuthorizeProfile(&R))
            {
                std::lock_guard<std::mutex> Lock(Solo::ReceiptMutex);
                Solo::Select(R);
                const bool Changed = Solo::Created[I] != Ok || (Ok && !(Solo::Profiles[I] == P.Expected));
                Solo::Created[I] = Ok;
                Solo::SelectedCandidates[I] = Ok ? static_cast<int>(P.Candidate) : -1;
                if (Ok) Solo::Profiles[I] = P.Expected;
                if (Changed) Solo::RefreshProfileDigest();
                const std::string Error = Ok ? std::string{} : "native-cpu-enhancement-" + P.Error;
                Solo::Receipt(Ok ? nullptr : Error.c_str());
                Log(Ok ? LogLevel::Info : LogLevel::Error, L"SOLO22 CPU " + std::to_wstring(I) + (Ok ?
                    L" verified: candidate=" + std::to_wstring(P.Candidate + 1) + L"/" + std::to_wstring(P.CandidateCount) +
                    L" template=" + std::to_wstring(P.Template) + L" seed=" + std::to_wstring(P.Seed) +
                    L" OVR=" + std::to_wstring(P.Expected.Rating) + L" height-cm=" + std::to_wstring(P.Expected.Height / 100) :
                    L" refused: " + std::wstring(P.Error.begin(), P.Error.end())));
            }
        }
        catch (...) { Log(LogLevel::Error, L"SOLO22 enhanced CPU receipt failed"); }
        SetLastError(NativeError); return Player;
    }
    SetLastError(EntryError);
    return OriginalGenerate(Session, ActorManager, Object);
}
// StartGame receives native game-info before session/AI init. Other games retain their native calls.
inline void __fastcall Start(void* Session, void* Info)
{
    const DWORD NativeError = GetLastError();
    ClearDefense();
    Solo::Request R{}; uint64_t Match = 0, Slots[10]{};
    const bool HasMatch = At(Info, MatchOffset, Match);
    Multiplayer::Manifest Mixed{};
    if (HasMatch && Multiplayer::ForMatch(Match, Mixed))
    {
        bool Ok = false;
        try { Ok = Multiplayer::Validate(Session, Info, Mixed, false, Lookup); } catch (...) { Ok = false; }
        if (!Ok)
        {
            Multiplayer::Fail(Mixed, 5);
            Log(LogLevel::Error, L"PARK22 refused StartGame: authorization, online setup or exact roster validation failed");
            SetLastError(NativeError); return;
        }
        Log(LogLevel::Info, L"PARK22 validated native mixed roster before StartGame");
    }
    else
    {
        bool Generated = false;
        if (Info && Read(static_cast<unsigned char*>(Info) + 0x48, Slots, 40) &&
            Read(static_cast<unsigned char*>(Info) + 0xb0, Slots + 5, 40))
            for (auto Id : Slots) Generated |= IsCpu(Id);
        bool PreviousMatch = false;
        { std::lock_guard<std::mutex> Lock(Solo::ReceiptMutex); PreviousMatch = HasMatch && Solo::Current.Match && Match == Solo::Current.Match; }
        const bool Loaded = Solo::LoadRequest(R);
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
                { std::lock_guard<std::mutex> Lock(Solo::ReceiptMutex);
                  Solo::Receipt(Loaded ? "native-start-match-mismatch" : "native-start-request-unavailable"); }
                SetLastError(NativeError); return;
            }
        }
        else
        {
            bool Ok = false;
            try
            {
                Ok = Solo::Validate(Session, Info, R, false, Lookup);
                std::lock_guard<std::mutex> Lock(Solo::ReceiptMutex);
                Solo::Select(R); Solo::Receipt(Ok ? nullptr : "native-start-roster-validation-failed");
            }
            catch (...) { Ok = false; }
            if (!Ok)
            {
                Log(LogLevel::Error, L"SOLO22 refused StartGame: expected complete authorized native rosters");
                SetLastError(NativeError); return;
            }
            Log(LogLevel::Info, L"SOLO22 StartGame validated: one human and " + std::to_wstring(R.CpuCount) + L" native CPU rosters");
        }
    }
    SetLastError(NativeError); MatchLifecycleHooks::CallStart(Session, Info);
}
inline uint64_t __fastcall Playing(void* Session)
{
    const DWORD NativeError = GetLastError();
    ClearDefense();
    uint64_t Match = 0; Solo::Request R{};
    uint32_t SortRoster = 0, TeamSize = 0;
    void* Info = Session ? static_cast<unsigned char*>(Session) + 0xcb0 : nullptr;
    Multiplayer::Manifest Mixed{};
    const bool IsMixed = At(Info, MatchOffset, Match) && Multiplayer::ForMatch(Match, Mixed);
    if (IsMixed)
    {
        bool Ok = false;
        try { Ok = Multiplayer::Validate(Session, Info, Mixed, true, Lookup) && At(Info, RosterSortOffset, SortRoster) &&
            ArmDefense(Session, Match, Mixed.TeamSize, true); }
        catch (...) { Ok = false; }
        if (!Ok)
        {
            Multiplayer::Fail(Mixed, 6);
            Log(LogLevel::Error, L"PARK22 refused InitPlayingGame: prepared mixed roster or authorization invalid");
            SetLastError(NativeError); return 0;
        }
        TeamSize = Mixed.TeamSize;
    }
    else
    {
        bool Ours = false;
        if (At(Info, MatchOffset, Match))
        {
            std::lock_guard<std::mutex> Lock(Solo::ReceiptMutex);
            Ours = Solo::Current.Match && Match == Solo::Current.Match;
        }
        if (!Ours)
        {
            uint64_t Ids[10]{}; int Home = 0, Away = 0;
            if (At(Info, 0x118, Home) && At(Info, 0x11c, Away) && Home > 0 && Home <= 5 && Away > 0 && Away <= 5 &&
                Read(static_cast<unsigned char*>(Info) + 0x48, Ids, static_cast<size_t>(Home) * sizeof(uint64_t)) &&
                Read(static_cast<unsigned char*>(Info) + 0xb0, Ids + 5, static_cast<size_t>(Away) * sizeof(uint64_t)))
                for (const auto Id : Ids) if (IsCpu(Id))
                {
                    Log(LogLevel::Error, L"PARK22 refused delayed generated roster without its match authorization");
                    SetLastError(NativeError); return 0;
                }
            SetLastError(NativeError); return MatchLifecycleHooks::CallNative(Session);
        }
        bool Ok = false;
        try
        {
            Ok = Solo::LoadRequest(R) && R.Match == Match && Solo::Validate(Session, Info, R, true, Lookup) &&
                At(Info, RosterSortOffset, SortRoster) && ArmDefense(Session, Match, R.TeamSize, false);
            std::lock_guard<std::mutex> Lock(Solo::ReceiptMutex);
            if (!Ok) Solo::Receipt("native-playing-roster-validation-failed");
        }
        catch (...) { Ok = false; }
        if (!Ok)
        {
            Log(LogLevel::Error, L"SOLO22 refused InitPlayingGame: prepared native roster is incomplete");
            SetLastError(NativeError); return 0;
        }
        TeamSize = R.TeamSize;
        Log(LogLevel::Info, L"SOLO22 InitPlayingGame validated: " + std::to_wstring(R.TeamSize * 2) + L" prepared native player rosters");
        Log(LogLevel::Info, L"SOLO22 AI initialization counts: native=" +
            std::to_wstring(MatchLifecycleHooks::OriginalHomeCount()) + L"/" + std::to_wstring(MatchLifecycleHooks::OriginalAwayCount()) +
            L" roster=" + std::to_wstring(R.TeamSize) + L"/" + std::to_wstring(R.TeamSize));
    }
    uint64_t Result = 0;
    SetLastError(NativeError);
    {
        // Restrict roster-derived AI counts to this validated initialization thread.
        MatchLifecycleHooks::InitScope Scope(TeamSize);
        // Keep model slots in the same court order as park nameplates.
        RosterOrderScope Order(reinterpret_cast<uint32_t*>(static_cast<unsigned char*>(Info) + RosterSortOffset), SortRoster);
        Result = MatchLifecycleHooks::CallNative(Session);
    }
    const DWORD Error = GetLastError();
    if (!Result) ClearDefense();
    if (IsMixed) Multiplayer::Started(Mixed, Result != 0);
    else
    {
        std::lock_guard<std::mutex> Lock(Solo::ReceiptMutex);
        Solo::Receipt(Result ? nullptr : "native-playing-init-failed", Result != 0);
    }
#if defined(GRANITE_SOLO_CPU_TRACE)
    if (Result && IsMixed)
        if (const auto Observe = Multiplayer::AfterPlaying.load()) Observe(Session, Mixed);
#endif
    Log(LogLevel::Info, std::wstring(IsMixed ? L"PARK22" : L"SOLO22") + L" InitPlayingGame returned " + std::to_wstring(Result));
    SetLastError(Error); return Result;
}

// Single installation entry for all CPU park modes.
inline constexpr unsigned HookCount = 2;
struct Site { size_t Rva; const char* Bytes; size_t Size; void* Detour; void** Original; };
inline const Site Sites[] = {
    {0x166b330, "\x48\x8b\xc4\x55\x53\x56\x41\x55\x41\x56\x48\x8d\x68\x88\x48\x81\xec\x50\x01\x00\x00", 21,
        reinterpret_cast<void*>(&Generate), reinterpret_cast<void**>(&OriginalGenerate)},
    {0x1de3450, "\x40\x57\x41\x55\x41\x56\x48\x83\xec\x30\x48\x89\x6c\x24\x58\x49\x8b\xf8\x4c\x8b\x41\x10", 22,
        reinterpret_cast<void*>(&BuildDefense), reinterpret_cast<void**>(&OriginalDefense)},
    {0x167d3c0, "\x48\x89\x5c\x24\x18\x48\x89\x6c\x24\x20\x57\x48\x83\xec\x20", 15, nullptr, nullptr},
    {Profile::ApiSites[0].Rva, Profile::ApiSites[0].Bytes, Profile::ApiSites[0].Size, nullptr, nullptr},
    {Profile::ApiSites[1].Rva, Profile::ApiSites[1].Bytes, Profile::ApiSites[1].Size, nullptr, nullptr},
    {Profile::ApiSites[2].Rva, Profile::ApiSites[2].Bytes, Profile::ApiSites[2].Size, nullptr, nullptr},
    {Profile::ApiSites[3].Rva, Profile::ApiSites[3].Bytes, Profile::ApiSites[3].Size, nullptr, nullptr},
    {Profile::ApiSites[4].Rva, Profile::ApiSites[4].Bytes, Profile::ApiSites[4].Size, nullptr, nullptr},
    {Profile::ApiSites[5].Rva, Profile::ApiSites[5].Bytes, Profile::ApiSites[5].Size, nullptr, nullptr},
    {Profile::ApiSites[6].Rva, Profile::ApiSites[6].Bytes, Profile::ApiSites[6].Size, nullptr, nullptr},
    {Profile::ApiSites[7].Rva, Profile::ApiSites[7].Bytes, Profile::ApiSites[7].Size, nullptr, nullptr},
    {Profile::ApiSites[8].Rva, Profile::ApiSites[8].Bytes, Profile::ApiSites[8].Size, nullptr, nullptr},
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
        Probe.ReadOk = ReadProcessMemory(GetCurrentProcess(), Base + S.Rva, Probe.Bytes, S.Size, &Probe.ReadSize) != FALSE;
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
inline void InstallControl(HMODULE Executable)
{
    ExeBase = reinterpret_cast<unsigned char*>(Executable);
    Profile::Bind(ExeBase);
    const auto& S = Profile::ApiSites[5];
    unsigned char Actual[32]{};
    void* Target = ExeBase + S.Rva;
    if (!Read(Target, Actual, S.Size) || memcmp(Actual, S.Bytes, S.Size))
    { Log(LogLevel::Error, L"PARK22 disabled: enhanced CPU CreatePlayer build signature mismatch"); return; }
    MH_STATUS Status = MH_CreateHook(Target, reinterpret_cast<void*>(&CreatePlayer), reinterpret_cast<void**>(&OriginalCreate));
    if (Status != MH_OK) { Log(LogLevel::Error, L"PARK22 CreatePlayer hook could not be created"); return; }
    Status = MH_EnableHook(Target);
    if (Status != MH_OK) { MH_RemoveHook(Target); Log(LogLevel::Error, L"PARK22 CreatePlayer hook could not be enabled"); return; }
    Profile::Ready = true;
    Multiplayer::OnlineHookReady = Multiplayer::Online::Install();
    if (!OriginalConnect || !OriginalOpenRequest || !OriginalCloseHandle)
    { Log(LogLevel::Error, L"PARK22 control disabled: HTTP redirect unavailable; enhanced solo remains available"); return; }
    Multiplayer::Installed = true;
    if (HANDLE Thread = CreateThread(nullptr, 0, Multiplayer::Worker, nullptr, 0, nullptr)) CloseHandle(Thread);
    else
    {
        Multiplayer::Installed = false;
        Log(LogLevel::Error, L"PARK22 control worker could not start; enhanced solo remains available"); return;
    }
    Log(LogLevel::Info, Multiplayer::OnlineHookReady ?
        L"PARK22 v6 enabled: server-authored CPU profiles and guarded mixed online sessions; waiting for the game's login" :
        L"PARK22 mixed sessions unavailable; remote solo control remains available");
}
inline void InstallHooks(HMODULE Executable)
{
    auto* Base = reinterpret_cast<unsigned char*>(Executable);
    size_t Made = 0, Enabled = 0;
    MH_STATUS Status = MH_OK;
    for (unsigned I = 0; I < HookCount; ++I)
    {
        Status = MH_CreateHook(Base + Sites[I].Rva, Sites[I].Detour, Sites[I].Original);
        if (Status != MH_OK) break;
        ++Made;
    }
    // Hooks can be called as soon as they are enabled; publish Lookup first.
    if (Made == HookCount)
    {
        Lookup = reinterpret_cast<LookupFn>(Base + Sites[HookCount].Rva);
        for (unsigned I = 0; I < HookCount; ++I)
        {
            Status = MH_EnableHook(Base + Sites[I].Rva);
            if (Status != MH_OK) break;
            ++Enabled;
        }
    }
    if (Made != HookCount || Enabled != HookCount)
    {
        for (unsigned I = 0; I < Enabled; ++I) MH_DisableHook(Base + Sites[I].Rva);
        for (unsigned I = 0; I < Made; ++I) MH_RemoveHook(Base + Sites[I].Rva);
        std::wostringstream Detail;
        Detail << L"PARK22 refused: hook installation failed rva=0x" << std::hex
               << Sites[Made != HookCount ? Made : Enabled].Rva << std::dec << L" status=" << Status;
        Log(LogLevel::Error, Detail.str()); return;
    }
    MatchLifecycleHooks::PlayingHandler = &Playing;
    MatchLifecycleHooks::StartHandler = &Start;
    try { InstallControl(Executable); }
    catch (...) { Log(LogLevel::Error, L"PARK22 enhanced CPU hook installation failed"); }
    { std::lock_guard<std::mutex> Lock(Solo::ReceiptMutex); Solo::Receipt(); }
    Log(LogLevel::Info, Profile::Ready ?
        L"PARK22 CPU enabled: park v6 / solo v6, shared profile execution, guarded 2v2/3v3/5v5 start and manual/no-help AI defense" :
        L"PARK22 CPU unavailable: enhanced CPU hook is not ready");
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
                Log(LogLevel::Info, L"PARK22 native code ready after " +
                    std::to_wstring(GetTickCount64() - Started) + L" ms; installing hooks");
                InstallHooks(Executable); return 0;
            }
            const ULONGLONG Elapsed = GetTickCount64() - Started;
            if (Elapsed >= ReadinessTimeoutMs)
            {
                Log(LogLevel::Error, L"PARK22 refused: native build signature mismatch after " +
                    std::to_wstring(Elapsed) + L" ms waiting; " + SignatureDetail(Failure));
                return 1;
            }
            const DWORD Remaining = static_cast<DWORD>(ReadinessTimeoutMs - Elapsed);
            Sleep(Remaining < ReadinessPollMs ? Remaining : ReadinessPollMs);
        }
    }
    catch (...) { Log(LogLevel::Error, L"PARK22 refused: native readiness worker failed"); return 1; }
}
inline void Install(HMODULE Executable)
{
    // Always install for the supported NBA2K22 build; no opt-in flag file.
    if (!Executable || GetModuleHandleW(L"nba2k22.exe") != Executable) return;
    if (InstallStarted.exchange(true)) return;
    SignatureFailure Failure{};
    if (CheckSignatures(Executable, Failure)) { InstallHooks(Executable); return; }
    // The packed executable restores .text during startup. Wait outside Initialise.
    Log(LogLevel::Info, L"PARK22 waiting for native code signatures (up to " +
        std::to_wstring(ReadinessTimeoutMs) + L" ms); " + SignatureDetail(Failure));
    if (HANDLE Thread = CreateThread(nullptr, 0, WaitAndInstall, Executable, 0, nullptr)) CloseHandle(Thread);
    else
    {
        const DWORD Error = GetLastError();
        InstallStarted = false;
        Log(LogLevel::Error, L"PARK22 refused: native readiness thread could not start: " + std::to_wstring(Error));
    }
}
} // namespace ParkCpu
