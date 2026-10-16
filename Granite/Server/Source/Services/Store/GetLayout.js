// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Zlib = require('node:zlib');
const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { StoreDefinitions } = require('./StoreDefinitions2K22');

const Fields = Object.freeze({
    LayoutJsonSize: 0x6cb1bd26,
    LayoutJsonCompressed: 0xe1e79306,
});

function LayoutDocument(Catalog = null) {
    return Object.fromEntries(StoreDefinitions.map(Store => {
        // Use final sale-view membership, including resource/price/conflict filtering.
        const VisibleCells = Catalog ? Catalog.GetCellsForPage(Store.Page) : Store.Cells;
        const Cells = VisibleCells.map(Cell => ({
            cell_size: 'ONE_BY_ONE', cell_type: 'TAG', store_type: Store.Root,
            description: '', title: Cell.Title, flag: 'NONE',
            tag: Cell.Tag, logo_guid: '',
        }));
        const Pages = [];
        for (let Offset = 0; Offset < Cells.length; Offset += 6) {
            const Page = Cells.slice(Offset, Offset + 6);
            Pages.push([Page.slice(0, 3), ...(Page.length > 3 ? [Page.slice(3)] : [])]);
        }
        return [Store.Root, Pages];
    }));
}

const RepliesByCatalog = new WeakMap();

function BuildPacket(Catalog) {
    const Document = Buffer.from(`${JSON.stringify(LayoutDocument(Catalog))}\0`, 'utf8');
    const Compressed = Zlib.deflateSync(Document, { level: 9 });
    return new Builder()
        .AddU64(Fields.LayoutJsonSize, BigInt(Document.length))
        .AddBinary(Fields.LayoutJsonCompressed, Compressed)
        .AddStringCrc(Crc32('RESULT'), Crc32('SUCCESS'))
        .Build();
}

const DefaultReply = BuildPacket(null);

function Build(Input = {}, Context = {}) {
    const Catalog = Context.StoreCatalog2K22;
    if (!Catalog) return DefaultReply;
    if (!RepliesByCatalog.has(Catalog)) RepliesByCatalog.set(Catalog, BuildPacket(Catalog));
    return RepliesByCatalog.get(Catalog);
}

module.exports = { Build, GetLayout: Build, Fields, LayoutDocument, Status: '2K22_NATIVE_BRAND_STORE_LAYOUT' };
