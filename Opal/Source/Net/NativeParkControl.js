// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Fs = require('node:fs');
const Path = require('node:path');
const Log = require('../Core/Log');
const Wire = require('../Protocol/NativeParkWire');
const Endpoint = '/native-park/v4/poll';
const SoloEndpoint = '/native-solo/v3/poll', SoloReportLimit = 8192;

function SessionOptions() {
    // Same installation/configuration as Granite; there is no park credential file.
    const Root = Path.resolve(__dirname, '../../../Granite/Server');
    const Config = JSON.parse(Fs.readFileSync(Path.join(Root, 'Config.json'), 'utf8'));
    return {
        Directory: Path.resolve(Root, process.env.GRANITE_SESSION_DIR || Config.SessionDirectory || 'Storage/Sessions'),
        RequireVerified: Config.RequireVerifiedIdentity === true || process.env.CELESTIAL_REQUIRE_VERIFIED_IDENTITY === '1',
    };
}
function SessionPlayer(Options, Key) {
    if (typeof Key !== 'string' || !/^[1-9][0-9]{0,18}$/.test(Key) || BigInt(Key) > 0x7fffffffffffffffn) return null;
    let Session;
    try {
        Session = JSON.parse(Fs.readFileSync(Path.join(Options.Directory, Key + '.json'), 'utf8'));
    } catch (Failure) {
        if (Failure.code === 'ENOENT') return null;
        // Granite can be updating this file. A transient read failure must not
        // revoke a healthy match; the ordinary lease still bounds any outage.
        throw Failure;
    }
    if (!Session || Session.key !== Key || (Options.RequireVerified && Session.verified !== true) ||
        typeof Session.userId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(Session.userId)) return null;
    const Puid = BigInt(Session.userId);
    return Puid <= 0xffffffffffffffffn && !Wire.IsCpu(Puid) ? Puid : null;
}
function CreateHandler() {
    let Options = null;
    try { Options = SessionOptions(); }
    catch (_) { Log.Error('Native park control unavailable: existing Granite session configuration could not be read'); }
    if (Options) Log.Info('Native park v4 uses existing Granite login sessions; enhanced CPU profiles require no separate configuration');
    const Peers = new Map();
    return function Handle(Req, Res) {
        const Solo = Req.url === SoloEndpoint;
        if (Req.url !== Endpoint && !Solo) return false;
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
        if ((!Solo && Expected !== Wire.ReportBytes) || (Solo && (!Expected || Expected > SoloReportLimit)) ||
            Req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== (Solo ? 'application/json' : 'application/octet-stream')) {
            Reply(400); return true;
        }
        let Puid;
        try { Puid = SessionPlayer(Options, Req.headers['x-granite-session']); }
        catch (_) { Reply(503); return true; }
        if (!Puid) { Reply(401); return true; }
        const Now = Date.now(), Id = `${Solo ? 'solo' : 'park'}:${Puid}`;
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
                const Body = Solo ? require('../Protocol/NativeSoloPark').OnReport(Puid, JSON.parse(Bytes.toString('utf8'))) :
                    require('../Protocol/NativePark').OnReport(Puid, Wire.ReadReport(Bytes));
                Reply(Body ? 200 : 204, Body);
            } catch (Failure) { Reply(Failure.Status === 409 ? 409 : 400); }
        });
        return true;
    };
}
module.exports = { CreateHandler };
