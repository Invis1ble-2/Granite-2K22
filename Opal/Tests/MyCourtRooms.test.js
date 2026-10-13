// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Log = require('../Source/Core/Log');
const { Crc } = require('../Source/Core/Names');
const FieldList = require('../Source/Codec/FieldList');
const Frame = require('../Source/Codec/Frame');
const ObjectFrame = require('../Source/Codec/ObjectFrame');
const WebSocket = require('../Source/Net/Websocket');
const Roster = require('../Source/Protocol/Roster');
const MyCourt = require('../Source/Protocol/MyCourt');
const Squad = require('../Source/Protocol/Squad');
const { Connection, State, OnConnect } = require('../Source/Protocol/Connection');

Log.SetLevel(Log.Level.Error);

const CapturedMatchType = 0x0ad66d71ca210651n;

function FakeSocket(Sink) {
    return { destroyed: false, localAddress: '127.0.0.1', write: (B) => Sink.push(B), end() {}, destroy() {} };
}

function MyCourtConnect(Puid) {
    const Body = new FieldList.Builder()
        .AddU64('MATCH_TYPE', CapturedMatchType)
        .AddU64('USER_ID_LIST', Puid)
        .AddU32(0x4b7ad8c3, 0xfeac4070)
        .AddU32('LOCATION', Crc('CRIB'))
        .Build();
    return Frame.Build(0x9d32c5b4, Buffer.alloc(8), Body, Frame.InnerHeader.None);
}

function Enter(Puid, Sink) {
    const C = new Connection(FakeSocket(Sink), {}, 20054);
    const FrameData = MyCourtConnect(Puid);
    OnConnect(C, Frame.Parse(FrameData), FrameData);
    return C;
}

function Payloads(Sink) {
    const Out = [];
    for (const Wire of Sink) for (const M of WebSocket.Decode(Wire).Messages) Out.push(M.Payload);
    return Out;
}

function Inits(Sink) {
    return Payloads(Sink).filter((P) => P.length >= 8 && P.readUInt32BE(4) === 0x9d32c5b4);
}

function Token(Init) {
    const List = FieldList.Parse(Init, Frame.HeaderSize);
    const Reference = FieldList.Find(List, 0xae6eea84);
    Assert.ok(Reference, 'the init reply names its relay token');
    const Data = List.Payload.subarray(List.DataOffset);
    return Data.subarray(Reference.Data1 >>> 0, (Reference.Data1 >>> 0) + (Reference.Data2 >>> 0));
}

Test('two players entering MyCourt get separate rooms, rosters and relay tokens', (T) => {
    Roster.Players.clear();
    MyCourt.Rooms.clear();
    MyCourt.RoomStates.clear();
    T.after(() => {
        Roster.Players.clear();
        MyCourt.Rooms.clear();
        MyCourt.RoomStates.clear();
    });
    const First = [],
        Second = [];
    const A = Enter(0x0110000100000001n, First);
    const B = Enter(0x0110000100000002n, Second);

    Assert.equal(A.State, State.Active);
    Assert.equal(B.State, State.Active);
    Assert.equal(A.ActivityName, 'mycourt');
    Assert.notEqual(A.RoomScope, B.RoomScope);
    Assert.deepEqual(Roster.Peers(A), [], 'nobody else is in the first court');
    Assert.deepEqual(Roster.Peers(B), [], 'nobody else is in the second court');

    const AInits = Inits(First);
    const BInits = Inits(Second);
    Assert.equal(AInits.length, 1, 'the first player is not re-sent a roster when the second enters their own court');
    for (const [Init, Puid] of [
        [AInits[0], 0x0110000100000001n],
        [BInits[0], 0x0110000100000002n],
    ]) {
        const Users = FieldList.Parse(Init, Frame.HeaderSize).Fields.filter((F) => F.Crc === Crc('USER_ID_LIST'));
        Assert.deepEqual(
            Users.map((F) => F.Value),
            [Puid],
            'each roster names only its owner',
        );
    }
    Assert.ok(!Token(AInits[0]).equals(Token(BInits[0])), 'the relay groups the two courts separately');
    Assert.equal(Token(AInits[0]).length, 16);
});

