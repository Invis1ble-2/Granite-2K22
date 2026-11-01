// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const { Crc32 } = require('../Core/Crc32');
const Packets = require('./Packets');
const Boulevard = require('../Activity/StageSpots/BoulevardCourts2K19');
const StageSpots = require('../Activity/StageSpots/GamblingCourts2K22');
const SlamballSpots = require('../Activity/StageSpots/SlamballCourts2K22');
const AnteUp = require('../../../Shared/AnteUp');
const Zlib = require('node:zlib');

const CourtClass = 0x2c4d49e3;
const DataPacket = Packets.Wire('OBJECT_DATA');

const AnteUpSession = 0x003a190e;
const GamblingAllcourtsName = { GAMBLING_ONE_V_ONE: 'GAMBLING_ONE_V_ONE_1' };
const GamblingCourtTypeByTeam = StageSpots.CourtTypeByTeam;

function StageLowFor(MarkerName) {
    return Crc32(GamblingAllcourtsName[MarkerName] || MarkerName) >>> 0;
}

function StageGuidFor(MarkerName) {
    return (BigInt(AnteUpSession >>> 0) << 32n) | BigInt(StageLowFor(MarkerName));
}

function BuildPresentFlagMap() {
    const M = [];
    const Push = (Off) => M.push(Off);
    [
        0x84, 0xd0, 0xd8, 0xe0, 0xe2, 0xe4, 0xe8, 0xea, 0xee, 0xf2, 0x100, 0x102, 0x110, 0x118, 0x11a, 0x11c, 0x124,
    ].forEach(Push);
    for (let I = 0; I < 5; I++) Push(0x125 + I);
    for (let I = 0; I < 5; I++) Push(0x157 + I);
    for (let I = 0; I < 5; I++) Push(0x162 + I);
    for (let I = 0; I < 5; I++) Push(0x1bc + I);
    Push(0x1c2);
    for (let I = 0; I < 5; I++) Push(0x1c3 + I);
    for (let I = 0; I < 5; I++) Push(0x1f0 + I);
    for (let I = 0; I < 5; I++) Push(0x1fa + I);
    for (let I = 0; I < 5; I++) Push(0x254 + I);
    Push(0x25a);
    for (let I = 0; I < 3; I++) Push(0x25b + I);
    for (let I = 0; I < 3; I++) Push(0x338 + I);
    [0x500, 0x520, 0x528, 0x540, 0x560, 0x568, 0x580, 0x5a0, 0x5a8, 0x5aa, 0x5ac, 0x5ae].forEach(Push);
    for (let I = 0; I < 8; I++) Push(0x5af + I);
    for (let I = 0; I < 8; I++) Push(0x5be + I);
    for (let I = 0; I < 8; I++) Push(0x607 + I);
    [0x660, 0x668, 0x66c, 0x670, 0x680, 0x688, 0x68a, 0x68c, 0x68e, 0x690, 0x692, 0x698, 0x6a8, 0x6b0, 0x6b8].forEach(
        Push,
    );
    return M;
}
const PresentFlagMap = BuildPresentFlagMap();
const PresentFlagCount = PresentFlagMap.length;
const Bit = {
    CourtType: 0,
    CourtTransform: 1,
    CourtObjectId: 2,
    SetupGate: 11,
    MatchId: 12,
    GameState: 13,
    AwayCount: 15,
    AwayPlayers: [17, 18, 19, 20, 21],
    AwayUserdata: [32, 33, 34, 35, 36],
    HomeCount: 37,
    HomePlayers: [38, 39, 40, 41, 42],
    HomeUserdata: [53, 54, 55, 56, 57],
    GameRelayToken: 101,
    GameRelayAddress: 102,
    GameRelayPort: 103,
    GameRelayId: 104,
    GotnextCount: 58,
    Gotnext0x48Records: [59, 60, 61],
    Gotnext0x90Records: [62, 63, 64],
    WinnersLocation: [65, 66, 67],
    LosersLocation: [68, 69, 70],
    GamblingIndex: 108,
};

function ValidateTeams(Home, Away) {
    if (!Array.isArray(Home) || !Array.isArray(Away) || !Home.length || Home.length !== Away.length || Home.length > 5)
        throw new Error('Court needs two equal teams of 1..5 players');
    const All = [...Home, ...Away].map(BigInt);
    if (All.some((Id) => Id <= 0n || Id > 0xffffffffffffffffn) || new Set(All).size !== All.length)
        throw new Error('Court teams require unique nonzero uint64 player ids');
    return { Home: All.slice(0, Home.length), Away: All.slice(Home.length) };
}

const CourtTeams = new Map();

class BitWriter {
    constructor() {
        this.Bytes = [];
        this.Cur = 0;
        this.N = 0;
    }
    WriteBits(Value, N) {
        let V = BigInt(Value) & ((1n << BigInt(N)) - 1n);
        for (let I = N - 1; I >= 0; I--) {
            const BitValue = Number((V >> BigInt(I)) & 1n);
            this.Cur = ((this.Cur << 1) | BitValue) & 0xff;
            if (++this.N === 8) {
                this.Bytes.push(this.Cur);
                this.Cur = 0;
                this.N = 0;
            }
        }
    }
    Write64(Value) {
        this.WriteBits(BigInt(Value) & 0xffffffffffffffffn, 64);
    }
    Align() {
        if (this.N > 0) {
            this.Bytes.push((this.Cur << (8 - this.N)) & 0xff);
            this.Cur = 0;
            this.N = 0;
        }
    }
    WriteFlat(Buf) {
        for (const B of Buf) this.Bytes.push(B & 0xff);
    }
    Finish() {
        this.Align();
        return Buffer.from(this.Bytes);
    }
}

