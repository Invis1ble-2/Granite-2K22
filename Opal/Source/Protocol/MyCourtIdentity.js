// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Zlib = require('node:zlib');
const MyCourt = require('./MyCourt');
const Roster = require('./Roster');
const PlayerBody = require('./PlayerBody');
const Log = require('../Core/Log');

const MaxProfile = 0x70000;
const ProfileMinimum = 0x414;
const MaxSlots = 5;
const NativePuidPolynomial = 0xc96c5795d7870f42n;
const U64Mask = 0xffffffffffffffffn;
const BlobCache = new WeakMap();

function Members(Connection) {
    return Roster.InActivity(Connection.ActivityKey, Connection.RoomScope).filter((Peer) =>
        MyCourt.IsMyCourt(Peer) && PlayerBody.GenerationForConnection(Peer) === '2K22');
}

function Floor(Value) {
    if (!Number.isFinite(Value)) throw new Error('profile contains a non-finite value');
    return Math.floor(Value);
}

function FloatText(Value) {
    if (!Number.isFinite(Value)) throw new Error('profile contains a non-finite appearance value');
    return Object.is(Value, -0) ? '0.000000' : Value.toFixed(6);
}

function Signed3(Value) {
    const Raw = (Value >>> 18) & 7;
    return Raw & 4 ? Raw - 8 : Raw;
}

function NativePuid(Raw) {
    if (!Buffer.isBuffer(Raw) || Raw.length < ProfileMinimum) throw new Error('invalid native profile length');
    const Weight = Floor(Raw.readFloatLE(0x170));
    const Height = Floor((Raw.readUInt16LE(0x638) & 0x7fff) * 0.01);
    const AppearanceByte = Raw[0x670];
    const AppearanceBits = Signed3(Raw.readUInt32LE(0x658));
    const Position = (Raw.readUInt32LE(0x210) >>> 8) & 7;
    const ModelBits = Raw.readUInt32LE(0x184);
    const ModelId = ModelBits & 0xffff;
    const SlotKey = Raw.readUInt16LE(0x410);
    if (Weight < 0 || Weight > 1000 || Height < 0 || Height > 300 ||
        ModelId === 0 || SlotKey === 0 || ModelId > 0xffff || SlotKey > 0xffff) {
        throw new Error('native profile values are outside the supported range');
    }
    const Values = [
        1, Weight, Height,
        AppearanceByte + 1, AppearanceBits + 1, Position + 1,
        (Raw[0x188] & 0x1f) + 1,
        (ModelBits >>> 28) + 1,
        FloatText(Raw.readFloatLE(0x63c)), FloatText(Raw.readFloatLE(0x640)),
        FloatText(Raw.readFloatLE(0x648)), FloatText(Raw.readFloatLE(0x64c)),
        ModelId, SlotKey,
    ];
    const Text = Values.join('_');
    const Bytes = Buffer.alloc(0x400);
    const Encoded = Buffer.from(Text, 'ascii');
    if (Encoded.length > Bytes.length) throw new Error('native PUID input exceeds 1024 bytes');
    Encoded.copy(Bytes);
    let Crc = U64Mask;
    for (const Byte of Bytes) {
        Crc ^= BigInt(Byte);
        for (let Bit = 0; Bit < 8; Bit++) Crc = Crc & 1n ? (Crc >> 1n) ^ NativePuidPolynomial : Crc >> 1n;
    }
    return { Id: BigInt.asUintN(64, Crc ^ U64Mask), Key: BigInt(SlotKey), ModelId: BigInt(ModelId), Text };
}

function BlobInfo(Blob) {
    let Info = BlobCache.get(Blob);
    if (Info) return Info;
    if (!Buffer.isBuffer(Blob) || !Blob.length || Blob.length > MaxProfile) throw new Error('invalid invited profile');
    const Raw = Zlib.inflateSync(Blob, { maxOutputLength: MaxProfile });
    if (!Raw.length) throw new Error('empty invited profile');
    const Puid = NativePuid(Raw);
    Info = { Length: Raw.length, Id: Puid.Id, Key: Puid.Key, ModelId: Puid.ModelId, Text: Puid.Text };
    BlobCache.set(Blob, Info);
    return Info;
}

function Snapshot(Connection) {
    if (!MyCourt.IsMyCourt(Connection) || !Connection.RoomScope ||
        PlayerBody.GenerationForConnection(Connection) !== '2K22') throw new Error('not in a native MyCOURT');
    const Owner = BigInt(MyCourt.OwnerFor(Connection));
    const Host = Members(Connection).find((Peer) => Peer.Puid === Owner);
    if (!Host) throw new Error('MyCOURT host is absent');
    const States = [...MyCourt.RoomStates.values()].filter((State) =>
        State.RoomScope === Connection.RoomScope && State.ActivityKey === Connection.ActivityKey &&
        State.Generation === '2K22' && State.NativeHost === Host && BigInt(State.Fields.OwnerId || 0n) === Owner);
    if (States.length !== 1) throw new Error('no unique host-authored native room snapshot');
    const State = States[0], Slots = [], Keys = new Set(), Ids = new Set();
    for (let Index = 0; Index < MaxSlots; Index++) {
        const Key = BigInt(State.Fields[`UserDataId${Index}`] || 0n);
        const Blob = State.Fields[`UserData${Index}`];
        if (!Key && (!Blob || !Blob.length)) { Slots.push(null); continue; }
        if (!Key || Key > 0xffffn || Keys.has(String(Key)) || !Blob) throw new Error('ambiguous invited player key');
        Keys.add(String(Key));
        const Info = BlobInfo(Blob);
        if (Info.Key !== Key || Ids.has(String(Info.Id))) throw new Error('profile key or PUID does not match its room slot');
        Ids.add(String(Info.Id));
        Slots.push({ Key, Id: Info.Id, Length: Info.Length, ModelId: Info.ModelId });
    }
    const Fingerprint = `${Host.Id}:${State.ObjectId}:` + Slots.map((Slot) =>
        Slot ? `${Slot.Key}:${Slot.Id}:${Slot.Length}` : '-').join('|');
    return { Owner, Host, Slots, Fingerprint };
}

function VerifiedIds(Connection, Humans, Requested) {
    const Current = Snapshot(Connection);
    const HumanIds = new Set(Humans.map((Peer) => String(Peer.Puid)));
    const CpuIds = new Set();
    for (const Id of Requested) {
        const Value = BigInt(Id);
        const Slot = Current.Slots.find((Candidate) => Candidate?.Id === Value);
        if (!Slot || HumanIds.has(String(Value)) || CpuIds.has(String(Value)))
            throw new Error('requested MyCOURT NBA identity is not a unique profile-derived native PUID');
        CpuIds.add(String(Value));
    }
    return new Set([...CpuIds].map((Id) => BigInt(Id)));
}


module.exports = { VerifiedIds, NativePuid };
