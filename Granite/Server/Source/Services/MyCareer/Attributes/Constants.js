// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

// 2K22 24个属性条目定义
const AttributeIds2K22 = Object.freeze([
    0x5777f815, 0x069d0d83, 0x05c576a5, 0xe07ea3b2, 0xe9301ab4, 0x3df2cad8,
    0x02b3a124, 0x23dec832, 0xb32c1658, 0x0db5aaac, 0x599f7361, 0x6deb99e6,
    0x89c7b7d1, 0xce15ece8, 0x4b036c05, 0x2b320b93, 0x42dab826, 0xdec000bb,
    0x5a5326ef, 0xcee7d1f2, 0x41c76fb9, 0x2fcf838e, 0x510016ca, 0xf431f5e8,
]);

const AttributeIds = AttributeIds2K22;

const Name = 0x68b693b2;
const Level = 0x6dbe0ea3;
const CurrentCap = 0xbdfe4551;
const InitialValue = CurrentCap;
const Cap = 0x9803ab6b;
const PriceCount = 0x3526dbfb;
const ToLevel = 0x50496459;
const Price = 0x3d9ce069;
const SecondPrice = 0xe9fcbd20;
const CareerSaveId = 0xd5e5f21d;

function AsBigInt(Value, Fallback = 0n) {
    try {
        return BigInt(Value ?? Fallback);
    } catch {
        return Fallback;
    }
}

const AttributeLabels = Object.freeze([
    'layups',
    'dunks',
    'midRange',
    'threePoint',
    'ballHandling',
    'passing',
    'postOffense',
    'rebounding',
    'steals',
    'blocks',
    'vertical',
    'lateralQuickness',
    'speed',
    'acceleration',
    'strength',
    'stamina',
]);

function ParseList(Value, Fallback) {
    if (Value === undefined || Value === null || Value === '') return Fallback.slice();
    let Raw = Value;
    try {
        if (typeof Raw === 'string' && Raw.trim().startsWith('[')) Raw = JSON.parse(Raw);
    } catch {
        return Fallback.slice();
    }
    if (typeof Raw === 'string') Raw = Raw.split(',');
    if (!Array.isArray(Raw)) return Fallback.slice();
    return Fallback.map((DefaultValue, Index) => {
        const Parsed = AsBigInt(Raw[Index], DefaultValue);
        return Parsed < 0n ? 0n : Parsed;
    });
}

const DefaultInitial2K22 = Object.freeze([
    32n, 29n, 33n, 1n, 1n, 29n, 25n, 26n, 1n, 1n, 40n, 29n, 18n, 32n, 29n, 51n, 24n, 14n, 1n, 23n, 26n, 17n, 29n, 21n
]);
const DefaultCap2K22 = Object.freeze([
    99n, 99n, 99n, 0n, 0n, 99n, 99n, 99n, 0n, 0n, 99n, 99n, 99n, 99n, 99n, 99n, 99n, 99n, 0n, 99n, 99n, 99n, 99n, 99n
]);

const DefaultInitialValues = Object.freeze(
    ParseList(
        process.env.GRANITE_ATTRIBUTE_INITIALS,
        DefaultInitial2K22,
    ),
);
const DefaultCapValues = Object.freeze(
    ParseList(
        process.env.GRANITE_ATTRIBUTE_CAPS,
        DefaultCap2K22,
    ),
);
// Keep the legacy archetype limits until the 2K22 level semantics are
// confirmed. A level is a purchased increment, not automatically a rating cap.
const DefaultMaxLevelValues = Object.freeze(AttributeIds.map(() => 25n));
const DefaultInitial = DefaultInitialValues[0];
const DefaultCap = DefaultCapValues[0];

function ProfileValues(Profile, Key, Fallback) {
    if (!Profile || typeof Profile !== 'object') return Fallback;
    const Value = Profile[Key] ?? Profile[`${Key}Values`] ?? Profile[`${Key}s`];
    if (Array.isArray(Value)) return ParseList(Value, Fallback);
    if (Value && typeof Value === 'object') {
        return Fallback.map((DefaultValue, Index) => {
            const Id = AttributeIds[Index];
            const Label = AttributeLabels[Index];
            return AsBigInt(Value[Id] ?? Value[`0x${Id.toString(16).toUpperCase()}`] ?? Value[Label], DefaultValue);
        });
    }
    return Fallback;
}

function ProfileHasValues(Profile, Key) {
    if (!Profile || typeof Profile !== 'object') return false;
    return Profile[Key] !== undefined || Profile[`${Key}Values`] !== undefined || Profile[`${Key}s`] !== undefined;
}

function SaveIdFor(Context = {}) {
    if (Context.careerScopeId !== null && Context.careerScopeId !== undefined && String(Context.careerScopeId) !== '')
        return String(Context.careerScopeId);
    return String(AsBigInt(Context.CareerSaveId ?? Context.CloudSaveId ?? 0n));
}

