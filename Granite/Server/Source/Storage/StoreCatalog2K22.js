// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const Fs = require('node:fs');
const Zlib = require('node:zlib');
const { createHash } = require('node:crypto');
const { Builder } = require('../Codec/FieldList');
const { Crc32 } = require('../Core/Crc32');
const { Groups, StoreDefinitions, MatchingCells } = require('../Services/Store/StoreDefinitions2K22');
const { BrandForItem } = require('../Services/Store/StoreBrands2K22');
const GroupByType = new Map(Object.entries(Groups).map(([Name, Group]) => [Group.ItemType, Name]));

const EXPECTED_TYPEHASH = 0x67af5087;
const EXPECTED_RECORD_SIZE = 0x1a0;
const MAX_PRICE = 0x01ffffff; // 2^25 - 1

const Fields = Object.freeze({
    Version: 0x80592dd9,
    Items: 0xa6b5b9f8,
    UncompressedSize: 0xbf8684dd,
});

const StoreTags = Object.freeze(Object.fromEntries(Object.entries(Groups).map(([Name, Group]) => [Name, Group.Tag])));
const StoreTagCrcs = Object.freeze(Object.fromEntries(Object.entries(StoreTags).map(([Name, Tag]) => [Name, Crc32(Tag)])));

function VerifyDiscount(originPrice, finalPrice) {
    if (finalPrice === originPrice) {
        return { valid: true, discount: null };
    }
    if (finalPrice > originPrice || originPrice <= 0) {
        return { valid: false, discount: null };
    }
    const discount = Math.fround(1 - finalPrice / originPrice);
    const factor = Math.fround(1 - discount);
    // Native CVTDQ2PS/MULSS/CVTSS2SI uses float32 and nearest-even rounding.
    const Amount = Math.fround(Math.fround(originPrice) * factor);
    const Floor = Math.floor(Amount);
    const simulated = Amount - Floor === 0.5 ? Floor + (Floor % 2) : Math.round(Amount);
    if (simulated === finalPrice) {
        return { valid: true, discount };
    }
    return { valid: false, discount: null };
}

function AreItemsEqual(a, b) {
    if (a.originPrice !== b.originPrice) return false;
    if (a.price !== b.price) return false;
    if (a.currency !== b.currency) return false;
    if (a.itemType !== b.itemType) return false;
    if (a.availability !== b.availability) return false;
    if (a.name !== b.name) return false;
    if (a.subName !== b.subName) return false;
    if (a.thumbnail !== b.thumbnail) return false;
    if (JSON.stringify(a.resources) !== JSON.stringify(b.resources)) return false;
    // Brand/team metadata affects view eligibility, so differing values must not be merged.
    if (JSON.stringify(a.rawWords?.['0x194']) !== JSON.stringify(b.rawWords?.['0x194'])) return false;
    const aContent = Array.isArray(a.content) ? a.content : [];
    const bContent = Array.isArray(b.content) ? b.content : [];
    if (aContent.length !== bContent.length) return false;
    for (let i = 0; i < aContent.length; i++) {
        if (aContent[i] !== bContent[i]) return false;
    }
    return true;
}

function BuildCatalogPacket(items, version) {
    const JsonText = JSON.stringify(items);
    const Uncompressed = Buffer.from(`${JsonText}\0`, 'utf8');
    // The client has one shared item cache: distinct filtered views need distinct versions.
    const PacketVersion = createHash('sha256').update(`${version}\0${JsonText}`).digest().readBigUInt64BE() || 1n;
    const Compressed = Zlib.deflateSync(Uncompressed, { level: 9 });
    return new Builder()
        .AddU64(Fields.Version, PacketVersion)
        .AddBinary(Fields.Items, Compressed)
        .AddU64(Fields.UncompressedSize, BigInt(Uncompressed.length))
        .AddStringCrc(Crc32('RESULT'), Crc32('SUCCESS'))
        .Build();
}

