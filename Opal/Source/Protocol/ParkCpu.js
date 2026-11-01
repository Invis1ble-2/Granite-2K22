// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Crypto = require('node:crypto');
const Log = require('../Core/Log');
const Settings = require('../Core/Config');
const Wire = require('./ParkCpuWire');
const Roster = require('./Roster');
const Slots = require('./Slots');
const CourtData = require('./CourtData');
const PlayerObject = require('./PlayerObject');
const Body22 = require('./PlayerBody');
const ObjectFrame = require('../Codec/ObjectFrame');
const CpuTemplates = require('./ParkCpuProfiles');
const Waiting = new Map();
const WaitMs = 10000;
const CpuProtectedFields = new Set([0, 1, 4, 5, 91, 93, 144]);
const Nonce = () => Crypto.randomBytes(8).readBigUInt64LE() || 1n;
const KeyFor = (C, Found) => `${C.ActivityKey}:${C.RoomScope || ''}:${Found.Raw.Name}`;
const Controls = new Map(), Watches = new Map();
let WatchTimer = null;
function Watch(P, Check) {
    Watches.set(P, Check);
    if (WatchTimer) return;
    WatchTimer = setInterval(() => {
        const Now = Date.now();
        for (const [Match, Run] of Watches) if (Now - (Match.CheckedAt || 0) >= 500) Run();
    }, 250);
    WatchTimer.unref?.();
}
function Unwatch(P) {
    Watches.delete(P);
    if (!Watches.size) { clearInterval(WatchTimer); WatchTimer = null; }
}

