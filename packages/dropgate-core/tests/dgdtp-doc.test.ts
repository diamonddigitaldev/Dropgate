import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ROOT, inRepository } from '../scripts/copy-contents.mjs';
import { DEFAULT_RECONNECT_WINDOW_SECONDS, MIN_RECORD_BYTES } from '../src/dgdtp/channel.js';
import {
  CPACE_ATTEMPT_ID_BYTES, CPACE_MESSAGE1_BYTES, CPACE_MESSAGE2_BYTES, CPACE_MESSAGE3_BYTES, CPACE_ROOM_NONCE_BYTES,
} from '../src/dgdtp/cpace.js';
import { CLOSE_SECRET_BYTES, ISK_BYTES, LINK_SECRET_BYTES, PSK_BYTES, RESUME_SECRET_BYTES, ROOM_ID_BYTES } from '../src/dgdtp/keys.js';
import {
  NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES, NOISE_MAX_MESSAGE_BYTES, NOISE_MAX_RECORD_PLAINTEXT_BYTES, NOISE_PROTOCOL_NAME,
  NOISE_REKEY_INTERVAL,
} from '../src/dgdtp/noise.js';
import { MAX_GENERATION, PROLOGUE_BYTES } from '../src/dgdtp/prologue.js';
import {
  FRAME_HEADER_BYTES, LARGE_BUCKET_BYTES, MAX_CLOSE_BODY_BYTES, MAX_FRAMES_EACH_WAY, MAX_FRAME_BYTES, SDP_BUCKET_BYTES,
  SMALL_BUCKET_BYTES,
} from '../src/dgdtp/seal.js';
import { DATA_CHANNEL_LABEL, LOW_WATER_BYTES } from '../src/dgdtp/webrtc.js';
import {
  CREDIT_STEP_BYTES, CREDIT_WINDOW_BYTES, ENCRYPT_AHEAD, MAX_UNFINISHED_FILE_ENDS, PUMP_HIGH_WATER_BYTES, RESULT_ACK_WAIT_MS,
  SOURCE_BLOCKS_AHEAD,
} from '../src/dgdtp/engine.js';
import { CODE_RETRY_MS, RENDEZVOUS_PATH, RENEW_INTERVAL_MS } from '../src/dgdtp/rendezvous.js';
import {
  CLOSE_ACK_WAIT_MS, HANDSHAKE_TIMEOUT_MS, ICE_TIMEOUT_MS, LATE_CLOSE_WAIT_MS, MIN_NO_ANSWER_MS, NO_ANSWER_RTTS, NO_PROGRESS_MS,
  OFFER_TIMEOUT_MS, PING_INTERVAL_MS, SETUP_TIMEOUT_MS, STALL_FAILED_MS, STALL_SHOWN_MS,
} from '../src/dgdtp/timers.js';
import {
  ASSURANCES, BIND_BYTES, BLOCK_BYTES, CLOSE_DETAILS, CLOSE_REASONS, DATA_HEADER_BYTES, HELLO_BYTES, MANIFEST_HEADER_BYTES, MANIFEST_VERSION,
  MAX_MANIFEST_BYTES, MAX_MANIFEST_FILES, MAX_MEDIA_TYPE_BYTES, MESSAGE_TYPE, decodeMessage, encodeMessage,
} from '../src/dgdtp/messages.js';
import { STATUS_STATE } from '../src/dgdtp/engine.js';
import { RENDEZVOUS_ERROR, RENDEZVOUS_TYPE } from '../src/dgdtp/rendezvous.js';
import messageVectors from './fixtures/dgdtp-message-vectors.json';
import {
  MAX_PAUSE_LIMIT_MS, MAX_RECONNECT_WINDOW_MS, MIN_PAUSE_LIMIT_MS, MIN_RECONNECT_WINDOW_MS,
} from '../src/client/direct.js';

// DGDTP.md's table of the secure channel's, the rendezvous client's, the
// engine's and the handles' constants gives each one's value.
// The docs checks read names, not values, so this holds the table to the code:
// every constant the table names is one of these, with the value it gives, and
// every one of these is in the table. Unpacked on its own, from a release's
// source archive, the package has no docs, so this is skipped.

