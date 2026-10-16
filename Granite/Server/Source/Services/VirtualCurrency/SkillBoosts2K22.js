// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const { GetField, GetFields, GetU64, Types } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

// NBA2K22 unpacked: the twelve sellable rows at 0x14376E5B0, stride 0x14.
// +0x00 item, +0x04 skill category, +0x08 uses (1/10); the seventh category
// is not in the twelve-item price request at 0x142492DB8. Do not sell it here.
// Prices are the user-approved regular VC prices, not prices from the binary.
const Products = new Map([
    [0x667c0cff, 1], [0xd9bf4ca0, 10], // Jump shots
    [0x597caaf3, 1], [0xd036002d, 10], // Layups and dunks
    [0xdc0987fa, 1], [0xa96fcda4, 10], // Steals
    [0x7ea52c59, 1], [0xe612935d, 10], // Blocks
    [0x0b2ced51, 1], [0xe8bc92ae, 10], // Rebounding
    [0x76ef3d6a, 1], [0x59cab85a, 10], // Ball handling and passing
].map(([Item, Uses]) => [Item, Object.freeze({ uses: Uses, price: Uses === 1 ? 200n : 1500n })]));

function ProductFor(Item) {
    return Products.get(Number(Item) >>> 0) || null;
}

function QuantitiesFor(Items, Fields) {
    const Quantities = new Map();
    if (!Items.some(Item => ProductFor(Item))) return Quantities;
    if (GetFields(Fields, 0xc1ed2239).length !== Items.length)
        throw new Error('invalid skill boost purchase types');
    Items.forEach((Item, Index) => {
        const Product = ProductFor(Item);
        if (!Product) return;
        const ItemField = GetField(Fields, 0xfd76cfbd, Index);
        const Type = GetField(Fields, 0xc1ed2239, Index);
        const CountCrc = Crc32(`ITEM${Index}_COUNT`);
        const PriceCrc = Crc32(`ITEM${Index}_EXPECTED_PRICE`);
        const Count = GetField(Fields, CountCrc);
        const Price = GetField(Fields, PriceCrc);
        // FUN_1413E17B0 writes cart +0x58 as ITEM%d_COUNT: number of packs,
        // not the 1/10 uses granted by each pack. Client skill counts stay local.
        if (ItemField.Type !== Types.StringCrc || Type.Type !== Types.StringCrc || Type.Data1 !== 0xbb8189c6 ||
            !Count || Count.Type !== Types.U64 || !Price || Price.Type !== Types.U64 ||
            GetFields(Fields, CountCrc).length !== 1 || GetFields(Fields, PriceCrc).length !== 1 ||
            GetU64(Fields, CountCrc) < 1n || GetU64(Fields, CountCrc) > 99n ||
            GetU64(Fields, PriceCrc) !== Product.price)
            throw new Error('invalid skill boost cart row');
        Quantities.set(Index, GetU64(Fields, CountCrc));
    });
    return Quantities;
}

module.exports = { ProductFor, QuantitiesFor };
