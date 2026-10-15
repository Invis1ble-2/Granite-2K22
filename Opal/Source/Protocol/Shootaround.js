// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const { Crc32, Hex } = require('../Core/Crc32');
const FieldList = require('../Codec/FieldList');
const ObjectFrame = require('../Codec/ObjectFrame');
const MyCourt = require('./MyCourt');
const PlayerObject = require('./PlayerObject');
const GotNext = require('./GotNext');
const Roster = require('./Roster');
const PlayerBody = require('./PlayerBody');
const PlayerBody2K22 = require('./PlayerBody2K22');
const CourtLayout2K22 = require('./CourtLayout2K22');
const Requests = require('./Requests');

const CourtClass = 0x2c4d49e3;
const CourtFlags = 116;
// Retail mycourt.ACTIVITY selects s656/s657; both baskets.SCNE register
// court_marker "main". FUN_14148AD80 keys graphics baskets by its name CRC,
// not the session COURT ID or the transform reference "main_marker".
const MyCourtArtBinding2K22 = Crc32('main') >>> 0;
const CourtType = Object.freeze({ None: 0, OneVOne: 6, Couch: 27, Blacktop: 28, Shootaround: 29 });
const CourtTypeCount = 44;
const CourtTypeName = Object.freeze({
    0: 'NONE',
    1: 'FIVE_V_FIVE',
    2: 'FIVE_V_FIVE_GYM',
    3: 'FOUR_V_FOUR',
    4: 'THREE_V_THREE',
    5: 'TWO_V_TWO',
    6: 'ONE_V_ONE',
    7: 'ONE_V_ONE_QUICK',
    8: 'ONE_V_ONE_V_ONE',
    9: 'DUNK_CONTEST',
    10: 'THREE_PT_CONTEST',
    27: 'COUCH',
    28: 'BLACKTOP',
    29: 'SHOOTAROUND',
    30: 'SHOOTAROUND_PROAM',
    31: 'SLAMBALL_3V3',
    32: 'SLAMBALL_2V2',
    33: 'FREE_THROW_TOURNEY',
    34: 'HOUSE_RULES',
    35: 'COURT_CONQUEROR',
    36: 'THREE_V_THREE_PRO',
    37: 'RUFFLES_TOURNEY',
    38: 'BEST_OF_TEN',
    39: 'AROUND_THE_WORLD',
    40: 'PARTNER_SHOOTING',
    41: 'SEVEN_ON_BOARD',
    42: 'HORSE',
    43: 'SIGN_OUT',
});
// NBA2K22 type table at 0x142C41E70 (FUN_141484770).
const CourtType2K22 = Object.freeze({ None: 0, OneVOne: 9, Couch: 31, Blacktop: 32, Shootaround: 33 });
const CourtTypeName2K22 = Object.freeze({
    0: 'NONE', 1: 'FIVE_V_FIVE', 2: 'FIVE_V_FIVE_GYM',
    3: 'FIVE_V_FIVE_EVENT', 4: 'FIVE_V_FIVE_EVENT_FIREANDICE',
    5: 'FOUR_V_FOUR', 6: 'THREE_V_THREE', 7: 'THREE_V_THREE_GYM',
    8: 'TWO_V_TWO', 9: 'ONE_V_ONE', 10: 'ONE_V_ONE_HALF',
    11: 'ONE_V_ONE_QUICK', 12: 'ONE_V_ONE_V_ONE', 13: 'THREE_PT_CONTEST',
    31: 'COUCH', 32: 'BLACKTOP', 33: 'SHOOTAROUND', 34: 'SHOOTAROUND_PROAM',
    49: 'BEST_OF_TEN', 50: 'AROUND_THE_WORLD', 51: 'PARTNER_SHOOTING',
    52: 'SEVEN_ON_BOARD', 53: 'HORSE', 54: 'SIGN_OUT', 55: 'GUN',
    56: 'PRIVATE_WORKOUT_DRILL', 57: 'PRIVATE_WORKOUT_DRILLDEFENSE',
    58: 'FREETHROW_PRACTICE', 59: 'FULLCOURT_PRESS',
    60: 'CATCH_AND_SHOOT', 61: 'DEFENSIVE_PRESS',
});

