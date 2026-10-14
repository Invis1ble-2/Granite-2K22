// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const FieldList = require('../Source/Codec/FieldList');
const Frame = require('../Source/Codec/Frame');
const ObjectFrame = require('../Source/Codec/ObjectFrame');
const Shootaround = require('../Source/Protocol/Shootaround');
const MyCourt = require('../Source/Protocol/MyCourt');
const PlayerBody = require('../Source/Protocol/PlayerBody');
const PlayerBody2K22 = require('../Source/Protocol/PlayerBody2K22');
const CourtLayout2K22 = require('../Source/Protocol/CourtLayout2K22');
const Requests = require('../Source/Protocol/Requests');

let Passed = 0;
function Test(Name, Fn) {
    try {
        Fn();
        Passed++;
        process.stdout.write(`\x1b[38;5;39m  pass  ${Name}\x1b[0m\n`);
    } catch (E) {
        process.stdout.write(`\x1b[38;5;203m  FAIL  ${Name}\n        ${E.message}\x1b[0m\n`);
        process.exitCode = 1;
    }
}

function BuildShootaround() {
    return new FieldList.Builder()
        .AddU64(0x07bc2a56, 0n)
        .AddU64(0x190bbdbc, 0x01100001349dd023n)
        .AddU64(0xa8357302, 1n)
        .AddU32('COMMAND', Shootaround.Command)
        .AddU64(0xba4bba9d, 0n)
        .Build();
}

const LiveStartCribGame =
    '84000000ce148fb1fb680000000000000000000000000004000003f0000d4d0600000060' +
    '07bc2a563d9e50890000000000000000190bbdbc3d9e508901100001349dd023' +
    'a83573023d9e50890000000000000001b18f14ce1423add2ab153d7ef47f0000' +
    'ba4bba9d3d9e5089000000000000000000000000000000000000000000000000';

function MyCourtConnection(Id, Puid) {
    const Sent = [];
    const Acks = [];
    const Events = [];
    return {
        Sent,
        Acks,
        Events,
        Connection: {
            Id: Id,
            State: 2,
            Closed: false,
            Identifier: Puid.toString(16).toUpperCase(),
            ActivityName: 'mycourt',
            ActivityKey: 0xfeac4070,
            Puid: Puid,
            SessionId: 0x3f0n,
            MyCourtBootstrapSent: false,
            MyCourtBootstrapTimer: null,
            Send(FrameData) {
                Acks.push(FrameData);
                Events.push('ack');
                return true;
            },
            SendObject(FrameData) {
                Sent.push(FrameData);
                Events.push('object');
                return true;
            },
        },
    };
}

Test('shootaround command value is the live 2K19 value', () => {
    Assert.strictEqual(Shootaround.Command >>> 0, 0xab153d7e);
});

Test('live-shaped shootaround frame is recognized', () => {
    const Body = BuildShootaround();
    const FrameData = Frame.Build(0xce148fb1, Buffer.alloc(8), Body, Frame.InnerHeader.None);
    const Req = Shootaround.Read(FrameData);
    Assert.ok(Req, 'recognized');
    Assert.strictEqual(Req.Fields, 5);
    Assert.strictEqual(Req.PlayerCount, 1n);
    Assert.strictEqual(Req.SoloFlag, 0n);
    Assert.strictEqual(Req.GameSlot, 0n);
    Assert.strictEqual(Req.Players.length, 1);
    Assert.strictEqual(Req.Players[0], 0x01100001349dd023n);
});

Test('non-shootaround commands are ignored', () => {
    const Body = new FieldList.Builder().AddU32('COMMAND', 0x5bb78c48).AddU32('LOCATION', 0x19b63986).Build();
    const FrameData = Frame.Build(0xce148fb1, Buffer.alloc(8), Body, Frame.InnerHeader.None);
    Assert.strictEqual(Shootaround.Read(FrameData), null);
});

Test('shootaround outside mycourt is not handled', () => {
    const Body = BuildShootaround();
    const FrameData = Frame.Build(0xce148fb1, Buffer.alloc(8), Body, Frame.InnerHeader.None);
    const Connection = { Identifier: 'test', ActivityName: 'neighborhood' };
    Assert.strictEqual(MyCourt.IsMyCourt(Connection), false);
    Assert.strictEqual(Shootaround.Handle(Connection, FrameData), false);
});

function BuildPlayerBody(Puid) {
    const Body = Buffer.alloc(35 + 404);
    Body.writeBigUInt64BE(Puid, 0);
    Body.writeBigUInt64BE(1n, 8);
    Body.fill(0xff, 16, 35);
    Body.writeUInt32LE(0x9705bb0d, 51);
    return Body;
}

