'use strict';
// One client, local or session-authenticated remote control; guarded native 2v2/3v3.
const Fs = require('node:fs');
const Path = require('node:path');
const Crypto = require('node:crypto');
const Log = require('../Core/Log');
const Slots = require('./Slots');
const Roster = require('./Roster');
const CourtData = require('./CourtData');
const PlayerObject = require('./PlayerObject');
const Body22 = require('./PlayerBody2K22');
const ObjectFrame = require('../Codec/ObjectFrame');
const ConfigPath = Path.resolve(__dirname, '../..', 'NativeSoloPark.json');
const ProtocolVersion = 3, RequestBytes = 96, WaitMs = 10000;
const Pending = new Map(), Waiting = new Map(), Controls = new Map();
const LeaseMs = 8000, HeartbeatMs = 10000;
const Nonce = () => (Crypto.randomBytes(8).readBigUInt64LE() || 1n).toString(16);
function Config() {
    try {
        const C = JSON.parse(Fs.readFileSync(ConfigPath, 'utf8'));
        return C.Enabled === true ? C : null;
    } catch (_) { return null; }
}
function ReadReceipt(Root) {
    try { return JSON.parse(Fs.readFileSync(Path.join(Root, 'SoloParkNative.ready.json'), 'utf8')); }
    catch (_) { return null; }
}
function Installed(R, Remote = false) {
    if (!R || R.version !== ProtocolVersion || R.module !== '00010213' || R.installed !== true || !Number.isInteger(R.pid) || R.pid <= 0) return false;
    if (Remote) return true; // Remote liveness comes from authenticated heartbeats, not a server-local PID.
    try { process.kill(R.pid, 0); return true; } catch (_) { return false; }
}
function RemoteLive(C, P) {
    return Controls.get(C.Id) === P.Control && Date.now() - P.Control.SeenAt <= HeartbeatMs &&
        P.Control.Report.instance === P.Instance && Installed(P.Control.Report, true);
}
function ReceiptFor(P) { return P.Remote ? P.Control.Report : ReadReceipt(P.Root); }
// Same uint32 recipe as CpuEnhancement::Random; independent of the game's RNG.
function ProfileForSeed(Seed) {
    let State = (Seed ^ 0x50433232) >>> 0;
    const Next = () => {
        State = (State + 0x9e3779b9) >>> 0;
        let X = Math.imul(State ^ (State >>> 16), 0x21f0aaad) >>> 0;
        X = Math.imul(X ^ (X >>> 15), 0x735a2d97) >>> 0;
        return (X ^ (X >>> 15)) >>> 0;
    };
    const Below = Count => {
        const Threshold = ((-Count) >>> 0) % Count;
        let X; do { X = Next(); } while (X < Threshold);
        return X % Count;
    };
    return { Overall: 80 + Below(20), Height: 175 + Below(46),
        Shape: Array.from({ length: 5 }, () => (9500 + Below(1001)) / 10000) };
}
function IsReady(R, P) {
    return Installed(R, P.Remote) && R.pid === P.Pid && (!P.Remote || (R.instance === P.Instance && R.epoch === P.Epoch && R.armed === true)) &&
        R.match === P.MatchId.toString(16) && !R.error &&
        R.teamSize === P.TeamSize && R.cpuCount === P.Cpu.length &&
        Array.isArray(R.created) && R.created.length === P.Cpu.length && new Set(R.created).size === P.Cpu.length &&
        P.Cpu.every(Id => R.created.includes(Id.toString(16))) &&
        Array.isArray(R.profiles) && R.profiles.length === P.Cpu.length &&
        new Set(R.profiles.map(Profile => Profile?.id)).size === P.Cpu.length &&
        P.Cpu.every((Id, I) => {
            const Actual = R.profiles.find(Profile => Profile?.id === Id.toString(16));
            const Expected = ProfileForSeed(P.Seeds[I]);
            return Actual?.seed === P.Seeds[I] && Actual.overall === Expected.Overall && Actual.height === Expected.Height &&
                Array.isArray(Actual.shape) && Actual.shape.length === 5 &&
                Actual.shape.every((Value, J) => Number.isFinite(Value) && Math.abs(Value - Expected.Shape[J]) < 0.00001);
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
function WriteRequest(Root, Match, Owner, Cpu, TeamSize, Seeds) {
    const B = BuildRequest(Match, Owner, Cpu, TeamSize, Seeds);
    const File = Path.join(Root,'SoloParkNative.request');
    try { Fs.writeFileSync(File+'.tmp',B);Fs.renameSync(File+'.tmp',File); }
    catch (E) { try { Fs.unlinkSync(File+'.tmp'); } catch (_) {} throw E; }
}
function FrameFor(Id, Seed) {
    return ObjectFrame.Build({PacketId:PlayerObject.ObjectDataPacket,ConnectionId:null,ObjectId:Id,
        ClassCrc:PlayerObject.PlayerClass,Payload:Body22.BuildGeneratedPlayer(Id,Seed),Layout:ObjectFrame.Layout.Nineteen});
}
function Alone(C) {
    const Humans = Roster.InActivity(C.ActivityKey, C.RoomScope || null);
    return Humans.length === 1 && Humans[0] === C;
}
function CanContinue(C, P) {
    return !C.Closed && C.ActivityKey === P.ActivityKey && (C.RoomScope || null) === P.RoomScope &&
        C.GotNext === P.Spot && C.GotNext.Court === P.Court && Boolean(C.PlayerBody) && Alone(C);
}
function CancelWait(C) {
    const W = Waiting.get(C.Id);
    if (!W) return false;
    Waiting.delete(C.Id);clearTimeout(W.Timer);
    return true;
}
function Stop(C) {
    const Cancelled = CancelWait(C), P = Pending.get(C.Id);
    if (!P) return Cancelled;
    Pending.delete(C.Id);clearInterval(P.Timer);
    // Withdraw authorization first, before destroying players or allowing another match.
    if (!P.Remote) try {
        const File = Path.join(P.Root,'SoloParkNative.request');
        const B = Fs.readFileSync(File);
        if (B.length === RequestBytes && B.readUInt32LE(4) === ProtocolVersion && B.readBigUInt64LE(8) === P.MatchId)
            Fs.unlinkSync(File);
    } catch (_) {}
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
    const Profiles = Sides.map(Side => Side.map(Id => Id === C.Puid ? Data.Blob : Buffer.alloc(0)));
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
    Log.Info(`Native solo ${P.Found.Raw.Name}: published ${P.Cpu.length} generated PLAYER objects; awaiting client roster receipts (${P.Remote ? 'network' : 'local'})`);
}
function Poll(C, P) {
    if (Pending.get(C.Id) !== P) return;
    try {
        if (!CanContinue(C,P)) { Abort(C,'queue changed, client left or another human joined'); return; }
        if (P.Remote && !RemoteLive(C, P)) { Abort(C, 'remote native control heartbeat or instance lost'); return; }
        const R = ReceiptFor(P);
        const Bound = !P.Remote || (R?.instance === P.Instance && R?.epoch === P.Epoch);
        if (Bound && R?.match === P.MatchId.toString(16) && R.pid === P.Pid && R.error) { Abort(C,R.error); return; }
        if (!Installed(R, P.Remote) || R.pid !== P.Pid) { Abort(C,'native game process is no longer available'); return; }
        if (P.Phase === 'arming') {
            if (Bound && R.match === P.MatchId.toString(16) && R.armed === true) Publish(C, P);
            else if (Date.now() - P.CreatedAt > 15000) Abort(C, 'remote solo request authorization timed out');
        } else if (P.Phase === 'preloading') {
            if (IsReady(R,P)) Commit(C,P);
            else if (Date.now()-P.PreloadAt > 45000) Abort(C,'native CPU generation timed out; inspect SOLO22 log');
        } else if (P.Phase === 'starting') {
            if (IsReady(R,P) && R.started === true) {
                P.Phase = 'native-started';
                if (!P.Remote) clearInterval(P.Timer);
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
        Pending.size || !Alone(C) ||
        Found.Groups.some(G => Slots.SeatsOf(G.SlotObjectId).some(Id => Id && Id !== C.Puid))) {
        CancelWait(C);return false;
    }
    const Own = require('./GotNext').QueueFor(C,C.GotNext.Court,C.GotNext.Slot);
    if (!Own || !Found.Groups.some(G => G.SlotObjectId === Own.SlotObjectId) ||
        !Number.isInteger(C.GotNext.Seat) || C.GotNext.Seat < 0 || C.GotNext.Seat >= TeamSize ||
        Slots.SeatsOf(Own.SlotObjectId)[C.GotNext.Seat] !== C.Puid) {
        CancelWait(C);return false;
    }
    const Spot = C.GotNext;
    if (!Number.isFinite(Spot.Since)) Spot.Since = Date.now();
    const Remaining = WaitMs - (Date.now() - Spot.Since);
    if (Remaining > 0) {
        if (Waiting.get(C.Id)?.Spot !== Spot) CancelWait(C);
        if (!Waiting.has(C.Id)) {
            const W = {Spot,Timer:null};
            W.Timer = setTimeout(() => {
                if (Waiting.get(C.Id) !== W) return;
                Waiting.delete(C.Id);
                if (C.Closed || C.GotNext !== Spot || Spot.Playing) return;
                try { require('./GotNext').MaybeStartMatch(C); }
                catch (E) { Log.Error(`Native solo delayed start withheld: ${E.message}`); }
            },Remaining);
            W.Timer.unref?.();Waiting.set(C.Id,W);
            Log.Info(`Native solo ${Found.Raw.Name}: waiting 10 seconds before ${TeamSize}v${TeamSize} CPU fill`);
        }
        return false;
    }
    CancelWait(C);
    const Control = Controls.get(C.Id);
    const Remote = Boolean(Control && Date.now() - Control.SeenAt <= HeartbeatMs && Installed(Control.Report, true));
    const Receipt = Remote ? Control.Report : (typeof Opts.GameDirectory === 'string' && Opts.GameDirectory.length ? ReadReceipt(Opts.GameDirectory) : null);
    if (!Installed(Receipt, Remote)) {
        if (!C.NativeSoloNotice) Log.Info('Native solo withheld: Module 00010213 with solo v3 readiness is required locally or through the game login');
        C.NativeSoloNotice = true; return false;
    }
    C.NativeSoloNotice = false;
    const MatchId = Crypto.randomBytes(8).readBigUInt64LE() || 1n;
    const Base = 0x0222c00000000000n | BigInt('0x'+Crypto.randomBytes(5).toString('hex'));
    const Cpu = Array.from({length:TeamSize * 2 - 1},(_,I) => (Base & 0xfffffffffffffff8n)+BigInt(I));
    const Seeds = Cpu.map(() => Crypto.randomBytes(4).readUInt32LE() || 1);
    const P = {Root:Remote ? null : Opts.GameDirectory,Pid:Receipt.pid,MatchId,Cpu,Seeds,TeamSize,Spot,Court:Spot.Court,OwnSlot:Own.SlotObjectId,
        Activity:C.ActivityName,ActivityKey:C.ActivityKey,RoomScope:C.RoomScope || null,
        Found,Bodies:new Map(),Phase:'arming',CreatedAt:Date.now(),Timer:null,
        Remote,Control,Instance:Remote ? Control.Instance : null,Epoch:Remote ? Control.Epoch : null};
    Pending.set(C.Id,P);
    try {
        if (Remote) {
            P.Request = BuildRequest(MatchId, C.Puid, Cpu, TeamSize, Seeds);
            Log.Info(`Native solo ${Found.Raw.Name}: awaiting authenticated remote request authorization`);
        } else {
            WriteRequest(P.Root,MatchId,C.Puid,Cpu,TeamSize,Seeds);
            Publish(C, P);
        }
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
    if (!R || !Installed(R, true) || !Hex(R.instance) || BigInt('0x' + R.instance) === 0n ||
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
module.exports = {TryStart,CancelWait,Stop,Finish,Pending,FrameFor,IsReady,WriteRequest,ReadReceipt,Poll,HandleUpdate,OnReport};
