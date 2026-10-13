#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include "../BadgeSync.h"
#include <cassert>
#include <cstdio>

int main(int argc, char** argv)
{
    std::vector<unsigned char> Original;
    BadgeSync::Field(Original, 0xd5e5f21d, 0);
    BadgeSync::Field(Original, 0x5eeda966, 2);
    Original.resize(Original.size() + 16, 0);
    uint64_t Save = 99, Slot = 99;
    assert(BadgeSync::RequestScope(Original.data(), static_cast<DWORD>(Original.size()), Save, Slot));
    assert(Save == 0 && Slot == 2);
    assert(!BadgeSync::RequestScope(Original.data(), 47, Save, Slot));
    const unsigned char Compressed[] = {0x1f, 0x8b};
    assert(!BadgeSync::RequestScope(Compressed, 2, Save, Slot));
    auto Trailing = Original;
    Trailing.resize(Trailing.size() + 16, 0);
    assert(!BadgeSync::RequestScope(Trailing.data(), static_cast<DWORD>(Trailing.size()), Save, Slot));
    BadgeSync::Snapshot Data{};
    const unsigned Caps[] = {10, 9, 10, 7};
    for (int Index = 0; Index < 4; ++Index) { Data.Caps[Index] = Caps[Index]; Data.Points[Index] = 100000; }
    for (auto& Value : Data.Potentials) Value = 1000000;
    for (int Index = 0; Index < 99; ++Index) { Data.Names[Index] = 1000 + Index; Data.Levels[Index] = BadgeSync::LevelCrcs[0]; }
    const auto Wire = BadgeSync::Encode(Original.data(), static_cast<DWORD>(Original.size()), Data);
    assert(Wire.size() == Original.size() + (1 + 12 + 24 + 198) * 16);
    assert(!BadgeSync::RequestScope(Wire.data(), static_cast<DWORD>(Wire.size()), Save, Slot));
    assert(BadgeSync::Read32(Wire.data() + 32) == BadgeSync::Version);
    assert(BadgeSync::Read32(Wire.data() + 44) == 1);
    assert(memcmp(Original.data(), Wire.data(), 32) == 0);
    if (argc == 2)
    {
        FILE* File = nullptr;
        assert(fopen_s(&File, argv[1], "wb") == 0 && File);
        assert(fwrite(Wire.data(), 1, Wire.size(), File) == Wire.size());
        fclose(File);
    }
    puts("BadgeSync scope, serialization and fallback tests passed");
}
