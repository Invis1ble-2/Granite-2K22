#pragma once
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <string>

namespace ModuleConfig
{
    // Loaded once before hooks and worker threads are installed.
    inline bool EnableCrashHandler = true;
    inline bool EnableParkRosterTrace = false;
    inline bool EnablePriceWatchdog = true;
    inline bool EnableBadgeBudgets = true;
    inline bool EnableAnimationShopAll = true;
    inline bool EnableAnimationRequirementBypass = true;
    inline bool EnableAnimationUnlockAll = false;

    // Logging & Output toggles
    inline bool EnableFileLogging = true;
    inline bool EnableConsole = true;

    inline bool LogSoloPark = false;
    inline bool LogParkRosterTrace = false;
    inline bool LogAttributePrice = false;
    inline bool LogBadgeBudget = false;
    inline bool LogContentSeasons = false;
    inline bool LogAnimationUnlock = false;

    // UTF-16LE lets the Windows profile API read comments and Unicode paths.
    // CREATE_NEW preserves existing settings, including concurrent creation.
    inline bool EnsureIni(const std::wstring& Path)
    {
        const HANDLE File = CreateFileW(Path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr,
            CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (File == INVALID_HANDLE_VALUE)
        {
            if (GetLastError() != ERROR_FILE_EXISTS) return false;
            const DWORD Attributes = GetFileAttributesW(Path.c_str());
            return Attributes != INVALID_FILE_ATTRIBUTES && !(Attributes & FILE_ATTRIBUTE_DIRECTORY);
        }
        constexpr wchar_t Defaults[] =
            L"\xFEFF; Granite Module settings: 1 = enabled, 0 = disabled.\r\n"
            L"; Keep beside Module.dll. Changes apply on the next game launch.\r\n"
            L"; Crash reports are controlled separately from .log output.\r\n\r\n"
            L"[Features]\r\n"
            L"; Crash capture and minidumps\r\nEnableCrashHandler = 1\r\n\r\n"
            L"; Optional native park roster diagnostics\r\nEnableParkRosterTrace = 0\r\n\r\n"
            L"; Career attribute direct prices and watchdog\r\nEnablePriceWatchdog = 1\r\n\r\n"
            L"; Career badge budget reporting\r\nEnableBadgeBudgets = 1\r\n\r\n"
            L"; Show all native animation shop candidates (season/exclusion/rule filters bypassed)\r\nEnableAnimationShopAll = 1\r\n\r\n"
            L"; Ignore animation height/attributes/progression requirements; normal purchases remain\r\nEnableAnimationRequirementBypass = 1\r\n\r\n"
            L"; Virtual ownership plus eligibility: equip animations without purchasing\r\nEnableAnimationUnlockAll = 0\r\n\r\n"
            L"[Logging]\r\n"
            L"; Write .log files in console logs\r\nEnableFileLogging = 1\r\n\r\n"
            L"; Allocate a console window and print to it\r\nEnableConsole = 1\r\n\r\n"
            L"; Solo park validation and generated roster messages\r\nLogSoloPark = 0\r\n\r\n"
            L"; Native roster messages and memory dumps\r\nLogParkRosterTrace = 0\r\n\r\n"
            L"; Attribute price synchronization and watchdog messages\r\nLogAttributePrice = 0\r\n\r\n"
            L"; Badge budget buffering and reporting messages\r\nLogBadgeBudget = 0\r\n\r\n"
            L"; Content-season reference setup status (not a feature toggle)\r\nLogContentSeasons = 0\r\n\r\n"
            L"; Animation hook setup status (not a feature toggle)\r\nLogAnimationUnlock = 0\r\n";
        constexpr DWORD Size = static_cast<DWORD>(sizeof(Defaults) - sizeof(wchar_t));
        DWORD Written = 0;
        const bool Saved = WriteFile(File, Defaults, Size, &Written, nullptr) && Written == Size;
        CloseHandle(File);
        if (!Saved) DeleteFileW(Path.c_str());
        return Saved;
    }

    inline bool ReadToggle(const wchar_t* Section, const wchar_t* Key, bool Default,
                           const std::wstring& Path)
    {
        wchar_t Value[32]{};
        GetPrivateProfileStringW(Section, Key, L"", Value, static_cast<DWORD>(sizeof(Value) / sizeof(Value[0])),
                                 Path.c_str());
        std::wstring Text(Value);
        const size_t Start = Text.find_first_not_of(L" \t");
        if (Start == std::wstring::npos) return Default;
        Text = Text.substr(Start, Text.find_last_not_of(L" \t") - Start + 1);
        if (Text == L"1") return true;
        if (Text == L"0") return false;
        return Default;
    }

    inline bool Load(const std::wstring& ModuleDir)
    {
        const std::wstring Ini = ModuleDir + L"\\Granite.ini";
        const bool Saved = EnsureIni(Ini);

        // Features
        EnableCrashHandler    = ReadToggle(L"Features", L"EnableCrashHandler", true, Ini);
        EnableParkRosterTrace = ReadToggle(L"Features", L"EnableParkRosterTrace", false, Ini);
        EnablePriceWatchdog   = ReadToggle(L"Features", L"EnablePriceWatchdog", true, Ini);
        EnableBadgeBudgets    = ReadToggle(L"Features", L"EnableBadgeBudgets", true, Ini);
        EnableAnimationShopAll = ReadToggle(L"Features", L"EnableAnimationShopAll", true, Ini);
        EnableAnimationRequirementBypass = ReadToggle(L"Features", L"EnableAnimationRequirementBypass", true, Ini);
        EnableAnimationUnlockAll = ReadToggle(L"Features", L"EnableAnimationUnlockAll", false, Ini);

        // Logging & Output
        EnableFileLogging   = ReadToggle(L"Logging", L"EnableFileLogging", true, Ini);
        EnableConsole       = ReadToggle(L"Logging", L"EnableConsole", true, Ini);

        LogSoloPark         = ReadToggle(L"Logging", L"LogSoloPark", false, Ini);
        LogParkRosterTrace  = ReadToggle(L"Logging", L"LogParkRosterTrace", false, Ini);
        LogAttributePrice   = ReadToggle(L"Logging", L"LogAttributePrice", false, Ini);
        LogBadgeBudget      = ReadToggle(L"Logging", L"LogBadgeBudget", false, Ini);
        LogContentSeasons   = ReadToggle(L"Logging", L"LogContentSeasons", false, Ini);
        LogAnimationUnlock  = ReadToggle(L"Logging", L"LogAnimationUnlock", false, Ini);
        return Saved;
    }
}
