// Shared login discovery and HTTP resources; feature protocols own their connections.
#pragma once
#include <windows.h>
#include <winhttp.h>
#include <cstdint>
#include <mutex>
#include <string>

namespace GameSessionDiscovery
{
struct InternetHandle
{
    HINTERNET Value = nullptr;
    ~InternetHandle() { if (Value) WinHttpCloseHandle(Value); }
    InternetHandle() = default;
    explicit InternetHandle(HINTERNET V) : Value(V) {}
    InternetHandle(const InternetHandle&) = delete;
    InternetHandle& operator=(const InternetHandle&) = delete;
};
struct SessionData
{
    std::wstring Session;
    INTERNET_PORT Port = 0;
    uint64_t Generation = 1, Scene = 1;
    bool InWorld = false;
};
inline std::mutex Mutex;
inline SessionData State;
inline void (*OnChanged)() = nullptr;
inline SessionData Snapshot()
{
    std::lock_guard<std::mutex> Lock(Mutex); return State;
}
inline bool Current(const SessionData& C)
{
    // Caller holds Mutex. Ignore replies from an earlier login or world transition.
    return C.Generation == State.Generation && C.Scene == State.Scene && C.InWorld == State.InWorld &&
        C.Port == State.Port && C.Session == State.Session;
}
inline void ResetLogin(uint64_t Generation)
{
    std::lock_guard<std::mutex> Lock(Mutex);
    State = SessionData{}; State.Generation = Generation;
    if (OnChanged) OnChanged();
}
inline uint64_t BeginWorld()
{
    std::lock_guard<std::mutex> Lock(Mutex);
    State.InWorld = false; ++State.Scene;
    if (OnChanged) OnChanged();
    return State.Scene;
}
inline void ObserveResponse(HINTERNET Request, uint64_t Generation, uint64_t Scene)
{
    try
    {
        DWORD Status = 0, Size = sizeof(Status);
        if (!WinHttpQueryHeaders(Request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            WINHTTP_HEADER_NAME_BY_INDEX, &Status, &Size, WINHTTP_NO_HEADER_INDEX) || Status != 200) return;
        wchar_t Session[32]{}, Port[8]{};
        Size = sizeof(Session);
        if (!WinHttpQueryHeaders(Request, WINHTTP_QUERY_CUSTOM, L"X-Granite-Native-Session",
            Session, &Size, WINHTTP_NO_HEADER_INDEX)) return;
        Size = sizeof(Port);
        if (!WinHttpQueryHeaders(Request, WINHTTP_QUERY_CUSTOM, L"X-Granite-Native-Port",
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
        std::lock_guard<std::mutex> Lock(Mutex);
        if (Generation != State.Generation) return;
        if (State.Session != Key || State.Port != PortValue)
        {
            State.Session = Key; State.Port = static_cast<INTERNET_PORT>(PortValue);
            if (OnChanged) OnChanged();
        }
        if (Scene && Scene == State.Scene) State.InWorld = true;
    }
    catch (...) { /* Optional control discovery must not change the game's HTTP close. */ }
}
} // namespace GameSessionDiscovery