function BuildGotNextCourtDataPayload(Opts) {
    Opts = Opts || {};
    const Native22 = Opts.Generation === '2K22';
    if (Native22) return require('./CourtLayout2K22').Build(Opts);
    const Contract = Native22 ? require('./CourtLayout2K22') : null;
    const Bit = Contract ? Contract.Bit : module.exports.Bit;
    const FlagCount = Contract ? Contract.Count : PresentFlagCount;
    const HasCourtType = Number.isInteger(Opts.CourtType);
    const CourtType = HasCourtType ? Opts.CourtType >>> 0 : 0;
    const HasCourtTransform = Opts.CourtTransform != null;
    let CourtTransformValue = null;
    if (HasCourtTransform) {
        if (Buffer.isBuffer(Opts.CourtTransform) || ArrayBuffer.isView(Opts.CourtTransform)) {
            CourtTransformValue = Buffer.from(
                Opts.CourtTransform.buffer || Opts.CourtTransform,
                Opts.CourtTransform.byteOffset || 0,
                Opts.CourtTransform.byteLength == null ? Opts.CourtTransform.length : Opts.CourtTransform.byteLength,
            );
            CourtTransformValue = Buffer.from(CourtTransformValue);
        } else if (Array.isArray(Opts.CourtTransform) && Opts.CourtTransform.length === 16) {
            CourtTransformValue = Buffer.alloc(0x40);
            Opts.CourtTransform.forEach((Value, Index) => {
                if (!Number.isFinite(Value)) throw new Error('courtTransform contains a non-finite value');
                CourtTransformValue.writeFloatLE(Value, Index * 4);
            });
        } else {
            throw new Error('courtTransform must be a 64-byte buffer or 16-float array');
        }
        if (CourtTransformValue.length !== 0x40) {
            throw new Error('courtTransform must contain exactly 64 bytes');
        }
    }
    const HasCourtObjectId = Number.isInteger(Opts.CourtObjectId);
    const CourtObjectId = HasCourtObjectId ? Opts.CourtObjectId >>> 0 : 0;
    const Count = Math.max(0, Math.min(255, Opts.Count | 0));
    const Setup = Array.isArray(Opts.SetupRecords) ? Opts.SetupRecords.slice(0, 3) : [];
    const Spots = Array.isArray(Opts.SpotRecords) ? Opts.SpotRecords.slice(0, 3) : [];
    const SetupByIndex =
        Opts.SetupRecordIndex != null
            ? [{ index: Math.max(0, Math.min(2, Opts.SetupRecordIndex | 0)), Data: Opts.SetupRecord }]
            : Setup.map((Data, Index) => ({ index: Index, Data }));
    const SpotsByIndex =
        Opts.SpotRecordIndex != null
            ? [{ index: Math.max(0, Math.min(2, Opts.SpotRecordIndex | 0)), Data: Opts.SpotRecord }]
            : Spots.map((Data, Index) => ({ index: Index, Data }));

    const Bits = new Array(FlagCount).fill(0);
    const GameFields = new Map();
    const U64 = (Value) => {
        const B = Buffer.alloc(8);
        B.writeBigUInt64LE(BigInt(Value));
        return B;
    };
    if (!Native22 && Opts.GameState !== undefined) {
        const State = Buffer.alloc(4);
        State.writeUInt32LE(Opts.GameState);
        GameFields.set(Bit.GameState, State);
    }
    if (Opts.Teams) {
        const { Home, Away } = ValidateTeams(Opts.Teams.Home, Opts.Teams.Away);
        GameFields.set(Bit.SetupGate, Buffer.from([Opts.Online ? 1 : 0]));
        GameFields.set(Bit.MatchId, U64(Opts.Teams.MatchId ?? Opts.MatchId ?? Opts.CourtId));
        if (Opts.Teams.Transport) {
            const Transport = Opts.Teams.Transport;
            const Address = Buffer.alloc(4),
                Port = Buffer.alloc(2),
                RelayId = Buffer.alloc(2);
            Address.writeUInt32LE(Transport.address);
            Port.writeUInt16LE(Transport.port);
            RelayId.writeUInt16LE(Transport.RelayId);
            GameFields.set(Bit.GameRelayToken, Transport.Token);
            GameFields.set(Bit.GameRelayAddress, Address);
            GameFields.set(Bit.GameRelayPort, Port);
            GameFields.set(Bit.GameRelayId, RelayId);
        }
        GameFields.set(Bit.AwayCount, Buffer.from([Away.length]));
        Away.forEach((Id, I) => GameFields.set(Bit.AwayPlayers[I], U64(Id)));
        GameFields.set(Bit.HomeCount, Buffer.from([Home.length]));
        Home.forEach((Id, I) => GameFields.set(Bit.HomePlayers[I], U64(Id)));
        if (Opts.Profiles) {
            for (const Side of ['Home', 'Away']) {
                const Blobs = Opts.Profiles[Side];
                const Ids = Side === 'Home' ? Home : Away;
                if (!Array.isArray(Blobs) || Blobs.length !== Ids.length)
                    throw new Error(`Missing ${Side} court USERDATA`);
                Blobs.forEach((BlobData, I) => {
                    if (!Buffer.isBuffer(BlobData) || !BlobData.length || BlobData.length > 0x70000)
                        throw new Error(`Invalid ${Side} court USERDATA at seat ${I}`);
                    const Inflated = Zlib.inflateSync(BlobData, { maxOutputLength: 0x6d030 });
                    if (Inflated.length < 223256) throw new Error('Court USERDATA is truncated');
                    const Length = Buffer.alloc(4);
                    Length.writeUInt32LE(BlobData.length);
                    GameFields.set(
                        (Side === 'Home' ? Bit.HomeUserdata : Bit.AwayUserdata)[I],
                        Buffer.concat([Length, BlobData]),
                    );
                });
            }
        }
    }
    for (const [Key, Fields] of [
        ['WinnersLocation', Bit.WinnersLocation],
        ['LosersLocation', Bit.LosersLocation],
    ]) {
        const Line = Opts[Key];
        if (!Line) continue;
        const Vec4 = (V, W) => {
            if (!Array.isArray(V) || V.length < 3 || !V.slice(0, 3).every(Number.isFinite))
                throw new Error(`${Key} needs finite x/y/z vectors`);
            const B = Buffer.alloc(16);
            B.writeFloatLE(V[0], 0);
            B.writeFloatLE(V[1], 4);
            B.writeFloatLE(V[2], 8);
            B.writeFloatLE(W, 12);
            return B;
        };
        if (!Number.isFinite(Line.Facing)) throw new Error(`${Key} needs a finite facing`);
        const Facing = Buffer.alloc(4);
        Facing.writeInt32LE(Math.round(Line.Facing));
        GameFields.set(Fields[0], Vec4(Line.position, 1.0));
        GameFields.set(Fields[1], Vec4(Line.Step, 0.0));
        GameFields.set(Fields[2], Facing);
    }
    const HasGamblingIndex = Opts.GamblingIndex !== undefined;
    if (
        HasGamblingIndex &&
        (!Number.isInteger(Opts.GamblingIndex) || Opts.GamblingIndex < 0 || Opts.GamblingIndex >= 64)
    )
        throw new Error('Gambling index must address the 64-entry limit table');
    for (const BitValue of GameFields.keys()) Bits[BitValue] = 1;
    if (HasGamblingIndex) Bits[Bit.GamblingIndex] = 1;
    if (HasCourtType) Bits[Bit.CourtType] = 1;
    if (HasCourtTransform) Bits[Bit.CourtTransform] = 1;
    if (HasCourtObjectId) Bits[Bit.CourtObjectId] = 1;
    if (Count > 0) Bits[Bit.GotnextCount] = 1;
    for (const Rec of SpotsByIndex) Bits[Bit.Gotnext0x48Records[Rec.index]] = 1;
    for (const Rec of SetupByIndex) Bits[Bit.Gotnext0x90Records[Rec.index]] = 1;

    const Bw = new BitWriter();
    Bw.Write64(Opts.CourtId != null ? BigInt(Opts.CourtId) : 0n);
    Bw.Write64(Opts.OwnerId != null ? BigInt(Opts.OwnerId) : 0n);
    for (let I = 0; I < FlagCount; I++) Bw.WriteBits(Bits[I], 1);
    Bw.Align();

    if (HasCourtType) {
        const B = Buffer.alloc(4);
        B.writeUInt32LE(CourtType, 0);
        Bw.WriteFlat(B);
    }
    if (HasCourtTransform) Bw.WriteFlat(CourtTransformValue);
    if (HasCourtObjectId) {
        const B = Buffer.alloc(4);
        B.writeUInt32LE(CourtObjectId, 0);
        Bw.WriteFlat(B);
    }
    const OrderedGameFields = [...GameFields].sort(([A], [B]) => A - B);
    for (const [BitValue, Value] of OrderedGameFields) if (BitValue < Bit.GotnextCount) Bw.WriteFlat(Value);
    if (Count > 0) Bw.WriteFlat(Buffer.from([Count & 0xff]));
    for (const Rec of SpotsByIndex.sort((A, B) => A.index - B.index)) {
        const B = Buffer.alloc(0x48);
        Buffer.from(Rec.Data || []).copy(B, 0, 0, Math.min(Buffer.from(Rec.Data || []).length, 0x48));
        Bw.WriteFlat(B);
    }
    for (const Rec of SetupByIndex.sort((A, B) => A.index - B.index)) {
        const B = Buffer.alloc(0x90);
        Buffer.from(Rec.Data || []).copy(B, 0, 0, Math.min(Buffer.from(Rec.Data || []).length, 0x90));
        Bw.WriteFlat(B);
    }
    for (const [BitValue, Value] of OrderedGameFields) if (BitValue > Bit.Gotnext0x90Records[2]) Bw.WriteFlat(Value);
    if (HasGamblingIndex) Bw.WriteFlat(Buffer.from([Opts.GamblingIndex]));
    return Bw.Finish();
}

