// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

// Gym workout regions need the same queue plumbing as park courts, because
// pressing A on one sends a JOIN for the region's court key and
// GotNext.Deliver can only answer it when a group with a free seat exists. The
// ship court table has no gym entry, so the group shape is synthesised here from
// GymEquipment2K22: one single-seat "gotnext" group per machine, anchored on the
// purple workout mat, which is the setup record base the client draws it from.
//
// Slot objects are never published for these groups (neighborhood is a bitstream
// world), so the synthetic slot id only has to be unique inside Slots.

const { Crc32 } = require('../Core/Crc32');
const Gym = require('./GymEquipment2K22');
const CourtData = require('./CourtData');

const SlotNamespace = 0x47494d0000000000n;
const RegionTypeGotNext = 0x9705bb0d;

const ByCourtKey = new Map();
const Groups = [];

for (const Region of Gym.Regions) {
    const Key = Crc32(Region.Anchor) >>> 0;
    const ObjectId = BigInt(Key);
    const Record = CourtData.BuildSetupRecord(Gym.SpotLayout(Region), 0);
    const Mat = [Record.readFloatLE(0x00), 0.0, Record.readFloatLE(0x08)];
    const Radians = (Region.Yaw * Math.PI) / 180.0;
    const Group = {
        Name: Region.Anchor,
        CourtName: Region.Anchor,
        Kind: 'gotnext',
        Seq: Key,
        Winding: 0,
        Pos: [Region.X, 0.0, Region.Z],
        Yaw: Radians,
        TeamSize: 1,
        // PLAYER CourtName selects the workout by machine hash, not the JOIN anchor.
        CourtId: Region.Name,
        // QueueFunction 0 keeps AdvanceLine from packing seats like a park line.
        QueueFunction: 0,
        Anchors: [Mat],
        Facing: [Math.sin(Radians), 0.0, Math.cos(Radians)],
        RegionType: RegionTypeGotNext,
        ObjectId,
        SlotObjectId: SlotNamespace | ObjectId,
        SlotName: Key,
        SlotIds: [SlotNamespace | ObjectId],
    };
    Groups.push(Group);
    ByCourtKey.set(ObjectId.toString(), Group);
    // Follow-up requests may use PLAYER CourtName instead of the JOIN anchor.
    ByCourtKey.set(BigInt(Region.Name).toString(), Group);
}

function GroupFor(Court) {
    if (Court === null || Court === undefined) return null;
    return ByCourtKey.get(BigInt.asUintN(64, BigInt(Court)).toString()) || null;
}

module.exports = { Groups, GroupFor, SlotNamespace };
