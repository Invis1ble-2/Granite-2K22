// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { ItemCrc, PurchaseType } = require('../VirtualCurrency/Purchase');
const { InventoryFor } = require('../../Storage/AutomaticOwnership');
const Wire2K22 = require('./Wire2K22');
const { RequestedPage } = require('./GetOverview');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');

function Build(Input, Context = {}) {
    const Reply = new Builder();
    const AllOwned = InventoryFor(Context);
    const Agent = Input?.headers?.['user-agent'];
    const Native2K22 = typeof Agent === 'string' && /^VISUAL_CONCEPTS_WIN64\/22(?:\.|$)/i.test(Agent);
    const Page = Native2K22 ? RequestedPage(Input) : null;
    let Owned = AllOwned;
    // K22 FUN_1413AC4B0 (0x1413AC61D–0x1413AC637) requests CATEGORY:ICON.
    if (Page === 'CATEGORY:ICON') {
        const PanelIds = new Set((Context.StoreCatalog2K22?.groupItems?.PlayerPanels || [])
            .map(Entry => Number(Entry.item_id) >>> 0));
        Owned = AllOwned.filter(Entry => PanelIds.has(Number(Entry.item) >>> 0));
    } else if (Page === 'PAGE:MYPLAYER_EQUIPMENT') {
        // Equipment and closet use separate page requests on this shared route.
        const ApparelIds = new Set(['Clothing', 'Accessories', 'Shoes'].flatMap(Group =>
            (Context.StoreCatalog2K22?.groupItems?.[Group] || [])
                .map(Entry => Number(Entry.item_id) >>> 0)));
        Owned = AllOwned.filter(Entry => !ApparelIds.has(Number(Entry.item) >>> 0));
    }
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