function RotateLocal(Layout, V, IsDirection) {
    const Radians = (Layout.Yaw * Math.PI) / 180.0;
    const C = Math.cos(Radians),
        S = Math.sin(Radians);
    const X = C * V[0] + S * V[2];
    const Z = -S * V[0] + C * V[2];
    if (IsDirection) return [X, V[1], Z];
    return [Layout.position[0] + X, Layout.position[1] + V[1], Layout.position[2] + Z];
}

function LocalBase(Layout, Location) {
    const Longitudinal = Layout.size === 3 ? 2255.52001953125 : 1432.56005859375;
    const OnCourtSide = 1524.0 * 0.5 + 80.0;
    const OffCourtSide = OnCourtSide + 160.0;
    const HalfLength = Longitudinal * 0.5;
    const FlipOffset = Layout.size === 3 ? 0.0 : -716.280029296875;
    const GroupSpan = 120.0 * (Layout.size - 1);
    const Near = Location.startsWith('NEARSIDE_');
    const SideMagnitude = Location.includes('_OFFCOURT_') ? OffCourtSide : OnCourtSide;
    const Side = Near ? -SideMagnitude : SideMagnitude;
    let Along;
    if (Location.endsWith('_RIGHT')) Along = HalfLength - 160.0 - GroupSpan + FlipOffset;
    else if (Location.endsWith('_LEFT')) Along = -HalfLength + 160.0 + FlipOffset;
    else if (Location.endsWith('_CENTER')) Along = -GroupSpan * 0.5 + FlipOffset;
    else throw new Error('unsupported retail Got Next location ' + Location);
    return [Side, 0.0, Along];
}

function ExitLocation(Location) {
    if (Location.startsWith('NEARSIDE_')) return Location.replace('NEARSIDE_', 'NEARSIDE_OFFCOURT_');
    if (Location.startsWith('FARSIDE_')) return Location.replace('FARSIDE_', 'FARSIDE_OFFCOURT_');
    throw new Error('unsupported retail Got Next exit location ' + Location);
}

function SnapCardinal(V) {
    return V.map((N) => (Math.abs(N) < 1e-6 ? 0 : Math.abs(N - 1) < 1e-6 ? 1 : Math.abs(N + 1) < 1e-6 ? -1 : N));
}

function CourtTransform(Layout) {
    const Radians = (Layout.Yaw * Math.PI) / 180.0;
    const C = SnapCardinal([Math.cos(Radians)])[0];
    const S = SnapCardinal([Math.sin(Radians)])[0];
    return [
        C,
        0.0,
        -S,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        S,
        0.0,
        C,
        0.0,
        Layout.position[0],
        Layout.position[1],
        Layout.position[2],
        1.0,
    ];
}

function FacingAngle(WorldFacing) {
    return Math.round((Math.atan2(WorldFacing[0], WorldFacing[2]) * 32768.0) / Math.PI);
}

