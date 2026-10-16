// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

// 2K19 primary VC field
const Balance2K19 = 0x93b1e1e4;

// 2K22 multi-token balances confirmed via Ghidra disassembly of FUN_1413e32c0 / FUN_1413e2f40:
// 0xce7d633f: VC balance (Token type 0)
// 0xe4982d62: MTP balance (Token type 1)
// 0xe0a117ba: Token/Season balance (Token type 2)
const BalanceVC2K22 = 0xce7d633f;
const BalanceMTP2K22 = 0xe4982d62;
const BalanceToken2K22 = 0xe0a117ba;

const StartingBalance = 888888n;
function ParseBoolean(Value, Fallback) {
    if (Value === undefined || Value === null || Value === '') return Fallback;
    return !['0', 'false', 'no', 'off'].includes(String(Value).trim().toLowerCase());
}

const StaticBalance = ParseBoolean(process.env.GRANITE_VC_STATIC, false);

function IsStaticBalance(Context = {}) {
    if (typeof Context.VirtualCurrencyStatic === 'boolean') return Context.VirtualCurrencyStatic;
    if (typeof Context.VcStatic === 'boolean') return Context.VcStatic;
    return StaticBalance;
}

function BalanceFor(Context = {}) {
    const Key = Context.userId === null || Context.userId === undefined ? 'anonymous' : Context.userId.toString();
    if (!Context.Wallets) return StartingBalance;
    if (IsStaticBalance(Context)) {
        Context.Wallets.set(Key, StartingBalance);
        return StartingBalance;
    }
    if (!Context.Wallets.has(Key)) Context.Wallets.set(Key, StartingBalance);
    return Context.Wallets.get(Key);
}

function SetBalance(Context = {}, Value) {
    if (!(Context.Wallets instanceof Map)) return Value;
    const Key = Context.userId === null || Context.userId === undefined ? 'anonymous' : Context.userId.toString();
    const Previous = Context.Wallets.get(Key);
    const HadPrevious = Context.Wallets.has(Key);
    const Static = IsStaticBalance(Context);
    const Next = Static ? StartingBalance : BigInt(Value);
    if (Next < 0n || Next > 0xffffffffffffffffn) throw new RangeError('VC balance is outside the U64 range');
    Context.Wallets.set(Key, Next);
    if (Static || typeof Context.SaveWallets !== 'function') return Next;
    try {
        Context.SaveWallets();
    } catch (Failure) {
        if (HadPrevious) Context.Wallets.set(Key, Previous);
        else Context.Wallets.delete(Key);
        throw Failure;
    }
    return Next;
}

function Build(Input, Context = {}) {
    const CurrentBalance = BalanceFor(Context);
    return new Builder()
        .AddU32(Crc32('RESULT'), Crc32('SUCCESS'))
        .AddU64(Balance2K19, CurrentBalance)
        .AddU64(BalanceVC2K22, CurrentBalance)
        .AddU64(BalanceMTP2K22, 0n)
        .AddU64(BalanceToken2K22, 0n)
        .Build();
}

module.exports = {
    Build,
    Balance: Build,
    BalanceFor,
    StartingBalance,
    SetBalance,
    StaticBalance,
    IsStaticBalance,
    Status: 'CONFIRMED_2K19_BALANCE_FIELD_DEBIT_BY_DEFAULT',
};
