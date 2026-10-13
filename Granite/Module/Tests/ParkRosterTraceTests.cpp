#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <stdexcept>
#include "../MinHook/include/MinHook.h"
enum class LogLevel { Info, Error };
std::vector<std::wstring> Lines;
void Log(LogLevel, const std::wstring& Text) { Lines.push_back(Text); }
std::wstring ModuleDirectory() { return L"Z:\\nonexistent-park-trace-test"; }
#include "../ParkRosterTrace.h"
void Check(bool Value) { if (!Value) throw std::runtime_error("assertion failed"); }
unsigned char Settings[0x300]{}, Team[0x100]{}, Player[0xb18]{}, Roster[0x120]{};
unsigned int GameCalls = 0, AiCalls = 0, GetterCalls = 0;
void __fastcall NativeGame(int Mode, void* Data)
{
    Check(Mode == 7 && Data == Settings && GetLastError() == 42); ++GameCalls;
}
unsigned int __fastcall NativeValue(void* Data)
{
    Check(Data == Roster || Data == nullptr); Check(GetLastError() == 42); ++GetterCalls;
    return Data ? 37U : 99U;
}
void __fastcall NativeAi(void* Data, void* Selected, int Mode)
{
    Check(Data == Team && Selected == Roster && Mode == 3 && GetLastError() == 42); ++AiCalls;
    Check(ParkRosterTrace::RosterValue(Roster) == 37);
    Check(ParkRosterTrace::RosterValue(Roster) == 37);
    Check(ParkRosterTrace::RosterValue(nullptr) == 99); // diagnostics never fabricate a replacement value
    Check(ParkRosterTrace::SeenCount == 2);
}
int main()
{
    try {
        ModuleConfig::LogParkRosterTrace = true;
        ParkRosterTrace::OriginalGameInit = NativeGame;
        ParkRosterTrace::OriginalAiRoster = NativeAi;
        ParkRosterTrace::OriginalRosterValue = NativeValue;
        void* Node = Player; memcpy(Team + 8, &Node, sizeof(Node));
        SetLastError(42);
        ParkRosterTrace::GameInit(7, Settings);
        ParkRosterTrace::AiRoster(Team, Roster, 3);
        Check(GameCalls == 1 && AiCalls == 1 && GetterCalls == 3);
        Check(!ParkRosterTrace::InAiRoster && ParkRosterTrace::SeenCount == 0);
        unsigned int Captures = 0;
        for (const auto& Line : Lines) if (Line.find(L"PARKTRACE roster-player address=") == 0) ++Captures;
        Check(Captures == 2); // repeated getter calls are sampled once per team
        Check(ParkRosterTrace::RosterValue(Roster) == 37 && GetterCalls == 4);
        const size_t Count = Lines.size();
        ParkRosterTrace::Install(nullptr); // default-disabled INI feature installs no native hook
        Check(Lines.size() == Count);
        puts("ParkRosterTrace: original arguments/returns, last-error preservation, bounded unique roster sampling, null handling and disabled installation passed");
        return 0;
    } catch (const std::exception& E) { fprintf(stderr, "%s\n", E.what()); return 1; }
}
