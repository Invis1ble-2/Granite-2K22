#pragma once
#include <windows.h>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace BadgeSync
{
constexpr uint32_t Version = 0x2f4f0e8c;
constexpr uint32_t Maximum = 0xa8226629;
constexpr uint32_t Progress = 0x788024d0;
constexpr uint32_t Extra = 0x3c63053b;
constexpr uint32_t Potential = 0xc09ce10f;
constexpr uint32_t BadgeName = 0xb3aea962;
constexpr uint32_t BadgeLevel = 0xebb6c44d;
constexpr uint32_t LevelCrcs[] = {0x1c966fc2, 0x4e107e0f, 0xdfa3dfdd, 0x713cf0e5, 0x371de7a3};

struct Snapshot
{
    uint64_t SaveId, Slot;
    uint32_t Caps[4], Points[4], Extras[4], Potentials[24], Names[99], Levels[99];
};

// POD only: SEH catches unloaded/changing career pointers without C++ unwinding.
inline bool ReadSnapshot(uint64_t SaveId, uint64_t Slot, Snapshot& Result, const wchar_t*& Failure)
{
    Failure = L"executable signature";
    __try
    {
        auto* Base = reinterpret_cast<unsigned char*>(GetModuleHandleW(nullptr));
        const unsigned char Signature[] = {0x48, 0x89, 0x5c, 0x24, 0x08, 0x57};
        if (!Base || memcmp(Base + 0x11d39a0, Signature, sizeof(Signature)) != 0) return false;
        Failure = L"career state pointers";
        auto* State = *reinterpret_cast<unsigned char**>(Base + 0x6332628);
        void* Career = *reinterpret_cast<void**>(Base + 0x632f0d8);
        if (!State || !Career) return false;
        Failure = L"career save/slot mismatch";
        auto** Table = *reinterpret_cast<void***>(Career);
        using ScopeFn = uint64_t (*)(void*);
        Result.SaveId = reinterpret_cast<ScopeFn>(Table[0x188 / 8])(Career);
        Result.Slot = reinterpret_cast<ScopeFn>(Table[0x2b0 / 8])(Career);
        if (Result.SaveId != SaveId || Result.Slot != Slot) return false;
        Failure = L"career player pointer";
        using PlayerFn = unsigned char* (*)(void*);
        auto* Player = reinterpret_cast<PlayerFn>(Table[0x2a0 / 8])(Career);
        if (!Player) return false;
        auto* PlayerData = *reinterpret_cast<unsigned char**>(Player + 0xe0);
        if (!PlayerData) return false;
        Failure = L"career/state build parameters differ";
        const unsigned Position = *reinterpret_cast<uint32_t*>(State + 0x17958);
        const unsigned Archetype = *reinterpret_cast<uint32_t*>(State + 0x1795c);
        const unsigned Physical = *reinterpret_cast<uint32_t*>(State + 0x17960);
        if (Position > 4 || Archetype > 17 || Physical > 4 ||
            Position != ((*reinterpret_cast<uint32_t*>(Player + 0xf8) >> 8) & 7) ||
            Archetype != ((*reinterpret_cast<uint32_t*>(Player + 0x368) >> 7) & 31) ||
            Physical != ((*reinterpret_cast<uint32_t*>(PlayerData + 0x8c) >> 18) & 7)) return false;
        Failure = L"career/state attribute potential differs";
        float InitialPotential[24];
        for (int Index = 0; Index < 24; ++Index)
        {
            InitialPotential[Index] = *reinterpret_cast<float*>(State + 0x1798c + Index * 4);
            if (!std::isfinite(InitialPotential[Index]) || InitialPotential[Index] < 0 || InitialPotential[Index] > 1)
                return false;
            if (Index < 19 && std::fabs(InitialPotential[Index] -
                *reinterpret_cast<float*>(PlayerData + 8 + Index * 4)) > 0.000002f) return false;
        }
        Failure = L"native maximum/earned/extra inconsistent";
        using BudgetFn = int (*)(int, int);
        auto Budget = reinterpret_cast<BudgetFn>(Base + 0x11d39a0);
        unsigned Total = 0;
        for (int Index = 0; Index < 4; ++Index)
        {
            const int Category = Index + 1;
            const int Cap = Budget(Category, 0); // include the build's existing extra points
            const unsigned Earned = *reinterpret_cast<uint16_t*>(State + 0x17a64 + Category * 2);
            const unsigned Bonus = *reinterpret_cast<uint16_t*>(State + 0x17a9c + Category * 2);
            if (Cap < 0 || Cap > 65535 || Earned > static_cast<unsigned>(Cap) || Bonus > static_cast<unsigned>(Cap)) return false;
            Result.Caps[Index] = Cap;
            Result.Extras[Index] = Bonus;
            const unsigned Ordinary = Cap - Bonus;
            const int Threshold = Ordinary ? *reinterpret_cast<int*>(Base + 0x6841f0c +
                (Category * 30 + (Ordinary > 30 ? 29 : Ordinary - 1)) * 4) : 0;
            const unsigned Current = *reinterpret_cast<uint32_t*>(State + 0x17a78 + Category * 4);
            if (Threshold < 0 || Current > 0x7fffffff) return false;
            Result.Points[Index] = Current > static_cast<unsigned>(Threshold) ? Current : Threshold;
            Total += Cap;
        }
        Failure = L"native budget not initialized";
        if (!Total) return false; // not initialized yet; retry on the next attributes request
        Failure = L"potential changed during snapshot";
        for (int Index = 0; Index < 24; ++Index)
        {
            const float Ratio = *reinterpret_cast<float*>(State + 0x1798c + Index * 4);
            if (!std::isfinite(Ratio) || Ratio < 0 || Ratio > 1 || Ratio != InitialPotential[Index]) return false;
            Result.Potentials[Index] = static_cast<unsigned>(std::lround(Ratio * 1000000.0f));
        }
        Failure = L"equipped badge level out of range";
        for (int Index = 0; Index < 99; ++Index)
        {
            const unsigned Level = State[0x17a00 + Index];
            if (Level > 4) return false;
            Result.Names[Index] = *reinterpret_cast<uint32_t*>(Base + 0x24cbec0 + Index * 4);
            Result.Levels[Index] = LevelCrcs[Level];
        }
        Failure = L"career changed during snapshot";
        if (*reinterpret_cast<unsigned char**>(Base + 0x6332628) != State ||
            *reinterpret_cast<void**>(Base + 0x632f0d8) != Career) return false;
        if (reinterpret_cast<PlayerFn>(Table[0x2a0 / 8])(Career) != Player ||
            *reinterpret_cast<uint32_t*>(State + 0x17958) != Position ||
            *reinterpret_cast<uint32_t*>(State + 0x1795c) != Archetype ||
            *reinterpret_cast<uint32_t*>(State + 0x17960) != Physical) return false;
        return reinterpret_cast<ScopeFn>(Table[0x188 / 8])(Career) == SaveId &&
               reinterpret_cast<ScopeFn>(Table[0x2b0 / 8])(Career) == Slot;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}

inline uint32_t Read32(const unsigned char* Bytes)
{
    return (uint32_t(Bytes[0]) << 24) | (uint32_t(Bytes[1]) << 16) | (uint32_t(Bytes[2]) << 8) | Bytes[3];
}
inline void Write32(std::vector<unsigned char>& Bytes, uint32_t Value)
{
    for (int Shift = 24; Shift >= 0; Shift -= 8) Bytes.push_back(static_cast<unsigned char>(Value >> Shift));
}
inline void Field(std::vector<unsigned char>& Bytes, uint32_t Name, uint64_t Value)
{
    Write32(Bytes, Name); Write32(Bytes, 0x3d9e5089);
    Write32(Bytes, static_cast<uint32_t>(Value >> 32)); Write32(Bytes, static_cast<uint32_t>(Value));
}

// Only raw field lists with no external data are changed. Original requests survive all failures.
inline bool RequestScope(const void* Body, DWORD Length, uint64_t& SaveId, uint64_t& Slot)
{
    if (!Body || Length < 16 || Length > 65536 || Length % 16) return false;
    const auto* Bytes = static_cast<const unsigned char*>(Body);
    bool HaveSave = false, HaveSlot = false;
    for (DWORD Offset = 0; Offset < Length; Offset += 16)
    {
        const uint32_t Name = Read32(Bytes + Offset);
        if (!Name) return Offset == Length - 16 && HaveSave && HaveSlot &&
            Read32(Bytes + Offset + 4) == 0 && Read32(Bytes + Offset + 8) == 0 && Read32(Bytes + Offset + 12) == 0;
        if (Name == Version) return false;
        if (Name == 0xd5e5f21d || Name == 0x5eeda966)
        {
            if (Read32(Bytes + Offset + 4) != 0x3d9e5089) return false;
            const uint64_t Value = (uint64_t(Read32(Bytes + Offset + 8)) << 32) | Read32(Bytes + Offset + 12);
            if (Name == 0xd5e5f21d) { if (HaveSave) return false; SaveId = Value; HaveSave = true; }
            else { if (HaveSlot) return false; Slot = Value; HaveSlot = true; }
        }
    }
    return false;
}
inline std::vector<unsigned char> Encode(const void* Body, DWORD Length, const Snapshot& Data)
{
    const auto* Bytes = static_cast<const unsigned char*>(Body);
    std::vector<unsigned char> Result(Bytes, Bytes + Length - 16);
    Field(Result, Version, 1);
    for (int Index = 0; Index < 4; ++Index)
    {
        Field(Result, Maximum, Data.Caps[Index]); Field(Result, Progress, Data.Points[Index]);
        Field(Result, Extra, Data.Extras[Index]);
    }
    for (auto Value : Data.Potentials) Field(Result, Potential, Value);
    for (int Index = 0; Index < 99; ++Index)
    {
        Field(Result, BadgeName, Data.Names[Index]); Field(Result, BadgeLevel, Data.Levels[Index]);
    }
    Result.resize(Result.size() + 16, 0);
    return Result;
}
}
