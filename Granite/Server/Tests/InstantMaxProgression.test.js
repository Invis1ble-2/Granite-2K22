'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Http = require('node:http');
const Os = require('node:os');
const Path = require('node:path');
const { Builder, Parse, GetU64, Crc32 } = require('../Source/Codec/FieldList');
const State = require('../Source/Services/MyCareer/GrindPoints/State');
const Get = require('../Source/Services/MyCareer/Attributes/Get');
const Add = require('../Source/Services/MyCareer/GrindPoints/AddGrindPoints');
const { CreateHandler, LoadConfig } = require('../Source/Server');
const { LoadCareerGrind, SaveCareerGrind } = require('../Source/Storage/CareerGrind');

function Total(Reply) {
    return GetU64(Parse(Reply.Body, { FieldListSize: Reply.FieldListSize }).Fields, State.Fields.GrindPoints);
}

function Match(Delta, ClientTotal) {
    const Reply = new Builder().AddU64(State.Fields2K22.GrindPoints, BigInt(Delta))
        .AddU64(State.Fields2K22.ClientTotal, BigInt(ClientTotal))
        .AddU64(State.Fields.CounterIncrement, 1n).Build();
    return { Parsed: Parse(Reply.Body) };
}

Test('instant progression persists once, preserves attributes, survives reload and keeps slots separate', () => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-instant-'));
    try {
        const File = Path.join(Root, 'GrindPoints.json');
        let Saves = 0;
        const Context = {
            userId: 'player', careerScopeId: 'slot-1', InstantMaxProgression: true,
            ForcedGrindPoints: NaN, CareerGrind: new Map(), Careers: new Map(),
            SaveCareerGrind: () => { Saves++; SaveCareerGrind(File, Context.CareerGrind); },
        };
        const Before = Get.Build({}, { ...Context, InstantMaxProgression: false });
        Assert.equal(Total(Before), null);
        const AttributesBefore = Context.Careers.get('player:slot-1').map(Item => ({ ...Item }));
        Assert.equal(Total(Get.Build({}, Context)), 2478075n);
        Assert.equal(Total(Get.Build({}, Context)), 2478075n);
        Assert.equal(Saves, 1);
        Assert.deepEqual(Context.Careers.get('player:slot-1'), AttributesBefore);
        Context.CareerGrind = LoadCareerGrind(File);
        Assert.equal(Total(Get.Build({}, { ...Context, InstantMaxProgression: false })), 2478075n);
        const Second = { ...Context, careerScopeId: 'slot-2' };
        Assert.equal(Total(Get.Build({}, { ...Second, InstantMaxProgression: false })), null);
        Assert.equal(Total(Get.Build({}, Second)), 2478075n);
        Assert.equal(Context.CareerGrind.size, 2);
    } finally { Fs.rmSync(Root, { recursive: true, force: true }); }
});

Test('post-match replies retain the full budget, including when a match is the first request', () => {
    const Context = { userId: 'player', careerScopeId: 'slot-1', InstantMaxProgression: true,
        ForcedGrindPoints: NaN, CareerGrind: new Map(), Careers: new Map() };
    Assert.equal(Total(Add.Build(Match(6758, 6758), Context)), 2484833n);
    Assert.equal(Total(Add.Build(Match(100, 6858), Context)), 2484933n);
    Assert.equal(Total(Get.Build({}, Context)), 2484933n);
    Assert.deepEqual(Context.CareerGrind.get('player:slot-1'), { total: 2484933, counter: 2 });
    Context.CareerGrind.set('player:slot-1', { total: 23710, counter: 3 });
    Assert.equal(Total(Get.Build({}, Context)), 2478075n);
    Assert.equal(Context.CareerGrind.get('player:slot-1').counter, 3);
    Context.CareerGrind.set('player:slot-1', { total: 3000000, counter: 4 });
    Assert.equal(Total(Get.Build({}, Context)), 3000000n);
    Assert.equal(Total(Get.Build({}, {})), null);
});

