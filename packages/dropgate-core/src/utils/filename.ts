import { DropgateError, type ErrorOrigin } from '../errors.js';

// One file name rule, used by both protocols (hosted and direct).
//
// A name in a manifest, sent or received, is refused only when it's
// structurally invalid: empty, over 255 UTF-8 bytes, or holding a control
// character or a path separator. Everything else is fixed where a name is
// written out: `sanitizeFilename()` gives the name to save under, the same on
// every OS (Windows' rules apply everywhere), and `uniqueFilename()` resolves
// a collision as `name (1).ext`.
//
// Errors never carry the name itself (hard requirement 8).

/** The most UTF-8 bytes a file name may have. */
export const MAX_FILENAME_BYTES = 255;

const encoder = new TextEncoder();

const utf8Length = (s: string): number => encoder.encode(s).length;

// C0 and C1 controls, and DEL.
const CONTROL = /\p{Cc}/u;
const CONTROL_ALL = /\p{Cc}/gu;

// Bidi controls and zero-width (invisible) characters: each is shown as a
// visible `[U+XXXX]` in a saved name, so `photo‮gnp.exe` can't pass
// for `photo.png`.
const INVISIBLE = /[؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/gu;

// Characters Windows refuses in a name; `:` also covers `name:stream`.
const WINDOWS_ILLEGAL = /[<>:"/\\|?*]/g;

// Windows' reserved device names, with or without an extension (`CON.txt`).
const RESERVED = /^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(\s*)(\..*)?$/i;

const TRAILING_DOTS_AND_SPACES = /[. ]+$/;

/** Where a checked name is, for the error: its place in the list, and who sent it. */
export interface FilenameContext {
  index?: number;
  /** `server` or `peer` for a name received; this device's own by default. */
  origin?: ErrorOrigin;
}

/**
 * Checks a file name in a manifest, sent or received.
 * @throws {DropgateError} INVALID_FILENAME if it's empty, over 255 UTF-8 bytes,
 * or has a control character or path separator in it.
 */
export function validateFilename(filename: string, where: FilenameContext = {}): void {
  const invalid = (message: string): DropgateError => new DropgateError({
    code: 'INVALID_FILENAME',
    message,
    ...(where.origin ? { origin: where.origin } : {}),
    ...(where.index === undefined ? {} : { details: { index: where.index } }),
  });
  if (typeof filename !== 'string' || filename.trim().length === 0) {
    throw invalid('A file name is empty.');
  }
  if (utf8Length(filename) > MAX_FILENAME_BYTES) {
    throw invalid(`A file name is longer than ${MAX_FILENAME_BYTES} bytes.`);
  }
  if (CONTROL.test(filename)) {
    throw invalid('A file name has a control character in it.');
  }
  if (/[/\\]/.test(filename)) {
    throw invalid('A file name has a path in it.');
  }
}

/** Splits a name at its last dot into stem and extension (`.bashrc` has none). */
function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

/** The longest start of `s` that's at most `budget` UTF-8 bytes, never splitting a character. */
function truncateBytes(s: string, budget: number): string {
  let used = 0;
  let kept = '';
  for (const ch of s) {
    const size = utf8Length(ch);
    if (used + size > budget) break;
    used += size;
    kept += ch;
  }
  return kept;
}

/**
 * Joins a stem, a suffix and an extension within `MAX_FILENAME_BYTES`,
 * shortening the stem (or, for a very long extension, the whole name).
 */
function joinWithinLimit(stem: string, suffix: string, ext: string): string {
  const whole = stem + suffix + ext;
  if (utf8Length(whole) <= MAX_FILENAME_BYTES) return whole;
  if (utf8Length(suffix + ext) > MAX_FILENAME_BYTES / 2) {
    return truncateBytes(stem + ext, MAX_FILENAME_BYTES - utf8Length(suffix)) + suffix;
  }
  return truncateBytes(stem, MAX_FILENAME_BYTES - utf8Length(suffix + ext)) + suffix + ext;
}

/**
 * The name to save a received file under: the same on every OS, so it can be
 * written anywhere Dropgate runs. It's NFC; bidi and zero-width characters are
 * shown as `[U+XXXX]`; control characters and `< > : " / \ | ? *` become `_`;
 * trailing dots and spaces go; a Windows reserved name (`CON`, `NUL.txt`) gets
 * a leading `_`; and it fits 255 UTF-8 bytes. Never empty.
 */
export function sanitizeFilename(filename: string): string {
  let name = String(filename ?? '').normalize('NFC');
  name = name.replace(INVISIBLE, (ch) => `[U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`);
  name = name.replace(CONTROL_ALL, '_').replace(WINDOWS_ILLEGAL, '_');
  name = name.replace(TRAILING_DOTS_AND_SPACES, '');
  if (RESERVED.test(name)) name = `_${name}`;
  const [stem, ext] = splitExtension(name);
  name = joinWithinLimit(stem, '', ext).replace(TRAILING_DOTS_AND_SPACES, '');
  return name || '_';
}

/**
 * A name not already taken: the name itself, or `name (1).ext`, `name (2).ext`
 * and so on. Names are compared without regard to case, as Windows does.
 * @param taken - The names already used, or a function that says whether a name is.
 */
export function uniqueFilename(filename: string, taken: Iterable<string> | ((name: string) => boolean)): string {
  const isTaken = typeof taken === 'function'
    ? taken
    : ((set: Set<string>) => (name: string) => set.has(name.toLowerCase()))(
      new Set(Array.from(taken, (n) => String(n).toLowerCase())),
    );
  if (!isTaken(filename)) return filename;
  const [stem, ext] = splitExtension(filename);
  for (let n = 1; ; n++) {
    const candidate = joinWithinLimit(stem, ` (${n})`, ext);
    if (!isTaken(candidate)) return candidate;
  }
}
