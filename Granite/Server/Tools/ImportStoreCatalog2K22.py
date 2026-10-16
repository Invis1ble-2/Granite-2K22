# Copyright (c) 2026 Celestial
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import struct
import zlib


MANIFEST_SCALE = 4
RECORD_SIZE = 0x1A0
EXPECTED_TYPEHASH = 0x67AF5087
MAX_ASSET_BYTES = 256 * 1024 * 1024
MAX_MEMBER_BYTES = 64 * 1024 * 1024
LOCAL_FILE_HEADER = b'PK\x03\x04'
RAW_WORD_OFFSETS = (0x170, 0x174, 0x178, 0x17C, 0x188,
                    0x18C, 0x190, 0x194, 0x198, 0x19C)


def HashFile(File):
    Digest = hashlib.sha256()
    with File.open('rb') as Stream:
        for Chunk in iter(lambda: Stream.read(1024 * 1024), b''):
            Digest.update(Chunk)
    return Digest.hexdigest()


def ReadManifest(File):
    Root = File.resolve().parent
    Rows = []
    ByArchive = {}
    with File.open('r', encoding='utf-8-sig') as Stream:
        for LineNumber, Line in enumerate(Stream, 1):
            Parts = Line.split()
            if len(Parts) < 4 or not Parts[-2].isdigit() or not Parts[-1].isdigit():
                continue
            Archive, Offset, Size = Parts[0], int(Parts[-2]), int(Parts[-1])
            Name = ' '.join(Parts[1:-2])
            if not re.fullmatch(r'[0-9A-Z]{2}', Archive):
                raise ValueError(f'invalid archive ID on manifest line {LineNumber}: {Archive}')
            if not Name:
                raise ValueError(f'missing asset name on manifest line {LineNumber}')
            if Size < 0:
                raise ValueError(f'negative asset size on manifest line {LineNumber}')
            Rows.append((Archive, Name, Offset, Size))
            ByArchive.setdefault(Archive, []).append((Offset, Size))

    if not Rows:
        raise ValueError(f'no asset rows found in manifest: {File}')

    Bases = {}
    for Archive, Entries in ByArchive.items():
        Shard = Root / Archive
        if not Shard.is_file():
            raise FileNotFoundError(f'manifest shard is missing: {Shard}')
        Base = min(Offset for Offset, _ in Entries)
        End = max(Offset + Size for Offset, Size in Entries)
        RequiredBytes = (End - Base) * MANIFEST_SCALE
        if RequiredBytes > Shard.stat().st_size:
            raise ValueError(
                f'manifest range for shard {Archive} exceeds its file: '
                f'needs {RequiredBytes} bytes, has {Shard.stat().st_size}')
        Bases[Archive] = Base

    Assets = {}
    for Archive, Name, Offset, Size in Rows:
        if Name == '[pad_file]':
            continue
        Entry = (Root / Archive, Archive, Offset, Size)
        Previous = Assets.get(Name)
        if Previous is not None and Previous != Entry:
            raise ValueError(f'duplicate manifest asset path has conflicting locations: {Name}')
        Assets[Name] = Entry
    return Assets, Bases


def ReadAsset(Assets, Bases, Name):
    try:
        File, Archive, Offset, Size = Assets[Name]
    except KeyError as Error:
        raise ValueError(f'asset not found in manifest: {Name}') from Error
    PhysicalOffset = (Offset - Bases[Archive]) * MANIFEST_SCALE
    PhysicalSize = Size * MANIFEST_SCALE
    if PhysicalOffset < 0 or PhysicalSize < 0 or PhysicalSize > MAX_ASSET_BYTES:
        raise ValueError(f'invalid 2K22 manifest bounds for {Name}')
    if PhysicalOffset + PhysicalSize > File.stat().st_size:
        raise ValueError(f'2K22 manifest range exceeds shard bounds for {Name}')
    with File.open('rb') as Stream:
        Stream.seek(PhysicalOffset)
        Data = Stream.read(PhysicalSize)
    if len(Data) != PhysicalSize:
        raise ValueError(f'short read for {Name}: expected {PhysicalSize}, got {len(Data)}')
    return Data


