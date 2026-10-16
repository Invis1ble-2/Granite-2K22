// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Fs = require('node:fs');
const Path = require('node:path');

// NBA2K22 unpacked 0x14364A160; progression order at 0x142B1A3A0
// is Shake, Quencher, Zero (not the store table's Quencher, Shake, Zero).
const Products = new Map([
    [0xed175be5, Object.freeze({ index: 0, uses: 1, price: 500n })],
    [0x45a9e847, Object.freeze({ index: 0, uses: 10, price: 3500n })],
    [0x4c99dc6d, Object.freeze({ index: 1, uses: 1, price: 500n })],
    [0xe80626b4, Object.freeze({ index: 1, uses: 10, price: 3500n })],
    [0xf713373a, Object.freeze({ index: 2, uses: 1, price: 500n })],
    [0x88d81a73, Object.freeze({ index: 2, uses: 10, price: 3500n })],
]);
const BoostIds = Object.freeze([0xed175be5, 0x4c99dc6d, 0xf713373a]);
const MaximumUses = 99;
const MaximumReceipts = 128;

function ProductFor(Item) { return Products.get(Number(Item) >>> 0) || null; }
function Validate(State) {
    if (!State || !Array.isArray(State.counts) || State.counts.length !== 3 ||
        !State.counts.every(N => Number.isInteger(N) && N >= 0 && N <= MaximumUses) ||
        !Array.isArray(State.receipts) || State.receipts.length > MaximumReceipts ||
        !State.receipts.every(Id => typeof Id === 'string' && /^[a-f0-9]{64}$/.test(Id)))
        throw new Error('invalid Gatorade boost state');
    return { counts: [...State.counts], receipts: [...State.receipts] };
}
function Load(File) {
    let Document;
    try { Document = JSON.parse(Fs.readFileSync(File, 'utf8')); }
    catch (Failure) { if (Failure.code === 'ENOENT') return new Map(); throw Failure; }
    if (Document?.version !== 1 || !Document.accounts || typeof Document.accounts !== 'object' || Array.isArray(Document.accounts))
        throw new Error('invalid Gatorade boost document');
    return new Map(Object.entries(Document.accounts).map(([Key, State]) => {
        if (!/^[0-9A-F]{16}$/.test(Key)) throw new Error('invalid Gatorade account key');
        return [Key, Validate(State)];
    }));
}
function Save(File, States) {
    const Accounts = Object.fromEntries([...States].map(([Key, State]) => [Key, Validate(State)]));
    Fs.mkdirSync(Path.dirname(File), { recursive: true });
    const Temporary = `${File}.${process.pid}.tmp`;
    try {
        Fs.writeFileSync(Temporary, `${JSON.stringify({ version: 1, accounts: Accounts }, null, 2)}\n`, 'utf8');
        Fs.renameSync(Temporary, File);
    } finally {
        Fs.rmSync(Temporary, { force: true });
    }
}

module.exports = { ProductFor, BoostIds, MaximumUses, MaximumReceipts, Validate, Load, Save };
