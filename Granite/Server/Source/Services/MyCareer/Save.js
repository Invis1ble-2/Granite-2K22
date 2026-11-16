// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, Types, GetU64 } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { SummaryTypes } = require('../../Storage/PlayerCards2K22');
const { ParseSaveId, GenerateSaveId } = require('../../Storage/CareerSaveIds');
const GrindPoints = require('./GrindPoints/State');
const {
    AttributesFor,
    CareerKey,
    ProfileKeys,
    ExplicitAttributeIds,
    Name,
    Level,
    InitialValue,
    Cap,
    CareerSaveId,
} = require('./Attributes/Constants');
const {
    Position,
    PrimaryArchetype,
    SecondaryArchetype,
    ProfileForArchetypes,
    BuildScopeForProfile,
} = require('./Attributes/BuildProfiles');

function Value64(Field) {
    return (BigInt(Field.Data1) << 32n) | BigInt(Field.Data2);
}

function StringCrc(Field) {
    return Field ? Field.Data1 >>> 0 : null;
}

function ResolveCloudSaveId(Fields, Context = {}) {
    if (Context.CareerSaveIds && typeof Context.CareerSaveIds.Resolve === 'function') {
        return Context.CareerSaveIds.Resolve(Context, Fields);
    }
    const Requested = ParseSaveId(GetU64(Fields, CareerSaveId));
    const Existing = Requested ?? ParseSaveId(Context.CareerSaveId ?? Context.CloudSaveId);
    return Existing !== null ? Existing : GenerateSaveId();
}

function WithCloudSaveId(Fields, CloudSaveId) {
    const High = Number((CloudSaveId >> 32n) & 0xffffffffn) >>> 0;
    const Low = Number(CloudSaveId & 0xffffffffn) >>> 0;
    let Replaced = false;
    const Updated = Fields.map((Field) => {
        if (Field.Crc !== CareerSaveId) return Field;
        Replaced = true;
        return { ...Field, Type: Types.U64, Data1: High, Data2: Low, value: CloudSaveId };
    });
    if (!Replaced) {
        Updated.push({ Crc: CareerSaveId, Type: Types.U64, Data1: High, Data2: Low, value: CloudSaveId });
    }
    return Updated;
}

function ScopedCareerContext(Context = {}, CloudSaveId) {
    const ScopeId = CloudSaveId.toString();
    if (Context.Sessions && Context.SessionKey && typeof Context.Sessions.bind === 'function') {
        const Binding = { careerScopeId: ScopeId };
        if (Context.careerSlot !== null && Context.careerSlot !== undefined && String(Context.careerSlot) !== '') {
            Binding.careerSlot = String(Context.careerSlot);
        }
        Context.Sessions.bind(Context.SessionKey, Binding);
    }
    return {
        ...Context,
        CareerSaveId: CloudSaveId,
        CloudSaveId,
        careerScopeId: ScopeId,
    };
}

function AppendGrindPoints(Reply, Context) {
    const Grind = GrindPoints.StateFor(Context);
    if (!Grind) return;
    Reply.AddU64(GrindPoints.Fields.GrindPoints, BigInt(Grind.total)).AddU64(
        GrindPoints.Fields.Counter,
        BigInt(Grind.counter),
    );
    if (Number.isFinite(Grind.overallPoints)) {
        Reply.AddF32(GrindPoints.Fields.OverallPoints, Grind.overallPoints);
    }
}

