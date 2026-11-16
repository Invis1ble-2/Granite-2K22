// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetFields } = require('../../../Codec/FieldList');
const { Crc32 } = require('../../../Core/Crc32');
const {
    AttributeIds,
    ExplicitAttributeIds,
    MaxAttributeLevel,
    Name,
    Level,
    PriceCount,
    ToLevel,
    Price,
    SecondPrice,
    AttributesFor,
    AsBigInt,
    CareerKey,
} = require('./Constants');

// 2K22 Default VC upgrade price curve (levels 1..75)
const DefaultPriceBase = AsBigInt(process.env.GRANITE_ATTRIBUTE_PRICE_BASE || 100, 100n);
const DefaultPriceStep = AsBigInt(process.env.GRANITE_ATTRIBUTE_PRICE_STEP || 25, 25n);

function PriceForLevel(LevelValue, Context = {}) {
    const Custom = Context.AttributePrices;
    if (Custom instanceof Map && Custom.has(Number(LevelValue))) return AsBigInt(Custom.get(Number(LevelValue)));
    return DefaultPriceBase + (BigInt(LevelValue) - 1n) * DefaultPriceStep;
}

function RequestedIds(Fields) {
    const Ids = GetFields(Fields, Name).map((Field) => Field.Data1 >>> 0);
    return Ids.length ? Ids : AttributeIds.slice(0, 19);
}

function FieldU64(Field) {
    return Field ? (BigInt(Field.Data1 >>> 0) << 32n) | BigInt(Field.Data2 >>> 0) : 0n;
}

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const Ids = RequestedIds(Fields);
    const LevelFields = GetFields(Fields, Level);
    const Career = CareerKey(Context);
    const Existing = Career && Context.Careers instanceof Map ? Context.Careers.get(Career) : null;
    const HasKnownProfile = Array.isArray(Existing) || Boolean(Context.AttributeProfile || Context.BuildProfile);
    const Live = AttributesFor({ ...Context, ReadOnly: true });
    const ById = new Map(Live.map((Item) => [Item.id >>> 0, Item]));

    // The price request's LEVEL is the player's current step level used by the
    // client-side callback check (FUN_14068ED70: Level == sub_1411D1E30(idx)).
    // Never adopt these values into the career save.

    const Reply = new Builder();
    const Sections = [];

    // NBA 2K22 schema verified via FUN_1405F5950 (request) and FUN_14068ED70 (response):
    // 19 explicit attributes, each section provides:
    // - Name (0x68b693b2, U32)
    // - Level (0x6dbe0ea3, U64): must match sub_1411D1E30(idx)
    // - PriceCount (0x3526dbfb, U64): count of price entries to follow
    // Followed by price entries:
    // - ToLevel (0x50496459, U64): target step level (1 <= ToLevel <= 75, strictly < 0x4c)
    // - Price (0x3d9ce069, U64): cumulative VC price from Current
    // - SecondPrice (0xe9fcbd20, U64): cumulative SP price from Current
    for (let Index = 0; Index < Ids.length; Index++) {
        const Id = Ids[Index] >>> 0;
        const Attribute = ById.get(Id);
        const HasRequestedLevel = Index < LevelFields.length;
        let Current = HasRequestedLevel ? FieldU64(LevelFields[Index]) : 0n;
        if (!HasRequestedLevel && HasKnownProfile && Attribute) {
            Current = Attribute.level;
        }

        const Start = Number(Current);
        const CanPopulate =
            ExplicitAttributeIds.has(Id) &&
            (HasRequestedLevel || HasKnownProfile) &&
            (!Context.RequireKnownAttributeProfile || HasKnownProfile) &&
            Number.isInteger(Start) &&
            Start >= 0 &&
            Start < MaxAttributeLevel;
        const Count = CanPopulate ? MaxAttributeLevel - Start : 0;
        Sections.push({ id: Id, Current, Start, Count });
    }

    // First write header fields (Name, Level, PriceCount for each attribute)
    for (const Section of Sections) {
        Reply.AddU32(Name, Section.id).AddU64(Level, Section.Current).AddU64(PriceCount, Section.Count);
    }

    // Then write price table records (ToLevel, Price, SecondPrice)
    for (const Section of Sections) {
        let CumulativeVC = 0n;
        let CumulativeSP = 0n;
        for (let Step = 1; Step <= Section.Count; Step++) {
            const TargetLevel = Section.Start + Step;
            const UnitPrice = PriceForLevel(TargetLevel, Context);
            CumulativeVC += UnitPrice;
            CumulativeSP += UnitPrice;
            Reply.AddU64(ToLevel, TargetLevel).AddU64(Price, CumulativeVC).AddU64(SecondPrice, CumulativeSP);
        }
    }

    return Reply.AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = {
    Build,
    Price: Build,
    PriceForLevel,
    MaxAttributeLevel,
    Status: 'NBA2K22_EXACT_DECOMPILED_PRICE_SCHEMA_CONFIRMED',
};

