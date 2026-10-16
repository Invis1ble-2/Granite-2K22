// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Zlib = require('node:zlib');
const { Builder, Parse, GetField, GetU64 } = require('../Source/Codec/FieldList');
const { Crc32 } = require('../Source/Core/Crc32');
const Prices = require('../Source/Services/VirtualCurrency/GetPrices');
const Layout = require('../Source/Services/Store/GetLayout');
const Items = require('../Source/Services/Store/GetItems');
const Overview = require('../Source/Services/Store/GetOverview');

Test('store price completion includes the mandatory native date without clearing local shoes', () => {
    const Res = Parse(Items.Build({}).Body);
    Assert.equal(GetField(Res.Fields, 0x31de3808).Type, 0x55c05a86);
    Assert.equal(GetField(Res.Fields, Crc32('RESULT')).Data1, 0x504521a8);
    Assert.equal(GetField(Res.Fields, 0x9cc95621), null);
    Assert.equal(GetField(Res.Fields, 3440963264), null);
    Assert.equal(require('../Source/Services/Ida2K19/Registry').ByEndpointId.get(0x25e937ad), Items);
});

Test('store price updates round-trip all repeated items across compressed native blocks', () => {
    const VcPrices = new Map(
        Array.from({ length: 513 }, (_, I) => [
            0x12340000 + I,
            { price: 1000n + BigInt(I), finalPrice: 500n + BigInt(I) },
        ]),
    );
    const Res = Parse(Items.Build({}, { VcPrices }).Body);
    const Blobs = Res.Fields.filter((Field) => Field.Crc === 0x9cc95621);
    Assert.equal(Blobs.length, 2);
    const Seen = [];
    Blobs.forEach((BlobData, Index) => {
        Assert.equal(BlobData.Type, 0x36182e83);
        const Raw = Zlib.inflateSync(BlobData.Raw);
        Assert.equal(BigInt(Raw.length), GetU64(Res.Fields, 0x634465d8, Index));
        const Block = Parse(Raw).Fields;
        const ItemsValue = Block.filter((Field) => Field.Crc === 0xfd76cfbd);
        Assert.equal(ItemsValue.length, Index === 0 ? 512 : 1);
        ItemsValue.forEach((Item, Occurrence) => {
            Assert.equal(Item.Type, 0x1423add2);
            for (const Crc of [0x3d9ce069, 0x417fe697]) Assert.equal(GetField(Block, Crc, Occurrence).Type, 0x3d9e5089);
            const Entry = VcPrices.get(Item.Data1);
            Assert.equal(GetU64(Block, 0x3d9ce069, Occurrence), Entry.price);
            Assert.equal(GetU64(Block, 0x417fe697, Occurrence), Entry.finalPrice);
            Seen.push(Item.Data1);
        });
    });
    Assert.deepEqual(Seen, [...VcPrices.keys()]);
    for (const Price of [-1n, 0x3ffffffn, 1n << 32n])
        Assert.throws(() => Items.Build({}, { VcPrices: new Map([[1, Price]]) }), /store price/);
});

const PriceRequest = Buffer.from(
    '027d051d1423add2964fa1d3f47f00000510c1041423add2ef9195dbf47f0000' +
        '3ce0fdc51423add2e73a8cecd920005a4be7cd531423add22340036ff47f0000' +
        '7217f1921423add2d954229300000000757a358b1423add2a2c20dc400000008' +
        '95afdc951423add2f0953d2ace20005a9b7454a71423add2066a8838007f0003' +
        '9c1990be1423add23d7eda62d300005aa28468661423add2f03defa4f47f0000' +
        'a5e9ac7f1423add29171446cf47f0007ab66f4033d9e50890000000000000000' +
        'd2ee9ce91423add2b0d807c9f47f0000e2a8ec031423add2a2e1947d00000000' +
        'e9e10b1e1423add24905ed7b00000008eb1ea0281423add260933b95ce20005a' +
        'ec7364311423add2ef15fdab6400000200000000000000000000000000000000',
    'hex',
);

Test('captured 15-item price request produces native StringCrc identities and U64 amounts', () => {
    const Req = Parse(PriceRequest);
    const Context = { VcPrices: new Map() };
    const Reply = Prices.Build({ Parsed: Req }, Context);
    const Res = Parse(Reply.Body);
    Assert.equal(Res.Fields.length, 15 * 5 + 1);
    for (let I = 0; I < 15; I++) {
        const Id = GetField(Req.Fields, Crc32(`ITEM_${I}`)).Data1;
        const Echo = GetField(Res.Fields, Crc32(`ITEM_${I}`));
        Assert.equal(Echo.Type, 0x1423add2);
        Assert.equal(Echo.Data1, Id);
        for (const Column of ['PRICE', 'FINAL_PRICE', 'MYTEAM_PRICE', 'FINAL_MYTEAM_PRICE']) {
            const Field = GetField(Res.Fields, Crc32(`${Column}_${I}`));
            Assert.equal(Field.Type, 0x3d9e5089);
            Assert.equal(Field.Data1, 0);
            Assert.equal(Field.Data2, 100 + I * 25);
            Assert.equal(GetU64([Field], Field.Crc), Context.VcPrices.get(Id).price);
        }
    }
    const Again = Parse(Prices.Build({ Parsed: Req }, Context).Body);
    Assert.deepEqual(Again.Fields, Res.Fields);
});

