// A second implementation of DGDTP 4's key schedule and sealed signalling, on
// node:crypto, written from the format below rather than from core's
// src/dgdtp/keys.ts and seal.ts. Core's tests check that both make the same
// bytes: the pinned vectors in tests/fixtures/dgdtp-signal-vectors.json came
// from this file (`node tests/helpers/reference-signal.mjs` writes them again).
//
// The key schedule, HKDF-SHA256 (RFC 5869), from a base secret B: a link's
// secret S (32 bytes), a typed code's CPace ISK (64) or a resume secret R (32);
// ctx = roomNonce (16) || attemptId (16):
//   roomId   (16)  IKM S, no salt,  info "dropgate/4 dgdtp room"        link mode only
//   psk      (32)  IKM B, salt ctx, info "dropgate/4 dgdtp psk"
//   sealR2S  (32)  IKM B, salt ctx, info "dropgate/4 dgdtp signal r>s"
//   sealS2R  (32)  IKM B, salt ctx, info "dropgate/4 dgdtp signal s>r"
//   closeR2S (32)  IKM closeSecret, salt ctx, info "dropgate/4 dgdtp close r>s"
//   closeS2R (32)  IKM closeSecret, salt ctx, info "dropgate/4 dgdtp close s>r"
//
// A frame:
//   kind (1: 0x10 signal, 0x11 close) || direction (1: 1 receiver to sender, 2 back)
//   || attemptId (16) || counter (4, BE) || AES-256-GCM(key, nonce, inside, ad) with its 16-byte tag
//   nonce  8 zero bytes || counter (4, BE)
//   ad     "dropgate/4 dgdtp signal" || roomNonce || attemptId || direction || counter || kind
//   key    sealR2S / sealS2R by direction; closeR2S / closeS2R for a close
// The inside: type (1) || body length (2, BE) || body || zero bytes to the bucket:
//   1 OFFER, 2 ANSWER   SDP as UTF-8                       2,048, or 8,192 if it doesn't fit
//   3 CANDIDATE         lv(candidate) || lv(sdpMid) || sdpMLineIndex (2, BE; FFFF none) || lv(usernameFragment)
//   4 END_OF_CANDIDATES empty
//   5 RESTART           empty
//   6 CLOSE             the close's body (kind 0x11 only)
//   lv(s) = UTF-8 length (2, BE) || UTF-8, a null as empty;  3 to 6 are 512 bytes padded
// Counters start at 0 each way; a close is counter 0 under the close keys.

import { createCipheriv, createDecipheriv, createHash, hkdfSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const b = (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value, 'hex'));
const hkdf = (ikm, salt, info, length) => Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from(info, 'ascii'), length));

/** Every output of the key schedule from fixed inputs, hex. `roomId` only in link mode. */
export function keySchedule({ mode, base, roomNonce, attemptId, closeSecret }) {
  const ctx = Buffer.concat([b(roomNonce), b(attemptId)]);
  const out = {};
  if (mode === 'link') out.roomId = hkdf(b(base), Buffer.alloc(0), 'dropgate/4 dgdtp room', 16);
  out.psk = hkdf(b(base), ctx, 'dropgate/4 dgdtp psk', 32);
  out.sealR2S = hkdf(b(base), ctx, 'dropgate/4 dgdtp signal r>s', 32);
  out.sealS2R = hkdf(b(base), ctx, 'dropgate/4 dgdtp signal s>r', 32);
  out.closeR2S = hkdf(b(closeSecret), ctx, 'dropgate/4 dgdtp close r>s', 32);
  out.closeS2R = hkdf(b(closeSecret), ctx, 'dropgate/4 dgdtp close s>r', 32);
  return Object.fromEntries(Object.entries(out).map(([name, value]) => [name, value.toString('hex')]));
}

const u16 = (n) => {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(n);
  return out;
};
const u32 = (n) => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(n);
  return out;
};
const lv = (text) => {
  const bytes = Buffer.from(text ?? '', 'utf8');
  return Buffer.concat([u16(bytes.length), bytes]);
};

const TYPES = { offer: 1, answer: 2, candidate: 3, 'end-of-candidates': 4, restart: 5, close: 6 };

