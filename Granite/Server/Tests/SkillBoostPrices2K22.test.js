'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const Os = require('node:os');
const { Builder, Parse, GetFields, GetU32, GetU64, Types } = require('../Source/Codec/FieldList');
const { Crc32 } = require('../Source/Core/Crc32');
const Prices = require('../Source/Services/VirtualCurrency/GetPrices');
const Purchase = require('../Source/Services/VirtualCurrency/Purchase');
const Skills = require('../Source/Services/VirtualCurrency/SkillBoosts2K22');
const { OwnedKey } = require('../Source/Storage/OwnedItems');

// Independent expectations for the twelve native sellable rows, not the special seventh category.
const Products = [
    [0x667c0cff, 1, 200n], [0xd9bf4ca0, 10, 1500n],
    [0x597caaf3, 1, 200n], [0xd036002d, 10, 1500n],
    [0xdc0987fa, 1, 200n], [0xa96fcda4, 10, 1500n],
    [0x7ea52c59, 1, 200n], [0xe612935d, 10, 1500n],
    [0x0b2ced51, 1, 200n], [0xe8bc92ae, 10, 1500n],
    [0x76ef3d6a, 1, 200n], [0x59cab85a, 10, 1500n],
];
const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');
const Failure = Crc32('FAILURE');
const Tx = Prices.TransactionFields;

function Input(Packet) {
    return { Body: Packet.Body, Parsed: Parse(Packet.Body), headers: { 'user-agent': 'VISUAL_CONCEPTS_WIN64/22.0' } };
}
function Context(Balance = 100000n) {
    return { userId: 42n, VirtualCurrencyStatic: false, Wallets: new Map([['42', Balance]]),
        VcPrices: new Map(), StoreCatalogPrices: new Map(), DefaultPurchasePrice: 1n,
        OwnedItems: new Map(), Purchases: new Map(), GatoradeBoosts: new Map() };
}
function Cart(Rows) {
    const B = new Builder().AddU64(Tx.CareerKey, 0n).AddU64(Purchase.CloudSaveId, 0n);
    Rows.forEach((R, I) => B.AddStringCrc(Purchase.ItemCrc, R.item)
        .AddStringCrc(Purchase.PurchaseType, R.type ?? 0xbb8189c6)
        .AddU64(Crc32(`ITEM${I}_COUNT`), R.quantity ?? 1n)
        .AddU64(Crc32(`ITEM${I}_EXPECTED_PRICE`), R.price ?? Products.find(P => P[0] === R.item)?.[2] ?? 100n));
    return Input(B.Build());
}
function Quote(Items, C) {
    const B = new Builder();
    Items.forEach((Item, I) => B.AddStringCrc(Crc32(`ITEM_${I}`), Item));
    return Parse(Prices.Build(Input(B.Build()), C).Body).Fields;
}
function Buy(Req, C) { return Parse(Purchase.Build(Req, C).Body).Fields; }
function AssertRejected(Req, C = Context(), Expected = Failure) {
    const Before = C.Wallets.get('42');
    Assert.equal(GetU32(Buy(Req, C), Result), Expected);
    Assert.equal(C.Wallets.get('42'), Before);
    Assert.equal(C.OwnedItems.size, 0);
    Assert.equal(C.Purchases.size, 0);
    Assert.equal(C.GatoradeBoosts.size, 0);
}

Test('all twelve quotes use fixed VC prices regardless of order, stale cache or absent cache', () => {
    const Orders = [Products, [...Products].reverse(), [...Products.slice(3), ...Products.slice(0, 3)]];
    for (const Rows of Orders) for (const Cache of [undefined, new Map(), new Map(Products.map(([Item]) => [Item, { price: 1n }]))]) {
        const C = { VcPrices: Cache };
        const Fields = Quote(Rows.map(P => P[0]), C);
        Assert.equal(GetU32(Fields, Result), Success);
        Assert.equal(Fields.length, Rows.length * 5 + 1);
        const Crcs = Fields.map(F => F.Crc >>> 0);
        Assert.deepEqual(Crcs, [...Crcs].sort((A, B) => A - B), 'native price lookup requires sorted fields');
        Rows.forEach(([Item, Uses, Price], I) => {
            Assert.deepEqual(Skills.ProductFor(Item), { uses: Uses, price: Price });
            Assert.equal(GetU32(Fields, Crc32(`ITEM_${I}`)), Item);
            for (const Prefix of ['PRICE', 'FINAL_PRICE', 'MYTEAM_PRICE', 'FINAL_MYTEAM_PRICE'])
                Assert.equal(GetU64(Fields, Crc32(`${Prefix}_${I}`)), Price);
            if (Cache) Assert.equal(Cache.get(Item).price, Price);
        });
    }
});

