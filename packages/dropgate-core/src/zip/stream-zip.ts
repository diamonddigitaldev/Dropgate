import { DropgateError } from '../errors.js';
import { sanitizeFilename, uniqueFilename } from '../utils/filename.js';
import { crc32 } from './crc32.js';

// A ZIP archive, stored (not compressed), written as it streams.
//
// Each member is a local header, its bytes, then a data descriptor with its
// CRC-32 and size (general purpose flag bit 3), with its name in UTF-8 (bit 11).
// The central directory and the end records follow the last member.
//
// ZIP64 is used only where the classic format can't hold a value: a member of
// 0xFFFFFFFF bytes or more, a member or the central directory starting at
// 0xFFFFFFFF or later, or 0xFFFF members or more. Then the ZIP64 extra field
// carries the values that don't fit, and the ZIP64 end record and its locator
// come before the classic end record. Any other archive is the classic format,
// "version needed" 2.0, with no ZIP64 record, which every reader opens.
//
// A member's size is given as it starts, so whether it needs ZIP64 is known
// before its first byte, and writing more or fewer bytes than that is refused.

const LOCAL_HEADER = 0x04034b50;
const DATA_DESCRIPTOR = 0x08074b50;
const CENTRAL_HEADER = 0x02014b50;
const ZIP64_END = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const END = 0x06054b50;

/** Bit 3: sizes and CRC-32 in a data descriptor. Bit 11: the name is UTF-8. */
const FLAGS = 0x0808;
const VERSION_CLASSIC = 20;
const VERSION_ZIP64 = 45;
const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;
const ZIP64_EXTRA = 0x0001;

/** How much of the central directory is gathered before it's passed on. */
const DIRECTORY_CHUNK = 64 * 1024;

interface Member {
  name: Uint8Array;
  size: number;
  crc: number;
  offset: number;
}

interface OpenMember extends Member {
  written: number;
}

const utf8 = new TextEncoder();

/** Writes little-endian values into a buffer, front to back. */
class Bytes {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private at = 0;

  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }

  u16(value: number): this { this.view.setUint16(this.at, value, true); this.at += 2; return this; }
  u32(value: number): this { this.view.setUint32(this.at, value >>> 0, true); this.at += 4; return this; }
  u64(value: number): this { this.view.setBigUint64(this.at, BigInt(value), true); this.at += 8; return this; }
  raw(value: Uint8Array): this { this.bytes.set(value, this.at); this.at += value.length; return this; }
}