/** A message's padded inside. */
export function insideOf(message) {
  let body;
  if (message.type === 'offer' || message.type === 'answer') body = Buffer.from(message.sdp, 'utf8');
  else if (message.type === 'candidate') {
    body = Buffer.concat([
      lv(message.candidate), lv(message.sdpMid), u16(message.sdpMLineIndex ?? 0xffff), lv(message.usernameFragment),
    ]);
  } else if (message.type === 'close') body = b(message.body);
  else body = Buffer.alloc(0);
  const length = 3 + body.length;
  const sdp = message.type === 'offer' || message.type === 'answer';
  const bucket = sdp ? (length <= 2048 ? 2048 : 8192) : 512;
  if (length > bucket) throw new Error('too big for its bucket');
  return Buffer.concat([Buffer.of(TYPES[message.type]), u16(body.length), body, Buffer.alloc(bucket - length)]);
}

function nonce(counter) {
  return Buffer.concat([Buffer.alloc(8), u32(counter)]);
}

function ad({ roomNonce, attemptId, direction, counter, kind }) {
  return Buffer.concat([Buffer.from('dropgate/4 dgdtp signal', 'ascii'), b(roomNonce), b(attemptId), Buffer.of(direction), u32(counter), Buffer.of(kind)]);
}

/**
 * One frame: `key` hex, `direction` 1 or 2, `kind` 0x10 or 0x11, holding
 * `message`, or `inside` as it is (so a test can seal one that's wrong).
 * @param {{ key: string, roomNonce: string, attemptId: string, direction: number, counter: number, kind: number, message?: any, inside?: Buffer }} options
 */
