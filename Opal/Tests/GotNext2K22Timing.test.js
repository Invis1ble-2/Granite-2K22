'use strict';
const Test=require('node:test'),Assert=require('node:assert/strict');
const G=require('../Source/Protocol/GotNext'),Courts=require('../Source/Protocol/Courts');
const Tables=require('../Source/Activity/CourtTables');
Test('actual movement before delayed second join no longer chooses the farthest mat',()=>{
    const B=require('node:fs').readFileSync(require('node:path').join(__dirname,'Fixtures/NBA2K22/DelayedJoinMovement.bin'));
    const Position=require('../Source/Protocol/Position').ReadMovement(B);
    const C={ActivityName:'neighborhood',ProtocolGeneration:'2K22',Position};
    const Target=G.SpotFor(C,0xaa3a4c37n,0);
    Assert.ok(Math.abs(Target[2]-(-269.86560023437505))<0.001);
    // Compare the native group's three points directly.
    const Q=G.QueuesFor(C,0xaa3a4c37n)[0];
    const Distance=A=>(A[0]-Position.X*3)**2+(A[2]-Position.Z*3)**2;
    Assert.equal(Distance(Target),Math.min(...Q.Anchors.map(Distance)));
});
Test('2K22 compressed positions select the actual mat and warp in native wire units',()=>{
    const C={ActivityName:'neighborhood',ProtocolGeneration:'2K22',Puid:123n};
    const Raw=Tables.For('neighborhood',C).Courts.find(X=>X.Name==='SHORT_TOP_LEFT');
    const World=Tables.For('neighborhood',C);
    const Queues=Courts.GroupsFor(Raw,World.Room,World.SeqBase).filter(X=>X.Kind==='gotnext');
    const Group=Queues[0],Target=Group.Anchors[1];
    // Captured movement uses world centimeters / 3, as confirmed by the native multiplier.
    C.Position={X:Math.round(Target[0]/3),Y:Math.round(Target[1]/3),Z:Math.round(Target[2]/3)};
    Assert.deepEqual(G.SpotFor(C,Group.ObjectId,0),Target);
    C.GotNext={Court:Group.ObjectId,Slot:0,Seat:1,Location:Target};
    // A later movement packet must not move an occupied player onto another mat.
    C.Position={X:0,Y:0,Z:0};
    Assert.deepEqual(G.SpotFor(C,Group.ObjectId,0),Target);
    const Sent=[];C.SendObject=F=>{Sent.push(F);return true;};
    Assert.equal(G.Warp(C),true);
    const F=Sent[0];for(let I=0;I<3;I++)Assert.equal(F.readInt16BE(36+I*2),Math.round(Target[I]/3));
    Assert.equal(G.WireScaleFor({ActivityName:'neighborhood'}),1);
    Assert.equal(G.WireScaleFor(C),3);
});
