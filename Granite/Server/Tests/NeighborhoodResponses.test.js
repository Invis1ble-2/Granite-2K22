'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const { Builder, Parse, GetU32, GetU64, GetFields, Types, Crc32 } = require('../Source/Codec/FieldList');
const Overview = require('../Source/Services/Store/GetOverview');
const Checkpoint = require('../Source/Services/GameStats/Checkpoint');
function NativeU64(Fields, Crc) {
    const Field = GetFields(Fields, Crc)[0];
    return Field?.Type === Types.U64 ? (BigInt(Field.Data1) << 32n) | BigInt(Field.Data2) : 0n;
}
const Input = Name => ({ Parsed: Parse(Fs.readFileSync(Path.join(__dirname, 'Fixtures/Neighborhood', Name))) });

Test('actual TYPE:BOOSTS request gets the cache lifetime consumed by the native overview state machine', () => {
    const Request = Input('BoostOverview.bin');
    const Response = Overview.Build(Request);
    const Fields = Parse(Response.Body, { FieldListSize: Response.FieldListSize }).Fields;
    Assert.equal(GetU32(Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(GetU64(Fields, Overview.Fields.CacheSeconds), 60n);
    Assert.equal(GetU64(Fields, Overview.Fields.Count), 0n);
    const Available = GetFields(Fields, Overview.Fields.Available)[0];
    Assert.equal(Available.Type, Types.Bool8);
    Assert.equal(Available.Data1, 0);
    Assert.equal(NativeU64(Fields, Overview.Fields.CacheSeconds), 60n);
    Assert.equal(GetFields(Fields, Overview.Fields.Count)[0].Type, Types.U64);
});

Test('actual checkpoint START acknowledges the same quest and provides a stable nonzero instance', () => {
    const Request = Input('QuestStart.bin');
    const Context = { userId: '123', careerScopeId: 'slot-1' };
    Assert.equal(GetU32(Request.Parsed.Fields, Checkpoint.Fields.Operation), Checkpoint.Operations.Start);
    const Fields = Parse(Checkpoint.Build(Request, Context).Body).Fields;
    Assert.equal(GetU32(Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(NativeU64(Fields, Checkpoint.Fields.Quest), BigInt(GetU32(Request.Parsed.Fields, Checkpoint.Fields.Quest)));
    const OldResponse = Parse(new Builder().AddU32(Checkpoint.Fields.Quest, 123).Build().Body).Fields;
    Assert.equal(NativeU64(OldResponse, Checkpoint.Fields.Quest), 0n, 'native getter rejects the old StringCrc response');
    const Instance = GetU64(Fields, Checkpoint.Fields.Instance);
    Assert.ok(Instance > 0n && Instance <= 0x7fffffffn);
    Assert.equal(GetU64(Parse(Checkpoint.Build(Request, Context).Body).Fields, Checkpoint.Fields.Instance), Instance);
    Assert.notEqual(GetU64(Parse(Checkpoint.Build(Request, { ...Context, careerScopeId: 'slot-2' }).Body).Fields,
        Checkpoint.Fields.Instance), Instance);
    const Quest = GetU32(Request.Parsed.Fields, Checkpoint.Fields.Quest);
    for (const Operation of [Checkpoint.Operations.Complete, Checkpoint.Operations.Cancel]) {
        const Parsed = Parse(new Builder().AddU32(Checkpoint.Fields.Quest, Quest)
            .AddU32(Checkpoint.Fields.Operation, Operation).AddU64(Checkpoint.Fields.Instance, Instance).Build().Body);
        const Result = Parse(Checkpoint.Build({ Parsed }, Context).Body).Fields;
        Assert.equal(NativeU64(Result, Checkpoint.Fields.Quest), BigInt(Quest));
        if (Operation === Checkpoint.Operations.Complete) Assert.equal(GetU64(Result, Checkpoint.Fields.Instance), Instance);
    }
});
