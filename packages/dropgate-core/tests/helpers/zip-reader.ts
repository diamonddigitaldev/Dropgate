// A ZIP reader for the tests, written from PKWARE's APPNOTE rather than from
// core's writer: it finds the end record (and ZIP64's, through its locator),
// walks the central directory, and checks each member's local header and data
// descriptor against it. It reads a recorded archive, where runs of zeros are
// kept as their length, so an archive of several GiB of zeros fits in memory.

import zlib from 'node:zlib';

/** One part of a recorded archive: bytes, or a run of zeros kept as its length. */
export type Segment = { bytes: Uint8Array } | { zeros: number };

/**
 * An `onData` that records an archive. Chunks from `zeros`' buffer are kept
 * as their length; everything else (headers, descriptors, small members) is
 * copied.
 */
export function recordArchive(zeros: Uint8Array) {
  const segments: Segment[] = [];
  let length = 0;
  return {
    segments,
    get length() { return length; },
    onData(chunk: Uint8Array) {
      length += chunk.byteLength;
      const last = segments[segments.length - 1];
      if (chunk.buffer === zeros.buffer) {
        if (last && 'zeros' in last) last.zeros += chunk.byteLength;
        else segments.push({ zeros: chunk.byteLength });
      } else {
        segments.push({ bytes: chunk.slice() });
      }
    },
  };
}

class Recorded {
  private readonly starts: number[] = [];
  readonly length: number;

  constructor(private readonly segments: Segment[]) {
    let at = 0;
    for (const s of segments) { this.starts.push(at); at += 'zeros' in s ? s.zeros : s.bytes.length; }
    this.length = at;
  }

