// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const Os = require('node:os');
const Zlib = require('node:zlib');

const { Builder, Parse, GetField, GetU64 } = require('../Source/Codec/FieldList');
const { Crc32 } = require('../Source/Core/Crc32');
const {
    StoreTags,
    StoreTagCrcs,
    StoreCatalog2K22,
    LoadCatalog2K22,
    VerifyDiscount,
    BuildCatalogPacket,
    Fields,
} = require('../Source/Storage/StoreCatalog2K22');
const StoreItems = require('../Source/Services/Store/GetItems');
const StoreOverview = require('../Source/Services/Store/GetOverview');
const Server = require('../Source/Server');

function MakeOverviewInput(Page) {
    const { Body } = new Builder().AddString16(0x952ef509, Page).Build();
    Body.writeUInt32BE((Page.length + 1) * 2, 12);
    return { Body, Parsed: Parse(Body) };
}

function ValidCatalogDoc(items = []) {
    return {
        version: 1,
        source: 'NBA2K22_MANIFEST_STORE_BINARY_DATA',
        typeHash: '0x67AF5087',
        recordSizeBytes: 0x1a0,
        priceFieldsDecoded: true,
        manifestSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        items,
    };
}

Test('StoreCatalog2K22 rejects unverified metadata and non-decoded price fields', () => {
    Assert.throws(
        () => new StoreCatalog2K22({ ...ValidCatalogDoc(), source: 'INVALID_SOURCE' }),
        /invalid 2K22 store catalog source/,
    );
    Assert.throws(
        () => new StoreCatalog2K22({ ...ValidCatalogDoc(), typeHash: '0x00000000' }),
        /invalid 2K22 store catalog typeHash/,
    );
    Assert.throws(
        () => new StoreCatalog2K22({ ...ValidCatalogDoc(), recordSizeBytes: 0x200 }),
        /invalid 2K22 store catalog recordSizeBytes/,
    );
    Assert.throws(
        () => new StoreCatalog2K22({ ...ValidCatalogDoc(), priceFieldsDecoded: false }),
        /priceFieldsDecoded: true/,
    );
    Assert.throws(
        () => new StoreCatalog2K22({ ...ValidCatalogDoc(), items: 'not an array' }),
        /items must be an array/,
    );
});

Test('StoreCatalog2K22 packet decompression, NUL termination, uncompressed size and non-zero version', () => {
    const RawItem = {
        item: '0x10000001',
        name: 'Test Shirt',
        subName: 'Cotton Tee',
        originPrice: 1000,
        price: 800,
        currency: 0,
        itemType: 2,
        availability: 0,
        thumbnail: 'thumb1.iff',
        content: ['clothing/shirt.iff'],
    };
    const Catalog = new StoreCatalog2K22(ValidCatalogDoc([RawItem]));
    Assert.equal(Catalog.version, 0x0123456789abcdefn);

    const Reply = Catalog.GetClothingStoreReply();
    const Parsed = Parse(Reply.Body);
    Assert.equal(GetField(Parsed.Fields, Crc32('RESULT')).Data1, Crc32('SUCCESS'));

    const VersionField = GetField(Parsed.Fields, Fields.Version);
    Assert.ok(VersionField);
    Assert.equal(GetU64(Parsed.Fields, Fields.Version), GetU64(Parse(Catalog.GetClothingStoreReply().Body).Fields, Fields.Version));
    Assert.notEqual(GetU64(Parsed.Fields, Fields.Version), 0n);

    const SizeField = GetField(Parsed.Fields, Fields.UncompressedSize);
    Assert.ok(SizeField);
    const SizeVal = GetU64(Parsed.Fields, Fields.UncompressedSize);

    const BlobField = GetField(Parsed.Fields, Fields.Items);
    Assert.ok(BlobField);
    const Uncompressed = Zlib.inflateSync(BlobField.Raw);

    Assert.equal(BigInt(Uncompressed.length), SizeVal);
    Assert.equal(Uncompressed.at(-1), 0, 'payload must be NUL terminated');

    const JsonStr = Uncompressed.subarray(0, -1).toString('utf8');
    const Items = JSON.parse(JsonStr);
    Assert.equal(Items.length, 1);
    Assert.equal(Items[0].item_id, 0x10000001);
    Assert.equal(Items[0].price, 1000);
    Assert.deepEqual(Items[0].tag_crcs, [StoreTagCrcs.Clothing,
        Crc32('GRANITE:STORE:SWAGS:BRAND:OTHER'), Crc32('GRANITE:STORE:SPORTING_GOODS_STORE:BRAND:OTHER')]);
    Assert.equal(Items[0].name, 'Test Shirt');
    Assert.equal(Items[0].desc, 'Cotton Tee');
    Assert.ok(typeof Items[0].discount === 'number');
});

