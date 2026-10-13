// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

// NBA2K22 FUN_1413B5880 reads these fields; FUN_14144FE20 schedules another
// request as soon as CacheSeconds elapses. Omitting it defaults to zero and
// produces a request every frame even after a SUCCESS response.
const Fields = Object.freeze({ Available: 0xe7458589, Count: 0xebd33bd4, CacheSeconds: 0x30dcc93c });
const CacheSeconds = 60;
function Build() {
    return new Builder().AddU32(Crc32('RESULT'), Crc32('SUCCESS'))
        .AddBool(Fields.Available, false)
        .AddU64(Fields.Count, 0n)
        .AddU64(Fields.CacheSeconds, BigInt(CacheSeconds)).Build();
}

module.exports = { Build, GetOverview: Build, Fields, CacheSeconds, Status: 'STORE_OVERVIEW_2K22_COMPATIBLE' };
