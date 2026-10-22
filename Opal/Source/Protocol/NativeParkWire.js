// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

// Fixed little-endian wire contract shared with Module/NativeParkControl.h.
// Seats 0..2 are Home, 3..5 are Away; seats 2 and 5 are zero in 2v2.
const Version = 4, ModuleVersion = 0x00010217, ManifestBytes = 184, ReportBytes = 120;
const ManifestMagic = 0x3232504d, ReportMagic = 0x3452504d;
const LeaseMs = 8000, HeartbeatMs = 10000, MaxTemplates = 72, RelayId = 0x0a;
const Flag = Object.freeze({ Installed: 1, Armed: 2, Started: 4 });
const Phase = Object.freeze({ arming: 1, preloading: 2, starting: 3, playing: 4 });
const CpuMask = 0xfffff00000000000n, CpuPrefix = 0x0222c00000000000n;
const IsCpu = Id => typeof Id === 'bigint' && (Id & CpuMask) === CpuPrefix;
const ErrorNames = Object.freeze([
    null, 'invalid native manifest', 'template pool changed', 'CPU descriptor validation failed',
    'native CPU roster missing', 'native start validation failed', 'native playing validation failed',
    'native initialization failed', 'native template pool unavailable', 'enhanced CPU ability or body validation failed',
    'native online session descriptor or authorization invalid', 'native online session creation failed',
]);

function ReadReport(Bytes) {
    if (!Buffer.isBuffer(Bytes) || Bytes.length !== ReportBytes || Bytes.readUInt32LE(0) !== ReportMagic ||
        Bytes.readUInt32LE(4) !== Version || Bytes.readUInt32LE(8) !== ModuleVersion || Bytes.readUInt32LE(52))
        throw new Error('unsupported native park report');
    const R = {
        Flags: Bytes.readUInt32LE(12), Instance: Bytes.readBigUInt64LE(16),
        Epoch: Bytes.readBigUInt64LE(24), Match: Bytes.readBigUInt64LE(32),
        PoolCount: Bytes.readUInt32LE(40), Created: Bytes.readUInt32LE(44), Error: Bytes.readUInt32LE(48),
        Digest: Buffer.from(Bytes.subarray(56, 88)),
        ProfileDigest: Buffer.from(Bytes.subarray(88, 120)),
    };
    if (!R.Instance || (R.Flags & ~7) || (R.Created & ~63) || R.Error >= ErrorNames.length ||
        R.PoolCount > MaxTemplates || ((R.Flags & Flag.Installed) && !R.PoolCount))
        throw new Error('invalid native park report');
    return R;
}

function BuildManifest(P, Client) {
    if (!Phase[P.Phase] || !Client.Epoch || !P.MatchId || ![2, 3].includes(P.TeamSize) ||
        !Buffer.isBuffer(P.Digest) || P.Digest.length !== 32 || P.PoolCount < 1 || P.PoolCount > MaxTemplates)
        throw new Error('invalid native park manifest');
    const B = Buffer.alloc(ManifestBytes);
    B.writeUInt32LE(ManifestMagic, 0); B.writeUInt32LE(Version, 4);
    B.writeBigUInt64LE(Client.Epoch, 8); B.writeBigUInt64LE(P.MatchId, 16);
    B.writeUInt32LE(LeaseMs, 24); B.writeUInt32LE(Phase[P.Phase], 28);
    B.writeBigUInt64LE(Client.Connection.Puid, 32);
    B.writeUInt32LE(P.TeamSize, 40); B.writeUInt32LE(P.HumanMask, 44); B.writeUInt32LE(P.PoolCount, 48);
    P.Digest.copy(B, 56);
    for (let I = 0; I < 6; I++) {
        B.writeBigUInt64LE(P.Players[I], 88 + I * 8);
        B.writeUInt32LE(P.Seeds[I], 136 + I * 4);
        B.writeUInt32LE(P.Templates[I], 160 + I * 4);
    }
    return B;
}

function HasPool(Client) {
    const R = Client?.Report;
    return Boolean(R && (R.Flags & Flag.Installed) && !R.Error && R.PoolCount &&
        Date.now() - Client.SeenAt <= HeartbeatMs);
}

function Matches(R, P, Client) {
    return Boolean(R && R.Epoch === Client.Epoch && R.Match === P.MatchId &&
        R.PoolCount === P.PoolCount && R.Digest.equals(P.Digest));
}

module.exports = {
    Version, ModuleVersion, ManifestBytes, ReportBytes, ManifestMagic, ReportMagic,
    LeaseMs, HeartbeatMs, MaxTemplates, RelayId, Flag, Phase, IsCpu, ErrorNames,
    ReadReport, BuildManifest, HasPool, Matches,
};