Test('StoreCatalog2K22 filters invalid items, non-VC currency, unavailable items, and bad prices', () => {
    const RawItems = [
        // Valid clothing
        {
            item: '0x00000001',
            name: 'Valid Shirt',
            originPrice: 500,
            price: 500,
            currency: 0,
            itemType: 2,
            availability: 0,
            content: ['guid1.iff'],
        },
        // Invalid ID: 0
        {
            item: '0x00000000',
            name: 'Bad ID 0',
            originPrice: 500,
            price: 500,
            currency: 0,
            itemType: 2,
            availability: 0,
            content: ['guid1.iff'],
        },
        // Invalid ID: 0xFFFFFFFF
        {
            item: '0xFFFFFFFF',
            name: 'Bad ID FFFF',
            originPrice: 500,
            price: 500,
            currency: 0,
            itemType: 2,
            availability: 0,
            content: ['guid1.iff'],
        },
        // Non-VC currency (3)
        {
            item: '0x00000002',
            name: 'Non VC',
            originPrice: 500,
            price: 500,
            currency: 3,
            itemType: 2,
            availability: 0,
            content: ['guid1.iff'],
        },
        // Unavailable item (availability: 3, 5, 8, etc.)
        {
            item: '0x00000003',
            name: 'Unavailable 3',
            originPrice: 500,
            price: 500,
            currency: 0,
            itemType: 2,
            availability: 3,
            content: ['guid1.iff'],
        },
        {
            item: '0x00000004',
            name: 'Unavailable 8',
            originPrice: 500,
            price: 500,
            currency: 0,
            itemType: 2,
            availability: 8,
            content: ['guid1.iff'],
        },
        // Unsupported itemType (e.g. 1 or 6)
        {
            item: '0x00000005',
            name: 'Unsupported Type',
            originPrice: 500,
            price: 500,
            currency: 0,
            itemType: 1,
            availability: 0,
            content: ['guid1.iff'],
        },
        // Empty content GUID
        {
            item: '0x00000006',
            name: 'Empty Content',
            originPrice: 500,
            price: 500,
            currency: 0,
            itemType: 2,
            availability: 0,
            content: [],
        },
        // Negative / abnormal price (from signed26 decode)
        {
            item: '0x00000007',
            name: 'Negative Price',
            originPrice: -100,
            price: -100,
            currency: 0,
            itemType: 2,
            availability: 0,
            content: ['guid1.iff'],
        },
        // Final price > origin price
        {
            item: '0x00000008',
            name: 'Final Greater Origin',
            originPrice: 100,
            price: 200,
            currency: 0,
            itemType: 2,
            availability: 0,
            content: ['guid1.iff'],
        },
        // Price exceeds 2^25
        {
            item: '0x00000009',
            name: 'Price Too High',
            originPrice: 0x02000000,
            price: 0x02000000,
            currency: 0,
            itemType: 2,
            availability: 0,
            content: ['guid1.iff'],
        },
    ];

    const Catalog = new StoreCatalog2K22(ValidCatalogDoc(RawItems));
    Assert.equal(Catalog.items.length, 1);
    Assert.equal(Catalog.items[0].item_id, 1);
});