def ReadIFFMembers(Data):
    """Read manifest-indexed IFF members stored as ZIP local records."""
    Members = {}
    Position = 0
    while True:
        HeaderOffset = Data.find(LOCAL_FILE_HEADER, Position)
        if HeaderOffset < 0:
            break
        if HeaderOffset + 30 > len(Data):
            break
        try:
            (Signature, Version, Flags, Method, ModTime, ModDate, CRC,
             CompressedSize, UncompressedSize, NameLength, ExtraLength) = \
                struct.unpack_from('<IHHHHHIIIHH', Data, HeaderOffset)
            if Signature != 0x04034B50:
                Position = HeaderOffset + 1
                continue
            DataOffset = HeaderOffset + 30 + NameLength + ExtraLength
            End = DataOffset + CompressedSize
            if (
                not NameLength or Flags & (0x0001 | 0x0008) or
                Method not in (0, 8) or UncompressedSize > MAX_MEMBER_BYTES or
                End > len(Data)
            ):
                Position = HeaderOffset + 1
                continue
            NameBytes = Data[HeaderOffset + 30:HeaderOffset + 30 + NameLength]
            Name = NameBytes.decode('utf-8')
            Payload = Data[DataOffset:End]
            if Method == 0:
                Member = Payload
            else:
                Member = zlib.decompress(Payload, -15)
            if len(Member) != UncompressedSize:
                raise ValueError(f'wrong uncompressed size for IFF member {Name}')
            if (zlib.crc32(Member) & 0xFFFFFFFF) != CRC:
                raise ValueError(f'CRC mismatch for IFF member {Name}')
            if Name in Members and Members[Name] != Member:
                raise ValueError(f'duplicate IFF member has conflicting data: {Name}')
            Members[Name] = Member
            Position = End
        except (UnicodeDecodeError, struct.error, zlib.error) as Error:
            raise ValueError(f'invalid ZIP local record at asset offset {HeaderOffset:#x}') from Error
    if not Members:
        raise ValueError('no supported ZIP local records found in store_binary_data.iff')
    return Members


def CString(Data, Offset, PoolName):
    if not 0 <= Offset < len(Data):
        raise ValueError(f'{PoolName} string offset outside pool: {Offset:#x}')
    End = Data.find(b'\0', Offset)
    if End < 0:
        raise ValueError(f'unterminated string in {PoolName} at {Offset:#x}')
    try:
        return Data[Offset:End].decode('utf-8')
    except UnicodeDecodeError as Error:
        raise ValueError(f'invalid UTF-8 in {PoolName} at {Offset:#x}') from Error


def ReadOffset(Offsets, Index, PoolName):
    if len(Offsets) % 8:
        raise ValueError(f'{PoolName} offset array is not a sequence of 64-bit values')
    return struct.unpack_from('<Q', Offsets, Index * 8)[0]


