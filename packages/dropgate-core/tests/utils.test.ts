import { describe, it, expect } from 'vitest';
import { lifetime, filenames, hosts, codes } from '../src/index.js';
import { bytesToBase64, base64ToBytes, arrayBufferToBase64 } from '../src/utils/base64.js';
import { parseServerUrl, buildBaseUrl } from '../src/utils/network.js';

const lifetimeToMs = lifetime.toMs;
const validatePlainFilename = filenames.validate;
const isLocalhostHostname = hosts.isLocalhost;
const isSecureContextForP2P = hosts.isSecureForDirect;
const generateP2PCode = codes.generate;
const isP2PCodeLike = codes.isLike;
import { DropgateError } from '../src/errors.js';

/** The code of the DropgateError `run` throws. */
function codeThrownBy(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(DropgateError);
    return (err as DropgateError).code;
  }
  throw new Error('expected it to throw');
}

describe('lifetime.toMs', () => {
  it('converts minutes to milliseconds', () => {
    expect(lifetimeToMs(1, 'minutes')).toBe(60000);
    expect(lifetimeToMs(5, 'minutes')).toBe(300000);
  });

  it('converts hours to milliseconds', () => {
    expect(lifetimeToMs(1, 'hours')).toBe(3600000);
    expect(lifetimeToMs(24, 'hours')).toBe(86400000);
  });

  it('converts days to milliseconds', () => {
    expect(lifetimeToMs(1, 'days')).toBe(86400000);
    expect(lifetimeToMs(7, 'days')).toBe(604800000);
  });

  it('returns 0 for unlimited', () => {
    expect(lifetimeToMs(999, 'unlimited')).toBe(0);
  });

  it('returns 0 for invalid inputs', () => {
    expect(lifetimeToMs(-1, 'hours')).toBe(0);
    expect(lifetimeToMs(NaN, 'hours')).toBe(0);
    expect(lifetimeToMs(1, 'invalid')).toBe(0);
  });
});

describe('filenames.validate', () => {
  it('accepts valid filenames', () => {
    expect(() => validatePlainFilename('test.txt')).not.toThrow();
    expect(() => validatePlainFilename('my-file.pdf')).not.toThrow();
    expect(() => validatePlainFilename('document_v2.docx')).not.toThrow();
  });

  it('rejects empty filenames', () => {
    expect(codeThrownBy(() => validatePlainFilename(''))).toBe('INVALID_FILENAME');
    expect(codeThrownBy(() => validatePlainFilename('   '))).toBe('INVALID_FILENAME');
  });

  it('rejects filenames with path separators', () => {
    expect(codeThrownBy(() => validatePlainFilename('../test.txt'))).toBe('INVALID_FILENAME');
    expect(codeThrownBy(() => validatePlainFilename('path/to/file.txt'))).toBe('INVALID_FILENAME');
    expect(codeThrownBy(() => validatePlainFilename('path\\to\\file.txt'))).toBe('INVALID_FILENAME');
  });

  it('rejects filenames that are too long', () => {
    const longName = 'a'.repeat(256);
    expect(codeThrownBy(() => validatePlainFilename(longName))).toBe('INVALID_FILENAME');
  });
});