Test('START_CRIB_GAME sends a SHOOTAROUND court, the player PLAYING on it, then the room SCRIMMAGE', () => {
    const Live = Buffer.from(LiveStartCribGame, 'hex');
    Assert.strictEqual(Live.length, 132);
    const Puid = 0x01100001349dd023n;
    const { Sent, Connection } = MyCourtConnection(7001, Puid);
    Connection.PlayerBody = BuildPlayerBody(Puid);
    Connection.PlayerRevision = 1n;
    MyCourt.Rooms.clear();
    Assert.ok(MyCourt.PublishBootstrap(Connection));

    Assert.strictEqual(Shootaround.Handle(Connection, Live), true);
    Assert.strictEqual(Sent.length, 4, 'bootstrap, then the court, then the player, then the room');

    const Court = Sent[1];
    Assert.strictEqual(Court.readUInt32BE(4), MyCourt.ObjectDataPacket);
    Assert.strictEqual(Court.readUInt32BE(24), 0x2c4d49e3, 'COURT class');
    Assert.strictEqual(Court.readBigUInt64BE(16), 0x000003f0000d4d10n, 'same session as the room, own index');
    const Payload = Court.subarray(32, 32 + Court.readUInt32BE(28));
    Assert.strictEqual(Payload.readBigUInt64BE(0), 0x000003f0000d4d10n);
    const Bits = ObjectFrame.ReadFlags(Payload, 16, Shootaround.CourtFlags);
    Assert.deepStrictEqual(Bits, [0, 2, 11, 12, 15, 37, 38]);
    const Values = Payload.subarray(16 + 15);
    Assert.strictEqual(Values.readUInt32LE(0), 29, 'type SHOOTAROUND');
    Assert.strictEqual(Values.readUInt32LE(4), 0x000d4d10, 'court id');
    Assert.strictEqual(Values[8], 0, 'setup gate byte');
    Assert.strictEqual(Values.readBigUInt64LE(9), 0x000003f0000d4d10n, 'match id');
    Assert.strictEqual(Values[17], 0, 'second team size');
    Assert.strictEqual(Values[18], 1, 'first team size');
    Assert.strictEqual(Values.readBigUInt64LE(19), Puid, 'the requester is on the first team');
    Assert.strictEqual(Values.length, 27);

    Assert.strictEqual(Sent[2].readUInt32BE(24), 0x2c5d2702, 'then the player object');
    Assert.strictEqual(Sent[2].readUInt32LE(32 + 51), 0xecbccdf8, 'PLAYER field 2 = PLAYING');
    Assert.strictEqual(Sent[2].readUInt32LE(32 + 55), 0x000d4d10, 'PLAYER field 3 = the court id');
    Assert.strictEqual(Connection.PlayerBody.readUInt32LE(51), 0xecbccdf8);

    const Room = MyCourt.ParseRoom(Sent[3]);
    Assert.ok(Room, 'then a complete room OBJECT_DATA');
    Assert.strictEqual(Room.ObjectId, 0x000003f0000d4d06n, 'the room the command named');
    Assert.strictEqual(Room.Version, 2n, 'one above the bootstrap');
    Assert.strictEqual(Room.Room.Fields.State, MyCourt.CribState.Scrimmage);
    Assert.strictEqual(Room.Room.Fields.GameType, 0);
    Assert.strictEqual(Room.Room.Fields.RelatedCount, 1);
    Assert.strictEqual(Room.Room.Fields.RelatedId0, Puid);
    Assert.strictEqual(Room.Room.Fields.RelatedId1, 0n);
    Assert.strictEqual(Room.Room.Fields.OwnerId, Puid, 'bootstrap fields are kept');

    Connection.PlayerBody = BuildPlayerBody(Puid);
    Assert.strictEqual(Shootaround.Reapply(Connection), true);
    Assert.strictEqual(Connection.PlayerBody.readUInt32LE(51), 0xecbccdf8, 'PLAYING survives a body swap');

    Assert.strictEqual(Shootaround.Release(Connection), true);
    Assert.strictEqual(Connection.PlayerBody.readUInt32LE(51), 0x9705bb0d, 'release puts WALKING back');
    Assert.strictEqual(Connection.PlayerBody.readUInt32LE(55), 0);
    MyCourt.ClearConnection(Connection);
    Assert.strictEqual(MyCourt.RoomStates.size, 0);
});

const LiveEndCommand =
    '64000000ce148fb1fb680000000000000000000000000006000003f0000d4d1000000040' +
    'b18f14ce1423add2daeafe9ef47f0000d4d9ad7d3d9e50890000000000000000' +
    'e39206951423add27037de7a0000000000000000000000000000000000000000';

Test('the end command puts the player back to WALKING, re-sends the court and clears the room', () => {
    const Puid = 0x01100001349dd023n;
    const { Sent, Connection } = MyCourtConnection(7003, Puid);
    Connection.PlayerBody = BuildPlayerBody(Puid);
    Connection.PlayerRevision = 1n;
    MyCourt.Rooms.clear();
    Assert.ok(MyCourt.PublishBootstrap(Connection));
    Assert.strictEqual(Shootaround.Handle(Connection, Buffer.from(LiveStartCribGame, 'hex')), true);
    Assert.strictEqual(Sent.length, 4);

    const End = Buffer.from(LiveEndCommand, 'hex');
    Assert.strictEqual(End.length, 100);
    const Read = Shootaround.ReadEnd(End);
    Assert.strictEqual(Read.Court, 0x000003f0000d4d10n);
    Assert.strictEqual(Read.Result, 0x7037de7a, 'WON');
    Assert.strictEqual(Shootaround.Read(End), null, 'the end command is not a start');

    Assert.strictEqual(Shootaround.Handle(Connection, End), true);
    Assert.strictEqual(Sent.length, 7, 'player, court and room');
    Assert.strictEqual(Sent[4].readUInt32BE(24), 0x2c5d2702, 'the player first');
    Assert.strictEqual(Sent[4].readUInt32LE(32 + 51), 0x9705bb0d, 'WALKING');
    Assert.strictEqual(Sent[4].readUInt32LE(32 + 55), 0, 'no game');
    Assert.strictEqual(Sent[5].readUInt32BE(24), 0x2c4d49e3, 'then the court');
    Assert.strictEqual(Sent[5].subarray(32).readBigUInt64BE(8), 2n, 'one version up, which resolves the request');
    const Room = MyCourt.ParseRoom(Sent[6]);
    Assert.ok(Room);
    Assert.strictEqual(Room.Room.Fields.State, MyCourt.CribState.None, 'room out of SCRIMMAGE');
    Assert.strictEqual(Room.Version, 3n);
    Assert.ok(!Connection.Shootaround);

    Connection.PlayerBody = BuildPlayerBody(Puid);
    Assert.strictEqual(Shootaround.Reapply(Connection), false, 'PLAYING is not re-applied after the end');

    Assert.strictEqual(Shootaround.Handle(Connection, End), true, 'a retry is answered again');
    Assert.strictEqual(Sent.length, 10);
    Assert.strictEqual(Sent[8].subarray(32).readBigUInt64BE(8), 3n);
    MyCourt.ClearConnection(Connection);
});

