// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Json = require('./JsonLedger');
const { Validate: ValidateMatch, IsId } = require('../../../../Shared/AnteUpMatches');
const { IsStaticBalance, StartingBalance } = require('../Services/VirtualCurrency/Balance');
const Logger = require('../Core/Logger');
const MaximumBalance = 0xffffffffffffffffn;

function Empty() {
    return { version: 1, matches: {} };
}

function Validate(State) {
    if (!Json.IsObject(State) || State.version !== 1 || !Json.IsObject(State.matches))
        throw new Error('Invalid Ante-Up wallet ledger');
    for (const [Id, Entry] of Object.entries(State.matches)) {
        if (!Json.IsObject(Entry) || !Json.IsObject(Entry.bets) ||
            !['pending', 'paid', 'refunded'].includes(Entry.status) || ValidateMatch(Entry.match).id !== Id ||
            (Entry.status === 'pending' && Entry.match.state !== 'active'))
            throw new Error(`Invalid Ante-Up wallet match ${Id}`);
        const Players = [...Entry.match.home, ...Entry.match.away];
        for (const [Player, Bet] of Object.entries(Entry.bets)) {
            if (!Players.includes(Player) || !Json.IsObject(Bet) ||
                !Array.isArray(Bet.requestKeys) || !Bet.requestKeys.length ||
                Bet.requestKeys.some(Key => typeof Key !== 'string' || !Key || Key.length > 256))
                throw new Error(`Invalid Ante-Up wager ${Id}/${Player}`);
        }
    }
    return State;
}

function Identity(Match) {
    return JSON.stringify([Match.id, Match.court, Match.index, Match.gamblingId,
        Match.entryVc, Match.home, Match.away]);
}

function Commit(Context, Entry, Balances) {
    const Wallets = Context.Wallets;
    if (!(Wallets instanceof Map) || typeof Context.SaveWallets !== 'function' || IsStaticBalance(Context))
        throw new Error('Ante-Up requires a persistent, non-static wallet');
    const PreviousLedger = Wallets.AnteUp;
    const PreviousBalances = new Map();
    for (const [Id, Value] of Balances) {
        if (Value < 0n || Value > MaximumBalance) throw new Error('Ante-Up wallet balance is outside U64 range');
        PreviousBalances.set(Id, Wallets.get(Id));
    }
    Wallets.AnteUp = { version: 1, matches: { ...(PreviousLedger?.matches || {}), [Entry.match.id]: Entry } };
    for (const [Id, Value] of Balances) Wallets.set(Id, Value);
    try {
        // Wagers and balances must reach disk in the same atomic wallet save.
        Context.SaveWallets();
    } catch (Failure) {
        Wallets.AnteUp = PreviousLedger;
        for (const [Id, Value] of PreviousBalances) {
            if (Value === undefined) Wallets.delete(Id);
            else Wallets.set(Id, Value);
        }
        throw Failure;
    }
}

function Reconcile(Context) {
    const Records = Context.AnteUpMatches;
    if (!Records || !(Context.Wallets instanceof Map)) return;
    for (const Match of Records.List()) {
        if (Match.state === 'active') continue;
        const Entry = Context.Wallets.AnteUp?.matches[Match.id];
        if (Entry && Identity(Entry.match) !== Identity(Match))
            throw new Error(`Ante-Up match identity changed: ${Match.id}`);
        if (Entry?.status === 'pending') {
            const Players = [...Match.home, ...Match.away];
            const PaidInFull = Players.every(Id => Object.hasOwn(Entry.bets, Id));
            const Award = Match.state === 'completed' && Match.winnerSide !== null && PaidInFull;
            const Winners = Award ? (Match.winnerSide === 0 ? Match.home : Match.away) : [];
            const Balances = new Map();
            for (const Id of Object.keys(Entry.bets)) {
                if (!Context.Wallets.has(Id)) throw new Error(`Ante-Up wager has no wallet: ${Id}`);
                const Credit = Award ? (Winners.includes(Id) ? BigInt(Match.entryVc) * 2n : 0n) : BigInt(Match.entryVc);
                Balances.set(Id, Context.Wallets.get(Id) + Credit);
            }
            Commit(Context, { ...Entry, match: Match, status: Award ? 'paid' : 'refunded' }, Balances);
            Logger.Info(`Ante-Up ${Match.id} ${Match.court}: ${Award ? 'paid winners 2x bet' : 'refunded all paid wagers'}`);
        }
        // A crash after Commit is harmless: the persisted status suppresses a second payment.
        try { Records.Remove(Match.id); }
        catch (Failure) { Logger.Error(`Ante-Up completed record cleanup failed: ${Failure.message}`); }
    }
}

function PlaceBet(Input, Context, Court, GamblingId) {
    const Id = String(Context.userId ?? '');
    const RequestId = Input?.headers?.['vc-request-id'];
    if (!Context.HasLoginSession || !IsId(Id) || !Context.SessionKey ||
        typeof RequestId !== 'string' || !RequestId || RequestId.length > 128 ||
        !(Context.Wallets instanceof Map) || !Context.AnteUpMatches || IsStaticBalance(Context))
        return { Ok: false, Result: 'FAILURE' };
    const RequestKey = `${Context.SessionKey}:${RequestId}`;
    const State = Context.Wallets.AnteUp || Empty();
    // The client request has no MatchId. Retain its session-scoped receipt so a
    // delayed retry from a previous game cannot charge the next game on this court.
    for (const Entry of Object.values(State.matches)) {
        if (Entry.bets[Id]?.requestKeys.includes(RequestKey)) {
            return { Ok: Entry.match.index === Court.index && Entry.match.gamblingId === String(GamblingId),
                Result: 'FAILURE', MatchId: Entry.match.id, Duplicate: true };
        }
    }
    const Candidates = Context.AnteUpMatches.List().filter(Match => Match.state === 'active' &&
        Match.index === Court.index && Match.gamblingId === String(GamblingId) &&
        [...Match.home, ...Match.away].includes(Id));
    if (Candidates.length !== 1) return { Ok: false, Result: 'FAILURE' };
    const Match = Candidates[0];
    const Previous = State.matches[Match.id];
    if (Previous && (Previous.status !== 'pending' || Identity(Previous.match) !== Identity(Match)))
        return { Ok: false, Result: 'FAILURE' };
    if (Previous?.bets[Id]) {
        const Bet = Previous.bets[Id];
        Commit(Context, { ...Previous, bets: { ...Previous.bets,
            [Id]: { requestKeys: [...Bet.requestKeys, RequestKey] } } }, new Map());
        return { Ok: true, MatchId: Match.id, Duplicate: true };
    }
    // One player cannot fund two unresolved games, even if the court changes.
    if (Object.values(State.matches).some(Entry => Entry.status === 'pending' && Entry.bets[Id]))
        return { Ok: false, Result: 'FAILURE' };
    const Current = Context.Wallets.get(Id) ?? StartingBalance;
    const Amount = BigInt(Match.entryVc);
    if (Current < Amount) return { Ok: false, Result: 'INSUFFICIENT_FUNDS' };
    const Entry = { match: Match, status: 'pending',
        bets: { ...(Previous?.bets || {}), [Id]: { requestKeys: [RequestKey] } } };
    Commit(Context, Entry, new Map([[Id, Current - Amount]]));
    Logger.Info(`Ante-Up ${Match.id}: ${Id} paid ${Amount} VC for ${Match.court}`);
    return { Ok: true, MatchId: Match.id, Duplicate: false };
}

module.exports = { Empty, Validate, Reconcile, PlaceBet };