Test('StoreCatalog2K22 deduplication merges exact duplicates and excludes conflicting item IDs', () => {
    const RawItems = [
        // Duplicate identical items: ID 0x10
        {
            item: '0x00000010',
            name: 'Identical Item',
            subName: 'A',
            originPrice: 200,
            price: 200,
            currency: 0,
            itemType: 2,
            availability: 0,
            thumbnail: 'thumb.iff',
            content: ['guid.iff'],
        },
        {
            item: '0x00000010',
            name: 'Identical Item',
            subName: 'A',
            originPrice: 200,
            price: 200,
            currency: 0,
            itemType: 2,
            availability: 0,
            thumbnail: 'thumb.iff',
            content: ['guid.iff'],
        },
        // Conflicting items: ID 0x20 with different prices
        {
            item: '0x00000020',
            name: 'Conflict Item',
            subName: 'Original',
            originPrice: 300,
            price: 300,
            currency: 0,
            itemType: 2,
            availability: 0,
            thumbnail: 'thumb.iff',
            content: ['guid.iff'],
        },
        {
            item: '0x00000020',
            name: 'Conflict Item',
            subName: 'Conflicting Price',
            originPrice: 400,
            price: 400,
            currency: 0,
            itemType: 2,
            availability: 0,
            thumbnail: 'thumb.iff',
            content: ['guid.iff'],
        },
        // Unique item: ID 0x30
        {
            item: '0x00000030',
            name: 'Unique Item',
            subName: 'C',
            originPrice: 500,
            price: 500,
            currency: 0,
            itemType: 5,
            availability: 0,
            thumbnail: 'thumb.iff',
            content: ['guid.iff'],
        },
    ];

    const Catalog = new StoreCatalog2K22(ValidCatalogDoc(RawItems));
    Assert.equal(Catalog.items.length, 2);
    Assert.equal(Catalog.items[0].item_id, 0x10);
    Assert.equal(Catalog.items[1].item_id, 0x30);
    Assert.equal(Catalog.items.some((i) => i.item_id === 0x20), false, 'conflicted item 0x20 must be excluded');
});

Test('StoreCatalog2K22 tag assignment and store category isolation', () => {
    const RawItems = [
        {
            item: '0x00000101',
            name: 'Clothing Item',
            originPrice: 100,
            price: 100,
            currency: 0,
            itemType: 2,
            availability: 0,
            content: ['c.iff'],
        },
        {
            item: '0x00000102',
            name: 'Accessory Item',
            originPrice: 150,
            price: 150,
            currency: 0,
            itemType: 4,
            availability: 0,
            content: ['a.iff'],
        },
        {
            item: '0x00000103',
            name: 'Shoe Item',
            originPrice: 200,
            price: 200,
            currency: 0,
            itemType: 5,
            availability: 0,
            content: ['s.iff'],
        },
    ];

    const Catalog = new StoreCatalog2K22(ValidCatalogDoc(RawItems));
    Assert.equal(Catalog.clothingStoreItems.length, 2);
    Assert.equal(Catalog.clothingStoreItems[0].tag_crcs[0], StoreTagCrcs.Clothing);
    Assert.equal(Catalog.clothingStoreItems[1].tag_crcs[0], StoreTagCrcs.Accessories);

    Assert.equal(Catalog.shoeStoreItems.length, 1);
    Assert.equal(Catalog.shoeStoreItems[0].tag_crcs[0], StoreTagCrcs.Shoes);
});

Test('StoreCatalog2K22 discount precision and client simulation', () => {
    // When final == origin: no discount field
    const CheckNoDiscount = VerifyDiscount(1000, 1000);
    Assert.equal(CheckNoDiscount.valid, true);
    Assert.equal(CheckNoDiscount.discount, null);

    // Standard discount: 1000 -> 800 (20%)
    const Check20 = VerifyDiscount(1000, 800);
    Assert.equal(Check20.valid, true);
    Assert.ok(typeof Check20.discount === 'number');
    const Factor20 = Math.fround(1 - Check20.discount);
    Assert.equal(Math.round(Math.fround(1000 * Factor20)), 800);

    // 2500 -> 1875 (25%)
    const Check25 = VerifyDiscount(2500, 1875);
    Assert.equal(Check25.valid, true);
    const Factor25 = Math.fround(1 - Check25.discount);
    Assert.equal(Math.round(Math.fround(2500 * Factor25)), 1875);
});

