// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');

const { Hex } = require('../Core/Crc32');
const { Crc } = require('../Core/Names');
const FieldList = require('../Codec/FieldList');
const PlayerObject = require('./PlayerObject');
const Position = require('./Position');
const Courts = require('./Courts');
const Slots = require('./Slots');
const Roster = require('./Roster');
const CourtTables = require('../Activity/CourtTables');
const PlayerBody = require('./PlayerBody');

const RequestPacket = 0xce148fb1;

const Command = Crc('JOIN');

const EndCommand = 0xdaeafe9e;
const EndField = Object.freeze({ Result: 0xe3920695, Score: 0xd4d9ad7d });
const EndResult = Object.freeze({
    Won: 0x7037de7a,
    NoWinners: 0x466750bb,
    LostOrDropped: 0x76d0691e,
});

const LeaveCommand = 0x6ce44260;

const Field = {
    PlayerKey: 0xcc9ecd84,
    SlotIndex: 0xe101d0dc,
    Unknown: 0xea7e8979,
};

const CourtKeyOffset = 24;

const State = {
    None: 0x9705bb0d,
    Pending: 0xeb9084a3,
    GotNext: 0xca9b2162,
    Playing: 0xecbccdf8,
};

function Read(Bytes) {
    const CommandData = FieldList.Scan(Bytes, 'COMMAND');
    if (!CommandData) return null;
    const Which = CommandData.Data1 >>> 0;
    if (Which !== Command >>> 0 && Which !== LeaveCommand >>> 0) return null;

    const At = FieldList.Locate(Bytes);
    if (At < 0) return null;
    const List = FieldList.Parse(Bytes, At);
    const Find = (CrcValue) => {
        const F = List.Fields.find((X) => X.Crc === CrcValue >>> 0);
        return F && F.Value !== undefined ? F.Value : null;
    };

    const Key = Bytes.length >= CourtKeyOffset + 8 ? Bytes.readBigUInt64BE(CourtKeyOffset) : null;

    return {
        Leaving: Which === LeaveCommand >>> 0,
        CourtKey: Key,
        Room: Key === null ? null : Number(Key >> 32n),
        Seq: Key === null ? null : Number(Key & 0xffffffffn),
        PlayerKey: Find(Field.PlayerKey),
        SlotIndex: Find(Field.SlotIndex),
        Fields: List.Fields.length,
    };
}

function Handle(Connection, Bytes) {
    const Grab = Read(Bytes);
    if (!Grab) return false;
    const Slot = Grab.SlotIndex === null ? 0 : Number(Grab.SlotIndex);

    if (Grab.CourtKey !== null) {
        const Candidates = [Grab.CourtKey];
        if (Bytes.length >= CourtKeyOffset + 12) {
            Candidates.push(Bytes.readBigUInt64BE(CourtKeyOffset + 4));
        }
        let Resolved = null;
        for (const Key of Candidates) {
            // Native queued courts JOIN by court plus queue index, not an internal
            // queue object. Select before canonicalizing, or both sides become queue 0.
            const Group = (Connection.ActivityName === 'stage' || Connection.ActivityName === 'cages') && !Grab.Leaving
                ? QueuesFor(Connection, Key).find((G) => G.QueueIndex === Slot)
                : GroupFor(Connection, Key) || GroupForLoose(Connection, Key);
            if (Group) {
                Resolved = Group.ObjectId;
                break;
            }
        }
        if (Resolved !== null && Resolved !== Grab.CourtKey) {
            Log.Verbose(
                `  court key ${Grab.CourtKey.toString(16)} resolved to ` +
                    `${Resolved.toString(16)} for ${Connection.Identifier}`,
            );
            Grab.CourtKey = Resolved;
            Grab.Room = Number(Resolved >> 32n);
            Grab.Seq = Number(Resolved & 0xffffffffn);
        }
    }

    const Court =
        Grab.CourtKey === null
            ? 'an unreadable court'
            : `court ${Grab.CourtKey.toString(16).toUpperCase().padStart(16, '0')} ` +
              `(room ${Hex(Grab.Room)}, seq ${Hex(Grab.Seq)})`;

    if (Grab.Leaving) {
        const Held = Connection.GotNext && GroupFor(Connection, Connection.GotNext.Court);
        const Requested = Grab.CourtKey !== null && GroupFor(Connection, Grab.CourtKey);
        if (Held && (!Requested || Requested.CourtName !== Held.CourtName)) {
            Log.Error(`Ignoring leave for a different court from ${Connection.Identifier}`);
            return true;
        }
        Log.Info(`${Connection.Identifier} is giving up their spot on ${Court} @ ${Log.Clock()}`);
        try {
            require('./Requests').AckCorrelated(Connection, Bytes);
        } catch (_) {}
        Release(Connection);
        return true;
    }

    if (require('./CourtData').IsBitstreamWorld(Connection.ActivityName) && Connection.GotNext?.Playing) {
        const Active = GroupFor(Connection, Connection.GotNext.Court);
        const Requested = GroupFor(Connection, Grab.CourtKey);
        if (Active && Requested?.CourtName === Active.CourtName) {
            require('./Requests').AckCorrelated(Connection, Bytes);
        } else {
            Log.Error(`Court join ignored while ${Connection.Identifier} is already in a game`);
        }
        return true;
    }

    require('./ParkCpu').Stop(Connection, 'queue changed');
    Connection.GotNext = { Court: Grab.CourtKey, Slot: Slot, Since: Date.now() };

    Log.Info(`${Connection.Identifier} has next on ${Court}, slot ${Slot} @ ${Log.Clock()}`);
    Log.Verbose(
        `  granted by putting GOT_NEXT (${Hex(State.GotNext)}) into the player object the ` +
            `client reads its own state out of; correlated REQUEST_ACK follows the warp`,
    );
    Deliver(Connection, Bytes);
    return true;
}

const StateEndian = 'LE';

function FindState(Body, Want = State.None) {
    const Decoded = PlayerBody.Decode(Body);
    if (Decoded.Ok && Decoded.Generation === '2K22') {
        const At = Decoded.Offsets.get(4);
        return At !== undefined && Body.readUInt32LE(At) === (Want >>> 0) ? At : -1;
    }
    const Pattern = Buffer.alloc(4);
    Pattern.writeUInt32LE(Want >>> 0, 0);
    return Body.indexOf(Pattern);
}

const CourtIdOffset = 4;

function Grant(Body, StateData = State.GotNext, CourtId = null, Location = null, Facing = null) {
    const At = FindState(Body);
    if (At < 0) return { Patched: false, At: -1 };

    let Patched = Buffer.from(Body);
    Patched.writeUInt32LE(StateData >>> 0, At);

    let CourtAt = -1;
    if (CourtId !== null && At + CourtIdOffset + 4 <= Patched.length) {
        CourtAt = At + CourtIdOffset;
        Patched.writeUInt32LE(CourtId >>> 0, CourtAt);
    }

    let LocAt = -1;
    let FacingAt = -1;
    let LocReason = null;
    if (Location) {
        const Placed = PlayerBody.SetGotNextDestination(Patched, Location, Facing);
        if (Placed.Ok) {
            Patched = Placed.Body;
            LocAt = Placed.Offset;
            FacingAt = Placed.FacingOffset;
        } else {
            LocReason = Placed.Reason;
        }
    }

    return {
        Patched: true,
        At: At,
        CourtAt: CourtAt,
        LocAt: LocAt,
        FacingAt: FacingAt,
        LocReason: LocReason,
        Frame: Patched,
    };
}

