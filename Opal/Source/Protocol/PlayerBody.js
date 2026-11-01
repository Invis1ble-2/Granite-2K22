// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

// NBA2K22 FUN_1416E8120 (bitmap), FUN_1416E1FE0 (values),
// FUN_1416BD430 (names). Length-prefixed compressed values remain opaque.
const BitmapBytes = 21, ValuesStart = 37;
const Widths = [8,8,8,8,4,4,4,1,1,4,2,1,1,4,4,4,4,4,4,4,4,4,1,1,1,1,1,1,1,4,4,4,4,4,4,4,4,4,4,4,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,4,4,1,1,1,1,2,2,2,2,2,2,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,4,4,8,2,1,1,1,1,1,1,4,1,1,1,1];
Widths.pop(); // signature includes GamerTag capacity; its wire value is variable length.
// Fields 96..103: strings, custom head, skin, uniforms, custom shoes.
Widths.push(...Array(8).fill(0), 1, 8, ...Array(5).fill(8), 1,
    ...Array(31).fill(0), ...Array(4).fill(0), 1,4,4,1,1,1,1,8,8,16,4,4,4,4,8,4,4,0);
const ArrayFields = new Set([...Array(8)].map((_, I) => 96+I).concat([...Array(35)].map((_, I) => 112+I), [164]));
const Field = Object.freeze({Puid:0,MachineId:1,FakePlayerFlag:91,FakePlayerData:144,
    ServerGenerated:91,UserGenerationSettings:144,EquippedItemInfo:145,PreferredBallType:159,Activity:149,
    SquadId:105,SquadInvites:Object.freeze([106,107,108,109,110]),GotNextLocation:156,GotNextFacing:157});
