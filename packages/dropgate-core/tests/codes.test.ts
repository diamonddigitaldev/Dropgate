import { afterEach, describe, it, expect, vi } from 'vitest';
import { inspect } from 'node:util';
import { codes } from '../src/index.js';
import { webCryptoProvider, type CryptoProvider } from '../src/crypto/index.js';
import {
  CODE_DIGITS, CODE_LETTERS, CodePassword, generateCode, isCodeLike, newCode, normalizeCode, parseCode,
} from '../src/dgdtp/codes.js';

// Direct transfer codes: each character drawn evenly from the crypto
// provider's random bytes by rejection sampling, a million codes checked for
// bias, how a typed code is read, and the split into the locator, which is
// sent, and the password, which never leaves the device.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A provider whose random bytes are `bytes`, in order, keeping each array it gave out. */
function scripted(bytes: number[]): { provider: CryptoProvider; given: Uint8Array[] } {
  const queue = [...bytes];
  const given: Uint8Array[] = [];
  const provider = {
    randomBytes(length: number) {
      if (queue.length < length) throw new Error('The script ran out of bytes.');
      const out = Uint8Array.from(queue.splice(0, length));
      given.push(out);
      return out;
    },
  } as unknown as CryptoProvider;
  return { provider, given };
}

const real = webCryptoProvider(globalThis.crypto);

