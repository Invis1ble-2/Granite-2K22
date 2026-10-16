// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { ItemCrc, PurchaseType } = require('../VirtualCurrency/Purchase');
const { InventoryFor } = require('../../Storage/AutomaticOwnership');
const Wire2K22 = require('./Wire2K22');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');

function Build(Input, Context = {}) {
    const Reply = new Builder();
    const Owned = InventoryFor(Context);
    // NBA2K22 FUN_14059B340 (0x14059B485–0x14059B4E8) consumes the
    // compressed inventory only, not the duplicate legacy item/type fields.
    const Agent = Input?.headers?.['user-agent'];
    const Native2K22 = typeof Agent === 'string' && /^VISUAL_CONCEPTS_WIN64\/22(?:\.|$)/i.test(Agent);
    if (!Native2K22) {
        for (const Entry of Owned) {
            Reply.AddStringCrc(ItemCrc, Number(Entry.item));
            if (Entry.purchaseType) Reply.AddStringCrc(PurchaseType, Number(Entry.purchaseType));
        }
    }
    Wire2K22.AppendInventory(Reply, Owned);
    Reply.AddU32(Result, Success);
    if (Native2K22) Reply.Fields.sort((A, B) => A.Crc - B.Crc);
    return Reply.Build();
}

module.exports = {
    Build,
    GetOwnedItems: Build,
    Status: 'GHIDRA_2K22_COMPRESSED_JSON_WITH_LEGACY_CLIENT_FALLBACK',
};
