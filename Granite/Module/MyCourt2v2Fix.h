// NBA 2K22 MyCOURT 2v2: keep CourtType 6's camera with genuine 2/2 rosters.
#pragma once
#include "NativeMatchInit.h"

namespace MyCourt2v2Fix
{
inline bool Read(const void* Address, void* Out, size_t Size)
{
    SIZE_T N = 0;
    return Address && ReadProcessMemory(GetCurrentProcess(), Address, Out, Size, &N) && N == Size;
}
template<class T> inline bool At(const void* Base, size_t Offset, T& Value)
{
    return Base && Read(static_cast<const unsigned char*>(Base) + Offset, &Value, sizeof(Value));
}
inline uint32_t TeamSizeForSession(void* Session)
{
    const void* Info = Session ? static_cast<unsigned char*>(Session) + 0xcb0 : nullptr;
    uint32_t CourtId = 0;
    int Home = 0, Away = 0, GameSetting = 0, GameType = 0;
    uint64_t HomePlayers[2]{}, AwayPlayers[2]{};
    // CourtType 6 selects CRIB_3_ON_3. Override counts only for its complete 2/2 roster.
    const bool Applies = At(Info, 0x118, Home) && Home == 2 && At(Info, 0x11c, Away) && Away == 2 &&
        Read(static_cast<const unsigned char*>(Info) + 0x48, HomePlayers, sizeof(HomePlayers)) &&
        Read(static_cast<const unsigned char*>(Info) + 0xb0, AwayPlayers, sizeof(AwayPlayers)) &&
        At(Info, 0x2b0, CourtId) && CourtId == 0x000d4d10 &&
        At(Info, 0, GameSetting) && GameSetting == 64 && At(Info, 4, GameType) && GameType == 17;
    return Applies ? 2U : 0U;
}
inline void Install()
{
    NativeMatchInit::ResolveTeamSize = &TeamSizeForSession;
}
} // namespace MyCourt2v2Fix
