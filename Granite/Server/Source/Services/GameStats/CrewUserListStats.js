// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const { Builder, Crc32 } = require('../../Codec/FieldList');
const { UserId } = require('../../Storage/PlayerCards2K22');
const Logger = require('../../Core/Logger');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');

// Field CRCs verified from NBA2K22 sub_140E58A70
const Crcs = Object.freeze({
    // Branch 4: Default / Park mode (sub_14170BBE0() == 10)
    UserId: 0xa0666b6f,      // USER_ID (U64)
    Wins: 0x270d2bda,        // W (U64)
    GamesPlayed: 0x958a9ac9, // GP (U64) - client computes Losses = GP - W
    Points: 0xbf486fbc,      // PTS (U64) - client computes PPG = PTS / GP
    Assists: 0x7389a59f,     // AST (U64) - client computes APG = AST / GP
    Rebounds: 0x85a5b830,    // REB (U64) - client computes RPG = REB / GP
    Grade: 0xae0e6c84,       // GRADE (U64) - client computes average grade = GRADE / GP
    Blocks: 0x319d18ad,      // BLK (U64)
    Steals: 0x3006dc10,      // STL (U64)
    Turnovers: 0x796dd6ae,   // TO (U64)

    // Branch 1: Rec / Pro-Am (0x1e41bada)
    RecUserId: 0x1e41bada,
    RecWins: 0xeb127f4f,
    RecLosses: 0x6177b6a3,
    RecGamesPlayed: 0x1523e256,
    RecPpg: 0xa1ce5968,
    RecRpg: 0xbc2a902f,
    RecApg: 0xa24a8d06,
    RecExtra: 0x6010220c,

    // Alternative user ID CRCs observed in client queries
    AltUserId1: 0xb9c24f15,
    AltUserId2: 0xb9c25715,
});

function ExtractUserIds(Input, Context) {
    const Fields = Input?.Parsed?.Fields || [];
    const Requested = [];
    const Seen = new Set();

    for (const Field of Fields) {
        if (
            Field.Crc === Crcs.UserId ||
            Field.Crc === Crcs.AltUserId1 ||
            Field.Crc === Crcs.AltUserId2
        ) {
            const Raw = Field.value;
            const Id = UserId(Raw);
            if (Id && !Seen.has(Id)) {
                Seen.add(Id);
                Requested.push(Id);
            }
        }
    }

    // If request body was empty or had no user IDs, fall back to current session user
    if (Requested.length === 0) {
        const SessionId = UserId(Context.userId || Context.EffectiveUserId || Context.RequestUserId);
        if (SessionId) {
            Requested.push(SessionId);
        }
    }

    return Requested;
}

function Build(Input, Context = {}) {
    const Reply = new Builder();
    const UserIds = ExtractUserIds(Input, Context);
    const GameStats = Context.GameStats;

    Logger.Verbose(
        `[GameStats] CrewUserListStats: building stats for ${UserIds.length} user(s): ${UserIds.join(', ')}`,
    );

    for (const Id of UserIds) {
        // Query ship/park stats from WorldStats ledger
        let Totals = GameStats?.Totals(Id, 'Ship');
        // If no Ship games exist, try NBA totals as secondary fallback
        if ((!Totals || Totals.games === 0n) && GameStats) {
            const NbaTotals = GameStats.Totals(Id, 'NBA');
            if (NbaTotals && NbaTotals.games > 0n) {
                Totals = NbaTotals;
            }
        }

        const GP = Totals?.games ?? 0n;
        const W = Totals?.W ?? 0n;
        const PTS = Totals?.PTS ?? 0n;
        const AST = Totals?.AST ?? 0n;
        const REB = Totals?.REB ?? 0n;
        const BLK = Totals?.BLK ?? 0n;
        const STL = Totals?.STL ?? 0n;
        const TO = Totals?.TO ?? 0n;
        const GRADE = Totals?.GRADE ?? 0n;

        // Branch 4: Default / Park mode (sub_14170BBE0() == 10)
        Reply.AddU64(Crcs.UserId, BigInt(Id));
        Reply.AddU64(Crcs.Wins, W);
        Reply.AddU64(Crcs.GamesPlayed, GP);
        Reply.AddU64(Crcs.Points, PTS);
        Reply.AddU64(Crcs.Assists, AST);
        Reply.AddU64(Crcs.Rebounds, REB);
        Reply.AddU64(Crcs.Grade, GRADE);
        Reply.AddU64(Crcs.Blocks, BLK);
        Reply.AddU64(Crcs.Steals, STL);
        Reply.AddU64(Crcs.Turnovers, TO);

        // Branch 1: Rec / Pro-Am compatibility
        const L = GP >= W ? GP - W : 0n;
        const PpgFloat = GP > 0n ? Number(PTS) / Number(GP) : 0.0;
        const RpgFloat = GP > 0n ? Number(REB) / Number(GP) : 0.0;
        const ApgFloat = GP > 0n ? Number(AST) / Number(GP) : 0.0;
        Reply.AddU64(Crcs.RecUserId, BigInt(Id));
        Reply.AddU64(Crcs.RecWins, W);
        Reply.AddU64(Crcs.RecLosses, L);
        Reply.AddU64(Crcs.RecGamesPlayed, GP);
        Reply.AddF32(Crcs.RecPpg, PpgFloat);
        Reply.AddF32(Crcs.RecRpg, RpgFloat);
        Reply.AddF32(Crcs.RecApg, ApgFloat);
        Reply.AddF32(Crcs.RecExtra, 0.0);
    }

    return Reply.AddU32(Result, Success).Build();
}

module.exports = {
    Build,
    ExtractUserIds,
    Crcs,
};