// NBA2K22 native world-to-int16 position multiplier DAT_1422BCAEC = 1/3.
function WireScaleFor(Connection) {
    return PlayerBody.GenerationForConnection(Connection) === '2K22' ? 3 : 1;
}

function QueuesFor(Connection, Court) {
    if (Court === null || Court === undefined) return [];
    const World = CourtTables.For(Connection.ActivityName, Connection);
    if (!World) return [];

    const Id = BigInt.asUintN(64, BigInt(Court));
    const Low = Number(Id & 0xffffffffn) >>> 0;

    for (let Pass = 0; Pass < 3; Pass++) {
        for (const Raw of World.Courts) {
            const Queues = Courts.GroupsFor(Raw, World.Room, World.SeqBase)
                .filter((G) => Raw.Queues || G.Kind === 'gotnext');
            if (!Queues.length) continue;

            let Hit;
            if (Pass === 0) {
                Hit = Queues.some((G) => G.ObjectId === Court);
            } else {
                const Wire = [];
                if (Raw.Guid !== null && Raw.Guid !== undefined) {
                    Wire.push(BigInt.asUintN(64, BigInt(Raw.Guid)));
                }
                if (Raw.CourtId !== null && Raw.CourtId !== undefined) {
                    Wire.push(BigInt.asUintN(64, BigInt(Raw.CourtId)));
                }
                Hit = Pass === 1 ? Wire.some((W) => W === Id) : Wire.some((W) => Number(W & 0xffffffffn) >>> 0 === Low);
            }
            if (Hit) return Queues.slice().sort((A, B) => (A.QueueIndex ?? A.Winding) - (B.QueueIndex ?? B.Winding));
        }
    }
    return [];
}

function QueueFor(Connection, Court, Slot) {
    const Queues = QueuesFor(Connection, Court);
    if (!Queues.length) return GroupFor(Connection, Court) || GroupForLoose(Connection, Court);
    if (Queues[0].QueueIndex !== undefined) {
        return Queues.find((G) => G.ObjectId === Court) || Queues.find((G) => G.QueueIndex === (Slot >>> 0)) || null;
    }
    return Queues[Math.min(Math.max(0, Slot >>> 0), Queues.length - 1)];
}

function MatIndexFor(Connection, Group) {
    if (!Group || !Group.Anchors || Group.Anchors.length <= 1) return 0;
    const Live = Connection.Position;
    if (!Live) return 0;

    const Scale = WireScaleFor(Connection);
    const X = Live.X * Scale;
    const Z = Live.Z * Scale;
    let Best = 0;
    let BestDistance = Infinity;
    Group.Anchors.forEach((Anchor, Index) => {
        const Dx = Anchor[0] - X;
        const Dz = Anchor[2] - Z;
        const Distance = Dx * Dx + Dz * Dz;
        if (Distance < BestDistance) {
            BestDistance = Distance;
            Best = Index;
        }
    });
    return Best;
}

function SpotFor(Connection, Court, Slot) {
    const Group = QueueFor(Connection, Court, Slot);
    if (!Group || !Group.Anchors.length) return null;
    const Index = Number.isInteger(Connection.GotNext?.Seat)
        ? Connection.GotNext.Seat : MatIndexFor(Connection, Group);
    return Group.Anchors[Index] || Group.Anchors[0] || null;
}

function QueueFacingUnits(Group, Spot) {
    return Group?.Facing
        ? Math.atan2(Group.Facing[0], Group.Facing[2]) * 32768 / Math.PI
        : Position.FacingUnitsForSpot(Spot, Group ? Group.Pos : null);
}

function Deliver(Connection, RequestBuffer = null) {
    if (!Connection.PlayerBody) {
        Log.Error(
            `${Connection.Identifier} has next but no player body has arrived yet, so the ` +
                `grant cannot be delivered.`,
        );
        return false;
    }

    const Native22 = PlayerBody.GenerationForConnection(Connection) === '2K22';
    // Allocate first: a taken nearest mat may assign a different free seat.
    if (Native22 && !Seat(Connection)) {
        Connection.GotNext = null;
        if (RequestBuffer) require('./Requests').AckCorrelated(Connection, RequestBuffer);
        return false;
    }
    const Group = Connection.ActivityName === 'stage' || Connection.ActivityName === 'cages'
        ? QueueFor(Connection, Connection.GotNext?.Court, Connection.GotNext?.Slot)
        : GroupFor(Connection, Connection.GotNext && Connection.GotNext.Court);
    const CourtId = Group ? Courts.IdentityOf(Group) : null;
    const GymSpot = Native22 && Connection.ActivityName === 'neighborhood'
        ? require('./GymSpots2K22').GroupFor(Connection.GotNext.Court)
        : null;

    const Spot = SpotFor(
        Connection,
        Connection.GotNext && Connection.GotNext.Court,
        Connection.GotNext ? Connection.GotNext.Slot : 0,
    );
    const WriteLocation = process.env.OPAL_GOTNEXT_LOCATION === '0' ? null : Spot;
    const Facing = WriteLocation ? QueueFacingUnits(Group, WriteLocation) : null;
    if (WriteLocation) Connection.GotNext.Location = WriteLocation;
    const Patch = Grant(Connection.PlayerBody, State.GotNext, CourtId, WriteLocation, Facing);
    if (!Patch.Patched) {
        Log.Error(
            `${Connection.Identifier} has next but their player body carries no ` +
                `${Hex(State.None)} to replace, so the grant has nowhere to go.`,
        );
        return false;
    }

    Connection.PlayerBody = Patch.Frame;
    const Frame = PlayerObject.FrameFor(Connection);
    if (!Frame) return false;
    let Granted = 0;
    const GrantedSelf = Connection.SendObject(Frame);
    if (GrantedSelf) Granted++;
    try {
        for (const Peer of Roster.Peers(Connection)) {
            if (Peer.SendObject(Frame)) Granted++;
        }
    } catch (_) {}
    if (!Granted) {
        return false;
    }

    Log.Verbose(
        `  ${Connection.Identifier} sent their own player object with GOT_NEXT at ` +
            `body+${Patch.At}, revision ${Connection.PlayerRevision} to ${Granted} recipient(s)`,
    );
    if (Patch.CourtAt >= 0) {
        Log.Verbose(
            `  and court ${Hex(CourtId)} at body+${Patch.CourtAt} (parkobj+308), which is ` +
                `what UpdateParkState looks the court up by before it will let go of the spot`,
        );
    } else {
        Log.Error(
            `${Connection.Identifier} has next but no court id could be written into their ` +
                `player body, so the client will loop on "failed to leave got next on court".`,
        );
    }
    if (Patch.LocAt >= 0) {
        Log.Verbose(
            `  and gotNextLocation (${WriteLocation[0]}, ${WriteLocation[1]}, ` +
                `${WriteLocation[2]}) at body+${Patch.LocAt} (PLAYER field 147), facing ` +
                `${Facing === null ? 'unset' : Math.round(Facing)} at body+${Patch.FacingAt} ` +
                `(field 148) — the point Update_AIWorldDescription copies to the AI world ` +
                `description+48, which is what the got-next detector warps them to`,
        );
    } else if (WriteLocation) {
        Log.Error(
            `${Connection.Identifier} has next but gotNextLocation could not be ` +
                `written: ${Patch.LocReason}. The client will warp them to the world ` +
                `origin instead of the spot.`,
        );
    }

    if (!Native22) Seat(Connection);

    const CourtData = require('./CourtData');
    const BitstreamGrab =
        Connection.GotNext &&
        CourtData.IsBitstreamWorld(Connection.ActivityName) &&
        (Connection.ActivityName !== 'neighborhood' ||
            CourtData.ParkCourtFormat(GroupFor(Connection, Connection.GotNext.Court)?.CourtName) !== 'legacy');
    if (Connection.GotNext && !BitstreamGrab) {
        Courts.Republish(Connection, Connection.GotNext.Court);
    }
    const Warped = Warp(Connection);

    let Acknowledged = false;
    if (RequestBuffer) {
        try {
            Acknowledged = require('./Requests').AckCorrelated(Connection, RequestBuffer);
        } catch (_) {}
        try {
            const GrantedSpot = Connection.GotNext;
            const Timer = setTimeout(() => {
                if (Connection.Closed || Connection.GotNext !== GrantedSpot || !Connection.GotNext || Connection.GotNext.Playing || !Connection.PlayerBody)
                    return;
                const Refresh = PlayerObject.FrameFor(Connection);
                if (Refresh) {
                    Connection.SendObject(Refresh);
                    for (const Peer of Roster.Peers(Connection)) Peer.SendObject(Refresh);
                }
                Warp(Connection);
            }, 750);
            if (Timer.unref) Timer.unref();
        } catch (_) {}
    }
    if (GymSpot) {
        if (!GrantedSelf || Patch.CourtAt < 0 || Patch.LocAt < 0 || !Warped || !Acknowledged) {
            Log.Error(`${Connection.Identifier}: gym start withheld; player, destination, warp and Ack must succeed`);
            return false;
        }
        // Entering description state 3 arms native workout selection. Gym seats
        // do not create the park GAME/teams used by MaybeStartMatch.
        const GrantedWorkout = GrantPlaying(Connection);
        if (GrantedWorkout) {
            Log.Info(
                `${Connection.Identifier} granted gym PLAYING for ${GymSpot.CourtName}, ` +
                    `machine ${Hex(CourtId)} @ ${Log.Clock()}`,
            );
        } else {
            Log.Error(`${Connection.Identifier}: gym PLAYING could not be delivered`);
        }
        return GrantedWorkout;
    }

    try {
        MaybeStartMatch(Connection);
    } catch (Failure) {
        Log.Error(`Match start withheld: ${Failure.message}`);
    }
    return true;
}

