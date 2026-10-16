// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { LoadFile } = require('./StoreCatalog2K22');

function LoadCatalogPrices(Source) {
    const Catalog = typeof Source === 'string' ? LoadFile(Source) : Source;
    if (!(Catalog?.catalogPricesByItem instanceof Map))
        throw new Error('store prices require a loaded 2K22 store catalog');
    return new Map(Catalog.catalogPricesByItem);
}

module.exports = { LoadCatalogPrices };
