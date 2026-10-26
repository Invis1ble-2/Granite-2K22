// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const Log = require('../Core/Log');
const ObjectFrame = require('../Codec/ObjectFrame');
const Roster = require('./Roster');
const PlayerBody = require('./PlayerBody');
const Requests = require('./Requests');

const RoomClass = 0x16a0d01e;
const RoomClassSize = 7952;
const ObjectDataPacket = 0x9c72247c;
const ObjectDataListPacket = 0x618ec78c;
const ObjectUpdatePacket = 0xfef2dd68;
const LegacyObjectUpdatePacket = 0x01ae543f;
const RoomObjectIndex = 0x000d4d06n;
const BootstrapDelayMs = Number.isFinite(Number(process.env.OPAL_MYCOURT_BOOTSTRAP_DELAY_MS))
    ? Math.max(0, Number(process.env.OPAL_MYCOURT_BOOTSTRAP_DELAY_MS))
    : 100;

const InitialWorldTime = 0x9705bb0d;
const InitialState = 0x4905ed7b;

const RoomRuntime = Object.freeze({
    Value0: 128,
    Value0Dirty: 132,
    Value1: 136,
    Value1Dirty: 144,
    Value2: 148,
    Value2Dirty: 152,
    OwnerFlag: 153,
    OwnerFlagDirty: 154,
    Value4: 156,
    Value4Dirty: 160,
    RelatedCount: 161,
    RelatedCountDirty: 162,
    RelatedIdsDirty: 163,
    RelatedIds: 176,
    CustomizationDirty: 224,
    CustomizationBlock: 228,
    CustomizationSize: 4856,
    PlayerStateBlock: 5088,
    PlayerStateSize: 2712,
    PlayerStateDirty: 7800,
    UserDataCount: 7808,
    UserDataCountDirty: 7816,
    UserDataIdsDirty: 7817,
    UserDataIds: 7824,
    UserDataBuffers: 7864,
    UserDataLengths: 7904,
    UserDataDirty: 7924,
    FeatureA: 7929,
    FeatureADirty: 7930,
    FeatureB: 7931,
    FeatureBDirty: 7932,
    FeatureC: 7933,
    FeatureCDirty: 7934,
    FinalValue: 7936,
    FinalValueDirty: 7944,
});

const RoomFields = Object.freeze([
    { Name: 'WorldTime', Type: 'u32', Size: 4 },
    { Name: 'OwnerId', Type: 'u64', Size: 8 },
    { Name: 'State', Type: 'u32', Size: 4 },
    { Name: 'IsValid', Type: 'u8', Size: 1 },
    { Name: 'GameType', Type: 'u32', Size: 4 },
    { Name: 'RelatedCount', Type: 'u8', Size: 1 },
    ...Array.from({ length: 6 }, (_, Index) => ({ Name: `RelatedId${Index}`, Type: 'u64', Size: 8 })),
    { Name: 'Customization', Type: 'blob32', FixedLength: 4856 },
    { Name: 'PlayerState', Type: 'blob32', FixedLength: 2712 },
    { Name: 'UserDataCount', Type: 'u64', Size: 8 },
    ...Array.from({ length: 5 }, (_, Index) => ({ Name: `UserDataId${Index}`, Type: 'u64', Size: 8 })),
    ...Array.from({ length: 5 }, (_, Index) => ({ Name: `UserData${Index}`, Type: 'blob32' })),
    { Name: 'FeatureA', Type: 'u8', Size: 1 },
    { Name: 'FeatureB', Type: 'u8', Size: 1 },
    { Name: 'FeatureC', Type: 'u8', Size: 1 },
    { Name: 'FinalValue', Type: 'u64', Size: 8 },
]);

// NBA2K22.exe.unpacked.exe: FUN_141655790/FUN_1416E18E0 read/write
// 30 fields; StadiumData=0x12FC, StadiumSetup=0xAE0, cloud-save ID at bit 29.
const RoomFields2K22 = Object.freeze([
    ...RoomFields.map((Field) => {
        if (Field.Name === 'Customization') return { ...Field, FixedLength: 0x12fc };
        if (Field.Name === 'PlayerState') return { ...Field, FixedLength: 0xae0 };
        return Field;
    }),
    { Name: 'OwnerCloudSaveId', Type: 'u64', Size: 8 },
]);

function FieldsFor(Generation = '2K19') {
    return Generation === '2K22' ? RoomFields2K22 : RoomFields;
}

