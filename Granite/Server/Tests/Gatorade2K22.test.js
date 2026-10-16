'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const Os = require('node:os');
const { Builder, Parse, GetFields, GetU32, GetU64 } = require('../Source/Codec/FieldList');
const { Crc32 } = require('../Source/Core/Crc32');
const Purchase = require('../Source/Services/VirtualCurrency/Purchase');
const Attributes = require('../Source/Services/MyCareer/Attributes/Get');
const Gatorade = require('../Source/Services/MyCareer/Gatorade');
const Store = require('../Source/Storage/GatoradeBoosts');
const { OwnedKey } = require('../Source/Storage/OwnedItems');
const { InventoryFor } = require('../Source/Storage/AutomaticOwnership');
const Result = Crc32('RESULT'), Success = Crc32('SUCCESS');
const Agent = 'VISUAL_CONCEPTS_WIN64/22.0';
function Input(Packet, Id = '1') {
    return { Body: Packet.Body, Parsed: Parse(Packet.Body), headers: { 'user-agent': Agent, 'vc-request-id': Id } };
}
function Cart(Rows, Id = '1') {
    const B = new Builder();
    Rows.forEach((R, I) => B.AddStringCrc(0xfd76cfbd, R.item).AddStringCrc(0xc1ed2239, R.type ?? 0xbb8189c6)
        .AddU64(Crc32(`ITEM${I}_COUNT`), R.quantity ?? 1n)
        .AddU64(Crc32(`ITEM${I}_EXPECTED_PRICE`), R.price ?? Store.ProductFor(R.item)?.price ?? 100n));
    return Input(B.Build(), Id);
}
function Context() {
    return { userId: 42n, SessionKey: 'session-one', careerScopeId: 'slot-0',
        GatoradeBoosts: new Map(), OwnedItems: new Map(), Wallets: new Map([['42', 100000n]]),
        VirtualCurrencyStatic: false, Purchases: new Map() };
}
function Counts(C) { return Gatorade.StateFor(C)?.counts; }
function ResultOf(Reply) { return GetU32(Parse(Reply.Body).Fields, Result); }
function AttributeReply(C) { return Attributes.Build(Input(new Builder().Build()), C); }
function NativeApply(Reply, Skills) {
    // Mirrors the observed WasSeen logic of FUN_141192840, not an in-game test.
    const SkillIds = [0x4822e8a5, 0x6c0e5921, 0x8577fd4e, 0x3e1552fe, 0x456a08ba, 0x12317592, 0xb4c321d5];
    const F = Parse(Reply.Body).Fields, Ids = GetFields(F, Gatorade.Fields.Type);
    const Values = GetFields(F, Gatorade.Fields.Count);
    Assert.equal(Ids.length, 10);
    Assert.equal(Values.length, 10);
    const NextSkills = [...Skills], Drinks = [-1, -1, -1];
    Ids.forEach((F, I) => {
        const Skill = SkillIds.indexOf(F.Data1), Drink = Store.BoostIds.indexOf(F.Data1);
        if (Skill !== -1) NextSkills[Skill] = Number(Values[I].value);
        if (Drink !== -1) Drinks[Drink] = Math.max(0, Math.min(99, Number(Values[I].value)));
    });
    return { skills: NextSkills, drinks: Drinks };
}