export function frame({ key, roomNonce, attemptId, direction, counter, kind, message, inside }) {
  const cipher = createCipheriv('aes-256-gcm', b(key), nonce(counter));
  cipher.setAAD(ad({ roomNonce, attemptId, direction, counter, kind }));
  const sealed = Buffer.concat([cipher.update(inside ?? insideOf(message)), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([Buffer.of(kind, direction), b(attemptId), u32(counter), sealed]);
}

/** A frame opened, as its header and padded inside: throws if it doesn't open. */
export function openFrame({ key, roomNonce, frame: bytes }) {
  const f = b(bytes);
  const kind = f[0];
  const direction = f[1];
  const attemptId = f.subarray(2, 18);
  const counter = f.readUInt32BE(18);
  const decipher = createDecipheriv('aes-256-gcm', b(key), nonce(counter));
  decipher.setAAD(ad({ roomNonce, attemptId, direction, counter, kind }));
  decipher.setAuthTag(f.subarray(f.length - 16));
  const inside = Buffer.concat([decipher.update(f.subarray(22, f.length - 16)), decipher.final()]);
  return { kind, direction, attemptId: attemptId.toString('hex'), counter, inside };
}

const fixed = (label, length) => createHash('sha512').update(`dropgate/4 dgdtp signal vector ${label}`).digest().subarray(0, length).toString('hex');

/** The fixed inputs every vector starts from. */
export const SIGNAL_INPUTS = Object.freeze({
  roomNonce: fixed('room nonce', 16),
  attemptId: fixed('attempt id', 16),
  linkSecret: fixed('link secret', 32),
  isk: fixed('isk', 64),
  resumeSecret: fixed('resume secret', 32),
  closeSecret: fixed('close secret', 32),
});

/** An SDP of exactly `length` bytes: a plausible start, then attribute lines to fill it. */
export function sdpOf(length, label) {
  const start = `v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:${label}\r\na=ice-pwd:aaaabbbbccccddddeeeeffff\r\na=ice-options:trickle\r\na=fingerprint:sha-256 ${Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, '0').toUpperCase()).join(':')}\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n`;
  let sdp = start;
  for (let i = 0; Buffer.byteLength(sdp) < length; i++) {
    const line = `a=x-fill:${i}\r\n`;
    sdp += Buffer.byteLength(sdp) + line.length <= length ? line : 'x'.repeat(length - Buffer.byteLength(sdp));
  }
  if (Buffer.byteLength(sdp) !== length) throw new Error('sdp length');
  return sdp;
}

/** Each direction's frames, in order, with the message each holds. */
export const SIGNAL_MESSAGES = Object.freeze({
  receiver: [
    { type: 'offer', sdp: sdpOf(900, 'rcv1') },
    { type: 'candidate', candidate: 'candidate:842163049 1 udp 2122260223 192.168.1.23 51204 typ host generation 0 ufrag rcv1 network-id 1', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'rcv1' },
    { type: 'candidate', candidate: 'candidate:1467250027 1 udp 2122194687 2001:db8:85a3::8a2e:370:7334 51205 typ host generation 0 ufrag rcv1 network-id 2', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'rcv1' },
    { type: 'candidate', candidate: 'candidate:3305312592 1 udp 2113937151 0f5f6c3e-6f1d-4b0a-9a39-1c5a3f2e6b7d.local 51206 typ host generation 0 ufrag rcv1', sdpMid: null, sdpMLineIndex: null, usernameFragment: null },
    { type: 'end-of-candidates' },
    // The offer after a restart, too big for 2,048: the largest that fits 8,192.
    { type: 'offer', sdp: sdpOf(8189, 'rcv2') },
  ],
  sender: [
    // The largest answer that fits 2,048.
    { type: 'answer', sdp: sdpOf(2045, 'snd1') },
    { type: 'candidate', candidate: 'candidate:2832154521 1 udp 1686052607 203.0.113.7 61033 typ srflx raddr 10.0.0.4 rport 61033 generation 0 ufrag snd1 network-id 1', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'snd1' },
    { type: 'candidate', candidate: '', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'snd1' },
    { type: 'end-of-candidates' },
    { type: 'restart' },
    // The smallest answer too big for 2,048.
    { type: 'answer', sdp: sdpOf(2046, 'snd2') },
  ],
});

/** A close's body: the CLOSE message's own bytes go there; here, bytes of a test's own. */
export const CLOSE_BODIES = Object.freeze({
  receiver: Buffer.from('a close from the receiver', 'ascii').toString('hex'),
  sender: Buffer.alloc(509, 0x5c).toString('hex'),
});

/** The pinned vectors, as tests/fixtures/dgdtp-signal-vectors.json holds them. */
export function signalVectors() {
  const v = SIGNAL_INPUTS;
  const ctx = { roomNonce: v.roomNonce, attemptId: v.attemptId, closeSecret: v.closeSecret };
  const schedules = {
    link: keySchedule({ mode: 'link', base: v.linkSecret, ...ctx }),
    code: keySchedule({ mode: 'code', base: v.isk, ...ctx }),
    resume: keySchedule({ mode: 'resume', base: v.resumeSecret, ...ctx }),
  };
  const keys = schedules.code;
  const way = (role, direction, key) => SIGNAL_MESSAGES[role].map((message, counter) => {
    const bytes = frame({ key, roomNonce: v.roomNonce, attemptId: v.attemptId, direction, counter, kind: 0x10, message });
    if (!openFrame({ key, roomNonce: v.roomNonce, frame: bytes }).inside.equals(insideOf(message))) throw new Error('opens');
    return { counter, type: message.type, bytes: bytes.length, frame: bytes.toString('hex') };
  });
  const close = (role, direction, key) => {
    const message = { type: 'close', body: CLOSE_BODIES[role] };
    const bytes = frame({ key, roomNonce: v.roomNonce, attemptId: v.attemptId, direction, counter: 0, kind: 0x11, message });
    return { body: CLOSE_BODIES[role], frame: bytes.toString('hex') };
  };
  return {
    about: "DGDTP 4's key schedule and sealed signalling frames, made by tests/helpers/reference-signal.mjs, a second "
      + 'implementation on node:crypto written from the format (its header comment), not from core. schedules: every output '
      + 'of the key schedule in each mode from inputs (roomId only in link mode; the close keys from closeSecret). frames: '
      + "each direction's frames in order under the code-mode schedule's keys, with the message each holds (messages), and "
      + 'one out-of-band close each way under its close keys.',
    inputs: { ...v },
    schedules,
    messages: SIGNAL_MESSAGES,
    frames: {
      receiver: way('receiver', 1, keys.sealR2S),
      sender: way('sender', 2, keys.sealS2R),
    },
    close: {
      receiver: close('receiver', 1, keys.closeR2S),
      sender: close('sender', 2, keys.closeS2R),
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = new URL('../fixtures/dgdtp-signal-vectors.json', import.meta.url);
  writeFileSync(out, `${JSON.stringify(signalVectors(), null, 2)}\n`);
  console.log(`Wrote ${fileURLToPath(out)}`);
}
