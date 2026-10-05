import { cryptoProvider } from '../crypto/provider.js';
import type { CryptoProvider } from '../crypto/provider.js';

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
 * Generate a P2P sharing code from the crypto provider's secure random bytes,
 * never anything weaker. Format: XXXX-0000 (4 letters + 4 digits)
 * @throws {DropgateError} RUNTIME_UNSUPPORTED if there are no secure random numbers here.
 */
export function generateP2PCode(provider: CryptoProvider = cryptoProvider()): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excluded I and O to avoid confusion
  const randomBytes = provider.randomBytes(8);

  let letterPart = '';
  for (let i = 0; i < 4; i++) {
    letterPart += letters[randomBytes[i] % letters.length];
  }

  let numberPart = '';
  for (let i = 4; i < 8; i++) {
    numberPart += (randomBytes[i] % 10).toString();
  }

  return `${letterPart}-${numberPart}`;
}

/**
 * Check if a string looks like a P2P sharing code
 */
export function isP2PCodeLike(code: string): boolean {
  return /^[A-Z]{4}-\d{4}$/.test(String(code || '').trim());
}