function GroupFor(Connection, Court) {
    if (Court === null || Court === undefined) return null;
    // Gym workout regions are single-seat spots with no ship court table entry;
    // GymSpots2K22 supplies the same group shape so JOIN can be seated.
    const GymSpot = require('./GymSpots2K22').GroupFor(Court);
    if (GymSpot) return GymSpot;
    const World = CourtTables.For(Connection.ActivityName, Connection);
    if (!World) return null;

    for (const Raw of World.Courts) {
        for (const Group of Courts.GroupsFor(Raw, World.Room, World.SeqBase)) {
            if (Group.ObjectId === Court) return Group;
        }
    }

    const Id = BigInt.asUintN(64, BigInt(Court));
    const Low = Number(Id & 0xffffffffn) >>> 0;
    for (let Pass = 0; Pass < 2; Pass++) {
        for (const Raw of World.Courts) {
            const Wire = [];
            if (Raw.Guid !== null && Raw.Guid !== undefined) {
                Wire.push(BigInt.asUintN(64, BigInt(Raw.Guid)));
            }
            if (Raw.CourtId !== null && Raw.CourtId !== undefined) {
                Wire.push(BigInt.asUintN(64, BigInt(Raw.CourtId)));
            }
            const Hit =
                Pass === 0 ? Wire.some((W) => W === Id) : Wire.some((W) => Number(W & 0xffffffffn) >>> 0 === Low);
            if (!Hit) continue;
            const Groups = Courts.GroupsFor(Raw, World.Room, World.SeqBase).filter((G) => G.Kind === 'gotnext');
            if (Groups.length) return Groups[0];
        }
    }
    return null;
}

function GroupForLoose(Connection, Court) {
    if (Court === null || Court === undefined) return null;
    const Low = Number(BigInt.asUintN(64, BigInt(Court)) & 0xffffffffn) >>> 0;
    const World = CourtTables.For(Connection.ActivityName, Connection);
    if (!World) return null;

    for (const Raw of World.Courts) {
        for (const Group of Courts.GroupsFor(Raw, World.Room, World.SeqBase)) {
            if (Number(Group.ObjectId & 0xffffffffn) >>> 0 === Low) return Group;
        }
    }
    return null;
}

// A LINE has waiting capacity independent of the match's team size. Keep its
// occupied seats packed so joining, leaving and game handoff preserve FIFO.
function AdvanceLine(Connection, Group) {
    if (!Group || Group.QueueFunction !== 1) return;
    const StateData = Slots.StateFor(Group.SlotObjectId, Group.Anchors.length);
    const Packed = StateData.Seats.filter((Id) => Id !== 0n);
    const Next = Array.from({length:Group.Anchors.length}, (_, I) => Packed[I] || 0n);
    if (Next.every((Id, I) => Id === StateData.Seats[I])) return;
    StateData.Seats = Next;
    StateData.Revision++;
    for (const Player of Roster.InActivity(Connection.ActivityKey)) {
        if (!Player.GotNext || Player.GotNext.Playing || Player.Puid == null) continue;
        const Held = QueueFor(Player, Player.GotNext.Court, Player.GotNext.Slot);
        if (Held?.SlotObjectId !== Group.SlotObjectId) continue;
        const Index = Next.indexOf(Player.Puid);
        if (Index < 0 || Player.GotNext.Seat === Index) continue;
        Player.GotNext.Seat = Index;
        Player.GotNext.Location = Group.Anchors[Index];
        if (Player.PlayerBody) {
            Reapply(Player);
            PublishPlayerState(Player);
            Warp(Player);
        }
    }
}

function NotifyQueueChanges(Connection, SlotIds) {
    if (!['neighborhood', 'cages'].includes(Connection.ActivityName) || !SlotIds.length) return;
    const World = CourtTables.For(Connection.ActivityName, Connection);
    if (!World) return;
    const Changed = new Set(SlotIds);
    for (const Raw of World.Courts) {
        const Groups = Courts.GroupsFor(Raw, World.Room, World.SeqBase).filter(G => G.Kind === 'gotnext');
        if (Groups.some(G => Changed.has(G.SlotObjectId)))
            require('./ParkCpu').QueueChanged(Connection, { Raw, Groups });
    }
}

