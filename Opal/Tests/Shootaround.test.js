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
    return {
        Sent,
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
            SendObject(FrameData) {
                Sent.push(FrameData);
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
function BuildStart2K22(Players, Type, Count = Players.length) {
    const Builder = new FieldList.Builder()
        .AddU64(Shootaround.Field.SoloFlag, 0n)
        .AddU64(Shootaround.Field.PlayerCount, BigInt(Count))
        .AddU32('COMMAND', Shootaround.Command)
        .AddU64(Shootaround.Field.GameSlot, BigInt(Type));
    Players.forEach((Puid) => Builder.AddU64(Shootaround.Field.Player, Puid));
    const Body = Builder.Build();
    const Header = Buffer.from(Buffer.from(LiveStartCribGame, 'hex').subarray(0, 36));
    Header.writeUInt32LE(Header.length + Body.length);
    Header.writeUInt32BE(Body.length, 32);
    return Buffer.concat([Header, Body]);
}

Test('2K22 MyCourt menu modes are converted, never treated as native COURT types', () => {
    for (const [Mode, Type] of [[0, 33], [1, 49], [6, 9], [11, 54], [12, 55]]) {
        Assert.strictEqual(Shootaround.CourtTypeFor({ GameSlot: BigInt(Mode) }, '2K22'), Type);
    }
    for (const Mode of [2n, 18n, 19n, 63n, 64n, 0x100000006n]) {
        Assert.strictEqual(Shootaround.CourtTypeFor({ GameSlot: Mode }, '2K22'), null, 'unknown mode must not fall back or truncate');
    }
    Assert.strictEqual(Shootaround.CourtTypeFor({ GameSlot: 6n }), 6, 'legacy mapping unchanged');
    Assert.strictEqual(Shootaround.CourtTypeFor({ GameSlot: 0n }), 29, 'legacy default unchanged');
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

Test('2K22 MyCourt start/end use 148-bit courts, preserve AI ids and keep the room snapshot', () => {
    const Puid = 0x0110000142d875e1n;
    const Ai = 0x1234n;
    const { Sent, Connection } = MyCourtConnection(7023, Puid);
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
        for (const [Requested, Expected, Ids, AwayCount] of [
            [0, 33, [Puid], 0], [1, 49, [Puid, Ai], 0],
            [6, 9, [Puid, Ai], 1], [11, 54, [Puid, Ai], 0], [12, 55, [Puid], 0],
        ]) {
            const Begin = Sent.length;
            Assert.ok(Shootaround.Handle(Connection, BuildStart2K22(Ids, Requested)));
            Assert.strictEqual(Sent.length - Begin, 3, 'court, player, room');
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
            Assert.strictEqual(Native.Values.get(Bit.HomePlayers[0]).readBigUInt64LE(), Puid);
            if (Ids.length > 1) {
                Assert.strictEqual(Native.Values.get(AwayCount ? Bit.AwayPlayers[0] : Bit.HomePlayers[1]).readBigUInt64LE(), Ai);
            }
            const Room = MyCourt.ParseRoom(Sent[Begin + 2], '2K22');
            Assert.strictEqual(Room.Room.Fields.State, MyCourt.CribState.Scrimmage);
            Assert.strictEqual(Room.Room.Fields.GameType, Requested, 'room keeps the menu mode, not COURT type');
            Assert.strictEqual(Room.Room.Fields.OwnerCloudSaveId, Cached.Fields.OwnerCloudSaveId);
            Assert.ok(Room.Room.Fields.PlayerState.equals(Buffer.alloc(2784, 9)));
            Assert.ok(Shootaround.HandleEnd(Connection, Buffer.from(LiveEndCommand, 'hex')));
            const EndCourt = CourtLayout2K22.Decode(ObjectFrame.Parse(Sent[Sent.length - 2]).Payload);
            Assert.ok(EndCourt.Ok);
            Assert.strictEqual(EndCourt.Values.get(Bit.CourtType).readUInt32LE(), Expected);
            Assert.strictEqual(MyCourt.ParseRoom(Sent[Sent.length - 1], '2K22').Room.Fields.State, MyCourt.CribState.None);
        }
    } finally {
        MyCourt.ClearConnection(Connection);
    }
});

Test('unverified menu modes and invalid lineups send no COURT, PLAYING or SCRIMMAGE', () => {
    const Puid = 0x0110000142d875e1n;
    const Ai = 0x1234n;
    const { Sent, Connection } = MyCourtConnection(7024, Puid);
    Connection.ProtocolGeneration = '2K22';
    Connection.MachineId = 0x123456789abcdef0n;
    Connection.PlayerRevision = 1n;
    Connection.PlayerBody = BuildPlayerBody2K22(Puid, Connection.MachineId);
    const Body = Connection.PlayerBody;
    for (const [Ids, Mode, Count] of [
        [[Puid], 2, 1], [[Puid], 6, 1], [[Puid, Ai], 12, 2],
        [[Puid, Ai], 0, 2], [[Puid, Puid], 6, 2], [[Ai], 1, 1],
        [[Puid, 0n], 1, 2], [[Puid, Ai], 1, 99],
    ]) {
        Assert.ok(Shootaround.Handle(Connection, BuildStart2K22(Ids, Mode, Count)));
        Assert.strictEqual(Sent.length, 0);
        Assert.strictEqual(Connection.PlayerBody, Body);
        Assert.strictEqual(Connection.Shootaround, undefined);
        Assert.strictEqual(Connection.ShootaroundCourtKey, undefined);
    }
    MyCourt.ClearConnection(Connection);
});

process.stdout.write(`\n${Passed} passing\n`);