function WriteVec4(Record, Offset, V) {
    Record.writeFloatLE(V[0], Offset + 0x00);
    Record.writeFloatLE(V[1], Offset + 0x04);
    Record.writeFloatLE(V[2], Offset + 0x08);
    Record.writeFloatLE(0.0, Offset + 0x0c);
}

function StageGeometry(Layout, Index) {
    return StageSpots.Geometry(Layout.StageCourt || Layout.SlamballCourt, Index);
}

function BuildSetupRecord(Layout, Index) {
    if (Index < 0 || Index >= Layout.Locations.length) throw new Error('invalid Got Next setup index ' + Index);
    const Record = Buffer.alloc(0x90);
    const Location = Layout.Locations[Index];
    const Geo = Layout.StageCourt || Layout.SlamballCourt ? StageGeometry(Layout, Index) : null;
    const Base0 = Geo ? Geo.Base : LocalBase(Layout, Location);
    const Exit0 = Geo ? Geo.Exit : LocalBase(Layout, ExitLocation(Location));
    const Step0 = Geo ? Geo.StepLocal : [0.0, 0.0, 120.0];
    const Face0 = Geo ? Geo.FacingLocal : [Location.startsWith('NEARSIDE_') ? 1.0 : -1.0, 0.0, 0.0];
    const Base = RotateLocal(Layout, Base0, false);
    const ExitBase = RotateLocal(Layout, Exit0, false);
    const Step = SnapCardinal(RotateLocal(Layout, Step0, true));
    const Facing = SnapCardinal(RotateLocal(Layout, Face0, true));

    WriteVec4(Record, 0x00, Base);
    WriteVec4(Record, 0x10, Step);
    Record.writeInt32LE(FacingAngle(Facing), 0x20);
    WriteVec4(Record, 0x30, ExitBase);
    WriteVec4(Record, 0x40, Step);
    Record.writeInt32LE(FacingAngle(Facing), 0x50);
    if (Geo) {
        Record.writeFloatLE(1, 0x0c);
        Record.writeFloatLE(1, 0x3c);
    }

    const FacingX = Face0[0];
    const XMin = Base0[0] - 120.0 - 75.0 * FacingX;
    const XMax = Base0[0] + 120.0 - 75.0 * FacingX;
    const ZMin = Base0[2] - 120.0;
    const ZMax = Base0[2] + (Geo ? Geo.Count : Layout.size) * 120.0;
    const Corners = [
        [XMin, 0.0, ZMin],
        [XMin, 0.0, ZMax],
        [XMax, 0.0, ZMax],
        [XMax, 0.0, ZMin],
    ];
    Corners.forEach((Corner, CornerIndex) => {
        const World = RotateLocal(Layout, Corner, false);
        Record.writeFloatLE(World[0], 0x60 + CornerIndex * 8);
        Record.writeFloatLE(World[2], 0x64 + CornerIndex * 8);
    });
    Record.writeUInt32LE(Geo ? Geo.Count : Layout.size, 0x80);
    Record[0x84] = Geo ? Number(Geo.SquadOnly) : Index === 2 ? 1 : 0;
    Record[0x85] = Geo ? Number(Geo.WinnerSpot) : Index === 0 ? 1 : 0;
    Record.writeUInt32LE(Geo ? Geo.Function : 0, 0x88);
    return Record;
}

function BuildOccupancyRecord(Layout, Index) {
    if (Index < 0 || Index >= Layout.Locations.length) throw new Error('invalid Got Next occupancy index ' + Index);
    const Record = Buffer.alloc(0x48);
    const SquadOnly = Layout.Queues ? Layout.Queues[Index].SquadOnly : Index === 2;
    Record.writeUInt32LE(SquadOnly ? 1 : 0, 0x38);
    return Record;
}

function BuildObjectFrame(ObjectId, Payload) {
    const F = Buffer.alloc(32 + Payload.length);
    F.writeUInt32LE(F.length, 0);
    F.writeUInt32BE(DataPacket >>> 0, 4);
    F.writeBigUInt64BE(BigInt.asUintN(64, BigInt(ObjectId)), 16);
    F.writeUInt32BE(CourtClass >>> 0, 24);
    F.writeUInt32BE(Payload.length >>> 0, 28);
    Payload.copy(F, 32);
    return F;
}

function LayoutFor(Entry) {
    return {
        CourtType: Entry.CourtType,
        size: Entry.TeamSize,
        position: Entry.Pos.slice(),
        Yaw: Entry.YawDeg || 0,
        Locations: Entry.Locations.slice(),
        Activity: 'neighborhood',
        Generation: Entry.Generation,
        name: Entry.name,
    };
}

function PostGameLocations(Layout) {
    if (!Layout || !Layout.Activity || !Layout.name) return null;
    try {
        const CourtTables = require('../Activity/CourtTables');
        const World = CourtTables.For(Layout.Activity, {ProtocolGeneration:Layout.Generation || '2K19'});
        const Raw = World && World.Courts.find((C) => C.Name === Layout.name);
        if (!Raw) return null;
        const Groups = require('./Courts')
            .GroupsFor(Raw, World.Room, World.SeqBase)
            .filter((G) => G.Kind === 'gotnext');
        return Groups.length ? require('./GotNext').PostGameLocations(Raw, Groups) : null;
    } catch (Failure) {
        Log.Error(`Post-game locations for ${Layout.name} could not be built: ${Failure.message}`);
        return null;
    }
}

function BuildParkCourt(Entry, Generation = '2K19') {
    const Layout = LayoutFor(Entry);
    const Guid = BigInt.asUintN(64, BigInt(Entry.id));
    const Payload = OccupancyPayload(Layout, Guid, 0n, Entry.id, ParkSeats(Entry), undefined, true, Generation);
    return { Guid, Frame: BuildObjectFrame(Guid, Payload) };
}

function ParkEntries(Generation) {
    return Generation === '2K22' ? require('../Activity/StageSpots/ShipCourts2K22').Courts : Boulevard.BoulevardCourts;
}
function BuildParkCourtByName(Name, Generation = '2K19') {
    const Entry = ParkEntries(Generation).find((E) => E.name === Name);
    return Entry ? BuildParkCourt(Entry, Generation) : null;
}

function IsBitstreamWorld(ActivityName) {
    return ActivityName === 'neighborhood' || ActivityName === 'stage' || ActivityName === 'cages';
}

