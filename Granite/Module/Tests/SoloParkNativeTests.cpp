#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cwctype>
#include <intrin.h>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include "../MinHook/include/MinHook.h"
enum class LogLevel { Info, Verbose, Error };
void Log(LogLevel, const std::wstring&) {}
#include "../CpuEnhancement.h"
const wchar_t* RedirectHost=L"127.0.0.1";
using WinHttpConnectFn=HINTERNET(WINAPI*)(HINTERNET,LPCWSTR,INTERNET_PORT,DWORD);
using WinHttpOpenRequestFn=HINTERNET(WINAPI*)(HINTERNET,LPCWSTR,LPCWSTR,LPCWSTR,LPCWSTR,LPCWSTR const*,DWORD);
using WinHttpCloseHandleFn=BOOL(WINAPI*)(HINTERNET);
WinHttpConnectFn OriginalConnect=nullptr;
WinHttpOpenRequestFn OriginalOpenRequest=nullptr;
WinHttpCloseHandleFn OriginalCloseHandle=nullptr;
#include "../NativeParkControl.h"
#include "../SoloParkNative.h"
void Check(bool Ok) { if (!Ok) throw std::runtime_error("assertion failed"); }
unsigned char Players[4][0x446d0]{}, Containers[4][0x30]{}, Rosters[4][0x120]{}, Object[0xb0]{}, Info[0x590]{};
const uint64_t Ids[] = {0x0110000100001000ULL, 0x0222c00000000010ULL, 0x0222c00000000011ULL, 0x0222c00000000012ULL};
unsigned GenerateCalls = 0, StartCalls = 0, PlayingCalls = 0;
void* Result = Players[1];
template<class T> void Put(unsigned char* B, size_t Off, T Value) { memcpy(B + Off, &Value, sizeof(Value)); }
void* __fastcall NativeGenerate(void* S, void* A, void* O)
{
    Check(S == Players[0] && A == Rosters[0] && O == Object);++GenerateCalls;SetLastError(91);return Result;
}
void __fastcall NativeStart(void* S, void* I)
{
    Check(S == Players[0] && I == Info && GetLastError() == 73);++StartCalls;SetLastError(92);
}
int __fastcall NativeHomeCount() { return 3; }
int __fastcall NativeAwayCount() { return 4; }
uint64_t PlayingResult = 1;
uint64_t __fastcall NativePlaying(void* S)
{
    Check(S == Players[0] && GetLastError() == 73);
    Check(SoloParkNative::HomeCount()==2 && SoloParkNative::AwayCount()==2);
    ++PlayingCalls;SetLastError(94);return PlayingResult;
}
void* __fastcall Lookup(void* S, uint64_t Id)
{
    Check(S == Players[0]);for (unsigned I = 0; I < 4; ++I) if (Ids[I] == Id) return Players[I];return nullptr;
}
bool ArmRequest(const SoloParkNative::Request& R)
{
    SoloParkNative::NetworkEnvelope E{};E.Instance=0x1122334455667788ULL;E.Epoch=0x8877665544332211ULL;E.LeaseMs=8000;E.Data=R;
    return SoloParkNative::NetworkReply(&E,sizeof(E),E.Instance);
}
int main()
{
    try {
        SoloParkNative::Request R{};R.Magic=0x32325053;R.Version=3;R.Match=0x1234;R.Owner=Ids[0];R.TeamSize=2;R.CpuCount=3;
        for (unsigned I=0; I<R.CpuCount; ++I) { R.Cpu[I]=Ids[I+1]; R.Seeds[I]=I+1; }
        SoloParkNative::Request Loaded{};Check(!SoloParkNative::LoadRequest(Loaded));
        Check(ArmRequest(R));Check(SoloParkNative::LoadRequest(Loaded));
        for (unsigned I = 0; I < 4; ++I) {
            Put(Players[I],0xf0,Ids[I]);Put(Players[I],0x2200,I ? 8U : 0U);
            Put(Players[I],0x446c0,static_cast<void*>(Containers[I]));Put(Containers[I],0x28,static_cast<void*>(Rosters[I]));
        }
        SoloParkNative::OriginalGenerate=NativeGenerate;SoloParkNative::OriginalStart=NativeStart;
        SoloParkNative::OriginalPlaying=NativePlaying;SoloParkNative::Lookup=Lookup;
        SoloParkNative::OriginalHomeCount=NativeHomeCount;SoloParkNative::OriginalAwayCount=NativeAwayCount;
        Check(SoloParkNative::HomeCount()==3 && SoloParkNative::AwayCount()==4);
        bool OtherThreadNative=false;
        {
            SoloParkNative::InitScope Scope;
            std::thread Worker([&] { OtherThreadNative=SoloParkNative::HomeCount()==3 && SoloParkNative::AwayCount()==4; });
            Worker.join();Check(OtherThreadNative && SoloParkNative::HomeCount()==2);
            { SoloParkNative::InitScope Nested;Check(SoloParkNative::AwayCount()==2); }
            Check(SoloParkNative::InitializingSolo);
        }
        try { SoloParkNative::InitScope Scope;throw std::runtime_error("scope"); }
        catch (const std::runtime_error&) {}
        Check(!SoloParkNative::InitializingSolo && SoloParkNative::HomeCount()==3);
        for (unsigned I=1; I<4; ++I) {
            Put(Object,0xa0,Ids[I]);Result=Players[I];SetLastError(73);
            Check(SoloParkNative::Generate(Players[0],Rosters[0],Object) == Result && GetLastError()==91);
            Check(SoloParkNative::Created[I-1]);
        }
        // Reproduce native uint32_t indexing; poison the previously mistaken offset.
        Check(GenerateCalls==3);Put(Info,0xb6*sizeof(uint32_t),R.Match);
        Put(Info,0xd0*sizeof(uint32_t),uint64_t(0xabcdef));Put(Info,0x2e8,uint64_t(0x400000002));
        Put(Info,0x118,2);Put(Info,0x11c,2);
        Put(Info,0x48,Ids[0]);Put(Info,0x50,Ids[1]);Put(Info,0xb0,Ids[2]);Put(Info,0xb8,Ids[3]);
        unsigned char Before[sizeof(Info)]{};memcpy(Before,Info,sizeof(Info));
        SetLastError(73);SoloParkNative::Start(Players[0],Info);Check(StartCalls==1 && GetLastError()==92);
        Check(memcmp(Before,Info,sizeof(Info))==0);
        memcpy(Players[0]+0xcb0,Info,sizeof(Info));
        for (auto& Player : Players) Put(Player,0x21f0,1U);
        SetLastError(73);Check(SoloParkNative::Playing(Players[0])==1 && PlayingCalls==1 && GetLastError()==94);
        PlayingResult=0;SetLastError(73);Check(SoloParkNative::Playing(Players[0])==0 && PlayingCalls==2 && GetLastError()==94);
        const auto ReceiptText=SoloParkNative::NetworkReceipt(0x1122334455667788ULL);
        Check(strstr(ReceiptText.c_str(),"\"started\":false") && strstr(ReceiptText.c_str(),"native-playing-init-failed"));
        PlayingResult=1;
        Check(!SoloParkNative::InitializingSolo && SoloParkNative::HomeCount()==3 && SoloParkNative::AwayCount()==4);
        Put(Players[2],0x21f0,2U);SetLastError(73);Check(SoloParkNative::Playing(Players[0])==0 && PlayingCalls==2);
        Put(Players[2],0x21f0,1U);Put(Players[0],0xcb0+0x118,0);Check(SoloParkNative::Playing(Players[0])==0 && PlayingCalls==2);
        Put(Players[0],0xcb0+0x118,2);
        Put(Info,0x11c,0);SetLastError(73);SoloParkNative::Start(Players[0],Info);Check(StartCalls==1 && GetLastError()==73);
        Put(Info,0x11c,2);Put(Info,0xb8,Ids[1]);SoloParkNative::Start(Players[0],Info);Check(StartCalls==1);
        Put(Info,0xb8,Ids[3]);Put(Info,0xb6*sizeof(uint32_t),uint64_t(0x5678));Put(Info,0x340,R.Match);
        SetLastError(73);SoloParkNative::Start(Players[0],Info);Check(StartCalls==1 && GetLastError()==73);
        Put(Info,0xb6*sizeof(uint32_t),R.Match);Put(Info,0x340,uint64_t(0xabcdef));Put(Containers[3],0x28,static_cast<void*>(nullptr));SoloParkNative::Start(Players[0],Info);Check(StartCalls==1);
        Put(Object,0xa0,Ids[3]);Result=nullptr;Check(SoloParkNative::Generate(Players[0],Rosters[0],Object)==nullptr && !SoloParkNative::Created[2]);
        SoloParkNative::RevokeNetwork();SetLastError(73);
        SoloParkNative::Start(Players[0],Info);Check(StartCalls==1 && GetLastError()==73);
        Put(Info,0xb6*sizeof(uint32_t),uint64_t(0x5678));SoloParkNative::Start(Players[0],Info);Check(StartCalls==1);
        memset(Info+0x48,0,40);memset(Info+0xb0,0,40);SetLastError(73);
        SoloParkNative::Start(Players[0],Info);Check(StartCalls==2 && GetLastError()==92);
        R.Cpu[2]=R.Cpu[0];Check(!ArmRequest(R));Check(!SoloParkNative::LoadRequest(Loaded));
        SoloParkNative::Install(nullptr); // invalid executable: no hooks installed
        puts("SoloParkNative: native argument/return/error preservation, complete 2v2 validation, empty/duplicate/missing roster refusal and normal-match passthrough passed");return 0;
    } catch (const std::exception& E) { fprintf(stderr,"%s\n",E.what());return 1; }
}
