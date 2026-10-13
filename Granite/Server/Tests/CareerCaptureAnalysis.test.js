'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const { Builder } = require('../Source/Codec/FieldList');
const { Analyze } = require('../Tools/AnalyzeCareerCapture');
const { Normalize } = require('../Source/Services/MyCareer/Attributes/Constants');

Test('capture analysis reparses binaries, preserves repeated CRCs and separates slots', () => {
    const Directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'career-capture-'));
    try {
        function Save(Name, Slot, Values, Response = true) {
            const Base = Path.join(Directory, Name);
            const Request = new Builder().AddU64(0x5eeda966, BigInt(Slot)).Build();
            // Deliberately stale sidecar parse: binary must be the source of truth.
            Fs.writeFileSync(`${Base}.json`, JSON.stringify({ url: '/nba/2k19/MyCareer/Attributes/get?x=123', Parse: { Status: 'empty' } }));
            Fs.writeFileSync(`${Base}.bin`, Request.Body);
            if (Response) {
                const Reply = new Builder();
                for (const Value of Values) Reply.AddU64(0x6dbe0ea3, BigInt(Value));
                Fs.writeFileSync(`${Base}.response.bin`, Reply.Build().Body);
            }
        }
        Save('202610110001', 1, [3, 5]);
        Save('202610110002', 2, [90, 90]);
        Save('202610110003', 1, [3, 6]);
        Save('202610110004', 1, [], false);
        const Report = Analyze(Directory);
        Assert.equal(Report.errors.length, 0);
        Assert.equal(Report.timeline.length, 4);
        Assert.equal(Report.timeline[1].previous, undefined);
        Assert.equal(Report.timeline[2].previous, '202610110001.json');
        Assert.equal(Report.timeline[2].responseChanges.length, 1);
        Assert.equal(Report.timeline[2].responseChanges[0].key, '0x6DBE0EA3[1]');
        Assert.equal(Report.timeline[2].responseChanges[0].after.value, '6');
        Assert.equal(Report.timeline[3].response.status, 'missing');
        Assert.equal(Report.timeline[3].responseChanges, null);
        Assert.equal(Analyze(Directory, '202610110003').timeline.length, 2);
    } finally { Fs.rmSync(Directory, { recursive: true, force: true }); }
});

Test('2K22 grind request uses the post-match client total and persists later increments', () => {
    const State = require('../Source/Services/MyCareer/GrindPoints/State');
    const Add = require('../Source/Services/MyCareer/GrindPoints/AddGrindPoints');
    const { Parse, GetU64 } = require('../Source/Codec/FieldList');
    const Context = { userId: 'test', careerScopeId: 'slot-2', CareerGrind: new Map(), Careers: new Map() };
    function Input(Delta, Total) {
        const Body = new Builder().AddU64(0x9479e41f, BigInt(Delta)).AddU64(0x447e70ad, 100n)
            .AddU64(0xc015fb98, BigInt(Total)).AddU64(0xe52096da, 1n).Build().Body;
        return { Body, Parsed: Parse(Body) };
    }
    const First = Add.Build(Input(1500, 5000), Context);
    Assert.equal(GetU64(Parse(First.Body).Fields, State.Fields.GrindPoints), 5000n);
    const Next = Add.Build(Input(700, 5700), Context);
    Assert.equal(GetU64(Parse(Next.Body).Fields, State.Fields.GrindPoints), 5700n);
    Assert.deepEqual(Context.CareerGrind.get('test:slot-2'), { total: 5700, counter: 2 });
    const MissingScope = Add.Build(Input(700, 5700), {});
    Assert.equal(GetU64(Parse(MissingScope.Body).Fields, State.Fields.GrindPoints), 5700n);
});

Test('2K22 profile respects configured maximum rather than replacing it with 99', () => {
    Assert.equal(Normalize({}, 0, { generation: '2K22' }).maxLevel, 25n);
    Assert.equal(Normalize({}, 0, { generation: '2K22', maxLevels: Array(24).fill(37) }).maxLevel, 37n);
});