Test('three native 10-packs grant ten uses per category and use real prices, not permanent ownership', () => {
    const C = Context();
    const Historical = [{ item: '0xE80626B4', price: '100' }, { item: 123, price: '500' }];
    C.OwnedItems.set(OwnedKey(C), Historical);
    C.SaveOwnedItems = () => Assert.fail('Gatorade must not rewrite purchase history');
    let Saves = 0; C.SaveGatoradeBoosts = () => Saves++;
    const Reply = Purchase.Build(Cart([{ item: 0xe80626b4 }, { item: 0x88d81a73 }, { item: 0x45a9e847 }]), C);
    Assert.equal(ResultOf(Reply), Success);
    Assert.deepEqual(Counts(C), [10, 10, 10]);
    Assert.equal(C.Wallets.get('42'), 89500n);
    Assert.deepEqual(GetFields(Parse(Reply.Body).Fields, 0xfca5f7d2).map(F => F.value), [3500n, 3500n, 3500n]);
    Assert.equal(Saves, 1);
    Assert.deepEqual(C.OwnedItems.get(OwnedKey(C)), Historical);
    Assert.deepEqual(InventoryFor(C), [Historical[1]], 'historical consumables are not permanent instances');
});
for (const [Item, Expected] of [
    [0xed175be5, [2, 0, 0]], [0x45a9e847, [20, 0, 0]],
    [0x4c99dc6d, [0, 2, 0]], [0xe80626b4, [0, 20, 0]],
    [0xf713373a, [0, 0, 2]], [0x88d81a73, [0, 0, 20]],
]) Test(`quantity and category mapping ${Item.toString(16)}`, () => {
    const C = Context(), P = Store.ProductFor(Item);
    const Reply = Purchase.Build(Cart([{ item: Item, quantity: 2n }]), C);
    Assert.equal(ResultOf(Reply), Success);
    Assert.deepEqual(Counts(C), Expected);
    Assert.equal(C.Wallets.get('42'), 100000n - P.price * 2n);
    Assert.equal(GetU64(Parse(Reply.Body).Fields, 0xfca5f7d2), P.price, 'reply price is per pack');
    Assert.equal(GetU64(Parse(Reply.Body).Fields, 0x728d86d2), 2n);
});

Test('selective attributes apply drinks without clearing any of the seven existing skill boosts', () => {
    const C = Context(); Purchase.Build(Cart([{ item: 0xe80626b4 }]), C);
    const Skills = [1, 0, 12, 11, 1, 10, 23];
    Assert.deepEqual(NativeApply(AttributeReply(C), Skills), { skills: Skills, drinks: [0, 10, 0] });
    const Other = { ...C, userId: 43n };
    Assert.equal(GetFields(Parse(AttributeReply(Other).Body).Fields, Gatorade.Fields.Type).length, 0);
    Assert.deepEqual(NativeApply(AttributeReply({ ...C, careerScopeId: 'slot-1' }), Skills).drinks, [0, 10, 0]);
    const Legacy = Attributes.Build({ headers: { 'user-agent': 'VISUAL_CONCEPTS_WIN64/19.0' } }, C);
    Assert.equal(GetFields(Parse(Legacy.Body).Fields, Gatorade.Fields.Type).length, 0);
});

Test('bad counts, price/type, insufficient funds and capacity fail before granting or charging', () => {
    const BadRows = [
        { item: 0xed175be5, quantity: 0n }, { item: 0xed175be5, quantity: 100n },
        { item: 0xed175be5, quantity: -1n }, { item: 0xed175be5, price: 100n },
        { item: 0xed175be5, type: 0x4feaedaa },
    ];
    for (const Row of BadRows) {
        const C = Context();
        Assert.notEqual(ResultOf(Purchase.Build(Cart([Row]), C)), Success);
        Assert.equal(C.GatoradeBoosts.size, 0);
        Assert.equal(C.Wallets.get('42'), 100000n);
        Assert.equal(C.OwnedItems.size, 0);
        Assert.equal(C.Purchases.size, 0);
    }
    const C = Context(); C.Wallets.set('42', 10n);
    Assert.notEqual(ResultOf(Purchase.Build(Cart([{ item: 0xed175be5 }]), C)), Success);
    Assert.equal(C.GatoradeBoosts.size, 0);
    const Full = Context(); Full.GatoradeBoosts.set(OwnedKey(Full), { counts: [99, 0, 0], receipts: [] });
    Assert.notEqual(ResultOf(Purchase.Build(Cart([{ item: 0xed175be5 }]), Full)), Success);
    Assert.deepEqual(Counts(Full), [99, 0, 0]);
    Assert.equal(Full.Wallets.get('42'), 100000n);
    for (const Invalid of [{ ...Context(), userId: null }, { ...Context(), GatoradeBoosts: null }])
        Assert.notEqual(ResultOf(Purchase.Build(Cart([{ item: 0xed175be5 }]), Invalid)), Success);
});

