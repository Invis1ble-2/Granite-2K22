'use strict';
// FUN_1416E7A00: 20 inherited bits; FUN_1416E6570: 128 court bits.
// Value widths checked in FUN_1416E1080 / FUN_1416DE580.
// FUN_1416B4A30 -> game modes 0x33/0x34 (PARK_2_ON_2/PARK_3_ON_3).
// Court type 6 selects SHORT geometry; NBA half courts require type 8.
const ParkCourtType = Object.freeze({TwoOnTwo:8,ThreeOnThree:6});
const Count = 148;
const Bit = Object.freeze({
    Name:0, IsActive:1, CourtTransform:4, ArtBinding:8, GameState:9,
    CourtType:20, IsHalfCourt:22, HasWaitingArea:24,
    SetupGate:11, MatchId:17,
    AwayCount:28, AwayPlayers:[30,31,32,33,34], AwayUserdata:[50,51,52,53,54],
    HomeCount:55, HomePlayers:[56,57,58,59,60], HomeUserdata:[76,77,78,79,80],
    GotnextCount:82, Gotnext0x48Records:[83,84,85], Gotnext0x90Records:[86,87,88],
    WinnersLocation:[89,90,91], LosersLocation:[92,93,94],
    GameRelayToken:12, GameRelayAddress:13, GameRelayPort:14, GameRelayId:15,
    GameParameter:19,
    GamePreparedValid:81,
    GamblingIndex:126,
    // FUN_1416E6570/DE580: +728/+730, consumed by 141724681–6D5.
    BallType:130, OverrideBallType:131,
});
// The fields emitted by the initial queue bootstrap. Unsupported variable
// userdata remains outside this decoder; never infer its boundaries.
const Widths = new Map([[0,4],[1,1],[4,64],[8,4],[9,4],[11,1],[12,16],[13,4],[14,2],[15,2],[17,8],[19,4],[20,4],[22,1],[24,1],[28,1],[55,1],[81,1],[82,1],
    ...[30,31,32,33,34,56,57,58,59,60].map(I=>[I,8]),
    ...[83,84,85].map(I=>[I,72]), ...[86,87,88].map(I=>[I,144]),
    ...[89,90,92,93].map(I=>[I,16]),[91,4],[94,4],[126,1],[130,4],[131,4]]);
