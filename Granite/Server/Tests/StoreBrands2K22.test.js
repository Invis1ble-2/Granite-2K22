// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Zlib = require('node:zlib');
const { Parse, GetField, GetU64 } = require('../Source/Codec/FieldList');
const { Crc32 } = require('../Source/Core/Crc32');
const { StoreCatalog2K22, Fields } = require('../Source/Storage/StoreCatalog2K22');
const { BrandForItem, NativeBrands, NativeWord, ResourceBrands, IsNbaItem } = require('../Source/Services/Store/StoreBrands2K22');
const { StoreDefinitions, Groups } = require('../Source/Services/Store/StoreDefinitions2K22');
const Layout = require('../Source/Services/Store/GetLayout');
function Item(Id, Brand = 0, Type = 2, Changes = {}) {
    return { item: Id, itemType: Type, name: 'Misleading Nike Jordan Puma New Balance',
        originPrice: 500, price: 500, currency: 0, availability: 0, content: ['generic'],
        rawWords: { '0x194': `0x${((Brand << 19) | 32).toString(16).padStart(8, '0')}` }, ...Changes };
}
function Catalog(Items) {
    return new StoreCatalog2K22({ source: 'NBA2K22_MANIFEST_STORE_BINARY_DATA', typeHash: '0x67AF5087',
        recordSizeBytes: 416, priceFieldsDecoded: true, version: 1, items: Items });
}
function Rows(CatalogValue, Root) {
    const Reply = CatalogValue.GetReplyForPage(StoreDefinitions.find(Store => Store.Root === Root).Page);
    const Parsed = Parse(Reply.Body);
    const Raw = Zlib.inflateSync(GetField(Parsed.Fields, Fields.Items).Raw);
    Assert.equal(BigInt(Raw.length), GetU64(Parsed.Fields, Fields.UncompressedSize));
    Assert.equal(Raw.at(-1), 0);
    return JSON.parse(Raw.subarray(0, -1));
}
Test('all native brands decode exactly, with Adidas2 merged and no display-name guessing', () => {
    for (let Brand = 0; Brand < NativeBrands.length; Brand++) {
        Assert.equal(BrandForItem(Item(1, Brand)), NativeBrands[Brand]);
    }
    Assert.equal(BrandForItem(Item(1)), 'NONE');
    Assert.equal(BrandForItem(Item(1, 2, 2, { content: ['shirt_bape_newbalance'] })), 'NIKE');
    Assert.equal(BrandForItem(Item(1, 31, 2, { content: ['shirt_newbalance'] })), 'NONE');
    for (const Value of [null, undefined, '', '0x20', '0x00007820junk', '500', -1, 1.5, true, 0x100000000]) {
        const Raw = Item(1, 0, 2, { rawWords: { '0x194': Value }, content: ['shirt_newbalance'] });
        Assert.equal(NativeWord(Raw), null);
        Assert.equal(BrandForItem(Raw), 'NONE');
        Assert.equal(IsNbaItem(Raw), false);
    }
    Assert.equal(NativeWord({ rawWords: { '0x194': 32 } }), 32);
});
Test('resource fallbacks use explicit bounded tokens and a verified New Balance shoe allowlist', () => {
    for (const Entry of ResourceBrands) {
        // Every configured fallback has a real retail resource example (verified below too).
        Assert.ok(Entry.Pattern instanceof RegExp);
    }
    for (const [Resource, Expected] of [
        ['shirt_bape_camo', 'BAPE'], ['shirt_champion_mesh', 'CHAMPION'],
        ['shirt_newbalance_blk', 'NEWBALANCE'], ['cdn/store/shoes/win64/data/shoe_7700_default.iff', 'NEWBALANCE'],
        ['shoe_7701_default', 'NEWBALANCE'], ['shoe_7703_default', 'NEWBALANCE'],
        ['shoe_7705_default', 'NEWBALANCE'], ['shoe_7706_default', 'NEWBALANCE'],
        ['shoe_7702_default', 'NONE'], ['shoe_7799_default', 'NONE'], ['shoe_3500_default', 'NONE'],
        ['shirt_notnewbalance_blk', 'NONE'], ['shirt_nike_solid', 'NONE'], ['earring_diamond_round', 'NONE'],
    ]) Assert.equal(BrandForItem(Item(1, 0, 5, { content: [Resource] })), Expected, Resource);
});
Test('single-brand stores isolate apparel, merge Adidas2 and reject unrelated types', () => {
    const Cases = [['ADIDAS_STORES', 1], ['CONVERSE_STORE', 5], ['JORDAN_STORE', 3],
        ['NIKE_STORE', 2], ['PUMA_STORE', 24], ['UNDERARMOUR_STORE', 8], ['PARK_AFTER_DARK', 21]];
    const Raw = Cases.flatMap(([, Brand]) => [2, 4, 5, 8].map(Type => Item(Brand * 100 + Type, Brand, Type)));
    Raw.push(Item(999, 4));
    const Value = Catalog(Raw);
    for (const [Root, Brand] of Cases) {
        const Expected = [2, 4, 5].map(Type => Brand * 100 + Type);
        if (Brand === 1) Expected.push(999);
        Assert.deepEqual(Rows(Value, Root).map(Row => Row.item_id), Expected, Root);
        const Cells = Layout.LayoutDocument(Value)[Root].flat(2);
        for (const Row of Rows(Value, Root)) Assert.equal(Cells.filter(Cell => Row.tag_crcs.includes(Crc32(Cell.tag))).length, 1);
    }
    const Versions = Cases.map(([Root]) => GetU64(Parse(Value.GetReplyForPage(StoreDefinitions.find(Store => Store.Root === Root).Page).Body).Fields, Fields.Version));
    Assert.equal(new Set(Versions).size, Cases.length, 'same type groups must not share another brand cache');
});
Test('New Balance store contains only verified clothing and shoe resources', () => {
    const Value = Catalog([Item(1, 0, 2, { content: ['shirt_newbalance_blk'] }),
        Item(2, 0, 5, { content: ['shoe_7700_default.iff'] }), Item(3, 0, 5, { content: ['shoe_7702_default.iff'] }),
        Item(4, 2, 2, { content: ['shirt_newbalance_blk'] }), Item(5)]);
    Assert.deepEqual(Rows(Value, 'NEW_BALANCE_STORE').map(Row => Row.item_id), [1, 2]);
});
Test('NBA keeps confirmed NBA and historical teams, but not generic or other-league apparel', () => {
    const Teams = [0, 29, 30, 31, 562, 32, 200, 300];
    const Value = Catalog(Teams.map((Team, Index) => Item(Index + 1, 2, 2, { rawWords: { '0x194': (2 << 19) | Team } })));
    Assert.deepEqual(Rows(Value, 'NBASTORE').map(Row => Row.item_id), [1, 2, 3, 4, 5]);
});
Test('brand/team conflicts exclude duplicate IDs, including metadata missing on one row', () => {
    for (const Changed of [Item(1, 3), Item(1, 2, 2, { rawWords: {} }),
        Item(1, 2, 2, { rawWords: { '0x194': (2 << 19) | 31 } })]) {
        Assert.equal(Catalog([Item(1, 2), Changed]).items.length, 0);
    }
    Assert.equal(Catalog([Item(1, 2), Item(1, 2)]).items.length, 1);
});
Test('Beats clothing never substitutes unrelated clothes or unlocks unavailable story rewards', () => {
    const Value = Catalog([Item(1, 2), Item(2, 0, 2, { content: ['tshirt_ss_storymode_2kbeats'], availability: 8 }), Item(3, 0, 19)]);
    Assert.deepEqual(Rows(Value, 'BEATS_CLOTHING'), []);
    Assert.deepEqual(Rows(Value, 'BEATS_HEADPHONES').map(Row => Row.item_id), [3]);
    Assert.ok(!Value.items.some(Row => Row.item_id === 2));
});
Test('retail catalog: all stores are tagged and brand-isolated without losing general shop coverage', () => {
    const Document = require('../Source/Storage/StoreCatalog2K22').ReadDocument(
        require('node:path').join(__dirname, '../Storage/Inventory/StoreCatalog2K22.json'));
    const Value = new StoreCatalog2K22(Document);
    Assert.equal(Document.resourceValidationVersion, 1);
    Assert.equal(Document.items.length, 40804, 'retain native rows for provenance, filter only sale views');
    Assert.equal(Value.items.length, 25974);
    const Kept = new Set(Value.items.map(Row => Row.item_id));
    Assert.ok(Kept.has(0x7F530229), 'wearable Clippers shorts survive a missing thumbnail');
    Assert.ok(Kept.has(0x32D2CB15), 'wearable Adidas shirt survives a missing name');
    Assert.ok(!Kept.has(0xDF11BA98), 'BAPE thumbnail is not proof of wearable content');
    Assert.ok(!Kept.has(0xEF3B08C2), 'missing Kings cap content is excluded');
    for (const Raw of Document.items.filter(Row => Kept.has(Number(Row.item)))) {
        Assert.ok(Raw.resources.name || Raw.resources.thumbnail, Raw.item);
        if ([2, 4, 5].includes(Raw.itemType)) Assert.equal(Raw.resources.content, true, Raw.item);
    }
    const Source = new Map(Document.items.map(Row => [Number(Row.item), Row]));
    const SingleBrands = { ADIDAS_STORES: 'ADIDAS', CONVERSE_STORE: 'CONVERSE', JORDAN_STORE: 'JORDAN',
        NEW_BALANCE_STORE: 'NEWBALANCE', NIKE_STORE: 'NIKE', PUMA_STORE: 'PUMA', UNDERARMOUR_STORE: 'UNDERARMOUR', PARK_AFTER_DARK: 'PARKAFTERDARK' };
    for (const Store of StoreDefinitions) {
        const Actual = Rows(Value, Store.Root);
        if (Store.Root === 'BEATS_CLOTHING') Assert.equal(Actual.length, 0);
        else Assert.ok(Actual.length > 0, Store.Root);
        const Pages = Layout.LayoutDocument(Value)[Store.Root];
        const Cells = Pages.flat(2);
        Assert.deepEqual(Cells.map(Cell => Cell.tag), Store.Cells.filter(Cell =>
            Actual.some(Row => Row.tag_crcs.includes(Crc32(Cell.Tag)))).map(Cell => Cell.Tag));
        Assert.equal(Pages.length, Math.ceil(Cells.length / 6));
        for (const Page of Pages) {
            Assert.ok(Page.length >= 1 && Page.length <= 2);
            for (const Column of Page) Assert.ok(Column.length >= 1 && Column.length <= 3);
        }
        for (const Row of Actual) {
            Assert.equal(Cells.filter(Cell => Row.tag_crcs.includes(Crc32(Cell.tag))).length, 1, `${Store.Root}/${Row.item_id}`);
            const Raw = Source.get(Row.item_id);
            if (SingleBrands[Store.Root]) Assert.equal(BrandForItem(Raw), SingleBrands[Store.Root], Store.Root);
            if (Store.NbaOnly) Assert.ok(IsNbaItem(Raw));
            Assert.equal(Row.price, Raw.originPrice);
        }
        if (['SWAGS', 'FOOTLOCKER', 'SPORTING_GOODS_STORE'].includes(Store.Root)) {
            const Expected = Value.items.filter(Row => Store.Groups.some(Name => Groups[Name].ItemType === Source.get(Row.item_id).itemType));
            Assert.deepEqual(Actual.map(Row => Row.item_id), Expected.map(Row => Row.item_id));
            for (const Cell of Store.Cells.filter(Cell => Cell.Brand)) {
                const Eligible = Expected.some(Row => {
                    const Raw = Source.get(Row.item_id);
                    const Brand = BrandForItem(Raw);
                    return (Cell.Brand === 'OTHER' ? !Cell.OtherThan.includes(Brand) : Brand === Cell.Brand) &&
                        Cell.Groups.some(Name => Groups[Name].ItemType === Raw.itemType);
                });
                Assert.equal(Actual.some(Row => Row.tag_crcs.includes(Crc32(Cell.Tag))), Eligible,
                    `${Store.Root}: filtered brand ${Cell.Title}`);
            }
        }
    }
    for (const Entry of ResourceBrands) {
        Assert.ok(Document.items.some(Row => Row.content.some(Resource => Entry.Pattern.test(Resource.split(/[\\/]/).at(-1)))));
    }
});

