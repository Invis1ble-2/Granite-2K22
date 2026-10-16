#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <array>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>
enum class LogLevel { Info, Error };
unsigned InfoLogs = 0, ErrorLogs = 0;
void Log(LogLevel Level, const std::wstring&) { if (Level == LogLevel::Info) ++InfoLogs; else ++ErrorLogs; }
#include "../ContentSeasons.h"

unsigned Checks = 0, Loads = 0;
void Check(bool Ok) { ++Checks; if (!Ok) throw std::runtime_error("assertion failed"); }
template<class T> T At(const void* Data, size_t Offset)
{
    T Value{}; memcpy(&Value, static_cast<const unsigned char*>(Data) + Offset, sizeof(Value)); return Value;
}
void __fastcall NativeLoad(void* Data)
{
    ++Loads;
    LONG Disabled = 0; int64_t Empty = 0;
    memcpy(static_cast<unsigned char*>(Data) + ContentSeasons::EnabledOffset, &Disabled, sizeof(Disabled));
    memcpy(static_cast<unsigned char*>(Data) + ContentSeasons::TimeOffset, &Empty, sizeof(Empty));
}
int main()
{
    unsigned char* Image = nullptr;
    try
    {
        alignas(8) std::array<unsigned char, 0x240> Data, Other;
        Data.fill(0xa5); Other.fill(0xa5);
        auto Expected = Data;
        const LONG Enabled = 1;
        memcpy(Expected.data() + ContentSeasons::EnabledOffset, &Enabled, sizeof(Enabled));
        memcpy(Expected.data() + ContentSeasons::TimeOffset, &ContentSeasons::ReferenceTime, sizeof(int64_t));
        ContentSeasons::Apply(Data.data());
        Check(Data == Expected); // schedule, padding and surrounding fields are untouched
        Check(At<int64_t>(Data.data(), 0x178) == 212524300800000LL);
        ContentSeasons::Apply(Data.data()); Check(Data == Expected);
        ContentSeasons::SeasonData = Data.data(); ContentSeasons::OriginalLoad = NativeLoad;
        ContentSeasons::Load(Data.data()); Check(Loads == 1 && Data == Expected);
        ContentSeasons::Load(Data.data()); Check(Loads == 2 && Data == Expected);
        ContentSeasons::Load(Other.data()); Check(Loads == 3);
        auto OtherExpected = Expected;
        NativeLoad(OtherExpected.data());
        Check(Other == OtherExpected); // an unrelated instance keeps the native result
        Check(ContentSeasons::DataWritable(Data.data()));
        Check(!ContentSeasons::DataWritable(nullptr));

        // Isolated virtual image, never game memory. Commit only fixture pages.
        Image = static_cast<unsigned char*>(VirtualAlloc(nullptr, ContentSeasons::DataRva + 0x1000,
            MEM_RESERVE, PAGE_NOACCESS));
        Check(Image != nullptr);
        for (const auto& S : ContentSeasons::Signatures)
        {
            auto* Page = Image + (S.Rva & ~size_t(0xfff));
            Check(VirtualAlloc(Page, 0x1000, MEM_COMMIT, PAGE_READWRITE) == Page);
            memcpy(Image + S.Rva, S.Bytes, S.Size);
        }
        size_t Failed = 0;
        const auto Module = reinterpret_cast<HMODULE>(Image);
        Check(ContentSeasons::CheckSignatures(Module, Failed));
        for (const auto& S : ContentSeasons::Signatures)
        {
            Image[S.Rva] ^= 1;
            Check(!ContentSeasons::CheckSignatures(Module, Failed) && Failed == S.Rva);
            Image[S.Rva] ^= 1;
        }
        Check(ContentSeasons::CheckSignatures(Module, Failed));
        Check(!ContentSeasons::CheckSignatures(nullptr, Failed));
        DWORD Previous = 0;
        auto* Page = Image + (ContentSeasons::Signatures[0].Rva & ~size_t(0xfff));
        Check(VirtualProtect(Page, 0x1000, PAGE_NOACCESS, &Previous));
        Check(!ContentSeasons::CheckSignatures(Module, Failed));
        Check(VirtualProtect(Page, 0x1000, Previous, &Previous));
        Check(!ContentSeasons::DataWritable(Image + ContentSeasons::DataRva));
        auto* DataPage = Image + (ContentSeasons::DataRva & ~size_t(0xfff));
        Check(VirtualAlloc(DataPage, 0x1000, MEM_COMMIT, PAGE_READWRITE) == DataPage);
        Check(ContentSeasons::DataWritable(Image + ContentSeasons::DataRva));
        Check(!ContentSeasons::DataWritable(DataPage + 0xff0)); // fields would cross the committed region
        Check(VirtualProtect(DataPage, 0x1000, PAGE_READONLY, &Previous));
        Check(!ContentSeasons::DataWritable(Image + ContentSeasons::DataRva));
        Check(!ContentSeasons::InstallHooks(Module));
        Check(ErrorLogs == 1); // failures stay visible with status logging disabled
        // Exercise real MinHook installation on fixture code, never execute it.
        Check(VirtualProtect(DataPage, 0x1000, PAGE_READWRITE, &Previous));
        Check(VirtualProtect(Page, 0x1000, PAGE_EXECUTE_READWRITE, &Previous));
        Check(MH_Initialize() == MH_OK);
        auto* FixtureData = Image + ContentSeasons::DataRva;
        memset(FixtureData, 0, Data.size());
        auto* Target = Image + ContentSeasons::LoadRva;
        Check(!ModuleConfig::LogContentSeasons);
        Check(ContentSeasons::InstallHooks(Module));
        Check(At<LONG>(FixtureData, 0x170) == 0 && At<int64_t>(FixtureData, 0x178) == 0);
        Check(InfoLogs == 0);
        Check(MH_DisableHook(Target) == MH_OK && MH_RemoveHook(Target) == MH_OK);
        // Late injection: keep all initialized data except the two local fields.
        memcpy(FixtureData, Other.data(), Other.size());
        const int64_t InitializedTime = 212500000000000LL;
        memcpy(FixtureData + 0x80, &InitializedTime, sizeof(InitializedTime));
        auto LateExpected = Other;
        memcpy(LateExpected.data() + 0x80, &InitializedTime, sizeof(InitializedTime));
        memcpy(LateExpected.data() + 0x170, &Enabled, sizeof(Enabled));
        memcpy(LateExpected.data() + 0x178, &ContentSeasons::ReferenceTime, sizeof(int64_t));
        ModuleConfig::LogContentSeasons = true;
        Check(ContentSeasons::InstallHooks(Module));
        Check(memcmp(FixtureData, LateExpected.data(), LateExpected.size()) == 0);
        Check(InfoLogs == 1);
        Check(MH_DisableHook(Target) == MH_OK && MH_RemoveHook(Target) == MH_OK);
        Check(MH_Uninitialize() == MH_OK);
        VirtualFree(Image, 0, MEM_RELEASE);
        printf("ContentSeasonsTests: %u checks passed (no game/network access).\n", Checks);
        return 0;
    }
    catch (const std::exception& E)
    {
        if (Image) VirtualFree(Image, 0, MEM_RELEASE);
        fprintf(stderr, "ContentSeasonsTests failed at check %u: %s\n", Checks, E.what());
        return 1;
    }
}
