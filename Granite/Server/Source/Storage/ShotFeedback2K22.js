// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Crc32 } = require('../Core/Crc32');

// NBA2K22 unpacked: 1409A2EF0 / 14251B1F0 maps indicator IDs;
// 1409A2B10 maps release animation IDs. Both consume native ownership JSON.
// Keep only real manifest entries: higher enum values are placeholders.
const Categories = Object.freeze({
    'CATEGORY:PLAYER_INDICATOR': Object.freeze(Array.from({ length: 50 }, (_, Index) =>
        Crc32(`GLOBALDATA_PLAYER_INDICATOR_TYPE_${Index + 1}`))),
    'CATEGORY:GREEN_RELEASE_ANIMATION': Object.freeze(Array.from({ length: 15 }, (_, Index) =>
        Crc32(`GLOBALDATA_SHOT_METER_PERFECT_${Index + 1}`))),
});

// The default circle, six colors and 35 sounds plus "none" are native choices.
const ItemIds = Object.freeze(Object.values(Categories).flat());

module.exports = { Categories, ItemIds };