/** The DOS time and date ZIP records, in local time; 1980 at the earliest. */
function dosDateTime(when: Date): { time: number; date: number } {
  const year = when.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    date: ((Math.min(year, 2107) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

function refused(message: string): DropgateError {
  return new DropgateError({ code: 'INVALID_ARGUMENT', message });
}

/**
 * Streaming ZIP writer that assembles files into a ZIP archive on the fly,
 * stored without compressing, never holding a file in memory. Works in Node.js
 * and browsers alike.
 *
 * The archive's bytes go to `onData` in order, one call at a time. A member's
 * bytes are passed on as they're given to `writeChunk()`, not copied, so don't
 * change them until `drained()` has resolved. Await `drained()` after writing
 * to wait for them, so a slow consumer slows the writer down instead of the
 * bytes piling up in memory. Once `onData` fails, or a member's size is wrong,
 * nothing more is given to `onData`, and `drained()` and `finalize()` throw
 * that error.
 */
export class StreamingZipWriter {
  private readonly onData: (chunk: Uint8Array) => void | Promise<void>;
  private readonly time: number;
  private readonly date: number;
  private readonly members: Member[] = [];
  /** The names stored so far, lower-cased, as `filenames.unique()` compares them. */
  private readonly taken = new Set<string>();
  private current: OpenMember | null = null;
  private offset = 0;
  private finalized = false;
  private pendingWrites: Promise<void> = Promise.resolve();
  private failed: { error: unknown } | null = null;

  constructor(onData: (chunk: Uint8Array) => void | Promise<void>) {
    this.onData = onData;
    ({ time: this.time, date: this.date } = dosDateTime(new Date()));
  }

  /**
   * Begins a member, `size` bytes long. Its name is made safe with
   * `filenames.sanitize()` and, if an earlier member has it, unique with
   * `filenames.unique()`. Must call endFile() before starting another file.
   * @param name - The file's name.
   * @param size - Exactly how many bytes will be written to it.
   * @returns The name it's stored under.
   * @throws {DropgateError} INVALID_ARGUMENT if a file is still open, the
   * archive is finalized, or the size isn't a whole number of bytes.
   */
  startFile(name: string, size: number): string {
    this.usable();
    if (this.current) throw refused('Must call endFile() before starting a new file.');
    if (!Number.isSafeInteger(size) || size < 0) {
      throw refused("A ZIP member's size must be a whole number of bytes, 0 or more.");
    }

    const stored = uniqueFilename(sanitizeFilename(name), (n) => this.taken.has(n.toLowerCase()));
    this.taken.add(stored.toLowerCase());
    const nameBytes = utf8.encode(stored);
    const zip64 = size >= MAX_32;

    // The CRC-32 and sizes follow the bytes, in the data descriptor. A ZIP64
    // member says so here with a ZIP64 extra field, so a reader knows its
    // descriptor's sizes are 8 bytes.
    const header = new Bytes(30 + nameBytes.length + (zip64 ? 20 : 0))
      .u32(LOCAL_HEADER)
      .u16(zip64 ? VERSION_ZIP64 : VERSION_CLASSIC)
      .u16(FLAGS)
      .u16(0) // stored
      .u16(this.time)
      .u16(this.date)
      .u32(0)
      .u32(zip64 ? MAX_32 : 0)
      .u32(zip64 ? MAX_32 : 0)
      .u16(nameBytes.length)
      .u16(zip64 ? 20 : 0)
      .raw(nameBytes);
    if (zip64) header.u16(ZIP64_EXTRA).u16(16).u64(0).u64(0);

    this.current = { name: nameBytes, size, crc: 0, offset: this.offset, written: 0 };
    this.emit(header.bytes);
    return stored;
  }

  /**
   * Writes the next bytes of the current member.
   * @param data - The data chunk to write.
   * @throws {DropgateError} INVALID_ARGUMENT if no file is started, or the
   * bytes would take the member past the size it was started with.
   */
  writeChunk(data: Uint8Array): void {
    this.usable();
    const member = this.current;
    if (!member) throw refused('No file started. Call startFile() first.');
    if (member.written + data.byteLength > member.size) {
      throw this.fail(refused('More bytes were written to a ZIP member than its size.'));
    }
    if (data.byteLength === 0) return;
    member.crc = crc32(data, member.crc);
    member.written += data.byteLength;
    this.emit(data);
  }

  /**
   * Ends the current member, with its data descriptor.
   * @throws {DropgateError} INVALID_ARGUMENT if no file is started, or fewer
   * bytes were written to it than its size.
   */
  endFile(): void {
    this.usable();
    const member = this.current;
    if (!member) throw refused('No file to end.');
    if (member.written !== member.size) {
      throw this.fail(refused('Fewer bytes were written to a ZIP member than its size.'));
    }
    const zip64 = member.size >= MAX_32;
    const descriptor = new Bytes(zip64 ? 24 : 16).u32(DATA_DESCRIPTOR).u32(member.crc);
    if (zip64) descriptor.u64(member.size).u64(member.size);
    else descriptor.u32(member.size).u32(member.size);
    this.current = null;
    this.members.push({ name: member.name, size: member.size, crc: member.crc, offset: member.offset });
    this.emit(descriptor.bytes);
  }

  /** Waits until `onData` has taken everything written so far. Throws its error if it failed. */
  async drained(): Promise<void> {
    await this.pendingWrites;
    if (this.failed) throw this.failed.error;
  }

  /**
   * Finalize the ZIP archive: writes the central directory and the end
   * records, then waits for `onData` to take them. Must be called after all
   * files are written.
   * @throws {DropgateError} INVALID_ARGUMENT if a file is still open.
   */
  async finalize(): Promise<void> {
    if (this.failed) throw this.failed.error;
    if (this.current) throw refused('Cannot finalize with an open file. Call endFile() first.');
    if (!this.finalized) {
      this.finalized = true;
      this.writeDirectory();
    }
    await this.drained();
  }

  private writeDirectory(): void {
    const directoryOffset = this.offset;
    let zip64 = this.members.length >= MAX_16 || directoryOffset >= MAX_32;

    let gathered: Uint8Array[] = [];
    let gatheredLength = 0;
    const flush = () => {
      if (gatheredLength === 0) return;
      const chunk = new Uint8Array(gatheredLength);
      let at = 0;
      for (const part of gathered) { chunk.set(part, at); at += part.length; }
      gathered = [];
      gatheredLength = 0;
      this.emit(chunk);
    };

    for (const member of this.members) {
      const bigSize = member.size >= MAX_32;
      const bigOffset = member.offset >= MAX_32;
      // The ZIP64 extra field holds, in this order, only the values the
      // record's own fields can't.
      const extraLength = (bigSize ? 16 : 0) + (bigOffset ? 8 : 0);
      const version = extraLength ? VERSION_ZIP64 : VERSION_CLASSIC;
      if (extraLength) zip64 = true;

      const record = new Bytes(46 + member.name.length + (extraLength ? 4 + extraLength : 0))
        .u32(CENTRAL_HEADER)
        .u16(version) // made by: MS-DOS, so readers apply their own file permissions
        .u16(version)
        .u16(FLAGS)
        .u16(0)
        .u16(this.time)
        .u16(this.date)
        .u32(member.crc)
        .u32(bigSize ? MAX_32 : member.size)
        .u32(bigSize ? MAX_32 : member.size)
        .u16(member.name.length)
        .u16(extraLength ? 4 + extraLength : 0)
        .u16(0) // comment
        .u16(0) // disk
        .u16(0) // internal attributes
        .u32(0) // external attributes
        .u32(bigOffset ? MAX_32 : member.offset)
        .raw(member.name);
      if (extraLength) {
        record.u16(ZIP64_EXTRA).u16(extraLength);
        if (bigSize) record.u64(member.size).u64(member.size);
        if (bigOffset) record.u64(member.offset);
      }
      gathered.push(record.bytes);
      gatheredLength += record.bytes.length;
      if (gatheredLength >= DIRECTORY_CHUNK) flush();
    }

    const directorySize = this.offset + gatheredLength - directoryOffset;
    if (directorySize >= MAX_32) zip64 = true;
    const count = this.members.length;

    if (zip64) {
      const recordOffset = this.offset + gatheredLength;
      const end64 = new Bytes(56 + 20)
        .u32(ZIP64_END)
        .u64(44) // the size of the rest of this record
        .u16(VERSION_ZIP64)
        .u16(VERSION_ZIP64)
        .u32(0) // this disk
        .u32(0) // the directory's disk
        .u64(count)
        .u64(count)
        .u64(directorySize)
        .u64(directoryOffset)
        .u32(ZIP64_LOCATOR)
        .u32(0) // the ZIP64 end record's disk
        .u64(recordOffset)
        .u32(1); // disks
      gathered.push(end64.bytes);
      gatheredLength += end64.bytes.length;
    }

    // In a ZIP64 archive, a value too big for its field here is 0xFFFF or
    // 0xFFFFFFFF, and the ZIP64 end record has it.
    const end = new Bytes(22)
      .u32(END)
      .u16(0)
      .u16(0)
      .u16(Math.min(count, MAX_16))
      .u16(Math.min(count, MAX_16))
      .u32(Math.min(directorySize, MAX_32))
      .u32(Math.min(directoryOffset, MAX_32))
      .u16(0); // comment
    gathered.push(end.bytes);
    gatheredLength += end.bytes.length;
    flush();
  }

  private usable(): void {
    if (this.failed) throw this.failed.error;
    if (this.finalized) throw refused('ZIP has already been finalized.');
  }

  /** Stops the archive: nothing more goes to `onData`, and every call after throws `error`. */
  private fail(error: DropgateError): DropgateError {
    this.failed ??= { error };
    return error;
  }

  private emit(chunk: Uint8Array): void {
    this.offset += chunk.byteLength;
    // Queued, so an async onData takes the bytes one call at a time, in order.
    this.pendingWrites = this.pendingWrites
      .then(() => (this.failed ? undefined : this.onData(chunk)))
      .catch((error: unknown) => { this.failed ??= { error }; });
  }
}
