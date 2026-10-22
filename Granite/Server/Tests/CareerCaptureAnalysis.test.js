'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const { Builder } = require('../Source/Codec/FieldList');
const { Normalize } = require('../Source/Services/MyCareer/Attributes/Constants');


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
