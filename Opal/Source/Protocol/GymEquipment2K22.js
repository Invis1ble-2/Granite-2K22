// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

// Gatorade gym workout regions published as COURT objects.
//
// levels/gatorade_training_facility_markers.iff carries thirteen anchors whose
// UserText is GOT_NEXT, one per equipment group. Keep the anchor CRC as the
// OBJECT_DATA id/geometry binding; COURT bit0 uses the machine hash consumed by
// prompts and training selection.
//
// COURT bit20 stays the equipment type that FUN_14173E170 switches on, because
// that switch is what turns an object into a workout prompt. Each region also
// carries one queue spot with setup geometry: park courts are never sent without
// it, and the client's proximity tests run against that geometry.

const { Crc32 } = require('../Core/Crc32');
const Log = require('../Core/Log');
const ObjectFrame = require('../Codec/ObjectFrame');
const Packets = require('./Packets');
const Layout22 = require('./CourtLayout2K22');
const CourtData = require('./CourtData');

const CourtClass = 0x2c4d49e3;
const DataPacket = Packets.Wire('OBJECT_DATA');

// COURT bit0 is the equipment name hash, and it is the only thing that selects
// the workout prompt: FUN_140DF0C80 maps it to a text ID (0x56..0x63) and falls
// back to the generic 0x4C for anything else. It is also the world hash key, so
// it has to be the retail machine hash rather than the anchor name.
// FUN_14173E170 maps each type to a workout ID; FUN_141B64840 uses that ID
// to index the machine hash table at 0x142DB7728. Positions and cardinal yaws
// come from the grouped GOT_NEXT scene markers.
// GATORADE_HAND_EYE is a separate marker, not one of these workout groups.
const Regions = [
    { Anchor: 'BENCH_PRESS_GROUP_0', Name: 0xeafc0891, Type: 0x11, X: 692.478149, Z: 11742.625, Yaw: 0 },
    { Anchor: 'DUMBBELL_GROUP_0', Name: 0x4c0715da, Type: 0x15, X: 2322.35425, Z: 11616.2891, Yaw: 0 },
    { Anchor: 'LEG_PRESS_GROUP_0Shape', Name: 0x8f1490f1, Type: 0x18, X: 2188.03125, Z: 12277.7295, Yaw: 0 },
    { Anchor: 'TREADMILLS_GROUP_0Shape', Name: 0x89482226, Type: 0x1e, X: 1060.63623, Z: 8960.65234, Yaw: 90 },
    { Anchor: 'AGILITY_HURDLES_GROUP_0Shape', Name: 0xbb35b65f, Type: 0x0f, X: 2063.0, Z: 9434.0, Yaw: -90 },
    { Anchor: 'BATTLE_ROPE_GROUP_0Shape', Name: 0xaabba94d, Type: 0x10, X: -1038.0, Z: 9580.0, Yaw: -90 },
    { Anchor: 'BOX_GROUP_0Shape', Name: 0x9e0e0ab0, Type: 0x12, X: 909.895081, Z: 12786.7236, Yaw: 0 },
    { Anchor: 'CLEAN_WEIGHT_GROUP_0', Name: 0xfe7d8902, Type: 0x13, X: 878.108459, Z: 10992.8896, Yaw: 0 },
    { Anchor: 'GATORADE_GROUP_0_Shape', Name: 0x6b45f0e9, Type: 0x16, X: 469.853729, Z: 13468.4414, Yaw: -90 },
    { Anchor: 'LADDER_GROUP_0Shape', Name: 0xc7457ba3, Type: 0x17, X: 1756.0, Z: 9409.0, Yaw: -90 },
    { Anchor: 'MEDICINE_BALL_GROUP_0Shape', Name: 0x1ae760a6, Type: 0x19, X: 999.822144, Z: 10371.7969, Yaw: 0 },
    { Anchor: 'SPRINT_GROUP_0Shape', Name: 0x1f789231, Type: 0x1c, X: 454.687683, Z: 10561.6699, Yaw: 0 },
    { Anchor: 'SQUATS_GROUP_0Shape', Name: 0x9f95bdf8, Type: 0x1d, X: 2327.31421, Z: 12661.8906, Yaw: 0 },
];

const ByKey = new Map(Regions.map((Region) => [Crc32(Region.Anchor) >>> 0, Region]));

