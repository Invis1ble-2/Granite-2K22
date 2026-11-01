// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const ObjectFrame = require('../Codec/ObjectFrame');
const PlayerObject = require('./PlayerObject');

const Packet = 0xfef2dd68;

const KeyOffset = ObjectFrame.Layout.Player.Payload + ObjectFrame.Body.Key;
const VersionOffset = ObjectFrame.Layout.Player.Payload + ObjectFrame.Body.Version;

const VersionStep = 16n;

const MinIntervalMs = 250;

function Build(Bytes) {
    if (Bytes.length < VersionOffset + 8) return { Frame: Bytes, From: null, To: null, Key: null };
    const Frame = Buffer.from(Bytes);
    const Key = Frame.readBigUInt64BE(KeyOffset);
    const From = Frame.readBigUInt64BE(VersionOffset);
    const To = From + VersionStep;
    Frame.writeBigUInt64BE(To, VersionOffset);
    return { Frame: Frame, From: From, To: To, Key: Key };
}

function Mine(Connection, Key) {
    return Key !== null && Connection.Puid !== null && Key === Connection.Puid;
}

function Echo(Connection, Bytes) {
    if (!Connection.PlayerBody) return false;

    const { From, Key } = Build(Bytes);
    if (!Mine(Connection, Key)) return require('./ParkCpu').HandleUpdate(Connection, Bytes);

    // Native pending requests require both received-ACK and a newer object.
    // Echoing PLAYER alone leaves updates beyond the legacy 1..16 ACK range
    // pending until timeout, including updates sent when leaving a queue area.
    if (require('./PlayerBody').GenerationForConnection(Connection) === '2K22' &&
        Bytes.length >= 42 && Bytes.readUInt32BE(4) === Packet &&
        Bytes.readUInt32BE(32) === PlayerObject.PlayerClass &&
        Bytes.length >= 42 + Bytes.readUInt16BE(40)) {
        const RequestId = Bytes.readBigUInt64BE(16);
        if (RequestId !== 0n && !Connection.Closed)
            Connection.Send(require('./Requests').Build(RequestId));
    }

    if (From !== null && From >= Connection.PlayerRevision) Connection.PlayerRevision = From;

    const Now = Date.now();
    if (Connection.LastEchoMs && Now - Connection.LastEchoMs < MinIntervalMs) {
        if (!Connection.PendingEchoTimer) {
            const Timer = setTimeout(
                () => {
                    Connection.PendingEchoTimer = null;
                    if (Connection.Closed) return;
                    Reply(Connection, From, 'deferred ');
                },
                MinIntervalMs - (Now - Connection.LastEchoMs),
            );
            if (Timer.unref) Timer.unref();
            Connection.PendingEchoTimer = Timer;
        }
        Log.Verbose(
            `  player object reply to ${Connection.Identifier} deferred by the rate limit, ` +
                `${Now - Connection.LastEchoMs}ms since the last one`,
        );
        return false;
    }
    return Reply(Connection, From, '');
}

function CompletePendingPlayer(Connection, Bytes) {
    if (Connection.Closed || !Connection.PlayerBody ||
        require('./PlayerBody').GenerationForConnection(Connection) !== '2K22') return false;
    if (!Buffer.isBuffer(Bytes) || Bytes.length < ObjectFrame.Layout.Player.Payload ||
        Bytes.readUInt32BE(4) !== Packet) return false;

    const Update = ObjectFrame.Parse(Bytes);
    if (!Update || Update.Layout !== ObjectFrame.Layout.Player ||
        Update.Class !== PlayerObject.PlayerClass || !Mine(Connection, Update.ObjectId) ||
        !Mine(Connection, Update.Key) || !require('./PlayerBody').Decode(Update.Payload).Ok) return false;
    const RequestId = Bytes.readBigUInt64BE(ObjectFrame.Layout.Player.Sequence);
    if (RequestId === 0n) return false;
    const Revision = (Update.Version > Connection.PlayerRevision ? Update.Version : Connection.PlayerRevision) + 1n;
    if (Revision > 0xffffffffffffffffn) return false;

    // The destination may already be live. Finish only this old socket's pending
    // request, without FrameFor's shared-cache writes or merging late fields.
    const BodyData = Buffer.from(Connection.PlayerBody);
    BodyData.writeBigUInt64BE(Revision, ObjectFrame.Body.Version);
    const Frame = ObjectFrame.Build({
        PacketId: PlayerObject.ObjectDataPacket,
        ConnectionId: null,
        ObjectId: Connection.Puid,
        ClassCrc: PlayerObject.PlayerClass,
        Payload: BodyData,
        Layout: ObjectFrame.Layout.Nineteen,
    });
    CancelPending(Connection);
    if (!Connection.Send(require('./Requests').Build(RequestId))) return false;
    if (!Connection.SendObject(Frame)) {
        Log.Error(`pending PLAYER reply to ${Connection.Identifier} could not be written.`);
        return false;
    }
    Connection.PlayerRevision = Revision;
    Connection.LastEchoMs = Date.now();
    Log.Verbose(
        `  completed pending PLAYER request ${RequestId} for ${Connection.Identifier} ` +
            `at revision ${Revision} (old connection only)`,
    );
    return true;
}

function CancelPending(Connection) {
    if (Connection && Connection.PendingEchoTimer) {
        clearTimeout(Connection.PendingEchoTimer);
        Connection.PendingEchoTimer = null;
    }
}

function Reply(Connection, From, Kind) {
    CancelPending(Connection);
    Connection.LastEchoMs = Date.now();

    const Frame = PlayerObject.FrameFor(Connection);
    if (!Frame || !Connection.SendObject(Frame)) {
        Log.Error(`player object reply to ${Connection.Identifier} could not be written.`);
        return false;
    }

    Log.Verbose(
        `  ${Kind}answered ${Connection.Identifier}'s object update ` +
            `(version ${From === null ? '?' : From}) with their player object at revision ` +
            `${Connection.PlayerRevision}, which is what resolves the pending request`,
    );
    return true;
}

module.exports = {
    Packet,
    KeyOffset,
    VersionOffset,
    VersionStep,
    MinIntervalMs,
    Mine,
    Build,
    Echo,
    CompletePendingPlayer,
    CompleteClosedRoomPlayer: CompletePendingPlayer,
    CancelPending,
};