const ShowField = 93;
function IsPresent(Body, Id) { return Boolean(Body[16+(Id>>3)] & (0x80>>(Id&7))); }
function Decode(Body) {
    if (!Buffer.isBuffer(Body) || Body.length < ValuesStart) return {Ok:false,Reason:'2K22 PLAYER header truncated'};
    if (Widths.length !== 165 || (Body[36] & 7)) return {Ok:false,Reason:'invalid 2K22 PLAYER bitmap'};
    const Offsets = new Map(); let Cursor = ValuesStart;
    for (let Id=0;Id<165;Id++) {
        if (!IsPresent(Body,Id)) continue;
        Offsets.set(Id,Cursor);
        let Size=Widths[Id];
        if (ArrayFields.has(Id)) {
            if (Cursor+4>Body.length) return {Ok:false,Reason:`2K22 field ${Id} count truncated`};
            Size=Body.readUInt32LE(Cursor); Cursor+=4;
            // FirstName and LastName prefixes count UTF-16 code units.
            if (Id===97 || Id===98) Size*=2;
        }
        if (Size>Body.length-Cursor) return {Ok:false,Reason:`2K22 field ${Id} exceeds body`};
        Cursor+=Size;
    }
    return {Ok:true,Length:Cursor,Offsets,Present:Offsets.size,ValuesStart,Field,ShowField,Generation:'2K22'};
}
function Patch(Body, Changes) {
    const D=Decode(Body); if (!D.Ok) return {...D,Body};
    const Ids=[...D.Offsets.keys()], Values=new Map();
    Ids.forEach((Id,I)=>Values.set(Id,Body.subarray(D.Offsets.get(Id),I+1<Ids.length?D.Offsets.get(Ids[I+1]):D.Length)));
    const Header=Buffer.from(Body.subarray(0,ValuesStart));
    for (const [Id,Value] of Changes) { Values.set(Id,Value);Header[16+(Id>>3)]|=0x80>>(Id&7); }
    return {Ok:true,Body:Buffer.concat([Header,...[...Values.keys()].sort((A,B)=>A-B).map(Id=>Values.get(Id)),Body.subarray(D.Length)])};
}
function SetU64Fields(Body, Changes) {
    const Values=new Map();
    for (const [Id,Raw] of Changes) {
        if (Widths[Id]!==8 || ArrayFields.has(Id)) return {Ok:false,Reason:`field ${Id} is not U64`,Body};
        const B=Buffer.alloc(8);B.writeBigUInt64LE(BigInt.asUintN(64,BigInt(Raw)));Values.set(Id,B);
    }
    return Patch(Body,Values);
}
// FUN_1416BD430: State/CourtName are fields 4/5, not body+51/55.
function SetGameState(Body, State, CourtName) {
    const U32=N=>{const B=Buffer.alloc(4);B.writeUInt32LE(N>>>0);return B;};
    return Patch(Body,new Map([[4,U32(State)],[5,U32(CourtName)]]));
}
// FUN_1416E913D / FUN_1416E468B: Activity is field 149, a little-endian U32.
function SetActivity(Body, Activity) {
    if (!Number.isInteger(Activity) || Activity<0 || Activity>0xffffffff)
        return {Ok:false,Reason:'invalid 2K22 Activity',Body};
    const D=Decode(Body);if(!D.Ok)return {...D,Body};
    const At=D.Offsets.get(Field.Activity),Was=At===undefined?null:Body.readUInt32LE(At);
    if (Was===Activity) return {Ok:true,Body,Was,Changed:false};
    const Value=Buffer.alloc(4);Value.writeUInt32LE(Activity);
    return {...Patch(Body,new Map([[Field.Activity,Value]])),Was,Changed:true};
}
function SetMachineId(Body, Id) {
    const D=Decode(Body), At=D.Ok?D.Offsets.get(0):undefined;
    if (At===undefined || Body.readBigUInt64LE(At)!==Body.readBigUInt64BE(0)) return {Ok:false,Native:false,Body,Reason:'2K22 PUID mismatch'};
    if (!Id || BigInt(Id)<=0n || BigInt(Id)>0xffffffffffffffffn) return {Ok:false,Native:true,Body,Reason:'invalid machine ID'};
    const Existing=D.Offsets.get(1), R=SetU64Fields(Body,new Map([[1,Id]]));
    return {...R,Native:true,Offset:Existing??At+8,Was:Existing===undefined?null:Body.readBigUInt64LE(Existing),MachineId:BigInt(Id)};
}
function SetShow(Body) {
    const D=Decode(Body);if(!D.Ok)return {...D,Body};
    const At=D.Offsets.get(ShowField),Was=At===undefined?null:Body[At];
    const R=Patch(Body,new Map([[ShowField,Buffer.from([1])]]));
    return {...R,Was,Inserted:At===undefined,Offset:R.Ok?Decode(R.Body).Offsets.get(ShowField):undefined};
}
function InspectGeneration(Body) {
    const D=Decode(Body);if(!D.Ok)return D;
    const At=D.Offsets.get(0);if(At===undefined)return {...D,GenerationOk:false,Reason:'2K22 PUID absent'};
    const FlagAt=D.Offsets.get(Field.FakePlayerFlag),DataAt=D.Offsets.get(Field.FakePlayerData);
    const Flag=FlagAt===undefined?0:Body[FlagAt],Bytes=DataAt===undefined?0:Body.readUInt32LE(DataAt);
    // ServerGenerated and EquippedItemInfo do not prove the fake-player
    // branch. Validate identity using only the NBA2K22 field layout.
    return {...D,GenerationOk:true,Puid:Body.readBigUInt64LE(At),FakePlayerFlag:Flag,FakePlayerDataBytes:Bytes,RealPeer:true};
}
function SetGotNextDestination(Body, Location, Facing=null) {
    if(!Location||Location.length<3||!Location.slice(0,3).every(Number.isFinite))return {Ok:false,Reason:'invalid location'};
    const B=Buffer.alloc(16);Location.slice(0,3).forEach((V,I)=>B.writeFloatLE(V,I*4));B.writeFloatLE(1,12);
    const Changes=new Map([[156,B]]);
    if(Facing!==null&&Number.isFinite(Facing)){const F=Buffer.alloc(4);F.writeInt32LE(Math.max(-2147483648,Math.min(2147483647,Math.round(Facing))));Changes.set(157,F);}
    const R=Patch(Body,Changes);return {...R,Offset:R.Ok?Decode(R.Body).Offsets.get(156):undefined};
}
function SetSquadId(Body,Id){return SetU64Fields(Body,new Map([[105,Id||0n]]));}
function SetSquadInvites(Body,Ids){Ids=[...(Ids||[])].slice(0,5);return SetU64Fields(Body,new Map(Field.SquadInvites.map((Id,I)=>[Id,Ids[I]||0n])));}
function ReadU64Field(Body,Id){const D=Decode(Body),At=D.Ok?D.Offsets.get(Id):undefined;return At===undefined||Widths[Id]!==8?null:Body.readBigUInt64LE(At);}
function Trim(Body){const D=Decode(Body);return {...D,Body:D.Ok?Body.subarray(0,D.Length):Body,Trimmed:D.Ok?Body.length-D.Length:0};}
function BuildGeneratedPlayer(Puid, Seed) {
    Puid=BigInt(Puid);
    if ((Puid & 0xfffff00000000000n)!==0x0222c00000000000n) throw new Error('native CPU id is outside its reserved range');
    if (!Number.isInteger(Seed) || Seed<0 || Seed>0xffffffff) throw new Error('native CPU seed must be uint32');
    // FUN_14166B330 -> FUN_1416403A0: position 5 selects native RNG % 5;
    // 0x693a3883 seeds generation, rather than supplying a position value.
    const Script=new (require('../Codec/FieldList').Builder)()
        .AddU32(0xf5d65e01,5).AddU64(0x693a3883,BigInt(Seed || 1)).Build();
    const Count=Buffer.alloc(4);Count.writeUInt32LE(Script.length);
    const Header=Buffer.alloc(ValuesStart);Header.writeBigUInt64BE(Puid);Header.writeBigUInt64BE(1n,8);
    const U64=N=>{const B=Buffer.alloc(8);B.writeBigUInt64LE(N);return B;};
    const None=Buffer.alloc(4);None.writeUInt32LE(0x9705bb0d);
    return Patch(Header,new Map([[0,U64(Puid)],[1,U64(0n)],[4,None],
        [91,Buffer.from([1])],[93,Buffer.from([1])],[144,Buffer.concat([Count,Script])]])).Body;
}
function GenerationForConnection() { return '2K22'; }
module.exports={BitmapBytes,ValuesStart,Widths,ArrayFields,Field,ShowField,IsPresent,Decode,Trim,SetMachineId,SetShow,InspectGeneration,SetGotNextDestination,SetSquadId,SetSquadInvites,SetU64Fields,ReadU64Field,BuildGeneratedPlayer,SetGameState,SetActivity,GenerationForConnection};