function LayoutFor(Region) {
    return {
        Activity: 'neighborhood',
        name: Region.Anchor,
        position: [Region.X, 0, Region.Z],
        Yaw: Region.Yaw,
        CourtType: Region.Type,
        size: 1,
        Generation: '2K22',
        Locations: ['NEARSIDE_RIGHT'],
    };
}
// LocalBase offsets a queue spot from the court centre; probe it at the origin so
// the spot can be placed exactly on the equipment anchor instead.
function SpotLayout(Region) {
    const Layout = LayoutFor(Region);
    const Probe = CourtData.BuildSetupRecord({ ...Layout, position: [0, 0, 0] }, 0);
    return { ...Layout, position: [Region.X - Probe.readFloatLE(0), 0, Region.Z - Probe.readFloatLE(8)] };
}

// The 0x48 queue record carries the occupant PUIDs at +8 + slot*8, exactly like
// CourtData.LiveSpotRecord does for park courts: that is what tells the client
// which spot is taken and by whom.
// Keep the verified spot0/game0 baseline; occupant PUIDs still reserve the seat.
function OccupancyRecord(Layout, Seats) {
    const Record = CourtData.BuildOccupancyRecord(Layout, 0);
    Record.writeUInt32LE(0, 0);
    (Seats || []).slice(0, 8).forEach((Id, Slot) => {
        if (Id) Record.writeBigUInt64BE(BigInt.asUintN(64, BigInt(Id)), 8 + Slot * 8);
    });
    return Record;
}

function Build(Region, Seats = null, Version = 0n) {
    const Key = Crc32(Region.Anchor) >>> 0;
    const ObjectId = BigInt(Key);
    const Layout = LayoutFor(Region);
    const Spot = SpotLayout(Region);
    const Payload = Layout22.Build({
        CourtId: ObjectId,
        // The legacy OwnerId option carries the native object version. JOIN
        // remains pending until this version advances after the request.
        OwnerId: Version,
        CourtObjectId: Region.Name,
        CourtType: Region.Type,
        ArtBinding: Key,
        CourtTransform: CourtData.CourtTransform(Layout),
        GameState: 0,
        // Disable the native waiting-spot draw path without removing interaction geometry.
        HasWaitingArea: false,
        // Setup geometry places the marker; the occupancy record keeps court state
        // 0x348 + index*0x48 at "idle". Without it that slot holds whatever the
        // client never initialised and FUN_1416790B0 answers "not interactable",
        // which suppresses every prompt. Count must be 1: the earlier Count=0
        // build produced no prompt at all, while Count=1 did.
        Count: 1,
        SpotRecords: [OccupancyRecord(Layout, Seats)],
        SetupRecords: [CourtData.BuildSetupRecord(Spot, 0)],
    });
    return {
        ObjectId,
        Frame: ObjectFrame.Build({
            PacketId: DataPacket,
            ConnectionId: null,
            ObjectId,
            ClassCrc: CourtClass,
            Payload,
            Layout: ObjectFrame.Layout.Nineteen,
        }),
    };
}

function PublishRegion(Connection, Region, Seats = null) {
    const ObjectId = BigInt(Crc32(Region.Anchor) >>> 0);
    const Version = (Connection.CourtVersions.get(ObjectId) || 0n) + 1n;
    Connection.CourtVersions.set(ObjectId, Version);
    return Connection.SendObject(Build(Region, Seats, Version).Frame);
}

function Publish(Connection) {
    let Sent = 0;
    for (const Region of Regions) {
        if (PublishRegion(Connection, Region)) Sent++;
    }
    if (Sent) {
        Log.Info(
            `${Connection.Identifier} was given ${Sent}/${Regions.length} gym workout regions as COURT ` +
                `objects @ ${Log.Clock()}`,
        );
    }
    return Sent;
}

// The device state lives in the COURT object, not in the player object: park
// courts are refreshed the same way whenever a seat changes. A gym group has no
// ship court table entry, so GotNext.Seat/Release cannot rebroadcast it for us and
// this stands in, keyed by the slot id the caller already holds.
function PublishSpot(Connection, SlotId) {
    const Id = BigInt.asUintN(64, BigInt(SlotId));
    const Region = ByKey.get(Number(Id & 0xffffffffn));
    if (!Region) return 0;
    const Seats = require('./Slots').SeatsOf(Id);
    return PublishRegion(Connection, Region, Seats) ? 1 : 0;
}

module.exports = { Regions, LayoutFor, SpotLayout, Build, Publish, PublishSpot };