function TypesFor(Generation) {
    return Generation === '2K22' ? CourtType2K22 : CourtType;
}

// START_CRIB_GAME sends a menu mode, not COURT.Type (FUN_14161A1B0).
// NBA2K22 menu rows: 0x142432A20 / FUN_140640F60; counts:
// FUN_14166F030/FUN_14166EFA0. COURT names: 0x142C41E70.
// FUN_140744BF0 orders versus IDs by side, without moving the local player.
// Most training rosters are Home-only; private workout instead needs 1/1
// (2026-10-14 client AI_FillInGameDescription asserts; native position tables
// 0x1432375D0/0x143237600). Mode 16 selects the local second menu side.
// Couch/arcade modes 9/10 have a separate entry path, not these menu rows.
const MenuModes2K22 = Object.freeze({
    0: Object.freeze({ CourtType: 33, Teams: 'together', MinPlayers: 1, MaxPlayers: 1 }),
    1: Object.freeze({ CourtType: 49, Teams: 'together', MinPlayers: 2, MaxPlayers: 4 }),
    2: Object.freeze({ CourtType: 50, Teams: 'together', MinPlayers: 2, MaxPlayers: 4 }),
    3: Object.freeze({ CourtType: 51, Teams: 'together', MinPlayers: 2, MaxPlayers: 2 }),
    4: Object.freeze({ CourtType: 52, Teams: 'together', MinPlayers: 2, MaxPlayers: 5 }),
    5: Object.freeze({ CourtType: 53, Teams: 'together', MinPlayers: 2, MaxPlayers: 5 }),
    6: Object.freeze({ CourtType: 9, Teams: 'versus', MinPlayers: 2, MaxPlayers: 2 }),
    7: Object.freeze({ CourtType: 8, Teams: 'versus', MinPlayers: 4, MaxPlayers: 4 }),
    8: Object.freeze({ CourtType: 6, Teams: 'versus', MinPlayers: 6, MaxPlayers: 6 }),
    11: Object.freeze({ CourtType: 54, Teams: 'together', MinPlayers: 2, MaxPlayers: 5 }),
    12: Object.freeze({ CourtType: 55, Teams: 'together', MinPlayers: 1, MaxPlayers: 1 }),
    13: Object.freeze({ CourtType: 58, Teams: 'together', MinPlayers: 1, MaxPlayers: 1 }),
    14: Object.freeze({ CourtType: 61, Teams: 'together', MinPlayers: 3, MaxPlayers: 3 }),
    15: Object.freeze({ CourtType: 56, Teams: 'versus', MinPlayers: 2, MaxPlayers: 2, LocalSlot: 0 }),
    16: Object.freeze({ CourtType: 57, Teams: 'versus', MinPlayers: 2, MaxPlayers: 2, LocalSlot: 1 }),
    17: Object.freeze({ CourtType: 59, Teams: 'together', MinPlayers: 3, MaxPlayers: 3 }),
    18: Object.freeze({ CourtType: 60, Teams: 'together', MinPlayers: 1, MaxPlayers: 1 }),
});

function MenuModeFor(Game) {
    if (!Game || Game.GameSlot === undefined || Game.GameSlot === null) return null;
    const Mode = Number(Game.GameSlot);
    return Number.isInteger(Mode) && Mode >= 0 && Mode <= 18 ? MenuModes2K22[Mode] || null : null;
}

