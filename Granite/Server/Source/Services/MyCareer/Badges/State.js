'use strict';

const Fs = require('node:fs');
const Path = require('node:path');
const { GetFields } = require('../../../Codec/FieldList');
const { CareerKey, AttributesFor } = require('../Attributes/Constants');

// NBA2K22 FUN_141193FF0 / FUN_1411766B0: category progress and earned points.
const Fields = Object.freeze({ Category: 0x751229b2, Progress: 0x35668754,
    Earned: 0xa047433d, Extra: 0x2f57af06, Badge: 0x3073a024,
    Level: 0x748afde1, ToLevel: 0x3d727b25 });
const Categories = Object.freeze([0x992a275b, 0x50a4ff71, 0x520bc7ba, 0xe4e00b6f]);
const Levels = Object.freeze([0x1c966fc2, 0x4e107e0f, 0xdfa3dfdd, 0x713cf0e5, 0x371de7a3]);

function Load(File) {
    if (!File) return {};
    try { return JSON.parse(Fs.readFileSync(File, 'utf8')); }
    catch (Error) { if (Error.code === 'ENOENT') return {}; throw Error; }
}

function Save(File, Records) {
    Fs.mkdirSync(Path.dirname(File), { recursive: true });
    const Temporary = `${File}.${process.pid}.tmp`;
    Fs.writeFileSync(Temporary, JSON.stringify(Records, null, 2) + '\n');
    Fs.renameSync(Temporary, File);
}

function Reset(Context) {
    const Key = CareerKey(Context);
    if (!Key || !Context.CareerBadgesFile) return;
    const Records = Load(Context.CareerBadgesFile);
    if (Records[Key]) { delete Records[Key]; Save(Context.CareerBadgesFile, Records); }
}

// FUN_141957BD0 filters potentials through DAT_142D3FC70 and DAT_142D3FC40:
// indices 0..18 belong to badge categories 1..4 (kind 1); indices 19..23
// belong to categories 5..8 (kind 2) and do not contribute to badge budgets.
// The native badge state may leave those final five ratios at zero even when
// the persisted attribute caps are 1000000. Keep all 24 values in snapshots.
function MatchesPotential(Left, Right) {
    const Valid = Values => Array.isArray(Values) && Values.length === 24 &&
        Values.every(Value => Number.isInteger(Number(Value)) && Number(Value) >= 0 && Number(Value) <= 1000000);
    return Valid(Left) && Valid(Right) &&
        Left.slice(0, 19).every((Value, Index) => Math.abs(Number(Value) - Number(Right[Index])) <= 2);
}

function For(Context) {
    const Key = CareerKey(Context);
    const Record = Key && Load(Context.CareerBadgesFile)[Key];
    if (!Record || Record.source !== 'NBA2K22-native-1411D39A0') return null;
    if (!Array.isArray(Record.caps) || Record.caps.length !== 4 ||
        Record.caps.some(Value => !Number.isInteger(Value) || Value < 0 || Value > 65535)) return null;
    // A profile exported from a different potential allocation must not grant its budget here.
    const Attributes = AttributesFor(Context);
    if (!MatchesPotential(Attributes.map(Item => Item.cap), Record.potential)) return null;
    return Record;
}

function Append(Reply, Context) {
    const Record = For(Context);
    if (!Record) return;
    Categories.forEach((Category, Index) => {
        Reply.AddU32(Fields.Category, Category)
            .AddU64(Fields.Progress, BigInt(Record.progress[Index]))
            .AddU64(Fields.Earned, BigInt(Record.caps[Index]))
            .AddU64(Fields.Extra, BigInt(Record.extra[Index]));
    });
    for (const [Badge, Level] of Object.entries(Record.levels || {})) {
        if (Levels.includes(Level)) Reply.AddU32(Fields.Badge, Number(Badge)).AddU32(Fields.Level, Level);
    }
}

function Apply(Input, Context, UpdateLevels = false) {
    const Record = For(Context);
    if (!Record) return false;
    const Values = Input?.Parsed?.Fields || [];
    const CategoryFields = GetFields(Values, Fields.Category);
    const Progress = GetFields(Values, Fields.Progress);
    const Earned = GetFields(Values, Fields.Earned);
    const NumberOf = Field => Field ? Number((BigInt(Field.Data1 >>> 0) << 32n) | BigInt(Field.Data2 >>> 0)) : null;
    for (let Index = 0; Index < CategoryFields.length; Index++) {
        const CategoryIndex = Categories.indexOf(CategoryFields[Index].Data1 >>> 0);
        if (CategoryIndex < 0) continue;
        const ClientEarned = NumberOf(Earned[Index]);
        if (ClientEarned !== null && ClientEarned > Record.caps[CategoryIndex])
            throw new Error('Badge points exceed the exported build budget; export this build again');
        const Points = NumberOf(Progress[Index]);
        if (Number.isInteger(Points) && Points >= 0 && Points <= 0x7fffffff)
            Record.progress[CategoryIndex] = Math.max(Record.progress[CategoryIndex], Points);
    }
    if (UpdateLevels) {
        const Badges = GetFields(Values, Fields.Badge);
        const Targets = GetFields(Values, Fields.ToLevel);
        if (Badges.length !== Targets.length) throw new Error('Incomplete badge level update');
        Record.levels ||= {};
        Badges.forEach((Badge, Index) => {
            const Level = Targets[Index].Data1 >>> 0;
            if (!Levels.includes(Level)) throw new Error('Unknown badge level');
            Record.levels[Badge.Data1 >>> 0] = Level;
        });
    }
    const Records = Load(Context.CareerBadgesFile);
    Records[CareerKey(Context)] = Record;
    Save(Context.CareerBadgesFile, Records);
    return true;
}

module.exports = { Fields, Categories, Levels, Load, Save, Reset, MatchesPotential, For, Append, Apply };
