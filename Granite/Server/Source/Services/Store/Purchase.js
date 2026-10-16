// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetFields, GetField, Types } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { ItemCrc, PurchaseType } = require('../VirtualCurrency/Purchase');
const { OwnedKey, ListOwnedItems, RememberOwnedItem } = require('../../Storage/OwnedItems');
const { BalanceFor, SetBalance } = require('../VirtualCurrency/Balance');
const Wire2K22 = require('./Wire2K22');
const Logger = require('../../Core/Logger');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');
const InsufficientFunds = 0xf4e7a9b4;
const Balance2K19 = 0x93b1e1e4;
const Balance2K22 = 0xce7d633f;

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    let Cart;
    try {
        Cart = Wire2K22.ReadCart(Fields);
    } catch (Failure) {
        Logger.Error(`invalid StoreV4 cart: ${Failure.message}`);
        return new Builder().AddU32(Result, Crc32('FAILURE')).Build();
    }
    if (Cart && !OwnedKey(Context)) return new Builder().AddU32(Result, Crc32('FAILURE')).Build();
    const NativeCatalog = Context.StoreCatalog2K22;
    const HasNativeCatalog = Boolean(Cart && typeof NativeCatalog?.GetPrice === 'function');
    if (HasNativeCatalog && !(Context.OwnedItems instanceof Map))
        return new Builder().AddU32(Result, Crc32('FAILURE')).Build();
    const AccountKey = OwnedKey(Context);
    const ExistingOwned = new Set(ListOwnedItems(Context.OwnedItems, AccountKey).map(Entry => Number(Entry.item) >>> 0));
    let Total = 0n;
    if (HasNativeCatalog) {
        const SeenItems = new Set();
        for (const Row of Cart) {
            const Price = NativeCatalog.GetPrice(Row.item);
            if (SeenItems.has(Row.item) || Price === null || Price === undefined || BigInt(Row.price) !== BigInt(Price)) {
                Logger.Verbose(`StoreV4 price mismatch or duplicate catalog item 0x${Row.item.toString(16).toUpperCase()}`);
                return new Builder().AddU32(Result, Crc32('FAILURE')).Build();
            }
            SeenItems.add(Row.item);
            if (!ExistingOwned.has(Row.item)) Total += BigInt(Price);
        }
        if (!(Context.Wallets instanceof Map))
            return new Builder().AddU32(Result, Crc32('FAILURE')).Build();
        if (Total > BalanceFor(Context)) return new Builder().AddU32(Result, InsufficientFunds).Build();
    }
    let OwnedSnapshot = null;
    let OwnershipChanged = false;
    const Items = Cart ? Cart.map(Row => Row.item) : GetFields(Fields, ItemCrc).map((Field) => Field.Data1 >>> 0);
    if (Items.length && Context.OwnedItems instanceof Map) {
        const Key = AccountKey;
        if (Key) {
            const Previous = Context.OwnedItems.get(Key);
            OwnedSnapshot = Array.isArray(Previous) ? Previous.map(Entry => ({ ...Entry })) : null;
            let StoredAny = false;
            for (let Index = 0; Index < Items.length; Index++) {
                if (HasNativeCatalog && ExistingOwned.has(Items[Index])) continue;
                const TypeField = GetField(Fields, PurchaseType, Index);
                RememberOwnedItem(Context.OwnedItems, Key, {
                    item: Items[Index] >>> 0,
                    purchaseType: Cart ? Cart[Index].purchaseType : TypeField ? TypeField.Data1 >>> 0 : null,
                    price: Cart ? Cart[Index].price : 0n,
                });
                StoredAny = true;
            }
            try {
                if (StoredAny && typeof Context.SaveOwnedItems === 'function') Context.SaveOwnedItems();
                OwnershipChanged = StoredAny;
            } catch (Failure) {
                if (OwnedSnapshot) Context.OwnedItems.set(Key, OwnedSnapshot);
                else Context.OwnedItems.delete(Key);
                Logger.Error(`StoreV4 ownership save failed; purchase not charged: ${Failure.message}`);
                return new Builder().AddU32(Result, Crc32('FAILURE')).Build();
            }
        }
    }
    if (HasNativeCatalog && Total > 0n) {
        try {
            SetBalance(Context, BalanceFor(Context) - Total);
        } catch (Failure) {
            if (OwnershipChanged && AccountKey) {
                if (OwnedSnapshot) Context.OwnedItems.set(AccountKey, OwnedSnapshot);
                else Context.OwnedItems.delete(AccountKey);
                try { if (typeof Context.SaveOwnedItems === 'function') Context.SaveOwnedItems(); }
                catch (RollbackFailure) {
                    Logger.Error(`StoreV4 ownership rollback failed after wallet save error: ${RollbackFailure.message}`);
                }
            }
            Logger.Error(`StoreV4 wallet save failed; purchase not charged: ${Failure.message}`);
            return new Builder().AddU32(Result, Crc32('FAILURE')).Build();
        }
    }
    if (Context.Purchases instanceof Map) {
        for (let Index = 0; Index < Items.length; Index++) {
            if (HasNativeCatalog && ExistingOwned.has(Items[Index])) continue;
            Context.Purchases.set(`store:${Items[Index] >>> 0}:${Date.now()}:${Index}`, { item: Items[Index] });
        }
    }
    if (Cart) {
        const Reply = new Builder();
        for (const Row of Cart) {
            // FUN_1413E2260 -> FUN_1405B3670 reads paired item/count fields.
            Reply.AddStringCrc(ItemCrc, Row.item).AddU64(Wire2K22.Fields.OwnedCount, 1n);
        }
        if (HasNativeCatalog) {
            const CurrentBalance = BalanceFor(Context);
            Reply.AddU64(Balance2K19, CurrentBalance).AddU64(Balance2K22, CurrentBalance);
        }
        Reply.AddU32(Result, Success);
        Reply.Fields.sort((A, B) => A.Crc - B.Crc);
        return Reply.Build();
    }
    const Echo = Fields.map((Field) => ({
        Crc: Field.Crc >>> 0,
        Type: Field.Type >>> 0,
        Data1: Field.Data1 >>> 0,
        Data2: Field.Data2 >>> 0,
    }));
    Echo.push({ Crc: Result, Type: Types.StringCrc, Data1: Success >>> 0, Data2: 0 });
    Echo.sort((A, B) => A.Crc - B.Crc);
    const Reply = new Builder();
    for (const Record of Echo) Reply.Record(Record.Crc, Record.Type, Record.Data1, Record.Data2);
    return Reply.Build();
}

module.exports = {
    Build,
    Purchase: Build,
    Status: '2K22_CATALOG_PRICE_VALIDATION_AND_WALLET_DEBIT',
};
