'use strict';
const Test=require('node:test'),A=require('node:assert/strict'),Fs=require('node:fs'),Path=require('node:path');
const W=require('../Source/Protocol/WorldState'),P=require('../Source/Protocol/PlayerObject');
const B=require('../Source/Protocol/PlayerBody'),Requests=require('../Source/Protocol/Requests');
require('../Source/Core/Log').SetLevel(0);
const Fixture=N=>Fs.readFileSync(Path.join(__dirname,`Fixtures/NBA2K22/QueueAreaUpdate${N}.bin`));
function Connection(Events) {
    const H=P.ExtractHandshakeBody(Fs.readFileSync(Path.join(__dirname,'Fixtures/NBA2K22/PlayerHandshake.bin')));
    return {ProtocolGeneration:'2K22',Puid:H.PlayerId,MachineId:123n,PlayerBody:H.Body,PlayerRevision:1n,
        Send(F){Events.push(F);return true;},SendObject(F){Events.push(F);return true;}};
}
Test('actual queue-area PLAYER update 18 receives exact ACK and newer object, without waiting for timeout',()=>{
    const Events=[],C=Connection(Events),Input=Fixture(18),Before=Buffer.from(Input);
    A.equal(W.Echo(C,Input),true);A.equal(Events.length,2);
    A.equal(Events[0].readUInt32BE(4),Requests.Packet);A.equal(Events[0].readBigUInt64BE(16),18n);
    A.equal(Events[1].readUInt32BE(4),P.ObjectDataPacket);
    A.ok(Events[1].readBigUInt64BE(40)>Input.readBigUInt64BE(50),'pending object version condition is also satisfied');
    A.deepEqual(Input,Before);
});
Test('updates 19 and 20 both ACK immediately while object reply is rate limited',async()=>{
    const Events=[],C=Connection(Events);
    try {
        A.equal(W.Echo(C,Fixture(19)),true);
        A.equal(W.Echo(C,Fixture(20)),false);
        A.deepEqual(Events.filter(F=>F.readUInt32BE(4)===Requests.Packet).map(F=>F.readBigUInt64BE(16)),[19n,20n]);
        await new Promise(Resolve=>setTimeout(Resolve,W.MinIntervalMs+30));
        const Objects=Events.filter(F=>F.readUInt32BE(4)===P.ObjectDataPacket);
        A.equal(Objects.length,2);A.ok(Objects[1].readBigUInt64BE(40)>Fixture(20).readBigUInt64BE(50));
    } finally {W.CancelPending(C);}
});
Test('native ACK preserves all 64 request bits and does not acknowledge foreign or incomplete objects',()=>{
    const Events=[],C=Connection(Events),Input=Fixture(18);Input.writeBigUInt64BE(0x100000012n,16);
    A.equal(W.Echo(C,Input),true);A.equal(Events[0].readBigUInt64BE(16),0x100000012n);
    const Other=Fixture(19);Other.writeBigUInt64BE(999n,42);Events.length=0;
    A.equal(W.Echo(C,Other),false);A.equal(Events.length,0);
    C.LastEchoMs=0;W.Echo(C,Fixture(20).subarray(0,60));
    A.equal(Events.some(F=>F.readUInt32BE(4)===Requests.Packet),false);
    W.CancelPending(C);
});
