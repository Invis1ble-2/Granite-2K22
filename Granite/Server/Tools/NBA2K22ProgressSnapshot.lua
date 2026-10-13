-- Cheat Engine Lua: attach to NBA2K22.exe first, then execute this script.
-- Read-only. Addresses are RVAs from the Ghidra image with SHA256
-- 14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0.
-- Verify the executable build before using. Output goes to the Lua console.
local base = getAddressSafe('NBA2K22.exe')
assert(base, 'Attach Cheat Engine to NBA2K22.exe first')
local state = readQword(base + 0x6332628)
assert(state and state ~= 0, 'Career state pointer is unavailable; enter a career save first')
local function signed32(address)
  local value = readInteger(address)
  assert(value, string.format('Cannot read %X', address))
  if value >= 0x80000000 then value = value - 0x100000000 end
  return value
end
local function bytes(address, count)
  local result = readBytes(address, count, true)
  assert(result and #result == count, 'Cannot read attribute levels')
  return result
end
print('NBA2K22 progression snapshot ' .. os.date('%Y-%m-%d %H:%M:%S'))
print(string.format('base=%X careerState=%X', base, state))
local thresholds = {}
for i = 0, 20 do
  thresholds[i + 1] = signed32(base + 0x68427e8 + i * 4)
end
print('threshold table [0..20] = ' .. table.concat(thresholds, ', '))
local eventSum = 0
for i = 0, 113 do eventSum = eventSum + signed32(state + 0xe8bc8 + i * 4) end
local adjustment = signed32(state + 0xe8d90)
local total = math.max(0, eventSum + adjustment)
local level = 0
for i = 1, 20 do
  local threshold = thresholds[i + 1]
  if threshold == 0 then break end
  if total >= threshold then level = i end
end
print(string.format('eventSum=%d adjustment=%d total=%d derivedGrindLevel=%d', eventSum, adjustment, total, level))
local levels = bytes(state + 0x17974, 24)
print('attribute levels [0..23] = ' .. table.concat(levels, ', '))
local caps = {}
for i = 0, 23 do
  local value = readFloat(state + 0x1798c + i * 4)
  assert(value, 'Cannot read normalized caps')
  caps[i + 1] = string.format('%.6f', value)
end
print('normalized level caps [0..23] = ' .. table.concat(caps, ', '))
print('Record UI overall cap and available upgrades alongside this output; those UI values are not read here.')