function ProfileKeys(Context = {}, IncludeLegacy = true) {
    const Identities = [];
    if (Context.userId !== null && Context.userId !== undefined) Identities.push(String(Context.userId));
    if (Context.gamertag) Identities.push(String(Context.gamertag));
    if (!Identities.length && Context.SessionKey) Identities.push(String(Context.SessionKey));
    const Scoped = Identities.map((Identity) => `${Identity}:${SaveIdFor(Context)}`);
    return IncludeLegacy && SaveIdFor(Context) === '0' ? [...Scoped, ...Identities] : Scoped;
}

function CareerKey(Context = {}) {
    return ProfileKeys(Context, false)[0] || null;
}

function ProfileFor(Context = {}) {
    const Keys = ProfileKeys(Context);
    const Profiles = Context.AttributeProfiles || Context.BuildProfiles;
    if (Profiles instanceof Map) {
        for (const Key of Keys) if (Profiles.has(Key)) return Profiles.get(Key);
    } else if (Profiles && typeof Profiles === 'object') {
        for (const Key of Keys) if (Profiles[Key]) return Profiles[Key];
    }
    return Context.BuildProfile || Context.AttributeProfile || null;
}

function Is2K22Profile(Profile) {
    return Boolean(Profile && (Profile.titleId === 0x801e || Profile.generation === '2K22' || Profile.source === 'NBA2K22'));
}

function Normalize(Item, Index, Profile = null) {
    const Source = Item && typeof Item === 'object' ? Item : {};
    const Initials = ProfileValues(Profile, 'initial', DefaultInitialValues);
    const Caps = ProfileValues(Profile, 'cap', DefaultCapValues);
    const ConfiguredMaxLevels = ProfileValues(Profile, 'maxLevel', DefaultMaxLevelValues);
    const InitialValue = AsBigInt(Source.initial ?? Source.initialValue ?? Source.base, Initials[Index]);
    const Initial = InitialValue < 0n ? 0n : InitialValue;
    const CapValue = AsBigInt(Source.cap ?? Source.capRatio ?? Source.max ?? Source.maxRating, Caps[Index]);
    // 2K22 caps can be fixed-point scale factors (e.g. 1000000 = 100%, 913044 = 91.3%) or rating caps (<=99)
    const SafeCap = CapValue < 0n ? Caps[Index] : CapValue;
    const HasProfileMax = ProfileHasValues(Profile, 'maxLevel');
    const ConfiguredMax = AsBigInt(
        HasProfileMax ? ConfiguredMaxLevels[Index] : (Source.maxLevel ?? Source.maxLevels),
        ConfiguredMaxLevels[Index],
    );
    const MaxLevel = ConfiguredMax < 0n ? 0n : ConfiguredMax;
    const LevelValue = AsBigInt(Source.level ?? Source.purchased ?? Source.purchasedLevels, 0n);
    return {
        id: Number(Source.id ?? Source.AttributeId ?? AttributeIds[Index]) >>> 0,
        level: LevelValue < 0n ? 0n : LevelValue,
        initial: Initial,
        cap: SafeCap,
        maxLevel: MaxLevel,
    };
}

function AttributesFor(Context = {}) {
    const Key = CareerKey(Context);
    const Existing = Key && Context.Careers instanceof Map ? Context.Careers.get(Key) : null;
    const StoredProfile = ProfileFor(Context);
    const Profile =
        StoredProfile ||
        (Context.RequireKnownAttributeProfile
            ? {
                  maxLevels: AttributeIds.map(() => 0),
                  source: 'unknown build (closed until MyCareer/save)',
              }
            : null);
    const ById = new Map(
        Array.isArray(Existing)
            ? Existing.map((Item, Index) => {
                  const Normalized = Normalize(Item, Index, Profile);
                  return [Normalized.id, Normalized];
              })
            : [],
    );
    const Result = AttributeIds.map((Id, Index) => ById.get(Id) || Normalize({}, Index, Profile));
    if (!Context.ReadOnly && Key && Context.Careers instanceof Map) Context.Careers.set(Key, Result);
    return Result;
}

module.exports = {
    AttributeIds,
    Name,
    Level,
    CurrentCap,
    InitialValue,
    Cap,
    PriceCount,
    ToLevel,
    Price,
    SecondPrice,
    CareerSaveId,
    AttributeLabels,
    DefaultInitial,
    DefaultCap,
    DefaultInitialValues,
    DefaultCapValues,
    DefaultMaxLevelValues,
    AsBigInt,
    Normalize,
    ProfileKeys,
    CareerKey,
    ProfileFor,
    Is2K22Profile,
    AttributesFor,
};
