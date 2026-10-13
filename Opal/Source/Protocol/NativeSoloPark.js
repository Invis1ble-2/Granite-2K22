'use strict';
// One local client, three actual native generated PLAYER objects, then guarded 2v2.
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
const Pending = new Map();
function Config() {
    try {
        const C = JSON.parse(Fs.readFileSync(ConfigPath, 'utf8'));
        return C.Enabled === true && typeof C.GameDirectory === 'string' ? C : null;
    } catch (_) { return null; }
}
function ReadReceipt(Root) {
    try { return JSON.parse(Fs.readFileSync(Path.join(Root, 'SoloParkNative.ready.json'), 'utf8')); }
    catch (_) { return null; }
}
function Installed(R) {
    if (!R || R.version !== 1 || R.module !== '00010206' || R.installed !== true || !Number.isInteger(R.pid)) return false;
    try { process.kill(R.pid, 0); return true; } catch (_) { return false; }
}
function IsReady(R, P) {
    return Installed(R) && R.pid === P.Pid && R.match === P.MatchId.toString(16) && !R.error &&
        Array.isArray(R.created) && R.created.length === 3 && new Set(R.created).size === 3 &&
        P.Cpu.every(Id => R.created.includes(Id.toString(16)));
}
function WriteRequest(Root, Match, Owner, Cpu) {
    const B = Buffer.alloc(48);B.write('SP22');B.writeUInt32LE(1,4);B.writeBigUInt64LE(Match,8);B.writeBigUInt64LE(Owner,16);
    Cpu.forEach((Id,I) => B.writeBigUInt64LE(Id,24+I*8));
    const File = Path.join(Root,'SoloParkNative.request');
    Fs.writeFileSync(File+'.tmp',B);Fs.renameSync(File+'.tmp',File);
}
function FrameFor(Id, Seed) {
    return ObjectFrame.Build({PacketId:PlayerObject.ObjectDataPacket,ConnectionId:null,ObjectId:Id,
        ClassCrc:PlayerObject.PlayerClass,Payload:Body22.BuildGeneratedPlayer(Id,Seed),Layout:ObjectFrame.Layout.Nineteen});
}
function CanContinue(C, P) {
    if (C.Closed || !C.GotNext || C.GotNext.Court !== P.Court || !C.PlayerBody) return false;
    const Humans = Roster.InActivity(C.ActivityKey, C.RoomScope || null);
    return Humans.length === 1 && Humans[0] === C;
}
function Stop(C) {
    const P = Pending.get(C.Id);
    if (!P) return false;
    Pending.delete(C.Id);clearInterval(P.Timer);
    for (const Id of P.Cpu) {
        Slots.Release(Id);
        if (!C.Closed) C.SendObject(PlayerObject.DestroyFrameFor({Puid:Id}));
    }
    try {
        const File = Path.join(P.Root,'SoloParkNative.request');
        const B = Fs.readFileSync(File);
        if (B.length === 48 && B.readBigUInt64LE(8) === P.MatchId) Fs.unlinkSync(File);
    } catch (_) {}
    return true;
}
function Abort(C, Why) {
    if (!Pending.has(C.Id)) return;
    Stop(C);
    Log.Error(`Native solo 2v2 stopped: ${Why}; restoring queue state`);
    if (!C.Closed) require('./GotNext').Release(C);
}
function Commit(C, P) {
    const Held = require('./GotNext').QueueFor(C,C.GotNext.Court,C.GotNext.Slot);
    const OwnGroup = Held?.SlotObjectId === P.OwnSlot ?
        P.Found.Groups.findIndex(G => G.SlotObjectId === P.OwnSlot) : -1;
    if (OwnGroup < 0) throw new Error('human queue group changed');
    const Sides = [[],[]];
    for (let Side = 0; Side < 2; ++Side) {
        const G = P.Found.Groups[Side];
        const Seats = Slots.StateFor(G.SlotObjectId,2).Seats;
        if (Seats.some(Id => Id && Id !== C.Puid)) throw new Error('another player occupied this court');
        Sides[Side] = new Array(2).fill(0n);
    }
    const Seat = C.GotNext.Seat;
    if (!Number.isInteger(Seat) || Seat < 0 || Seat > 1) throw new Error('human queue seat is invalid');
    Sides[OwnGroup][Seat] = C.Puid;
    let Next = 0;
    for (let Side = 0; Side < 2; ++Side) for (let I = 0; I < 2; ++I) if (!Sides[Side][I]) {
        const Id = P.Cpu[Next++];
        if (!Slots.Occupy(P.Found.Groups[Side].SlotObjectId,Id,2,I)) throw new Error('CPU seat became unavailable');
        Sides[Side][I] = Id;
    }
    const Userdata = require('./Userdata');
    const Data = C.Userdata && Userdata.Read(C.Userdata);
    if (!Data || !Data.IsUserdata || Data.DeclaredLength !== Data.Blob.length) throw new Error('human USERDATA is incomplete');
    const Profiles = Sides.map(Side => Side.map(Id => Id === C.Puid ? Data.Blob : Buffer.alloc(0)));
    const Prepared = CourtData.PrepareGameTeams(C.ActivityName,P.Found.Raw.Name,Sides[0],Sides[1],
        {Home:Profiles[0],Away:Profiles[1]},'2K22',{NativeSolo:{Owner:C.Puid,MatchId:P.MatchId}});
    if (!C.SendObject(Prepared.Frame)) throw new Error('court roster send failed');
    if (!require('./GotNext').GrantPlaying(C)) throw new Error('PLAYING grant failed');
    P.Phase = 'starting';P.StartedAt = Date.now();
    Log.Info(`Native solo ${P.Found.Raw.Name}: three client-created CPU rosters confirmed; 2v2 teams sent before PLAYING`);
}
function Poll(C, P) {
    if (Pending.get(C.Id) !== P) return;
    try {
        if (!CanContinue(C,P)) { Abort(C,'client left or another human joined'); return; }
        const R = ReadReceipt(P.Root);
        if (R?.match === P.MatchId.toString(16) && R.pid === P.Pid && R.error) { Abort(C,R.error); return; }
        if (!Installed(R) || R.pid !== P.Pid) { Abort(C,'native game process is no longer available'); return; }
        if (P.Phase === 'preloading') {
            if (IsReady(R,P)) Commit(C,P);
            else if (Date.now()-P.CreatedAt > 45000) Abort(C,'native CPU generation timed out; inspect SOLO22 log');
        } else if (P.Phase === 'starting') {
            if (IsReady(R,P) && R.started === true) {
                P.Phase = 'native-started';clearInterval(P.Timer);
                Log.Info(`Native solo ${P.Found.Raw.Name}: client validated four prepared native rosters at InitPlayingGame; awaiting in-game play`);
            } else if (Date.now()-P.StartedAt > 30000) Abort(C,'guarded native StartGame was not confirmed');
        }
    } catch (E) { Abort(C,E.message); }
}
function TryStart(C, Found) {
    if (Pending.has(C.Id)) return true;
    const Opts = Config();
    if (!Opts || C.ActivityName !== 'neighborhood' || require('./PlayerBody').GenerationForConnection(C) !== '2K22' ||
        Found.Groups.length !== 2 || Found.Groups.some(G => G.Anchors.length !== 2)) return false;
    if (Pending.size || Roster.InActivity(C.ActivityKey,C.RoomScope || null).length !== 1) return false;
    if (Found.Groups.some(G => Slots.SeatsOf(G.SlotObjectId).some(Id => Id && Id !== C.Puid))) return false;
    const Receipt = ReadReceipt(Opts.GameDirectory);
    if (!Installed(Receipt)) {
        Log.Info('Native solo withheld: restart game with Module 0x00010206 and SoloParkNative.enabled');return false;
    }
    const Own = require('./GotNext').QueueFor(C,C.GotNext.Court,C.GotNext.Slot);
    if (!Own || !Number.isInteger(C.GotNext.Seat)) return false;
    const MatchId = Crypto.randomBytes(8).readBigUInt64LE() || 1n;
    const Base = 0x0222c00000000000n | BigInt('0x'+Crypto.randomBytes(5).toString('hex'));
    const Cpu = [0n,1n,2n].map(I => (Base & 0xfffffffffffffffcn)+I);
    const P = {Root:Opts.GameDirectory,Pid:Receipt.pid,MatchId,Cpu,Court:C.GotNext.Court,OwnSlot:Own.SlotObjectId,
        Found,Bodies:new Map(),Phase:'preloading',CreatedAt:Date.now(),Timer:null};
    Pending.set(C.Id,P);
    try {
        WriteRequest(P.Root,MatchId,C.Puid,Cpu);
        for (const Id of Cpu) {
            const Frame = FrameFor(Id,Crypto.randomBytes(4).readUInt32LE());
            P.Bodies.set(Id,Buffer.from(Frame.subarray(32)));
            if (!C.SendObject(Frame)) throw new Error('CPU PLAYER publication failed');
        }
        P.Timer = setInterval(() => Poll(C,P),120);P.Timer.unref?.();
        Log.Info(`Native solo ${Found.Raw.Name}: published three generated PLAYER objects; awaiting client roster receipts`);
    } catch (E) { Abort(C,E.message); }
    return true;
}
function Finish(C, Found, Game, Reason) {
    if (!Game.NativeSolo || Game.Ended) return false;
    Game.Ended = true;Stop(C);
    require('./GotNext').Release(C);
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
module.exports = {TryStart,Stop,Finish,Pending,FrameFor,IsReady,WriteRequest,ReadReceipt,Poll,HandleUpdate};