function ParkFormat() {
    const V = (process.env.OPAL_PARK_FORMAT || 'bitstream').toLowerCase();
    return V === 'legacy' || V === 'split' ? V : 'bitstream';
}

function ParkCourtFormat(CourtName) {
    const Mode = ParkFormat();
    if (Mode === 'legacy') return 'legacy';
    if (Mode === 'split') {
        const Index = Boulevard.BoulevardCourts.findIndex((E) => E.name === CourtName);
        if (Index >= 0 && Index < 4) return 'legacy';
    }
    return 'bitstream';
}

function PublishParkCourts(Connection) {
    let Sent = 0,
        Records = 0;
    for (const Entry of ParkEntries(require('./PlayerBody').GenerationForConnection(Connection))) {
        const { Frame } = BuildParkCourt(Entry, require('./PlayerBody').GenerationForConnection(Connection));
        if (Connection.SendObject(Frame)) {
            Sent++;
            Records += Entry.Locations.length;
        }
    }
    Log.Info(
        `${Connection.Identifier} was given ${Sent} park courts ` +
            `carrying ${Records} spot records @ ${Log.Clock()}`,
    );
    return Sent;
}

function RefreshParkCourts(Connection) {
    let Sent = 0;
    for (const Entry of ParkEntries(require('./PlayerBody').GenerationForConnection(Connection))) {
        if (Connection.SendObject(BuildParkCourt(Entry, require('./PlayerBody').GenerationForConnection(Connection)).Frame)) Sent++;
    }
    Log.Info(`${Connection.Identifier} was re-sent ${Sent} Boulevard courts @ ${Log.Clock()}`);
    return Sent;
}

let NextOwner = 1;

function LiveSpotRecord(Layout, QueueIndex, HolderBySlot) {
    const Record = BuildOccupancyRecord(Layout, QueueIndex);
    for (let Slot = 0; Slot < HolderBySlot.length; Slot++) {
        const Holder = HolderBySlot[Slot];
        if (Holder) Record.writeBigUInt64BE(BigInt.asUintN(64, BigInt(Holder)), 8 + Slot * 8);
    }
    return Record;
}

function OccupancyPayload(Layout, CourtId, OwnerId, ObjectId, SeatsByQueue, Profiles, GameCourtValue = true, Generation = '2K19') {
    const SetupRecords = Layout.Locations.map((_, I) => BuildSetupRecord(Layout, I));
    const SpotRecords = Layout.Locations.map((_, I) => LiveSpotRecord(Layout, I, SeatsByQueue[I] || []));
    const Teams = GameCourtValue ? CourtTeams.get(BigInt(CourtId).toString()) : undefined;
    const PostGame = PostGameLocations(Layout);
    return BuildGotNextCourtDataPayload({
        Generation,
        CourtId,
        OwnerId,
        CourtType: Layout.CourtType,
        IsHalfCourt: Layout.IsHalfCourt,
        CourtTransform: CourtTransform(Layout),
        CourtObjectId: ObjectId >>> 0,
        // FUN_14148AD80 registers graphics baskets by the court marker name CRC.
        // Name/object identity alone does not populate the independent bit8 binding.
        ArtBinding: Generation === '2K22' ? Crc32(Layout.name) >>> 0 : undefined,
        Count: SetupRecords.length,
        SpotRecords,
        SetupRecords,
        WinnersLocation: PostGame ? PostGame.Winners : undefined,
        LosersLocation: PostGame ? PostGame.Losers : undefined,
        Teams,
        Profiles,
        Online: Boolean(Teams) && !Teams.NativeSolo,
        GameState: GameCourtValue ? (Teams ? (Teams.GameReady ? 3 : 2) : 0) : undefined,
        GamblingIndex: Layout.StageCourt ? StagePrice(Layout.StageCourt.name).index : undefined,
        BallType: Generation === '2K22' ? (Teams?.BallType ?? 0) : undefined,
        OverrideBallType: Generation === '2K22' ? 0 : undefined,
    });
}

function ParkLayoutFor(Entry) {
    return {
        CourtType: Entry.CourtType,
        size: Entry.TeamSize,
        position: Entry.Pos.slice(),
        Yaw: Entry.YawDeg || 0,
        Locations: Entry.Locations.slice(),
        Activity: 'neighborhood',
        Generation: Entry.Generation,
        name: Entry.name,
    };
}

function ParkSeats(Entry) {
    const CourtTables = require('../Activity/CourtTables');
    const Courts = require('./Courts');
    const Slots = require('./Slots');
    const World = CourtTables.For('neighborhood', {ProtocolGeneration:Entry.Generation || '2K19'});
    const Raw = World && World.Courts.find((C) => C.Name === Entry.name);
    const Empty = (N) => new Array(N).fill(0n);
    if (!Raw) return Entry.Locations.map(() => Empty(Entry.TeamSize));
    const Groups = Courts.GroupsFor(Raw, World.Room, World.SeqBase);
    const Windings = Groups.filter((G) => G.Kind === 'gotnext');
    const Squad = Groups.find((G) => G.Kind === 'squad');
    return Entry.Locations.map((_, Qi) => {
        const Group = Qi < Windings.length ? Windings[Qi] : Squad;
        if (!Group) return Empty(Entry.TeamSize);
        const Seats = Slots.SeatsOf(Group.SlotObjectId);
        if (!Seats.length) return Empty(Entry.TeamSize);
        return Seats.slice(0, Entry.TeamSize);
    });
}

function BuildParkCourtOccupancy(Entry, Profiles, Generation = Entry.Generation || '2K19') {
    const Layout = ParkLayoutFor(Entry);
    const Guid = BigInt.asUintN(64, BigInt(Entry.id));
    const Payload = OccupancyPayload(Layout, Guid, BigInt(NextOwner++), Entry.id >>> 0, ParkSeats(Entry), Profiles, true, Generation);
    return { Guid, Frame: BuildObjectFrame(Guid, Payload) };
}

function BuildParkCourtMirror(Entry, Generation = '2K19') {
    const Layout = ParkLayoutFor(Entry);
    const Retail = Entry.RetailCourtId >>> 0;
    const Payload = OccupancyPayload(
        Layout,
        BigInt(Retail),
        BigInt(NextOwner++),
        Retail,
        ParkSeats(Entry),
        undefined,
        false,
        Generation,
    );
    return { Guid: BigInt.asUintN(64, BigInt(Retail)), Frame: BuildObjectFrame(BigInt(Retail), Payload) };
}

