// Temporary, opt-in NBA2K22 roster diagnostics. Does not construct or replace players.
#pragma once
#include "ModuleConfig.h"

namespace ParkRosterTrace
{
using GameInitFn = void(__fastcall*)(int, void*);
using AiRosterFn = void(__fastcall*)(void*, void*, int);
using RosterValueFn = unsigned int(__fastcall*)(void*);
inline GameInitFn OriginalGameInit = nullptr;
inline AiRosterFn OriginalAiRoster = nullptr;
inline RosterValueFn OriginalRosterValue = nullptr;
inline std::atomic_uint MatchNumber{0};
inline thread_local bool InAiRoster = false;
inline thread_local void* Seen[16]{};
inline thread_local unsigned int SeenCount = 0;

inline bool Read(const void* Address, void* Output, size_t Size)
{
    SIZE_T Copied = 0;
    return Address && ReadProcessMemory(GetCurrentProcess(), Address, Output, Size, &Copied) && Copied == Size;
}

inline void Snapshot(const wchar_t* Label, const void* Address, size_t Size)
{
    if (!ModuleConfig::LogParkRosterTrace) return;
    unsigned char Bytes[0x300]{};
    if (Size > sizeof(Bytes)) return;
    wchar_t Head[160]{};
    swprintf_s(Head, L"PARKTRACE %s address=%p bytes=%zu", Label, Address, Size);
    Log(LogLevel::Info, Head);
    if (!Read(Address, Bytes, Size))
    {
        Log(LogLevel::Info, L"PARKTRACE unreadable snapshot; original game call is unchanged");
        return;
    }
    for (size_t Offset = 0; Offset < Size; Offset += 16)
    {
        wchar_t Line[100]{};
        int Used = swprintf_s(Line, L"PARKTRACE +%03zX:", Offset);
        for (size_t I = Offset; I < Size && I < Offset + 16; ++I)
            Used += swprintf_s(Line + Used, sizeof(Line) / sizeof(Line[0]) - Used, L" %02X", Bytes[I]);
        Log(LogLevel::Info, Line);
    }
}

inline void __fastcall GameInit(int Mode, void* Settings)
{
    if (!ModuleConfig::LogParkRosterTrace) { OriginalGameInit(Mode, Settings); return; }
    const DWORD LastError = GetLastError();
    try
    {
        Log(LogLevel::Info, L"PARKTRACE game-init match=" + std::to_wstring(++MatchNumber) +
                           L" mode=" + std::to_wstring(Mode));
        Snapshot(L"game-init-settings", Settings, 0x300);
    }
    catch (...) {}
    SetLastError(LastError);
    OriginalGameInit(Mode, Settings);
}

inline void __fastcall AiRoster(void* Team, void* SelectedRoster, int Mode)
{
    if (!ModuleConfig::LogParkRosterTrace) { OriginalAiRoster(Team, SelectedRoster, Mode); return; }
    const DWORD LastError = GetLastError();
    try
    {
        wchar_t Line[180]{};
        swprintf_s(Line, L"PARKTRACE ai-roster team=%p selected=%p mode=%d", Team, SelectedRoster, Mode);
        Log(LogLevel::Info, Line);
        Snapshot(L"ai-team-header", Team, 0x100);
        // AI_InitRosterData walks player objects through team+8 and player+0xB10.
        // Read this chain without calling player virtual methods or writing memory.
        void* Player = nullptr;
        if (Team) Read(reinterpret_cast<unsigned char*>(Team) + 8, &Player, sizeof(Player));
        for (unsigned int I = 0; Player && I < 12; ++I)
        {
            Snapshot(L"ai-player-header", Player, 0x80);
            void* Next = nullptr;
            if (!Read(reinterpret_cast<unsigned char*>(Player) + 0xB10, &Next, sizeof(Next)) || Next == Player) break;
            Player = Next;
        }
    }
    catch (...) {}
    const bool Previous = InAiRoster;
    const unsigned int PreviousCount = SeenCount;
    void* PreviousSeen[16]{};
    memcpy(PreviousSeen, Seen, sizeof(Seen));
    InAiRoster = true;
    SeenCount = 0;
    SetLastError(LastError);
    OriginalAiRoster(Team, SelectedRoster, Mode);
    InAiRoster = Previous;
    SeenCount = PreviousCount;
    memcpy(Seen, PreviousSeen, sizeof(Seen));
}

inline unsigned int __fastcall RosterValue(void* Roster)
{
    const DWORD LastError = GetLastError();
    if (ModuleConfig::LogParkRosterTrace && InAiRoster && SeenCount < 16)
    {
        bool AlreadySeen = false;
        for (unsigned int I = 0; I < SeenCount; ++I) AlreadySeen |= Seen[I] == Roster;
        if (!AlreadySeen)
        {
            Seen[SeenCount++] = Roster;
            try { Snapshot(L"roster-player", Roster, 0x120); } catch (...) {}
        }
    }
    SetLastError(LastError);
    return OriginalRosterValue(Roster);
}

inline void Install(HMODULE Executable)
{
    if (!ModuleConfig::EnableParkRosterTrace) return;
    if (GetModuleHandleW(L"nba2k22.exe") != Executable)
    {
        Log(LogLevel::Error, L"PARKTRACE refused: executable is not NBA2K22");
        return;
    }
    struct Hook
    {
        size_t Offset;
        const char* Expected;
        size_t Length;
        void* Replacement;
        void** Original;
    };
    Hook Hooks[] = {
        {0x10cab80, "\x48\x8b\xc4\x55\x48\x8d\xa8\x38\xf2\xff\xff\x48\x81\xec\xc0\x0e\x00\x00", 18,
            reinterpret_cast<void*>(&GameInit), reinterpret_cast<void**>(&OriginalGameInit)},
        {0x197d550, "\x48\x8b\xc4\x44\x89\x40\x18\x48\x89\x50\x10\x55\x48\x8d\x68\xe8\x48\x81\xec\x10\x01\x00\x00", 23,
            reinterpret_cast<void*>(&AiRoster), reinterpret_cast<void**>(&OriginalAiRoster)},
        {0x979200, "\x8b\x81\xf8\x00\x00\x00\xc1\xe8\x12\x83\xe0\x7f\xc3", 13,
            reinterpret_cast<void*>(&RosterValue), reinterpret_cast<void**>(&OriginalRosterValue)},
    };
    auto* Base = reinterpret_cast<unsigned char*>(Executable);
    for (const auto& H : Hooks)
    {
        unsigned char Actual[32]{};
        if (!Read(Base + H.Offset, Actual, H.Length) || memcmp(Actual, H.Expected, H.Length))
        {
            Log(LogLevel::Error, L"PARKTRACE refused: native function bytes differ from analyzed build");
            return;
        }
    }
    size_t Created = 0;
    for (const auto& H : Hooks)
    {
        if (MH_CreateHook(Base + H.Offset, H.Replacement, H.Original) != MH_OK) break;
        ++Created;
    }
    size_t Enabled = 0;
    if (Created == 3)
        for (const auto& H : Hooks)
        {
            if (MH_EnableHook(Base + H.Offset) != MH_OK) break;
            ++Enabled;
        }
    if (Created != 3 || Enabled != 3)
    {
        for (size_t I = 0; I < Enabled; ++I) MH_DisableHook(Base + Hooks[I].Offset);
        for (size_t I = 0; I < Created; ++I) MH_RemoveHook(Base + Hooks[I].Offset);
        Log(LogLevel::Error, L"PARKTRACE hook installation failed; diagnostic hooks removed");
        return;
    }
    Log(LogLevel::Info, L"PARKTRACE enabled: native game settings, AI teams, roster players; observation only");
}
}
