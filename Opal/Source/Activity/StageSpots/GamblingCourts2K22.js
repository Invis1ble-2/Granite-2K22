'use strict';

// Installed 2K22: gambling.ACTIVITY -> stadium 905 -> s905.iff/arena.SCNE.
// Logical positions/queues: 2k_world_setup.iff/park_setup.RDAT, GAMBLING/DEFAULT.
// CourtType: FUN_14160CD00, enum table 0x142CC4A90 (1v1=9, 2v2=8, 3v3=6).
const CourtTypeByTeam = Object.freeze({1:9, 2:8, 3:6});
const FunctionType = Object.freeze({Group:0, Line:1});
const Queue = (Location, Count, SquadOnly = false, WinnerSpot = false, Function = FunctionType.Group) =>
    Object.freeze({Location, ExitLocation:Location.replace('SIDE_', 'SIDE_OFFCOURT_'),
        Count, SquadOnly, WinnerSpot, Function});
const LogicalQueues = Object.freeze({
    '1V1_NORMAL': Object.freeze([
        Queue('NEARSIDE_RIGHT', 1, false, true),
        Queue('NEARSIDE_LEFT', 3, false, false, FunctionType.Line),
    ]),
    '3V3_V_FLIPPED': Object.freeze([
        Queue('FARSIDE_LEFT', 3, false, true), Queue('FARSIDE_RIGHT', 3),
        Queue('FARSIDE_CENTER', 3, true),
    ]),
    '2V2_V_FLIPPED': Object.freeze([
        Queue('FARSIDE_RIGHT', 2, false, true), Queue('FARSIDE_LEFT', 2),
        Queue('FARSIDE_CENTER', 2, true),
    ]),
    '2V2_NORMAL': Object.freeze([
        Queue('NEARSIDE_RIGHT', 2, false, true), Queue('NEARSIDE_LEFT', 2),
        Queue('NEARSIDE_CENTER', 2, true),
    ]),
});

// Keep the SCNE marker position distinct from the logical court's POSITION.
// Missing SCNE Translate (3v3_2) / Rotate (1v1) are not fabricated marker values.
const Definitions = [
    ['GAMBLING_ONE_V_ONE', 1, [0,0,2825], 0, '1V1_NORMAL',
        [-2.99600005,0,2834.09106], 'basket_ante_up_high_home'],
    ['GAMBLING_THREE_V_THREE_1', 3, [-3165.98,0,5.92], 90, '3V3_V_FLIPPED',
        [-3165.97998,0,5.92000008], 'basket_ante_up_high'],
    ['GAMBLING_THREE_V_THREE_2', 3, [0,0,0], 90, '3V3_V_FLIPPED',
        null, 'basket_ante_up_high5'],
    ['GAMBLING_THREE_V_THREE_3', 3, [3179.637,0,5.098], 90, '3V3_V_FLIPPED',
        [3179.63696,0,5.09800005], 'basket_ante_up_high6'],
    ['GAMBLING_THREE_V_THREE_4', 3, [-2809.62399,0,2218.222], 90, '3V3_V_FLIPPED',
        [-2809.62402,0,2218.22192], 'basket_ante_up_high7'],
    ['GAMBLING_THREE_V_THREE_5', 3, [2804.68699,0,2217.596], 90, '3V3_V_FLIPPED',
        [2804.68701,0,2217.59595], 'basket_ante_up_high8'],
    ['GAMBLING_TWO_V_TWO_1', 2, [-2573.71999,0,-2194.081], -90, '2V2_V_FLIPPED',
        [-2573.71997,0,-2194.08105], 'basket_ante_up_high_home3'],
    ['GAMBLING_TWO_V_TWO_2', 2, [2564.731,0,-2186.956], 90, '2V2_NORMAL',
        [2564.73096,0,-2186.95605], 'basket_ante_up_high_home4'],
];
const GamblingCourts = Object.freeze(Definitions.map(([name, TeamSize, Pos, YawDeg, Logical, MarkerPosition, Basket]) =>
    Object.freeze({name, TeamSize, Pos:Object.freeze(Pos), YawDeg, Yaw:YawDeg*Math.PI/180,
        CourtType:CourtTypeByTeam[TeamSize], GeometryType:TeamSize===2?'NBA':'SHORT',
        // FUN_14160CD00 reads IS_HALFCOURT independently, default false; GAMBLING omits it.
        IsHalfCourt:false, Generation:'2K22', Logical, Queues:LogicalQueues[Logical],
        Marker:Object.freeze({Position:MarkerPosition && Object.freeze(MarkerPosition),
            Rotation:TeamSize===1?null:Object.freeze([0,YawDeg*Math.PI/180,0]),
            BasketType:'NBA_STANCHION', NetType:'CLOTH', HomeBasket:Basket,
            AwayBasket:TeamSize===3?Basket:null})})));