function QueueSeats(MarkerCourt, Activity = 'stage') {
    const CourtTables = require('../Activity/CourtTables');
    const Courts = require('./Courts');
    const Slots = require('./Slots');
    const World = CourtTables.For(Activity, {ProtocolGeneration:'2K22'});
    const Raw = World.Courts.find((C) => C.Name === MarkerCourt.name);
    const Groups = Raw ? Courts.GroupsFor(Raw, World.Room, World.SeqBase) : [];
    return MarkerCourt.Queues.map((Queue, Index) => {
        const Group = Groups.find((G) => G.QueueIndex === Index);
        const Seats = Group ? Slots.SeatsOf(Group.SlotObjectId) : [];
        return Array.from({length:Queue.Count}, (_, I) => Seats[I] || 0n);
    });
}

function BuildStageCourtOccupancy(MarkerCourt, Profiles) {
    return BuildStageCourt(MarkerCourt, Profiles, BigInt(NextOwner++));
}

function SendToActivity(Connection, Frame) {
    let Sent = 0;
    if (!Connection.Closed && Connection.SendObject(Frame)) Sent++;
    try {
        const Roster = require('./Roster');
        for (const Peer of Roster.Peers(Connection)) {
            if (!Peer.Closed && Peer.ActivityName === Connection.ActivityName && Peer.SendObject(Frame)) Sent++;
        }
    } catch (_) {}
    return Sent;
}

function BroadcastCourtGroup(Connection, Group) {
    if (!Group) return { Court: 0, Mirror: 0 };
    const CourtTables = require('../Activity/CourtTables');
    const World = CourtTables.For(Connection.ActivityName, Connection);
    if (!World) return { Court: 0, Mirror: 0 };
    const Raw = World.Courts.find((C) => C.Name === Group.CourtName);
    if (!Raw) return { Court: 0, Mirror: 0 };

    if (Connection.ActivityName === 'neighborhood') {
        const Entry = ParkEntries(require('./PlayerBody').GenerationForConnection(Connection)).find((E) => E.name === Raw.Name);
        if (!Entry) return { Court: 0, Mirror: 0 };
        const Generation = require('./PlayerBody').GenerationForConnection(Connection);
        const { Frame } = BuildParkCourtOccupancy(Entry, undefined, Generation);
        const Court = SendToActivity(Connection, Frame);
        // Ship Name and physical court IDs are identical. During a game a
        // queue-only mirror would overwrite the active roster/state.
        const Active = CourtTeams.has(BigInt(Entry.id).toString());
        const Mirrored = Generation === '2K22' && Active ? 0 :
            SendToActivity(Connection, BuildParkCourtMirror(Entry, Generation).Frame);
        Log.Verbose(
            `  occupancy broadcast for ${Raw.Name}: court ${Court}, ` + `physical mirror ${Mirrored} recipient(s)`,
        );
        return { Court, Mirror: Mirrored };
    }

    if (Connection.ActivityName === 'stage') {
        const MarkerCourt = StageSpots.GamblingCourts.find((M) => M.name === Raw.Name);
        if (!MarkerCourt) return { Court: 0, Mirror: 0 };
        const { Frame } = BuildStageCourtOccupancy(MarkerCourt);
        const Court = SendToActivity(Connection, Frame);
        Log.Verbose(`  occupancy broadcast for ${Raw.Name}: ${Court} recipient(s)`);
        return { Court, Mirror: 0 };
    }

    if (Connection.ActivityName === 'cages') {
        const Entry = SlamballSpots.Courts.find((C) => C.name === Raw.Name);
        if (!Entry) return { Court: 0, Mirror: 0 };
        const { Frame } = BuildSlamballCourtOccupancy(Entry);
        return { Court: SendToActivity(Connection, Frame), Mirror: 0 };
    }

    return { Court: 0, Mirror: 0 };
}
function RepublishParkCourt(Connection, CourtKey) {
    const Id = BigInt.asUintN(64, BigInt(CourtKey));
    const Entry = ParkEntries(require('./PlayerBody').GenerationForConnection(Connection)).find((E) => BigInt.asUintN(64, BigInt(E.id)) === Id);
    if (!Entry) return false;
    const { Frame } = BuildParkCourt(Entry, require('./PlayerBody').GenerationForConnection(Connection));
    let Sent = 0;
    if (Connection.SendObject(Frame)) Sent++;
    try {
        const Roster = require('./Roster');
        for (const Peer of Roster.Peers(Connection)) {
            if (Peer.ActivityName === Connection.ActivityName && Peer.SendObject(Frame)) Sent++;
        }
    } catch (_) {}
    return Sent > 0;
}

function StageLayoutFor(MarkerCourt) {
    return StageSpots.LayoutFor(MarkerCourt);
}

function StagePrice(Name) {
    const Price = AnteUp.ByName(Name);
    if (!Price) throw new Error(`No shared Ante-Up price index for ${Name}`);
    return Price;
}

function BuildStageCourt(MarkerCourt, Profiles, OwnerId = 0n) {
    const Layout = StageLayoutFor(MarkerCourt);
    const Guid = StageGuidFor(MarkerCourt.name);
    const Low = StageLowFor(MarkerCourt.name);
    const Payload = OccupancyPayload(Layout, Guid, OwnerId, Low, QueueSeats(MarkerCourt), Profiles, true, '2K22');
    return { Guid, Low, Frame: BuildObjectFrame(Guid, Payload) };
}

function GameCourt(Activity, Name, Generation = '2K19') {
    if (Activity === 'stage') {
        const Entry = StageSpots.GamblingCourts.find((C) => C.name === Name);
        if (Entry) return { Entry, Guid: StageGuidFor(Name), Build: BuildStageCourtOccupancy };
    } else if (Activity === 'neighborhood') {
        const Entry = ParkEntries(Generation).find((C) => C.name === Name);
        if (Entry) return { Entry, Guid: BigInt(Entry.id), Build: BuildParkCourtOccupancy };
    } else if (Activity === 'cages') {
        const Entry = SlamballSpots.Courts.find((C) => C.name === Name);
        if (Entry) return { Entry, Guid: BigInt(Entry.id), Build: BuildSlamballCourtOccupancy };
    }
    throw new Error(`Unknown ${Activity} game court ${Name}`);
}

