'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const Os = require('node:os');
const Zlib = require('node:zlib');
const { Builder, Parse, GetField, GetU32, GetU64 } = require('../Source/Codec/FieldList');
const { Crc32 } = require('../Source/Core/Crc32');
const Purchase = require('../Source/Services/Store/Purchase');
const GetOwned = require('../Source/Services/Store/GetOwnedItems');
const Wire = require('../Source/Services/Store/Wire2K22');
const Storage = require('../Source/Storage/OwnedItems');
const GetItems = require('../Source/Services/Store/GetItems');
const { StoreCatalog2K22, Fields: CatalogFields } = require('../Source/Storage/StoreCatalog2K22');
const WalletStore = require('../Source/Storage/Wallets');
const { LoadAutomaticItems } = require('../Source/Storage/AutomaticOwnership');
function DecodeOwned(Context) {
    const Fields = Parse(GetOwned.Build({}, Context).Body).Fields;
    const Blob = Fields.find(F => F.Crc === Wire.Fields.Inventory);
    const Json = Zlib.inflateSync(Blob.value);
    Assert.equal(BigInt(Json.length), GetU64(Fields, Wire.Fields.InventorySize));
    Assert.equal(Json.at(-1), 0);
    return JSON.parse(Json.subarray(0, -1).toString('utf8'));
}
Test('real 2K22 compressed animation carts persist and reload through the native JSON inventory', () => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'store2k22-'));
    try {
        const File = Path.join(Root, 'owned.json');
        const Context = { userId: 42n, OwnedItems: new Map(), Purchases: new Map(), AutomaticOwnedItems: [] };
        Context.SaveOwnedItems = () => Storage.SaveOwnedItems(File, Context.OwnedItems);
        for (const [Name, Item, Price] of [['AnimationPurchase.bin', 3483154177, 100], ['AnimationPurchase2.bin', 2360010015, 125]]) {
            const Body = Fs.readFileSync(Path.join(__dirname, 'Fixtures/Store2K22', Name));
            const Reply = Parse(Purchase.Build({ Body, Parsed: Parse(Body) }, Context).Body);
            Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
            Assert.equal(GetU32(Reply.Fields, 0xfd76cfbd), Item);
            Assert.equal(GetU64(Reply.Fields, 0x8f1fa615), 1n);
            Assert.ok(Reply.Fields.every(F => F.Status !== 'out_of_range'));
            const Entries = Storage.ListOwnedItems(Context.OwnedItems, Storage.OwnedKey(Context));
            Assert.equal(Entries.at(-1).price, String(Price));
        }
        const Before = DecodeOwned(Context);
        const Loaded = { ...Context, OwnedItems: Storage.LoadOwnedItems(File) };
        Assert.deepEqual(DecodeOwned(Loaded), Before);
        Assert.deepEqual(Before.map(R => R.item_id), [3483154177, 2360010015]);
        Assert.ok(Before.every(R => Number.isSafeInteger(R.instance_id) && R.instance_id > 0));
        Assert.deepEqual(DecodeOwned({ ...Loaded, userId: 43n }), []);
        const Body = Fs.readFileSync(Path.join(__dirname, 'Fixtures/Store2K22/AnimationPurchase.bin'));
        Purchase.Build({ Parsed: Parse(Body) }, Loaded);
        Assert.equal(DecodeOwned(Loaded).length, 2, 're-buy must not create duplicate animation ownership');
    } finally { Fs.rmSync(Root, { recursive: true, force: true }); }
});
Test('invalid compressed carts fail without writing ownership', () => {
    for (const Binary of [Buffer.from('bad zlib'), Zlib.deflateSync(Buffer.from('[{}]')), Zlib.deflateSync(Buffer.from('null'))]) {
        let Saved = false;
        const Context = { userId: 42n, OwnedItems: new Map(), SaveOwnedItems() { Saved = true; } };
        const Body = new Builder().AddBinary(Wire.Fields.Cart, Binary).Build().Body;
        const Reply = Parse(Purchase.Build({ Parsed: Parse(Body) }, Context).Body);
        Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('FAILURE'));
        Assert.equal(Context.OwnedItems.size, 0);
        Assert.equal(Saved, false);
    }
});