function ValidateGame2K22(Connection, Game) {
    const Mode = MenuModeFor(Game);
    if (!Mode) return { Ok: false, Reason: `unverified MyCOURT menu mode ${Game?.GameSlot}; no COURT fallback` };
    const Ids = Game.Players || [];
    const Count = Number(Game.PlayerCount);
    if (!Number.isInteger(Count) || Count !== Ids.length ||
        Count < Mode.MinPlayers || Count > Mode.MaxPlayers) {
        return { Ok: false, Reason: `menu mode ${Game.GameSlot} needs ${Mode.MinPlayers}..${Mode.MaxPlayers} players; count ${Game.PlayerCount}, IDs ${Ids.length}` };
    }
    const Unique = new Set(Ids.map((Id) => BigInt(Id)));
    if (Unique.has(0n) || Unique.size !== Ids.length ||
        Connection.Puid === null || Connection.Puid === undefined || !Unique.has(BigInt(Connection.Puid))) {
        return { Ok: false, Reason: 'invalid, duplicate or missing local player IDs in MyCOURT request' };
    }
    if (Mode.LocalSlot !== undefined && BigInt(Ids[Mode.LocalSlot]) !== BigInt(Connection.Puid)) {
        return { Ok: false, Reason: `menu mode ${Game.GameSlot} requires the local player in slot ${Mode.LocalSlot}` };
    }
    // FUN_14168C4B0: this flag means more than one non-AI participant,
    // not "solo". A local COURT without native synchronization/transport must
    // not silently start a multiplayer-human request as an offline game.
    if (Game.SoloFlag !== 0n && Game.SoloFlag !== 0) {
        return { Ok: false, Reason: 'MyCOURT multiplayer-human synchronization is not supported; expected request flag 0' };
    }
    return { Ok: true, Mode };
}
const CourtIndex = 0x000d4d10;
const CourtBit = Object.freeze({
    Type: 0,
    CourtId: 2,
    SetupGate: 11,
    MatchId: 12,
    SecondTeamSize: 15,
    SecondTeam: 17,
    FirstTeamSize: 37,
    FirstTeam: 38,
});

const RequestPacket = 0xce148fb1;

const Command = 0xab153d7e;

const EndCommand = 0xdaeafe9e;
const ConnectedCommand = 0xdfc1471f;

const RoomKeyOffset = 24;

const StateOffset = 51;
const GameIdOffset = 55;

const Field = Object.freeze({
    SoloFlag: 0x07bc2a56,
    Player: 0x190bbdbc,
    PlayerCount: 0xa8357302,
    GameSlot: 0xba4bba9d,
    Score: 0xd4d9ad7d,
    Result: 0xe3920695,
});

function Read(Bytes, List = null) {
    const CommandData = List ? FieldList.Find(List, 'COMMAND') : FieldList.Scan(Bytes, 'COMMAND');
    if (!CommandData || CommandData.Data1 >>> 0 !== Command >>> 0) return null;
    if (!List) {
        const At = FieldList.Locate(Bytes);
        if (At < 0) return null;
        List = FieldList.Parse(Bytes, At);
    }
    const Find = (Crc) => List.Fields.find((F) => F.Crc === Crc >>> 0) || null;
    const Solo = Find(Field.SoloFlag);
    const Count = Find(Field.PlayerCount);
    const Slot = Find(Field.GameSlot);
    const Players = List.Fields.filter((F) => F.Crc === Field.Player >>> 0 && F.Value !== undefined).map(
        (F) => F.Value,
    );
    if (!Solo || !Count || !Slot) return null;
    return {
        SoloFlag: Solo.Value,
        PlayerCount: Count.Value,
        GameSlot: Slot.Value,
        Players: Players,
        Fields: List.Fields.length,
    };
}

function Writable(Body) {
    if (!Buffer.isBuffer(Body) || Body.length < GameIdOffset + 4) return false;
    const Present = PlayerObject.PresentBits(Body, 16, 1);
    return [0, 1, 2, 3].every((Bit) => Present.includes(Bit));
}

function PatchPlayer(Connection, State, GameId) {
    if (PlayerBody.GenerationForConnection(Connection) === '2K22') {
        const Patched = PlayerBody2K22.SetGameState(Connection.PlayerBody, State, GameId);
        if (!Patched.Ok) return false;
        Connection.PlayerBody = PlayerBody.Mark(Patched.Body, '2K22');
        return true;
    }
    if (!Writable(Connection.PlayerBody)) return false;
    const Body = Buffer.from(Connection.PlayerBody);
    Body.writeUInt32LE(State >>> 0, StateOffset);
    Body.writeUInt32LE(GameId >>> 0, GameIdOffset);
    Connection.PlayerBody = Body;
    return true;
}