function BuildSpectatorCourtFrame(Activity, Name, CourtType, Generation = '2K19') {
    if (!Number.isInteger(CourtType)) return null;
    if (Activity === 'neighborhood') {
        const Entry = ParkEntries(Generation).find((E) => E.name === Name);
        if (!Entry) return null;
        const Layout = { ...ParkLayoutFor(Entry), CourtType: CourtType >>> 0 };
        const Guid = BigInt.asUintN(64, BigInt(Entry.id));
        const Payload = OccupancyPayload(Layout, Guid, BigInt(NextOwner++), Entry.id >>> 0, ParkSeats(Entry), undefined, true, Entry.Generation || '2K19');
        return BuildObjectFrame(Guid, Payload);
    }
    if (Activity === 'stage') {
        const MarkerCourt = StageSpots.GamblingCourts.find((M) => M.name === Name);
        if (!MarkerCourt) return null;
        const Layout = { ...StageLayoutFor(MarkerCourt), CourtType: CourtType >>> 0 };
        const Guid = StageGuidFor(MarkerCourt.name);
        const Payload = OccupancyPayload(
            Layout,
            Guid,
            BigInt(NextOwner++),
            StageLowFor(MarkerCourt.name),
            QueueSeats(MarkerCourt),
            undefined,
            true,
            '2K22',
        );
        return BuildObjectFrame(Guid, Payload);
    }
    return null;
}

function PrepareGameTeams(Activity, Name, Home, Away, Profiles, Generation = '2K19', Options = {}) {
    const Court = GameCourt(Activity, Name, Generation);
    if (Activity === 'neighborhood' && ParkCourtFormat(Name) !== 'bitstream')
        throw new Error('Neighborhood game start requires OPAL_PARK_FORMAT=bitstream for this court');
    const Teams = ValidateTeams(Home, Away);
    if (Teams.Home.length !== Court.Entry.TeamSize) throw new Error('Roster does not match court team size');
    const { randomBytes: RandomBytes } = require('node:crypto');
    if (Options.NativeSolo && Options.NativePark) throw new Error('conflicting native park modes');
    if (Options.NativePark) {
        const Mixed = Options.NativePark, Ids = [...Teams.Home, ...Teams.Away];
        const Cpu = Ids.filter(Id => require('./ParkCpuWire').IsCpu(Id));
        const Humans = Ids.filter(Id => !Cpu.includes(Id));
        if (!['neighborhood', 'cages'].includes(Activity) || Generation !== '2K22' ||
            !(Activity === 'cages' ? [2, 3, 5] : [2, 3]).includes(Teams.Home.length) ||
            !Cpu.length || Humans.length < 2 || !Mixed.MatchId || !Array.isArray(Mixed.Humans) ||
            Mixed.Humans.length !== Humans.length || new Set(Mixed.Humans).size !== Humans.length ||
            Mixed.Humans.some(Id => !Humans.includes(Id)))
            throw new Error('Mixed native park requires the exact human roster and CPU vacancies');
        Teams.NativePark = { Humans: Humans.slice(), Cpu, MatchId: Mixed.MatchId };
        Teams.MatchId = Mixed.MatchId;
    }
    if (Options.NativeSolo) {
        const Solo = Options.NativeSolo;
        const Cpu = [...Teams.Home, ...Teams.Away].filter(Id => (Id & 0xfffff00000000000n) === 0x0222c00000000000n);
        const Humans = [...Teams.Home, ...Teams.Away].filter(Id => !Cpu.includes(Id));
        if (!['neighborhood', 'cages'].includes(Activity) || Generation !== '2K22' ||
            !(Activity === 'cages' ? [2, 3, 5] : [2, 3]).includes(Teams.Home.length) ||
            Cpu.length !== Teams.Home.length * 2 - 1 || Humans.length !== 1 || Humans[0] !== Solo.Owner || !Solo.MatchId)
            throw new Error('Native solo court requires one human and native CPU fill in a supported 2K22 court');
        Teams.NativeSolo = { Owner: Solo.Owner, Cpu, MatchId: Solo.MatchId };
        Teams.MatchId = Solo.MatchId;
    }
    if (Generation === '2K22') {
        const BallType = Options.BallType ?? 0;
        if (!Number.isInteger(BallType) || BallType < 0 || BallType > 0xffffffff)
            throw new Error('invalid court ball resource CRC');
        // Freeze one shared ball before any court publication or PLAYING grant.
        Teams.BallType = BallType;
    }
    const Relay = require('../Activity/Activities').Relay.Local;
    if (!Number.isInteger(Relay.Port) || Relay.Port < 1 || Relay.Port > 65535)
        throw new Error('GAME relay port must be in 1..65535');
    if (!Teams.NativeSolo) Teams.Transport = {
        Token: RandomBytes(16),
        address: require('../Activity/Init').PackEndpoint(Relay.Ip, Relay.Port).Address,
        port: Relay.Port,
        RelayId: Teams.NativePark ? require('./ParkCpuWire').RelayId : 0,
    };
    Teams.MatchId ??= RandomBytes(8).readBigUInt64LE() || 1n;
    Teams.Activity = Activity;
    Teams.Generation = Generation;
    Teams.name = Name;
    Teams.Phase = 'preparing';
    Teams.AwayReleased = false;
    Teams.Ended = false;
    Teams.Reports = new Map();
    const Guid = Court.Guid;
    const Previous = CourtTeams.get(Guid.toString());
    CourtTeams.set(Guid.toString(), Teams);
    try {
        return Court.Build(Court.Entry, Profiles);
    } catch (Failure) {
        if (Previous) CourtTeams.set(Guid.toString(), Previous);
        else CourtTeams.delete(Guid.toString());
        throw Failure;
    }
}

function ClearStageTeams(Name) {
    return ClearGameTeams('stage', Name);
}

function PrepareStageTeams(Name, Home, Away, Profiles) {
    return PrepareGameTeams('stage', Name, Home, Away, Profiles);
}

