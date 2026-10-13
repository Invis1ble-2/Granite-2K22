// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { GetU64, GetField } = require('../../../Codec/FieldList');
const { CareerKey } = require('../Attributes/Constants');
const { MaxTotal, MaxCounter, Clamp } = require('../../../Storage/CareerGrind');

const Fields = Object.freeze({
    CareerSaveId: 0xd5e5f21d,
    Category: 0x81bccb52,
    GrindPoints: 0x75c9b54f,
    RawPoints: 0x8ba979e8,
    ClientTotal: 0x479bb1dc,
    CounterIncrement: 0xe52096da,
    Counter: 0xff44548c,
    Flag: 0x3a6ad728,
    Session: 0x36be118e,
    Badge: 0x3073a024,
    BadgeProgress: 0x89097176,
});

// Confirmed in NBA2K22 FUN_14119a350 (request writer) and
// FUN_141221690 (job constructor). Reply fields retain their existing CRCs.
const Fields2K22 = Object.freeze({
    ...Fields,
    GrindPoints: 0x9479e41f,
    RawPoints: 0x447e70ad,
    ClientTotal: 0xc015fb98,
});

function RequestFields(FieldValues) {
    return GetField(FieldValues, Fields2K22.GrindPoints) || GetField(FieldValues, Fields2K22.ClientTotal)
        ? Fields2K22
        : Fields;
}

function NumberOf(FieldValues, Crc) {
    const Field = GetField(FieldValues, Crc);
    if (!Field) return null;
    const Value = GetU64(FieldValues, Crc);
    return Number(BigInt.asIntN(64, Value));
}

// Runtime threshold observed for level 20 in NBA2K22.exe.unpacked.exe.
// FUN_141959AF0 unlocks the complete build budget at this level.
const MaxProgressionPoints = 2478075;

function MinimumTotalFor(Context = {}) {
    return Context.InstantMaxProgression === true ? MaxProgressionPoints : 0;
}

function StateFor(Context = {}) {
    const Key = CareerKey(Context);
    if (!Key || !(Context.CareerGrind instanceof Map)) return null;
    let Stored = Context.CareerGrind.get(Key) || null;
    const Minimum = MinimumTotalFor(Context);
    if (Minimum && (!Stored || Stored.total < Minimum)) {
        Stored = { total: Minimum, counter: Stored?.counter ?? 0 };
        Context.CareerGrind.set(Key, Stored);
        if (typeof Context.SaveCareerGrind === 'function') Context.SaveCareerGrind();
    }
    const Forced = Number(Context.ForcedGrindPoints ?? process.env.GRANITE_FORCED_GRIND_POINTS);
    if (Number.isSafeInteger(Forced) && Forced >= 0) {
        return { total: Clamp(Math.max(Forced, Minimum), 0, MaxTotal), counter: Stored?.counter ?? 0 };
    }
    return Stored;
}

function Apply(FieldValues, Context = {}) {
    const Key = CareerKey(Context);
    if (!Key || !(Context.CareerGrind instanceof Map)) return null;
    const Previous = Context.CareerGrind.get(Key) || null;
    const Request = RequestFields(FieldValues);
    const Added = Math.max(0, NumberOf(FieldValues, Request.GrindPoints) ?? 0);
    const ClientTotal = NumberOf(FieldValues, Request.ClientTotal);
    const Increment = NumberOf(FieldValues, Request.CounterIncrement) ?? 0;
    const Minimum = MinimumTotalFor(Context);
    const Total = Clamp(
        Previous
            ? Math.max(Previous.total, Minimum) + Added
            : Minimum
              ? Math.max(ClientTotal ?? Added, Minimum + Added)
              : ClientTotal ?? Added,
        0,
        MaxTotal,
    );
    const Counter = Clamp((Previous ? Previous.counter : 0) + Increment, 0, MaxCounter);
    const Next = { total: Total, counter: Counter };
    Context.CareerGrind.set(Key, Next);
    return { key: Key, Previous, next: Next, Added, Increment };
}

module.exports = { Fields, Fields2K22, RequestFields, StateFor, apply: Apply, NumberOf, MaxProgressionPoints };
