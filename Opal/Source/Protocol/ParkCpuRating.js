'use strict';

// NBA2K22 unpacked: 140974990, 140981630, 140981230. This is not a display-only rating.
const Crypto = require('node:crypto');
const Zlib = require('node:zlib');
const Resource = require('../Data/CpuRating2K22.json');
const Bytes = 0x5416c, F = Math.fround;
if (Resource.Format !== 'NBA2K22-rating-v1' || Resource.Bytes !== Bytes ||
    !/^[0-9a-f]{64}$/.test(Resource.Digest) || !Array.isArray(Resource.DataDeflateBase64) ||
    Resource.DataDeflateBase64.some(Part => typeof Part !== 'string') ||
    !Array.isArray(Resource.Groups) || Resource.Groups.length !== 23)
    throw new Error('invalid NBA2K22 rating resource');
const Data = Zlib.inflateSync(Buffer.from(Resource.DataDeflateBase64.join(''), 'base64'), { maxOutputLength: Bytes });
if (Data.length !== Bytes || Crypto.createHash('sha256').update(Data).digest('hex') !== Resource.Digest)
    throw new Error('NBA2K22 rating resource digest mismatch');
const FloatAt = Offset => Data.readFloatLE(Offset);
const FromBits = Bits => { const B = Buffer.allocUnsafe(4); B.writeUInt32LE(Bits); return B.readFloatLE(); };
const Scale = FromBits(0x3c23d70a), Inches = FromBits(0x3ec99326);
const Heights = [0x432f428f,0x43461eb8,0x4336e148,0x434b3333,0x43410a3d,0x43555c29,
    0x43410a3d,0x43555c29,0x43461eb8,0x435a70a4,0,0].map(FromBits);
const BadgeRatings = [69,79,89,99,119];
const IsFlag = Index => Index === 0x24 || (Index < 0x24 && (Index & 3) < 2);
const Groups = Resource.Groups.map(Group => {
    if (!Array.isArray(Group.Attributes) || ![1,2].includes(Group.Attributes.length) ||
        Group.Attributes.some(Index => !Number.isInteger(Index) || Index < 0 || Index >= 57) ||
        !/^[0-9a-f]{8}$/.test(Group.WeightBits)) throw new Error('invalid NBA2K22 derived attribute group');
    const Weight = FromBits(Number.parseInt(Group.WeightBits, 16));
    if (!Number.isFinite(Weight) || Weight < 0) throw new Error('invalid NBA2K22 group weight');
    return { Attributes: Group.Attributes, Weight };
});
for (let Offset = 0; Offset < 0x54168; Offset += 4) {
    if (Offset === 0xdaa4 || Offset === 0xdaa8 || (Offset >= 0xda28 && Offset < 0xdab0)) continue;
    if (!Number.isFinite(FloatAt(Offset))) throw new Error('invalid NBA2K22 rating coefficient');
}
const BucketMin = Data.readInt32LE(0xdaa4), BucketMax = Data.readInt32LE(0xdaa8);
const CurveMode = Data.readUInt32LE(0x54168);
if (BucketMax < BucketMin || BucketMax - BucketMin > 30 || CurveMode > 1)
    throw new Error('unsupported NBA2K22 rating configuration');