class StoreCatalog2K22 {
    constructor(Document) {
        if (!Document || typeof Document !== 'object') {
            throw new TypeError('2K22 store catalog must be an object');
        }
        if (Document.source !== 'NBA2K22_MANIFEST_STORE_BINARY_DATA') {
            throw new Error(`invalid 2K22 store catalog source: ${Document.source}`);
        }
        const typeHash = typeof Document.typeHash === 'string' && /^0x[0-9a-f]{8}$/i.test(Document.typeHash)
            ? Number(Document.typeHash) : Document.typeHash;
        if (typeHash !== EXPECTED_TYPEHASH) {
            throw new Error(`invalid 2K22 store catalog typeHash: ${Document.typeHash}`);
        }
        if (Document.recordSizeBytes !== EXPECTED_RECORD_SIZE) {
            throw new Error(`invalid 2K22 store catalog recordSizeBytes: ${Document.recordSizeBytes}`);
        }
        if (Document.priceFieldsDecoded !== true) {
            throw new Error('2K22 store catalog requires priceFieldsDecoded: true');
        }
        if (!Array.isArray(Document.items)) {
            throw new Error('2K22 store catalog items must be an array');
        }
        if (Document.resourceValidationVersion !== undefined && Document.resourceValidationVersion !== 1) {
            throw new Error('unsupported 2K22 catalog resource validation version');
        }

        let Version = 1n;
        const Sha = Document.manifestSha256 || Document.storeAssetSlotSha256;
        if (typeof Sha === 'string' && Sha.length >= 16) {
            try {
                Version = BigInt(`0x${Sha.slice(0, 16)}`);
            } catch {}
        } else if (typeof Document.version === 'number' && Document.version > 0) {
            Version = BigInt(Document.version);
        }
        if (Version === 0n) Version = 1n;
        this.version = Version;

        const Seen = new Map();
        const RawSeen = new Map();
        const Conflicted = new Set();
        for (const RawItem of Document.items) {
            if (!RawItem || typeof RawItem !== 'object') continue;

            const RawId = RawItem.item ?? RawItem.itemId ?? RawItem.id;
            const Id = typeof RawId === 'number' ? RawId
                : typeof RawId === 'string' && /^(?:0x[0-9a-f]{1,8}|[0-9]+)$/i.test(RawId) ? Number(RawId) : NaN;
            if (!Number.isSafeInteger(Id) || Id <= 0 || Id >= 0xffffffff) continue;
            if (RawSeen.has(Id) && !AreItemsEqual(RawSeen.get(Id), RawItem)) Conflicted.add(Id);
            else RawSeen.set(Id, RawItem);

            if (RawItem.currency !== 0) continue;
            if (RawItem.availability !== 0) continue;
            const GroupName = GroupByType.get(RawItem.itemType);
            if (!GroupName) continue;
            if (Document.resourceValidationVersion === 1) {
                const Resources = RawItem.resources;
                const Wearable = [2, 4, 5].includes(RawItem.itemType);
                if (!Resources || typeof Resources.name !== 'boolean' || typeof Resources.thumbnail !== 'boolean' ||
                    (typeof Resources.content !== 'boolean' && Resources.content !== null) ||
                    (Wearable && typeof Resources.content !== 'boolean')) {
                    throw new Error(`missing resource validation for 2K22 item ${RawId}`);
                }
                // Keep usable nameless OR thumbnail-less items, never require both labels.
                if (Resources.content === false || (!Resources.name && !Resources.thumbnail)) continue;
            }

            if (
                !Array.isArray(RawItem.content) ||
                (Groups[GroupName].RequiresContent && RawItem.content.length === 0) ||
                !RawItem.content.every((entry) => typeof entry === 'string' && entry.length > 0)
            ) {
                continue;
            }

            const OriginPrice = RawItem.originPrice;
            const FinalPrice = RawItem.price;
            if (
                !Number.isInteger(OriginPrice) ||
                !Number.isInteger(FinalPrice) ||
                FinalPrice < 0 ||
                FinalPrice > OriginPrice ||
                OriginPrice > MAX_PRICE
            ) {
                continue;
            }

            const DiscountCheck = VerifyDiscount(OriginPrice, FinalPrice);
            if (!DiscountCheck.valid) continue;

            if (Seen.has(Id)) {
                const Entry = Seen.get(Id);
                if (!Entry.conflicted && !AreItemsEqual(Entry.raw, RawItem)) {
                    Entry.conflicted = true;
                }
            } else {
                Seen.set(Id, {
                    id: Id,
                    raw: RawItem,
                    discount: DiscountCheck.discount,
                    conflicted: false,
                });
            }
        }

        const ValidEntries = Array.from(Seen.values()).filter((entry) => !entry.conflicted && !Conflicted.has(entry.id));

        this.items = [];
        this.pricesByItem = new Map();
        // Includes consumables for the VC purchase path; GetPrice retains its store-only rules.
        this.catalogPricesByItem = new Map();
        this.groupItems = Object.fromEntries(Object.keys(Groups).map(Name => [Name, []]));
        const ItemsByPage = new Map(StoreDefinitions.map(Store => [Store.Page, []]));
        const CellCrcs = new Map(StoreDefinitions.flatMap(Store => Store.Cells.map(Cell => [Cell.Tag, Crc32(Cell.Tag)])));

        for (const Entry of ValidEntries) {
            const Raw = Entry.raw;
            const GroupName = GroupByType.get(Raw.itemType);
            const TagCrc = StoreTagCrcs[GroupName];
            const Brand = BrandForItem(Raw);

            const Item = {
                item_id: Entry.id,
                price: Raw.originPrice,
                tag_crcs: [TagCrc],
                name: String(Raw.name || '').slice(0, 64),
                desc: String(Raw.subName || '').slice(0, 128),
            };
            if (Entry.discount !== null) {
                Item.discount = Entry.discount;
            }
            const Tags = new Set(Item.tag_crcs);
            for (const Store of StoreDefinitions) {
                const Cells = MatchingCells(Store, Raw, GroupName, Brand);
                if (Cells.length === 0) continue;
                ItemsByPage.get(Store.Page).push(Item);
                for (const Cell of Cells) Tags.add(CellCrcs.get(Cell.Tag));
            }
            Item.tag_crcs = [...Tags];

            this.catalogPricesByItem.set(Entry.id, BigInt(Raw.price));
            if (GroupName !== 'Gatorade') this.pricesByItem.set(Entry.id, BigInt(Raw.price));
            this.items.push(Item);
            this.groupItems[GroupName].push(Item);
        }

        this.repliesByPage = new Map();
        this.cellsByPage = new Map();
        for (const Store of StoreDefinitions) {
            this.repliesByPage.set(Store.Page, BuildCatalogPacket(ItemsByPage.get(Store.Page), this.version));
            const Tags = new Set(ItemsByPage.get(Store.Page).flatMap(Item => Item.tag_crcs));
            this.cellsByPage.set(Store.Page, Object.freeze(Store.Cells.filter(Cell => Tags.has(CellCrcs.get(Cell.Tag)))));
        }
        // Keep the previously verified views and API stable.
        this.clothingStoreItems = this.items.filter(Item => Item.tag_crcs.some(Tag => Tag === StoreTagCrcs.Clothing || Tag === StoreTagCrcs.Accessories));
        this.shoeStoreItems = this.groupItems.Shoes;
        this.clothingStoreReply = this.GetReplyForPage('PAGE:TKWORLD_PARK_CLOTHING_STORE');
        this.shoeStoreReply = this.GetReplyForPage('PAGE:TKWORLD_FOOT_LOCKER');
    }

    GetClothingStoreReply() {
        return this.clothingStoreReply;
    }

    GetShoeStoreReply() {
        return this.shoeStoreReply;
    }

    GetPrice(item) {
        return this.pricesByItem.get(Number(item) >>> 0) ?? null;
    }

    GetCellsForPage(page) {
        return this.cellsByPage.get(page) || [];
    }

    GetReplyForPage(page) {
        return this.repliesByPage.get(page) || null;
    }
}

function ReadDocument(Source) {
    const File = !Fs.existsSync(Source) && Source.endsWith('.json') ? `${Source}.gz` : Source;
    const Data = Fs.readFileSync(File);
    return JSON.parse((File.endsWith('.gz') ? Zlib.gunzipSync(Data) : Data).toString('utf8'));
}

function LoadCatalog2K22(Source) {
    return new StoreCatalog2K22(typeof Source === 'string' ? ReadDocument(Source) : Source);
}

module.exports = {
    ReadDocument,
    StoreTags,
    StoreTagCrcs,
    StoreCatalog2K22,
    LoadCatalog2K22,
    LoadFile: LoadCatalog2K22,
    VerifyDiscount,
    BuildCatalogPacket,
    Fields,
};
