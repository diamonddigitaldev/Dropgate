// DGDTP 4's records, manifest, checkpoint chain and rendezvous messages
// against the second implementation's pinned vectors
// (tests/fixtures/dgdtp-message-vectors.json, from
// tests/helpers/reference-messages.mjs), as one list of checks: each a name,
// what should happen and what did. tests/messages.test.ts runs them in Node on
// each provider, and the integration suite's core/crypto-vectors.spec.mjs runs
// the same code (bundled from tests/browser/vectors-entry.ts) in Chromium,
// Firefox and WebKit, so each engine's SHA-256 and byte handling are held to
// the same bytes. Nothing here uses Node.
import vectors from '../fixtures/dgdtp-message-vectors.json';
import type { CryptoProvider } from '../../src/crypto/index.js';
import {
  blockCount, chainBlock, chainFileEnd, chainStart, decodeManifest, decodeMessage, encodeManifest, encodeMessage, manifestHash,
  type ManifestFile, type Message,
} from '../../src/dgdtp/messages.js';
import { readServerMessage, rendezvousMessage } from '../../src/dgdtp/rendezvous.js';
import { fromHex, hex, type VectorCheck } from './cpace-vectors.js';

/** The fields the vectors write as hex that core holds as bytes. */
const BYTE_FIELDS = new Set([
  'closeSecret', 'fragment', 'manifestHash', 'resumeSecret', 'bytes', 'hash', 'chain', 'commitId', 'operationId', 'roomNonce', 'frame',
]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The vectors' fields as core takes them: hex as bytes, an 8-byte `id` as a bigint. */
export function toCore(value: Json, key = ''): unknown {
  if (typeof value === 'string' && BYTE_FIELDS.has(key)) return fromHex(value);
  if (typeof value === 'string' && key === 'id') return BigInt(`0x${value}`);
  if (Array.isArray(value)) return value.map((v) => toCore(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toCore(v, k)]));
  return value;
}

