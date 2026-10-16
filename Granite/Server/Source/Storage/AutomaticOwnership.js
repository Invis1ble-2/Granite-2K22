// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const { OwnedKey, ListOwnedItems } = require('./OwnedItems');

const { ProductFor: GatoradeProduct } = require('./GatoradeBoosts');
function LoadAutomaticItems(File) {
    const Document = JSON.parse(Fs.readFileSync(File, 'utf8'));
    if (
        Document.version !== 1 ||
        Document.source !== 'NBA2K19_MANIFEST_STORE_BINARY_DATA' ||
        !Array.isArray(Document.items)
    )
        throw new Error('automatic ownership requires an exported NBA2K19 item catalog');
    const Unique = new Map();
    for (const Entry of Document.items) {
        const Item = Number(Entry.item);
        if (!Number.isInteger(Item) || Item <= 0 || Item >= 0xffffffff)
            throw new Error(`invalid automatic ownership item: ${Entry.item}`);
        Unique.set(Item, {
            item: `0x${Item.toString(16).toUpperCase().padStart(8, '0')}`,
            purchaseType: null,
            price: '0',
            at: new Date(0).toISOString(),
        });
    }
    if (!Unique.size) throw new Error('automatic ownership catalog is empty');
    return [...Unique.values()];
}

function InventoryFor(Context = {}) {
    const Key = OwnedKey(Context);
    if (!Key) return [];
    const Merged = new Map();
    for (const Entry of Context.AutomaticOwnedItems || []) {
        const Item = Number(Entry.item) >>> 0;
        if (!GatoradeProduct(Item)) Merged.set(Item, Entry);
    }
    // Keep historical purchase records on disk, but consumables are no longer
    // permanent instances: their remaining uses live in GatoradeBoosts.
    for (const Entry of ListOwnedItems(Context.OwnedItems, Key)) {
        const Item = Number(Entry.item) >>> 0;
        if (!GatoradeProduct(Item)) Merged.set(Item, Entry);
    }
    return [...Merged.values()];
}

module.exports = { LoadAutomaticItems, InventoryFor };