Test('a room object from one court never reaches another court', (T) => {
    Roster.Players.clear();
    MyCourt.Rooms.clear();
    T.after(() => {
        Roster.Players.clear();
        MyCourt.Rooms.clear();
    });
    const First = [],
        Second = [];
    const A = Enter(0x0110000100000011n, First);
    const B = Enter(0x0110000100000012n, Second);
    const Payload = ObjectFrame.BuildPayload({
        key: 0xaa01n,
        version: 1n,
        ClassCrc: MyCourt.RoomClass,
        Bits: [],
        Values: Buffer.alloc(0),
    });
    const Room = ObjectFrame.Build({
        PacketId: MyCourt.ObjectDataPacket,
        ConnectionId: null,
        ObjectId: 0xaa01n,
        ClassCrc: MyCourt.RoomClass,
        Payload,
        Layout: ObjectFrame.Layout.Nineteen,
    });
    Second.length = 0;

    Assert.ok(MyCourt.Relay(A, Room, MyCourt.ObjectDataPacket));
    Assert.equal(Payloads(Second).filter((P) => P.equals(Room)).length, 0, 'the other owner did not receive it');
    Assert.equal(MyCourt.ReplayTo(B), 0, 'and it is not replayed into their court');
    Assert.equal(MyCourt.ReplayTo(A), 1, 'the owner still gets their own room back');
});

Test('the same player reconnecting lands in the same court', (T) => {
    Roster.Players.clear();
    T.after(() => {
        Roster.Players.clear();
        Squad.Reset();
    });
    const A = Enter(0x0110000100000021n, []);
    const Scope = A.RoomScope;
    A.Close('test');
    const Again = Enter(0x0110000100000021n, []);
    Assert.equal(Again.RoomScope, Scope);
});

function RoomState22(Fields = {}) {
    return {
        ObjectId: 0xaa01n, Version: 1n, Generation: '2K22',
        Fields: {
            WorldTime: MyCourt.InitialWorldTime, OwnerId: 0x0110000100000061n,
            State: MyCourt.InitialState, IsValid: 1,
            Customization: Buffer.alloc(0x12fc, 7), PlayerState: Buffer.alloc(0xae0, 8),
            UserDataCount: 1n, UserDataId0: 81n, UserData0: Buffer.from([1, 2, 3, 4]),
            OwnerCloudSaveId: 0x1122334455667788n,
            ...Fields,
        },
    };
}

function RoomUpdate22(State, RequestId) {
    const Encoded = MyCourt.EncodeRoom(State.Fields, '2K22');
    const Payload = ObjectFrame.BuildPayload({
        key: State.ObjectId, version: State.Version, ClassCrc: MyCourt.RoomClass,
        Bits: Encoded.Bits, Values: Encoded.Values, FlagCount: 30,
    });
    const Bytes = ObjectFrame.Build({
        PacketId: MyCourt.ObjectUpdatePacket, ObjectId: State.ObjectId,
        ClassCrc: MyCourt.RoomClass, Payload, Layout: ObjectFrame.Layout.Player,
    });
    Bytes.writeBigUInt64BE(RequestId, 16);
    return Bytes;
}

