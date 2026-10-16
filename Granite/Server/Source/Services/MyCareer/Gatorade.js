// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Crypto = require('node:crypto');
const { Builder, GetField, GetFields, GetU64, Types } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { OwnedKey } = require('../../Storage/OwnedItems');
const Store = require('../../Storage/GatoradeBoosts');
const Fields = Object.freeze({ Type: 0xfec00e03, Count: 0xe08b01f9, Reason: 0x98ad1587 });
const PurchaseType = 0xc1ed2239;
const Type2K22 = 0xbb8189c6;
// FUN_1405F5720: 0x142453378 = NBA_GAME / PROAM_GAME / PARK_GAME.
const DecreaseReasons = new Set([0xc01ce911, 0x29846bce, 0x2e00cea4]);

function Is2K22(Input) {
    return /^VISUAL_CONCEPTS_WIN64\/22(?:\.|$)/i.test(Input?.headers?.['user-agent'] || '');
}
function StateFor(Context) {
    const Key = OwnedKey(Context);
    return Key && Context.GatoradeBoosts instanceof Map ? Context.GatoradeBoosts.get(Key) || null : null;
}
function Receipt(Input, Context, Operation) {
    const Id = Input?.headers?.['vc-request-id'];
    if (!Context.SessionKey || typeof Id !== 'string' || !Id) return null;
    const Body = Input.Body || JSON.stringify(Input.Parsed?.Fields.map(F => [F.Crc, F.Type, F.Data1, F.Data2]) || []);
    return Crypto.createHash('sha256').update(`${Operation}\0${Context.SessionKey}\0${Id}\0`).update(Body).digest('hex');
}
function NextState(Previous, Counts, Token) {
    return { counts: Counts, receipts: Token ? [...Previous.receipts, Token].slice(-Store.MaximumReceipts) : [...Previous.receipts] };
}
function Prepare(Input, Context, Items) {
    if (!Items.some(Item => Store.ProductFor(Item))) return null;
    const Key = OwnedKey(Context);
    if (!Key || !(Context.GatoradeBoosts instanceof Map)) throw new Error('Gatorade state unavailable');
    const Previous = Store.Validate(StateFor(Context) || { counts: [0, 0, 0], receipts: [] });
    const Quantities = new Map();
    const Token = Receipt(Input, Context, 'purchase');
    const Replay = Boolean(Token && Previous.receipts.includes(Token));
    const Counts = [...Previous.counts];
    const Prices = new Map();
    const Values = Input?.Parsed?.Fields || [];
    Items.forEach((Item, Index) => {
        const Product = Store.ProductFor(Item);
        if (!Product) return;
        const Type = GetField(Values, PurchaseType, Index, Types.StringCrc);
        const CountCrc = Crc32(`ITEM${Index}_COUNT`);
        const PriceCrc = Crc32(`ITEM${Index}_EXPECTED_PRICE`);
        const Count = GetField(Values, CountCrc, 0, Types.U64);
        const Price = GetField(Values, PriceCrc, 0, Types.U64);
        const Quantity = Count ? GetU64(Values, CountCrc) : 0n;
        if (!Type || Type.Data1 !== Type2K22 || !Count || !Price ||
            GetFields(Values, CountCrc).length !== 1 || GetFields(Values, PriceCrc).length !== 1 ||
            Quantity < 1n || Quantity > 99n || GetU64(Values, PriceCrc) !== Product.price)
            throw new Error('invalid Gatorade cart row');
        Counts[Product.index] += Number(Quantity) * Product.uses;
        Prices.set(Index, Product.price);
        Quantities.set(Index, Quantity);
    });
    if (!Replay && Counts.some(N => N > Store.MaximumUses)) throw new Error('Gatorade capacity exceeded');
    return { Key, Previous: StateFor(Context), Replay, Prices, Quantities,
        Next: Replay ? Previous : NextState(Previous, Counts, Token) };
}
function Commit(Context, Plan) {
    if (!Plan || Plan.Replay) return;
    Context.GatoradeBoosts.set(Plan.Key, Plan.Next);
    try {
        if (typeof Context.SaveGatoradeBoosts === 'function') Context.SaveGatoradeBoosts();
    } catch (Failure) {
        if (Plan.Previous) Context.GatoradeBoosts.set(Plan.Key, Plan.Previous);
        else Context.GatoradeBoosts.delete(Plan.Key);
        throw Failure;
    }
}
function Append(Reply, Input, Context) {
    if (!Is2K22(Input)) return Reply;
    const State = StateFor(Context);
    if (!State) return Reply; // Do not initialize or overwrite untracked client state on reads.
    const Counts = Store.Validate(State).counts;
    // FUN_141192840 requires ten slots (0x141192895), but skips unknown
    // types at 0x141192983 without setting WasSeen. Seven zero-type slots
    // therefore leave ALL existing skill counts untouched; they are NOT zeros
    // for the seven skill types. Never send skill IDs here.
    for (let Index = 0; Index < 7; Index++) Reply.AddStringCrc(Fields.Type, 0).AddU64(Fields.Count, 0n);
    Store.BoostIds.forEach((Id, Index) => Reply.AddStringCrc(Fields.Type, Id).AddU64(Fields.Count, BigInt(Counts[Index])));
    return Reply;
}
function Decrease(Input, Context = {}) {
    const Reply = new Builder();
    const Previous = StateFor(Context);
    const Reason = GetField(Input?.Parsed?.Fields || [], Fields.Reason, 0, Types.StringCrc);
    // Preserve the former SUCCESS fallback for unrelated/unknown requests.
    if (!Is2K22(Input) || !Previous || !Reason || !DecreaseReasons.has(Reason.Data1))
        return Reply.AddStringCrc(Crc32('RESULT'), Crc32('SUCCESS')).Build();
    const Token = Receipt(Input, Context, 'decrease');
    if (!Token || !Previous.receipts.includes(Token)) {
        Commit(Context, { Key: OwnedKey(Context), Previous,
            Next: NextState(Previous, Previous.counts.map(N => Math.max(0, N - 1)), Token) });
    }
    Append(Reply, Input, Context);
    return Reply.AddStringCrc(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = { Fields, Prepare, Commit, Append, Decrease, StateFor };
