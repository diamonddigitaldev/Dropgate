import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { zip, DropgateError } from '../src/index.js';
import { recordArchive, readZip, type ReadArchive } from './helpers/zip-reader.js';

const GiB = 1024 ** 3;
/** One shared buffer of zeros: the recorder keeps chunks of it as their length. */
const ZEROS = new Uint8Array(16 << 20);

/** Bytes that differ from member to member and from offset to offset. */
function pattern(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 31 + seed * 7 + (i >> 8)) & 0xff);
}

/** Writes `size` zeros from the shared buffer, awaiting the writer each step. */
async function writeZeros(writer: ReturnType<typeof zip.writer>, size: number): Promise<void> {
  for (let left = size; left > 0; left -= ZEROS.length) {
    writer.writeChunk(ZEROS.subarray(0, Math.min(left, ZEROS.length)));
    await writer.drained();
  }
}

/** Writes members of small, known bytes, each split into uneven chunks, and reads the archive back. */
async function writeSmall(members: Array<{ name: string; bytes: Uint8Array }>): Promise<{ read: ReadArchive; stored: string[] }> {
  const recorder = recordArchive(ZEROS);
  const writer = zip.writer(recorder.onData);
  const stored: string[] = [];
  for (const member of members) {
    stored.push(writer.startFile(member.name, member.bytes.length));
    for (let at = 0, step = 1; at < member.bytes.length; at += step, step = step * 3 + 1) {
      writer.writeChunk(member.bytes.subarray(at, at + step));
    }
    writer.endFile();
  }
  await writer.finalize();
  return { read: readZip(recorder.segments), stored };
}

/** Every member read back whole: its name, size, CRC-32 (by zlib) and bytes. */
function expectMembers(read: ReadArchive, members: Array<{ name: string; bytes: Uint8Array }>): void {
  expect(read.entries.map((e) => e.name)).toEqual(members.map((m) => m.name));
  read.entries.forEach((entry, i) => {
    expect(entry.size, entry.name).toBe(members[i].bytes.length);
    expect(entry.compressedSize, 'stored, not compressed').toBe(entry.size);
    expect(entry.method, 'stored').toBe(0);
    expect(entry.crc, `${entry.name}'s CRC-32`).toBe(zlib.crc32(members[i].bytes) >>> 0);
    expect(read.crcOf(entry), `${entry.name}'s bytes against its CRC-32`).toBe(entry.crc);
    expect(Buffer.from(read.bytesOf(entry)).equals(Buffer.from(members[i].bytes)), `${entry.name}'s bytes`).toBe(true);
  });
}

describe("core's ZIP writer: the classic format for small archives", () => {
  it('writes a small archive in the classic format: version needed 2.0, no ZIP64 record or field, every member read back whole', async () => {
    const members = [
      { name: 'first.txt', bytes: pattern(1000, 1) },
      { name: 'empty.txt', bytes: new Uint8Array(0) },
      { name: 'third.bin', bytes: pattern(70_000, 3) },
    ];
    const { read, stored } = await writeSmall(members);
    expect(stored).toEqual(members.map((m) => m.name));
    expectMembers(read, members);
    expect(read.zip64, 'no ZIP64 end record or locator').toBe(false);
    for (const entry of read.entries) {
      expect(entry.versionNeeded, 'version needed 2.0').toBe(20);
      expect(entry.localVersionNeeded).toBe(20);
      expect(entry.madeBy, 'made by MS-DOS, 2.0: readers give the files their own permissions').toBe(20);
      expect(entry.flags, 'a data descriptor, and the name in UTF-8').toBe(0x0808);
      expect(entry.zip64Extra).toEqual([]);
      expect(entry.localZip64Extra).toBe(false);
      expect(entry.descriptorLength).toBe(16);
    }
    expect(read.end.count).toBe(3);
  });

  it('writes an archive with no members as just its end record', async () => {
    const { read } = await writeSmall([]);
    expect(read.entries).toEqual([]);
    expect(read.zip64).toBe(false);
  });

  it("passes a member's bytes on as they are, in order, one onData call at a time", async () => {
    const order: string[] = [];
    let busy = false;
    const writer = zip.writer(async (chunk) => {
      expect(busy, 'onData is never called while it is still busy').toBe(false);
      busy = true;
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(chunk === data ? 'data' : 'record');
      busy = false;
    });
    const data = pattern(10, 0);
    writer.startFile('a.txt', 10);
    writer.writeChunk(data);
    writer.endFile();
    await writer.drained();
    expect(order, "the member's own bytes, not a copy, between its header and descriptor").toEqual(['record', 'data', 'record']);
    await writer.finalize();
  });
});

