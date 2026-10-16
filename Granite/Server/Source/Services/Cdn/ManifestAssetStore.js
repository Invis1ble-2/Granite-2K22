'use strict';

const Fs = require('node:fs');
const Path = require('node:path');
const Readline = require('node:readline');
const { ManifestAssetPath } = require('./File');

const Scale = 4;
const MaximumAssetBytes = 256 * 1024 * 1024;

function ParseRow(Line) {
    const Parts = Line.trim().split(/\s+/);
    if (Parts.length < 4 || !/^[0-9A-Z]{2}$/.test(Parts[0])) return null;
    const OffsetText = Parts.at(-2);
    const SizeText = Parts.at(-1);
    if (!/^\d+$/.test(OffsetText) || !/^\d+$/.test(SizeText)) return null;
    const Name = Parts.slice(1, -2).join(' ');
    if (!Name) return null;
    return { Archive: Parts[0], Name, Offset: Number(OffsetText), Size: Number(SizeText) };
}

class ManifestAssetStore {
    constructor(Manifest) {
        this.Manifest = Path.resolve(Manifest);
        this.IndexPromise = null;
    }

    async LoadIndex() {
        const Root = Path.dirname(this.Manifest);
        const Bases = new Map();
        const Rows = new Map();
        const Input = Fs.createReadStream(this.Manifest, { encoding: 'utf8' });
        const Lines = Readline.createInterface({ input: Input, crlfDelay: Infinity });
        try {
            for await (const Line of Lines) {
                const Row = ParseRow(Line);
                if (!Row) continue;
                const End = Row.Offset + Row.Size;
                if (!Number.isSafeInteger(End)) throw new Error(`manifest offset overflow for ${Row.Name}`);
                const Base = Bases.get(Row.Archive);
                if (Base === undefined || Row.Offset < Base) Bases.set(Row.Archive, Row.Offset);
                if (Row.Name !== '[pad_file]' && ManifestAssetPath(Row.Name)) {
                    const Key = Row.Name.toLowerCase();
                    const Previous = Rows.get(Key);
                    if (Previous && (Previous.Archive !== Row.Archive || Previous.Offset !== Row.Offset || Previous.Size !== Row.Size))
                        throw new Error(`manifest contains conflicting asset paths: ${Row.Name}`);
                    Rows.set(Key, Row);
                }
            }
        } catch (Failure) {
            Input.destroy();
            throw Failure;
        }

        const Index = new Map();
        const ShardSizes = new Map();
        for (const [Name, Row] of Rows) {
            const Base = Bases.get(Row.Archive);
            const PhysicalOffset = (Row.Offset - Base) * Scale;
            const PhysicalSize = Row.Size * Scale;
            const File = Path.resolve(Root, Row.Archive);
            if (
                !Number.isSafeInteger(PhysicalOffset) || PhysicalOffset < 0 ||
                !Number.isSafeInteger(PhysicalSize) || PhysicalSize <= 0 || PhysicalSize > MaximumAssetBytes
            )
                throw new Error(`invalid manifest bounds for ${Name}`);
            let ShardSize = ShardSizes.get(Row.Archive);
            if (ShardSize === undefined) {
                ShardSize = Fs.statSync(File).size;
                ShardSizes.set(Row.Archive, ShardSize);
            }
            const PhysicalEnd = PhysicalOffset + PhysicalSize;
            if (!Number.isSafeInteger(PhysicalEnd) || PhysicalEnd > ShardSize)
                throw new Error(`manifest asset exceeds shard bounds: ${Name}`);
            Index.set(Name, { File, PhysicalOffset, PhysicalSize });
        }
        return Index;
    }

    async Read(Relative) {
        if (!ManifestAssetPath(Relative)) return null;
        this.IndexPromise ||= this.LoadIndex();
        const Index = await this.IndexPromise;
        const Entry = Index.get(Relative.toLowerCase());
        if (!Entry) return null;
        const BufferValue = Buffer.allocUnsafe(Entry.PhysicalSize);
        const Handle = Fs.openSync(Entry.File, 'r');
        try {
            let Total = 0;
            while (Total < BufferValue.length) {
                const Count = Fs.readSync(
                    Handle,
                    BufferValue,
                    Total,
                    BufferValue.length - Total,
                    Entry.PhysicalOffset + Total,
                );
                if (!Count) throw new Error(`short manifest asset read: ${Relative}`);
                Total += Count;
            }
        } finally {
            Fs.closeSync(Handle);
        }
        return BufferValue;
    }
}

module.exports = { ManifestAssetStore, ManifestAssetPath, Scale, MaximumAssetBytes };
