// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetU64 } = require('../../../Codec/FieldList');
const { Crc32 } = require('../../../Core/Crc32');
const Logger = require('../../../Core/Logger');

const EndpointIds = Object.freeze([0xa40c9996]);

const FieldCrcs = Object.freeze({
    Result: Crc32('RESULT'),
    Success: Crc32('SUCCESS'),
    UserId: Crc32('USER_ID'),
    SeasonLevel: Crc32('SEASON_LEVEL'),
    OnboardingState: 0x54636562,
    Nickname: Crc32('NICKNAME'),
    TeamCity: Crc32('TEAM_CITY'),
    TeamAbbreviation: Crc32('TEAM_ABBREVIATION'),
});

const Defaults = Object.freeze({
    OnboardingCompletedState: 5n,
    SeasonLevel: 1n,
    TeamCity: 'Los Angeles',
    Nickname: 'Granite',
    TeamAbbreviation: 'GRN',
});

const Routes = Object.freeze(['myteam2k19/get_user', 'myteam/get_user']);

function Resolve(Route) {
    return Routes.includes(Route);
}

/**
 * Builds the minimal MyTEAM user profile response with intro onboarding already completed
 * so the 2K22 client proceeds directly into the hub flow using local myteam_roster.iff.
 */
function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const UserId = GetU64(Fields, FieldCrcs.UserId) ?? Context.userId ?? 1n;
    Logger.Verbose(`MyTeam2k19/get_user: returning completed onboarding state for user ${UserId}`);
    return new Builder()
        .AddU32(FieldCrcs.Result, FieldCrcs.Success)
        .AddU64(FieldCrcs.UserId, UserId)
        .AddU64(FieldCrcs.OnboardingState, Defaults.OnboardingCompletedState)
        .AddU64(FieldCrcs.SeasonLevel, Defaults.SeasonLevel)
        .AddString8(FieldCrcs.TeamCity, Defaults.TeamCity)
        .AddString8(FieldCrcs.Nickname, Defaults.Nickname)
        .AddString8(FieldCrcs.TeamAbbreviation, Defaults.TeamAbbreviation)
        .Build();
}

module.exports = {
    Build,
    GetUser: Build,
    Resolve,
    EndpointIds,
    FieldCrcs,
    Defaults,
    Routes,
};