Test('legacy forced experience is consistent in attribute and post-match replies', () => {
    const Context = { userId: 'player', CareerGrind: new Map(), Careers: new Map(), ForcedGrindPoints: 5000 };
    Assert.equal(Total(Get.Build({}, Context)), 5000n);
    Assert.equal(Total(Add.Build(Match(100, 100), Context)), 5000n);
    Assert.equal(Context.CareerGrind.get('player:0').total, 100);
    Context.InstantMaxProgression = true;
    Assert.equal(Total(Get.Build({}, Context)), 2478075n);
    Assert.equal(Total(Add.Build(Match(100, 100), Context)), 2478075n);
});

Test('configured HTTP routes initialize a new slot, persist matches and reset a reused slot', async T => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-instant-http-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const ConfigFile = Path.join(Root, 'Config.json');
    Fs.writeFileSync(ConfigFile, JSON.stringify({ InstantMaxProgression: true }));
    const Config = LoadConfig(ConfigFile);
    Assert.equal(Config.InstantMaxProgression, true);
    const Server = Http.createServer(CreateHandler(Config, { StoreCatalogPrices: new Map() }));
    await new Promise(Resolve => Server.listen(0, '127.0.0.1', Resolve));
    T.after(() => new Promise(Resolve => Server.close(Resolve)));
    async function Request(Route, Slot, Extra = () => {}) {
        const BuilderValue = new Builder().AddU64(Crc32('USERID'), 123n)
            .AddU64(0x5eeda966, BigInt(Slot)).AddU64(0xd5e5f21d, 0n);
        Extra(BuilderValue);
        const Body = BuilderValue.Build().Body;
        return await new Promise((Resolve, Reject) => {
            const Req = Http.request({ host: '127.0.0.1', port: Server.address().port,
                path: `/nba/2k19/${Route}`, method: 'POST',
                headers: { 'Content-Length': String(Body.length), VCFIELDLIST_SIZE: String(Body.length) } }, Res => {
                const Chunks = [];
                Res.on('data', Chunk => Chunks.push(Chunk));
                Res.on('end', () => Resolve({ Body: Buffer.concat(Chunks),
                    FieldListSize: Number(Res.headers.vcfieldlist_size) }));
            });
            Req.on('error', Reject);
            Req.end(Body);
        });
    }
    await Request('MyCareer/save', 1);
    Assert.deepEqual(LoadCareerGrind(Config.CareerGrind).get('123:slot-1'), { total: 2478075, counter: 0 });
    Assert.equal(Total(await Request('MyCareer/Attributes/get', 1)), 2478075n);
    Assert.equal(Total(await Request('MyCareerV3/AddGrindPoints', 1, B => B
        .AddU64(State.Fields2K22.GrindPoints, 6758n)
        .AddU64(State.Fields2K22.ClientTotal, 6758n)
        .AddU64(State.Fields.CounterIncrement, 1n))), 2484833n);
    Assert.equal(Total(await Request('MyCareer/Attributes/get', 2)), 2478075n);
    Assert.equal(LoadCareerGrind(Config.CareerGrind).get('123:slot-1').total, 2484833);
    await Request('MyCareer/save', 1);
    Assert.deepEqual(LoadCareerGrind(Config.CareerGrind).get('123:slot-1'), { total: 2478075, counter: 0 });
    // A fresh handler reloads the same files with the feature switched off.
    const Reloaded = Http.createServer(CreateHandler({ ...Config, InstantMaxProgression: false },
        { StoreCatalogPrices: new Map() }));
    await new Promise(Resolve => Reloaded.listen(0, '127.0.0.1', Resolve));
    T.after(() => new Promise(Resolve => Reloaded.close(Resolve)));
    const Body = new Builder().AddU64(Crc32('USERID'), 123n).AddU64(0x5eeda966, 1n).Build().Body;
    const Reply = await new Promise((Resolve, Reject) => {
        const Req = Http.request({ host: '127.0.0.1', port: Reloaded.address().port,
            path: '/nba/2k19/MyCareer/Attributes/get', method: 'POST' }, Res => {
            const Chunks = [];
            Res.on('data', Chunk => Chunks.push(Chunk));
            Res.on('end', () => Resolve({ Body: Buffer.concat(Chunks) }));
        });
        Req.on('error', Reject);
        Req.end(Body);
    });
    Assert.equal(Total(Reply), 2478075n);
});