describe("core's ZIP writer: names", () => {
  it('stores accented and CJK names in UTF-8 with the UTF-8 flag set, NFC', async () => {
    const members = [
      { name: 'Café déjà vu.txt', bytes: pattern(5, 1) },
      { name: '東京の写真.jpg', bytes: pattern(6, 2) },
      { name: '사진 모음.png', bytes: pattern(7, 3) },
      { name: 'Ελληνικά — ñandú.md', bytes: pattern(8, 4) },
    ];
    // Decomposed (NFD) on the way in, as macOS gives names, and NFC as stored.
    const { read, stored } = await writeSmall(members.map((m) => ({ ...m, name: m.name.normalize('NFD') })));
    expect(stored).toEqual(members.map((m) => m.name.normalize('NFC')));
    expectMembers(read, members);
    for (const entry of read.entries) {
      expect(entry.flags & 0x0800, `${entry.name} has the UTF-8 flag`).toBe(0x0800);
      expect(Buffer.from(entry.nameBytes).equals(Buffer.from(entry.name, 'utf8')), `${entry.name} is stored as UTF-8`).toBe(true);
    }
  });

  it('gives two members with the same name distinct entries, without regard to case, and makes each name safe', async () => {
    const { read, stored } = await writeSmall([
      { name: 'notes.txt', bytes: pattern(3, 1) },
      { name: 'notes.txt', bytes: pattern(4, 2) },
      { name: 'Notes.TXT', bytes: pattern(5, 3) },
      { name: 'CON.txt', bytes: pattern(6, 4) },
      { name: 'photo‮gnp.exe', bytes: pattern(7, 5) },
      { name: 'a/b\\c:d.txt', bytes: pattern(8, 6) },
    ]);
    expect(stored).toEqual(['notes.txt', 'notes (1).txt', 'Notes (2).TXT', '_CON.txt', 'photo[U+202E]gnp.exe', 'a_b_c_d.txt']);
    expect(read.entries.map((e) => e.name), 'the archive holds the names startFile() returned').toEqual(stored);
    expect(new Set(read.entries.map((e) => e.name.toLowerCase())).size).toBe(stored.length);
  });
});

