-- Run once in Cheat Engine's Lua window while this build's badge page is open.
-- Reads the client-computed maximum; does not change game memory or equip badges.
-- Target: NBA2K22.exe.unpacked.exe, Ghidra image base 0x140000000.
local serverRoot = [[D:\download\Granite-main\Granite\Server]]
local base = getAddressSafe('NBA2K22.exe') or getAddressSafe('NBA2K22.exe.unpacked.exe')
assert(base, 'Attach Cheat Engine to NBA2K22 first')
local state = readQword(base + 0x6332628)
local career = readQword(base + 0x632f0d8)
assert(state and state ~= 0 and career and career ~= 0, 'Open a loaded career badge page first')
local bytes = readBytes(base + 0x11d39a0, 6, true)
assert(bytes and bytes[1] == 0x48 and bytes[2] == 0x89 and bytes[3] == 0x5c
  and bytes[4] == 0x24 and bytes[5] == 0x08 and bytes[6] == 0x57,
  'Executable differs from the Ghidra-verified build; export stopped')

local scratch = allocateMemory(4096, base)
assert(scratch, 'Could not allocate native snapshot buffer')
local data = scratch + 0x800
local code = string.format([[
%X:
  push rbx
  sub rsp,20
  mov rbx,%X
  mov rcx,[%X]
  mov rax,[rcx]
  call qword ptr [rax+188]
  mov [rbx],rax
  mov rcx,[%X]
  mov rax,[rcx]
  call qword ptr [rax+2B0]
  mov [rbx+8],rax
]], scratch, data, base + 0x632f0d8, base + 0x632f0d8)
for category = 1,4 do
  -- param2=0 includes this category's existing extra points, matching the menu maximum.
  code = code .. string.format([[
  mov ecx,%X
  xor edx,edx
  mov rax,%X
  call rax
  mov [rbx+%X],eax
]], category, base + 0x11d39a0, 0x10 + (category-1)*4)
end
code = code .. [[
  add rsp,20
  pop rbx
  xor eax,eax
  ret
]]
local installed = autoAssemble(code)
assert(installed, 'Could not assemble native snapshot reader')
-- A nil timeout waits for completion so the buffer is never freed while code is running.
local ok, failure = pcall(function() executeCodeEx(0, nil, scratch) end)
if not ok then error('Native snapshot failed: ' .. tostring(failure)) end
assert(readQword(base + 0x6332628) == state and readQword(base + 0x632f0d8) == career,
  'Career changed during snapshot; rerun on the badge page')
-- Convert arbitrary U64 ids without rounding through Lua/CE floating-point numbers.
local function unsignedDecimal(address)
  local raw = assert(readBytes(address, 8, true))
  local digits = {0}
  for index = 8,1,-1 do
    local carry = raw[index]
    for digit = 1,#digits do
      local value = digits[digit]*256 + carry
      digits[digit] = value % 10
      carry = math.floor(value/10)
    end
    while carry > 0 do
      digits[#digits+1] = carry % 10
      carry = math.floor(carry/10)
    end
  end
  local result = ''
  for digit = #digits,1,-1 do result = result .. digits[digit] end
  return result
end
local saveId = unsignedDecimal(data)
local slot = unsignedDecimal(data+8)
local caps, progress, extra, potential, levels = {}, {}, {}, {}, {}
local levelCrcs = {0x1c966fc2, 0x4e107e0f, 0xdfa3dfdd, 0x713cf0e5, 0x371de7a3}
for category = 1,4 do
  local maximum = readInteger(data + 0x10 + (category-1)*4)
  local earned = readSmallInteger(state + 0x17a64 + category*2)
  assert(maximum and maximum >= 0 and maximum <= 65535 and earned <= maximum,
    'Native maximum is inconsistent with earned points')
  caps[category] = maximum
  extra[category] = readSmallInteger(state + 0x17a9c + category*2)
  local threshold = 0
  local ordinary = maximum - extra[category]
  if ordinary > 0 then
    threshold = readInteger(base + 0x6841f0c + (category*30 + math.min(ordinary-1,29))*4)
  end
  progress[category] = math.max(readInteger(state + 0x17a78 + category*4), threshold)
  assert(progress[category] >= 0, 'Invalid badge progress')
end
for index = 0,23 do
  local ratio = readFloat(state + 0x1798c + index*4)
  assert(ratio and ratio >= 0 and ratio <= 1, 'Invalid attribute potential')
  potential[index+1] = math.floor(ratio*1000000+0.5)
end
for index = 0,98 do
  local level = readBytes(state + 0x17a00 + index, 1)
  assert(level and level >= 0 and level <= 4, 'Invalid equipped badge level')
  local badge = readInteger(base + 0x24cbec0 + index*4)
  if badge < 0 then badge = badge + 4294967296 end
  levels[#levels+1] = string.format('"%d":%d', badge, levelCrcs[level+1])
end
deAlloc(scratch)
local snapshot = string.format([[{
  "source":"NBA2K22-native-1411D39A0",
  "careerSaveId":"%s","careerSlot":"%s",
  "caps":[%s],"progress":[%s],"extra":[%s],
  "potential":[%s],"levels":{%s}
}
]], saveId, slot, table.concat(caps,','), table.concat(progress,','), table.concat(extra,','),
  table.concat(potential,','), table.concat(levels,','))
local output = serverRoot .. [[\Tools\NBA2K22BadgeBudget.snapshot.json]]
local file = assert(io.open(output, 'w'))
file:write(snapshot)
file:close()
print('Native maximum: finishing=' .. caps[1] .. ', shooting=' .. caps[2]
  .. ', playmaking=' .. caps[3] .. ', defense=' .. caps[4])
print('Snapshot: ' .. output)
local command = 'node "' .. serverRoot .. [[\Tools\ImportNBA2K22BadgeBudget.js" "]] .. output .. '" 2>&1'
local pipe = assert(io.popen(command, 'r'))
print(pipe:read('*a'))
pipe:close()
print('After import succeeds, leave and reload the career to receive the full badge budget.')
