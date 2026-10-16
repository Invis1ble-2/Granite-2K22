import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
import zlib


TOOL_PATH = Path(__file__).parents[1] / 'Tools' / 'ImportStoreCatalog2K22.py'
SPEC = importlib.util.spec_from_file_location('ImportStoreCatalog2K22', TOOL_PATH)
Catalog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(Catalog)


class StoreCatalog2K22Tests(unittest.TestCase):
    def test_manifest_shard_mapping_uses_scaled_relative_offsets(self):
        with tempfile.TemporaryDirectory() as Directory:
            Root = Path(Directory)
            Shard = Root / '0C'
            Shard.write_bytes(b'01234567abcdefgh')
            Manifest = Root / 'manifest'
            Manifest.write_text('0C alpha.bin 100 2\n0C beta.bin 102 2\n', encoding='utf-8')

            Assets, Bases = Catalog.ReadManifest(Manifest)

            self.assertEqual(Bases['0C'], 100)
            self.assertEqual(Catalog.ReadAsset(Assets, Bases, 'alpha.bin'), b'01234567')
            self.assertEqual(Catalog.ReadAsset(Assets, Bases, 'beta.bin'), b'abcdefgh')

    def test_iff_local_records_are_decompressed_and_crc_checked(self):
        Name = b'table.BIN'
        Member = b'catalog payload'
        Compressed = zlib.compressobj(wbits=-15)
        Payload = Compressed.compress(Member) + Compressed.flush()
        Header = struct.pack(
            '<IHHHHHIIIHH', 0x04034B50, 20, 0, 8, 0, 0,
            zlib.crc32(Member) & 0xFFFFFFFF, len(Payload), len(Member), len(Name), 0)
        Slot = Header + Name + Payload

        self.assertEqual(Catalog.ReadIFFMembers(Slot), {'table.BIN': Member})
        Corrupt = bytearray(Slot)
        Corrupt[14] ^= 1
        with self.assertRaisesRegex(ValueError, 'CRC mismatch'):
            Catalog.ReadIFFMembers(bytes(Corrupt))

    def test_catalog_decodes_only_verified_fields_and_retains_raw_words(self):
        Record = bytearray(Catalog.RECORD_SIZE)
        struct.pack_into('<I', Record, 0x54, 0x12345678)
        struct.pack_into('<I', Record, 0x188, 1500)
        struct.pack_into('<I', Record, 0x18C, 1200)
        struct.pack_into('<I', Record, 0x198, 2 << 5)
        struct.pack_into('<Q', Record, 0x148, 0)
        Files = {
            'store_item_info_typehash.BIN': struct.pack('<I', Catalog.EXPECTED_TYPEHASH),
            'store_num_items_data.BIN': struct.pack('<I', 1),
            'store_items_data.BIN': bytes(Record),
            'store_items_content_guid_pool_size.BIN': struct.pack('<I', 1),
            'store_items_content_guid_pool.BIN': b'\0',
            'store_items_thumbnail_strings_pool_size.BIN': struct.pack('<I', len(b'thumb.iff\0')),
            'store_items_thumbnail_strings_pool.BIN': b'thumb.iff\0',
            'store_items_name_string_array_data.BIN': struct.pack('<Q', 1),
            'store_items_name_string_buffer_data.BIN': b'\0Shirt\0',
            'store_items_sub_name_string_array_data.BIN': struct.pack('<Q', 1),
            'store_items_sub_name_string_buffer_data.BIN': b'\0Tee\0',
        }

        Result = Catalog.DecodeCatalog(Files, {'thumb.iff'}, False)

        self.assertEqual(Result['nativeRecordCount'], 1)
        self.assertEqual(Result['items'][0]['item'], '0x12345678')
        self.assertEqual(Result['items'][0]['name'], 'Shirt')
        self.assertEqual(Result['items'][0]['subName'], 'Tee')
        self.assertEqual(Result['items'][0]['thumbnail'], 'thumb.iff')
        self.assertTrue(Result['priceFieldsDecoded'])
        self.assertEqual(Result['items'][0]['originPrice'], 1500)
        self.assertEqual(Result['items'][0]['price'], 1200)
        self.assertEqual(Result['items'][0]['currency'], 0)
        self.assertEqual(Result['items'][0]['itemType'], 2)
        self.assertEqual(Result['items'][0]['availability'], 0)
        self.assertEqual(Result['items'][0]['resources'],
                         {'name': True, 'thumbnail': True, 'content': None})
        Files['store_items_name_string_array_data.BIN'] = struct.pack('<Q', 0)
        Files['store_items_sub_name_string_array_data.BIN'] = struct.pack('<Q', 0)
        Files['store_items_name_string_buffer_data.BIN'] = b'Wrong pool first name\0'
        Empty = Catalog.DecodeCatalog(Files, {'THUMB.IFF'}, False)['items'][0]
        self.assertEqual((Empty['name'], Empty['subName']), ('', ''))
        self.assertFalse(Empty['resources']['name'])
        self.assertTrue(Empty['resources']['thumbnail'])
        Prefixed = Catalog.DecodeCatalog(Files, {'cdn/store/thumb.iff'}, False)['items'][0]
        self.assertTrue(Prefixed['resources']['thumbnail'])
        struct.pack_into('<I', Record, 0x48, 0x12345678)
        Files['store_items_data.BIN'] = bytes(Record)
        Localized = Catalog.DecodeCatalog(Files, set(), False)['items'][0]
        self.assertEqual(Localized['name'], '')
        self.assertTrue(Localized['resources']['name'], 'localized key survives null English fallback')

    def test_catalog_rejects_unverified_native_typehash(self):
        Names = (
            'store_item_info_typehash.BIN', 'store_num_items_data.BIN',
            'store_items_data.BIN', 'store_items_content_guid_pool_size.BIN',
            'store_items_content_guid_pool.BIN',
            'store_items_thumbnail_strings_pool_size.BIN',
            'store_items_thumbnail_strings_pool.BIN',
            'store_items_name_string_array_data.BIN',
            'store_items_name_string_buffer_data.BIN',
            'store_items_sub_name_string_array_data.BIN',
            'store_items_sub_name_string_buffer_data.BIN',
        )
        Files = {Name: b'' for Name in Names}
        Files['store_item_info_typehash.BIN'] = struct.pack('<I', 0)


    def test_catalog_decodes_signed26_prices_with_sign_extension(self):
        Record = bytearray(Catalog.RECORD_SIZE)
        struct.pack_into('<I', Record, 0x54, 0xABCDEF01)
        # 0x03FFFFFF is -1 in signed 26-bit
        struct.pack_into('<I', Record, 0x188, 0x03FFFFFF | (8 << 26))
        # 0x02000000 is -33554432 in signed 26-bit
        struct.pack_into('<I', Record, 0x18C, 0x02000000 | (3 << 26))
        struct.pack_into('<I', Record, 0x198, 5 << 5)
        Files = {
            'store_item_info_typehash.BIN': struct.pack('<I', Catalog.EXPECTED_TYPEHASH),
            'store_num_items_data.BIN': struct.pack('<I', 1),
            'store_items_data.BIN': bytes(Record),
            'store_items_content_guid_pool_size.BIN': struct.pack('<I', 1),
            'store_items_content_guid_pool.BIN': b'\x00',
            'store_items_thumbnail_strings_pool_size.BIN': struct.pack('<I', 1),
            'store_items_thumbnail_strings_pool.BIN': b'\x00',
            'store_items_name_string_array_data.BIN': struct.pack('<Q', 0),
            'store_items_name_string_buffer_data.BIN': b'Shoes\x00',
            'store_items_sub_name_string_array_data.BIN': struct.pack('<Q', 0),
            'store_items_sub_name_string_buffer_data.BIN': b'Sneaker\x00',
        }
        Result = Catalog.DecodeCatalog(Files, set(), False)
        self.assertEqual(Result['items'][0]['originPrice'], -1)
        self.assertEqual(Result['items'][0]['availability'], 8)
        self.assertEqual(Result['items'][0]['price'], -33554432)
        self.assertEqual(Result['items'][0]['currency'], 3)
        self.assertEqual(Result['items'][0]['itemType'], 5)
    def test_clothing_table_requires_verified_header_bounds_and_sorted_keys(self):
        Data = bytearray(40 + 2 * 40)
        struct.pack_into('<I', Data, 0, 0x6D38FDEF)
        struct.pack_into('<I', Data, 0x1C, 2)
        struct.pack_into('<I', Data, 44, 100)
        struct.pack_into('<I', Data, 84, 200)
        self.assertEqual(Catalog.ClothingItemHashes(Data), {100, 200})
        with self.assertRaisesRegex(ValueError, 'bounds'):
            Catalog.ClothingItemHashes(Data[:60])
        struct.pack_into('<I', Data, 84, 100)
        with self.assertRaisesRegex(ValueError, 'sorted and unique'):
            Catalog.ClothingItemHashes(Data)
        with self.assertRaisesRegex(ValueError, 'unsupported'):
            Catalog.ClothingItemHashes(b'\0' * 40)

    def test_wearable_content_is_independent_of_thumbnail_and_expands_alternatives(self):
        Hashes = {zlib.crc32(b'hat_front') & 0xFFFFFFFF}
        def Item(Type, Content):
            return {'itemType': Type, 'content': Content}
        self.assertTrue(Catalog.HasWearableContent(Item(2, ['hat{_front,_back}']), set(), Hashes))
        self.assertFalse(Catalog.HasWearableContent(Item(4, ['missing']), set(), Hashes))
        self.assertFalse(Catalog.HasWearableContent(Item(2, ['hat_front', 'missing']), set(), Hashes))
        self.assertFalse(Catalog.HasWearableContent(Item(2, []), set(), Hashes))
        self.assertFalse(Catalog.HasWearableContent(Item(5, ['hat_front']), set(), Hashes))
        self.assertTrue(Catalog.HasWearableContent(Item(5, ['shoe.iff']), {'cdn/store/shoe.iff'}, set()))
        self.assertTrue(Catalog.HasWearableContent(Item(2, ['hat_front']),
                                                 {'clothing/clothing_item_hat_front.iff'}, set()))
        self.assertFalse(Catalog.HasWearableContent(Item(2, ['missing']),
                                                  {'store/thumbnails/missing.iff'}, set()))

if __name__ == '__main__':
    unittest.main()
