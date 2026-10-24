// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../../Codec/FieldList');
const { Crc32 } = require('../../../Core/Crc32');
const { CareerKey, ProfileKeys } = require('../Attributes/Constants');

const EndpointIds = Object.freeze([0xe857eb5b]);
const Status = 'MYCAREER_ONLINE_REMOTE_DELETE_REQUEST';
function Build(Input, Context = {}) {
    const Key = CareerKey(Context);
    if (Key) {
        Context.PlayerCards?.Forget(Context);
        if (Context.Careers instanceof Map) {
            Context.Careers.delete(Key);
            if (typeof Context.SaveCareers === 'function') Context.SaveCareers();
        }
        if (Context.AttributeProfiles instanceof Map) {
            for (const ProfileKey of ProfileKeys(Context, false)) Context.AttributeProfiles.delete(ProfileKey);
            if (typeof Context.SaveAttributeProfiles === 'function') Context.SaveAttributeProfiles();
        }
        if (Context.CareerOveralls instanceof Map) {
            Context.CareerOveralls.delete(Key);
            if (typeof Context.SaveCareerOveralls === 'function') Context.SaveCareerOveralls();
        }
        if (Context.CareerGrind instanceof Map) {
            Context.CareerGrind.delete(Key);
            if (typeof Context.SaveCareerGrind === 'function') Context.SaveCareerGrind();
        }
    }
    return new Builder().AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = { Build, Delete: Build, EndpointIds, Feature: Status, Status };