function Seat(Connection) {
    if (!Connection.GotNext || Connection.Puid === null) return false;

    const Group = QueueFor(Connection, Connection.GotNext.Court, Connection.GotNext.Slot);
    if (!Group) return false;
    AdvanceLine(Connection, Group);

    const SeatData = Slots.Occupy(
        Group.SlotObjectId,
        Connection.Puid,
        Group.Anchors.length,
        Group.QueueFunction === 1 ? -1 : MatIndexFor(Connection, Group),
    );
    if (!SeatData) {
        Log.Error(
            `${Connection.Identifier} grabbed a spot on a queue with no free seat, so they ` +
                `were granted got-next without being seated.`,
        );
        return false;
    }

    if (Group.QueueIndex !== undefined) {
        Connection.GotNext.Court = Group.ObjectId;
        Connection.GotNext.Slot = Group.QueueIndex;
    }
    Connection.GotNext.Seat = SeatData.Index;
    Connection.GotNext.Location = Group.Anchors[SeatData.Index];
    if (SeatData.Freed.length) {
        const World = CourtTables.For(Connection.ActivityName, Connection);
        for (const Raw of World.Courts) {
            for (const FreedGroup of Courts.GroupsFor(Raw, World.Room, World.SeqBase)) {
                if (FreedGroup.QueueFunction !== 1 || !SeatData.Freed.includes(FreedGroup.SlotObjectId)) continue;
                AdvanceLine(Connection, FreedGroup);
                require('./CourtData').BroadcastCourtGroup(Connection, FreedGroup);
            }
        }
    }
    Publish(Connection, Group);

    if (require('./CourtData').IsBitstreamWorld(Connection.ActivityName)) {
        require('./CourtData').BroadcastCourtGroup(Connection, Group);
        // Gym groups have no ship court table entry, so the rebroadcast above is a
        // no-op for them and the device would stay "free" while we hold its spot.
        require('./GymEquipment2K22').PublishSpot(Connection, Group.SlotObjectId);
    }

    Log.Verbose(
        `  seated in queue ${Hex(Number(Group.SlotObjectId & 0xffffffffn))} at seat ` +
            `${SeatData.Index} of ${Group.Anchors.length}` +
            (SeatData.Freed.length ? `, releasing ${SeatData.Freed.length} held elsewhere` : ''),
    );
    NotifyQueueChanges(Connection, [...SeatData.Freed, Group.SlotObjectId]);
    return true;
}

function Publish(Connection, Group) {
    const CourtData = require('./CourtData');
    if (
        CourtData.IsBitstreamWorld(Connection.ActivityName) &&
        (Connection.ActivityName !== 'neighborhood' || CourtData.ParkCourtFormat(Group.CourtName) !== 'legacy')
    ) {
        return;
    }
    Slots.Publish(Connection, Group);
    for (const Peer of Roster.Peers(Connection)) Slots.Publish(Peer, Group);
}

function CourtGroupsForMatch(Connection, Court) {
    const World = CourtTables.For(Connection.ActivityName, Connection);
    if (!World) return null;
    for (const Raw of World.Courts) {
        const Groups = Courts.GroupsFor(Raw, World.Room, World.SeqBase);
        if (!Groups.some((G) => G.ObjectId === Court)) continue;
        return { Raw, Groups: Groups.filter((G) => G.Kind === 'gotnext') };
    }
    return null;
}

function HandleGameConnected(Connection, Bytes) {
    const CourtData = require('./CourtData');
    if (
        !CourtData.IsBitstreamWorld(Connection.ActivityName) ||
        Bytes.length < 68 ||
        Bytes.readUInt32BE(4) !== RequestPacket
    )
        return false;
    const CommandData = FieldList.Scan(Bytes, 'COMMAND');
    if (!CommandData || CommandData.Data1 !== 0xdfc1471f) return false;
    const Group = GroupFor(Connection, Bytes.readBigUInt64BE(CourtKeyOffset));
    const Held = Connection.GotNext && GroupFor(Connection, Connection.GotNext.Court);
    if (!Group || !Held || Group.CourtName !== Held.CourtName || !Connection.GotNext.Playing) {
        Log.Error(
            `Ignored court connection-complete notification outside an active seated game: ${Connection.Identifier}`,
        );
        return true;
    }

    if (!require('./Requests').AckCorrelated(Connection, Bytes)) {
        Log.Error(`Could not acknowledge court connection-complete for ${Connection.Identifier}`);
        return true;
    }
    if (!Connection.GotNext.GameConnected) {
        const Ready = CourtData.MarkGameConnected(Connection.ActivityName, Group.CourtName, Connection.Puid, PlayerBody.GenerationForConnection(Connection));
        if (Ready.Accepted) {
            Connection.GotNext.GameConnected = true;
            Log.Info(
                `${Connection.ActivityName} ${Group.CourtName}: ${Ready.Ready}/${Ready.total} participants reported game connection complete @ ${Log.Clock()}`,
            );
            if (Ready.Advanced) {
                const Game = CourtData.GameTeams(Connection.ActivityName, Group.CourtName, PlayerBody.GenerationForConnection(Connection));
                const Found = CourtGroupsForMatch(Connection, Group.ObjectId);
                if (Game && Found && Found.Groups.length === 2 && !Game.AwayReleased) {
                    const AwayQueue = Found.Groups[1];
                    for (const Puid of Game.Away) Slots.ReleaseFrom(AwayQueue.SlotObjectId, Puid);
                    AdvanceLine(Connection, AwayQueue);
                    Game.AwayReleased = true;
                    Log.Info(
                        `${Connection.ActivityName} ${Group.CourtName}: opened the away line ` +
                            `for the next ${AwayQueue.Anchors.length} challenger(s); home remains occupied`,
                    );
                }
                CourtData.BroadcastCourtGroup(Connection, Group);
                Log.Info(
                    `${Connection.ActivityName} ${Group.CourtName}: all game connections complete; published native court state 3 @ ${Log.Clock()}`,
                );
            }
        }
    }
    return true;
}

function ReadGameEnd(Bytes) {
    const CommandData = FieldList.Scan(Bytes, 'COMMAND');
    if (!CommandData || CommandData.Data1 >>> 0 !== EndCommand) return null;
    const At = FieldList.Locate(Bytes);
    const List = At >= 0 ? FieldList.Parse(Bytes, At) : { Fields: [] };
    const ResultField = List.Fields.find((FieldValue) => FieldValue.Crc === EndField.Result);
    const ScoreField = List.Fields.find((FieldValue) => FieldValue.Crc === EndField.Score);
    const Result = ResultField ? (ResultField.Data1 !== undefined ? ResultField.Data1 : ResultField.Value) : null;
    const Score = ScoreField && ScoreField.Value !== undefined ? ScoreField.Value : null;
    return {
        Court: Bytes.length >= CourtKeyOffset + 8 ? Bytes.readBigUInt64BE(CourtKeyOffset) : null,
        Result: Result === null || Result === undefined ? null : Number(Result) >>> 0,
        Score: Score,
    };
}

function PublishPlayerState(Player) {
    const Frame = PlayerObject.FrameFor(Player);
    if (!Frame) return 0;
    let Sent = 0;
    if (Player.SendObject(Frame)) Sent++;
    for (const Peer of Roster.Peers(Player)) if (Peer.SendObject(Frame)) Sent++;
    return Sent;
}

