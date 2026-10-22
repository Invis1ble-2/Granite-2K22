'use strict';
// All native 2v2/3v3 control uses the authenticated game session.
const Crypto = require('node:crypto');
const Log = require('../Core/Log');
const Slots = require('./Slots');
const Roster = require('./Roster');
const CourtData = require('./CourtData');
const PlayerObject = require('./PlayerObject');
const Body22 = require('./PlayerBody2K22');
const ObjectFrame = require('../Codec/ObjectFrame');
const Settings = require('../Core/Config');
const CpuTemplates = require('./CpuTemplates2K22');
const ProtocolVersion = 3, RequestBytes = 96;
const Pending = new Map(), Controls = new Map();
const LeaseMs = 8000, HeartbeatMs = 10000;
const Nonce = () => (Crypto.randomBytes(8).readBigUInt64LE() || 1n).toString(16);
function Config() { return Settings.NativePark(); }
function Installed(R) {
    return Boolean(R && R.version === ProtocolVersion && R.module === '00010221' && R.installed === true &&
        Number.isInteger(R.pid) && R.pid > 0);
}
function RemoteLive(C, P) {
    return Controls.get(C.Id) === P.Control && Date.now() - P.Control.SeenAt <= HeartbeatMs &&
        P.Control.Report.instance === P.Instance && Installed(P.Control.Report) &&
        require('./NativePark').HasTemplatePool(C, P.Instance);
}
function ReceiptFor(P) { return P.Control.Report; }
function IsReady(R, P) {
    return Installed(R) && R.pid === P.Pid && R.instance === P.Instance && R.epoch === P.Epoch && R.armed === true &&
        R.match === P.MatchId.toString(16) && !R.error &&
        R.teamSize === P.TeamSize && R.cpuCount === P.Cpu.length &&
        Array.isArray(R.created) && R.created.length === P.Cpu.length && new Set(R.created).size === P.Cpu.length &&
        P.Cpu.every(Id => R.created.includes(Id.toString(16))) &&
        Array.isArray(R.profiles) && R.profiles.length === P.Cpu.length &&
        new Set(R.profiles.map(Profile => Profile?.id)).size === P.Cpu.length &&
        P.Cpu.every((Id, I) => {
            const Actual = R.profiles.find(Profile => Profile?.id === Id.toString(16));
            const Expected = CpuTemplates.ProfileForSeed(P.Seeds[I]);
            return Actual?.seed === P.Seeds[I] && Actual.overall === Expected.Overall && Actual.height === Expected.Height &&
                Actual.weight === Expected.Weight && CpuTemplates.ValidBadges(P.Seeds[I], Actual.badges) &&
                CpuTemplates.ValidShotTendencies(Actual.threePointAbility, Actual.shotTendencies) &&
                Array.isArray(Actual.shape) && Actual.shape.length === 5 &&
                // Exact template shape bits are checked against the source by the module.
                Actual.shape.every(Value => Number.isFinite(Value) && Value > 0);
        });
}
function BuildRequest(Match, Owner, Cpu, TeamSize = (Cpu.length + 1) / 2, Seeds) {
    if (![2,3].includes(TeamSize) || Cpu.length !== TeamSize * 2 - 1 || new Set(Cpu).size !== Cpu.length ||
        Cpu.some(Id => typeof Id !== 'bigint' || Id === Owner || (Id & 0xfffff00000000000n) !== 0x0222c00000000000n) ||
        !Array.isArray(Seeds) || Seeds.length !== Cpu.length || Seeds.some(Seed => !Number.isInteger(Seed) || Seed < 1 || Seed > 0xffffffff))
        throw new Error('invalid native solo CPU roster');
    const B = Buffer.alloc(RequestBytes);
    B.write('SP22');B.writeUInt32LE(ProtocolVersion,4);B.writeBigUInt64LE(Match,8);B.writeBigUInt64LE(Owner,16);
    B.writeUInt32LE(TeamSize,24);B.writeUInt32LE(Cpu.length,28);
    Cpu.forEach((Id,I) => B.writeBigUInt64LE(Id,32+I*8));
    Seeds.forEach((Seed, I) => B.writeUInt32LE(Seed, 72 + I * 4));
    return B;
}
function FrameFor(Id, Seed) {
    return ObjectFrame.Build({PacketId:PlayerObject.ObjectDataPacket,ConnectionId:null,ObjectId:Id,
        ClassCrc:PlayerObject.PlayerClass,Payload:Body22.BuildGeneratedPlayer(Id,Seed),Layout:ObjectFrame.Layout.Nineteen});
}
function OnlyQueuedHuman(C, Found) {
    return Found.Groups.every(G => Slots.SeatsOf(G.SlotObjectId).every(Id => !Id || Id === C.Puid));
}
function CanContinue(C, P) {
    return !C.Closed && C.ActivityKey === P.ActivityKey && (C.RoomScope || null) === P.RoomScope &&
        C.GotNext === P.Spot && C.GotNext.Court === P.Court && Boolean(C.PlayerBody) &&
        ((P.Phase !== 'arming' && P.Phase !== 'preloading') || OnlyQueuedHuman(C, P.Found));
}
function CancelWait(C) { return require('./NativePark').CancelWait(C); }
function QueueChanged(C, Found) {
    for (const P of Pending.values()) {
        if (P.ActivityKey !== C.ActivityKey || P.RoomScope !== (C.RoomScope || null) ||
            P.Found.Raw.Name !== Found.Raw.Name || (P.Phase !== 'arming' && P.Phase !== 'preloading')) continue;
        const Owner = P.Control.Connection;
        if (Owner.GotNext !== P.Spot || !OnlyQueuedHuman(Owner, Found)) {
            Stop(Owner);
            Log.Info(`Native solo ${Found.Raw.Name}: queue changed during preparation; retaining human queue seats`);
        }
    }
}
function Stop(C) {
    const Cancelled = CancelWait(C), P = Pending.get(C.Id);
    if (!P) return Cancelled;
    Pending.delete(C.Id);clearInterval(P.Timer);
    // Withdraw authorization first, before destroying players or allowing another match.
    const Game = CourtData.GameTeams(P.Activity,P.Found.Raw.Name,'2K22');
    if (Game?.NativeSolo?.MatchId === P.MatchId) CourtData.ClearGameTeams(P.Activity,P.Found.Raw.Name,'2K22');
    for (const Id of P.Cpu) {
        Slots.Release(Id);
        if (!C.Closed) {
            try { C.SendObject(PlayerObject.DestroyFrameFor({Puid:Id})); }
            catch (E) { Log.Error(`Native solo CPU removal failed: ${E.message}`); }
        }
    }
    return true;
}
function Abort(C, Why) {
    const P = Pending.get(C.Id);
    if (!P) return;
    Stop(C);
    Log.Error(`Native solo ${P.TeamSize}v${P.TeamSize} stopped: ${Why}; restoring queue state`);
    // Do not release a new queue or a normal full-human game started in the meantime.
    const Game = CourtData.GameTeams(P.Activity,P.Found.Raw.Name,'2K22');
    if (!C.Closed && C.GotNext === P.Spot && !Game) require('./GotNext').Release(C);
}
function Commit(C, P) {
    const Held = require('./GotNext').QueueFor(C,C.GotNext.Court,C.GotNext.Slot);
    const OwnGroup = Held?.SlotObjectId === P.OwnSlot ?
        P.Found.Groups.findIndex(G => G.SlotObjectId === P.OwnSlot) : -1;
    if (OwnGroup < 0) throw new Error('human queue group changed');
    if (CourtData.GameTeams(P.Activity,P.Found.Raw.Name,'2K22')) throw new Error('court already has a game');
    const Sides = [[],[]];
    for (let Side = 0; Side < 2; ++Side) {
        const Seats = Slots.StateFor(P.Found.Groups[Side].SlotObjectId,P.TeamSize).Seats;
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
        const Occupied = Slots.Occupy(P.Found.Groups[Side].SlotObjectId,Id,P.TeamSize,I);
        if (!Occupied || Occupied.Index !== I) throw new Error('CPU seat became unavailable');
        Sides[Side][I] = Id;
    }
    const Userdata = require('./Userdata');
    const Data = C.Userdata && Userdata.Read(C.Userdata);
    if (!Data || !Data.IsUserdata || Data.DeclaredLength !== Data.Blob.length) throw new Error('human USERDATA is incomplete');
    const HumanProfile = Userdata.CourtProfile(C, Data.Blob);
    const Profiles = Sides.map(Side => Side.map(Id => Id === C.Puid ? HumanProfile : Buffer.alloc(0)));
    const Prepared = CourtData.PrepareGameTeams(P.Activity,P.Found.Raw.Name,Sides[0],Sides[1],
        {Home:Profiles[0],Away:Profiles[1]},'2K22',{NativeSolo:{Owner:C.Puid,MatchId:P.MatchId}});
    if (!C.SendObject(Prepared.Frame)) throw new Error('court roster send failed');
    if (!require('./GotNext').GrantPlaying(C)) throw new Error('PLAYING grant failed');
    P.Phase = 'starting';P.StartedAt = Date.now();
    Log.Info(`Native solo ${P.Found.Raw.Name}: ${P.Cpu.length} enhanced CPU rosters verified against their seeds; ${P.TeamSize}v${P.TeamSize} teams sent before PLAYING`);
}
function Publish(C, P) {
    P.Phase = 'preloading'; P.PreloadAt = Date.now();
    for (const [I, Id] of P.Cpu.entries()) {
        const Frame = FrameFor(Id, P.Seeds[I]);
        P.Bodies.set(Id, Buffer.from(Frame.subarray(32)));
        if (!C.SendObject(Frame)) throw new Error('CPU PLAYER publication failed');
    }
    Log.Info(`Native solo ${P.Found.Raw.Name}: published ${P.Cpu.length} generated PLAYER objects; awaiting authenticated game roster receipts`);
}
function Poll(C, P) {
    if (Pending.get(C.Id) !== P) return;
    try {
        if (!CanContinue(C,P)) { Abort(C,'queue changed or client left'); return; }
        if (!RemoteLive(C, P)) { Abort(C, 'native control heartbeat or instance lost'); return; }
        const R = ReceiptFor(P);
        const Bound = R?.instance === P.Instance && R?.epoch === P.Epoch;
        if (Bound && R?.match === P.MatchId.toString(16) && R.pid === P.Pid && R.error) { Abort(C,R.error); return; }
        if (!Installed(R) || R.pid !== P.Pid) { Abort(C,'native game process is no longer available'); return; }
        if (P.Phase === 'arming') {
            if (Bound && R.match === P.MatchId.toString(16) && R.armed === true) Publish(C, P);
            else if (Date.now() - P.CreatedAt > 15000) Abort(C, 'native request authorization timed out');
        } else if (P.Phase === 'preloading') {
            if (IsReady(R,P)) Commit(C,P);
            else if (Date.now()-P.PreloadAt > 45000) Abort(C,'native CPU generation timed out; inspect SOLO22 log');
        } else if (P.Phase === 'starting') {
            if (IsReady(R,P) && R.started === true) {
                P.Phase = 'native-started';
                Log.Info(`Native solo ${P.Found.Raw.Name}: client validated ${P.TeamSize * 2} prepared native rosters at InitPlayingGame; awaiting in-game play`);
            } else if (Date.now()-P.StartedAt > 30000) Abort(C,'guarded native StartGame was not confirmed');
        }
    } catch (E) { Abort(C,E.message); }
}
function TryStart(C, Found) {
    if (Pending.has(C.Id)) return true;
    const Opts = Config(), TeamSize = Found.Raw.TeamSize;
    if (!Opts || C.Closed || !C.PlayerBody || !C.GotNext || C.GotNext.Playing ||
        C.ActivityName !== 'neighborhood' || require('./PlayerBody').GenerationForConnection(C) !== '2K22' ||
        ![2,3].includes(TeamSize) || (TeamSize === 2 ? Opts.TwoOnTwo : Opts.ThreeOnThree) === false ||
        CourtData.ParkCourtFormat(Found.Raw.Name) !== 'bitstream' ||
        Found.Groups.length !== 2 || Found.Groups.some(G => G.Anchors.length !== TeamSize) ||
        !OnlyQueuedHuman(C, Found)) {
        return false;
    }
    const Own = require('./GotNext').QueueFor(C,C.GotNext.Court,C.GotNext.Slot);
    if (!Own || !Found.Groups.some(G => G.SlotObjectId === Own.SlotObjectId) ||
        !Number.isInteger(C.GotNext.Seat) || C.GotNext.Seat < 0 || C.GotNext.Seat >= TeamSize ||
        Slots.SeatsOf(Own.SlotObjectId)[C.GotNext.Seat] !== C.Puid) {
        return false;
    }
    const Spot = C.GotNext;
    if (!require('./NativePark').WaitForQueue(C, Found)) return false;
    const Control = Controls.get(C.Id);
    if (!Control || Date.now() - Control.SeenAt > HeartbeatMs || !Installed(Control.Report)) {
        if (!C.NativeSoloNotice) Log.Info('Native solo withheld: authenticated game control with Module 00010221 is required');
        C.NativeSoloNotice = true; return false;
    }
    if (!require('./NativePark').HasTemplatePool(C, Control.Instance)) {
        if (!C.NativeSoloNotice) Log.Info('Native solo withheld: authenticated client template pool is unavailable or differs from the server catalog');
        C.NativeSoloNotice = true; return false;
    }
    const Receipt = Control.Report;
    C.NativeSoloNotice = false;
    let Selected;
    try { Selected = CpuTemplates.Select(TeamSize * 2 - 1, Opts); }
    catch (E) {
        Log.Error(`Native solo ${Found.Raw.Name} withheld: ${E.message}`);
        return false;
    }
    const Seeds = Selected.map(Profile => Profile.Seed);
    CancelWait(C);
    const MatchId = Crypto.randomBytes(8).readBigUInt64LE() || 1n;
    const Base = 0x0222c00000000000n | BigInt('0x'+Crypto.randomBytes(5).toString('hex'));
    const Cpu = Array.from({length:TeamSize * 2 - 1},(_,I) => (Base & 0xfffffffffffffff8n)+BigInt(I));
    const P = {Pid:Receipt.pid,MatchId,Cpu,Seeds,TeamSize,Spot,Court:Spot.Court,OwnSlot:Own.SlotObjectId,
        Activity:C.ActivityName,ActivityKey:C.ActivityKey,RoomScope:C.RoomScope || null,
        Found,Bodies:new Map(),Phase:'arming',CreatedAt:Date.now(),Timer:null,
        Remote:true,Control,Instance:Control.Instance,Epoch:Control.Epoch};
    Pending.set(C.Id,P);
    try {
        P.Request = BuildRequest(MatchId, C.Puid, Cpu, TeamSize, Seeds);
        Log.Info(`Native solo ${Found.Raw.Name}: CPU overall ${Opts.CpuOverallMode === 'fixed' ? `fixed ${Opts.CpuFixedOverall}` : 'random 80-99'}; templates: ${Selected.map(Profile => Profile.Name).join(', ')}; awaiting authenticated game control authorization`);
        P.Timer = setInterval(() => Poll(C,P),120);P.Timer.unref?.();
    } catch (E) { Abort(C,E.message); }
    return true;
}
function Finish(C, Found, Game, Reason) {
    if (!Game.NativeSolo || Game.Ended) return false;
    Game.Ended = true;Stop(C);
    require('./GotNext').Release(C);
    // Away seats may already be free; Release then has no seat change to broadcast.
    CourtData.BroadcastCourtGroup(C,Found.Groups[0]);
    Log.Info(`Native solo ${Found.Raw.Name} ended (${Reason}); CPU objects removed and queue restored`);
    return true;
}
function HandleUpdate(C, Bytes) {
    const P = Pending.get(C.Id);
    if (!P || C.Closed || Bytes.length < 42 || Bytes.readUInt32BE(4) !== 0xfef2dd68 ||
        Bytes.readUInt32BE(32) !== PlayerObject.PlayerClass) return false;
    const Id = Bytes.readBigUInt64BE(24), Cached = P.Bodies.get(Id), Size = Bytes.readUInt16BE(40);
    if (!Cached || Bytes.length < 42+Size) return false;
    const Body = Bytes.subarray(42,42+Size), D = Body22.Decode(Body), Base = Body22.Decode(Cached);
    if (!D.Ok || !Base.Ok || Body.readBigUInt64BE() !== Id) return false;
    const PuidAt = D.Offsets.get(0);
    if (PuidAt !== undefined && Body.readBigUInt64LE(PuidAt) !== Id) return false;
    const From = Body.readBigUInt64BE(8), To = (From > Cached.readBigUInt64BE(8) ? From : Cached.readBigUInt64BE(8))+16n;
    if (To > 0xffffffffffffffffn) return false;
    const Protected = new Set([0,1,4,5,91,93,144]);
    const Values = new Map();
    for (const [Decoded,Data,Partial] of [[Base,Cached,false],[D,Body,true]]) {
        const Ids = [...Decoded.Offsets.keys()];
        Ids.forEach((Field,I) => {
            if (Partial && Protected.has(Field)) return;
            Values.set(Field,Data.subarray(Decoded.Offsets.get(Field),I+1<Ids.length ? Decoded.Offsets.get(Ids[I+1]) : Decoded.Length));
        });
    }
    const Header = Buffer.from(Cached.subarray(0,Body22.ValuesStart));Header.fill(0,16);Header.writeBigUInt64BE(To,8);
    const Parts = [...Values].sort((A,B)=>A[0]-B[0]).map(([Field,Value]) => {
        Header[16+(Field>>3)] |= 0x80>>(Field&7);return Value;
    });
    const Next = Buffer.concat([Header,...Parts]);P.Bodies.set(Id,Next);
    const Request = Bytes.readBigUInt64BE(16);
    if (Request) C.Send(require('./Requests').Build(Request));
    return C.SendObject(ObjectFrame.Build({PacketId:PlayerObject.ObjectDataPacket,ConnectionId:null,ObjectId:Id,
        ClassCrc:PlayerObject.PlayerClass,Payload:Next,Layout:ObjectFrame.Layout.Nineteen}));
}
function OnReport(Puid, R) {
    const Hex = Value => typeof Value === 'string' && /^[0-9a-f]{1,16}$/.test(Value);
    if (!R || !Installed(R) || !Hex(R.instance) || BigInt('0x' + R.instance) === 0n ||
        !Hex(R.epoch) || !Hex(R.match) || typeof R.armed !== 'boolean' || typeof R.started !== 'boolean' ||
        !Array.isArray(R.created) || R.created.length > 5 || !Array.isArray(R.profiles) || R.profiles.length > 5 ||
        (R.error !== null && (typeof R.error !== 'string' || R.error.length > 2048))) throw new Error('invalid native solo report');
    for (const [Id, Control] of Controls) if (Control.Connection.Closed) Controls.delete(Id);
    const Matches = Roster.Active().filter(C => C.Puid === Puid && C.ActivityName === 'neighborhood' &&
        C.PlayerBody && require('./PlayerBody').GenerationForConnection(C) === '2K22');
    if (Matches.length !== 1) return null;
    const C = Matches[0], Now = Date.now();
    let Control = Controls.get(C.Id);
    if (Control && (Control.Instance !== R.instance || Control.Report.pid !== R.pid)) {
        if (Now - Control.SeenAt <= HeartbeatMs) {
            const Failure = new Error('another solo native instance is active'); Failure.Status = 409; throw Failure;
        }
        if (Pending.has(C.Id)) Abort(C, 'remote native instance changed');
        Controls.delete(C.Id); Control = null;
    }
    if (!Control) {
        Control = {Connection:C,Instance:R.instance,Epoch:Nonce(),SeenAt:Now,Report:R};
        Controls.set(C.Id, Control);
    }
    Control.SeenAt = Now; Control.Report = R;
    let P = Pending.get(C.Id);
    if (P?.Remote) Poll(C, P);
    else if (!P && C.GotNext && !C.GotNext.Playing) require('./GotNext').MaybeStartMatch(C);
    P = Pending.get(C.Id);
    if (!P?.Remote || P.Control !== Control) return null;
    const B = Buffer.alloc(120);
    B.writeBigUInt64LE(BigInt('0x' + P.Instance), 0); B.writeBigUInt64LE(BigInt('0x' + P.Epoch), 8);
    B.writeUInt32LE(LeaseMs, 16); P.Request.copy(B, 24);
    return B;
}
module.exports = {TryStart,CancelWait,QueueChanged,Stop,Finish,Pending,FrameFor,IsReady,Poll,HandleUpdate,OnReport};
