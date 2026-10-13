'use strict';
const Test=require('node:test'),Assert=require('node:assert/strict');
const Court=require('../Source/Protocol/CourtData');
const Native=require('../Source/Protocol/CourtLayout2K22');
const Fs=require('node:fs'),Path=require('node:path');
Test('actual 2K22 handshake on legacy Boulevard activity switches published courts to native encoding',()=>{
    const {Connection,State}=require('../Source/Protocol/Connection');
    const Players=require('../Source/Protocol/PlayerObject'),Roster=require('../Source/Protocol/Roster');
    const P=require('../Source/Protocol/PlayerBody');
    const Frame=Fs.readFileSync(Path.join(__dirname,'Fixtures/NBA2K22/BoulevardPlayerHandshake.bin'));
    const C=new Connection({destroyed:false,write(){}},{},20054),Inbox=[];
    C.ActivityName='neighborhood';C.ActivityKey=0x3cf672c2;C.State=State.Active;C.CourtProtocolPending=true;
    Assert.equal(require('../Source/Protocol/Courts').Publish(C),0);
    Assert.equal(Inbox.length,0);
    C.SendObject=F=>{Inbox.push(F);return true;};
    Roster.Players.clear();Players.BestBodies.clear();Roster.Add(C);
    try {
        Players.Register(C,Frame);
        Assert.equal(C.ProtocolGeneration,'2K22');Assert.equal(P.Decode(C.PlayerBody).Generation,'2K22');
        const Courts=Inbox.filter(F=>F.length>=32&&F.readUInt32BE(24)===0x2c4d49e3);
        Assert.equal(Courts.length,12);
        Assert.equal(Courts.filter(F=>Native.Decode(F.subarray(32)).Values.get(20).readUInt32LE()===6).length,6);
        Assert.equal(Courts.filter(F=>Native.Decode(F.subarray(32)).Values.get(20).readUInt32LE()===8).length,6);
        for(const F of Courts){const D=Native.Decode(F.subarray(32));Assert.equal(D.Ok,true);Assert.equal(D.Trailing,0);Assert.ok(D.Values.has(82));}
        Assert.equal(C.CourtProtocolPending,false);Assert.equal(C.CourtRefreshTimers.length,2);
        const Ship=require('../Source/Activity/StageSpots/ShipCourts2K22');
        const World=require('../Source/Activity/CourtTables').For('neighborhood',C);
        Assert.equal(World.Courts.length,12);
        for(const F of Courts) {
            const D=Native.Decode(F.subarray(32)),Entry=Ship.Courts.find(E=>BigInt(E.id)===F.readBigUInt64BE(16));
            Assert.ok(Entry);Assert.equal(D.Values.get(0).readUInt32LE(),Entry.id);
            Assert.equal(D.Values.get(20).readUInt32LE(),Entry.TeamSize===2?8:6);
            Assert.equal(D.Values.get(22)[0],Entry.TeamSize===2?1:0);
            const Transform=D.Values.get(4);
            for(let I=0;I<3;I++)Assert.ok(Math.abs(Transform.readFloatLE(48+I*4)-Entry.Pos[I])<0.001);
        }
        Assert.equal(P.GenerationForConnection({ActivityKey:0x3cf672c2}),'2K19');
    } finally {C.Close();Roster.Players.clear();Players.BestBodies.clear();}
});
Test('actual old court sent to NBA2K22 does not satisfy the native queue field contract',()=>{
    const Frame=Fs.readFileSync(Path.join(__dirname,'Fixtures/NBA2K22/LegacyCourt.bin'));
    const D=Native.Decode(Frame.subarray(32));
    Assert.equal(D.Ok,false);
    Assert.match(D.Reason,/unmodeled court field|truncated|padding/);
});
Test('2K22 bootstrap places setup and occupancy after the inherited fields and team result arrays',()=>{
    const Setup=Buffer.alloc(144,0x11),Spot=Buffer.alloc(72,0x22),Transform=Buffer.alloc(64);
    const Body=Court.BuildGotNextCourtDataPayload({Generation:'2K22',CourtId:123n,OwnerId:4n,CourtType:2,
        CourtTransform:Transform,CourtObjectId:321,Count:3,SetupRecords:[Setup,Setup,Setup],SpotRecords:[Spot,Spot,Spot]});
    const D=Native.Decode(Body);Assert.equal(D.Ok,true);Assert.equal(D.Trailing,0);
    Assert.equal(Native.Count,148);Assert.equal(D.Values.get(82)[0],3);
    Assert.deepEqual(D.Values.get(86),Setup);Assert.deepEqual(D.Values.get(83),Spot);
    Assert.equal(D.Values.get(0).readUInt32LE(),321);
    Assert.equal(D.Values.get(20).readUInt32LE(),2);
    Assert.equal(D.Values.has(8),false); // ArtBinding is not the marker ID.
    Assert.equal(D.Values.get(1)[0],1);
    Assert.equal(D.Values.has(58),false);
    Assert.equal(Native.Decode(Body.subarray(0,Body.length-1)).Ok,false);
});
Test('2K22 real publication builder emits native queue flags while preserving old clients',()=>{
    const Name=require('../Source/Activity/StageSpots/BoulevardCourts2K19').BoulevardCourts[0].name;
    const NativeFrame=Court.BuildParkCourtByName(Name,'2K22').Frame;
    const OldFrame=Court.BuildParkCourtByName(Name).Frame;
    Assert.notDeepEqual(NativeFrame,OldFrame);
    const D=Native.Decode(NativeFrame.subarray(32));Assert.equal(D.Ok,true);Assert.equal(D.Trailing,0);
    Assert.ok(D.Values.has(82));Assert.ok(D.Values.has(86));
    const Entry=require('../Source/Activity/StageSpots/ShipCourts2K22').Courts[0];
    for(const Built of [Court.BuildParkCourtOccupancy(Entry,undefined,'2K22'),Court.BuildParkCourtMirror(Entry,'2K22')]) {
        const Parsed=Native.Decode(Built.Frame.subarray(32));Assert.equal(Parsed.Ok,true);Assert.equal(Parsed.Trailing,0);
    }
});
Test('2K22 native park geometry uses NBA half courts for 2v2 and SHORT full courts for 3v3',()=>{
    Assert.deepEqual(Native.ParkCourtType,{TwoOnTwo:8,ThreeOnThree:6});
    const Ship=require('../Source/Activity/StageSpots/ShipCourts2K22');
    for(const Entry of Ship.Courts) {
        Assert.equal(Entry.CourtType,Entry.TeamSize===2?8:6);
        Assert.deepEqual(Entry.Pos,Entry.Marker.Translate);
        const Layout=Court.LayoutFor(Entry),Expected=Buffer.alloc(64);
        Court.CourtTransform(Layout).forEach((V,I)=>Expected.writeFloatLE(V,I*4));
        for(const Built of [Court.BuildParkCourtByName(Entry.name,'2K22'),
            Court.BuildParkCourtOccupancy(Entry,undefined,'2K22'),Court.BuildParkCourtMirror(Entry,'2K22')]) {
            const D=Native.Decode(Built.Frame.subarray(32));
            Assert.equal(D.Ok,true,D.Reason);Assert.equal(D.Trailing,0);
            Assert.equal(D.Values.get(20).readUInt32LE(),Entry.TeamSize===2?8:6);
            Assert.equal(D.Values.get(22)[0],Entry.TeamSize===2?1:0);
            Assert.deepEqual(D.Values.get(4),Expected,'preserve resource marker transform');
        }
    }
});
