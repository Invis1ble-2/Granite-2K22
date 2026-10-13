"""Read installed NBA2K22 ship court markers without changing game archives.
Usage: python ExtractShipCourtMarkers.py GAME_DIR OUTPUT_JSON
Manifest offsets/lengths use four-byte units; archive bases are the first
manifest entry for the same archive. Only the markers.SCNE ZIP member is read.
"""
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path


def extract(game_dir):
    root = Path(game_dir)
    bases = {}
    target = None
    source = 'levels/ship_deck1_park_markers.iff'
    with (root / 'manifest').open(encoding='utf-8') as manifest:
        for line in manifest:
            fields = line.split()
            if len(fields) != 4:
                continue
            archive, name, offset, length = fields
            try:
                offset, length = int(offset), int(length)
            except ValueError:
                continue
            bases.setdefault(archive, offset)
            if name == source:
                target = archive, offset, length
    if target is None:
        raise ValueError('Ship park markers missing from installed manifest')
    archive, offset, length = target
    byte_offset = (offset - bases[archive]) * 4
    with (root / archive).open('rb') as stream:
        stream.seek(byte_offset)
        data = stream.read(length * 4)
    with zipfile.ZipFile(io.BytesIO(data)) as asset:
        markers = json.loads('{' + asset.read('markers.SCNE').decode('utf-8') + '}')
    courts = []
    for name, marker in markers['markers']['Object'].items():
        if name.startswith(('SHORT_', 'HALF_CENTER_')):
            courts.append({'Name': name, 'Translate': marker['Translate'],
                           'Rotate': marker['Rotate'], 'Attributes': marker['Attribute']})
    if sum(c['Name'].startswith('SHORT_') for c in courts) != 6 or sum(
            c['Name'].startswith('HALF_CENTER_') for c in courts) != 6:
        raise ValueError('Expected six 3v3 and six 2v2 markers; refusing partial layout')
    return {'Source': source, 'Archive': archive, 'ArchiveByteOffset': byte_offset,
            'AssetSha256': hashlib.sha256(data).hexdigest(), 'Courts': courts}


if __name__ == '__main__':
    result = extract(sys.argv[1])
    Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(f"Extracted {len(result['Courts'])} ship court markers")
