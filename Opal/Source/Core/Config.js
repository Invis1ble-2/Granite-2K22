'use strict';

const Fs = require('node:fs');
const Path = require('node:path');
const ConfigPath = Path.resolve(__dirname, '../..', 'Config.json');

function Read() {
    try {
        const Config = JSON.parse(Fs.readFileSync(ConfigPath, 'utf8'));
        return Config && typeof Config === 'object' && !Array.isArray(Config) ? Config : {};
    }
    catch (_) { return {}; }
}
function NativePark() {
    const Config = Read().NativePark;
    return Config && typeof Config === 'object' && !Array.isArray(Config) && Config.Enabled === true ? Config : null;
}

// Timing is an Opal process-lifetime snapshot: restart Opal to publish a new
// selection. Clients negotiate it before the next match; Granite login values are bootstrap only.
let FrameRateValue;
function FrameRate() {
    if (FrameRateValue !== undefined) return FrameRateValue;
    let Config;
    try { Config = JSON.parse(Fs.readFileSync(ConfigPath, 'utf8')); }
    catch (Failure) {
        if (Failure.code !== 'ENOENT') throw new Error(`Cannot read park frame rate: ${Failure.message}`);
        Config = {};
    }
    if (!Config || typeof Config !== 'object' || Array.isArray(Config))
        throw new Error('Opal/Config.json must be an object');
    const Value = Config.NativePark?.FrameRate ?? 120;
    if (Value !== 60 && Value !== 120)
        throw new Error('Opal/Config.json NativePark.FrameRate must be 60 or 120');
    FrameRateValue = Value;
    return Value;
}

module.exports = { Read, NativePark, FrameRate };
