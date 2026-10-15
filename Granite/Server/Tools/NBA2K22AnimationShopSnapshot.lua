-- Cheat Engine Lua window: attach to NBA2K22.exe, open the affected shop page,
-- then run this file. READ-ONLY: no native calls, patches, purchases or file writes.
-- Target SHA256: 14741e908c9c586fb0a32a9b17f59a0e53f586cdab6b841e6aa056859116ace0
-- Ghidra: FUN_14010B7A0 / callback 1405E4C60 identify the fixed shop object;
-- FUN_1406EE500 supplies its layout; FUN_14068BBE0 supplies the filters below.
local base = getAddressSafe('NBA2K22.exe')
assert(base, 'Attach Cheat Engine to NBA2K22.exe first')
local function bytes(address, count)
  local result = readBytes(address, count, true)
  assert(result and #result == count, string.format('Cannot read %X (%d bytes)', address, count))
  return result
end
local function same(a, b)
  if #a ~= #b then return false end
  for i = 1, #a do if a[i] ~= b[i] then return false end end
  return true
end
local function check(rva, expected)
  assert(same(bytes(base + rva, #expected), expected),
    string.format('Build/patch mismatch at RVA %X; stopped', rva))
end
check(0x68bbe0, {0x48,0x89,0x5c,0x24,0x08,0x55,0x56,0x57,0x48,0x81,0xec,0x80,0,0,0,0x48})
check(0x5e5bd0, {0x83,0xf9,0x40,0x0f,0x87,0x65,0x03,0,0,0x48,0x63,0xc1})
check(0x6ee500, {0x89,0x54,0x24,0x10,0x53,0x55,0x57,0x41,0x55,0x41,0x56,0x41,0x57,0x48,0x83,0xec})
check(0x5e4c60, {0x83,0xf9,0x02,0x75,0x0e,0x33,0xd2,0x48,0x8d,0x0d,0x82,0x56,0xc8,0x04})
check(0x3d20f10, {0x1c,0,0,0,0x9a,0,0,0,0x01,0xb7,0x9c,0xcf})
check(0x3d37170, {0x21,0,0,0,0xd9,0,0,0,0xb2,0x4e,0x5b,0x09})
assert(readQword(base + 0x3d9dca0) == base + 0x3d20f10, 'Animation table pointer differs; stopped')
local function u32(data, offset)
  local i = offset + 1
  assert(i >= 1 and i + 3 <= #data, 'Invalid snapshot offset')
  return data[i] + data[i+1]*256 + data[i+2]*65536 + data[i+3]*16777216
end
local function integers(address, count)
  if count == 0 then return {}, {} end
  local raw, result = bytes(address, count*4), {}
  for i = 0, count-1 do result[i+1] = u32(raw, i*4) end
  return result, raw
end
local function word(address) return u32(bytes(address, 4), 0) end
local function normalized(category)
  if category == 60 or category == 61 then return 3 end
  if category == 62 then return 2 end
  if category >= 51 and category <= 56 then return 33 end
  if category >= 57 and category <= 59 then return 34 end
  return category
end
local state = readQword(base + 0x6332628)
assert(state and state ~= 0, 'Load a career and open the affected shop page first')
local shop = base + 0x526a2f0
assert(readQword(shop) == base + 0x243de50, 'Unexpected shop vtable; stopped')
assert(word(shop + 0x35c) == 1 and word(shop + 0x344) == 1,
  'Open the animation shop ITEM page first (not the category/equipment page)')
local categoryCount, selected = word(shop + 0x3fc), word(shop + 0x320)
assert(categoryCount >= 1 and categoryCount <= 19 and selected < categoryCount,
  'Unexpected shop category selection; stopped')
local menuCategories, menuRaw = integers(shop + 0x3b0, categoryCount)
local category = menuCategories[selected+1]
assert(category <= 63, 'Unexpected active category; stopped')
local itemCount, itemPointer = word(shop + 0x340), readQword(shop + 0x338)
assert(itemCount <= 370 and itemPointer and itemPointer ~= 0, 'Invalid shop list; stopped')
local widget = readQword(shop + 0x318)
assert(widget and widget ~= 0, 'Shop item widget is not initialized; stopped')
local actual, actualRaw = integers(itemPointer, itemCount)
local raw, records = bytes(base + 0x3d20f10, 1621*56), {}
for i = 0, 1620 do
  local offset = i*56
  local cat, index, item = u32(raw, offset), u32(raw, offset+4), u32(raw, offset+8)
  assert(cat <= 34 and item ~= 0 and item ~= 0xffffffff, 'Unexpected animation record; stopped')
  local key = cat .. ':' .. index
  -- Match FUN_14117D1A0: the first matching row wins.
  if not records[key] then
    records[key] = {item=item, seasonal=u32(raw, offset+40), first=u32(raw, offset+44), last=u32(raw, offset+48)}
  end
end
local lines = {'NBA2K22 animation shop snapshot v2 ' .. os.date('%Y-%m-%d %H:%M:%S')}
local function emit(text) lines[#lines+1] = text end
emit('READ-ONLY. Native category and generated list below are runtime reads, not label guesses.')
emit(string.format('Shop category=%d normalized=%d categoryCount=%d selected=%d generatedItems=%d',
  category, normalized(category), categoryCount, selected, itemCount))
emit('Actual generated indices (UI order): ' .. table.concat(actual, ','))
local function rowFor(index) return records[normalized(category) .. ':' .. index] end
local function describe(index)
  local row = rowFor(index)
  return row and string.format('index=%d crc=%08X seasonal=%d range=%d..%d',
    index,row.item,row.seasonal,row.first,row.last) or string.format('index=%d no paid-item row',index)
end
for _, index in ipairs(actual) do emit('  actual ' .. describe(index)) end
-- FUN_140423640: 10 schedule entries, stride 24, sentinel int at +8.
-- Only a nonzero override lets us compute the exact native timestamp/season
-- without invoking its QueryPerformanceCounter-based clock.
local schedule = bytes(base + 0x4f121f0, 0xf8)
local override = u32(schedule, 0xf0)
local overrideTime = readQword(base + 0x4f122e8)
assert(overrideTime, 'Cannot read season override timestamp')
local exactSeason
if override ~= 0 then
  local previous = 0
  for i = 0, 9 do
    local start = readQword(base + 0x4f121f0 + i*24)
    assert(start, 'Cannot read season start')
    if u32(schedule, i*24+8) == 0xffffffff or overrideTime < start then break end
    previous = i
  end
  exactSeason = previous + 1
end
emit(string.format('Season override flag=%d timestamp=%s exactSeason=%s', override,
  tostring(overrideTime), exactSeason and tostring(exactSeason) or 'UNKNOWN (native clock not called)'))
for i = 0, 9 do
  emit(string.format('  schedule[%d] start=%s sentinel=%08X', i,
    tostring(readQword(base + 0x4f121f0 + i*24)), u32(schedule, i*24+8)))
end
-- Relevant neighborhood categories plus category 28 from the purchase evidence.
-- Definitions are from FUN_1405E5BD0 / FUN_1405E5720; all use uint32 indices.
local definitions = {
  [1]={0x2432230,45,0x2433d18,13},
  [3]={0x2431520,93,0x2433c20,1}, [28]={0x2430bb0,69,0x2433a9c,1},
  [34]={0x2431bb0,82,0x2433c40,53}, [57]={0x2431d10,82,0x2433d50,53},
  [58]={0x2431ea0,82,0x2433e30,53}, [59]={0x2432040,82,0x2433f10,53},
  [60]={0x2431740,11,0x2433c24,1}, [61]={0x2431770,8,0x2433c28,1},
  [62]={0x2431518,2,0x2433c2c,1}
}
local definition = definitions[category]
local flagReads = {}
if definition then
  local candidates = integers(base + definition[1], definition[2])
  local exclusions = integers(base + definition[3], definition[4])
  local blocked, shown = {}, {}
  for _, index in ipairs(exclusions) do blocked[index] = true end
  for _, index in ipairs(actual) do shown[index] = true end
  emit('Active candidates: ' .. table.concat(candidates, ','))
  emit('Active exclusions: ' .. table.concat(exclusions, ','))
  -- Category 3 has a separate career-byte gate, unaffected by the CT predicates.
  local exceptions = {[116]=true,[117]=true,[97]=true,[98]=true,[99]=true,[100]=true,
    [101]=true,[102]=true,[103]=true,[104]=true,[106]=true,[107]=true}
  local zeroBlocked = {[0]=true,[1]=true,[4]=true,[5]=true,[6]=true,[7]=true,
    [8]=true,[9]=true,[34]=true,[57]=true,[58]=true,[59]=true}
  local function gate(index)
    if blocked[index] then return 'static-exclusion' end
    if index == 0 and zeroBlocked[category] then return 'zero-index' end
    if category == 3 then
      assert(index <= 0xffff, 'Unexpected career flag index; stopped')
      local value = bytes(state + 0x1bd + index, 1)[1]
      flagReads[index] = value
      if value == 0 and exceptions[index] then return 'career-byte-zero-special-block' end
    end
    return 'pass'
  end
  local gates = {}
  for _, index in ipairs(candidates) do
    gates[index] = gate(index)
    emit(string.format('  candidate %s shown=%s gate=%s%s', describe(index),
      tostring(shown[index] or false), gates[index],
      flagReads[index] and (' careerByte=' .. flagReads[index]) or ''))
  end
  if category == 28 then
    emit('Category 28 action rules are NOT reproduced; no complete filter prediction.')
  else
    for season = 1, 10 do
      local predicted = {}
      for _, index in ipairs(candidates) do
        local row = rowFor(index)
        if gates[index] == 'pass' and (not row or row.seasonal == 0 or
          (row.first <= season and season <= row.last)) then predicted[#predicted+1] = index end
      end
      emit(string.format('  predicted season=%d count=%d matchesActual=%s indices=%s',
        season,#predicted,tostring(same(predicted,actual)),table.concat(predicted,',')))
    end
    emit('Predictions do NOT identify the current season when exactSeason is UNKNOWN.')
  end
else
  emit('Active candidate/filter prediction is not implemented for this category; actual list is above.')
end
assert(readQword(base + 0x6332628) == state and readQword(shop) == base + 0x243de50 and
  word(shop + 0x35c) == 1 and word(shop + 0x344) == 1 and word(shop + 0x3fc) == categoryCount and
  word(shop + 0x320) == selected and word(shop + 0x340) == itemCount and
  readQword(shop + 0x338) == itemPointer, 'Shop/career changed; rerun while idle')
assert(same(bytes(shop + 0x3b0, categoryCount*4), menuRaw), 'Categories changed; rerun while idle')
if itemCount > 0 then assert(same(bytes(itemPointer, itemCount*4),actualRaw), 'List changed; rerun while idle') end
assert(same(bytes(base + 0x4f121f0,0xf8),schedule) and readQword(base + 0x4f122e8) == overrideTime,
  'Season data changed; rerun while idle')
for index, value in pairs(flagReads) do
  assert(bytes(state + 0x1bd + index,1)[1] == value, 'Career flags changed; rerun while idle')
end
emit('Done. No game memory or server data changed. Copy the COMPLETE output with the shop screenshot.')
print(table.concat(lines, '\n'))