function SendPlayer(Connection) {
    const Frame = PlayerObject.FrameFor(Connection);
    return !!Frame && !!Connection.SendObject(Frame);
}

function GrantPlaying(Connection, GameId) {
    if (!PatchPlayer(Connection, GotNext.State.Playing, GameId)) {
        Log.Error(
            `${Connection.Identifier} is starting a couch game but has no full player body to ` +
                `put PLAYING into, so the client will treat them as a spectator.`,
        );
        return false;
    }
    Connection.Shootaround = { GameId: GameId >>> 0, Since: Date.now() };
    return SendPlayer(Connection);
}

function Release(Connection) {
    if (!Connection || !Connection.Shootaround) return false;
    Connection.Shootaround = null;
    if (!PatchPlayer(Connection, GotNext.State.None, 0)) return false;
    return SendPlayer(Connection);
}

function Reapply(Connection) {
    if (!Connection || !Connection.Shootaround) return false;
    if (PlayerBody.GenerationForConnection(Connection) === '2K22') {
        const Decoded = PlayerBody2K22.Decode(Connection.PlayerBody);
        if (!Decoded.Ok) return false;
        const StateAt = Decoded.Offsets.get(4);
        const CourtAt = Decoded.Offsets.get(5);
        if (StateAt !== undefined && CourtAt !== undefined &&
            Connection.PlayerBody.readUInt32LE(StateAt) === GotNext.State.Playing >>> 0 &&
            Connection.PlayerBody.readUInt32LE(CourtAt) === Connection.Shootaround.GameId) return false;
    } else {
        if (!Writable(Connection.PlayerBody)) return false;
        if (Connection.PlayerBody.readUInt32LE(StateOffset) >>> 0 === GotNext.State.Playing >>> 0 &&
            Connection.PlayerBody.readUInt32LE(GameIdOffset) === Connection.Shootaround.GameId) return false;
    }
    return PatchPlayer(Connection, GotNext.State.Playing, Connection.Shootaround.GameId);
}

function BuildCourt(ObjectId, Version, Players, Type = null, Away = [], Generation = '2K19') {
    Type = Type === null ? TypesFor(Generation).Shootaround : Type;
    const U32 = (Value) => {
        const Out = Buffer.alloc(4);
        Out.writeUInt32LE(Value >>> 0, 0);
        return Out;
    };
    const U64 = (Value) => {
        const Out = Buffer.alloc(8);
        Out.writeBigUInt64LE(BigInt.asUintN(64, BigInt(Value)), 0);
        return Out;
    };
    const Key = BigInt.asUintN(64, BigInt(ObjectId));
    const Team = Players.slice(0, 5).map((Player) => BigInt(Player));
    const Other = (Away || []).slice(0, 5).map((Player) => BigInt(Player));
    const Fields = new Map();
    if (Generation === '2K22') {
        // FUN_1416E7A00/FUN_1416E6570: 20 inherited + 128 court bits.
        const Bit = CourtLayout2K22.Bit;
        Fields.set(Bit.Name, U32(Number(Key & 0xffffffffn)));
        Fields.set(Bit.IsActive, Buffer.from([1]));
        Fields.set(Bit.ArtBinding, U32(MyCourtArtBinding2K22));
        Fields.set(Bit.CourtType, U32(Type));
        Fields.set(Bit.SetupGate, Buffer.from([0]));
        Fields.set(Bit.MatchId, U64(Key));
        Fields.set(Bit.AwayCount, Buffer.from([Other.length]));
        Other.forEach((Player, Index) => Fields.set(Bit.AwayPlayers[Index], U64(Player)));
        Fields.set(Bit.HomeCount, Buffer.from([Team.length]));
        Team.forEach((Player, Index) => Fields.set(Bit.HomePlayers[Index], U64(Player)));
    } else {
        Fields.set(CourtBit.Type, U32(Type));
        Fields.set(CourtBit.CourtId, U32(Number(Key & 0xffffffffn)));
        Fields.set(CourtBit.SetupGate, Buffer.from([0]));
        Fields.set(CourtBit.MatchId, U64(Key));
        Fields.set(CourtBit.SecondTeamSize, Buffer.from([Other.length]));
        Other.forEach((Player, Index) => Fields.set(CourtBit.SecondTeam + Index, U64(Player)));
        Fields.set(CourtBit.FirstTeamSize, Buffer.from([Team.length]));
        Team.forEach((Player, Index) => Fields.set(CourtBit.FirstTeam + Index, U64(Player)));
    }

    const Bits = [...Fields.keys()].sort((A, B) => A - B);
    const Head = Buffer.alloc(16);
    Head.writeBigUInt64BE(Key, 0);
    Head.writeBigUInt64BE(BigInt(Version), 8);
    const Bitmap = Buffer.alloc(ObjectFrame.FlagBytes(Generation === '2K22' ? CourtLayout2K22.Count : CourtFlags));
    for (const Bit of Bits) Bitmap[Bit >> 3] |= 0x80 >> (Bit & 7);
    const Payload = Buffer.concat([Head, Bitmap, ...Bits.map((Bit) => Fields.get(Bit))]);
    return ObjectFrame.Build({
        PacketId: MyCourt.ObjectDataPacket,
        ConnectionId: null,
        ObjectId: Key,
        ClassCrc: CourtClass,
        Payload,
        Layout: ObjectFrame.Layout.Nineteen,
    });
}

