'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const Os = require('node:os');
const { Builder, Parse, GetFields, GetU32, Crc32 } = require('../Source/Codec/FieldList');
const State = require('../Source/Services/MyCareer/Badges/State');
const Get = require('../Source/Services/MyCareer/Attributes/Get');
const Add = require('../Source/Services/MyCareer/GrindPoints/AddGrindPoints');
const Update = require('../Source/Services/MyCareer/Badges/Update');
const { Import } = require('../Tools/ImportNBA2K22BadgeBudget');

function Setup(T) {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-badges-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Config = { CareerBadgesFile: Path.join(Root, 'BadgePoints.json'), SessionDirectory: Path.join(Root, 'sessions') };
    Fs.mkdirSync(Config.SessionDirectory);
    Fs.writeFileSync(Path.join(Config.SessionDirectory, 'one.json'), JSON.stringify({ userId: '123', careerSlot: '2' }));
    const Context = { userId: '123', careerScopeId: 'slot-2', Careers: new Map(), CareerGrind: new Map(), ...Config };
    const Potential = Array(24).fill(1000000);
    Context.BuildProfile = { caps: Potential };
    const Snapshot = { source: 'NBA2K22-native-1411D39A0', careerSaveId: '0', careerSlot: '2',
        caps: [10,9,10,7], progress: [100000,90000,100000,70000], extra: [0,0,0,0],
        potential: Potential, levels: { '12345': State.Levels[0] } };
    return { Config, Context, Snapshot };
}
function Fields(Reply) { return Parse(Reply.Body, { FieldListSize: Reply.FieldListSize }).Fields; }
function Numbers(Values, Crc) { return GetFields(Values, Crc).map(Field => Number((BigInt(Field.Data1) << 32n) | BigInt(Field.Data2))); }

Test('native per-build maxima import as 10/9/10/7 and survive reload without copying them into other slots', T => {
    const { Config, Context, Snapshot } = Setup(T);
    const Result = Import(Snapshot, Config);
    Assert.equal(Result.key, '123:slot-2');
    const Reply = Fields(Get.Build({}, Context));
    Assert.deepEqual(GetFields(Reply, State.Fields.Category).map(F => F.Data1), State.Categories);
    Assert.deepEqual(Numbers(Reply, State.Fields.Earned), [10,9,10,7]);
    Assert.deepEqual(Numbers(Reply, State.Fields.Extra), [0,0,0,0]);
    const Reloaded = { ...Context, Careers: new Map() };
    Assert.deepEqual(Numbers(Fields(Get.Build({}, Reloaded)), State.Fields.Earned), [10,9,10,7]);
    Assert.equal(GetFields(Fields(Get.Build({}, { ...Context, careerScopeId: 'slot-1' })), State.Fields.Category).length, 0);
    Assert.equal(GetFields(Fields(Get.Build({}, { ...Context, userId: '456' })), State.Fields.Category).length, 0);
    const OtherBuild = { ...Context, Careers: new Map(), BuildProfile: { caps: Array(24).fill(500000) } };
    Assert.equal(GetFields(Fields(Get.Build({}, OtherBuild)), State.Fields.Category).length, 0);
});

Test('post-match reports cannot reduce the granted budget, and badge choices persist', T => {
    const { Config, Context, Snapshot } = Setup(T);
    Import(Snapshot, Config);
    const Match = new Builder().AddU64(0x9479e41f, 100n).AddU64(0xc015fb98, 100n)
        .AddU32(State.Fields.Category, State.Categories[0])
        .AddU64(State.Fields.Earned, 0n).AddU64(State.Fields.Progress, 100005n).Build();
    Assert.deepEqual(Numbers(Fields(Add.Build({ Parsed: Parse(Match.Body) }, Context)), State.Fields.Earned), [10,9,10,7]);
    Assert.equal(State.For(Context).progress[0], 100005);
    const Choice = new Builder().AddU32(State.Fields.Badge, 12345).AddU32(State.Fields.ToLevel, State.Levels[2]).Build();
    const Reply = Fields(Update.Build({ Parsed: Parse(Choice.Body) }, Context));
    Assert.equal(GetU32(Reply, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(GetU32(Reply, State.Fields.Level), State.Levels[2]);
    Assert.equal(State.For(Context).levels['12345'], State.Levels[2]);
    Assert.deepEqual(Numbers(Fields(Get.Build({}, Context)), State.Fields.Earned), [10,9,10,7]);
    const Invalid = new Builder().AddU32(State.Fields.Badge, 12345).AddU32(State.Fields.ToLevel, 123).Build();
    Assert.equal(GetU32(Fields(Update.Build({ Parsed: Parse(Invalid.Body) }, Context)), Crc32('RESULT')), Crc32('FAILURE'));
    Assert.equal(State.For(Context).levels['12345'], State.Levels[2]);
});

Test('each snapshot has its own maxima, includes existing extra points and validates account selection', T => {
    const { Config, Context, Snapshot } = Setup(T);
    Snapshot.caps = [1,20,4,12];
    Snapshot.extra = [0,2,0,1];
    Import(Snapshot, Config);
    Assert.deepEqual(Numbers(Fields(Get.Build({}, Context)), State.Fields.Earned), [1,20,4,12]);
    Assert.deepEqual(Numbers(Fields(Get.Build({}, Context)), State.Fields.Extra), [0,2,0,1]);
    Fs.writeFileSync(Path.join(Config.SessionDirectory, 'two.json'), JSON.stringify({ userId: '456', careerSlot: '2' }));
    Assert.throws(() => Import(Snapshot, Config), /uniquely identify/);
    Assert.equal(Import(Snapshot, Config, '123').key, '123:slot-2');
    Assert.throws(() => Import({ ...Snapshot, caps: [65536,9,10,7] }, Config, '123'), /Invalid caps/);
    Assert.throws(() => Import({ ...Snapshot, extra: [2,0,0,0] }, Config, '123'), /Extra exceeds/);
    State.Reset(Context);
    Assert.equal(State.For(Context), null);
});
