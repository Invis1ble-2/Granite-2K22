// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

function Build(Input) {
    const Fields = Input?.Parsed?.Fields || [];
    const BuilderInstance = new Builder()
        .AddU32(Crc32('RESULT'), Crc32('SUCCESS'))
        .AddU64(0x30dcc93c, 86400n); // 缓存有效期延长至 24 小时

    // 将客户端请求的所有公告 ID 标记为已确认/已阅读 (Dismissed)
    for (const Field of Fields) {
        if (Field.Crc === 0x1874526e && Field.value !== undefined) {
            BuilderInstance.AddU32(0x1874526e, Field.value);
            BuilderInstance.AddBool(0x38b34015, true); // IS_DISMISSED = true
        }
    }

    return BuilderInstance.Build();
}

module.exports = { Build, Message: Build, Status: 'AUTO_DISMISS_ALL_CONTENT_MESSAGES' };

