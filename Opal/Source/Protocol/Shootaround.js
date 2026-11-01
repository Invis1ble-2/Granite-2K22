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
const CourtLayout2K22 = require('./CourtLayout2K22');
const Requests = require('./Requests');
const { randomBytes: RandomBytes } = require('node:crypto');
const Init = require('../Activity/Init');

// One shared online game per private room, including its final revision for retries.
const OnlineGames = new Map();

const CourtClass = 0x2c4d49e3;
const CourtFlags = 116;
// Retail mycourt.ACTIVITY selects s656/s657; both baskets.SCNE register
// court_marker "main". FUN_14148AD80 keys graphics baskets by its name CRC,
// not the session COURT ID or the transform reference "main_marker".
const MyCourtArtBinding2K22 = Crc32('main') >>> 0;
const OnlineGameParameter2K22 = Init.DefaultRelayId;
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
    7: Object.freeze({ CourtType: 6, Teams: 'versus', MinPlayers: 4, MaxPlayers: 4 }),
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
    // FUN_14168C4B0 +0x384 is (non-AI participants > 1), not a solo flag.
    const Flag = Game.SoloFlag;
    if (Flag !== 0n && Flag !== 0 && Flag !== 1n && Flag !== 1) {
        return { Ok: false, Reason: 'invalid MyCOURT multiplayer-human flag' };
    }
    if (Flag === 1n || Flag === 1) {
        if (Count < 2) return { Ok: false, Reason: 'online MyCOURT needs at least two human participants' };
        return { Ok: true, Mode, Online: true };
    }
    const Humans = PlayersFor(Connection, Ids);
    if (Humans.length > 1) {
        return { Ok: false, Reason: 'multiple human participants require the online flag' };
    }
    return { Ok: true, Mode, Online: false };
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
        const Patched = PlayerBody.SetGameState(Connection.PlayerBody, State, GameId);
        if (!Patched.Ok) return false;
        Connection.PlayerBody = Patched.Body;
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
        const Decoded = PlayerBody.Decode(Connection.PlayerBody);
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

function RoomBallFor(Connection) {
    const Owner = MyCourt.OwnerFor(Connection);
    const Host = Owner === Connection.Puid ? Connection :
        Roster.InActivity(Connection.ActivityKey, Connection.RoomScope).find(Peer => Peer.Puid === Owner);
    return require('./Userdata').PreferredBallFor([Host]);
}

