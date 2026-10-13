'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const Os = require('node:os');
const Zlib = require('node:zlib');
const { Builder, Parse, GetU32, GetU64 } = require('../Source/Codec/FieldList');
const { Crc32 } = require('../Source/Core/Crc32');
const Purchase = require('../Source/Services/Store/Purchase');
const GetOwned = require('../Source/Services/Store/GetOwnedItems');
const Wire = require('../Source/Services/Store/Wire2K22');
const Storage = require('../Source/Storage/OwnedItems');
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
