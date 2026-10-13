// NBA2K22 FUN_1413E14C0/FUN_1413DCCD0: compressed JSON cart.
// FUN_14059B340/FUN_1405AFE80: compressed JSON ownership inventory.
'use strict';
const Zlib = require('node:zlib');
const { GetField } = require('../../Codec/FieldList');
const Fields = Object.freeze({ Cart: 0x3d366503, Inventory: 0x603bd442, InventorySize: 0x5ab6fdf4, OwnedCount: 0x8f1fa615 });
const MaximumJsonBytes = 4 * 1024 * 1024;
function ReadCart(FieldValues) {
    const Field = GetField(FieldValues, Fields.Cart);
    if (!Field) return null;
    if (!Buffer.isBuffer(Field.value)) throw new Error('Store cart is not a valid binary field');
    const Raw = Zlib.inflateSync(Field.value, { maxOutputLength: MaximumJsonBytes });
    const Rows = JSON.parse(Raw.toString('utf8').replace(/\0+$/, ''));
    if (!Array.isArray(Rows) || !Rows.length || Rows.length > 512) throw new Error('Invalid store cart length');
    return Rows.map(Row => {
        if (!Row || !Number.isInteger(Row.item_crc) || Row.item_crc <= 0 || Row.item_crc >= 0xffffffff ||
            !Number.isInteger(Row.item_type) || Row.item_type < 0 || Row.item_type > 0xffffffff ||
            Row.count !== 1 || typeof Row.savebound !== 'boolean' ||
            !Number.isSafeInteger(Row.expected_price) || Row.expected_price < 0)
            throw new Error('Unsupported or invalid store cart row');
        return { item: Row.item_crc, purchaseType: Row.item_type, price: BigInt(Row.expected_price), savebound: Row.savebound };
    });
}
function InstanceId(Entry) {
    // Non-consumable ownership is one row per item/account. Stable across reloads.
    return Number(Entry.item) >>> 0;
}
function AppendInventory(Reply, Entries) {
    const Rows = Entries.map(Entry => ({ item_id: Number(Entry.item) >>> 0, instance_id: InstanceId(Entry) }));
    // The native JSON reader takes a NUL-terminated string from the inflated bytes.
    const Json = Buffer.from(`${JSON.stringify(Rows)}\0`, 'utf8');
    Reply.AddBinary(Fields.Inventory, Zlib.deflateSync(Json, { level: 9 })).AddU64(Fields.InventorySize, BigInt(Json.length));
}
module.exports = { Fields, ReadCart, AppendInventory, InstanceId };
