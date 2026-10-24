// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Path = require('node:path');
const { Types, GetU64 } = require('../Codec/FieldList');
const Json = require('./JsonLedger');
const Logger = require('../Core/Logger');

// FUN_141194A30 -> FUN_141227770. Preserve the client's units and wire types;
// these values also select the position/archetype preset used by the 2K Card.
const SummaryTypes = new Map([
    [0x801f78b9, Types.StringCrc], [0xa517a20c, Types.StringCrc],
    [0xb043a83d, Types.StringCrc], [0x92f5e6fc, Types.StringCrc],
    [0x347ff877, Types.StringCrc], [0x87258423, Types.U64],
    [0xf73592c7, Types.U64], [0x1263ffd0, Types.U64], [0xd466a799, Types.U64],
]);
const SlotField = 0x5eeda966;
const SaveField = 0xd5e5f21d;

function UserId(Value) {
    try {
        if (Value === null || Value === undefined || Value === '') return null;
        const Id = BigInt(Value);
        return Id > 0n && Id <= 0xffffffffffffffffn ? Id.toString() : null;
    } catch { return null; }
}

function Scope(Fields) {
    const Save = GetU64(Fields, SaveField);
    const Slot = GetU64(Fields, SlotField);
    if (Slot !== null) return `slot-${Slot}`;
    return Save !== null && Save > 0n ? Save.toString() : null;
}

function ProfileScope(Fields) {
    const Save = GetU64(Fields, SaveField);
    return Save !== null && Save > 0n ? Save.toString() : Scope(Fields);
}

function Summary(Fields) {
    const Selected = Fields.filter(Field => SummaryTypes.has(Field.Crc));
    if (Selected.length !== SummaryTypes.size || new Set(Selected.map(Field => Field.Crc)).size !== SummaryTypes.size)
        return null;
    if (Selected.some(Field => Field.Type !== SummaryTypes.get(Field.Crc) ||
        !Number.isInteger(Field.Data1) || Field.Data1 < 0 || Field.Data1 > 0xffffffff ||
        !Number.isInteger(Field.Data2) || Field.Data2 < 0 || Field.Data2 > 0xffffffff)) return null;
    return Selected.map(({ Crc, Type, Data1, Data2 }) => ({ Crc, Type, Data1, Data2 }));
}

class PlayerCards2K22 {
    constructor(File) {
        this.File = File;
        this.State = Json.Load(File, { version: 1, recovered: false, summaries: {}, active: {} });
        const State = this.State;
        if (State.version !== 1 || typeof State.recovered !== 'boolean' ||
            !Json.IsObject(State.summaries) || !Json.IsObject(State.active))
            throw new Error(`Invalid 2K22 player card store: ${File}`);
        for (const [Key, Record] of Object.entries(State.summaries)) {
            if (!Json.IsObject(Record) || !Array.isArray(Record.fields) || !Summary(Record.fields) ||
                !Number.isFinite(Date.parse(Record.savedAt)) || !/^\d+:(?:slot-)?\d+$/.test(Key) ||
                !/^(?:slot-)?\d+$/.test(Record.profileScope))
                throw new Error(`Invalid 2K22 player summary: ${Key}`);
        }
        for (const [Id, Active] of Object.entries(State.active)) {
            if (UserId(Id) !== Id || !Json.IsObject(Active) || !/^(?:slot-)?\d+$/.test(Active.scope) ||
                !Number.isFinite(Date.parse(Active.observedAt))) throw new Error(`Invalid active career: ${Id}`);
        }
    }

    Commit(State) {
        Json.Save(this.File, State);
        this.State = State;
    }

    Observe(Context, Fields) {
        if (!Context.HasLoginSession || Context.ReadOnly) return;
        const Id = UserId(Context.userId);
        const Selected = Scope(Fields);
        if (!Id || !Selected || this.State.active[Id]?.scope === Selected) return;
        this.Commit({ ...this.State, active: { ...this.State.active,
            [Id]: { scope: Selected, observedAt: new Date().toISOString() } } });
    }

    Remember(Context, Fields) {
        if (!Context.HasLoginSession || Context.ReadOnly) return;
        const Id = UserId(Context.userId);
        const Selected = Scope(Fields);
        const Values = Summary(Fields);
        if (!Id || !Selected || !Values) return;
        const Key = `${Id}:${Selected}`;
        const Now = new Date().toISOString();
        this.Commit({ ...this.State,
            summaries: { ...this.State.summaries,
                [Key]: { fields: Values, profileScope: ProfileScope(Fields), savedAt: Now } },
            active: { ...this.State.active, [Id]: { scope: Selected, observedAt: Now } },
        });
    }

