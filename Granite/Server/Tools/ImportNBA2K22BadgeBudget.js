'use strict';
const Fs = require('node:fs');
const Path = require('node:path');
const { LoadConfig } = require('../Source/Server');
const State = require('../Source/Services/MyCareer/Badges/State');

function Import(Snapshot, Config, UserId = null) {
    if (Snapshot.source !== 'NBA2K22-native-1411D39A0') throw new Error('Unknown snapshot source');
    for (const Key of ['caps', 'extra', 'progress']) {
        if (!Array.isArray(Snapshot[Key]) || Snapshot[Key].length !== 4 ||
            Snapshot[Key].some(Value => !Number.isInteger(Value) || Value < 0 ||
                Value > (Key === 'progress' ? 0x7fffffff : 65535))) throw new Error(`Invalid ${Key}`);
    }
    if (Snapshot.extra.some((Value, Index) => Value > Snapshot.caps[Index])) throw new Error('Extra exceeds total');
    if (!Array.isArray(Snapshot.potential) || Snapshot.potential.length !== 24 ||
        Snapshot.potential.some(Value => !Number.isInteger(Value) || Value < 0 || Value > 1000000))
        throw new Error('Invalid build potential');
    if (!/^\d+$/.test(String(Snapshot.careerSlot)) || !/^\d+$/.test(String(Snapshot.careerSaveId)))
        throw new Error('Missing native career scope');
    if (!Snapshot.levels || typeof Snapshot.levels !== 'object' || Array.isArray(Snapshot.levels) ||
        Object.entries(Snapshot.levels).some(([Badge, Level]) => !/^\d+$/.test(Badge) ||
            Number(Badge) > 0xffffffff || !State.Levels.includes(Level))) throw new Error('Invalid badge levels');
    let EffectiveUser = UserId;
    if (!EffectiveUser) {
        const Sessions = Fs.readdirSync(Config.SessionDirectory).filter(Name => Name.endsWith('.json'))
            .map(Name => JSON.parse(Fs.readFileSync(Path.join(Config.SessionDirectory, Name), 'utf8')))
            .filter(Item => Item.userId && String(Item.careerSlot) === String(Snapshot.careerSlot));
        const Users = [...new Set(Sessions.map(Item => Item.userId))];
        if (Users.length !== 1) throw new Error('Cannot uniquely identify the player for this slot; pass userId explicitly');
        EffectiveUser = Users[0];
    }
    if (!/^\d+$/.test(String(EffectiveUser))) throw new Error('Invalid userId');
    const Scope = Snapshot.careerSaveId === '0' ? `slot-${Snapshot.careerSlot}` : Snapshot.careerSaveId;
    const Key = `${EffectiveUser}:${Scope}`;
    const Records = State.Load(Config.CareerBadgesFile);
    Records[Key] = { ...Snapshot, importedAt: new Date().toISOString() };
    State.Save(Config.CareerBadgesFile, Records);
    return { key: Key, points: Snapshot.caps, file: Config.CareerBadgesFile };
}

if (require.main === module) {
    try {
        const [File, UserId] = process.argv.slice(2);
        if (!File) throw new Error('Usage: node Tools/ImportNBA2K22BadgeBudget.js snapshot.json [userId]');
        console.log(JSON.stringify(Import(JSON.parse(Fs.readFileSync(File, 'utf8')), LoadConfig(), UserId), null, 2));
    } catch (Error) { console.error(Error.message); process.exitCode = 1; }
}
module.exports = { Import };