for (const [Item, Uses, Price] of Products) Test(`skill ${Item.toString(16)} charges per pack, not per use (${Uses} uses)`, () => {
    for (const Warm of [false, true]) {
        const C = Context();
        C.StoreCatalogPrices.set(Item, 1n);
        C.VcPrices.set(Item, { price: 100n, finalPrice: 100n });
        if (Warm) Quote([Item], C);
        const Fields = Buy(Cart([{ item: Item, quantity: 2n }]), C);
        Assert.equal(GetU32(Fields, Result), Success);
        Assert.equal(GetU64(Fields, Tx.Price), Price);
        Assert.equal(GetU64(Fields, Tx.Quantity), 2n);
        Assert.equal(GetU64(Fields, Purchase.BalanceCrc), 100000n - 2n * Price);
        Assert.equal(C.Wallets.get('42'), 100000n - 2n * Price);
        Assert.equal(C.GatoradeBoosts.size, 0, 'skill pricing never initializes drink state');
        Assert.equal(C.OwnedItems.get(OwnedKey(C))[0].price, String(Price));
    }
});

Test('duplicate item rows keep indexed counts and publish each pack price/quantity', () => {
    const C = Context();
    const Rows = [{ item: 0xd9bf4ca0, quantity: 2n }, { item: 0x667c0cff }, { item: 0xd9bf4ca0, quantity: 3n }];
    const Fields = Buy(Cart(Rows), C);
    Assert.equal(GetU32(Fields, Result), Success);
    Assert.equal(C.Wallets.get('42'), 92300n);
    Assert.deepEqual(GetFields(Fields, Tx.Price).map(F => F.value), [1500n, 200n, 1500n]);
    Assert.deepEqual(GetFields(Fields, Tx.Quantity).map(F => F.value), [2n, 1n, 3n]);
});

Test('historical wrong prices 125/150 are rejected instead of silently charging 100 or a new price', () => {
    for (const Row of [{ item: 0xd9bf4ca0, price: 125n }, { item: 0x597caaf3, price: 150n }])
        AssertRejected(Cart([Row]));
});

Test('missing, duplicate, malformed or non-native skill cart fields fail without charging', () => {
    const Price = Crc32('ITEM0_EXPECTED_PRICE'), Count = Crc32('ITEM0_COUNT');
    for (const Crc of [Price, Count, Purchase.PurchaseType]) {
        const Req = Cart([{ item: 0x667c0cff }]);
        Req.Parsed.Fields = Req.Parsed.Fields.filter(F => F.Crc !== Crc);
        AssertRejected(Req);
    }
    for (const Crc of [Price, Count, Purchase.PurchaseType]) {
        const Req = Cart([{ item: 0x667c0cff }]);
        Req.Parsed.Fields.push({ ...Req.Parsed.Fields.find(F => F.Crc === Crc) });
        AssertRejected(Req);
    }
    for (const Crc of [Price, Count, Purchase.PurchaseType, Purchase.ItemCrc]) {
        const Req = Cart([{ item: 0x667c0cff }]);
        Req.Parsed.Fields.find(F => F.Crc === Crc).Type = Types.F32;
        AssertRejected(Req);
    }
    AssertRejected(Cart([{ item: 0x667c0cff, type: Purchase.ConsumablePurchaseType }]));
    for (const Quantity of [0n, -1n, 100n, 0xffffffffffffffffn])
        AssertRejected(Cart([{ item: 0x667c0cff, quantity: Quantity }]));
    for (const Price of [0n, 100n, 199n, 201n, 0xffffffffffffffffn])
        AssertRejected(Cart([{ item: 0x667c0cff, price: Price }]));
    const Shifted = Cart([{ item: 0x667c0cff }, { item: 0xd9bf4ca0 }]);
    Shifted.Parsed.Fields.find(F => F.Crc === Purchase.PurchaseType).Type = Types.F32;
    AssertRejected(Shifted, Context());
});

Test('response-only fields cannot override a skill transaction price, quantity, balance or mode', () => {
    for (const Crc of [Tx.Price, Tx.Quantity, Purchase.BalanceCrc, Tx.Mode]) {
        const Req = Cart([{ item: 0x667c0cff }]);
        Req.Parsed.Fields.push({ Crc, Type: Types.U64, Data1: 0, Data2: 1 });
        AssertRejected(Req);
    }
});

Test('insufficient funds checks the full cart; exact balance succeeds', () => {
    AssertRejected(Cart([{ item: 0xd9bf4ca0, quantity: 2n }]), Context(2999n), 0xf4e7a9b4);
    const C = Context(1700n);
    const Fields = Buy(Cart([{ item: 0x667c0cff }, { item: 0xd9bf4ca0 }]), C);
    Assert.equal(GetU32(Fields, Result), Success);
    Assert.equal(C.Wallets.get('42'), 0n);
    Assert.equal(GetU64(Fields, Purchase.BalanceCrc), 0n);
});