function BuildCourt(ObjectId, Version, Players, Type = null, Away = [], Generation = '2K19', Online = null, BallType = 0) {
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
        Fields.set(Bit.BallType, U32(Online ? (Online.Ended ? 0 : Online.BallType) : BallType));
        Fields.set(Bit.OverrideBallType, U32(0));
        Fields.set(Bit.SetupGate, Buffer.from([Online && !Online.Ended ? 1 : 0]));
        Fields.set(Bit.MatchId, U64(Online ? Online.MatchId : Key));
        if (Online) {
            // FUN_14173D480 waits for state 2 before building the online description.
            Fields.set(Bit.GameState, U32(Online.Ended ? 0 : Online.Ready ? 3 : 2));
            const Transport = Online.Transport;
            Fields.set(Bit.GameRelayToken, Online.Ended ? Buffer.alloc(16) : Transport.Token);
            Fields.set(Bit.GameRelayAddress, U32(Online.Ended ? 0 : Transport.address));
            for (const [Id, Value] of [[Bit.GameRelayPort, Transport.port], [Bit.GameRelayId, Transport.RelayId]]) {
                const Out = Buffer.alloc(2);
                Out.writeUInt16LE(Online.Ended ? 0 : Value);
                Fields.set(Id, Out);
            }
            const Parameter = Buffer.alloc(4);
            Parameter.writeUInt32LE(Online.Ended ? 0 : Online.GameParameter >>> 0);
            Fields.set(Bit.GameParameter, Parameter);
            for (const Side of ['Home', 'Away']) {
                const Blobs = Online.Ended ? [] : Online.Profiles[Side];
                const Ids = Side === 'Home' ? Team : Other;
                if (!Online.Ended && (!Array.isArray(Blobs) || Blobs.length !== Ids.length ||
                    Blobs.some((Blob, Index) => !Buffer.isBuffer(Blob) || Blob.length > 0x70000 ||
                        (Online.NativeCpuIds?.has(Ids[Index]) ? Blob.length !== 0 : !Blob.length)))) {
                    throw new Error(`invalid MyCOURT ${Side} USERDATA lineup`);
                }
                // Reusing a court across modes must not retain old IDs or profiles.
                Bit[`${Side}Players`].forEach((Id, Index) => Fields.set(Id, U64(Ids[Index] || 0n)));
                Bit[`${Side}Userdata`].forEach((Id, Index) => {
                    const Blob = Blobs[Index] || Buffer.alloc(0);
                    Fields.set(Id, Buffer.concat([U32(Blob.length), Blob]));
                });
            }
        }
        Fields.set(Bit.AwayCount, Buffer.from([Other.length]));
        if (!Online) Other.forEach((Player, Index) => Fields.set(Bit.AwayPlayers[Index], U64(Player)));
        Fields.set(Bit.HomeCount, Buffer.from([Team.length]));
        if (!Online) Team.forEach((Player, Index) => Fields.set(Bit.HomePlayers[Index], U64(Player)));
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

function MyCourtGameLabel(Type, Generation, MenuMode) {
    if (Generation === '2K22' && Number(MenuMode) === 7) return 'TWO_V_TWO';
    return CourtTypeLabel(Type, Generation);
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

function OnlineRoomKey(Connection) {
    if (!MyCourt.IsMyCourt(Connection) || !Connection.RoomScope ||
        PlayerBody.GenerationForConnection(Connection) !== '2K22') return null;
    return `${Connection.ActivityKey}:${Connection.RoomScope}`;
}

function OnlineMembers(Game) {
    return Roster.InActivity(Game.ActivityKey, Game.RoomScope).filter((Peer) =>
        MyCourt.IsMyCourt(Peer) && !MyCourt.IsRoomClosed(Peer) && PlayerBody.GenerationForConnection(Peer) === '2K22');
}

function PublishOnlineCourt(Game) {
    Game.Version += 1n;
    const Frame = BuildCourt(Game.CourtKey, Game.Version, Game.Ended ? [] : Game.Home,
        Game.CourtType, Game.Ended ? [] : Game.Away, '2K22', Game);
    const Sent = new Set();
    for (const Peer of OnlineMembers(Game)) {
        Peer.ShootaroundCourtVersion = Game.Version;
        if (Peer.SendObject(Frame)) Sent.add(Peer);
    }
    return Sent;
}

function PublishOnlinePlayer(Player, Game, Playing) {
    Player.Shootaround = Playing ? { GameId: CourtIndex, Since: Date.now() } : null;
    if (!PatchPlayer(Player, Playing ? GotNext.State.Playing : GotNext.State.None, Playing ? CourtIndex : 0))
        return false;
    if (Player.Closed) return true;
    const Frame = PlayerObject.FrameFor(Player);
    if (!Frame) return false;
    let OwnSent = false;
    for (const Peer of OnlineMembers(Game)) {
        const Sent = Peer.SendObject(Frame);
        if (Peer === Player) OwnSent = !!Sent;
    }
    return OwnSent;
}

function ReplayOnlineGame(Connection, Game) {
    PublishOnlineCourt(Game);
    MyCourt.RepublishRoom(Connection, Game.RoomKey);
}

function FinishOnlineGame(Connection, Game, Reason) {
    if (Game.Ended) {
        ReplayOnlineGame(Connection, Game);
        return;
    }
    // End once for the whole game; late completion/ending retries must not revive it.
    Game.Ended = true;
    Game.Ready = false;
    for (const Player of Game.Players) PublishOnlinePlayer(Player, Game, false);
    PublishOnlineCourt(Game);
    MyCourt.EndCribGame(Connection, Game.RoomKey);
    Game.Profiles = null;
    Game.Connected.clear();
    Log.Info(`MyCourt ${MyCourtGameLabel(Game.CourtType, '2K22', Game.MenuMode)} match ${Game.MatchId.toString(16).toUpperCase()} ` +
        `ended: ${Reason}; ${Game.Players.length} human participants released`);
}

function GamePeers(Connection) {
    const Game = Connection && Connection.ShootaroundOnline;
    if (!Game || Game.Ended || !Connection.Shootaround ||
        OnlineGames.get(OnlineRoomKey(Connection)) !== Game) return [];
    return Roster.Peers(Connection).filter((Peer) =>
        Game.Players.includes(Peer) && Peer.ShootaroundOnline === Game && !!Peer.Shootaround);
}

function ClearOnlineConnection(Connection) {
    delete Connection.ShootaroundOnline;
    delete Connection.ShootaroundCourtKey;
    delete Connection.ShootaroundCourtType;
    delete Connection.ShootaroundTeam;
    delete Connection.ShootaroundAway;
    delete Connection.ShootaroundRoomKey;
    delete Connection.ShootaroundBallType;
}

function Disconnect(Connection) {
    const Key = OnlineRoomKey(Connection);
    const Game = Key && OnlineGames.get(Key);
    if (!Game) return false;
    if (!Game.Ended && Game.Players.includes(Connection)) {
        FinishOnlineGame(Connection, Game, 'participant left MyCOURT');
    }
    ClearOnlineConnection(Connection);
    if (!OnlineMembers(Game).some((Peer) => Peer !== Connection)) OnlineGames.delete(Key);
    return true;
}

function CloseRoom(Connection) {
    const Key = OnlineRoomKey(Connection);
    if (!Key) return false;
    const Game = OnlineGames.get(Key);
    if (Game && !Game.Ended) FinishOnlineGame(Connection, Game, 'MyCOURT owner left');
    OnlineGames.delete(Key);
    const Members = new Set([Connection, ...Roster.Peers(Connection), ...(Game ? Game.Players : [])]);
    for (const Member of Members) {
        if (!MyCourt.IsMyCourt(Member) || Member.RoomScope !== Connection.RoomScope ||
            Member.ActivityKey !== Connection.ActivityKey) continue;
        if (Game && Member.ShootaroundOnline && Member.ShootaroundOnline !== Game) continue;
        ClearOnlineConnection(Member);
        Member.Shootaround = null;
        delete Member.ShootaroundBallType;
        delete Member.ShootaroundStartRequests;
        delete Member.ShootaroundOnlineReceipts;
    }
    return !!Game;
}

function InvalidateNativeIdentity(Connection, Reason) {
    const Game = OnlineGames.get(OnlineRoomKey(Connection));
    if (Game && !Game.Ended && Game.NativeCpuIds?.size) FinishOnlineGame(Connection, Game, Reason);
}

function StartOnlineGame2K22(Connection, Request, Req) {
    const Key = OnlineRoomKey(Connection);
    if (!Key) {
        Log.Error(`${Connection.Identifier} MyCourt start rejected: missing private room scope`);
        MyCourt.RepublishRoom(Connection, Request.ObjectId);
        return true;
    }
    const Members = Roster.InActivity(Connection.ActivityKey, Connection.RoomScope);
    let Players;
    let Game;
    try {
        const Mode = MenuModeFor(Req);
        const Teams = TeamsFor(Connection, Req, Mode?.CourtType, []);
        if (!Teams || Teams.Home.length > 5 || Teams.Away.length > 5)
            throw new Error('invalid MyCOURT teams or native court roster capacity exceeded');
        const Ids = Req.Players.map((Id) => BigInt(Id));
        Players = Ids.map((Id) => Members.find((Peer) => Peer.Puid === Id)).filter(Boolean);
        if (Players.length < 2 || Players.some((Peer) => Peer.Closed ||
            !MyCourt.IsMyCourt(Peer) || PlayerBody.GenerationForConnection(Peer) !== '2K22' ||
            Peer.Shootaround || Peer.GotNext?.Playing)) {
            throw new Error('online human participants must be idle and in the same MyCOURT');
        }
        const HumanIds = new Set(Players.map((Peer) => BigInt(Peer.Puid)));
        const UnknownIds = Ids.filter((Id) => !HumanIds.has(Id));
        const NativeCpuIds = UnknownIds.length
            ? require('./MyCourtIdentity').VerifiedIds(Connection, Players, UnknownIds) : new Set();
        if (Members.some((Peer) => Peer.Shootaround)) throw new Error('another MyCOURT game is already active');
        const Machines = Players.map((Peer) => Peer.MachineId);
        if (Machines.some((Id) => Id == null || BigInt(Id) === 0n) ||
            new Set(Machines.map(String)).size !== Players.length) throw new Error('missing or duplicate machine IDs');
        const Userdata = require('./Userdata');
        const Profiles = new Map(Players.map((Peer) => {
            const Data = Peer.Userdata && Userdata.Read(Peer.Userdata);
            if (!Userdata.Packaged(Peer) || !Data?.IsUserdata ||
                !Data.Blob.length || Data.DeclaredLength !== Data.Blob.length) {
                throw new Error(`complete USERDATA is not ready for ${Peer.Identifier}`);
            }
            if (!PlayerBody.SetGameState(Peer.PlayerBody, GotNext.State.Playing, CourtIndex).Ok)
                throw new Error(`complete PLAYER is not ready for ${Peer.Identifier}`);
            const Blob = Userdata.CourtProfile(Peer, Data.Blob);
            if (Blob.length > 0x70000) throw new Error('court USERDATA exceeds the native size limit');
            return [BigInt(Peer.Puid), Blob];
        }));
        for (const Id of NativeCpuIds) Profiles.set(Id, Buffer.alloc(0));
        const Relay = require('../Activity/Activities').Relay.Local;
        if (!Number.isInteger(Relay.Port) || Relay.Port < 1 || Relay.Port > 65535)
            throw new Error('GAME relay port must be in 1..65535');
        const Previous = OnlineGames.get(Key);
        let Version = Previous ? Previous.Version : 0n;
        for (const Peer of Members) {
            if ((Peer.ShootaroundCourtVersion || 0n) > Version) Version = Peer.ShootaroundCourtVersion;
        }
        const CourtKey = MyCourt.SessionObjectId(Connection.SessionId, BigInt(CourtIndex));
        Game = {
            ActivityKey: Connection.ActivityKey, RoomScope: Connection.RoomScope,
            RoomKey: Request.ObjectId, CourtKey, Version,
            MenuMode: Number(Req.GameSlot), CourtType: Mode.CourtType,
            MatchId: RandomBytes(8).readBigUInt64LE() || 1n,
            GameParameter: OnlineGameParameter2K22,
            BallType: RoomBallFor(Connection),
            Transport: {
                Token: RandomBytes(16),
                address: Init.PackEndpoint(Relay.Ip, Relay.Port).Address,
                // The endpoint relay ID and 32-bit GAME parameter are separate fields.
                port: Relay.Port, RelayId: Init.DefaultRelayId,
            },
            Home: Teams.Home, Away: Teams.Away,
            Profiles: {
                Home: Teams.Home.map((Id) => Profiles.get(Id)),
                Away: Teams.Away.map((Id) => Profiles.get(Id)),
            },
            Players, NativeCpuIds, Connected: new Set(), Ready: false, Ended: false,
        };
        // Complete packet construction before publishing any state to the clients.
        BuildCourt(CourtKey, Version + 1n, Game.Home, Game.CourtType, Game.Away, '2K22', Game);
    } catch (Failure) {
        Log.Error(`${Connection.Identifier} MyCourt start rejected: ${Failure.message}`);
        MyCourt.RepublishRoom(Connection, Request.ObjectId);
        return true;
    }

    OnlineGames.set(Key, Game);
    for (const Player of Players) {
        Player.ShootaroundOnline = Game;
        Player.ShootaroundCourtKey = Game.CourtKey;
        Player.ShootaroundCourtType = Game.CourtType;
        Player.ShootaroundTeam = Game.Home;
        Player.ShootaroundAway = Game.Away;
        Player.ShootaroundRoomKey = Game.RoomKey;
    }
    if (Request.Id !== 0n) {
        let Starts = Connection.ShootaroundStartRequests;
        if (!Starts || Starts.RoomKey !== Request.ObjectId)
            Starts = Connection.ShootaroundStartRequests = { RoomKey: Request.ObjectId, Ids: new Set() };
        Starts.Ids.add(Request.Id);
    }
    const Sent = PublishOnlineCourt(Game);
    if (Players.some((Player) => !Sent.has(Player))) {
        FinishOnlineGame(Connection, Game, 'court delivery failed');
        return true;
    }
    for (const Player of Players) {
        if (!PublishOnlinePlayer(Player, Game, true)) {
            FinishOnlineGame(Connection, Game, 'PLAYER delivery failed');
            return true;
        }
    }
    if (!MyCourt.StartCribGame(Connection, Game.RoomKey, Req)) {
        FinishOnlineGame(Connection, Game, 'room start failed');
        return true;
    }
    Log.Info(`MyCourt online ${MyCourtGameLabel(Game.CourtType, '2K22', Game.MenuMode)} match ${Game.MatchId.toString(16).toUpperCase()} ` +
        `(menu mode ${Game.MenuMode}): home ${TeamLabel(Game.Home)}, away ${TeamLabel(Game.Away)}; ` +
        `${Players.length} human profiles, ${Game.NativeCpuIds.size} verified native NBA invitees; awaiting ${Players.length} connections`);
    return true;
}

function IsPreviousOnlineRequest(Connection, Request, Game) {
    if (Request.Id === 0n) return false;
    const Receipts = Connection.ShootaroundOnlineReceipts ||
        (Connection.ShootaroundOnlineReceipts = new Map());
    const Key = `${Request.Command}:${Request.Id}`;
    const Previous = Receipts.get(Key);
    if (Previous !== undefined && Previous !== Game.MatchId) return true;
    Receipts.set(Key, Game.MatchId);
    // Bound the per-connection retransmission history; do not retain old game objects.
    if (Receipts.size > 128) Receipts.delete(Receipts.keys().next().value);
    return false;
}

function HandleConnected2K22(Connection, Request) {
    AckRequest2K22(Connection, Request);
    const Online = Connection.ShootaroundOnline;
    if (Online && OnlineGames.get(OnlineRoomKey(Connection)) === Online &&
        Request.ObjectId === Online.CourtKey && Online.Players.includes(Connection)) {
        if (IsPreviousOnlineRequest(Connection, Request, Online)) {
            ReplayOnlineGame(Connection, Online);
            return true;
        }
        if (!Online.Ended) {
            Online.Connected.add(Connection.Puid);
            Online.Ready = Online.Players.every((Player) => Online.Connected.has(Player.Puid));
        }
        PublishOnlineCourt(Online);
        Log.Info(`MyCourt ${MyCourtGameLabel(Online.CourtType, '2K22', Online.MenuMode)} connections ${Online.Connected.size}/${Online.Players.length}; ` +
            `court state ${Online.Ended ? 0 : Online.Ready ? 3 : 2}, revision ${Online.Version}`);
        return true;
    }
    if (Online) {
        Log.Verbose(`  stale MyCourt online connection-complete ignored`);
        return true;
    }
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
        Connection.ShootaroundAway || [], '2K22', null, Connection.ShootaroundBallType || 0));
    Log.Verbose(`  MyCourt connection-complete request ${Request.Id}, court revision ${Connection.ShootaroundCourtVersion}`);
    return true;
}

