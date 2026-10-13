'use strict';
const { Builder } = require('../../../Codec/FieldList');
const { Crc32 } = require('../../../Core/Crc32');
const State = require('./State');

function Build(Input, Context = {}) {
    const Reply = new Builder();
    try {
        if (!State.Apply(Input, Context, true))
            return Reply.AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
        State.Append(Reply, Context);
        return Reply.AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
    } catch (Error) {
        require('../../../Core/Logger').Error(`badge update: ${Error.message}`);
        return Reply.AddU32(Crc32('RESULT'), Crc32('FAILURE')).Build();
    }
}
module.exports = { Build };