  private segmentAt(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  read(offset: number, length: number): Uint8Array {
    if (offset < 0 || offset + length > this.length) throw new Error(`Read past the archive: ${offset}+${length} of ${this.length}`);
    const out = new Uint8Array(length);
    let at = 0;
    for (let i = this.segmentAt(offset); at < length; i++) {
      const s = this.segments[i];
      const within = offset + at - this.starts[i];
      const size = 'zeros' in s ? s.zeros : s.bytes.length;
      const take = Math.min(size - within, length - at);
      if ('bytes' in s) out.set(s.bytes.subarray(within, within + take), at);
      at += take;
    }
    return out;
  }

  /** Whether a range is all zeros: runs of zeros as they were recorded, and copied bytes checked. */
  isZero(offset: number, length: number): boolean {
    let at = 0;
    for (let i = this.segmentAt(offset); at < length; i++) {
      const s = this.segments[i];
      const within = offset + at - this.starts[i];
      const size = 'zeros' in s ? s.zeros : s.bytes.length;
      const take = Math.min(size - within, length - at);
      if ('bytes' in s && s.bytes.subarray(within, within + take).some((b) => b !== 0)) return false;
      at += take;
    }
    return true;
  }

  /** The CRC-32 of a range, with a run of zeros computed by zlib in 16 MiB steps. */
  crc(offset: number, length: number): number {
    const ZERO = new Uint8Array(16 << 20);
    let crc = 0;
    let at = 0;
    for (let i = this.segmentAt(offset); at < length; i++) {
      const s = this.segments[i];
      const within = offset + at - this.starts[i];
      const size = 'zeros' in s ? s.zeros : s.bytes.length;
      const take = Math.min(size - within, length - at);
      if ('bytes' in s) crc = zlib.crc32(s.bytes.subarray(within, within + take), crc);
      else for (let left = take; left > 0; left -= ZERO.length) crc = zlib.crc32(ZERO.subarray(0, Math.min(left, ZERO.length)), crc);
      at += take;
    }
    return crc >>> 0;
  }
}

export interface ReadEntry {
  name: string;
  /** The raw name bytes, as stored. */
  nameBytes: Uint8Array;
  flags: number;
  method: number;
  madeBy: number;
  versionNeeded: number;
  localVersionNeeded: number;
  crc: number;
  size: number;
  compressedSize: number;
  offset: number;
  /** Which values the central directory record's ZIP64 extra field held. */
  zip64Extra: Array<'size' | 'compressedSize' | 'offset'>;
  localZip64Extra: boolean;
  dataOffset: number;
  descriptorLength: number;
}

export interface ReadArchive {
  entries: ReadEntry[];
  /** Whether a ZIP64 end record and locator are present. */
  zip64: boolean;
  /** The classic end record's own fields, as written (sentinels included). */
  end: { count: number; directorySize: number; directoryOffset: number };
  directoryOffset: number;
  /** The CRC-32 of each member's bytes, computed by zlib. */
  crcOf(entry: ReadEntry): number;
  /** A member's bytes. */
  bytesOf(entry: ReadEntry): Uint8Array;
  /** Whether a member's bytes were recorded as a run of zeros (or are all zero). */
  allZero(entry: ReadEntry): boolean;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u64 = (v: DataView, at: number) => Number(v.getBigUint64(at, true));

/** Reads a recorded archive and checks every record's structure, throwing on any mismatch. */
export function readZip(segments: Segment[]): ReadArchive {
  const zip = new Recorded(segments);
  const fail = (what: string): never => { throw new Error(`Bad ZIP: ${what}`); };

  // The end record: 22 bytes, no comment.
  const endAt = zip.length - 22;
  const end = view(zip.read(endAt, 22));
  if (end.getUint32(0, true) !== 0x06054b50) fail('no end record at the end');
  if (end.getUint16(20, true) !== 0) fail('a comment');
  const end16 = { count: end.getUint16(10, true), directorySize: end.getUint32(12, true), directoryOffset: end.getUint32(16, true) };
  if (end.getUint16(8, true) !== end16.count) fail("the end record's two counts differ");

  let count = end16.count;
  let directorySize = end16.directorySize;
  let directoryOffset = end16.directoryOffset;
  let zip64 = false;
  let directoryEnd = endAt;

  if (endAt >= 20) {
    const locator = view(zip.read(endAt - 20, 20));
    if (locator.getUint32(0, true) === 0x07064b50) {
      zip64 = true;
      if (locator.getUint32(16, true) !== 1) fail('the locator counts more than one disk');
      const recordAt = u64(locator, 8);
      if (recordAt !== endAt - 20 - 56) fail('the ZIP64 end record is not right before its locator');
      const record = view(zip.read(recordAt, 56));
      if (record.getUint32(0, true) !== 0x06064b50) fail('no ZIP64 end record where the locator says');
      if (u64(record, 4) !== 44) fail("the ZIP64 end record's size");
      if (record.getUint16(14, true) < 45) fail("the ZIP64 end record's version needed");
      if (u64(record, 24) !== u64(record, 32)) fail("the ZIP64 end record's two counts differ");
      count = u64(record, 32);
      directorySize = u64(record, 40);
      directoryOffset = u64(record, 48);
      directoryEnd = recordAt;
      // Each classic field is its value, or the sentinel when it's too big.
      if (end16.count !== Math.min(count, 0xffff)) fail("the end record's count");
      if (end16.directorySize !== Math.min(directorySize, 0xffffffff)) fail("the end record's directory size");
      if (end16.directoryOffset !== Math.min(directoryOffset, 0xffffffff)) fail("the end record's directory offset");
    }
  }
  if (directoryOffset + directorySize !== directoryEnd) fail("the central directory doesn't end where the end records start");

  const directory = zip.read(directoryOffset, directorySize);
  const dv = view(directory);
  const entries: ReadEntry[] = [];
  let at = 0;
  let expectedOffset = 0;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(at, true) !== 0x02014b50) fail(`no central header ${i}`);
    const nameLength = dv.getUint16(at + 28, true);
    const extraLength = dv.getUint16(at + 30, true);
    const commentLength = dv.getUint16(at + 32, true);
    const nameBytes = directory.slice(at + 46, at + 46 + nameLength);
    let size = dv.getUint32(at + 24, true);
    let compressedSize = dv.getUint32(at + 20, true);
    let offset = dv.getUint32(at + 42, true);
    const zip64Extra: ReadEntry['zip64Extra'] = [];
    // Extra fields: only ZIP64's is expected, holding just the fields that are sentinels, in order.
    for (let e = at + 46 + nameLength; e < at + 46 + nameLength + extraLength;) {
      const id = dv.getUint16(e, true);
      const length = dv.getUint16(e + 2, true);
      if (id !== 0x0001) fail(`an unexpected extra field ${id}`);
      let f = e + 4;
      if (size === 0xffffffff) { size = u64(dv, f); f += 8; zip64Extra.push('size'); }
      if (compressedSize === 0xffffffff) { compressedSize = u64(dv, f); f += 8; zip64Extra.push('compressedSize'); }
      if (offset === 0xffffffff) { offset = u64(dv, f); f += 8; zip64Extra.push('offset'); }
      if (f - (e + 4) !== length) fail("the ZIP64 extra field's length doesn't match the sentinels");
      e += 4 + length;
    }
    if (dv.getUint16(at + 34, true) !== 0) fail('a disk number');