Test('storage errors roll back counts without debiting the wallet', () => {
    const C = Context(); C.SaveGatoradeBoosts = () => { throw new Error('disk unavailable'); };
    Assert.notEqual(ResultOf(Purchase.Build(Cart([{ item: 0xed175be5 }]), C)), Success);
    Assert.equal(C.GatoradeBoosts.size, 0);
    Assert.equal(C.Wallets.get('42'), 100000n);
    Assert.equal(C.Purchases.size, 0);
});

Test('static balance policy is unchanged and ordinary skill carts have identical replies', () => {
    const C = Context(); C.VirtualCurrencyStatic = true;
    Purchase.Build(Cart([{ item: 0xed175be5 }]), C);
    Assert.equal(C.Wallets.get('42'), 888888n);
    const SkillInput = Cart([{ item: 0x667c0cff, price: 200n }, { item: 0xa96fcda4, quantity: 2n, price: 1500n }]);
    const Base = Context(), WithState = Context();
    WithState.GatoradeBoosts.set(OwnedKey(WithState), { counts: [10, 20, 30], receipts: [] });
    const Before = JSON.stringify([...WithState.GatoradeBoosts]);
    const BaseReply = Purchase.Build(SkillInput, Base), StateReply = Purchase.Build(SkillInput, WithState);
    Assert.equal(ResultOf(BaseReply), Success);
    Assert.equal(ResultOf(StateReply), Success);
    Assert.equal(Base.Wallets.get('42'), 96800n);
    Assert.equal(WithState.Wallets.get('42'), 96800n);
    Assert.deepEqual(BaseReply.Body, StateReply.Body);
    Assert.equal(JSON.stringify([...WithState.GatoradeBoosts]), Before);
});