const LiveOneVOne =
    '94000000ce148fb1fb680000000000000000000000000008000003f0000d4d0600000070' +
    '07bc2a563d9e50890000000000000000190bbdbc3d9e508901100001349dd023' +
    '190bbdbc3d9e50891b05500bb5bbaf20a83573023d9e50890000000000000002' +
    'b18f14ce1423add2ab153d7e33002047ba4bba9d3d9e50890000000000000006' +
    '00000000000000000000000000000000';

Test('a 1v1 START_CRIB_GAME builds a ONE_V_ONE court with the requester home and the NPC away', () => {
    const Live = Buffer.from(LiveOneVOne, 'hex');
    Assert.strictEqual(Live.length, 148);
    const Puid = 0x01100001349dd023n;
    const Npc = 0x1b05500bb5bbaf20n;
    const Req = Shootaround.Read(Live);
    Assert.ok(Req);
    Assert.deepStrictEqual(Req.Players, [Puid, Npc]);
    Assert.strictEqual(Req.GameSlot, 6n);
    Assert.strictEqual(Shootaround.CourtTypeFor(Req), 6);

    const { Sent, Connection } = MyCourtConnection(7004, Puid);
    Connection.PlayerBody = BuildPlayerBody(Puid);
    Connection.PlayerRevision = 1n;
    MyCourt.Rooms.clear();
    Assert.ok(MyCourt.PublishBootstrap(Connection));
    Assert.strictEqual(Shootaround.Handle(Connection, Live), true);
    Assert.strictEqual(Sent.length, 4, 'bootstrap, court, player, room');

    const Court = Sent[1];
    Assert.strictEqual(Court.readUInt32BE(24), 0x2c4d49e3);
    const Payload = Court.subarray(32, 32 + Court.readUInt32BE(28));
    Assert.deepStrictEqual(ObjectFrame.ReadFlags(Payload, 16, Shootaround.CourtFlags), [0, 2, 11, 12, 15, 17, 37, 38]);
    const Values = Payload.subarray(16 + 15);
    Assert.strictEqual(Values.readUInt32LE(0), 6, 'type ONE_V_ONE');
    Assert.strictEqual(Values.readUInt32LE(4), 0x000d4d10, 'court id');
    Assert.strictEqual(Values[8], 0, 'setup gate byte');
    Assert.strictEqual(Values.readBigUInt64LE(9), 0x000003f0000d4d10n, 'match id');
    Assert.strictEqual(Values[17], 1, 'one away');
    Assert.strictEqual(Values.readBigUInt64LE(18), Npc, 'the NPC away (+0x130)');
    Assert.strictEqual(Values[26], 1, 'one home');
    Assert.strictEqual(Values.readBigUInt64LE(27), Puid, 'the requester home (+0x1C8)');
    Assert.strictEqual(Values.length, 35);

    Assert.strictEqual(Sent[2].readUInt32BE(24), 0x2c5d2702);
    Assert.strictEqual(Sent[2].readUInt32LE(32 + 51), 0xecbccdf8, 'the requester PLAYING');
    Assert.strictEqual(Sent[2].readUInt32LE(32 + 55), 0x000d4d10);
    const Room = MyCourt.ParseRoom(Sent[3]);
    Assert.ok(Room);
    Assert.strictEqual(Room.Room.Fields.State, MyCourt.CribState.Scrimmage);
    Assert.strictEqual(Room.Room.Fields.GameType, 6);
    Assert.strictEqual(Room.Room.Fields.RelatedCount, 2);
    Assert.strictEqual(Room.Room.Fields.RelatedId1, Npc);

    Assert.strictEqual(Shootaround.Handle(Connection, Buffer.from(LiveEndCommand, 'hex')), true);
    Assert.strictEqual(Sent.length, 7);
    const Again = Sent[5].subarray(32);
    Assert.strictEqual(Sent[5].readUInt32BE(24), 0x2c4d49e3);
    Assert.deepStrictEqual(ObjectFrame.ReadFlags(Again, 16, Shootaround.CourtFlags), [0, 2, 11, 12, 15, 17, 37, 38]);
    Assert.strictEqual(Again.subarray(31).readUInt32LE(0), 6);
    MyCourt.ClearConnection(Connection);
});

Test('a client room update with little-endian blobs and padding is answered one revision above it', () => {
    const Puid = 0x011000012a80c1a1n;
    const { Sent, Connection } = MyCourtConnection(7002, Puid);
    MyCourt.Rooms.clear();
    Assert.ok(MyCourt.PublishBootstrap(Connection));

    const Customization = Buffer.alloc(4856, 7);
    const PlayerState = Buffer.alloc(2712, 9);
    const Values = Buffer.alloc(1 + 4 + 4856 + 4 + 2712 + 595);
    Values[0] = 1;
    Values.writeUInt32LE(4856, 1);
    Customization.copy(Values, 5);
    Values.writeUInt32LE(2712, 5 + 4856);
    PlayerState.copy(Values, 9 + 4856);
    const ObjectId = 0x000003f0000d4d06n;
    const Payload = ObjectFrame.BuildPayload({
        key: ObjectId,
        version: 2n,
        ClassCrc: MyCourt.RoomClass,
        Bits: [3, 12, 13],
        Values,
    });
    const Update = ObjectFrame.Build({
        PacketId: MyCourt.ObjectUpdatePacket,
        ConnectionId: null,
        ObjectId,
        ClassCrc: MyCourt.RoomClass,
        Payload,
        Layout: ObjectFrame.Layout.Player,
    });
    Assert.strictEqual(Update.length, 8234, 'same size as the live update');

    Assert.ok(MyCourt.Relay(Connection, Update, MyCourt.ObjectUpdatePacket));
    Assert.strictEqual(Sent.length, 2);
    Assert.strictEqual(Sent[1].readUInt32BE(4), MyCourt.ObjectDataPacket, 'answered as OBJECT_DATA');
    const Reply = MyCourt.ParseRoom(Sent[1]);
    Assert.ok(Reply);
    Assert.strictEqual(Reply.Version, 3n, 'strictly above the client update');
    Assert.deepStrictEqual(Reply.Flags, [0, 1, 2, 3, 12, 13]);
    Assert.ok(Reply.Room.Fields.Customization.equals(Customization));
    Assert.ok(Reply.Room.Fields.PlayerState.equals(PlayerState));
    MyCourt.ClearConnection(Connection);
});

