// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const { SessionOptions, SessionPlayer } = require('./GameSessionAuth');
const Log = require('../Core/Log');
const Wire = require('../Protocol/ParkCpuWire');
const Endpoint = '/native-cpu/v7/poll', SoloReportLimit = 8192;

function CreateHandler() {
    let Options = null;
    try { Options = SessionOptions(); }
    catch (_) { Log.Error('ParkCpu control unavailable: existing Granite session configuration could not be read'); }
    if (Options) Log.Info('ParkCpu v7 uses existing Granite login sessions; CPU generation and ratings are server-authored');
    const Peers = new Map();
    return function Handle(Req, Res) {
        if (Req.url !== Endpoint) return false;
        let Done = false, Peer = null, OwnsPeer = false;
        const Release = () => { if (OwnsPeer) { Peer.Busy = false; OwnsPeer = false; } };
        const Reply = (Status, Body = null) => {
            if (Done) return;
            Done = true;
            Release();
            Res.writeHead(Status, {
                'Content-Type': 'application/octet-stream', 'Content-Length': Body?.length || 0,
                'Cache-Control': 'no-store', 'Connection': 'close',
            });
            Res.end(Body);
        };
        Res.on('close', Release);
        if (!Options) { Reply(503); return true; }
        if (Req.method !== 'POST' || !Req.socket.encrypted) { Reply(405); return true; }
        const LengthText = Req.headers['content-length'];
        const Expected = typeof LengthText === 'string' && /^[1-9][0-9]{0,4}$/.test(LengthText) ? Number(LengthText) : 0;
        if (Expected <= Wire.ReportBytes || Expected > Wire.ReportBytes + SoloReportLimit ||
            Req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/octet-stream') {
            Reply(400); return true;
        }
        let Puid;
        try { Puid = SessionPlayer(Options, Req.headers['x-granite-session']); }
        catch (_) { Reply(503); return true; }
        if (!Puid) { Reply(401); return true; }
        const Now = Date.now(), Id = String(Puid);
        for (const [Key, P] of Peers) if (!P.Busy && Now - P.LastAt > 60000) Peers.delete(Key);
        Peer = Peers.get(Id);
        if (!Peer) {
            if (Peers.size >= 256) { Reply(429); return true; }
            Peer = { Busy: false, LastAt: 0 }; Peers.set(Id, Peer);
        }
        if (Peer.Busy || Now - Peer.LastAt < 100) { Reply(429); return true; }
        Peer.Busy = true; Peer.LastAt = Now; OwnsPeer = true;
        Req.setTimeout(5000, () => { Reply(408); Req.destroy(); });
        const Parts = []; let Length = 0;
        Req.on('data', Chunk => {
            if (Done) return;
            Length += Chunk.length;
            if (Length > Expected) { Reply(413); return; }
            Parts.push(Chunk);
        });
        Req.on('error', Release);
        Req.on('aborted', Release);
        Req.on('end', () => {
            if (Done) return;
            try {
                if (Length !== Expected) throw new Error('incomplete native report');
                const Bytes = Buffer.concat(Parts);
                const ParkCpu = require('../Protocol/ParkCpu');
                const Body = ParkCpu.OnControlReport(Puid, Wire.ReadReport(Bytes.subarray(0, Wire.ReportBytes)),
                    JSON.parse(Bytes.toString('utf8', Wire.ReportBytes)));
                Reply(Body ? 200 : 204, Body);
            } catch (Failure) { Reply(Failure.Status === 409 ? 409 : 400); }
        });
        return true;
    };
}
module.exports = { CreateHandler, SessionOptions, SessionPlayer };
