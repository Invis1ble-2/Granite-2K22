// Exercise the actual SendRequestHook/WriteDataHook with a mock native snapshot
// and mock transport. WinHTTP request/header operations use real local handles;
// no network connection or game process is required.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define ReadSnapshot UnusedNativeSnapshot
#include "../BadgeSync.h"
#undef ReadSnapshot
#include <cassert>
static bool SnapshotReady = true;
namespace BadgeSync {
inline bool ReadSnapshot(uint64_t Save, uint64_t Slot, Snapshot& Data, const wchar_t*& Failure)
{
    Failure = L"mock career not ready";
    if (!SnapshotReady) return false;
    Data = {};
    Data.SaveId = Save; Data.Slot = Slot;
    const unsigned Caps[] = {10,9,10,7};
    for (int I = 0; I < 4; ++I) { Data.Caps[I] = Caps[I]; Data.Points[I] = 100000; }
    for (auto& Value : Data.Potentials) Value = 1000000;
    for (int I = 0; I < 99; ++I) { Data.Names[I] = 1000 + I; Data.Levels[I] = LevelCrcs[0]; }
    return true;
}
}
#include "../Module.cpp"
static std::vector<unsigned char> Sent;
static unsigned SendCalls = 0, WriteCalls = 0;
static bool FailSend = false;
static DWORD_PTR SentContext = 0;
BOOL WINAPI MockSend(HINTERNET Request, LPCWSTR Headers, DWORD HeaderLength, LPVOID Body,
                     DWORD Length, DWORD Total, DWORD_PTR Context)
{
    ++SendCalls;
    assert(Length == Total);
    Sent.assign(static_cast<unsigned char*>(Body), static_cast<unsigned char*>(Body) + Length);
    SentContext = Context;
    if (Headers && HeaderLength) assert(std::wstring(Headers, HeaderLength).find(L"X-Test: yes") != std::wstring::npos);
    if (Length > 96)
    {
        wchar_t Size[32] = {}; DWORD Bytes = sizeof(Size);
        assert(WinHttpQueryHeaders(Request, WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_REQUEST_HEADERS,
            WINHTTP_HEADER_NAME_BY_INDEX, Size, &Bytes, WINHTTP_NO_HEADER_INDEX));
        assert(std::stoul(Size) == Length);
        Bytes = sizeof(Size);
        assert(WinHttpQueryHeaders(Request, WINHTTP_QUERY_CUSTOM | WINHTTP_QUERY_FLAG_REQUEST_HEADERS,
            L"VCFIELDLIST_SIZE", Size, &Bytes, WINHTTP_NO_HEADER_INDEX));
        assert(std::stoul(Size) == Length);
    }
    if (FailSend) { SetLastError(ERROR_CONNECTION_ABORTED); return FALSE; }
    return TRUE;
}
BOOL WINAPI MockWrite(HINTERNET, LPCVOID, DWORD Length, LPDWORD Written)
{ ++WriteCalls; if (Written) *Written = Length; return TRUE; }
BOOL WINAPI MockClose(HINTERNET Handle) { return WinHttpCloseHandle(Handle); }

int main(int argc, char** argv)
{
    auto Session = WinHttpOpen(L"BadgeStreamTest", WINHTTP_ACCESS_TYPE_NO_PROXY, nullptr, nullptr, 0);
    auto Connection = WinHttpConnect(Session, L"127.0.0.1", 21000, 0);
    auto Request = WinHttpOpenRequest(Connection, L"POST", L"/nba/2k19/MyCareer/Attributes/get", nullptr, nullptr, nullptr, 0);
    assert(Session && Connection && Request);
    OriginalSendRequest = MockSend; OriginalWriteData = MockWrite; OriginalCloseHandle = MockClose;
    BadgeRequests.insert(Request);
    std::vector<unsigned char> Body;
    BadgeSync::Field(Body, 0x1c5741a9, 7); BadgeSync::Field(Body, 0x34dc552e, 202240048);
    BadgeSync::Field(Body, 0x4f63c5c3, 15627617611795252437ULL);
    BadgeSync::Field(Body, 0x5eeda966, 2); BadgeSync::Field(Body, 0xd5e5f21d, 0);
    Body.resize(Body.size()+16, 0);
    assert(Body.size() == 96);
    const wchar_t* Headers = L"VCFIELDLIST_SIZE: 96\r\nContent-Length: 96\r\nX-Test: yes\r\n";
    BufferBadgeStream(Request, Headers, static_cast<DWORD>(-1), 96, 123);
    DWORD Written = 0;
    assert(WriteDataHook(Request, Body.data(), 32, &Written) && Written == 32 && SendCalls == 0);
    assert(WriteDataHook(Request, Body.data()+32, 64, &Written) && Written == 64 && SendCalls == 1);
    assert(Sent.size() == 96+235*16 && SentContext == 123 && WriteCalls == 0);
    assert(memcmp(Sent.data(), Body.data(), 80) == 0);
    assert(BadgeSync::Read32(Sent.data()+80) == BadgeSync::Version);
    assert(PendingBadgeRequests.empty() && BadgeRequestBodies[Request]->size() == Sent.size());
    if (argc == 2) {
        FILE* File = nullptr; assert(fopen_s(&File, argv[1], "wb") == 0 && File);
        assert(fwrite(Sent.data(), 1, Sent.size(), File) == Sent.size()); fclose(File);
    }
    SnapshotReady = false;
    BufferBadgeStream(Request, nullptr, 0, 96, 124);
    assert(WriteDataHook(Request, Body.data(), 96, &Written) && Written == 96);
    assert(Sent == Body && SentContext == 124); // original request survives unavailable native state
    BufferBadgeStream(Request, nullptr, 0, 96, 125);
    assert(!WriteDataHook(Request, Body.data(), 97, &Written) && Written == 0);
    assert(!WriteDataHook(Request, Body.data(), 96, nullptr));
    FailSend = true;
    assert(!WriteDataHook(Request, Body.data(), 96, &Written) && Written == 0);
    assert(GetLastError() == ERROR_CONNECTION_ABORTED);
    assert(PendingBadgeRequests.empty());
    FailSend = false;
    assert(WriteDataHook(Connection, Body.data(), 96, &Written) && Written == 96 && WriteCalls == 1);
    BufferBadgeStream(Request, nullptr, 0, 96, 126);
    assert(CloseHandleHook(Request));
    assert(PendingBadgeRequests.empty() && BadgeRequestBodies.empty() && BadgeRequests.empty());
    WinHttpCloseHandle(Connection); WinHttpCloseHandle(Session);
    puts("Badge stream hooks: fragmented write, headers, byte accounting, native fallback, failure and close passed");
}