function PlacePostGamePlayer(Player, CourtGroup, Destination, ReserveSeat, PreferredSeat) {
    if (!Player || !Player.PlayerBody || !CourtGroup || !Destination) return false;
    let At = FindState(Player.PlayerBody, State.Playing);
    if (At < 0) At = FindState(Player.PlayerBody, State.GotNext);
    if (At < 0) At = FindState(Player.PlayerBody, State.None);
    if (At < 0) return false;

    const Facing = Position.FacingUnitsForSpot(Destination, CourtGroup.Pos);
    let Body = Buffer.from(Player.PlayerBody);
    Body.writeUInt32LE(State.GotNext >>> 0, At);
    if (At + CourtIdOffset + 4 <= Body.length)
        Body.writeUInt32LE(Courts.IdentityOf(CourtGroup) >>> 0, At + CourtIdOffset);
    const Placed = PlayerBody.SetGotNextDestination(Body, Destination, Facing);
    if (!Placed.Ok) {
        Log.Error(`${Player.Identifier}'s postgame destination could not be written: ${Placed.Reason}`);
    } else {
        Body = Placed.Body;
    }

    let SeatIndex = null;
    if (ReserveSeat) {
        const SeatData = Slots.Occupy(CourtGroup.SlotObjectId, Player.Puid, CourtGroup.Anchors.length, PreferredSeat);
        if (!SeatData) return false;
        SeatIndex = SeatData.Index;
    }
    Player.PlayerBody = Body;
    Player.GotNext = {
        Court: CourtGroup.ObjectId,
        Slot: 0,
        Seat: SeatIndex,
        Location: Destination,
        Since: Date.now(),
        Playing: false,
        PostGameWinner: ReserveSeat,
        PostGameHold: true,
    };
    return true;
}

function ReleasePostGamePlayer(Player) {
    if (!Player || !Player.PlayerBody) return false;
    let At = FindState(Player.PlayerBody, State.Playing);
    if (At < 0) At = FindState(Player.PlayerBody, State.GotNext);
    if (At < 0) At = FindState(Player.PlayerBody, State.None);
    if (At < 0) return false;
    const Body = Buffer.from(Player.PlayerBody);
    Body.writeUInt32LE(State.None >>> 0, At);
    if (At + CourtIdOffset + 4 <= Body.length) Body.writeUInt32LE(0, At + CourtIdOffset);
    Player.PlayerBody = Body;
    Player.GotNext = null;
    return true;
}

const WinnerBehindSpacing = 120.0;
const WinnerBehindSign = -1;
const LoserSideDistance = 842.0;
const LoserLateralSpacing = 120.0;
const OneOnOneBasketLeft = 420.0;

function CourtLocalToWorld(Raw, Lx, Lz) {
    const C = Raw.Pos,
        Yaw = Number(Raw.Yaw) || 0;
    const Cos = Math.cos(Yaw),
        Sin = Math.sin(Yaw);
    return [C[0] + Lx * Cos + Lz * Sin, C[1], C[2] - Lx * Sin + Lz * Cos];
}

function HomeSideSign(Raw, HomeGroup) {
    const Anchor = HomeGroup && HomeGroup.Anchors && HomeGroup.Anchors[0];
    if (!Anchor) return 1;
    const C = Raw.Pos,
        Yaw = Number(Raw.Yaw) || 0;
    const Cos = Math.cos(Yaw),
        Sin = Math.sin(Yaw);
    const Lx = (Anchor[0] - C[0]) * Cos - (Anchor[2] - C[2]) * Sin;
    return Lx >= 0 ? 1 : -1;
}

function WinnerPoint(Raw, Index) {
    return CourtLocalToWorld(Raw, 0, WinnerBehindSign * Index * WinnerBehindSpacing);
}

function LoserPoint(Found, Index, Count) {
    const Raw = Found.Raw;
    const Size = Raw.TeamSize || Found.Groups[0].Anchors.length;
    if (Size === 1) return CourtLocalToWorld(Raw, -OneOnOneBasketLeft, 0);
    const Lx = -HomeSideSign(Raw, Found.Groups[0]) * LoserSideDistance;
    const Lz = (Index - (Count - 1) * 0.5) * LoserLateralSpacing;
    return CourtLocalToWorld(Raw, Lx, Lz);
}

function PostGameLocations(Raw, Groups) {
    const Found = { Raw, Groups };
    const Size = Raw.TeamSize || Groups[0].Anchors.length;
    const Line = (First, Second) => ({
        position: First,
        Step: Size > 1 ? Second.map((Value, Axis) => Value - First[Axis]) : [0, 0, 0],
        Facing: Position.FacingUnitsForSpot(First, Raw.Pos),
    });
    return {
        Winners: Line(WinnerPoint(Raw, 0), WinnerPoint(Raw, 1)),
        Losers: Line(LoserPoint(Found, 0, Size), LoserPoint(Found, 1, Size)),
    };
}

function SendPostGameWarp(Player, Destination, FacingTarget) {
    const Frame = Position.BuildWarp(Player.Puid, {
        X: Math.round(Destination[0]),
        Y: Math.round(Destination[1]),
        Z: Math.round(Destination[2]),
        Heading: Position.FacingByteForSpot(Destination, FacingTarget),
    });
    Position.Suppress(Player);
    let Sent = 0;
    if (Player.SendObject(Frame)) Sent++;
    for (const Peer of Roster.Peers(Player)) if (Peer.SendObject(Frame)) Sent++;
    return Sent;
}

function FinishPublicGame(Connection, Found, Game, WinnerSide, Reason) {
    if (!Game || Game.Ended || !Found || Found.Groups.length !== 2) return false;
    if (Game.NativeSolo || Game.NativePark) return require('./ParkCpu').Finish(Connection, Found, Game, Reason);
    Game.Ended = true;
    Game.Phase = 'ending';
    Game.WinnerSide = WinnerSide;

    const Participants = [...Game.Home, ...Game.Away];
    const Winners = WinnerSide === 0 ? Game.Home : WinnerSide === 1 ? Game.Away : [];
    const WinnerSet = new Set(Winners.map(String));
    const Members = Roster.InActivity(Connection.ActivityKey);
    const ByPuid = new Map(
        Members.filter((Member) => Member.Puid != null).map((Member) => [String(Member.Puid), Member]),
    );

    for (const Puid of Participants) {
        Slots.ReleaseFrom(Found.Groups[0].SlotObjectId, Puid);
        Slots.ReleaseFrom(Found.Groups[1].SlotObjectId, Puid);
    }
    AdvanceLine(Connection, Found.Groups[1]);

    const Changed = [];
    const Placements = new Map();

    if (!Winners.length) {
        for (const Puid of Participants) {
            const Player = ByPuid.get(String(Puid));
            if (Player && ReleasePostGamePlayer(Player)) Changed.push(Player);
        }
    } else {
        for (const [Index, Puid] of Winners.entries()) {
            const Player = ByPuid.get(String(Puid));
            const Point = WinnerPoint(Found.Raw, Index);
            if (Player && PlacePostGamePlayer(Player, Found.Groups[0], Point, true, Index)) {
                Changed.push(Player);
                Placements.set(String(Puid), { Kind: 'winner-court', Point, Facing: Found.Raw.Pos });
            }
        }
        const Losers = Participants.filter((Puid) => !WinnerSet.has(String(Puid)));
        Losers.forEach((Puid, Index) => {
            const Player = ByPuid.get(String(Puid));
            const Point = LoserPoint(Found, Index, Losers.length);
            if (Player && ReleasePostGamePlayer(Player)) {
                Changed.push(Player);
                Placements.set(String(Puid), {
                    Kind: Found.Raw.TeamSize === 1 ? 'loser-basket-left' : 'loser-opposite-home',
                    Point,
                    Facing: Found.Raw.Pos,
                });
            }
        });
    }

    require('./CourtData').ClearGameTeams(Connection.ActivityName, Found.Raw.Name, PlayerBody.GenerationForConnection(Connection));
    require('./CourtData').BroadcastCourtGroup(Connection, Found.Groups[0]);
    for (const Player of Changed) {
        PublishPlayerState(Player);
        const Placement = Placements.get(String(Player.Puid));
        if (Placement) {
            const Sent = SendPostGameWarp(Player, Placement.Point, Placement.Facing);
            Log.Verbose(
                `  ${Player.Identifier} warped to ${Placement.Kind} at ` +
                    `(${Placement.Point.map((Value) => Math.round(Value)).join(', ')}) ` +
                    `for ${Sent} recipient(s)`,
            );
        }
    }

    Game.Phase = 'ended';
    Log.Info(
        `${Connection.ActivityName} ${Found.Raw.Name} ended (${Reason}); ` +
            `frozen home [${Game.Home.map(String)}], away [${Game.Away.map(String)}]; ` +
            `${Winners.length ? `winner/home [${Winners.map(String)}]` : 'no winners'}, ` +
            `${Participants.length - Winners.length} loser(s) moved to the losing zone @ ${Log.Clock()}`,
    );

    if (Changed.length && Winners.length) {
        const Anchor = Changed.find((Player) => WinnerSet.has(String(Player.Puid)));
        if (Anchor) {
            const Timer = setTimeout(() => {
                if (!Anchor.Closed && Anchor.GotNext && !Anchor.GotNext.Playing) MaybeStartMatch(Anchor);
            }, 1500);
            if (Timer.unref) Timer.unref();
        }
    }
    return true;
}

