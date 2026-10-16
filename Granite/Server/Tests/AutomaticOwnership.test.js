// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Path = require('node:path');
const Zlib = require('node:zlib');
const { Parse, Types } = require('../Source/Codec/FieldList');
const { LoadAutomaticItems, InventoryFor, IsAutomaticallyOwned } = require('../Source/Storage/AutomaticOwnership');
const { LoadFile, ReadDocument } = require('../Source/Storage/StoreCatalog2K22');
const { LoadCatalogPrices } = require('../Source/Storage/StoreCatalog');
const { OwnedKey } = require('../Source/Storage/OwnedItems');
const Inventory = require('../Source/Services/Inventory/GetWithTag');
const StoreOwned = require('../Source/Services/Store/GetOwnedItems');
const CatalogPath = Path.resolve(__dirname, '../Storage/Inventory/StoreCatalog2K22.json');
const Catalog = LoadFile(CatalogPath);
const Grants = LoadAutomaticItems(Catalog);
const GatoradeIds = [0x4c99dc6d, 0xe80626b4, 0xed175be5, 0x45a9e847, 0xf713373a, 0x88d81a73];

Test('2K22 automatic grants use validated permanent items, never raw rows or consumables', () => {
    const Document = ReadDocument(CatalogPath);
    Assert.equal(Document.source, 'NBA2K22_MANIFEST_STORE_BINARY_DATA');
    Assert.equal(Document.items.length, 40804);
    Assert.ok(Grants.length > 0 && Grants.length < Document.items.length);
    const Valid = new Set(Catalog.items.map(Entry => Entry.item_id));
    const Excluded = new Set(['Gatorade', 'Fireworks'].flatMap(Group =>
        Catalog.groupItems[Group].map(Entry => Entry.item_id)));
    for (const Entry of Grants) {
        Assert.ok(Valid.has(Number(Entry.item)));
        Assert.ok(!Excluded.has(Number(Entry.item)));
        Assert.equal(Entry.price, '0');
    }
    Assert.equal(new Set(Grants.map(Entry => Entry.item)).size, Grants.length);
    Assert.deepEqual(LoadAutomaticItems(CatalogPath), Grants);
    Assert.throws(() => LoadAutomaticItems(null), /2K22/);
    const Prices = LoadCatalogPrices(Catalog);
    for (const [Item, Price] of Catalog.pricesByItem) Assert.equal(Prices.get(Item), Price);
    for (const Item of GatoradeIds) Assert.ok(!Grants.some(Entry => Number(Entry.item) === Item));
});

Test('automatic grants merge without debiting VC, rewriting purchases, or leaking accounts', () => {
    const Context = { userId: 42n, AutomaticOwnedItems: Grants, OwnedItems: new Map(), Wallets: new Map([['42', 123n]]) };
    const Purchased = { item: Grants[0].item, price: '777', purchaseType: '0x00000001' };
    const Exclusive = { item: '0xFFFFFFFE', price: '100', purchaseType: null };
    Assert.ok(!Grants.some(Entry => Entry.item === Exclusive.item));
    Context.OwnedItems.set(OwnedKey(Context), [Purchased, Exclusive]);
    const Before = JSON.stringify([...Context.OwnedItems]);
    const Result = InventoryFor(Context);
    Assert.equal(Result.length, Grants.length + 1);
    Assert.equal(Result.find(Entry => Entry.item === Purchased.item), Purchased);
    Assert.ok(Result.includes(Exclusive));
    const Other = InventoryFor({ ...Context, userId: 43n });
    Assert.equal(Other.length, Grants.length);
    Assert.ok(!Other.includes(Exclusive));
    Assert.deepEqual(InventoryFor({ ...Context, userId: null }), []);
    Assert.equal(JSON.stringify([...Context.OwnedItems]), Before);
    Assert.equal(Context.Wallets.get('42'), 123n);
    Assert.deepEqual(InventoryFor({ ...Context, AutomaticOwnedItems: [] }), [Purchased, Exclusive]);
    Assert.equal(IsAutomaticallyOwned(Purchased.item, Context), true);
    Assert.equal(IsAutomaticallyOwned(Purchased.item, { ...Context, AutomaticOwnedItems: [] }), false);
    Assert.equal(IsAutomaticallyOwned(Purchased.item, { ...Context, userId: null }), false);
});

Test('all eligible 2K22 automatic grants survive the inventory response without truncation', () => {
    const Context = { userId: 42n, AutomaticOwnedItems: Grants, OwnedItems: new Map() };
    const Reply = Inventory.Build({}, Context);
    const Outer = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize }).Fields;
    const Blobs = Outer.filter(Field => Field.Crc === 0x9cc95621);
    const Sizes = Outer.filter(Field => Field.Crc === 0x634465d8);
    Assert.equal(Blobs.length, Math.ceil(Grants.length / 512));
    Assert.equal(Sizes.length, Blobs.length);
    const Received = [];
    Blobs.forEach((BlobData, Index) => {
        const Raw = Zlib.inflateSync(BlobData.Raw);
        Assert.equal(Sizes[Index].Type, Types.U64);
        Assert.equal(BigInt(Raw.length), Sizes[Index].value);
        const Inner = Parse(Raw).Fields;
        const Items = Inner.filter(Field => Field.Crc === 0xfd76cfbd);
        const Masks = Inner.filter(Field => Field.Crc === 0xfbe14f6f);
        Assert.ok(Items.length <= 512);
        Assert.equal(Items.length, Masks.length);
        Items.forEach((Item, Occurrence) => {
            Assert.equal(Item.Type, Types.StringCrc);
            Assert.equal(Masks[Occurrence].Type, Types.U64);
            Assert.equal(Masks[Occurrence].value, 1n);
            Received.push(Item.Data1);
        });
    });
    Assert.deepEqual(Received, Grants.map(Entry => Number(Entry.item)));
    const Owned = Parse(StoreOwned.Build({}, Context).Body).Fields
        .filter(Field => Field.Crc === 0xfd76cfbd).map(Field => Field.Data1);
    Assert.deepEqual(Owned, Received);
});

Test('consumable filtering preserves historical records without permanent Gatorade instances', () => {
    for (const Encode of [Id => Id, Id => String(Id), Id => `0x${Id.toString(16)}`]) {
        const Permanent = Grants[0];
        const AutomaticOwnedItems = [...GatoradeIds.map(Id => ({ item: Encode(Id) })), Permanent];
        const OwnedItems = new Map();
        const Context = { userId: 42n, AutomaticOwnedItems, OwnedItems };
        const Purchased = GatoradeIds.map(Id => ({ item: Encode(Id), price: '500', purchaseType: '0x00000016' }));
        OwnedItems.set(OwnedKey(Context), Purchased);
        const Before = JSON.stringify({ automatic: AutomaticOwnedItems, owned: [...OwnedItems] });
        Assert.deepEqual(InventoryFor(Context), [Permanent]);
        Assert.deepEqual(OwnedItems.get(OwnedKey(Context)), Purchased);
        Assert.deepEqual(InventoryFor({ ...Context, userId: 43n }), [Permanent]);
        Assert.deepEqual(InventoryFor({ ...Context, userId: null }), []);
        Assert.deepEqual(InventoryFor({ ...Context, AutomaticOwnedItems: [] }), []);
        Assert.equal(JSON.stringify({ automatic: AutomaticOwnedItems, owned: [...OwnedItems] }), Before);
    }
});