function DecodeRoom(Parsed) {
    const Schema = FieldsFor(Parsed && Parsed.Generation);
    if (!Parsed || Parsed.Class !== RoomClass || Parsed.FlagCount !== Schema.length || !Parsed.Values) {
        return null;
    }
    const Present = new Set(Parsed.Flags);
    const Fields = {};
    let Offset = 0;
    for (let Index = 0; Index < Schema.length; Index++) {
        if (!Present.has(Index)) continue;
        const Field = Schema[Index];
        if (Field.Type === 'blob32') {
            if (Offset + 4 > Parsed.Values.length) return null;
            const Length = Parsed.Values.readUInt32LE(Offset);
            Offset += 4;
            if (Field.FixedLength !== undefined && Length !== 0 && Length !== Field.FixedLength) return null;
            if (Offset + Length > Parsed.Values.length) return null;
            Fields[Field.Name] = Buffer.from(Parsed.Values.slice(Offset, Offset + Length));
            Offset += Length;
            continue;
        }
        if (Offset + Field.Size > Parsed.Values.length) return null;
        if (Field.Type === 'u8') Fields[Field.Name] = Parsed.Values.readUInt8(Offset);
        else if (Field.Type === 'u32') Fields[Field.Name] = Parsed.Values.readUInt32LE(Offset) >>> 0;
        else Fields[Field.Name] = Parsed.Values.readBigUInt64LE(Offset);
        Offset += Field.Size;
    }
    const Rest = Parsed.Values.subarray(Offset);
    return { Fields: Fields, BytesRead: Offset, Complete: Rest.every((Byte) => Byte === 0) };
}

function DecodeRoomPayload(Payload, Generation = '2K19') {
    const Count = FieldsFor(Generation).length;
    const FlagsSize = ObjectFrame.FlagBytes(Count);
    const ValuesStart = 16 + FlagsSize;
    if (!Buffer.isBuffer(Payload) || Payload.length < ValuesStart) return null;
    const UnusedMask = (1 << (FlagsSize * 8 - Count)) - 1;
    if (Payload[ValuesStart - 1] & UnusedMask) return null;
    const Parsed = {
        Class: RoomClass,
        Generation,
        FlagCount: Count,
        Key: Payload.readBigUInt64BE(0),
        Version: Payload.readBigUInt64BE(8),
        Flags: ObjectFrame.ReadFlags(Payload, 16, Count),
        Values: Payload.slice(ValuesStart),
    };
    Parsed.Room = DecodeRoom(Parsed);
    return Parsed.Room && Parsed.Room.Complete ? Parsed : null;
}

const Rooms = new Map();
const ClosedRooms = new WeakMap(); // Terminal state belongs to old connections, never a host PUID.
let TemplateAttempted = false;
let TemplateFrame = null;

function IsMyCourt(Connection) {
    return !!Connection && String(Connection.ActivityName || '').toLowerCase() === 'mycourt';
}

function IsRoomClosed(Connection) {
    const Closed = Connection && ClosedRooms.get(Connection);
    return !!Closed && IsMyCourt(Connection) && Closed.ActivityKey === Connection.ActivityKey &&
        Closed.RoomScope === Connection.RoomScope;
}

function ResetConnection(Connection) {
    if (Connection.MyCourtBootstrapTimer) clearTimeout(Connection.MyCourtBootstrapTimer);
    Connection.MyCourtBootstrapTimer = null;
    Connection.MyCourtBootstrapSent = false;
    ClosedRooms.delete(Connection);
}

function PublishClosedRoom(Connection, SeenObjectId = null, SeenVersion = 0n) {
    if (!IsRoomClosed(Connection) || Connection.Closed || Connection.State !== 2 ||
        Connection.Puid === null || Connection.Puid === undefined) return 0;
    const Closed = ClosedRooms.get(Connection);
    let Sent = 0;
    for (const Record of Closed.Records.values()) {
        const Seen = SeenObjectId === Record.ObjectId ? BigInt(SeenVersion) : 0n;
        Record.Version = (Seen > Record.Version ? Seen : Record.Version) + 1n;
        // NBA2K22 FUN_14161E460 (14161E5B6..14161E5E5): matching the
        // local PUID in room +0xB1/+0xC0 enters native unavailable handling
        // without waiting for the host-entity disappearance countdown.
        // These fields are private to this visitor; never cache/broadcast them.
        const Fields = { RelatedCount: 1, RelatedId0: BigInt(Connection.Puid) };
        for (let Index = 1; Index < 6; Index++) Fields[`RelatedId${Index}`] = 0n;
        if (Connection.SendObject(BuildRoomFrame({
            ObjectId: Record.ObjectId, Version: Record.Version, Generation: '2K22', Fields,
        }))) Sent++;
    }
    return Sent;
}

function ParseRoom(Bytes, Generation = '2K19') {
    if (!Buffer.isBuffer(Bytes) || Bytes.length < 30 || Bytes.readUInt32LE(0) !== Bytes.length) return null;
    const Parsed = ObjectFrame.Parse(Bytes);
    if (!Parsed || Parsed.Class !== RoomClass) return null;
    const Decoded = DecodeRoomPayload(Parsed.Payload, Generation);
    return Decoded ? Object.assign(Parsed, Decoded) : null;
}

