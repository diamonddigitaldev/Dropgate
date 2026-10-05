import { describe, it, expect } from 'vitest';
import { filenames } from '../src/index.js';
import { DropgateError } from '../src/errors.js';
import { validateFilename } from '../src/utils/filename.js';

// 09 10.1 and 10.2: the one file name rule.

const utf8 = (s: string) => new TextEncoder().encode(s).length;

/** The DropgateError `run` throws. */
function thrownBy(run: () => unknown): DropgateError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(DropgateError);
    return err as DropgateError;
  }
  throw new Error('expected it to throw');
}

describe('filenames.validate (09 10.1, manifest validation)', () => {
  it('accepts ordinary and non-ASCII names', () => {
    for (const name of ['test.txt', 'my-file.pdf', 'ünïcode.txt', '写真.jpg', '🎉 party.png', 'a:b', 'CON.txt', 'a.', '.bashrc', 'photo‮gnp.exe']) {
      expect(() => filenames.validate(name), name).not.toThrow();
    }
  });

  it('rejects empty names', () => {
    expect(thrownBy(() => filenames.validate('')).code).toBe('INVALID_FILENAME');
    expect(thrownBy(() => filenames.validate('   ')).code).toBe('INVALID_FILENAME');
  });

  it('accepts a name of exactly 255 UTF-8 bytes, and rejects 256', () => {
    expect(() => filenames.validate('a'.repeat(255))).not.toThrow();
    const multiByte = 'é'.repeat(127) + 'a'; // 2 × 127 + 1 = 255 bytes
    expect(utf8(multiByte)).toBe(255);
    expect(() => filenames.validate(multiByte)).not.toThrow();
    expect(thrownBy(() => filenames.validate('a'.repeat(256))).code).toBe('INVALID_FILENAME');
  });

  it('rejects a name of 255 UTF-16 units that is more than 255 UTF-8 bytes', () => {
    const name = 'é'.repeat(255);
    expect(name.length).toBe(255);
    expect(utf8(name)).toBe(510);
    expect(thrownBy(() => filenames.validate(name)).code).toBe('INVALID_FILENAME');
  });

  it('rejects NUL and other control characters', () => {
    for (const name of ['a\u0000b', 'a\u0001b', 'tab\there', 'line\nbreak', 'del\u007F', 'c1\u0085']) {
      expect(thrownBy(() => filenames.validate(name)).code, JSON.stringify(name)).toBe('INVALID_FILENAME');
    }
  });

  it('rejects path separators', () => {
    for (const name of ['../test.txt', 'path/to/file.txt', 'path\\to\\file.txt', '..\\..\\x']) {
      expect(thrownBy(() => filenames.validate(name)).code, name).toBe('INVALID_FILENAME');
    }
  });

  it('never puts the name in the error, and says where a received name came from', () => {
    const secret = 'secret-plans\u0000.pdf';
    const err = thrownBy(() => validateFilename(secret, { index: 2, origin: 'peer' }));
    expect(JSON.stringify(err)).not.toContain('secret-plans');
    expect(err.message).not.toContain('secret-plans');
    expect(err).toMatchObject({ code: 'INVALID_FILENAME', origin: 'peer', details: { index: 2 } });
    expect(thrownBy(() => filenames.validate('')).origin).toBe('local');
  });
});

