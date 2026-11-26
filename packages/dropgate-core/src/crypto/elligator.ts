// RFC 9380's Elligator 2 map to Curve25519, which CPace uses to turn a hash of
// the password into a generator. WebCrypto has no such map, so it's
// @noble/curves' (compiled into core's build from an exact pin) in every
// provider. This is the one file in core that imports @noble/curves.
//
// The map's export carries a name its own comment calls experimental, so
// tests/crypto.test.ts fails if the pinned version stops exporting it. A
// package sweep that finds it renamed changes the import here, and nothing else.
//
// It runs in JavaScript, whose BigInt arithmetic makes no promise of constant
// time; the map's input is a hash of the code. That's a stated limit.
import { _map_to_curve_elligator2_curve25519 as mapToCurve } from '@noble/curves/ed25519.js';
import { invertCt, mod } from '@noble/curves/abstract/modular.js';
import { DropgateError } from '../errors.js';

/** 2²⁵⁵ − 19, Curve25519's field. */
const P = (1n << 255n) - 19n;

/** A field element and a u-coordinate are 32 bytes, little-endian (RFC 7748). */
const FIELD_BYTES = 32;

/** RFC 7748's decodeUCoordinate for 255 bits: little-endian, bit 255 cleared. */
export function decodeUCoordinate(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.byteLength !== FIELD_BYTES) {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: `A Curve25519 field element is ${FIELD_BYTES} bytes.` });
  }
  const out = new Uint8Array(bytes);
  out[FIELD_BYTES - 1] &= 0x7f;
  return out;
}

const toNumber = (bytes: Uint8Array) => {
  let n = 0n;
  for (let i = bytes.byteLength - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
};

const toBytes = (n: bigint) => {
  const out = new Uint8Array(FIELD_BYTES);
  for (let i = 0; i < FIELD_BYTES; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
};

/**
 * Elligator 2 of the 32-byte field element `u` (decoded as RFC 7748 says, so
 * bit 255 is ignored): the u-coordinate of the point it maps to, 32 bytes,
 * little-endian, reduced. The map gives it as a fraction `xMn / xMd`; the
 * division is by Fermat's little theorem, whose exponent is public.
 */
export function elligator2(u: Uint8Array): Uint8Array<ArrayBuffer> {
  const { xMn, xMd } = mapToCurve(toNumber(decodeUCoordinate(u)));
  return toBytes(mod(xMn * invertCt(xMd, P), P));
}
