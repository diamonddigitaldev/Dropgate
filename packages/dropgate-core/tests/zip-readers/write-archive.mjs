// Writes one archive with core's built ZIP writer, and a JSON file saying what
// it holds, for readers that aren't core's to check: Info-ZIP's `unzip -t` and
// Python's zipfile (check_archive.py). CI runs it after the build, one archive
// at a time, since two of them are over 4 GiB.
//
//   node tests/zip-readers/write-archive.mjs <kind> <folder>
//
// Kinds: classic, member-4gib, offsets-4gib, members-65536.

import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { zip } from '../../dist/index.js';

const GiB = 1024 ** 3;
const ZEROS = new Uint8Array(16 << 20);

function pattern(length, seed) {
  return Uint8Array.from({ length }, (_, i) => (i * 31 + seed * 7 + (i >> 8)) & 0xff);
}

// Each kind: its members, a size and either their bytes or zeros, and whether
// the archive must be ZIP64.
const KINDS = {
  // Small members, with accented, CJK and repeated names: the classic format.
  classic: {
    zip64: false,
    members: [
      { name: 'first.txt', bytes: pattern(1000, 1) },
      { name: 'empty.txt', bytes: new Uint8Array(0) },
      { name: 'Café déjà vu.txt', bytes: pattern(70_000, 2) },
      { name: '東京の写真.jpg', bytes: pattern(5000, 3) },
      { name: '사진 모음.png', bytes: pattern(300, 4) },
      { name: 'notes.txt', bytes: pattern(10, 5) },
      { name: 'notes.txt', bytes: pattern(20, 6) },
      { name: 'Notes.TXT', bytes: pattern(30, 7) },
    ],
  },
  // One member of 4 GiB + 1 byte between two small ones, the last past 4 GiB.
  'member-4gib': {
    zip64: true,
    members: [
      { name: 'before.txt', bytes: pattern(100, 1) },
      { name: 'big.bin', zeros: 4 * GiB + 1 },
      { name: 'after.txt', bytes: pattern(200, 2) },
    ],
  },
  // Every member under 4 GiB, but the last starts past it.
  'offsets-4gib': {
    zip64: true,
    members: [
      { name: 'one.bin', zeros: 1.5 * GiB },
      { name: 'two.bin', zeros: 1.5 * GiB },
      { name: 'three.bin', zeros: 1.5 * GiB },
      { name: 'tail.txt', bytes: pattern(50, 9) },
    ],
  },
  // More members than the classic end record can count.
  'members-65536': {
    zip64: true,
    members: Array.from({ length: 65_536 }, (_, i) => ({ name: `f${i}.bin`, bytes: Uint8Array.of(i & 0xff) })),
  },
};

const [kind, folder] = process.argv.slice(2);
const spec = KINDS[kind];
if (!spec || !folder) {
  console.error(`Usage: node write-archive.mjs <${Object.keys(KINDS).join(' | ')}> <folder>`);
  process.exit(2);
}
mkdirSync(folder, { recursive: true });
const archivePath = path.join(folder, `${kind}.zip`);

const out = createWriteStream(archivePath);
const writer = zip.writer(async (chunk) => {
  if (!out.write(chunk)) await once(out, 'drain');
});

const expected = [];
for (const member of spec.members) {
  const size = member.bytes ? member.bytes.length : member.zeros;
  const name = writer.startFile(member.name, size);
  if (member.bytes) {
    writer.writeChunk(member.bytes);
    expected.push({ name, size, sha256: createHash('sha256').update(member.bytes).digest('hex') });
  } else {
    for (let left = size; left > 0; left -= ZEROS.length) {
      writer.writeChunk(ZEROS.subarray(0, Math.min(left, ZEROS.length)));
      await writer.drained();
    }
    expected.push({ name, size, zeros: true });
  }
  writer.endFile();
  await writer.drained();
}
await writer.finalize();
out.end();
await once(out, 'close');

writeFileSync(path.join(folder, `${kind}.json`), JSON.stringify({ zip64: spec.zip64, members: expected }));
console.log(`Wrote ${archivePath}: ${spec.members.length} members, ZIP64 ${spec.zip64 ? 'expected' : 'not expected'}.`);