    Forget(Context) {
        const Id = UserId(Context.userId);
        const Profile = Context.careerScopeId;
        const Selected = Profile?.startsWith('slot-') ? Profile :
            Context.careerSlot !== null && Context.careerSlot !== undefined ? `slot-${Context.careerSlot}` : Profile;
        if (!Id || !Selected) return;
        const Summaries = { ...this.State.summaries };
        const Active = { ...this.State.active };
        for (const [Key, Record] of Object.entries(Summaries)) {
            if (!Key.startsWith(`${Id}:`) || (Key !== `${Id}:${Selected}` && Record.profileScope !== Profile)) continue;
            if (`${Id}:${Active[Id]?.scope}` === Key) delete Active[Id];
            delete Summaries[Key];
        }
        if (Active[Id]?.scope === Selected) delete Active[Id];
        this.Commit({ ...this.State, summaries: Summaries, active: Active });
    }

    For(Context) {
        if (!Context.HasLoginSession) return null;
        const Id = UserId(Context.RequestUserId ?? Context.userId);
        if (!Id) return null;
        // Self: honor the current session's explicit slot. Peers: use THEIR last
        // observed career slot, never the viewer's slot or an arbitrary save.
        const OwnScope = Id === UserId(Context.userId)
            ? Context.careerSlot !== null && Context.careerSlot !== undefined ? `slot-${Context.careerSlot}`
                : Context.careerScopeId !== '0' ? Context.careerScopeId : null
            : null;
        const Selected = OwnScope || this.State.active[Id]?.scope;
        let Record = Selected && this.State.summaries[`${Id}:${Selected}`];
        if (!Record && OwnScope && !OwnScope.startsWith('slot-')) {
            const Matches = Object.entries(this.State.summaries)
                .filter(([Key, Value]) => Key.startsWith(`${Id}:`) && Value.profileScope === OwnScope);
            if (Matches.length === 1) Record = Matches[0][1];
        }
        if (!Record) return null;
        return { userId: Id, scope: Record.profileScope, fields: Record.fields };
    }

    Recover(CaptureDirectory, SessionDirectory) {
        if (this.State.recovered || !CaptureDirectory || !SessionDirectory) return;
        const SessionUsers = new Map();
        let Errors = 0;
        for (const File of Json.Files(SessionDirectory)) {
            try {
                const Session = Json.Read(File);
                const Id = UserId(Session.userId);
                // Old unverified sessions may have been rebound by a peer-card
                // request. Do not attribute a historical save to a different user.
                if (!Id || (!Session.verified && Session.platformUserId && UserId(Session.platformUserId) !== Id)) continue;
                SessionUsers.set(String(Session.key), Id);
            } catch { Errors++; }
        }
        if (!SessionUsers.size) return;
        const Summaries = { ...this.State.summaries };
        const Active = { ...this.State.active };
        let Imported = 0;
        for (const File of Json.Files(CaptureDirectory)) {
            if (!/_(?:MyCareer_save|MyCareer_Attributes_get)_/i.test(Path.basename(File)) || File.endsWith('.response.json')) continue;
            try {
                const Capture = Json.Read(File);
                const Request = new URL(Capture.url, 'https://granite.invalid');
                const Id = SessionUsers.get(Request.searchParams.get('x'));
                const Fields = Capture.Parse?.Status === 'ok' ? Capture.Parse.value?.Fields : null;
                if (!Id || !Array.isArray(Fields) || !Number.isFinite(Date.parse(Capture.CapturedAt))) continue;
                const Selected = Scope(Fields);
                if (!Selected) continue;
                if (!Active[Id] || Date.parse(Active[Id].observedAt) < Date.parse(Capture.CapturedAt))
                    Active[Id] = { scope: Selected, observedAt: Capture.CapturedAt };
                if (!Request.pathname.toLowerCase().endsWith('/mycareer/save')) continue;
                const Values = Summary(Fields);
                const Key = `${Id}:${Selected}`;
                if (!Values || (Summaries[Key] && Date.parse(Summaries[Key].savedAt) >= Date.parse(Capture.CapturedAt))) continue;
                Summaries[Key] = { fields: Values, profileScope: ProfileScope(Fields), savedAt: Capture.CapturedAt };
                Imported++;
            } catch { Errors++; }
        }
        // Never overwrite attributes, badge points or the original captures.
        this.Commit({ version: 1, recovered: true, summaries: Summaries, active: Active });
        Logger.Info(`2K22 player card recovery: ${Imported} saved summaries, ${Errors} unreadable records`);
    }
}

module.exports = { PlayerCards2K22, UserId, Scope, Summary, SummaryTypes };