def DecodeCatalog(Files, ManifestNames, IncludeRaw):
    Required = (
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
    Missing = [Name for Name in Required if Name not in Files]
    if Missing:
        raise ValueError(f'store_binary_data.iff is missing members: {", ".join(Missing)}')

    TypeHashData = Files['store_item_info_typehash.BIN']
    if len(TypeHashData) != 4:
        raise ValueError('store_item_info_typehash.BIN must contain one 32-bit value')
    TypeHash, = struct.unpack('<I', TypeHashData)
    if TypeHash != EXPECTED_TYPEHASH:
        raise ValueError(
            f'unexpected ONLINE_STORE_ITEM_INFO typehash: {TypeHash:#010x}; '
            f'expected {EXPECTED_TYPEHASH:#010x}')

    CountData = Files['store_num_items_data.BIN']
    if len(CountData) != 4:
        raise ValueError('store_num_items_data.BIN must contain one 32-bit value')
    Count, = struct.unpack('<I', CountData)
    if not 1 <= Count <= 100000:
        raise ValueError(f'unsupported NBA2K22 store record count: {Count}')

    FoldedManifestNames = {Name.lower() for Name in ManifestNames}
    Data = Files['store_items_data.BIN']
    NameOffsets = Files['store_items_name_string_array_data.BIN']
    SubNameOffsets = Files['store_items_sub_name_string_array_data.BIN']
    Names = Files['store_items_name_string_buffer_data.BIN']
    SubNames = Files['store_items_sub_name_string_buffer_data.BIN']
    ContentPool = Files['store_items_content_guid_pool.BIN']
    ThumbnailPool = Files['store_items_thumbnail_strings_pool.BIN']
    ContentPoolSize, = struct.unpack('<I', Files['store_items_content_guid_pool_size.BIN'])
    ThumbnailPoolSize, = struct.unpack('<I', Files['store_items_thumbnail_strings_pool_size.BIN'])

    if len(Data) != Count * RECORD_SIZE:
        raise ValueError(
            f'unsupported NBA2K22 store table dimensions: {len(Data)} bytes for '
            f'{Count} records of {RECORD_SIZE:#x} bytes')
    if len(NameOffsets) != Count * 8 or len(SubNameOffsets) != Count * 8:
        raise ValueError('store name offset arrays do not match native record count')
    if len(ContentPool) != ContentPoolSize or len(ThumbnailPool) != ThumbnailPoolSize:
        raise ValueError('store string pool size does not match its size metadata')

    Items = []
    Matched = set()
    IDs = set()
    for Index in range(Count):
        Record = Data[Index * RECORD_SIZE:(Index + 1) * RECORD_SIZE]
        Item, = struct.unpack_from('<I', Record, 0x54)
        if Item in (0, 0xFFFFFFFF):
            raise ValueError(f'invalid NBA2K22 item ID at record {Index}: {Item:#010x}')
        IDs.add(Item)

        NameOffset = ReadOffset(NameOffsets, Index, 'name')
        SubNameOffset = ReadOffset(SubNameOffsets, Index, 'sub-name')
        # Native loader (1405A691A/1405A694C) preserves zero as a null pointer.
        Name = CString(Names, NameOffset, 'name') if NameOffset else ''
        SubName = CString(SubNames, SubNameOffset, 'sub-name') if SubNameOffset else ''

        ThumbnailOffset, = struct.unpack_from('<Q', Record, 0x148)
        Thumbnail = CString(ThumbnailPool, ThumbnailOffset, 'thumbnail')
        if Thumbnail in ManifestNames:
            Matched.add(Thumbnail)

        Raw188, = struct.unpack_from('<I', Record, 0x188)
        Raw18C, = struct.unpack_from('<I', Record, 0x18C)
        Raw198, = struct.unpack_from('<I', Record, 0x198)

        Val188 = Raw188 & 0x03FFFFFF
        OriginPrice = Val188 if not (Val188 & 0x02000000) else Val188 - 0x04000000
        Availability = (Raw188 >> 26) & 0x0F

        Val18C = Raw18C & 0x03FFFFFF
        Price = Val18C if not (Val18C & 0x02000000) else Val18C - 0x04000000
        Currency = (Raw18C >> 26) & 7
        ContentCount = (Raw18C & 0xE0000000) >> 29

        ItemType = (Raw198 >> 5) & 63

        Content = []
        if ContentCount > 7:
            raise ValueError(f'unsupported content pointer count at record {Index}')
        for Slot in range(ContentCount):
            Pointer, = struct.unpack_from('<Q', Record, 0x10 + Slot * 8)
            Asset = CString(ContentPool, Pointer, 'content GUID')
            Prefixed = f'cdn/store/{Asset}'
            if Prefixed in ManifestNames:
                Asset = Prefixed
                Matched.add(Asset)
            elif Asset in ManifestNames:
                Matched.add(Asset)
            Content.append(Asset)

        Entry = {
            'recordIndex': Index,
            'item': f'0x{Item:08X}',
            'name': Name,
            'subName': SubName,
            'originPrice': OriginPrice,
            'price': Price,
            'currency': Currency,
            'itemType': ItemType,
            'availability': Availability,
            'thumbnail': Thumbnail,
            'content': Content,
            'resources': {
                # Localized names may exist even without an English fallback pointer.
                'name': bool(Name.strip()) or struct.unpack_from('<I', Record, 0x48)[0] != 0,
                'thumbnail': bool(Thumbnail) and (Thumbnail.lower() in FoldedManifestNames or
                                                 f'cdn/store/{Thumbnail}'.lower() in FoldedManifestNames),
                'content': None,
            },
            'rawWords': {
                f'0x{Offset:03X}': f'0x{struct.unpack_from("<I", Record, Offset)[0]:08X}'
                for Offset in RAW_WORD_OFFSETS
            },
        }
        if IncludeRaw:
            Entry['rawRecord'] = Record.hex()
        Items.append(Entry)

    ManifestItemAssets = sum(
        Name.startswith(('cdn/store/clothing/win64/items/', 'cdn/store/shoes/win64/data/'))
        for Name in ManifestNames
    )
    return {
        'version': 1,
        'source': 'NBA2K22_MANIFEST_STORE_BINARY_DATA',
        'nativeRecordCount': Count,
        'uniqueItemCount': len(IDs),
        'duplicateItemRows': Count - len(IDs),
        'typeHash': f'0x{TypeHash:08X}',
        'recordSizeBytes': RECORD_SIZE,
        'matchedManifestAssets': len(Matched),
        'manifestItemAssets': ManifestItemAssets,
        'priceFieldsDecoded': True,
        'fieldLayout': {
            'itemId': {'offset': '0x54', 'type': 'u32'},
            'name': 'store_items_name_string_array_data[index] -> name string buffer',
            'subName': 'store_items_sub_name_string_array_data[index] -> sub-name string buffer',
            'originPrice': {
                'offset': '0x188',
                'mask': '0x03FFFFFF',
                'type': 'signed 26-bit integer (native record+0x188[0..25])',
            },
            'availability': {
                'offset': '0x188',
                'shift': 26,
                'mask': '0x0F',
                'type': 'u4 (native record+0x188[26..29])',
            },
            'price': {
                'offset': '0x18C',
                'mask': '0x03FFFFFF',
                'type': 'signed 26-bit integer (native record+0x18c[0..25])',
            },
            'currency': {
                'offset': '0x18C',
                'shift': 26,
                'mask': '0x07',
                'type': 'u3 (native record+0x18c[26..28]; 0 = VC)',
            },
            'itemType': {
                'offset': '0x198',
                'shift': 5,
                'mask': '0x3F',
                'type': 'u6 (native record+0x198[5..10]; 2=clothing, 4=accessories, 5=shoes)',
            },
            'thumbnail': {
                'offset': '0x148',
                'type': 'u64 relative offset into store_items_thumbnail_strings_pool.BIN',
            },
            'content': {
                'pointerOffset': '0x10',
                'pointerType': 'u64 relative offset into store_items_content_guid_pool.BIN',
                'countOffset': '0x18C',
                'countMask': '0xE0000000',
                'countShift': 29,
            },
        },
        'items': Items,
    }


def ClothingItemHashes(Data):
    # ConsolidatedClothingItems: 40-byte header, count at +0x1C,
    # then 0x28-byte records with name CRC at +4 (FUN_141084260).
    if len(Data) < 40 or struct.unpack_from('<I', Data)[0] != 0x6D38FDEF:
        raise ValueError('unsupported consolidated clothing item table')
    Count, = struct.unpack_from('<I', Data, 0x1C)
    if not Count or 40 + Count * 40 > len(Data):
        raise ValueError('invalid consolidated clothing item table bounds')
    Hashes = [struct.unpack_from('<I', Data, 40 + Index * 40 + 4)[0]
              for Index in range(Count)]
    if any(Left >= Right for Left, Right in zip(Hashes, Hashes[1:])):
        raise ValueError('consolidated clothing item hashes are not sorted and unique')
    return set(Hashes)


def ContentVariants(Name):
    # Catalog toggle groups (left/right, front/back) are alternatives, not file names.
    Match = re.fullmatch(r'([^{}]*)\{([^{}]+)\}([^{}]*)', Name)
    if not Match:
        return [Name] if '{' not in Name and '}' not in Name else []
    Prefix, Choices, Suffix = Match.groups()
    Parts = Choices.split(',')
    if len(Parts) > 64 or any(not Part for Part in Parts):
        raise ValueError(f'invalid clothing content alternatives: {Name}')
    return [Prefix + Part + Suffix for Part in Parts]


def HasWearableContent(Item, ManifestNames, ClothingHashes):
    def Exists(Name):
        if Name.lower() in ManifestNames or f'cdn/store/{Name}'.lower() in ManifestNames:
            return True
        if Item['itemType'] == 5:
            return False
        if f'clothing/clothing_item_{Name}.iff'.lower() in ManifestNames:
            return True
        return (zlib.crc32(Name.lower().encode('utf-8')) & 0xFFFFFFFF) in ClothingHashes

    return bool(Item['content']) and all(
        any(Exists(Variant) for Variant in ContentVariants(Name)) for Name in Item['content'])


def AddResourceValidation(Result, Assets, Bases):
    Slot = ReadAsset(Assets, Bases, 'clothing_itemtable.iff')
    Members = ReadIFFMembers(Slot)
    Hashes = ClothingItemHashes(Members['item_table.ConsolidatedClothingItems'])
    ManifestNames = {Name.lower() for Name in Assets}
    for Item in Result['items']:
        if Item['itemType'] in (2, 4, 5):
            Item['resources']['content'] = HasWearableContent(Item, ManifestNames, Hashes)
    Result['resourceValidationVersion'] = 1
    Result['clothingItemTableSha256'] = hashlib.sha256(Slot).hexdigest()


def Main(Manifest, Output, IncludeRaw):
    Manifest = Manifest.resolve()
    Output = Output.resolve()
    if Output == Manifest or Manifest.parent in Output.parents:
        raise ValueError('output must be outside the game manifest directory')

    Assets, Bases = ReadManifest(Manifest)
    AssetSlot = ReadAsset(Assets, Bases, 'store_binary_data.iff')
    Files = ReadIFFMembers(AssetSlot)
    ManifestNames = set(Assets)
    Result = DecodeCatalog(Files, ManifestNames, IncludeRaw)
    AddResourceValidation(Result, Assets, Bases)
    Result.update({
        'manifestSha256': HashFile(Manifest),
        'storeAssetSlotSha256': hashlib.sha256(AssetSlot).hexdigest(),
        'storeAssetManifestUnits': Assets['store_binary_data.iff'][3],
        'storeAssetPhysicalBytes': len(AssetSlot),
    })

    Output.parent.mkdir(parents=True, exist_ok=True)
    Temporary = Output.with_name(Output.name + '.tmp')
    if not IncludeRaw:
        for Item in Result['items']:
            Item.pop('recordIndex', None)
            Item['rawWords'] = {'0x194': Item['rawWords']['0x194']}
    Data = json.dumps(Result, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    if Output.suffix == '.gz':
        Data = gzip.compress(Data, compresslevel=9, mtime=0)
    Temporary.write_bytes(Data)
    Temporary.replace(Output)
    print(
        f'Parsed {Result["nativeRecordCount"]} NBA2K22 store records '
        f'({Result["uniqueItemCount"]} unique item IDs); '
        f'{Result["matchedManifestAssets"]} manifest assets matched. '
        f'Output: {Output}'
    )


if __name__ == '__main__':
    Parser = argparse.ArgumentParser(
        description='Read the NBA 2K22 manifest shard layout and decode store_binary_data.iff')
    Parser.add_argument('manifest', type=Path, help='NBA 2K22 manifest file')
    Parser.add_argument('output', type=Path, help='output .json or .json.gz path (must be outside game directory)')
    Parser.add_argument('--include-raw', action='store_true',
                        help='include each full 0x1A0 record as hex in the output')
    Arguments = Parser.parse_args()
    Main(Arguments.manifest, Arguments.output, Arguments.include_raw)
