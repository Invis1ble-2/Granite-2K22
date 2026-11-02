'use strict';

const Settings = require('../../../Shared/Config');

function Read() {
    try { return Settings.Read(); }
    catch (_) { return {}; }
}

function ParkCpu() {
    const Config = Read().ParkCpu;
    return Config && typeof Config === 'object' && !Array.isArray(Config) && Config.Enabled === true ? Config : null;
}

module.exports = { ...Settings, Read, ParkCpu };
