// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Fs = require('node:fs');
const Net = require('node:net');
const Path = require('node:path');
const File = Path.resolve(__dirname, '../Config.json');
// Keep existing relative storage paths anchored to Granite's data directory.
const GraniteRoot = Path.resolve(__dirname, '../Granite/Server');

function Read(ConfigFile = File) {
    const Config = JSON.parse(Fs.readFileSync(ConfigFile, 'utf8'));
    if (!Config || typeof Config !== 'object' || Array.isArray(Config))
        throw new Error(`${ConfigFile} must be an object`);
    return Config;
}

// Network and timing changes apply after both services restart; ParkCpu can reread the file.
const Startup = Read();

function Network(Config = Startup, Env = process.env) {
    const Value = {
        Host: Env.GRANITE_HOST || Config.Host || '0.0.0.0',
        PublicHost: Config.PublicHost || '127.0.0.1',
        Port: Number(Env.GRANITE_PORT || Config.Port || 21000),
        WorldPort: Number(Env.OPAL_PORT || Config.WorldPort || 20054),
        RelayPort: Number(Env.OPAL_RELAY_PORT || Config.RelayPort || 28091),
        RelayBind: Env.OPAL_RELAY_BIND || Config.RelayBind || '0.0.0.0',
    };
    if (!Net.isIPv4(Value.PublicHost) || Value.PublicHost === '0.0.0.0' || Value.PublicHost === '255.255.255.255')
        throw new Error('Config.json PublicHost must be a reachable IPv4 address');
    for (const Key of ['Port', 'WorldPort', 'RelayPort']) {
        if (!Number.isInteger(Value[Key]) || Value[Key] < 1 || Value[Key] > 65535)
            throw new Error(`Config.json ${Key} must be 1..65535`);
    }
    return Value;
}

function FrameRate() {
    const Value = Startup.OnlineFrameRate?.FrameRate ?? Startup.ParkCpu?.FrameRate ?? 120;
    if (Value !== 60 && Value !== 120)
        throw new Error('Config.json OnlineFrameRate.FrameRate must be 60 or 120');
    return Value;
}

function LockstepBufferFrames(Env = process.env) {
    const Frames = Number(Env.GRANITE_LOCKSTEP_BUFFER_FRAMES ?? Env.OPAL_LOCKSTEP_DELAY_FRAMES ??
        Startup.LockstepBufferFrames ?? 6);
    if (!Number.isInteger(Frames) || Frames < 1 || Frames > 49)
        throw new Error('Config.json LockstepBufferFrames / lockstep environment overrides must be 1..49');
    if (Env.GRANITE_LOCKSTEP_BUFFER_FRAMES !== undefined && Env.OPAL_LOCKSTEP_DELAY_FRAMES !== undefined &&
        Number(Env.GRANITE_LOCKSTEP_BUFFER_FRAMES) !== Number(Env.OPAL_LOCKSTEP_DELAY_FRAMES))
        throw new Error('Granite and Opal lockstep buffer frame counts must match');
    return Frames;
}

module.exports = { File, GraniteRoot, Read, Network, FrameRate, LockstepBufferFrames };
