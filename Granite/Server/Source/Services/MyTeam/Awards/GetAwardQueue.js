// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const JsonBlob = require('../JsonBlob');
const Logger = require('../../../Core/Logger');

const EndpointIds = Object.freeze([0x65db5f19]);

const Document = Object.freeze({});

const Routes = Object.freeze(['myteam2k19/get_award_queue', 'myteam/get_award_queue']);

function Resolve(Route) {
    return Routes.includes(Route);
}

/**
 * Answers MyTeam2k19/get_award_queue with a compressed empty JSON blob so JSON_LIST
 * parsing succeeds instead of failing with 0xad91595 and aborting MyTEAM entry.
 */
function Build() {
    Logger.Verbose('MyTeam2k19/get_award_queue: answering empty award queue JSON blob');
    return JsonBlob.Reply(Document);
}

module.exports = {
    Build,
    GetAwardQueue: Build,
    Resolve,
    EndpointIds,
    Document,
    Routes,
};