function RememberBuildProfile(Fields, Context) {
    if (!(Context.AttributeProfiles instanceof Map)) return null;
    const Primary = StringCrc(Fields.find((Field) => Field.Crc === PrimaryArchetype));
    const Secondary = StringCrc(Fields.find((Field) => Field.Crc === SecondaryArchetype));
    const PositionValue = StringCrc(Fields.find((Field) => Field.Crc === Position));
    const Profile = ProfileForArchetypes(Primary, Secondary, PositionValue);
    if (!Profile) return null;

    let NumericSaveId = 0n;
    try {
        NumericSaveId = BigInt(Context.CareerSaveId ?? Context.CloudSaveId ?? 0n);
    } catch {
        NumericSaveId = 0n;
    }
    Profile.generation = '2K22';
    Profile.titleId = 0x801e;
    if (!(typeof Context.careerScopeId === 'string' && Context.careerScopeId.startsWith('slot-'))) {
        Context.careerScopeId = NumericSaveId === 0n ? BuildScopeForProfile(Profile) : NumericSaveId.toString();
    }
    if (Context.Sessions && Context.SessionKey && typeof Context.Sessions.bind === 'function') {
        Context.Sessions.bind(Context.SessionKey, { careerScopeId: Context.careerScopeId });
    }

    const Keys = ProfileKeys(Context, false);
    let Changed = false;
    for (const Key of Keys) {
        const Previous = Context.AttributeProfiles.get(Key);
        if (
            Previous &&
            (Previous.primaryArchetype !== Profile.primaryArchetype ||
                Previous.secondaryArchetype !== Profile.secondaryArchetype)
        )
            Changed = true;
        Context.AttributeProfiles.set(Key, { ...(Previous || {}), ...Profile });
    }
    if (Keys.length && typeof Context.SaveAttributeProfiles === 'function') {
        Context.SaveAttributeProfiles();
    }
    if (Changed && Context.Careers instanceof Map) {
        const Existing = Context.Careers.get(CareerKey(Context));
        if (Array.isArray(Existing)) {
            for (const Item of Existing) Item.level = ExplicitAttributeIds.has(Item.id) ? 1n : 0n;
            if (typeof Context.SaveCareers === 'function') Context.SaveCareers();
        }
    }
    return Profile;
}

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const CloudSaveId = ResolveCloudSaveId(Fields, Context);
    const ScopedContext = ScopedCareerContext(Context, CloudSaveId);
    const BuildProfile = RememberBuildProfile(Fields, ScopedContext);
    if (CareerKey(ScopedContext) && ScopedContext.Careers) {
        const Ids = Fields.filter((Field) => Field.Crc === Name);
        if (Ids.length) {
            const Current = AttributesFor(ScopedContext);
            const Initial = Fields.filter((Field) => Field.Crc === InitialValue);
            const Caps = Fields.filter((Field) => Field.Crc === Cap);
            const Levels = Fields.filter((Field) => Field.Crc === Level);
            const ById = new Map(Current.map((Item) => [Item.id, Item]));
            Ids.forEach((Field, Index) => {
                const Item = ById.get(Field.Data1 >>> 0);
                if (!Item) return;
                if (Initial[Index]) {
                    const SavedRating = Value64(Initial[Index]);
                    // The save payload carries the post-upgrade rating in
                    // BDFE4551. Keep it as the base/current rating; Level is
                    // a separate purchased-count field and is optional in
                    // 2K22 save requests.
                    if (SavedRating >= 0n && SavedRating <= 99n) Item.initial = SavedRating;
                }
                if (Caps[Index]) Item.cap = Value64(Caps[Index]);
                if (Levels[Index]) Item.level = Value64(Levels[Index]);
                // 2K22 save payloads commonly omit Level. In that case the
                // existing purchased-count value is intentionally preserved.
            });
            ScopedContext.Careers.set(CareerKey(ScopedContext), Current);
            if (typeof ScopedContext.SaveCareers === 'function') ScopedContext.SaveCareers();
        }
    }
    ScopedContext.PlayerCards?.Remember(ScopedContext, WithCloudSaveId(Fields, CloudSaveId));

    const Reply = new Builder();
    // NBA 2K22 FUN_14059A4F0: when CloudSaveId != 0 (phase 2 and subsequent saves),
    // the callback validates builder summary fields against local player data, runs
    // FUN_141192B50(reply, 1, player), and confirms 0xD5E5F21D.
    const EmittedSummary = new Set();
    for (const [Crc, ExpectedType] of SummaryTypes.entries()) {
        const Field = Fields.find((Candidate) => Candidate.Crc === Crc && Candidate.Type === ExpectedType);
        if (!Field) continue;
        Reply.Record(Field.Crc, Field.Type, Field.Data1, Field.Data2);
        EmittedSummary.add(Crc);
    }
    if (BuildProfile) {
        const PositionValue = StringCrc(Fields.find((Field) => Field.Crc === Position));
        if (PositionValue !== null && !EmittedSummary.has(Position)) Reply.AddStringCrc(Position, PositionValue);
        if (!EmittedSummary.has(SecondaryArchetype)) {
            Reply.AddStringCrc(SecondaryArchetype, BuildProfile.secondaryArchetype);
        }
        if (!EmittedSummary.has(PrimaryArchetype)) {
            Reply.AddStringCrc(PrimaryArchetype, BuildProfile.primaryArchetype);
        }
    }
    AppendGrindPoints(Reply, ScopedContext);
    return Reply.AddU64(CareerSaveId, CloudSaveId).AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

function Import(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const CloudSaveId = ResolveCloudSaveId(Fields, Context);
    const ScopedContext = ScopedCareerContext(Context, CloudSaveId);
    const Reply = new Builder();
    AppendGrindPoints(Reply, ScopedContext);
    return Reply.AddU64(CareerSaveId, CloudSaveId).AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = {
    Build,
    Save: Build,
    Import,
    ImportMyCareerSave: Import,
    Status: 'NBA2K22_TWO_PHASE_SAVE_AND_CLOUDSAVEID_CONFIRMED',
};
