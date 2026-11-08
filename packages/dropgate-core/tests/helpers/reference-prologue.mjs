// A second implementation of DGDTP 4's DTLS binding, the prologue Noise hashes
// in first, on node:crypto, written from the format below rather than from
// core's src/dgdtp/prologue.ts. Core's tests check that both make the same
// bytes: the pinned vectors in tests/fixtures/dgdtp-prologue-vectors.json came
// from this file (`node tests/helpers/reference-prologue.mjs` writes them again).
//
// The fingerprints, from each side's SDP (the receiver's OFFER, the sender's ANSWER):
//   every line starting "a=fingerprint:" is read, at session or media level
//   its value is a hash function's name, whitespace, then the fingerprint
//   a name other than sha-256 (in any case) is ignored
//   a sha-256 fingerprint is exactly 32 hex pairs (either case) joined by ":"; anything else is refused
//   the same value twice counts once; none, or two different, is refused
// The prologue, 131 bytes:
//   "dropgate/4 dgdtp prologue" (25, ASCII) || major (1) || mode (1: link 1, code 2, resume 3)
//   || roomNonce (16) || attemptId (16) || generation (8, BE) || receiver's fingerprint (32) || sender's (32)
// The generation is 0 for a connection's first attempt, one more for each resume.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handshake } from './reference-noise.mjs';
import { keySchedule } from './reference-signal.mjs';

const MODES = { link: 1, code: 2, resume: 3 };

/** The one SHA-256 fingerprint in `sdp`, hex, or null if the rule refuses it. */
export function fingerprintOf(sdp) {
  const values = new Set();
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith('a=fingerprint:')) continue;
    const match = /^(\S+)(?:[ \t]+(.*))?$/.exec(line.slice('a=fingerprint:'.length).trim());
    if (!match || match[1].toLowerCase() !== 'sha-256') continue;
    const pairs = (match[2] ?? '').trim().split(':');
    if (pairs.length !== 32 || !pairs.every((pair) => /^[0-9a-fA-F]{2}$/.test(pair))) return null;
    values.add(pairs.join('').toLowerCase());
  }
  return values.size === 1 ? [...values][0] : null;
}

/** The prologue, hex, from hex inputs. */
export function prologue({ major = 4, mode, roomNonce, attemptId, generation, receiverFingerprint, senderFingerprint }) {
  const gen = Buffer.alloc(8);
  gen.writeBigUInt64BE(BigInt(generation));
  const out = Buffer.concat([
    Buffer.from('dropgate/4 dgdtp prologue', 'ascii'), Buffer.of(major, MODES[mode]),
    Buffer.from(roomNonce, 'hex'), Buffer.from(attemptId, 'hex'), gen,
    Buffer.from(receiverFingerprint, 'hex'), Buffer.from(senderFingerprint, 'hex'),
  ]);
  if (out.length !== 131) throw new Error('131 bytes');
  return out.toString('hex');
}

const fixed = (label, length) => createHash('sha512').update(`dropgate/4 dgdtp prologue vector ${label}`).digest().subarray(0, length).toString('hex');

/** The fixed inputs every vector starts from. */
export const PROLOGUE_INPUTS = Object.freeze({
  roomNonce: fixed('room nonce', 16),
  attemptId: fixed('attempt id', 16),
  linkSecret: fixed('link secret', 32),
  isk: fixed('isk', 64),
  resumeSecret: fixed('resume secret', 32),
  receiverFingerprint: fixed('receiver fingerprint', 32),
  senderFingerprint: fixed('sender fingerprint', 32),
  otherFingerprint: fixed('other fingerprint', 32),
  receiverEphemeral: fixed('receiver ephemeral', 32),
  senderEphemeral: fixed('sender ephemeral', 32),
  hello: Buffer.from('the sender\'s hello', 'ascii').toString('hex'),
});

/** `hex` as SDP writes a fingerprint: upper-case pairs, colon-separated (or lower case). */
export const colons = (hex, lower = false) => {
  const pairs = hex.match(/../g).join(':');
  return lower ? pairs.toLowerCase() : pairs.toUpperCase();
};

