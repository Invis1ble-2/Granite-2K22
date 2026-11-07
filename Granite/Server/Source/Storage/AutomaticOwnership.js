// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { LoadFile } = require('./StoreCatalog2K22');
const { OwnedKey, ListOwnedItems } = require('./OwnedItems');
const { ProductFor: GatoradeProduct } = require('./GatoradeBoosts');
const ShotFeedback = require('./ShotFeedback2K22');

// Explicit permanent categories only: never grant consumable or unknown categories.
const PermanentGroups = Object.freeze([
    'Clothing', 'Accessories', 'Shoes', 'Mascots', 'Tattoos', 'Headphones',
    'MyCourt', 'Wheelz', 'Football', 'DJStation', 'Equipment',
    'PlayerPanels',
]);

function LoadAutomaticItems(Source) {
    const Catalog = typeof Source === 'string' ? LoadFile(Source) : Source;
    if (!Catalog?.groupItems) throw new Error('automatic ownership requires a loaded 2K22 store catalog');
    const Items = PermanentGroups.flatMap(Group =>
        (Catalog.groupItems[Group] || []).map(Entry => Entry.item_id));
    // These EXE-backed items have no storefront thumbnails and are excluded
    // from the local shop catalog, but still unlock through native ownership.
    Items.push(...ShotFeedback.ItemIds);
    const Unique = new Map();
    for (const Item of Items) {
        if (GatoradeProduct(Item)) continue;
        Unique.set(Item, {
            item: `0x${Item.toString(16).toUpperCase().padStart(8, '0')}`,
            purchaseType: null,
            price: '0',
            at: new Date(0).toISOString(),
        });
    }
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

function IsAutomaticallyOwned(Item, Context = {}) {
    return Boolean(OwnedKey(Context)) && (Context.AutomaticOwnedItems || [])
        .some(Entry => Number(Entry.item) === (Number(Item) >>> 0));
}

module.exports = { LoadAutomaticItems, InventoryFor, IsAutomaticallyOwned };