function CourtTypeFor(Game, Generation = '2K19') {
    if (Generation === '2K22') return MenuModeFor(Game)?.CourtType ?? null;
    const Type = Number(Game && Game.GameSlot !== undefined ? Game.GameSlot : 0) >>> 0;
    return Type > 0 && Type < CourtTypeCount ? Type : CourtType.Shootaround;
}

function CourtTypeLabel(Type, Generation = '2K19') {
    const Names = Generation === '2K22' ? CourtTypeName2K22 : CourtTypeName;
    return Names[Type] || `court type ${Type}`;
}

function TeamLabel(Team) {
    return Team.length
        ? Team.map((Id) => `0x${BigInt(Id).toString(16).toUpperCase().padStart(16, '0')}`).join(', ')
        : 'nobody';
}

function TeamsFor(Connection, Game, Type, Players) {
    const Generation = PlayerBody.GenerationForConnection(Connection);
    if (Generation === '2K22') {
        const Mode = MenuModeFor(Game);
        if (!Mode || Mode.CourtType !== Type) return null;
        const Ids = (Game.Players || []).map((Id) => BigInt(Id));
        if (Mode.Teams === 'together') return { Home: Ids, Away: [] };
        const Half = Ids.length / 2;
        return { Home: Ids.slice(0, Half), Away: Ids.slice(Half) };
    }
    if (Type === CourtType.Shootaround) {
        const Home = Players.map((Player) => Player.Puid)
            .filter((Puid) => Puid !== null && Puid !== undefined)
            .map((Puid) => BigInt(Puid));
        return { Home: Home.slice(0, 5), Away: [] };
    }
    const Ids = [];
    for (const Id of Game.Players || []) {
        const Value = BigInt(Id);
        if (!Ids.includes(Value)) Ids.push(Value);
    }
    const Own = Connection.Puid === null || Connection.Puid === undefined ? null : BigInt(Connection.Puid);
    if (Own !== null && !Ids.includes(Own)) Ids.unshift(Own);
    const Half = Math.ceil(Ids.length / 2);
    return { Home: Ids.slice(0, Math.min(Half, 5)), Away: Ids.slice(Half, Half + 5) };
}

function PlayersFor(Connection, Ids) {
    const Wanted = new Set((Ids || []).map((Id) => BigInt(Id)));
    const Players = [Connection];
    for (const Peer of Roster.Peers(Connection)) {
        if (Peer === Connection || !MyCourt.IsMyCourt(Peer)) continue;
        if (PlayerBody.GenerationForConnection(Peer) !== PlayerBody.GenerationForConnection(Connection)) continue;
        if (Peer.Puid === null || Peer.Puid === undefined || !Wanted.has(BigInt(Peer.Puid))) continue;
        Players.push(Peer);
    }
    return Players;
}

