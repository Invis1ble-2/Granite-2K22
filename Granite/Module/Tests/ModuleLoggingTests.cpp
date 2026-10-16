#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

unsigned Checks = 0, Errors = 0, FilterCalls = 0;
std::vector<std::wstring> Messages;
enum class LogLevel { Info, Error };
void Log(LogLevel Level, const std::wstring& Text)
{
    if (Level == LogLevel::Error) ++Errors;
    Messages.push_back(Text);
}
#include "../AnimationUnlock.h"
#include "../CrashHandler.h"

void Check(bool Ok) { ++Checks; if (!Ok) throw std::runtime_error("assertion failed"); }
void Sink(const wchar_t* Text) { Messages.emplace_back(Text); }
LONG WINAPI FilterA(EXCEPTION_POINTERS*) { return EXCEPTION_CONTINUE_SEARCH; }
LONG WINAPI FilterB(EXCEPTION_POINTERS*) { return EXCEPTION_EXECUTE_HANDLER; }
LPTOP_LEVEL_EXCEPTION_FILTER LastFilter = nullptr;
LPTOP_LEVEL_EXCEPTION_FILTER WINAPI SetFilter(LPTOP_LEVEL_EXCEPTION_FILTER Filter)
{
    ++FilterCalls;
    LastFilter = Filter;
    return nullptr;
}

