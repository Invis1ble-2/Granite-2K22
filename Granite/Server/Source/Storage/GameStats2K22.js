// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const { Crc32 } = require('../Core/Crc32');
const Json = require('./JsonLedger');
const Logger = require('../Core/Logger');
const { UserId } = require('./PlayerCards2K22');

const Modes = Object.freeze({ NBA: 0x9296ae90, Ship: 0x6d4ca5ca });
const Counters = Object.freeze(['W', 'L', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FLS',
    'FGM', 'FGA', '3PM', '3PA', 'FTM', 'FTA']);
const RowNames = Object.freeze(['USERID', 'GAMESESSIONID', 'MATCHTYPE', 'COMPLETIONSTATUS',
    'TIME_PLAYED', 'D', ...Counters]);
const Types = Object.freeze(Object.fromEntries(RowNames.map(Name => [Name, Name === 'MATCHTYPE' ? 'StringCrc' : 'U64'])));

function Values(Fields, Name, Type) {
    const Crc = Crc32(Name);
    const Matches = Fields.filter(Field => Number(Field.Crc) === Crc);
    if (Matches.some(Field => Field.Type !== Type)) return null;
    return Matches.map(Field => Field.Value);
}

function Integer(Value, Maximum = 0x7fffffff) {
    if (!/^(?:0|[1-9]\d*)$/.test(String(Value))) return null;
    const NumberValue = Number(Value);
    return Number.isSafeInteger(NumberValue) && NumberValue <= Maximum ? NumberValue : null;
}

function Normalize(Record) {
    if (!Array.isArray(Record?.Fields)) return null;
    let Mode;
    if (Record.Service === 'ArbitrationV3/AsyncArbitration') Mode = 'NBA';
    else if (Record.Service === 'ArbitrationV3/AsyncArbitrationPark') Mode = 'Ship';
    else return null;
    const Fields = Record.Fields.map(Field => ({ Crc: Number(Field.Crc), Type: Field.Type, Value: Field.value }));
    const Match = Values(Fields, 'MATCHTYPE', 'StringCrc');
    const Session = Values(Fields, 'GAMESESSIONID', 'U64');
    if (Match?.length !== 1 || Number(Match[0]) !== Modes[Mode] || Session?.length !== 1) return null;
    const SessionId = UserId(Session[0]);
    const Reporter = UserId(Record.userId);
    if (!SessionId || !Reporter) return null;
    const Columns = Object.fromEntries(RowNames.map(Name => [Name, Values(Fields, `USER_${Name}`, Types[Name])]));
    const Ids = Columns.USERID;
    if (!Ids?.length || Ids.length > 10 || new Set(Ids.map(UserId)).size !== Ids.length ||
        !Ids.some(Id => UserId(Id) === Reporter) ||
        Object.values(Columns).some(Column => !Column || Column.length !== Ids.length)) return null;
    const Rows = {};
    for (let Index = 0; Index < Ids.length; Index++) {
        const Id = UserId(Ids[Index]);
        if (!Id || UserId(Columns.GAMESESSIONID[Index]) !== SessionId ||
            Number(Columns.MATCHTYPE[Index]) !== Modes[Mode]) return null;
        const Row = {};
        for (const Name of ['COMPLETIONSTATUS', 'TIME_PLAYED', 'D', ...Counters]) {
            const Value = Integer(Columns[Name][Index]);
            if (Value === null) return null;
            Row[Name] = Value;
        }
        // Keep non-complete reports as evidence too: they must not become a
        // second game, or silently override a disagreeing completed report.
        Rows[Id] = Row;
    }
    const Ratings = Values(Fields, 'USER_RATING', 'U64');
    const ReporterIndex = Ids.findIndex(Id => UserId(Id) === Reporter);
    const Rating = Ratings?.length === Ids.length ? Integer(Ratings[ReporterIndex], 100) : null;
    return { mode: Mode, session: SessionId, reporter: Reporter, rows: Rows, rating: Rating };
}

function Eligible(Row) {
    return Row.COMPLETIONSTATUS === 0 && Row.TIME_PLAYED > 0 && Row.D === 0 &&
        Row.W <= 1 && Row.L <= 1 && Row.W + Row.L === 1 &&
        Row.FGM <= Row.FGA && Row['3PM'] <= Row['3PA'] && Row.FTM <= Row.FTA &&
        Row['3PM'] <= Row.FGM && Row['3PA'] <= Row.FGA;
}

function Consensus(Player) {
    if (Player.conflict) return null;
    const Reports = Object.values(Player.reports);
    if (!Reports.length) return null;
    const First = JSON.stringify(Reports[0]);
    if (Reports.some(Row => JSON.stringify(Row) !== First)) return null;
    return Eligible(Reports[0]) ? Reports[0] : null;
}