function ReadEnd(Bytes, List = null) {
    const CommandData = List ? FieldList.Find(List, 'COMMAND') : FieldList.Scan(Bytes, 'COMMAND');
    if (!CommandData || CommandData.Data1 >>> 0 !== EndCommand >>> 0) return null;
    if (!List) {
        const At = FieldList.Locate(Bytes);
        List = At >= 0 ? FieldList.Parse(Bytes, At) : { Fields: [] };
    }
    const Find = (Crc) => List.Fields.find((F) => F.Crc === Crc >>> 0) || null;
    const Score = Find(Field.Score);
    const Result = Find(Field.Result);
    return {
        Court: Bytes.length >= RoomKeyOffset + 8 ? Bytes.readBigUInt64BE(RoomKeyOffset) : null,
        Score: Score && Score.Value !== undefined ? Score.Value : null,
        Result: Result ? (Result.Data1 !== undefined ? Result.Data1 >>> 0 : Result.Value) : null,
    };
}

function ReadRequest2K22(Bytes) {
    // FUN_1416D6F30: COMMAND body is request u64, object u64, field-list size.
    if (!Buffer.isBuffer(Bytes) || Bytes.length < 52 ||
        Bytes.readUInt32LE(0) !== Bytes.length || Bytes.readUInt32BE(4) !== RequestPacket) return null;
    const Length = Bytes.readUInt32BE(32);
    if (Length < 16 || Length > Bytes.length - 36 || Length % 16 !== 0) return null;
    const List = FieldList.Parse(Bytes.subarray(36, 36 + Length), 0);
    const CommandData = FieldList.Find(List, 'COMMAND');
    if (!CommandData || CommandData.Type !== FieldList.Type.U32) return null;
    return {
        Id: Bytes.readBigUInt64BE(16),
        ObjectId: Bytes.readBigUInt64BE(RoomKeyOffset),
        Command: CommandData.Data1 >>> 0,
        List,
    };
}

function AckRequest2K22(Connection, Request) {
    if (!Request || Request.Id === 0n || Connection.Closed) return false;
    const Sent = Connection.Send(Requests.Build(Request.Id));
    if (!Sent) Log.Error(`${Connection.Identifier} could not acknowledge MyCourt request ${Request.Id}`);
    return !!Sent;
}

function HandleConnected2K22(Connection, Request) {
    AckRequest2K22(Connection, Request);
    if (Connection.ShootaroundCourtKey === undefined ||
        Request.ObjectId !== Connection.ShootaroundCourtKey ||
        Connection.ShootaroundCourtType === undefined || !Connection.ShootaroundTeam) {
        Log.Error(`${Connection.Identifier} MyCourt connection-complete rejected: no matching court`);
        return true;
    }
    // FUN_141746ED0 requires ACK AND a newer associated object. Do not reset
    // PLAYER/room state on retries, including a notification arriving after end.
    Connection.ShootaroundCourtVersion = (Connection.ShootaroundCourtVersion || 0n) + 1n;
    Connection.SendObject(BuildCourt(Request.ObjectId, Connection.ShootaroundCourtVersion,
        Connection.ShootaroundTeam, Connection.ShootaroundCourtType,
        Connection.ShootaroundAway || [], '2K22'));
    Log.Verbose(`  MyCourt connection-complete request ${Request.Id}, court revision ${Connection.ShootaroundCourtVersion}`);
    return true;
}

