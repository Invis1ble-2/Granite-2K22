// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Relay = require('../Source/Net/VconlineRelay');

Test('traffic summaries bound console output without claiming client delivery', () => {
    const Summary = new Relay.TrafficSummary();
    Assert.equal(Summary.Take(), null);
    Summary.In = 1000;
    Summary.Attempted = 2000;
    Summary.Completed = 1999;
    Summary.Failed = 1;
    Assert.match(
        Summary.Take(),
        /1000 data datagrams in, 2000 sends attempted, 1999 OS send completions, 1 send errors/,
    );
    Assert.equal(Summary.Take(), null);
});
