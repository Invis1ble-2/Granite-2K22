'use strict';
const Test=require('node:test'),Assert=require('node:assert/strict');
const P=require('../Source/Protocol/PlayerBody'),C=require('../Source/Protocol/PlayerBody2K22');
const Objects=require('../Source/Protocol/PlayerObject');
Test('actual NBA2K22 handshake closes all 165 player fields at exactly 1192 bytes',()=>{
    const Fs=require('node:fs'),Path=require('node:path');
    const Frame=Fs.readFileSync(Path.join(__dirname,'Fixtures/NBA2K22/PlayerHandshake.bin'));
    const H=Objects.ExtractHandshakeBody(Frame);Assert.ok(H);
    const D=C.Decode(H.Body);Assert.equal(D.Ok,true);Assert.equal(D.Present,165);
    Assert.equal(D.Length,1192);Assert.equal(D.Length,H.Body.length);
    Assert.equal(H.Body.readBigUInt64LE(D.Offsets.get(0)),H.PlayerId);
    Assert.equal(P.LayoutFor(H.Body),C);
});
function Body(Fields){const H=Buffer.alloc(37);H.writeBigUInt64BE(123n);const Values=[];for(const [Id,V] of [...Fields].sort((A,B)=>A[0]-B[0])){H[16+(Id>>3)]|=0x80>>(Id&7);Values.push(V);}return Buffer.concat([H,...Values]);}
function U64(V){const B=Buffer.alloc(8);B.writeBigUInt64LE(V);return B;}
Test('2K22 body boundaries and native field writes preserve compressed payloads and tail',()=>{
    const Blob=Buffer.from([3,0,0,0,11,22,33]);
    const Name=Buffer.from([2,0,0,0,65,0,0,0]);
    const B=Body(new Map([[0,U64(123n)],[1,U64(8n)],[2,U64(77n)],[3,U64(88n)],[97,Name],[100,Blob],[145,Buffer.alloc(4)],[164,Blob]]));
    const D=C.Decode(B);Assert.equal(D.Ok,true);Assert.equal(D.Length,B.length);Assert.equal(C.Widths.length,165);
    Assert.equal(P.LayoutFor(B),C);
    const R=P.SetShow(P.SetMachineId(B,99n).Body);Assert.equal(R.Ok,true);
    Assert.equal(P.ReadU64Field(R.Body,1),99n);Assert.equal(R.Body[C.Decode(R.Body).Offsets.get(93)],1);
    const S=P.SetSquadId(R.Body,456n);Assert.equal(P.ReadU64Field(S.Body,105),456n);
    const Dest=P.SetGotNextDestination(S.Body,[1,2,3],90);Assert.equal(Dest.Ok,true);
    const At=C.Decode(Dest.Body).Offsets.get(156);Assert.equal(Dest.Body.readFloatLE(At+8),3);
    const G=C.InspectGeneration(Dest.Body);Assert.equal(G.RealPeer,true);
    Assert.deepEqual(Dest.Body.subarray(C.Decode(Dest.Body).Offsets.get(100),C.Decode(Dest.Body).Offsets.get(105)),Blob);
    const Truncated=B.subarray(0,B.length-1);Assert.equal(C.Decode(Truncated).Ok,false);
});
Test('2K22 partial appearance merge preserves server-owned machine, show and squad fields',()=>{
    const Full=P.Mark(Body(new Map([[0,U64(123n)],[1,U64(9n)],[93,Buffer.from([1])],[105,U64(77n)],[159,Buffer.alloc(4)]])),'2K22');
    const Value=Buffer.alloc(4);Value.writeUInt32LE(42);
    const Partial=P.Mark(Body(new Map([[1,U64(888n)],[93,Buffer.from([0])],[105,U64(999n)],[159,Value]])),'2K22');
    const M=Objects.MergeBodies(Full,Partial);Assert.ok(M);Assert.equal(P.ReadU64Field(M.Body,1),9n);Assert.equal(P.ReadU64Field(M.Body,105),77n);
    const D=P.Decode(M.Body);Assert.equal(M.Body[D.Offsets.get(93)],1);Assert.equal(M.Body.readUInt32LE(D.Offsets.get(159)),42);
});