Test('retail layout removes empty Nike/Puma accessories and BAPE without removing stocked cells', () => {
    const Value = require('../Source/Storage/StoreCatalog2K22').LoadFile(
        require('node:path').join(__dirname, '../Storage/Inventory/StoreCatalog2K22.json'));
    const Document = Layout.LayoutDocument(Value);
    for (const Brand of ['NIKE', 'PUMA']) {
        Assert.deepEqual(Document[`${Brand}_STORE`].flat(2).map(Cell => Cell.tag),
            ['CLOTHING', 'SHOES'].map(Type => `GRANITE:STORE:${Brand}_STORE:BRAND:${Brand}:${Type}`));
    }
    Assert.ok(!Document.SWAGS.flat(2).some(Cell => Cell.tag.endsWith(':BAPE')));
    Assert.deepEqual(Document.BEATS_CLOTHING, []);
});

Test('layout packet uses context catalog, repacks pages and isolates cached catalogs', () => {
    const Raw = [Item(1, 2), Item(2, 24, 5)];
    const Value = Catalog(Raw);
    const Empty = Catalog([]);
    function DecodeLayout(Reply) {
        const Parsed = Parse(Reply.Body);
        const BufferValue = Zlib.inflateSync(GetField(Parsed.Fields, Layout.Fields.LayoutJsonCompressed).Raw);
        Assert.equal(BigInt(BufferValue.length), GetU64(Parsed.Fields, Layout.Fields.LayoutJsonSize));
        Assert.equal(BufferValue.at(-1), 0);
        return JSON.parse(BufferValue.subarray(0, -1));
    }
    const Reply = Layout.Build({}, { StoreCatalog2K22: Value });
    Assert.equal(Layout.Build({}, { StoreCatalog2K22: Value }), Reply);
    const Document = DecodeLayout(Reply);
    Assert.deepEqual(Document, Layout.LayoutDocument(Value));
    Assert.equal(Document.NIKE_STORE.flat(2).length, 1);
    Assert.equal(Document.PUMA_STORE.flat(2).length, 1);
    const EmptyReply = Layout.Build({}, { StoreCatalog2K22: Empty });
    Assert.notEqual(EmptyReply, Reply);
    Assert.ok(Object.values(DecodeLayout(EmptyReply)).every(Pages => Pages.length === 0));
    Assert.equal(Layout.Build({}, { StoreCatalog2K22: Value }), Reply);
    Assert.ok(DecodeLayout(Layout.Build()).SWAGS.flat(2).length > Document.SWAGS.flat(2).length,
        'no-catalog legacy fallback must not poison catalog-specific cache');
});