function Enabled(TeamSize) {
    const C = Settings.ParkCpu();
    return Boolean(C && (TeamSize === 2 ? C.TwoOnTwo : TeamSize === 3 ? C.ThreeOnThree : C.FiveOnFive) !== false);
}
function SupportsCourt(C, Found) {
    const Size = Found.Raw.TeamSize;
    return (C.ActivityName === 'neighborhood' && [2, 3].includes(Size) &&
        CourtData.ParkCourtFormat(Found.Raw.Name) === 'bitstream') ||
        (C.ActivityName === 'cages' && [2, 3, 5].includes(Size));
}
function SameQueue(A, B) {
    return Boolean(B && A.Seats.length === B.Seats.length && A.Seats.every((Side, I) =>
        Side.length === B.Seats[I].length && Side.every((Id, J) => Id === B.Seats[I][J])) &&
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
// One court clock is shared by solo and multiplayer fill, independent of module heartbeats.
function WaitForQueue(C, Found) {
    const Key = KeyFor(C, Found), Size = Found.Raw.TeamSize;
    const Seats = Found.Groups.map(G => Slots.StateFor(G.SlotObjectId, Size).Seats.slice());
    const Ids = Seats.flat().filter(Id => Id !== 0n);
    const ByPuid = new Map(Roster.InActivity(C.ActivityKey, C.RoomScope || null).map(P => [P.Puid, P]));
    const Members = Ids.map(Id => ({ Connection: ByPuid.get(Id) }));
    for (const M of Members) M.Spot = M.Connection?.GotNext;
    const S = { Seats, Members };
    let W = Waiting.get(Key);
    if (!Ids.length || Ids.length >= Size * 2 || Ids.some(Wire.IsCpu) ||
        Members.some(M => !M.Connection || M.Connection.Closed || !M.Spot || M.Spot.Playing)) {
        if (W) { clearTimeout(W.Timer); Waiting.delete(Key); }
        return false;
    }
    if (!W || !SameQueue(W.Snapshot, S)) {
        if (W) clearTimeout(W.Timer);
        W = { Snapshot: S, Since: Date.now(), Timer: null };
        Waiting.set(Key, W);
        const Anchor = Members[0].Connection;
        W.Timer = setTimeout(() => {
            if (Waiting.get(Key) !== W) return;
            W.Timer = null;
            if (Anchor.Closed || Anchor.GotNext !== W.Snapshot.Members[0].Spot) {
                Waiting.delete(Key); return;
            }
            try { require('./GotNext').MaybeStartMatch(Anchor); }
            catch (Failure) { Waiting.delete(Key); Log.Error(`ParkCpu delayed start withheld: ${Failure.message}`); }
        }, WaitMs);
        W.Timer.unref?.();
        Log.Info(`ParkCpu ${Found.Raw.Name}: ${Ids.length} human seat(s); waiting 10 stable seconds before CPU fill`);
    }
    return Date.now() - W.Since >= WaitMs;
}
function FrameFor(Id, Seed) {
    return ObjectFrame.Build({ PacketId: PlayerObject.ObjectDataPacket, ConnectionId: null, ObjectId: Id,
        ClassCrc: PlayerObject.PlayerClass, Payload: Body22.BuildGeneratedPlayer(Id, Seed), Layout: ObjectFrame.Layout.Nineteen });
}
// Shared CPU update validation/merge. Multiplayer only accepts mutations from its
// first human; other participants receive the authoritative body without changing it.
function HandleCpuUpdate(C, Bytes, P, Members) {
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
    const Values = new Map();
    const Authority = !Members || C === Members[0].Connection;
    const Sources = Authority ? [[Base, Cached, false], [D, Body, true]] : [[Base, Cached, false]];
    for (const [Decoded, Data, Partial] of Sources) {
        const Ids = [...Decoded.Offsets.keys()];
        Ids.forEach((Field, I) => {
            if (Partial && CpuProtectedFields.has(Field)) return;
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
    if (!Members || !Authority) return C.SendObject(Frame);
    let Sent = false;
    for (const M of Members) if (!M.Connection.Closed) Sent = M.Connection.SendObject(Frame) || Sent;
    return Sent;
}

// Both modes share the authenticated native instance; match authorization stays mode-specific.
const Multiplayer = (() => {
    const Courts = new Map(), Participants = new Map();
    function Notice(C, Why) {
        if (C.ParkCpuNotice === Why) return;
        C.ParkCpuNotice = Why;
        Log.Info(`ParkCpu fill withheld for ${C.Identifier}: ${Why}`);
    }
    function HasTemplatePool(C, Instance) {
        const Control = Controls.get(C.Id);
        return Wire.HasPool(Control) && Control.Instance.toString(16) === Instance &&
            CpuTemplates.MatchesPool(Control.Report);
    }
    function Snapshot(C, Found) {
        const Size = Found.Raw.TeamSize, Next = require('./GotNext');
        if (!SupportsCourt(C, Found) || !Enabled(Size) ||
            require('./PlayerBody').GenerationForConnection(C) !== '2K22' || Found.Groups.length !== 2 ||
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
                Next.FindState(Player.PlayerBody, Next.State.GotNext) < 0 || !Player.MachineId || !Player.Userdata) return null;
            Members.push({ Connection: Player, Spot, Side, Seat, Control: Controls.get(Player.Id) });
        }
        if (new Set(Members.map(M => String(M.Connection.MachineId))).size !== Members.length) return null;
        return { Seats, Members };
    }
    function Remove(P, Why, ReleasePlayers) {
        if (P.Done) return false;
        P.Done = true;
        Courts.delete(P.Key); Unwatch(P);
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
            } catch (Failure) { Log.Error(`ParkCpu player cleanup failed: ${Failure.message}`); }
        }
        CourtData.BroadcastCourtGroup(P.Context, P.Found.Groups[0]);
        Log.Info(`ParkCpu multiplayer ${P.TeamSize}v${P.TeamSize} ${P.MatchId.toString(16)} ended: ${Why}; shared CPU and court state cleared`);
        return true;
    }
    function Stop(C, Why = 'queue changed') {
        const Cancelled = CancelWait(C), P = Participants.get(C.Id);
        if (!P) return Cancelled;
        return Remove(P, Why, P.Phase === 'starting' || P.Phase === 'playing');
    }
    function Disconnect(C) {
        Stop(C, 'participant disconnected or changed activity');
        C.ParkCpuNotice = null;
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
            const Frame = FrameFor(Id, P.Seeds[I]);
            P.Bodies.set(Id, Buffer.from(Frame.subarray(32)));
            for (const M of P.Members) if (!M.Connection.SendObject(Frame)) throw new Error('CPU publication failed');
        }
        Log.Info(`ParkCpu multiplayer ${P.Found.Raw.Name}: all ${P.Members.length} clients armed; published ${P.Cpu.length} shared CPU objects`);
    }
    function Commit(P) {
        if (!SameQueue(P.Snapshot, Snapshot(P.Anchor, P.Found))) throw new Error('court seats changed before commit');
        if (CourtData.GameTeams(P.ActivityName, P.Found.Raw.Name, '2K22')) throw new Error('court already has a game');
        for (const Id of P.Cpu) {
            const I = P.Players.indexOf(Id), Stride = Wire.SideStride(P.TeamSize), Side = I < Stride ? 0 : 1, Seat = I % Stride;
            const Held = Slots.Occupy(P.Found.Groups[Side].SlotObjectId, Id, P.TeamSize, Seat);
            if (!Held || Held.Index !== Seat) throw new Error('CPU seat became unavailable');
        }
        const Userdata = require('./Userdata');
        const Blobs = new Map(P.Members.map(M => [M.Connection.Puid, Userdata.CourtProfile(M.Connection, M.Blob)]));
        const Stride = Wire.SideStride(P.TeamSize);
        const Home = P.Players.slice(0, P.TeamSize), Away = P.Players.slice(Stride, Stride + P.TeamSize);
        const Profiles = Side => Side.map(Id => Blobs.get(Id) || Buffer.alloc(0));
        const Prepared = CourtData.PrepareGameTeams(P.ActivityName, P.Found.Raw.Name, Home, Away,
            { Home: Profiles(Home), Away: Profiles(Away) }, '2K22',
            { NativePark: { MatchId: P.MatchId, Humans: P.Members.map(M => M.Connection.Puid) },
                BallType: Userdata.PreferredBallFor([...Home, ...Away].map(Id =>
                    P.Members.find(M => M.Connection.Puid === Id)?.Connection)) });
        // Mark starting before the first send: a partial send must release every participant.
        P.Phase = 'starting'; P.StartedAt = Date.now();
        for (const M of P.Members) if (!M.Connection.SendObject(Prepared.Frame)) throw new Error('court roster publication failed');
        for (const M of P.Members) if (!require('./GotNext').GrantPlaying(M.Connection)) throw new Error('PLAYING grant failed');
        Log.Info(`ParkCpu multiplayer ${P.TeamSize}v${P.TeamSize}: exact teams sent; ${P.Members.length} real network members, ${P.Cpu.length} CPU; awaiting native start and game connections`);
    }
    function Tick(P) {
        if (P.Done || Courts.get(P.Key) !== P) return;
        P.CheckedAt = Date.now();
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
                if ((P.Phase === 'starting' || P.Phase === 'playing') && !R.ProfileDigest.equals(P.ProfileDigest))
                    throw new Error('server-authored CPU profile digest changed');
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
                if (Reports.every(R => (R.Created & P.CpuMask) === P.CpuMask)) {
                    if (Reports.some(R => !R.ProfileDigest.equals(P.ProfileDigest)))
                        throw new Error('client CPU profile differs from the server-authored attributes or body');
                    Commit(P);
                }
            } else {
                const Game = CourtData.GameTeams(P.ActivityName, P.Found.Raw.Name, '2K22');
                if (Game?.NativePark?.MatchId !== P.MatchId) throw new Error('frozen court game disappeared');
                if (P.Phase === 'starting') {
                    if (Reports.every(R => R.Flags & Wire.Flag.Started) && Game.GameReady) {
                        P.Phase = 'playing';
                        Log.Info(`ParkCpu multiplayer ${P.MatchId.toString(16)}: all native initializations and game connections confirmed; in-game synchronization still requires user acceptance`);
                    } else if (Now - P.StartedAt > 30000) throw new Error('native start or game synchronization timed out');
                }
            }
        } catch (Failure) { Remove(P, Failure.message, P.Phase === 'starting' || P.Phase === 'playing'); }
    }
    function Begin(C, Found, S, Key) {
        const First = S.Members[0].Control.Report;
        const Userdata = require('./Userdata');
        for (const M of S.Members) {
            const Data = Userdata.Read(M.Connection.Userdata);
            if (!Data?.IsUserdata || Data.DeclaredLength !== Data.Blob.length) throw new Error('human USERDATA is incomplete');
            M.Blob = Buffer.from(Data.Blob);
        }
        const Selected = CpuTemplates.Select(Found.Raw.TeamSize * 2 - S.Members.length, Settings.ParkCpu());
        const P = {
            Key, Anchor: S.Members[0].Connection, Found, Snapshot: S, Members: S.Members,
            ActivityName: C.ActivityName,
            Context: { ActivityName: C.ActivityName, ActivityKey: C.ActivityKey, RoomScope: C.RoomScope || null,
                WorldKey: C.WorldKey, ProtocolGeneration: '2K22', Id: 0, SendObject: () => false },
            ActivityKey: C.ActivityKey, RoomScope: C.RoomScope || null, TeamSize: Found.Raw.TeamSize,
            MatchId: Nonce(), PoolCount: First.PoolCount, Digest: Buffer.from(First.Digest),
            Players: new Array(Wire.MaxPlayers).fill(0n), Seeds: new Array(Wire.MaxPlayers).fill(0), Templates: new Array(Wire.MaxPlayers).fill(0xffffffff),
            Profiles: new Array(Wire.MaxPlayers).fill(null),
            HumanMask: 0, CpuMask: 0, Cpu: [], Bodies: new Map(), ProfileDigest: null,
            Phase: 'arming', CreatedAt: Date.now(), Done: false,
        };
        for (const M of S.Members) {
            const I = M.Side * Wire.SideStride(P.TeamSize) + M.Seat;
            P.Players[I] = M.Connection.Puid; P.HumanMask |= 1 << I;
        }
        const Base = 0x0222c00000000000n | (BigInt('0x' + Crypto.randomBytes(5).toString('hex')) & ~15n);
        for (let Side = 0; Side < 2; ++Side) for (let Seat = 0; Seat < P.TeamSize; ++Seat) {
            const I = Side * Wire.SideStride(P.TeamSize) + Seat;
            if (P.Players[I]) continue;
            const Profile = Selected[P.Cpu.length];
            const Id = Base + BigInt(P.Cpu.length);
            P.Players[I] = Id; P.Cpu.push(Id); P.CpuMask |= 1 << I;
            P.Seeds[I] = Profile.Seed;
            P.Templates[I] = Profile.Template;
            P.Profiles[I] = Profile;
        }
        P.ProfileDigest = CpuTemplates.ProfileDigest(P.Players, P.Profiles);
        Courts.set(Key, P);
        for (const M of P.Members) Participants.set(M.Connection.Id, P);
        Watch(P, () => Tick(P));
        Log.Info(`ParkCpu multiplayer ${Found.Raw.Name}: froze ${P.Members.length} human seat(s), ${P.Cpu.length} empty seat(s); templates: ${Selected.map(Profile => Profile.Name).join(', ')}; awaiting v7 CPU control on every client`);
        return true;
    }
    function QueueChanged(C, Found) {
        const Size = Found.Raw.TeamSize;
        if (!SupportsCourt(C, Found) || !Enabled(Size) ||
            require('./PlayerBody').GenerationForConnection(C) !== '2K22' || Found.Groups.length !== 2 ||
            Found.Groups.some(G => G.Anchors.length !== Size)) return;
        const P = Courts.get(KeyFor(C, Found));
        if (P) Tick(P);
        if (CourtData.GameTeams(C.ActivityName, Found.Raw.Name, '2K22')) return;
        Solo.QueueChanged(C, Found);
        WaitForQueue(C, Found);
    }
    function TryStart(C, Found) {
        const Key = KeyFor(C, Found), Existing = Courts.get(Key);
        if (Existing) { Tick(Existing); return !Existing.Done; }
        const S = Snapshot(C, Found);
        if (!S) return false;
        if (S.Members.some(M => Participants.has(M.Connection.Id))) return false;
        const Waited = WaitForQueue(C, Found);
        if (S.Members.some(M => !Wire.HasPool(M.Control))) {
            Notice(C, 'all queued humans need Module 00010227 v7 readiness through their game login'); return false;
        }
        const First = S.Members[0].Control.Report;
        if (S.Members.some(M => M.Control.Report.PoolCount !== First.PoolCount || !M.Control.Report.Digest.equals(First.Digest))) {
            Notice(C, 'client template pools differ; refusing CPU fill'); return false;
        }
        if (!CpuTemplates.MatchesPool(First)) {
            Notice(C, 'client template pool differs from the server catalog; refusing CPU fill'); return false;
        }
        if (!Waited) return false;
        try {
            const Started = Begin(C, Found, S, Key);
            if (Started) {
                const W = Waiting.get(Key);
                if (W) { clearTimeout(W.Timer); Waiting.delete(Key); }
                C.ParkCpuNotice = null;
            }
            return Started;
        } catch (Failure) {
            Notice(C, Failure.message); return false;
        }
    }
    function OnReport(C) {
        const Control = Controls.get(C.Id);
        let P = Participants.get(C.Id);
        if (P) Tick(P);
        P = Participants.get(C.Id);
        return P && !P.Done ? Wire.BuildManifest(P, Control) : null;
    }
    function HandleUpdate(C, Bytes) {
        const P = Participants.get(C.Id);
        return HandleCpuUpdate(C, Bytes, P, P?.Members);
    }
    return { TryStart, QueueChanged, Stop, Disconnect, Finish, OnReport, HandleUpdate, HasTemplatePool,
        HasMatch: C => Participants.has(C.Id) };
})();

