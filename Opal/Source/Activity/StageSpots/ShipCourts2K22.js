'use strict';
const Markers = require('./ShipCourts2K22.markers.json');
const { Crc32 } = require('../../Core/Crc32');
const Geometry = require('./BoulevardCourts2K19');
const { ParkCourtType } = require('../../Protocol/CourtLayout2K22');
// Exact marker centers/rotations from the installed ship level. Queue offsets
// still use the existing retail spacing recipe; they are not extracted tuning.
const Courts = Markers.Courts.map(M => {
    const TeamSize = M.Name.startsWith('SHORT_') ? 3 : 2;
    const Id = Crc32(M.Name) >>> 0;
    return {name:M.Name,id:Id,RetailCourtId:Id,Pos:M.Translate.slice(),
        YawDeg:Math.abs(M.Rotate[0]) > 3 ? 180 : M.Rotate[1]*180/Math.PI,
        TeamSize,CourtType:TeamSize === 3 ? ParkCourtType.ThreeOnThree : ParkCourtType.TwoOnTwo,Generation:'2K22',
        Locations:['NEARSIDE_RIGHT','NEARSIDE_LEFT','NEARSIDE_CENTER'],
        Marker:M,QueueGeometrySource:'existing-retail-spacing'};
});
function Table() {
    return Courts.map((C,Index)=>({Name:C.name,Index,Guid:C.id,CourtId:C.id,
        Pos:C.Pos.slice(),MarkerPos:C.Pos.slice(),Yaw:C.YawDeg*Math.PI/180,SpotYaw:0,
        CourtType:C.TeamSize===3?'SHORT':'NBA',TeamSize:C.TeamSize,NoSquad:false,
        SpotAnchors:[Geometry.SpotAnchorsFor(C,0),Geometry.SpotAnchorsFor(C,1)],
        SquadAnchors:[Geometry.SquadAnchorFor(C)],RegionType:0x9705bb0d,SquadRegionType:0x6291f559}));
}
module.exports={Courts,Table,Markers};
