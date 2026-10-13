'use strict';

const { GetFields, Types } = require('../../../Codec/FieldList');
const { CareerKey, AttributesFor } = require('../Attributes/Constants');
const State = require('./State');
const Logger = require('../../../Core/Logger');

// Versioned extension appended by Module/BadgeSync.h to the authenticated Attributes/get request.
const Fields = Object.freeze({ Version: 0x2f4f0e8c, Maximum: 0xa8226629,
    Progress: 0x788024d0, Extra: 0x3c63053b, Potential: 0xc09ce10f,
    BadgeName: 0xb3aea962, BadgeLevel: 0xebb6c44d });

function Accept(Input, Context = {}) {
    const Values = Input?.Parsed?.Fields || [];
    if (!GetFields(Values, Fields.Version).length || Context.InstantMaxBadges !== true) return false;
    try {
        const Key = CareerKey(Context);
        if (!Key || Context.userId === null || Context.userId === undefined || !Context.CareerBadgesFile)
            throw new Error('Missing player identity or badge storage');
        function Read(Crc, Count, Maximum) {
            const Items = GetFields(Values, Crc);
            if (Items.length !== Count || Items.some(Item => Item.Type !== Types.U64))
                throw new Error('Incomplete or invalid module badge report');
            return Items.map(Item => {
                const Value = (BigInt(Item.Data1 >>> 0) << 32n) | BigInt(Item.Data2 >>> 0);
                if (Value > BigInt(Maximum)) throw new Error('Module badge value out of range');
                return Number(Value);
            });
        }
        if (Read(Fields.Version, 1, 1)[0] !== 1) throw new Error('Unsupported badge report version');
        const Caps = Read(Fields.Maximum, 4, 65535);
        const Progress = Read(Fields.Progress, 4, 0x7fffffff);
        const Extra = Read(Fields.Extra, 4, 65535);
        const Potential = Read(Fields.Potential, 24, 1000000);
        const Names = Read(Fields.BadgeName, 99, 0xffffffff);
        const Levels = Read(Fields.BadgeLevel, 99, 0xffffffff);
        if (!Caps.some(Value => Value > 0) || Extra.some((Value, Index) => Value > Caps[Index]))
            throw new Error('Invalid module badge budget');
        if (new Set(Names).size !== 99 || Levels.some(Value => !State.Levels.includes(Value)))
            throw new Error('Invalid module badge levels');
        const Attributes = AttributesFor(Context);
        if (!State.MatchesPotential(Attributes.map(Item => Item.cap), Potential)) {
            const Differences = Attributes.slice(0, 19).flatMap((Item, Index) =>
                Math.abs(Number(Item.cap) - Potential[Index]) > 2
                    ? [`${Index}:stored=${Item.cap},native=${Potential[Index]}`] : []);
            throw new Error(`Module badge potential differs from the stored build (${Differences.join('; ')}); retry after build save`);
        }
        const Records = State.Load(Context.CareerBadgesFile);
        const Previous = Records[Key];
        const SameBuild = Previous?.source === 'NBA2K22-native-1411D39A0' &&
            State.MatchesPotential(Potential, Previous.potential) && Previous.caps?.length === 4 &&
            Caps.every((Value, Index) => Value === Previous.caps[Index]);
        const Record = { source: 'NBA2K22-native-1411D39A0', caps: Caps, extra: Extra,
            progress: Progress.map((Value, Index) => SameBuild ? Math.max(Value, Previous.progress[Index]) : Value),
            potential: Potential, levels: Object.fromEntries(Names.map((Name, Index) => [Name, Levels[Index]])) };
        if (SameBuild) Record.levels = { ...Record.levels, ...Previous.levels };
        const Changed = !Previous || ['caps', 'extra', 'progress', 'potential', 'levels']
            .some(Name => JSON.stringify(Previous[Name]) !== JSON.stringify(Record[Name]));
        if (Changed) {
            Records[Key] = { ...Record, importedAt: new Date().toISOString(), transport: 'module-attributes-get-v1' };
            State.Save(Context.CareerBadgesFile, Records);
            Logger.Info(`module badge budget for ${Key}: ${Caps.join('/')} points`);
        }
        return true;
    } catch (Error) {
        Logger.Error(`module badge report rejected: ${Error.message}`);
        return false;
    }
}

module.exports = { Fields, Accept };