Test('wallet save failure restores the balance and creates no purchase records', () => {
    const C = Context();
    C.SaveWallets = () => { throw new Error('disk unavailable'); };
    AssertRejected(Cart([{ item: 0xd9bf4ca0 }]), C);
});

Test('a mixed skill/Gatorade cart uses both price tables and does not alter skill counts', () => {
    const C = Context();
    const Fields = Buy(Cart([{ item: 0xd9bf4ca0, quantity: 2n }, { item: 0xed175be5, price: 500n, quantity: 2n }]), C);
    Assert.equal(GetU32(Fields, Result), Success);
    Assert.equal(C.Wallets.get('42'), 96000n);
    Assert.deepEqual(GetFields(Fields, Tx.Price).map(F => F.value), [1500n, 500n]);
    Assert.deepEqual(GetFields(Fields, Tx.Quantity).map(F => F.value), [2n, 2n]);
    Assert.deepEqual(C.GatoradeBoosts.get(OwnedKey(C)).counts, [2, 0, 0]);
    Assert.equal(C.OwnedItems.get(OwnedKey(C)).length, 1);
    AssertRejected(Cart([{ item: 0xed175be5, price: 500n }, { item: 0xd9bf4ca0, price: 125n }]));
});

Test('skills cannot bypass the native cart validation through the legacy tattoo purchase route', () => {
    for (const [Item] of Products) {
        const C = Context();
        const Req = Input(new Builder().AddStringCrc(Tx.Item, Item).AddU64(Tx.Quantity, 1n).Build());
        Assert.equal(GetU32(Parse(Purchase.BuildConsumable(Req, C).Body).Fields, Result), Failure);
        Assert.equal(C.Wallets.get('42'), 100000n);
        Assert.equal(C.Purchases.size, 0);
    }
});

Test('unrelated items and the special seventh skill category keep their existing pricing path', () => {
    for (const Item of [0x677d5533, 0x4b6cc362, 0xed175be5, 0x12345678]) Assert.equal(Skills.ProductFor(Item), null);
    const C = Context();
    C.VcPrices.set(0x12345678, { price: 750n });
    const Fields = Quote([0x12345678], C);
    Assert.equal(GetU64(Fields, Crc32('FINAL_PRICE_0')), 750n);
    Assert.equal(GetU32(Buy(Cart([{ item: 0x12345678 }]), C), Result), Success);
    Assert.equal(C.Wallets.get('42'), 99250n);
});

Test('handler recreation between quote and purchase cannot reset a skill price to 100 (no listener)', async T => {
    const { Readable } = require('node:stream');
    const Server = require('../Source/Server');
    const Root = Fs.mkdtempSync(Path.join(process.env.PI_SCRATCH_DIR || Os.tmpdir(), 'skill-prices-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const ConfigFile = Path.join(Root, 'Config.json');
    Fs.writeFileSync(ConfigFile, JSON.stringify({ VirtualCurrencyStatic: false }));
    const Config = Server.LoadConfig(ConfigFile);
    const C = Context();
    delete C.VcPrices;
    const Session = { userId: 42n, careerSlot: '0', verified: true };
    const Dependencies = { ...C, Careers: new Map(), CareerGrind: new Map(), CareerOveralls: new Map(),
        AutomaticOwnedItems: [], Sessions: { get: () => Session, bind: (Key, Patch) => ({ ...Session, ...Patch }) } };
    let Handler = Server.CreateHandler(Config, Dependencies);
    async function Dispatch(Route, Req) {
        const R = Readable.from([Req.Body]);
        Object.assign(R, { method: 'POST', url: `/nba/2k19/VirtualCurrency/${Route}?x=skill-test`, headers: Req.headers });
        const Res = { writeHead(Status) { this.statusCode = Status; }, end(Body) { this.Body = Body; } };
        await Handler(R, Res);
        Assert.equal(Res.statusCode, 200);
        return Parse(Res.Body).Fields;
    }
    const Quoted = await Dispatch('get_prices', Input(new Builder().AddStringCrc(Crc32('ITEM_0'), 0xd9bf4ca0).Build()));
    Assert.equal(GetU64(Quoted, Crc32('FINAL_PRICE_0')), 1500n);
    Handler = Server.CreateHandler(Config, Dependencies);
    const Bought = await Dispatch('purchase', Cart([{ item: 0xd9bf4ca0 }]));
    Assert.equal(GetU32(Bought, Result), Success);
    Assert.equal(GetU64(Bought, Tx.Price), 1500n);
    Assert.equal(GetU64(Bought, Purchase.BalanceCrc), 98500n);
    Assert.equal(C.Wallets.get('42'), 98500n);
});
