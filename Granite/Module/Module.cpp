// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>
#include <winhttp.h>
#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <atomic>
#include <cstdint>
#include <sstream>
#include <cstdio>
#include <cstring>
#include <cwctype>
#include <mutex>
#include <string>
#include <unordered_set>
#include <unordered_map>
#include <memory>
#include <vector>
#include <intrin.h>

#include "BadgeSync.h"

#include "CrashHandler.h"
#include "ModuleConfig.h"
#include "MinHook/include/MinHook.h"

#pragma comment(lib, "MinHook/lib/libMinHook.x64.lib")

namespace
{
// Set once after configuration is loaded, before hooks and workers start.
const wchar_t* RedirectHost = L"127.0.0.1";
INTERNET_PORT RedirectPort = 21000;

namespace GameSessionDiscovery
{
inline void ResetLogin(uint64_t Generation);
inline uint64_t BeginWorld();
inline void ObserveResponse(HINTERNET Request, uint64_t Generation, uint64_t Scene);
}

using WinHttpConnectFn = HINTERNET(WINAPI*)(HINTERNET, LPCWSTR, INTERNET_PORT, DWORD);
using WinHttpOpenRequestFn = HINTERNET(WINAPI*)(HINTERNET, LPCWSTR, LPCWSTR, LPCWSTR, LPCWSTR, LPCWSTR const*, DWORD);
using WinHttpSendRequestFn = BOOL(WINAPI*)(HINTERNET, LPCWSTR, DWORD, LPVOID, DWORD, DWORD, DWORD_PTR);
using WinHttpCloseHandleFn = BOOL(WINAPI*)(HINTERNET);
using WinHttpWriteDataFn = BOOL(WINAPI*)(HINTERNET, LPCVOID, DWORD, LPDWORD);

WinHttpConnectFn OriginalConnect = nullptr;
WinHttpOpenRequestFn OriginalOpenRequest = nullptr;
WinHttpSendRequestFn OriginalSendRequest = nullptr;
WinHttpCloseHandleFn OriginalCloseHandle = nullptr;
WinHttpWriteDataFn OriginalWriteData = nullptr;

std::mutex HandlesMutex;
std::unordered_set<HINTERNET> RedirectedConnections;
std::unordered_set<HINTERNET> RedirectedRequests;
std::unordered_set<HINTERNET> LoginRequests;
std::unordered_set<HINTERNET> BadgeRequests;
struct NativeRequest { uint64_t Generation = 0, Scene = 0; };
std::unordered_map<HINTERNET, NativeRequest> NativeRequests;
uint64_t NativeLoginGeneration = 1;
// WinHTTP may retain lpOptional until response completion; keep storage until close.
std::unordered_map<HINTERNET, std::shared_ptr<std::vector<unsigned char>>> BadgeRequestBodies;
struct PendingBadgeRequest
{
    std::wstring Headers;
    DWORD TotalLength;
    DWORD_PTR Context;
    std::vector<unsigned char> Body;
};
std::unordered_map<HINTERNET, std::shared_ptr<PendingBadgeRequest>> PendingBadgeRequests;
std::wstring IdentityTicket;
HMODULE SelfModule = nullptr;
std::atomic_bool PriceSyncInProgress = false;
std::mutex LogMutex;
HANDLE LogFile = INVALID_HANDLE_VALUE;
wchar_t LogPath[MAX_PATH * 2] = {};

enum class LogLevel
{
    Info,
    Verbose,
    Error
};

void Log(LogLevel Level, const std::wstring& Message, bool DetailsEnabled = ModuleConfig::LogModule)
{
    // Errors always bypass category toggles, for every output destination.
    if (Level != LogLevel::Error)
    {
        if (Message.starts_with(L"SOLO22")) DetailsEnabled = ModuleConfig::LogSoloPark;
        else if (Message.starts_with(L"PARK22")) DetailsEnabled = ModuleConfig::LogNativePark;
        else if (Message.starts_with(L"FPS22")) DetailsEnabled = ModuleConfig::LogOnlineFrameRate;
        else if (Message.starts_with(L"PROGRESSION22")) DetailsEnabled = ModuleConfig::LogCareerProgression;
        else if (Message.starts_with(L"ANIM22")) DetailsEnabled = ModuleConfig::LogAnimationUnlock;
        if (!DetailsEnabled) return;
    }
    const wchar_t Symbol = Level == LogLevel::Info ? L'@' : Level == LogLevel::Verbose ? L'~' : L'!';
    const WORD Colour = Level == LogLevel::Info      ? FOREGROUND_GREEN | FOREGROUND_INTENSITY
                        : Level == LogLevel::Verbose ? FOREGROUND_RED | FOREGROUND_GREEN | FOREGROUND_INTENSITY
                                                     : FOREGROUND_RED | FOREGROUND_INTENSITY;
    const std::wstring Line = std::wstring(1, Symbol) + L" " + Message + L"\n";
    OutputDebugStringW(Line.c_str());
    if (ModuleConfig::EnableCrashHandler) CrashHandler::RecordLogLine(Line.c_str(), Line.size());
    const HANDLE Output = GetStdHandle(Level == LogLevel::Error ? STD_ERROR_HANDLE : STD_OUTPUT_HANDLE);
    if (ModuleConfig::EnableConsole && Output && Output != INVALID_HANDLE_VALUE)
    {
        CONSOLE_SCREEN_BUFFER_INFO Previous{};
        const BOOL HasPrevious = GetConsoleScreenBufferInfo(Output, &Previous);
        SetConsoleTextAttribute(Output, Colour);
        DWORD Written = 0;
        WriteConsoleW(Output, Line.data(), static_cast<DWORD>(Line.size()), &Written, nullptr);
        if (HasPrevious) SetConsoleTextAttribute(Output, Previous.wAttributes);
    }

    std::scoped_lock Lock(LogMutex);
    if (ModuleConfig::EnableFileLogging && LogFile != INVALID_HANDLE_VALUE)
    {
        const int Bytes =
            WideCharToMultiByte(CP_UTF8, 0, Line.c_str(), static_cast<int>(Line.size()), nullptr, 0, nullptr, nullptr);
        if (Bytes > 0)
        {
            std::string Utf8(static_cast<size_t>(Bytes), '\0');
            WideCharToMultiByte(CP_UTF8, 0, Line.c_str(), static_cast<int>(Line.size()), Utf8.data(), Bytes, nullptr,
                                nullptr);
            DWORD Wrote = 0;
            WriteFile(LogFile, Utf8.data(), static_cast<DWORD>(Utf8.size()), &Wrote, nullptr);
            FlushFileBuffers(LogFile);
        }
    }
}

void LogHttp(LogLevel Level, const std::wstring& Message)
{
    Log(Level, Message, ModuleConfig::LogHttp);
}

void LogPrice(LogLevel Level, const std::wstring& Message)
{
    Log(Level, Message, ModuleConfig::LogAttributePrice);
}

void LogBadges(LogLevel Level, const std::wstring& Message)
{
    Log(Level, Message, ModuleConfig::LogBadgeBudget);
}

std::wstring ModuleDirectory()
{
    wchar_t Path[MAX_PATH] = {};
    const DWORD Length = GetModuleFileNameW(SelfModule, Path, MAX_PATH);
    if (Length == 0 || Length >= MAX_PATH) return L".";
    std::wstring Full(Path, Length);
    const size_t Slash = Full.find_last_of(L"\\/");
    return Slash == std::wstring::npos ? L"." : Full.substr(0, Slash);
}

void OpenLogFile()
{
    if (!ModuleConfig::EnableFileLogging) return;
    const std::wstring Directory = ModuleDirectory() + L"\\console logs";
    CreateDirectoryW(Directory.c_str(), nullptr);

    SYSTEMTIME Now{};
    GetLocalTime(&Now);
    wchar_t Name[64] = {};
    swprintf_s(Name, L"\\granite-%04u%02u%02u-%02u%02u%02u.log", Now.wYear, Now.wMonth, Now.wDay, Now.wHour,
               Now.wMinute, Now.wSecond);

    const std::wstring File = Directory + Name;
    wcsncpy_s(LogPath, File.c_str(), _TRUNCATE);
    const HANDLE Handle = CreateFileW(File.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                                      OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (Handle == INVALID_HANDLE_VALUE)
    {
        OutputDebugStringW(L"! Granite could not open a console-logs file\n");
        return;
    }

    LARGE_INTEGER Size{};
    if (GetFileSizeEx(Handle, &Size) && Size.QuadPart == 0)
    {
        const unsigned char Bom[3] = {0xEF, 0xBB, 0xBF};
        DWORD Wrote = 0;
        WriteFile(Handle, Bom, sizeof(Bom), &Wrote, nullptr);
    }

    std::scoped_lock Lock(LogMutex);
    LogFile = Handle;
}

bool EnsureConsole()
{
    if (!ModuleConfig::EnableConsole) return false;
    if (!GetConsoleWindow() && !AllocConsole())
    {
        OutputDebugStringW(L"! Granite could not allocate a logging console\n");
        return false;
    }

    SetConsoleTitleW(L"NBA2K Granite Hook Module");

    FILE* Stream = nullptr;
    if (freopen_s(&Stream, "CONOUT$", "w", stdout) != 0)
        OutputDebugStringW(L"! Granite could not bind stdout to CONOUT$\n");
    if (freopen_s(&Stream, "CONOUT$", "w", stderr) != 0)
        OutputDebugStringW(L"! Granite could not bind stderr to CONOUT$\n");
    if (freopen_s(&Stream, "CONIN$", "r", stdin) != 0)
        OutputDebugStringW(L"! Granite could not bind stdin to CONIN$\n");
    return true;
}

std::wstring Lower(std::wstring Value)
{
    std::transform(Value.begin(), Value.end(), Value.begin(),
                   [](wchar_t Value) { return static_cast<wchar_t>(std::towlower(Value)); });
    return Value;
}

bool IsTwoKHost(LPCWSTR Host)
{
    if (!Host || !*Host) return false;
    const std::wstring LowerHost = Lower(Host);
    return LowerHost.find(L"2ksports.com") != std::wstring::npos || LowerHost.find(L"2k.com") != std::wstring::npos;
}

bool IsRedirectedConnection(HINTERNET Handle)
{
    std::scoped_lock Lock(HandlesMutex);
    return RedirectedConnections.contains(Handle);
}

bool IsRedirectedRequest(HINTERNET Handle)
{
    std::scoped_lock Lock(HandlesMutex);
    return RedirectedRequests.contains(Handle);
}

HINTERNET WINAPI ConnectHook(HINTERNET Session, LPCWSTR ServerName, INTERNET_PORT Port, DWORD Reserved)
{
    const bool Redirect = IsTwoKHost(ServerName);
    HINTERNET Result =
        OriginalConnect(Session, Redirect ? RedirectHost : ServerName, Redirect ? RedirectPort : Port, Reserved);
    if (Redirect && Result)
    {
        std::scoped_lock Lock(HandlesMutex);
        RedirectedConnections.insert(Result);
    }
    if (Redirect)
    {
        LogHttp(LogLevel::Info, L"redirect " + std::wstring(ServerName) + L":" + std::to_wstring(Port) + L" -> " +
                                RedirectHost + L":" + std::to_wstring(RedirectPort));
    }
    return Result;
}

HINTERNET WINAPI OpenRequestHook(HINTERNET Connection, LPCWSTR Verb, LPCWSTR ObjectName, LPCWSTR Version,
                                 LPCWSTR Referrer, LPCWSTR const* AcceptTypes, DWORD Flags)
{
    HINTERNET Request = OriginalOpenRequest(Connection, Verb, ObjectName, Version, Referrer, AcceptTypes, Flags);
    const DWORD RequestError = GetLastError();
    if (Request && IsRedirectedConnection(Connection))
    {
        std::scoped_lock Lock(HandlesMutex);
        RedirectedRequests.insert(Request);
        const std::wstring Object = Lower(ObjectName ? ObjectName : L"");
        if (Object.find(L"/session/login") != std::wstring::npos) LoginRequests.insert(Request);
        const size_t Query = Object.find(L'?');
        const std::wstring Path = Object.substr(0, Query);
        if (Path.ends_with(L"/session/login") || Path.ends_with(L"/session/destroy"))
        {
            GameSessionDiscovery::ResetLogin(++NativeLoginGeneration);
        }
        uint64_t Scene = 0;
        if (Path.ends_with(L"/world/connect")) Scene = GameSessionDiscovery::BeginWorld();
        else if (Path.ends_with(L"/world/disconnect")) GameSessionDiscovery::BeginWorld();
        NativeRequests[Request] = { NativeLoginGeneration, Scene };
        // Classify attribute requests for logging even when budget reporting is disabled.
        if (Path.ends_with(L"/mycareer/attributes/get")) BadgeRequests.insert(Request);
    }
    if (IsRedirectedConnection(Connection))
    {
        LogHttp(LogLevel::Info, L">> HTTP Request: " + std::wstring(Verb ? Verb : L"GET") + L" " + (ObjectName ? ObjectName : L"/"));
    }
    SetLastError(RequestError);
    return Request;
}

void BufferBadgeStream(HINTERNET Request, LPCWSTR Headers, DWORD HeadersLength, DWORD TotalLength, DWORD_PTR Context)
{
    auto Pending = std::make_shared<PendingBadgeRequest>();
    if (Headers) Pending->Headers.assign(Headers,
        HeadersLength == static_cast<DWORD>(-1) ? wcslen(Headers) : HeadersLength);
    Pending->TotalLength = TotalLength;
    Pending->Context = Context;
    Pending->Body.reserve(TotalLength);
    {
        std::scoped_lock Lock(HandlesMutex);
        PendingBadgeRequests[Request] = Pending;
    }
    LogBadges(LogLevel::Info, L"badge budget report buffering WinHttpWriteData body bytes=" + std::to_wstring(TotalLength));
}

BOOL WINAPI SendRequestHook(HINTERNET Request, LPCWSTR Headers, DWORD HeadersLength, LPVOID Optional,
                            DWORD OptionalLength, DWORD TotalLength, DWORD_PTR Context)
{
    bool BadgeRequest = false;
    {
        std::scoped_lock Lock(HandlesMutex);
        BadgeRequest = BadgeRequests.contains(Request);
    }
    const bool LogDetails = !BadgeRequest || ModuleConfig::LogBadgeBudget;
    if (IsRedirectedRequest(Request))
    {
        if (LogDetails && Headers && HeadersLength > 0)
        {
            LogHttp(LogLevel::Verbose, L"   Headers: " + std::wstring(Headers, HeadersLength == static_cast<DWORD>(-1) ? wcslen(Headers) : HeadersLength));
        }
        if (LogDetails && Optional && OptionalLength > 0)
        {
            LogHttp(LogLevel::Info, L"   Body bytes: " + std::to_wstring(OptionalLength));
        }

        DWORD Security = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_CN_INVALID |
                         SECURITY_FLAG_IGNORE_CERT_DATE_INVALID | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
        if (!WinHttpSetOption(Request, WINHTTP_OPTION_SECURITY_FLAGS, &Security, sizeof(Security)))
        {
            Log(LogLevel::Error, L"WinHttpSetOption security flags failed: " + std::to_wstring(GetLastError()));
        }
        bool LoginRequest = false;
        {
            std::scoped_lock Lock(HandlesMutex);
            LoginRequest = LoginRequests.contains(Request);
        }
        if (LoginRequest && !IdentityTicket.empty())
        {
            const std::wstring IdentityHeader = L"X-Celestial-Ticket: " + IdentityTicket + L"\r\n";
            if (!WinHttpAddRequestHeaders(Request, IdentityHeader.c_str(), static_cast<DWORD>(IdentityHeader.size()),
                                          WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE))
            {
                Log(LogLevel::Error,
                    L"could not attach the Celestial identity ticket: " + std::to_wstring(GetLastError()));
            }
            else
            {
                LogHttp(LogLevel::Verbose, L"attached verified identity to Session/login");
            }
        }
    }
    const bool ReportBadges = ModuleConfig::EnableBadgeBudgets && BadgeRequest;
    // Ghidra FUN_141f1a480 sends no optional body, then synchronously writes the
    // stream and receives the response. Buffer only this verified caller so we
    // can validate scope and replace lengths before any HTTP headers are sent.
    const auto Base = reinterpret_cast<uintptr_t>(GetModuleHandleW(nullptr));
    if (ReportBadges && !Optional && OptionalLength == 0 && TotalLength >= 16 &&
        TotalLength <= 65536 && TotalLength % 16 == 0 &&
        reinterpret_cast<uintptr_t>(_ReturnAddress()) == Base + 0x1f1a967)
    {
        BufferBadgeStream(Request, Headers, HeadersLength, TotalLength, Context);
        return TRUE;
    }
    if (ReportBadges && OptionalLength != TotalLength)
        LogBadges(LogLevel::Info, L"badge budget report deferred: unsupported stream caller RVA=" +
            std::to_wstring(reinterpret_cast<uintptr_t>(_ReturnAddress()) - Base) +
            L" optional=" + std::to_wstring(OptionalLength) + L" total=" + std::to_wstring(TotalLength));
    if (ReportBadges && OptionalLength == TotalLength)
    {
        uint64_t SaveId = 0, Slot = 0;
        BadgeSync::Snapshot Snapshot{};
        const wchar_t* Failure = L"request field list/scope invalid";
        if (BadgeSync::RequestScope(Optional, OptionalLength, SaveId, Slot) &&
            BadgeSync::ReadSnapshot(SaveId, Slot, Snapshot, Failure))
        {
            auto Body = std::make_shared<std::vector<unsigned char>>(BadgeSync::Encode(Optional, OptionalLength, Snapshot));
            std::wstring CleanHeaders;
            const std::wstring Existing = Headers ? std::wstring(Headers,
                HeadersLength == static_cast<DWORD>(-1) ? wcslen(Headers) : HeadersLength) : L"";
            for (size_t Start = 0; Start < Existing.size();)
            {
                const size_t End = Existing.find(L'\n', Start);
                const std::wstring Line = Existing.substr(Start, End == std::wstring::npos ? End : End - Start + 1);
                const std::wstring Name = Lower(Line.substr(0, Line.find(L':')));
                if (Name != L"vcfieldlist_size" && Name != L"vcfieldlist-size" && Name != L"content-length")
                    CleanHeaders += Line;
                if (End == std::wstring::npos) break;
                Start = End + 1;
            }
            const std::wstring Sizes = L"VCFIELDLIST_SIZE: " + std::to_wstring(Body->size()) +
                L"\r\nContent-Length: " + std::to_wstring(Body->size()) + L"\r\n";
            if (WinHttpAddRequestHeaders(Request, Sizes.c_str(), static_cast<DWORD>(Sizes.size()),
                WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE))
            {
                {
                    std::scoped_lock Lock(HandlesMutex);
                    BadgeRequestBodies[Request] = Body;
                }
                LogBadges(LogLevel::Info, L"badge budget report slot=" + std::to_wstring(Slot) + L" points=" +
                    std::to_wstring(Snapshot.Caps[0]) + L"/" + std::to_wstring(Snapshot.Caps[1]) + L"/" +
                    std::to_wstring(Snapshot.Caps[2]) + L"/" + std::to_wstring(Snapshot.Caps[3]));
                return OriginalSendRequest(Request, CleanHeaders.empty() ? nullptr : CleanHeaders.c_str(),
                    static_cast<DWORD>(CleanHeaders.size()), Body->data(), static_cast<DWORD>(Body->size()),
                    static_cast<DWORD>(Body->size()), Context);
            }
            Failure = L"request size headers could not be replaced";
        }
        LogBadges(LogLevel::Info, L"badge budget report deferred: " + std::wstring(Failure) +
            L" requested save=" + std::to_wstring(SaveId) + L" slot=" + std::to_wstring(Slot) +
            L" native save=" + std::to_wstring(Snapshot.SaveId) + L" slot=" + std::to_wstring(Snapshot.Slot));
    }
    return OriginalSendRequest(Request, Headers, HeadersLength, Optional, OptionalLength, TotalLength, Context);
}

BOOL WINAPI WriteDataHook(HINTERNET Request, LPCVOID Buffer, DWORD Length, LPDWORD Written)
{
    if (!ModuleConfig::EnableBadgeBudgets) return OriginalWriteData(Request, Buffer, Length, Written);
    std::shared_ptr<PendingBadgeRequest> Pending;
    {
        std::scoped_lock Lock(HandlesMutex);
        const auto It = PendingBadgeRequests.find(Request);
        if (It != PendingBadgeRequests.end()) Pending = It->second;
    }
    if (!Pending) return OriginalWriteData(Request, Buffer, Length, Written);
    // The verified game transport supplies a bytes-written pointer and writes
    // serially. Do not silently accept an incompatible/overlong write.
    if (!Written || (!Buffer && Length) || Length > Pending->TotalLength - Pending->Body.size())
    {
        if (Written) *Written = 0;
        SetLastError(ERROR_INVALID_PARAMETER);
        return FALSE;
    }
    if (Length)
    {
        const auto* Bytes = static_cast<const unsigned char*>(Buffer);
        Pending->Body.insert(Pending->Body.end(), Bytes, Bytes + Length);
    }
    if (Pending->Body.size() < Pending->TotalLength)
    {
        *Written = Length;
        return TRUE;
    }
    auto Body = std::make_shared<std::vector<unsigned char>>(std::move(Pending->Body));
    {
        std::scoped_lock Lock(HandlesMutex);
        PendingBadgeRequests.erase(Request);
        BadgeRequestBodies[Request] = Body; // retain even when native snapshot is deferred
    }
    const BOOL Result = SendRequestHook(Request, Pending->Headers.empty() ? nullptr : Pending->Headers.c_str(),
        static_cast<DWORD>(Pending->Headers.size()), Body->data(), static_cast<DWORD>(Body->size()),
        static_cast<DWORD>(Body->size()), Pending->Context);
    *Written = Result ? Length : 0; // game stream accounting uses its original byte count
    return Result;
}

BOOL WINAPI CloseHandleHook(HINTERNET Handle)
{
    const DWORD EntryError = GetLastError();
    NativeRequest Observed;
    {
        std::scoped_lock Lock(HandlesMutex);
        const auto It = NativeRequests.find(Handle);
        if (It != NativeRequests.end()) { Observed = It->second; NativeRequests.erase(It); }
        RedirectedRequests.erase(Handle);
        RedirectedConnections.erase(Handle);
        LoginRequests.erase(Handle);
        BadgeRequests.erase(Handle);
        BadgeRequestBodies.erase(Handle);
        PendingBadgeRequests.erase(Handle);
    }
    // Headers are available here even when the game used asynchronous WinHTTP.
    // Observe only requests made through the existing Granite redirect.
    if (Observed.Generation) GameSessionDiscovery::ObserveResponse(Handle, Observed.Generation, Observed.Scene);
    SetLastError(EntryError);
    return OriginalCloseHandle(Handle);
}

template <typename Function>
bool PatchImport(HMODULE Module, const char* ImportedModule, const char* FunctionName, Function Replacement,
                 Function& Original)
{
    if (!Module) return false;
    auto* Base = reinterpret_cast<unsigned char*>(Module);
    auto* Dos = reinterpret_cast<IMAGE_DOS_HEADER*>(Base);
    if (Dos->e_magic != IMAGE_DOS_SIGNATURE) return false;
    auto* Nt = reinterpret_cast<IMAGE_NT_HEADERS*>(Base + Dos->e_lfanew);
    if (Nt->Signature != IMAGE_NT_SIGNATURE) return false;
    const auto Directory = Nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
    if (!Directory.VirtualAddress || !Directory.Size) return false;

    auto* Descriptor = reinterpret_cast<IMAGE_IMPORT_DESCRIPTOR*>(Base + Directory.VirtualAddress);
    for (; Descriptor->Name; ++Descriptor)
    {
        const char* Name = reinterpret_cast<const char*>(Base + Descriptor->Name);
        if (_stricmp(Name, ImportedModule) != 0) continue;
        auto* Thunk = reinterpret_cast<IMAGE_THUNK_DATA*>(Base + Descriptor->FirstThunk);
        auto* Lookup = Descriptor->OriginalFirstThunk
                           ? reinterpret_cast<IMAGE_THUNK_DATA*>(Base + Descriptor->OriginalFirstThunk)
                           : Thunk;
        for (; Lookup->u1.AddressOfData; ++Lookup, ++Thunk)
        {
            if (IMAGE_SNAP_BY_ORDINAL(Lookup->u1.Ordinal)) continue;
            auto* Import = reinterpret_cast<IMAGE_IMPORT_BY_NAME*>(Base + Lookup->u1.AddressOfData);
            if (std::strcmp(reinterpret_cast<const char*>(Import->Name), FunctionName) != 0) continue;
            auto** Slot = reinterpret_cast<void**>(&Thunk->u1.Function);
            DWORD Protection = 0;
            if (!VirtualProtect(Slot, sizeof(void*), PAGE_READWRITE, &Protection)) return false;
            Original = reinterpret_cast<Function>(*Slot);
            *Slot = reinterpret_cast<void*>(Replacement);
            FlushInstructionCache(GetCurrentProcess(), Slot, sizeof(void*));
            DWORD Ignored = 0;
            VirtualProtect(Slot, sizeof(void*), Protection, &Ignored);
            return Original != nullptr;
        }
    }
    return false;
}

constexpr DWORD DefaultAttributePriceBase = 100;
constexpr DWORD DefaultAttributePriceStep = 25;
constexpr int AttributeCount = 24;
constexpr int MaxAttributeLevel = 75;

// The job factory returns an internal result code.  Returning void here left
// RAX undefined when the hook was entered, so the caller could discard the
// otherwise valid price state immediately after the hook returned.
using CreateAndSendRequestFn = DWORD (*)(void*);
CreateAndSendRequestFn OriginalCreateAndSendRequest = nullptr;

void PopulateCareerPrices(DWORD BasePrice, DWORD StepPrice, void* JobContext)
{
    HMODULE Executable = GetModuleHandleW(nullptr);
    if (!Executable) return;
    auto* BaseAddr = reinterpret_cast<unsigned char*>(Executable);
    auto* StatePtr = reinterpret_cast<DWORD*>(BaseAddr + 0x5280980);

    // Populate prices for 24 attributes x 75 levels
    for (int Attr = 0; Attr < AttributeCount; ++Attr)
    {
        for (int Lvl = 1; Lvl <= MaxAttributeLevel; ++Lvl)
        {
            DWORD UnitPrice = BasePrice + (static_cast<DWORD>(Lvl) - 1) * StepPrice;
            uintptr_t Offset = static_cast<uintptr_t>((Attr * MaxAttributeLevel + Lvl) * 8);
            *reinterpret_cast<DWORD*>(reinterpret_cast<unsigned char*>(StatePtr) + Offset) = UnitPrice;     // VC
            *reinterpret_cast<DWORD*>(reinterpret_cast<unsigned char*>(StatePtr) + Offset - 4) = UnitPrice; // SP
        }
    }

    // Set state machine to READY (2)
    *StatePtr = 2;

    // Do not write through JobContext here.  Its layout is build-specific and
    // the CE proof only changes the global state and price matrix above.
    // The caller observes the same state through StatePtr.
    (void)JobContext;
}

void FetchAndApplyServerPrices(void* JobContext)
{
    bool Expected = false;
    if (!PriceSyncInProgress.compare_exchange_strong(Expected, true)) return;
    struct SyncGuard
    {
        ~SyncGuard() { PriceSyncInProgress.store(false); }
    } Guard;

    DWORD ResolvedBase = DefaultAttributePriceBase;
    DWORD ResolvedStep = DefaultAttributePriceStep;

    // Connect to Granite server to get authoritative direct prices
    HINTERNET Session = WinHttpOpen(L"Granite-DirectConnect/1.0", WINHTTP_ACCESS_TYPE_NO_PROXY,
                                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (Session)
    {
        HINTERNET Connection = WinHttpConnect(Session, RedirectHost, RedirectPort, 0);
        if (Connection)
        {
            // Granite is an HTTPS server on port 21000.  The game-side
            // redirect keeps the secure request flag; this direct request
            // must do the same or WinHTTP sends clear-text HTTP to a TLS
            // socket and the server never sees it.
            HINTERNET Request = WinHttpOpenRequest(Connection, L"GET",
                                                   L"/nba/2k19/MyCareer/Attributes/direct_price",
                                                   nullptr, nullptr,
                                                   WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE);
            if (Request)
            {
                DWORD Security = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_CN_INVALID |
                                 SECURITY_FLAG_IGNORE_CERT_DATE_INVALID | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
                WinHttpSetOption(Request, WINHTTP_OPTION_SECURITY_FLAGS, &Security, sizeof(Security));
                WinHttpSetTimeouts(Request, 3000, 3000, 3000, 3000);

                if (WinHttpSendRequest(Request, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                       WINHTTP_NO_REQUEST_DATA, 0, 0, 0) &&
                    WinHttpReceiveResponse(Request, nullptr))
                {
                    DWORD StatusCode = 0;
                    DWORD StatusSize = sizeof(StatusCode);
                    if (WinHttpQueryHeaders(Request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                                            WINHTTP_HEADER_NAME_BY_INDEX, &StatusCode, &StatusSize,
                                            WINHTTP_NO_HEADER_INDEX) &&
                        StatusCode == 200)
                    {
                        std::string ResponseBody;
                        DWORD BytesAvailable = 0;
                        while (WinHttpQueryDataAvailable(Request, &BytesAvailable) && BytesAvailable > 0)
                        {
                            std::string Chunk(BytesAvailable, '\0');
                            DWORD ReadBytes = 0;
                            if (WinHttpReadData(Request, Chunk.data(), BytesAvailable, &ReadBytes) && ReadBytes > 0)
                            {
                                ResponseBody.append(Chunk.data(), ReadBytes);
                            }
                        }

                        // Parse basePrice and stepPrice from JSON response
                        auto FindNumber = [&](const std::string& Key) -> DWORD {
                            size_t Pos = ResponseBody.find("\"" + Key + "\":");
                            if (Pos == std::string::npos) Pos = ResponseBody.find("\"" + Key + "\" :");
                            if (Pos == std::string::npos) return 0;
                            size_t Colon = ResponseBody.find(':', Pos);
                            if (Colon == std::string::npos) return 0;
                            size_t Start = ResponseBody.find_first_not_of(" \t", Colon + 1);
                            if (Start == std::string::npos) return 0;
                            size_t End = ResponseBody.find_first_of(",}\r\n ", Start);
                            std::string ValStr = ResponseBody.substr(Start, End == std::string::npos ? std::string::npos : End - Start);
                            try { return static_cast<DWORD>(std::stoul(ValStr)); } catch (...) { return 0; }
                        };

                        DWORD SvrBase = FindNumber("basePrice");
                        DWORD SvrStep = FindNumber("stepPrice");
                        if (SvrBase > 0) ResolvedBase = SvrBase;
                        if (SvrStep > 0) ResolvedStep = SvrStep;
                        LogPrice(LogLevel::Info, L"Received authoritative attribute price parameters from Granite server: base=" +
                                                std::to_wstring(ResolvedBase) + L", step=" + std::to_wstring(ResolvedStep));
                    }
                }
                else
                {
                    LogPrice(LogLevel::Error, L"direct attribute price request failed: " +
                                            std::to_wstring(GetLastError()));
                }
                WinHttpCloseHandle(Request);
            }
            else
            {
                LogPrice(LogLevel::Error, L"could not create direct attribute price request: " +
                                        std::to_wstring(GetLastError()));
            }
            WinHttpCloseHandle(Connection);
        }
        else
        {
            LogPrice(LogLevel::Error, L"could not connect to Granite direct price endpoint: " +
                                    std::to_wstring(GetLastError()));
        }
        WinHttpCloseHandle(Session);
    }
    else
    {
        LogPrice(LogLevel::Error, L"could not open WinHTTP session for direct attribute prices: " +
                                std::to_wstring(GetLastError()));
    }

    PopulateCareerPrices(ResolvedBase, ResolvedStep, JobContext);
    LogPrice(LogLevel::Info, L"Career attribute prices direct-connected! State set to 2 (READY).");
}

DWORD HookedCreateAndSendRequest(void* JobContext)
{
    LogPrice(LogLevel::Info, L">> Intercepted CareerUpgrades_CreateAndSendRequest (0x5f5950). Synchronizing directly with Granite server...");
    FetchAndApplyServerPrices(JobContext);
    return 0;
}

DWORD WINAPI CareerPriceWatchdog(void*)
{
    HMODULE Executable = GetModuleHandleW(nullptr);
    if (!Executable) return 0;
    auto* BaseAddr = reinterpret_cast<unsigned char*>(Executable);
    volatile auto* StatePtr = reinterpret_cast<volatile DWORD*>(BaseAddr + 0x5280980);

    while (true)
    {
        Sleep(200);
        DWORD CurrentState = *StatePtr;
        // State 0 is the initial value used by the online path before its
        // service lookup completes.  That lookup can fail before WinHTTP is
        // reached on this 2K22 build, so include 0 as well as pending/failed
        // states.  This is the same state/matrix transition proven by the CE
        // script and leaves no dependency on the missing price request.
        if (CurrentState == 0 || CurrentState == 1 || CurrentState == 3)
        {
            LogPrice(LogLevel::Info, L"Watchdog detected attribute price state=" + std::to_wstring(CurrentState) +
                                    L", synchronizing from Granite server...");
            FetchAndApplyServerPrices(nullptr);
        }
    }
    return 0;
}

#include "OnlineMatchFrameRateHooks.h"
#include "GameSessionDiscovery.h"
#include "OnlineFrameRateClient.h"
#include "MatchLifecycleHooks.h"
#include "MyCourt2v2Fix.h"
#include "ParkCpu.h"
#include "AnimationUnlock.h"
#include "CareerProgressionSync.h"
#if defined(GRANITE_SOLO_CPU_TRACE)
#include "SoloCpuTrace22.h"
#endif

DWORD WINAPI Initialise(void*)
{
    const auto Directory = ModuleDirectory();
    const bool ConfigSaved = ModuleConfig::Load(Directory);
    RedirectHost = ModuleConfig::ServerHost.c_str();
    RedirectPort = ModuleConfig::ServerPort;
    EnsureConsole();
    OpenLogFile();
    Log(LogLevel::Info, L"Granite module 0x00010226 initialized; configuration: " + Directory + L"\\Granite.ini");
    if (!ConfigSaved) Log(LogLevel::Error, L"Granite.ini could not be created or accessed; missing settings use defaults");
    if (ModuleConfig::EnableCrashHandler)
        CrashHandler::Install([](const wchar_t* Text) { Log(LogLevel::Error, Text); },
                              (Directory + L"\\console logs").c_str(), LogPath, SelfModule);
    DWORD TicketLength = GetEnvironmentVariableW(L"CELESTIAL_IDENTITY_TICKET", nullptr, 0);
    if (TicketLength > 1 && TicketLength < 8192)
    {
        std::wstring Ticket(TicketLength, L'\0');
        const DWORD Copied = GetEnvironmentVariableW(L"CELESTIAL_IDENTITY_TICKET", Ticket.data(), TicketLength);
        if (Copied > 0 && Copied < TicketLength)
        {
            Ticket.resize(Copied);
            IdentityTicket = std::move(Ticket);
            SetEnvironmentVariableW(L"CELESTIAL_IDENTITY_TICKET", nullptr);
            Log(LogLevel::Verbose, L"Celestial identity ticket loaded");
        }
    }
    HMODULE Executable = GetModuleHandleW(nullptr);
    GameSessionDiscovery::OnChanged = [] {
        ParkCpu::Multiplayer::Revoke(); ParkCpu::Solo::RevokeNetwork();
        OnlineMatchFrameRateHooks::ClearLogin();
    };
    const bool Connect = PatchImport(Executable, "WINHTTP.dll", "WinHttpConnect", ConnectHook, OriginalConnect);
    const bool Open =
        PatchImport(Executable, "WINHTTP.dll", "WinHttpOpenRequest", OpenRequestHook, OriginalOpenRequest);
    const bool Send =
        PatchImport(Executable, "WINHTTP.dll", "WinHttpSendRequest", SendRequestHook, OriginalSendRequest);
    const bool Close =
        PatchImport(Executable, "WINHTTP.dll", "WinHttpCloseHandle", CloseHandleHook, OriginalCloseHandle);
    const bool Write = !ModuleConfig::EnableBadgeBudgets ||
        PatchImport(Executable, "WINHTTP.dll", "WinHttpWriteData", WriteDataHook, OriginalWriteData);

    if (ModuleConfig::EnableBadgeBudgets)
        LogBadges(LogLevel::Info, L"Native system clock retained; career badge budgets attach to Attributes/get requests");

    // Install CareerUpgrades_CreateAndSendRequest Hook via MinHook
    MH_STATUS MhStatus = MH_Initialize();
    if (MhStatus == MH_OK || MhStatus == MH_ERROR_ALREADY_INITIALIZED)
    {
        MatchLifecycleHooks::BeforeStart = OnlineMatchFrameRateHooks::ObserveMatch;
        OnlineMatchFrameRateHooks::Install(Executable);
        if (GetModuleHandleW(L"NBA2K22.exe") == Executable) OnlineFrameRateClient::Start();
        MyCourt2v2Fix::Install();
        MatchLifecycleHooks::OnReady = &ParkCpu::Install;
        MatchLifecycleHooks::Install(Executable);
        AnimationUnlock::Install(Executable);
        CareerProgressionSync::Install(Executable);
#if defined(GRANITE_SOLO_CPU_TRACE)
        SoloCpuTrace22::Install(Executable);
#endif
        if (ModuleConfig::EnablePriceWatchdog)
        {
            void* Target = reinterpret_cast<void*>(reinterpret_cast<unsigned char*>(Executable) + 0x5f5950);
            MH_STATUS HookStatus = MH_CreateHook(Target, reinterpret_cast<void*>(&HookedCreateAndSendRequest),
                                                 reinterpret_cast<void**>(&OriginalCreateAndSendRequest));
            if (HookStatus == MH_OK)
            {
                HookStatus = MH_EnableHook(Target);
                if (HookStatus == MH_OK)
                    LogPrice(LogLevel::Info, L"Career attribute price direct-connect hook installed at 0x5f5950");
                else
                {
                    MH_RemoveHook(Target);
                    LogPrice(LogLevel::Error, L"Failed to enable hook at 0x5f5950: " + std::to_wstring(HookStatus));
                }
            }
            else
            {
                LogPrice(LogLevel::Error, L"Failed to create hook at 0x5f5950: " + std::to_wstring(HookStatus));
            }
        }
    }
    else
    {
        Log(LogLevel::Error, L"MinHook initialize failed: " + std::to_wstring(MhStatus));
    }

    // Start background watchdog thread for seamless attribute price state management
    if (ModuleConfig::EnablePriceWatchdog)
    {
        if (HANDLE WatchdogThread = CreateThread(nullptr, 0, CareerPriceWatchdog, nullptr, 0, nullptr))
        {
            CloseHandle(WatchdogThread);
            LogPrice(LogLevel::Info, L"Career attribute price watchdog thread started");
        }
        else
        {
            LogPrice(LogLevel::Error, L"Career attribute price watchdog thread failed: " + std::to_wstring(GetLastError()));
        }
    }

    if (Connect && Open && Send && Close && Write)
    {
        LogHttp(LogLevel::Info,
            L"NBA2K WinHTTP redirect active at " + std::wstring(RedirectHost) + L":" + std::to_wstring(RedirectPort));
        return 0;
    }
    Log(LogLevel::Error,
        L"could not install every WinHTTP import hook; this NBA2K build may use delay imports or a different transport");
    return 1;
}
}

extern "C" __declspec(dllexport) unsigned int GraniteModuleVersion()
{
    return ParkCpu::ModuleVersion;
}

extern "C" __declspec(dllexport) void CALLBACK GraniteCrashWatchW(HWND, HINSTANCE, LPWSTR CommandLine, int)
{
    CrashHandler::WatchMain(CommandLine);
}

BOOL APIENTRY DllMain(HMODULE Module, DWORD Reason, LPVOID)
{
    if (Reason == DLL_PROCESS_ATTACH)
    {
        SelfModule = Module;
        DisableThreadLibraryCalls(Module);
        wchar_t Host[MAX_PATH] = {};
        GetModuleFileNameW(nullptr, Host, MAX_PATH);
        const wchar_t* HostName = wcsrchr(Host, L'\\');
        if (_wcsicmp(HostName ? HostName + 1 : Host, L"rundll32.exe") == 0) return TRUE;
        if (HANDLE Thread = CreateThread(nullptr, 0, Initialise, nullptr, 0, nullptr)) CloseHandle(Thread);
    }
    return TRUE;
}
