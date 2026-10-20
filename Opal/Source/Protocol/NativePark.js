// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Fs = require('node:fs');
const Path = require('node:path');
const Crypto = require('node:crypto');
const Log = require('../Core/Log');
const Wire = require('./NativeParkWire');
const Roster = require('./Roster');
const Slots = require('./Slots');
const CourtData = require('./CourtData');
const PlayerObject = require('./PlayerObject');
const Body22 = require('./PlayerBody2K22');
const ObjectFrame = require('../Codec/ObjectFrame');
const ConfigPath = Path.resolve(__dirname, '../..', 'NativeSoloPark.json');
const Controls = new Map(), Waiting = new Map(), Courts = new Map(), Participants = new Map();
const WaitMs = 10000;
const Nonce = () => Crypto.randomBytes(8).readBigUInt64LE() || 1n;
const KeyFor = (C, Found) => `${C.ActivityKey}:${C.RoomScope || ''}:${Found.Raw.Name}`;

function Enabled(TeamSize) {
    try {
        const C = JSON.parse(Fs.readFileSync(ConfigPath, 'utf8'));
        return C.Enabled === true && (TeamSize === 2 ? C.TwoOnTwo : C.ThreeOnThree) !== false;
    } catch (_) { return false; }
}
function Notice(C, Why) {
    if (C.NativeParkNotice === Why) return;
    C.NativeParkNotice = Why;
    Log.Info(`Native park fill withheld for ${C.Identifier}: ${Why}`);
}
function Snapshot(C, Found) {
    const Size = Found.Raw.TeamSize, Next = require('./GotNext');
    if (C.ActivityName !== 'neighborhood' || ![2, 3].includes(Size) || !Enabled(Size) ||
        require('./PlayerBody').GenerationForConnection(C) !== '2K22' ||
        CourtData.ParkCourtFormat(Found.Raw.Name) !== 'bitstream' || Found.Groups.length !== 2 ||
        Found.Groups.some(G => G.Anchors.length !== Size)) return null;
    const Seats = Found.Groups.map(G => Slots.StateFor(G.SlotObjectId, Size).Seats.slice());
    if (Seats.some(S => S.length !== Size)) return null;
    const Ids = Seats.flat().filter(Id => Id !== 0n);
    if (Ids.length < 2 || Ids.length >= Size * 2 || new Set(Ids).size !== Ids.length || Ids.some(Wire.IsCpu)) return null;
    const ByPuid = new Map(Roster.InActivity(C.ActivityKey, C.RoomScope || null).map(P => [P.Puid, P]));
    const Members = [];
    for (let Side = 0; Side < 2; ++Side) for (let Seat = 0; Seat < Size; ++Seat) {
        const Id = Seats[Side][Seat];
        if (!Id) continue;
        const Player = ByPuid.get(Id), Spot = Player?.GotNext;
        const Group = Spot && Next.QueueFor(Player, Spot.Court, Spot.Slot);
        if (!Player || Player.Closed || !Player.PlayerBody || !Spot || Spot.Playing || Spot.Seat !== Seat ||
            Group?.SlotObjectId !== Found.Groups[Side].SlotObjectId ||
            require('./PlayerBody').GenerationForConnection(Player) !== '2K22' ||
            Next.FindState(Player.PlayerBody, Next.State.GotNext) < 0 || !Player.MachineId) return null;
        const Data = Player.Userdata && require('./Userdata').Read(Player.Userdata);
        if (!Data?.IsUserdata || Data.DeclaredLength !== Data.Blob.length) return null;
        Members.push({ Connection: Player, Spot, Side, Seat, Blob: Buffer.from(Data.Blob), Control: Controls.get(Player.Id) });
    }
    if (new Set(Members.map(M => String(M.Connection.MachineId))).size !== Members.length) return null;
    return { Seats, Members };
}
function SameQueue(A, B) {
    return Boolean(B && A.Seats.flat().every((Id, I) => Id === B.Seats.flat()[I]) &&
        A.Members.length === B.Members.length && A.Members.every((M, I) => {
            const N = B.Members[I];
            return M.Connection === N.Connection && M.Spot === N.Spot && M.Control === N.Control;
        }));
}
function CancelWait(C) {
    let Changed = false;
    for (const [Key, W] of Waiting) if (W.Snapshot.Members.some(M => M.Connection === C)) {
        clearTimeout(W.Timer); Waiting.delete(Key); Changed = true;
    }
    return Changed;
}
function Remove(P, Why, ReleasePlayers) {
    if (P.Done) return false;
    P.Done = true;
    Courts.delete(P.Key); clearInterval(P.Timer);
    for (const M of P.Members) if (Participants.get(M.Connection.Id) === P) Participants.delete(M.Connection.Id);
    const Game = CourtData.GameTeams(P.ActivityName, P.Found.Raw.Name, '2K22');
    if (Game?.NativePark?.MatchId === P.MatchId) {
        Game.Ended = true;
        CourtData.ClearGameTeams(P.ActivityName, P.Found.Raw.Name, '2K22');
    }
    for (const Id of P.Cpu) {
        for (const Group of P.Found.Groups) Slots.ReleaseFrom(Group.SlotObjectId, Id);
        for (const M of P.Members) if (!M.Connection.Closed) {
            try { M.Connection.SendObject(PlayerObject.DestroyFrameFor({ Puid: Id })); }
            catch (_) { /* Cleanup continues for every participant. */ }
        }
    }
    if (ReleasePlayers) for (const M of P.Members) {
        if (M.Connection.GotNext !== M.Spot) continue;
        try {
            if (M.Connection.Closed) { Slots.Release(M.Connection.Puid); M.Connection.GotNext = null; }
            else require('./GotNext').Release(M.Connection);
        } catch (Failure) { Log.Error(`Native park player cleanup failed: ${Failure.message}`); }
    }
    CourtData.BroadcastCourtGroup(P.Context, P.Found.Groups[0]);
    Log.Info(`Native park ${P.TeamSize}v${P.TeamSize} ${P.MatchId.toString(16)} ended: ${Why}; shared CPU and court state cleared`);
    return true;
}
function Stop(C, Why = 'queue changed') {
    const Cancelled = CancelWait(C), P = Participants.get(C.Id);
    if (!P) return Cancelled;
    return Remove(P, Why, P.Phase === 'starting' || P.Phase === 'playing');
}
function Disconnect(C) {
    Stop(C, 'participant disconnected or changed activity');
    Controls.delete(C.Id); C.NativeParkNotice = null;
}
function Finish(C, Found, Game, Why) {
    const P = Participants.get(C.Id);
    if (!Game.NativePark || Game.Ended || !P || P.MatchId !== Game.NativePark.MatchId) return false;
    return Remove(P, `game end (${Why})`, true);
}
function PublishCpu(P) {
    P.Phase = 'preloading'; P.PreloadAt = Date.now();
    for (const Id of P.Cpu) {
        const I = P.Players.indexOf(Id);
        const Frame = require('./NativeSoloPark').FrameFor(Id, P.Seeds[I]);
        P.Bodies.set(Id, Buffer.from(Frame.subarray(32)));
        for (const M of P.Members) if (!M.Connection.SendObject(Frame)) throw new Error('CPU publication failed');
    }
    Log.Info(`Native park ${P.Found.Raw.Name}: all ${P.Members.length} clients armed; published ${P.Cpu.length} shared CPU objects`);
}
function Commit(P) {
    if (!SameQueue(P.Snapshot, Snapshot(P.Anchor, P.Found))) throw new Error('court seats changed before commit');
    if (CourtData.GameTeams(P.ActivityName, P.Found.Raw.Name, '2K22')) throw new Error('court already has a game');
    for (const Id of P.Cpu) {
        const I = P.Players.indexOf(Id), Side = I < 3 ? 0 : 1, Seat = I % 3;
        const Held = Slots.Occupy(P.Found.Groups[Side].SlotObjectId, Id, P.TeamSize, Seat);
        if (!Held || Held.Index !== Seat) throw new Error('CPU seat became unavailable');
    }
    const Blobs = new Map(P.Members.map(M => [M.Connection.Puid, M.Blob]));
    const Home = P.Players.slice(0, P.TeamSize), Away = P.Players.slice(3, 3 + P.TeamSize);
    const Profiles = Side => Side.map(Id => Blobs.get(Id) || Buffer.alloc(0));
    const Prepared = CourtData.PrepareGameTeams(P.ActivityName, P.Found.Raw.Name, Home, Away,
        { Home: Profiles(Home), Away: Profiles(Away) }, '2K22',
        { NativePark: { MatchId: P.MatchId, Humans: P.Members.map(M => M.Connection.Puid) } });
    // Mark starting before the first send: a partial send must release every participant.
    P.Phase = 'starting'; P.StartedAt = Date.now();
    for (const M of P.Members) if (!M.Connection.SendObject(Prepared.Frame)) throw new Error('court roster publication failed');
    for (const M of P.Members) if (!require('./GotNext').GrantPlaying(M.Connection)) throw new Error('PLAYING grant failed');
    Log.Info(`Native park ${P.TeamSize}v${P.TeamSize}: exact teams sent; ${P.Members.length} real network members, ${P.Cpu.length} CPU; awaiting native start and game connections`);
}
function Tick(P) {
    if (P.Done || Courts.get(P.Key) !== P) return;
    try {
        const Now = Date.now();
        for (const M of P.Members) {
            const C = M.Connection, Control = M.Control, R = Control?.Report;
            if (C.Closed || C.GotNext !== M.Spot || C.ActivityKey !== P.ActivityKey ||
                (C.RoomScope || null) !== P.RoomScope || Controls.get(C.Id) !== Control ||
                !Control || Now - Control.SeenAt > Wire.HeartbeatMs) throw new Error('participant, queue or control connection lost');
            if (R?.Epoch === Control.Epoch && R.Match === P.MatchId && R.Error)
                throw new Error(Wire.ErrorNames[R.Error]);
            if (!R || !(R.Flags & Wire.Flag.Installed) || R.PoolCount !== P.PoolCount || !R.Digest.equals(P.Digest))
                throw new Error('native module or template pool changed');
            if (P.Phase !== 'arming' && (!Wire.Matches(R, P, Control) || !(R.Flags & Wire.Flag.Armed) || (R.Created & ~P.CpuMask)))
                throw new Error('native match authorization lost');
        }
        if (P.Phase === 'arming' || P.Phase === 'preloading') {
            if (!SameQueue(P.Snapshot, Snapshot(P.Anchor, P.Found))) throw new Error('court queue changed during preparation');
        }
        const Reports = P.Members.map(M => M.Control.Report);
        if (P.Phase === 'arming') {
            if (Now - P.CreatedAt > 15000) throw new Error('native authorization timed out');
            if (P.Members.every(M => Wire.Matches(M.Control.Report, P, M.Control) && (M.Control.Report.Flags & Wire.Flag.Armed))) PublishCpu(P);
        } else if (P.Phase === 'preloading') {
            if (Now - P.PreloadAt > 45000) throw new Error('native CPU generation timed out');
            if (Reports.every(R => (R.Created & P.CpuMask) === P.CpuMask)) Commit(P);
        } else {
            const Game = CourtData.GameTeams(P.ActivityName, P.Found.Raw.Name, '2K22');
            if (Game?.NativePark?.MatchId !== P.MatchId) throw new Error('frozen court game disappeared');
            if (P.Phase === 'starting') {
                if (Reports.every(R => R.Flags & Wire.Flag.Started) && Game.GameReady) {
                    P.Phase = 'playing';
                    Log.Info(`Native park ${P.MatchId.toString(16)}: all native initializations and game connections confirmed; in-game synchronization still requires user acceptance`);
                } else if (Now - P.StartedAt > 30000) throw new Error('native start or game synchronization timed out');
            }
        }
    } catch (Failure) { Remove(P, Failure.message, P.Phase === 'starting' || P.Phase === 'playing'); }
}
function Begin(C, Found, S, Key) {
    const First = S.Members[0].Control.Report;
    const P = {
        Key, Anchor: S.Members[0].Connection, Found, Snapshot: S, Members: S.Members, Seats: S.Seats,
        ActivityName: C.ActivityName,
        Context: { ActivityName: C.ActivityName, ActivityKey: C.ActivityKey, RoomScope: C.RoomScope || null,
            WorldKey: C.WorldKey, ProtocolGeneration: '2K22', Id: 0, SendObject: () => false },
        ActivityKey: C.ActivityKey, RoomScope: C.RoomScope || null, TeamSize: Found.Raw.TeamSize,
        MatchId: Nonce(), PoolCount: First.PoolCount, Digest: Buffer.from(First.Digest),
        Players: new Array(6).fill(0n), Seeds: new Array(6).fill(0), Templates: new Array(6).fill(0xffffffff),
        HumanMask: 0, CpuMask: 0, Cpu: [], Bodies: new Map(),
        Phase: 'arming', CreatedAt: Date.now(), Timer: null, Done: false,
    };
    for (const M of S.Members) {
        const I = M.Side * 3 + M.Seat;
        P.Players[I] = M.Connection.Puid; P.HumanMask |= 1 << I;
    }
    const Base = 0x0222c00000000000n | (BigInt('0x' + Crypto.randomBytes(5).toString('hex')) & ~7n);
    for (let Side = 0; Side < 2; ++Side) for (let Seat = 0; Seat < P.TeamSize; ++Seat) {
        const I = Side * 3 + Seat;
        if (P.Players[I]) continue;
        const Id = Base + BigInt(P.Cpu.length);
        P.Players[I] = Id; P.Cpu.push(Id); P.CpuMask |= 1 << I;
        P.Seeds[I] = Crypto.randomBytes(4).readUInt32LE() || 1;
        P.Templates[I] = P.Seeds[I] % P.PoolCount;
    }
    Courts.set(Key, P);
    for (const M of P.Members) Participants.set(M.Connection.Id, P);
    P.Timer = setInterval(() => Tick(P), 250); P.Timer.unref?.();
    Log.Info(`Native park ${Found.Raw.Name}: froze ${P.Members.length} human seat(s), ${P.Cpu.length} empty seat(s); awaiting v3 authorization on every client`);
    return true;
}
function TryStart(C, Found) {
    const Key = KeyFor(C, Found), Existing = Courts.get(Key);
    if (Existing) { Tick(Existing); return !Existing.Done; }
    const S = Snapshot(C, Found);
    if (!S) { CancelWait(C); return false; }
    if (S.Members.some(M => Participants.has(M.Connection.Id))) return false;
    if (S.Members.some(M => !Wire.HasPool(M.Control))) {
        CancelWait(C); Notice(C, 'all queued humans need Module 0001020F v3 readiness through their game login'); return false;
    }
    const First = S.Members[0].Control.Report;
    if (S.Members.some(M => M.Control.Report.PoolCount !== First.PoolCount || !M.Control.Report.Digest.equals(First.Digest))) {
        CancelWait(C); Notice(C, 'client template pools differ; refusing CPU fill'); return false;
    }
    C.NativeParkNotice = null;
    let W = Waiting.get(Key);
    if (!W || !SameQueue(W.Snapshot, S)) {
        if (W) clearTimeout(W.Timer);
        W = { Snapshot: S, Since: Date.now(), Timer: null };
        Waiting.set(Key, W);
        const Anchor = S.Members[0].Connection;
        W.Timer = setTimeout(() => {
            if (Waiting.get(Key) !== W) return;
            W.Timer = null;
            if (Anchor.Closed || !Anchor.GotNext) { Waiting.delete(Key); return; }
            try { require('./GotNext').MaybeStartMatch(Anchor); }
            catch (Failure) { Waiting.delete(Key); Log.Error(`Native park delayed start withheld: ${Failure.message}`); }
        }, WaitMs);
        W.Timer.unref?.();
        Log.Info(`Native park ${Found.Raw.Name}: waiting 10 stable seconds before filling team vacancies`);
        return false;
    }
    if (Date.now() - W.Since < WaitMs) return false;
    clearTimeout(W.Timer); Waiting.delete(Key);
    return Begin(C, Found, S, Key);
}
function OnReport(Puid, R) {
    const Matches = Roster.Active().filter(C => C.Puid === Puid && C.ActivityName === 'neighborhood' &&
        C.PlayerBody && require('./PlayerBody').GenerationForConnection(C) === '2K22');
    if (Matches.length !== 1) return null;
    const C = Matches[0], Now = Date.now();
    let Control = Controls.get(C.Id);
    if (Control && Control.Instance !== R.Instance) {
        if (Now - Control.SeenAt <= Wire.HeartbeatMs) {
            const Failure = new Error('another native instance is active'); Failure.Status = 409; throw Failure;
        }
        Stop(C, 'native instance changed'); Controls.delete(C.Id); Control = null;
    }
    if (!Control) {
        Control = { Connection: C, Instance: R.Instance, Epoch: Nonce(), SeenAt: Now, Report: R };
        Controls.set(C.Id, Control);
    }
    Control.SeenAt = Now; Control.Report = R;
    let P = Participants.get(C.Id);
    if (P) Tick(P);
    else if (C.GotNext && !C.GotNext.Playing) require('./GotNext').MaybeStartMatch(C);
    P = Participants.get(C.Id);
    return P && !P.Done ? Wire.BuildManifest(P, Control) : null;
}
function HandleUpdate(C, Bytes) {
    const P = Participants.get(C.Id);
    if (!P || P.Done || C.Closed || Bytes.length < 42 || Bytes.readUInt32BE(4) !== 0xfef2dd68 ||
        Bytes.readUInt32BE(32) !== PlayerObject.PlayerClass) return false;
    const Id = Bytes.readBigUInt64BE(24), Cached = P.Bodies.get(Id), Size = Bytes.readUInt16BE(40);
    if (!Cached || Bytes.length < 42 + Size) return false;
    const Body = Bytes.subarray(42, 42 + Size), D = Body22.Decode(Body), Base = Body22.Decode(Cached);
    if (!D.Ok || !Base.Ok || Body.readBigUInt64BE() !== Id) return false;
    const PuidAt = D.Offsets.get(0);
    if (PuidAt !== undefined && Body.readBigUInt64LE(PuidAt) !== Id) return false;
    const From = Body.readBigUInt64BE(8), To = (From > Cached.readBigUInt64BE(8) ? From : Cached.readBigUInt64BE(8)) + 16n;
    if (To > 0xffffffffffffffffn) return false;
    const Protected = new Set([0, 1, 4, 5, 91, 93, 144]), Values = new Map();
    const Authority = C === P.Members[0].Connection;
    const Sources = Authority ? [[Base, Cached, false], [D, Body, true]] : [[Base, Cached, false]];
    for (const [Decoded, Data, Partial] of Sources) {
        const Ids = [...Decoded.Offsets.keys()];
        Ids.forEach((Field, I) => {
            if (Partial && Protected.has(Field)) return;
            Values.set(Field, Data.subarray(Decoded.Offsets.get(Field), I + 1 < Ids.length ? Decoded.Offsets.get(Ids[I + 1]) : Decoded.Length));
        });
    }
    const Header = Buffer.from(Cached.subarray(0, Body22.ValuesStart)); Header.fill(0, 16); Header.writeBigUInt64BE(To, 8);
    const Parts = [...Values].sort((A, B) => A[0] - B[0]).map(([Field, Value]) => {
        Header[16 + (Field >> 3)] |= 0x80 >> (Field & 7); return Value;
    });
    const Next = Buffer.concat([Header, ...Parts]); P.Bodies.set(Id, Next);
    const Request = Bytes.readBigUInt64BE(16);
    if (Request) C.Send(require('./Requests').Build(Request));
    const Frame = ObjectFrame.Build({ PacketId: PlayerObject.ObjectDataPacket, ConnectionId: null,
        ObjectId: Id, ClassCrc: PlayerObject.PlayerClass, Payload: Next, Layout: ObjectFrame.Layout.Nineteen });
    if (!Authority) return C.SendObject(Frame);
    let Sent = false;
    for (const M of P.Members) if (!M.Connection.Closed) Sent = M.Connection.SendObject(Frame) || Sent;
    return Sent;
}
module.exports = { TryStart, CancelWait, Stop, Disconnect, Finish, OnReport, HandleUpdate };
