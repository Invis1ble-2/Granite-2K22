// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const { Builder, GetField, Types } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { StoreDefinitions } = require('./StoreDefinitions2K22');

// NBA2K22 FUN_1413B5880 reads these fields; FUN_14144FE20 schedules another
// request as soon as CacheSeconds elapses. Omitting it defaults to zero and
// produces a request every frame even after a SUCCESS response.
const Fields = Object.freeze({ Available: 0xe7458589, Count: 0xebd33bd4, CacheSeconds: 0x30dcc93c });
const CacheSeconds = 60;
const OverviewPageField = 0x952ef509;
const LocalStorePages = new Set(StoreDefinitions.map(Store => Store.Page));

function RequestedPage(Input) {
    const Fields = Input?.Parsed?.Fields;
    const Data = Input?.Parsed?.Data;
    if (!Array.isArray(Fields) || !Buffer.isBuffer(Data)) return null;
    const Field = GetField(Fields, OverviewPageField, 0, Types.String16);
    if (!Field || !Number.isInteger(Field.Data1) || !Number.isInteger(Field.Data2)) return null;
    // Real 2K22 requests (StoreV4 captures) encode Data2 as bytes, not code units.
    const End = Field.Data1 + Field.Data2;
    if (Field.Data1 < 0 || Field.Data2 < 2 || Field.Data2 > 512 || Field.Data2 % 2 || End > Data.length) return null;
    let Value = '';
    for (let Offset = Field.Data1; Offset + 1 < End; Offset += 2) {
        const Unit = Data.readUInt16BE(Offset);
        // Native request buffers can have non-ASCII/control garbage after the identifier.
        if (!((Unit >= 0x41 && Unit <= 0x5a) || (Unit >= 0x30 && Unit <= 0x39) || Unit === 0x3a || Unit === 0x5f)) break;
        Value += String.fromCharCode(Unit);
    }
    return Value;
}

function Build(Input = {}) {
    const Available = LocalStorePages.has(RequestedPage(Input));
    return new Builder().AddU32(Crc32('RESULT'), Crc32('SUCCESS'))
        .AddBool(Fields.Available, Available)
        .AddU64(Fields.Count, 0n)
        .AddU64(Fields.CacheSeconds, BigInt(CacheSeconds)).Build();
}

module.exports = {
    Build,
    GetOverview: Build,
    RequestedPage,
    Fields,
    CacheSeconds,
    LocalStorePages,
    Status: '2K22_NATIVE_LOCAL_STORE_OVERVIEW_GATE',
};
