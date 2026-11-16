// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const JsonBlob = require('../JsonBlob');
const Logger = require('../../../Core/Logger');

const EndpointIds = Object.freeze([0x6751771a]);

const LineupListMember = 'lineups';

const Document = Object.freeze({
    [LineupListMember]: Object.freeze([
        Object.freeze({
            lineup_id: 1,
            lineup_name: 'Lineup 1',
        }),
    ]),
});

const Routes = Object.freeze(['myteam2k19/get_user_lineups', 'myteam/get_user_lineups']);

function Resolve(Route) {
    return Routes.includes(Route);
}

/**
 * Returns at least one starter lineup record so 2K22's FUN_141776120 passes its
 * minimum lineup count check (>= 1 when onboarding state == 5) without aborting MyTEAM.
 */
function Build() {
    Logger.Verbose('MyTeam2k19/get_user_lineups: answering minimal default lineup entry');
    return JsonBlob.Reply(Document);
}

module.exports = {
    Build,
    GetUserLineups: Build,
    Resolve,
    EndpointIds,
    LineupListMember,
    Document,
    Routes,
};
