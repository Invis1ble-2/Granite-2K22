// NBA 2K22 timing negotiation, independent of CPU rosters and enabled only after World/connect.
#pragma once
#include "GameSessionDiscovery.h"
#include "OnlineMatchFrameRateHooks.h"

namespace OnlineFrameRateClient
{
using GameSessionDiscovery::InternetHandle;
struct Timing
{
    unsigned FrameRate = 0, BufferFrames = 0;
    uint64_t Epoch = 0;
    std::wstring Scene;
};
inline bool ReadTiming(HINTERNET Request, Timing& T)
{
    const auto Number = [Request](const wchar_t* Name, unsigned& Value)
    {
        wchar_t Text[8]{}; DWORD Size = sizeof(Text);
        if (!WinHttpQueryHeaders(Request, WINHTTP_QUERY_CUSTOM, Name, Text, &Size, WINHTTP_NO_HEADER_INDEX)) return false;
        Text[_countof(Text) - 1] = L'\0';
        if (!Text[0]) return false;
        Value = 0;
        for (const wchar_t C : std::wstring(Text))
        {
            if (C < L'0' || C > L'9' || Value > 1000) return false;
            Value = Value * 10 + static_cast<unsigned>(C - L'0');
        }
        return true;
    };
    wchar_t EpochText[24]{}, SceneText[128]{}; DWORD Size = sizeof(EpochText);
    if (!WinHttpQueryHeaders(Request, WINHTTP_QUERY_CUSTOM, L"X-Opal-Timing-Epoch",
        EpochText, &Size, WINHTTP_NO_HEADER_INDEX)) return false;
    Size = sizeof(SceneText);
    if (!WinHttpQueryHeaders(Request, WINHTTP_QUERY_CUSTOM, L"X-Opal-Timing-Scene",
        SceneText, &Size, WINHTTP_NO_HEADER_INDEX)) return false;
    EpochText[_countof(EpochText) - 1] = SceneText[_countof(SceneText) - 1] = L'\0';
    const std::wstring Epoch(EpochText); T.Scene = SceneText;
    if (Epoch.empty() || Epoch.size() > 16 || T.Scene.empty()) return false;
    T.Epoch = 0;
    for (const wchar_t C : Epoch)
    {
        const unsigned Digit = C >= L'0' && C <= L'9' ? static_cast<unsigned>(C - L'0') :
            C >= L'a' && C <= L'f' ? static_cast<unsigned>(C - L'a' + 10) : 16;
        if (Digit > 15) return false;
        T.Epoch = (T.Epoch << 4) | Digit;
    }
    for (const wchar_t C : T.Scene)
        if (!((C >= L'0' && C <= L'9') || (C >= L'a' && C <= L'z') ||
            (C >= L'A' && C <= L'Z') || C == L':' || C == L'-' || C == L'_')) return false;
    return T.Epoch && Number(L"X-Opal-Frame-Rate", T.FrameRate) && (T.FrameRate == 60 || T.FrameRate == 120) &&
        Number(L"X-Opal-Buffer-Frames", T.BufferFrames) && T.BufferFrames >= 1 && T.BufferFrames <= 49;
}
inline bool Poll(HINTERNET Connection, const GameSessionDiscovery::SessionData& C, Timing& Selected)
{
    InternetHandle Request(WinHttpOpenRequest(Connection, L"POST", L"/native-fps/v1/poll",
        nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE));
    if (!Request.Value) return false;
    DWORD Policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
    DWORD Security = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_CN_INVALID |
        SECURITY_FLAG_IGNORE_CERT_DATE_INVALID | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
    if (!WinHttpSetOption(Request.Value, WINHTTP_OPTION_REDIRECT_POLICY, &Policy, sizeof(Policy)) ||
        !WinHttpSetOption(Request.Value, WINHTTP_OPTION_SECURITY_FLAGS, &Security, sizeof(Security))) return false;
    std::wostringstream Epoch; Epoch << std::hex << Selected.Epoch;
    const std::wstring Headers = L"Content-Length: 0\r\nCache-Control: no-store\r\nX-Granite-Session: " + C.Session +
        L"\r\nX-Opal-Frame-Rate: " + std::to_wstring(Selected.FrameRate) +
        L"\r\nX-Opal-Buffer-Frames: " + std::to_wstring(Selected.BufferFrames) +
        L"\r\nX-Opal-Timing-Epoch: " + Epoch.str() + L"\r\nX-Opal-Timing-Scene: " + Selected.Scene + L"\r\n";
    if (!WinHttpSendRequest(Request.Value, Headers.c_str(), static_cast<DWORD>(Headers.size()),
        WINHTTP_NO_REQUEST_DATA, 0, 0, 0) || !WinHttpReceiveResponse(Request.Value, nullptr)) return false;
    DWORD Status = 0, Size = sizeof(Status);
    if (!WinHttpQueryHeaders(Request.Value, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX, &Status, &Size, WINHTTP_NO_HEADER_INDEX)) return false;
    std::lock_guard<std::mutex> Lock(GameSessionDiscovery::Mutex);
    if (!GameSessionDiscovery::Current(C)) return true;
    if (Status == 204)
    {
        Selected = {}; OnlineMatchFrameRateHooks::ClearLogin();
        return true; // No supported world is active; no configuration was published.
    }
    if (Status == 401 || Status == 409)
    { Selected = {}; OnlineMatchFrameRateHooks::ClearLogin(); return false; }
    if (Status != 200 && Status != 428) return false;
    Timing Received;
    if (!ReadTiming(Request.Value, Received)) return false;
    if (Status == 428)
    {
        OnlineMatchFrameRateHooks::VerifyServer(0, 0);
        if (!OnlineMatchFrameRateHooks::ConfigureServer(Received.FrameRate, Received.BufferFrames)) return false;
        Selected = Received;
        Log(LogLevel::Info, L"FPS22 entered online world; received Opal timing " + std::to_wstring(Selected.FrameRate) +
            L" Hz, buffer " + std::to_wstring(Selected.BufferFrames) + L" frames; awaiting acknowledgement");
        return true;
    }
    return Received.Epoch == Selected.Epoch && Received.Scene == Selected.Scene &&
        Received.FrameRate == Selected.FrameRate && Received.BufferFrames == Selected.BufferFrames &&
        OnlineMatchFrameRateHooks::VerifyServer(Received.FrameRate, Received.BufferFrames);
}
inline DWORD WINAPI Worker(void*)
{
    InternetHandle Session(WinHttpOpen(L"Granite-OnlineFrameRate/1", WINHTTP_ACCESS_TYPE_NO_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!Session.Value || !WinHttpSetTimeouts(Session.Value, 2000, 2000, 2000, 2000))
    { Log(LogLevel::Error, L"FPS22 control unavailable: HTTP session could not be created"); return 1; }
    GameSessionDiscovery::SessionData Previous;
    Timing Selected;
    ULONGLONG FailedSince = 0; bool ReportedFailure = false;
    for (;;)
    {
        const auto C = GameSessionDiscovery::Snapshot();
        if (C.Generation != Previous.Generation || C.Scene != Previous.Scene || C.InWorld != Previous.InWorld ||
            C.Session != Previous.Session || C.Port != Previous.Port)
        { Previous = C; Selected = {}; FailedSince = 0; ReportedFailure = false; }
        if (!C.InWorld || C.Session.empty() || !C.Port || !OnlineMatchFrameRateHooks::Ready) { Sleep(500); continue; }
        bool Ok = false;
        try
        {
            InternetHandle Connection(WinHttpConnect(Session.Value, RedirectHost, C.Port, 0));
            if (Connection.Value) Ok = Poll(Connection.Value, C, Selected);
        }
        catch (...) { Ok = false; }
        if (!Ok)
        {
            std::lock_guard<std::mutex> Lock(GameSessionDiscovery::Mutex);
            if (GameSessionDiscovery::Current(C)) OnlineMatchFrameRateHooks::VerifyServer(0, 0);
            const auto Now = GetTickCount64();
            if (!FailedSince) FailedSince = Now;
            else if (!ReportedFailure && Now - FailedSince >= 8000)
            {
                Log(LogLevel::Error, L"FPS22 independent control unavailable for at least 8 seconds; online timing is unconfirmed");
                ReportedFailure = true;
            }
        }
        else { FailedSince = 0; ReportedFailure = false; }
        Sleep(Ok ? 1000 : 1500);
    }
}
inline void Start()
{
    if (!OriginalConnect || !OriginalOpenRequest || !OriginalCloseHandle)
    { Log(LogLevel::Error, L"FPS22 independent control disabled: HTTP discovery unavailable"); return; }
    if (HANDLE Thread = CreateThread(nullptr, 0, Worker, nullptr, 0, nullptr)) CloseHandle(Thread);
    else Log(LogLevel::Error, L"FPS22 independent control worker could not start");
}
} // namespace OnlineFrameRateClient