function ParseRoomList(Bytes, Generation = '2K19') {
    if (
        !Buffer.isBuffer(Bytes) ||
        Bytes.length < 23 ||
        Bytes.readUInt32LE(0) !== Bytes.length ||
        Bytes.readUInt32BE(4) !== ObjectDataListPacket
    )
        return null;
    const Count = Bytes.readUInt8(16);
    const ClassCrc = Bytes.readUInt32BE(17) >>> 0;
    if (!Count || ClassCrc !== RoomClass) return null;
    let Offset = 23;
    const Records = [];
    for (let Index = 0; Index < Count; Index++) {
        if (Offset + 9 > Bytes.length) return null;
        const ObjectId = Bytes.readBigUInt64BE(Offset);
        const Length = Bytes.readUInt8(Offset + 8);
        const End = Offset + 9 + Length;
        if (End > Bytes.length) return null;
        const Payload = Buffer.from(Bytes.slice(Offset + 9, End));
        const Parsed = DecodeRoomPayload(Payload, Generation);
        if (!Parsed) return null;
        Records.push({ ObjectId: ObjectId, Payload: Payload, Parsed: Parsed });
        Offset = End;
    }
    return Offset === Bytes.length ? { Count: Count, Class: ClassCrc, Records: Records } : null;
}

function ListContainsRoom(Bytes, Generation = '2K19') {
    return ParseRoomList(Bytes, Generation) !== null;
}

function PacketRoom(Bytes, PacketId, Generation = '2K19') {
    const Parsed = ParseRoom(Bytes, Generation);
    if (Parsed) return { Parsed: Parsed, List: false };
    if (PacketId === ObjectDataListPacket) {
        const List = ParseRoomList(Bytes, Generation);
        if (List) return { Parsed: { ObjectId: null, Class: RoomClass, RoomList: List }, List: true };
    }
    return null;
}

function ExtractTemplateFrame(Input, Generation = '2K19') {
    if (Buffer.isBuffer(Input)) {
        const Id = Input.length >= 8 ? Input.readUInt32BE(4) >>> 0 : null;
        return Id !== null && IsRoomPacket(Id) && PacketRoom(Input, Id, Generation) ? Buffer.from(Input) : null;
    }
    if (typeof Input !== 'string') return null;
    for (const Line of Input.split(/\r?\n/)) {
        const Hex = Line.split(/\s+/).find(
            (Token) => Token.length >= 32 && /^[0-9a-f]+$/i.test(Token) && !(Token.length & 1),
        );
        if (!Hex) continue;
        let Frame;
        try {
            Frame = Buffer.from(Hex, 'hex');
        } catch (_) {
            continue;
        }
        const Id = Frame.length >= 8 ? Frame.readUInt32BE(4) >>> 0 : null;
        if (Id !== null && IsRoomPacket(Id) && PacketRoom(Frame, Id, Generation)) return Frame;
    }
    return null;
}

function RoomTemplate() {
    if (TemplateAttempted) return TemplateFrame;
    TemplateAttempted = true;
    const File = process.env.OPAL_MYCOURT_ROOM_FRAME;
    if (!File) return null;
    try {
        const Input = Fs.readFileSync(File);
        const Data = File.toLowerCase().endsWith('.txt') ? Input.toString('utf8') : Input;
        TemplateFrame = ExtractTemplateFrame(Data) || ExtractTemplateFrame(Data, '2K22');
        if (!TemplateFrame) {
            Log.Error(`MyCourt room template ${File} contains no complete 0x16A0D01E frame`);
        } else {
            Log.Verbose(`  loaded MyCourt room template ${File} (${TemplateFrame.length} bytes)`);
        }
    } catch (Failure) {
        Log.Error(`MyCourt room template ${File} could not be read: ${Failure.message}`);
    }
    return TemplateFrame;
}

function OwnerFor(Connection) {
    // 2K22 elevator visits carry the host in TEAM_ID, not the visitor identity.
    if (PlayerBody.GenerationForConnection(Connection) === '2K22' && Connection.TeamId) {
        return BigInt.asUintN(64, BigInt(Connection.TeamId));
    }
    return Connection.Puid !== null && Connection.Puid !== undefined
        ? Connection.Puid
        : Connection.ClaimedPuid !== null && Connection.ClaimedPuid !== undefined
          ? Connection.ClaimedPuid
          : null;
}

function IsGuest(Connection) {
    const Owner = OwnerFor(Connection);
    return Owner !== null && Connection.Puid !== null && Connection.Puid !== undefined &&
        BigInt(Owner) !== BigInt(Connection.Puid);
}

function RoomScopeFor(Connection) {
    const Owner = OwnerFor(Connection);
    if (Owner === null) return `mycourt:connection-${Connection.Id}`;
    return `mycourt:${BigInt.asUintN(64, BigInt(Owner)).toString(16).padStart(16, '0')}`;
}

function RelayTokenFor(Connection) {
    const Token = Buffer.from(require('../Activity/Init').Variant.MyCourt.Data);
    const Scope = Connection.RoomScope || RoomScopeFor(Connection);
    const Hex = Scope.slice('mycourt:'.length);
    if (/^[0-9a-f]{16}$/.test(Hex)) Token.writeBigUInt64BE(BigInt('0x' + Hex), 0);
    else Token.writeBigUInt64BE(0x4d59434f55525400n | BigInt(Connection.Id & 0xff), 0);
    return Token;
}