Test('uses and bounded duplicate receipts persist across reloads; no historical purchases are replayed', T => {
    const Root = Fs.mkdtempSync(Path.join(process.env.PI_SCRATCH_DIR || Os.tmpdir(), 'gatorade-test-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const File = Path.join(Root, 'boosts.json'), C = Context();
    C.GatoradeBoosts = Store.Load(File);
    C.SaveGatoradeBoosts = () => Store.Save(File, C.GatoradeBoosts);
    const Req = Cart([{ item: 0x45a9e847 }], 'paid-1');
    Assert.equal(ResultOf(Purchase.Build(Req, C)), Success);
    const Wallet = C.Wallets.get('42');
    Purchase.Build(Req, C);
    Assert.equal(C.Wallets.get('42'), Wallet);
    Assert.deepEqual(Counts(C), [10, 0, 0]);
    C.GatoradeBoosts = Store.Load(File);
    Purchase.Build(Req, C);
    Assert.equal(C.Wallets.get('42'), Wallet);
    Assert.deepEqual(Counts(C), [10, 0, 0]);
    Purchase.Build(Cart([{ item: 0x45a9e847 }], 'paid-2'), C);
    Assert.deepEqual(Counts(C), [20, 0, 0]);
    const Other = { ...C, userId: 43n };
    Assert.equal(Gatorade.StateFor(Other), null);
    Fs.writeFileSync(File, '{corrupted');
    Assert.throws(() => Store.Load(File));
    Assert.deepEqual(Fs.readdirSync(Root), ['boosts.json']);
});

Test('native decrease decrements only tracked drinks once, floors at zero and leaves skills untouched', () => {
    const C = Context(); C.GatoradeBoosts.set(OwnedKey(C), { counts: [1, 10, 0], receipts: [] });
    const Decrease = Input(new Builder().AddStringCrc(Gatorade.Fields.Reason, 0xc01ce911).Build(), 'consume-1');
    const Skills = [1, 0, 12, 11, 1, 10, 5];
    const Reply = Gatorade.Decrease(Decrease, C);
    Assert.equal(ResultOf(Reply), Success);
    Assert.deepEqual(NativeApply(Reply, Skills), { skills: Skills, drinks: [0, 9, 0] });
    Gatorade.Decrease(Decrease, C);
    Assert.deepEqual(Counts(C), [0, 9, 0]);
    for (const Reason of [0x29846bce, 0x2e00cea4])
        Gatorade.Decrease(Input(new Builder().AddStringCrc(Gatorade.Fields.Reason, Reason).Build(), String(Reason)), C);
    Assert.deepEqual(Counts(C), [0, 7, 0]);
    const Before = JSON.stringify([...C.GatoradeBoosts]);
    Gatorade.Decrease(Input(new Builder().AddStringCrc(Gatorade.Fields.Reason, 0).Build()), C);
    Assert.equal(JSON.stringify([...C.GatoradeBoosts]), Before);
    const Empty = Context();
    Assert.equal(Parse(Gatorade.Decrease(Decrease, Empty).Body).Fields.length, 1);
    Assert.equal(Empty.GatoradeBoosts.size, 0);
});

Test('HTTP dispatcher loads and persists Gatorade state without a listener', async T => {
    const { Readable } = require('node:stream');
    const Server = require('../Source/Server');
    const Root = Fs.mkdtempSync(Path.join(process.env.PI_SCRATCH_DIR || Os.tmpdir(), 'gatorade-route-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const ConfigFile = Path.join(Root, 'Config.json');
    Fs.writeFileSync(ConfigFile, JSON.stringify({ VirtualCurrencyStatic: false }));
    const Config = Server.LoadConfig(ConfigFile);
    const Session = { userId: 42n, careerSlot: '0', verified: true };
    const Dependencies = { Careers: new Map(), Wallets: new Map([['42', 100000n]]), OwnedItems: new Map(),
        CareerGrind: new Map(), CareerOveralls: new Map(), StoreCatalogPrices: new Map(), AutomaticOwnedItems: [],
        Sessions: { get: () => Session, bind: (Key, Patch) => ({ ...Session, ...Patch }) } };
    let Handler = Server.CreateHandler(Config, Dependencies);
    async function Dispatch(Route, Data) {
        const Req = Readable.from([Data.Body]);
        Object.assign(Req, { method: 'POST', url: `/nba/2k19/${Route}?x=test-session`, headers: Data.headers });
        const Res = { writeHead(Status) { this.statusCode = Status; }, end(Body) { this.Body = Body; } };
        await Handler(Req, Res);
        Assert.equal(Res.statusCode, 200);
        return { Body: Res.Body };
    }
    const Buy = Cart([{ item: 0x45a9e847 }], 'buy');
    Assert.equal(ResultOf(await Dispatch('VirtualCurrency/purchase', Buy)), Success);
    const Skills = [1, 0, 12, 11, 1, 10, 9];
    const Read = Input(new Builder().Build(), 'read');
    Assert.deepEqual(NativeApply(await Dispatch('MyCareer/Attributes/get', Read), Skills), { skills: Skills, drinks: [10, 0, 0] });
    Assert.equal(Store.Load(Config.GatoradeBoostsFile).get(OwnedKey({ userId: 42n })).counts[0], 10);
    const Wallet = Dependencies.Wallets.get('42');
    Handler = Server.CreateHandler(Config, Dependencies);
    await Dispatch('VirtualCurrency/purchase', Buy);
    Assert.equal(Dependencies.Wallets.get('42'), Wallet);
    Assert.deepEqual(NativeApply(await Dispatch('MyCareer/Attributes/get', Read), Skills).drinks, [10, 0, 0]);
    const Use = Input(new Builder().AddStringCrc(Gatorade.Fields.Reason, 0xc01ce911).Build(), 'use');
    Assert.deepEqual(NativeApply(await Dispatch('MyCareerV3/DecreaseBoosts', Use), Skills), { skills: Skills, drinks: [9, 0, 0] });
    Assert.equal(Store.Load(Config.GatoradeBoostsFile).get(OwnedKey({ userId: 42n })).counts[0], 9);
    Assert.equal(Dependencies.OwnedItems.size, 0);
});
