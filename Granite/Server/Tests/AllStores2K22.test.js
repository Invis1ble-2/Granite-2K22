// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Zlib = require('node:zlib');
const { Builder, Parse, GetField, GetU64 } = require('../Source/Codec/FieldList');
const { Crc32 } = require('../Source/Core/Crc32');
const { Groups, StoreDefinitions } = require('../Source/Services/Store/StoreDefinitions2K22');
const Layout = require('../Source/Services/Store/GetLayout');
const Overview = require('../Source/Services/Store/GetOverview');
const Items = require('../Source/Services/Store/GetItems');
const { StoreCatalog2K22, Fields, StoreTagCrcs } = require('../Source/Storage/StoreCatalog2K22');
const Wire = require('../Source/Services/Store/Wire2K22');

function Request(Page, Tail = 0) {
    const { Body } = new Builder().AddString16(0x952ef509, Page).Build();
    Body.writeUInt32BE((Page.length + 1) * 2, 12); // Captured 2K22 byte count, not the legacy Builder convention.
    Body.writeUInt16BE(Tail, Body.length - 2);
    return { Body, Parsed: Parse(Body) };
}
function NativeItem(Type, Changes = {}) {
    return { item: Type * 1000, itemType: Type, name: `Native Type ${Type}`, subName: '',
        originPrice: 500, price: 500, currency: 0, availability: 0, content: ['native_resource'],
        rawWords: { '0x194': '0x00C00000' }, ...Changes };
}
function Catalog(Rows) {
    return new StoreCatalog2K22({ source: 'NBA2K22_MANIFEST_STORE_BINARY_DATA', typeHash: '0x67AF5087',
        recordSizeBytes: 0x1a0, priceFieldsDecoded: true, version: 1, items: Rows });
}
function Decode(Reply) {
    const Parsed = Parse(Reply.Body);
    const Raw = Zlib.inflateSync(GetField(Parsed.Fields, Fields.Items).Raw);
    Assert.equal(BigInt(Raw.length), GetU64(Parsed.Fields, Fields.UncompressedSize));
    Assert.equal(Raw.at(-1), 0);
    Assert.ok(GetU64(Parsed.Fields, Fields.Version) > 0n);
    Assert.equal(GetField(Parsed.Fields, 0x31de3808), null);
    return JSON.parse(Raw.subarray(0, -1));
}

Test('all HTTP store roots match the complete native CRC table, excluding the local barber', () => {
    // Memory bytes read at 0x142412160; BARBERSHOP is slot 7.
    const Native = Buffer.from('f5df8480664b49d347d51e09916d36e762f52afda3d523c594a34bf93a4146d2e9f0456b45622935ed4093e5066b5418047b18aaa4b9f5400e9446014cdef94029e9efee30869aaa', 'hex');
    const Expected = Array.from({ length: 18 }, (_, I) => Native.readUInt32LE(I * 4)).filter((_, I) => I !== 7);
    Assert.deepEqual(StoreDefinitions.map(Store => Crc32(Store.Root)), Expected);
    Assert.deepEqual(StoreDefinitions.map(Store => Store.NativeRootCrc), Expected);
    Assert.equal(new Set(StoreDefinitions.map(Store => Store.Page)).size, 17);
    Assert.equal(Layout.LayoutDocument().BARBERSHOP, undefined);
    Assert.equal(Crc32('ADIDAS_STORES'), 0x35296245);
    Assert.equal(Crc32('SPORTING_GOODS_STORE'), 0x40f9de4c);
});

const AllItems = Object.values(Groups).map(Group => NativeItem(Group.ItemType,
    Group.RequiresContent ? {} : { content: [] }));