function RoomKey(Connection, ObjectId) {
    const Activity = Connection.RoomScope
        ? Connection.RoomScope
        : Connection.ActivityKey === null || Connection.ActivityKey === undefined
          ? 'mycourt'
          : (Connection.ActivityKey >>> 0).toString(16);
    if (ObjectId !== null && ObjectId !== undefined) {
        return `${Activity}:${BigInt(ObjectId).toString(16)}`;
    }
    return `${Activity}:list`;
}

function IsRoomPacket(PacketId) {
    return (
        PacketId === ObjectDataPacket ||
        PacketId === ObjectDataListPacket ||
        PacketId === ObjectUpdatePacket ||
        PacketId === LegacyObjectUpdatePacket
    );
}

function SessionObjectId(SessionId, Index = RoomObjectIndex) {
    return (BigInt(SessionId) << 32n) | BigInt(Index);
}

function BuildBootstrap(Connection) {
    if (
        !Connection ||
        Connection.Puid === null ||
        Connection.Puid === undefined ||
        Connection.SessionId === null ||
        Connection.SessionId === undefined
    )
        return null;
    const ObjectId = SessionObjectId(Connection.SessionId);
    const Values = Buffer.alloc(16);
    Values.writeUInt32LE(InitialWorldTime >>> 0, 0);
    Values.writeBigUInt64LE(BigInt.asUintN(64, BigInt(OwnerFor(Connection))), 4);
    Values.writeUInt32LE(InitialState >>> 0, 12);
    const Payload = ObjectFrame.BuildPayload({
        key: ObjectId,
        version: 1n,
        ClassCrc: RoomClass,
        Bits: [0, 1, 2],
        Values,
        FlagCount: FieldsFor(PlayerBody.GenerationForConnection(Connection)).length,
    });
    return ObjectFrame.Build({
        PacketId: ObjectDataPacket,
        ConnectionId: null,
        ObjectId,
        ClassCrc: RoomClass,
        Payload,
        Layout: ObjectFrame.Layout.Nineteen,
    });
}

function PublishBootstrap(Connection) {
    if (IsRoomClosed(Connection)) { PublishClosedRoom(Connection); return false; }
    if (!IsMyCourt(Connection) || Connection.State !== 2 || Connection.MyCourtBootstrapSent) return false;
    let Frame = BuildBootstrap(Connection);
    if (!Frame) {
        Log.Error(
            `${Connection.Identifier} could not receive a MyCourt bootstrap because its PUID or session is missing`,
        );
        return false;
    }
    const Generation = PlayerBody.GenerationForConnection(Connection);
    let Parsed = ParseRoom(Frame, Generation);
    if (!Parsed) return false;
    const Existing = RoomStates.get(RoomKey(Connection, Parsed.ObjectId));
    if (Existing && Existing.Generation === Generation) {
        if (Existing.Fields.OwnerId !== undefined) {
            // A native snapshot already supplied ownership. Never reset it or
            // its version when the delayed bootstrap timer fires.
            if (Generation === '2K22' && !Connection.SendObject(BuildRoomFrame(Existing))) return false;
            Connection.MyCourtBootstrapSent = true;
            return false;
        }
        Frame = BuildRoomFrame({
            ObjectId: Parsed.ObjectId, Generation,
            Version: (Existing.Version > Parsed.Version ? Existing.Version : Parsed.Version) + 1n,
            Fields: { ...Parsed.Room.Fields, ...Existing.Fields },
        });
        Parsed = ParseRoom(Frame, Generation);
    }
    if (!Parsed || !Connection.SendObject(Frame)) return false;
    Connection.MyCourtBootstrapSent = true;
    Rooms.set(RoomKey(Connection, Parsed.ObjectId), {
        Frame: Buffer.from(Frame),
        Generation,
        Source: Connection.Id,
        Bootstrap: true,
        ObjectId: Parsed.ObjectId,
        ActivityKey:
            Connection.ActivityKey === null || Connection.ActivityKey === undefined
                ? null
                : Connection.ActivityKey >>> 0,
        RoomScope: Connection.RoomScope || null,
    });
    RoomStates.set(RoomKey(Connection, Parsed.ObjectId), {
        ObjectId: Parsed.ObjectId,
        Version: Parsed.Version,
        Fields: { ...Parsed.Room.Fields },
        Generation,
        Source: Connection.Id,
        ActivityKey:
            Connection.ActivityKey === null || Connection.ActivityKey === undefined
                ? null
                : Connection.ActivityKey >>> 0,
        RoomScope: Connection.RoomScope || null,
    });
    Log.Info(
        `${Connection.Identifier} received the NBA${Generation} MyCourt ownership bootstrap ` +
            `(owner 0x${BigInt(OwnerFor(Connection)).toString(16).padStart(16, '0')}, ` +
            `object ${Parsed.ObjectId.toString(16).toUpperCase()})`,
    );
    Log.Verbose(
        `  room revision ${Parsed.Version}, ownership bootstrap retains any native fields, ` +
            `sent ${BootstrapDelayMs}ms after init`,
    );
    return true;
}

