'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Price = require('../Source/Services/MyCareer/Attributes/Price');
const Fields = require('../Source/Codec/FieldList');
const Constants = require('../Source/Services/MyCareer/Attributes/Constants');

Test('DirectPrice generates full matrix for 24 attributes and 75 levels', () => {
    const Result = Price.DirectPrice({}, {});
    Assert.equal(Result.result, 'SUCCESS');
    Assert.equal(Result.attributesCount, 24);
    Assert.equal(Result.levelsPerAttribute, 75);
    Assert.equal(Result.matrix.length, 24);
    for (let i = 0; i < 24; i++) {
        const Attr = Result.matrix[i];
        Assert.equal(Attr.id, Constants.AttributeIds[i]);
        Assert.equal(Attr.levels.length, 75);
        Assert.equal(Attr.levels[0].level, 1);
        Assert.equal(Attr.levels[0].vc, 100);
        Assert.equal(Attr.levels[0].sp, 100);
        // Level 2 with step 25: 100 + (2-1)*25 = 125
        Assert.equal(Attr.levels[1].level, 2);
        Assert.equal(Attr.levels[1].vc, 125);
        Assert.equal(Attr.levels[1].sp, 125);
    }
});

Test('price response echoes requested ratings without changing saved career levels', () => {
    const Context = { userId: 123n, Careers: new Map(), SaveCareers() { throw new Error('price lookup must not save'); } };
    const Career = Constants.CareerKey(Context);
    const Saved = Constants.AttributeIds.map((id, index) => ({
        id,
        level: 0n,
        initial: BigInt(20 + index),
        cap: 99n,
        maxLevel: 99n,
    }));
    Context.Careers.set(Career, Saved.map((Item) => ({ ...Item })));
    const Ratings = Constants.AttributeIds.map((_, index) => BigInt(30 + index));
    const Request = new Fields.Builder();
    for (const Id of Constants.AttributeIds) Request.AddU32(Constants.Name, Id);
    for (const Rating of Ratings) Request.AddU64(Constants.Level, Rating);

    const Reply = Price.Build({ Parsed: { Fields: Fields.Parse(Request.Build().Body).Fields } }, Context);
    const ResponseFields = Fields.Parse(Reply.Body).Fields;
    Assert.deepEqual(
        Fields.GetFields(ResponseFields, Constants.Level).map((Field) => Fields.GetU64([Field], Constants.Level)),
        Ratings,
    );
    Assert.deepEqual(
        Context.Careers.get(Career).map((Item) => Item.level),
        Saved.map((Item) => Item.level),
    );
    Assert.equal(Fields.GetFields(ResponseFields, Constants.PriceCount).length, Constants.AttributeIds.length);
    Assert.ok(Fields.GetFields(ResponseFields, Constants.ToLevel).length > 0);
});
