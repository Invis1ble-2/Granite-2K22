// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Fs = require('node:fs');
const Path = require('node:path');

function IsObject(Value) {
    return Value !== null && typeof Value === 'object' && !Array.isArray(Value);
}

function Read(File) {
    return JSON.parse(Fs.readFileSync(File, 'utf8').replace(/^\uFEFF/, ''));
}

function Load(File, Empty) {
    try { return Read(File); }
    catch (Failure) {
        if (Failure.code !== 'ENOENT') throw Failure;
        return Empty;
    }
}

function Save(File, State) {
    if (!File) return;
    Fs.mkdirSync(Path.dirname(File), { recursive: true });
    const Temporary = `${File}.${process.pid}.tmp`;
    try {
        Fs.writeFileSync(Temporary, `${JSON.stringify(State, null, 2)}\n`, 'utf8');
        Fs.renameSync(Temporary, File);
    } finally {
        if (Fs.existsSync(Temporary)) Fs.unlinkSync(Temporary);
    }
}

function Files(Directory, Recursive = false) {
    if (!Directory || !Fs.existsSync(Directory)) return [];
    const Result = [];
    for (const Entry of Fs.readdirSync(Directory, { withFileTypes: true })) {
        const File = Path.join(Directory, Entry.name);
        if (Entry.isFile() && Entry.name.endsWith('.json')) Result.push(File);
        else if (Recursive && Entry.isDirectory()) Result.push(...Files(File, true));
    }
    return Result.sort();
}

module.exports = { IsObject, Read, Load, Save, Files };
