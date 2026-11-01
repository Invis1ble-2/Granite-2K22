// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Fs = require('node:fs');
const Path = require('node:path');

function SessionOptions() {
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
    try { Session = JSON.parse(Fs.readFileSync(Path.join(Options.Directory, Key + '.json'), 'utf8')); }
    catch (Failure) {
        if (Failure.code === 'ENOENT') return null;
        // Granite can be updating this file; let the caller retry a transient read failure.
        throw Failure;
    }
    if (!Session || Session.key !== Key || (Options.RequireVerified && Session.verified !== true) ||
        typeof Session.userId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(Session.userId)) return null;
    const Puid = BigInt(Session.userId);
    return Puid <= 0xffffffffffffffffn && (Puid & 0xfffff00000000000n) !== 0x0222c00000000000n ? Puid : null;
}
module.exports = { SessionOptions, SessionPlayer };
