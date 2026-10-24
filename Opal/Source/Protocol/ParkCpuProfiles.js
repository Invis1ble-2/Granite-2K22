'use strict';

const Crypto = require('node:crypto');
const Zlib = require('node:zlib');
const Catalog = require('../Data/CpuTemplates2K22.json');
const Overall = require('./ParkCpuRating');
const ProfileBytes = 672;
const RowBytes = 0x560, MaxSeed = 0xffffffff;
if (Catalog.Format !== 'NBA2K22-player-template-v2' || Catalog.RowBytes !== RowBytes ||
    !Number.isInteger(Catalog.Count) || Catalog.Count < 1 || Catalog.Count > 72 ||
    !Array.isArray(Catalog.Rows) || Catalog.Rows.length !== Catalog.Count ||
    typeof Catalog.DataDeflateBase64 !== 'string' || !Catalog.DataDeflateBase64.length ||
    typeof Catalog.Digest !== 'string' || !/^[0-9a-f]{64}$/.test(Catalog.Digest))
    throw new Error('invalid exported NBA2K22 CPU template catalog');

const PoolCount = Catalog.Count, PoolDigest = Buffer.from(Catalog.Digest, 'hex');
// Rows are concatenated in original pool order before zlib/Deflate compression.
const Data = Zlib.inflateSync(Buffer.from(Catalog.DataDeflateBase64, 'base64'), {
    maxOutputLength: PoolCount * RowBytes
});
if (Data.length !== PoolCount * RowBytes)
    throw new Error('invalid exported CPU template data length');
const Names = new Set(), Unique = [];
const NameAt = (Row, Offset) => {
    const Text = Row.toString('utf16le', Offset, Offset + 0x28), End = Text.indexOf('\0');
    if (End <= 0) throw new Error('invalid exported CPU template name');
    return Text.slice(0, End);
};
const KeyFor = Text => Text.normalize('NFKC').trim().toLowerCase();
const Rows = Catalog.Rows.map((Template, Index) => {
    if (Template.Index !== Index)
        throw new Error('invalid exported CPU template index');
    const Row = Data.subarray(Index * RowBytes, (Index + 1) * RowBytes);
    if (Row.length !== RowBytes || Row.readBigUInt64LE(0x88) !== 0x4f0n || Row.readBigUInt64LE(0x90) !== 0x520n)
        throw new Error('invalid exported CPU template layout');
    for (const Offset of [0x60, 0x78, 0x80, 0x98, 0xa0, 0xa8, 0xb0, 0xb8, 0xc0, 0xc8, 0xd0, 0xd8, 0xe0])
        if (Row.readBigUInt64LE(Offset)) throw new Error('unexpected pointer in exported CPU template');
    const Last = NameAt(Row, 0), First = NameAt(Row, 0x28);
    if (Template.FirstName !== First || Template.LastName !== Last)
        throw new Error('exported CPU template name does not match its data');
    const Key = JSON.stringify([KeyFor(First), KeyFor(Last)]);
    // Retain the first original record for a player, not multiple season variants.
    if (!Names.has(Key)) {
        Names.add(Key);
        Unique.push(Object.freeze({ Index, Name: `${First} ${Last}` }));
    }
    return Row;
});
if (!Crypto.createHash('sha256').update(Buffer.concat(Rows)).digest().equals(PoolDigest))
    throw new Error('exported CPU template digest mismatch');
Object.freeze(Unique);