const Solo = (() => {
    const ProtocolVersion = 6, CandidateCount = CpuTemplates.SoloCandidateCount;
    const RequestBytes = 144 + Wire.MaxCpu * CandidateCount * CpuTemplates.ProfileBytes;
    const Pending = new Map();
    const { LeaseMs, HeartbeatMs } = Wire;
    function Installed(R) {
        return Boolean(R && R.version === ProtocolVersion && R.module === '00010227' && R.installed === true &&
            Number.isInteger(R.pid) && R.pid > 0);
    }
    function RemoteLive(C, P) {
        return Controls.get(C.Id) === P.Control && Date.now() - P.Control.SeenAt <= HeartbeatMs &&
            P.Control.SoloReport.instance === P.Instance && Installed(P.Control.SoloReport) &&
            Multiplayer.HasTemplatePool(C, P.Instance);
    }
    function SelectionDigest(R, P) {
        if (!Array.isArray(R.candidates) || R.candidates.length !== P.Cpu.length ||
            R.candidates.some(I => !Number.isInteger(I) || I < 0 || I >= CandidateCount) ||
            (P.SelectedCandidates && R.candidates.some((I, N) => I !== P.SelectedCandidates[N]))) return null;
        if (!P.Selection || R.candidates.some((I, N) => I !== P.Selection.Indices[N])) {
            P.Selection = { Indices: R.candidates.slice(),
                Digest: CpuTemplates.ProfileDigest(P.Cpu, P.Candidates.map((Choices, I) => Choices[R.candidates[I]])).toString('hex') };
        }
        return P.Selection.Digest;
    }
    function IsReady(R, P) {
        return Installed(R) && R.pid === P.Pid && R.instance === P.Instance && R.epoch === P.Epoch && R.armed === true &&
            R.match === P.MatchId.toString(16) && !R.error &&
            R.teamSize === P.TeamSize && R.cpuCount === P.Cpu.length &&
            Array.isArray(R.created) && R.created.length === P.Cpu.length && new Set(R.created).size === P.Cpu.length &&
            P.Cpu.every(Id => R.created.includes(Id.toString(16))) &&
            typeof R.profileDigest === 'string' && R.profileDigest === SelectionDigest(R, P);
    }
    function BuildRequest(Match, Owner, Cpu, TeamSize, Seeds, Candidates) {
        if (![2, 3, 5].includes(TeamSize) || Cpu.length !== TeamSize * 2 - 1 || new Set(Cpu).size !== Cpu.length ||
            Cpu.some(Id => typeof Id !== 'bigint' || Id === Owner || (Id & 0xfffff00000000000n) !== 0x0222c00000000000n) ||
            !Array.isArray(Seeds) || Seeds.length !== Cpu.length || Seeds.some(Seed => !Number.isInteger(Seed) || Seed < 1 || Seed > 0xffffffff) ||
            !Array.isArray(Candidates) || Candidates.length !== Cpu.length ||
            Candidates.some(Choices => !Array.isArray(Choices) || Choices.length !== CandidateCount))
            throw new Error('invalid native solo CPU roster');
        const B = Buffer.alloc(RequestBytes);
        B.write('SP22'); B.writeUInt32LE(ProtocolVersion, 4); B.writeBigUInt64LE(Match, 8); B.writeBigUInt64LE(Owner, 16);
        B.writeUInt32LE(TeamSize, 24); B.writeUInt32LE(Cpu.length, 28);
        Cpu.forEach((Id, I) => B.writeBigUInt64LE(Id, 32 + I * 8));
        Seeds.forEach((Seed, I) => B.writeUInt32LE(Seed, 104 + I * 4));
        B.writeUInt32LE(CandidateCount, 140);
        Candidates.forEach((Choices, I) => Choices.forEach((Profile, N) =>
            CpuTemplates.EncodeProfile(Profile).copy(B, 144 + (I * CandidateCount + N) * CpuTemplates.ProfileBytes)));
        return B;
    }
    function OnlyQueuedHuman(C, Found) {
        return Found.Groups.every(G => Slots.SeatsOf(G.SlotObjectId).every(Id => !Id || Id === C.Puid));
    }
    function CanContinue(C, P) {
        return !C.Closed && C.ActivityKey === P.ActivityKey && (C.RoomScope || null) === P.RoomScope &&
            C.GotNext === P.Spot && C.GotNext.Court === P.Court && Boolean(C.PlayerBody) &&
            ((P.Phase !== 'arming' && P.Phase !== 'preloading') || OnlyQueuedHuman(C, P.Found));
    }
    function QueueChanged(C, Found) {
        for (const P of Pending.values()) {
            if (P.ActivityKey !== C.ActivityKey || P.RoomScope !== (C.RoomScope || null) ||
                P.Found.Raw.Name !== Found.Raw.Name || (P.Phase !== 'arming' && P.Phase !== 'preloading')) continue;
            const Owner = P.Control.Connection;
            if (Owner.GotNext !== P.Spot || !OnlyQueuedHuman(Owner, Found)) {
                Stop(Owner);
                Log.Info(`ParkCpu solo ${Found.Raw.Name}: queue changed during preparation; retaining human queue seats`);
            }
        }
    }
    function Stop(C) {
        const Cancelled = CancelWait(C), P = Pending.get(C.Id);
        if (!P) return Cancelled;
        Pending.delete(C.Id); Unwatch(P);
        // Withdraw authorization first, before destroying players or allowing another match.
        const Game = CourtData.GameTeams(P.Activity, P.Found.Raw.Name, '2K22');
        if (Game?.NativeSolo?.MatchId === P.MatchId) CourtData.ClearGameTeams(P.Activity, P.Found.Raw.Name, '2K22');
        for (const Id of P.Cpu) {
            Slots.Release(Id);
            if (!C.Closed) {
                try { C.SendObject(PlayerObject.DestroyFrameFor({ Puid: Id })); }
                catch (E) { Log.Error(`ParkCpu solo CPU removal failed: ${E.message}`); }
            }
        }
        return true;
    }
    function Disconnect(C) {
        const P = Pending.get(C.Id);
        C.ParkCpuSoloNotice = false;
        if (!P) { CancelWait(C); return false; }
        const Game = CourtData.GameTeams(P.Activity, P.Found.Raw.Name, '2K22');
        if (Game?.NativeSolo?.MatchId === P.MatchId) Game.Ended = true;
        Stop(C);
        // Vacate also advances waiting players; Stop is idempotent on re-entry.
        require('./GotNext').Vacate(C);
        // A reconnect must not reuse the old body's granted state/court destination.
        PlayerObject.ClearCachedBody(C);
        // Away seats may already be free, leaving no human seat change to broadcast.
        CourtData.BroadcastCourtGroup(C, P.Found.Groups[0]);
        Log.Info(`ParkCpu solo ${P.Found.Raw.Name} ended (client disconnected); CPU objects removed, player cache cleared and queue restored`);
        return true;
    }
    function Abort(C, Why) {
        const P = Pending.get(C.Id);
        if (!P) return;
        Stop(C);
        Log.Error(`ParkCpu solo ${P.TeamSize}v${P.TeamSize} stopped: ${Why}; restoring queue state`);
        // Do not release a new queue or a normal full-human game started in the meantime.
        const Game = CourtData.GameTeams(P.Activity, P.Found.Raw.Name, '2K22');
        if (!C.Closed && C.GotNext === P.Spot && !Game) require('./GotNext').Release(C);
    }
    function Commit(C, P) {
        P.SelectedCandidates = P.Control.SoloReport.candidates.slice();
        const Held = require('./GotNext').QueueFor(C, C.GotNext.Court, C.GotNext.Slot);
        const OwnGroup = Held?.SlotObjectId === P.OwnSlot ?
            P.Found.Groups.findIndex(G => G.SlotObjectId === P.OwnSlot) : -1;
        if (OwnGroup < 0) throw new Error('human queue group changed');
        if (CourtData.GameTeams(P.Activity, P.Found.Raw.Name, '2K22')) throw new Error('court already has a game');
        const Sides = [[], []];
        for (let Side = 0; Side < 2; ++Side) {
            const Seats = Slots.StateFor(P.Found.Groups[Side].SlotObjectId, P.TeamSize).Seats;
            if (Seats.length !== P.TeamSize || Seats.some(Id => Id && Id !== C.Puid))
                throw new Error('court seats changed');
            Sides[Side] = new Array(P.TeamSize).fill(0n);
        }
        const Seat = C.GotNext.Seat;
        if (!Number.isInteger(Seat) || Seat < 0 || Seat >= P.TeamSize ||
            Slots.SeatsOf(P.OwnSlot)[Seat] !== C.Puid) throw new Error('human queue seat is invalid');
        Sides[OwnGroup][Seat] = C.Puid;
        let Next = 0;
        for (let Side = 0; Side < 2; ++Side) for (let I = 0; I < P.TeamSize; ++I) if (!Sides[Side][I]) {
            const Id = P.Cpu[Next++];
            const Occupied = Slots.Occupy(P.Found.Groups[Side].SlotObjectId, Id, P.TeamSize, I);
            if (!Occupied || Occupied.Index !== I) throw new Error('CPU seat became unavailable');
            Sides[Side][I] = Id;
        }
        const Userdata = require('./Userdata');
        const Data = C.Userdata && Userdata.Read(C.Userdata);
        if (!Data || !Data.IsUserdata || Data.DeclaredLength !== Data.Blob.length) throw new Error('human USERDATA is incomplete');
        const HumanProfile = Userdata.CourtProfile(C, Data.Blob);
        const Profiles = Sides.map(Side => Side.map(Id => Id === C.Puid ? HumanProfile : Buffer.alloc(0)));
        const Prepared = CourtData.PrepareGameTeams(P.Activity, P.Found.Raw.Name, Sides[0], Sides[1],
            { Home: Profiles[0], Away: Profiles[1] }, '2K22', {
                NativeSolo: { Owner: C.Puid, MatchId: P.MatchId }, BallType: Userdata.PreferredBallFor([C]),
            });
        if (!C.SendObject(Prepared.Frame)) throw new Error('court roster send failed');
        if (!require('./GotNext').GrantPlaying(C)) throw new Error('PLAYING grant failed');
        P.Phase = 'starting'; P.StartedAt = Date.now();
        const Chosen = P.Candidates.map((Choices, I) => `${I}:${P.SelectedCandidates[I] + 1}/${CandidateCount}:OVR=${Choices[P.SelectedCandidates[I]].Rating}`);
        Log.Info(`ParkCpu solo ${P.Found.Raw.Name}: ${P.Cpu.length} CPU rosters verified against authorized candidates (${Chosen.join(', ')}); ${P.TeamSize}v${P.TeamSize} teams sent before PLAYING`);
    }
    function Publish(C, P) {
        P.Phase = 'preloading'; P.PreloadAt = Date.now();
        for (const [I, Id] of P.Cpu.entries()) {
            const Frame = FrameFor(Id, P.Seeds[I]);
            P.Bodies.set(Id, Buffer.from(Frame.subarray(32)));
            if (!C.SendObject(Frame)) throw new Error('CPU PLAYER publication failed');
        }
        Log.Info(`ParkCpu solo ${P.Found.Raw.Name}: published ${P.Cpu.length} generated PLAYER objects; awaiting authenticated game roster receipts`);
    }
    function Poll(C, P) {
        if (Pending.get(C.Id) !== P) return;
        P.CheckedAt = Date.now();
        try {
            if (!CanContinue(C, P)) { Abort(C, 'queue changed or client left'); return; }
            if (!RemoteLive(C, P)) { Abort(C, 'native control heartbeat or instance lost'); return; }
            const R = P.Control.SoloReport;
            const Bound = R?.instance === P.Instance && R?.epoch === P.Epoch;
            if (Bound && R?.match === P.MatchId.toString(16) && R.pid === P.Pid && R.error) { Abort(C, R.error); return; }
            if (!Installed(R) || R.pid !== P.Pid) { Abort(C, 'native game process is no longer available'); return; }
            if (P.Phase === 'arming') {
                if (Bound && R.match === P.MatchId.toString(16) && R.armed === true) Publish(C, P);
                else if (Date.now() - P.CreatedAt > 15000) Abort(C, 'native request authorization timed out');
            } else if (P.Phase === 'preloading') {
                if (IsReady(R, P)) Commit(C, P);
                else if (Date.now() - P.PreloadAt > 45000) Abort(C, 'native CPU generation timed out; inspect SOLO22 log');
            } else if (P.Phase === 'starting') {
                if (IsReady(R, P) && R.started === true) {
                    P.Phase = 'native-started';
                    Log.Info(`ParkCpu solo ${P.Found.Raw.Name}: client validated ${P.TeamSize * 2} prepared native rosters at InitPlayingGame; awaiting in-game play`);
                } else if (Date.now() - P.StartedAt > 30000) Abort(C, 'guarded native StartGame was not confirmed');
            }
        } catch (E) { Abort(C, E.message); }
    }
    function TryStart(C, Found) {
        if (Pending.has(C.Id)) return true;
        const Opts = Settings.ParkCpu(), TeamSize = Found.Raw.TeamSize;
        if (!Opts || C.Closed || !C.PlayerBody || !C.GotNext || C.GotNext.Playing ||
            !SupportsCourt(C, Found) || require('./PlayerBody').GenerationForConnection(C) !== '2K22' ||
            !Enabled(TeamSize) ||
            Found.Groups.length !== 2 || Found.Groups.some(G => G.Anchors.length !== TeamSize) ||
            !OnlyQueuedHuman(C, Found)) return false;
        const Own = require('./GotNext').QueueFor(C, C.GotNext.Court, C.GotNext.Slot);
        if (!Own || !Found.Groups.some(G => G.SlotObjectId === Own.SlotObjectId) ||
            !Number.isInteger(C.GotNext.Seat) || C.GotNext.Seat < 0 || C.GotNext.Seat >= TeamSize ||
            Slots.SeatsOf(Own.SlotObjectId)[C.GotNext.Seat] !== C.Puid) return false;
        const Spot = C.GotNext;
        if (!WaitForQueue(C, Found)) return false;
        const Control = Controls.get(C.Id);
        if (!Control || Date.now() - Control.SeenAt > HeartbeatMs || !Installed(Control.SoloReport)) {
            if (!C.ParkCpuSoloNotice) Log.Info('ParkCpu solo withheld: authenticated game control with Module 00010227 is required');
            C.ParkCpuSoloNotice = true; return false;
        }
        if (!Multiplayer.HasTemplatePool(C, Control.Instance.toString(16))) {
            if (!C.ParkCpuSoloNotice) Log.Info('ParkCpu solo withheld: authenticated client template pool is unavailable or differs from the server catalog');
            C.ParkCpuSoloNotice = true; return false;
        }
        const Receipt = Control.SoloReport;
        C.ParkCpuSoloNotice = false;
        let Selected;
        try { Selected = CpuTemplates.SelectCandidates(TeamSize * 2 - 1, Opts); }
        catch (E) {
            Log.Error(`ParkCpu solo ${Found.Raw.Name} withheld: ${E.message}`);
            return false;
        }
        const Seeds = Selected.map(Choices => Choices[0].Seed);
        CancelWait(C);
        const MatchId = Nonce();
        const Base = 0x0222c00000000000n | BigInt('0x' + Crypto.randomBytes(5).toString('hex'));
        const Cpu = Array.from({ length: TeamSize * 2 - 1 }, (_, I) => (Base & ~15n) + BigInt(I));
        const P = { Pid: Receipt.pid, MatchId, Cpu, Seeds, Candidates: Selected, SelectedCandidates: null, Selection: null, TeamSize, Spot,
            Court: Spot.Court, OwnSlot: Own.SlotObjectId, Activity: C.ActivityName, ActivityKey: C.ActivityKey, RoomScope: C.RoomScope || null,
            Found, Bodies: new Map(), Phase: 'arming', CreatedAt: Date.now(),
            Control, Instance: Control.Instance.toString(16), Epoch: Control.Epoch.toString(16) };
        Pending.set(C.Id, P);
        try {
            const Request = BuildRequest(MatchId, C.Puid, Cpu, TeamSize, Seeds, Selected);
            P.Envelope = Buffer.alloc(24 + RequestBytes);
            P.Envelope.writeBigUInt64LE(Control.Instance, 0); P.Envelope.writeBigUInt64LE(Control.Epoch, 8);
            P.Envelope.writeUInt32LE(LeaseMs, 16); Request.copy(P.Envelope, 24);
            P.Lease = Buffer.alloc(32); P.Envelope.copy(P.Lease, 0, 0, 24); P.Lease.writeBigUInt64LE(MatchId, 24);
            Log.Info(`ParkCpu solo ${Found.Raw.Name}: CPU overall ${Opts.CpuOverallMode === 'fixed' ? `fixed ${Opts.CpuFixedOverall}` : 'random 80-99'}; ${CandidateCount} authorized candidates per CPU; templates: ${Selected.map(Choices => Choices[0].Name).join(', ')}; awaiting authenticated game control authorization`);
            Watch(P, () => Poll(C, P));
        } catch (E) { Abort(C, E.message); }
        return true;
    }
    function Finish(C, Found, Game, Reason) {
        if (!Game.NativeSolo || Game.Ended) return false;
        Game.Ended = true; Stop(C);
        require('./GotNext').Release(C);
        // Away seats may already be free; Release then has no seat change to broadcast.
        CourtData.BroadcastCourtGroup(C, Found.Groups[0]);
        Log.Info(`ParkCpu solo ${Found.Raw.Name} ended (${Reason}); CPU objects removed and queue restored`);
        return true;
    }
    function HandleUpdate(C, Bytes) {
        return HandleCpuUpdate(C, Bytes, Pending.get(C.Id));
    }
    function ValidateReport(R) {
        const Hex = Value => typeof Value === 'string' && /^[0-9a-f]{1,16}$/.test(Value);
        // An unready module can report its status, but cannot authorize a CPU match.
        if (!R || R.version !== ProtocolVersion || R.module !== '00010227' || typeof R.installed !== 'boolean' ||
            !Number.isInteger(R.pid) || R.pid <= 0 || !Hex(R.instance) || BigInt('0x' + R.instance) === 0n ||
            !Hex(R.epoch) || !Hex(R.match) || typeof R.armed !== 'boolean' || typeof R.started !== 'boolean' ||
            !Array.isArray(R.created) || R.created.length > Wire.MaxCpu || typeof R.profileDigest !== 'string' || !/^[0-9a-f]{64}$/.test(R.profileDigest) ||
            !Number.isInteger(R.cpuCount) || R.cpuCount < 0 || R.cpuCount > Wire.MaxCpu ||
            !Array.isArray(R.candidates) || R.candidates.length !== R.cpuCount ||
            R.candidates.some(I => !Number.isInteger(I) || I < -1 || I >= CandidateCount) ||
            (R.error !== null && (typeof R.error !== 'string' || R.error.length > 2048))) throw new Error('invalid native solo report');
    }
    function OnReport(C) {
        const Control = Controls.get(C.Id), R = Control.SoloReport;
        let P = Pending.get(C.Id);
        if (P) Poll(C, P);
        P = Pending.get(C.Id);
        if (!P || P.Control !== Control) return null;
        return R.epoch === P.Epoch && R.match === P.MatchId.toString(16) && R.armed === true ? P.Lease : P.Envelope;
    }
    return { TryStart, QueueChanged, Stop, Disconnect, Finish, HandleUpdate, OnReport, Pending, IsReady, Poll, ValidateReport, Abort };
})();