describe("core's ZIP writer: a member's size, given as it starts", () => {
  const expectRefused = (run: () => unknown) => expect(run).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));

  it('refuses more bytes than the size, and gives nothing more to onData', async () => {
    const chunks: Uint8Array[] = [];
    const writer = zip.writer((chunk) => { chunks.push(chunk); });
    writer.startFile('a.txt', 4);
    writer.writeChunk(pattern(3, 0));
    expectRefused(() => writer.writeChunk(pattern(2, 0)));
    await writer.drained().catch(() => {});
    const given = chunks.length;
    expectRefused(() => writer.writeChunk(pattern(1, 0)));
    expectRefused(() => writer.endFile());
    await expect(writer.finalize()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(chunks.length, 'nothing after the refusal').toBe(given);
  });

  it('refuses fewer bytes than the size at endFile(), and the archive is never finished', async () => {
    const writer = zip.writer(() => {});
    writer.startFile('a.txt', 4);
    writer.writeChunk(pattern(3, 0));
    expectRefused(() => writer.endFile());
    await expect(writer.finalize()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('refuses a size that is not a whole number of bytes, 0 or more', () => {
    for (const size of [-1, 1.5, Number.NaN, Infinity, 2 ** 53, '4' as unknown as number, undefined as unknown as number]) {
      expectRefused(() => zip.writer(() => {}).startFile('a.txt', size));
    }
  });

  it('refuses calls out of order, with errors that never name the file', async () => {
    const writer = zip.writer(() => {});
    expectRefused(() => writer.writeChunk(pattern(1, 0)));
    expectRefused(() => writer.endFile());
    writer.startFile('secret-plans.txt', 1);
    expectRefused(() => writer.startFile('b.txt', 1));
    await expect(writer.finalize()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    writer.writeChunk(pattern(1, 0));
    writer.endFile();
    await writer.finalize();
    expectRefused(() => writer.startFile('c.txt', 1));

    const sized = zip.writer(() => {});
    sized.startFile('secret-plans.txt', 1);
    const error = (() => { try { sized.writeChunk(pattern(2, 0)); } catch (err) { return err as DropgateError; } })();
    expect(error).toBeInstanceOf(DropgateError);
    expect(JSON.stringify({ message: error?.message, details: error?.details })).not.toContain('secret');
  });

  it("stops at onData's failure: nothing more is given to it, and drained() and finalize() throw its error", async () => {
    let calls = 0;
    const writer = zip.writer(() => { calls++; throw new Error('Disk full.'); });
    writer.startFile('a.txt', 2);
    writer.writeChunk(pattern(2, 0));
    await expect(writer.drained()).rejects.toThrow('Disk full.');
    expect(() => writer.endFile()).toThrow('Disk full.');
    await expect(writer.finalize()).rejects.toThrow('Disk full.');
    expect(calls).toBe(1);
  });
});

describe("core's ZIP writer: ZIP64 where the archive needs it", () => {
  it('a member of 4 GiB + 1 byte, with members before and after it: ZIP64 for that member, and offsets past 4 GiB', async () => {
    const recorder = recordArchive(ZEROS);
    const writer = zip.writer(recorder.onData);
    const before = pattern(100, 1);
    const after = pattern(200, 2);
    const big = 4 * GiB + 1;

    writer.startFile('before.txt', before.length);
    writer.writeChunk(before);
    writer.endFile();
    writer.startFile('big.bin', big);
    await writeZeros(writer, big);
    writer.endFile();
    writer.startFile('after.txt', after.length);
    writer.writeChunk(after);
    writer.endFile();
    await writer.finalize();
    expect(recorder.length).toBeGreaterThan(big);

    const read = readZip(recorder.segments);
    expect(read.entries.map((e) => [e.name, e.size])).toEqual([['before.txt', 100], ['big.bin', big], ['after.txt', 200]]);
    const [first, large, last] = read.entries;

    expect(first.versionNeeded).toBe(20);
    expect(first.zip64Extra).toEqual([]);

    expect(large.versionNeeded, 'version needed 4.5').toBe(45);
    expect(large.localVersionNeeded).toBe(45);
    expect(large.localZip64Extra, "a ZIP64 extra field in its local header, so its descriptor's sizes are 8 bytes").toBe(true);
    expect(large.descriptorLength).toBe(24);
    expect(large.zip64Extra, 'its sizes in the ZIP64 extra field').toEqual(['size', 'compressedSize']);
    expect(large.crc, "zlib's CRC-32 of 4 GiB + 1 zeros").toBe(read.crcOf(large));
    expect(read.allZero(large)).toBe(true);

    expect(last.offset).toBeGreaterThan(0xffffffff);
    expect(last.zip64Extra, 'its offset in the ZIP64 extra field').toEqual(['offset']);
    expect(last.versionNeeded).toBe(45);
    expect(last.localZip64Extra, 'a small member keeps a classic local header').toBe(false);
    expect(Buffer.from(read.bytesOf(last)).equals(Buffer.from(after))).toBe(true);
    expect(last.crc).toBe(zlib.crc32(after) >>> 0);

    expect(read.zip64, 'a ZIP64 end record and locator').toBe(true);
    expect(read.end, "the classic end record's directory offset is ZIP64's sentinel").toEqual({
      count: 3, directorySize: expect.any(Number), directoryOffset: 0xffffffff,
    });
  }, 120_000);

  it('offsets past 4 GiB with every member under 4 GiB: only the offsets go to ZIP64', async () => {
    const recorder = recordArchive(ZEROS);
    const writer = zip.writer(recorder.onData);
    const part = 1.5 * GiB;
    for (const name of ['one.bin', 'two.bin', 'three.bin']) {
      writer.startFile(name, part);
      await writeZeros(writer, part);
      writer.endFile();
    }
    const tail = pattern(50, 9);
    writer.startFile('tail.txt', tail.length);
    writer.writeChunk(tail);
    writer.endFile();
    await writer.finalize();

    const read = readZip(recorder.segments);
    expect(read.entries.map((e) => e.name)).toEqual(['one.bin', 'two.bin', 'three.bin', 'tail.txt']);
    for (const entry of read.entries.slice(0, 3)) {
      expect(entry.size).toBe(part);
      expect(entry.versionNeeded, `${entry.name} needs nothing of ZIP64`).toBe(20);
      expect(entry.zip64Extra).toEqual([]);
      expect(entry.localZip64Extra).toBe(false);
      expect(entry.crc).toBe(read.crcOf(entry));
      expect(read.allZero(entry)).toBe(true);
    }
    const tailEntry = read.entries[3];
    expect(tailEntry.offset).toBeGreaterThan(0xffffffff);
    expect(tailEntry.zip64Extra).toEqual(['offset']);
    expect(Buffer.from(read.bytesOf(tailEntry)).equals(Buffer.from(tail))).toBe(true);
    expect(read.zip64).toBe(true);
  }, 120_000);

  /** An archive of `count` one-byte members, named by number. */
  async function oneByteMembers(count: number): Promise<ReadArchive> {
    const recorder = recordArchive(ZEROS);
    const writer = zip.writer(recorder.onData);
    for (let i = 0; i < count; i++) {
      writer.startFile(`f${i}.bin`, 1);
      writer.writeChunk(Uint8Array.of(i & 0xff));
      writer.endFile();
      if (i % 4096 === 0) await writer.drained();
    }
    await writer.finalize();
    return readZip(recorder.segments);
  }

  it('65,534 one-byte members stay classic; 65,535 get the ZIP64 end records, the count read back whole', async () => {
    const classic = await oneByteMembers(65_534);
    expect(classic.zip64).toBe(false);
    expect(classic.end.count).toBe(65_534);
    expect(classic.entries.every((e) => e.versionNeeded === 20 && e.zip64Extra.length === 0)).toBe(true);

    const many = await oneByteMembers(65_535);
    expect(many.zip64, 'a ZIP64 end record and locator').toBe(true);
    expect(many.end.count, "the classic end record's count is ZIP64's sentinel").toBe(0xffff);
    expect(many.entries).toHaveLength(65_535);
    expect(many.entries.every((e) => e.size === 1 && e.versionNeeded === 20 && e.zip64Extra.length === 0), 'each member is classic').toBe(true);
    for (const i of [0, 1, 255, 256, 65_534]) {
      const entry = many.entries[i];
      expect(entry.name).toBe(`f${i}.bin`);
      expect([...many.bytesOf(entry)]).toEqual([i & 0xff]);
      expect(entry.crc).toBe(zlib.crc32(Uint8Array.of(i & 0xff)) >>> 0);
    }
  }, 120_000);
});
