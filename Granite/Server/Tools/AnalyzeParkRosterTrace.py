"""Compare native roster trace snapshots with an NBA2K22 crash minidump.
Pointers are evidence from their source process, never reusable game objects.
"""
import argparse
import json
import re
import struct
from pathlib import Path


def trace_snapshots(path):
    snapshots = []
    active = None
    team = -1
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if "PARKTRACE ai-roster team=" in line:
            team += 1
        start = re.search(r"PARKTRACE ([\w-]+) address=([0-9A-Fa-f]+) bytes=(\d+)", line)
        if start:
            active = {"kind": start[1], "address": int(start[2], 16),
                      "size": int(start[3]), "team": team, "chunks": {}}
            snapshots.append(active)
        row = re.search(r"PARKTRACE \+([0-9A-Fa-f]+):((?: [0-9A-Fa-f]{2})+)\s*$", line)
        if row and active:
            active["chunks"][int(row[1], 16)] = bytes.fromhex(row[2])
    for snap in snapshots:
        data = bytearray()
        for offset, chunk in sorted(snap.pop("chunks").items()):
            if offset != len(data):
                raise ValueError(f"incomplete {snap['kind']} snapshot")
            data.extend(chunk)
        if len(data) != snap["size"]:
            raise ValueError(f"truncated {snap['kind']} snapshot")
        snap["data"] = bytes(data)
    return snapshots


class Dump:
    def __init__(self, path):
        self.file = path.open("rb")
        header = self.file.read(32)
        if header[:4] != b"MDMP":
            raise ValueError("not a minidump")
        count, directory = struct.unpack_from("<II", header, 8)
        self.file.seek(directory)
        streams = [struct.unpack("<III", self.file.read(12)) for _ in range(count)]
        self.ranges = []
        self.image_base = None
        for kind, _, rva in streams:
            self.file.seek(rva)
            if kind == 9:
                count, data = struct.unpack("<QQ", self.file.read(16))
                for _ in range(count):
                    address, size = struct.unpack("<QQ", self.file.read(16))
                    self.ranges.append((address, size, data))
                    data += size
            elif kind == 5:
                count = struct.unpack("<I", self.file.read(4))[0]
                for _ in range(count):
                    self.ranges.append(struct.unpack("<QII", self.file.read(16)))
            elif kind == 4:
                count = struct.unpack("<I", self.file.read(4))[0]
                modules = [self.file.read(108) for _ in range(count)]
                for module in modules:
                    base = struct.unpack_from("<Q", module)[0]
                    name_rva = struct.unpack_from("<I", module, 20)[0]
                    self.file.seek(name_rva)
                    length = struct.unpack("<I", self.file.read(4))[0]
                    name = self.file.read(length).decode("utf-16-le")
                    if name.replace("\\", "/").split("/")[-1].lower() == "nba2k22.exe":
                        self.image_base = base
        if self.image_base is None:
            raise ValueError("NBA2K22 module missing from minidump")

    def read(self, address, size):
        for start, span, data in self.ranges:
            if start <= address and address + size <= start + span:
                self.file.seek(data + address - start)
                return self.file.read(size)
        return None

    def teams(self):
        result = []
        for side, rva in (("home", 0x630C310), ("away", 0x630D568)):
            address = self.image_base + rva
            flags = self.read(address + 0x1044, 4)
            slots = self.read(address + 0xD0, 13 * 8)
            result.append({"side": side, "count": struct.unpack("<I", flags)[0] >> 28 if flags else None,
                           "flags_hex": flags.hex() if flags else None,
                           "playing_roster_pointers": [hex(p) for p in struct.unpack("<13Q", slots)] if slots else None})
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--dump", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    snapshots = trace_snapshots(args.log)
    rosters = []
    for snap in snapshots:
        if snap["kind"] != "roster-player":
            continue
        data = snap["data"]
        rosters.append({"team": snap["team"], "pointer": hex(snap["address"]),
                        "last_name": data[:0x28].decode("utf-16-le").split("\0")[0],
                        "first_name": data[0x28:0x50].decode("utf-16-le").split("\0")[0]})
    dump = Dump(args.dump)
    try:
        result = {"trace_log": str(args.log.resolve()), "crash_dump": str(args.dump.resolve()),
                  "crash_image_base": hex(dump.image_base),
                  "native_team_count": sum(s["kind"] == "ai-team-header" for s in snapshots),
                  "native_player_count": sum(s["kind"] == "ai-player-header" for s in snapshots),
                  "native_rosters": rosters, "crash_teams": dump.teams(),
                  "note": "Native trace proves valid roster pointers; crash teams prove empty playing rosters. These are process-specific snapshots, not CPU creation templates."}
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"teams": result["native_team_count"], "players": result["native_player_count"],
                          "valid_rosters": len(rosters), "crash_counts": [t["count"] for t in result["crash_teams"]]}))
    finally:
        dump.file.close()


if __name__ == "__main__":
    main()