function HandleEnd(Connection, Bytes) {
    if (!MyCourt.IsMyCourt(Connection)) return false;
    const Modern = PlayerBody.GenerationForConnection(Connection) === '2K22';
    const Request = Modern ? ReadRequest2K22(Bytes) : null;
    if (Modern && (!Request || Request.Command !== EndCommand || Connection.Closed)) return false;
    if (Modern && MyCourt.IsRoomClosed(Connection)) {
        AckRequest2K22(Connection, Request);
        MyCourt.PublishClosedRoom(Connection);
        return true;
    }
    const End = ReadEnd(Bytes, Request ? Request.List : null);
    if (!End) return false;
    if (Modern) {
        AckRequest2K22(Connection, Request);
        const Online = Connection.ShootaroundOnline;
        if (Online && OnlineGames.get(OnlineRoomKey(Connection)) === Online &&
            (Request.ObjectId === 0n || Request.ObjectId === Online.CourtKey) && Online.Players.includes(Connection)) {
            if (IsPreviousOnlineRequest(Connection, Request, Online)) {
                ReplayOnlineGame(Connection, Online);
                return true;
            }
            FinishOnlineGame(Connection, Online, `result ${End.Result === null ? 'unknown' : Hex(End.Result)}`);
            return true;
        }
        if (Online) {
            Log.Verbose(`  stale MyCourt online end ignored`);
            return true;
        }
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
    Connection.ShootaroundBallType = 0;
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
    if (Modern && MyCourt.IsRoomClosed(Connection)) {
        if (![Command, ConnectedCommand, EndCommand].includes(Request.Command)) return false;
        AckRequest2K22(Connection, Request);
        MyCourt.PublishClosedRoom(Connection);
        return true;
    }
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
            const Online = OnlineGames.get(OnlineRoomKey(Connection));
            if (Online) ReplayOnlineGame(Connection, Online);
            else MyCourt.RepublishRoom(Connection, Request.ObjectId);
            return true;
        }
        const Checked = ValidateGame2K22(Connection, Req);
        if (!Checked.Ok) {
            Log.Error(`${Connection.Identifier} MyCourt start rejected: ${Checked.Reason}`);
            MyCourt.RepublishRoom(Connection, Request.ObjectId);
            return true;
        }
        const Online = OnlineGames.get(OnlineRoomKey(Connection));
        if (Online && !Online.Ended) {
            Log.Verbose(`  MyCourt start ignored: a match is already active in this room`);
            ReplayOnlineGame(Connection, Online);
            return true;
        }
        if (Checked.Online) return StartOnlineGame2K22(Connection, Request, Req);
        delete Connection.ShootaroundOnline;
        OnlineGames.delete(OnlineRoomKey(Connection));
    }
    Log.Info(
        `${Connection.Identifier} asked for a MyCourt ${MyCourtGameLabel(Type, Generation, Req.GameSlot)} ` +
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
    Connection.ShootaroundBallType = Modern ? RoomBallFor(Connection) : 0;
    const Court = BuildCourt(CourtKey, Connection.ShootaroundCourtVersion, Teams.Home, Type, Teams.Away,
        Generation, null, Connection.ShootaroundBallType);
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
        `  NBA${Generation} MyCourt game start ${Hex(Command)} from ${Who}: ${MyCourtGameLabel(Type, Generation, Req.GameSlot)} court ` +
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
    GamePeers,
    Disconnect,
    CloseRoom,
    InvalidateNativeIdentity,
};
