// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetFields } = require('../../../Codec/FieldList');
const { Crc32 } = require('../../../Core/Crc32');
const {
    AttributeIds,
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

// 2K22 Default VC upgrade price curve (matches 2K22 attributes 1..99 scale)
const DefaultPriceBase = AsBigInt(process.env.GRANITE_ATTRIBUTE_PRICE_BASE || 100, 100n);
const DefaultPriceStep = AsBigInt(process.env.GRANITE_ATTRIBUTE_PRICE_STEP || 25, 25n);

function PriceForLevel(LevelValue, Context = {}) {
    const Custom = Context.AttributePrices;
    if (Custom instanceof Map && Custom.has(Number(LevelValue))) return AsBigInt(Custom.get(Number(LevelValue)));
    return DefaultPriceBase + (BigInt(LevelValue) - 1n) * DefaultPriceStep;
}

function RequestedLevels(Fields) {
    const Levels = GetFields(Fields, Level);
    return AttributeIds.map((_, Index) => {
        const Field = Levels[Index];
        if (!Field) return 0n;
        return (BigInt(Field.Data1 >>> 0) << 32n) | BigInt(Field.Data2 >>> 0);
    });
}

function RequestedIds(Fields) {
    const Ids = GetFields(Fields, Name).map((Field) => Field.Data1 >>> 0);
    return Ids.length ? Ids : AttributeIds.slice();
}

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const Ids = RequestedIds(Fields);
    const Levels = RequestedLevels(Fields);
    const LevelFields = GetFields(Fields, Level);
    const Career = CareerKey(Context);
    const Existing = Career && Context.Careers instanceof Map ? Context.Careers.get(Career) : null;
    const HasKnownProfile = Array.isArray(Existing) || Boolean(Context.AttributeProfile || Context.BuildProfile);
    const Live = AttributesFor(Context);
    const ById = new Map(Live.map((Item) => [Item.id >>> 0, Item]));

    // The price request's LEVEL is the player's current rating used by the
    // client-side callback check.  It is not the purchased-level field used by
    // Purchase.js.  Never adopt these values into the career save; doing so
    // turns a read-only price lookup into a free attribute upgrade.

    const Reply = new Builder();
    const Sections = [];

    // NBA 2K22 schema verified via decompilation of FUN_14068ed70:
    // 24 attributes, each section provides:
    // - Name (0x68b693b2, U32)
    // - Current Level (0x6dbe0ea3, U64): MUST MATCH player's current local rating (Item.level or Item.initial)
    // - PriceCount (0x3526dbfb, U64): count of price entries to follow
    // Followed by price entries:
    // - ToLevel (0x50496459, U64): target upgrade rating (must be < 0x4c = 76 in offset array)
    // - Price / VC (0x3d9ce069, U64): cumulative VC price
    // - SecondPrice / SP (0xe9fcbd20, U64): cumulative SP price
    for (let Index = 0; Index < Ids.length; Index++) {
        const Id = Ids[Index] >>> 0;
        const Attribute = ById.get(Id);
        // Prefer the value supplied by the client.  A zero/missing value can
        // only be filled from a previously loaded profile; an anonymous
        // request must remain empty rather than receiving a generic table.
        const HasRequestedLevel = Index < LevelFields.length;
        let Current = HasRequestedLevel ? AsBigInt(Levels[Index], 0n) : 0n;
        if (!HasRequestedLevel && HasKnownProfile && Attribute) {
            Current = Attribute.level > 0n ? Attribute.level : Attribute.initial;
        }

        const Maximum = Attribute && Attribute.cap !== undefined && Attribute.cap > 0n ? AsBigInt(Attribute.cap, 99n) : 99n;
        const Cap = Maximum > 99n ? 99n : Maximum;
        const Start = Number(Current);
        const Count = Current > 0n ? Math.max(0, Math.min(75, Number(Cap) - Start)) : 0;
        Sections.push({ id: Id, Current, Start, cap: Cap, Count });
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

function GeneratePriceMatrix(Context = {}) {
    const Matrix = [];
    for (const Id of AttributeIds) {
        const Levels = [];
        for (let lvl = 1; lvl <= 75; lvl++) {
            const Unit = Number(PriceForLevel(lvl, Context));
            Levels.push({ level: lvl, vc: Unit, sp: Unit });
        }
        Matrix.push({ id: Id, levels: Levels });
    }
    return Matrix;
}

function DirectPrice(Input = {}, Context = {}) {
    return {
        result: 'SUCCESS',
        attributesCount: AttributeIds.length,
        levelsPerAttribute: 75,
        basePrice: Number(DefaultPriceBase),
        stepPrice: Number(DefaultPriceStep),
        matrix: GeneratePriceMatrix(Context),
    };
}

module.exports = {
    Build,
    Price: Build,
    DirectPrice,
    GeneratePriceMatrix,
    PriceForLevel,
    Status: 'NBA2K22_EXACT_DECOMPILED_PRICE_SCHEMA_CONFIRMED',
};