Test('GetItems routes 2K22 stores to catalog replies and falls back for unconfigured/unsupported requests', () => {
    const RawItems = [
        {
            item: '0x00000201',
            name: 'Park Hoodie',
            originPrice: 800,
            price: 800,
            currency: 0,
            itemType: 2,
            availability: 0,
            content: ['hoodie.iff'],
        },
        {
            item: '0x00000202',
            name: 'Park Kicks',
            originPrice: 1200,
            price: 1200,
            currency: 0,
            itemType: 5,
            availability: 0,
            content: ['kicks.iff'],
        },
    ];
    const Catalog = new StoreCatalog2K22(ValidCatalogDoc(RawItems));

    // 1. With Catalog configured and clothing store page requested
    const ParkClothingInput = MakeOverviewInput('PAGE:TKWORLD_PARK_CLOTHING_STORE');
    const ReplyPark = StoreItems.Build(ParkClothingInput, { StoreCatalog2K22: Catalog });
    const ParsedPark = Parse(ReplyPark.Body);
    Assert.ok(GetField(ParsedPark.Fields, Fields.Items), 'clothing page returns 2K22 items binary');
    Assert.equal(GetField(ParsedPark.Fields, 0x31de3808), null, 'does not return 2K19 date header');

    // 2. NBA store page requested
    const NbaStoreInput = MakeOverviewInput('PAGE:TKWORLD_NBA_STORE');
    const ReplyNba = StoreItems.Build(NbaStoreInput, { StoreCatalog2K22: Catalog });
    const ParsedNba = Parse(ReplyNba.Body);
    Assert.ok(GetField(ParsedNba.Fields, Fields.Items), 'NBA store returns 2K22 items binary');

    // 3. Foot Locker page requested
    const FootLockerInput = MakeOverviewInput('PAGE:TKWORLD_FOOT_LOCKER');
    const ReplyShoes = StoreItems.Build(FootLockerInput, { StoreCatalog2K22: Catalog });
    const ParsedShoes = Parse(ReplyShoes.Body);
    Assert.ok(GetField(ParsedShoes.Fields, Fields.Items), 'Foot Locker returns 2K22 items binary');
    const ShoePayload = Zlib.inflateSync(GetField(ParsedShoes.Fields, Fields.Items).Raw);
    const ShoeItems = JSON.parse(ShoePayload.subarray(0, -1).toString('utf8'));
    Assert.equal(ShoeItems.length, 1);
    Assert.equal(ShoeItems[0].item_id, 0x00000202);

    // 4. Unknown pages still use the old completion branch, never arbitrary catalog views.
    const UnknownInput = MakeOverviewInput('PAGE:UNKNOWN');
    const ParsedUnknown = Parse(StoreItems.Build(UnknownInput, { StoreCatalog2K22: Catalog }).Body);
    Assert.ok(GetField(ParsedUnknown.Fields, 0x31de3808), 'fallback returns date header');
    Assert.equal(GetField(ParsedUnknown.Fields, Fields.Items), null);

    // 5. Without Catalog configured, all requests fall back to 2K19 price update protocol
    const ReplyNoCatalog = StoreItems.Build(ParkClothingInput, {});
    const ParsedNoCatalog = Parse(ReplyNoCatalog.Body);
    Assert.ok(GetField(ParsedNoCatalog.Fields, 0x31de3808), 'no catalog falls back to 2K19 date header');
    Assert.equal(GetField(ParsedNoCatalog.Fields, Fields.Items), null);
});