// FUN_14160C890: full XMM0 return (xyz), not the decompiler's truncated uint64.
// Dimensions/offsets at 142CF7D64/70/C0, 14236B7EC and 142A347AC; flip=false.
const Dimensions = Object.freeze({
    9:Object.freeze({Length:1127.760009765625, Offset:-563.8800048828125}),
    8:Object.freeze({Length:1432.56005859375, Offset:-563.280029296875}),
    6:Object.freeze({Length:2255.52001953125, Offset:0}),
});
function LocalBase(Court, Location, Count) {
    const Dim = Court.QueueDimensions || Dimensions[Court.CourtType];
    if (!Dim || !/^(NEARSIDE|FARSIDE)_(OFFCOURT_)?(LEFT|RIGHT|CENTER)$/.test(Location))
        throw new Error(`Unsupported Ante-Up location ${Location}`);
    const Span = 120*(Count-1);
    const Side = (Location.startsWith('NEARSIDE_')?-1:1)*(Location.includes('_OFFCOURT_')?1002:842);
    let Along = Dim.Offset-Span/2;
    if (Location.endsWith('_LEFT')) Along = 160-Dim.Length/2+Dim.Offset;
    if (Location.endsWith('_RIGHT')) Along = Dim.Length/2-160-Span+Dim.Offset;
    return [Side,0,Along];
}
function ToWorld(Court, V, Direction = false) {
    const C = Math.cos(Court.Yaw), S = Math.sin(Court.Yaw);
    const Value = [C*V[0]+S*V[2], V[1], -S*V[0]+C*V[2]];
    return Direction ? Value.map(N=>Math.abs(N)<1e-6?0:Math.round(N*1e6)/1e6)
        : Value.map((N,I)=>N+Court.Pos[I]);
}
function Geometry(Court, Index) {
    const Q = Court.Queues[Index];
    if (!Q) throw new Error(`Invalid Ante-Up queue ${Court.name}#${Index}`);
    return {...Q, Base:LocalBase(Court,Q.Location,Q.Count), Exit:LocalBase(Court,Q.ExitLocation,Q.Count),
        StepLocal:[0,0,120], FacingLocal:[Q.Location.startsWith('NEARSIDE_')?1:-1,0,0]};
}
function AnchorsFor(Court, Index) {
    const G = Geometry(Court,Index);
    return Array.from({length:G.Count},(_,I)=>ToWorld(Court,G.Base.map((N,J)=>N+I*G.StepLocal[J])));
}
function LayoutFor(Court) {
    return {CourtType:Court.CourtType, IsHalfCourt:Court.IsHalfCourt, size:Court.TeamSize,
        position:Court.Pos.slice(), Yaw:Court.YawDeg, Locations:Court.Queues.map(Q=>Q.Location),
        Queues:Court.Queues, StageCourt:Court, Activity:'stage', Generation:'2K22', name:Court.name};
}
function Table() {
    return GamblingCourts.map((Court,Index)=>({Name:Court.name, Index, Pos:Court.Pos.slice(),
        MarkerPos:Court.Marker.Position && Court.Marker.Position.slice(), Yaw:Court.Yaw,
        CourtType:Court.GeometryType, TeamSize:Court.TeamSize, Generation:'2K22',
        Queues:Court.Queues.map((Q,I)=>({...Q, Anchors:AnchorsFor(Court,I),
            Facing:ToWorld(Court,Geometry(Court,I).FacingLocal,true)})),
        NoSquad:!Court.Queues.some(Q=>Q.SquadOnly)}));
}
module.exports={GamblingCourts, CourtTypeByTeam, FunctionType, Geometry, AnchorsFor, LayoutFor, Table};
