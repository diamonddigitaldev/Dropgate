import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ROOT, inRepository } from '../scripts/copy-contents.mjs';
import { MAX_HELLO_BYTES } from '../src/dgdtp/channel.js';
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

// DGDTP.md's table of the secure channel's constants gives each one's value.
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
  NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES, MAX_HELLO_BYTES, NOISE_REKEY_INTERVAL, MAX_GENERATION,
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