function ScheduleBootstrap(Connection) {
    if (!IsMyCourt(Connection) || IsRoomClosed(Connection) || Connection.MyCourtBootstrapSent || Connection.MyCourtBootstrapTimer) return false;
    const Timer = setTimeout(() => {
        Connection.MyCourtBootstrapTimer = null;
        if (!Connection.Closed) PublishBootstrap(Connection);
    }, BootstrapDelayMs);
    if (Timer.unref) Timer.unref();
    Connection.MyCourtBootstrapTimer = Timer;
    return true;
}

const RoomStates = new Map();

const CribState = Object.freeze({
    None: InitialState,
    Scrimmage: 0x9712981b,
});

function EncodeRoom(Fields, Generation = '2K19') {
    const Bits = [];
    const Parts = [];
    FieldsFor(Generation).forEach((Field, Index) => {
        const Value = Fields[Field.Name];
        if (Value === undefined || Value === null) return;
        Bits.push(Index);
        if (Field.Type === 'blob32') {
            if (!Buffer.isBuffer(Value) || (Field.FixedLength !== undefined && Value.length !== 0 && Value.length !== Field.FixedLength)) {
                throw new Error(`invalid ${Generation} MyCourt ${Field.Name} block`);
            }
            const Count = Buffer.alloc(4);
            Count.writeUInt32LE(Value.length, 0);
            Parts.push(Count, Value);
        } else if (Field.Type === 'u8') {
            Parts.push(Buffer.from([Number(Value) & 0xff]));
        } else if (Field.Type === 'u32') {
            const Out = Buffer.alloc(4);
            Out.writeUInt32LE(Number(Value) >>> 0, 0);
            Parts.push(Out);
        } else {
            const Out = Buffer.alloc(8);
            Out.writeBigUInt64LE(BigInt.asUintN(64, BigInt(Value)), 0);
            Parts.push(Out);
        }
    });
    return { Bits: Bits, Values: Buffer.concat(Parts) };
}

function RoomStateFor(Connection, ObjectId) {
    const Id = ObjectId === null || ObjectId === undefined ? SessionObjectId(Connection.SessionId) : BigInt(ObjectId);
    const Key = RoomKey(Connection, Id);
    let State = RoomStates.get(Key);
    if (!State) {
        State = {
            ObjectId: Id,
            Version: 0n,
            Fields: {},
            Generation: PlayerBody.GenerationForConnection(Connection),
            Source: Connection.Id,
            ActivityKey:
                Connection.ActivityKey === null || Connection.ActivityKey === undefined
                    ? null
                    : Connection.ActivityKey >>> 0,
            RoomScope: Connection.RoomScope || null,
        };
        RoomStates.set(Key, State);
    }
    return { Key: Key, State: State };
}

function CacheRoomState(Connection, Packet, Generation, Native = true) {
    const Parsed = Packet.Parsed;
    const Records = Packet.List ? Parsed.RoomList.Records : [{ ObjectId: Parsed.ObjectId, Parsed }];
    for (const Record of Records) {
        const { State } = RoomStateFor(Connection, Record.ObjectId);
        Object.assign(State.Fields, Record.Parsed.Room.Fields);
        if (Generation === '2K22' && !IsGuest(Connection)) State.NativeHost = Native ? Connection : null;
        State.Generation = Generation;
        if (Record.Parsed.Version > State.Version) State.Version = Record.Parsed.Version;
    }
}

function BuildRoomFrame(State) {
    const Generation = State.Generation || '2K19';
    const Encoded = EncodeRoom(State.Fields, Generation);
    const Payload = ObjectFrame.BuildPayload({
        key: State.ObjectId,
        version: State.Version,
        ClassCrc: RoomClass,
        Bits: Encoded.Bits,
        Values: Encoded.Values,
        FlagCount: FieldsFor(Generation).length,
    });
    return ObjectFrame.Build({
        PacketId: ObjectDataPacket,
        ConnectionId: null,
        ObjectId: State.ObjectId,
        ClassCrc: RoomClass,
        Payload,
        Layout: ObjectFrame.Layout.Nineteen,
    });
}

function PublishRoomState(Connection, Key, State, SeenVersion = 0n) {
    if (IsRoomClosed(Connection)) return { Frame: null, Sent: 0 };
    const Seen = BigInt(SeenVersion || 0n);
    State.Version = (Seen > State.Version ? Seen : State.Version) + 1n;
    const Frame = BuildRoomFrame(State);
    Rooms.set(Key, {
        Frame: Frame,
        Generation: State.Generation || '2K19',
        Source: State.Source,
        ObjectId: State.ObjectId,
        ActivityKey: State.ActivityKey,
        RoomScope: State.RoomScope || null,
    });
    let Sent = Connection.SendObject(Frame) ? 1 : 0;
    for (const Peer of Roster.Peers(Connection)) {
        if (IsMyCourt(Peer) && !IsRoomClosed(Peer) && PlayerBody.GenerationForConnection(Peer) === (State.Generation || '2K19') && Peer.SendObject(Frame)) Sent++;
    }
    return { Frame: Frame, Sent: Sent };
}

