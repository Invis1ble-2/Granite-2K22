'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const Http = require('node:http');
const { Builder, Parse, GetFields, GetU64, GetU32, Crc32 } = require('../Source/Codec/FieldList');
const Report = require('../Source/Services/MyCareer/Badges/Report');
const State = require('../Source/Services/MyCareer/Badges/State');
const Get = require('../Source/Services/MyCareer/Attributes/Get');
const { CreateHandler, LoadConfig } = require('../Source/Server');

function Wire(Caps = [10,9,10,7], Potential = Array(24).fill(1000000)) {
    const B = new Builder().AddU64(0xd5e5f21d, 0n).AddU64(0x5eeda966, 2n)
        .AddU64(Report.Fields.Version, 1n);
    for (let Index = 0; Index < 4; Index++) B.AddU64(Report.Fields.Maximum, BigInt(Caps[Index]))
        .AddU64(Report.Fields.Progress, 100000n).AddU64(Report.Fields.Extra, 0n);
    Potential.forEach(Value => B.AddU64(Report.Fields.Potential, BigInt(Value)));
    for (let Index = 0; Index < 99; Index++) B.AddU64(Report.Fields.BadgeName, BigInt(1000 + Index))
        .AddU64(Report.Fields.BadgeLevel, BigInt(State.Levels[0]));
    return B.Build().Body;
}
function Setup(T) {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-badge-report-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Context = { userId: '123', careerScopeId: 'slot-2', Careers: new Map(), CareerGrind: new Map(),
        CareerBadgesFile: Path.join(Root, 'BadgePoints.json'), InstantMaxBadges: true,
        BuildProfile: { caps: Array(24).fill(1000000) } };
    return { Root, Context };
}
function Earned(Built) { return GetFields(Parse(Built.Body).Fields, State.Fields.Earned).map(F => Number(F.value)); }

Test('module report grants the native maximum in the same attributes response and keeps stored badge choices', T => {
    const { Context } = Setup(T);
    const Body = process.env.GRANITE_BADGE_WIRE_FIXTURE
        ? Fs.readFileSync(process.env.GRANITE_BADGE_WIRE_FIXTURE) : Wire();
    const Parsed = Parse(Body);
    Assert.equal(Parsed.Data.length, 0);
    Assert.equal(Parsed.Trailing.length, 0);
    Assert.equal(GetU64(Parsed.Fields, 0x5eeda966), 2n);
    Assert.deepEqual(Earned(Get.Build({ Parsed }, Context)), [10,9,10,7]);
    const Records = State.Load(Context.CareerBadgesFile);
    Records['123:slot-2'].levels['1000'] = State.Levels[2];
    Records['123:slot-2'].progress[0] = 100005;
    State.Save(Context.CareerBadgesFile, Records);
    Get.Build({ Parsed }, Context);
    Assert.equal(State.For(Context).levels['1000'], State.Levels[2]);
    Assert.equal(State.For(Context).progress[0], 100005);
    Assert.deepEqual(Earned(Get.Build({}, { ...Context, Careers: new Map() })), [10,9,10,7]);
    Assert.deepEqual(Earned(Get.Build({}, { ...Context, careerScopeId: 'slot-3' })), []);
});

Test('disabled, anonymous, incomplete, excessive and wrong-build reports cannot alter stored state', T => {
    const { Context } = Setup(T);
    const Valid = { Parsed: Parse(Wire()) };
    Assert.equal(Report.Accept(Valid, { ...Context, InstantMaxBadges: false }), false);
    Assert.equal(Report.Accept(Valid, { ...Context, userId: null }), false);
    Assert.equal(Fs.existsSync(Context.CareerBadgesFile), false);
    Assert.equal(Report.Accept(Valid, Context), true);
    const Before = Fs.readFileSync(Context.CareerBadgesFile, 'utf8');
    Assert.equal(Report.Accept({ Parsed: Parse(new Builder().AddU64(Report.Fields.Version, 1n).Build().Body) }, Context), false);
    Assert.equal(Report.Accept({ Parsed: Parse(Wire([65536,9,10,7])) }, Context), false);
    Assert.equal(Report.Accept({ Parsed: Parse(Wire([10,9,10,7], Array(24).fill(500000))) }, Context), false);
    Assert.equal(Fs.readFileSync(Context.CareerBadgesFile, 'utf8'), Before);
});

