import type { Base64Adapter } from '../types.js';
import { getDefaultBase64 } from '../adapters/defaults.js';

let defaultAdapter: Base64Adapter | null = null;

function getAdapter(adapter?: Base64Adapter): Base64Adapter {
  if (adapter) return adapter;
  if (!defaultAdapter) {
    defaultAdapter = getDefaultBase64();
  }
  return defaultAdapter;
}

/**
 * Convert a Uint8Array to a base64 string
 */
export function bytesToBase64(bytes: Uint8Array, adapter?: Base64Adapter): string {
  return getAdapter(adapter).encode(bytes);
}

/**
 * Convert an ArrayBuffer to a base64 string
 */
export function arrayBufferToBase64(buf: ArrayBuffer, adapter?: Base64Adapter): string {
  return bytesToBase64(new Uint8Array(buf), adapter);
}

/**
 * Convert a base64 string to a Uint8Array
 */
export function base64ToBytes(b64: string, adapter?: Base64Adapter): Uint8Array {
  return getAdapter(adapter).decode(b64);
}

/** Bytes as URL-safe base64 with no `=`, as Dropgate 4 writes a link's secret and every binary field. */
export function bytesToBase64url(bytes: Uint8Array, adapter?: Base64Adapter): string {
  return bytesToBase64(bytes, adapter).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The bytes a URL-safe base64 string with no `=` holds, if it's exactly that
 * (and `length` bytes, when given), or null.
 */
export function base64urlToBytes(value: unknown, length?: number, adapter?: Base64Adapter): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return null;
  let bytes: Uint8Array;
  try {
    const standard = value.replace(/-/g, '+').replace(/_/g, '/');
    bytes = base64ToBytes(standard + '='.repeat((4 - (standard.length % 4)) % 4), adapter);
  } catch {
    return null;
  }
  // Only one string spells each run of bytes: no stray bits in the last character.
  if (bytesToBase64url(bytes, adapter) !== value) return null;
  if (length !== undefined && bytes.byteLength !== length) return null;
  return new Uint8Array(bytes);
}