function RepublishRoom(Connection, ObjectId) {
    if (!IsMyCourt(Connection)) return null;
    if (IsRoomClosed(Connection)) { PublishClosedRoom(Connection); return null; }
    const Key = RoomKey(Connection, ObjectId);
    const State = RoomStates.get(Key);
    if (!State || State.Generation !== PlayerBody.GenerationForConnection(Connection)) return null;
    // Complete a rejected command without changing ownership, game state or blobs.
    const Out = PublishRoomState(Connection, Key, State);
    return { ObjectId: State.ObjectId, Version: State.Version, Sent: Out.Sent, Frame: Out.Frame };
}

function StartCribGame(Connection, ObjectId, Game) {
    if (!IsMyCourt(Connection) || IsRoomClosed(Connection)) return null;
    if (
        (ObjectId === null || ObjectId === undefined) &&
        (Connection.SessionId === null || Connection.SessionId === undefined)
    )
        return null;
    const { Key, State } = RoomStateFor(Connection, ObjectId);
    State.Fields.State = CribState.Scrimmage;
    State.Fields.GameType = Number(Game.GameSlot) >>> 0;
    // NBA2K22 FUN_14161E460 checks this room list (+0xB1/+0xC0) to reject
    // visitors. It is not the game roster; preserve it across start and end.
    if (PlayerBody.GenerationForConnection(Connection) !== '2K22') {
        const Players = (Game.Players || []).slice(0, 6).map((Player) => BigInt(Player));
        State.Fields.RelatedCount = Players.length;
        for (let Index = 0; Index < 6; Index++) {
            State.Fields[`RelatedId${Index}`] = Index < Players.length ? Players[Index] : 0n;
        }
    }
    const Out = PublishRoomState(Connection, Key, State);
    return { ObjectId: State.ObjectId, Version: State.Version, Sent: Out.Sent, Frame: Out.Frame };
}

function EndCribGame(Connection, ObjectId) {
    if (!IsMyCourt(Connection) || IsRoomClosed(Connection)) return null;
    if (
        (ObjectId === null || ObjectId === undefined) &&
        (Connection.SessionId === null || Connection.SessionId === undefined)
    )
        return null;
    const { Key, State } = RoomStateFor(Connection, ObjectId);
    State.Fields.State = CribState.None;
    if (PlayerBody.GenerationForConnection(Connection) !== '2K22') {
        State.Fields.RelatedCount = 0;
        for (let Index = 0; Index < 6; Index++) State.Fields[`RelatedId${Index}`] = 0n;
    }
    const Out = PublishRoomState(Connection, Key, State);
    return { ObjectId: State.ObjectId, Version: State.Version, Sent: Out.Sent, Frame: Out.Frame };
}