Test('Server LoadConfig resolves StoreCatalog2K22File and CreateHandler wires Context', () => {
    const TempDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-store-test-'));
    try {
        const ConfigFile = Path.join(TempDir, 'Config.json');
        const CatalogFile = Path.join(TempDir, 'Catalog.json');

        // Write sample config and catalog
        Fs.writeFileSync(
            ConfigFile,
            JSON.stringify({
                Port: 21000,
                Host: '127.0.0.1',
                NBA2K22StoreCatalog: 'Catalog.json',
            }),
            'utf8',
        );

        const RawDoc = ValidCatalogDoc([
            {
                item: '0x00000501',
                name: 'Server Test Item',
                originPrice: 500,
                price: 500,
                currency: 0,
                itemType: 2,
                availability: 0,
                content: ['server.iff'],
            },
        ]);
        Fs.writeFileSync(CatalogFile, JSON.stringify(RawDoc), 'utf8');

        const Loaded = Server.LoadConfig(ConfigFile);
        Assert.equal(Loaded.StoreCatalog2K22File, CatalogFile);

        // Test handler initialization and Context injection
        const InjectedCatalog = LoadCatalog2K22(CatalogFile);
        Assert.equal(InjectedCatalog.items.length, 1);
        Assert.equal(InjectedCatalog.items[0].item_id, 0x501);

        // Test manifest-default fallback path
        const ManifestDefaultConfig = Path.join(TempDir, 'ManifestConfig.json');
        Fs.writeFileSync(
            ManifestDefaultConfig,
            JSON.stringify({
                NBA2K22Manifest: 'manifest',
            }),
            'utf8',
        );
        const LoadedDefault = Server.LoadConfig(ManifestDefaultConfig);
        Assert.equal(
            LoadedDefault.StoreCatalog2K22File,
            Path.resolve(TempDir, 'Storage/Inventory/StoreCatalog2K22.json'),
        );

        // Test unconfigured stays null
        const UnconfiguredConfig = Path.join(TempDir, 'EmptyConfig.json');
        Fs.writeFileSync(UnconfiguredConfig, JSON.stringify({}), 'utf8');
        const LoadedEmpty = Server.LoadConfig(UnconfiguredConfig);
        Assert.equal(LoadedEmpty.StoreCatalog2K22File, null);
    } finally {
        Fs.rmSync(TempDir, { recursive: true, force: true });
    }
});

Test('filtered catalog versions change across stores and after item edits', () => {
    const Item = { item: 42, originPrice: 500, price: 500, currency: 0, itemType: 2, availability: 0, content: ['shirt'] };
    const Catalog = new StoreCatalog2K22(ValidCatalogDoc([Item, { ...Item, item: 43, itemType: 5 }]));
    const Version = Reply => GetU64(Parse(Reply.Body).Fields, Fields.Version);
    Assert.notEqual(Version(Catalog.GetClothingStoreReply()), Version(Catalog.GetShoeStoreReply()));
    const Changed = new StoreCatalog2K22(ValidCatalogDoc([{ ...Item, originPrice: 600, price: 600 }]));
    Assert.notEqual(Version(Catalog.GetClothingStoreReply()), Version(Changed.GetClothingStoreReply()));
});

Test('catalog rejects coercible IDs/prices and conflicts even when one duplicate is ineligible', () => {
    const Base = { item: 42, originPrice: 500, price: 500, currency: 0, itemType: 2, availability: 0, content: ['shirt'] };
    for (const item of [-4294967295, 4294967297, 1.5, '0x01garbage', '0x100000001', true]) {
        Assert.equal(new StoreCatalog2K22(ValidCatalogDoc([{ ...Base, item }])).items.length, 0, String(item));
    }
    for (const price of [null, false, '500']) {
        Assert.equal(new StoreCatalog2K22(ValidCatalogDoc([{ ...Base, price }])).items.length, 0);
    }
    Assert.equal(new StoreCatalog2K22(ValidCatalogDoc([Base, { ...Base, currency: 1 }])).items.length, 0);
});

