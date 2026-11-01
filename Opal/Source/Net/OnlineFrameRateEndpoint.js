// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Crypto = require('node:crypto');
const Log = require('../Core/Log');
const Roster = require('../Protocol/Roster');
const { SessionOptions, SessionPlayer } = require('./GameSessionAuth');
const Endpoint = '/native-fps/v1/poll';

function CreateHandler() {
    const Timing = require('./VconlineRelay').TimingOptions();
    const Epoch = (Crypto.randomBytes(8).readBigUInt64LE() || 1n).toString(16);
    let Options = null;
    try { Options = SessionOptions(); }
    catch (_) { Log.Error('Online frame rate control unavailable: Granite session configuration could not be read'); }
    return function Handle(Req, Res) {
        if (Req.url !== Endpoint) return false;
        const Reply = (Status, Scene = null) => {
            const Headers = { 'Content-Length': 0, 'Cache-Control': 'no-store', 'Connection': 'close' };
            if (Scene !== null) Object.assign(Headers, {
                'X-Opal-Frame-Rate': String(Timing.LockstepHz),
                'X-Opal-Buffer-Frames': String(Timing.LockstepDelayFrames),
                'X-Opal-Timing-Epoch': Epoch,
                'X-Opal-Timing-Scene': Scene,
            });
            Res.writeHead(Status, Headers); Res.end();
        };
        if (!Options) { Reply(503); return true; }
        if (Req.method !== 'POST' || !Req.socket.encrypted) { Reply(405); return true; }
        if (Req.headers['content-length'] !== '0' || Req.headers['transfer-encoding']) { Reply(400); return true; }
        let Puid;
        try { Puid = SessionPlayer(Options, Req.headers['x-granite-session']); }
        catch (_) { Reply(503); return true; }
        if (!Puid) { Reply(401); return true; }
        // HTTP login alone never publishes timing. Opal's active world connection is authoritative.
        const Peers = Roster.Active().filter(C => C.Puid === Puid &&
            ['neighborhood', 'stage', 'cages', 'mycourt'].includes(C.ActivityName) &&
            require('../Protocol/PlayerBody').GenerationForConnection(C) === '2K22');
        if (Peers.length !== 1) { Reply(204); return true; }
        const C = Peers[0];
        const Scene = `${C.Id.toString(16)}:${C.ActivityKey}:${C.WorldKey}:${C.RoomScope || ''}`;
        const Confirmed = Req.headers['x-opal-frame-rate'] === String(Timing.LockstepHz) &&
            Req.headers['x-opal-buffer-frames'] === String(Timing.LockstepDelayFrames) &&
            Req.headers['x-opal-timing-epoch'] === Epoch && Req.headers['x-opal-timing-scene'] === Scene;
        Reply(Confirmed ? 200 : 428, Scene);
        return true;
    };
}
module.exports = { CreateHandler };