function Relay(Connection, Bytes, PacketId = null) {
    if (!Buffer.isBuffer(Bytes)) return false;
    const Id = PacketId === null ? (Bytes.length >= 8 ? Bytes.readUInt32BE(4) >>> 0 : null) : Number(PacketId) >>> 0;
    if (!IsMyCourt(Connection) || Id === null || !IsRoomPacket(Id)) {
        return false;
    }
    const Generation = PlayerBody.GenerationForConnection(Connection);
    const Schema = FieldsFor(Generation);
    const Packet = PacketRoom(Bytes, Id, Generation);
    if (!Packet) return false;
    const Parsed = Packet.Parsed;
    if (Generation === '2K22' && Id === ObjectUpdatePacket && !Packet.List && Parsed.Layout === ObjectFrame.Layout.Player) {
        const RequestId = Bytes.readBigUInt64BE(16);
        if (RequestId !== 0n && !Connection.Closed) Connection.Send(Requests.Build(RequestId));
    }
    if (IsRoomClosed(Connection)) {
        PublishClosedRoom(Connection, Packet.List ? null : Parsed.ObjectId, Parsed.Version || 0n);
        return true;
    }

    if (Generation === '2K22' && IsGuest(Connection)) {
        // A visitor can upload their own saved customization on entry. Do not
        // merge it into the host's room; complete updates with authoritative data.
        PublishBootstrap(Connection);
        if (!Packet.List) {
            const State = RoomStates.get(RoomKey(Connection, Parsed.ObjectId));
            if (State && State.Generation === Generation) {
                PublishRoomState(Connection, RoomKey(Connection, Parsed.ObjectId), State, Parsed.Version);
            } else {
                ReplayTo(Connection);
            }
        } else {
            ReplayTo(Connection);
        }
        return true;
    }

    if ((Id === ObjectUpdatePacket || Id === LegacyObjectUpdatePacket) && !Packet.List) {
        const { Key, State } = RoomStateFor(Connection, Parsed.ObjectId);
        Object.assign(State.Fields, Parsed.Room.Fields);
        State.Generation = Generation;
        if (Generation === '2K22') State.NativeHost = Connection;
        const Out = PublishRoomState(Connection, Key, State, Parsed.Version);
        const Names = Parsed.Flags.map((Bit) => Schema[Bit].Name);
        Log.Info(
            `${Connection.Identifier} updated MyCourt room ${Parsed.ObjectId.toString(16).toUpperCase()} ` +
                `(${Names.length ? Names.join(', ') : 'no fields'}); answered at revision ${State.Version} ` +
                `to ${Out.Sent} ${Out.Sent === 1 ? 'player' : 'players'}`,
        );
        return true;
    }

    // Keep the native snapshot for later partial updates without discarding
    // cloud-save IDs, stadium blocks or guest data supplied by the client.
    CacheRoomState(Connection, Packet, Generation);
    const Key = RoomKey(Connection, Parsed.ObjectId);
    Rooms.set(Key, {
        Frame: Buffer.from(Bytes),
        Generation,
        Source: Connection.Id,
        ObjectId: Parsed.ObjectId,
        ActivityKey:
            Connection.ActivityKey === null || Connection.ActivityKey === undefined
                ? null
                : Connection.ActivityKey >>> 0,
        RoomScope: Connection.RoomScope || null,
    });

    let Sent = Connection.SendObject(Bytes) ? 1 : 0;
    for (const Peer of Roster.Peers(Connection)) {
        if (IsMyCourt(Peer) && !IsRoomClosed(Peer) && PlayerBody.GenerationForConnection(Peer) === Generation && Peer.SendObject(Bytes)) Sent++;
    }
    const ObjectLabel = Packet.List
        ? 'object list containing room state'
        : `room object ${Parsed.ObjectId.toString(16).toUpperCase()}`;
    Log.Info(
        `${Connection.Identifier} published MyCourt ${ObjectLabel} ` +
            `(${Bytes.length} bytes) to ${Sent} ${Sent === 1 ? 'player' : 'players'}`,
    );
    if (Packet.List) {
        Log.Verbose(
            `  ${Parsed.RoomList.Count} native room record${Parsed.RoomList.Count === 1 ? '' : 's'} ` +
                `validated in the compact ${Generation} object-list layout`,
        );
    } else {
        const Names = Parsed.Flags.map((Bit) => Schema[Bit].Name);
        const Owner = Parsed.Room.Fields.OwnerId;
        const Related = Parsed.Room.Fields.RelatedCount;
        const Userdata = Parsed.Room.Fields.UserDataCount;
        Log.Verbose(
            `  room revision ${Parsed.Version.toString()}, ${Parsed.Flags.length}/${Schema.length} fields present` +
                `${Owner === undefined ? '' : `, owner ${Owner}`}` +
                `${Related === undefined ? '' : `, related ${Related}`}` +
                `${Userdata === undefined ? '' : `, userdata ${Userdata.toString()}`}` +
                `${Names.length ? `: ${Names.join(', ')}` : ''}`,
        );
    }
    return true;
}

function PublishTemplate(Connection) {
    if (!IsMyCourt(Connection) || Connection.State !== 2) return false;
    if (IsRoomClosed(Connection)) return PublishClosedRoom(Connection) > 0;
    if (IsGuest(Connection)) return ReplayTo(Connection) > 0;
    const Frame = RoomTemplate();
    if (!Frame) return false;
    const PacketId = Frame.readUInt32BE(4) >>> 0;
    const Generation = PlayerBody.GenerationForConnection(Connection);
    const Packet = PacketRoom(Frame, PacketId, Generation);
    if (!Packet) return false;
    const Parsed = Packet.Parsed;
    CacheRoomState(Connection, Packet, Generation, false);
    Rooms.set(RoomKey(Connection, Parsed.ObjectId), {
        Frame: Buffer.from(Frame),
        Generation,
        Source: 'template',
        ObjectId: Parsed.ObjectId,
        ActivityKey:
            Connection.ActivityKey === null || Connection.ActivityKey === undefined
                ? null
                : Connection.ActivityKey >>> 0,
        RoomScope: Connection.RoomScope || null,
    });
    let Sent = Connection.SendObject(Frame) ? 1 : 0;
    for (const Peer of Roster.Peers(Connection)) {
        if (IsMyCourt(Peer) && !IsRoomClosed(Peer) && PlayerBody.GenerationForConnection(Peer) === Generation && Peer.SendObject(Frame)) Sent++;
    }
    Log.Info(
        `${Connection.Identifier} received MyCourt room template (${Frame.length} bytes), ` +
            `sent to ${Sent} ${Sent === 1 ? 'player' : 'players'}`,
    );
    return Sent > 0;
}

