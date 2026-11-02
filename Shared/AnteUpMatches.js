// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Fs = require('node:fs');
const Path = require('node:path');
const Json = require('../Granite/Server/Source/Storage/JsonLedger');
const Policy = require('./AnteUp');
const MaximumId = 0xffffffffffffffffn;

function IsId(Value) {
    return typeof Value === 'string' && /^[1-9][0-9]{0,19}$/.test(Value) && BigInt(Value) <= MaximumId;
}

function Validate(Match) {
    const Court = Policy.ByName(Match?.court);
    const Size = Court?.name.includes('ONE_V_ONE') ? 1 : Court?.name.includes('TWO_V_TWO') ? 2 : 3;
    if (!Json.IsObject(Match) || Match.version !== 1 || !IsId(Match.id) ||
        !Court || Court.index !== Match.index || !IsId(Match.gamblingId) ||
        !Number.isSafeInteger(Match.entryVc) || Match.entryVc <= 0 ||
        !Array.isArray(Match.home) || !Array.isArray(Match.away) ||
        Match.home.length !== Size || Match.away.length !== Size ||
        ![...Match.home, ...Match.away].every(IsId) ||
        new Set([...Match.home, ...Match.away]).size !== Size * 2 ||
        !['active', 'completed', 'cancelled'].includes(Match.state) ||
        ![null, 0, 1].includes(Match.winnerSide) ||
        (Match.state !== 'completed' && Match.winnerSide !== null))
        throw new Error('Invalid Ante-Up match record');
    return Match;
}

function DirectoryFor(Config, Root) {
    return Path.resolve(Root, process.env.GRANITE_ANTE_UP_MATCHES ||
        Config.AnteUpMatchesDirectory || 'Storage/Gambling/Matches');
}

class MatchRecords {
    constructor(Directory) {
        this.Directory = Directory;
    }

    File(Id) {
        if (!IsId(Id)) throw new Error('Invalid Ante-Up match id');
        return Path.join(this.Directory, `${Id}.json`);
    }

    Read(Id) {
        const Match = Validate(Json.Read(this.File(Id)));
        if (Match.id !== Id) throw new Error('Ante-Up match filename does not match its id');
        return Match;
    }

    List() {
        const Matches = [];
        for (const File of Json.Files(this.Directory)) {
            try { Matches.push(this.Read(Path.basename(File, '.json'))); }
            catch (Failure) {
                // HTTP may have acknowledged and removed a terminal record.
                if (Failure.code !== 'ENOENT') throw Failure;
            }
        }
        return Matches;
    }

    Save(Match) {
        Json.Save(this.File(Match.id), Validate(Match));
    }

    Remove(Id) {
        try { Fs.unlinkSync(this.File(Id)); }
        catch (Failure) { if (Failure.code !== 'ENOENT') throw Failure; }
    }
}

module.exports = { MatchRecords, DirectoryFor, Validate, IsId };