function RefreshCatalog() {
    return new StoreCatalog2K22({ source: 'NBA2K22_MANIFEST_STORE_BINARY_DATA', typeHash: '0x67AF5087',
        recordSizeBytes: 0x1a0, priceFieldsDecoded: true, version: 1,
        items: [{ item: 513, itemType: 2, name: 'Shirt', originPrice: 500, price: 500,
            currency: 0, availability: 0, content: ['shirt'] }] });
}
function StoreRequest(Page = 'PAGE:TKWORLD_PARK_CLOTHING_STORE') {
    const { Body } = new Builder().AddString16(0x952ef509, Page).Build();
    Body.writeUInt32BE((Page.length + 1) * 2, 12);
    return { Body, Parsed: Parse(Body) };
}
function ReplyInventory(Reply) {
    const Fields = Parse(Reply.Body).Fields;
    Assert.ok(Fields.every(F => F.Status !== 'out_of_range'));
    for (const Id of [Wire.Fields.Inventory, Wire.Fields.InventorySize])
        Assert.equal(Fields.filter(F => F.Crc === Id).length, 1, 'exactly one inventory envelope');
    const Raw = Zlib.inflateSync(GetField(Fields, Wire.Fields.Inventory).value);
    Assert.equal(BigInt(Raw.length), GetU64(Fields, Wire.Fields.InventorySize));
    Assert.equal(Raw.at(-1), 0);
    return JSON.parse(Raw.subarray(0, -1).toString('utf8'));
}

Test('StoreV4 rejects forged prices and insufficient funds without mutating inventory or balance', () => {
    const Catalog = RefreshCatalog();
    const MakeRequest = (Price) => {
        const Rows = [{ item_crc: 513, item_type: 697223338, count: 1, expected_price: Price, savebound: false }];
        const Body = new Builder().AddBinary(Wire.Fields.Cart,
            Zlib.deflateSync(Buffer.from(`${JSON.stringify(Rows)}\0`))).Build().Body;
        return { Body, Parsed: Parse(Body) };
    };
    for (const [Price, Balance, Expected] of [[499, 1000n, Crc32('FAILURE')], [500, 499n, 0xf4e7a9b4]]) {
        const Context = { userId: 42n, OwnedItems: new Map(), StoreCatalog2K22: Catalog,
            Wallets: new Map([['42', Balance]]), SaveOwnedItems() { Assert.fail('rejected purchase must not save'); } };
        const Reply = Parse(Purchase.Build(MakeRequest(Price), Context).Body);
        Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Expected);
        Assert.equal(Context.Wallets.get('42'), Balance);
        Assert.equal(Context.OwnedItems.size, 0);
    }
});