Test('prices keep configured amounts and support empty and maximum-size requests', () => {
    const Configured = 12345n;
    const Context = { VcPrices: new Map([[0x12345678, { price: Configured }]]) };
    const Req = new Builder();
    for (let I = 0; I < 513; I++) Req.AddStringCrc(Crc32(`ITEM_${I}`), 0x12345678 + I);
    const Res = Parse(Prices.Build({ Parsed: Parse(Req.Build().Body) }, Context).Body);
    Assert.equal(Res.Fields.length, 512 * 5 + 1);
    Assert.equal(GetU64(Res.Fields, Crc32('FINAL_PRICE_0')), Configured);
    Assert.equal(GetField(Res.Fields, Crc32('ITEM_512')), null);
    Assert.equal(Parse(Prices.Build({ Parsed: Parse(new Builder().Build().Body) }).Body).Fields.length, 1);
});

const { StoreDefinitions, Groups } = require('../Source/Services/Store/StoreDefinitions2K22');
const StoreRoots = new Set(StoreDefinitions.map(Store => Store.Root));

Test('layout inflates into bounded native pages, rows and recognized category cells', () => {
    const Reply = Layout.Build();
    const Res = Parse(Reply.Body);
    const Size = GetField(Res.Fields, 0x6cb1bd26);
    const BlobData = GetField(Res.Fields, 0xe1e79306);
    Assert.equal(Size.Type, 0x3d9e5089);
    Assert.equal(BlobData.Type, 0x36182e83);
    const Raw = Zlib.inflateSync(BlobData.Raw);
    Assert.equal(BigInt(Raw.length), GetU64(Res.Fields, 0x6cb1bd26));
    Assert.equal(Raw.at(-1), 0);
    const LayoutData = JSON.parse(Raw.subarray(0, -1).toString('utf8'));
    Assert.deepEqual(Object.keys(LayoutData), [...StoreRoots]);
    for (const [Store, Pages] of Object.entries(LayoutData)) {
        Assert.ok(StoreRoots.has(Store));
        const Definition = StoreDefinitions.find(Definition => Definition.Root === Store);
        Assert.equal(Pages.length, Math.ceil(Definition.Cells.length / 6));
        for (const Page of Pages) {
            Assert.ok(Page.length > 0 && Page.length <= 2);
            Assert.ok(Page.every(Row => Row.length > 0 && Row.length <= 3));
        }
        const Cells = Pages.flat(2);
        Assert.equal(Cells.length, Definition.Cells.length);
        for (const Cell of Cells) {
            Assert.equal(Cell.store_type, Store);
            Assert.equal(Cell.cell_size, 'ONE_BY_ONE');
            Assert.equal(Crc32(Cell.cell_size), 0xd9fcbd59);
            Assert.equal(Cell.cell_type, 'TAG');
            Assert.equal(Cell.flag, 'NONE');
            Assert.equal(Crc32(Cell.flag), 0x4905ed7b);
            Assert.equal(Cell.description, '');
            Assert.equal(Cell.logo_guid, '');
            Assert.ok(Cell.title.length > 0 && Cell.title.length < 64);
            Assert.ok(Definition.Cells.some(Defined => Defined.Tag === Cell.tag && Defined.Title === Cell.title));
            Assert.ok(!Cell.title.startsWith('Local '));
        }
    }
    Assert.equal(Reply.FieldListSize, Reply.Body.length);
});

function OverviewInput(Page) {
    const { Body } = new Builder().AddString16(0x952ef509, Page).Build();
    Body.writeUInt32BE((Page.length + 1) * 2, 12); // Native request length is bytes.
    return { Body, Parsed: Parse(Body) };
}

Test('2K22 native local-store overview pages are enabled without inventing online item counts', () => {
    for (const Page of Overview.LocalStorePages) {
        const Reply = Parse(Overview.Build(OverviewInput(Page)).Body).Fields;
        Assert.equal(GetField(Reply, Overview.Fields.Available).Data1, 1, Page);
        Assert.equal(GetU64(Reply, Overview.Fields.Count), 0n, 'no server-side extra items are advertised');
        Assert.equal(GetU64(Reply, Overview.Fields.CacheSeconds), 60n);
    }
    for (const Page of ['TYPE:BOOSTS', 'PAGE:COULD_BE_ANYTHING', 'PAGE:UNKNOWN']) {
        const Reply = Parse(Overview.Build(OverviewInput(Page)).Body).Fields;
        Assert.equal(GetField(Reply, Overview.Fields.Available).Data1, 0, Page);
    }
    Assert.equal(GetField(Parse(Overview.Build().Body).Fields, Overview.Fields.Available).Data1, 0);
});