function ClearGameTeams(Activity, Name, Generation = '2K19') {
    return CourtTeams.delete(GameCourt(Activity, Name, Generation).Guid.toString());
}

function GameTeams(Activity, Name, Generation = '2K19') {
    return CourtTeams.get(GameCourt(Activity, Name, Generation).Guid.toString()) || null;
}

function MarkStageGameConnected(Name, Puid) {
    return MarkGameConnected('stage', Name, Puid);
}

function MarkGameConnected(Activity, Name, Puid, Generation = '2K19') {
    const Teams = CourtTeams.get(GameCourt(Activity, Name, Generation).Guid.toString());
    if (!Teams) return { Accepted: false, Advanced: false };
    const Expected = (Teams.NativeSolo ? [Teams.NativeSolo.Owner] :
        Teams.NativePark ? Teams.NativePark.Humans : [...Teams.Home, ...Teams.Away]).map(String);
    const Id = String(Puid);
    if (!Expected.includes(Id)) return { Accepted: false, Advanced: false };
    Teams.Connected ??= new Set();
    Teams.Connected.add(Id);
    const Advanced = !Teams.GameReady && Expected.every((P) => Teams.Connected.has(P));
    if (Advanced) {
        Teams.GameReady = true;
        Teams.Phase = 'playing';
    }
    return { Accepted: true, Advanced, Ready: Teams.Connected.size, total: Expected.length };
}

function PublishStageCourts(Connection) {
    let Sent = 0,
        Records = 0;
    for (const MarkerCourt of StageSpots.GamblingCourts) {
        const { Frame } = BuildStageCourt(MarkerCourt);
        if (Connection.SendObject(Frame)) {
            Sent++;
            Records += MarkerCourt.Queues.length;
        }
    }
    Log.Info(
        `${Connection.Identifier} was given ${StageSpots.GamblingCourts.length} Ante-Up courts ` +
            `carrying ${Records} spot records @ ${Log.Clock()}`,
    );
    return Sent;
}

function RefreshStageCourts(Connection) {
    let Sent = 0;
    for (const MarkerCourt of StageSpots.GamblingCourts) {
        if (Connection.SendObject(BuildStageCourt(MarkerCourt).Frame)) Sent++;
    }
    Log.Info(`${Connection.Identifier} was re-sent ${Sent} Ante-Up courts @ ${Log.Clock()}`);
    return Sent;
}

function RepublishStageCourt(Connection, CourtKey) {
    const Key = BigInt.asUintN(64, BigInt(CourtKey));
    const Low = Number(Key & 0xffffffffn) >>> 0;
    const MarkerCourt = StageSpots.GamblingCourts.find((C) => StageLowFor(C.name) === Low);
    if (!MarkerCourt) return false;
    const { Frame } = BuildStageCourt(MarkerCourt);
    let Sent = 0;
    if (Connection.SendObject(Frame)) Sent++;
    try {
        const Roster = require('./Roster');
        for (const Peer of Roster.Peers(Connection)) {
            if (Peer.ActivityName === Connection.ActivityName && !Peer.CourtProtocolPending &&
                Peer.CourtsPublished && Peer.SendObject(Frame)) Sent++;
        }
    } catch (_) {}
    return Sent > 0;
}

function BuildSlamballCourt(Entry, Profiles, OwnerId = 0n) {
    const Guid = BigInt(Entry.id);
    const Payload = OccupancyPayload(SlamballSpots.LayoutFor(Entry), Guid, OwnerId, Entry.id,
        QueueSeats(Entry, 'cages'), Profiles, true, '2K22');
    return { Guid, Frame: BuildObjectFrame(Guid, Payload) };
}

function BuildSlamballCourtOccupancy(Entry, Profiles) {
    return BuildSlamballCourt(Entry, Profiles, BigInt(NextOwner++));
}

function PublishSlamballCourts(Connection, Refresh = false) {
    let Sent = 0;
    for (const Entry of SlamballSpots.Courts) {
        if (Connection.SendObject(BuildSlamballCourt(Entry).Frame)) Sent++;
    }
    Log.Info(
        `${Connection.Identifier} ${Refresh ? 'was re-sent' : 'was given'} ` +
        `${Sent}/${SlamballSpots.Courts.length} cages courts (2K22; six trampoline courts + FULL1 moat) @ ${Log.Clock()}`,
    );
    return Sent;
}

function RepublishSlamballCourt(Connection, CourtKey) {
    const Low = Number(BigInt.asUintN(64, BigInt(CourtKey)) & 0xffffffffn) >>> 0;
    const Entry = SlamballSpots.Courts.find((C) => C.id === Low);
    return Entry ? SendToActivity(Connection, BuildSlamballCourt(Entry).Frame) > 0 : false;
}

module.exports = {
    PrepareGameTeams,
    ClearGameTeams,
    GameTeams,
    MarkGameConnected,
    PrepareStageTeams,
    ClearStageTeams,
    MarkStageGameConnected,
    ValidateTeams,
    CourtClass,
    DataPacket,
    AnteUpSession,
    GamblingAllcourtsName,
    GamblingCourtTypeByTeam,
    StageLowFor,
    StageGuidFor,
    StageLayoutFor,
    BuildStageCourt,
    PublishStageCourts,
    RefreshStageCourts,
    RepublishStageCourt,
    PublishSlamballCourts,
    RepublishSlamballCourt,
    ParkFormat,
    ParkCourtFormat,
    BuildParkCourtByName,
    ParkEntries,
    LiveSpotRecord,
    BuildParkCourtOccupancy,
    BuildParkCourtMirror,
    BuildStageCourtOccupancy,
    BroadcastCourtGroup,
    BuildSpectatorCourtFrame,
    PresentFlagCount,
    Bit,
    BitWriter,
    BuildPresentFlagMap,
    BuildGotNextCourtDataPayload,
    RotateLocal,
    LocalBase,
    ExitLocation,
    SnapCardinal,
    CourtTransform,
    FacingAngle,
    WriteVec4,
    BuildSetupRecord,
    BuildOccupancyRecord,
    BuildObjectFrame,
    LayoutFor,
    BuildParkCourt,
    PostGameLocations,
    IsBitstreamWorld,
    PublishParkCourts,
    RefreshParkCourts,
    RepublishParkCourt,
};