function BuildPlayerBody2K22(Puid, MachineId) {
    const U64 = (Value) => { const Out = Buffer.alloc(8); Out.writeBigUInt64LE(Value); return Out; };
    const Header = Buffer.alloc(37);
    Header.writeBigUInt64BE(Puid);
    Header.writeBigUInt64BE(1n, 8);
    // Deliberately omit fields 4/5; retain MiniGameId/MiniObjectId and opaque data.
    for (const Bit of [0, 1, 2, 3, 144]) Header[16 + (Bit >> 3)] |= 0x80 >> (Bit & 7);
    const Blob = Buffer.from([3, 0, 0, 0, 0xab, 0xcd, 0xef]);
    return PlayerBody.Mark(Buffer.concat([Header, U64(Puid), U64(MachineId),
        U64(0x1122334455667788n), U64(0x8877665544332211n), Blob]), '2K22');
}
function BuildStart2K22(Players, Type, Count = Players.length, RequestId = 4n, SoloFlag = 0n) {
    const Builder = new FieldList.Builder()
        .AddU64(Shootaround.Field.SoloFlag, SoloFlag)
        .AddU64(Shootaround.Field.PlayerCount, BigInt(Count))
        .AddU32('COMMAND', Shootaround.Command)
        .AddU64(Shootaround.Field.GameSlot, BigInt(Type));
    Players.forEach((Puid) => Builder.AddU64(Shootaround.Field.Player, Puid));
    const Body = Builder.Build();
    const Header = Buffer.from(Buffer.from(LiveStartCribGame, 'hex').subarray(0, 36));
    Header.writeUInt32LE(Header.length + Body.length);
    Header.writeUInt32BE(Body.length, 32);
    Header.writeBigUInt64BE(RequestId, 16);
    return Buffer.concat([Header, Body]);
}

function BuildCommand2K22(Command, ObjectId, RequestId) {
    const Body = new FieldList.Builder().AddU32('COMMAND', Command).Build();
    const Header = Buffer.from(Buffer.from(LiveStartCribGame, 'hex').subarray(0, 36));
    Header.writeUInt32LE(Header.length + Body.length);
    Header.writeBigUInt64BE(RequestId, 16);
    Header.writeBigUInt64BE(ObjectId, 24);
    Header.writeUInt32BE(Body.length, 32);
    return Buffer.concat([Header, Body]);
}

function AssertAck(Ack, RequestId) {
    Assert.strictEqual(Ack.length, 24);
    Assert.strictEqual(Ack.readUInt32BE(4), Requests.Packet);
    Assert.strictEqual(Ack.readBigUInt64BE(16), RequestId, 'the entire u64 ID, not just its low word');
}

function ModernMyCourtConnection(Id) {
    const Fixture = MyCourtConnection(Id, 0x0110000142d875e1n);
    const Connection = Fixture.Connection;
    Connection.ProtocolGeneration = '2K22';
    Connection.MachineId = 0x123456789abcdef0n;
    Connection.PlayerRevision = 1n;
    Connection.PlayerBody = BuildPlayerBody2K22(Connection.Puid, Connection.MachineId);
    return Fixture;
}

// Native menu rows 0x142432A20, counts FUN_14166F030/FUN_14166EFA0.
// The last number is the encoded Away count, not the drill's actor roles.
const MenuCases2K22 = [
    [0, 33, 1, 1, 0], [1, 49, 2, 4, 0], [2, 50, 2, 4, 0],
    [3, 51, 2, 2, 0], [4, 52, 2, 5, 0], [5, 53, 2, 5, 0],
    [6, 9, 2, 2, 1], [7, 8, 4, 4, 2], [8, 6, 6, 6, 3],
    [11, 54, 2, 5, 0], [12, 55, 1, 1, 0], [13, 58, 1, 1, 0],
    [14, 61, 3, 3, 0], [15, 56, 2, 2, 1], [16, 57, 2, 2, 1],
    [17, 59, 3, 3, 0], [18, 60, 1, 1, 0],
];

function ModePlayers2K22(Puid, Mode, Count) {
    const Ids = Array.from({ length: Count }, (_, Index) => 0x1234n + BigInt(Index));
    if (Count) Ids[Mode === 16 && Count > 1 ? 1 : 0] = Puid;
    return Ids;
}

Test('2K22 MyCourt menu modes are converted, never treated as native COURT types', () => {
    for (const [Mode, Type] of MenuCases2K22) {
        Assert.strictEqual(Shootaround.CourtTypeFor({ GameSlot: BigInt(Mode) }, '2K22'), Type);
    }
    for (const Mode of [9n, 10n, 19n, 63n, 64n, 0x100000006n]) {
        Assert.strictEqual(Shootaround.CourtTypeFor({ GameSlot: Mode }, '2K22'), null, 'unknown mode must not fall back or truncate');
    }
    Assert.strictEqual(Shootaround.CourtTypeFor({ GameSlot: 6n }), 6, 'legacy mapping unchanged');
    Assert.strictEqual(Shootaround.CourtTypeFor({ GameSlot: 0n }), 29, 'legacy default unchanged');
});

