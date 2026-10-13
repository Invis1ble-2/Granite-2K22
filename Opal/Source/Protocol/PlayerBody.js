'use strict';
const Legacy = require('./PlayerBody2K19');
const Cruise = require('./PlayerBody2K22');
const Bodies = new WeakMap();
function LayoutFor(Body) {
    if (Bodies.has(Body)) return Bodies.get(Body);
    if (Buffer.isBuffer(Body) && Body.length >= 45 && Body.readBigUInt64BE(0) !== 0n && Cruise.IsPresent(Body,0) &&
        Body.readBigUInt64BE(0) === Body.readBigUInt64LE(Cruise.ValuesStart) && Cruise.Decode(Body).Ok) return Cruise;
    return Legacy;
}
function Mark(Body, Generation) { if (Buffer.isBuffer(Body)) Bodies.set(Body,Generation==='2K22'?Cruise:Legacy);return Body; }
function GenerationForConnection(Connection) {
    if (Connection.ProtocolGeneration) return Connection.ProtocolGeneration;
    if (Connection.PlayerBody) return LayoutFor(Connection.PlayerBody) === Cruise ? '2K22' : '2K19';
    return Connection.ActivityKey === 0xb3cb0e44 ? '2K22' : '2K19';
}
const Export = {...Legacy,LayoutFor,Mark,GenerationForConnection};
for (const Name of ['Decode','Trim','SetMachineId','SetShow','InspectGeneration','SetGotNextDestination','SetSquadId','SetSquadInvites','SetU64Fields','ReadU64Field','IsPresent']) {
    Export[Name] = (Body,...Args) => {
        const Layout=LayoutFor(Body),Result=Layout[Name](Body,...Args);
        if (Result && typeof Result === 'object') {
            if (Result.Body) Bodies.set(Result.Body,Layout);
            if (Name==='Decode' && Result.Ok) Object.assign(Result,{ValuesStart:Layout.ValuesStart,Field:Layout.Field,ShowField:Layout.ShowField,Generation:Layout===Cruise?'2K22':'2K19'});
        }
        return Result;
    };
}
module.exports=Export;