// Only native inputs represented by the exported template attributes or derived 0x9e are supported.
const Active = [];
for (let Index = 0; Index < 159; ++Index) {
    let Used = false;
    for (let Pair = 0; Pair < 54; ++Pair) Used ||= FloatAt((Pair * 159 + Index) * 4) !== 0;
    for (let Pair = 0; Pair < 279; ++Pair) Used ||= FloatAt(0xdab0 + (Pair * 159 + Index) * 4) !== 0;
    if (Used && Index >= 57 && Index !== 158) throw new Error('unsupported NBA2K22 rating input');
    if (Used) Active.push(Index);
}
function Round(Value) {
    if (!Number.isFinite(Value) || Value <= -2147483648 || Value >= 2147483647)
        throw new Error('invalid NBA2K22 rating conversion');
    const Low = Math.floor(Value), Fraction = Value - Low;
    return Fraction < 0.5 ? Low : Fraction > 0.5 ? Low + 1 : Low + (Math.abs(Low % 2));
}
function Curve(Offset, Value) {
    const X0 = FloatAt(Offset), X1 = FloatAt(Offset + 4), Y0 = FloatAt(Offset + 8), Y1 = FloatAt(Offset + 12);
    const Slope = F(F(Y1 - Y0) / F(X1 - X0));
    const Result = F(F(Slope * F(Value - X0)) + Y0);
    if (!Number.isFinite(Result)) throw new Error('invalid NBA2K22 rating curve');
    return Math.max(Math.min(Y0, Y1), Math.min(Math.max(Y0, Y1), Result));
}
function Derived(Attributes) {
    let Numerator = F(0), Denominator = F(0);
    for (const Group of Groups) {
        let Weight = Group.Weight, Contribution;
        if (Group.Attributes.length === 1) Contribution = F(Weight * Attributes[Group.Attributes[0]]);
        else {
            Weight = F(Weight * 0.5);
            Contribution = F(F(Attributes[Group.Attributes[0]] + Attributes[Group.Attributes[1]]) * Weight);
            Weight = F(Weight + Weight);
        }
        Denominator = F(Weight + Denominator);
        Numerator = F(Contribution + Numerator);
    }
    return Round(F(Numerator / Denominator));
}
function Calculate(Profile) {
    const Position = Profile.Position;
    if (!Number.isInteger(Position) || Position < 0 || Position > 4 || Profile.Attributes.length !== 57 ||
        Profile.Badges.length !== 99) throw new Error('invalid NBA2K22 rating profile');
    const Attributes = Profile.Attributes.slice(); Attributes[158] = Derived(Attributes);
    const Height = F(Profile.Height * Scale), Bucket = Round(F(Height * Inches));
    const BucketInRange = Bucket >= BucketMin && Bucket <= BucketMax;
    const B = Bucket - BucketMin, BucketIndex = B >= 0 && B <= 30 ? B : 0;
    const PositionWeight = FloatAt(0xd9b0 + Position * 4);
    const H0 = Heights[Position * 2], H1 = Heights[Position * 2 + 1];
    const Body = Math.max(25, Math.min(99, F(F(F(74 / F(H1 - H0)) * F(Height - H0)) + 25)));
    const AttributeCurve = FloatAt(0x54164) !== FloatAt(0x54160);
    let Best = F(0), BestType = 0;
    const Values = [];
    for (let Type = 0; Type < 9; ++Type) {
        let AN = F(0), AD = F(0), BN = F(0), BD = F(0);
        for (const Index of Active) {
            const Delta = BucketInRange ? FloatAt(0xdab0 + ((BucketIndex * 9 + Type) * 159 + Index) * 4) : 0;
            let Weight = F(Delta + FloatAt(((Position * 9 + Type) * 159 + Index) * 4));
            if (AttributeCurve) Weight = F(Weight * Curve(0x54158, Attributes[Index]));
            AD = F(Weight + AD);
            AN = F(F(Attributes[Index] * Weight) + AN);
        }
        for (let Index = 0; Index < 99; ++Index) {
            if (IsFlag(Index)) continue;
            const Level = Profile.Badges[Index];
            if (!Number.isInteger(Level) || Level < 0 || Level > 4) throw new Error('invalid NBA2K22 badge level');
            const Delta = BucketInRange ? FloatAt(0x38fd4 + ((BucketIndex * 9 + Type) * 99 + Index) * 4) : 0;
            const Weight = F(Delta + FloatAt(0x8628 + ((Position * 9 + Type) * 99 + Index) * 4));
            BD = F(Weight + BD);
            BN = F(F(Weight * BadgeRatings[Level]) + BN);
        }
        const Numerator = F(F(F(F(PositionWeight * Body) + AN) * 0.75) + F(BN * 0.25));
        const Denominator = F(F(F(PositionWeight + AD) * 0.75) + F(BD * 0.25));
        let Value = F(Numerator / Denominator);
        Value = Curve(CurveMode === 0 ? 0x53f68 + BucketIndex * 16 : 0xd9c8 + Position * 16, Value);
        Values.push(Value);
        if (Best < Value) { Best = Value; BestType = Type; }
    }
    // Native Recalculate changes type only when PLAYERDATA+0x354 low three bits are zero.
    const Type = Profile.PreserveType ? Profile.Type : BestType;
    if (!Number.isInteger(Type) || Type < 0 || Type > 8) throw new Error('invalid NBA2K22 player type');
    const Normalized = F(Values[Type] * Scale);
    const Rating = Round(Normalized > 1 ? Normalized : F(Normalized * 100));
    return { Rating, Type };
}
module.exports = { Calculate, IsFlag };