Test('empty cells reflect resource, availability, price and ID-conflict filtering', () => {
    const Good = { name: true, thumbnail: false, content: true };
    const Raw = [Item(1, 2, 2, { resources: Good }),
        Item(2, 2, 4, { resources: Good, availability: 8 }),
        Item(3, 2, 5, { resources: Good, price: -1 }),
        Item(4, 24, 2, { resources: { ...Good, content: false } }),
        Item(5, 24, 5, { resources: { name: false, thumbnail: false, content: true } }),
        Item(6, 2, 4, { resources: Good }), Item(6, 24, 4, { resources: Good })];
    const Value = new StoreCatalog2K22({ source: 'NBA2K22_MANIFEST_STORE_BINARY_DATA', typeHash: '0x67AF5087',
        recordSizeBytes: 416, priceFieldsDecoded: true, version: 1, resourceValidationVersion: 1, items: Raw });
    const Document = Layout.LayoutDocument(Value);
    Assert.deepEqual(Value.items.map(Row => Row.item_id), [1]);
    Assert.deepEqual(Document.NIKE_STORE.flat(2).map(Cell => Cell.tag), ['GRANITE:STORE:NIKE_STORE:BRAND:NIKE:CLOTHING']);
    Assert.deepEqual(Document.PUMA_STORE, []);
});