describe('base64 encoding/decoding', () => {
  it('encodes and decodes bytes correctly', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const encoded = bytesToBase64(original);
    expect(encoded).toBe('SGVsbG8=');

    const decoded = base64ToBytes(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('handles empty arrays', () => {
    const empty = new Uint8Array([]);
    const encoded = bytesToBase64(empty);
    expect(encoded).toBe('');

    const decoded = base64ToBytes(encoded);
    expect(decoded.length).toBe(0);
  });

  it('encodes ArrayBuffer correctly', () => {
    const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;
    const encoded = arrayBufferToBase64(buffer);
    expect(encoded).toBe('SGVsbG8=');
  });
});

describe('P2P utilities', () => {
  describe('hosts.isLocalhost', () => {
    it('identifies localhost variants', () => {
      expect(isLocalhostHostname('localhost')).toBe(true);
      expect(isLocalhostHostname('127.0.0.1')).toBe(true);
      expect(isLocalhostHostname('::1')).toBe(true);
      expect(isLocalhostHostname('LOCALHOST')).toBe(true);
    });

    it('rejects non-localhost hostnames', () => {
      expect(isLocalhostHostname('dropgate.link')).toBe(false);
      expect(isLocalhostHostname('192.168.1.1')).toBe(false);
      expect(isLocalhostHostname('')).toBe(false);
    });
  });

  describe('hosts.isSecureForDirect', () => {
    it('returns true for secure context', () => {
      expect(isSecureContextForP2P('dropgate.link', true)).toBe(true);
    });

    it('returns true for localhost even without secure context', () => {
      expect(isSecureContextForP2P('localhost', false)).toBe(true);
      expect(isSecureContextForP2P('127.0.0.1', false)).toBe(true);
    });

    it('returns false for non-localhost without secure context', () => {
      expect(isSecureContextForP2P('dropgate.link', false)).toBe(false);
    });
  });

  describe('codes.generate', () => {
    it('generates codes in correct format', () => {
      const code = generateP2PCode();
      expect(code).toMatch(/^[A-Z]{4}-\d{4}$/);
    });

    it('generates different codes each time', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 10; i++) {
        codes.add(generateP2PCode());
      }
      // With cryptographic randomness, collisions should be extremely rare
      expect(codes.size).toBeGreaterThan(5);
    });
  });

  describe('codes.isLike', () => {
    it('validates correct P2P codes', () => {
      expect(isP2PCodeLike('ABCD-1234')).toBe(true);
      expect(isP2PCodeLike('WXYZ-9876')).toBe(true);
    });

    it('rejects invalid codes', () => {
      expect(isP2PCodeLike('ABC-1234')).toBe(false);  // Too short
      expect(isP2PCodeLike('ABCD-123')).toBe(false);  // Too short
      expect(isP2PCodeLike('abcd-1234')).toBe(false); // Lowercase
      expect(isP2PCodeLike('ABCD1234')).toBe(false);  // No dash
      expect(isP2PCodeLike('')).toBe(false);
    });
  });
});

describe('parseServerUrl', () => {
  it('parses HTTPS URLs correctly', () => {
    const result = parseServerUrl('https://dropgate.link');
    expect(result.host).toBe('dropgate.link');
    expect(result.secure).toBe(true);
    expect(result.port).toBeUndefined();
  });

  it('parses HTTP URLs correctly', () => {
    const result = parseServerUrl('http://localhost:3000');
    expect(result.host).toBe('localhost');
    expect(result.secure).toBe(false);
    expect(result.port).toBe(3000);
  });

  it('defaults to HTTPS when no protocol specified', () => {
    const result = parseServerUrl('dropgate.link');
    expect(result.host).toBe('dropgate.link');
    expect(result.secure).toBe(true);
  });

  it('handles URLs with ports', () => {
    const result = parseServerUrl('https://example.com:8080');
    expect(result.host).toBe('example.com');
    expect(result.port).toBe(8080);
    expect(result.secure).toBe(true);
  });

  it('handles URLs with whitespace', () => {
    const result = parseServerUrl('  https://dropgate.link  ');
    expect(result.host).toBe('dropgate.link');
  });
});

describe('buildBaseUrl', () => {
  it('builds HTTPS URLs correctly', () => {
    const url = buildBaseUrl({ host: 'dropgate.link', secure: true });
    expect(url).toBe('https://dropgate.link');
  });

  it('builds HTTP URLs correctly', () => {
    const url = buildBaseUrl({ host: 'localhost', secure: false });
    expect(url).toBe('http://localhost');
  });

  it('includes port when specified', () => {
    const url = buildBaseUrl({ host: 'localhost', port: 3000, secure: false });
    expect(url).toBe('http://localhost:3000');
  });

  it('defaults to HTTPS when secure is not specified', () => {
    const url = buildBaseUrl({ host: 'dropgate.link' });
    expect(url).toBe('https://dropgate.link');
  });

  it('throws error for missing host', () => {
    expect(codeThrownBy(() => buildBaseUrl({ host: '' }))).toBe('INVALID_ARGUMENT');
    expect(codeThrownBy(() => buildBaseUrl({ host: undefined as unknown as string }))).toBe('INVALID_ARGUMENT');
  });

  it('throws INVALID_ARGUMENT for an address that is not a URL', () => {
    expect(codeThrownBy(() => parseServerUrl('http://exa mple.com:99999'))).toBe('INVALID_ARGUMENT');
  });
});
