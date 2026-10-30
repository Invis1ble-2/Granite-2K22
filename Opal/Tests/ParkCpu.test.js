'use strict';
const Test=require('node:test'),A=require('node:assert/strict'),Fs=require('node:fs'),Path=require('node:path'),Z=require('node:zlib');
const N=require('../Source/Protocol/ParkCpu'),G=require('../Source/Protocol/GotNext'),C=require('../Source/Protocol/CourtData');
const B=require('../Source/Protocol/PlayerBody'),P=require('../Source/Protocol/PlayerObject'),R=require('../Source/Protocol/Roster');
const Slots=require('../Source/Protocol/Slots'),Tables=require('../Source/Activity/CourtTables'),Courts=require('../Source/Protocol/Courts');
const FL=require('../Source/Codec/FieldList'),F=require('../Source/Codec/Frame'),U=require('../Source/Protocol/Userdata');
require('../Source/Core/Log').SetLevel(0);
const Config=Path.resolve(__dirname,'../Config.json');
const H=P.ExtractHandshakeBody(Fs.readFileSync(Path.join(__dirname,'Fixtures/NBA2K22/PlayerHandshake.bin')));
function ReceiptProfile(Seed, Id) {
    let State=(Seed^0x50433232)>>>0;
    const Next=()=>{State=(State+0x9e3779b9)>>>0;let X=Math.imul(State^(State>>>16),0x21f0aaad)>>>0;X=Math.imul(X^(X>>>15),0x735a2d97)>>>0;return (X^(X>>>15))>>>0;};
    const Below=Count=>{const Threshold=((-Count)>>>0)%Count;let X;do{X=Next();}while(X<Threshold);return X%Count;};
    return {id:Id,seed:Seed,overall:80+Below(20),height:175+Below(46),shape:Array.from({length:5},()=> (9500+Below(1001))/10000)};
}
function Setup(Run, Queue = 0) {
    const Saved=Fs.readFileSync(Config),Settings=JSON.parse(Saved);
    Settings.ParkCpu={Enabled:true,TwoOnTwo:true,ThreeOnThree:true};Fs.writeFileSync(Config,JSON.stringify(Settings));
    const Entry=C.ParkEntries('2K22').find(E=>E.TeamSize===2),World=Tables.For('neighborhood',{ProtocolGeneration:'2K22'});
    const Raw=World.Courts.find(E=>E.Name===Entry.name),Groups=Courts.GroupsFor(Raw,World.Room,World.SeqBase).filter(G=>G.Kind==='gotnext');
    const Events=[],Id=9400,Puid=0x0110000100009000n,Body=P.StampIdentity(H.Body,H.PlayerId,Puid).Body;
    Body.writeUInt32LE(G.State.GotNext,B.Decode(Body).Offsets.get(4));
    const X={Id,Puid,MachineId:1n,Identifier:'solo-native-test',State:2,ActivityKey:0x3cf672c2,ActivityName:'neighborhood',
        ProtocolGeneration:'2K22',PlayerBody:Body,PlayerRevision:1n,GotNext:{Court:Groups[0].ObjectId,Slot:Queue,Seat:1,Since:Date.now()-11000},
        Userdata:F.Build(0x9e3471ed,Buffer.alloc(8),new FL.Builder().AddBlob('COMPRESSED_DATA',Z.deflateSync(Buffer.alloc(223256)))
            .AddU32('COMMAND',U.UserdataCommand).Build(),F.InnerHeader.Object),SendObject(B){Events.push(B);return true;},Send(B){Events.push(B);return true;}};
    function Receipt(Value={}) {
        const Pending=N.Pending.get(X.Id),Created=Value.created || [];
        const Profiles=Value.profiles || (Pending ? Created.map(Id=>{const I=Pending.Cpu.findIndex(Cpu=>Cpu.toString(16)===Id);return ReceiptProfile(Pending.Seeds[I],Id);}) : []);
        return N.OnSoloReport(Puid,{version:3,module:'00010213',installed:true,pid:process.pid,match:'0',
            teamSize:Pending?.TeamSize || 2,cpuCount:Pending?.Cpu.length || 3,created:Created,profiles:Profiles,error:null,
            instance:'1',epoch:Pending?.Epoch || '0',armed:true,started:false,...Value});
    }
    Slots.Occupy(Groups[Queue].SlotObjectId,Puid,2,1);R.Add(X);
    const Spot=X.GotNext;X.GotNext=null;Receipt();X.GotNext=Spot;
    try {Run({X,Receipt,Events,Entry,Groups});}
    finally {N.Stop(X);X.Closed=true;Slots.Release(Puid);R.Remove(X);C.ClearGameTeams('neighborhood',Entry.name,'2K22');Fs.writeFileSync(Config,Saved);}
}
Test('generated CPU object uses native field 144 and server-generated flag; no equipment payload or fake machine',()=>{
    const Id=0x0222c00000000001n,Body=B.BuildGeneratedPlayer(Id,123),D=B.Decode(Body);
    A.equal(D.Ok,true);A.equal(D.Length,Body.length);A.equal(Body.readBigUInt64BE(),Id);A.equal(Body.readBigUInt64LE(D.Offsets.get(1)),0n);
    A.equal(Body[D.Offsets.get(91)],1);A.equal(D.Offsets.has(145),false);A.equal(B.Field.UserGenerationSettings,144);
    const At=D.Offsets.get(144),Script=Body.subarray(At+4);A.equal(Body.readUInt32LE(At),Script.length);
    A.equal(FL.Find(FL.Parse(Script,0),0xf5d65e01).Data1,123);A.equal(FL.Find(FL.Parse(Script,0),0x693a3883).Value,0n);
    A.throws(()=>B.BuildGeneratedPlayer(1n,123));
});
Test('native CPU receipts precede 2v2 teams and PLAYING; only the human joins GAME; end removes CPU objects',()=>Setup(({X,Receipt,Events,Entry})=>{
    A.equal(G.MaybeStartMatch(X),true);const Pending=N.Pending.get(X.Id);A.ok(Pending);clearInterval(Pending.Timer);
    Receipt({match:Pending.MatchId.toString(16)});
    A.equal(Events.length,3);A.ok(Events.every(E=>E.readUInt32BE(24)===P.PlayerClass));
    A.ok(G.FindState(X.PlayerBody,G.State.GotNext)>=0);A.equal(C.GameTeams('neighborhood',Entry.name,'2K22'),null);
    A.equal(G.MaybeStartMatch(X),true);A.equal(Events.length,3);
    const Req=Pending.Request;A.equal(Req.length,96);A.equal(Req.toString('ascii',0,4),'SP22');
    Receipt({match:'deadbeef',created:Pending.Cpu.map(Id=>Id.toString(16))});N.Poll(X,Pending);A.equal(Events.length,3);
    Receipt({match:Pending.MatchId.toString(16),created:Pending.Cpu.map(Id=>Id.toString(16))});N.Poll(X,Pending);
    A.equal(Events[3].readUInt32BE(24),C.CourtClass);const D=require('../Source/Protocol/CourtLayout2K22').Decode(Events[3].subarray(32));
    A.equal(D.Ok,true);A.equal(D.Values.get(17).readBigUInt64LE(),Pending.MatchId);A.equal(D.Values.get(55)[0],2);A.equal(D.Values.get(28)[0],2);A.equal(D.Values.get(11)[0],0);A.equal(D.Values.has(12),false);
    A.equal(D.Values.get(20).readUInt32LE(),8);A.equal(D.Values.get(22)[0],1);
    const Blobs=[76,77,50,51].map(I=>D.Values.get(I));A.equal(Blobs.filter(B=>B.readUInt32LE()===0).length,3);
    A.ok(G.FindState(X.PlayerBody,G.State.Playing)>=0);
    const Game=C.GameTeams('neighborhood',Entry.name,'2K22');A.equal(Game.NativeSolo.Cpu.length,3);
    A.equal(C.MarkGameConnected('neighborhood',Entry.name,Pending.Cpu[0],'2K22').Accepted,false);
    A.deepEqual(C.MarkGameConnected('neighborhood',Entry.name,X.Puid,'2K22'),{Accepted:true,Advanced:true,Ready:1,total:1});
    Receipt({match:Pending.MatchId.toString(16),created:Pending.Cpu.map(Id=>Id.toString(16)),started:true});N.Poll(X,Pending);A.equal(Pending.Phase,'native-started');
    A.equal(N.Finish(X,{Raw:{Name:Entry.name}},Game,'test end'),true);A.equal(N.Pending.size,0);
    A.equal(Events.filter(E=>E.readUInt32BE(4)===0xa5feca35).length,3);
    A.ok(G.FindState(X.PlayerBody,G.State.None)>=0);A.equal(C.GameTeams('neighborhood',Entry.name,'2K22'),null);
}));
Test('both queue sides retain the human seat and fill exactly three CPU seats',()=>{
    for (const Queue of [0,1]) Setup(({X,Receipt,Entry,Groups})=>{
        A.equal(G.MaybeStartMatch(X),true);const Pending=N.Pending.get(X.Id);clearInterval(Pending.Timer);
        Receipt({match:Pending.MatchId.toString(16)});
        A.equal(Pending.OwnSlot,Groups[Queue].SlotObjectId);
        Receipt({match:Pending.MatchId.toString(16),created:Pending.Cpu.map(Id=>Id.toString(16))});N.Poll(X,Pending);
        A.equal(Pending.Phase,'starting');
        const Game=C.GameTeams('neighborhood',Entry.name,'2K22');A.ok(Game);
        A.equal([Game.Home,Game.Away][Queue][1],X.Puid);
        A.equal(Slots.SeatsOf(Groups[Queue].SlotObjectId)[1],X.Puid);
        A.deepEqual(Groups.flatMap(Group=>Slots.SeatsOf(Group.SlotObjectId)).filter(Id=>Id!==X.Puid).sort(),Pending.Cpu.slice().sort());
    },Queue);
});
Test('only the owner can ACK and echo generated CPU updates; generation metadata remains authoritative',()=>Setup(({X,Receipt,Events})=>{
    G.MaybeStartMatch(X);const Pending=N.Pending.get(X.Id);clearInterval(Pending.Timer);
    Receipt({match:Pending.MatchId.toString(16)});
    const Id=Pending.Cpu[0],Cached=Pending.Bodies.get(Id),Body=Buffer.from(Cached),D=B.Decode(Body);
    Body.writeBigUInt64BE(53n,8);Body[D.Offsets.get(91)]=0;Body[D.Offsets.get(93)]=0;
    Body.writeUInt32LE(G.State.Playing,D.Offsets.get(4));Body.fill(0,D.Offsets.get(144)+4);
    const Packet=Buffer.alloc(42+Body.length);Packet.writeUInt32BE(0xfef2dd68,4);Packet.writeBigUInt64BE(0x100000012n,16);
    Packet.writeBigUInt64BE(Id,24);Packet.writeUInt32BE(P.PlayerClass,32);Packet.writeUInt16BE(Body.length,40);Body.copy(Packet,42);
    const World=require('../Source/Protocol/WorldState');
    A.equal(World.Echo({...X,Id:9999},Packet),false);A.equal(Events.length,3);
    A.equal(World.Echo(X,Packet.subarray(0,Packet.length-1)),false);A.equal(Events.length,3);
    A.equal(World.Echo(X,Packet),true);A.equal(Events.length,5);
    A.equal(Events[3].readBigUInt64BE(16),0x100000012n);
    const Reply=Events[4].subarray(32),RD=B.Decode(Reply);A.equal(Reply.readBigUInt64BE(8),69n);
    A.equal(Reply[RD.Offsets.get(91)],1);A.equal(Reply[RD.Offsets.get(93)],1);
    A.equal(Reply.readUInt32LE(RD.Offsets.get(4)),G.State.None);
    A.deepEqual(Reply.subarray(RD.Offsets.get(144)),Cached.subarray(D.Offsets.get(144)));
}));
Test('native creation failure or timeout releases the queue without PLAYING',()=>{
    for (const Failure of ['error','timeout']) Setup(({X,Receipt,Events,Entry})=>{
        G.MaybeStartMatch(X);const Pending=N.Pending.get(X.Id);clearInterval(Pending.Timer);
        Receipt({match:Pending.MatchId.toString(16)});
        if(Failure==='error')Receipt({match:Pending.MatchId.toString(16),error:'native-cpu-roster-missing'});
        else {Pending.PreloadAt=Date.now()-46000;Receipt({match:Pending.MatchId.toString(16)});}
        N.Poll(X,Pending);A.equal(N.Pending.size,0);A.equal(C.GameTeams('neighborhood',Entry.name,'2K22'),null);
        A.ok(G.FindState(X.PlayerBody,G.State.None)>=0);A.equal(X.GotNext,null);A.equal(Events.filter(E=>E.readUInt32BE(4)===0xa5feca35).length,3);
    });
});
Test('disconnect and another human joining cancel native preloading',()=>{
    for(const Kind of ['disconnect','peer']) Setup(({X})=>{
        G.MaybeStartMatch(X);const Pending=N.Pending.get(X.Id);clearInterval(Pending.Timer);
        const Peer={Id:9500,State:2,ActivityKey:X.ActivityKey,Closed:false};
        try {if(Kind==='disconnect')X.Closed=true;else R.Add(Peer);N.Poll(X,Pending);A.equal(N.Pending.size,0);}
        finally{R.Remove(Peer);}
    });
});