function HandleGameEnd(Connection, Bytes) {
    const Ended = ReadGameEnd(Bytes);
    if (!Ended || !require('./CourtData').IsBitstreamWorld(Connection.ActivityName)) return false;

    require('./Requests').AckCorrelated(Connection, Bytes);
    const GymSpot = Connection.ActivityName === 'neighborhood' &&
        PlayerBody.GenerationForConnection(Connection) === '2K22' && Connection.GotNext?.Playing
        ? require('./GymSpots2K22').GroupFor(Connection.GotNext.Court)
        : null;
    if (GymSpot) {
        // Gym workouts have no public GAME/teams record. Ack alone leaves the
        // authoritative PLAYER in PLAYING, which Reapply would keep restoring.
        if (Release(Connection)) {
            Log.Info(`${Connection.Identifier} ended gym workout ${GymSpot.CourtName}; WALKING restored @ ${Log.Clock()}`);
        } else {
            Log.Error(`${Connection.Identifier}: gym end cleanup could not publish WALKING`);
        }
        return true;
    }

    let Found = Ended.Court === null ? null : CourtGroupsForMatch(Connection, Ended.Court);
    if (!Found && Connection.GotNext) Found = CourtGroupsForMatch(Connection, Connection.GotNext.Court);
    if (!Found) {
        Log.Error(
            `Acknowledged an end-game request from ${Connection.Identifier}, but its court could not be resolved`,
        );
        return true;
    }
    const Game = require('./CourtData').GameTeams(Connection.ActivityName, Found.Raw.Name, PlayerBody.GenerationForConnection(Connection));
    if (!Game) {
        Log.Verbose(
            `  duplicate end-game request for ${Found.Raw.Name} from ${Connection.Identifier}; ` +
                `the court generation is already complete`,
        );
        return true;
    }
    const Home = Game.Home.map(String),
        Away = Game.Away.map(String),
        Id = String(Connection.Puid);
    const Side = Home.includes(Id) ? 0 : Away.includes(Id) ? 1 : -1;
    if (Side < 0) {
        Log.Error(`Ignored ${Connection.Identifier}'s result for ${Found.Raw.Name}: not in the frozen game roster`);
        return true;
    }
    Game.Reports.set(Id, Ended.Result);
    if (Ended.Result === EndResult.Won) {
        FinishPublicGame(Connection, Found, Game, Side, `WIN ${Hex(Ended.Result)}`);
    } else if (Ended.Result === EndResult.LostOrDropped) {
        FinishPublicGame(Connection, Found, Game, Side ^ 1, `LOSS/DROP ${Hex(Ended.Result)}`);
    } else if (Ended.Result === EndResult.NoWinners) {
        FinishPublicGame(Connection, Found, Game, null, `DRAW ${Hex(Ended.Result)}`);
    } else {
        Log.Error(
            `Acknowledged unknown end-game result ${Ended.Result === null ? 'missing' : Hex(Ended.Result)} ` +
                `from ${Connection.Identifier}; court state was left unchanged`,
        );
    }
    return true;
}

function GrantPlaying(PlayerConn) {
    if (!PlayerConn.PlayerBody) return false;
    const At = FindState(PlayerConn.PlayerBody, State.GotNext);
    if (At < 0) return false;
    const Body = Buffer.from(PlayerConn.PlayerBody);
    Body.writeUInt32LE(State.Playing >>> 0, At);
    PlayerConn.PlayerBody = Body;
    require('./ParkCpu').CancelWait(PlayerConn);
    if (PlayerConn.GotNext) PlayerConn.GotNext.Playing = true;
    const Frame = PlayerObject.FrameFor(PlayerConn);
    if (!Frame) return false;
    let Sent = 0;
    if (PlayerConn.SendObject(Frame)) Sent++;
    for (const Peer of Roster.Peers(PlayerConn)) {
        if (Peer.SendObject(Frame)) Sent++;
    }
    return Sent > 0;
}