Test('2K22 every menu enforces native count boundaries and preserves every ordered ID', () => {
    const { Connection } = ModernMyCourtConnection(7030);
    for (const [Mode, Type, Min, Max, AwayCount] of MenuCases2K22) {
        for (let Count = 0; Count <= 7; Count++) {
            const Ids = ModePlayers2K22(Connection.Puid, Mode, Count);
            const Game = { GameSlot: BigInt(Mode), PlayerCount: BigInt(Count), Players: Ids, SoloFlag: 0n };
            const Checked = Shootaround.ValidateGame2K22(Connection, Game);
            const Valid = Count >= Min && Count <= Max;
            Assert.strictEqual(Checked.Ok, Valid, `menu ${Mode}, count ${Count}`);
            if (!Valid) continue;
            const Teams = Shootaround.TeamsFor(Connection, Game, Type, []);
            Assert.deepStrictEqual(Teams.Home, Ids.slice(0, Count - AwayCount));
            Assert.deepStrictEqual(Teams.Away, Ids.slice(Count - AwayCount));
            Assert.deepStrictEqual([...Teams.Home, ...Teams.Away], Ids, 'no lost, cloned or reordered IDs');
        }
    }
    for (const Mode of [6, 7, 8]) {
        const Count = Mode === 6 ? 2 : Mode === 7 ? 4 : 6;
        const Ids = ModePlayers2K22(Connection.Puid, Mode, Count).reverse();
        const Game = { GameSlot: BigInt(Mode), PlayerCount: BigInt(Count), Players: Ids, SoloFlag: 0n };
        Assert.ok(Shootaround.ValidateGame2K22(Connection, Game).Ok);
        const Teams = Shootaround.TeamsFor(Connection, Game, Shootaround.CourtTypeFor(Game, '2K22'), []);
        Assert.deepStrictEqual(Teams.Home, Ids.slice(0, Count / 2));
        Assert.deepStrictEqual(Teams.Away, Ids.slice(Count / 2), 'local Away player must not be moved to Home');
    }
});

Test('2K22 private workout supplies one roster per side for both local roles', () => {
    // 17:40:33 start: native AI settings require HOME1/AWAY1, not HOME2/AWAY0.
    const Puid = 0x0110000142d875e1n;
    const Ai = 0x91d3bea8327bc2f3n;
    const { Connection } = ModernMyCourtConnection(7031);
    Assert.strictEqual(Connection.Puid, Puid);
    const Bit = CourtLayout2K22.Bit;
    try {
        for (const [Mode, Type, Ids] of [[15, 56, [Puid, Ai]], [16, 57, [Ai, Puid]]]) {
            const Game = { GameSlot: BigInt(Mode), PlayerCount: 2n, Players: Ids, SoloFlag: 0n };
            Assert.ok(Shootaround.ValidateGame2K22(Connection, Game).Ok);
            const Teams = Shootaround.TeamsFor(Connection, Game, Type, []);
            Assert.deepStrictEqual(Teams, { Home: [Ids[0]], Away: [Ids[1]] });
            const Court = Shootaround.BuildCourt(0x3f0000d4d10n, 1n, Teams.Home, Type, Teams.Away, '2K22');
            const Native = CourtLayout2K22.Decode(ObjectFrame.Parse(Court).Payload);
            Assert.ok(Native.Ok, Native.Reason);
            Assert.strictEqual(Native.Values.get(Bit.CourtType).readUInt32LE(), Type);
            Assert.strictEqual(Native.Values.get(Bit.HomeCount)[0], 1);
            Assert.strictEqual(Native.Values.get(Bit.AwayCount)[0], 1);
            Assert.strictEqual(Native.Values.get(Bit.HomePlayers[0]).readBigUInt64LE(), Ids[0]);
            Assert.strictEqual(Native.Values.get(Bit.AwayPlayers[0]).readBigUInt64LE(), Ids[1]);
            Assert.ok(!Native.Values.has(Bit.HomePlayers[1]), 'no second Home actor or cloned AI');
            Assert.ok(!Shootaround.ValidateGame2K22(Connection, { ...Game, Players: [...Ids].reverse() }).Ok,
                'wrong local role must be rejected, not repaired by moving the player');
        }
    } finally {
        MyCourt.ClearConnection(Connection);
    }
});

Test('2K22 PLAYING/reapply/release insert state fields without overwriting identity or blobs', () => {
    const Puid = 0x0110000142d875e1n;
    const MachineId = 0x123456789abcdef0n;
    const { Connection } = MyCourtConnection(7022, Puid);
    Connection.ProtocolGeneration = '2K22';
    Connection.MachineId = MachineId;
    Connection.PlayerRevision = 1n;
    Connection.PlayerBody = BuildPlayerBody2K22(Puid, MachineId);
    const Source = Buffer.from(Connection.PlayerBody);
    const Before = PlayerBody2K22.Decode(Source);
    Assert.ok(Shootaround.GrantPlaying(Connection, Shootaround.CourtIndex));
    const After = PlayerBody2K22.Decode(Connection.PlayerBody);
    Assert.ok(After.Ok);
    for (const Bit of [0, 1, 2, 3]) {
        Assert.strictEqual(Connection.PlayerBody.readBigUInt64LE(After.Offsets.get(Bit)),
            Source.readBigUInt64LE(Before.Offsets.get(Bit)), `identity field ${Bit} unchanged`);
    }
    Assert.ok(Connection.PlayerBody.subarray(After.Offsets.get(144)).equals(Source.subarray(Before.Offsets.get(144))));
    Assert.strictEqual(Connection.PlayerBody.readUInt32LE(After.Offsets.get(4)), 0xecbccdf8);
    Assert.strictEqual(Connection.PlayerBody.readUInt32LE(After.Offsets.get(5)), Shootaround.CourtIndex);
    Assert.strictEqual(Shootaround.Reapply(Connection), false);
    Connection.PlayerBody.writeUInt32LE(0, After.Offsets.get(5));
    Assert.strictEqual(Shootaround.Reapply(Connection), true, 'court id also re-applied when state is already PLAYING');
    Assert.ok(Shootaround.Release(Connection));
    const Released = PlayerBody2K22.Decode(Connection.PlayerBody);
    Assert.strictEqual(Connection.PlayerBody.readUInt32LE(Released.Offsets.get(4)), 0x9705bb0d);
    Assert.strictEqual(Connection.PlayerBody.readUInt32LE(Released.Offsets.get(5)), 0);
    const Broken = { ...Connection, PlayerBody: Buffer.alloc(10) };
    Assert.strictEqual(Shootaround.GrantPlaying(Broken, Shootaround.CourtIndex), false);
    MyCourt.ClearConnection(Connection);
});

