// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
'use strict';

const { BrandTitles, BrandForItem, IsNbaItem } = require('./StoreBrands2K22');

// Native item types: record+0x198[5..10]. Keep legacy type tags for catalog API consumers.
const Groups = Object.freeze(Object.fromEntries([
    ['Clothing', 2, 'Clothing', true],
    ['Accessories', 4, 'Accessories', true],
    ['Shoes', 5, 'Shoes', true],
    ['Mascots', 7, 'Mascots', false],
    ['Tattoos', 8, 'Tattoos', true],
    ['Headphones', 19, 'Beats Headphones', true],
    ['MyCourt', 21, 'MyCOURT Items', false],
    ['Gatorade', 22, 'Gatorade', false],
    ['Fireworks', 23, 'Fireworks', false],
    ['Wheelz', 24, 'Wheelz Parts', true],
    ['Football', 25, 'Football', false],
    ['DJStation', 26, 'DJ Station', false],
    ['Equipment', 28, 'Basketballs', true],
].map(([Name, ItemType, Title, RequiresContent]) => [Name, Object.freeze({
    ItemType, Title, RequiresContent,
    // Gatorade uses an EXE-local layout with this exact tag (FUN_1405b2180).
    Tag: Name === 'Gatorade' ? 'PAGE:TKWORLD_GATORADE_STORE' : `GRANITE:LOCAL_${Name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`,
})])));

const Clothing = ['Clothing', 'Accessories'];
const Apparel = [...Clothing, 'Shoes'];
const ClothingBrands = Object.freeze([
    'ADIDAS', 'NIKE', 'JORDAN', 'CONVERSE', 'UNDERARMOUR', 'PUMA', 'NEWBALANCE',
    'MITCHELLNESS', 'STANCE', 'NEWERA', 'BAPE', 'CHAMPION', 'CROCS', 'MARKET', 'JUSTDON',
    'OVO', 'PALMANGELS', 'PATTA', 'SLAM', 'UNION', 'TWOHRSET', 'FISLL', 'HYPERFLY', 'ISLIDE',
    'BELAIR', 'STAYCOOLNYC', 'VISITORONEARTH', 'OVERTIME', 'CARROTS', 'GRUNGYGENTLEMAN',
    'FAIRPLAY', 'BUTTER', 'PARKAFTERDARK',
]);
const ShoeBrands = Object.freeze(['ADIDAS', 'NIKE', 'JORDAN', 'CONVERSE', 'REEBOK',
    'UNDERARMOUR', 'PUMA', 'NEWBALANCE', 'PARKAFTERDARK']);

function BrandCells(Root, GroupNames, Brands) {
    return [...Brands, 'OTHER'].map(Brand => ({
        Title: BrandTitles[Brand], Tag: `GRANITE:STORE:${Root}:BRAND:${Brand}`,
        Groups: GroupNames, Brand,
    }));
}
function SingleBrandCells(Root, GroupNames, Brand) {
    return GroupNames.map(Name => ({
        Title: `${BrandTitles[Brand]} ${Groups[Name].Title}`,
        Tag: `GRANITE:STORE:${Root}:BRAND:${Brand}:${Name.toUpperCase()}`,
        Groups: [Name], Brand,
    }));
}
function TypeCells(GroupNames) {
    return GroupNames.map(Name => ({ Title: Groups[Name].Title, Tag: Groups[Name].Tag, Groups: [Name] }));
}

