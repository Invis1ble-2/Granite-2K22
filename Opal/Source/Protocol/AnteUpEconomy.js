// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Settings = require('../../../Shared/Config');
const Policy = require('../../../Shared/AnteUp');
const { MatchRecords, DirectoryFor } = require('../../../Shared/AnteUpMatches');
const Log = require('../Core/Log');
let Records = null;

function Recover() {
    if (!Policy.EconomicsEnabled || Records) return;
    const Root = Settings.GraniteRoot;
    const Config = Settings.Read();
    const Store = new MatchRecords(DirectoryFor(Config, Root));
    let Cancelled = 0;
    // A new Opal process cannot resume the previous process's frozen games.
    // Preserve terminal outcomes; only unfinished matches become refunds.
    for (const Match of Store.List()) {
        if (Match.state !== 'active') continue;
        Store.Save({ ...Match, state: 'cancelled', reason: 'Opal restarted before game completion' });
        Cancelled++;
    }
    Records = Store;
    if (Cancelled) Log.Info(`Ante-Up recovered ${Cancelled} interrupted game(s) for refund`);
}

function Start(Game) {
    if (!Policy.EconomicsEnabled || Game.Activity !== 'stage' || Game.Generation !== '2K22') return;
    Recover();
    const Court = Policy.ByName(Game.name);
    if (!Court) throw new Error('Ante-Up match has no price policy');
    const Match = {
        version: 1, id: String(Game.MatchId), court: Game.name, index: Court.index,
        gamblingId: String(Policy.GamblingId), entryVc: Court.entryVc,
        home: Game.Home.map(String), away: Game.Away.map(String),
        state: 'active', winnerSide: null,
    };
    Records.Save(Match);
    Game.AnteUpRecord = Match;
}

function Finish(Game, WinnerSide, Reason) {
    if (!Game?.AnteUpRecord || Game.AnteUpClosed) return;
    const Completed = Game.GameReady === true;
    const Match = { ...Game.AnteUpRecord, state: Completed ? 'completed' : 'cancelled',
        winnerSide: Completed && [0, 1].includes(WinnerSide) ? WinnerSide : null, reason: Reason };
    Records.Save(Match);
    Game.AnteUpClosed = true;
}

function Cancel(Game) {
    if (!Game?.AnteUpRecord || Game.AnteUpClosed) return;
    Records.Save({ ...Game.AnteUpRecord, state: 'cancelled', reason: 'Game cleared before completion' });
    Game.AnteUpClosed = true;
}

module.exports = { Recover, Start, Finish, Cancel };
