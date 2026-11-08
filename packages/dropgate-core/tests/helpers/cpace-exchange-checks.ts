// The CPace exchange end to end, as one list of checks: each a name, what
// should happen and what did. tests/cpace-exchange.test.ts runs them in Node
// on each provider, and the integration suite's core/crypto-vectors.spec.mjs
// runs the same code (bundled from tests/browser/vectors-entry.ts) in
// Chromium, Firefox and WebKit, so each engine's X25519 is held to the same
// aborts. Nothing here uses Node.
import vectors from '../fixtures/cpace-x25519-sha512-vectors.json';
import type { CryptoProvider } from '../../src/crypto/index.js';
import { parseCode } from '../../src/dgdtp/codes.js';
import { checkCpaceAbort, cpaceAbort, cpaceInitiator, cpaceResponder } from '../../src/dgdtp/cpace.js';
import { fromHex, hex, type VectorCheck } from './cpace-vectors.js';

type Change = (message: Uint8Array) => Uint8Array;

/**
 * How one exchange ends on each side, `receiver/sender`: `isk` when that side
 * handed an ISK on, else the error's code. With both ISKs handed on, `same
 * isk` if they match. Each side sends an abort when its step fails.
 */
async function ending(provider: CryptoProvider, typed: string, change: { m1?: Change; m2?: Change; m3?: Change } = {}): Promise<string> {
  const roomNonce = provider.randomBytes(16);
  const sender = cpaceResponder(provider, { password: parseCode('ABCD-1234').password, locator: 'AB', roomNonce });
  const receiver = cpaceInitiator(provider, { password: parseCode(typed).password, locator: 'AB', roomNonce, attemptId: provider.randomBytes(16) });
  const codeOf = (err: unknown) => String((err as { code?: string })?.code ?? err);
  const side = { receiver: '', sender: '' };
  const isks: string[] = [];
  const take = (isk: Uint8Array) => isks.push(hex(isk));
  const pass = (message: Uint8Array, how?: Change) => (how ? how(new Uint8Array(message)) : message);

  const m1 = pass(await receiver.writeMessage1(), change.m1);
  let m2 = cpaceAbort();
  try {
    m2 = (await sender.readMessage1(m1)).message2;
  } catch (err) {
    side.sender = codeOf(err);
  }
  let m3 = cpaceAbort();
  try {
    m3 = (await receiver.readMessage2(pass(m2, change.m2), take)).message3;
    side.receiver = 'isk';
  } catch (err) {
    side.receiver = codeOf(err);
  }
  if (!side.sender) {
    try {
      await sender.readMessage3(pass(m3, change.m3), take);
      side.sender = 'isk';
    } catch (err) {
      side.sender = codeOf(err);
      if (side.receiver === 'isk') {
        try {
          checkCpaceAbort(cpaceAbort());
        } catch (abortErr) {
          side.receiver = codeOf(abortErr);
        }
      }
    }
  }
  const both = `${side.receiver}/${side.sender}`;
  return both === 'isk/isk' ? (isks[0] === isks[1] ? 'same isk' : 'different isks') : both;
}

const at = (offset: number, bytes: Uint8Array): Change => (message) => {
  message.set(bytes, offset);
  return message;
};
const flip = (offset: number): Change => (message) => {
  message[offset] ^= 1;
  return message;
};

const MISMATCH = 'CODE_MISMATCH/CODE_MISMATCH';

/** Every check, run on `provider`. */
export async function cpaceExchangeChecks(provider: CryptoProvider): Promise<VectorCheck[]> {
  const checks: VectorCheck[] = [];
  const check = async (name: string, expected: string, run: () => Promise<string>) => {
    let actual: string;
    try {
      actual = await run();
    } catch (err) {
      actual = `threw ${(err as Error)?.name}: ${(err as Error)?.message}`;
    }
    checks.push({ name, expected, actual });
  };
  await check('the same code, typed in lower case without the dash', 'same isk', () => ending(provider, 'abcd1234'));
  await check('a wrong code', MISMATCH, () => ending(provider, 'ABCD-1243'));
  const low = vectors['B.1.10'].text;
  for (const name of low.abort) {
    const u = fromHex(low.u[name as keyof typeof low.u]);
    await check(`${name} as Ya`, MISMATCH, () => ending(provider, 'ABCD-1234', { m1: at(16, u) }));
    await check(`${name} as Yb`, MISMATCH, () => ending(provider, 'ABCD-1234', { m2: at(0, u) }));
  }
  await check("a Tb that doesn't match", MISMATCH, () => ending(provider, 'ABCD-1234', { m2: flip(98) }));
  // The receiver hands its ISK on once Tb matches; the sender's abort then ends it.
  await check("a Ta that doesn't match", MISMATCH, () => ending(provider, 'ABCD-1234', { m3: flip(0) }));
  return checks;
}