Test('2K22 all mapped starts/connected/ends acknowledge exact IDs and preserve native rosters', () => {
    const Puid = 0x0110000142d875e1n;
    const { Sent, Acks, Events, Connection } = MyCourtConnection(7023, Puid);
    Connection.ProtocolGeneration = '2K22';
    Connection.MachineId = 0x123456789abcdef0n;
    Connection.PlayerRevision = 1n;
    Connection.PlayerBody = BuildPlayerBody2K22(Puid, Connection.MachineId);
    Assert.ok(MyCourt.PublishBootstrap(Connection));
    const Cached = MyCourt.RoomStateFor(Connection, 0x3f0000d4d06n).State;
    Cached.Fields.Customization = Buffer.alloc(4860, 7);
    Cached.Fields.PlayerState = Buffer.alloc(2784, 9);
    Cached.Fields.OwnerCloudSaveId = 0x1122334455667788n;
    try {
        for (const [Requested, Expected, Count, , AwayCount] of MenuCases2K22) {
            const Ids = ModePlayers2K22(Puid, Requested, Count);
            const Begin = Sent.length;
            const AckBegin = Acks.length;
            const EventBegin = Events.length;
            const RequestId = 0x1234567800000011n + BigInt(Requested);
            const RoomVersion = Cached.Version;
            Assert.ok(Shootaround.Handle(Connection, BuildStart2K22(Ids, Requested, Ids.length, RequestId)));
            Assert.strictEqual(Sent.length - Begin, 3, 'court, player, room');
            Assert.strictEqual(Acks.length - AckBegin, 1);
            AssertAck(Acks[AckBegin], RequestId);
            Assert.strictEqual(Events[EventBegin], 'ack', 'ACK precedes authoritative objects');
            const Court = ObjectFrame.Parse(Sent[Begin]);
            const Native = CourtLayout2K22.Decode(Court.Payload);
            Assert.ok(Native.Ok, Native.Reason);
            Assert.strictEqual(Native.Trailing, 0);
            const Bit = CourtLayout2K22.Bit;
            Assert.strictEqual(Native.Values.get(Bit.Name).readUInt32LE(), Shootaround.CourtIndex);
            Assert.strictEqual(Native.Values.get(Bit.CourtType).readUInt32LE(), Expected);
            Assert.strictEqual(Native.Values.get(Bit.MatchId).readBigUInt64LE(), Court.ObjectId);
            Assert.strictEqual(Native.Values.get(Bit.AwayCount)[0], AwayCount);
            Assert.strictEqual(Native.Values.get(Bit.HomeCount)[0], Ids.length - AwayCount);
            for (const [Side, Team] of [
                ['Home', Ids.slice(0, Ids.length - AwayCount)],
                ['Away', Ids.slice(Ids.length - AwayCount)],
            ]) {
                Team.forEach((Id, Index) => Assert.strictEqual(
                    Native.Values.get(Bit[`${Side}Players`][Index]).readBigUInt64LE(), Id,
                    `${Requested}: ${Side} slot ${Index} preserves the requested ID`));
            }
            const Room = MyCourt.ParseRoom(Sent[Begin + 2], '2K22');
            Assert.ok(Room.Version > RoomVersion, 'associated room version advances on start');
            Assert.strictEqual(Room.Room.Fields.State, MyCourt.CribState.Scrimmage);
            Assert.strictEqual(Room.Room.Fields.GameType, Requested, 'room keeps the menu mode, not COURT type');
            Assert.strictEqual(Room.Room.Fields.OwnerCloudSaveId, Cached.Fields.OwnerCloudSaveId);
            Assert.ok(Room.Room.Fields.PlayerState.equals(Buffer.alloc(2784, 9)));
            const Player = Connection.PlayerBody;
            const Playing = Connection.Shootaround;
            const Version = Connection.ShootaroundCourtVersion;
            const ConnectedId = RequestId + 0x100n;
            Assert.ok(Shootaround.Handle(Connection, BuildCommand2K22(Shootaround.ConnectedCommand, Court.ObjectId, ConnectedId)));
            AssertAck(Acks[AckBegin + 1], ConnectedId);
            Assert.strictEqual(Sent.length - Begin, 4, 'connected only sends a newer COURT');
            Assert.strictEqual(Connection.ShootaroundCourtVersion, Version + 1n);
            const ConnectedCourt = ObjectFrame.Parse(Sent[Begin + 3]);
            Assert.ok(ConnectedCourt.Payload.subarray(16).equals(Court.Payload.subarray(16)), 'same fields/IDs, only version changes');
            Assert.strictEqual(Connection.PlayerBody, Player);
            Assert.strictEqual(Connection.Shootaround, Playing);
            Assert.strictEqual(Cached.Version, Room.Version, 'connected does not change room state');
            const EndId = RequestId + 0x200n;
            Assert.ok(Shootaround.HandleEnd(Connection, BuildCommand2K22(Shootaround.EndCommand, Court.ObjectId, EndId)));
            Assert.strictEqual(Acks.length - AckBegin, 3);
            AssertAck(Acks[AckBegin + 2], EndId);
            Assert.strictEqual(Connection.ShootaroundCourtVersion, Version + 2n);
            const EndCourt = CourtLayout2K22.Decode(ObjectFrame.Parse(Sent[Sent.length - 2]).Payload);
            Assert.ok(EndCourt.Ok);
            Assert.strictEqual(EndCourt.Values.get(Bit.CourtType).readUInt32LE(), Expected);
            Assert.strictEqual(EndCourt.Values.get(Bit.HomeCount)[0], Ids.length - AwayCount);
            Assert.strictEqual(EndCourt.Values.get(Bit.AwayCount)[0], AwayCount);
            Ids.slice(0, Ids.length - AwayCount).forEach((Id, Index) => Assert.strictEqual(
                EndCourt.Values.get(Bit.HomePlayers[Index]).readBigUInt64LE(), Id));
            Ids.slice(Ids.length - AwayCount).forEach((Id, Index) => Assert.strictEqual(
                EndCourt.Values.get(Bit.AwayPlayers[Index]).readBigUInt64LE(), Id));
            Assert.strictEqual(MyCourt.ParseRoom(Sent[Sent.length - 1], '2K22').Room.Fields.State, MyCourt.CribState.None);
        }
    } finally {
        MyCourt.ClearConnection(Connection);
    }
});

