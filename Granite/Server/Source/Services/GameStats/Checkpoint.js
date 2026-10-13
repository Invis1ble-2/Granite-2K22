// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';
const { Builder, GetU32, GetU64 } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { CareerKey } = require('../MyCareer/Attributes/Constants');

const Fields = Object.freeze({ Quest: 0xb4433aa7, Operation: 0x4009c831, Instance: 0x770c77d6 });
const Operations = Object.freeze({ Start: 0x682d973f, Complete: 0x33492a41, Cancel: 0x69bc56ca });
function Build(Input, Context = {}) {
    const Values = Input?.Parsed?.Fields || [];
    const Quest = GetU32(Values, Fields.Quest);
    const Operation = GetU32(Values, Fields.Operation);
    const Reply = new Builder().AddU32(Crc32('RESULT'), Crc32('SUCCESS'));
    // FUN_1403FAD20 exits without advancing the quest state if QUEST_CRC is
    // missing/mismatched; START also requires a nonzero QUEST_INSTANCE_ID.
    if (Quest) {
        // Request CRCs are StringCrc, but FUN_1403FAD20 reads the response
        // through strict VCFIELDLIST_READ_ONLY::GetU64 (FUN_141E6C600).
        Reply.AddU64(Fields.Quest, BigInt(Quest));
        let Instance = GetU64(Values, Fields.Instance);
        if (Operation === Operations.Start || Operation === Operations.Complete) {
            // Stable across process restarts and isolated by authenticated save.
            if (!Instance) Instance = BigInt((Crc32(`${CareerKey(Context)}:quest:${Quest}`) & 0x7fffffff) || 1);
            Reply.AddU64(Fields.Instance, Instance);
        }
    }
    return Reply.Build();
}
module.exports = { Build, Checkpoint: Build, Fields, Operations, Status: 'CHECKPOINT_ACKNOWLEDGEMENT' };