function MaybeStartMatch(Connection) {
    if (!Connection.GotNext || Connection.Puid === null) return false;
    const Found = CourtGroupsForMatch(Connection, Connection.GotNext.Court);
    if (!Found || Found.Groups.length !== 2) return false;
    if (require('./CourtData').GameTeams(Connection.ActivityName, Found.Raw.Name, PlayerBody.GenerationForConnection(Connection))) return false;
    if (require('./ParkCpu').TryStart(Connection, Found)) return true;

    const Teams = [];
    for (const G of Found.Groups) {
        const Needed = G.MatchSize ?? G.Anchors.length;
        const Occupants = Slots.SeatsOf(G.SlotObjectId);
        const Seats = (G.QueueFunction === 1 ? Occupants.filter((Id) => Id !== 0n) : Occupants).slice(0, Needed);
        if (Seats.length !== Needed || Seats.some((Id) => Id === 0n)) return false;
        Teams.push(Seats);
    }

    const [Home, Away] = Teams;
    if (Home.length !== Away.length || Home.length > 5) return false;
    const Ids = [...Home, ...Away];
    if (new Set(Ids.map(String)).size !== Ids.length) return false;
    const Members = Roster.InActivity(Connection.ActivityKey);
    const ByPuid = new Map(Members.filter((C) => C.Puid !== null).map((C) => [String(C.Puid), C]));
    const Players = Ids.map((Id) => ByPuid.get(String(Id)));
    if (
        Players.some(
            (P) =>
                !P ||
                P.Closed ||
                !P.PlayerBody ||
                !P.GotNext ||
                GroupFor(P, P.GotNext.Court)?.CourtName !== Found.Raw.Name ||
                FindState(P.PlayerBody, State.GotNext) < 0,
        )
    )
        return false;

    if (require('./CourtData').IsBitstreamWorld(Connection.ActivityName)) {
        const CourtData = require('./CourtData');
        const Userdata = require('./Userdata');
        const MatchRoster = Players.map((Player) => ({
            AccountId: Player.Puid,
            MachineId: Player.MachineId,
            TeamId: Player.TeamId || 0n,
            Gamertag: Player.Gamertag || '',
            Userdata: Userdata.Packaged(Player),
            Connection: Player,
        }));
        if (
            new Set(MatchRoster.map((Entry) => String(Entry.MachineId))).size !== MatchRoster.length ||
            MatchRoster.some((Entry) => Entry.MachineId == null || BigInt(Entry.MachineId) === 0n || !Entry.Userdata)
        ) {
            Log.Error(
                `${Connection.ActivityName} start withheld: lockstep roster has a duplicate machine or missing USERDATA`,
            );
            return false;
        }
        let Prepared;
        try {
            const Blobs = Players.map((Player) => {
                const Data = Player.Userdata && Userdata.Read(Player.Userdata);
                if (!Data || !Data.IsUserdata || Data.DeclaredLength !== Data.Blob.length)
                    throw new Error(`missing complete USERDATA for ${Player.Identifier}`);
                return Userdata.CourtProfile(Player, Data.Blob);
            });
            Prepared = CourtData.PrepareGameTeams(Connection.ActivityName, Found.Raw.Name, Home, Away, {
                Home: Blobs.slice(0, Home.length),
                Away: Blobs.slice(Home.length),
            }, PlayerBody.GenerationForConnection(Connection));
        } catch (Failure) {
            Log.Error(`${Connection.ActivityName} start withheld: ${Failure.message}`);
            return false;
        }
        const { Guid, Frame } = Prepared;

        let Sent = 0;
        for (const Player of Players) {
            if (!Player.SendObject(Frame)) {
                CourtData.ClearGameTeams(Connection.ActivityName, Found.Raw.Name, PlayerBody.GenerationForConnection(Connection));
                Log.Error(
                    `${Connection.ActivityName} start withheld: court teams could not reach ${Player.Identifier}`,
                );
                return false;
            }
            Sent++;
        }
        for (const Observer of Members) if (!Players.includes(Observer) && Observer.SendObject(Frame)) Sent++;
        Log.Info(
            `${Connection.ActivityName} court teams ${Guid.toString(16)}: home [${Home.map(String)}], ` +
                `away [${Away.map(String)}]; ${Players.length} court USERDATA blobs; ` +
                `sent to ${Sent} before PLAYING @ ${Log.Clock()}`,
        );
    }

    let Started = 0;
    for (const Player of Players) if (GrantPlaying(Player)) Started++;

    if (Started) {
        Log.Info(
            `${Connection.Identifier}'s court is full (${Started} seated) — ` +
                `granted PLAYING to start the game @ ${Log.Clock()}`,
        );
        if (Connection.ActivityName === 'stage') {
            Log.Verbose('  2K22 teams and gambling index supplied; awaiting client game-init/synchronization evidence');
        } else if (Connection.ActivityName === 'neighborhood') {
            Log.Verbose(`  ${PlayerBody.GenerationForConnection(Connection)} neighborhood teams, USERDATA and GAME relay supplied; awaiting all game connections`);
        }

        try {
            const Spectator = require('./Spectator');
            if (Spectator.Enabled) {
                const Game = require('./CourtData').GameTeams(Connection.ActivityName, Found.Raw.Name, PlayerBody.GenerationForConnection(Connection));
                if (Game) Spectator.Announce(Connection, Game, Players);
            }
        } catch (Failure) {
            Log.Error(`spectator announce skipped: ${Failure.message}`);
        }
    }
    return Started > 0;
}

function IsFrozenParticipant(Game, Puid) {
    if (!Game || Puid === null || Puid === undefined) return false;
    const Id = String(Puid);
    return Game.Home.some((Member) => String(Member) === Id) || Game.Away.some((Member) => String(Member) === Id);
}

function Vacate(Connection) {
    require('./ParkCpu').Stop(Connection, 'participant vacated court');
    if (Connection.Puid === null) return [];

    if (require('./CourtData').IsBitstreamWorld(Connection.ActivityName) && Connection.GotNext) {
        const Found = CourtGroupsForMatch(Connection, Connection.GotNext.Court);
        if (Found) {
            const Game = require('./CourtData').GameTeams(Connection.ActivityName, Found.Raw.Name, PlayerBody.GenerationForConnection(Connection));
            if (IsFrozenParticipant(Game, Connection.Puid))
                require('./CourtData').ClearGameTeams(Connection.ActivityName, Found.Raw.Name, PlayerBody.GenerationForConnection(Connection));
        }
    }

    const Freed = Slots.Release(Connection.Puid);
    for (const SlotId of Freed) require('./GymEquipment2K22').PublishSpot(Connection, SlotId);
    Connection.GotNext = null;
    NotifyQueueChanges(Connection, Freed);
    if (Freed.length) {
        try {
            const CourtData = require('./CourtData');
            const World = CourtTables.For(Connection.ActivityName, Connection);
            if (World) {
                const Done = new Set();
                for (const Raw of World.Courts) {
                    for (const Group of Courts.GroupsFor(Raw, World.Room, World.SeqBase)) {
                        if (!Freed.includes(Group.SlotObjectId)) continue;
                        AdvanceLine(Connection, Group);
                        if (
                            CourtData.IsBitstreamWorld(Connection.ActivityName) &&
                            (Connection.ActivityName !== 'neighborhood' ||
                                CourtData.ParkCourtFormat(Group.CourtName) !== 'legacy')
                        ) {
                            const Key = Group.CourtName;
                            if (Done.has(Key)) continue;
                            Done.add(Key);
                            CourtData.BroadcastCourtGroup(Connection, Group);
                        } else {
                            Publish(Connection, Group);
                        }
                    }
                }
            }
        } catch (_) {}
    }
    return Freed;
}

