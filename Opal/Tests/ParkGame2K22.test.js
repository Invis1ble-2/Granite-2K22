'use strict';
const Test=require('node:test'), A=require('node:assert/strict');
const Fs=require('node:fs'),Path=require('node:path'),Z=require('node:zlib');
const G=require('../Source/Protocol/GotNext'),C=require('../Source/Protocol/CourtData');
const P=require('../Source/Protocol/PlayerObject'),B=require('../Source/Protocol/PlayerBody');
const Native=require('../Source/Protocol/PlayerBody'),Layout=require('../Source/Protocol/CourtLayout2K22');
const Tables=require('../Source/Activity/CourtTables'),Courts=require('../Source/Protocol/Courts');
const Slots=require('../Source/Protocol/Slots'),Roster=require('../Source/Protocol/Roster');
const F=require('../Source/Codec/Frame'),FL=require('../Source/Codec/FieldList'),U=require('../Source/Protocol/Userdata');
require('../Source/Core/Log').SetLevel(0);
const H=P.ExtractHandshakeBody(Fs.readFileSync(Path.join(__dirname,'Fixtures/NBA2K22/PlayerHandshake.bin')));
function Player(Id,Events) {
    const Puid=0x110000100000000n+BigInt(Id);
    const Body=P.StampIdentity(H.Body,H.PlayerId,Puid).Body;
    const Data=Z.deflateSync(Buffer.alloc(223256,Id&255));
    return {Id,Puid,MachineId:BigInt(Id),State:2,ActivityKey:0x3cf672c2,ActivityName:'neighborhood',
        ProtocolGeneration:'2K22',Identifier:String(Id),PlayerRevision:1n,PlayerBody:Body,
        Userdata:F.Build(0x9e3471ed,Buffer.alloc(8),new FL.Builder().AddBlob('COMPRESSED_DATA',Data).AddU32('COMMAND',U.UserdataCommand).Build(),F.InnerHeader.Object),
        VconlineProfileReady:true,SendObject(Frame){Events.push({Id,Frame});return true;},Send(Frame){Events.push({Id,Frame});return true;}};
}
Test('ship 2v2 and 3v3 start with native roster, profiles and relay before PLAYING',()=>{
    for(const Size of [2,3]) {
        const Entry=C.ParkEntries('2K22').find(E=>E.TeamSize===Size),Events=[];
        const World=Tables.For('neighborhood',{ProtocolGeneration:'2K22'});
        const Raw=World.Courts.find(R=>R.Name===Entry.name);
        const Groups=Courts.GroupsFor(Raw,World.Room,World.SeqBase).filter(G=>G.Kind==='gotnext');
        const Players=[];
        try {
            for(let I=0;I<Size*2;I++) {
                const X=Player(9000+I,Events),Side=Math.floor(I/Size),Seat=I%Size;
                X.GotNext={Court:Groups[Side].ObjectId,Slot:Side,Seat};
                const StateAt=Native.Decode(X.PlayerBody).Offsets.get(4);
                X.PlayerBody.writeUInt32LE(G.State.GotNext,StateAt);
                Slots.Occupy(Groups[Side].SlotObjectId,X.Puid,Size,Seat);Roster.Add(X);Players.push(X);
            }
            A.equal(G.MaybeStartMatch(Players[0]),true);
            for(const Event of Events.slice(0,Size*2)) {
                A.equal(Event.Frame.readUInt32BE(24),C.CourtClass);
                const D=Layout.Decode(Event.Frame.subarray(32));A.equal(D.Ok,true,D.Reason);A.equal(D.Trailing,0);
                A.equal(D.Values.get(28)[0],Size);A.equal(D.Values.get(55)[0],Size);
                A.equal(D.Values.get(20).readUInt32LE(),Size===2?8:6);
                A.equal(D.Values.get(22)[0],Size===2?1:0);
                A.equal(D.Values.get(12).length,16);A.equal(D.Values.get(14).readUInt16LE(),require('../Source/Activity/Activities').Relay.Local.Port);
                for(let I=0;I<Size;I++) {
                    A.equal(D.Values.get(56+I).readBigUInt64LE(),Players[I].Puid);
                    A.equal(D.Values.get(30+I).readBigUInt64LE(),Players[Size+I].Puid);
                    A.equal(Z.inflateSync(D.Values.get(76+I).subarray(4)).length,223256);
                    A.equal(Z.inflateSync(D.Values.get(50+I).subarray(4)).length,223256);
                }
            }
            A.ok(Players.every(X=>G.FindState(X.PlayerBody,G.State.Playing)>=0));
            A.equal(G.MaybeStartMatch(Players[0]),false);
            Events.length=0;C.BroadcastCourtGroup(Players[0],Groups[0]);
            A.equal(Events.length,Size*2,'same-ID mirror must not erase active teams');
            A.ok(Events.every(E=>Layout.Decode(E.Frame.subarray(32)).Values.get(55)[0]===Size));
            A.ok(C.BuildSpectatorCourtFrame('neighborhood',Entry.name,Entry.CourtType,'2K22'));
            for(const [I,X] of Players.entries()) {
                const Packet=Buffer.alloc(68);Packet.writeUInt32LE(68);Packet.writeUInt32BE(0xce148fb1,4);
                Packet.writeUInt32BE(100+I,20);Packet.writeBigUInt64BE(BigInt(Entry.id),24);
                Packet.writeUInt32BE(0xb18f14ce,36);Packet.writeUInt32BE(0x1423add2,40);Packet.writeUInt32BE(0xdfc1471f,44);
                A.equal(G.HandleGameConnected(X,Packet),true);
                A.equal(Boolean(C.GameTeams('neighborhood',Entry.name,'2K22').GameReady),I===Players.length-1);
            }
            A.equal(C.GameTeams('neighborhood',Entry.name,'2K22').Phase,'playing');
        } finally {for(const X of Players){Slots.Release(X.Puid);Roster.Remove(X);}C.ClearGameTeams('neighborhood',Entry.name,'2K22');}
    }
});
Test('native state lookup ignores matching CRC bytes outside ParkState; stale updates preserve server state',()=>{
    const X=Player(9100,[]),D=Native.Decode(X.PlayerBody),At=D.Offsets.get(4);
    X.PlayerBody.writeUInt32LE(G.State.None,At);X.PlayerBody.writeUInt32LE(G.State.GotNext,D.Offsets.get(5));
    A.equal(G.FindState(X.PlayerBody,G.State.GotNext),-1);
    const Stale=Buffer.from(X.PlayerBody);X.PlayerBody.writeUInt32LE(G.State.GotNext,At);
    const Merge=P.MergeBodies(X.PlayerBody,Stale);A.ok(Merge);A.equal(G.FindState(Merge.Body,G.State.GotNext),At);
});
Test('occupied nearest mat grants actual assigned destination through twelve join/leave cycles',()=>{
    const Events=[],X=Player(9200,Events),World=Tables.For('neighborhood',X),Raw=World.Courts[0];
    const Group=Courts.GroupsFor(Raw,World.Room,World.SeqBase).find(G=>G.Kind==='gotnext');
    const Target=Group.Anchors[0];X.Position={X:Target[0]/3,Y:Target[1]/3,Z:Target[2]/3};
    Slots.Occupy(Group.SlotObjectId,9999n,Raw.TeamSize,0);
    try {for(let I=0;I<12;I++) {
        X.GotNext={Court:Group.ObjectId,Slot:0};A.equal(G.Deliver(X),true);A.equal(X.GotNext.Seat,1);
        const D=Native.Decode(X.PlayerBody),At=D.Offsets.get(156);
        for(let J=0;J<3;J++)A.ok(Math.abs(X.PlayerBody.readFloatLE(At+J*4)-Group.Anchors[1][J])<0.001);
        A.equal(G.Release(X),true);A.equal(G.FindState(X.PlayerBody,G.State.None)>=0,true);
        A.ok(!Slots.SeatsOf(Group.SlotObjectId).includes(X.Puid));
    }} finally {Slots.Release(X.Puid);Slots.Release(9999n);}
});