/** What core gives, written as the vectors write it, keys sorted, so two can be compared as strings. */
export function canonical(value: unknown): string {
  const plain = (v: unknown): unknown => {
    if (v instanceof Uint8Array) return hex(v);
    if (typeof v === 'bigint') return v.toString(16).padStart(16, '0');
    if (Array.isArray(v)) return v.map(plain);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, plain((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(plain(value));
}

/**
 * The files of a manifest of exactly 1 MiB, as the vectors describe them:
 * 2,668 files whose names are 255 bytes and media types 127, then one whose
 * name is 24.
 */
export function largestManifestFiles(): ManifestFile[] {
  const files: ManifestFile[] = [];
  for (let i = 0; i < 2668; i++) {
    const start = `file-${String(i).padStart(5, '0')}-`;
    files.push({ name: start + 'n'.repeat(255 - start.length), size: i * 1000, type: `application/x-${'t'.repeat(127 - 14)}` });
  }
  files.push({ name: 'the-last-file-of-24-b.ex', size: 7, type: '' });
  return files;
}

/** File `f`'s content, as the vectors make it: byte k = (k * 7 + f * 13 + 1) mod 256. */
export function fileContent(f: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let k = 0; k < size; k++) out[k] = (k * 7 + f * 13 + 1) & 0xff;
  return out;
}

const codeOf = (err: unknown) => String((err as { code?: string })?.code ?? err);

/** The client's message from the vectors' fields. */
function clientMessage(kind: string, f: Record<string, Json>): Uint8Array {
  const version = { major: (f.major as number) ?? 4, minor: (f.minor as number) ?? 0 };
  switch (kind) {
    case 'create':
      return rendezvousMessage.create({
        version, roomId: fromHex(f.roomId as string), roomNonce: fromHex(f.roomNonce as string), code: f.code === true,
        ...(f.credential !== undefined ? { credential: f.credential as string } : {}),
      });
    case 'join':
      return rendezvousMessage.join(f.roomId !== undefined ? { version, roomId: fromHex(f.roomId as string) } : { version, locator: f.locator as string });
    case 'code': return rendezvousMessage.code();
    case 'renew': return rendezvousMessage.renew();
    case 'lock': return rendezvousMessage.lock();
    case 'send': return rendezvousMessage.send(f.tag as number, fromHex(f.frame as string));
    case 'drop': return rendezvousMessage.drop(f.tag as number);
    case 'receiverSend': return rendezvousMessage.receiverSend(fromHex(f.frame as string));
    default: throw new Error(`No message ${kind}.`);
  }
}

/** Every check, run on `provider`. */
export async function messageVectorChecks(provider: CryptoProvider): Promise<VectorCheck[]> {
  const checks: VectorCheck[] = [];
  const check = async (name: string, expected: string, run: () => string | Promise<string>) => {
    let actual: string;
    try {
      actual = await run();
    } catch (err) {
      actual = `threw ${codeOf(err)}: ${(err as Error)?.message}`;
    }
    checks.push({ name, expected, actual });
  };
  const refusal = (run: () => unknown) => () => {
    try {
      run();
      return 'accepted';
    } catch (err) {
      return codeOf(err);
    }
  };

  // Every record, both ways.
  for (const { name, fields, record } of vectors.records) {
    await check(`${name}: written`, record, () => hex(encodeMessage(toCore(fields as unknown as Json) as Message)));
    await check(`${name}: read`, canonical(fields), () => canonical(decodeMessage(fromHex(record))));
  }
  for (const { name, record, reads } of vectors.lenient) {
    await check(name, canonical(reads), () => canonical(decodeMessage(fromHex(record))));
  }
  for (const { name, record } of vectors.refused) {
    await check(`refused: ${name}`, 'INVALID_MESSAGE', refusal(() => decodeMessage(fromHex(record))));
  }

  // Manifests and their hashes.
  for (const { name, files, manifest, hash } of vectors.manifests) {
    await check(`manifest, ${name}: written`, manifest, () => hex(encodeManifest(files)));
    await check(`manifest, ${name}: read`, canonical({ files, totalSize: files.reduce((n, f) => n + f.size, 0) }), () => canonical(decodeManifest(fromHex(manifest))));
    await check(`manifest, ${name}: its hash`, hash, async () => hex(await manifestHash(provider, fromHex(manifest))));
  }
  const largest = encodeManifest(largestManifestFiles());
  const want = vectors.largestManifest;
  await check('the largest manifest: its length', String(want.length), () => String(largest.byteLength));
  await check('the largest manifest: its bytes', want.sha256, async () => hex(await provider.sha256(largest)));
  await check('the largest manifest: its hash', want.hash, async () => hex(await manifestHash(provider, largest)));
  await check('the largest manifest: read', String(want.fileCount), () => String(decodeManifest(largest).files.length));

  // The chain, every step.
  const chain = vectors.chain as unknown as {
    files: ManifestFile[]; manifest: string; manifestHash: string;
    steps: Array<{ step: string; chain: string; fileIndex: number; blockIndex: number; length: number; hash: string; size: number; blockCount: number }>;
  };
  await check("the chain's manifest", chain.manifest, () => hex(encodeManifest(chain.files)));
  await check("the chain's manifest hash", chain.manifestHash, async () => hex(await manifestHash(provider, fromHex(chain.manifest))));
  let c = await chainStart(provider, fromHex(chain.manifestHash));
  await check('the chain: C0', chain.steps[0].chain, () => hex(c));
  const contents = chain.files.map((f, i) => fileContent(i, f.size));
  for (const step of chain.steps.slice(1)) {
    const at = `the chain: file ${step.fileIndex}`;
    if (step.step === 'block') {
      const start = step.blockIndex * 1048576;
      const block = contents[step.fileIndex].subarray(start, start + step.length);
      await check(`${at}, block ${step.blockIndex}'s hash`, step.hash, async () => hex(await provider.sha256(block)));
      c = await chainBlock(provider, c, { fileIndex: step.fileIndex, blockIndex: step.blockIndex, length: block.byteLength, hash: await provider.sha256(block) });
      await check(`${at}, block ${step.blockIndex}`, step.chain, () => hex(c));
    } else {
      await check(`${at}'s block count`, String(step.blockCount), () => String(blockCount(step.size)));
      c = await chainFileEnd(provider, c, { fileIndex: step.fileIndex, size: step.size, blockCount: step.blockCount });
      await check(`${at}'s end`, step.chain, () => hex(c));
    }
  }

  // The rendezvous's messages.
  for (const { name, kind, fields, message } of vectors.rendezvous.client) {
    await check(`rendezvous, ${name}`, message, () => hex(clientMessage(kind, fields as Record<string, Json>)));
  }
  for (const { name, to, message, says } of vectors.rendezvous.server) {
    await check(`rendezvous, ${name}`, canonical(says), () => canonical(readServerMessage(fromHex(message), to as 'sender' | 'receiver')));
  }
  for (const { name, to, message } of vectors.rendezvous.refused) {
    await check(`rendezvous, refused: ${name}`, 'INVALID_RESPONSE', refusal(() => readServerMessage(fromHex(message), to as 'sender' | 'receiver')));
  }
  return checks;
}
