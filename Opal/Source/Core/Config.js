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

module.exports = { Read, NativePark };