Test('2K22 room blocks and cloud-save ID use a distinct schema; legacy stays strict', () => {
    const State = RoomState22();
    const Bytes = MyCourt.BuildRoomFrame(State);
    const Parsed = MyCourt.ParseRoom(Bytes, '2K22');
    Assert.equal(Parsed.FlagCount, 30);
    Assert.equal(Parsed.Room.Fields.OwnerCloudSaveId, State.Fields.OwnerCloudSaveId);
    Assert.deepEqual(Parsed.Room.Fields.Customization, State.Fields.Customization);
    Assert.deepEqual(Parsed.Room.Fields.PlayerState, State.Fields.PlayerState);
    Assert.deepEqual(Parsed.Room.Fields.UserData0, State.Fields.UserData0);
    Assert.equal(MyCourt.ParseRoom(Bytes), null, 'legacy parser must not silently accept bit 29');
    Assert.throws(() => MyCourt.EncodeRoom(State.Fields), /invalid 2K19/);
    Assert.throws(() => MyCourt.EncodeRoom({ Customization: Buffer.alloc(4856) }, '2K22'), /invalid 2K22/);
    Assert.throws(() => MyCourt.EncodeRoom({ PlayerState: Buffer.alloc(2712) }, '2K22'), /invalid 2K22/);
    const Invalid = Buffer.from(Bytes);
    Invalid[32 + 19] |= 2;
    Assert.equal(MyCourt.ParseRoom(Invalid, '2K22'), null, 'reserved bitmap bits are rejected');
    Assert.equal(MyCourt.ParseRoom(Bytes.subarray(0, Bytes.length - 1), '2K22'), null);
});

Test('2K22 bootstrap preserves the compatible minimal ownership bytes', () => {
    const C = { Puid: 0x0110000100000061n, SessionId: 1008n };
    const Legacy = MyCourt.BuildBootstrap(C);
    const Modern = MyCourt.BuildBootstrap({ ...C, ProtocolGeneration: '2K22' });
    Assert.deepEqual(Modern, Legacy);
    const Parsed = MyCourt.ParseRoom(Modern, '2K22');
    Assert.equal(Parsed.FlagCount, 30);
    Assert.deepEqual(Parsed.Flags, [0, 1, 2]);
    Assert.equal(Parsed.Room.Fields.OwnerId, C.Puid);
    Assert.equal(Parsed.Room.Fields.OwnerCloudSaveId, undefined, 'do not invent a cloud-save ID');
});

Test('2K22 room updates ACK the complete request ID and retain native fields on partial updates', (T) => {
    Roster.Players.clear();
    MyCourt.Rooms.clear();
    MyCourt.RoomStates.clear();
    T.after(() => { Roster.Players.clear(); MyCourt.Rooms.clear(); MyCourt.RoomStates.clear(); });
    const Sent = [], Objects = [];
    const C = {
        Id: 9201, State: 2, Closed: false, ProtocolGeneration: '2K22',
        ActivityName: 'mycourt', ActivityKey: 0xfeac4070, RoomScope: 'mycourt:owner22',
        Puid: 0x0110000100000061n, SessionId: 1008n, Identifier: 'owner22',
        Send: (B) => (Sent.push(B), true), SendObject: (B) => (Objects.push(B), true),
    };
    Roster.Add(C);
    const State = RoomState22();
    State.ObjectId = MyCourt.SessionObjectId(C.SessionId);
    Assert.ok(MyCourt.Relay(C, MyCourt.BuildRoomFrame(State)), 'cache the full initial snapshot');
    Assert.equal(MyCourt.PublishBootstrap(C), false, 'late bootstrap cannot replace native ownership');
    Assert.equal(Objects.length, 1, 'the native snapshot was not overwritten by another frame');
    Assert.equal(MyCourt.RoomStateFor(C, State.ObjectId).State.Version, 1n);
    const RequestId = 0x0102030405060781n;
    const Partial = { ...State, Version: 8n, Fields: { IsValid: 1, State: MyCourt.CribState.Scrimmage } };
    const Req = RoomUpdate22(Partial, RequestId);
    Assert.ok(MyCourt.Relay(C, Req));
    Assert.equal(Sent.length, 1);
    Assert.equal(Sent[0].readBigUInt64BE(16), RequestId, 'do not truncate the high half or assume IDs 1..16');
    const Reply = MyCourt.ParseRoom(Objects.at(-1), '2K22');
    Assert.equal(Reply.Version, 9n);
    Assert.equal(Reply.Room.Fields.State, MyCourt.CribState.Scrimmage);
    Assert.equal(Reply.Room.Fields.OwnerCloudSaveId, State.Fields.OwnerCloudSaveId);
    Assert.deepEqual(Reply.Room.Fields.Customization, State.Fields.Customization);
    Assert.deepEqual(Reply.Room.Fields.PlayerState, State.Fields.PlayerState);
    Assert.deepEqual(Reply.Room.Fields.UserData0, State.Fields.UserData0);
    Assert.equal(MyCourt.Relay(C, Req.subarray(0, Req.length - 1)), false);
    Assert.equal(Sent.length, 1, 'malformed requests are not ACKed');
    Assert.equal(MyCourt.ReplayTo({ ...C, Id: 9202, ProtocolGeneration: '2K19' }), 0,
        'a legacy connection cannot receive the cached modern room');
});