describe('code generation, by rejection sampling over one byte a character', () => {
  it('takes a letter from a byte under 240, mod 24, and a digit from a byte under 250, mod 10, drawing again for the rest', () => {
    // Letters: 240 and 255 thrown away; 0 is A, 239 is Z (239 mod 24 = 23), then 24 is A and 47 is Z.
    // Digits: 250 and 255 thrown away; 9, then 249 is 9, then 10 is 0 and 0 is 0.
    const { provider, given } = scripted([240, 0, 255, 239, 24, 47, 250, 9, 249, 255, 10, 0]);
    expect(generateCode(provider)).toBe('AZAZ-9900');
    // Each round asks for as many bytes as characters are still to come.
    expect(given.map((b) => b.byteLength)).toEqual([4, 2, 4, 2]);
    // And every byte drawn is overwritten once used.
    for (const bytes of given) expect([...bytes].every((b) => b === 0)).toBe(true);
  });

  it('maps exactly 10 byte values to each letter and 25 to each digit, and none past the limits', () => {
    const letters = new Map<string, number>();
    const digits = new Map<string, number>();
    for (let byte = 0; byte < 256; byte++) {
      // The byte in the first letter's place (then a 0 if it's thrown away), then bytes every place takes.
      const { provider: first } = scripted([byte, ...(byte >= 240 ? [0] : []), 0, 0, 0, 0, 0, 0, 0]);
      const letter = generateCode(first)[0];
      if (byte < 240) letters.set(letter, (letters.get(letter) ?? 0) + 1);
      else expect(letter).toBe('A');
      const { provider: digitFirst } = scripted([0, 0, 0, 0, byte, ...(byte >= 250 ? [0] : []), 0, 0, 0]);
      const digit = generateCode(digitFirst)[5];
      if (byte < 250) digits.set(digit, (digits.get(digit) ?? 0) + 1);
      else expect(digit).toBe('0');
    }
    expect([...letters.keys()].sort().join('')).toBe(CODE_LETTERS);
    expect([...letters.values()].every((n) => n === 10)).toBe(true);
    expect([...digits.keys()].sort().join('')).toBe(CODE_DIGITS);
    expect([...digits.values()].every((n) => n === 25)).toBe(true);
  });

  it("draws a sender's password on its own device, after the rendezvous's locator", () => {
    const { provider } = scripted([1, 2, 3, 4, 5, 6]);
    const two = newCode(provider, 'XY');
    expect(two.code).toBe('XYBC-3456');
    expect(two.locator).toBe('XY');
    expect(new TextDecoder().decode(CodePassword.spend(two.password))).toBe('BC3456');
    const { provider: again } = scripted([1, 2, 3, 4, 5]);
    const three = newCode(again, 'XYZ', 3);
    expect(three.code).toBe('XYZB-2345');
    expect(new TextDecoder().decode(CodePassword.spend(three.password))).toBe('B2345');
  });

  it("keeps the whole code out of the parts when they're serialised or copied", () => {
    const parts = newCode(real, 'AB');
    expect(parts.code).toMatch(/^AB[A-HJ-NP-Z]{2}-[0-9]{4}$/);
    expect(JSON.stringify(parts)).toBe('{"locator":"AB","password":"[CodePassword]"}');
    expect(Object.keys({ ...parts })).toEqual(['locator', 'password']);
    expect(inspect(parts)).not.toContain(parts.code.slice(2));
  });

  it("refuses a locator that isn't 2 or 3 of the code's letters", () => {
    for (const [locator, letters] of [['A', 2], ['ABC', 2], ['AB', 3], ['AI', 2], ['ab', 2], ['A1', 2], ['', 2]] as const) {
      expect(() => newCode(real, locator, letters as 2 | 3), locator).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    }
    expect(() => newCode(real, 'ABCD', 4 as 2)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('a million codes from the public generator', () => {
  // Chi-squared's upper tail at one in a million: a fair generator fails a
  // check about once in a million runs. 23 degrees of freedom for 24
  // letters, 9 for 10 digits.
  const LETTER_LIMIT = 70.55;
  const DIGIT_LIMIT = 44.81;
  const CODES = 1_000_000;

  const chiSquared = (counts: number[], total: number) => {
    const expected = total / counts.length;
    return counts.reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
  };

  /** Each place's count of each character, and the whole code's letters and digits together. */
  function tally(make: () => string) {
    const places = Array.from({ length: 8 }, (_, i) => new Array<number>(i < 4 ? 24 : 10).fill(0));
    for (let i = 0; i < CODES; i++) {
      const code = make();
      for (let p = 0; p < 4; p++) {
        const letter = CODE_LETTERS.indexOf(code[p]);
        if (letter < 0) throw new Error(`Not a code letter: ${code[p]}`);
        places[p][letter]++;
        const digit = CODE_DIGITS.indexOf(code[5 + p]);
        if (digit < 0) throw new Error(`Not a code digit: ${code[5 + p]}`);
        places[4 + p][digit]++;
      }
    }
    const sum = (from: number) => places[from].map((_, c) => places.slice(from, from + 4).reduce((n, place) => n + place[c], 0));
    return {
      letterPlaces: places.slice(0, 4).map((counts) => chiSquared(counts, CODES)),
      digitPlaces: places.slice(4).map((counts) => chiSquared(counts, CODES)),
      letters: chiSquared(sum(0), 4 * CODES),
      digits: chiSquared(sum(4), 4 * CODES),
    };
  }

  it("show no letter or digit bias, each from the crypto provider's random bytes alone, never Math.random()", () => {
    let calls = 0;
    const original = globalThis.crypto;
    const getRandomValues = <T extends ArrayBufferView>(array: T): T => {
      calls++;
      return original.getRandomValues(array as unknown as Uint8Array<ArrayBuffer>) as unknown as T;
    };
    const mathRandom = vi.spyOn(Math, 'random');
    vi.stubGlobal('crypto', { getRandomValues, subtle: original.subtle, randomUUID: () => original.randomUUID() });
    const result = tally(() => codes.generate());
    expect(calls).toBeGreaterThanOrEqual(2 * CODES);
    expect(mathRandom).not.toHaveBeenCalled();
    for (const [i, x] of result.letterPlaces.entries()) expect(x, `letter ${i + 1}`).toBeLessThan(LETTER_LIMIT);
    for (const [i, x] of result.digitPlaces.entries()) expect(x, `digit ${i + 1}`).toBeLessThan(DIGIT_LIMIT);
    expect(result.letters).toBeLessThan(LETTER_LIMIT);
    expect(result.digits).toBeLessThan(DIGIT_LIMIT);
  }, 60_000);

  it('would catch a byte taken mod 24 or mod 10 with no rejection, as Dropgate 3 drew them', () => {
    const v3 = () => {
      const b = real.randomBytes(8);
      return `${[...b.subarray(0, 4)].map((x) => CODE_LETTERS[x % 24]).join('')}-${[...b.subarray(4)].map((x) => x % 10).join('')}`;
    };
    const result = tally(v3);
    // 16 letters come up 11 times in 256 and 8 come up 10; digits 0–5 26 times, 6–9 25.
    for (const x of result.letterPlaces) expect(x).toBeGreaterThan(10 * LETTER_LIMIT);
    for (const x of result.digitPlaces) expect(x).toBeGreaterThan(3 * DIGIT_LIMIT);
  }, 60_000);
});

describe('a typed code', () => {
  it('is read the same with lower case, spaces anywhere and no dash', () => {
    for (const typed of ['ABCD-1234', 'abcd-1234', ' ABCD-1234 ', 'ABCD1234', 'abcd1234', 'a b c d 1 2 3 4', 'AbCd\t-\n1234', ' ABCD 1234 ']) {
      expect(normalizeCode(typed), JSON.stringify(typed)).toBe('ABCD-1234');
      expect(isCodeLike(typed), JSON.stringify(typed)).toBe(true);
      expect(codes.isLike(typed), JSON.stringify(typed)).toBe(true);
    }
  });

  it("isn't a code with an I or an O, the wrong length, another dash or character, or digits that aren't 0–9", () => {
    for (const typed of [
      'ABCI-1234', 'abco-1234', 'IBCD-1234', 'ABC-1234', 'ABCDE-1234', 'ABCD-123', 'ABCD-12345', 'ABCD--1234', '-ABCD1234',
      'ABCD1234-', 'AB-CD1234', 'ABCD_1234', 'ABCD–1234', '1234-ABCD', 'ABCD-123A', 'ABC1-1234', 'ßBCD-1234',
      'ＡBCD-1234', 'ABCD-١٢٣٤', 'ABCD​1234', 'ıBCD-1234', '', '   ',
    ]) {
      expect(() => normalizeCode(typed), JSON.stringify(typed)).toThrow(expect.objectContaining({ code: 'INVALID_CODE', origin: 'local' }));
      expect(isCodeLike(typed), JSON.stringify(typed)).toBe(false);
      expect(() => parseCode(typed), JSON.stringify(typed)).toThrow(expect.objectContaining({ code: 'INVALID_CODE' }));
    }
    for (const value of [undefined, null, 12345678, { code: 'ABCD-1234' }]) {
      expect(isCodeLike(value)).toBe(false);
      expect(() => normalizeCode(value as unknown as string)).toThrow(expect.objectContaining({ code: 'INVALID_CODE' }));
    }
  });

  it('says nothing of what was typed when it refuses it', () => {
    try {
      parseCode('ABCI-9876');
      expect.unreachable();
    } catch (err) {
      expect(`${(err as Error).message} ${JSON.stringify(err)} ${inspect(err)}`).not.toMatch(/9876|ABCI/);
    }
  });

  it('splits into the locator and the password: 2 locator letters, or 3', () => {
    const two = parseCode('ab cd 1234');
    expect(two.locator).toBe('AB');
    expect(new TextDecoder().decode(CodePassword.spend(two.password))).toBe('CD1234');
    const three = parseCode('abcd1234', 3);
    expect(three.locator).toBe('ABC');
    expect(new TextDecoder().decode(CodePassword.spend(three.password))).toBe('D1234');
    expect(() => parseCode('ABCD-1234', 4 as 2)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe("a code's password", () => {
  it('shows as its label alone, printed, logged or serialised', () => {
    const parts = parseCode('ABCD-1234');
    expect(`${JSON.stringify(parts)} ${String(parts.password)} ${inspect(parts)}`)
      .toBe(`{"locator":"AB","password":"[CodePassword]"} [CodePassword] ${inspect({ locator: 'AB', password: parts.password })}`);
    expect(inspect(parts)).not.toContain('1234');
    expect(Object.keys(parts.password)).toEqual([]);
  });

  it('gives its bytes once; forgotten, never', () => {
    const { password } = parseCode('ABCD-1234');
    expect(CodePassword.spend(password)).toEqual(new TextEncoder().encode('CD1234'));
    expect(CodePassword.spend(password)).toBeUndefined();
    const other = parseCode('ABCD-1234').password;
    other.forget();
    expect(CodePassword.spend(other)).toBeUndefined();
    expect(CodePassword.spend({} as CodePassword)).toBeUndefined();
  });
});