function Release(Connection) {
    require('./ParkCpu').Stop(Connection, 'participant released queue');
    if (!Connection.PlayerBody) {
        Vacate(Connection);
        return false;
    }

    let At = FindState(Connection.PlayerBody, State.GotNext);
    if (At < 0 && Connection.GotNext?.Playing) At = FindState(Connection.PlayerBody, State.Playing);
    if (At < 0) {
        Log.Verbose(`  ${Connection.Identifier} has no granted state to give back`);
        Vacate(Connection);
        return false;
    }

    const Body = Buffer.from(Connection.PlayerBody);
    Body.writeUInt32LE(State.None >>> 0, At);
    if (At + CourtIdOffset + 4 <= Body.length) Body.writeUInt32LE(0, At + CourtIdOffset);
    Connection.PlayerBody = Body;

    const Held = Connection.GotNext && CourtGroupsForMatch(Connection, Connection.GotNext.Court);
    if (Held && require('./CourtData').IsBitstreamWorld(Connection.ActivityName)) {
        const Game = require('./CourtData').GameTeams(Connection.ActivityName, Held.Raw.Name, PlayerBody.GenerationForConnection(Connection));
        if (IsFrozenParticipant(Game, Connection.Puid))
            require('./CourtData').ClearGameTeams(Connection.ActivityName, Held.Raw.Name, PlayerBody.GenerationForConnection(Connection));
    }
    const Freed = Slots.Release(Connection.Puid);
    for (const SlotId of Freed) require('./GymEquipment2K22').PublishSpot(Connection, SlotId);
    const World = CourtTables.For(Connection.ActivityName, Connection);
    if (World && Freed.length) {
        for (const Raw of World.Courts) {
            for (const Group of Courts.GroupsFor(Raw, World.Room, World.SeqBase)) {
                if (!Freed.includes(Group.SlotObjectId)) continue;
                AdvanceLine(Connection, Group);
                if (require('./CourtData').IsBitstreamWorld(Connection.ActivityName)) {
                    require('./CourtData').BroadcastCourtGroup(Connection, Group);
                } else {
                    Publish(Connection, Group);
                    Courts.Republish(Connection, Group.ObjectId);
                }
            }
        }
    }
    Connection.GotNext = null;
    NotifyQueueChanges(Connection, Freed);

    const Frame = PlayerObject.FrameFor(Connection);
    if (!Frame || !Connection.SendObject(Frame)) return false;
    for (const Peer of Roster.Peers(Connection)) {
        if (Peer.KnownPlayers?.has(Connection.Id)) Peer.SendObject(Frame);
    }

    Log.Verbose(
        `  put ${Hex(State.None)} back at body+${At} and cleared the court, revision ` +
            `${Connection.PlayerRevision} — the client waits on this before it will move on`,
    );
    return true;
}

function Reapply(Connection) {
    if (!Connection.GotNext || !Connection.PlayerBody) return false;

    if (Connection.GotNext.Playing) {
        const PlayingAt = FindState(Connection.PlayerBody, State.Playing);
        let At = PlayingAt;
        if (At < 0) At = FindState(Connection.PlayerBody, State.GotNext);
        if (At < 0) At = FindState(Connection.PlayerBody, State.None);
        if (At < 0) return false;
        const GymSpot = Connection.ActivityName === 'neighborhood' &&
            PlayerBody.GenerationForConnection(Connection) === '2K22'
            ? require('./GymSpots2K22').GroupFor(Connection.GotNext.Court)
            : null;
        if (GymSpot) {
            // Cached/client bodies may already say PLAYING with an old anchor key.
            const Patch = require('./PlayerBody').SetGameState(
                Connection.PlayerBody, State.Playing, GymSpot.CourtId,
            );
            if (!Patch.Ok || Patch.Body.equals(Connection.PlayerBody)) return false;
            Connection.PlayerBody = Patch.Body;
            return true;
        }
        if (PlayingAt >= 0) return false;
        const Body = Buffer.from(Connection.PlayerBody);
        Body.writeUInt32LE(State.Playing >>> 0, At);
        const GroupValue = GroupFor(Connection, Connection.GotNext.Court);
        if (GroupValue && At + CourtIdOffset + 4 <= Body.length)
            Body.writeUInt32LE(Courts.IdentityOf(GroupValue) >>> 0, At + CourtIdOffset);
        Connection.PlayerBody = Body;
        return true;
    }
    const Group = Connection.ActivityName === 'stage' || Connection.ActivityName === 'cages'
        ? QueueFor(Connection, Connection.GotNext.Court, Connection.GotNext.Slot)
        : GroupFor(Connection, Connection.GotNext.Court);
    const Location =
        process.env.OPAL_GOTNEXT_LOCATION === '0'
            ? null
            : Connection.GotNext.Location || SpotFor(Connection, Connection.GotNext.Court, Connection.GotNext.Slot);
    const Facing = Location ? QueueFacingUnits(Group, Location) : null;
    const StateAt = FindState(Connection.PlayerBody, State.GotNext);
    if (StateAt >= 0) {
        let Body = Buffer.from(Connection.PlayerBody);
        if (Group && StateAt + CourtIdOffset + 4 <= Body.length)
            Body.writeUInt32LE(Courts.IdentityOf(Group) >>> 0, StateAt + CourtIdOffset);
        if (Location) {
            const Placed = PlayerBody.SetGotNextDestination(Body, Location, Facing);
            if (!Placed.Ok) return false;
            Body = Placed.Body;
        }
        if (Body.equals(Connection.PlayerBody)) return false;
        Connection.PlayerBody = Body;
    } else {
        const Patch = Grant(
            Connection.PlayerBody,
            State.GotNext,
            Group ? Courts.IdentityOf(Group) : null,
            Location,
            Facing,
        );
        if (!Patch.Patched) return false;
        Connection.PlayerBody = Patch.Frame;
    }
    if (Location) Connection.GotNext.Location = Location;
    Log.Verbose(
        `  re-applied GOT_NEXT to ${Connection.Identifier}'s player body, which had come ` +
            `back from the body cache carrying ${Hex(State.None)}`,
    );
    return true;
}

function Warp(Connection) {
    if (!Connection.GotNext || Connection.GotNext.Playing || Connection.Puid === null) return false;

    const Spot = SpotFor(Connection, Connection.GotNext.Court, Connection.GotNext.Slot);
    if (!Spot) {
        Log.Error(
            `${Connection.Identifier} has next but the spot for that court and slot could ` +
                `not be found, so they will not be moved onto it.`,
        );
        return false;
    }

    const Group = QueueFor(Connection, Connection.GotNext.Court, Connection.GotNext.Slot);
    const Heading = Group?.Facing
        ? Math.max(0, Math.min(255, Math.round((QueueFacingUnits(Group, Spot) + 32768) / 255))) & 0xff
        : Position.FacingByteForSpot(Spot, Group ? Group.Pos : null);
    const Scale = WireScaleFor(Connection);
    const Frame = Position.BuildWarp(Connection.Puid, {
        X: Math.round(Spot[0] / Scale),
        Y: Math.round(Spot[1] / Scale),
        Z: Math.round(Spot[2] / Scale),
        Heading: Heading,
    });
    Position.Suppress(Connection);
    let Sent = 0;
    if (Connection.SendObject(Frame)) Sent++;
    try {
        for (const Peer of Roster.Peers(Connection)) {
            if (!Peer.KnownPlayers || !Peer.KnownPlayers.has(Connection.Id)) continue;
            if (Peer.SendObject(Frame)) Sent++;
        }
    } catch (_) {}
    if (!Sent) return false;

    Log.Verbose(
        `  and moved onto the spot at (${Spot.map((V) => Math.round(V)).join(', ')}) ` +
            `facing ${Heading} to ${Sent} recipient(s), stale relay suppressed ${Position.SuppressMs}ms`,
    );
    return true;
}

module.exports = {
    RequestPacket,
    Command,
    LeaveCommand,
    Field,
    CourtKeyOffset,
    CourtIdOffset,
    State,
    StateEndian,
    EndCommand,
    EndField,
    EndResult,
    Read,
    Handle,
    Grant,
    FindState,
    WireScaleFor,
    Deliver,
    Reapply,
    SpotFor,
    Warp,
    QueuesFor,
    QueueFor,
    Seat,
    Vacate,
    GroupFor,
    GroupForLoose,
    Release,
    MaybeStartMatch,
    GrantPlaying,
    HandleGameConnected,
    ReadGameEnd,
    HandleGameEnd,
    FinishPublicGame,
    WinnerPoint,
    LoserPoint,
    CourtLocalToWorld,
    HomeSideSign,
    PostGameLocations,
};
