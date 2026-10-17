"""Reads an archive written by core's ZIP writer with Python's zipfile, a reader
that isn't core's, and checks it against the JSON that write-archive.mjs wrote:
every member's name and size, its bytes (SHA-256, or all zeros), and its CRC-32
(zipfile checks it as each member is read to the end). It also checks the
format: a small archive is classic ("version needed" 2.0, no ZIP64 record), and
the others carry the ZIP64 end records.

    python3 tests/zip-readers/check_archive.py <archive.zip> <archive.json>
"""

import hashlib
import json
import struct
import sys
import zipfile

ZIP64_LOCATOR = 0x07064B50
STEP = 16 << 20


def fail(message):
    print(f"FAIL: {message}")
    sys.exit(1)


def main(archive_path, expected_path):
    with open(expected_path, encoding="utf-8") as f:
        expected = json.load(f)
    members = expected["members"]

    # The ZIP64 end record's locator sits right before the classic end record
    # (22 bytes, no comment).
    with open(archive_path, "rb") as f:
        f.seek(-42, 2)
        tail = f.read(42)
    has_zip64_end = struct.unpack("<I", tail[:4])[0] == ZIP64_LOCATOR
    if has_zip64_end != expected["zip64"]:
        fail(f"ZIP64 end records {'present' if has_zip64_end else 'missing'}, expected {'them' if expected['zip64'] else 'none'}")

    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        if len(infos) != len(members):
            fail(f"{len(infos)} members, expected {len(members)}")
        for i, (info, want) in enumerate(zip(infos, members)):
            if info.filename != want["name"]:
                fail(f"member {i} is named {info.filename!r}, expected {want['name']!r}")
            if not info.flag_bits & 0x0800:
                fail(f"member {i} has no UTF-8 flag")
            if info.compress_type != zipfile.ZIP_STORED:
                fail(f"member {i} isn't stored")
            if info.file_size != want["size"]:
                fail(f"member {i} is {info.file_size} bytes, expected {want['size']}")
            if not expected["zip64"] and info.extract_version != 20:
                fail(f"member {i} needs version {info.extract_version}, expected 20 in a classic archive")

            digest = hashlib.sha256()
            read = 0
            all_zero = True
            # Read to the end, so zipfile checks the CRC-32 (BadZipFile if it's wrong).
            with archive.open(info) as member:
                while True:
                    chunk = member.read(STEP)
                    if not chunk:
                        break
                    read += len(chunk)
                    if want.get("zeros"):
                        all_zero = all_zero and chunk.count(0) == len(chunk)
                    else:
                        digest.update(chunk)
            if read != want["size"]:
                fail(f"member {i} read {read} bytes, expected {want['size']}")
            if want.get("zeros") and not all_zero:
                fail(f"member {i} isn't all zeros")
            if not want.get("zeros") and digest.hexdigest() != want["sha256"]:
                fail(f"member {i}'s bytes differ")

    print(f"OK: {archive_path}: {len(members)} members, names, sizes, CRC-32 and bytes as written; ZIP64 {'present' if has_zip64_end else 'absent'}, as expected.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