function ReplayTo(Connection) {
    if (!IsMyCourt(Connection)) return 0;
    if (IsRoomClosed(Connection)) return PublishClosedRoom(Connection);
    let Sent = 0;
    const ActivityKey =
        Connection.ActivityKey === null || Connection.ActivityKey === undefined ? null : Connection.ActivityKey >>> 0;
    for (const Room of Rooms.values()) {
        if (Room.ActivityKey !== ActivityKey) continue;
        if ((Room.RoomScope || null) !== (Connection.RoomScope || null)) continue;
        if ((Room.Generation || '2K19') !== PlayerBody.GenerationForConnection(Connection)) continue;
        if (Connection.SendObject(Room.Frame)) Sent++;
    }
    if (Sent) Log.Verbose(`  ${Connection.Identifier} received ${Sent} MyCourt room object${Sent === 1 ? '' : 's'}`);
    return Sent;
}

function ClearConnection(Connection) {
    if (Connection.MyCourtBootstrapTimer) {
        clearTimeout(Connection.MyCourtBootstrapTimer);
        Connection.MyCourtBootstrapTimer = null;
    }
    // A delayed close from the old connection must not close a re-entered room.
    if (IsRoomClosed(Connection)) return;
    const Generation = PlayerBody.GenerationForConnection(Connection);
    const Scope = Generation === '2K22' ? Connection.RoomScope || null : null;
    const Peers = Roster.Peers(Connection).filter((Peer) =>
        IsMyCourt(Peer) && !IsRoomClosed(Peer) && PlayerBody.GenerationForConnection(Peer) === Generation);
    const BelongsToRoom = (Room) => Scope
        ? Room.RoomScope === Scope && Room.ActivityKey === Connection.ActivityKey &&
          (Room.Generation || '2K19') === Generation
        : Room.Source === Connection.Id;
    const OwnerLeft = Scope && Scope === RoomScopeFor(Connection) && !IsGuest(Connection) &&
        Connection.Puid !== null && Connection.Puid !== undefined;
    if (OwnerLeft) {
        // Finish before revoking membership, so the final COURT/PLAYER updates
        // still reach every human. Normal match end does not enter this path.
        require('./Shootaround').CloseRoom(Connection);
        const States = [...RoomStates.values()].filter(BelongsToRoom);
        let Notified = 0;
        for (const Member of [Connection, ...Peers]) {
            if (Member.MyCourtBootstrapTimer) {
                clearTimeout(Member.MyCourtBootstrapTimer);
                Member.MyCourtBootstrapTimer = null;
            }
            const Records = new Map(States.map((State) =>
                [State.ObjectId, { ObjectId: State.ObjectId, Version: State.Version }]));
            if (!Records.size && Member.SessionId !== null && Member.SessionId !== undefined) {
                const ObjectId = SessionObjectId(Member.SessionId);
                Records.set(ObjectId, { ObjectId, Version: 1n });
            }
            ClosedRooms.set(Member, { ActivityKey: Member.ActivityKey, RoomScope: Scope, Records });
            if (Member !== Connection && PublishClosedRoom(Member)) Notified++;
            // Keep the socket available for native travel, but not in the old
            // room's roster, identity consensus, or a newly entered host room.
            Roster.Remove(Member);
        }
        Log.Info(`MyCourt owner ${Connection.Identifier} left; room closed for ${Notified}/${Peers.length} visitors @ ${Log.Clock()}`);
    } else if (Scope && Peers.length) {
        return;
    }
    for (const [Key, Room] of Rooms) {
        if (BelongsToRoom(Room)) Rooms.delete(Key);
    }
    for (const [Key, State] of RoomStates) {
        if (BelongsToRoom(State)) RoomStates.delete(Key);
    }
}

module.exports = {
    OwnerFor,
    RoomScopeFor,
    RelayTokenFor,
    RoomClass,
    RoomClassSize,
    RoomRuntime,
    RoomFields,
    RoomFields2K22,
    FieldsFor,
    ObjectDataPacket,
    ObjectDataListPacket,
    ObjectUpdatePacket,
    LegacyObjectUpdatePacket,
    RoomObjectIndex,
    BootstrapDelayMs,
    InitialWorldTime,
    InitialState,
    Rooms,
    IsMyCourt,
    IsRoomPacket,
    ParseRoom,
    ListContainsRoom,
    DecodeRoom,
    DecodeRoomPayload,
    ParseRoomList,
    ExtractTemplateFrame,
    RoomTemplate,
    PublishTemplate,
    SessionObjectId,
    BuildBootstrap,
    PublishBootstrap,
    ScheduleBootstrap,
    Relay,
    ReplayTo,
    ClearConnection,
    IsRoomClosed,
    ResetConnection,
    PublishClosedRoom,
    RoomStates,
    CribState,
    EncodeRoom,
    RoomStateFor,
    BuildRoomFrame,
    PublishRoomState,
    RepublishRoom,
    StartCribGame,
    EndCribGame,
};