function Add(Games, Report) {
    const Key = `${Report.mode}:${Report.session}`;
    const Previous = Games[Key];
    const Players = { ...(Previous?.players || {}) };
    let Changed = false;
    for (const [Id, Row] of Object.entries(Report.rows)) {
        const Player = Players[Id] || { reports: {}, conflict: false };
        const Old = Player.reports[Report.reporter];
        let Updated = Player;
        // Grade recovery must not change the technical-stat consensus.
        if (!Old || JSON.stringify(Old) !== JSON.stringify(Row)) {
            Updated = { ...Updated, reports: { ...Player.reports, [Report.reporter]: Row },
                conflict: Player.conflict || Boolean(Old) };
        }
        if (Id === Report.reporter && Report.rating !== null) {
            if (Updated.rating === undefined) Updated = { ...Updated, rating: Report.rating };
            else if (Updated.rating !== null && Updated.rating !== Report.rating)
                Updated = { ...Updated, rating: null };
        }
        if (Updated === Player) continue;
        Players[Id] = Updated;
        Changed = true;
    }
    if (Changed) Games[Key] = { mode: Report.mode, session: Report.session, players: Players };
    return Changed;
}

class GameStats2K22 {
    constructor(File) {
        this.File = File;
        this.State = Json.Load(File, { version: 1, recovered: false, games: {} });
        const State = this.State;
        if (State.version !== 1 || typeof State.recovered !== 'boolean' || !Json.IsObject(State.games))
            throw new Error(`Invalid 2K22 game stats ledger: ${File}`);
        for (const [Key, Game] of Object.entries(State.games)) {
            if (!Json.IsObject(Game) || !Object.hasOwn(Modes, Game.mode) || !UserId(Game.session) ||
                Key !== `${Game.mode}:${Game.session}` || !Json.IsObject(Game.players))
                throw new Error(`Invalid 2K22 game stats entry: ${Key}`);
            for (const [Id, Player] of Object.entries(Game.players)) {
                if (!UserId(Id) || !Json.IsObject(Player) || typeof Player.conflict !== 'boolean' || !Json.IsObject(Player.reports))
                    throw new Error(`Invalid 2K22 player stats entry: ${Key}/${Id}`);
                // Missing ratings are legacy data; null quarantines disagreeing self-reports.
                if (Player.rating !== undefined && Player.rating !== null &&
                    Integer(Player.rating, 100) === null)
                    throw new Error(`Invalid 2K22 player rating: ${Key}/${Id}`);
                for (const [Reporter, Row] of Object.entries(Player.reports)) {
                    if (!UserId(Reporter) || !Json.IsObject(Row) ||
                        ['COMPLETIONSTATUS', 'TIME_PLAYED', 'D', ...Counters].some(Name => Integer(Row[Name]) === null))
                        throw new Error(`Invalid 2K22 stats report: ${Key}/${Id}`);
                }
            }
        }
    }

    Commit(State) {
        Json.Save(this.File, State);
        this.State = State;
    }

    Accept(Record) {
        const Report = Normalize(Record);
        if (!Report) return false;
        const Games = { ...this.State.games };
        if (!Add(Games, Report)) return false;
        this.Commit({ ...this.State, games: Games });
        const Conflicts = Object.values(Games[`${Report.mode}:${Report.session}`].players)
            .filter(Player => Player.conflict || new Set(Object.values(Player.reports).map(Row => JSON.stringify(Row))).size > 1).length;
        if (Conflicts) Logger.Error(`2K22 stats: quarantined ${Conflicts} conflicting player result(s) in ${Report.mode}/${Report.session}`);
        return true;
    }

    Totals(Id, Mode) {
        const Result = Object.fromEntries(['games', 'GRADE', ...Counters].map(Name => [Name, 0n]));
        const Key = UserId(Id);
        if (!Key || !Object.hasOwn(Modes, Mode)) return Result;
        for (const Game of Object.values(this.State.games)) {
            if (Game.mode !== Mode || !Game.players[Key]) continue;
            const Row = Consensus(Game.players[Key]);
            if (!Row) continue;
            Result.games++;
            for (const Name of Counters) Result[Name] += BigInt(Row[Name]);
            const Rating = Game.players[Key].rating;
            if (Rating !== undefined && Rating !== null) Result.GRADE += BigInt(Rating);
        }
        return Result;
    }

    Recover(Directory) {
        if (!Directory) return;
        const Games = { ...this.State.games };
        let Readable = 0;
        let Errors = 0;
        let Changed = false;
        for (const File of Json.Files(Directory, true)) {
            try {
                const Report = Normalize(Json.Read(File));
                if (!Report) continue;
                Changed = Add(Games, Report) || Changed;
                Readable++;
            } catch { Errors++; }
        }
        if (Changed || this.State.recovered !== (Errors === 0))
            this.Commit({ version: 1, recovered: Errors === 0, games: Games });
        let EligiblePlayers = 0;
        let ExcludedPlayers = 0;
        for (const Game of Object.values(Games)) {
            for (const Player of Object.values(Game.players)) {
                if (Consensus(Player)) EligiblePlayers++;
                else ExcludedPlayers++;
            }
        }
        Logger.Info(`2K22 stats recovery: ${Readable} reports, ${Object.keys(Games).length} games, ` +
            `${EligiblePlayers} countable / ${ExcludedPlayers} excluded player results, ${Errors} unreadable records`);
    }
}

module.exports = { GameStats2K22, Modes, Counters };