Test('unverified menu modes and invalid lineups send no COURT, PLAYING or SCRIMMAGE', () => {
    const Puid = 0x0110000142d875e1n;
    const Ai = 0x1234n;
    const { Sent, Acks, Connection } = MyCourtConnection(7024, Puid);
    Connection.ProtocolGeneration = '2K22';
    Connection.MachineId = 0x123456789abcdef0n;
    Connection.PlayerRevision = 1n;
    Connection.PlayerBody = BuildPlayerBody2K22(Puid, Connection.MachineId);
    const Body = Connection.PlayerBody;
    Assert.ok(MyCourt.PublishBootstrap(Connection));
    const Cached = MyCourt.RoomStateFor(Connection, MyCourt.SessionObjectId(Connection.SessionId)).State;
    Cached.Fields.Customization = Buffer.alloc(4860, 7);
    Cached.Fields.PlayerState = Buffer.alloc(2784, 9);
    Cached.Fields.OwnerCloudSaveId = 0x1122334455667788n;
    const Fields = { ...Cached.Fields };
    let RequestId = 0xabcdef1200000020n;
    for (const [Ids, Mode, Count, Flag = 0n] of [
        [[Puid], 9, 1], [[Puid], 10, 1], [[Puid], 19, 1],
        [[Puid], 1, 1], [[Puid], 11, 1],
        [ModePlayers2K22(Puid, 1, 5), 1, 5], [[Puid], 2, 1],
        [[Puid], 6, 1], [[Puid, Ai], 12, 2], [[Puid, Ai], 0, 2],
        [[Puid, Puid], 6, 2], [[Ai], 13, 1],
        [[Puid, 0n], 1, 2], [[Puid, Ai], 1, 99],
        [[Ai, Puid], 15, 2], [[Puid, Ai], 16, 2],
        [[Puid, Ai], 6, 2, 1n], [[Puid, Ai], 6, 2, 2n],
    ]) {
        const Begin = Sent.length;
        const AckBegin = Acks.length;
        const Version = Cached.Version;
        Assert.ok(Shootaround.Handle(Connection, BuildStart2K22(Ids, Mode, Count, ++RequestId, Flag)));
        Assert.strictEqual(Acks.length, AckBegin + 1);
        AssertAck(Acks[AckBegin], RequestId);
        Assert.strictEqual(Sent.length, Begin + 1, 'only a room snapshot, no gameplay objects');
        const Room = MyCourt.ParseRoom(Sent[Begin], '2K22');
        Assert.ok(Room.Version > Version);
        Assert.deepStrictEqual(Room.Room.Fields, Fields, 'ownership, state, blobs and IDs unchanged');
        Assert.strictEqual(Connection.PlayerBody, Body);
        Assert.strictEqual(Connection.Shootaround, undefined);
        Assert.strictEqual(Connection.ShootaroundCourtKey, undefined);
    }
    MyCourt.ClearConnection(Connection);
});

Test('2K22 retries acknowledge and advance versions without reopening an ended game', () => {
    const { Sent, Acks, Connection } = ModernMyCourtConnection(7025);
    Assert.ok(MyCourt.PublishBootstrap(Connection));
    const Start = BuildStart2K22([Connection.Puid], 12, 1, 0x1111111100000020n);
    const CourtKey = MyCourt.SessionObjectId(Connection.SessionId, Shootaround.CourtIndex);
    const Connected = BuildCommand2K22(Shootaround.ConnectedCommand, CourtKey, 0x2222222200000021n);
    const End = BuildCommand2K22(Shootaround.EndCommand, CourtKey, 0x3333333300000022n);
    try {
        Assert.ok(Shootaround.Handle(Connection, Start));
        const PlayingBody = Connection.PlayerBody;
        for (let Retry = 0; Retry < 2; Retry++) {
            const Version = Connection.ShootaroundCourtVersion;
            const Begin = Sent.length;
            Assert.ok(Shootaround.Handle(Connection, Connected));
            AssertAck(Acks[Acks.length - 1], 0x2222222200000021n);
            Assert.strictEqual(Sent.length, Begin + 1);
            Assert.strictEqual(Connection.ShootaroundCourtVersion, Version + 1n);
            Assert.strictEqual(Connection.PlayerBody, PlayingBody);
        }
        Assert.ok(Shootaround.Handle(Connection, End));
        Assert.ok(Shootaround.Handle(Connection, End), 'end retry also receives ACK/new version');
        AssertAck(Acks[Acks.length - 1], 0x3333333300000022n);
        const WalkingBody = Connection.PlayerBody;
        const Version = Connection.ShootaroundCourtVersion;
        Assert.ok(Shootaround.Handle(Connection, Connected), 'late connected notification');
        Assert.strictEqual(Connection.PlayerBody, WalkingBody);
        Assert.strictEqual(Connection.Shootaround, null);
        Assert.strictEqual(Connection.ShootaroundCourtVersion, Version + 1n);
        const Begin = Sent.length;
        Assert.ok(Shootaround.Handle(Connection, Start), 'late duplicate start does not reopen');
        AssertAck(Acks[Acks.length - 1], 0x1111111100000020n);
        Assert.strictEqual(Sent.length, Begin + 1, 'only the unchanged room snapshot');
        Assert.strictEqual(Connection.PlayerBody, WalkingBody);
        Assert.strictEqual(Connection.Shootaround, null);
        Assert.strictEqual(MyCourt.ParseRoom(Sent[Sent.length - 1], '2K22').Room.Fields.State, MyCourt.CribState.None);
        Assert.ok(Shootaround.Handle(Connection,
            BuildStart2K22([Connection.Puid], 0, 1, 0x7777777700000025n)), 'a different start ID opens the next game');
        Assert.ok(Connection.Shootaround);
        Assert.ok(Shootaround.Handle(Connection,
            BuildCommand2K22(Shootaround.EndCommand, 0n, 0x8888888800000026n)), 'native zero-object end');
        AssertAck(Acks[Acks.length - 1], 0x8888888800000026n);
        const AfterSecondGame = Connection.PlayerBody;
        const AfterSecondVersion = Connection.ShootaroundCourtVersion;
        const AfterSecondCount = Sent.length;
        Assert.ok(Shootaround.Handle(Connection, Start), 'old start A after game B must not reopen A');
        AssertAck(Acks[Acks.length - 1], 0x1111111100000020n);
        Assert.strictEqual(Sent.length, AfterSecondCount + 1, 'only the current room snapshot');
        Assert.strictEqual(Connection.PlayerBody, AfterSecondGame);
        Assert.strictEqual(Connection.ShootaroundCourtVersion, AfterSecondVersion);
        Assert.strictEqual(Connection.ShootaroundCourtType, 33, 'old GUN start does not replace SHOOTAROUND');
        Assert.strictEqual(Connection.Shootaround, null);
        Assert.strictEqual(MyCourt.ParseRoom(Sent[Sent.length - 1], '2K22').Room.Fields.State, MyCourt.CribState.None);
    } finally {
        MyCourt.ClearConnection(Connection);
    }
});

