// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const { Builder, Crc32 } = require('../../Codec/FieldList');
const { CareerKey } = require('./Attributes/Constants');
const { AppendAttributeRows } = require('./Attributes/Get');
const Badges = require('./Badges/State');
const Logger = require('../../Core/Logger');

function Build(Input, Context = {}) {
    const Reply = new Builder();
    const Card = Context.PlayerCards?.For(Context);
    if (!Card) {
        Logger.Verbose('2K22 card: no unambiguous saved summary for the requested player/slot');
        return Reply.AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
    }
    for (const Field of Card.fields) Reply.Record(Field.Crc, Field.Type, Field.Data1, Field.Data2);
    const Target = { ...Context, userId: Card.userId, gamertag: '', CareerSaveId: 0n,
        careerScopeId: Card.scope, ReadOnly: true };
    // Reuse the proven attribute/badge encoding, not the writable progression
    // handler: inspecting a peer must not create budgets or accept badge reports.
    if (Target.Careers instanceof Map && Target.Careers.has(CareerKey(Target))) {
        AppendAttributeRows(Reply, Target);
        Badges.Append(Reply, Target);
    }
    return Reply.AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = { Build };