describe('filenames.sanitize (09 10.2, output sanitisation)', () => {
  it('normalises to NFC', () => {
    const decomposed = 'ünicode.txt'; // u + combining diaeresis
    expect(filenames.sanitize(decomposed)).toBe('ünicode.txt');
    expect(filenames.sanitize(decomposed)).toBe(filenames.sanitize('ünicode.txt'));
  });

  it('shows bidi overrides and zero-width characters as visible escapes', () => {
    expect(filenames.sanitize('photo‮gnp.exe')).toBe('photo[U+202E]gnp.exe');
    expect(filenames.sanitize('a‍b.txt')).toBe('a[U+200D]b.txt');
    expect(filenames.sanitize('​x⁦y⁩﻿.txt')).toBe('[U+200B]x[U+2066]y[U+2069][U+FEFF].txt');
    expect(filenames.sanitize('‎‏؜.txt')).toBe('[U+200E][U+200F][U+061C].txt');
  });

  it('handles Windows reserved names, with or without an extension, in any case', () => {
    expect(filenames.sanitize('CON')).toBe('_CON');
    expect(filenames.sanitize('CON.txt')).toBe('_CON.txt');
    expect(filenames.sanitize('nul.tar.gz')).toBe('_nul.tar.gz');
    expect(filenames.sanitize('Com1.log')).toBe('_Com1.log');
    expect(filenames.sanitize('LPT9')).toBe('_LPT9');
    expect(filenames.sanitize('CON .txt')).toBe('_CON .txt');
    expect(filenames.sanitize('CONSOLE.txt')).toBe('CONSOLE.txt');
    expect(filenames.sanitize('COM10.txt')).toBe('COM10.txt');
  });

  it('removes trailing dots and spaces', () => {
    expect(filenames.sanitize('a.')).toBe('a');
    expect(filenames.sanitize('report.pdf. . ')).toBe('report.pdf');
    expect(filenames.sanitize('...')).toBe('_');
    expect(filenames.sanitize('CON.')).toBe('_CON');
  });

  it('handles name:stream and the other characters Windows refuses', () => {
    expect(filenames.sanitize('a:b')).toBe('a_b');
    expect(filenames.sanitize('file.txt:hidden:$DATA')).toBe('file.txt_hidden_$DATA');
    expect(filenames.sanitize('what?<>|*".txt')).toBe('what______.txt');
  });

  it('is total: separators, controls and empty names still give a safe name', () => {
    expect(filenames.sanitize('..\\..\\x')).toBe('.._.._x');
    expect(filenames.sanitize('../etc/passwd')).toBe('.._etc_passwd');
    expect(filenames.sanitize('a\u0000b\nc')).toBe('a_b_c');
    expect(filenames.sanitize('')).toBe('_');
    expect(filenames.sanitize('.')).toBe('_');
    expect(filenames.sanitize('..')).toBe('_');
  });

  it('keeps ordinary non-ASCII names as they are', () => {
    for (const name of ['ünïcode.txt', '写真.jpg', '🎉 party.png', 'Résumé (final).docx', '.bashrc']) {
      expect(filenames.sanitize(name)).toBe(name);
    }
  });

  it('fits 255 UTF-8 bytes, keeping the extension and never splitting a character', () => {
    const long = '写'.repeat(100) + '.txt'; // 304 bytes
    const out = filenames.sanitize(long);
    expect(utf8(out)).toBeLessThanOrEqual(255);
    expect(out.endsWith('.txt')).toBe(true);
    expect(out).toBe('写'.repeat(83) + '.txt'); // 249 + 4 bytes; an 84th wouldn't fit
    const escaped = filenames.sanitize('‮'.repeat(40) + '.txt');
    expect(utf8(escaped)).toBeLessThanOrEqual(255);
    expect(escaped.endsWith('.txt')).toBe(true);
  });

  it('is deterministic and idempotent', () => {
    for (const name of ['photo‮gnp.exe', 'CON.txt', 'a.', 'a:b', '..\\..\\x', 'ü.txt', '写'.repeat(100) + '.txt']) {
      const once = filenames.sanitize(name);
      expect(filenames.sanitize(name)).toBe(once);
      expect(filenames.sanitize(once)).toBe(once);
      expect(() => filenames.validate(once)).not.toThrow();
    }
  });
});

describe('filenames.unique (09 10.2, collisions)', () => {
  it('keeps a name that is free', () => {
    expect(filenames.unique('a.txt', [])).toBe('a.txt');
    expect(filenames.unique('a.txt', ['b.txt'])).toBe('a.txt');
  });

  it('turns a collision into name (1).ext, then (2)', () => {
    expect(filenames.unique('a.txt', ['a.txt'])).toBe('a (1).txt');
    expect(filenames.unique('a.txt', ['a.txt', 'a (1).txt'])).toBe('a (2).txt');
    expect(filenames.unique('archive.tar.gz', ['archive.tar.gz'])).toBe('archive.tar (1).gz');
    expect(filenames.unique('README', ['README'])).toBe('README (1)');
    expect(filenames.unique('.bashrc', ['.bashrc'])).toBe('.bashrc (1)');
  });

  it('compares without regard to case, as Windows does', () => {
    expect(filenames.unique('Photo.JPG', ['photo.jpg'])).toBe('Photo (1).JPG');
  });

  it('takes a function that says whether a name is taken', () => {
    const onDisk = new Set(['a.txt', 'a (1).txt', 'a (2).txt']);
    expect(filenames.unique('a.txt', (n) => onDisk.has(n))).toBe('a (3).txt');
  });

  it('stays within 255 UTF-8 bytes', () => {
    const name = 'a'.repeat(251) + '.txt';
    const out = filenames.unique(name, [name]);
    expect(utf8(out)).toBe(255);
    expect(out.endsWith(' (1).txt')).toBe(true);
  });
});