    // Its local header, bytes and data descriptor.
    if (offset !== expectedOffset) fail(`member ${i} doesn't start where the one before ended`);
    const local = view(zip.read(offset, 30));
    if (local.getUint32(0, true) !== 0x04034b50) fail(`no local header ${i}`);
    const localNameLength = local.getUint16(26, true);
    const localExtraLength = local.getUint16(28, true);
    const localName = zip.read(offset + 30, localNameLength);
    if (Buffer.compare(Buffer.from(localName), Buffer.from(nameBytes)) !== 0) fail(`member ${i}'s local name differs`);
    const flags = local.getUint16(6, true);
    if (flags !== dv.getUint16(at + 8, true)) fail(`member ${i}'s flags differ`);
    if (local.getUint16(8, true) !== dv.getUint16(at + 10, true)) fail(`member ${i}'s method differs`);
    let localZip64Extra = false;
    if (localExtraLength) {
      const extra = view(zip.read(offset + 30 + localNameLength, localExtraLength));
      if (extra.getUint16(0, true) !== 0x0001 || localExtraLength !== 20) fail(`member ${i}'s local extra field`);
      localZip64Extra = true;
    }
    if (flags & 0x0008) {
      // With a data descriptor, the local header's CRC is 0, and its sizes 0 (or ZIP64's sentinel).
      if (local.getUint32(14, true) !== 0) fail(`member ${i}'s local CRC isn't 0`);
      const sentinel = localZip64Extra ? 0xffffffff : 0;
      if (local.getUint32(18, true) !== sentinel || local.getUint32(22, true) !== sentinel) fail(`member ${i}'s local sizes`);
    }
    const dataOffset = offset + 30 + localNameLength + localExtraLength;
    const descriptorLength = localZip64Extra ? 24 : 16;
    const descriptor = view(zip.read(dataOffset + compressedSize, descriptorLength));
    if (descriptor.getUint32(0, true) !== 0x08074b50) fail(`member ${i}'s data descriptor`);
    const crc = dv.getUint32(at + 16, true);
    if (descriptor.getUint32(4, true) !== crc) fail(`member ${i}'s descriptor CRC differs`);
    const descriptorSizes = localZip64Extra
      ? [u64(descriptor, 8), u64(descriptor, 16)]
      : [descriptor.getUint32(8, true), descriptor.getUint32(12, true)];
    if (descriptorSizes[0] !== compressedSize || descriptorSizes[1] !== size) fail(`member ${i}'s descriptor sizes differ`);
    expectedOffset = dataOffset + compressedSize + descriptorLength;

    entries.push({
      name: new TextDecoder('utf-8', { fatal: true }).decode(nameBytes),
      nameBytes,
      flags,
      method: dv.getUint16(at + 10, true),
      madeBy: dv.getUint16(at + 4, true),
      versionNeeded: dv.getUint16(at + 6, true),
      localVersionNeeded: local.getUint16(4, true),
      crc,
      size,
      compressedSize,
      offset,
      zip64Extra,
      localZip64Extra,
      dataOffset,
      descriptorLength,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== directorySize) fail("the central directory's size doesn't match its records");
  if (expectedOffset !== directoryOffset) fail("the central directory doesn't start right after the last member");

  return {
    entries,
    zip64,
    end: end16,
    directoryOffset,
    crcOf: (entry) => zip.crc(entry.dataOffset, entry.compressedSize),
    bytesOf: (entry) => zip.read(entry.dataOffset, entry.compressedSize),
    allZero: (entry) => zip.isZero(entry.dataOffset, entry.compressedSize),
  };
}