const AllCatalog = Catalog(AllItems);
for (const Store of StoreDefinitions) {
    Test(`${Store.Root} returns the exact eligible catalog with matching layout tags`, () => {
        const Input = Request(Store.Page);
        const Rows = Decode(Items.Build(Input, { StoreCatalog2K22: AllCatalog }));
        const EmptyForPumaFixture = ['BEATS_CLOTHING', 'ADIDAS_STORES', 'CONVERSE_STORE', 'JORDAN_STORE',
            'NEW_BALANCE_STORE', 'NIKE_STORE', 'UNDERARMOUR_STORE', 'PARK_AFTER_DARK'].includes(Store.Root);
        const Expected = EmptyForPumaFixture ? [] : AllItems.filter(Item => Store.Groups.some(Name => Groups[Name].ItemType === Item.itemType));
        Assert.deepEqual(Rows.map(Row => Row.item_id), Expected.map(Item => Item.item));
        Assert.ok(GetField(Parse(Overview.Build(Input).Body).Fields, Overview.Fields.Available).value);
        const Cells = Layout.LayoutDocument(AllCatalog)[Store.Root].flat(2);
        Assert.equal(Cells.length, Store.Cells.filter(Cell => Rows.some(Row => Row.tag_crcs.includes(Crc32(Cell.Tag)))).length);
        for (const Cell of Cells) Assert.ok(Rows.some(Row => Row.tag_crcs.includes(Crc32(Cell.tag))));
        for (const Row of Rows) {
            Assert.ok(Cells.some(Cell => Row.tag_crcs.includes(Crc32(Cell.tag))), String(Row.item_id));
        }
        Assert.deepEqual(Rows.map(Row => Row.price), Rows.map(() => 500));
        const Reply = Items.Build(Input, { StoreCatalog2K22: AllCatalog });
        const Static = AllCatalog.GetReplyForPage(Store.Page);
        Assert.notEqual(Reply, Static, 'account envelope is not the shared catalog packet');
        Assert.deepEqual(Decode(Reply), Decode(Static), 'reuse the same catalog contents and version');
        const ReplyFields = Parse(Reply.Body).Fields;
        Assert.equal(GetU64(ReplyFields, Fields.Version), GetU64(Parse(Static.Body).Fields, Fields.Version));
        Assert.deepEqual(JSON.parse(Zlib.inflateSync(GetField(ReplyFields, Wire.Fields.Inventory).value).toString().replace(/\0+$/, '')), []);
        Assert.equal(GetField(Parse(Static.Body).Fields, Wire.Fields.Inventory), null, 'shared cache stays account-free');
        Assert.equal(GetField(Parse(Items.Build(Input).Body).Fields, Fields.Items), null, 'no implicit catalog');
    });
}

Test('contentless native consumables and sporting goods do not bypass content checks for clothing', () => {
    const CatalogValue = Catalog([
        NativeItem(22, { content: [] }), NativeItem(25, { content: [] }), NativeItem(26, { content: [] }),
        NativeItem(2, { content: [] }), NativeItem(24, { content: [] }), NativeItem(9, { content: [] }),
        NativeItem(22, { item: 22001, price: -1, content: [] }),
        NativeItem(22, { item: 22002, currency: 1, content: [] }),
        NativeItem(22, { item: 22003, availability: 3, content: [] }),
    ]);
    Assert.deepEqual(CatalogValue.items.map(Row => Row.item_id), [22000, 25000, 26000]);
    Assert.equal(CatalogValue.GetPrice(22000), null, 'Gatorade remains on its dedicated VC purchase route');
    const Rows = Decode(CatalogValue.GetReplyForPage('PAGE:TKWORLD_GATORADE_STORE'));
    Assert.deepEqual(Rows[0].tag_crcs, [Crc32('PAGE:TKWORLD_GATORADE_STORE')]);
    Assert.equal(StoreTagCrcs.Gatorade, Crc32('PAGE:TKWORLD_GATORADE_STORE'));
    Assert.equal(CatalogValue.GetReplyForPage('PAGE:TKWORLD_BARBERSHOP'), null);
});

Test('captured NBA non-ASCII tail is ignored but unknown ASCII suffixes stay closed', () => {
    const Input = Request('PAGE:TKWORLD_NBA_STORE', 0xf47f);
    Assert.equal(Overview.RequestedPage(Input), 'PAGE:TKWORLD_NBA_STORE');
    Assert.equal(Decode(Items.Build(Input, { StoreCatalog2K22: AllCatalog })).length, 2);
    for (const Page of ['PAGE:TKWORLD_NBA_STORE_UNKNOWN', 'PAGE:COULD_BE_ANYTHING', 'TYPE:BOOSTS', 'PAGE:UNKNOWN']) {
        const Unknown = Request(Page);
        Assert.equal(GetField(Parse(Overview.Build(Unknown).Body).Fields, Overview.Fields.Available).Data1, 0);
        Assert.equal(GetField(Parse(Items.Build(Unknown, { StoreCatalog2K22: AllCatalog }).Body).Fields, Fields.Items), null);
    }
    for (const [Offset, Length] of [[-1, 2], [0, 3], [0, 514], [0, 500]]) {
        Assert.equal(Overview.RequestedPage({ Parsed: {
            Fields: [{ Crc: 0x952ef509, Type: 0x7a4d534c, Data1: Offset, Data2: Length }], Data: Buffer.alloc(32),
        } }), null);
    }
});

Test('Puma now has only its own apparel while Foot Locker stays shoe-only', () => {
    const Shoes = Decode(AllCatalog.GetReplyForPage('PAGE:TKWORLD_PUMA_STORE'));
    Assert.deepEqual(Shoes.map(Row => Row.item_id), [2000, 4000, 5000]);
    Assert.deepEqual(Decode(AllCatalog.GetShoeStoreReply()).map(Row => Row.item_id), [5000]);
    const Clothing = Decode(AllCatalog.GetClothingStoreReply());
    Assert.deepEqual(Clothing.map(Row => Row.item_id), [2000, 4000]);
    Assert.notEqual(GetU64(Parse(AllCatalog.GetShoeStoreReply().Body).Fields, Fields.Version),
        GetU64(Parse(AllCatalog.GetClothingStoreReply().Body).Fields, Fields.Version));
});