function Decode(Body) {
    if (!Buffer.isBuffer(Body) || Body.length < 35) return {Ok:false,Reason:'court header truncated'};
    if (Body[34] & 15) return {Ok:false,Reason:'nonzero padding after 148 court bits'};
    let Cursor=35;const Values=new Map();
    for(let Id=0;Id<Count;Id++) {
        if(!(Body[16+(Id>>3)]&(0x80>>(Id&7))))continue;
        const Variable = Bit.AwayUserdata.includes(Id) || Bit.HomeUserdata.includes(Id);
        if (Variable && Cursor+4>Body.length) return {Ok:false,Reason:`court field ${Id} length truncated`,Field:Id};
        const Width=Variable ? 4+Body.readUInt32LE(Cursor) : Widths.get(Id);
        if(Width===undefined)return {Ok:false,Reason:`unmodeled court field ${Id}`,Field:Id};
        if(Cursor+Width>Body.length)return {Ok:false,Reason:`court field ${Id} truncated`,Field:Id};
        Values.set(Id,Body.subarray(Cursor,Cursor+Width));Cursor+=Width;
    }
    return {Ok:true,Length:Cursor,Values,Trailing:Body.length-Cursor};
}
function Build(Opts) {
    const Values=new Map();
    const U32=N=>{const B=Buffer.alloc(4);B.writeUInt32LE(N>>>0);return B;};
    const U64=N=>{const B=Buffer.alloc(8);B.writeBigUInt64LE(BigInt(N));return B;};
    if (Opts.Teams) {
        const Teams = require('./CourtData').ValidateTeams(Opts.Teams.Home, Opts.Teams.Away);
        Values.set(Bit.SetupGate,Buffer.from([Opts.Online?1:0]));
        Values.set(Bit.MatchId,U64(Opts.Teams.MatchId ?? Opts.CourtId));
        const T=Opts.Teams.Transport;
        if(T) {
            if(!Buffer.isBuffer(T.Token)||T.Token.length!==16)throw new Error('invalid native relay UUID');
            Values.set(Bit.GameRelayToken,T.Token);
            Values.set(Bit.GameRelayAddress,U32(T.address));
            for(const [Id,N] of [[Bit.GameRelayPort,T.port],[Bit.GameRelayId,T.RelayId]]) {
                const B=Buffer.alloc(2);B.writeUInt16LE(N);Values.set(Id,B);
            }
        }
        for(const Side of ['Home','Away']) {
            Values.set(Bit[`${Side}Count`],Buffer.from([Teams[Side].length]));
            Teams[Side].forEach((Id,I)=>Values.set(Bit[`${Side}Players`][I],U64(Id)));
            if(Opts.Profiles) {
                const Blobs=Opts.Profiles[Side];
                if(!Array.isArray(Blobs)||Blobs.length!==Teams[Side].length)throw new Error(`Missing ${Side} court USERDATA`);
                Blobs.forEach((Blob,I)=>{
                    if (Opts.Teams.NativeSolo?.Cpu.includes(Teams[Side][I]) || Opts.Teams.NativePark?.Cpu.includes(Teams[Side][I])) {
                        if (!Buffer.isBuffer(Blob) || Blob.length) throw new Error('Native generated CPU must retain its own roster, without cloned USERDATA');
                        Values.set(Bit[`${Side}Userdata`][I],U32(0));return;
                    }
                    if(!Buffer.isBuffer(Blob)||!Blob.length||Blob.length>0x70000)throw new Error('invalid court USERDATA');
                    if(require('node:zlib').inflateSync(Blob,{maxOutputLength:0x6d030}).length<223256)throw new Error('Court USERDATA is truncated');
                    Values.set(Bit[`${Side}Userdata`][I],Buffer.concat([U32(Blob.length),Blob]));
                });
            }
        }
    }
    for(const Name of ['WinnersLocation','LosersLocation']) {
        const Line=Opts[Name];if(!Line)continue;
        for(let I=0;I<3;I++) {
            const B=Buffer.alloc(I===2?4:16);
            if(I===2)B.writeInt32LE(Math.round(Line.Facing));
            else {const V=I===0?Line.position:Line.Step;V.slice(0,3).forEach((N,J)=>B.writeFloatLE(N,J*4));B.writeFloatLE(I===0?1:0,12);}
            Values.set(Bit[Name][I],B);
        }
    }
    if(Number.isInteger(Opts.CourtObjectId)) Values.set(Bit.Name,U32(Opts.CourtObjectId));
    Values.set(Bit.IsActive,Buffer.from([1]));
    Values.set(Bit.GameState,U32(Opts.GameState === undefined ? 0 : Opts.GameState));
    if(Opts.CourtTransform) {
        let Transform;
        if(Array.isArray(Opts.CourtTransform)&&Opts.CourtTransform.length===16) {
            Transform=Buffer.alloc(64);Opts.CourtTransform.forEach((V,I)=>Transform.writeFloatLE(V,I*4));
        } else Transform=Buffer.from(Opts.CourtTransform);
        Values.set(Bit.CourtTransform,Transform);
    }
    if(Number.isInteger(Opts.ArtBinding)) Values.set(Bit.ArtBinding,U32(Opts.ArtBinding));
    if(Number.isInteger(Opts.CourtType)) {
        Values.set(Bit.CourtType,U32(Opts.CourtType));
        const HalfCourt = Opts.IsHalfCourt === undefined ? Opts.CourtType===ParkCourtType.TwoOnTwo : Opts.IsHalfCourt;
        Values.set(Bit.IsHalfCourt,Buffer.from([HalfCourt?1:0]));
    }
    Values.set(Bit.HasWaitingArea,Buffer.from([Opts.HasWaitingArea === false ? 0 : 1]));
    Values.set(Bit.GotnextCount,Buffer.from([Opts.Count||0]));
    if((Opts.Count||0)>3) throw new Error('2K22 supports at most three queue groups');
    for(const [Name,Ids,Width] of [['SpotRecords',Bit.Gotnext0x48Records,72],['SetupRecords',Bit.Gotnext0x90Records,144]]) {
        for(let I=0;I<(Opts[Name]||[]).length;I++) {
            const R=Opts[Name][I],Index=Buffer.isBuffer(R)?I:R.index,Data=Buffer.isBuffer(R)?R:R.Data;
            if(!Number.isInteger(Index)||Index<0||Index>2)throw new Error('invalid native queue index');
            const B=Buffer.from(Data||[]);if(B.length!==Width)throw new Error('invalid native queue record width');
            Values.set(Ids[Index],B);
        }
    }
    if (Opts.GamblingIndex !== undefined) {
        if (!Number.isInteger(Opts.GamblingIndex) || Opts.GamblingIndex<0 || Opts.GamblingIndex>=64)
            throw new Error('invalid native gambling price index');
        Values.set(Bit.GamblingIndex,Buffer.from([Opts.GamblingIndex]));
    }
    for (const Name of ['BallType', 'OverrideBallType']) {
        const Value = Opts[Name];
        if (Value === undefined) continue;
        if (!Number.isInteger(Value) || Value < 0 || Value > 0xffffffff)
            throw new Error(`invalid native ${Name}`);
        Values.set(Bit[Name], U32(Value));
    }
    const Header=Buffer.alloc(35);Header.writeBigUInt64BE(BigInt(Opts.CourtId||0));Header.writeBigUInt64BE(BigInt(Opts.OwnerId||0),8);
    const Parts=[Header];
    for(const [Id,Value] of [...Values].sort((A,B)=>A[0]-B[0])) {
        const Variable=Bit.HomeUserdata.includes(Id)||Bit.AwayUserdata.includes(Id);
        if(Value.length!==(Variable?4+Value.readUInt32LE(0):Widths.get(Id)))throw new Error(`invalid native field width ${Id}`);
        Header[16+(Id>>3)]|=0x80>>(Id&7);Parts.push(Value);
    }
    return Buffer.concat(Parts);
}
module.exports={Count,Bit,Widths,Decode,Build,ParkCourtType};
