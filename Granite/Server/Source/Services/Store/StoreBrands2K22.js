// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

// NBA2K22 SHA256 14741e90...: ONLINE_STORE_ITEM_INFO descriptor 0x14342d008,
// Brand = record+0x194[19..23]. Enum 0x14317c678, strings 0x14223e3f0.
const NativeBrands = Object.freeze([
    'NONE', 'ADIDAS', 'NIKE', 'JORDAN', 'ADIDAS', 'CONVERSE', 'REEBOK',
    'SPALDING', 'UNDERARMOUR', 'PEAK', 'ANTA', 'LI_NING', 'LE_COQ_SPORTIF',
    'AND1', 'BRANDBLACK', 'MARVEL', 'MITCHELLNESS', 'PIGALLE', 'STANCE',
    'RUFFLES', 'NEWERA', 'PARKAFTERDARK', 'MOUNTAINDEW', 'GATORADE', 'PUMA',
]);
const BrandTitles = Object.freeze({
    ADIDAS: 'adidas', NIKE: 'Nike', JORDAN: 'Jordan', CONVERSE: 'Converse', REEBOK: 'Reebok',
    UNDERARMOUR: 'Under Armour', MITCHELLNESS: 'Mitchell & Ness', STANCE: 'Stance',
    NEWERA: 'New Era', PARKAFTERDARK: 'Club 2K', PUMA: 'Puma', NEWBALANCE: 'New Balance',
    BAPE: 'BAPE', CHAMPION: 'Champion', CROCS: 'Crocs', MARKET: 'Market', JUSTDON: 'Just Don',
    OVO: 'OVO', PALMANGELS: 'Palm Angels', PATTA: 'Patta', SLAM: 'SLAM', UNION: 'Union Los Angeles',
    TWOHRSET: '2HR SET', FISLL: 'FISLL', HYPERFLY: 'Hyperfly', ISLIDE: 'ISlide',
    BELAIR: 'Bel-Air Athletics', STAYCOOLNYC: 'Stay Cool NYC', VISITORONEARTH: 'Visitor on Earth',
    OVERTIME: 'Overtime', CARROTS: 'Carrots', GRUNGYGENTLEMAN: 'Grungy Gentleman',
    FAIRPLAY: 'FairPlay', BUTTER: 'Butter', BEATS: 'Beats', OTHER: '2K / Other Labels',
});

// Explicit content-resource identifiers observed in the retail catalog, NOT name/description
// heuristics. Used only when the native Brand is NONE. In particular, 'nike' is also
// a generic garment template and 'diamond' a material, so neither is a fallback token.
const ResourceBrands = Object.freeze([
    ['newbalance', 'NEWBALANCE'], ['bape', 'BAPE'], ['champion', 'CHAMPION'], ['crocs', 'CROCS'],
    ['chinatown', 'MARKET'], ['market', 'MARKET'], ['justdon', 'JUSTDON'],
    ['mitchellandness', 'MITCHELLNESS'], ['ovo', 'OVO'], ['palmangels', 'PALMANGELS'],
    ['patta', 'PATTA'], ['slam', 'SLAM'], ['unionlosangeles', 'UNION'], ['2hrset', 'TWOHRSET'],
    ['fisll', 'FISLL'], ['hyperfly', 'HYPERFLY'], ['islide', 'ISLIDE'], ['belair', 'BELAIR'],
    ['staycoolnyc', 'STAYCOOLNYC'], ['visitoronearth', 'VISITORONEARTH'], ['overtime', 'OVERTIME'],
    ['carrots', 'CARROTS'], ['grungygentleman', 'GRUNGYGENTLEMAN'], ['fairplay', 'FAIRPLAY'], ['butter', 'BUTTER'],
].map(([Token, Brand]) => Object.freeze({ Brand, Pattern: new RegExp(`(?:^|_)${Token}(?:_|\\.|$)`, 'i') })));

function NativeWord(Item) {
    const Value = Item?.rawWords?.['0x194'];
    if (typeof Value === 'string' && /^0x[0-9a-f]{8}$/i.test(Value)) return Number(Value);
    if (Number.isInteger(Value) && Value >= 0 && Value <= 0xffffffff) return Value;
    return null;
}

function BrandForItem(Item) {
    const Word = NativeWord(Item);
    // Missing/malformed metadata is not evidence for resource-based brand inference.
    if (Word === null) return 'NONE';
    const Native = (Word >>> 19) & 31;
    if (Native !== 0) return NativeBrands[Native] || 'NONE';
    const Resources = Array.isArray(Item.content) ? Item.content.filter(Value => typeof Value === 'string')
        .map(Value => Value.split(/[\\/]/).at(-1)) : [];
    for (const Entry of ResourceBrands) {
        if (Resources.some(Resource => Entry.Pattern.test(Resource))) return Entry.Brand;
    }
    // The old native enum omits New Balance. Only these observed retail shoe model IDs
    // are mapped; do not infer that arbitrary 77xx resources belong to this brand.
    if (Item.itemType === 5 && Resources.some(Resource => /^shoe_(?:7700|7701|7703|7705|7706)_/i.test(Resource)))
        return 'NEWBALANCE';
    return 'NONE';
}

function IsNbaItem(Item) {
    const Word = NativeWord(Item);
    if (Word === null) return false;
    const Team = Word & 0x7ff;
    // 31=Hornets, 30=historical All-Star, 562=Seattle; 32=unassigned.
    return Team <= 31 || Team === 562;
}

module.exports = { NativeBrands, BrandTitles, ResourceBrands, NativeWord, BrandForItem, IsNbaItem };
