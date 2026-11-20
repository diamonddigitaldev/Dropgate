import { cryptoProvider } from '../crypto/provider.js';
import type { CryptoProvider } from '../crypto/provider.js';
import { generateCode, isCodeLike } from '../dgdtp/codes.js';

/**
 * Whether a hostname is this machine: `localhost`, `127.0.0.1` or `::1`
 * (`[::1]` too, as a URL's hostname gives it).
 */
export function isLocalhostHostname(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/**
 * Check if the current context allows P2P (HTTPS or localhost)
 */
export function isSecureContextForP2P(
  hostname?: string,
  isSecureContext?: boolean
): boolean {
  return Boolean(isSecureContext) || isLocalhostHostname(hostname || '');
}

/**
 * A new direct transfer code, ABCD-1234 (four of the 24 letters without I
 * and O, then four digits), each character drawn evenly from the crypto
 * provider's secure random bytes, never anything weaker (dgdtp/codes.ts).
 * @throws {DropgateError} RUNTIME_UNSUPPORTED if there are no secure random numbers here.
 */
export function generateP2PCode(provider: CryptoProvider = cryptoProvider()): string {
  return generateCode(provider);
}

/**
 * Whether a value is a direct transfer code as someone might type it: spaces
 * and lower case are fine, and the dash may be left out; an I or an O isn't.
 */
export function isP2PCodeLike(code: unknown): boolean {
  return isCodeLike(code);
}