const DOC = 'docs/technical/DGDTP.md';

const CONSTANTS: Record<string, number | bigint | string> = {
  NOISE_PROTOCOL_NAME,
  CPACE_MESSAGE1_BYTES, CPACE_MESSAGE2_BYTES, CPACE_MESSAGE3_BYTES, CPACE_ROOM_NONCE_BYTES, CPACE_ATTEMPT_ID_BYTES,
  LINK_SECRET_BYTES, RESUME_SECRET_BYTES, CLOSE_SECRET_BYTES, ISK_BYTES, ROOM_ID_BYTES, PSK_BYTES,
  FRAME_HEADER_BYTES, SMALL_BUCKET_BYTES, SDP_BUCKET_BYTES, LARGE_BUCKET_BYTES, MAX_FRAME_BYTES, MAX_FRAMES_EACH_WAY,
  MAX_CLOSE_BODY_BYTES, PROLOGUE_BYTES, NOISE_MAX_MESSAGE_BYTES, NOISE_MAX_RECORD_PLAINTEXT_BYTES,
  NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES, NOISE_REKEY_INTERVAL, MAX_GENERATION,
  DATA_CHANNEL_LABEL, MIN_RECORD_BYTES, LOW_WATER_BYTES,
  RENDEZVOUS_PATH, RENEW_INTERVAL_MS, CODE_RETRY_MS,
  HELLO_BYTES, BIND_BYTES, MANIFEST_HEADER_BYTES, DATA_HEADER_BYTES, BLOCK_BYTES, MAX_MANIFEST_BYTES, MAX_MANIFEST_FILES,
  MAX_MEDIA_TYPE_BYTES, MANIFEST_VERSION,
  DEFAULT_RECONNECT_WINDOW_SECONDS, CREDIT_WINDOW_BYTES, CREDIT_STEP_BYTES, PUMP_HIGH_WATER_BYTES, SOURCE_BLOCKS_AHEAD,
  ENCRYPT_AHEAD, MAX_UNFINISHED_FILE_ENDS, RESULT_ACK_WAIT_MS,
  ICE_TIMEOUT_MS, HANDSHAKE_TIMEOUT_MS, SETUP_TIMEOUT_MS, OFFER_TIMEOUT_MS, PING_INTERVAL_MS, MIN_NO_ANSWER_MS, NO_ANSWER_RTTS,
  NO_PROGRESS_MS, STALL_SHOWN_MS, STALL_FAILED_MS, CLOSE_ACK_WAIT_MS, LATE_CLOSE_WAIT_MS,
  MIN_PAUSE_LIMIT_MS, MAX_PAUSE_LIMIT_MS, MIN_RECONNECT_WINDOW_MS, MAX_RECONNECT_WINDOW_MS,
};

/** A value as the table writes it: `a string`, 8,230, or 2⁶⁴ − 1. */
function valueOf(cell: string): number | bigint | string {
  const code = /^`([^`]*)`$/.exec(cell);
  if (code) return code[1];
  if (cell === '2⁶⁴ − 1') return (1n << 64n) - 1n;
  if (/^\d{1,3}(?:,\d{3})*$/.test(cell)) return Number(cell.replace(/,/g, ''));
  throw new Error(`a value the test can't read: ${cell}`);
}