Test('captured native report ignores the five non-badge ratios but checks every badge potential', T => {
    const { Context } = Setup(T);
    const Body = Fs.readFileSync(Path.join(__dirname, 'Fixtures/BadgeReport/AttributesGet.native.bin'));
    const Parsed = Parse(Body);
    Context.careerScopeId = 'slot-1';
    Context.BuildProfile = { caps: [413793,1000000,1000000,1000000,0,1000000,1000000,0,0,
        1000000,1000000,461538,1000000,1000000,1000000,1000000,1000000,0,1000000,
        1000000,1000000,1000000,1000000,1000000] };
    const Potentials = GetFields(Parsed.Fields, Report.Fields.Potential);
    Assert.equal(Body.length, 3856);
    Assert.equal(Parsed.Fields.length, 240);
    Assert.equal(Parsed.Trailing.length, 0);
    Assert.deepEqual(Potentials.slice(19).map(F => Number(F.value)), [0,0,0,0,0]);
    Assert.deepEqual(Earned(Get.Build({ Parsed }, Context)), [10,9,10,7]);
    const Record = State.For(Context);
    Assert.deepEqual(Record.progress, [148800,128800,148800,88800]);
    Assert.deepEqual(Record.potential.slice(19), [0,0,0,0,0]);
    Assert.equal(Record.transport, 'module-attributes-get-v1');
    Assert.deepEqual(Earned(Get.Build({}, { ...Context, Careers: new Map() })), [10,9,10,7]);
    const Before = Fs.readFileSync(Context.CareerBadgesFile, 'utf8');
    for (let Index = 0; Index < 19; Index++) {
        const Modified = Buffer.from(Body);
        const Value = Number(Potentials[Index].value);
        Modified.writeUInt32BE(Value === 1000000 ? Value - 3 : Value + 3, Potentials[Index].RecordOffset + 12);
        Assert.equal(Report.Accept({ Parsed: Parse(Modified) }, Context), false, `badge potential ${Index}`);
        const ChangedAttributes = Context.Careers.get('123:slot-1').map(Item => ({ ...Item }));
        ChangedAttributes[Index].cap = BigInt(Value === 1000000 ? Value - 3 : Value + 3);
        Assert.equal(State.For({ ...Context, Careers: new Map([['123:slot-1', ChangedAttributes]]) }), null);
    }
    Assert.equal(Fs.readFileSync(Context.CareerBadgesFile, 'utf8'), Before);
    const Records = State.Load(Context.CareerBadgesFile);
    const Badge = Object.keys(Record.levels).find(Name => Name !== '0');
    Records['123:slot-1'].levels[Badge] = State.Levels[2];
    State.Save(Context.CareerBadgesFile, Records);
    // Non-badge ratios changing must not reset a saved allocation on a repeat report.
    const ChangedTail = Buffer.from(Body);
    Potentials.slice(19).forEach(F => ChangedTail.writeUInt32BE(1000000, F.RecordOffset + 12));
    Assert.equal(Report.Accept({ Parsed: Parse(ChangedTail) }, Context), true);
    Assert.equal(State.For(Context).levels[Badge], State.Levels[2]);
});

Test('authenticated dispatcher accepts automatic report and returns native badge fields', async T => {
    const { Root } = Setup(T);
    const File = Path.join(Root, 'Config.json');
    Fs.writeFileSync(File, JSON.stringify({ InstantMaxBadges: true }));
    const Config = LoadConfig(File);
    // Use the existing session binding rather than a user id supplied in the module extension.
    const { SessionStore } = require('../Source/Storage/SessionStore');
    const Sessions = new SessionStore(Config.SessionDirectory);
    const Session = Sessions.Create({ userId: 123n });
    const Server = Http.createServer(CreateHandler(Config, { Sessions, StoreCatalogPrices: new Map(),
        BuildProfiles: new Map([['123:slot-2', { caps: Array(24).fill(1000000) }]]) }));
    await new Promise(Resolve => Server.listen(0, '127.0.0.1', Resolve));
    T.after(() => new Promise(Resolve => Server.close(Resolve)));
    const Body = Wire();
    const Response = await new Promise((Resolve, Reject) => {
        const Req = Http.request({ host: '127.0.0.1', port: Server.address().port,
            path: `/nba/2k19/MyCareer/Attributes/get?x=${Session.key}`, method: 'POST',
            headers: { 'Content-Length': Body.length, VCFIELDLIST_SIZE: Body.length } }, Res => {
            const Chunks = [];
            Res.on('data', Chunk => Chunks.push(Chunk));
            Res.on('end', () => Resolve({ Body: Buffer.concat(Chunks) }));
        });
        Req.on('error', Reject); Req.end(Body);
    });
    Assert.equal(GetU32(Parse(Response.Body).Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.deepEqual(Earned(Response), [10,9,10,7]);
    Assert.deepEqual(State.Load(Config.CareerBadgesFile)['123:slot-2'].caps, [10,9,10,7]);
});
