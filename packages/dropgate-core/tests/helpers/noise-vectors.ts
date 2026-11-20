// Cacophony's Noise_NNpsk0_25519_AESGCM_SHA256 vector (tests/fixtures/noise-
// cacophony-vector.json, which says where it came from), as one list of checks
// like cpace-vectors.ts': each a name, the vector's value and core's.
// tests/noise.test.ts runs them in Node, and the integration suite's
// core/crypto-vectors.spec.mjs runs the same code (bundled by esbuild from
// tests/browser/vectors-entry.ts, as a test build) in Chromium, Firefox and
// WebKit. Nothing here uses Node: no Buffer, no node:crypto.
//
// The vector pins both ephemeral keys, which only a test build allows
// (src/dgdtp/noise.ts' `testing`).
import cacophony from '../fixtures/noise-cacophony-vector.json';
import type { CryptoProvider } from '../../src/crypto/index.js';
import { noiseInitiator, noiseResponder, type NoiseTransport } from '../../src/dgdtp/noise.js';
import { fromHex, hex, type VectorCheck } from './cpace-vectors.js';

/** What a refusal shows as: the code, for core's own error, else the error's name and message. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'opened';
  } catch (err) {
    const { code, name, message } = (err ?? {}) as { code?: string; name?: string; message?: string };
    return code ?? `threw ${name}: ${message}`;
  }
}

/** `bytes` with one bit flipped. */
export function flipped(bytes: Uint8Array, bit: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes);
  out[bit >> 3] ^= 1 << (bit & 7);
  return out;
}

/** The vector's two sides, on `provider`, with its fixed ephemerals. */
export function cacophonySides(provider: CryptoProvider) {
  const v = cacophony.vector;
  return {
    initiator: noiseInitiator(provider, { prologue: fromHex(v.init_prologue), psk: fromHex(v.init_psks[0]), testing: { ephemeral: fromHex(v.init_ephemeral) } }),
    responder: noiseResponder(provider, { prologue: fromHex(v.resp_prologue), psk: fromHex(v.resp_psks[0]), testing: { ephemeral: fromHex(v.resp_ephemeral) } }),
  };
}

/** Every check, run on `provider`: the handshake, its hash, the 4 transport messages, and 4 refusals. */
export async function noiseVectorChecks(provider: CryptoProvider): Promise<VectorCheck[]> {
  const v = cacophony.vector;
  const checks: VectorCheck[] = [];
  const check = (name: string, expected: string, actual: string) => checks.push({ name, expected, actual });
  const [m1, m2, ...records] = v.messages;

  const { initiator, responder } = cacophonySides(provider);
  const message1 = await initiator.writeMessage1(fromHex(m1.payload));
  check('message 1 (psk, e), written by the initiator', m1.ciphertext, hex(message1));
  check("message 1's payload, opened by the responder", m1.payload, hex(await responder.readMessage1(message1)));
  const { message: message2, transport: responderTransport } = await responder.writeMessage2(fromHex(m2.payload));
  check('message 2 (e, ee), written by the responder', m2.ciphertext, hex(message2));
  const { payload, transport: initiatorTransport } = await initiator.readMessage2(message2);
  check("message 2's payload, opened by the initiator", m2.payload, hex(payload));
  check('the handshake hash, the initiator', v.handshake_hash, hex(initiatorTransport.handshakeHash));
  check('the handshake hash, the responder', v.handshake_hash, hex(responderTransport.handshakeHash));

  // The transport messages take turns, the initiator first.
  for (const [i, { payload: plaintext, ciphertext }] of records.entries()) {
    const [from, to, sender, receiver]: [string, string, NoiseTransport, NoiseTransport] = i % 2 === 0
      ? ['initiator', 'responder', initiatorTransport, responderTransport]
      : ['responder', 'initiator', responderTransport, initiatorTransport];
    const record = await sender.encrypt(fromHex(plaintext));
    check(`transport message ${i + 1}, sealed by the ${from}`, ciphertext, hex(record));
    check(`transport message ${i + 1}, opened by the ${to}`, plaintext, hex(await receiver.decrypt(record)));
  }

  // A bit flipped in each kind of message: refused, and nothing tried again.
  const refused = 'SECURITY_POLICY_MISMATCH';
  const next = await initiatorTransport.encrypt(fromHex(records[0].payload));
  check('a transport message with a bit flipped', refused, await refusal(() => responderTransport.decrypt(flipped(next, 7))));
  check('then that same message as sealed, on the same transport', refused, await refusal(() => responderTransport.decrypt(next)));
  const one = cacophonySides(provider);
  check('message 1 with a bit flipped', refused, await refusal(() => one.responder.readMessage1(flipped(message1, 3))));
  const two = cacophonySides(provider);
  await two.initiator.writeMessage1(fromHex(m1.payload));
  check('message 2 with a bit flipped', refused, await refusal(() => two.initiator.readMessage2(flipped(message2, 300))));

  return checks;
}