function HandleEnd(Connection, Bytes) {
    if (!MyCourt.IsMyCourt(Connection)) return false;
    const Modern = PlayerBody.GenerationForConnection(Connection) === '2K22';
    const Request = Modern ? ReadRequest2K22(Bytes) : null;
    if (Modern && (!Request || Request.Command !== EndCommand || Connection.Closed)) return false;
    const End = ReadEnd(Bytes, Request ? Request.List : null);
    if (!End) return false;
    if (Modern) {
        AckRequest2K22(Connection, Request);
        if (Request.ObjectId !== 0n && Request.ObjectId !== Connection.ShootaroundCourtKey) {
            Log.Error(`${Connection.Identifier} MyCourt end rejected: no matching court`);
            return true;
        }
    }
    Log.Info(
        `${Connection.Identifier} finished their MyCourt shootaround (result ` +
            `${End.Result === null ? 'unknown' : Hex(End.Result)}, score ${End.Score === null ? '?' : End.Score}) @ ${Log.Clock()}`,
    );

    Connection.Shootaround = null;
    const Walking = PatchPlayer(Connection, GotNext.State.None, 0) && SendPlayer(Connection);

    const CourtKey = End.Court !== null && End.Court !== 0n ? End.Court : Connection.ShootaroundCourtKey;
    let CourtVersion = null;
    if (CourtKey !== null && CourtKey !== undefined) {
        Connection.ShootaroundCourtVersion = (Connection.ShootaroundCourtVersion || 0n) + 1n;
        const Team =
            Connection.ShootaroundTeam && Connection.ShootaroundTeam.length
                ? Connection.ShootaroundTeam
                : [Connection.Puid].filter((Puid) => Puid !== null && Puid !== undefined);
        const Type =
            Connection.ShootaroundCourtType === undefined
                ? TypesFor(PlayerBody.GenerationForConnection(Connection)).Shootaround : Connection.ShootaroundCourtType;
        if (
            Connection.SendObject(
                BuildCourt(CourtKey, Connection.ShootaroundCourtVersion, Team, Type,
                    Connection.ShootaroundAway || [], PlayerBody.GenerationForConnection(Connection)),
            )
        ) {
            CourtVersion = Connection.ShootaroundCourtVersion;
        }
    }

    const Room = MyCourt.EndCribGame(
        Connection,
        Connection.ShootaroundRoomKey === undefined ? null : Connection.ShootaroundRoomKey,
    );
    Log.Verbose(
        `  player object ${Walking ? 'sent with WALKING and no game' : 'could not be put back to WALKING'}, ` +
            `court ${CourtKey === null || CourtKey === undefined ? 'unknown' : CourtKey.toString(16).toUpperCase()} ` +
            `${CourtVersion === null ? 'not re-sent' : `re-sent at version ${CourtVersion}`}, ` +
            `room ${Room ? `NONE at revision ${Room.Version}` : 'not found'}`,
    );
    return true;
}