/** The rows of the table under "Constants" in the secure channel's section: each name with the value the table gives it. */
function tableRows(markdown: string): Array<{ name: string; value: number | bigint | string }> {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const heading = lines.findIndex((line) => /^### 4\.\d+ Constants$/.test(line));
  expect(heading, `${DOC} has no "Constants" heading in its secure channel's section`).toBeGreaterThan(-1);
  const rows: Array<{ name: string; value: number | bigint | string }> = [];
  for (const line of lines.slice(heading + 1)) {
    if (/^#{1,3} /.test(line)) break;
    if (!line.startsWith('| `')) continue;
    const [names, values] = line.split('|').slice(1, 3).map((cell) => cell.trim());
    const nameList = names.split(',').map((name) => name.trim().replace(/^`|`$/g, ''));
    const valueList = values.startsWith('`') ? [values] : values.split(/,\s+/);
    // One value for every name, or one for each.
    expect(valueList.length === 1 || valueList.length === nameList.length, `${line}: a value for each name, or one for all`).toBe(true);
    nameList.forEach((name, i) => rows.push({ name, value: valueOf(valueList.length === 1 ? valueList[0] : valueList[i]) }));
  }
  return rows;
}

describe.skipIf(!inRepository())("DGDTP.md's constants (in the repository only)", () => {
  it('gives every constant of the secure channel the value core has', () => {
    const path = new URL(DOC, ROOT);
    expect(existsSync(path)).toBe(true);
    const rows = tableRows(readFileSync(path, 'utf8'));
    for (const { name, value } of rows) {
      expect(Object.prototype.hasOwnProperty.call(CONSTANTS, name), `${DOC} names ${name}, which this test doesn't know`).toBe(true);
      expect(value, `${DOC} gives ${name}`).toBe(CONSTANTS[name]);
    }
    expect(rows.map(({ name }) => name).sort()).toEqual(Object.keys(CONSTANTS).sort());
  });

  it('reads the values the table writes, and refuses one it can\'t read', () => {
    expect(valueOf('8,230')).toBe(8230);
    expect(valueOf('16')).toBe(16);
    expect(valueOf('2⁶⁴ − 1')).toBe((1n << 64n) - 1n);
    expect(valueOf('`Noise_NNpsk0_25519_AESGCM_SHA256`')).toBe('Noise_NNpsk0_25519_AESGCM_SHA256');
    expect(() => valueOf('8230 bytes')).toThrow();
    expect(() => valueOf('8,23')).toThrow();
  });
});

// DGDTP.md's tables of the wire: the rendezvous's messages and ERROR's codes,
// the engine's records with their lengths, and the values their fields take.
// Each table is held to core's own, both ways: every row is one of core's,
// with its number, and every one of core's has a row. The records' lengths
// are held to the second implementation's vectors, which core's bytes match.

/** A table's rows after `marker` (a heading, or a bold line): each row's cells, trimmed, the header and its rule left out. */
function tableAfter(markdown: string, marker: RegExp): string[][] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((line) => marker.test(line));
  expect(at, `${DOC} has no line like ${marker}`).toBeGreaterThan(-1);
  const rows: string[][] = [];
  let inTable = false;
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('|')) {
      inTable = true;
      rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim()));
    } else if (inTable || /^#{1,3} /.test(line)) {
      break;
    }
  }
  // The header and the rule under it.
  return rows.slice(2);
}

/** A row's number, written as 7 or 0x83. */
const numberOf = (cell: string): number => {
  const plain = cell.replace(/^`|`$/g, '');
  if (/^0x[0-9A-F]{2}$/.test(plain)) return parseInt(plain.slice(2), 16);
  if (/^\d+$/.test(plain)) return Number(plain);
  throw new Error(`a number the test can't read: ${cell}`);
};
const nameOf = (cell: string) => cell.replace(/^`|`$/g, '');

/** `{ name: number }` from a table's rows, its number in column `n` and its name in column `m`. */
const pairs = (rows: string[][], n = 0, m = 1) => Object.fromEntries(rows.map((row) => [nameOf(row[m]), numberOf(row[n])]));

/** Each record type's lengths in the second implementation's vectors. */
function vectorLengths(): Map<number, Set<number>> {
  const lengths = new Map<number, Set<number>>();
  for (const { record } of messageVectors.records as Array<{ record: string }>) {
    const type = parseInt(record.slice(0, 2), 16);
    if (!lengths.has(type)) lengths.set(type, new Set());
    (lengths.get(type) as Set<number>).add(record.length / 2);
  }
  return lengths;
}

/** The lengths a "Bytes" cell gives, as 51, "18 or 79" or "10, 21 or 82"; none for a record whose length is its content's. */
function lengthsOf(cell: string): number[] | undefined {
  if (!/^\d/.test(cell)) return undefined;
  return cell.split(/,\s*|\s+or\s+/).map((part) => {
    if (!/^\d+$/.test(part)) throw new Error(`a length the test can't read: ${cell}`);
    return Number(part);
  });
}