function OnControlReport(Puid, R, Receipt) {
    Solo.ValidateReport(Receipt);
    if (Receipt.instance !== R.Instance.toString(16)) throw new Error('native control instance mismatch');
    const Matches = Roster.Active().filter(C => C.Puid === Puid && ['neighborhood', 'cages'].includes(C.ActivityName) &&
        C.PlayerBody && require('./PlayerBody').GenerationForConnection(C) === '2K22');
    if (Matches.length !== 1) return null;
    for (const [Id, Control] of Controls) if (Control.Connection.Closed) Controls.delete(Id);
    const C = Matches[0], Now = Date.now();
    let Control = Controls.get(C.Id);
    if (Control && (Control.Instance !== R.Instance || Control.SoloReport.pid !== Receipt.pid)) {
        if (Now - Control.SeenAt <= Wire.HeartbeatMs) {
            const Failure = new Error('another native instance is active'); Failure.Status = 409; throw Failure;
        }
        Multiplayer.Stop(C, 'native instance changed'); Solo.Abort(C, 'remote native instance changed');
        Controls.delete(C.Id); Control = null;
    }
    if (!Control) {
        Control = { Connection: C, Instance: R.Instance, Epoch: Nonce() };
        Controls.set(C.Id, Control);
    }
    Control.SeenAt = Now; Control.Report = R; Control.SoloReport = Receipt;
    if (!Multiplayer.HasMatch(C) && !Solo.Pending.has(C.Id) && C.GotNext && !C.GotNext.Playing)
        require('./GotNext').MaybeStartMatch(C);
    const Park = Multiplayer.OnReport(C), Single = Solo.OnReport(C);
    if (!Park && !Single) return null;
    const Header = Buffer.alloc(16);
    Header.writeUInt32LE(0x3743504e, 0); Header.writeUInt32LE(7, 4);
    Header.writeUInt32LE(Park?.length || 0, 8); Header.writeUInt32LE(Single?.length || 0, 12);
    return Buffer.concat([Header, ...(Park ? [Park] : []), ...(Single ? [Single] : [])]);
}

function TryStart(C, Found) {
    return Multiplayer.TryStart(C, Found) || Solo.TryStart(C, Found);
}
function Stop(C, Why) {
    // Do not short-circuit: both modes must clear their state/waiters.
    const Mixed = Multiplayer.Stop(C, Why), Single = Solo.Stop(C);
    return Mixed || Single;
}
function Disconnect(C) {
    Multiplayer.Disconnect(C);
    Solo.Disconnect(C);
    Controls.delete(C.Id);
}
function Finish(C, Found, Game, Why) {
    return Game.NativeSolo ? Solo.Finish(C, Found, Game, Why) : Multiplayer.Finish(C, Found, Game, Why);
}
function HandleUpdate(C, Bytes) {
    return Multiplayer.HandleUpdate(C, Bytes) || Solo.HandleUpdate(C, Bytes);
}
module.exports = {
    TryStart, Stop, Disconnect, Finish, HandleUpdate, CancelWait, WaitForQueue, FrameFor,
    QueueChanged: Multiplayer.QueueChanged, HasTemplatePool: Multiplayer.HasTemplatePool,
    OnControlReport,
    Pending: Solo.Pending, IsReady: Solo.IsReady, Poll: Solo.Poll,
};
