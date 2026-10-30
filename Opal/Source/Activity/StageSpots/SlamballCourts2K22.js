'use strict';

const { Crc32 } = require('../../Core/Crc32');
const { Geometry, AnchorsFor } = require('./GamblingCourts2K22');

// 2k_world_setup.iff/park_setup.RDAT: SLAMBALL / SLAMBALL_AREA.
// Positions/rotations of the six trampoline courts are also present in
// levels/ship_deck1_upperpark_markers.iff. FULL1 is the moat's full 5v5 court.
const Queue = (Location, Count, SquadOnly = false, WinnerSpot = false) =>
    Object.freeze({Location, ExitLocation:Location.replace('SIDE_', 'SIDE_OFFCOURT_'),
        Count, SquadOnly, WinnerSpot, Function:0});
const LogicalQueues = Object.freeze({
    SLAMBALL_3V3_NORMAL: Object.freeze([
        Queue('NEARSIDE_RIGHT', 3, false, true), Queue('NEARSIDE_LEFT', 3),
        Queue('NEARSIDE_CENTER', 3, true),
    ]),
    SLAMBALL_3V3_V_FLIPPED: Object.freeze([
        Queue('FARSIDE_LEFT', 3, false, true), Queue('FARSIDE_RIGHT', 3),
        Queue('FARSIDE_CENTER', 3, true),
    ]),
    SLAMBALL_2V2_NORMAL: Object.freeze([
        Queue('NEARSIDE_LEFT', 2, false, true), Queue('NEARSIDE_RIGHT', 2),
        Queue('NEARSIDE_CENTER', 2, true),
    ]),
    SLAMBALL_2V2_V_FLIPPED: Object.freeze([
        Queue('FARSIDE_LEFT', 2, false, true), Queue('FARSIDE_RIGHT', 2),
        Queue('FARSIDE_CENTER', 2, true),
    ]),
    FULL1_COURT: Object.freeze([
        Queue('NEARSIDE_LEFT', 5, false, true), Queue('NEARSIDE_RIGHT', 5),
        Queue('NEARSIDE_CENTER', 5, true),
    ]),
});

// FUN_14160CD00 / 142CC4A90: FIVE_V_FIVE=1, SLAMBALL_3V3=35, SLAMBALL_2V2=36.
// FUN_14160C890: the 2v2 offset follows FLIP_DIRECTION_OF_PLAY=false,
// independently of IS_HALFCOURT. Do not reuse Ante-Up's queue offset tuning.
const Types = Object.freeze({
    3:Object.freeze({CourtType:35, Length:2255.52001953125, Offset:0}),
    2:Object.freeze({CourtType:36, Length:1432.56005859375, Offset:-716.280029296875}),
    5:Object.freeze({CourtType:1, Length:2865.1201171875, Offset:0}),
});
const Definitions = [
    ['SLAMBALL_3V3_TOP_RIGHT', 3, [-1309.591,1104.21594,-9192.383], 180, 'SLAMBALL_3V3_NORMAL'],
    ['SLAMBALL_3V3_TOP_LEFT', 3, [-1309.591,1104.21594,-6592.383], 180, 'SLAMBALL_3V3_NORMAL'],
    ['SLAMBALL_2V2_TOP', 2, [-1309.185,1104.21594,-12097.59], 180, 'SLAMBALL_2V2_NORMAL'],
    ['SLAMBALL_3V3_BOTTOM_RIGHT', 3, [1309.591,1104.21594,-9192.383], 180, 'SLAMBALL_3V3_V_FLIPPED'],
    ['SLAMBALL_3V3_BOTTOM_LEFT', 3, [1309.591,1104.21594,-6592.383], 180, 'SLAMBALL_3V3_V_FLIPPED'],
    ['SLAMBALL_2V2_BOTTOM', 2, [1309.5,1104.21594,-12096.64], 180, 'SLAMBALL_2V2_V_FLIPPED'],
    ['FULL1', 5, [3.943364,1104.41663,12539.0791], -90, 'FULL1_COURT'],
];
const Courts = Object.freeze(Definitions.map(([name, TeamSize, Pos, YawDeg, Logical]) =>
    Object.freeze({name, id:Crc32(name) >>> 0, TeamSize, Pos:Object.freeze(Pos),
        YawDeg, Yaw:YawDeg*Math.PI/180, CourtType:Types[TeamSize].CourtType,
        IsHalfCourt:TeamSize===2, Generation:'2K22', Logical,
        QueueDimensions:Types[TeamSize], Queues:LogicalQueues[Logical]})));

function LayoutFor(Court) {
    return {CourtType:Court.CourtType, IsHalfCourt:Court.IsHalfCourt, size:Court.TeamSize,
        position:Court.Pos.slice(), Yaw:Court.YawDeg, Locations:Court.Queues.map(Q=>Q.Location),
        Queues:Court.Queues, SlamballCourt:Court, Activity:'cages', Generation:'2K22', name:Court.name};
}
function Table() {
    return Courts.map((Court,Index)=>({Name:Court.name, Index, Guid:Court.id, CourtId:Court.id,
        Pos:Court.Pos.slice(), MarkerPos:Court.Pos.slice(), Yaw:Court.Yaw,
        CourtType:Court.TeamSize===3?'SHORT':'NBA', TeamSize:Court.TeamSize, Generation:'2K22',
        Queues:Court.Queues.map((Q,I)=>({...Q, Anchors:AnchorsFor(Court,I),
            Facing:FacingFor(Court,I)})), NoSquad:false}));
}
function FacingFor(Court, Index) {
    const Local = Geometry(Court,Index).FacingLocal;
    const C = Math.cos(Court.Yaw), S = Math.sin(Court.Yaw);
    return [C*Local[0]+S*Local[2], Local[1], -S*Local[0]+C*Local[2]]
        .map(N=>Math.abs(N)<1e-6?0:Math.round(N*1e6)/1e6);
}
module.exports={Courts, LogicalQueues, LayoutFor, Table};
