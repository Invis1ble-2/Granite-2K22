local base = getAddress("nba2k22.exe")
local stateAddr = base + 0x5280980
print("Current state: " .. readInteger(stateAddr))