// Root CRCs are the complete native table at 0x142412160, except BARBERSHOP:
// that store builds its items locally in FUN_1405a4d80 and must stay native.
// Page association: FUN_1405b6360 -> FUN_1405a5f80 / 0x14241abc0.
// Layout is locally reconstructed, not a recovered official server layout.
const StoreDefinitions = Object.freeze([
    ['NBASTORE', 0x8084dff5, 'PAGE:TKWORLD_NBA_STORE', Clothing, { NbaOnly: true, Brands: ['NIKE', 'JORDAN', 'MITCHELLNESS', 'NEWERA'] }],
    ['SWAGS', 0xd3494b66, 'PAGE:TKWORLD_PARK_CLOTHING_STORE', Clothing, { Brands: ClothingBrands }],
    ['FOOTLOCKER', 0x091ed547, 'PAGE:TKWORLD_FOOT_LOCKER', ['Shoes'], { Brands: ShoeBrands }],
    ['BEATS_HEADPHONES', 0xe7366d91, 'STORE_CATEGORY:BEATS_BY_NIGHT', ['Headphones']],
    // No eligible Beats clothing exists in the retail catalog; do not substitute all clothing.
    ['BEATS_CLOTHING', 0xfd2af562, 'PAGE:BEATS_CLOTHING', Clothing, { Brand: 'BEATS' }],
    ['WHEELZ', 0xc523d5a3, 'PAGE:TKWORLD_WHEELZ_STORE', ['Wheelz']],
    ['TATTOOS', 0xf94ba394, 'PAGE:TKWORLD_TATTOO_PARLOR', ['Tattoos']],
    ['GATORADE', 0x6b45f0e9, 'PAGE:TKWORLD_GATORADE_STORE', ['Gatorade']],
    ['ADIDAS_STORES', 0x35296245, 'PAGE:TKWORLD_ADIDAS_STORE', Apparel, { Brand: 'ADIDAS' }],
    ['CONVERSE_STORE', 0xe59340ed, 'PAGE:TKWORLD_CONVERSE_STORE', Apparel, { Brand: 'CONVERSE' }],
    ['JORDAN_STORE', 0x18546b06, 'PAGE:TKWORLD_JORDAN_STORE', Apparel, { Brand: 'JORDAN' }],
    ['NEW_BALANCE_STORE', 0xaa187b04, 'PAGE:TKWORLD_NEW_BALANCE_STORE', Apparel, { Brand: 'NEWBALANCE' }],
    ['NIKE_STORE', 0x40f5b9a4, 'PAGE:TKWORLD_NIKE_STORE', Apparel, { Brand: 'NIKE' }],
    ['PUMA_STORE', 0x0146940e, 'PAGE:TKWORLD_PUMA_STORE', Apparel, { Brand: 'PUMA' }],
    ['SPORTING_GOODS_STORE', 0x40f9de4c, 'PAGE:TKWORLD_SPORTINGGOODS_STORE',
        [...Apparel, 'Equipment', 'Football', 'Fireworks', 'DJStation', 'Headphones', 'Mascots', 'MyCourt'],
        { Brands: [...ClothingBrands, 'REEBOK'] }],
    ['UNDERARMOUR_STORE', 0xeeefe929, 'PAGE:TKWORLD_UNDERARMOUR_STORE', Apparel, { Brand: 'UNDERARMOUR' }],
    ['PARK_AFTER_DARK', 0xaa9a8630, 'TYPE:STORE', Apparel, { Brand: 'PARKAFTERDARK' }],
].map(([Root, NativeRootCrc, Page, GroupNames, Options = {}]) => {
    const Cells = Options.Brand ? SingleBrandCells(Root, GroupNames, Options.Brand)
        : Options.Brands ? [
            ...BrandCells(Root, GroupNames.filter(Name => Apparel.includes(Name)), Options.Brands),
            ...TypeCells(GroupNames.filter(Name => !Apparel.includes(Name))),
        ] : TypeCells(GroupNames);
    return Object.freeze({
        Root, NativeRootCrc, Page, Groups: Object.freeze([...GroupNames]),
        NbaOnly: Boolean(Options.NbaOnly),
        Cells: Object.freeze(Cells.map(Cell => Object.freeze({
            ...Cell, Groups: Object.freeze([...Cell.Groups]),
            // The Other cell is the complement within this store, not a wildcard.
            OtherThan: Cell.Brand === 'OTHER' ? Object.freeze([...Options.Brands]) : null,
        }))),
    });
}));

function MatchingCells(Store, Raw, GroupName, Brand = BrandForItem(Raw)) {
    if (!Store.Groups.includes(GroupName) || (Store.NbaOnly && !IsNbaItem(Raw))) return [];
    return Store.Cells.filter(Cell => Cell.Groups.includes(GroupName)
        && (!Cell.Brand || (Cell.Brand === 'OTHER' ? !Cell.OtherThan.includes(Brand) : Cell.Brand === Brand)));
}

function DefinitionForPage(Page) {
    return StoreDefinitions.find(Definition => Definition.Page === Page) || null;
}

module.exports = { Groups, StoreDefinitions, DefinitionForPage, MatchingCells };