int wmain(int Argc, wchar_t** Argv)
{
    std::wstring Directory, Ini;
    unsigned char* Image = nullptr;
    try
    {
        Check(Argc == 2); // An unused directory inside the caller's scratch directory.
        Directory = Argv[1];
        Check(CreateDirectoryW(Directory.c_str(), nullptr) != FALSE);
        Ini = Directory + L"\\Granite.ini";
        struct Toggle { const wchar_t* Key; bool* Value; };
        const Toggle Toggles[] = {
            {L"LogContentSeasons", &ModuleConfig::LogContentSeasons},
            {L"LogAnimationUnlock", &ModuleConfig::LogAnimationUnlock},
        };
        Check(!ModuleConfig::LogContentSeasons && !ModuleConfig::LogAnimationUnlock);
        Check(ModuleConfig::Load(Directory));
        Check(ModuleConfig::ReadToggle(L"Logging", L"LogCrashHandler", true, Ini)); // obsolete key is not generated
        Check(WritePrivateProfileStringW(L"Logging", L"LogCrashHandler", L"1", Ini.c_str()) != FALSE);
        for (const auto& T : Toggles)
        {
            Check(!*T.Value);
            Check(!ModuleConfig::ReadToggle(L"Logging", T.Key, true, Ini)); // generated key, not just fallback
            Check(WritePrivateProfileStringW(L"Logging", T.Key, L"1", Ini.c_str()) != FALSE);
        }
        Check(WritePrivateProfileStringW(L"Features", L"EnableAnimationUnlockAll", L"1", Ini.c_str()) != FALSE);
        Check(ModuleConfig::Load(Directory));
        for (const auto& T : Toggles) Check(*T.Value);
        Check(ModuleConfig::EnableAnimationUnlockAll); // existing INI was not overwritten
        Check(WritePrivateProfileStringW(L"Logging", L"LogContentSeasons", L"0", Ini.c_str()) != FALSE);
        Check(ModuleConfig::Load(Directory));
        Check(!ModuleConfig::LogContentSeasons && ModuleConfig::LogAnimationUnlock);
        for (const auto& T : Toggles)
            Check(WritePrivateProfileStringW(L"Logging", T.Key, L"invalid", Ini.c_str()) != FALSE);
        Check(ModuleConfig::Load(Directory));
        for (const auto& T : Toggles) Check(!*T.Value);
        for (const auto& T : Toggles)
        {
            *T.Value = true;
            Check(WritePrivateProfileStringW(L"Logging", T.Key, nullptr, Ini.c_str()) != FALSE);
        }
        Check(ModuleConfig::Load(Directory));
        for (const auto& T : Toggles) Check(!*T.Value); // old INI: missing keys are quiet
        Check(ModuleConfig::EnableCrashHandler && ModuleConfig::EnableAnimationUnlockAll);

        // Fake API forwarding only: no OS exception handler or watcher is installed.
        CrashHandler::Sink = Sink;
        CrashHandler::SetFilterOriginal = SetFilter;
        CrashHandler::ChainedFilter = FilterA;
        Check(CrashHandler::SetFilterHook(FilterB) == FilterA);
        Check(FilterCalls == 1 && LastFilter == CrashHandler::UnhandledFilter);
        Check(CrashHandler::ChainedFilter == FilterB && Messages.empty());
        Check(CrashHandler::SetFilterHook(FilterA) == FilterB);
        Check(FilterCalls == 2 && LastFilter == CrashHandler::UnhandledFilter);
        Check(CrashHandler::ChainedFilter == FilterA && Messages.empty()); // even a legacy INI key cannot restore it
        CrashHandler::Say(L"test error"); // error/report output remains independent
        Check(Messages.size() == 1 && Messages.back() == L"test error");
        Check(CrashHandler::SetFilterHook(CrashHandler::UnhandledFilter) == nullptr);
        Check(FilterCalls == 3 && CrashHandler::ChainedFilter == FilterA && Messages.size() == 1);

        // Native-shaped fixture code: install/remove hooks, never execute the code.
        Image = static_cast<unsigned char*>(VirtualAlloc(nullptr, 0x526b000, MEM_RESERVE, PAGE_NOACCESS));
        Check(Image != nullptr);
        for (size_t I = 0; I < 3; ++I)
        {
            const auto& S = AnimationUnlock::Sites[I];
            auto* Page = Image + (S.Rva & ~size_t(0xfff));
            Check(VirtualAlloc(Page, 0x1000, MEM_COMMIT, PAGE_EXECUTE_READWRITE) == Page);
            memcpy(Image + S.Rva, S.Bytes, S.Size);
        }
        Check(MH_Initialize() == MH_OK);
        ModuleConfig::EnableAnimationShopAll = true;
        ModuleConfig::EnableAnimationRequirementBypass = true;
        ModuleConfig::EnableAnimationUnlockAll = true;
        Messages.clear();
        for (bool Enabled : {false, true})
        {
            ModuleConfig::LogAnimationUnlock = Enabled;
            AnimationUnlock::InstallHooks(reinterpret_cast<HMODULE>(Image));
            Check(Errors == 0);
            Check(Messages.size() == (Enabled ? 1u : 0u));
            if (Enabled) Check(Messages.back().find(L"ANIM22 enabled: shop-all=1 requirements-bypass=1 unlock-all=1") == 0);
            ModuleConfig::LogAnimationUnlock = false;
            AnimationUnlock::InstallHooks(reinterpret_cast<HMODULE>(Image)); // already hooked => error, not hidden
            Check(Errors == 1);
            Check(Messages.back().find(L"ANIM22 hook installation failed") == 0);
            for (size_t I = 0; I < 3; ++I)
                Check(MH_DisableHook(Image + AnimationUnlock::Sites[I].Rva) == MH_OK &&
                      MH_RemoveHook(Image + AnimationUnlock::Sites[I].Rva) == MH_OK);
            Errors = 0;
            Messages.clear();
        }
        Check(MH_Uninitialize() == MH_OK);
        Check(VirtualFree(Image, 0, MEM_RELEASE) != FALSE);
        Image = nullptr;
        Check(DeleteFileW(Ini.c_str()) != FALSE);
        Check(RemoveDirectoryW(Directory.c_str()) != FALSE);
        printf("ModuleLoggingTests: %u checks passed (no game/network access).\n", Checks);
        return 0;
    }
    catch (const std::exception& E)
    {
        if (Image) VirtualFree(Image, 0, MEM_RELEASE);
        if (!Ini.empty()) DeleteFileW(Ini.c_str());
        if (!Ini.empty()) RemoveDirectoryW(Directory.c_str());
        fprintf(stderr, "ModuleLoggingTests failed at check %u: %s\n", Checks, E.what());
        return 1;
    }
}