Test('2K22 rejects unrelated object keys without changing the active game', () => {
    const { Sent, Acks, Connection } = ModernMyCourtConnection(7026);
    Assert.ok(MyCourt.PublishBootstrap(Connection));
    Assert.ok(Shootaround.Handle(Connection, BuildStart2K22([Connection.Puid], 12)));
    const Body = Connection.PlayerBody;
    const Playing = Connection.Shootaround;
    const Version = Connection.ShootaroundCourtVersion;
    const Foreign = MyCourt.SessionObjectId(Connection.SessionId + 1n, Shootaround.CourtIndex);
    try {
        for (const Command of [Shootaround.Command, Shootaround.ConnectedCommand, Shootaround.EndCommand]) {
            const Packet = Command === Shootaround.Command
                ? BuildStart2K22([Connection.Puid], 12, 1, 0x4444444400000023n)
                : BuildCommand2K22(Command, Foreign, 0x4444444400000023n);
            Packet.writeBigUInt64BE(Foreign, 24);
            const Begin = Sent.length;
            const AckBegin = Acks.length;
            Assert.ok(Shootaround.Handle(Connection, Packet));
            Assert.strictEqual(Acks.length, AckBegin + 1);
            AssertAck(Acks[AckBegin], 0x4444444400000023n);
            Assert.strictEqual(Sent.length, Begin, 'no foreign objects published');
            Assert.strictEqual(Connection.PlayerBody, Body);
            Assert.strictEqual(Connection.Shootaround, Playing);
            Assert.strictEqual(Connection.ShootaroundCourtVersion, Version);
        }
    } finally {
        MyCourt.ClearConnection(Connection);
    }
});

Test('2K22 command ACK path ignores malformed frames, unrelated worlds and legacy connected notifications', () => {
    const { Sent, Acks, Connection } = ModernMyCourtConnection(7027);
    const Valid = BuildStart2K22([Connection.Puid], 12);
    const WrongPacket = Buffer.from(Valid);
    WrongPacket.writeUInt32BE(MyCourt.ObjectDataPacket, 4);
    const WrongLength = Buffer.from(Valid);
    WrongLength.writeUInt32LE(Valid.length + 1);
    const ShortBody = Buffer.from(Valid);
    ShortBody.writeUInt32BE(Valid.length, 32);
    for (const Packet of [Valid.subarray(0, 35), WrongPacket, WrongLength, ShortBody,
        BuildCommand2K22(0x5bb78c48, 0n, 32n)]) {
        Assert.strictEqual(Shootaround.Handle(Connection, Packet), false);
        Assert.strictEqual(Sent.length, 0);
        Assert.strictEqual(Acks.length, 0);
    }
    Connection.ActivityName = 'neighborhood';
    Connection.ActivityKey = 0x3cf672c2;
    Assert.strictEqual(Shootaround.Handle(Connection, Valid), false);
    Assert.strictEqual(Acks.length, 0);
    const Legacy = MyCourtConnection(7028, Connection.Puid);
    Assert.strictEqual(Shootaround.Handle(Legacy.Connection,
        BuildCommand2K22(Shootaround.ConnectedCommand, 0x3f0000d4d10n, 32n)), false);
    Assert.strictEqual(Legacy.Acks.length, 0);
    Assert.strictEqual(Legacy.Sent.length, 0);
});

Test('rejecting a 2K22 mode without a cached room does not invent room state', () => {
    const { Sent, Acks, Connection } = ModernMyCourtConnection(7029);
    const Count = MyCourt.RoomStates.size;
    Assert.ok(Shootaround.Handle(Connection, BuildStart2K22([Connection.Puid], 2, 1, 0x5555555500000024n)));
    AssertAck(Acks[0], 0x5555555500000024n);
    Assert.strictEqual(Sent.length, 0);
    Assert.strictEqual(MyCourt.RoomStates.size, Count);
    Assert.strictEqual(Connection.Shootaround, undefined);
});

process.stdout.write(`\n${Passed} passing\n`);