Test('configured catalog flows through HTTP dispatcher without starting a listener', async T => {
    const { Readable } = require('node:stream');
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-store-route-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const ConfigFile = Path.join(Root, 'Config.json');
    Fs.writeFileSync(ConfigFile, JSON.stringify({ NBA2K22StoreCatalog: 'catalog.json' }));
    const Item = { item: 42, originPrice: 500, price: 500, currency: 0, itemType: 2, availability: 0, content: ['shirt'] };
    Fs.writeFileSync(Path.join(Root, 'catalog.json'), JSON.stringify(ValidCatalogDoc([Item])));
    const Config = Server.LoadConfig(ConfigFile);
    const Handler = Server.CreateHandler(Config, { Careers: new Map(), Wallets: new Map(), OwnedItems: new Map() });
    const { Body } = MakeOverviewInput('PAGE:TKWORLD_PARK_CLOTHING_STORE');
    const Req = Readable.from([Body]);
    Object.assign(Req, { method: 'POST', url: '/nba/2k19/StoreV4/v4/get_items', headers: {} });
    const Res = { writeHead(Status) { this.statusCode = Status; }, end(Value) { this.body = Value; } };
    await Handler(Req, Res);
    Assert.equal(Res.statusCode, 200);
    const Blob = GetField(Parse(Res.body).Fields, Fields.Items);
    const Raw = Zlib.inflateSync(Blob.Raw);
    Assert.equal(JSON.parse(Raw.subarray(0, -1))[0].item_id, 42);
    const Wire = require('../Source/Services/Store/Wire2K22');
    const ReplyFields = Parse(Res.body).Fields;
    const Inventory = Zlib.inflateSync(GetField(ReplyFields, Wire.Fields.Inventory).value);
    Assert.equal(BigInt(Inventory.length), GetU64(ReplyFields, Wire.Fields.InventorySize));
    Assert.equal(Inventory.at(-1), 0);
    Assert.deepEqual(JSON.parse(Inventory.subarray(0, -1)), []);
    const Layout = require('../Source/Services/Store/GetLayout');
    const LayoutReq = Readable.from([Body]);
    Object.assign(LayoutReq, { method: 'POST', url: '/nba/2k19/StoreV4/v4/get_layout', headers: {} });
    const LayoutRes = { writeHead(Status) { this.statusCode = Status; }, end(Value) { this.body = Value; } };
    await Handler(LayoutReq, LayoutRes);
    Assert.equal(LayoutRes.statusCode, 200);
    const LayoutFields = Parse(LayoutRes.body).Fields;
    const LayoutRaw = Zlib.inflateSync(GetField(LayoutFields, Layout.Fields.LayoutJsonCompressed).Raw);
    Assert.equal(BigInt(LayoutRaw.length), GetU64(LayoutFields, Layout.Fields.LayoutJsonSize));
    const LayoutDoc = JSON.parse(LayoutRaw.subarray(0, -1));
    Assert.deepEqual(LayoutDoc.PUMA_STORE, [], 'dispatcher must pass loaded catalog rather than use static layout');
    Assert.deepEqual(LayoutDoc.SWAGS.flat(2).map(Cell => Cell.tag), ['GRANITE:STORE:SWAGS:BRAND:OTHER']);
    Assert.doesNotThrow(() => Server.CreateHandler({ ...Config, StoreCatalog2K22File: Path.join(Root, 'missing.json') }));
});

Test('real Puma byte-length requests return tagged shoe JSON instead of old price completion', () => {
    const Catalog = new StoreCatalog2K22(ValidCatalogDoc([{
        item: 42, originPrice: 500, price: 500, currency: 0, itemType: 5,
        availability: 0, content: ['shoe'], rawWords: { '0x194': '0x00C07820' },
    }]));
    const Prefix = '0050004100470045003a0054004b0057004f0052004c0044005f00500055004d0041005f00530054004f00520045';
    for (const End of ['0000', '0008']) {
        const Data = Buffer.from(Prefix + End, 'hex');
        const Input = { Parsed: { Fields: [{ Crc: 0x952ef509, Type: 0x7a4d534c, Data1: 0, Data2: 48 }], Data } };
        Assert.equal(StoreOverview.RequestedPage(Input), 'PAGE:TKWORLD_PUMA_STORE');
        const Reply = Parse(StoreItems.Build(Input, { StoreCatalog2K22: Catalog }).Body);
        Assert.equal(GetField(Reply.Fields, 0x31de3808), null);
        const Raw = Zlib.inflateSync(GetField(Reply.Fields, Fields.Items).Raw);
        const Rows = JSON.parse(Raw.subarray(0, -1));
        Assert.equal(Rows[0].item_id, 42);
        const Cell = require('../Source/Services/Store/GetLayout').LayoutDocument().PUMA_STORE.flat(2).find(Cell => Cell.title === 'Puma Shoes');
        Assert.ok(Rows[0].tag_crcs.includes(Crc32(Cell.tag)));
    }
});

