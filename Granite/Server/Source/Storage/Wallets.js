// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const Path = require('node:path');
const MaximumBalance = 0xffffffffffffffffn;
let SaveSequence = 0;

function NormalizeKey(Key) {
    const Value = String(Key);
    if (!Value || Value.trim() !== Value || Value.length > 256) throw new Error(`invalid wallet account key: ${Value}`);
    return Value;
}

function NormalizeBalance(Value, Key) {
    let Balance;
    try {
        if (typeof Value !== 'bigint' && typeof Value !== 'string' && !Number.isSafeInteger(Value))
            throw new Error('unsupported value type');
        Balance = BigInt(Value);
    } catch {
        throw new Error(`invalid wallet balance for account ${Key}`);
    }
    if (Balance < 0n || Balance > MaximumBalance) throw new Error(`wallet balance out of range for account ${Key}`);
    return Balance;
}

function Load(File) {
    let Raw;
    try {
        Raw = JSON.parse(Fs.readFileSync(File, 'utf8'));
    } catch (Failure) {
        if (Failure.code === 'ENOENT') return new Map();
        throw new Error(`wallet file unavailable; refusing to reset balances: ${Failure.message}`, { cause: Failure });
    }
    if (!Raw || typeof Raw !== 'object' || Array.isArray(Raw) || Raw.version !== 1 ||
        !Raw.accounts || typeof Raw.accounts !== 'object' || Array.isArray(Raw.accounts))
        throw new Error('invalid wallet file schema; refusing to reset balances');

    const Wallets = new Map();
    for (const [RawKey, Value] of Object.entries(Raw.accounts)) {
        const Key = NormalizeKey(RawKey);
        Wallets.set(Key, NormalizeBalance(Value, Key));
    }
    return Wallets;
}

function Save(File, Wallets) {
    if (!(Wallets instanceof Map)) throw new TypeError('wallets must be a Map');
    const Accounts = Object.create(null);
    for (const [RawKey, Value] of Wallets) {
        const Key = NormalizeKey(RawKey);
        Accounts[Key] = NormalizeBalance(Value, Key).toString();
    }
    const Document = `${JSON.stringify({ version: 1, accounts: Accounts }, null, 2)}\n`;
    Fs.mkdirSync(Path.dirname(File), { recursive: true });
    const Temporary = `${File}.${process.pid}.${Date.now()}.${++SaveSequence}.tmp`;
    try {
        Fs.writeFileSync(Temporary, Document, { encoding: 'utf8', flag: 'wx' });
        Fs.renameSync(Temporary, File);
    } catch (Failure) {
        try { Fs.unlinkSync(Temporary); } catch {}
        throw Failure;
    }
}

module.exports = { Load, Save, NormalizeBalance, MaximumBalance };