describe.skipIf(!inRepository())("DGDTP.md's tables of the wire (in the repository only)", () => {
  const markdown = () => readFileSync(new URL(DOC, ROOT), 'utf8');

  it("gives the rendezvous's messages core's type bytes, each from the side that sends it", () => {
    const rows = tableAfter(markdown(), /^### 5\.2 Messages$/);
    expect(pairs(rows)).toEqual({ ...RENDEZVOUS_TYPE });
    for (const [type, name, from] of rows) {
      const value = numberOf(type);
      const side = value >= 0x80 ? 'The server' : value >= 0x10 ? 'A receiver' : 'The sender';
      expect(`${name}: ${from}`).toBe(`${name}: ${side}`);
    }
  });

  it("gives ERROR's codes core's numbers", () => {
    expect(pairs(tableAfter(markdown(), /^\*\*`ERROR`'s codes:\*\*$/))).toEqual({ ...RENDEZVOUS_ERROR });
  });

  it("gives every record core's type and the second implementation's lengths", () => {
    const rows = tableAfter(markdown(), /^### 8\.1 The Records$/);
    expect(pairs(rows)).toEqual({ ...MESSAGE_TYPE });
    const lengths = vectorLengths();
    for (const row of rows) {
      const want = lengthsOf(row[row.length - 1]);
      const type = numberOf(row[0]);
      if (want === undefined) {
        // MANIFEST and DATA are as long as what they carry; RESUME and RESUME_OK are kept, with no length yet.
        expect([MESSAGE_TYPE.MANIFEST, MESSAGE_TYPE.DATA, MESSAGE_TYPE.RESUME, MESSAGE_TYPE.RESUME_OK], row[1]).toContain(type);
        continue;
      }
      expect([...(lengths.get(type) ?? [])].sort((a, b) => a - b), row[1]).toEqual(want);
    }
  });

  it("gives CLOSE's reasons and details core's numbers", () => {
    const reasons = pairs(tableAfter(markdown(), /^\*\*`CLOSE`'s reason\*\*/));
    expect(reasons).toEqual(Object.fromEntries(CLOSE_REASONS.map((reason, i) => [reason, i + 1])));
    const details = pairs(tableAfter(markdown(), /^\*\*`CLOSE`'s detail,\*\*/));
    expect(details).toEqual(Object.fromEntries(CLOSE_DETAILS.map((detail, i) => [detail, i + 1])));
  });

  it("gives ACCEPT's sink and RESULT's assurance, HOLD's reasons and STATUS's states core's values", () => {
    expect(pairs(tableAfter(markdown(), /^\*\*`ACCEPT`'s sink, and `RESULT`'s assurance:\*\*$/)))
      .toEqual(Object.fromEntries(ASSURANCES.map((assurance, i) => [assurance, i + 1])));

    // HOLD's reasons as core writes them, and any other value read as the person.
    const holds = pairs(tableAfter(markdown(), /^\*\*`HOLD`'s reason\*\*/));
    for (const [reason, value] of Object.entries(holds)) {
      expect(encodeMessage({ type: 'hold', held: true, reason: reason as 'person' | 'app' })[2], reason).toBe(value);
    }
    expect(Object.keys(holds).sort()).toEqual(['app', 'person']);
    expect(decodeMessage(Uint8Array.of(MESSAGE_TYPE.HOLD, 1, 9))).toMatchObject({ reason: 'person' });

    const states = tableAfter(markdown(), /^\*\*`STATUS`'s state:\*\*$/).filter((row) => row[1] !== '—');
    expect(pairs(states)).toEqual({ ...STATUS_STATE });
  });

  it('reads the numbers the tables write, and refuses one it can\'t read', () => {
    expect(numberOf('`0x83`')).toBe(0x83);
    expect(numberOf('12')).toBe(12);
    expect(() => numberOf('0x8')).toThrow();
    expect(lengthsOf('18 or 79')).toEqual([18, 79]);
    expect(lengthsOf('10, 21 or 82')).toEqual([10, 21, 82]);
    expect(lengthsOf('at most the record size − 16')).toBeUndefined();
    expect(() => lengthsOf('51 bytes')).toThrow();
  });
});