Test('a MyCourt connection inherits only a known unambiguous PLAYER generation for the same PUID', (T) => {
    Roster.Players.clear();
    const Puid = 0x0110000100000071n;
    Roster.Add({ Id: -1, State: 2, Closed: false, Puid, ProtocolGeneration: '2K22', ActivityKey: 0x3cf672c2 });
    const C = Enter(Puid, []);
    T.after(() => { C.Close('test'); Roster.Players.clear(); MyCourt.Rooms.clear(); MyCourt.RoomStates.clear(); });
    Assert.equal(C.ProtocolGeneration, '2K22');
    Assert.ok(MyCourt.PublishBootstrap(C));
    Assert.equal(MyCourt.RoomStates.values().next().value.Generation, '2K22');
});

Test('a 2K22 template supplies the field cache and revision for subsequent partial replies', (T) => {
    const Fs = require('node:fs');
    const OriginalRead = Fs.readFileSync;
    const Previous = process.env.OPAL_MYCOURT_ROOM_FRAME;
    const State = RoomState22();
    State.Version = 12n;
    const Template = MyCourt.BuildRoomFrame(State);
    process.env.OPAL_MYCOURT_ROOM_FRAME = 'mycourt-2k22-fixture.bin';
    T.mock.method(Fs, 'readFileSync', (Path, ...Args) =>
        Path === 'mycourt-2k22-fixture.bin' ? Template : OriginalRead(Path, ...Args));
    Roster.Players.clear(); MyCourt.Rooms.clear(); MyCourt.RoomStates.clear();
    T.after(() => {
        if (Previous === undefined) delete process.env.OPAL_MYCOURT_ROOM_FRAME;
        else process.env.OPAL_MYCOURT_ROOM_FRAME = Previous;
        Roster.Players.clear(); MyCourt.Rooms.clear(); MyCourt.RoomStates.clear();
    });
    const Objects = [];
    const C = {
        Id: 9301, State: 2, Closed: false, ProtocolGeneration: '2K22',
        ActivityName: 'mycourt', ActivityKey: 0xfeac4070, RoomScope: 'mycourt:template22',
        Identifier: 'template22', Send: () => true, SendObject: (B) => (Objects.push(B), true),
    };
    Assert.ok(MyCourt.PublishTemplate(C));
    Assert.ok(MyCourt.Relay(C, RoomUpdate22({ ...State, Version: 12n, Fields: { IsValid: 1 } }, 17n)));
    const Reply = MyCourt.ParseRoom(Objects.at(-1), '2K22');
    Assert.equal(Reply.Version, 13n);
    Assert.equal(Reply.Room.Fields.OwnerCloudSaveId, State.Fields.OwnerCloudSaveId);
    Assert.deepEqual(Reply.Room.Fields.Customization, State.Fields.Customization);
    Assert.deepEqual(Reply.Room.Fields.PlayerState, State.Fields.PlayerState);
});
