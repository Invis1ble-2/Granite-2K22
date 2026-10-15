// NBA2K22 animation shop visibility, eligibility and virtual ownership.
#pragma once
#include <atomic>
#include <cstdint>
#include <cstring>
#include <string>
#include "ModuleConfig.h"
#include "MinHook/include/MinHook.h"

namespace AnimationUnlock
{
// NBA2K22.exe.unpacked.exe, image base 0x140000000.
// SHA256: 14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0
// FUN_1406EE500 -> FUN_14068BBE0 builds the animation shop list.
// FUN_1411D71C0 / FUN_1411FF130 share the ownership/eligibility predicates.
// Keep the native candidate groups, order, price requests and purchase flow.
using FilterFn = uint64_t(__fastcall*)(void*, uint32_t, uint32_t);
using EligibilityFn = uint64_t(__fastcall*)(void*, void*, const int*);
using OwnershipFn = uint8_t(__fastcall*)(void*);
inline FilterFn OriginalFilter = nullptr;
inline EligibilityFn OriginalEligibility = nullptr;
inline OwnershipFn OriginalOwnership = nullptr;
inline void* ShopObject = nullptr;
inline std::atomic_bool InstallStarted = false;

inline uint64_t __fastcall Filter(void* Shop, uint32_t Category, uint32_t Index)
{
    if (ModuleConfig::EnableAnimationShopAll && Shop == ShopObject && Category < 63 && Index != UINT32_MAX)
    {
        // FUN_14068BBE0's zero-index mask distinguishes "none" placeholders from
        // genuine index-0 items (including shooting/dribbling categories).
        // Category 63 is the custom-animation path and retains its native logic.
        constexpr uint64_t HiddenZero = 0x0e000004000003f3ULL;
        return Index != 0 || ((HiddenZero >> Category) & 1) == 0 ? 1 : 0;
    }
    return OriginalFilter(Shop, Category, Index);
}

inline uint64_t __fastcall Eligibility(void* Animation, void* Player, const int* Level)
{
    // UnlockAll must work on its own, even when the separate purchase bypass is off.
    if (ModuleConfig::EnableAnimationRequirementBypass || ModuleConfig::EnableAnimationUnlockAll) return 1;
    return OriginalEligibility(Animation, Player, Level);
}

inline uint8_t __fastcall Ownership(void* Animation)
{
    return ModuleConfig::EnableAnimationUnlockAll ? 1 : OriginalOwnership(Animation);
}

struct Site
{
    size_t Rva;
    const char* Bytes;
    size_t Size;
    void* Detour;
    void** Original;
};
inline const Site Sites[] = {
    {0x68bbe0, "\x48\x89\x5c\x24\x08\x55\x56\x57\x48\x81\xec\x80\x00\x00\x00\x48\x63\xf2\x33\xff\x49\x63\xd8\xbd\x01\x00\x00\x00\x83\xfe\x03\x0f", 32,
        reinterpret_cast<void*>(&Filter), reinterpret_cast<void**>(&OriginalFilter)},
    {0x12011d0, "\x48\x89\x5c\x24\x10\x48\x89\x6c\x24\x18\x48\x89\x74\x24\x20\x57\x41\x56\x41\x57\x48\x83\xec\x50\x48\x8b\xd9\x0f\x29\x74\x24\x40", 32,
        reinterpret_cast<void*>(&Eligibility), reinterpret_cast<void**>(&OriginalEligibility)},
    {0x11f98d0, "\x40\x53\x48\x83\xec\x20\x48\x8b\xd9\x48\x8b\x0d\xf8\x57\x13\x05\x48\x8b\x01\xff\x90\xb0\x04\x00\x00\x85\xc0\x75\x0b\xb8\x01\x00", 32,
        reinterpret_cast<void*>(&Ownership), reinterpret_cast<void**>(&OriginalOwnership)},
    // Callback 1405E4C60 identifies the fixed animation shop object (RVA 526A2F0).
    {0x5e4c60, "\x83\xf9\x02\x75\x0e\x33\xd2\x48\x8d\x0d\x82\x56\xc8\x04", 14, nullptr, nullptr},
    {0x3d20f10, "\x1c\x00\x00\x00\x9a\x00\x00\x00\x01\xb7\x9c\xcf", 12, nullptr, nullptr},
    {0x3d37170, "\x21\x00\x00\x00\xd9\x00\x00\x00\xb2\x4e\x5b\x09", 12, nullptr, nullptr},
};
inline bool Requested(size_t Index)
{
    if (Index == 0) return ModuleConfig::EnableAnimationShopAll;
    if (Index == 1) return ModuleConfig::EnableAnimationRequirementBypass || ModuleConfig::EnableAnimationUnlockAll;
    if (Index == 2) return ModuleConfig::EnableAnimationUnlockAll;
    return true;
}
inline bool CheckSignatures(HMODULE Executable, size_t& FailedRva)
{
    auto* Base = reinterpret_cast<unsigned char*>(Executable);
    for (size_t I = 0; I < sizeof(Sites) / sizeof(Sites[0]); ++I)
    {
        if (!Requested(I)) continue;
        const auto& S = Sites[I];
        unsigned char Bytes[32]{};
        SIZE_T Read = 0;
        if (!ReadProcessMemory(GetCurrentProcess(), Base + S.Rva, Bytes, S.Size, &Read) ||
            Read != S.Size || memcmp(Bytes, S.Bytes, S.Size) != 0)
        {
            FailedRva = S.Rva;
            return false;
        }
    }
    return true;
}
inline void InstallHooks(HMODULE Executable)
{
    auto* Base = reinterpret_cast<unsigned char*>(Executable);
    bool Created[3]{}, Enabled[3]{};
    MH_STATUS Status = MH_OK;
    size_t FailedRva = 0;
    // Publish immutable context before any detour can be reached.
    ShopObject = Base + 0x526a2f0;
    for (size_t I = 0; I < 3; ++I)
    {
        if (!Requested(I)) continue;
        Status = MH_CreateHook(Base + Sites[I].Rva, Sites[I].Detour, Sites[I].Original);
        if (Status != MH_OK) { FailedRva = Sites[I].Rva; break; }
        Created[I] = true;
    }
    if (Status == MH_OK)
    {
        for (size_t I = 0; I < 3; ++I)
        {
            if (!Created[I]) continue;
            Status = MH_EnableHook(Base + Sites[I].Rva);
            if (Status != MH_OK) { FailedRva = Sites[I].Rva; break; }
            Enabled[I] = true;
        }
    }
    if (Status != MH_OK)
    {
        for (size_t I = 3; I-- > 0;)
            if (Enabled[I]) MH_DisableHook(Base + Sites[I].Rva);
        for (size_t I = 0; I < 3; ++I)
            if (Created[I]) MH_RemoveHook(Base + Sites[I].Rva);
        Log(LogLevel::Error, L"ANIM22 hook installation failed at RVA " + std::to_wstring(FailedRva) +
            L"; status=" + std::to_wstring(Status));
        return;
    }
    Log(LogLevel::Info, L"ANIM22 enabled: shop-all=" + std::to_wstring(ModuleConfig::EnableAnimationShopAll) +
        L" requirements-bypass=" + std::to_wstring(ModuleConfig::EnableAnimationRequirementBypass) +
        L" unlock-all=" + std::to_wstring(ModuleConfig::EnableAnimationUnlockAll));
}
inline DWORD WINAPI WaitAndInstall(void* Context)
{
    const auto Executable = static_cast<HMODULE>(Context);
    constexpr DWORD TimeoutMs = 30'000, PollMs = 250;
    const ULONGLONG Started = GetTickCount64();
    try
    {
        for (;;)
        {
            size_t FailedRva = 0;
            if (CheckSignatures(Executable, FailedRva)) { InstallHooks(Executable); return 0; }
            const ULONGLONG Elapsed = GetTickCount64() - Started;
            if (Elapsed >= TimeoutMs)
            {
                Log(LogLevel::Error, L"ANIM22 refused: native signature mismatch at RVA " +
                    std::to_wstring(FailedRva) + L"; unsupported build or active CE patch (disable CE entries 1/2/3)");
                return 1;
            }
            const DWORD Remaining = static_cast<DWORD>(TimeoutMs - Elapsed);
            Sleep(Remaining < PollMs ? Remaining : PollMs);
        }
    }
    catch (...) { Log(LogLevel::Error, L"ANIM22 native hook installation failed"); return 1; }
}
inline void Install(HMODULE Executable)
{
    if (!ModuleConfig::EnableAnimationShopAll && !ModuleConfig::EnableAnimationRequirementBypass &&
        !ModuleConfig::EnableAnimationUnlockAll) return;
    if (!Executable || GetModuleHandleW(L"NBA2K22.exe") != Executable) return;
    if (InstallStarted.exchange(true)) return;
    size_t FailedRva = 0;
    if (CheckSignatures(Executable, FailedRva)) { InstallHooks(Executable); return; }
    // Packed .text becomes available after injection; do not delay WinHTTP/other hooks.
    Log(LogLevel::Info, L"ANIM22 waiting for native signatures (up to 30 seconds)");
    if (HANDLE Thread = CreateThread(nullptr, 0, WaitAndInstall, Executable, 0, nullptr)) CloseHandle(Thread);
    else
    {
        InstallStarted = false;
        Log(LogLevel::Error, L"ANIM22 could not start native readiness worker");
    }
}
}
