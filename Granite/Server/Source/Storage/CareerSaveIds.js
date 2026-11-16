// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Crypto = require('node:crypto');
const { GetU64 } = require('../Codec/FieldList');
const Json = require('./JsonLedger');

const SaveField = 0xd5e5f21d;
const SlotField = 0x5eeda966;
// NBA 2K22 FUN_14059A4F0 checks signed CloudSaveId > 0, and FUN_140874570
// checks signed CloudSaveId > 1 (1 is reserved for Prelude).
const MinSaveId = 2n;
const MaxSaveId = 0x7fffffffffffffffn;

function ParseSaveId(Value) {
    try {
        if (Value === null || Value === undefined || Value === '') return null;
        const Id = BigInt(Value);
        return Id >= MinSaveId && Id <= MaxSaveId ? Id : null;
    } catch {
        return null;
    }
}

function IdentityFor(Context = {}) {
    try {
        if (Context.userId !== null && Context.userId !== undefined && Context.userId !== '') {
            const Id = BigInt(Context.userId);
            if (Id > 0n) return `user:${Id.toString()}`;
        }
    } catch {}
    if (Context.gamertag) return `gamertag:${String(Context.gamertag)}`;
    return null;
}

function SlotFor(Context = {}, Fields = []) {
    const Requested = Array.isArray(Fields) ? GetU64(Fields, SlotField) : null;
    if (Requested !== null) return Requested.toString();
    if (Context.careerSlot !== null && Context.careerSlot !== undefined && String(Context.careerSlot) !== '') {
        return String(Context.careerSlot);
    }
    return null;
}

function GenerateSaveId(Used = null) {
    for (;;) {
        const Candidate = Crypto.randomBytes(8).readBigUInt64BE(0) & MaxSaveId;
        if (Candidate < MinSaveId) continue;
        if (Used instanceof Set && Used.has(Candidate.toString())) continue;
        return Candidate;
    }
}

class CareerSaveIds {
    constructor(File = null) {
        this.File = File;
        const Raw = File ? Json.Load(File, { version: 1, records: [] }) : { version: 1, records: [] };
        if (!Json.IsObject(Raw) || Raw.version !== 1 || !Array.isArray(Raw.records)) {
            throw new Error(`Invalid career save ID store: ${File}`);
        }
        const Records = [];
        for (const Entry of Raw.records) {
            if (!Json.IsObject(Entry)) continue;
            const Parsed = ParseSaveId(Entry.id);
            const Identity = typeof Entry.identity === 'string' && Entry.identity ? Entry.identity : null;
            const Slot =
                Entry.slot !== null && Entry.slot !== undefined && String(Entry.slot) !== ''
                    ? String(Entry.slot)
                    : null;
            if (!Identity || Slot === null || Parsed === null) continue;
            Records.push({ identity: Identity, slot: Slot, id: Parsed.toString() });
        }
        this.State = { version: 1, records: Records };
        this.Used = new Set(Records.map((Record) => Record.id));
    }

    Commit(Records) {
        this.State = { version: 1, records: Records };
        this.Used = new Set(Records.map((Record) => Record.id));
        if (this.File) Json.Save(this.File, this.State);
    }

    ForgetSlot(Context = {}, Slot = null) {
        const Identity = IdentityFor(Context);
        const SlotKey = Slot !== null && Slot !== undefined ? String(Slot) : SlotFor(Context);
        if (!Identity || SlotKey === null) return [];
        const Kept = [];
        const Removed = [];
        for (const Record of this.State.records) {
            if (Record.identity === Identity && Record.slot === SlotKey) Removed.push(Record.id);
            else Kept.push(Record);
        }
        if (Removed.length && !Context.ReadOnly) this.Commit(Kept);
        return Removed;
    }

    Resolve(Context = {}, Fields = []) {
        const Requested = Array.isArray(Fields) ? ParseSaveId(GetU64(Fields, SaveField)) : null;
        const Existing = Requested ?? ParseSaveId(Context.CareerSaveId ?? Context.CloudSaveId);
        const Identity = IdentityFor(Context);
        const Slot = SlotFor(Context, Fields);
        if (Existing !== null) {
            const IdText = Existing.toString();
            this.Used.add(IdText);
            if (
                !Context.ReadOnly &&
                Identity &&
                Slot !== null &&
                !this.State.records.some(
                    (Record) => Record.identity === Identity && Record.slot === Slot && Record.id === IdText,
                )
            ) {
                this.Commit([...this.State.records, { identity: Identity, slot: Slot, id: IdText }]);
            }
            return Existing;
        }
        const Allocated = GenerateSaveId(this.Used);
        const IdText = Allocated.toString();
        this.Used.add(IdText);
        if (!Context.ReadOnly && Identity && Slot !== null) {
            this.Commit([...this.State.records, { identity: Identity, slot: Slot, id: IdText }]);
        }
        return Allocated;
    }
}

module.exports = {
    CareerSaveIds,
    MinSaveId,
    MaxSaveId,
    ParseSaveId,
    IdentityFor,
    SlotFor,
    GenerateSaveId,
};
