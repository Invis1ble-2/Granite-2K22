// NBA 2K22 park CPU profiles. Included by Module.cpp before the park hooks.
#pragma once
#include <string>

namespace CpuEnhancement
{
inline constexpr uint32_t ModuleVersion = 0x00010213;
inline constexpr size_t TemplateBytes = 0x560, DataBytes = 0x4f0, AttributeCount = 0x39;
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
};
using GetAttributeFn = int(__fastcall*)(void*, unsigned);
using SetAttributeFn = void(__fastcall*)(void*, unsigned, int);
using RecalculateFn = void(__fastcall*)(void*, int);
using OverallFn = int(__fastcall*)(void*);
using DeriveBodyFn = void(__fastcall*)(void*, float);
inline GetAttributeFn GetAttribute = nullptr;
inline SetAttributeFn SetAttribute = nullptr;
inline RecalculateFn Recalculate = nullptr;
inline OverallFn Overall = nullptr;
inline DeriveBodyFn DeriveBody = nullptr;
inline void Bind(unsigned char* Base)
{
    GetAttribute = reinterpret_cast<GetAttributeFn>(Base + ApiSites[0].Rva);
    SetAttribute = reinterpret_cast<SetAttributeFn>(Base + ApiSites[1].Rva);
    Recalculate = reinterpret_cast<RecalculateFn>(Base + ApiSites[2].Rva);
    Overall = reinterpret_cast<OverallFn>(Base + ApiSites[3].Rva);
    DeriveBody = reinterpret_cast<DeriveBodyFn>(Base + ApiSites[4].Rva);
}
inline bool Read(const void* Address, void* Out, size_t Size)
{
    SIZE_T N = 0;
    return Address && ReadProcessMemory(GetCurrentProcess(), Address, Out, Size, &N) && N == Size;
}
template<class T> inline T Load(const unsigned char* Data, size_t Offset)
{
    T Value{}; memcpy(&Value, Data + Offset, sizeof(Value)); return Value;
}
template<class T> inline void Store(unsigned char* Data, size_t Offset, T Value)
{
    memcpy(Data + Offset, &Value, sizeof(Value));
}
template<class T> inline bool At(const void* Data, size_t Offset, T& Value)
{
    return Data && Read(static_cast<const unsigned char*>(Data) + Offset, &Value, sizeof(Value));
}
struct Random
{
    uint32_t State;
    explicit Random(uint32_t Seed) : State(Seed ^ 0x50433232U) {}
    uint32_t Next()
    {
        // Unsigned, fixed-width mixing; no game/global RNG state is touched.
        State += 0x9e3779b9U;
        uint32_t X = State;
        X = (X ^ (X >> 16)) * 0x21f0aaadU;
        X = (X ^ (X >> 15)) * 0x735a2d97U;
        return X ^ (X >> 15);
    }
    uint32_t Below(uint32_t Count)
    {
        const uint32_t Threshold = (0U - Count) % Count;
        uint32_t X;
        do { X = Next(); } while (X < Threshold);
        return X % Count;
    }
};
struct Snapshot
{
    uint32_t Rating = 0, Position = 0, Type = 0, Height = 0, DerivedHeight = 0, Weight = 0;
    std::array<uint32_t, 5> Shape{};
    std::array<uint32_t, AttributeCount> Attributes{};
    bool operator==(const Snapshot&) const = default;
};
struct Generation
{
    // Lives through the whole Generate call, not merely the nested Create call.
    alignas(16) unsigned char Data[TemplateBytes]{};
    Snapshot Expected{};
    std::string Error; // First failure only; propagated to the existing receipt/log.
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
    if (S.Height < 17500 || S.Height > 22000)
        return Reject(Error, "height-range:actual=" + std::to_string(S.Height));
    if (!S.DerivedHeight) return Reject(Error, "derived-height-zero");
    for (size_t I = 0; I < S.Shape.size(); ++I)
    {
        const float Value = Load<float>(Appearance, ShapeOffsets[I]);
        if (!std::isfinite(Value) || Value < 0.9499f || Value > 1.0501f)
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
    return true;
}
inline bool Tune(void* Data, uint32_t Target, uint32_t Seed, std::string* Error)
{
    std::array<int, AttributeCount> Base{};
    for (unsigned I = 0; I < AttributeCount; ++I) Base[I] = GetAttribute(Data, I);
    const ULONGLONG Deadline = GetTickCount64() + 2000;
    unsigned Evaluations = 0;
    const auto Score = [&]() -> int
    {
        if (++Evaluations > 512) { Reject(Error, "evaluation-limit"); return -1; }
        if (GetTickCount64() > Deadline) { Reject(Error, "deadline"); return -1; }
        // updatePotential=0: no potential write or registered-roster change branch.
        Recalculate(Data, 0);
        return Overall(Data);
    };
    const auto Shift = [&](int Delta) -> int
    {
        for (unsigned I = 0; I < AttributeCount; ++I) if (I != 0x22)
            SetAttribute(Data, I, std::clamp(Base[I] + Delta, 25, 99));
        return Score();
    };
    // Preserve the template's relative strengths. Potential (index 0x22),
    // tendencies (0x39+), badges and animation data are not randomized.
    int Low = -74, High = 74;
    int Value = Shift(High);
    if (Value < static_cast<int>(Target) || Value > 99)
        return Reject(Error, "target-unreachable:target=" + std::to_string(Target) + ":actual=" + std::to_string(Value));
    while (Low < High)
    {
        const int Mid = Low + (High - Low) / 2;
        Value = Shift(Mid);
        if (Value < 25 || Value > 99) return Reject(Error, "score-range:actual=" + std::to_string(Value));
        if (Value < static_cast<int>(Target)) Low = Mid + 1;
        else High = Mid;
    }
    Value = Shift(Low);
    if (Value < static_cast<int>(Target)) return Reject(Error, "shift-below-target:actual=" + std::to_string(Value));
    if (Value == static_cast<int>(Target)) return true;
    // Resolve an integer-score boundary without flattening the entire profile.
    // A bounded coordinate search can only accept native scores >= the target.
    const unsigned First = Seed % static_cast<unsigned>(AttributeCount);
    for (unsigned N = 0; N < AttributeCount; ++N)
    {
        const unsigned I = (First + N) % static_cast<unsigned>(AttributeCount);
        if (I == 0x22) continue;
        int A = 25, B = GetAttribute(Data, I);
        while (A < B)
        {
            const int Mid = A + (B - A) / 2;
            SetAttribute(Data, I, Mid);
            Value = Score();
            if (Value < 25 || Value > 99) return Reject(Error, "score-range:actual=" + std::to_string(Value));
            if (Value < static_cast<int>(Target)) A = Mid + 1;
            else B = Mid;
        }
        SetAttribute(Data, I, A);
        Value = Score();
        if (Value == static_cast<int>(Target)) return true;
        if (Value < static_cast<int>(Target)) return Reject(Error, "coordinate-below-target:actual=" + std::to_string(Value));
    }
    return Reject(Error, "exact-target-unreachable"); // No display-only fallback.
}
inline bool Build(Generation& G, const unsigned char* Source)
{
    if (!Authorized(G)) return Reject(&G.Error, "build-authorization");
    if (!Read(Source, G.Data, sizeof(G.Data))) return Reject(&G.Error, "template-unreadable");
    constexpr size_t ZeroSlots[] = {0x60, 0x78, 0x80, 0x98, 0xa0, 0xa8, 0xb0, 0xb8, 0xc0, 0xc8, 0xd0, 0xd8, 0xe0};
    for (size_t Offset : ZeroSlots) if (Load<uint64_t>(G.Data, Offset))
        return Reject(&G.Error, "template-nonzero-slot:offset=" + std::to_string(Offset));
    if (Load<const void*>(G.Data, 0x88) != Source + 0x4f0 ||
        Load<const void*>(G.Data, 0x90) != Source + 0x520) return Reject(&G.Error, "template-pointer-layout");
    Store(G.Data, 0x88, G.Data + 0x4f0);
    Store(G.Data, 0x90, G.Data + 0x520);
    uint32_t Position = (Load<uint32_t>(G.Data, 0xf8) >> 8) & 7;
    if (Position > 5) return Reject(&G.Error, "template-position:actual=" + std::to_string(Position));
    if (Position == 5) // Same fallback as the native recalculator.
        Store(G.Data, 0xf8, (Load<uint32_t>(G.Data, 0xf8) & ~0x700U) | 0x400U);
    Random R(G.Seed);
    const uint32_t Target = 80 + R.Below(20);
    auto* Appearance = G.Data + 0x520;
    const auto Height = static_cast<uint16_t>(17500 + R.Below(46) * 100);
    Store(Appearance, 0, static_cast<uint16_t>((Load<uint16_t>(Appearance, 0) & 0x8000) | Height));
    for (size_t Offset : ShapeOffsets)
        Store(Appearance, Offset, static_cast<float>(9500 + R.Below(1001)) / 10000.0f);
    // 0x14044d6bc-6c2 passes appearance+0xc as the second (XMM1) argument.
    DeriveBody(Appearance, Load<float>(Appearance, 0xc));
    std::string Detail;
    if (!Tune(G.Data, Target, G.Seed, &Detail)) return Reject(&G.Error, "tune-" + Detail);
    if (!Capture(G.Data, G.Expected, &Detail)) return Reject(&G.Error, "template-" + Detail);
    if (G.Expected.Rating != Target) return Reject(&G.Error, "template-target-mismatch");
    // The copied display field must reflect the actual native calculation.
    Store(G.Data, 0x70, (Load<uint32_t>(G.Data, 0x70) & ~0xfe000U) | (Target << 13));
    return Authorized(G) || Reject(&G.Error, "build-authorization-expired");
}
// TK_WORLD::PLAYER embeds its server object at +0x50. Server+0x164 is
// therefore Player+0x1b4 (dirty byte +0x1b8), not Player+0x164.
inline constexpr size_t DisplayOffset = 0x1b4, DisplayDirtyOffset = 0x1b8;
inline bool VerifyData(void* Player, uint64_t Id, const Snapshot& Expected, std::string* Error, void** Roster = nullptr)
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
    if (Roster) *Roster = Data;
    return true;
}
inline bool VerifyDisplay(void* Player, void* Data, const Snapshot& Expected, std::string* Error)
{
    uint32_t Display = 0;
    if (!At(Player, DisplayOffset, Display)) return Reject(Error, "display-unreadable");
    if (Display != Expected.Rating)
        return Reject(Error, "display:expected=" + std::to_string(Expected.Rating) + ":actual=" + std::to_string(Display));
    const void* Sources[] = {static_cast<unsigned char*>(Player) + 0x2208, static_cast<unsigned char*>(Player) + 0x3100, Data};
    const char* Names[] = {"embedded-display", "prepared-display", "roster-display"};
    for (size_t I = 0; I < 3; ++I)
    {
        uint32_t Packed = 0;
        if (!At(Sources[I], 0x70, Packed)) return Reject(Error, std::string(Names[I]) + "-unreadable");
        const uint32_t Value = (Packed >> 13) & 0x7f;
        if (Value != Expected.Rating)
            return Reject(Error, std::string(Names[I]) + ":expected=" + std::to_string(Expected.Rating) + ":actual=" + std::to_string(Value));
    }
    return true;
}
inline bool Verify(void* Player, uint64_t Id, const Snapshot& Expected, std::string* Error = nullptr)
{
    void* Data = nullptr;
    return VerifyData(Player, Id, Expected, Error, &Data) && VerifyDisplay(Player, Data, Expected, Error);
}
inline bool Finish(Generation& G, void* Player)
{
    if (!G.Valid) return Reject(&G.Error, "generation-invalid");
    if (!G.Seen) return Reject(&G.Error, G.Entered ? "create-returned-null" : "create-hook-not-reached");
    if (!Authorized(G)) return Reject(&G.Error, "generation-authorization");
    void* Data = nullptr;
    if (!VerifyData(Player, G.Id, G.Expected, &G.Error, &Data)) return false;
    // Native Create forces ServerObject+0x164 to 100 for descriptor flag 8.
    // Synchronize only this authorized CPU, after both real profiles match.
    auto* Base = static_cast<unsigned char*>(Player);
    unsigned char* Sources[] = {Base + 0x2208, Base + 0x3100, static_cast<unsigned char*>(Data)};
    uint32_t Packed[3]{};
    for (size_t I = 0; I < 3; ++I)
    {
        if (!At(Sources[I], 0x70, Packed[I])) return Reject(&G.Error, "display-sync-unreadable");
        Packed[I] = (Packed[I] & ~0xfe000U) | (G.Expected.Rating << 13);
    }
    if (!Authorized(G)) return Reject(&G.Error, "display-sync-authorization");
    const auto Write = [&](void* Address, const void* Bytes, size_t Size)
    {
        SIZE_T N = 0;
        return WriteProcessMemory(GetCurrentProcess(), Address, Bytes, Size, &N) && N == Size;
    };
    const unsigned char Dirty = 1;
    if (!Write(Base + DisplayOffset, &G.Expected.Rating, sizeof(G.Expected.Rating)) ||
        !Write(Base + DisplayDirtyOffset, &Dirty, sizeof(Dirty))) return Reject(&G.Error, "display-sync-write");
    // +0x3100 is the prepared PLAYERDATA copy made by FUN_14166ac80.
    // Update only packed display bits, never its attributes or appearance.
    for (size_t I = 0; I < 3; ++I)
        if (!Write(Sources[I] + 0x70, &Packed[I], sizeof(Packed[I]))) return Reject(&G.Error, "display-sync-packed-write");
    return (Authorized(G) || Reject(&G.Error, "display-sync-authorization-expired")) &&
        Verify(Player, G.Id, G.Expected, &G.Error);
}
inline void Append(std::vector<unsigned char>& Bytes, uint64_t Id, const Snapshot& S)
{
    const auto U32 = [&](uint32_t V) { for (unsigned I = 0; I < 4; ++I) Bytes.push_back(static_cast<unsigned char>(V >> (I * 8))); };
    for (unsigned I = 0; I < 8; ++I) Bytes.push_back(static_cast<unsigned char>(Id >> (I * 8)));
    U32(S.Rating); U32(S.Position); U32(S.Type); U32(S.Height); U32(S.DerivedHeight); U32(S.Weight);
    for (uint32_t V : S.Shape) U32(V);
    for (uint32_t V : S.Attributes) U32(V);
}
}
