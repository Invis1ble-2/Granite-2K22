// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../../Codec/FieldList');
const { Crc32 } = require('../../../Core/Crc32');
const Logger = require('../../../Core/Logger');
const { InventoryFor } = require('../../../Storage/AutomaticOwnership');
const { Name, Level, CurrentCap, Cap, AttributesFor, CareerKey } = require('./Constants');
const GrindPoints = require('../GrindPoints/State');
const Badges = require('../Badges/State');
const BadgeReport = require('../Badges/Report');
const Gatorade = require('../Gatorade');

const FeatureUnlock = 0xae72731a;
const JumpshotCreator = 0xf1a265a3;
const JumpshotCreatorMinOvr = 75;
const ShirtOff = 0x6e884a7f;
const ShirtOffMinOvr = 91;
const MascotUnlock = 0x8806fd39;
const CareerStartOvr = 60;
const ObservedCapOvr = 98;

function EstimateOverallForUnlocks(Attributes) {
    let Purchased = 0;
    let Available = 0;
    for (const Item of Attributes || []) {
        const Maximum = Math.max(0, Math.min(25, Number(Item.maxLevel ?? 0n)));
        const Current = Math.max(0, Math.min(Maximum, Number(Item.level ?? 0n)));
        Purchased += Current;
        Available += Maximum;
    }
    if (!Available) return CareerStartOvr;
    const Progress = Math.max(0, Math.min(1, Purchased / Available));
    return Math.floor(CareerStartOvr + Progress * (ObservedCapOvr - CareerStartOvr));
}

function ReportedOverallFor(Context = {}) {
    const Key = CareerKey(Context);
    const Overall = Key && Context.CareerOveralls instanceof Map ? Context.CareerOveralls.get(Key) : undefined;
    return Number.isInteger(Overall) ? Overall : null;
}

function AppendAttributeRows(Reply, Context = {}) {
    const Attributes = AttributesFor(Context);
    for (const Item of Attributes) {
        // In 2K22 (FUN_141193CD0 / FUN_141175E70):
        // 0x6DBE0EA3 is attribute purchased level
        // 0xBDFE4551 is absolute level cap
        // 0x9803AB6B is range percentage cap (fixed-point ratio, 1000000 = 100.0%)
        // When 0x9803AB6B is provided, client computes:
        // levelCap = round((maxLevel - initialLevel) * pctOfRange + initialLevel)
        // If 0x9803AB6B is missing, client falls back to 0xBDFE4551 as levelCap.
        const PurchasedLevel = Item.level !== undefined && Item.level !== null ? Item.level : 0n;
        const EffectiveCap = Item.cap !== undefined && Item.cap !== null ? Item.cap : 1000000n;
        // Absolute cap fallback: if cap ratio is 1000000 (100%), absolute cap is 99n or maxLevel
        const AbsoluteCap = EffectiveCap >= 1000000n ? 99n : (Item.initial !== undefined ? Item.initial : 25n);

        Reply.AddU32(Name, Item.id)
            .AddU64(Level, PurchasedLevel)
            .AddU64(CurrentCap, AbsoluteCap)
            .AddU64(Cap, EffectiveCap);
    }
    return Attributes;
}

function Build(Input, Context = {}) {
    const Reply = new Builder();
    const Attributes = AppendAttributeRows(Reply, Context);

    const UnlockOverall = EstimateOverallForUnlocks(Attributes);
    if (UnlockOverall >= JumpshotCreatorMinOvr) {
        Reply.AddU32(FeatureUnlock, JumpshotCreator);
        Logger.Verbose(`career unlock estimate ${UnlockOverall} OVR: JUMPSHOT_CREATOR supplied`);
    }

    const ReportedOverall = ReportedOverallFor(Context);
    if (ReportedOverall !== null && ReportedOverall >= ShirtOffMinOvr) {
        Reply.AddU32(FeatureUnlock, ShirtOff);
        Logger.Verbose(`career reported ${ReportedOverall} OVR: SHIRT_OFF supplied`);
    }

    const Agent = Input?.headers?.['user-agent'];
    if (typeof Agent === 'string' && /^VISUAL_CONCEPTS_WIN64\/22(?:\.|$)/i.test(Agent)) {
        const MascotIds = new Set((Context.StoreCatalog2K22?.groupItems?.Mascots || [])
            .map(Item => Number(Item.item_id) >>> 0));
        if (MascotIds.size && InventoryFor(Context).some(Item => MascotIds.has(Number(Item.item) >>> 0))) {
            // 2K22 treats FeatureUnlock as a complete list. Omitting index 22
            // clears ParkMascotId/MascotSignature in FUN_141225BE0 on reload.
            Reply.AddU32(FeatureUnlock, MascotUnlock);
        }
    }

    const Grind = GrindPoints.StateFor(Context);
    if (Grind) {
        Reply.AddU64(GrindPoints.Fields.GrindPoints, BigInt(Grind.total)).AddU64(
            GrindPoints.Fields.Counter,
            BigInt(Grind.counter),
        );
    }
    BadgeReport.Accept(Input, Context);
    Badges.Append(Reply, Context);
    Gatorade.Append(Reply, Input, Context);
    return Reply.AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = {
    Build,
    Get: Build,
    EstimateOverallForUnlocks,
    AppendAttributeRows,
    FeatureUnlock,
    JumpshotCreator,
    JumpshotCreatorMinOvr,
    ShirtOff,
    ShirtOffMinOvr,
    ReportedOverallFor,
    Status: 'CONFIRMED_2K19_ATTRIBUTES_AND_UNLOCKABLE_FEATURE_ARRAYS',
};
