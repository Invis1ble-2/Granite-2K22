local base = getAddress("nba2k22.exe")
local stateAddr = base + 0x5280980

-- Write state = 2
writeInteger(stateAddr, 2)

-- Write price 100 VC for each level of all 24 attributes
for attr = 0, 23 do
  for lvl = 1, 75 do
    local offset = (attr * 75 + lvl) * 2 * 4
    writeInteger(stateAddr + offset, 100) -- VC price = 100
  end
end
print("Career prices populated successfully! State set to 2.")