function Handle(Connection, Bytes) {
    if (!MyCourt.IsMyCourt(Connection)) return false;
    const Modern = PlayerBody.GenerationForConnection(Connection) === '2K22';
    const Request = Modern ? ReadRequest2K22(Bytes) : null;
    if (Modern && (!Request || Connection.Closed)) return false;
    if (Modern && Request.Command === ConnectedCommand) return HandleConnected2K22(Connection, Request);
    if (HandleEnd(Connection, Bytes)) return true;
    const Req = Read(Bytes, Request ? Request.List : null);
    if (!Req) return false;
    const Who = Req.Players.length
        ? Req.Players.map((P) => `0x${BigInt(P).toString(16).toUpperCase().padStart(16, '0')}`).join(', ')
        : '(no player ids)';
    const Generation = PlayerBody.GenerationForConnection(Connection);
    const Type = CourtTypeFor(Req, Generation);
    if (Modern) {
        AckRequest2K22(Connection, Request);
        if (Connection.SessionId === null || Connection.SessionId === undefined ||
            Request.ObjectId !== MyCourt.SessionObjectId(Connection.SessionId)) {
            Log.Error(`${Connection.Identifier} MyCourt start rejected: no matching room`);
            return true;
        }
        const Starts = Connection.ShootaroundStartRequests;
        if (Request.Id !== 0n && Starts && Starts.RoomKey === Request.ObjectId && Starts.Ids.has(Request.Id)) {
            MyCourt.RepublishRoom(Connection, Request.ObjectId);
            return true;
        }
        const Checked = ValidateGame2K22(Connection, Req);
        if (!Checked.Ok) {
            Log.Error(`${Connection.Identifier} MyCourt start rejected: ${Checked.Reason}`);
            MyCourt.RepublishRoom(Connection, Request.ObjectId);
            return true;
        }
    }
    Log.Info(
        `${Connection.Identifier} asked for a MyCourt ${CourtTypeLabel(Type, Generation)} ` +
            `(players ${Req.Players.length}, count ${Req.PlayerCount}, ` +
            `soloFlag ${Req.SoloFlag}, ${Generation === '2K22' ? 'menu mode' : 'type'} ${Req.GameSlot}, COURT type ${Type}) @ ${Log.Clock()}`,
    );

    const ObjectId = Bytes.length >= RoomKeyOffset + 8 ? Bytes.readBigUInt64BE(RoomKeyOffset) : null;
    const RoomKey = ObjectId === null || ObjectId === 0n ? null : ObjectId;
    const Session =
        RoomKey !== null
            ? RoomKey >> 32n
            : Connection.SessionId === null || Connection.SessionId === undefined
              ? 0n
              : BigInt(Connection.SessionId);
    const CourtKey = (Session << 32n) | BigInt(CourtIndex);
    const GameId = CourtIndex >>> 0;
    const Players = PlayersFor(Connection, Req.Players);

    const Teams = TeamsFor(Connection, Req, Type, Players);
    Connection.ShootaroundCourtKey = CourtKey;
    Connection.ShootaroundCourtType = Type;
    Connection.ShootaroundTeam = Teams.Home;
    Connection.ShootaroundAway = Teams.Away;
    Connection.ShootaroundRoomKey = RoomKey;
    Connection.ShootaroundCourtVersion = (Connection.ShootaroundCourtVersion || 0n) + 1n;
    const Court = BuildCourt(CourtKey, Connection.ShootaroundCourtVersion, Teams.Home, Type, Teams.Away, Generation);
    let Courts = Connection.SendObject(Court) ? 1 : 0;
    for (const Peer of Roster.Peers(Connection)) {
        if (Peer !== Connection && MyCourt.IsMyCourt(Peer) &&
            PlayerBody.GenerationForConnection(Peer) === Generation && Peer.SendObject(Court)) Courts++;
    }

    let Playing = 0;
    for (const Player of Players) {
        if (GrantPlaying(Player, GameId)) Playing++;
    }

    const Room = MyCourt.StartCribGame(Connection, RoomKey, Req);
    if (!Room) {
        Log.Error(
            `${Connection.Identifier} asked for a couch game but no MyCourt room could be ` +
                `resolved for it, so the room was not put into SCRIMMAGE.`,
        );
        return true;
    }
    if (Modern && Request.Id !== 0n) {
        let Starts = Connection.ShootaroundStartRequests;
        if (!Starts || Starts.RoomKey !== RoomKey) {
            Starts = Connection.ShootaroundStartRequests = { RoomKey, Ids: new Set() };
        }
        Starts.Ids.add(Request.Id);
    }
    Log.Info(
        `  NBA${Generation} MyCourt game start ${Hex(Command)} from ${Who}: ${CourtTypeLabel(Type, Generation)} court ` +
            `${CourtKey.toString(16).toUpperCase()} (menu mode ${Req.GameSlot}, COURT type ${Type}, home ${TeamLabel(Teams.Home)}, ` +
            `away ${TeamLabel(Teams.Away)}) to ${Courts}, ` +
            `${Playing} player object${Playing === 1 ? '' : 's'} with PLAYING and game ${Hex(GameId)}, ` +
            `room ${Room.ObjectId.toString(16).toUpperCase()} SCRIMMAGE at revision ${Room.Version}`,
    );
    return true;
}

module.exports = {
    Command,
    EndCommand,
    ConnectedCommand,
    Field,
    RequestPacket,
    RoomKeyOffset,
    StateOffset,
    GameIdOffset,
    CourtClass,
    CourtFlags,
    CourtType,
    CourtType2K22,
    CourtTypeName,
    CourtIndex,
    CourtBit,
    BuildCourt,
    CourtTypeFor,
    MenuModes2K22,
    ValidateGame2K22,
    TeamsFor,
    Read,
    ReadEnd,
    Handle,
    HandleEnd,
    GrantPlaying,
    Release,
    Reapply,
    PlayersFor,
};