// Preserve the existing fixed-width seed sequence; it now runs only on the server.
function RandomForSeed(Seed) {
    let State = (Seed ^ 0x50433232) >>> 0;
    const Next = () => {
        State = (State + 0x9e3779b9) >>> 0;
        let X = Math.imul(State ^ (State >>> 16), 0x21f0aaad) >>> 0;
        X = Math.imul(X ^ (X >>> 15), 0x735a2d97) >>> 0;
        return (X ^ (X >>> 15)) >>> 0;
    };
    return Count => {
        const Threshold = ((-Count) >>> 0) % Count;
        let X; do { X = Next(); } while (X < Threshold);
        return X % Count;
    };
}
function ProfileForSeed(Seed) {
    const Below = RandomForSeed(Seed);
    return { Overall: 80 + Below(20), Height: 175 + Below(46), Weight: 165 + Below(161) };
}
function MatchesPool(Report) {
    return Boolean(Report && Report.PoolCount === PoolCount && Buffer.isBuffer(Report.Digest) &&
        Report.Digest.equals(PoolDigest));
}
function Tune(Profile, Target) {
    const Base = Profile.Attributes.slice(), Deadline = Date.now() + 2000;
    let Evaluations = 0;
    const Score = () => {
        if (++Evaluations > 1024 || Date.now() > Deadline) throw new Error('CPU tuning evaluation limit');
        const Result = Overall.Calculate(Profile);
        if (Result.Rating < 25) throw new Error('CPU tuning score out of range');
        Profile.Type = Result.Type; Profile.Rating = Result.Rating;
        return Result.Rating;
    };
    const Shift = Delta => {
        for (let I = 0; I < 57; ++I) if (I !== 0x22)
            Profile.Attributes[I] = Math.max(25, Math.min(99, Base[I] + Delta));
        return Score();
    };
    let Low = -74, High = 74, Value = Shift(High);
    if (Value < Target) {
        const Start = Profile.Seed % 99;
        for (let Tier = 0; Tier < 4 && Value < Target; ++Tier)
            for (let N = 0; N < 99 && Value < Target; ++N) {
                const I = (Start + N) % 99;
                if (Overall.IsFlag(I) || Profile.Badges[I] >= 4) continue;
                ++Profile.Badges[I]; Value = Score();
            }
        if (Value < Target) throw new Error('CPU target unreachable after badge promotion');
    }
    while (Low < High) {
        const Mid = Low + Math.floor((High - Low) / 2);
        Value = Shift(Mid);
        if (Value < Target) Low = Mid + 1;
        else High = Mid;
    }
    Value = Shift(Low);
    if (Value < Target) throw new Error('CPU shift below target');
    if (Value === Target) return;
    const First = Profile.Seed % 57;
    for (let N = 0; N < 57; ++N) {
        const I = (First + N) % 57;
        if (I === 0x22) continue;
        let A = 25, B = Profile.Attributes[I];
        while (A < B) {
            const Mid = A + Math.floor((B - A) / 2);
            Profile.Attributes[I] = Mid; Value = Score();
            if (Value < Target) A = Mid + 1;
            else B = Mid;
        }
        Profile.Attributes[I] = A; Value = Score();
        if (Value === Target) return;
        if (Value < Target) throw new Error('CPU coordinate below target');
    }
    throw new Error('CPU exact target unreachable');
}
function Generate(Seed, Template) {
    const Row = Rows[Template.Index], Meta = Catalog.Rows[Template.Index], Below = RandomForSeed(Seed);
    const Target = 80 + Below(20), Height = 17500 + Below(46) * 100, Weight = 165 + Below(161);
    const B = Buffer.allocUnsafe(4); B.writeFloatLE(Weight);
    const Position = (Row.readUInt32LE(0xf8) >>> 8) & 7;
    if (Position > 5 || !Array.isArray(Meta.Attributes) || Meta.Attributes.length !== 57 ||
        Meta.Attributes.some(Value => !Number.isInteger(Value) || Value < 25 || Value > 99))
        throw new Error('invalid CPU template attributes or position');
    const Profile = { Seed, Template: Template.Index, Name: Template.Name, Rating: Target,
        Position: Position === 5 ? 4 : Position, Type: (Row.readUInt32LE(0x168) >>> 26) & 31,
        Height, Weight: B.readUInt32LE(), Shape: [4,8,12,16,20].map(Offset => Row.readUInt32LE(0x520 + Offset)),
        Attributes: Meta.Attributes.slice(), Badges: [], ShotTendencies: [], PreserveType: (Row[0x354] & 7) !== 0 };
    for (let I = 0; I < 99; ++I) Profile.Badges.push(Overall.IsFlag(I) ?
        ((Row[0x4bb + (I >> 2)] >> (I & 3)) & 1) : Below(5));
    Tune(Profile, Target);
    const Ability = Profile.Attributes[7];
    const Tendency = Ability < 60 ? Math.max(10, 50 - 2 * (60 - Ability)) : Ability > 65 ? 50 + Ability - 65 : 50;
    Profile.ShotTendencies = [Tendency, Tendency];
    delete Profile.PreserveType;
    for (const Values of [Profile.Shape, Profile.Attributes, Profile.Badges, Profile.ShotTendencies]) Object.freeze(Values);
    return Object.freeze(Profile);
}
function EncodeProfile(Profile) {
    const B = Buffer.alloc(ProfileBytes);
    const Values = [Profile.Rating, Profile.Position, Profile.Type, Profile.Height, Profile.Weight,
        ...Profile.Shape, ...Profile.Attributes, ...Profile.Badges, ...Profile.ShotTendencies];
    if (Values.length !== ProfileBytes / 4 || Values.some(Value => !Number.isInteger(Value) || Value < 0 || Value > MaxSeed))
        throw new Error('invalid CPU profile serialization');
    Values.forEach((Value, I) => B.writeUInt32LE(Value, I * 4));
    return B;
}
function ProfileDigest(Players, Profiles) {
    if (Players.length !== Profiles.length) throw new Error('invalid CPU profile roster');
    const Hash = Crypto.createHash('sha256');
    for (let I = 0; I < Players.length; ++I) if (Profiles[I]) {
        const Id = Buffer.allocUnsafe(8); Id.writeBigUInt64LE(Players[I]);
        Hash.update(Id); Hash.update(EncodeProfile(Profiles[I]));
    }
    return Hash.digest();
}
function Select(Count, Opts) {
    if (!Number.isInteger(Count) || Count < 1 || Count > 5 || Count > Unique.length)
        throw new Error('invalid CPU count for unique player selection');
    if (!Opts || typeof Opts !== 'object') throw new Error('native CPU configuration unavailable');
    const Mode = Opts.CpuOverallMode === undefined ? 'random' : Opts.CpuOverallMode;
    if (Mode !== 'random' && Mode !== 'fixed')
        throw new Error('ParkCpu.CpuOverallMode must be "random" or "fixed"');
    if (Mode === 'fixed' && (!Number.isInteger(Opts.CpuFixedOverall) || Opts.CpuFixedOverall < 80 || Opts.CpuFixedOverall > 99))
        throw new Error('ParkCpu.CpuFixedOverall must be an integer from 80 to 99');
    const Available = Unique.slice();
    return Array.from({ length: Count }, () => {
        const [Template] = Available.splice(Crypto.randomInt(Available.length), 1);
        const Target = Mode === 'fixed' ? Opts.CpuFixedOverall : 80 + Crypto.randomInt(20);
        const Steps = Math.floor((MaxSeed - Template.Index) / PoolCount) + 1;
        // Choose the player first on the server. Encode its ORIGINAL pool index
        // in a nonzero seed, preserving the existing client seed % PoolCount rule.
        for (let Attempt = 0; Attempt < 1024; ++Attempt) {
            const Seed = Template.Index + PoolCount * Crypto.randomInt(Steps);
            if (!Seed) continue;
            if (ProfileForSeed(Seed).Overall === Target) return Generate(Seed, Template);
        }
        throw new Error(`could not select a CPU seed for ${Template.Name}, overall ${Target}`);
    });
}

module.exports = { PoolCount, UniqueCount: Unique.length, MatchesPool, Select, ProfileBytes, EncodeProfile, ProfileDigest };
