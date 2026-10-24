// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const { Builder, Crc32, Types } = require('../../Codec/FieldList');
const { UserId } = require('../../Storage/PlayerCards2K22');

// 2K22 FUN_14179ED20 -> FUN_14179EFE0 / FUN_14179F2F0 / FUN_1417A02C0.
// FUN_140679B50 consumes these groups in NBA / Ship / Rec menu order.
// Values on the wire are U64 TOTALS, not precomputed averages or F32 bits.
// The parser divides technical totals by games; the card multiplies back
// when displaying total points/rebounds/etc. Ratios use made/attempted counts.
const Groups = Object.freeze([
    { mode: 'NBA', flag: 0x1c80f23e, fields: {
        games: 0x35a6214e, W: 0x0154d43a, L: 0x8b311dd6,
        FGM: 0x4f7ff6b7, FGA: 0x46c9ba9c, FTM: 0x2e90b725, FTA: 0x2726fb0e,
        '3PM': 0x18c6d89a, '3PA': 0x117094b1, STL: 0x437ae628, BLK: 0x42e12295,
        FLS: 0x5684121f, AST: 0x00f59fa7, REB: 0xf6d98208, PTS: 0xcc345584, TO: 0xd9416d29,
    } },
    { mode: 'Ship', flag: 0x60894192, fields: {
        games: 0x50ce12d2, W: 0xd9be8e62, L: 0x53db478e,
        FGM: 0xb6a341eb, FGA: 0xbf150dc0, FTM: 0xd74c0079, FTA: 0xdefa4c52,
        '3PM': 0xe11a6fc6, '3PA': 0xe8ac23ed, STL: 0xbaa65174, BLK: 0xbb3d95c9,
        FLS: 0xaf58a543, AST: 0xf92928fb, REB: 0x0f053554, PTS: 0x35e8e2d8, TO: 0xbc295eb5,
    } },
    { mode: 'Rec', flag: 0x2b57a072, fields: {
        games: 0xa47750f4, W: 0xb449f974, L: 0x3e2c3098,
        FGM: 0x645a7d54, FGA: 0x6dec317f, FTM: 0x05b53cc6, FTA: 0x0c0370ed,
        '3PM': 0x33e35379, '3PA': 0x3a551f52, STL: 0x685f6dcb, BLK: 0x69c4a976,
        FLS: 0x7da199fc, AST: 0x2bd01444, REB: 0xddfc09eb, PTS: 0xe711de67, TO: 0x48901c93,
    } },
]);

function Build(Input, Context = {}) {
    const Reply = new Builder().AddU32(Crc32('RESULT'), Crc32('SUCCESS'));
    if (Context.Route !== 'gamestatsv4/get_world_game_stats' || !Context.HasLoginSession) return Reply.Build();
    const Fields = Input?.Parsed?.Fields || [];
    const Individual = Fields.find(Field => Field.Crc === 0xfa8be7f1);
    // Do not answer team-stat requests with individual career statistics.
    if (Individual && (Individual.Type !== Types.Bool8 || !Individual.Data1)) return Reply.Build();
    const Id = UserId(Context.RequestUserId ?? Context.userId);
    if (!Id) return Reply.Build();
    for (const Group of Groups) {
        if (!Fields.some(Field => Field.Crc === Group.flag && Field.Type === Types.Bool8 && Field.Data1)) continue;
        const Totals = Context.GameStats?.Totals(Id, Group.mode) || {};
        for (const [Name, Crc] of Object.entries(Group.fields)) Reply.AddU64(Crc, Totals[Name] ?? 0n);
    }
    // No proven reports exist for Rec / Pro-Am in this implementation. Never
    // copy Ship data into those modes; their missing counters stay zero.
    return Reply.Build();
}

const WorldFields = Groups.flatMap(Group => Object.values(Group.fields));
module.exports = { Build, WorldFields, Groups, Status: 'NBA2K22_PERSISTED_INDIVIDUAL_STATS' };
