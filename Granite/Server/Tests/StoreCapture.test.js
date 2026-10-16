'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const Crypto = require('node:crypto');
const Zlib = require('node:zlib');
const Capture = require('../Source/Core/Capture');
const { Builder, Parse, GetU32 } = require('../Source/Codec/FieldList');
const StoreOwned = require('../Source/Services/Store/GetOwnedItems');
const { OwnedKey } = require('../Source/Storage/OwnedItems');

function Hash(Body) { return Crypto.createHash('sha256').update(Body).digest('hex'); }
function BlockFile(Root, Hash) { return Path.join(Root, 'StoreResponses', 'Blocks', `${Hash}.bin`); }
function Fixture(T) {
    const Root = Fs.mkdtempSync(Path.join(process.env.PI_SCRATCH_DIR || Os.tmpdir(), 'store-capture-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    let Sequence = 0;
    function Save(Reply, Endpoint = 'get_owned_items', Module = Capture) {
        const Req = { method: 'POST', url: `/nba/2k19/StoreV4/v4/${Endpoint}?x=42`, headers: { 'vc-request-id': String(++Sequence) } };
        const Base = Module.Save(Root, Req, Buffer.alloc(0));
        Module.SaveResponse(Base, Req, Reply);
        const Sidecar = `${Base}.response.json`;
        return { Base, Sidecar, Meta: JSON.parse(Fs.readFileSync(Sidecar, 'utf8')) };
    }
    return { Root, Save };
}
function CatalogReply(Catalog, Inventory, Version = 1n) {
    return new Builder().AddU64(0x80592dd9, Version)
        .AddBinary(0x603bd442, Inventory).AddU64(0x5ab6fdf4, 123n)
        .AddBinary(0xa6b5b9f8, Catalog).AddU64(0xbf8684dd, 456n).Build();
}
function HasBlock(Row, Bytes) {
    return Row.Meta.ResponseBody.Chunks.some(C => C.Sha256 === Hash(Bytes) && C.Bytes === Bytes.length);
}

Test('identical store responses share blocks across requests and module reloads', T => {
    const { Root, Save } = Fixture(T);
    const Reply = new Builder().AddU32(123, 456).Build();
    const Before = Buffer.from(Reply.Body);
    const First = Save(Reply);
    const Second = Save(Reply, 'get_items');
    delete require.cache[require.resolve('../Source/Core/Capture')];
    const Third = Save(Reply, 'get_owned_items', require('../Source/Core/Capture'));
    Assert.equal(First.Meta.ResponseBody.StoredNew, true);
    for (const Row of [Second, Third]) {
        Assert.equal(Row.Meta.ResponseBody.StoredNew, false);
        Assert.deepEqual(Row.Meta.ResponseBody.Chunks, First.Meta.ResponseBody.Chunks);
        Assert.notEqual(Row.Meta.RequestId, First.Meta.RequestId);
        Assert.equal(Fs.existsSync(`${Row.Base}.response.bin`), false);
        Assert.deepEqual(Capture.ReadResponse(Row.Sidecar), Before);
    }
    Assert.equal(Fs.readdirSync(Path.join(Root, 'StoreResponses', 'Blocks')).length, 1);
    Assert.deepEqual(Reply.Body, Before);
    Assert.equal(First.Meta.ResponseBody.Sha256, Hash(Before));
    Assert.equal(GetU32(Parse(Capture.ReadResponse(First.Sidecar)).Fields, 123), 456);
});

Test('stores share inventory blocks and purchases reuse unchanged catalog blocks', T => {
    const { Root, Save } = Fixture(T);
    const Inventory = Zlib.deflateSync(Buffer.from('[{"item_id":1}]\0'));
    const AfterInventory = Zlib.deflateSync(Buffer.from('[{"item_id":1},{"item_id":2}]\0'));
    const CatalogA = Zlib.deflateSync(Buffer.from('[{"name":"store A"}]\0'));
    const CatalogB = Zlib.deflateSync(Buffer.from('[{"name":"store B with longer name"}]\0'));
    const Replies = [CatalogReply(CatalogA, Inventory), CatalogReply(CatalogB, Inventory, 2n), CatalogReply(CatalogB, AfterInventory, 2n)];
    const Rows = Replies.map(R => Save(R, 'get_items'));
    Assert.ok(HasBlock(Rows[0], Inventory) && HasBlock(Rows[1], Inventory));
    Assert.ok(HasBlock(Rows[1], CatalogB) && HasBlock(Rows[2], CatalogB));
    Assert.ok(HasBlock(Rows[2], AfterInventory));
    for (let I = 0; I < Rows.length; I++) Assert.deepEqual(Capture.ReadResponse(Rows[I].Sidecar), Replies[I].Body);
    Assert.deepEqual(Fs.readFileSync(BlockFile(Root, Hash(Inventory))), Inventory);
    const Count = Fs.readdirSync(Path.join(Root, 'StoreResponses', 'Blocks')).length;
    Assert.equal(Save(Replies[1], 'get_items').Meta.ResponseBody.StoredNew, false);
    Assert.equal(Fs.readdirSync(Path.join(Root, 'StoreResponses', 'Blocks')).length, Count);
});

Test('inventory changes refresh blocks without leaking another account purchases', T => {
    const { Save } = Fixture(T);
    const Context = { userId: 42n, AutomaticOwnedItems: [{ item: 1 }], OwnedItems: new Map() };
    const First = Save(StoreOwned.Build({}, Context));
    Context.OwnedItems.set(OwnedKey(Context), [{ item: 2 }]);
    const Changed = Save(StoreOwned.Build({}, Context));
    const OtherAccount = Save(StoreOwned.Build({}, { ...Context, userId: 43n }));
    Assert.notEqual(Changed.Meta.ResponseBody.Sha256, First.Meta.ResponseBody.Sha256);
    Assert.equal(Changed.Meta.ResponseBody.StoredNew, true);
    Assert.equal(OtherAccount.Meta.ResponseBody.Sha256, First.Meta.ResponseBody.Sha256);
    Assert.equal(OtherAccount.Meta.ResponseBody.StoredNew, false);
});

Test('large owned inventory retains lossless bytes without expanding JSON', T => {
    const { Save } = Fixture(T);
    const Reply = StoreOwned.Build({}, {
        userId: 42n, AutomaticOwnedItems: Array.from({ length: 28490 }, (_, I) => ({ item: I + 1 })),
    });
    const { Sidecar, Meta } = Save(Reply);
    Assert.equal(Meta.BodyBytes, Reply.Body.length);
    Assert.equal(Meta.DeclaredFieldListBytes, Reply.FieldListSize);
    Assert.equal(Meta.Parse.Status, 'snapshot');
    Assert.ok(Fs.statSync(Sidecar).size < 2048);
    Assert.deepEqual(Capture.ReadResponse(Sidecar), Reply.Body);
});

Test('padding, reversed binary order and trailing bytes are preserved exactly', T => {
    const { Save } = Fixture(T);
    const Reply = new Builder().AddBinary(0xa6b5b9f8, Buffer.from('cat'))
        .AddBinary(0x603bd442, Buffer.from('inventory')).Build();
    const DataOffset = Parse(Reply.Body).DataOffset;
    Reply.Body.fill(0x7e, DataOffset + 3, DataOffset + 8);
    const Body = Buffer.concat([Reply.Body, Buffer.from('trailing-data')]);
    const Row = Save({ Body, FieldListSize: Reply.Body.length }, 'get_items');
    Assert.ok(HasBlock(Row, Buffer.from('cat')));
    Assert.ok(HasBlock(Row, Buffer.from('inventory')));
    Assert.deepEqual(Capture.ReadResponse(Row.Sidecar), Body);
});

Test('unparseable, gzip, empty and overlapping layouts fall back losslessly', T => {
    const { Save } = Fixture(T);
    const Valid = CatalogReply(Buffer.from('catalog'), Buffer.from('inventory')).Body;
    const Overlap = Buffer.from(Valid);
    const Fields = Parse(Overlap).Fields;
    const Binaries = Fields.filter(F => F.TypeName === 'Binary');
    Overlap.writeUInt32BE(Binaries[0].Data1, Binaries[1].RecordOffset + 8);
    const OutOfRange = Buffer.from(Valid);
    OutOfRange.writeUInt32BE(0xffffffff, Binaries[0].RecordOffset + 12);
    for (const Body of [Buffer.from('not a field list'), Zlib.gzipSync(Valid), Buffer.alloc(0), Overlap, OutOfRange]) {
        const Row = Save({ Body }, 'get_items');
        Assert.ok(Row.Meta.ResponseBody.Chunks.length <= 1);
        Assert.deepEqual(Capture.ReadResponse(Row.Sidecar), Body);
    }
});

Test('missing blocks are saved again and capture directories remain independent', T => {
    const One = Fixture(T), Two = Fixture(T);
    const Reply = new Builder().AddU32(1, 2).Build();
    const First = One.Save(Reply);
    Fs.unlinkSync(BlockFile(One.Root, First.Meta.ResponseBody.Chunks[0].Sha256));
    Assert.throws(() => Capture.ReadResponse(First.Sidecar), /ENOENT/);
    Assert.equal(One.Save(Reply).Meta.ResponseBody.StoredNew, true);
    Assert.deepEqual(Capture.ReadResponse(First.Sidecar), Reply.Body);
    Assert.equal(Two.Save(Reply).Meta.ResponseBody.StoredNew, true);
});

Test('corrupted blocks and tampered manifests fail integrity checks', T => {
    const { Root, Save } = Fixture(T);
    const Reply = new Builder().AddU32(1, 2).Build();
    const First = Save(Reply);
    const File = BlockFile(Root, First.Meta.ResponseBody.Chunks[0].Sha256);
    Fs.writeFileSync(File, 'truncated');
    Assert.throws(() => Capture.ReadResponse(First.Sidecar), /integrity/);
    Assert.throws(() => Save(Reply), /snapshot mismatch/);
    Fs.writeFileSync(File, Reply.Body);
    for (const Mutate of [
        M => { M.ResponseBody.Sha256 = '0'.repeat(64); },
        M => { M.ResponseBody.Chunks[0].Bytes++; },
        M => { M.ResponseBody.Chunks[0].Sha256 = '../outside'; },
        M => { M.BodyBytes++; },
        M => { M.ResponseBody.Format = 'future-format'; },
    ]) {
        const Meta = structuredClone(First.Meta);
        Mutate(Meta);
        Fs.writeFileSync(First.Sidecar, JSON.stringify(Meta));
        Assert.throws(() => Capture.ReadResponse(First.Sidecar));
    }
});

Test('reader supports previous whole snapshots without rewriting them', T => {
    const { Root } = Fixture(T);
    const Body = new Builder().AddU32(1, 2).Build().Body;
    const Sha256 = Hash(Body);
    Fs.mkdirSync(Path.join(Root, 'StoreResponses'));
    const File = `StoreResponses/${Sha256}.bin`;
    Fs.writeFileSync(Path.join(Root, File), Body);
    const Sidecar = Path.join(Root, 'old.response.json');
    const Meta = { BodyBytes: Body.length, ResponseBody: { File, Sha256, StoredNew: true } };
    Fs.writeFileSync(Sidecar, JSON.stringify(Meta));
    Assert.deepEqual(Capture.ReadResponse(Sidecar), Body);
    Assert.deepEqual(JSON.parse(Fs.readFileSync(Sidecar)), Meta);
    Meta.ResponseBody.File = '../outside.bin';
    Fs.writeFileSync(Sidecar, JSON.stringify(Meta));
    Assert.throws(() => Capture.ReadResponse(Sidecar), /unsupported/);
});

Test('unrelated routes retain the old capture format and can use the unified reader', T => {
    const { Root, Save } = Fixture(T);
    const Reply = new Builder().AddU32(1, 2).Build();
    for (const Endpoint of ['purchase', 'get_items_extra', 'get_owned_items/extra']) {
        const { Base, Sidecar, Meta } = Save(Reply, Endpoint);
        Assert.equal(Meta.ResponseBody, undefined);
        Assert.equal(Meta.Parse.Status, 'ok');
        Assert.deepEqual(Fs.readFileSync(`${Base}.response.bin`), Reply.Body);
        Assert.deepEqual(Capture.ReadResponse(Sidecar), Reply.Body);
    }
    Assert.equal(Fs.existsSync(Path.join(Root, 'StoreResponses')), false);
});
