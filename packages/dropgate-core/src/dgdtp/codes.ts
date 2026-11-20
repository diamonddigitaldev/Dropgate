import type { CryptoProvider } from '../crypto/index.js';
import { DropgateError } from '../errors.js';

// Direct transfer codes, such as ABCD-1234: four letters, then four digits.
// The first letters are the locator, which the rendezvous hands out from its
// pool and knows the room by; the rest is the password, made on the sender's
// device, which CPace (cpace.ts) runs on and which never leaves it. Two
// locator letters leave 576 rooms and 5.76 million passwords; a server set
// for more rooms at once uses three, and the password is then one letter and
// four digits. The split changes nothing else.
//
// Every character is drawn by rejection sampling over one random byte from
// the crypto provider (a letter from a byte under 240, taken mod 24; a digit
// from a byte under 250, mod 10), so each is exactly as likely as the others.
//
// A password is held as a CodePassword: its bytes are reachable only once, by
// the CPace exchange that spends it, and it shows as its label alone when
// printed, logged or serialised.

/** The 24 letters a code uses: no I or O, which read as 1 and 0. */
export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** The 10 digits a code uses. */
export const CODE_DIGITS = '0123456789';

/** How many letters a code has, then how many digits. */
export const CODE_LETTER_COUNT = 4;
export const CODE_DIGIT_COUNT = 4;

/** How many of the letters are the locator: 2, or 3 on a server set for more rooms. */
export type LocatorLetters = 2 | 3;

export const DEFAULT_LOCATOR_LETTERS: LocatorLetters = 2;

/** A byte under this, taken mod 24, is a letter; 240 is the largest multiple of 24 a byte can be under. */
const LETTER_BYTE_LIMIT = 240;

/** A byte under this, taken mod 10, is a digit. */
const DIGIT_BYTE_LIMIT = 250;

/** A code as typed, once whitespace is gone: the letters (either case), an optional dash, the digits. */
const TYPED_CODE = /^([A-HJ-NP-Za-hj-np-z]{4})-?([0-9]{4})$/;

const ascii = (text: string) => new TextEncoder().encode(text);

const invalidCode = () => new DropgateError({ code: 'INVALID_CODE' });

/**
 * A code's password, held privately. Its bytes (CPace's PRS: the password's
 * characters in upper case, without the dash) are reachable once, by
 * `spend()`, and then gone; `forget()` lets go of them unspent. Printed,
 * logged or serialised, it shows as `[CodePassword]`.
 */
export class CodePassword {
  #bytes: Uint8Array<ArrayBuffer> | undefined;

  private constructor(bytes: Uint8Array<ArrayBuffer>) {
    this.#bytes = bytes;
    Object.freeze(this);
  }

  /** A password of these characters. */
  static of(characters: string): CodePassword {
    return new CodePassword(ascii(characters));
  }

  /**
   * The password's bytes, for the one CPace exchange that uses it: the caller
   * overwrites them once used. Undefined if it was spent or forgotten.
   */
  static spend(password: CodePassword): Uint8Array<ArrayBuffer> | undefined {
    if (!(password instanceof CodePassword)) return undefined;
    const bytes = password.#bytes;
    password.#bytes = undefined;
    return bytes;
  }

  /** Overwrites the bytes, if they weren't spent. */
  forget(): void {
    this.#bytes?.fill(0);
    this.#bytes = undefined;
  }

  toJSON(): string { return '[CodePassword]'; }
  toString(): string { return '[CodePassword]'; }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return '[CodePassword]'; }
}

/** A code taken apart: the locator, the only part that leaves the device, and the password. */
export interface CodeParts {
  readonly locator: string;
  readonly password: CodePassword;
}

function checkLetters(letters: LocatorLetters): void {
  if (letters !== 2 && letters !== 3) {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'A code has 2 or 3 locator letters.' });
  }
}

/**
 * `count` characters of `alphabet`, each from one random byte under `limit`
 * taken mod the alphabet's length; a byte at or over the limit is thrown
 * away and another drawn. The bytes are overwritten once used.
 */
function draw(provider: CryptoProvider, alphabet: string, limit: number, count: number): string {
  let out = '';
  while (out.length < count) {
    const bytes = provider.randomBytes(count - out.length);
    for (const byte of bytes) {
      if (byte < limit) out += alphabet[byte % alphabet.length];
    }
    bytes.fill(0);
  }
  return out;
}

const drawLetters = (provider: CryptoProvider, count: number) => draw(provider, CODE_LETTERS, LETTER_BYTE_LIMIT, count);
const drawDigits = (provider: CryptoProvider, count: number) => draw(provider, CODE_DIGITS, DIGIT_BYTE_LIMIT, count);

/** The whole code, `ABCD-1234`, from its letters and digits. */
const codeOf = (letters: string, digits: string) => `${letters}-${digits}`;

/**
 * A whole new code, every character random: what `codes.generate()` gives.
 * A sender's real code has the rendezvous's locator in front (`newCode()`).
 */
export function generateCode(provider: CryptoProvider): string {
  return codeOf(drawLetters(provider, CODE_LETTER_COUNT), drawDigits(provider, CODE_DIGIT_COUNT));
}

/**
 * A sender's new code for the locator the rendezvous gave: the password's
 * letters and digits drawn on this device. `code` is what the sender's screen
 * shows, left out when the parts are serialised or copied; only `locator` is
 * ever sent.
 * @throws {DropgateError} INVALID_ARGUMENT if `locator` isn't `letters` of the code's letters.
 */
export function newCode(
  provider: CryptoProvider, locator: string, letters: LocatorLetters = DEFAULT_LOCATOR_LETTERS,
): CodeParts & { readonly code: string } {
  checkLetters(letters);
  if (typeof locator !== 'string' || locator.length !== letters || [...locator].some((c) => !CODE_LETTERS.includes(c))) {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: `A locator is ${letters} of a code's letters.` });
  }
  const passwordLetters = drawLetters(provider, CODE_LETTER_COUNT - letters);
  const digits = drawDigits(provider, CODE_DIGIT_COUNT);
  const parts = { locator, password: CodePassword.of(passwordLetters + digits) };
  Object.defineProperty(parts, 'code', { value: codeOf(locator + passwordLetters, digits), enumerable: false });
  return Object.freeze(parts) as CodeParts & { readonly code: string };
}

/**
 * A code as typed, in its one form: `ABCD-1234`. Spaces anywhere (and around
 * it) and lower case are fine, and the dash may be left out; anything else,
 * an I or an O included, isn't a code.
 * @throws {DropgateError} INVALID_CODE if it isn't one.
 */
export function normalizeCode(value: string): string {
  const match = typeof value === 'string' ? TYPED_CODE.exec(value.replace(/\s+/g, '')) : null;
  if (!match) throw invalidCode();
  return codeOf(match[1].toUpperCase(), match[2]);
}

/** Whether `value` is a code as someone might type it (`normalizeCode()` takes it). */
export function isCodeLike(value: unknown): boolean {
  return typeof value === 'string' && TYPED_CODE.test(value.replace(/\s+/g, ''));
}

/**
 * A typed code taken apart, before anything is sent: its locator (the first
 * `letters` letters) and its password (the rest, without the dash).
 * @throws {DropgateError} INVALID_CODE if it isn't a code.
 */
export function parseCode(value: string, letters: LocatorLetters = DEFAULT_LOCATOR_LETTERS): CodeParts {
  checkLetters(letters);
  const code = normalizeCode(value);
  return Object.freeze({
    locator: code.slice(0, letters),
    password: CodePassword.of(code.slice(letters).replace('-', '')),
  });
}
