// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Fs = require('node:fs');
const Path = require('node:path');
const Crypto = require('node:crypto');
const { TryParse, Types } = require('../Codec/FieldList');

const Format = 'store-blocks-v1';
const PayloadFields = new Set([0x603bd442, 0xa6b5b9f8]); // inventory, catalog
const HashPattern = /^[a-f0-9]{64}$/;
function Hash(Body) {
    return Crypto.createHash('sha256').update(Body).digest('hex');
}

function Split(Body, Declared) {
    const Parsed = TryParse(Body, { FieldListSize: Declared || undefined });
    if (!Parsed.Ok || Parsed.Parsed.Compressed) return [Body];
    const { Fields, DataOffset, WireSize } = Parsed.Parsed;
    const Ranges = Fields.filter(F => F.Type === Types.Binary && PayloadFields.has(F.Crc)).map(F => ({
        Start: DataOffset + F.Data1, End: DataOffset + F.Data1 + F.Data2,
    })).sort((A, B) => A.Start - B.Start);
    const Parts = [];
    let Offset = 0;
    for (const Range of Ranges) {
        if (Range.Start < Math.max(DataOffset, Offset) || Range.End > WireSize || Range.End < Range.Start)
            return [Body];
        if (Range.Start > Offset) Parts.push(Body.subarray(Offset, Range.Start));
        if (Range.End > Range.Start) Parts.push(Body.subarray(Range.Start, Range.End));
        Offset = Range.End;
    }
    if (Offset < Body.length) Parts.push(Body.subarray(Offset));
    return Parts;
}

function Save(Directory, Body, Declared) {
    const BlocksDirectory = Path.join(Directory, 'StoreResponses', 'Blocks');
    Fs.mkdirSync(BlocksDirectory, { recursive: true });
    let StoredNew = false;
    const Chunks = Split(Body, Declared).map(Part => {
        const Sha256 = Hash(Part);
        const File = Path.join(BlocksDirectory, `${Sha256}.bin`);
        try {
            Fs.writeFileSync(File, Part, { flag: 'wx' });
            StoredNew = true;
        } catch (Failure) {
            if (Failure.code !== 'EEXIST') throw Failure;
            if (!Fs.readFileSync(File).equals(Part)) throw new Error(`store capture snapshot mismatch: ${File}`);
        }
        return { Sha256, Bytes: Part.length };
    });
    return { Format, Sha256: Hash(Body), Bytes: Body.length, StoredNew, Chunks };
}

function Check(Body, Sha256, Bytes) {
    if (!HashPattern.test(Sha256) || Hash(Body) !== Sha256 ||
        (Bytes !== undefined && (!Number.isSafeInteger(Bytes) || Bytes < 0 || Bytes !== Body.length)))
        throw new Error('store capture snapshot integrity check failed');
    return Body;
}

// Sidecar path is the public entry point. Reads all three historical capture formats.
function ReadResponse(SidecarFile) {
    const Meta = JSON.parse(Fs.readFileSync(SidecarFile, 'utf8'));
    const Directory = Path.dirname(SidecarFile);
    const Snapshot = Meta.ResponseBody;
    let Body;
    if (!Snapshot) {
        if (!SidecarFile.endsWith('.response.json')) throw new Error('expected a .response.json capture');
        Body = Fs.readFileSync(SidecarFile.slice(0, -5) + '.bin');
    } else if (Snapshot.Format === Format) {
        if (!Array.isArray(Snapshot.Chunks)) throw new Error('invalid store capture chunks');
        const Parts = Snapshot.Chunks.map(Chunk => {
            if (!HashPattern.test(Chunk.Sha256) || !Number.isSafeInteger(Chunk.Bytes) || Chunk.Bytes < 0)
                throw new Error('invalid store capture chunk');
            return Check(Fs.readFileSync(Path.join(Directory, 'StoreResponses', 'Blocks', `${Chunk.Sha256}.bin`)),
                Chunk.Sha256, Chunk.Bytes);
        });
        Body = Check(Buffer.concat(Parts), Snapshot.Sha256, Snapshot.Bytes);
    } else if (Snapshot.Format === undefined && HashPattern.test(Snapshot.Sha256) &&
        Snapshot.File === `StoreResponses/${Snapshot.Sha256}.bin`) {
        Body = Check(Fs.readFileSync(Path.join(Directory, Snapshot.File)), Snapshot.Sha256);
    } else {
        throw new Error('unsupported store capture snapshot format');
    }
    if (Body.length !== Meta.BodyBytes) throw new Error('capture response size mismatch');
    return Body;
}

module.exports = { Save, ReadResponse };