/** A plausible SDP for one data channel, with `fingerprintLines` where a browser puts them. */
export function sdpWith({ type, ufrag, fingerprintLines, sessionLines = [], eol = '\r\n' }) {
  const lines = [
    'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
    ...sessionLines,
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${ufrag}`, 'a=ice-pwd:aaaabbbbccccddddeeeeffff', 'a=ice-options:trickle',
    ...fingerprintLines,
    `a=setup:${type === 'offer' ? 'actpass' : 'active'}`, 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144',
  ];
  return lines.join(eol) + eol;
}

const v = PROLOGUE_INPUTS;
const sha256Line = (hex, lower) => `a=fingerprint:sha-256 ${colons(hex, lower)}`;

/** What the fingerprint rule makes of each SDP: the fingerprint's hex, or null for one it refuses. */
function fingerprintCases() {
  const cases = [
    ['one sha-256 line at media level', sdpWith({ type: 'offer', ufrag: 'aaaa', fingerprintLines: [sha256Line(v.receiverFingerprint)] })],
    ['one sha-256 line at session level', sdpWith({ type: 'offer', ufrag: 'aaab', sessionLines: [sha256Line(v.receiverFingerprint)], fingerprintLines: [] })],
    ['the same value at session and media level, in different cases', sdpWith({ type: 'answer', ufrag: 'aaac', sessionLines: [sha256Line(v.senderFingerprint)], fingerprintLines: [sha256Line(v.senderFingerprint, true)] })],
    ['the hash function named in upper case', sdpWith({ type: 'offer', ufrag: 'aaad', fingerprintLines: [`a=fingerprint:SHA-256 ${colons(v.receiverFingerprint)}`] })],
    ['sha-1 and sha-512 lines beside it, ignored', sdpWith({ type: 'answer', ufrag: 'aaae', fingerprintLines: [
      'a=fingerprint:sha-1 4A:AD:B9:B1:3F:82:18:3B:54:02:12:DF:3E:5D:49:6B:19:E5:7C:AB',
      sha256Line(v.senderFingerprint),
      `a=fingerprint:sha-512 ${colons(createHash('sha512').update('x').digest('hex'))}`,
    ] })],
    ['lines ending in LF alone, with a tab and trailing spaces', sdpWith({ type: 'offer', ufrag: 'aaaf', eol: '\n', fingerprintLines: [`a=fingerprint:sha-256\t${colons(v.receiverFingerprint)}  `] })],
    ['another hash function that would be malformed as sha-256, ignored', sdpWith({ type: 'offer', ufrag: 'aaag', fingerprintLines: ['a=fingerprint:sha-384 not-hex', sha256Line(v.receiverFingerprint)] })],
    ['no fingerprint line', sdpWith({ type: 'offer', ufrag: 'aaba', fingerprintLines: [] })],
    ['only a sha-1 line', sdpWith({ type: 'offer', ufrag: 'aabb', fingerprintLines: ['a=fingerprint:sha-1 4A:AD:B9:B1:3F:82:18:3B:54:02:12:DF:3E:5D:49:6B:19:E5:7C:AB'] })],
    ['two different sha-256 values', sdpWith({ type: 'offer', ufrag: 'aabc', fingerprintLines: [sha256Line(v.receiverFingerprint), sha256Line(v.otherFingerprint)] })],
    ['two different values, one at session level', sdpWith({ type: 'answer', ufrag: 'aabd', sessionLines: [sha256Line(v.otherFingerprint)], fingerprintLines: [sha256Line(v.senderFingerprint)] })],
    ['31 bytes', sdpWith({ type: 'offer', ufrag: 'aabe', fingerprintLines: [`a=fingerprint:sha-256 ${colons(v.receiverFingerprint.slice(0, 62))}`] })],
    ['33 bytes', sdpWith({ type: 'offer', ufrag: 'aabf', fingerprintLines: [`a=fingerprint:sha-256 ${colons(`${v.receiverFingerprint}ab`)}`] })],
    ['a character that isn\'t hex', sdpWith({ type: 'offer', ufrag: 'aabg', fingerprintLines: [`a=fingerprint:sha-256 ${colons(v.receiverFingerprint).replace(/^../, 'G0')}`] })],
    ['hex with no colons', sdpWith({ type: 'offer', ufrag: 'aabh', fingerprintLines: [`a=fingerprint:sha-256 ${v.receiverFingerprint.toUpperCase()}`] })],
    ['a pair of three digits', sdpWith({ type: 'offer', ufrag: 'aabi', fingerprintLines: [`a=fingerprint:sha-256 ${colons(v.receiverFingerprint).replace(/^../, 'ABC')}`] })],
    ['the name with no value', sdpWith({ type: 'offer', ufrag: 'aabj', fingerprintLines: ['a=fingerprint:sha-256'] })],
    ['a good line, then a malformed sha-256 one', sdpWith({ type: 'offer', ufrag: 'aabk', fingerprintLines: [sha256Line(v.receiverFingerprint), 'a=fingerprint:sha-256 00:11'] })],
  ];
  return cases.map(([name, sdp]) => ({ name, sdp, fingerprint: fingerprintOf(sdp) }));
}

/** The pinned vectors, as tests/fixtures/dgdtp-prologue-vectors.json holds them. */
export function prologueVectors() {
  const base = { roomNonce: v.roomNonce, attemptId: v.attemptId, receiverFingerprint: v.receiverFingerprint, senderFingerprint: v.senderFingerprint };
  const prologues = [
    { name: 'link mode, the first connection', mode: 'link', generation: '0' },
    { name: 'code mode, the first connection', mode: 'code', generation: '0' },
    { name: 'a resume, the second connection', mode: 'resume', generation: '1' },
    { name: 'a resume at the last generation', mode: 'resume', generation: (2n ** 64n - 1n).toString() },
  ].map((p) => ({ ...p, prologue: prologue({ ...base, mode: p.mode, generation: p.generation }) }));

  // The whole handshake over link mode's prologue, from SDPs: the offer's and
  // answer's fingerprints into the prologue, the key schedule's PSK, Noise's
  // two messages with fixed ephemerals and the sender's hello.
  const offer = sdpWith({ type: 'offer', ufrag: 'rcv1', fingerprintLines: [sha256Line(v.receiverFingerprint)] });
  const answer = sdpWith({ type: 'answer', ufrag: 'snd1', fingerprintLines: [sha256Line(v.senderFingerprint)] });
  const { psk } = keySchedule({ mode: 'link', base: v.linkSecret, roomNonce: v.roomNonce, attemptId: v.attemptId, closeSecret: '00'.repeat(32) });
  const linkPrologue = prologue({ ...base, receiverFingerprint: fingerprintOf(offer), senderFingerprint: fingerprintOf(answer), mode: 'link', generation: 0 });
  const hs = handshake({ prologue: linkPrologue, psk, initEphemeral: v.receiverEphemeral, respEphemeral: v.senderEphemeral, payload2: v.hello });

  return {
    about: "DGDTP 4's DTLS binding, made by tests/helpers/reference-prologue.mjs, a second implementation on node:crypto "
      + 'written from the format (its header comment), not from core. fingerprints: what the fingerprint rule makes of each '
      + 'SDP (the fingerprint as hex, or null where it is refused). prologues: the 131-byte prologue in each mode and at the '
      + 'generation edges from inputs. handshake: link mode end to end from an offer and an answer: the prologue from their '
      + "fingerprints, the key schedule's PSK, then Noise's two messages (fixed ephemerals, the sender's hello as message 2's "
      + 'payload) and the handshake hash, from tests/helpers/reference-noise.mjs and reference-signal.mjs.',
    inputs: { ...v },
    fingerprints: fingerprintCases(),
    prologues,
    handshake: {
      offer,
      answer,
      prologue: linkPrologue,
      psk,
      message1: hs.message1.toString('hex'),
      message2: hs.message2.toString('hex'),
      handshakeHash: hs.handshakeHash.toString('hex'),
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = new URL('../fixtures/dgdtp-prologue-vectors.json', import.meta.url);
  writeFileSync(out, `${JSON.stringify(prologueVectors(), null, 2)}\n`);
  console.log(`Wrote ${fileURLToPath(out)}`);
}