Test('StoreV4 rolls back ownership on save failure and honors fixed-wallet mode', () => {
    const Catalog = RefreshCatalog();
    const Rows = [{ item_crc: 513, item_type: 697223338, count: 1, expected_price: 500, savebound: false }];
    const Body = new Builder().AddBinary(Wire.Fields.Cart,
        Zlib.deflateSync(Buffer.from(`${JSON.stringify(Rows)}\0`))).Build().Body;
    const Input = { Body, Parsed: Parse(Body) };
    const FailedSave = { userId: 42n, OwnedItems: new Map(), StoreCatalog2K22: Catalog,
        Wallets: new Map([['42', 1000n]]), SaveOwnedItems() { throw new Error('disk full'); } };
    const FailedReply = Parse(Purchase.Build(Input, FailedSave).Body);
    Assert.equal(GetU32(FailedReply.Fields, Crc32('RESULT')), Crc32('FAILURE'));
    Assert.equal(FailedSave.Wallets.get('42'), 1000n);
    Assert.equal(FailedSave.OwnedItems.size, 0);
    let PersistedOwned = [];
    const FailedWalletSave = { userId: 42n, OwnedItems: new Map(), StoreCatalog2K22: Catalog,
        Wallets: new Map([['42', 1000n]]), SaveOwnedItems() {
            PersistedOwned = (this.OwnedItems.get('42') || []).map(Entry => ({ ...Entry }));
        }, SaveWallets() { throw new Error('wallet file is read-only'); } };
    const WalletFailure = Parse(Purchase.Build(Input, FailedWalletSave).Body);
    Assert.equal(GetU32(WalletFailure.Fields, Crc32('RESULT')), Crc32('FAILURE'));
    Assert.equal(FailedWalletSave.Wallets.get('42'), 1000n);
    Assert.equal(FailedWalletSave.OwnedItems.size, 0);
    Assert.deepEqual(PersistedOwned, [], 'ownership is rolled back when wallet persistence fails');


    const Static = { userId: 43n, OwnedItems: new Map(), StoreCatalog2K22: Catalog,
        Wallets: new Map(), VirtualCurrencyStatic: true };
    const StaticReply = Parse(Purchase.Build(Input, Static).Body);
    Assert.equal(GetU32(StaticReply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(Static.Wallets.get('43'), require('../Source/Services/VirtualCurrency/Balance').StartingBalance);
});
Test('same-version catalog refresh includes a purchase immediately without an equipment request', (T) => {
    const WalletRoot = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'store-wallets-'));
    T.after(() => Fs.rmSync(WalletRoot, { recursive: true, force: true }));
    const WalletFile = Path.join(WalletRoot, 'Wallets.json');
    const Wallets = new Map([['42', 2000n]]);
    WalletStore.Save(WalletFile, Wallets);
    const Catalog = RefreshCatalog();
    const Input = StoreRequest();
    const Static = Catalog.GetClothingStoreReply();
    const StaticBody = Buffer.from(Static.Body);
    const StaticFields = Static.Fields.map(F => ({ ...F }));
    let WalletSaves = 0;
    const Context = { userId: 42n, OwnedItems: new Map(), AutomaticOwnedItems: [], StoreCatalog2K22: Catalog,
        Wallets, SaveWallets: () => { WalletSaves++; WalletStore.Save(WalletFile, Wallets); }, VirtualCurrencyStatic: false };
    const Before = GetItems.Build(Input, Context);
    Assert.deepEqual(ReplyInventory(Before), []);
    let Saves = 0;
    Context.SaveOwnedItems = () => { Saves++; };
    const Cart = [{ item_crc: 513, item_type: 697223338, count: 1, expected_price: 500, savebound: false }];
    const CartBody = new Builder().AddBinary(Wire.Fields.Cart,
        Zlib.deflateSync(Buffer.from(`${JSON.stringify(Cart)}\0`))).Build().Body;
    const Result = Purchase.Build({ Parsed: Parse(CartBody) }, Context);
    Assert.equal(GetU32(Parse(Result.Body).Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    const ReplyFields = Parse(Result.Body).Fields;
    Assert.equal(GetU64(ReplyFields, 0x93b1e1e4), 1500n, 'legacy VC field immediately reports the debited wallet');
    Assert.equal(GetU64(ReplyFields, 0xce7d633f), 1500n, '2K22 token balance immediately reports the debited wallet');
    Assert.equal(Context.Wallets.get('42'), 1500n, 'StoreV4 debits the catalog price');
    Assert.equal(WalletSaves, 1);
    Assert.equal(WalletStore.Load(WalletFile).get('42'), 1500n, 'StoreV4 purchase survives a reload');
    Assert.equal(Saves, 1);
    const Retry = Purchase.Build({ Parsed: Parse(CartBody) }, Context);
    Assert.equal(GetU32(Parse(Retry.Body).Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(GetU64(Parse(Retry.Body).Fields, 0xce7d633f), 1500n, 'idempotent reply keeps the current wallet in sync');
    Assert.equal(Context.Wallets.get('42'), 1500n, 'retry of an already-owned cart is not charged again');
    Assert.equal(WalletSaves, 1, 'retry does not write or charge again');
    Assert.equal(Saves, 1, 'idempotent retry does not rewrite ownership');
    const After = GetItems.Build(Input, Context);
    Assert.deepEqual(ReplyInventory(After), [{ item_id: 513, instance_id: 513 }]);
    Assert.deepEqual(ReplyInventory(After), DecodeOwned(Context));
    Assert.deepEqual(ReplyInventory(Before), [], 'earlier response is not mutated by a purchase');
    const Expected = Parse(Static.Body).Fields;
    for (const Reply of [Before, After]) {
        const Fields = Parse(Reply.Body).Fields;
        Assert.equal(GetU32(Fields, Crc32('RESULT')), Crc32('SUCCESS'));
        Assert.equal(GetU64(Fields, CatalogFields.Version), GetU64(Expected, CatalogFields.Version));
        Assert.equal(GetU64(Fields, CatalogFields.UncompressedSize), GetU64(Expected, CatalogFields.UncompressedSize));
        Assert.deepEqual(GetField(Fields, CatalogFields.Items).value, GetField(Expected, CatalogFields.Items).value);
        Assert.deepEqual(Fields.map(F => F.Crc), Fields.map(F => F.Crc).sort((A, B) => A - B));
    }
    Assert.equal(Catalog.GetClothingStoreReply(), Static);
    Assert.deepEqual(Static.Body, StaticBody);
    Assert.deepEqual(Static.Fields, StaticFields);
    Assert.equal(GetField(Expected, Wire.Fields.Inventory), null, 'shared cache remains account-free');
    After.Body.fill(0);
    Assert.deepEqual(Static.Body, StaticBody, 'response buffers do not alias the catalog cache');
    Assert.deepEqual(ReplyInventory(GetItems.Build(Input, Context)), [{ item_id: 513, instance_id: 513 }]);
});

Test('catalog inventory merges automatic ownership and isolates accounts across shared store views', () => {
    const Catalog = RefreshCatalog();
    const OwnedItems = new Map();
    const Base = { StoreCatalog2K22: Catalog, OwnedItems, AutomaticOwnedItems: [{ item: 900, price: '0' }] };
    const A = { ...Base, userId: 42n };
    const B = { ...Base, userId: 43n };
    Storage.RememberOwnedItem(OwnedItems, Storage.OwnedKey(A), { item: 513 });
    Storage.RememberOwnedItem(OwnedItems, Storage.OwnedKey(A), { item: 900 });
    Storage.RememberOwnedItem(OwnedItems, Storage.OwnedKey(B), { item: 700 });
    for (const Context of [A, B, A]) {
        for (const Page of ['PAGE:TKWORLD_PARK_CLOTHING_STORE', 'PAGE:TKWORLD_FOOT_LOCKER']) {
            const Inventory = ReplyInventory(GetItems.Build(StoreRequest(Page), Context));
            Assert.deepEqual(Inventory, DecodeOwned(Context), 'full inventory is not filtered by this store');
            Assert.deepEqual(Inventory.map(R => R.item_id), Context === A ? [900, 513] : [900, 700]);
        }
    }
    Assert.deepEqual(ReplyInventory(GetItems.Build(StoreRequest(), Base)), [], 'no user must not expose any inventory');
    const Reloaded = new Map([...OwnedItems].map(([Key, Rows]) => [Key, JSON.parse(JSON.stringify(Rows))]));
    Assert.deepEqual(ReplyInventory(GetItems.Build(StoreRequest(), { ...A, OwnedItems: Reloaded })), DecodeOwned(A));
});

Test('inventory refresh does not change the unconfigured or unsupported store fallback', () => {
    const Context = { userId: 42n, OwnedItems: new Map(), AutomaticOwnedItems: [] };
    Storage.RememberOwnedItem(Context.OwnedItems, Storage.OwnedKey(Context), { item: 513 });
    for (const [Input, Value] of [[StoreRequest(), Context],
        [StoreRequest('PAGE:UNKNOWN'), { ...Context, StoreCatalog2K22: RefreshCatalog() }]]) {
        const Fields = Parse(GetItems.Build(Input, Value).Body).Fields;
        Assert.ok(GetField(Fields, GetItems.Fields.Date));
        Assert.equal(GetField(Fields, Wire.Fields.Inventory), null);
        Assert.equal(GetField(Fields, Wire.Fields.InventorySize), null);
        Assert.equal(GetField(Fields, CatalogFields.Items), null);
    }
});

const NativeOwnedInput = { headers: { 'user-agent': 'VISUAL_CONCEPTS_WIN64/22.0' } };

Test('2K22 ownership response removes only duplicate legacy fields, preserving complete compressed inventory', () => {
    const Context = { userId: 42n, OwnedItems: new Map(),
        AutomaticOwnedItems: Array.from({ length: 28490 }, (_, I) => ({ item: I + 1 })) };
    Storage.RememberOwnedItem(Context.OwnedItems, Storage.OwnedKey(Context), { item: 2, purchaseType: 77 });
    const Legacy = GetOwned.Build({}, Context);
    const Native = GetOwned.Build(NativeOwnedInput, Context);
    const OldFields = Parse(Legacy.Body).Fields;
    const Fields = Parse(Native.Body).Fields;
    Assert.equal(Fields.length, 3);
    Assert.equal(GetField(Fields, 0xfd76cfbd), null);
    Assert.equal(GetU32(Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.deepEqual(Fields.map(F => F.Crc), Fields.map(F => F.Crc).sort((A, B) => A - B));
    Assert.deepEqual(GetField(Fields, Wire.Fields.Inventory).value, GetField(OldFields, Wire.Fields.Inventory).value);
    Assert.equal(GetU64(Fields, Wire.Fields.InventorySize), GetU64(OldFields, Wire.Fields.InventorySize));
    Assert.equal(ReplyInventory(Native).length, 28490);
    Assert.equal(Legacy.Body.length - Native.Body.length, (28490 + 1) * 16);
    Assert.ok(Native.Body.length < Legacy.Body.length * 0.4, 'large inventory should save over 60% of response bytes');
});

Test('2K22 compressed-only ownership still refreshes after purchases and isolates accounts', () => {
    const Context = { userId: 42n, OwnedItems: new Map(), AutomaticOwnedItems: [{ item: 900 }] };
    const Before = GetOwned.Build(NativeOwnedInput, Context);
    const CartBody = Fs.readFileSync(Path.join(__dirname, 'Fixtures/Store2K22/AnimationPurchase.bin'));
    const Reply = Purchase.Build({ Parsed: Parse(CartBody) }, Context);
    Assert.equal(GetU32(Parse(Reply.Body).Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    const After = GetOwned.Build(NativeOwnedInput, Context);
    Assert.deepEqual(ReplyInventory(Before).map(R => R.item_id), [900]);
    Assert.deepEqual(ReplyInventory(After).map(R => R.item_id), [900, 3483154177]);
    Assert.deepEqual(ReplyInventory(GetOwned.Build(NativeOwnedInput, { ...Context, userId: 43n })).map(R => R.item_id), [900]);
    Assert.deepEqual(ReplyInventory(GetOwned.Build(NativeOwnedInput, { ...Context, userId: null })), []);
    Assert.deepEqual(ReplyInventory(GetItems.Build(StoreRequest(), { ...Context, StoreCatalog2K22: RefreshCatalog() })), ReplyInventory(After));
});

Test('legacy and unknown clients retain the original ownership envelope', () => {
    const Context = { userId: 42n, AutomaticOwnedItems: [{ item: 513, purchaseType: 77 }] };
    const Expected = GetOwned.Build({}, Context).Body;
    for (const Input of [undefined, {}, { headers: {} }, ...[
        'VISUAL_CONCEPTS_WIN64/19.0', 'VISUAL_CONCEPTS_WIN64/21.0',
        'VISUAL_CONCEPTS_WIN64/23.0', 'VISUAL_CONCEPTS_WIN64/220.0', '',
    ].map(Agent => ({ headers: { 'user-agent': Agent } }))]) {
        Assert.deepEqual(GetOwned.Build(Input, Context).Body, Expected);
    }
    for (const Agent of ['VISUAL_CONCEPTS_WIN64/22.0', 'VISUAL_CONCEPTS_WIN64/22.1']) {
        const Reply = GetOwned.Build({ headers: { 'user-agent': Agent } }, Context);
        Assert.equal(Parse(Reply.Body).Fields.length, 3);
        Assert.deepEqual(ReplyInventory(Reply), DecodeOwned(Context));
    }
});

Test('Gatorade remains on sale but automatic ownership is excluded consistently across store replies', () => {
    const Ids = [0x4c99dc6d, 0xe80626b4, 0xed175be5, 0x45a9e847, 0xf713373a, 0x88d81a73];
    const Catalog = new StoreCatalog2K22(JSON.parse(Fs.readFileSync(
        Path.join(__dirname, '../Storage/Inventory/StoreCatalog2K22.json'), 'utf8')));
    const AutomaticOwnedItems = LoadAutomaticItems(Path.join(__dirname, '../Storage/Inventory/AutomaticCatalog.json'));
    const Context = { userId: 42n, StoreCatalog2K22: Catalog, AutomaticOwnedItems, OwnedItems: new Map(),
        SaveOwnedItems() { Assert.fail('inventory reads must not save purchases'); } };
    const Input = StoreRequest('PAGE:TKWORLD_GATORADE_STORE');
    const Static = Catalog.GetReplyForPage('PAGE:TKWORLD_GATORADE_STORE');
    const OriginalBody = Buffer.from(Static.Body);
    const Reply = GetItems.Build(Input, Context);
    const Fields = Parse(Reply.Body).Fields;
    const Items = JSON.parse(Zlib.inflateSync(GetField(Fields, CatalogFields.Items).value).toString().replace(/\0+$/, ''));
    Assert.deepEqual(Items.map(Item => Item.item_id).sort((A, B) => A - B), [...Ids].sort((A, B) => A - B));
    const Expected = AutomaticOwnedItems.filter(Entry => !Ids.includes(Number(Entry.item))).map(Entry => Number(Entry.item));
    const Check = (Value, ExpectedIds) => Assert.deepEqual(ReplyInventory(Value).map(Row => Row.item_id), ExpectedIds);
    Check(Reply, Expected);
    Check(GetOwned.Build(NativeOwnedInput, Context), Expected);
    Check(GetOwned.Build({}, Context), Expected);
    Check(GetItems.Build(StoreRequest(), Context), Expected);
    Assert.equal(Expected.length, 28464);
    const Purchased = Ids.map(item => ({ item, price: '500', purchaseType: 22 }));
    Context.OwnedItems.set(Storage.OwnedKey(Context), Purchased);
    const Before = JSON.stringify([...Context.OwnedItems]);
    Check(GetItems.Build(Input, Context), Expected);
    Check(GetOwned.Build(NativeOwnedInput, Context), Expected);
    Assert.deepEqual(Context.OwnedItems.get(Storage.OwnedKey(Context)), Purchased, 'history is retained, not permanent ownership');
    const Other = { ...Context, userId: 43n };
    Check(GetItems.Build(Input, Other), Expected);
    Check(GetOwned.Build(NativeOwnedInput, Other), Expected);
    Assert.equal(JSON.stringify([...Context.OwnedItems]), Before);
    Assert.deepEqual(Static.Body, OriginalBody, 'catalog cache is unchanged');
    Assert.equal(AutomaticOwnedItems.length, 28470, 'source automatic catalog is unchanged');
});
