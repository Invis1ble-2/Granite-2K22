'use strict';

const Crypto = require('node:crypto');
const Catalog = require('../Data/CpuTemplates2K22.json');
const RowBytes = 0x560, MaxSeed = 0xffffffff;
if (Catalog.Format !== 'NBA2K22-player-template-v1' || Catalog.RowBytes !== RowBytes ||
    !Number.isInteger(Catalog.Count) || Catalog.Count < 1 || Catalog.Count > 72 ||
    !Array.isArray(Catalog.Rows) || Catalog.Rows.length !== Catalog.Count ||
    typeof Catalog.Digest !== 'string' || !/^[0-9a-f]{64}$/.test(Catalog.Digest))
    throw new Error('invalid exported NBA2K22 CPU template catalog');

const PoolCount = Catalog.Count, PoolDigest = Buffer.from(Catalog.Digest, 'hex');
const Names = new Set(), Unique = [];
const NameAt = (Row, Offset) => {
    const Text = Row.toString('utf16le', Offset, Offset + 0x28), End = Text.indexOf('\0');
    if (End <= 0) throw new Error('invalid exported CPU template name');
    return Text.slice(0, End);
};
const KeyFor = Text => Text.normalize('NFKC').trim().toLowerCase();
const Rows = Catalog.Rows.map((Template, Index) => {
    if (Template.Index !== Index || typeof Template.DataBase64 !== 'string')
        throw new Error('invalid exported CPU template index or data');
    const Row = Buffer.from(Template.DataBase64, 'base64');
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

// Same first three uint32 draws as CpuEnhancement::Build in Module 00010221.
function ProfileForSeed(Seed) {
    let State = (Seed ^ 0x50433232) >>> 0;
    const Next = () => {
        State = (State + 0x9e3779b9) >>> 0;
        let X = Math.imul(State ^ (State >>> 16), 0x21f0aaad) >>> 0;
        X = Math.imul(X ^ (X >>> 15), 0x735a2d97) >>> 0;
        return (X ^ (X >>> 15)) >>> 0;
    };
    const Below = Count => {
        const Threshold = ((-Count) >>> 0) % Count;
        let X; do { X = Next(); } while (X < Threshold);
        return X % Count;
    };
    return { Overall: 80 + Below(20), Height: 175 + Below(46), Weight: 165 + Below(161) };
}
function MatchesPool(Report) {
    return Boolean(Report && Report.PoolCount === PoolCount && Buffer.isBuffer(Report.Digest) &&
        Report.Digest.equals(PoolDigest));
}
function ValidBadges(Seed, Levels) {
    if (!Number.isInteger(Seed) || Seed < 1 || Seed > MaxSeed || !Array.isArray(Levels) || Levels.length !== 99)
        return false;
    const Row = Rows[Seed % PoolCount];
    // Native BadgeLimit: 19 one-bit flags, 80 graded slots. Personality bits
    // share the first packed bytes with graded slots but must retain the template.
    return Levels.every((Level, Index) => {
        const Flag = Index === 0x24 || (Index < 0x24 && (Index & 3) < 2);
        return Number.isInteger(Level) && Level >= 0 && Level <= (Flag ? 1 : 4) &&
            (!Flag || Level === ((Row[0x4bb + (Index >> 2)] >> (Index & 3)) & 1));
    });
}
function ValidShotTendencies(Ability, Levels) {
    if (!Number.isInteger(Ability) || Ability < 25 || Ability > 99 || !Array.isArray(Levels) || Levels.length !== 2)
        return false;
    const Expected = Ability < 60 ? Math.max(10, 50 - 2 * (60 - Ability)) : Ability > 65 ? 50 + Ability - 65 : 50;
    return Levels.every(Level => Number.isInteger(Level) && Level === Expected);
}
function Select(Count, Opts) {
    if (!Number.isInteger(Count) || Count < 1 || Count > 5 || Count > Unique.length)
        throw new Error('invalid CPU count for unique player selection');
    if (!Opts || typeof Opts !== 'object') throw new Error('native CPU configuration unavailable');
    const Mode = Opts.CpuOverallMode === undefined ? 'random' : Opts.CpuOverallMode;
    if (Mode !== 'random' && Mode !== 'fixed')
        throw new Error('NativePark.CpuOverallMode must be "random" or "fixed"');
    if (Mode === 'fixed' && (!Number.isInteger(Opts.CpuFixedOverall) || Opts.CpuFixedOverall < 80 || Opts.CpuFixedOverall > 99))
        throw new Error('NativePark.CpuFixedOverall must be an integer from 80 to 99');
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
            const Profile = ProfileForSeed(Seed);
            if (Profile.Overall === Target)
                return { Seed, Template: Template.Index, Name: Template.Name, ...Profile };
        }
        throw new Error(`could not select a CPU seed for ${Template.Name}, overall ${Target}`);
    });
}

module.exports = { PoolCount, UniqueCount: Unique.length, MatchesPool, Select, ProfileForSeed, ValidBadges, ValidShotTendencies };