Test('resource filtering keeps wearable nameless OR thumbnail-less items without placeholders', () => {
    const Raw = [];
    const Expected = [];
    for (const Type of [2, 4, 5]) {
        for (const Content of [false, true]) {
            for (const Name of [false, true]) {
                for (const Thumbnail of [false, true]) {
                    const Id = Type * 100 + Raw.length + 1;
                    Raw.push({ item: Id, itemType: Type, name: Name ? 'Named' : '', subName: '',
                        originPrice: 100, price: 100, currency: 0, availability: 0,
                        content: ['native-content'], resources: { content: Content, name: Name, thumbnail: Thumbnail } });
                    if (Content && (Name || Thumbnail)) Expected.push(Id);
                }
            }
        }
    }
    const Catalog = new StoreCatalog2K22({ ...ValidCatalogDoc(Raw), resourceValidationVersion: 1 });
    Assert.deepEqual(Catalog.items.map(Item => Item.item_id), Expected);
    Assert.equal(Catalog.items.length, 9, 'three survivors per wearable type, no blank placeholders');
    const Decode = Reply => {
        const Parsed = Parse(Reply.Body);
        const Data = Zlib.inflateSync(GetField(Parsed.Fields, Fields.Items).Raw);
        return JSON.parse(Data.subarray(0, -1));
    };
    const Clothing = Expected.filter(Id => Id < 500);
    Assert.deepEqual(Decode(Catalog.GetClothingStoreReply()).map(Item => Item.item_id), Clothing);
    Assert.deepEqual(Decode(Catalog.GetShoeStoreReply()).map(Item => Item.item_id), Expected.filter(Id => Id >= 500));
    Assert.ok(Decode(Catalog.GetClothingStoreReply()).some(Item => Item.name === ''), 'no invented fallback names');
    const Previous = new StoreCatalog2K22(ValidCatalogDoc(Raw));
    Assert.notEqual(GetU64(Parse(Previous.GetClothingStoreReply().Body).Fields, Fields.Version),
        GetU64(Parse(Catalog.GetClothingStoreReply().Body).Fields, Fields.Version), 'filtered view invalidates client cache');
});

Test('resource validation preserves non-wearable types and rejects incomplete or conflicted metadata', () => {
    const Item = { item: 123, itemType: 2, name: 'Item', originPrice: 100, price: 100,
        availability: 0, currency: 0, content: ['native'],
        resources: { content: true, name: true, thumbnail: false } };
    const Doc = Items => ({ ...ValidCatalogDoc(Items), resourceValidationVersion: 1 });
    Assert.throws(() => new StoreCatalog2K22(Doc([{ ...Item, resources: undefined }])), /missing resource validation/);
    Assert.throws(() => new StoreCatalog2K22(Doc([{ ...Item, resources: { ...Item.resources, content: null } }])),
        /missing resource validation/);
    Assert.throws(() => new StoreCatalog2K22({ ...Doc([]), resourceValidationVersion: 2 }), /unsupported/);
    const Conflicted = new StoreCatalog2K22(Doc([Item,
        { ...Item, resources: { ...Item.resources, content: false } }]));
    Assert.equal(Conflicted.items.length, 0, 'metadata cannot bypass duplicate ID conflicts');
    for (const Type of [8, 22, 24]) {
        const Value = { ...Item, itemType: Type, resources: { content: null, name: true, thumbnail: false } };
        Assert.equal(new StoreCatalog2K22(Doc([Value])).items.length, 1);
    }
});
