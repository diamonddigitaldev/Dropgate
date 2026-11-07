// Built from packages/dropgate-core by `npm run build` there. Don't edit this file:
// change core's source and build it again. CI fails if this doesn't match the build.
/*!
 * @dropgate/core has compiled into it @noble/curves 2.4.0, @noble/hashes 2.4.0 and
 * @noble/ciphers 2.4.0 (https://paulmillr.com/noble/), licensed under the MIT License:
 *
 * Copyright (c) 2022 Paul Miller (https://paulmillr.com)
 * Copyright (c) 2016 Thomas Pornin <pornin@bolet.org>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the “Software”), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
var __defProp = Object.defineProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var __privateWrapper = (obj, member, setter, getter) => ({
  set _(value) {
    __privateSet(obj, member, value, setter);
  },
  get _() {
    return __privateGet(obj, member, getter);
  }
});

// src/constants.ts
var DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
var AES_GCM_IV_BYTES = 12;

// src/errors.ts
var ERROR_CODES = {
  INVALID_ARGUMENT: { origin: "local", retryable: false, message: "An option passed to Dropgate is missing or invalid." },
  RUNTIME_UNSUPPORTED: { origin: "local", retryable: false, message: "This environment lacks something Dropgate needs." },
  OPERATION_CANCELLED: { origin: "local", retryable: false, message: "The operation was cancelled." },
  PAUSE_UNAVAILABLE: { origin: "local", retryable: false, message: "It can't be paused or resumed now." },
  SOURCE_UNAVAILABLE: { origin: "local", retryable: false, message: "A file couldn't be read." },
  OUTPUT_WRITE_FAILED: { origin: "local", retryable: false, message: "Received data couldn't be written." },
  ENCRYPT_FAILED: { origin: "local", retryable: false, message: "The upload couldn't be encrypted." },
  KEY_REQUIRED: { origin: "local", retryable: false, message: "This upload is encrypted, and the link has no key." },
  DECRYPT_FAILED: { origin: "local", retryable: false, message: "This upload couldn't be decrypted. The key may be wrong." },
  INTEGRITY_FAILED: { origin: "server", retryable: false, message: "Received data didn't pass its integrity check." },
  INVALID_MANIFEST: { origin: "peer", retryable: false, message: "The list of files sent didn't add up." },
  INVALID_FILENAME: { origin: "local", retryable: false, message: "A file name is empty, too long, or has a control character or path in it." },
  INVALID_CODE: { origin: "local", retryable: false, message: "That isn't a valid sharing code." },
  FILE_EMPTY: { origin: "local", retryable: false, message: "Empty files (0 bytes) cannot be uploaded." },
  FILE_TOO_LARGE: { origin: "server", retryable: false, message: "The upload is larger than the server's limit." },
  LIFETIME_NOT_ALLOWED: { origin: "server", retryable: false, message: "The server doesn't allow that file lifetime." },
  CAPABILITY_UNSUPPORTED: { origin: "server", retryable: false, message: "The server doesn't support this." },
  VERSION_UNSUPPORTED: { origin: "server", retryable: false, message: "This version of Dropgate can't work with the server." },
  INSECURE_TRANSPORT_NOT_ALLOWED: { origin: "local", retryable: false, message: "The server is on plain HTTP, which is not secure, and insecure servers are not allowed." },
  REDIRECT_NOT_FOLLOWED: { origin: "server", retryable: false, message: "The server redirected the request elsewhere. Dropgate never follows a redirect: use the address it redirects to." },
  AUTH_REQUIRED: { origin: "server", retryable: false, message: "The server needs a credential for this." },
  AUTH_EXPIRED: { origin: "server", retryable: false, message: "The credential has expired." },
  AUTH_DENIED: { origin: "server", retryable: false, message: "The credential doesn't allow this." },
  QUOTA_EXCEEDED: { origin: "server", retryable: false, message: "This would go over the quota the server allows." },
  NOT_FOUND: { origin: "server", retryable: false, message: "The upload wasn't found. It may have expired." },
  REQUEST_REJECTED: { origin: "server", retryable: false, message: "The server refused the request." },
  RATE_LIMITED: { origin: "server", retryable: true, message: "Too many requests. Try again later." },
  SERVER_FULL: { origin: "server", retryable: true, message: "The server is out of space. Try again later." },
  SERVER_ERROR: { origin: "server", retryable: true, message: "The server ran into an error." },
  INVALID_RESPONSE: { origin: "server", retryable: false, message: "The server's answer wasn't understood." },
  SERVER_UNREACHABLE: { origin: "network", retryable: true, message: "The server couldn't be reached." },
  TIMED_OUT: { origin: "network", retryable: true, message: "The server took too long to answer." },
  CONNECTION_LOST: { origin: "network", retryable: true, message: "The connection was lost." },
  PEER_FAILED: { origin: "peer", retryable: false, message: "The other device reported an error." },
  UNEXPECTED_ERROR: { origin: "local", retryable: false, message: "Something unexpected went wrong." }
};
var DropgateError = class _DropgateError extends Error {
  constructor(opts) {
    const info = ERROR_CODES[opts.code] ?? ERROR_CODES.UNEXPECTED_ERROR;
    super(opts.message ?? info.message, opts.cause !== void 0 ? { cause: opts.cause } : void 0);
    __publicField(this, "code");
    __publicField(this, "origin");
    /** Whether the same request could succeed if made again later. */
    __publicField(this, "retryable");
    __publicField(this, "status");
    __publicField(this, "details");
    /**
     * How the client that gave the error reaches its server. Every error a
     * client gives has it, so an error shown to someone can say the connection
     * wasn't secure.
     */
    __publicField(this, "transport");
    this.name = "DropgateError";
    this.code = opts.code in ERROR_CODES ? opts.code : "UNEXPECTED_ERROR";
    this.origin = opts.origin ?? info.origin;
    this.retryable = opts.retryable ?? info.retryable;
    if (opts.status !== void 0) this.status = opts.status;
    if (opts.details !== void 0) this.details = opts.details;
    if (opts.transport !== void 0) this.transport = Object.freeze({ secure: opts.transport.secure });
  }
  /** Whether `err` is a DropgateError, with `code` if one is given. */
  static is(err, code) {
    return err instanceof _DropgateError && (code === void 0 || err.code === code);
  }
  /** What JSON.stringify() gives: never the cause, which Dropgate didn't write. */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      origin: this.origin,
      retryable: this.retryable,
      ...this.status !== void 0 ? { status: this.status } : {},
      ...this.details !== void 0 ? { details: this.details } : {},
      ...this.transport !== void 0 ? { transport: this.transport } : {}
    };
  }
};
function withTransport(err, transport) {
  const error = toDropgateError(err);
  if (error.transport === void 0) {
    Object.defineProperty(error, "transport", { value: Object.freeze({ secure: transport.secure }), enumerable: true });
  }
  return error;
}
var SERVER_CREDENTIAL_CODES = /* @__PURE__ */ new Set(["AUTH_REQUIRED", "AUTH_EXPIRED", "AUTH_DENIED", "QUOTA_EXCEEDED"]);
var SERVER_CODES = Object.freeze({
  E2EE_DISABLED: "CAPABILITY_UNSUPPORTED",
  PAUSE_DISABLED: "CAPABILITY_UNSUPPORTED",
  UNSUPPORTED_OBJECT: "VERSION_UNSUPPORTED",
  LIFETIME_NOT_ALLOWED: "LIFETIME_NOT_ALLOWED",
  DIGEST_MISMATCH: "INTEGRITY_FAILED",
  CHUNK_CONFLICT: "INTEGRITY_FAILED",
  RANGE_NOT_SATISFIABLE: "INVALID_RESPONSE"
});
function errorFromStatus(status, json, fallback) {
  const named = json && typeof json === "object" ? json.code : void 0;
  if (status >= 400 && status < 500 && typeof named === "string" && SERVER_CREDENTIAL_CODES.has(named)) {
    return new DropgateError({ code: named, status });
  }
  if (status === 401) return new DropgateError({ code: "AUTH_REQUIRED", status });
  const said = json && typeof json === "object" && "error" in json ? json.error : void 0;
  const serverMessage = typeof said === "string" && said.trim() && said.length <= 200 ? said.trim() : void 0;
  const code = typeof named === "string" && Object.prototype.hasOwnProperty.call(SERVER_CODES, named) ? SERVER_CODES[named] : status === 404 || status === 410 ? "NOT_FOUND" : status === 413 ? "FILE_TOO_LARGE" : status === 429 ? "RATE_LIMITED" : status === 507 ? "SERVER_FULL" : status >= 500 ? "SERVER_ERROR" : "REQUEST_REJECTED";
  return new DropgateError({ code, status, message: serverMessage ?? fallback });
}
function directTransferDisabled() {
  return new DropgateError({
    code: "CAPABILITY_UNSUPPORTED",
    message: "Direct transfer is disabled on this server.",
    details: { capability: "p2p" }
  });
}
function toDropgateError(err, fallback = "UNEXPECTED_ERROR", message) {
  if (err instanceof DropgateError) return err;
  const name = err instanceof Error || err && typeof err === "object" && "name" in err ? err.name : void 0;
  if (name === "TimeoutError") return new DropgateError({ code: "TIMED_OUT", cause: err });
  if (name === "AbortError") return new DropgateError({ code: "OPERATION_CANCELLED", cause: err });
  return new DropgateError({ code: fallback, cause: err, ...message ? { message } : {} });
}

// node_modules/@noble/hashes/_u64.js
var U32_MASK64 = /* @__PURE__ */ (() => BigInt(2 ** 32 - 1))();
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var fromNumH = (n) => n / 2 ** 32 | 0;
var fromNumL = (n) => n >>> 0;
function setU64FromNum(view2, byteOffset, n, isLE2) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view2.setUint32(byteOffset, isLE2 ? l : h, isLE2);
  view2.setUint32(byteOffset + 4, isLE2 ? h : l, isLE2);
}
var shrSH = (h, _l, s) => h >>> s;
var shrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber(length, "length");
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("expected hash wrapped by utils.createHasher");
  anumber(h.outputLen);
  anumber(h.blockLen);
  if (h.outputLen < 1 || h.blockLen < 1)
    throw new Error("hash blockLen / outputLen must be >= 1");
}
var aobject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
var aopts = (value, label) => {
  aobject(value, label);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
};
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
function asciiToBase16(ch) {
  return ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - (65 - 10) : ch >= 97 && ch <= 102 ? ch - (97 - 10) : void 0;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  if (hasHexBuiltin) {
    try {
      return Uint8Array.fromHex(hex);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RangeError(error.message);
      throw error;
    }
  }
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function checkOpts(defaults, opts, title = "opts") {
  aopts(defaults, "defaults");
  if (opts !== void 0)
    aopts(opts, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
  return merged;
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes(bytesLength = 32) {
  anumber(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  constructor(blockLen, outputLen, padOffset, isLE2) {
    __publicField(this, "blockLen");
    __publicField(this, "outputLen");
    __publicField(this, "canXOF", false);
    __publicField(this, "padOffset");
    __publicField(this, "isLE");
    // For partial updates less than block size
    __publicField(this, "buffer");
    __publicField(this, "view");
    __publicField(this, "finished", false);
    __publicField(this, "length", 0);
    __publicField(this, "pos", 0);
    __publicField(this, "destroyed", false);
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE2;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view: view2, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view2, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view: view2, blockLen, isLE: isLE2 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view2, 0);
      buffer.fill(0);
    }
    setU64FromNum(view2, blockLen - 8, this.length * 8, isLE2);
    this.process(view2, 0);
    this.roundClean();
    const oview = out === buffer ? view2 : createView(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE2);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

// node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    // We cannot use array here since array allows indexing by variable
    // which means optimizer/compiler cannot use registers.
    // Numeric initializers matter: starting the fields as `undefined` changes
    // V8's field representation and makes sha256 3x slower (measured).
    __publicField(this, "A", 0);
    __publicField(this, "B", 0);
    __publicField(this, "C", 0);
    __publicField(this, "D", 0);
    __publicField(this, "E", 0);
    __publicField(this, "F", 0);
    __publicField(this, "G", 0);
    __publicField(this, "H", 0);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to || (to = new this.constructor())).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view2, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view2.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T12 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T22 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T12 | 0;
      D = C;
      C = B;
      B = A;
      A = T12 + T22 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  constructor() {
    super(32, SHA256_IV);
  }
};
var K512 = /* @__PURE__ */ (() => split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))))();
var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
var SHA2_64B = class extends HashMD {
  constructor(outputLen, IV) {
    super(128, outputLen, 16, false);
    // We cannot use array here since array allows indexing by variable
    // which means optimizer/compiler cannot use registers.
    // h -- high 32 bits, l -- low 32 bits
    // Numeric initializers matter: starting the fields as `undefined` changes
    // V8's field representation and slows hashing down (measured on sha256).
    __publicField(this, "Ah", 0);
    __publicField(this, "Al", 0);
    __publicField(this, "Bh", 0);
    __publicField(this, "Bl", 0);
    __publicField(this, "Ch", 0);
    __publicField(this, "Cl", 0);
    __publicField(this, "Dh", 0);
    __publicField(this, "Dl", 0);
    __publicField(this, "Eh", 0);
    __publicField(this, "El", 0);
    __publicField(this, "Fh", 0);
    __publicField(this, "Fl", 0);
    __publicField(this, "Gh", 0);
    __publicField(this, "Gl", 0);
    __publicField(this, "Hh", 0);
    __publicField(this, "Hl", 0);
    this.Ah = IV[0] | 0;
    this.Al = IV[1] | 0;
    this.Bh = IV[2] | 0;
    this.Bl = IV[3] | 0;
    this.Ch = IV[4] | 0;
    this.Cl = IV[5] | 0;
    this.Dh = IV[6] | 0;
    this.Dl = IV[7] | 0;
    this.Eh = IV[8] | 0;
    this.El = IV[9] | 0;
    this.Fh = IV[10] | 0;
    this.Fl = IV[11] | 0;
    this.Gh = IV[12] | 0;
    this.Gl = IV[13] | 0;
    this.Hh = IV[14] | 0;
    this.Hl = IV[15] | 0;
  }
  // prettier-ignore
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  // prettier-ignore
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  _cloneInto(to) {
    (to || (to = new this.constructor())).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view2, offset) {
    for (let i = 0; i < 16; i++, offset += 4) {
      SHA512_W_H[i] = view2.getUint32(offset);
      SHA512_W_L[i] = view2.getUint32(offset += 4);
    }
    for (let i = 16; i < 80; i++) {
      const W15h = SHA512_W_H[i - 15] | 0;
      const W15l = SHA512_W_L[i - 15] | 0;
      const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
      const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
      const W2h = SHA512_W_H[i - 2] | 0;
      const W2l = SHA512_W_L[i - 2] | 0;
      const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
      const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
      const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
      const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
      SHA512_W_H[i] = SUMh | 0;
      SHA512_W_L[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0; i < 80; i++) {
      const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
      const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
      const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
      const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L(T1l, sigma0l, MAJl);
      Ah = add3H(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    this.destroyed = true;
    clean(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var _SHA512 = class extends SHA2_64B {
  constructor() {
    super(64, SHA512_IV);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);
var sha512 = /* @__PURE__ */ createHasher(
  () => new _SHA512(),
  /* @__PURE__ */ oidNist(3)
);

// src/crypto/common.ts
var _label, _provider, _handle;
var ProviderKey = class {
  constructor(label, provider, handle) {
    __privateAdd(this, _label);
    __privateAdd(this, _provider);
    __privateAdd(this, _handle);
    __privateSet(this, _label, label);
    __privateSet(this, _provider, provider);
    __privateSet(this, _handle, handle);
    Object.freeze(this);
  }
  /** The provider's own handle, for the provider that made it, if the key is of this kind. */
  static handle(key, provider) {
    if (!(key instanceof this) || __privateGet(key, _provider) !== provider) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "That key wasn't made by this crypto provider, or isn't for this." });
    }
    return __privateGet(key, _handle);
  }
  toJSON() {
    return __privateGet(this, _label);
  }
  toString() {
    return __privateGet(this, _label);
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return __privateGet(this, _label);
  }
};
_label = new WeakMap();
_provider = new WeakMap();
_handle = new WeakMap();
var ContentKey = class extends ProviderKey {
  constructor(provider, handle) {
    super("[ContentKey]", provider, handle);
  }
};
var MacKey = class extends ProviderKey {
  constructor(provider, handle) {
    super("[MacKey]", provider, handle);
  }
};
var X25519Key = class extends ProviderKey {
  constructor(provider, handle) {
    super("[X25519Key]", provider, handle);
  }
};
function randomFrom(source) {
  const randomBytes3 = (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 65536) source.getRandomValues(out.subarray(i, Math.min(length, i + 65536)));
    return out;
  };
  return {
    randomBytes: randomBytes3,
    randomUUID() {
      if (typeof source.randomUUID === "function") return source.randomUUID();
      const bytes = randomBytes3(16);
      bytes[6] = bytes[6] & 15 | 64;
      bytes[8] = bytes[8] & 63 | 128;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  };
}
var own = (bytes) => new Uint8Array(bytes);
var CONTENT_KEY_BYTES = 32;
var MAC_KEY_BYTES = 32;
var X25519_BYTES = 32;
var HKDF_MAX_BYTES = 255 * 32;
var invalid = (message) => new DropgateError({ code: "INVALID_ARGUMENT", message });
var notBytes = (what, length) => invalid(`${what} is ${length} bytes.`);
var lowOrder = () => invalid("That X25519 public value is a low-order point: the shared secret would be all zeros.");
function checkContentKey(raw) {
  if (raw.byteLength !== CONTENT_KEY_BYTES) throw invalid("A content key is 32 bytes.");
}
function checkNonce(nonce) {
  if (nonce.byteLength !== AES_GCM_IV_BYTES) throw invalid("An AES-GCM nonce is 12 bytes.");
}
function checkHmac(hash, key) {
  if (hash !== "SHA-256" && hash !== "SHA-512") throw invalid("HMAC is SHA-256 or SHA-512 here.");
  if (key.byteLength === 0) throw invalid("An HMAC key here is never empty.");
}
function checkHkdfLength(length) {
  if (!Number.isInteger(length) || length < 1 || length > HKDF_MAX_BYTES) {
    throw invalid(`HKDF-SHA256 gives 1 to ${HKDF_MAX_BYTES} bytes.`);
  }
}
var P = (1n << 255n) - 19n;
var littleEndian = (bytes) => {
  let n = 0n;
  for (let i = bytes.byteLength - 1; i >= 0; i--) n = n << 8n | BigInt(bytes[i]);
  return n;
};
var LOW_ORDER = /* @__PURE__ */ new Set([
  0n,
  1n,
  P - 1n,
  littleEndian(Uint8Array.from([
    224,
    235,
    122,
    124,
    59,
    65,
    184,
    174,
    22,
    86,
    227,
    250,
    241,
    159,
    196,
    106,
    218,
    9,
    141,
    235,
    156,
    50,
    177,
    253,
    134,
    98,
    5,
    22,
    95,
    73,
    184,
    0
  ])),
  littleEndian(Uint8Array.from([
    95,
    156,
    149,
    188,
    163,
    80,
    140,
    36,
    177,
    208,
    177,
    85,
    156,
    131,
    239,
    91,
    4,
    68,
    92,
    196,
    88,
    28,
    142,
    134,
    216,
    34,
    78,
    221,
    208,
    159,
    17,
    87
  ]))
]);
function canonicalU(u) {
  if (u.byteLength !== X25519_BYTES) throw notBytes("An X25519 u-coordinate", X25519_BYTES);
  let n = littleEndian(u) & (1n << 255n) - 1n;
  if (n >= P) n -= P;
  if (LOW_ORDER.has(n)) throw lowOrder();
  const out = new Uint8Array(X25519_BYTES);
  for (let i = 0; i < X25519_BYTES; i++, n >>= 8n) out[i] = Number(n & 0xffn);
  return out;
}
function constantTimeEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
var allZero = (bytes) => {
  let any = 0;
  for (let i = 0; i < bytes.byteLength; i++) any |= bytes[i];
  return any === 0;
};

// node_modules/@noble/curves/utils.js
function aarray(item, title, inner = () => {
}) {
  if (!Array.isArray(item))
    throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
  for (let i = 0; i < item.length; i++)
    inner(item[i], `${title}[${i}]`);
  return item;
}
var abytes2 = (value, length, title) => abytes(value, length, title);
var anumber2 = anumber;
function aobject2(value, title = "object") {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
  return value;
}
function afunction(value, title) {
  if (typeof value !== "function")
    throw new TypeError(`"${title}" is invalid: expected function, got ${typeof value}`);
  return value;
}
var bytesToHex2 = bytesToHex;
var hexToBytes2 = (hex) => hexToBytes(hex);
var isBytes2 = isBytes;
var randomBytes2 = (bytesLength) => randomBytes(bytesLength);
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
var atitle2 = (title) => title ? `"${title}" ` : "";
function abool(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle2(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abignumber(n) {
  if (typeof n === "bigint") {
    if (!isPosBig(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber2(n);
  return n;
}
function asafenumber(value, title = "") {
  if (typeof value !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    const prefix = title && `"${title}" `;
    throw new RangeError(prefix + "expected safe integer, got " + value);
  }
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  return hexToNumber(bytesToHex(copyBytes(abytes(bytes)).reverse()));
}
function numberToBytesBE(n, len) {
  anumber(len);
  if (len === 0)
    throw new Error("zero output length is invalid");
  n = abignumber(n);
  const expectedLen = len * 2;
  const hex = n.toString(16);
  if (hex.length > expectedLen)
    throw new RangeError("number is too large");
  return hexToBytes(hex.padStart(expectedLen, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes2(bytes));
}
function isPosBig(n) {
  return typeof n === "bigint" && _0n <= n;
}
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  if (n < _0n)
    throw new Error("expected non-negative bigint, got " + n);
  return n === _0n ? 0 : n.toString(2).length;
}
var bitMask = (n) => {
  asafenumber(n, "n");
  return (_1n << BigInt(n)) - _1n;
};
function validateObject(object, fields = {}, optFields = {}, title = "object") {
  aobject2(object, title);
  aobject2(fields, "fields");
  aobject2(optFields, "optFields");
  function checkField(fieldName, expectedType, isOpt) {
    const label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`;
    const val = object[fieldName];
    if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== void 0 : expectedType !== "function")) {
      throw new TypeError(`${label} is invalid: expected own property`);
    }
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}

// node_modules/@noble/curves/abstract/modular.js
var _0n2 = /* @__PURE__ */ BigInt(0);
var _1n2 = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _15n = /* @__PURE__ */ BigInt(15);
var _16n = /* @__PURE__ */ BigInt(16);
var POW_WINDOWED_MIN = /* @__PURE__ */ BigInt("0x10000000000000000");
function mod(a, b) {
  if (b <= _0n2)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow(num, power, modulo) {
  if (modulo <= _1n2)
    throw new Error("pow: expected modulus > 1, got " + modulo);
  if (typeof power !== "bigint")
    throw new TypeError("invalid exponent: expected bigint, got " + typeof power);
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return _1n2;
  if (power === _1n2)
    return num;
  let d = num % modulo;
  if (d < _0n2)
    d += modulo;
  if (power < POW_WINDOWED_MIN) {
    let p2 = _1n2;
    while (power > _0n2) {
      if (power & _1n2)
        p2 = p2 * d % modulo;
      d = d * d % modulo;
      power >>= _1n2;
    }
    return p2;
  }
  const digits = [];
  while (power > _0n2) {
    digits.push(Number(power & _15n));
    power >>= _4n;
  }
  const table = new Array(16);
  table[0] = _1n2;
  table[1] = d;
  for (let i = 2; i < 16; i++)
    table[i] = table[i - 1] * d % modulo;
  let p = table[digits[digits.length - 1]];
  for (let w = digits.length - 2; w >= 0; w--) {
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    const digit = digits[w];
    if (digit !== 0)
      p = p * table[digit] % modulo;
  }
  return p;
}
function pow2(x, power, modulo) {
  if (modulo <= _1n2)
    throw new Error("pow2: expected modulus > 1, got " + modulo);
  if (power < _0n2)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  while (power-- > _0n2) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _1n2)
    throw new Error("invert: expected modulus > 1, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, u = _1n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    b = a, a = r, x = u, u = m;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function invertCt(a, prime) {
  if (prime <= _1n2)
    throw new Error("invertCt: expected prime modulus > 1, got " + prime);
  const an = mod(a, prime);
  if (an === _0n2)
    throw new Error("invertCt: expected non-zero number");
  const inverse = pow(an, prime - _2n, prime);
  if (mod(an * inverse, prime) !== _1n2)
    throw new Error("invertCt: does not exist");
  return inverse;
}
function assertIsSquare(Fp2, root, n) {
  const F = Fp2;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function aoddModulus(order, fnName) {
  if ((order & _1n2) === _0n2)
    throw new Error(fnName + ": expected odd modulus, got " + order);
}
function sqrt3mod4(Fp2, n) {
  const F = Fp2;
  const p1div4 = (F.ORDER + _1n2) / _4n;
  const root = F.pow(n, p1div4);
  assertIsSquare(F, root, n);
  return root;
}
function sqrt5mod8(Fp2, n) {
  const F = Fp2;
  const p5div8 = (F.ORDER - _5n) / _8n;
  const n2 = F.mul(n, _2n);
  const v = F.pow(n2, p5div8);
  const nv = F.mul(n, v);
  const i = F.mul(F.mul(nv, _2n), v);
  const root = F.mul(nv, F.sub(i, F.ONE));
  assertIsSquare(F, root, n);
  return root;
}
function sqrt9mod16(P3) {
  const Fp_ = Field(P3);
  const tn = tonelliShanks(P3);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P3 + _7n) / _16n;
  return ((Fp2, n) => {
    const F = Fp2;
    let tv1 = F.pow(n, c4);
    let tv2 = F.mul(tv1, c1);
    const tv3 = F.mul(tv1, c2);
    const tv4 = F.mul(tv1, c3);
    const e1 = F.eql(F.sqr(tv2), n);
    const e2 = F.eql(F.sqr(tv3), n);
    tv1 = F.cmov(tv1, tv2, e1);
    tv2 = F.cmov(tv4, tv3, e2);
    const e3 = F.eql(F.sqr(tv2), n);
    const root = F.cmov(tv1, tv2, e3);
    assertIsSquare(F, root, n);
    return root;
  });
}
function tonelliShanks(P3) {
  if (P3 < _3n)
    throw new Error("sqrt is not defined for small field");
  aoddModulus(P3, "tonelliShanks");
  let Q = P3 - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P3);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp2, n) {
    const F = Fp2;
    if (F.is0(n))
      return n;
    if (FpLegendre(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = F.mul(F.ONE, cc);
    let t = F.pow(n, Q);
    let R = F.pow(n, Q1div2);
    while (!F.eql(t, F.ONE)) {
      if (F.is0(t))
        throw new Error("Cannot find square root: probably non-prime P");
      let i = 1;
      let t_tmp = F.sqr(t);
      while (!F.eql(t_tmp, F.ONE)) {
        i++;
        t_tmp = F.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = F.pow(c, exponent);
      M = i;
      c = F.sqr(b);
      t = F.mul(t, c);
      R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P3) {
  aoddModulus(P3, "Fp.sqrt");
  if (P3 % _4n === _3n)
    return sqrt3mod4;
  if (P3 % _8n === _5n)
    return sqrt5mod8;
  if (P3 % _16n === _9n)
    return sqrt9mod16(P3);
  return tonelliShanks(P3);
}
var isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n2) === _1n2;
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  aobject2(field, "field");
  if (typeof field.ORDER !== "bigint")
    throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof field.ORDER);
  asafenumber(field.BYTES, "BYTES");
  asafenumber(field.BITS, "BITS");
  for (const name of FIELD_FIELDS)
    afunction(field[name], "field." + name);
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n2)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpInvertBatch(Fp2, nums, passZero = false) {
  validateField(Fp2);
  aarray(nums, "nums");
  abool(passZero, "passZero");
  const F = Fp2;
  const inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = acc;
    return F.mul(acc, num);
  }, F.ONE);
  const invertedAcc = F.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = F.mul(acc, inverted[i]);
    return F.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp2, n) {
  validateField(Fp2);
  const F = Fp2;
  aoddModulus(F.ORDER, "FpLegendre");
  const p1mod2 = (F.ORDER - _1n2) / _2n;
  const powered = F.pow(n, p1mod2);
  const yes = F.eql(powered, F.ONE);
  const zero = F.eql(powered, F.ZERO);
  const no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber2(nBitLength);
  if (n <= _0n2)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT = /* @__PURE__ */ new WeakMap();
var _Field = class {
  constructor(ORDER, opts = {}) {
    __publicField(this, "ORDER");
    __publicField(this, "BITS");
    __publicField(this, "BYTES");
    __publicField(this, "isLE");
    __publicField(this, "ZERO", _0n2);
    __publicField(this, "ONE", _1n2);
    __publicField(this, "_lengths");
    __publicField(this, "_mod");
    if (ORDER <= _1n2)
      throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
    let _nbitLength = void 0;
    this.isLE = false;
    if (opts != null && typeof opts === "object") {
      if (typeof opts.BITS === "number")
        _nbitLength = opts.BITS;
      if (typeof opts.sqrt === "function")
        Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
      if (typeof opts.isLE === "boolean")
        this.isLE = opts.isLE;
      if (opts.allowedLengths)
        this._lengths = Object.freeze(opts.allowedLengths.slice());
      if (typeof opts.modFromBytes === "boolean")
        this._mod = opts.modFromBytes;
    }
    const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    Object.freeze(this);
  }
  create(num) {
    return mod(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num !== "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num);
    return _0n2 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n2;
  }
  // is valid and invertible
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n2) === _1n2;
  }
  neg(num) {
    return mod(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return pow(num, power, this.ORDER);
  }
  div(lhs, rhs) {
    return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
  }
  // Same as above, but doesn't normalize
  sqrN(num) {
    return num * num;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num) {
    return invert(num, this.ORDER);
  }
  sqrt(num) {
    let sqrt = FIELD_SQRT.get(this);
    if (!sqrt)
      FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER));
    return sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes2(bytes);
    const { _lengths: allowedLengths, BYTES, isLE: isLE2, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE2 ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE2 ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
    if (modFromBytes)
      scalar = mod(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(lst) {
    return FpInvertBatch(this, lst, true);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    abool(condition, "condition");
    return condition ? b : a;
  }
};
function Field(ORDER, opts = {}) {
  Object.freeze(_Field.prototype);
  return new _Field(ORDER, opts);
}

// node_modules/@noble/curves/abstract/curve.js
var _0n3 = /* @__PURE__ */ BigInt(0);
var _1n3 = /* @__PURE__ */ BigInt(1);
var _4n2 = /* @__PURE__ */ BigInt(4);
var BLIND_BYTES = 16;
var BLIND_BITS = 128;
var FW_WINDOW = 5;
var TABLE_BYTES_MAX = /* @__PURE__ */ (() => 2 ** 31)();
function validatePointCons(Point) {
  const pc = Point;
  if (typeof pc !== "function")
    throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
  afunction(pc.fromAffine, "Point.fromAffine");
  afunction(pc.fromBytes, "Point.fromBytes");
  afunction(pc.fromHex, "Point.fromHex");
  aobject2(pc.BASE, "Point.BASE");
  aobject2(pc.ZERO, "Point.ZERO");
  validateField(pc.Fp);
  validateField(pc.Fn);
}
function normalizeZ(c, points) {
  validatePointCons(c);
  validateMSMPoints(points, c);
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits, min = 1) {
  if (!Number.isSafeInteger(W) || W < min || W > bits)
    throw new Error("invalid window size, expected [" + min + ".." + bits + "], got W=" + W);
}
function validateTableBytes(numPoints, fpBytes) {
  const bytes = numPoints * (4 * fpBytes + 128);
  if (bytes > TABLE_BYTES_MAX)
    throw new Error("invalid window size: table would need ~" + Math.ceil(bytes / 2 ** 20) + " MiB, max " + TABLE_BYTES_MAX / 2 ** 20 + " MiB");
}
function probeRandomBytes(randomBytes3, length) {
  if (randomBytes3 === void 0)
    return void 0;
  afunction(randomBytes3, "randomBytes");
  try {
    const probe = randomBytes3(length);
    if (!isBytes2(probe) || probe.length !== length)
      return void 0;
  } catch {
    return void 0;
  }
  return randomBytes3;
}
function validateMSMPoints(points, c) {
  aarray(points, "points");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field, maxScalar) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    const ok = maxScalar === void 0 ? field.isValid(s) : isPosBig(s) && s < maxScalar;
    if (!ok)
      throw new Error("invalid scalar at index " + i);
  });
}
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getWindowSize(P3) {
  return pointWindowSizes.get(P3) || 1;
}
function oddMultiples(p, size) {
  const dbl = p.double();
  const t = [p];
  for (let j = 1; j < size; j++)
    t.push(t[j - 1].add(dbl));
  return t;
}
function wnafDigits(n, W) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const d = [];
  while (n > _0n3) {
    let w = 0;
    if (n & _1n3) {
      w = Number(n & mask);
      if (w >= half)
        w -= size;
      n -= BigInt(w);
    }
    d.push(w);
    n >>= _1n3;
  }
  return d;
}
function signedWindowDigits(n, W, windows) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const shiftBy = BigInt(W);
  const d = [];
  for (let w = 0; w < windows; w++) {
    let v = Number(n & mask);
    n >>= shiftBy;
    if (v > half) {
      v -= size;
      n += _1n3;
    }
    d.push(v);
  }
  if (n !== _0n3)
    throw new Error("invalid wnaf");
  return d;
}
function wnafWalk(zero, tables, digits) {
  let max = 0;
  for (const d of digits)
    max = Math.max(max, d.length);
  let acc = zero;
  for (let bit = max - 1; bit >= 0; bit--) {
    if (bit !== max - 1)
      acc = acc.double();
    for (let i = 0; i < digits.length; i++) {
      const w = digits[i][bit];
      if (w) {
        const item = tables[i][Math.abs(w) - 1 >> 1];
        acc = acc.add(w < 0 ? item.negate() : item);
      }
    }
  }
  return acc;
}
var ScalarMultiplier = class {
  // Parametrized with a given Point class (not individual point)
  constructor(Point, randomBytes3) {
    __publicField(this, "Point");
    __publicField(this, "BASE");
    __publicField(this, "ZERO");
    __publicField(this, "randomBytes");
    __publicField(this, "wnafPrecomputes", /* @__PURE__ */ new WeakMap());
    __publicField(this, "baseCanBeBlinded");
    __publicField(this, "bits");
    validatePointCons(Point);
    this.randomBytes = probeRandomBytes(randomBytes3, BLIND_BYTES);
    this.Point = Point;
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.bits = Point.Fn.BITS;
  }
  /**
   * Creates a signed fixed-window wNAF precomputation table: for every window w, the
   * multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P`, flattened. All doublings are baked into the table,
   * so cached multiplication is additions-only. `windows = ceil(bits/W) + 1`: the extra
   * window absorbs the final carry of signed-digit recoding.
   * For a 256-bit curve and W=6, the table is 44⋅32 = 1408 points.
   * @param point - Point instance
   * @param W - window size
   * @param bits - scalar bitlength the table must cover
   */
  buildWnafTable(point, W, bits) {
    const windows = Math.ceil(bits / W) + 1;
    const half = 2 ** (W - 1);
    const comp = [];
    let base = point;
    for (let w = 0; w < windows; w++) {
      let acc = base;
      for (let i = 0; i < half; i++) {
        comp.push(acc);
        acc = acc.add(base);
      }
      base = comp[comp.length - 1].double();
    }
    return { W, bits, windows, comp };
  }
  /**
   * Implements ec multiplication using precomputed signed fixed-window wNAF tables.
   * Constant-time: fixed window count with one table addition per window — zero digits feed
   * the fake accumulator — and no doublings; the lookup scans the whole window slice.
   * Scalar bounds are validated by the public entry points ({@link ScalarMultiplier.mulCT},
   * {@link ScalarMultiplier.mulCTBlinded}, {@link ScalarMultiplier.mulUnsafe});
   * signedWindowDigits throws if `n` exceeds the table.
   * @returns real and fake (for const-time) points
   */
  wnafCachedCT(precomputes, n) {
    const { W, windows, comp } = precomputes;
    const half = 2 ** (W - 1);
    const digits = signedWindowDigits(n, W, windows);
    let p = this.ZERO;
    let f = this.BASE;
    for (let w = 0; w < windows; w++) {
      const digit = digits[w];
      const start = w * half;
      const idx = Math.abs(digit) - 1;
      let sel = comp[start];
      for (let i = 1; i < half; i++)
        sel = i === idx ? comp[start + i] : sel;
      const neg = sel.negate();
      if (digit === 0)
        f = f.add(comp[start]);
      else
        p = p.add(digit < 0 ? neg : sel);
    }
    return { p, f };
  }
  // Cache key is point identity plus (W, bits); at most two entries exist per point (public-width
  // `Fn.BITS` and blinded `Fn.BITS + BLIND_BITS`). Callers must not reuse the same point with
  // incompatible `transform(...)` layouts and expect a separate cache entry.
  getWnafPrecomputes(W, point, bits, transform) {
    let entries = this.wnafPrecomputes.get(point);
    let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
    if (!comp) {
      comp = this.buildWnafTable(point, W, bits);
      if (typeof transform === "function")
        comp = { ...comp, comp: transform(comp.comp) };
      if (!entries) {
        entries = [];
        this.wnafPrecomputes.set(point, entries);
      }
      entries.push(comp);
    }
    return comp;
  }
  assertPoint(point) {
    if (!(point instanceof this.Point))
      throw new TypeError('"point" expected Point instance, got type=' + typeof point);
  }
  // Shared prologue of the constant-time entry points. Rejects scalar 0: in key/signature-style
  // callers a zero scalar means broken upstream plumbing, and concrete Points already reject it.
  // Uses inRange instead of Fn.isValidNot0: validateField() only certifies the arithmetic subset.
  validateMulInput(point, scalar) {
    this.assertPoint(point);
    if (!inRange(scalar, _1n3, this.Point.Fn.ORDER))
      throw new Error("invalid scalar");
  }
  // Constant-time dispatch shared by mulCT / mulCTBlinded. Un-precomputed points (W===1, e.g.
  // ECDH peer keys) skip building a throwaway cached table in favor of a small fixed-window
  // multiply. `n` must be < 2^bits.
  runCT(point, n, bits, transform) {
    const W = getWindowSize(point);
    if (W === 1)
      return this.fixedWindowCT(point, n, bits);
    return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
  }
  mulCT(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    return this.runCT(point, scalar, this.bits, transform);
  }
  mulCTBlinded(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    if (this.randomBytes === void 0)
      throw new Error("randomBytes is required for scalar blinding");
    const bits = this.Point.Fn.BITS + BLIND_BITS;
    const blind = this.randomBytes(BLIND_BYTES);
    if (!isBytes2(blind) || blind.length !== BLIND_BYTES)
      throw new Error("randomBytes returned invalid byte array");
    blind[0] = blind[0] & 63 | 128;
    const n = scalar + bytesToNumberBE(blind) * this.Point.Fn.ORDER;
    return this.runCT(point, n, bits, transform);
  }
  /**
   * Constant-time multiplication `n*point` for an un-precomputed point, via a small fixed window.
   * A cached wNAF table only pays off when reused; a flat 2^FW_WINDOW table (`size-1` adds) is
   * far cheaper to build for a single use. The point-operation sequence is independent of `n`:
   * build the table, then per window exactly FW_WINDOW doublings, a data-oblivious scan over
   * every table entry, and one addition (adds the identity when the window digit is 0 — never
   * skipped).
   *
   * `n` must be `< 2^bits`. Assumes complete addition (adding the identity costs the same as any
   * add), which holds for the Weierstrass/Edwards point types used here. The table is left in
   * projective form (no normalizeZ): normalizing this small a table costs more than the
   * mixed-add savings it would buy for a single multiply.
   * @returns real point `p`; `f` duplicates it only to match {@link wnafCachedCT}'s return shape
   * (this path needs no fake accumulator — its op-count is already scalar-independent).
   */
  fixedWindowCT(point, n, bits) {
    const W = FW_WINDOW;
    const size = 1 << W;
    const mask = bitMask(W);
    const table = new Array(size);
    table[0] = this.ZERO;
    for (let i = 1; i < size; i++)
      table[i] = table[i - 1].add(point);
    const windows = Math.ceil(bits / W);
    let acc = this.ZERO;
    for (let window2 = windows - 1; window2 >= 0; window2--) {
      if (window2 !== windows - 1)
        for (let d = 0; d < W; d++)
          acc = acc.double();
      const digit = Number(n >> BigInt(window2 * W) & mask);
      let sel = table[0];
      for (let i = 1; i < size; i++)
        sel = i === digit ? table[i] : sel;
      acc = acc.add(sel);
    }
    return { p: acc, f: acc };
  }
  shouldBlind(point, cofactor) {
    if (this.randomBytes === void 0)
      return false;
    if (cofactor === _1n3)
      return true;
    if (point !== this.BASE)
      return false;
    if (this.baseCanBeBlinded === void 0)
      this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
    return this.baseCanBeBlinded;
  }
  mulSecret(point, scalar, cofactor, transform) {
    return this.shouldBlind(point, cofactor) ? this.mulCTBlinded(point, scalar, transform) : this.mulCT(point, scalar, transform);
  }
  mulUnsafe(point, scalar, transform) {
    this.assertPoint(point);
    if (!isPosBig(scalar))
      throw new Error("invalid scalar");
    const W = getWindowSize(point);
    if (W === 1 || scalar >= this.Point.Fn.ORDER)
      return mulAddUnsafe(this.Point, [point], [scalar], true);
    const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
    return this.wnafCachedCT(precomputes, scalar).p;
  }
  // Remembers the window size used for precomputed wNAF multiplication of the given point
  // and drops any previously built tables. Usually only the base point is precomputed.
  // W=1 resets the point to the un-precomputed (table-less) paths.
  // W is additionally capped so tables stay under ~2 GiB ({@link TABLE_BYTES_MAX}).
  setWindowSize(point, W) {
    this.assertPoint(point);
    validateW(W, this.bits);
    const windows = Math.ceil((this.bits + BLIND_BITS) / W) + 1;
    validateTableBytes(windows * 2 ** (W - 1), this.Point.Fp.BYTES);
    pointWindowSizes.set(point, W);
    this.wnafPrecomputes.delete(point);
  }
  // True when a window size is set: tables themselves are built lazily on first multiply.
  hasWindowSize(point) {
    return getWindowSize(point) !== 1;
  }
};
function mulAddUnsafe(c, points, scalars, allowOversized = false) {
  validatePointCons(c);
  validateMSMPoints(points, c);
  abool(allowOversized, "allowOversized");
  validateMSMScalars(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n2 : void 0);
  if (points.length !== scalars.length)
    throw new Error("arrays of points and scalars must have equal length");
  const tables = points.map((p) => oddMultiples(p, 4));
  const digits = scalars.map((n) => wnafDigits(n, 4));
  return wnafWalk(c.ZERO, tables, digits);
}
function createField(order, field, isLE2) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE: isLE2 });
  }
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (type !== "weierstrass" && type !== "edwards")
    throw new Error('expected curve type "weierstrass" or "edwards"');
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  validateObject(curveOpts);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(isPosBig(val) && val !== _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp2 = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp2.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp: Fp2, Fn };
}
function createKeygen(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// node_modules/@noble/curves/abstract/edwards.js
var _0n4 = /* @__PURE__ */ BigInt(0);
var _1n4 = /* @__PURE__ */ BigInt(1);
var _2n2 = /* @__PURE__ */ BigInt(2);
var _4n3 = /* @__PURE__ */ BigInt(4);
var _8n2 = /* @__PURE__ */ BigInt(8);
function isEdValidXY(Fp2, CURVE, x, y) {
  const x2 = Fp2.sqr(x);
  const y2 = Fp2.sqr(y);
  const left = Fp2.add(Fp2.mul(CURVE.a, x2), y2);
  const right = Fp2.add(Fp2.ONE, Fp2.mul(CURVE.d, Fp2.mul(x2, y2)));
  return Fp2.eql(left, right);
}
function edwards(params, extraOpts = {}) {
  validateObject(extraOpts, {}, {}, "extraOpts");
  const opts = extraOpts;
  const validated = createCurveFields("edwards", params, opts, opts.FpFnLE);
  const { Fp: Fp2, Fn } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  if (FpLegendre(Fp2, CURVE.a) !== 1)
    throw new Error("edwards: CURVE.a must be a square in Fp for complete addition formulas");
  if (FpLegendre(Fp2, CURVE.d) !== -1)
    throw new Error("edwards: CURVE.d must be a non-square in Fp for complete addition formulas");
  validateObject(opts, {}, { uvRatio: "function", randomBytes: "function" });
  const randomBytes3 = opts.randomBytes === void 0 ? randomBytes2 : opts.randomBytes;
  const MASK = _2n2 << BigInt(Fp2.BYTES * 8) - _1n4;
  function isOdd(n) {
    if (!Fp2.isOdd)
      throw new Error("Field does not have .isOdd()");
    return Fp2.isOdd(n);
  }
  const uvRatio2 = opts.uvRatio === void 0 ? (u, v) => {
    try {
      return { isValid: true, value: Fp2.sqrt(Fp2.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n4 };
    }
  } : opts.uvRatio;
  if (!isEdValidXY(Fp2, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const mulA = Fp2.eql(CURVE.a, Fp2.neg(Fp2.ONE)) ? (x) => Fp2.neg(x) : Fp2.eql(CURVE.a, Fp2.ONE) ? (x) => x : (x) => Fp2.mul(CURVE.a, x);
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n4 : _0n4;
    aInRange("coordinate " + title, n, min, MASK);
    return n;
  }
  function aedpoint(other) {
    if (!(other instanceof Point))
      throw new Error("EdwardsPoint expected");
  }
  const _Point = class _Point {
    constructor(X, Y, Z, T) {
      __publicField(this, "X");
      __publicField(this, "Y");
      __publicField(this, "Z");
      __publicField(this, "T");
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /**
     * Create one extended Edwards point from affine coordinates.
     * Does NOT validate that the point is on-curve or torsion-free.
     * Use `.assertValidity()` on adversarial inputs.
     */
    static fromAffine(p) {
      if (p instanceof _Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new _Point(x, y, Fp2.ONE, Fp2.mul(x, y));
    }
    // Uses algo from RFC8032 5.1.3.
    static fromBytes(bytes, zip215 = false) {
      const len = Fp2.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes(abytes2(bytes, len, "point"));
      abool(zip215, "zip215");
      const normed = copyBytes(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE(normed);
      const max = zip215 ? MASK : Fp2.ORDER;
      aInRange("point.y", y, _0n4, max);
      const y2 = Fp2.sqr(y);
      const u = Fp2.sub(y2, Fp2.ONE);
      const v = Fp2.sub(Fp2.mulN(d, y2), a);
      let { isValid, value: x } = uvRatio2(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = isOdd(x);
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && Fp2.is0(x) && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = Fp2.neg(x);
      return _Point.fromAffine({ x, y });
    }
    static fromHex(hex, zip215 = false) {
      return _Point.fromBytes(hexToBytes2(hex), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 6, isLazy = true) {
      wnaf.setWindowSize(this, windowSize);
      if (!isLazy)
        this.multiply(_2n2);
      return this;
    }
    // Useful in fromAffine() - not for fromBytes(), which always created valid points.
    assertValidity() {
      const p = this;
      const { a, d } = CURVE;
      if (p.is0())
        throw new Error("bad point: ZERO");
      const { X, Y, Z, T } = p;
      const X2 = Fp2.sqr(X);
      const Y2 = Fp2.sqr(Y);
      const Z2 = Fp2.sqr(Z);
      const Z4 = Fp2.sqr(Z2);
      const aX2 = Fp2.mul(X2, a);
      const left = Fp2.mul(Fp2.add(aX2, Y2), Z2);
      const right = Fp2.add(Z4, Fp2.mul(d, Fp2.mul(X2, Y2)));
      if (!Fp2.eql(left, right))
        throw new Error("bad point: equation left != right (1)");
      const XY = Fp2.mul(X, Y);
      const ZT = Fp2.mul(Z, T);
      if (!Fp2.eql(XY, ZT))
        throw new Error("bad point: equation left != right (2)");
    }
    // Compare one point to another.
    equals(other) {
      aedpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const X1Z2 = Fp2.mul(X1, Z2);
      const X2Z1 = Fp2.mul(X2, Z1);
      const Y1Z2 = Fp2.mul(Y1, Z2);
      const Y2Z1 = Fp2.mul(Y2, Z1);
      return Fp2.eql(X1Z2, X2Z1) && Fp2.eql(Y1Z2, Y2Z1);
    }
    is0() {
      return this.equals(_Point.ZERO);
    }
    negate() {
      return new _Point(Fp2.neg(this.X), this.Y, this.Z, Fp2.neg(this.T));
    }
    // Fast algo for doubling Extended Point.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
    // Cost: 4M + 4S + 1*a + 6add + 1*2.
    double() {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const A = Fp2.sqr(X1);
      const B = Fp2.sqr(Y1);
      const C = Fp2.mul(Fp2.sqr(Z1), _2n2);
      const D = mulA(A);
      const x1y1 = Fp2.addN(X1, Y1);
      const E = Fp2.sub(Fp2.subN(Fp2.sqr(x1y1), A), B);
      const G = Fp2.addN(D, B);
      const F = Fp2.subN(G, C);
      const H = Fp2.subN(D, B);
      const X3 = Fp2.mul(E, F);
      const Y3 = Fp2.mul(G, H);
      const T32 = Fp2.mul(E, H);
      const Z3 = Fp2.mul(F, G);
      return new _Point(X3, Y3, Z3, T32);
    }
    // Fast algo for adding 2 Extended Points.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
    // Cost: 9M + 1*a + 1*d + 7add.
    add(other) {
      aedpoint(other);
      const { d } = CURVE;
      const { X: X1, Y: Y1, Z: Z1, T: T12 } = this;
      const { X: X2, Y: Y2, Z: Z2, T: T22 } = other;
      const A = Fp2.mul(X1, X2);
      const B = Fp2.mul(Y1, Y2);
      const C = Fp2.mul(Fp2.mulN(T12, d), T22);
      const D = Fp2.mul(Z1, Z2);
      const E = Fp2.sub(Fp2.subN(Fp2.mulN(Fp2.addN(X1, Y1), Fp2.addN(X2, Y2)), A), B);
      const F = Fp2.subN(D, C);
      const G = Fp2.addN(D, C);
      const H = Fp2.sub(B, mulA(A));
      const X3 = Fp2.mul(E, F);
      const Y3 = Fp2.mul(G, H);
      const T32 = Fp2.mul(E, H);
      const Z3 = Fp2.mul(F, G);
      return new _Point(X3, Y3, Z3, T32);
    }
    subtract(other) {
      aedpoint(other);
      return this.add(other.negate());
    }
    // Constant-time multiplication.
    multiply(scalar) {
      if (!Fn.isValidNot0(scalar))
        throw new RangeError("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
      return normalize([p, f])[0];
    }
    // Non-constant-time multiplication. Uses double-and-add algorithm.
    // It's faster, but should only be used when you don't care about
    // an exposed private key e.g. sig verification.
    // Keeps the same subgroup-scalar contract: 0 is allowed for public-scalar callers, but
    // n and larger values are rejected instead of being reduced mod n to the identity point.
    multiplyUnsafe(scalar) {
      if (!Fn.isValid(scalar))
        throw new RangeError("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n4)
        return _Point.ZERO;
      if (this.is0() || scalar === _1n4)
        return this;
      return wnaf.mulUnsafe(this, scalar, normalize);
    }
    // Checks if point is of small order.
    // If you add something to small order point, you will have "dirty"
    // point with torsion component.
    // Clears cofactor and checks if the result is 0.
    isSmallOrder() {
      return this.clearCofactor().is0();
    }
    // Multiplies point by curve order and checks if the result is 0.
    // Returns `false` is the point is dirty.
    isTorsionFree() {
      return wnaf.mulUnsafe(this, CURVE.n).is0();
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      if (iz != null && typeof iz !== "bigint")
        throw new TypeError('"invertedZ" expected bigint, got type=' + typeof iz);
      const { X, Y, Z } = p;
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp2.create(_8n2) : Fp2.inv(Z);
      const x = Fp2.mul(X, iz);
      const y = Fp2.mul(Y, iz);
      const zz = Fp2.mul(Z, iz);
      if (is0)
        return { x: Fp2.ZERO, y: Fp2.ONE };
      if (!Fp2.eql(zz, Fp2.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    clearCofactor() {
      if (cofactor === _1n4)
        return this;
      if (cofactor === _2n2)
        return this.double();
      if (cofactor === _4n3)
        return this.double().double();
      if (cofactor === _8n2)
        return this.double().double().double();
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp2.toBytes(y);
      bytes[bytes.length - 1] |= isOdd(x) ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex2(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  };
  __publicField(_Point, "BASE", new _Point(CURVE.Gx, CURVE.Gy, Fp2.ONE, Fp2.mul(CURVE.Gx, CURVE.Gy)));
  __publicField(_Point, "ZERO", new _Point(Fp2.ZERO, Fp2.ONE, Fp2.ONE, Fp2.ZERO));
  __publicField(_Point, "Fp", Fp2);
  __publicField(_Point, "Fn", Fn);
  let Point = _Point;
  const normalize = (points) => normalizeZ(Point, points);
  const wnaf = new ScalarMultiplier(Point, randomBytes3);
  if (wnaf.bits >= 6)
    Point.BASE.precompute(6);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}

// node_modules/@noble/curves/abstract/montgomery.js
var _0n5 = /* @__PURE__ */ BigInt(0);
var _1n5 = /* @__PURE__ */ BigInt(1);
var _2n3 = /* @__PURE__ */ BigInt(2);
function cmask(P3, swap) {
  return P3 + swap - (swap >> _1n5 << _1n5);
}
function cswap(P3) {
  const offset = BigInt(6) * P3;
  return (mask, x_2, x_3) => {
    const sum = x_2 + x_3;
    const d = offset + x_3 - x_2;
    const a = (d * mask + x_2) % P3;
    return { x_2: a, x_3: sum - a };
  };
}
function validateOpts(curve) {
  validateObject(curve, {
    P: "bigint",
    type: "string",
    adjustScalarBytes: "function",
    powPminus2: "function"
  }, {
    randomBytes: "function",
    scalarMultBase: "function"
  });
  return Object.freeze({ ...curve });
}
function montgomery(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { P: P3, type, adjustScalarBytes: adjustScalarBytes2, powPminus2, randomBytes: rand } = CURVE;
  const mulBaseHook = CURVE.scalarMultBase;
  const is25519 = type === "x25519";
  if (!is25519 && type !== "x448")
    throw new Error("invalid type");
  const randomBytes_ = rand === void 0 ? randomBytes2 : rand;
  const montgomeryBits = is25519 ? 255 : 448;
  const swap = cswap(P3);
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? BigInt(9) : BigInt(5);
  const a24 = is25519 ? BigInt(121665) : BigInt(39081);
  const minScalar = is25519 ? _2n3 ** BigInt(254) : _2n3 ** BigInt(447);
  const maxAdded = is25519 ? BigInt(8) * (_2n3 ** BigInt(251) - _1n5) : BigInt(4) * (_2n3 ** BigInt(445) - _1n5);
  const maxScalar = minScalar + maxAdded + _1n5;
  const modP = (n) => mod(n, P3);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE(modP(u), fieldLen);
  }
  function decodeU(u) {
    const _u = copyBytes(abytes2(u, fieldLen, "uCoordinate"));
    if (is25519)
      _u[31] &= 127;
    return modP(bytesToNumberLE(_u));
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE(adjustScalarBytes2(copyBytes(abytes2(scalar, fieldLen, "scalar"))));
  }
  const lowOrderU = new Set(is25519 ? [
    _0n5,
    _1n5,
    P3 - _1n5,
    BigInt("325606250916557431795983626356110631294008115727848805560023387167927233504"),
    BigInt("39382357235489614581723060781553021112529911719440698176882885853963445705823")
  ] : [_0n5, _1n5, P3 - _1n5]);
  function scalarMult(scalar, u) {
    const pointU = decodeU(u);
    if (lowOrderU.has(pointU))
      throw new Error("invalid private or public key received");
    const pu = montgomeryLadder(pointU, decodeScalar(scalar));
    if (pu === _0n5)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  function scalarMultBase(scalar) {
    if (mulBaseHook === void 0)
      return scalarMult(scalar, GuBytes);
    const k = decodeScalar(scalar);
    aInRange("scalar", k, minScalar, maxScalar);
    const pu = modP(mulBaseHook(k));
    if (pu === _0n5)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  const getPublicKey = scalarMultBase;
  const getSharedSecret = scalarMult;
  function montgomeryLadder(u, scalar) {
    aInRange("u", u, _0n5, P3);
    aInRange("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = _1n5;
    let z_2 = _0n5;
    let x_3 = u;
    let z_3 = _1n5;
    const kx = k ^ k >> _1n5;
    for (let t = BigInt(montgomeryBits - 1); t >= _0n5; t--) {
      const mask2 = cmask(P3, kx >> t);
      ({ x_2, x_3 } = swap(mask2, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = swap(mask2, z_2, z_3));
      const A = x_2 + z_2;
      const AA = modP(A * A);
      const B = x_2 - z_2;
      const BB = modP(B * B);
      const E = AA - BB;
      const C = x_3 + z_3;
      const D = x_3 - z_3;
      const DA = modP(D * A);
      const CB = modP(C * B);
      const dacb = DA + CB;
      const da_cb = DA - CB;
      x_3 = modP(dacb * dacb);
      z_3 = modP(x_1 * modP(da_cb * da_cb));
      x_2 = modP(AA * BB);
      z_2 = modP(E * (AA + modP(a24 * E)));
    }
    const mask = cmask(P3, k);
    ({ x_2, x_3 } = swap(mask, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = swap(mask, z_2, z_3));
    const z2 = powPminus2(z_2);
    return modP(x_2 * z2);
  }
  const lengths = {
    secretKey: fieldLen,
    publicKey: fieldLen,
    seed: fieldLen
  };
  const randomSecretKey = (seed) => {
    seed = seed === void 0 ? randomBytes_(fieldLen) : seed;
    abytes2(seed, lengths.seed, "seed");
    return seed;
  };
  const utils = { randomSecretKey };
  Object.freeze(lengths);
  Object.freeze(utils);
  return Object.freeze({
    keygen: createKeygen(randomSecretKey, getPublicKey),
    getSharedSecret,
    getPublicKey,
    scalarMult,
    scalarMultBase,
    utils,
    GuBytes: GuBytes.slice(),
    lengths
  });
}

// node_modules/@noble/curves/ed25519.js
var _0n6 = /* @__PURE__ */ BigInt(0);
var _1n6 = /* @__PURE__ */ BigInt(1);
var _2n4 = /* @__PURE__ */ BigInt(2);
var _3n2 = /* @__PURE__ */ BigInt(3);
var _5n2 = /* @__PURE__ */ BigInt(5);
var _8n3 = /* @__PURE__ */ BigInt(8);
var ed25519_CURVE_p = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
var ed25519_CURVE = /* @__PURE__ */ (() => ({
  p: ed25519_CURVE_p,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n3,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
}))();
function ed25519_pow_2_252_3(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P3 = ed25519_CURVE_p;
  const x2 = x * x % P3;
  const b2 = x2 * x % P3;
  const b4 = pow2(b2, _2n4, P3) * b2 % P3;
  const b5 = pow2(b4, _1n6, P3) * x % P3;
  const b10 = pow2(b5, _5n2, P3) * b5 % P3;
  const b20 = pow2(b10, _10n, P3) * b10 % P3;
  const b40 = pow2(b20, _20n, P3) * b20 % P3;
  const b80 = pow2(b40, _40n, P3) * b40 % P3;
  const b160 = pow2(b80, _80n, P3) * b80 % P3;
  const b240 = pow2(b160, _80n, P3) * b80 % P3;
  const b250 = pow2(b240, _10n, P3) * b10 % P3;
  const pow_p_5_8 = pow2(b250, _2n4, P3) * x % P3;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
var ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio(u, v) {
  const P3 = ed25519_CURVE_p;
  const v3 = mod(v * v * v, P3);
  const v7 = mod(v3 * v3 * v, P3);
  const pow3 = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
  let x = mod(u * v3 * pow3, P3);
  const vx2 = mod(v * x * x, P3);
  const root1 = x;
  const root2 = mod(x * ED25519_SQRT_M1, P3);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod(-u, P3);
  const noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P3);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE(x, P3))
    x = mod(-x, P3);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var ed25519_Point = /* @__PURE__ */ edwards(ed25519_CURVE, { uvRatio });
var Fp = /* @__PURE__ */ (() => ed25519_Point.Fp)();
var x25519 = /* @__PURE__ */ (() => {
  const P3 = ed25519_CURVE_p;
  const powPminus2 = (x) => {
    const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
    return mod(pow2(pow_p_5_8, _3n2, P3) * b2, P3);
  };
  return montgomery({
    P: P3,
    type: "x25519",
    powPminus2,
    adjustScalarBytes,
    // ~3x faster fixed-base: [k]B on the birationally-equivalent Edwards curve using cached
    // base tables, mapped back via u = (1+y)/(1-y) = (Z+Y)/(Z-Y) with one Fermat inversion.
    // Same construction as libsodium's crypto_scalarmult_curve25519_base.
    scalarMultBase: (k) => {
      const kn = mod(k, ed25519_Point.Fn.ORDER);
      if (kn === _0n6)
        return _0n6;
      const p = ed25519_Point.BASE.multiply(kn);
      return mod((p.Z + p.Y) * powPminus2(mod(p.Z - p.Y, P3)), P3);
    }
  });
})();
var ELL2_C1 = /* @__PURE__ */ (() => (ed25519_CURVE_p + _3n2) / _8n3)();
var ELL2_C2 = /* @__PURE__ */ (() => Fp.pow(_2n4, ELL2_C1))();
var ELL2_C3 = /* @__PURE__ */ (() => Fp.sqrt(Fp.neg(Fp.ONE)))();
var ELL2_J = /* @__PURE__ */ BigInt(486662);
function _map_to_curve_elligator2_curve25519(u) {
  let tv1 = Fp.sqr(u);
  tv1 = Fp.mul(tv1, _2n4);
  let xd = Fp.add(tv1, Fp.ONE);
  let x1n = Fp.neg(ELL2_J);
  let tv2 = Fp.sqr(xd);
  let gxd = Fp.mul(tv2, xd);
  let gx1 = Fp.mul(tv1, ELL2_J);
  gx1 = Fp.mul(gx1, x1n);
  gx1 = Fp.add(gx1, tv2);
  gx1 = Fp.mul(gx1, x1n);
  let tv3 = Fp.sqr(gxd);
  tv2 = Fp.sqr(tv3);
  tv3 = Fp.mul(tv3, gxd);
  tv3 = Fp.mul(tv3, gx1);
  tv2 = Fp.mul(tv2, tv3);
  let y11 = ed25519_pow_2_252_3(tv2).pow_p_5_8;
  y11 = Fp.mul(y11, tv3);
  let y12 = Fp.mul(y11, ELL2_C3);
  tv2 = Fp.sqr(y11);
  tv2 = Fp.mul(tv2, gxd);
  let e1 = Fp.eql(tv2, gx1);
  let y1 = Fp.cmov(y12, y11, e1);
  let x2n = Fp.mul(x1n, tv1);
  let y21 = Fp.mul(y11, u);
  y21 = Fp.mul(y21, ELL2_C2);
  let y22 = Fp.mul(y21, ELL2_C3);
  let gx2 = Fp.mul(gx1, tv1);
  tv2 = Fp.sqr(y21);
  tv2 = Fp.mul(tv2, gxd);
  let e2 = Fp.eql(tv2, gx2);
  let y2 = Fp.cmov(y22, y21, e2);
  tv2 = Fp.sqr(y1);
  tv2 = Fp.mul(tv2, gxd);
  let e3 = Fp.eql(tv2, gx1);
  let xn = Fp.cmov(x2n, x1n, e3);
  let y = Fp.cmov(y2, y1, e3);
  let e4 = Fp.isOdd(y);
  y = Fp.cmov(y, Fp.neg(y), e3 !== e4);
  return { xMn: xn, xMd: xd, yMn: y, yMd: _1n6 };
}

// src/crypto/elligator.ts
var P2 = (1n << 255n) - 19n;
var FIELD_BYTES = 32;
function decodeUCoordinate(bytes) {
  if (bytes.byteLength !== FIELD_BYTES) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: `A Curve25519 field element is ${FIELD_BYTES} bytes.` });
  }
  const out = new Uint8Array(bytes);
  out[FIELD_BYTES - 1] &= 127;
  return out;
}
var toNumber = (bytes) => {
  let n = 0n;
  for (let i = bytes.byteLength - 1; i >= 0; i--) n = n << 8n | BigInt(bytes[i]);
  return n;
};
var toBytes = (n) => {
  const out = new Uint8Array(FIELD_BYTES);
  for (let i = 0; i < FIELD_BYTES; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
};
function elligator2(u) {
  const { xMn, xMd } = _map_to_curve_elligator2_curve25519(toNumber(decodeUCoordinate(u)));
  return toBytes(mod(xMn * invertCt(xMd, P2), P2));
}

// node_modules/@noble/ciphers/utils.js
function isBytes3(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle3 = (title) => title ? `"${title}" ` : "";
function abool2(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle3(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function anumber3(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle3(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle3(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes3(value, length, title = "") {
  if (isBytes3(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber3(length, "length");
  const bytes = isBytes3(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle3(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function aexists2(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput2(out, instance) {
  abytes3(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function aoutput32(out, instance) {
  aoutput2(out, instance);
  if (!isAligned32(out))
    throw new Error("invalid output, must be aligned");
}
function u8(arr) {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean2(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView2(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
var swap8IfBE = isLE ? (n) => n : (n) => byteSwap(n) >>> 0;
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
function equalBytes(a, b) {
  a = abytes3(a);
  b = abytes3(b);
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function wrapMacConstructor(keyLen, macCons, fromMsg) {
  const mac = macCons;
  const getArgs = fromMsg || (() => []);
  const macC = (msg, key) => mac(key, ...getArgs(msg)).update(msg).digest();
  const tmp = mac(new Uint8Array(keyLen), ...getArgs(new Uint8Array(0)));
  macC.outputLen = tmp.outputLen;
  macC.blockLen = tmp.blockLen;
  macC.create = (key, ...args) => mac(key, ...args);
  return macC;
}
var wrapCipher = /* @__NO_SIDE_EFFECTS__ */ (params, constructor) => {
  function wrappedCipher(key, ...args) {
    abytes3(key, void 0, "key");
    if (params.nonceLength !== void 0) {
      const nonce = args[0];
      abytes3(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
    }
    const tagl = params.tagLength;
    const aadStart = params.nonceLength !== void 0 ? 1 : 0;
    if (!params.withAAD) {
      for (let i = aadStart; i < args.length; i++)
        if (isBytes3(args[i]))
          throw new Error("AAD not supported");
    }
    if (params.withAAD && args[aadStart] !== void 0)
      abytes3(args[aadStart], void 0, "AAD");
    const cipher = constructor(key, ...args);
    const checkOutput = (fnLength, output) => {
      if (output !== void 0) {
        if (fnLength !== 2)
          throw new Error("cipher output not supported");
        abytes3(output, void 0, "output");
      }
    };
    let called = false;
    const wrCipher = {
      encrypt(data, output) {
        if (called)
          throw new Error("cannot encrypt() twice with same key + nonce");
        called = true;
        abytes3(data, void 0, "data");
        checkOutput(cipher.encrypt.length, output);
        return cipher.encrypt(data, output);
      },
      decrypt(data, output) {
        abytes3(data, void 0, "data");
        if (tagl && data.length < tagl)
          throw new Error('"ciphertext" expected length >= tagLength=' + tagl);
        checkOutput(cipher.decrypt.length, output);
        return cipher.decrypt(data, output);
      }
    };
    return wrCipher;
  }
  Object.assign(wrappedCipher, params);
  return wrappedCipher;
};
function getOutput(expectedLength, out, onlyAligned = true) {
  if (out === void 0)
    return new Uint8Array(expectedLength);
  abytes3(out, expectedLength, "output");
  if (onlyAligned && !isAligned32(out))
    throw new Error("invalid output, must be aligned");
  return out;
}
function u64Lengths(dataLength, aadLength, isLE2) {
  anumber3(dataLength);
  anumber3(aadLength);
  abool2(isLE2);
  const num = new Uint8Array(16);
  const view2 = createView2(num);
  view2.setBigUint64(0, BigInt(aadLength), isLE2);
  view2.setBigUint64(8, BigInt(dataLength), isLE2);
  return num;
}
function isAligned32(bytes) {
  return bytes.byteOffset % 4 === 0;
}
function copyBytes2(bytes) {
  return Uint8Array.from(abytes3(bytes));
}

// node_modules/@noble/ciphers/_polyval.js
var BLOCK_SIZE = 16;
var ZEROS16 = /* @__PURE__ */ new Uint8Array(16);
var ZEROS32 = /* @__PURE__ */ u32(ZEROS16);
var POLY = 225;
var mul2 = (s0, s1, s2, s3) => {
  const hiBit = s3 & 1;
  return {
    s3: s2 << 31 | s3 >>> 1,
    s2: s1 << 31 | s2 >>> 1,
    s1: s0 << 31 | s1 >>> 1,
    // NIST SP 800-38D §6.3 applies `V >> 1` and XORs R on carry. In this
    // 4x32-bit split, R = 0xe1 || 0^120 lives in the top byte of s0.
    s0: s0 >>> 1 ^ POLY << 24 & -(hiBit & 1)
    // reduce % poly
  };
};
var swapLE = (n) => (n >>> 0 & 255) << 24 | (n >>> 8 & 255) << 16 | (n >>> 16 & 255) << 8 | n >>> 24 & 255 | 0;
var estimateWindow = (bytes) => {
  if (bytes > 64 * 1024)
    return 8;
  if (bytes > 1024)
    return 4;
  return 2;
};
var GHASH = class {
  // We select bits per window adaptively based on expectedLength
  constructor(key, expectedLength) {
    __publicField(this, "blockLen", BLOCK_SIZE);
    __publicField(this, "outputLen", BLOCK_SIZE);
    __publicField(this, "s0", 0);
    __publicField(this, "s1", 0);
    __publicField(this, "s2", 0);
    __publicField(this, "s3", 0);
    __publicField(this, "finished", false);
    __publicField(this, "destroyed", false);
    __publicField(this, "t");
    __publicField(this, "W");
    __publicField(this, "windowSize");
    abytes3(key, 16, "key");
    key = copyBytes2(key);
    const kView = createView2(key);
    let k0 = kView.getUint32(0, false);
    let k1 = kView.getUint32(4, false);
    let k2 = kView.getUint32(8, false);
    let k3 = kView.getUint32(12, false);
    const doubles = [];
    for (let i = 0; i < 128; i++) {
      doubles.push({ s0: swapLE(k0), s1: swapLE(k1), s2: swapLE(k2), s3: swapLE(k3) });
      ({ s0: k0, s1: k1, s2: k2, s3: k3 } = mul2(k0, k1, k2, k3));
    }
    const W = estimateWindow(expectedLength || 1024);
    if (![1, 2, 4, 8].includes(W))
      throw new Error("ghash: invalid window size, expected 2, 4 or 8");
    this.W = W;
    const bits = 128;
    const windows = bits / W;
    const windowSize = this.windowSize = 2 ** W;
    const items = [];
    for (let w = 0; w < windows; w++) {
      for (let byte = 0; byte < windowSize; byte++) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (let j = 0; j < W; j++) {
          const bit = byte >>> W - j - 1 & 1;
          if (!bit)
            continue;
          const { s0: d0, s1: d1, s2: d2, s3: d3 } = doubles[W * w + j];
          s0 ^= d0, s1 ^= d1, s2 ^= d2, s3 ^= d3;
        }
        items.push({ s0, s1, s2, s3 });
      }
    }
    this.t = items;
  }
  _updateBlock(s0, s1, s2, s3) {
    s0 ^= this.s0, s1 ^= this.s1, s2 ^= this.s2, s3 ^= this.s3;
    const { W, t, windowSize } = this;
    let o0 = 0, o1 = 0, o2 = 0, o3 = 0;
    const mask = (1 << W) - 1;
    let w = 0;
    for (const num of [s0, s1, s2, s3]) {
      for (let bytePos = 0; bytePos < 4; bytePos++) {
        const byte = num >>> 8 * bytePos & 255;
        for (let bitPos = 8 / W - 1; bitPos >= 0; bitPos--) {
          const bit = byte >>> W * bitPos & mask;
          const { s0: e0, s1: e1, s2: e2, s3: e3 } = t[w * windowSize + bit];
          o0 ^= e0, o1 ^= e1, o2 ^= e2, o3 ^= e3;
          w += 1;
        }
      }
    }
    this.s0 = o0;
    this.s1 = o1;
    this.s2 = o2;
    this.s3 = o3;
  }
  update(data) {
    aexists2(this);
    abytes3(data);
    data = copyBytes2(data);
    const b32 = u32(data);
    const blocks = Math.floor(data.length / BLOCK_SIZE);
    const left = data.length % BLOCK_SIZE;
    for (let i = 0; i < blocks; i++) {
      this._updateBlock(swap8IfBE(b32[i * 4 + 0]), swap8IfBE(b32[i * 4 + 1]), swap8IfBE(b32[i * 4 + 2]), swap8IfBE(b32[i * 4 + 3]));
    }
    if (left) {
      ZEROS16.set(data.subarray(blocks * BLOCK_SIZE));
      this._updateBlock(swap8IfBE(ZEROS32[0]), swap8IfBE(ZEROS32[1]), swap8IfBE(ZEROS32[2]), swap8IfBE(ZEROS32[3]));
      clean2(ZEROS32);
    }
    return this;
  }
  destroy() {
    this.destroyed = true;
    const { t } = this;
    for (const elm of t) {
      elm.s0 = 0, elm.s1 = 0, elm.s2 = 0, elm.s3 = 0;
    }
  }
  digestInto(out) {
    aexists2(this);
    aoutput32(out, this);
    this.finished = true;
    const { s0, s1, s2, s3 } = this;
    const o32 = u32(out);
    o32[0] = s0;
    o32[1] = s1;
    o32[2] = s2;
    o32[3] = s3;
    if (!isLE)
      swap32IfBE(o32.subarray(0, BLOCK_SIZE / 4));
  }
  digest() {
    const res = new Uint8Array(BLOCK_SIZE);
    this.digestInto(res);
    this.destroy();
    return res;
  }
};
var ghash = /* @__PURE__ */ wrapMacConstructor(16, (key, expectedLength) => new GHASH(key, expectedLength), (msg) => [msg.length]);

// node_modules/@noble/ciphers/aes.js
var BLOCK_SIZE2 = 16;
var BLOCK_SIZE32 = 4;
var EMPTY_BLOCK = /* @__PURE__ */ new Uint8Array(BLOCK_SIZE2);
var POLY2 = 283;
function validateKeyLength(key) {
  if (![16, 24, 32].includes(key.length))
    throw new Error('"aes key" expected Uint8Array of length 16/24/32, got length=' + key.length);
}
function mul22(n) {
  return n << 1 ^ POLY2 & -(n >> 7);
}
function mul(a, b) {
  let res = 0;
  for (; b > 0; b >>= 1) {
    res ^= a & -(b & 1);
    a = mul22(a);
  }
  return res;
}
var sbox = /* @__PURE__ */ (() => {
  const t = new Uint8Array(256);
  for (let i = 0, x = 1; i < 256; i++, x ^= mul22(x))
    t[i] = x;
  const box = new Uint8Array(256);
  box[0] = 99;
  for (let i = 0; i < 255; i++) {
    let x = t[255 - i];
    x |= x << 8;
    box[t[i]] = (x ^ x >> 4 ^ x >> 5 ^ x >> 6 ^ x >> 7 ^ 99) & 255;
  }
  clean2(t);
  return box;
})();
var rotr32_8 = (n) => n << 24 | n >>> 8;
var rotl32_8 = (n) => n << 8 | n >>> 24;
function genTtable(sbox2, fn) {
  if (sbox2.length !== 256)
    throw new Error("wrong sbox length");
  const T02 = new Uint32Array(256).map((_, j) => fn(sbox2[j]));
  const T12 = T02.map(rotl32_8);
  const T22 = T12.map(rotl32_8);
  const T32 = T22.map(rotl32_8);
  const T01 = new Uint32Array(256 * 256);
  const T23 = new Uint32Array(256 * 256);
  const sbox22 = new Uint16Array(256 * 256);
  for (let i = 0; i < 256; i++) {
    for (let j = 0; j < 256; j++) {
      const idx = i * 256 + j;
      T01[idx] = T02[i] ^ T12[j];
      T23[idx] = T22[i] ^ T32[j];
      sbox22[idx] = sbox2[i] << 8 | sbox2[j];
    }
  }
  return { sbox: sbox2, sbox2: sbox22, T0: T02, T1: T12, T2: T22, T3: T32, T01, T23 };
}
var tableEncoding = /* @__PURE__ */ genTtable(sbox, (s) => mul(s, 3) << 24 | s << 16 | s << 8 | mul(s, 2));
var xPowers = /* @__PURE__ */ (() => {
  const p = new Uint8Array(16);
  for (let i = 0, x = 1; i < 16; i++, x = mul22(x))
    p[i] = x;
  return p;
})();
function expandKeyLE(key) {
  abytes3(key);
  const len = key.length;
  validateKeyLength(key);
  const { sbox2 } = tableEncoding;
  const toClean = [];
  if (!isLE || !isAligned32(key))
    toClean.push(key = copyBytes2(key));
  const k32 = swap32IfBE(u32(key));
  const Nk = k32.length;
  const subByte = (n) => applySbox(sbox2, n, n, n, n);
  const xk = new Uint32Array(len + 28);
  xk.set(k32);
  for (let i = Nk; i < xk.length; i++) {
    let t = xk[i - 1];
    if (i % Nk === 0)
      t = subByte(rotr32_8(t)) ^ xPowers[i / Nk - 1];
    else if (Nk > 6 && i % Nk === 4)
      t = subByte(t);
    xk[i] = xk[i - Nk] ^ t;
  }
  clean2(...toClean);
  return xk;
}
function apply0123(T01, T23, s0, s1, s2, s3) {
  return T01[s0 << 8 & 65280 | s1 >>> 8 & 255] ^ T23[s2 >>> 8 & 65280 | s3 >>> 24 & 255];
}
function applySbox(sbox2, s0, s1, s2, s3) {
  return sbox2[s0 & 255 | s1 & 65280] | sbox2[s2 >>> 16 & 255 | s3 >>> 16 & 65280] << 16;
}
function encrypt(xk, s0, s1, s2, s3) {
  const { sbox2, T01, T23 } = tableEncoding;
  let k = 0;
  s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
  const rounds = xk.length / 4 - 2;
  for (let i = 0; i < rounds; i++) {
    const t02 = xk[k++] ^ apply0123(T01, T23, s0, s1, s2, s3);
    const t12 = xk[k++] ^ apply0123(T01, T23, s1, s2, s3, s0);
    const t22 = xk[k++] ^ apply0123(T01, T23, s2, s3, s0, s1);
    const t32 = xk[k++] ^ apply0123(T01, T23, s3, s0, s1, s2);
    s0 = t02, s1 = t12, s2 = t22, s3 = t32;
  }
  const t0 = xk[k++] ^ applySbox(sbox2, s0, s1, s2, s3);
  const t1 = xk[k++] ^ applySbox(sbox2, s1, s2, s3, s0);
  const t2 = xk[k++] ^ applySbox(sbox2, s2, s3, s0, s1);
  const t3 = xk[k++] ^ applySbox(sbox2, s3, s0, s1, s2);
  return { s0: t0, s1: t1, s2: t2, s3: t3 };
}
function ctr32(xk, isLE2, nonce, src, dst) {
  abytes3(nonce, BLOCK_SIZE2, "nonce");
  abytes3(src);
  dst = getOutput(src.length, dst);
  const ctr = nonce;
  const c32 = u32(ctr);
  const view2 = createView2(ctr);
  const src32 = u32(src);
  const dst32 = u32(dst);
  const ctrPos = isLE2 ? 0 : 12;
  const srcLen = src.length;
  let ctrNum = view2.getUint32(ctrPos, isLE2);
  for (let i = 0; i + 4 <= src32.length; i += 4) {
    const { s0, s1, s2, s3 } = encrypt(xk, swap8IfBE(c32[0]), swap8IfBE(c32[1]), swap8IfBE(c32[2]), swap8IfBE(c32[3]));
    dst32[i + 0] = src32[i + 0] ^ swap8IfBE(s0);
    dst32[i + 1] = src32[i + 1] ^ swap8IfBE(s1);
    dst32[i + 2] = src32[i + 2] ^ swap8IfBE(s2);
    dst32[i + 3] = src32[i + 3] ^ swap8IfBE(s3);
    ctrNum = ctrNum + 1 >>> 0;
    view2.setUint32(ctrPos, ctrNum, isLE2);
  }
  const start = BLOCK_SIZE2 * Math.floor(src32.length / BLOCK_SIZE32);
  if (start < srcLen) {
    const { s0, s1, s2, s3 } = encrypt(xk, swap8IfBE(c32[0]), swap8IfBE(c32[1]), swap8IfBE(c32[2]), swap8IfBE(c32[3]));
    const b32 = new Uint32Array([s0, s1, s2, s3]);
    swap32IfBE(b32);
    const buf = u8(b32);
    for (let i = start, pos = 0; i < srcLen; i++, pos++)
      dst[i] = src[i] ^ buf[pos];
    clean2(b32);
  }
  return dst;
}
function computeTag(fn, isLE2, key, data, AAD) {
  const aadLength = AAD ? AAD.length : 0;
  const h = fn.create(key, data.length + aadLength);
  if (AAD)
    h.update(AAD);
  const num = u64Lengths(8 * data.length, 8 * aadLength, isLE2);
  h.update(data);
  h.update(num);
  const res = h.digest();
  clean2(num);
  return res;
}
var gcm = /* @__PURE__ */ wrapCipher({ blockSize: 16, nonceLength: 12, tagLength: 16, withAAD: true, varSizeNonce: true }, function aesgcm(key, nonce, AAD) {
  if (nonce.length < 8)
    throw new Error("aes/gcm: invalid nonce length");
  const tagLength = 16;
  function _computeTag(authKey, tagMask, data) {
    const tag = computeTag(ghash, false, authKey, data, AAD);
    for (let i = 0; i < tagMask.length; i++)
      tag[i] ^= tagMask[i];
    return tag;
  }
  function deriveKeys() {
    const xk = expandKeyLE(key);
    const authKey = EMPTY_BLOCK.slice();
    const counter = EMPTY_BLOCK.slice();
    ctr32(xk, false, counter, counter, authKey);
    if (nonce.length === 12) {
      counter.set(nonce);
    } else {
      const nonceLen = EMPTY_BLOCK.slice();
      const view2 = createView2(nonceLen);
      view2.setBigUint64(8, BigInt(nonce.length * 8), false);
      const g = ghash.create(authKey).update(nonce).update(nonceLen);
      g.digestInto(counter);
      g.destroy();
    }
    const tagMask = ctr32(xk, false, counter, EMPTY_BLOCK);
    return { xk, authKey, counter, tagMask };
  }
  return {
    encrypt(plaintext) {
      const { xk, authKey, counter, tagMask } = deriveKeys();
      const out = new Uint8Array(plaintext.length + tagLength);
      const toClean = [xk, authKey, counter, tagMask];
      if (!isAligned32(plaintext))
        toClean.push(plaintext = copyBytes2(plaintext));
      ctr32(xk, false, counter, plaintext, out.subarray(0, plaintext.length));
      const tag = _computeTag(authKey, tagMask, out.subarray(0, out.length - tagLength));
      toClean.push(tag);
      out.set(tag, plaintext.length);
      clean2(...toClean);
      return out;
    },
    decrypt(ciphertext) {
      const { xk, authKey, counter, tagMask } = deriveKeys();
      const toClean = [xk, authKey, tagMask, counter];
      if (!isAligned32(ciphertext))
        toClean.push(ciphertext = copyBytes2(ciphertext));
      const data = ciphertext.subarray(0, -tagLength);
      const passedTag = ciphertext.subarray(-tagLength);
      const tag = _computeTag(authKey, tagMask, data);
      toClean.push(tag);
      if (!equalBytes(tag, passedTag)) {
        clean2(...toClean);
        throw new Error("aes-gcm: invalid tag");
      }
      const out = ctr32(xk, false, counter, data);
      clean2(...toClean);
      return out;
    }
  };
});

// node_modules/@noble/hashes/hmac.js
var _HMAC = class {
  constructor(hash, key) {
    __publicField(this, "oHash");
    __publicField(this, "iHash");
    __publicField(this, "blockLen");
    __publicField(this, "outputLen");
    __publicField(this, "canXOF", false);
    __publicField(this, "finished", false);
    __publicField(this, "destroyed", false);
    ahash(hash);
    abytes(key, void 0, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("expected Hash instance");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean(pad);
  }
  update(buf) {
    aexists(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const buf = out.subarray(0, this.outputLen);
    this.iHash.digestInto(buf);
    this.oHash.update(buf);
    this.oHash.digestInto(buf);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to || (to = Object.create(Object.getPrototypeOf(this), {}));
    const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.canXOF = canXOF;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = /* @__PURE__ */ (() => {
  const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
  hmac_.create = (hash, key) => new _HMAC(hash, key);
  return hmac_;
})();

// node_modules/@noble/hashes/hkdf.js
var HKDF_COUNTER = /* @__PURE__ */ Uint8Array.of(0);
var EMPTY_BUFFER = /* @__PURE__ */ Uint8Array.of();
function expand(hash, prk, info, length = 32, _recycled) {
  ahash(hash);
  anumber(length, "length");
  abytes(prk, void 0, "prk");
  const olen = hash.outputLen;
  if (prk.length < olen)
    throw new Error('"prk" must be at least HashLen octets');
  if (length > 255 * olen)
    throw new Error("Length must be <= 255*HashLen");
  const blocks = Math.ceil(length / olen);
  if (info === void 0)
    info = EMPTY_BUFFER;
  else
    abytes(info, void 0, "info");
  if (!blocks) {
    if (_recycled)
      clean(prk);
    return new Uint8Array();
  }
  const okm = _recycled && blocks === 1 ? prk : new Uint8Array(blocks * olen);
  const { iHash, oHash } = hmac.create(hash, prk);
  const T = _recycled ? prk : new Uint8Array(olen);
  const worker = blocks > 1 ? _recycled?.iHash || hash.create() : void 0;
  for (let counter = 0; counter < blocks - 1; counter++) {
    HKDF_COUNTER[0] = counter + 1;
    const iWork = iHash._cloneInto(worker);
    if (counter)
      iWork.update(T);
    iWork.update(info).update(HKDF_COUNTER).digestInto(T);
    oHash._cloneInto(worker).update(T).digestInto(T);
    okm.set(T, olen * counter);
  }
  HKDF_COUNTER[0] = blocks;
  if (blocks > 1)
    iHash.update(T);
  iHash.update(info).update(HKDF_COUNTER).digestInto(T);
  oHash.update(T).digestInto(T);
  okm.set(T, olen * (blocks - 1));
  iHash.destroy();
  oHash.destroy();
  worker?.destroy();
  if (T !== okm)
    clean(T);
  clean(HKDF_COUNTER);
  if (length === okm.length)
    return okm;
  const res = okm.slice(0, length);
  clean(okm);
  return res;
}
var hkdf = (hash, ikm, salt, info, length) => {
  ahash(hash);
  if (salt === void 0)
    salt = new Uint8Array(hash.outputLen);
  const HMAC = hmac.create(hash, salt).update(ikm);
  return expand(hash, HMAC.digest(), info, length, HMAC);
};

// src/crypto/noble.ts
var BASE_U = Uint8Array.of(9, ...new Uint8Array(X25519_BYTES - 1));
var asOwn = (bytes) => bytes;
function nobleProvider(source) {
  const name = "noble";
  const { randomBytes: randomBytes3, randomUUID } = randomFrom(source);
  const contentKey = (bytes, exportable) => new ContentKey(name, Object.freeze({ bytes, exportable }));
  const keyBytes = (key) => ContentKey.handle(key, name).bytes;
  const macBytes = (key) => MacKey.handle(key, name);
  const scalarOf = (key) => X25519Key.handle(key, name);
  const hkdf2 = (ikm, salt, info, length) => asOwn(hkdf(sha256, ikm, salt, info, length));
  const aead = (key, nonce, associatedData) => {
    const bytes = keyBytes(key);
    checkNonce(nonce);
    return gcm(bytes, nonce, associatedData);
  };
  const provider = {
    name,
    canEncrypt: true,
    randomBytes: randomBytes3,
    randomUUID,
    async generateKey() {
      return contentKey(randomBytes3(CONTENT_KEY_BYTES), true);
    },
    async importKey(raw) {
      checkContentKey(raw);
      return contentKey(own(raw), true);
    },
    async exportKey(key) {
      const held = ContentKey.handle(key, name);
      if (!held.exportable) throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A derived key can't be exported." });
      return own(held.bytes);
    },
    async encrypt(key, plaintext) {
      const iv = randomBytes3(AES_GCM_IV_BYTES);
      const sealed = await provider.encryptWithNonce(key, iv, plaintext);
      const out = new Uint8Array(iv.byteLength + sealed.byteLength);
      out.set(iv);
      out.set(sealed, iv.byteLength);
      return out;
    },
    async decrypt(key, sealed) {
      return provider.decryptWithNonce(key, sealed.subarray(0, AES_GCM_IV_BYTES), sealed.subarray(AES_GCM_IV_BYTES));
    },
    async encryptWithNonce(key, nonce, plaintext, associatedData) {
      return asOwn(aead(key, nonce, associatedData).encrypt(plaintext));
    },
    async decryptWithNonce(key, nonce, sealed, associatedData) {
      return asOwn(aead(key, nonce, associatedData).decrypt(sealed));
    },
    async deriveContentKey(ikm, salt, info) {
      return contentKey(hkdf2(ikm, salt, info, CONTENT_KEY_BYTES), false);
    },
    async deriveMacKey(ikm, salt, info) {
      return new MacKey(name, hkdf2(ikm, salt, info, MAC_KEY_BYTES));
    },
    async hmacSha256(key, data) {
      return asOwn(hmac(sha256, macBytes(key), data));
    },
    async verifyHmacSha256(key, mac, data) {
      return constantTimeEqual(hmac(sha256, macBytes(key), data), mac);
    },
    async sha256(data) {
      return asOwn(sha256(data));
    },
    async sha512(data) {
      return asOwn(sha512(data));
    },
    async hmac(hash, key, data) {
      checkHmac(hash, key);
      return asOwn(hmac(hash === "SHA-256" ? sha256 : sha512, key, data));
    },
    async hkdf(ikm, salt, info, length) {
      checkHkdfLength(length);
      return hkdf2(ikm, salt, info, length);
    },
    equal: constantTimeEqual,
    async x25519Generate() {
      const scalar = randomBytes3(X25519_BYTES);
      return { privateKey: new X25519Key(name, scalar), publicKey: asOwn(x25519.scalarMult(scalar, BASE_U)) };
    },
    async x25519(privateKey, u) {
      if (u.byteLength !== X25519_BYTES) throw notBytes("An X25519 u-coordinate", X25519_BYTES);
      const scalar = scalarOf(privateKey);
      const peer = canonicalU(u);
      let shared;
      try {
        shared = asOwn(x25519.getSharedSecret(scalar, peer));
      } catch {
        throw lowOrder();
      }
      if (allZero(shared)) throw lowOrder();
      return shared;
    },
    async x25519FromScalar(scalar) {
      if (scalar.byteLength !== X25519_BYTES) throw notBytes("An X25519 scalar", X25519_BYTES);
      return new X25519Key(name, own(scalar));
    },
    elligator2
  };
  return Object.freeze(provider);
}

// src/crypto/provider.ts
var view = (bytes) => bytes.buffer instanceof ArrayBuffer ? bytes : own(bytes);
var HMAC_KEY_BITS = 256;
var X25519_PKCS8_PREFIX = Uint8Array.of(48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 110, 4, 34, 4, 32);
var noEncryption = () => new DropgateError({
  code: "RUNTIME_UNSUPPORTED",
  message: "Web Crypto API not available (crypto.subtle). Encryption needs a secure context (HTTPS or localhost)."
});
function webCryptoProvider(webCrypto) {
  const subtle = webCrypto.subtle;
  const name = "webcrypto";
  const { randomBytes: randomBytes3, randomUUID } = randomFrom(webCrypto);
  const needSubtle = () => {
    if (!subtle) throw noEncryption();
    return subtle;
  };
  const cryptoKey = (key) => ContentKey.handle(key, name);
  const macKey = (key) => MacKey.handle(key, name);
  const x25519Key = (key) => X25519Key.handle(key, name);
  const gcm2 = (nonce, associatedData) => {
    checkNonce(nonce);
    return associatedData === void 0 ? { name: "AES-GCM", iv: own(nonce) } : { name: "AES-GCM", iv: own(nonce), additionalData: own(associatedData) };
  };
  const hkdf2 = async (ikm, salt, info, algorithm, usages) => {
    const base = await needSubtle().importKey("raw", own(ikm), "HKDF", false, ["deriveKey"]);
    return needSubtle().deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: own(salt), info: own(info) },
      base,
      algorithm,
      false,
      usages
    );
  };
  const provider = {
    name,
    canEncrypt: Boolean(subtle),
    randomBytes: randomBytes3,
    randomUUID,
    async generateKey() {
      const key = await needSubtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
      return new ContentKey(name, key);
    },
    async importKey(raw) {
      checkContentKey(raw);
      const key = await needSubtle().importKey("raw", own(raw), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
      return new ContentKey(name, key);
    },
    async exportKey(key) {
      return new Uint8Array(await needSubtle().exportKey("raw", cryptoKey(key)));
    },
    async encrypt(key, plaintext) {
      const iv = randomBytes3(AES_GCM_IV_BYTES);
      const sealed = await provider.encryptWithNonce(key, iv, own(plaintext));
      const out = new Uint8Array(iv.byteLength + sealed.byteLength);
      out.set(iv);
      out.set(sealed, iv.byteLength);
      return out;
    },
    async decrypt(key, sealed) {
      const iv = sealed.slice(0, AES_GCM_IV_BYTES);
      const ciphertext = sealed.slice(AES_GCM_IV_BYTES);
      return new Uint8Array(await needSubtle().decrypt({ name: "AES-GCM", iv }, cryptoKey(key), ciphertext));
    },
    async encryptWithNonce(key, nonce, plaintext, associatedData) {
      return new Uint8Array(await needSubtle().encrypt(gcm2(nonce, associatedData), cryptoKey(key), view(plaintext)));
    },
    async decryptWithNonce(key, nonce, sealed, associatedData) {
      return new Uint8Array(await needSubtle().decrypt(gcm2(nonce, associatedData), cryptoKey(key), view(sealed)));
    },
    async deriveContentKey(ikm, salt, info) {
      return new ContentKey(name, await hkdf2(ikm, salt, info, { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]));
    },
    async deriveMacKey(ikm, salt, info) {
      return new MacKey(name, await hkdf2(ikm, salt, info, { name: "HMAC", hash: "SHA-256", length: HMAC_KEY_BITS }, ["sign", "verify"]));
    },
    async hmacSha256(key, data) {
      return new Uint8Array(await needSubtle().sign("HMAC", macKey(key), view(data)));
    },
    async verifyHmacSha256(key, mac, data) {
      return needSubtle().verify("HMAC", macKey(key), own(mac), view(data));
    },
    async sha256(data) {
      if (subtle) return new Uint8Array(await subtle.digest("SHA-256", own(data)));
      return sha256(data);
    },
    async sha512(data) {
      return new Uint8Array(await needSubtle().digest("SHA-512", view(data)));
    },
    async hmac(hash, key, data) {
      checkHmac(hash, key);
      const handle = await needSubtle().importKey("raw", own(key), { name: "HMAC", hash }, false, ["sign"]);
      return new Uint8Array(await needSubtle().sign("HMAC", handle, view(data)));
    },
    async hkdf(ikm, salt, info, length) {
      checkHkdfLength(length);
      const base = await needSubtle().importKey("raw", own(ikm), "HKDF", false, ["deriveBits"]);
      return new Uint8Array(await needSubtle().deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: own(salt), info: own(info) },
        base,
        length * 8
      ));
    },
    equal: constantTimeEqual,
    async x25519Generate() {
      const pair = await needSubtle().generateKey({ name: "X25519" }, false, ["deriveBits"]);
      const publicKey = new Uint8Array(await needSubtle().exportKey("raw", pair.publicKey));
      return { privateKey: new X25519Key(name, pair.privateKey), publicKey };
    },
    async x25519(privateKey, u) {
      if (u.byteLength !== X25519_BYTES) throw notBytes("An X25519 u-coordinate", X25519_BYTES);
      const scalar = x25519Key(privateKey);
      const peer = await needSubtle().importKey("raw", canonicalU(u), { name: "X25519" }, true, []);
      let shared;
      try {
        shared = new Uint8Array(await needSubtle().deriveBits({ name: "X25519", public: peer }, scalar, 256));
      } catch (err) {
        if (err?.name === "OperationError") throw lowOrder();
        throw err;
      }
      if (allZero(shared)) throw lowOrder();
      return shared;
    },
    async x25519FromScalar(scalar) {
      if (scalar.byteLength !== X25519_BYTES) throw notBytes("An X25519 scalar", X25519_BYTES);
      const pkcs8 = new Uint8Array(X25519_PKCS8_PREFIX.byteLength + X25519_BYTES);
      pkcs8.set(X25519_PKCS8_PREFIX);
      pkcs8.set(scalar, X25519_PKCS8_PREFIX.byteLength);
      try {
        return new X25519Key(name, await needSubtle().importKey("pkcs8", pkcs8, { name: "X25519" }, false, ["deriveBits"]));
      } finally {
        pkcs8.fill(0);
      }
    },
    elligator2
  };
  return Object.freeze(provider);
}
async function hasX25519(subtle) {
  if (!subtle) return false;
  try {
    await subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
    return true;
  } catch {
    return false;
  }
}
async function choose(webCrypto) {
  return await hasX25519(webCrypto.subtle) ? webCryptoProvider(webCrypto) : nobleProvider(webCrypto);
}
var ASYNC_OPERATIONS = [
  "generateKey",
  "importKey",
  "exportKey",
  "encrypt",
  "decrypt",
  "encryptWithNonce",
  "decryptWithNonce",
  "deriveContentKey",
  "deriveMacKey",
  "hmacSha256",
  "verifyHmacSha256",
  "sha256",
  "sha512",
  "hmac",
  "hkdf",
  "x25519Generate",
  "x25519",
  "x25519FromScalar"
];
function runtimeProvider(webCrypto) {
  let choice;
  const chosen = () => choice ?? (choice = choose(webCrypto));
  const operations = Object.fromEntries(ASYNC_OPERATIONS.map((operation) => [
    operation,
    async (...args) => (await chosen())[operation](...args)
  ]));
  return Object.freeze({
    ...operations,
    ...randomFrom(webCrypto),
    canEncrypt: true,
    equal: constantTimeEqual,
    elligator2,
    chosen
  });
}
var runtimes = /* @__PURE__ */ new WeakMap();
function cryptoProvider() {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.getRandomValues !== "function") {
    throw new DropgateError({
      code: "RUNTIME_UNSUPPORTED",
      message: "No secure random numbers here (crypto.getRandomValues())."
    });
  }
  let runtime = runtimes.get(webCrypto);
  if (!runtime) {
    runtime = runtimeProvider(webCrypto);
    runtimes.set(webCrypto, runtime);
  }
  return runtime;
}

// src/p2p/utils.ts
function isLocalhostHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}
function isSecureContextForP2P(hostname, isSecureContext) {
  return Boolean(isSecureContext) || isLocalhostHostname(hostname || "");
}
function generateP2PCode(provider = cryptoProvider()) {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const randomBytes3 = provider.randomBytes(8);
  let letterPart = "";
  for (let i = 0; i < 4; i++) {
    letterPart += letters[randomBytes3[i] % letters.length];
  }
  let numberPart = "";
  for (let i = 4; i < 8; i++) {
    numberPart += (randomBytes3[i] % 10).toString();
  }
  return `${letterPart}-${numberPart}`;
}
function isP2PCodeLike(code) {
  return /^[A-Z]{4}-\d{4}$/.test(String(code || "").trim());
}

// src/transport.ts
function isSecureServerUrl(baseUrl) {
  const url = new URL(baseUrl);
  return url.protocol === "https:" || isLocalhostHostname(url.hostname);
}
function insecureTransportNotAllowed() {
  return new DropgateError({ code: "INSECURE_TRANSPORT_NOT_ALLOWED", transport: { secure: false } });
}
function guardedFetch(fetchFn) {
  return async (input, init) => {
    const res = await fetchFn(input, { ...init, credentials: "omit", redirect: "manual" });
    if (res.type === "opaqueredirect" || res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      throw new DropgateError({ code: "REDIRECT_NOT_FOLLOWED", status: res.status || void 0 });
    }
    return res;
  };
}

// src/version.ts
var CORE_VERSION = true ? "3.0.13" : "0.0.0-dev";
var PROTOCOLS = Object.freeze({
  dgup: Object.freeze({ major: 4, minor: 0 }),
  dgdtp: Object.freeze({ major: 4, minor: 0 })
});

// src/utils/network.ts
function parseServerUrl(urlStr) {
  let normalized = String(urlStr ?? "").trim();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }
  let url;
  try {
    url = new URL(normalized);
  } catch (err) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "The server address is not a valid URL.", cause: err });
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : void 0,
    secure: url.protocol === "https:"
  };
}
function buildBaseUrl(opts) {
  const { host, port, secure } = opts;
  if (!host || typeof host !== "string") {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "Server host is required." });
  }
  const protocol = secure === false ? "http" : "https";
  const portSuffix = port ? `:${port}` : "";
  return `${protocol}://${host}${portSuffix}`;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason || new DropgateError({ code: "OPERATION_CANCELLED" }));
    }
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(signal.reason || new DropgateError({ code: "OPERATION_CANCELLED" }));
        },
        { once: true }
      );
    }
  });
}
function makeAbortSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timeoutId = null;
  const abort = (reason) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };
  if (parentSignal) {
    if (parentSignal.aborted) {
      abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener("abort", () => abort(parentSignal.reason), {
        once: true
      });
    }
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      abort(new DropgateError({ code: "TIMED_OUT" }));
    }, timeoutMs);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}
function makeWaitSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onParentAbort = () => abort(parentSignal.reason);
  if (parentSignal.aborted) abort(parentSignal.reason);
  else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  const timed = Number.isFinite(timeoutMs) && timeoutMs > 0;
  let timeoutId = null;
  const stopTimer = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
  };
  return {
    signal: controller.signal,
    async waiting(start) {
      if (timed) timeoutId = setTimeout(() => abort(new DropgateError({ code: "TIMED_OUT" })), timeoutMs);
      try {
        return await start();
      } finally {
        stopTimer();
      }
    },
    cleanup: () => {
      stopTimer();
      parentSignal.removeEventListener("abort", onParentAbort);
    }
  };
}
async function fetchJson(fetchFn, url, opts = {}) {
  const { timeoutMs, signal, ...rest } = opts;
  const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);
  try {
    let res;
    try {
      res = await fetchFn(url, { ...rest, signal: s });
    } catch (err) {
      throw toDropgateError(err, "SERVER_UNREACHABLE");
    }
    let text;
    try {
      text = await res.text();
    } catch (err) {
      throw toDropgateError(err, "CONNECTION_LOST");
    }
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
    }
    return { res, json, text };
  } finally {
    cleanup();
  }
}

// src/retry.ts
var QUIET_MS = 5 * 60 * 1e3;
var MAX_BACKOFF_MS = 3e4;
function retryPolicy(retry = {}) {
  const whole = (value) => Number.isFinite(value) && value >= 0;
  return {
    ...whole(retry.retries) ? { retries: Math.floor(retry.retries) } : {},
    backoffMs: whole(retry.backoffMs) ? retry.backoffMs : 1e3,
    maxBackoffMs: Math.min(whole(retry.maxBackoffMs) ? retry.maxBackoffMs : MAX_BACKOFF_MS, MAX_BACKOFF_MS)
  };
}
var retryAfter = /* @__PURE__ */ new WeakMap();
function withRetryAfter(err, res) {
  const header = res.headers.get("Retry-After");
  const seconds = header === null || header.trim() === "" ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) retryAfter.set(err, Math.min(seconds, 60) * 1e3);
  return err;
}
function isRecoverable(err) {
  if (!(err instanceof DropgateError) || err.code === "OPERATION_CANCELLED") return false;
  if (err.status === void 0) return err.code === "SERVER_UNREACHABLE" || err.code === "CONNECTION_LOST" || err.code === "TIMED_OUT";
  return err.status === 408 || err.status === 429 || err.status >= 500 && err.status !== 507;
}
var _end;
var RetryWindow = class {
  constructor() {
    __privateAdd(this, _end);
    __privateSet(this, _end, Date.now() + QUIET_MS);
  }
  /** The server answered: it waits 5 more minutes, or until the `deadline` it gave, if that's later. */
  heard(deadline) {
    const quiet = Date.now() + QUIET_MS;
    __privateSet(this, _end, typeof deadline === "number" && Number.isFinite(deadline) ? Math.max(deadline, quiet) : quiet);
  }
  /** When the server stops waiting, in milliseconds since 1970. */
  get end() {
    return __privateGet(this, _end);
  }
};
_end = new WeakMap();
function backoffMs(policy, attempt, random) {
  const full = Math.min(policy.backoffMs * 2 ** Math.min(attempt - 1, 30), policy.maxBackoffMs);
  const [a, b, c, d] = random(4);
  const fraction = ((a << 24 >>> 0) + (b << 16) + (c << 8) + d) / 2 ** 32;
  return Math.round(full / 2 + fraction * (full / 2));
}
async function retrying(run, o) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(attempt);
    } catch (thrown) {
      if (o.signal.aborted) throw o.signal.reason ?? new DropgateError({ code: "OPERATION_CANCELLED" });
      const err = toDropgateError(thrown);
      if (!isRecoverable(err)) throw err;
      if (o.policy.retries !== void 0 && attempt > o.policy.retries) throw err;
      const left = o.window.end - Date.now();
      if (left <= 0) throw o.expired ? o.expired(err) : err;
      let remaining = Math.min(retryAfter.get(err) ?? backoffMs(o.policy, attempt, o.random), left);
      while (remaining > 0) {
        o.waiting?.({ attempt, remainingMs: remaining });
        const tick = Math.min(100, remaining);
        await sleep(tick, o.signal);
        remaining -= tick;
      }
      o.retrying?.(attempt);
    }
  }
}

// src/cancel.ts
var CancelScope = class _CancelScope {
  constructor(label, opts = {}) {
    __publicField(this, "label");
    __publicField(this, "controller", new AbortController());
    __publicField(this, "children", /* @__PURE__ */ new Set());
    __publicField(this, "listeners", /* @__PURE__ */ new Set());
    __publicField(this, "parent", null);
    __publicField(this, "detachSignal", null);
    __publicField(this, "_cancellation", null);
    __publicField(this, "done", false);
    this.label = label;
    const { parent, signal } = opts;
    if (parent) {
      if (parent._cancellation) {
        this.settle({ by: "parent", source: parent._cancellation.source });
        return;
      }
      this.parent = parent;
      parent.children.add(this);
    }
    if (signal) {
      if (signal.aborted) {
        this.settle({ by: "signal", source: label });
        return;
      }
      const onAbort = () => this.settle({ by: "signal", source: label });
      signal.addEventListener("abort", onAbort, { once: true });
      this.detachSignal = () => signal.removeEventListener("abort", onAbort);
    }
  }
  /** Aborts when this node is cancelled, with an OPERATION_CANCELLED DropgateError as its reason. */
  get signal() {
    return this.controller.signal;
  }
  /** How it was cancelled, or null while it hasn't been. */
  get cancellation() {
    return this._cancellation;
  }
  /** A new node under this one. */
  child(label) {
    return new _CancelScope(label, { parent: this });
  }
  /** Cancels this node and everything under it. Returns false if it was already cancelled or done. */
  cancel() {
    if (this._cancellation || this.done) return false;
    this.settle({ by: "self", source: this.label });
    return true;
  }
  /** Runs `listener` once, when this node is cancelled. Returns a function that removes it. */
  onCancel(listener) {
    if (this._cancellation) {
      listener(this._cancellation);
      return () => {
      };
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Throws its OPERATION_CANCELLED error if this node has been cancelled. */
  throwIfCancelled() {
    if (this._cancellation) throw this.controller.signal.reason;
  }
  /**
   * Takes this node out of the tree, once its operation has ended: a later
   * cancel above it no longer reaches it, and its own cancel() does nothing.
   */
  finish() {
    if (this.done) return;
    this.done = true;
    this.parent?.children.delete(this);
    this.parent = null;
    this.detachSignal?.();
    this.detachSignal = null;
    this.listeners.clear();
  }
  settle(cancellation) {
    if (this._cancellation || this.done) return;
    this._cancellation = cancellation;
    this.detachSignal?.();
    this.detachSignal = null;
    this.parent?.children.delete(this);
    this.parent = null;
    this.controller.abort(new DropgateError({ code: "OPERATION_CANCELLED", details: { cancellation } }));
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) {
      try {
        listener(cancellation);
      } catch {
      }
    }
    const children = [...this.children];
    this.children.clear();
    for (const child of children) child.settle({ by: "parent", source: cancellation.source });
  }
};

// src/outcome.ts
async function settle(scope, work, transport) {
  try {
    const value = await work();
    return { status: "completed", value, transport };
  } catch (err) {
    const cancellation = scope.cancellation;
    if (cancellation) return { status: "cancelled", cancellation, transport };
    return { status: "failed", error: withTransport(err, transport), transport };
  } finally {
    scope.finish();
  }
}

// src/pause.ts
var PAUSE_REASON = new DropgateError({ code: "OPERATION_CANCELLED", message: "Paused." });
var unavailable = (message) => new DropgateError({ code: "PAUSE_UNAVAILABLE", message });
var _state, _hooks, _allowed, _turnedOff, _operation, _update, _snapshot, _segment, _unlink, _stopped, _waiting, _timer, _deadline, _status, _text, _pending, _PauseControl_instances, pauseAgain_fn, ending_fn, paused_fn, run_fn, arm_fn, disarm_fn, newSegment_fn, untilEnded_fn;
var PauseControl = class {
  constructor(operation, update, snapshot) {
    __privateAdd(this, _PauseControl_instances);
    __privateAdd(this, _state, "running");
    __privateAdd(this, _hooks, null);
    __privateAdd(this, _allowed, false);
    __privateAdd(this, _turnedOff, false);
    __privateAdd(this, _operation);
    __privateAdd(this, _update);
    __privateAdd(this, _snapshot);
    __privateAdd(this, _segment, new AbortController());
    __privateAdd(this, _unlink, () => {
    });
    /** Told when the work has stopped at its checkpoint. */
    __privateAdd(this, _stopped, null);
    /** The work waiting at its checkpoint: lets it go on, or fails it. */
    __privateAdd(this, _waiting, null);
    __privateAdd(this, _timer, null);
    __privateAdd(this, _deadline, null);
    /** The status and text the operation goes back to when it goes on. */
    __privateAdd(this, _status, "");
    __privateAdd(this, _text, "");
    /** Pauses and resumes still settling, rejected if the operation ends first. */
    __privateAdd(this, _pending, /* @__PURE__ */ new Set());
    __privateSet(this, _operation, operation);
    __privateSet(this, _update, update);
    __privateSet(this, _snapshot, snapshot);
    __privateMethod(this, _PauseControl_instances, newSegment_fn).call(this);
  }
  /**
   * Whether the operation can pause now, and how: with `hooks` once the server
   * has taken it, and `null` once it's finishing. The next snapshot says so.
   */
  allow(hooks) {
    if (hooks) __privateSet(this, _hooks, hooks);
    __privateSet(this, _allowed, hooks !== null);
  }
  /** What every snapshot's `canPause` is: whether `pause()` can be called now. Paused, pausing again renews the deadline. */
  get canPause() {
    return __privateGet(this, _state) === "paused" || __privateGet(this, _state) === "running" && __privateGet(this, _allowed);
  }
  /** The server has pausing turned off, so a pause is refused with CAPABILITY_UNSUPPORTED. */
  turnedOff() {
    __privateSet(this, _turnedOff, true);
    this.allow(null);
  }
  /** Aborts when a pause stops the work, or the operation is cancelled: each step a pause should stop uses it. */
  get signal() {
    return __privateGet(this, _segment).signal;
  }
  /** Whether `signal` aborted for a pause, and not a cancel: the work then goes to its checkpoint. */
  get interrupted() {
    return __privateGet(this, _segment).signal.aborted && __privateGet(this, _state) !== "running" && !__privateGet(this, _operation).aborted;
  }
  /**
   * Where the work can stop, between steps. While running, it goes on at once
   * and gives false. Paused, it waits until the operation goes on, then gives
   * true; it rejects if the operation is cancelled, or a pause ends it.
   */
  async checkpoint() {
    if (__privateGet(this, _state) === "running" || __privateGet(this, _state) === "ended") return false;
    const operation = __privateGet(this, _operation);
    if (operation.aborted) throw operation.reason;
    await new Promise((resolve, reject) => {
      var _a;
      const onAbort = () => reject(operation.reason);
      operation.addEventListener("abort", onAbort, { once: true });
      __privateSet(this, _waiting, {
        go: () => {
          operation.removeEventListener("abort", onAbort);
          resolve();
        },
        fail: (err) => {
          operation.removeEventListener("abort", onAbort);
          reject(err);
        }
      });
      (_a = __privateGet(this, _stopped)) == null ? void 0 : _a.call(this);
    }).finally(() => {
      __privateSet(this, _waiting, null);
    });
    return true;
  }
  /**
   * Pauses: stops the step under way, waits for the work to stop, and asks the
   * server to hold it. Paused already, it asks again, which renews the
   * server's deadline from now. If the server refuses, nothing changes; if it
   * no longer has the operation, the operation fails.
   */
  async pause() {
    if (__privateGet(this, _state) === "paused") return __privateMethod(this, _PauseControl_instances, pauseAgain_fn).call(this);
    if (__privateGet(this, _state) !== "running" || !__privateGet(this, _allowed) || !__privateGet(this, _hooks)) {
      if (__privateGet(this, _turnedOff) && __privateGet(this, _state) === "running") {
        throw new DropgateError({ code: "CAPABILITY_UNSUPPORTED", message: "Pausing is turned off on this server.", details: { capability: "pause" } });
      }
      throw unavailable(__privateGet(this, _state) === "ended" ? "It has ended, so it can't be paused." : "It can't be paused now.");
    }
    const hooks = __privateGet(this, _hooks);
    __privateSet(this, _state, "pausing");
    ({ status: __privateWrapper(this, _status)._, text: __privateWrapper(this, _text)._ } = __privateGet(this, _snapshot).call(this));
    __privateGet(this, _update).call(this, { text: "Pausing..." });
    const stopped = new Promise((resolve) => {
      __privateSet(this, _stopped, resolve);
    });
    __privateGet(this, _segment).abort(PAUSE_REASON);
    try {
      await __privateMethod(this, _PauseControl_instances, untilEnded_fn).call(this, stopped);
      __privateSet(this, _stopped, null);
      __privateMethod(this, _PauseControl_instances, paused_fn).call(this, await __privateMethod(this, _PauseControl_instances, untilEnded_fn).call(this, hooks.pause()));
    } catch (err) {
      __privateSet(this, _stopped, null);
      if (__privateMethod(this, _PauseControl_instances, ending_fn).call(this, err)) throw err;
      __privateMethod(this, _PauseControl_instances, run_fn).call(this);
      throw err;
    }
  }
  /**
   * Resumes: asks the server to go on, then lets the work go on. If the server
   * no longer has it, the operation fails; if it can't be asked, it stays paused.
   */
  async resume() {
    if (__privateGet(this, _state) !== "paused" || !__privateGet(this, _hooks)) {
      throw unavailable(__privateGet(this, _state) === "ended" ? "It has ended, so it can't be resumed." : "It isn't paused.");
    }
    const hooks = __privateGet(this, _hooks);
    const deadline = __privateGet(this, _deadline);
    __privateSet(this, _state, "resuming");
    __privateMethod(this, _PauseControl_instances, disarm_fn).call(this);
    __privateGet(this, _update).call(this, { text: "Resuming..." });
    try {
      await __privateMethod(this, _PauseControl_instances, untilEnded_fn).call(this, hooks.resume());
    } catch (err) {
      if (__privateMethod(this, _PauseControl_instances, ending_fn).call(this, err)) throw err;
      __privateMethod(this, _PauseControl_instances, paused_fn).call(this, deadline);
      throw err;
    }
    __privateMethod(this, _PauseControl_instances, run_fn).call(this);
  }
  /**
   * A new deadline for a pause already made, as the server said (null for
   * none): for a lease shared with downloads that go on, or stop.
   */
  extend(deadline) {
    if (__privateGet(this, _state) !== "paused") return;
    __privateSet(this, _deadline, deadline);
    __privateGet(this, _update).call(this, { deadline });
    __privateMethod(this, _PauseControl_instances, arm_fn).call(this);
  }
  /** The operation has ended: nothing more pauses, and a pause or resume still settling rejects with `reason`. */
  end(reason) {
    __privateSet(this, _state, "ended");
    __privateMethod(this, _PauseControl_instances, disarm_fn).call(this);
    __privateGet(this, _unlink).call(this);
    for (const reject of [...__privateGet(this, _pending)]) reject(reason);
    __privateGet(this, _pending).clear();
  }
};
_state = new WeakMap();
_hooks = new WeakMap();
_allowed = new WeakMap();
_turnedOff = new WeakMap();
_operation = new WeakMap();
_update = new WeakMap();
_snapshot = new WeakMap();
_segment = new WeakMap();
_unlink = new WeakMap();
_stopped = new WeakMap();
_waiting = new WeakMap();
_timer = new WeakMap();
_deadline = new WeakMap();
_status = new WeakMap();
_text = new WeakMap();
_pending = new WeakMap();
_PauseControl_instances = new WeakSet();
pauseAgain_fn = async function() {
  const hooks = __privateGet(this, _hooks);
  const deadline = __privateGet(this, _deadline);
  __privateSet(this, _state, "pausing");
  __privateMethod(this, _PauseControl_instances, disarm_fn).call(this);
  __privateGet(this, _update).call(this, {});
  try {
    __privateMethod(this, _PauseControl_instances, paused_fn).call(this, await __privateMethod(this, _PauseControl_instances, untilEnded_fn).call(this, hooks.pause()));
  } catch (err) {
    if (__privateMethod(this, _PauseControl_instances, ending_fn).call(this, err)) throw err;
    __privateMethod(this, _PauseControl_instances, paused_fn).call(this, deadline);
    throw err;
  }
};
/**
 * Whether an error from the server, or a cancel, ends the operation: a
 * cancel, or the server no longer having it (NOT_FOUND), which the
 * operation then fails with.
 */
ending_fn = function(err) {
  if (__privateGet(this, _state) === "ended" || __privateGet(this, _operation).aborted) return true;
  if (!DropgateError.is(err, "NOT_FOUND")) return false;
  __privateSet(this, _state, "ending");
  __privateMethod(this, _PauseControl_instances, disarm_fn).call(this);
  __privateGet(this, _waiting)?.fail(err);
  return true;
};
paused_fn = function(deadline) {
  __privateSet(this, _state, "paused");
  __privateSet(this, _deadline, deadline);
  __privateGet(this, _update).call(this, { status: "paused", pausedBy: "self", deadline, text: "Paused." });
  __privateMethod(this, _PauseControl_instances, arm_fn).call(this);
};
/** Back to running: a new segment for the steps from here, and the work goes on. */
run_fn = function() {
  __privateSet(this, _state, "running");
  __privateSet(this, _deadline, null);
  __privateMethod(this, _PauseControl_instances, newSegment_fn).call(this);
  __privateGet(this, _update).call(this, { status: __privateGet(this, _status), text: __privateGet(this, _text), pausedBy: null, deadline: null });
  __privateGet(this, _waiting)?.go();
};
/** At the deadline, a paused operation fails: the server no longer holds it, and nothing resumes by itself. */
arm_fn = function() {
  __privateMethod(this, _PauseControl_instances, disarm_fn).call(this);
  const deadline = __privateGet(this, _deadline);
  if (deadline === null) return;
  __privateSet(this, _timer, setTimeout(() => {
    __privateSet(this, _timer, null);
    if (__privateGet(this, _state) !== "paused") return;
    __privateSet(this, _state, "ending");
    __privateGet(this, _waiting)?.fail(__privateGet(this, _hooks).expired());
  }, Math.max(0, deadline - Date.now())));
};
disarm_fn = function() {
  if (__privateGet(this, _timer) !== null) clearTimeout(__privateGet(this, _timer));
  __privateSet(this, _timer, null);
};
newSegment_fn = function() {
  __privateGet(this, _unlink).call(this);
  const segment = new AbortController();
  const operation = __privateGet(this, _operation);
  const onAbort = () => segment.abort(operation.reason);
  if (operation.aborted) segment.abort(operation.reason);
  else operation.addEventListener("abort", onAbort, { once: true });
  __privateSet(this, _segment, segment);
  __privateSet(this, _unlink, () => operation.removeEventListener("abort", onAbort));
};
/** `promise`, or a rejection if the operation ends first. */
untilEnded_fn = function(promise) {
  return new Promise((resolve, reject) => {
    __privateGet(this, _pending).add(reject);
    promise.then(resolve, reject).finally(() => __privateGet(this, _pending).delete(reject));
  });
};

// src/operation.ts
function newOperationId() {
  return cryptoProvider().randomUUID();
}
function startOperation(opts) {
  const scope = new CancelScope(opts.kind, { parent: opts.parent, signal: opts.signal });
  const listeners = /* @__PURE__ */ new Set();
  const idle = { canPause: false, pausedBy: null, deadline: null };
  let snapshot = Object.freeze({ ...opts.initial, ...idle, transport: opts.transport });
  let ended = false;
  const publish = (next) => {
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
      }
    }
  };
  const update = (patch) => {
    if (!ended) publish({ ...snapshot, ...patch, canPause: pausing.canPause, transport: opts.transport });
  };
  const pausing = new PauseControl(scope.signal, (patch) => update(patch), () => snapshot);
  const ctx = { scope, signal: scope.signal, update, pausing };
  const run = async () => {
    await Promise.resolve();
    scope.throwIfCancelled();
    return opts.work(ctx);
  };
  const result = settle(scope, run, opts.transport).then((outcome) => {
    ended = true;
    pausing.end(withTransport(outcome.status === "failed" ? outcome.error : new DropgateError({ code: outcome.status === "cancelled" ? "OPERATION_CANCELLED" : "PAUSE_UNAVAILABLE", message: "It has ended." }), opts.transport));
    try {
      opts.onEnd?.(handle);
    } catch {
    }
    publish({ ...opts.finalSnapshot(outcome, snapshot), ...idle, transport: opts.transport });
    listeners.clear();
    return outcome;
  });
  const handle = {
    id: newOperationId(),
    kind: opts.kind,
    result,
    get snapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (ended) return () => {
      };
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel() {
      scope.cancel();
    },
    pause: () => pausing.pause().catch((err) => {
      throw withTransport(err, opts.transport);
    }),
    resume: () => pausing.resume().catch((err) => {
      throw withTransport(err, opts.transport);
    })
  };
  return handle;
}

// src/operations.ts
var OperationRegistry = class {
  constructor() {
    __publicField(this, "running", /* @__PURE__ */ new Map());
    __publicField(this, "root", new CancelScope("client"));
    /** What `client.operations` is. */
    __publicField(this, "api", Object.freeze({
      get: (id) => this.running.get(id),
      list: () => [...this.running.values()].map(({ id, kind }) => ({ id, kind })),
      cancelAll: () => {
        const root = this.root;
        this.root = new CancelScope("client");
        root.cancel();
      }
    }));
  }
  /** The node the client's next operation runs under. */
  get scope() {
    return this.root;
  }
  /** Adds a handle as its operation starts. */
  add(handle) {
    this.running.set(handle.id, handle);
    return handle;
  }
  /** Takes a handle out as its operation ends. */
  remove(handle) {
    this.running.delete(handle.id);
  }
};

// src/sink.ts
function isDownloadSink(value) {
  return typeof value === "object" && value !== null && typeof value.write === "function" && typeof value.close === "function";
}
var SinkWriter = class _SinkWriter {
  constructor(sink) {
    __publicField(this, "sink", sink);
    __publicField(this, "done", false);
  }
  /** Gets the sink for one file from a function giving one, or fails OUTPUT_WRITE_FAILED. */
  static async open(option, file) {
    let sink;
    try {
      sink = typeof option === "function" ? await option(file) : option;
    } catch (err) {
      throw new DropgateError({ code: "OUTPUT_WRITE_FAILED", cause: err });
    }
    if (!isDownloadSink(sink)) {
      throw new DropgateError({ code: "OUTPUT_WRITE_FAILED", message: "The function giving a sink gave something without write() and close()." });
    }
    return new _SinkWriter(sink);
  }
  async write(chunk) {
    try {
      await this.sink.write(chunk);
    } catch (err) {
      throw toDropgateError(err, "OUTPUT_WRITE_FAILED");
    }
  }
  async close() {
    this.done = true;
    try {
      await this.sink.close();
    } catch (err) {
      throw toDropgateError(err, "OUTPUT_WRITE_FAILED");
    }
  }
  /** Aborts the sink, once, if it wasn't closed. Best effort: an abort that fails is ignored. */
  async abort(reason) {
    if (this.done) return;
    this.done = true;
    try {
      await this.sink.abort?.(reason);
    } catch {
    }
  }
};

// src/source.ts
function blobSource(blob, name) {
  return {
    name: name ?? blob.name ?? "file",
    size: blob.size,
    ...blob.type ? { type: blob.type } : {},
    async read(start, end) {
      return new Uint8Array(await blob.slice(start, end).arrayBuffer());
    }
  };
}
var fileChanged = () => new DropgateError({
  code: "SOURCE_UNAVAILABLE",
  message: "A file changed after the upload started, so the rest of it can't be read as it was."
});
async function fileHandleSource(handle, opts) {
  const { size, mtimeMs } = await handle.stat();
  return {
    name: opts.name,
    size,
    ...opts.type ? { type: opts.type } : {},
    async read(start, end) {
      const now = await handle.stat();
      if (now.size !== size || now.mtimeMs !== mtimeMs) throw fileChanged();
      const buffer = new Uint8Array(end - start);
      let filled = 0;
      while (filled < buffer.length) {
        const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, start + filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      return filled === buffer.length ? buffer : buffer.subarray(0, filled);
    }
  };
}
var isFileSource = (value) => typeof value === "object" && value !== null && typeof value.read === "function" && typeof value.name === "string" && Number.isFinite(value.size);
var isBlobLike = (value) => typeof value === "object" && value !== null && typeof value.slice === "function" && Number.isFinite(value.size);
function toFileSources(input) {
  const list = Array.isArray(input) ? input : [input];
  return list.map((item, index) => {
    if (isFileSource(item)) return item;
    if (isBlobLike(item)) return blobSource(item);
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: `File at index ${index} is missing or invalid.`, details: { index } });
  });
}
async function readRange(source, start, end) {
  let bytes;
  try {
    bytes = await source.read(start, end);
  } catch (err) {
    if (DropgateError.is(err, "SOURCE_UNAVAILABLE")) throw err;
    throw new DropgateError({ code: "SOURCE_UNAVAILABLE", cause: err });
  }
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength !== end - start) {
    throw new DropgateError({
      code: "SOURCE_UNAVAILABLE",
      message: "A file gave a different number of bytes than asked for. It may have changed while it was read."
    });
  }
  const view2 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view2.buffer instanceof ArrayBuffer ? view2 : new Uint8Array(view2);
}

// src/adapters/defaults.ts
function getDefaultBase64() {
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    return {
      encode(bytes) {
        return Buffer.from(bytes).toString("base64");
      },
      decode(b64) {
        return new Uint8Array(Buffer.from(b64, "base64"));
      }
    };
  }
  if (typeof btoa === "function" && typeof atob === "function") {
    return {
      encode(bytes) {
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      },
      decode(b64) {
        const binary = atob(b64);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          out[i] = binary.charCodeAt(i);
        }
        return out;
      }
    };
  }
  throw new Error(
    "No Base64 implementation available. Provide a Base64Adapter via options."
  );
}
function getDefaultFetch() {
  return globalThis.fetch?.bind(globalThis);
}

// src/utils/share-link.ts
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var CODE_RE = /^[A-Z]{4}-\d{4}$/;
function parseShareInput(value) {
  const raw = String(value ?? "").trim();
  const hashAt = raw.indexOf("#");
  const before = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const after = hashAt === -1 ? "" : raw.slice(hashAt + 1);
  const secret = after ? after : void 0;
  if (!/^https?:\/\//i.test(before)) {
    const typed = before.replace(/\s+/g, "");
    if (UUID_RE.test(typed)) return { kind: "hosted", locator: typed.toLowerCase(), ...secret ? { secret } : {} };
    const code = typed.toUpperCase();
    return CODE_RE.test(code) ? { kind: "direct", locator: code } : null;
  }
  let url;
  try {
    url = new URL(before);
  } catch {
    return null;
  }
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (path.startsWith("/p2p/")) {
    const code = path.slice("/p2p/".length).replace(/\s+/g, "").toUpperCase();
    return CODE_RE.test(code) ? { kind: "direct", locator: code, linkHost: url.host } : null;
  }
  const bundle = path.startsWith("/b/");
  const id = path.slice(bundle ? "/b/".length : 1);
  if (!UUID_RE.test(id)) return null;
  return { kind: bundle ? "bundle" : "hosted", locator: id.toLowerCase(), linkHost: url.host, ...secret ? { secret } : {} };
}

// src/utils/filename.ts
var MAX_FILENAME_BYTES = 255;
var encoder = new TextEncoder();
var utf8Length = (s) => encoder.encode(s).length;
var CONTROL = /\p{Cc}/u;
var CONTROL_ALL = /\p{Cc}/gu;
var INVISIBLE = /[؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/gu;
var WINDOWS_ILLEGAL = /[<>:"/\\|?*]/g;
var RESERVED = /^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(\s*)(\..*)?$/i;
var TRAILING_DOTS_AND_SPACES = /[. ]+$/;
function validateFilename(filename, where = {}) {
  const invalid3 = (message) => new DropgateError({
    code: "INVALID_FILENAME",
    message,
    ...where.origin ? { origin: where.origin } : {},
    ...where.index === void 0 ? {} : { details: { index: where.index } }
  });
  if (typeof filename !== "string" || filename.trim().length === 0) {
    throw invalid3("A file name is empty.");
  }
  if (utf8Length(filename) > MAX_FILENAME_BYTES) {
    throw invalid3(`A file name is longer than ${MAX_FILENAME_BYTES} bytes.`);
  }
  if (CONTROL.test(filename)) {
    throw invalid3("A file name has a control character in it.");
  }
  if (/[/\\]/.test(filename)) {
    throw invalid3("A file name has a path in it.");
  }
}
function splitExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}
function truncateBytes(s, budget) {
  let used = 0;
  let kept = "";
  for (const ch of s) {
    const size = utf8Length(ch);
    if (used + size > budget) break;
    used += size;
    kept += ch;
  }
  return kept;
}
function joinWithinLimit(stem, suffix, ext) {
  const whole = stem + suffix + ext;
  if (utf8Length(whole) <= MAX_FILENAME_BYTES) return whole;
  if (utf8Length(suffix + ext) > MAX_FILENAME_BYTES / 2) {
    return truncateBytes(stem + ext, MAX_FILENAME_BYTES - utf8Length(suffix)) + suffix;
  }
  return truncateBytes(stem, MAX_FILENAME_BYTES - utf8Length(suffix + ext)) + suffix + ext;
}
function sanitizeFilename(filename) {
  let name = String(filename ?? "").normalize("NFC");
  name = name.replace(INVISIBLE, (ch) => `[U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}]`);
  name = name.replace(CONTROL_ALL, "_").replace(WINDOWS_ILLEGAL, "_");
  name = name.replace(TRAILING_DOTS_AND_SPACES, "");
  if (RESERVED.test(name)) name = `_${name}`;
  const [stem, ext] = splitExtension(name);
  name = joinWithinLimit(stem, "", ext).replace(TRAILING_DOTS_AND_SPACES, "");
  return name || "_";
}
function uniqueFilename(filename, taken) {
  const isTaken = typeof taken === "function" ? taken : /* @__PURE__ */ ((set) => (name) => set.has(name.toLowerCase()))(
    new Set(Array.from(taken, (n) => String(n).toLowerCase()))
  );
  if (!isTaken(filename)) return filename;
  const [stem, ext] = splitExtension(filename);
  for (let n = 1; ; n++) {
    const candidate = joinWithinLimit(stem, ` (${n})`, ext);
    if (!isTaken(candidate)) return candidate;
  }
}

// src/object/layout.ts
var HEADER_BYTES = 60;
var TAG_BYTES = 16;
var MIN_CHUNK_SIZE = 64 * 1024;
var MAX_CHUNK_SIZE = 64 * 1024 * 1024;
var invalid2 = (message) => new DropgateError({ code: "INVALID_ARGUMENT", message });
var isLength = (n) => Number.isSafeInteger(n) && n >= 0;
var isChunkSize = (chunkSize) => Number.isSafeInteger(chunkSize) && chunkSize >= MIN_CHUNK_SIZE && chunkSize <= MAX_CHUNK_SIZE;
var checkChunkSize = (chunkSize) => {
  if (!isChunkSize(chunkSize)) throw invalid2("A chunk size is from 64 KiB to 64 MiB.");
};
var bitLength = (n) => {
  let bits = 0;
  for (let rest = n; rest >= 1; rest = Math.floor(rest / 2)) bits++;
  return bits;
};
function padme(length) {
  if (!isLength(length)) throw invalid2("A length is a whole number of bytes.");
  if (length < 2) return length;
  const e = bitLength(length) - 1;
  const step = 2 ** (e - bitLength(e));
  return Math.ceil(length / step) * step;
}
function encryptedSize(length, chunkSize) {
  return HEADER_BYTES + length + TAG_BYTES * Math.ceil(length / chunkSize);
}
function paddedLength(length, chunkSize, maxBytes = 0) {
  checkChunkSize(chunkSize);
  if (!isLength(length) || length < 1) throw invalid2("An object holds at least one byte.");
  const padded = padme(length);
  if (!(maxBytes > 0)) return padded;
  if (encryptedSize(length, chunkSize) > maxBytes) throw new DropgateError({ code: "FILE_TOO_LARGE" });
  if (encryptedSize(padded, chunkSize) <= maxBytes) return padded;
  const room = maxBytes - HEADER_BYTES;
  const whole = Math.floor(room / (chunkSize + TAG_BYTES));
  const rest = room - whole * (chunkSize + TAG_BYTES);
  return whole * chunkSize + Math.max(0, rest - TAG_BYTES);
}
var _ObjectLayout_instances, check_fn;
var _ObjectLayout = class _ObjectLayout {
  constructor(encrypted, length, chunkSize) {
    __privateAdd(this, _ObjectLayout_instances);
    __publicField(this, "encrypted");
    __publicField(this, "chunkSize");
    /** The plaintext the chunks hold: for an encrypted object, padding included. */
    __publicField(this, "length");
    __publicField(this, "chunkCount");
    __publicField(this, "storedSize");
    this.encrypted = encrypted;
    this.chunkSize = chunkSize;
    this.length = length;
    this.chunkCount = Math.ceil(length / chunkSize);
    this.storedSize = encrypted ? encryptedSize(length, chunkSize) : length;
    Object.freeze(this);
  }
  /** An encrypted object of `length` plaintext bytes, padding included. */
  static encrypted(length, chunkSize) {
    checkChunkSize(chunkSize);
    if (!isLength(length) || length < 1) throw invalid2("An object holds at least one byte.");
    return new _ObjectLayout(true, length, chunkSize);
  }
  /** An unencrypted object: the files' bytes, with no header, tags or padding. */
  static plain(length, chunkSize) {
    checkChunkSize(chunkSize);
    if (!isLength(length) || length < 1) throw invalid2("An object holds at least one byte.");
    return new _ObjectLayout(false, length, chunkSize);
  }
  /**
   * The encrypted object a server says it holds `storedSize` bytes of.
   * @throws {DropgateError} INTEGRITY_FAILED if no object with this chunk size is that size.
   */
  static fromStoredSize(storedSize, chunkSize) {
    checkChunkSize(chunkSize);
    const body = storedSize - HEADER_BYTES;
    const count = Math.ceil(body / (chunkSize + TAG_BYTES));
    const lastStored = body - (count - 1) * (chunkSize + TAG_BYTES);
    if (!Number.isSafeInteger(storedSize) || count < 1 || lastStored <= TAG_BYTES) {
      throw new DropgateError({ code: "INTEGRITY_FAILED", message: "The object's size doesn't fit its chunk size." });
    }
    return new _ObjectLayout(true, (count - 1) * chunkSize + lastStored - TAG_BYTES, chunkSize);
  }
  /** Whether chunk `index` is the last. */
  isLast(index) {
    return index === this.chunkCount - 1;
  }
  /** The plaintext bytes in chunk `index`: C, but for the last. */
  chunkLength(index) {
    __privateMethod(this, _ObjectLayout_instances, check_fn).call(this, index);
    return Math.min(this.chunkSize, this.length - index * this.chunkSize);
  }
  /** Chunk `index`'s stored bytes, its tag included. */
  chunkBytes(index) {
    return this.range(index, index);
  }
  /** The stored bytes of chunks `first` to `last`, both included: a resume asks from the next whole chunk after the last one written. */
  range(first, last = this.chunkCount - 1) {
    __privateMethod(this, _ObjectLayout_instances, check_fn).call(this, first);
    __privateMethod(this, _ObjectLayout_instances, check_fn).call(this, last);
    if (last < first) throw invalid2("A range ends before it starts.");
    const stored = this.encrypted ? this.chunkSize + TAG_BYTES : this.chunkSize;
    const base = this.encrypted ? HEADER_BYTES : 0;
    return Object.freeze({ start: base + first * stored, end: Math.min(this.storedSize, base + (last + 1) * stored) });
  }
  /**
   * What the plaintext `[offset, offset + length)` needs, such as a bundle's
   * member: the chunks it's in, one run of stored bytes, and how many
   * plaintext bytes of the first chunk come before it. It never takes in a
   * chunk that's only padding.
   */
  span(offset, length) {
    if (!isLength(offset) || !isLength(length) || length < 1 || offset + length > this.length) {
      throw invalid2("That run of bytes isn't in the object.");
    }
    const first = Math.floor(offset / this.chunkSize);
    const last = Math.floor((offset + length - 1) / this.chunkSize);
    return Object.freeze({ first, last, skip: offset - first * this.chunkSize, ...this.range(first, last) });
  }
  /**
   * Where chunk `index`'s plaintext comes from, given the files' sizes in
   * order: the parts of files it holds, then `padding` zero bytes.
   */
  chunkParts(index, fileSizes) {
    const start = index * this.chunkSize;
    const end = start + this.chunkLength(index);
    const parts = [];
    let fileStart = 0;
    for (let file = 0; file < fileSizes.length && fileStart < end; file++) {
      const fileEnd = fileStart + fileSizes[file];
      const from = Math.max(start, fileStart);
      const to = Math.min(end, fileEnd);
      if (to > from) parts.push(Object.freeze({ file, offset: from - fileStart, length: to - from }));
      fileStart = fileEnd;
    }
    const filled = parts.reduce((sum, part) => sum + part.length, 0);
    return { parts, padding: end - start - filled };
  }
};
_ObjectLayout_instances = new WeakSet();
check_fn = function(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= this.chunkCount) throw invalid2("No chunk has that index.");
};
var ObjectLayout = _ObjectLayout;

// src/utils/size.ts
var BYTES_PER = Object.freeze({ KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 });
function mbToBytes(mb) {
  return mb * BYTES_PER.MB;
}
function estimateUploadBytes(sizeBytes, opts) {
  const base = Number(sizeBytes) || 0;
  if (!opts.encrypted || base <= 0 || !Number.isSafeInteger(base)) return base;
  const chunkSize = isChunkSize(Number(opts.chunkSize)) ? Number(opts.chunkSize) : DEFAULT_CHUNK_SIZE;
  const maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : 0;
  try {
    return encryptedSize(paddedLength(base, chunkSize, maxBytes), chunkSize);
  } catch {
    return encryptedSize(base, chunkSize);
  }
}

// src/utils/base64.ts
var defaultAdapter = null;
function getAdapter(adapter) {
  if (adapter) return adapter;
  if (!defaultAdapter) {
    defaultAdapter = getDefaultBase64();
  }
  return defaultAdapter;
}
function bytesToBase64(bytes, adapter) {
  return getAdapter(adapter).encode(bytes);
}
function base64ToBytes(b64, adapter) {
  return getAdapter(adapter).decode(b64);
}
function bytesToBase64url(bytes, adapter) {
  return bytesToBase64(bytes, adapter).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64urlToBytes(value, length, adapter) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return null;
  let bytes;
  try {
    const standard = value.replace(/-/g, "+").replace(/_/g, "/");
    bytes = base64ToBytes(standard + "=".repeat((4 - standard.length % 4) % 4), adapter);
  } catch {
    return null;
  }
  if (bytesToBase64url(bytes, adapter) !== value) return null;
  if (length !== void 0 && bytes.byteLength !== length) return null;
  return new Uint8Array(bytes);
}

// src/credentials.ts
var TOKEN68 = /^[A-Za-z0-9\-._~+/]+=*$/;
var MAX_TOKEN_LENGTH = 8192;
var _provider2, _operation2, _baseUrl, _token, _renewed, _OperationCredentials_instances, ask_fn;
var _OperationCredentials = class _OperationCredentials {
  constructor(provider, operation, baseUrl) {
    __privateAdd(this, _OperationCredentials_instances);
    __privateAdd(this, _provider2);
    __privateAdd(this, _operation2);
    __privateAdd(this, _baseUrl);
    __privateAdd(this, _token, null);
    __privateAdd(this, _renewed, false);
    __privateSet(this, _provider2, provider);
    __privateSet(this, _operation2, operation);
    __privateSet(this, _baseUrl, baseUrl);
  }
  /**
   * The credential for an operation the server says needs one, from the
   * provider.
   * @throws {DropgateError} AUTH_REQUIRED if there's no provider, it gives none, or it fails;
   * INVALID_ARGUMENT if what it gives isn't a credential; OPERATION_CANCELLED.
   */
  static async required(provider, operation, baseUrl, signal) {
    var _a;
    if (!provider) {
      throw new DropgateError({
        code: "AUTH_REQUIRED",
        message: "This server needs a credential for this, and the client was given no auth provider."
      });
    }
    const credentials = new _OperationCredentials(provider, operation, baseUrl);
    __privateSet(credentials, _token, await __privateMethod(_a = credentials, _OperationCredentials_instances, ask_fn).call(_a, "required", signal));
    return credentials;
  }
  /** The headers that carry the credential: none if there isn't one. */
  headers() {
    return __privateGet(this, _token) === null ? {} : { Authorization: `Bearer ${__privateGet(this, _token)}` };
  }
  /**
   * After the server said the credential had expired: asks the provider once
   * more, the first time only. Whether the request may be made again.
   */
  async renew(signal) {
    if (!__privateGet(this, _provider2) || __privateGet(this, _renewed)) return false;
    __privateSet(this, _renewed, true);
    __privateSet(this, _token, await __privateMethod(this, _OperationCredentials_instances, ask_fn).call(this, "expired", signal));
    return true;
  }
  toJSON() {
    return "[Credentials]";
  }
  toString() {
    return "[Credentials]";
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return "[Credentials]";
  }
};
_provider2 = new WeakMap();
_operation2 = new WeakMap();
_baseUrl = new WeakMap();
_token = new WeakMap();
_renewed = new WeakMap();
_OperationCredentials_instances = new WeakSet();
ask_fn = async function(reason, signal) {
  if (signal.aborted) throw signal.reason;
  const request = Object.freeze({ operation: __privateGet(this, _operation2), reason, baseUrl: __privateGet(this, _baseUrl), signal });
  let given;
  let stopWatching = () => {
  };
  const cancelled = new Promise((_, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    stopWatching = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    given = await Promise.race([Promise.resolve().then(() => __privateGet(this, _provider2).call(this, request)), cancelled]);
  } catch {
    if (signal.aborted) throw signal.reason;
    throw new DropgateError({ code: "AUTH_REQUIRED", origin: "local", message: "The auth provider couldn't give a credential." });
  } finally {
    stopWatching();
  }
  if (signal.aborted) throw signal.reason;
  if (given === null || given === void 0) {
    throw new DropgateError({ code: "AUTH_REQUIRED", message: "This server needs a credential for this, and the auth provider gave none." });
  }
  const token = given?.token;
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH || !TOKEN68.test(token)) {
    throw new DropgateError({
      code: "INVALID_ARGUMENT",
      message: "The auth provider's credential must be { token }, with a token of letters, digits and -._~+/ (optionally ending in =)."
    });
  }
  return token;
};
/** For an operation the server doesn't ask a credential for: nothing is ever sent. */
__publicField(_OperationCredentials, "none", new _OperationCredentials(null, "hosted.upload", ""));
var OperationCredentials = _OperationCredentials;
function credentialExpired(status, json) {
  return status === 401 && Boolean(json) && typeof json === "object" && json.code === "AUTH_EXPIRED";
}

// src/p2p/helpers.ts
function resolvePeerConfig(userConfig, serverCaps) {
  return {
    path: userConfig.peerjsPath ?? serverCaps?.peerjsPath ?? "/peerjs",
    iceServers: userConfig.iceServers ?? serverCaps?.iceServers ?? []
  };
}
function buildPeerOptions(config = {}) {
  const { host, port, peerjsPath = "/peerjs", secure = false, iceServers = [] } = config;
  const peerOpts = {
    host,
    path: peerjsPath,
    secure,
    config: { iceServers },
    debug: 0
  };
  if (port) {
    peerOpts.port = port;
  }
  return peerOpts;
}
async function createPeerWithRetries(opts) {
  const { code, codeGenerator, maxAttempts, buildPeer, onCode } = opts;
  let nextCode = code || codeGenerator();
  let peer = null;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onCode?.(nextCode, attempt);
    try {
      peer = await new Promise((resolve, reject) => {
        const instance = buildPeer(nextCode);
        instance.on("open", () => resolve(instance));
        instance.on("error", (err) => {
          try {
            instance.destroy();
          } catch {
          }
          reject(err);
        });
      });
      return { peer, code: nextCode };
    } catch (err) {
      lastError = err;
      nextCode = codeGenerator();
    }
  }
  throw lastError || new DropgateError({ code: "SERVER_UNREACHABLE", message: "Could not establish PeerJS connection." });
}

// src/p2p/protocol.ts
var P2P_PROTOCOL_VERSION = PROTOCOLS.dgdtp.major;
function isP2PMessage(value) {
  if (!value || typeof value !== "object") return false;
  const msg = value;
  return typeof msg.t === "string" && [
    "hello",
    "file_list",
    "meta",
    "ready",
    "chunk",
    "chunk_ack",
    "file_end",
    "file_end_ack",
    "end",
    "end_ack",
    "ping",
    "pong",
    "error",
    "cancelled",
    "resume",
    "resume_ack"
  ].includes(msg.t);
}
var P2P_CHUNK_SIZE = 64 * 1024;
var P2P_MAX_UNACKED_CHUNKS = 64;
var P2P_END_ACK_TIMEOUT_MS = 15e3;
var P2P_END_ACK_RETRIES = 3;
var P2P_END_ACK_RETRY_DELAY_MS = 100;
var P2P_CLOSE_GRACE_PERIOD_MS = 2e3;

// src/p2p/send.ts
var P2P_UNACKED_CHUNK_TIMEOUT_MS = 6e4;
function generateSessionId() {
  return cryptoProvider().randomUUID();
}
var ALLOWED_TRANSITIONS = {
  initializing: ["listening", "closed"],
  listening: ["handshaking", "closed", "cancelled"],
  handshaking: ["negotiating", "closed", "cancelled"],
  negotiating: ["transferring", "closed", "cancelled"],
  transferring: ["finishing", "closed", "cancelled"],
  finishing: ["awaiting_ack", "closed", "cancelled"],
  awaiting_ack: ["completed", "closed", "cancelled"],
  completed: ["closed"],
  cancelled: ["closed"],
  closed: []
};
async function startP2PSend(opts) {
  const {
    file,
    Peer,
    serverInfo,
    host,
    port,
    peerjsPath,
    secure = false,
    iceServers,
    codeGenerator,
    maxAttempts = 4,
    chunkSize = P2P_CHUNK_SIZE,
    endAckTimeoutMs = P2P_END_ACK_TIMEOUT_MS,
    bufferHighWaterMark = 8 * 1024 * 1024,
    bufferLowWaterMark = 2 * 1024 * 1024,
    heartbeatIntervalMs = 5e3,
    chunkAcknowledgments = true,
    maxUnackedChunks = P2P_MAX_UNACKED_CHUNKS,
    onCode,
    onStatus,
    onProgress,
    onComplete,
    onError,
    onDisconnect,
    onCancel,
    onConnectionHealth
  } = opts;
  const files = Array.isArray(file) ? file : [file];
  const isMultiFile = files.length > 1;
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (!files.length) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "At least one file is required." });
  }
  files.forEach((f, index) => validateFilename(f.name, { index }));
  if (!Peer) {
    throw new DropgateError({
      code: "INVALID_ARGUMENT",
      message: "PeerJS Peer constructor is required. Install peerjs and pass it as the Peer option."
    });
  }
  const p2pCaps = serverInfo?.capabilities?.p2p;
  if (serverInfo && !p2pCaps?.enabled) {
    throw directTransferDisabled();
  }
  const { path: finalPath, iceServers: finalIceServers } = resolvePeerConfig(
    { peerjsPath, iceServers },
    p2pCaps
  );
  const peerOpts = buildPeerOptions({
    host,
    port,
    peerjsPath: finalPath,
    secure,
    iceServers: finalIceServers
  });
  const finalCodeGenerator = codeGenerator || (() => generateP2PCode());
  const buildPeer = (id) => new Peer(id, peerOpts);
  const { peer, code } = await createPeerWithRetries({
    code: null,
    codeGenerator: finalCodeGenerator,
    maxAttempts,
    buildPeer,
    onCode
  });
  const sessionId = generateSessionId();
  let state = "listening";
  let activeConn = null;
  let sentBytes = 0;
  let heartbeatTimer = null;
  let healthCheckTimer = null;
  let lastActivityTime = Date.now();
  const unackedChunks = /* @__PURE__ */ new Map();
  let nextSeq = 0;
  let ackResolvers = [];
  let lastReportedBytes = 0;
  let transferEverStarted = false;
  const connectionAttempts = [];
  const MAX_CONNECTION_ATTEMPTS = 10;
  const CONNECTION_RATE_WINDOW_MS = 1e4;
  const transitionTo = (newState) => {
    if (!ALLOWED_TRANSITIONS[state].includes(newState)) {
      console.warn(`[P2P Send] Invalid state transition: ${state} -> ${newState}`);
      return false;
    }
    state = newState;
    return true;
  };
  const reportProgress = (data) => {
    if (isStopped()) return;
    const safeTotal = Number.isFinite(data.total) && data.total > 0 ? data.total : totalSize;
    const safeReceived = Math.min(Number(data.received) || 0, safeTotal || 0);
    if (safeReceived < lastReportedBytes) return;
    lastReportedBytes = safeReceived;
    const percent = safeTotal ? safeReceived / safeTotal * 100 : 0;
    onProgress?.({ processedBytes: safeReceived, totalBytes: safeTotal, percent });
  };
  const safeError = (err) => {
    if (state === "closed" || state === "completed" || state === "cancelled") return;
    transitionTo("closed");
    onError?.(err);
    cleanup();
  };
  const safeComplete = () => {
    if (state !== "awaiting_ack" && state !== "finishing") return;
    transitionTo("completed");
    onComplete?.();
    cleanup();
  };
  const cleanup = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }
    ackResolvers.forEach((resolve) => resolve());
    ackResolvers = [];
    unackedChunks.clear();
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", handleUnload);
    }
    try {
      activeConn?.close();
    } catch {
    }
    try {
      peer.destroy();
    } catch {
    }
  };
  const handleUnload = () => {
    try {
      activeConn?.send({ t: "error", message: "Sender closed the connection." });
    } catch {
    }
    stop();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", handleUnload);
  }
  const stop = () => {
    if (state === "closed" || state === "cancelled") return;
    if (state === "completed") {
      cleanup();
      return;
    }
    const wasActive = state === "transferring" || state === "finishing" || state === "awaiting_ack";
    transitionTo("cancelled");
    try {
      if (activeConn && activeConn.open) {
        activeConn.send({ t: "cancelled", message: "Sender cancelled the transfer." });
      }
    } catch {
    }
    if (wasActive && onCancel) {
      onCancel({ cancelledBy: "sender" });
    }
    cleanup();
  };
  const isStopped = () => state === "closed" || state === "cancelled";
  const startHealthMonitoring = (conn) => {
    if (!onConnectionHealth) return;
    healthCheckTimer = setInterval(() => {
      if (isStopped()) return;
      const dc = conn._dc;
      if (!dc) return;
      const health = {
        iceConnectionState: dc.readyState === "open" ? "connected" : "disconnected",
        bufferedAmount: dc.bufferedAmount,
        lastActivityMs: Date.now() - lastActivityTime
      };
      onConnectionHealth(health);
    }, 2e3);
  };
  const handleChunkAck = (msg) => {
    lastActivityTime = Date.now();
    unackedChunks.delete(msg.seq);
    reportProgress({ received: msg.received, total: totalSize });
    const resolver = ackResolvers.shift();
    if (resolver) resolver();
  };
  const waitForAck = () => {
    return new Promise((resolve) => {
      ackResolvers.push(resolve);
    });
  };
  const sendChunk = async (conn, data, offset, fileTotal) => {
    if (chunkAcknowledgments) {
      while (unackedChunks.size >= maxUnackedChunks) {
        const now = Date.now();
        for (const [_seq, chunk] of unackedChunks) {
          if (now - chunk.sentAt > P2P_UNACKED_CHUNK_TIMEOUT_MS) {
            const bufferedBytes = conn._dc?.bufferedAmount ?? 0;
            if (bufferedBytes >= 1024 * 1024) {
              throw new DropgateError({
                code: "CONNECTION_LOST",
                message: "Connection is too unstable. Data is queued locally but not being delivered to the receiver."
              });
            }
            throw new DropgateError({
              code: "CONNECTION_LOST",
              message: "Receiver stopped responding. No acknowledgments received for over " + P2P_UNACKED_CHUNK_TIMEOUT_MS + " ms."
            });
          }
        }
        await Promise.race([
          waitForAck(),
          sleep(1e3)
          // Timeout to prevent deadlock
        ]);
        if (isStopped()) return;
      }
    }
    const seq = nextSeq++;
    if (chunkAcknowledgments) {
      unackedChunks.set(seq, { offset, size: data.byteLength, sentAt: Date.now() });
    }
    conn.send({ t: "chunk", seq, offset, size: data.byteLength, total: fileTotal ?? totalSize });
    conn.send(data);
    sentBytes += data.byteLength;
    const dc = conn._dc;
    if (dc && bufferHighWaterMark > 0) {
      while (dc.bufferedAmount > bufferHighWaterMark) {
        await new Promise((resolve) => {
          const fallback = setTimeout(resolve, 60);
          try {
            dc.addEventListener(
              "bufferedamountlow",
              () => {
                clearTimeout(fallback);
                resolve();
              },
              { once: true }
            );
          } catch {
          }
        });
        if (isStopped()) return;
      }
    }
  };
  const waitForEndAck = async (conn, ackPromise) => {
    const baseTimeout = endAckTimeoutMs;
    for (let attempt = 0; attempt < P2P_END_ACK_RETRIES; attempt++) {
      conn.send({ t: "end", attempt });
      const timeout = baseTimeout * Math.pow(1.5, attempt);
      const result = await Promise.race([
        ackPromise,
        sleep(timeout).then(() => null)
      ]);
      if (result && result.t === "end_ack") {
        return result;
      }
      if (isStopped()) {
        throw new DropgateError({ code: "CONNECTION_LOST", message: "Connection closed during completion." });
      }
    }
    throw new DropgateError({ code: "CONNECTION_LOST", message: "Receiver did not confirm completion after retries." });
  };
  peer.on("connection", (conn) => {
    if (isStopped()) return;
    const now = Date.now();
    while (connectionAttempts.length > 0 && connectionAttempts[0] < now - CONNECTION_RATE_WINDOW_MS) {
      connectionAttempts.shift();
    }
    if (connectionAttempts.length >= MAX_CONNECTION_ATTEMPTS) {
      console.warn("[P2P Send] Connection rate limit exceeded, rejecting connection");
      try {
        conn.send({ t: "error", message: "Too many connection attempts. Please wait." });
      } catch {
      }
      try {
        conn.close();
      } catch {
      }
      return;
    }
    connectionAttempts.push(now);
    if (activeConn) {
      const isOldConnOpen = activeConn.open !== false;
      if (isOldConnOpen && state === "transferring") {
        try {
          conn.send({ t: "error", message: "Transfer already in progress." });
        } catch {
        }
        try {
          conn.close();
        } catch {
        }
        return;
      } else if (!isOldConnOpen) {
        try {
          activeConn.close();
        } catch {
        }
        activeConn = null;
        if (transferEverStarted) {
          try {
            conn.send({ t: "error", message: "Transfer already started with another receiver. Cannot reconnect." });
          } catch {
          }
          try {
            conn.close();
          } catch {
          }
          return;
        }
        state = "listening";
        sentBytes = 0;
        nextSeq = 0;
        unackedChunks.clear();
      } else {
        try {
          conn.send({ t: "error", message: "Another receiver is already connected." });
        } catch {
        }
        try {
          conn.close();
        } catch {
        }
        return;
      }
    }
    activeConn = conn;
    transitionTo("handshaking");
    if (!isStopped()) onStatus?.({ phase: "connected", message: "Receiver connected." });
    lastActivityTime = Date.now();
    let helloResolve = null;
    let readyResolve = null;
    let endAckResolve = null;
    let fileEndAckResolve = null;
    let started = false;
    const helloPromise = new Promise((resolve) => {
      helloResolve = resolve;
    });
    const readyPromise = new Promise((resolve) => {
      readyResolve = resolve;
    });
    const endAckPromise = new Promise((resolve) => {
      endAckResolve = resolve;
    });
    conn.on("data", (data) => {
      lastActivityTime = Date.now();
      if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        return;
      }
      if (!isP2PMessage(data)) return;
      const msg = data;
      switch (msg.t) {
        case "hello":
          helloResolve?.(msg.protocolVersion);
          break;
        case "ready":
          if (!isStopped()) onStatus?.({ phase: "transferring", message: "Receiver accepted. Starting transfer..." });
          readyResolve?.();
          break;
        case "chunk_ack":
          handleChunkAck(msg);
          break;
        case "file_end_ack":
          fileEndAckResolve?.(msg);
          break;
        case "end_ack":
          endAckResolve?.(msg);
          break;
        case "pong":
          break;
        case "error":
          safeError(new DropgateError({ code: "PEER_FAILED", message: "The receiver reported an error." }));
          break;
        case "cancelled":
          if (state === "cancelled" || state === "closed" || state === "completed") return;
          transitionTo("cancelled");
          onCancel?.({ cancelledBy: "receiver" });
          cleanup();
          break;
      }
    });
    conn.on("open", async () => {
      try {
        if (started || isStopped()) return;
        started = true;
        startHealthMonitoring(conn);
        const receiverVersion = await Promise.race([
          helloPromise,
          sleep(1e4).then(() => null)
        ]);
        if (isStopped()) return;
        if (receiverVersion === null) {
          throw new DropgateError({ code: "TIMED_OUT", origin: "peer", message: "Receiver did not respond to handshake." });
        } else if (receiverVersion !== P2P_PROTOCOL_VERSION) {
          throw new DropgateError({
            code: "VERSION_UNSUPPORTED",
            origin: "peer",
            message: `Protocol version mismatch: sender v${P2P_PROTOCOL_VERSION}, receiver v${receiverVersion}`
          });
        }
        conn.send({
          t: "hello",
          protocolVersion: P2P_PROTOCOL_VERSION,
          sessionId
        });
        transitionTo("negotiating");
        if (!isStopped()) onStatus?.({ phase: "waiting", message: "Connected. Waiting for receiver to accept..." });
        if (isMultiFile) {
          conn.send({
            t: "file_list",
            fileCount: files.length,
            files: files.map((f) => ({ name: f.name, size: f.size, mime: f.type || "application/octet-stream" })),
            totalSize
          });
        }
        conn.send({
          t: "meta",
          sessionId,
          name: files[0].name,
          size: files[0].size,
          mime: files[0].type || "application/octet-stream",
          ...isMultiFile ? { fileIndex: 0 } : {}
        });
        const dc = conn._dc;
        if (dc && Number.isFinite(bufferLowWaterMark)) {
          try {
            dc.bufferedAmountLowThreshold = bufferLowWaterMark;
          } catch {
          }
        }
        await readyPromise;
        if (isStopped()) return;
        if (heartbeatIntervalMs > 0) {
          heartbeatTimer = setInterval(() => {
            if (state === "transferring" || state === "finishing" || state === "awaiting_ack") {
              try {
                conn.send({ t: "ping", timestamp: Date.now() });
              } catch {
              }
            }
          }, heartbeatIntervalMs);
        }
        transitionTo("transferring");
        transferEverStarted = true;
        let overallSentBytes = 0;
        for (let fi = 0; fi < files.length; fi++) {
          const currentFile = files[fi];
          if (isMultiFile && fi > 0) {
            conn.send({
              t: "meta",
              sessionId,
              name: currentFile.name,
              size: currentFile.size,
              mime: currentFile.type || "application/octet-stream",
              fileIndex: fi
            });
          }
          for (let offset = 0; offset < currentFile.size; offset += chunkSize) {
            if (isStopped()) return;
            const slice = currentFile.slice(offset, offset + chunkSize);
            const buf = await slice.arrayBuffer();
            if (isStopped()) return;
            await sendChunk(conn, buf, offset, currentFile.size);
            overallSentBytes += buf.byteLength;
            reportProgress({ received: overallSentBytes, total: totalSize });
          }
          if (isStopped()) return;
          if (isMultiFile) {
            const fileEndAckPromise = new Promise((resolve) => {
              fileEndAckResolve = resolve;
            });
            conn.send({ t: "file_end", fileIndex: fi });
            const feAck = await Promise.race([
              fileEndAckPromise,
              sleep(endAckTimeoutMs).then(() => null)
            ]);
            if (isStopped()) return;
            if (!feAck) {
              throw new DropgateError({ code: "CONNECTION_LOST", message: `Receiver did not confirm receipt of file ${fi + 1}/${files.length}.` });
            }
          }
        }
        if (isStopped()) return;
        transitionTo("finishing");
        transitionTo("awaiting_ack");
        const ackResult = await waitForEndAck(conn, endAckPromise);
        if (isStopped()) return;
        const ackTotal = Number(ackResult.total) || totalSize;
        const ackReceived = Number(ackResult.received) || 0;
        if (ackTotal && ackReceived < ackTotal) {
          throw new DropgateError({ code: "PEER_FAILED", message: "Receiver reported an incomplete transfer." });
        }
        reportProgress({ received: ackReceived || ackTotal, total: ackTotal });
        safeComplete();
      } catch (err) {
        safeError(err);
      }
    });
    conn.on("error", (err) => {
      safeError(err);
    });
    conn.on("close", () => {
      if (state === "closed" || state === "completed" || state === "cancelled") {
        cleanup();
        return;
      }
      if (state === "awaiting_ack") {
        setTimeout(() => {
          if (state === "awaiting_ack") {
            safeError(new DropgateError({ code: "CONNECTION_LOST", message: "Connection closed while awaiting confirmation." }));
          }
        }, P2P_CLOSE_GRACE_PERIOD_MS);
        return;
      }
      if (state === "transferring" || state === "finishing") {
        transitionTo("cancelled");
        onCancel?.({ cancelledBy: "receiver" });
        cleanup();
      } else {
        activeConn = null;
        state = "listening";
        sentBytes = 0;
        nextSeq = 0;
        unackedChunks.clear();
        onDisconnect?.();
      }
    });
  });
  return {
    peer,
    code,
    sessionId,
    stop,
    getStatus: () => state,
    getBytesSent: () => sentBytes,
    getConnectedPeerId: () => {
      if (!activeConn) return null;
      return activeConn.peer || null;
    }
  };
}

// src/p2p/receive.ts
var ALLOWED_TRANSITIONS2 = {
  initializing: ["connecting", "closed"],
  connecting: ["handshaking", "closed", "cancelled"],
  handshaking: ["negotiating", "closed", "cancelled"],
  negotiating: ["transferring", "closed", "cancelled"],
  transferring: ["completed", "closed", "cancelled"],
  completed: ["closed"],
  cancelled: ["closed"],
  closed: []
};
async function startP2PReceive(opts) {
  const {
    code,
    Peer,
    serverInfo,
    host,
    port,
    peerjsPath,
    secure = false,
    iceServers,
    autoReady = true,
    watchdogTimeoutMs = 3e4,
    onStatus,
    onMeta,
    onData,
    onProgress,
    onFileStart,
    onFileEnd,
    onComplete,
    onError,
    onDisconnect,
    onCancel
  } = opts;
  if (!code) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "No sharing code was provided." });
  }
  if (!Peer) {
    throw new DropgateError({
      code: "INVALID_ARGUMENT",
      message: "PeerJS Peer constructor is required. Install peerjs and pass it as the Peer option."
    });
  }
  const p2pCaps = serverInfo?.capabilities?.p2p;
  if (serverInfo && !p2pCaps?.enabled) throw directTransferDisabled();
  const normalizedCode = String(code).trim().replace(/\s+/g, "").toUpperCase();
  if (!isP2PCodeLike(normalizedCode)) {
    throw new DropgateError({ code: "INVALID_CODE", message: "Invalid direct transfer code." });
  }
  const { path: finalPath, iceServers: finalIceServers } = resolvePeerConfig(
    { peerjsPath, iceServers },
    p2pCaps
  );
  const peerOpts = buildPeerOptions({
    host,
    port,
    peerjsPath: finalPath,
    secure,
    iceServers: finalIceServers
  });
  const peer = new Peer(void 0, peerOpts);
  let state = "initializing";
  let total = 0;
  let received = 0;
  let currentSessionId = null;
  let writeQueue = Promise.resolve();
  let watchdogTimer = null;
  let activeConn = null;
  let pendingChunk = null;
  let fileList = null;
  let currentFileReceived = 0;
  let totalReceivedAllFiles = 0;
  let expectedChunkSeq = 0;
  let writeQueueDepth = 0;
  const MAX_WRITE_QUEUE_DEPTH = 100;
  const MAX_FILE_COUNT = 1e4;
  let lastSenderActivityMs = 0;
  const transitionTo = (newState) => {
    if (!ALLOWED_TRANSITIONS2[state].includes(newState)) {
      console.warn(`[P2P Receive] Invalid state transition: ${state} -> ${newState}`);
      return false;
    }
    state = newState;
    return true;
  };
  const isStopped = () => state === "closed" || state === "cancelled";
  const resetWatchdog = () => {
    if (watchdogTimeoutMs <= 0) return;
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
    }
    watchdogTimer = setTimeout(() => {
      if (state === "transferring") {
        const sinceActivity = Date.now() - lastSenderActivityMs;
        if (sinceActivity < 1e4) {
          safeError(new DropgateError({
            code: "CONNECTION_LOST",
            message: "Connection is too unstable. Sender is reachable but file data has stopped arriving."
          }));
        } else {
          safeError(new DropgateError({
            code: "CONNECTION_LOST",
            message: "Sender stopped responding. No file data or heartbeats received for over " + watchdogTimeoutMs + " ms."
          }));
        }
      }
    }, watchdogTimeoutMs);
  };
  const clearWatchdog = () => {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };
  const safeError = (err) => {
    if (state === "closed" || state === "completed" || state === "cancelled") return;
    transitionTo("closed");
    onError?.(err);
    cleanup();
  };
  const safeComplete = (completeData) => {
    if (state !== "transferring") return;
    transitionTo("completed");
    onComplete?.(completeData);
  };
  const cleanup = () => {
    clearWatchdog();
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", handleUnload);
    }
    try {
      peer.destroy();
    } catch {
    }
  };
  const handleUnload = () => {
    try {
      activeConn?.send({ t: "error", message: "Receiver closed the connection." });
    } catch {
    }
    stop();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", handleUnload);
  }
  const stop = () => {
    if (state === "closed" || state === "cancelled") return;
    if (state === "completed") {
      cleanup();
      return;
    }
    const wasActive = state === "transferring";
    transitionTo("cancelled");
    try {
      if (activeConn && activeConn.open) {
        activeConn.send({ t: "cancelled", reason: "Receiver cancelled the transfer." });
      }
    } catch {
    }
    if (wasActive && onCancel) {
      onCancel({ cancelledBy: "receiver" });
    }
    cleanup();
  };
  const sendChunkAck = (conn, seq) => {
    try {
      conn.send({ t: "chunk_ack", seq, received });
    } catch {
    }
  };
  peer.on("error", (err) => {
    safeError(err);
  });
  peer.on("open", () => {
    transitionTo("connecting");
    const conn = peer.connect(normalizedCode, { reliable: true });
    activeConn = conn;
    conn.on("open", () => {
      transitionTo("handshaking");
      onStatus?.({ phase: "connected", message: "Connected." });
      conn.send({
        t: "hello",
        protocolVersion: P2P_PROTOCOL_VERSION,
        sessionId: ""
      });
    });
    conn.on("data", async (data) => {
      lastSenderActivityMs = Date.now();
      try {
        if (data instanceof ArrayBuffer || ArrayBuffer.isView(data) || typeof Blob !== "undefined" && data instanceof Blob) {
          if (state !== "transferring") {
            throw new DropgateError({
              code: "INTEGRITY_FAILED",
              origin: "peer",
              message: "Received binary data before transfer was accepted. Possible malicious sender."
            });
          }
          resetWatchdog();
          if (writeQueueDepth >= MAX_WRITE_QUEUE_DEPTH) {
            throw new DropgateError({ code: "OUTPUT_WRITE_FAILED", message: "Write queue overflow - receiver cannot keep up" });
          }
          let bufPromise;
          if (data instanceof ArrayBuffer) {
            bufPromise = Promise.resolve(new Uint8Array(data));
          } else if (ArrayBuffer.isView(data)) {
            bufPromise = Promise.resolve(
              new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            );
          } else if (typeof Blob !== "undefined" && data instanceof Blob) {
            bufPromise = data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
          } else {
            return;
          }
          const chunkSeq = pendingChunk?.seq ?? -1;
          const expectedSize = pendingChunk?.size;
          pendingChunk = null;
          writeQueueDepth++;
          writeQueue = writeQueue.then(async () => {
            const buf = await bufPromise;
            if (expectedSize !== void 0 && buf.byteLength !== expectedSize) {
              throw new DropgateError({
                code: "INTEGRITY_FAILED",
                origin: "peer",
                message: `Chunk size mismatch: expected ${expectedSize}, got ${buf.byteLength}`
              });
            }
            const newReceived = received + buf.byteLength;
            if (total > 0 && newReceived > total) {
              throw new DropgateError({
                code: "INTEGRITY_FAILED",
                origin: "peer",
                message: `Received more data than expected: ${newReceived} > ${total}`
              });
            }
            if (onData) {
              await onData(buf);
            }
            received += buf.byteLength;
            currentFileReceived += buf.byteLength;
            const progressReceived = fileList ? totalReceivedAllFiles + currentFileReceived : received;
            const progressTotal = fileList ? fileList.totalSize : total;
            const percent = progressTotal ? Math.min(100, progressReceived / progressTotal * 100) : 0;
            if (!isStopped()) onProgress?.({ processedBytes: progressReceived, totalBytes: progressTotal, percent });
            if (chunkSeq >= 0) {
              sendChunkAck(conn, chunkSeq);
            }
          }).catch((err) => {
            try {
              conn.send({
                t: "error",
                message: err?.message || "Receiver write failed."
              });
            } catch {
            }
            safeError(err);
          }).finally(() => {
            writeQueueDepth--;
          });
          return;
        }
        if (!isP2PMessage(data)) return;
        const msg = data;
        switch (msg.t) {
          case "hello":
            currentSessionId = msg.sessionId || null;
            transitionTo("negotiating");
            onStatus?.({ phase: "waiting", message: "Waiting for file details..." });
            break;
          case "file_list": {
            const fileListMsg = msg;
            if (fileListMsg.fileCount > MAX_FILE_COUNT) {
              throw new DropgateError({ code: "INVALID_MANIFEST", message: `Too many files: ${fileListMsg.fileCount}` });
            }
            const sumSize = fileListMsg.files.reduce((sum, f) => sum + f.size, 0);
            if (sumSize !== fileListMsg.totalSize) {
              throw new DropgateError({
                code: "INVALID_MANIFEST",
                message: `File list size mismatch: declared ${fileListMsg.totalSize}, actual sum ${sumSize}`
              });
            }
            fileListMsg.files.forEach((f, index) => validateFilename(f.name, { index, origin: "peer" }));
            fileList = fileListMsg;
            total = fileListMsg.totalSize;
            break;
          }
          case "meta": {
            if (state !== "negotiating" && !(state === "transferring" && fileList)) {
              return;
            }
            if (currentSessionId && msg.sessionId && msg.sessionId !== currentSessionId) {
              try {
                conn.send({ t: "error", message: "Busy with another session." });
              } catch {
              }
              return;
            }
            if (msg.sessionId) {
              currentSessionId = msg.sessionId;
            }
            const name = String(msg.name || "file");
            const fileSize = Number(msg.size) || 0;
            const fi = msg.fileIndex;
            validateFilename(name, { origin: "peer", ...typeof fi === "number" ? { index: fi } : {} });
            if (fileList && typeof fi === "number" && fi > 0) {
              currentFileReceived = 0;
              onFileStart?.({ fileIndex: fi, name, size: fileSize });
              break;
            }
            received = 0;
            currentFileReceived = 0;
            totalReceivedAllFiles = 0;
            if (!fileList) {
              total = fileSize;
            }
            writeQueue = Promise.resolve();
            const sendReady = () => {
              transitionTo("transferring");
              resetWatchdog();
              if (fileList) {
                onFileStart?.({ fileIndex: 0, name, size: fileSize });
              }
              try {
                conn.send({ t: "ready" });
              } catch {
              }
            };
            const metaEvt = { name, total };
            if (fileList) {
              metaEvt.fileCount = fileList.fileCount;
              metaEvt.files = fileList.files.map((f) => ({ name: f.name, size: f.size }));
              metaEvt.totalSize = fileList.totalSize;
            }
            if (autoReady) {
              if (!isStopped()) {
                onMeta?.(metaEvt);
                onProgress?.({ processedBytes: received, totalBytes: total, percent: 0 });
              }
              sendReady();
            } else {
              metaEvt.sendReady = sendReady;
              if (!isStopped()) {
                onMeta?.(metaEvt);
                onProgress?.({ processedBytes: received, totalBytes: total, percent: 0 });
              }
            }
            break;
          }
          case "chunk": {
            const chunkMsg = msg;
            if (state !== "transferring") {
              throw new DropgateError({
                code: "INTEGRITY_FAILED",
                origin: "peer",
                message: "Received chunk message before transfer was accepted."
              });
            }
            if (chunkMsg.seq !== expectedChunkSeq) {
              throw new DropgateError({
                code: "INTEGRITY_FAILED",
                origin: "peer",
                message: `Chunk sequence error: expected ${expectedChunkSeq}, got ${chunkMsg.seq}`
              });
            }
            expectedChunkSeq++;
            pendingChunk = chunkMsg;
            break;
          }
          case "ping":
            try {
              conn.send({ t: "pong", timestamp: Date.now() });
            } catch {
            }
            break;
          case "file_end": {
            clearWatchdog();
            await writeQueue;
            const feIdx = msg.fileIndex;
            onFileEnd?.({ fileIndex: feIdx, receivedBytes: currentFileReceived });
            try {
              conn.send({ t: "file_end_ack", fileIndex: feIdx, received: currentFileReceived, size: currentFileReceived });
            } catch {
            }
            totalReceivedAllFiles += currentFileReceived;
            currentFileReceived = 0;
            resetWatchdog();
            break;
          }
          case "end":
            clearWatchdog();
            await writeQueue;
            const finalReceived = fileList ? totalReceivedAllFiles + currentFileReceived : received;
            const finalTotal = fileList ? fileList.totalSize : total;
            if (finalTotal && finalReceived < finalTotal) {
              const err = new DropgateError({
                code: "CONNECTION_LOST",
                message: "Transfer ended before all data was received."
              });
              try {
                conn.send({ t: "error", message: err.message });
              } catch {
              }
              throw err;
            }
            try {
              conn.send({ t: "end_ack", received: finalReceived, total: finalTotal });
            } catch {
            }
            safeComplete({ received: finalReceived, total: finalTotal });
            (async () => {
              for (let i = 0; i < 2; i++) {
                await sleep(P2P_END_ACK_RETRY_DELAY_MS);
                try {
                  conn.send({ t: "end_ack", received: finalReceived, total: finalTotal });
                } catch {
                  break;
                }
              }
            })().catch(() => {
            });
            break;
          case "error":
            throw new DropgateError({ code: "PEER_FAILED", message: "The sender reported an error." });
          case "cancelled":
            if (state === "cancelled" || state === "closed" || state === "completed") return;
            transitionTo("cancelled");
            onCancel?.({ cancelledBy: "sender" });
            cleanup();
            break;
        }
      } catch (err) {
        safeError(err);
      }
    });
    conn.on("close", () => {
      if (state === "closed" || state === "completed" || state === "cancelled") {
        cleanup();
        return;
      }
      if (state === "transferring") {
        transitionTo("cancelled");
        onCancel?.({ cancelledBy: "sender" });
        cleanup();
      } else if (state === "negotiating") {
        transitionTo("closed");
        cleanup();
        onDisconnect?.();
      } else {
        safeError(new DropgateError({ code: "CONNECTION_LOST", message: "Sender disconnected before file details were received." }));
      }
    });
  });
  return {
    peer,
    stop,
    getStatus: () => state,
    getBytesReceived: () => received,
    getTotalBytes: () => total,
    getSessionId: () => currentSessionId
  };
}

// src/zip/crc32.ts
var TABLES = (() => {
  const tables = new Int32Array(256 * 8);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    tables[n] = c;
  }
  for (let n = 0; n < 256; n++) {
    let c = tables[n];
    for (let t = 1; t < 8; t++) {
      c = tables[c & 255] ^ c >>> 8;
      tables[t * 256 + n] = c;
    }
  }
  return tables;
})();
var T0 = TABLES.subarray(0, 256);
var T1 = TABLES.subarray(256, 512);
var T2 = TABLES.subarray(512, 768);
var T3 = TABLES.subarray(768, 1024);
var T4 = TABLES.subarray(1024, 1280);
var T5 = TABLES.subarray(1280, 1536);
var T6 = TABLES.subarray(1536, 1792);
var T7 = TABLES.subarray(1792, 2048);
function crc32(data, crc = 0) {
  let c = ~crc;
  const n = data.length;
  let i = 0;
  for (const end = n - n % 8; i < end; i += 8) {
    const lo = c ^ (data[i] | data[i + 1] << 8 | data[i + 2] << 16 | data[i + 3] << 24);
    c = T7[lo & 255] ^ T6[lo >>> 8 & 255] ^ T5[lo >>> 16 & 255] ^ T4[lo >>> 24] ^ T3[data[i + 4]] ^ T2[data[i + 5]] ^ T1[data[i + 6]] ^ T0[data[i + 7]];
  }
  for (; i < n; i++) c = T0[(c ^ data[i]) & 255] ^ c >>> 8;
  return ~c >>> 0;
}

// src/zip/stream-zip.ts
var LOCAL_HEADER = 67324752;
var DATA_DESCRIPTOR = 134695760;
var CENTRAL_HEADER = 33639248;
var ZIP64_END = 101075792;
var ZIP64_LOCATOR = 117853008;
var END = 101010256;
var FLAGS = 2056;
var VERSION_CLASSIC = 20;
var VERSION_ZIP64 = 45;
var MAX_32 = 4294967295;
var MAX_16 = 65535;
var ZIP64_EXTRA = 1;
var DIRECTORY_CHUNK = 64 * 1024;
var utf8 = new TextEncoder();
var Bytes = class {
  constructor(length) {
    __publicField(this, "bytes");
    __publicField(this, "view");
    __publicField(this, "at", 0);
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }
  u16(value) {
    this.view.setUint16(this.at, value, true);
    this.at += 2;
    return this;
  }
  u32(value) {
    this.view.setUint32(this.at, value >>> 0, true);
    this.at += 4;
    return this;
  }
  u64(value) {
    this.view.setBigUint64(this.at, BigInt(value), true);
    this.at += 8;
    return this;
  }
  raw(value) {
    this.bytes.set(value, this.at);
    this.at += value.length;
    return this;
  }
};
function dosDateTime(when) {
  const year = when.getFullYear();
  if (year < 1980) return { time: 0, date: 1 << 5 | 1 };
  return {
    time: when.getHours() << 11 | when.getMinutes() << 5 | when.getSeconds() >> 1,
    date: Math.min(year, 2107) - 1980 << 9 | when.getMonth() + 1 << 5 | when.getDate()
  };
}
function refused(message) {
  return new DropgateError({ code: "INVALID_ARGUMENT", message });
}
var StreamingZipWriter = class {
  constructor(onData) {
    __publicField(this, "onData");
    __publicField(this, "time");
    __publicField(this, "date");
    __publicField(this, "members", []);
    /** The names stored so far, lower-cased, as `filenames.unique()` compares them. */
    __publicField(this, "taken", /* @__PURE__ */ new Set());
    __publicField(this, "current", null);
    __publicField(this, "offset", 0);
    __publicField(this, "finalized", false);
    __publicField(this, "pendingWrites", Promise.resolve());
    __publicField(this, "failed", null);
    this.onData = onData;
    ({ time: this.time, date: this.date } = dosDateTime(/* @__PURE__ */ new Date()));
  }
  /**
   * Begins a member, `size` bytes long. Its name is made safe with
   * `filenames.sanitize()` and, if an earlier member has it, unique with
   * `filenames.unique()`. Must call endFile() before starting another file.
   * @param name - The file's name.
   * @param size - Exactly how many bytes will be written to it.
   * @returns The name it's stored under.
   * @throws {DropgateError} INVALID_ARGUMENT if a file is still open, the
   * archive is finalized, or the size isn't a whole number of bytes.
   */
  startFile(name, size) {
    this.usable();
    if (this.current) throw refused("Must call endFile() before starting a new file.");
    if (!Number.isSafeInteger(size) || size < 0) {
      throw refused("A ZIP member's size must be a whole number of bytes, 0 or more.");
    }
    const stored = uniqueFilename(sanitizeFilename(name), (n) => this.taken.has(n.toLowerCase()));
    this.taken.add(stored.toLowerCase());
    const nameBytes = utf8.encode(stored);
    const zip64 = size >= MAX_32;
    const header = new Bytes(30 + nameBytes.length + (zip64 ? 20 : 0)).u32(LOCAL_HEADER).u16(zip64 ? VERSION_ZIP64 : VERSION_CLASSIC).u16(FLAGS).u16(0).u16(this.time).u16(this.date).u32(0).u32(zip64 ? MAX_32 : 0).u32(zip64 ? MAX_32 : 0).u16(nameBytes.length).u16(zip64 ? 20 : 0).raw(nameBytes);
    if (zip64) header.u16(ZIP64_EXTRA).u16(16).u64(0).u64(0);
    this.current = { name: nameBytes, size, crc: 0, offset: this.offset, written: 0 };
    this.emit(header.bytes);
    return stored;
  }
  /**
   * Writes the next bytes of the current member.
   * @param data - The data chunk to write.
   * @throws {DropgateError} INVALID_ARGUMENT if no file is started, or the
   * bytes would take the member past the size it was started with.
   */
  writeChunk(data) {
    this.usable();
    const member = this.current;
    if (!member) throw refused("No file started. Call startFile() first.");
    if (member.written + data.byteLength > member.size) {
      throw this.fail(refused("More bytes were written to a ZIP member than its size."));
    }
    if (data.byteLength === 0) return;
    member.crc = crc32(data, member.crc);
    member.written += data.byteLength;
    this.emit(data);
  }
  /**
   * Ends the current member, with its data descriptor.
   * @throws {DropgateError} INVALID_ARGUMENT if no file is started, or fewer
   * bytes were written to it than its size.
   */
  endFile() {
    this.usable();
    const member = this.current;
    if (!member) throw refused("No file to end.");
    if (member.written !== member.size) {
      throw this.fail(refused("Fewer bytes were written to a ZIP member than its size."));
    }
    const zip64 = member.size >= MAX_32;
    const descriptor = new Bytes(zip64 ? 24 : 16).u32(DATA_DESCRIPTOR).u32(member.crc);
    if (zip64) descriptor.u64(member.size).u64(member.size);
    else descriptor.u32(member.size).u32(member.size);
    this.current = null;
    this.members.push({ name: member.name, size: member.size, crc: member.crc, offset: member.offset });
    this.emit(descriptor.bytes);
  }
  /** Waits until `onData` has taken everything written so far. Throws its error if it failed. */
  async drained() {
    await this.pendingWrites;
    if (this.failed) throw this.failed.error;
  }
  /**
   * Finalize the ZIP archive: writes the central directory and the end
   * records, then waits for `onData` to take them. Must be called after all
   * files are written.
   * @throws {DropgateError} INVALID_ARGUMENT if a file is still open.
   */
  async finalize() {
    if (this.failed) throw this.failed.error;
    if (this.current) throw refused("Cannot finalize with an open file. Call endFile() first.");
    if (!this.finalized) {
      this.finalized = true;
      this.writeDirectory();
    }
    await this.drained();
  }
  writeDirectory() {
    const directoryOffset = this.offset;
    let zip64 = this.members.length >= MAX_16 || directoryOffset >= MAX_32;
    let gathered = [];
    let gatheredLength = 0;
    const flush = () => {
      if (gatheredLength === 0) return;
      const chunk = new Uint8Array(gatheredLength);
      let at = 0;
      for (const part of gathered) {
        chunk.set(part, at);
        at += part.length;
      }
      gathered = [];
      gatheredLength = 0;
      this.emit(chunk);
    };
    for (const member of this.members) {
      const bigSize = member.size >= MAX_32;
      const bigOffset = member.offset >= MAX_32;
      const extraLength = (bigSize ? 16 : 0) + (bigOffset ? 8 : 0);
      const version = extraLength ? VERSION_ZIP64 : VERSION_CLASSIC;
      if (extraLength) zip64 = true;
      const record = new Bytes(46 + member.name.length + (extraLength ? 4 + extraLength : 0)).u32(CENTRAL_HEADER).u16(version).u16(version).u16(FLAGS).u16(0).u16(this.time).u16(this.date).u32(member.crc).u32(bigSize ? MAX_32 : member.size).u32(bigSize ? MAX_32 : member.size).u16(member.name.length).u16(extraLength ? 4 + extraLength : 0).u16(0).u16(0).u16(0).u32(0).u32(bigOffset ? MAX_32 : member.offset).raw(member.name);
      if (extraLength) {
        record.u16(ZIP64_EXTRA).u16(extraLength);
        if (bigSize) record.u64(member.size).u64(member.size);
        if (bigOffset) record.u64(member.offset);
      }
      gathered.push(record.bytes);
      gatheredLength += record.bytes.length;
      if (gatheredLength >= DIRECTORY_CHUNK) flush();
    }
    const directorySize = this.offset + gatheredLength - directoryOffset;
    if (directorySize >= MAX_32) zip64 = true;
    const count = this.members.length;
    if (zip64) {
      const recordOffset = this.offset + gatheredLength;
      const end64 = new Bytes(56 + 20).u32(ZIP64_END).u64(44).u16(VERSION_ZIP64).u16(VERSION_ZIP64).u32(0).u32(0).u64(count).u64(count).u64(directorySize).u64(directoryOffset).u32(ZIP64_LOCATOR).u32(0).u64(recordOffset).u32(1);
      gathered.push(end64.bytes);
      gatheredLength += end64.bytes.length;
    }
    const end = new Bytes(22).u32(END).u16(0).u16(0).u16(Math.min(count, MAX_16)).u16(Math.min(count, MAX_16)).u32(Math.min(directorySize, MAX_32)).u32(Math.min(directoryOffset, MAX_32)).u16(0);
    gathered.push(end.bytes);
    gatheredLength += end.bytes.length;
    flush();
  }
  usable() {
    if (this.failed) throw this.failed.error;
    if (this.finalized) throw refused("ZIP has already been finalized.");
  }
  /** Stops the archive: nothing more goes to `onData`, and every call after throws `error`. */
  fail(error) {
    this.failed ?? (this.failed = { error });
    return error;
  }
  emit(chunk) {
    this.offset += chunk.byteLength;
    this.pendingWrites = this.pendingWrites.then(() => this.failed ? void 0 : this.onData(chunk)).catch((error) => {
      this.failed ?? (this.failed = { error });
    });
  }
};

// src/object/header.ts
var MAGIC = [68, 71, 85, 80];
var DGUP_VERSION = 4;
var SUITE = 1;
var SALT_BYTES = 16;
var SIGNED_BYTES = 28;
var integrity = (message) => new DropgateError({ code: "INTEGRITY_FAILED", message });
var unreadable = () => new DropgateError({
  code: "VERSION_UNSUPPORTED",
  message: "This upload was made in a format this version of Dropgate can't read."
});
function headerFields(chunkSize, salt) {
  if (!isChunkSize(chunkSize)) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A chunk size is from 64 KiB to 64 MiB." });
  }
  if (salt.byteLength !== SALT_BYTES) throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A salt is 16 bytes." });
  const fields = new Uint8Array(SIGNED_BYTES);
  fields.set(MAGIC, 0);
  fields[4] = DGUP_VERSION;
  fields[5] = SUITE;
  new DataView(fields.buffer).setUint32(8, chunkSize, false);
  fields.set(salt, 12);
  return fields;
}
function parseHeader(bytes) {
  if (bytes.byteLength !== HEADER_BYTES) throw integrity("The object's header isn't 60 bytes.");
  if (MAGIC.some((byte, i) => bytes[i] !== byte)) throw integrity("This isn't a Dropgate object.");
  if (bytes[4] !== DGUP_VERSION) throw unreadable();
  if (bytes[5] !== SUITE) throw unreadable();
  if (bytes[6] !== 0 || bytes[7] !== 0) throw integrity("The object's header has reserved bytes set.");
  const chunkSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, false);
  if (chunkSize < MIN_CHUNK_SIZE || chunkSize > MAX_CHUNK_SIZE) throw integrity("The object's chunk size is out of range.");
  return Object.freeze({
    chunkSize,
    salt: bytes.slice(12, 12 + SALT_BYTES),
    signed: bytes.slice(0, SIGNED_BYTES),
    mac: bytes.slice(SIGNED_BYTES, HEADER_BYTES)
  });
}

// src/object/keys.ts
var SECRET_BYTES = 32;
var INFO = {
  header: "dropgate/4 header",
  payload: "dropgate/4 payload",
  meta: "dropgate/4 meta"
};
async function deriveObjectKeys(provider, secret, salt) {
  if (secret.byteLength !== SECRET_BYTES) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A link's secret is 32 bytes." });
  }
  const info = (label) => new TextEncoder().encode(label);
  const [header, payload, meta] = await Promise.all([
    provider.deriveMacKey(secret, salt, info(INFO.header)),
    provider.deriveContentKey(secret, salt, info(INFO.payload)),
    provider.deriveContentKey(secret, salt, info(INFO.meta))
  ]);
  return Object.freeze({ header, payload, meta });
}

// src/object/stream.ts
function chunkNonce(index, last) {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A chunk index is a whole number from 0." });
  }
  const nonce = new Uint8Array(12);
  let rest = index;
  for (let i = 10; rest > 0; i--) {
    nonce[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  nonce[11] = last ? 1 : 0;
  return nonce;
}
var integrity2 = (message, cause) => new DropgateError({ code: "INTEGRITY_FAILED", message, ...cause === void 0 ? {} : { cause } });
var _provider3, _key, _layout, _sealed, _kept;
var ChunkSealer = class {
  constructor(provider, payloadKey, layout) {
    __privateAdd(this, _provider3);
    __privateAdd(this, _key);
    __privateAdd(this, _layout);
    __privateAdd(this, _sealed);
    __privateAdd(this, _kept, /* @__PURE__ */ new Map());
    __privateSet(this, _provider3, provider);
    __privateSet(this, _key, payloadKey);
    __privateSet(this, _layout, layout);
    __privateSet(this, _sealed, new Uint8Array(Math.ceil(layout.chunkCount / 8)));
  }
  /** Whether chunk `index` has been sealed. */
  isSealed(index) {
    return (__privateGet(this, _sealed)[index >> 3] & 1 << (index & 7)) !== 0;
  }
  /**
   * Seals chunk `index`, the first and only time, from exactly its plaintext
   * (padding included), and keeps the result until `confirm(index)`.
   * @throws {DropgateError} ENCRYPT_FAILED if it was sealed before, or can't be.
   */
  async seal(index, plaintext) {
    const length = __privateGet(this, _layout).chunkLength(index);
    if (plaintext.byteLength !== length) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: `Chunk ${index} is ${length} bytes.` });
    }
    if (this.isSealed(index)) {
      throw new DropgateError({ code: "ENCRYPT_FAILED", message: `Chunk ${index} was sealed already, and a chunk is never sealed twice.` });
    }
    __privateGet(this, _sealed)[index >> 3] |= 1 << (index & 7);
    let sealed;
    try {
      sealed = await __privateGet(this, _provider3).encryptWithNonce(__privateGet(this, _key), chunkNonce(index, __privateGet(this, _layout).isLast(index)), plaintext);
    } catch (err) {
      throw new DropgateError({ code: "ENCRYPT_FAILED", cause: err });
    }
    __privateGet(this, _kept).set(index, sealed);
    return sealed;
  }
  /** Chunk `index`'s sealed bytes, kept since it was sealed until the server has it, to send again. */
  kept(index) {
    return __privateGet(this, _kept).get(index);
  }
  /** The server has chunk `index`: its sealed bytes needn't be kept. */
  confirm(index) {
    __privateGet(this, _kept).delete(index);
  }
};
_provider3 = new WeakMap();
_key = new WeakMap();
_layout = new WeakMap();
_sealed = new WeakMap();
_kept = new WeakMap();
var _provider4, _key2, _layout2, _last, _next;
var ChunkOpener = class {
  constructor(provider, payloadKey, layout, first = 0, last = layout.chunkCount - 1) {
    __privateAdd(this, _provider4);
    __privateAdd(this, _key2);
    __privateAdd(this, _layout2);
    __privateAdd(this, _last);
    __privateAdd(this, _next);
    layout.range(first, last);
    __privateSet(this, _provider4, provider);
    __privateSet(this, _key2, payloadKey);
    __privateSet(this, _layout2, layout);
    __privateSet(this, _next, first);
    __privateSet(this, _last, last);
  }
  /** The index of the chunk expected next. */
  get next() {
    return __privateGet(this, _next);
  }
  /** The stored length of the chunk expected next, or 0 once every chunk is open. */
  get nextLength() {
    if (__privateGet(this, _next) > __privateGet(this, _last)) return 0;
    const { start, end } = __privateGet(this, _layout2).chunkBytes(__privateGet(this, _next));
    return end - start;
  }
  /** Whether every chunk in the run has been opened. */
  get done() {
    return __privateGet(this, _next) > __privateGet(this, _last);
  }
  /**
   * Opens the next chunk.
   * @throws {DropgateError} INTEGRITY_FAILED if it's out of order, after the
   * run's end, the wrong length, or doesn't open (changed, moved, repeated,
   * from another object, or flagged last when it isn't, or not when it is).
   */
  async open(index, sealed) {
    if (this.done) throw integrity2("Data came after the last chunk.");
    if (index !== __privateGet(this, _next)) throw integrity2("A chunk came out of order.");
    if (sealed.byteLength !== this.nextLength) throw integrity2("A chunk is the wrong length.");
    let plaintext;
    try {
      plaintext = await __privateGet(this, _provider4).decryptWithNonce(__privateGet(this, _key2), chunkNonce(index, __privateGet(this, _layout2).isLast(index)), sealed);
    } catch (err) {
      throw integrity2("A chunk didn't pass its integrity check.", err);
    }
    __privateWrapper(this, _next)._++;
    return plaintext;
  }
  /**
   * The run is over: nothing more comes.
   * @throws {DropgateError} INTEGRITY_FAILED if it ended before its last chunk.
   */
  finish() {
    if (!this.done) throw integrity2("The data ended before its last chunk.");
  }
};
_provider4 = new WeakMap();
_key2 = new WeakMap();
_layout2 = new WeakMap();
_last = new WeakMap();
_next = new WeakMap();
async function* openChunks(opener, bytes) {
  let pending = [];
  let head = 0;
  let pendingLength = 0;
  const take = (length) => {
    const out = new Uint8Array(length);
    let at = 0;
    while (at < length) {
      const piece = pending[head];
      const used = Math.min(piece.byteLength, length - at);
      out.set(piece.subarray(0, used), at);
      at += used;
      if (used === piece.byteLength) head++;
      else pending[head] = piece.subarray(used);
    }
    pending = pending.slice(head);
    head = 0;
    pendingLength -= length;
    return out;
  };
  for await (const piece of bytes) {
    if (piece.byteLength === 0) continue;
    if (opener.done) throw integrity2("Data came after the last chunk.");
    pending.push(piece);
    pendingLength += piece.byteLength;
    while (!opener.done && pendingLength >= opener.nextLength) {
      const index = opener.next;
      yield { index, plaintext: await opener.open(index, take(opener.nextLength)) };
    }
    if (opener.done && pendingLength > 0) throw integrity2("Data came after the last chunk.");
  }
  opener.finish();
}

// src/object/manifest.ts
var MAX_FILES = 1e3;
var MIN_BUCKET = 4 * 1024;
var MAX_BUCKET = 1024 * 1024;
var LENGTH_BYTES = 4;
function bucketFor(length) {
  let bucket = MIN_BUCKET;
  while (bucket < length) bucket *= 2;
  if (bucket > MAX_BUCKET) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "The list of files is over 1 MiB." });
  }
  return bucket;
}
function checkFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: `An upload holds 1 to ${MAX_FILES} files.` });
  }
  files.forEach((file, index) => {
    validateFilename(file?.name, { index });
    if (file.size === 0) throw new DropgateError({ code: "FILE_EMPTY", details: { index } });
    if (!Number.isSafeInteger(file.size) || file.size < 1) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A file's size is a whole number of bytes.", details: { index } });
    }
  });
}
function encodeManifest(files) {
  checkFiles(files);
  const json = new TextEncoder().encode(JSON.stringify({ files: files.map(({ name, size }) => ({ name, size })) }));
  const padded = new Uint8Array(bucketFor(LENGTH_BYTES + json.byteLength));
  new DataView(padded.buffer).setUint32(0, json.byteLength, false);
  padded.set(json, LENGTH_BYTES);
  return padded;
}
var broken = (message) => new DropgateError({ code: "INTEGRITY_FAILED", message });
function decodeManifest(padded) {
  if (padded.byteLength < LENGTH_BYTES) throw broken("The list of files didn't parse.");
  const length = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0, false);
  if (length > padded.byteLength - LENGTH_BYTES) throw broken("The list of files didn't parse.");
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(padded.subarray(LENGTH_BYTES, LENGTH_BYTES + length)));
  } catch {
    throw broken("The list of files didn't parse.");
  }
  const files = parsed?.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) throw broken("The list of files didn't parse.");
  return files.map((file, index) => {
    const { name, size } = file ?? {};
    if (typeof name !== "string" || typeof size !== "number" || !Number.isSafeInteger(size) || size < 1) {
      throw broken("The list of files didn't parse.");
    }
    validateFilename(name, { index, origin: "server" });
    return Object.freeze({ name, size });
  });
}
async function sealMeta(provider, metaKey, padded) {
  const nonce = provider.randomBytes(AES_GCM_IV_BYTES);
  const sealed = await provider.encryptWithNonce(metaKey, nonce, padded);
  const meta = new Uint8Array(nonce.byteLength + sealed.byteLength);
  meta.set(nonce);
  meta.set(sealed, nonce.byteLength);
  return meta;
}
async function openMeta(provider, metaKey, meta) {
  if (meta.byteLength < AES_GCM_IV_BYTES) throw broken("The list of files didn't parse.");
  return provider.decryptWithNonce(metaKey, meta.subarray(0, AES_GCM_IV_BYTES), meta.subarray(AES_GCM_IV_BYTES));
}

// src/object/object.ts
var withOffsets = (files) => {
  let offset = 0;
  return files.map(({ name, size }) => {
    const file = Object.freeze({ name, size, offset });
    offset += size;
    return file;
  });
};
var hidden = "[DropgateObject]";
var _secret, _sealer;
var ObjectWriter = class {
  /** @internal Made by `createObject()`. */
  constructor(parts) {
    __publicField(this, "header");
    __publicField(this, "meta");
    __publicField(this, "layout");
    __publicField(this, "files");
    __privateAdd(this, _secret);
    __privateAdd(this, _sealer);
    __privateSet(this, _secret, parts.secret);
    __privateSet(this, _sealer, parts.sealer);
    this.header = parts.header;
    this.meta = parts.meta;
    this.layout = parts.layout;
    this.files = Object.freeze(parts.files);
    Object.freeze(this);
  }
  /** The link's secret: a copy, for the link alone. */
  secret() {
    return __privateGet(this, _secret).slice();
  }
  /** Where chunk `index`'s plaintext comes from: parts of the files, then zero bytes. */
  chunkParts(index) {
    return this.layout.chunkParts(index, this.files.map((file) => file.size));
  }
  /** Seals chunk `index` from its plaintext, once only (see `ChunkSealer`). */
  seal(index, plaintext) {
    return __privateGet(this, _sealer).seal(index, plaintext);
  }
  /** Chunk `index`'s sealed bytes, kept until `confirm(index)`, to send again unchanged. */
  kept(index) {
    return __privateGet(this, _sealer).kept(index);
  }
  /** The server has chunk `index`. */
  confirm(index) {
    __privateGet(this, _sealer).confirm(index);
  }
  /** Whether chunk `index` has been sealed. */
  isSealed(index) {
    return __privateGet(this, _sealer).isSealed(index);
  }
  toJSON() {
    return hidden;
  }
  toString() {
    return hidden;
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return hidden;
  }
};
_secret = new WeakMap();
_sealer = new WeakMap();
async function createObject(provider, opts) {
  checkFiles(opts.files);
  const length = opts.files.reduce((sum, file) => sum + file.size, 0);
  const layout = ObjectLayout.encrypted(paddedLength(length, opts.chunkSize, opts.maxBytes ?? 0), opts.chunkSize);
  const manifest = encodeManifest(opts.files);
  const secret = opts.secret ? opts.secret.slice() : provider.randomBytes(SECRET_BYTES);
  const salt = opts.salt ? opts.salt.slice() : provider.randomBytes(SALT_BYTES);
  const fields = headerFields(opts.chunkSize, salt);
  const keys = await deriveObjectKeys(provider, secret, salt);
  const mac = await provider.hmacSha256(keys.header, fields);
  const header = new Uint8Array(HEADER_BYTES);
  header.set(fields);
  header.set(mac, fields.byteLength);
  return new ObjectWriter({
    secret,
    header,
    meta: await sealMeta(provider, keys.meta, manifest),
    layout,
    files: withOffsets(opts.files),
    sealer: new ChunkSealer(provider, keys.payload, layout)
  });
}
var _provider5, _keys;
var OpenedObject = class {
  /** @internal Made by `openObject()`. */
  constructor(provider, keys, header, layout, files) {
    __publicField(this, "header");
    __publicField(this, "layout");
    __publicField(this, "files");
    /** The files' bytes added up: the plaintext before the padding. */
    __publicField(this, "totalSize");
    __privateAdd(this, _provider5);
    __privateAdd(this, _keys);
    __privateSet(this, _provider5, provider);
    __privateSet(this, _keys, keys);
    this.header = header;
    this.layout = layout;
    this.files = Object.freeze(files);
    this.totalSize = files.reduce((sum, file) => sum + file.size, 0);
    Object.freeze(this);
  }
  /** What file `index` needs: its chunks, one run of stored bytes, and how much of the first chunk to skip. */
  member(index) {
    const file = this.files[index];
    if (!file) throw new DropgateError({ code: "INVALID_ARGUMENT", message: "No file has that index." });
    return this.layout.span(file.offset, file.size);
  }
  /** An opener for chunks `first` to `last` (every chunk by default), in order. */
  opener(first = 0, last = this.layout.chunkCount - 1) {
    return new ChunkOpener(__privateGet(this, _provider5), __privateGet(this, _keys).payload, this.layout, first, last);
  }
  /**
   * Opens the stored bytes of chunks `first` to `last` (a member, or a resume
   * from the next whole chunk), giving each chunk's plaintext as it opens.
   */
  chunks(bytes, first = 0, last = this.layout.chunkCount - 1) {
    return openChunks(this.opener(first, last), bytes);
  }
  /**
   * Opens the whole stored object, header first, to the chunk marked last,
   * padding included, so nothing can have been cut off.
   * @throws {DropgateError} INTEGRITY_FAILED if its header isn't the one checked.
   */
  async *read(bytes) {
    const header = this.header;
    let seen = 0;
    async function* afterHeader() {
      for await (const piece of bytes) {
        const inHeader = Math.min(piece.byteLength, HEADER_BYTES - seen);
        for (let i = 0; i < inHeader; i++) {
          if (piece[i] !== header[seen + i]) {
            throw new DropgateError({ code: "INTEGRITY_FAILED", message: "The object's header isn't the one its metadata gave." });
          }
        }
        seen += inHeader;
        if (inHeader < piece.byteLength) yield piece.subarray(inHeader);
      }
      if (seen < HEADER_BYTES) throw new DropgateError({ code: "INTEGRITY_FAILED", message: "The data ended before its last chunk." });
    }
    yield* this.chunks(afterHeader());
  }
  toJSON() {
    return hidden;
  }
  toString() {
    return hidden;
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return hidden;
  }
};
_provider5 = new WeakMap();
_keys = new WeakMap();
async function openObject(provider, opts) {
  const parsed = parseHeader(opts.header);
  if (opts.secret.byteLength !== SECRET_BYTES) throw new DropgateError({ code: "DECRYPT_FAILED" });
  const keys = await deriveObjectKeys(provider, opts.secret, parsed.salt);
  const macMatches = await provider.verifyHmacSha256(keys.header, parsed.mac, parsed.signed);
  const manifest = await openMeta(provider, keys.meta, opts.meta).catch(() => void 0);
  if (!macMatches) {
    if (!manifest) throw new DropgateError({ code: "DECRYPT_FAILED" });
    throw new DropgateError({ code: "INTEGRITY_FAILED", message: "The object's header was changed." });
  }
  if (!manifest) throw new DropgateError({ code: "INTEGRITY_FAILED", message: "The list of files was changed." });
  const files = withOffsets(decodeManifest(manifest));
  const layout = ObjectLayout.fromStoredSize(opts.size, parsed.chunkSize);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > layout.length) {
    throw new DropgateError({ code: "INTEGRITY_FAILED", message: "The list of files doesn't fit the object." });
  }
  return new OpenedObject(provider, keys, opts.header.slice(), layout, files);
}

// src/client/DropgateClient.ts
function resolveServerToBaseUrl(server) {
  if (typeof server === "string") {
    return buildBaseUrl(parseServerUrl(server));
  }
  return buildBaseUrl(server);
}
function serverChunkSize(serverInfo, fallback) {
  const size = serverInfo?.capabilities?.upload?.chunkSize;
  return Number.isFinite(size) && size > 0 ? size : fallback;
}
var DIRECT_EVENTS = [
  "onStatus",
  "onProgress",
  "onMeta",
  "onComplete",
  "onCancel",
  "onConnectionHealth",
  "onFileStart",
  "onFileEnd",
  "onResumeRequest"
];
function protocolVersion(value) {
  if (!value || typeof value !== "object") return null;
  const { major, minor } = value;
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 0 || minor < 0) return null;
  return Object.freeze({ major, minor });
}
function checkProtocol(client, given) {
  const server = protocolVersion(given);
  if (!server || server.major < client.major) {
    return {
      compatible: false,
      client,
      server,
      update: "server",
      message: "Update required: this server runs an older version of Dropgate. Its operator needs to update it."
    };
  }
  if (server.major > client.major) {
    return {
      compatible: false,
      client,
      server,
      update: "client",
      message: "Update required: this server runs a newer version of Dropgate. Update this app to use it."
    };
  }
  return { compatible: true, client, server, message: "This server works with this version of Dropgate." };
}
var UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function hostedTarget(opts) {
  const { id } = opts ?? {};
  if (typeof id === "string" && id) return { id, secret: opts?.secret };
  throw new DropgateError({ code: "INVALID_ARGUMENT", message: "An upload id is required." });
}
function plainFiles(value, size) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) {
    throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's list of files wasn't understood." });
  }
  const files = value.map((file, index) => {
    const { name, size: fileSize } = file ?? {};
    if (typeof name !== "string" || typeof fileSize !== "number" || !Number.isSafeInteger(fileSize) || fileSize < 1) {
      throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's list of files wasn't understood." });
    }
    validateFilename(name, { index, origin: "server" });
    return { name, size: fileSize };
  });
  if (files.reduce((sum, file) => sum + file.size, 0) !== size) {
    throw new DropgateError({ code: "INTEGRITY_FAILED", message: "The list of files doesn't fit the upload." });
  }
  return files;
}
function chooseFiles(picked, count) {
  if (!picked) return Array.from({ length: count }, (_, i) => i);
  if (picked.some((i) => i >= count)) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "files names a file the upload doesn't have." });
  }
  return picked;
}
function droppedUpload(cause) {
  return new DropgateError({ code: "NOT_FOUND", status: cause.status, message: "The server dropped this upload.", cause });
}
function droppedPausedUpload(cause) {
  return new DropgateError({ code: "NOT_FOUND", status: cause?.status, message: "The server dropped this paused upload.", ...cause ? { cause } : {} });
}
function droppedDownload(paused, cause) {
  return new DropgateError({
    code: "NOT_FOUND",
    status: cause?.status,
    message: paused ? "The server dropped this paused download." : "The server dropped this download.",
    ...cause ? { cause } : {}
  });
}
function pauseLength(serverInfo) {
  const minutes = serverInfo?.capabilities?.upload?.maxPauseMinutes;
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1e3 : 0;
}
function pausedUntil(deadline, pauseMs) {
  if (typeof deadline !== "number" || !Number.isFinite(deadline)) {
    throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's answer to the pause wasn't understood." });
  }
  return Math.max(deadline, Date.now() + pauseMs);
}
function chunkRanges(value, count) {
  const valid = Array.isArray(value) && value.every((range) => Array.isArray(range) && range.length === 2 && Number.isSafeInteger(range[0]) && Number.isSafeInteger(range[1]) && range[0] >= 0 && range[0] <= range[1] && range[1] < count);
  if (!valid) throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's list of the chunks it holds wasn't understood." });
  return value;
}
function unreachableTooLong(cause) {
  if (cause.code === "NOT_FOUND") return cause;
  return new DropgateError({
    code: "NOT_FOUND",
    message: "The server dropped this upload: it couldn't be reached for longer than the server waits.",
    cause
  });
}
var LEASE_RENEW_MS = 2 * 60 * 1e3;
function untilAborted(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
function retryAfterMs(res, fallback) {
  const header = res.headers.get("Retry-After");
  const seconds = header === null || header.trim() === "" ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 60) * 1e3 : fallback;
}
var _auth;
var DropgateClient = class {
  /**
   * Create a new DropgateClient instance.
   * @param opts - Client configuration options including server URL.
   * @throws {DropgateError} INVALID_ARGUMENT if server is missing or invalid, or appInfo isn't
   * `{ name, version? }` strings; INSECURE_TRANSPORT_NOT_ALLOWED for a server on plain `http://`
   * on another machine without `allowInsecure`; RUNTIME_UNSUPPORTED if there's no fetch() or crypto.
   */
  constructor(opts) {
    /** The app using core, as given to the constructor, for display and local logs. Never sent anywhere. */
    __publicField(this, "appInfo");
    /** Chunk size in bytes for upload splitting. */
    __publicField(this, "chunkSize");
    /**
     * Fetch implementation used for HTTP requests. Every request it makes omits
     * credentials (no cookies), and follows no redirect.
     */
    __publicField(this, "fetchFn");
    /** Base64 encoder/decoder for binary data. */
    __publicField(this, "base64");
    /** Uploads to the server, and downloads from it. */
    __publicField(this, "hosted");
    /** Direct transfers, from one device to another. */
    __publicField(this, "direct");
    /** Sharing codes and links. */
    __publicField(this, "links");
    /** The server the client was made for. */
    __publicField(this, "server");
    /** What's running on the client, by each operation's ID. */
    __publicField(this, "operations");
    /** The server's base URL (e.g. 'https://dropgate.link'). */
    __publicField(this, "baseUrl");
    /** How the server is reached: on every snapshot, result and error the client gives. */
    __publicField(this, "transport");
    /** Who hears `insecure-transport`. */
    __publicField(this, "_insecureListeners", /* @__PURE__ */ new Set());
    /** Cached compatibility result (null until the first connect). */
    __publicField(this, "_compat", null);
    /** In-flight connect promise to deduplicate concurrent calls. */
    __publicField(this, "_connectPromise", null);
    /** The running operations, and the root of the cancellation tree. */
    __publicField(this, "_registry", new OperationRegistry());
    /** Every encrypt, decrypt, key, hash and random number the client uses. */
    __publicField(this, "_crypto");
    /** Where a credential comes from, for a server that asks for one: private, so it's never listed or serialised. */
    __privateAdd(this, _auth);
    if (!opts?.server) {
      throw new DropgateError({
        code: "INVALID_ARGUMENT",
        message: "DropgateClient requires server (URL string or ServerTarget object)."
      });
    }
    const { appInfo } = opts;
    if (appInfo !== void 0) {
      const valid = appInfo !== null && typeof appInfo === "object" && typeof appInfo.name === "string" && appInfo.name.trim() !== "" && (appInfo.version === void 0 || typeof appInfo.version === "string");
      if (!valid) {
        throw new DropgateError({ code: "INVALID_ARGUMENT", message: "appInfo must be { name, version? }, as strings." });
      }
      this.appInfo = Object.freeze({ name: appInfo.name, ...appInfo.version !== void 0 ? { version: appInfo.version } : {} });
    }
    this.baseUrl = resolveServerToBaseUrl(opts.server);
    this.transport = Object.freeze({ secure: isSecureServerUrl(this.baseUrl) });
    if (!this.transport.secure && opts.allowInsecure !== true) throw insecureTransportNotAllowed();
    this.chunkSize = Number.isFinite(opts.chunkSize) ? opts.chunkSize : DEFAULT_CHUNK_SIZE;
    const fetchFn = opts.fetchFn || getDefaultFetch();
    if (!fetchFn) {
      throw new DropgateError({ code: "RUNTIME_UNSUPPORTED", message: "No fetch() implementation found.", transport: this.transport });
    }
    this.fetchFn = guardedFetch(fetchFn);
    try {
      this._crypto = cryptoProvider();
    } catch (err) {
      throw withTransport(err, this.transport);
    }
    if (opts.auth !== void 0 && typeof opts.auth !== "function") {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "auth must be a function giving { token } or null.", transport: this.transport });
    }
    __privateSet(this, _auth, opts.auth);
    this.base64 = opts.base64 || getDefaultBase64();
    const transport = this.transport;
    const stamped = (fn) => (...args) => {
      let out;
      try {
        out = fn(...args);
      } catch (err) {
        throw withTransport(err, transport);
      }
      if (out instanceof Promise) return out.catch((err) => {
        throw withTransport(err, transport);
      });
      return out;
    };
    const client = this;
    this.server = Object.freeze({
      get baseUrl() {
        return client.baseUrl;
      },
      transport,
      connect: stamped((o) => this._connect(o)),
      info: stamped((o) => this._fetchInfo(o).then((serverInfo) => ({ ...serverInfo, transport }))),
      on: stamped((event, listener) => this._on(event, listener))
    });
    this.hosted = Object.freeze({
      upload: stamped((o) => this._upload(o)),
      download: stamped((o) => this._download(o)),
      metadata: stamped((o) => this._metadata(o)),
      open: stamped((o) => this._open(o)),
      validate: stamped((o) => this._validate(o)),
      delete: stamped((o) => this._delete(o))
    });
    this.direct = Object.freeze({
      send: stamped((o) => this._directSend(o)),
      receive: stamped((o) => this._directReceive(o))
    });
    this.links = Object.freeze({
      resolve: stamped((value, o) => this._resolve(value, o))
    });
    this.operations = this._registry.api;
  }
  _on(event, listener) {
    if (event !== "insecure-transport" || typeof listener !== "function") {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "client.server.on() takes 'insecure-transport' and a listener." });
    }
    this._insecureListeners.add(listener);
    return () => {
      this._insecureListeners.delete(listener);
    };
  }
  /** Asks the server for its info. */
  async _fetchInfo(opts) {
    const { timeoutMs = 5e3, signal } = opts ?? {};
    const { res, json } = await fetchJson(this.fetchFn, `${this.baseUrl}/api/info`, {
      method: "GET",
      timeoutMs,
      signal,
      headers: { Accept: "application/json" }
    });
    if (res.ok && json && typeof json === "object" && "version" in json) {
      return json;
    }
    if (res.status === 429 || res.status >= 500) throw errorFromStatus(res.status, json);
    throw new DropgateError({
      code: "INVALID_RESPONSE",
      status: res.status,
      message: "That server didn't answer as a Dropgate server does."
    });
  }
  async _connect(opts) {
    if (this._compat) return this._compat;
    if (!this._connectPromise) {
      this._connectPromise = this._fetchAndCheckCompat(opts).finally(() => {
        this._connectPromise = null;
      });
    }
    return this._connectPromise;
  }
  async _fetchAndCheckCompat(opts) {
    let serverInfo;
    try {
      serverInfo = await this._fetchInfo(opts);
    } catch (err) {
      throw toDropgateError(err, "SERVER_UNREACHABLE");
    }
    const compat = this._checkVersionCompat(serverInfo);
    this._compat = Object.freeze({ ...compat, serverInfo, baseUrl: this.baseUrl, transport: this.transport });
    if (!this.transport.secure) {
      const event = Object.freeze({ baseUrl: this.baseUrl, transport: this.transport });
      for (const listener of [...this._insecureListeners]) {
        try {
          listener(event);
        } catch {
        }
      }
    }
    return this._compat;
  }
  /** Throws VERSION_UNSUPPORTED if this client and the server can't work together over `protocol`. */
  _requireCompatible(compat, protocol) {
    const check = compat[protocol];
    if (check.compatible) return;
    throw new DropgateError({
      code: "VERSION_UNSUPPORTED",
      message: check.message,
      details: { component: protocol, update: check.update, client: check.client, server: check.server }
    });
  }
  /**
   * Whether this client works with the server, for each protocol on its own
   * (no network calls). The server's own version is for display only.
   */
  _checkVersionCompat(serverInfo) {
    const serverVersion = typeof serverInfo?.version === "string" ? serverInfo.version : "";
    return {
      dgup: checkProtocol(PROTOCOLS.dgup, serverInfo?.protocols?.dgup),
      dgdtp: checkProtocol(PROTOCOLS.dgdtp, serverInfo?.protocols?.dgdtp),
      serverVersion
    };
  }
  async _resolve(value, opts) {
    const transport = this.transport;
    const refused2 = (reason) => ({ valid: false, reason, transport });
    const input = parseShareInput(value);
    if (!input) return refused2(/^\s*https?:\/\//i.test(String(value ?? "")) ? "Unrecognised sharing link." : "Unrecognised sharing code.");
    if (input.linkHost !== void 0 && input.linkHost !== new URL(this.baseUrl).host) {
      return refused2("URL must be from this server.");
    }
    const compat = await this._connect(opts);
    this._requireCompatible(compat, "dgup");
    if (input.kind === "direct") {
      if (!compat.serverInfo?.capabilities?.p2p?.enabled) return refused2("Direct transfer is disabled on this server.");
      return { valid: true, type: "p2p", target: `/p2p/${encodeURIComponent(input.locator)}`, transport };
    }
    const path = input.kind === "bundle" ? `/b/${input.locator}` : `/${input.locator}`;
    return { valid: true, type: input.kind, target: input.secret ? `${path}#${input.secret}` : path, transport };
  }
  async _metadata(opts) {
    const target = hostedTarget(opts);
    const compat = await this._connect(opts);
    this._requireCompatible(compat, "dgup");
    return (await this._readObject(target.id, target.secret, compat, opts)).meta;
  }
  /**
   * Reads an upload's metadata, which takes no lease and counts nothing. An
   * encrypted one's header is checked and its list of files opened with the
   * link's secret, before any of its content is asked for; the opened object
   * is given too, for its download.
   */
  async _readObject(id, secret, compat, { timeoutMs = 5e3, signal }) {
    if (!UPLOAD_ID.test(id)) throw new DropgateError({ code: "NOT_FOUND" });
    const { res, json } = await fetchJson(this.fetchFn, `${compat.baseUrl}/api/v4/objects/${id}`, {
      method: "GET",
      timeoutMs,
      signal,
      headers: { Accept: "application/json" }
    });
    if (!res.ok) throw errorFromStatus(res.status, json, "Failed to fetch the upload's details.");
    const raw = json ?? {};
    const size = raw.size;
    if (typeof raw.encrypted !== "boolean" || typeof size !== "number" || !Number.isSafeInteger(size) || size < 1) {
      throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's details of the upload weren't understood." });
    }
    let files;
    let opened;
    if (raw.encrypted) {
      if (!secret) throw new DropgateError({ code: "KEY_REQUIRED" });
      if (!this._crypto.canEncrypt) {
        throw new DropgateError({
          code: "RUNTIME_UNSUPPORTED",
          message: "Web Crypto API not available for decryption. Encrypted uploads need a secure context (HTTPS or localhost)."
        });
      }
      const header = base64urlToBytes(raw.header, HEADER_BYTES, this.base64);
      const meta = base64urlToBytes(raw.meta, void 0, this.base64);
      if (!header || !meta) {
        throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's details of the upload weren't understood." });
      }
      const secretBytes = base64urlToBytes(secret, SECRET_BYTES, this.base64);
      if (!secretBytes) throw new DropgateError({ code: "DECRYPT_FAILED" });
      opened = await openObject(this._crypto, { secret: secretBytes, header, meta, size });
      files = opened.files.map(({ name, size: fileSize }) => ({ name, size: fileSize }));
    } else {
      files = plainFiles(raw.files, size);
    }
    return {
      meta: {
        kind: files.length === 1 ? "file" : "bundle",
        id,
        encrypted: raw.encrypted,
        files,
        totalSize: files.reduce((sum, file) => sum + file.size, 0),
        transport: this.transport
      },
      opened
    };
  }
  async _delete(opts) {
    const { id, manageToken, timeoutMs = 5e3, signal } = opts ?? {};
    if (typeof id !== "string" || !id || typeof manageToken !== "string" || !base64urlToBytes(manageToken, 32, this.base64)) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "Deleting an upload needs its id, and the manageToken its upload gave." });
    }
    if (!UPLOAD_ID.test(id)) throw new DropgateError({ code: "NOT_FOUND" });
    const compat = await this._connect({ timeoutMs, signal });
    this._requireCompatible(compat, "dgup");
    const { res, json } = await fetchJson(this.fetchFn, `${compat.baseUrl}/api/v4/objects/${id}`, {
      method: "DELETE",
      timeoutMs,
      signal,
      headers: { Accept: "application/json", "Dropgate-Manage-Token": manageToken }
    });
    if (!res.ok) throw errorFromStatus(res.status, json, "The upload couldn't be deleted.");
  }
  _validate(opts) {
    const { files: rawFiles, lifetimeMs, serverInfo } = opts;
    const caps = serverInfo?.capabilities?.upload;
    const encrypt2 = opts.encrypt ?? Boolean(caps?.e2ee);
    if (!caps || !caps.enabled) {
      throw new DropgateError({
        code: "CAPABILITY_UNSUPPORTED",
        message: "Server does not support file uploads.",
        details: { capability: "upload" }
      });
    }
    const files = toFileSources(rawFiles);
    if (files.length === 0) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "At least one file is required." });
    }
    if (files.length > MAX_FILES) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: `An upload holds 1 to ${MAX_FILES} files.` });
    }
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileSize = Number(file?.size);
      if (!file || !Number.isFinite(fileSize) || fileSize < 0) {
        throw new DropgateError({ code: "INVALID_ARGUMENT", message: `File at index ${i} is missing or invalid.`, details: { index: i } });
      }
      if (fileSize === 0) {
        throw new DropgateError({ code: "FILE_EMPTY", details: { index: i } });
      }
    }
    const maxMB = Number(caps.maxSizeMB);
    if (Number.isFinite(maxMB) && maxMB > 0) {
      const limitBytes = mbToBytes(maxMB);
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      const estimatedBytes = estimateUploadBytes(totalBytes, {
        encrypted: encrypt2,
        chunkSize: serverChunkSize(serverInfo, this.chunkSize),
        maxBytes: limitBytes
      });
      if (estimatedBytes > limitBytes) {
        const what = files.length === 1 ? "File at index 0 too large" : "These files are too large together";
        const msg = encrypt2 ? `${what} once encryption overhead is included. Server limit: ${maxMB} MB.` : `${what}. Server limit: ${maxMB} MB.`;
        throw new DropgateError({ code: "FILE_TOO_LARGE", message: msg, ...files.length === 1 ? { details: { index: 0 } } : {} });
      }
    }
    const maxHours = Number(caps.maxLifetimeHours);
    const lt = Number(lifetimeMs);
    if (!Number.isFinite(lt) || lt < 0 || !Number.isInteger(lt)) {
      throw new DropgateError({
        code: "INVALID_ARGUMENT",
        message: "Invalid lifetime. Must be a non-negative integer (milliseconds)."
      });
    }
    if (Number.isFinite(maxHours) && maxHours > 0) {
      const limitMs = Math.round(maxHours * 60 * 60 * 1e3);
      if (lt === 0) {
        throw new DropgateError({
          code: "LIFETIME_NOT_ALLOWED",
          message: `Server does not allow unlimited file lifetime. Max: ${maxHours} hours.`
        });
      }
      if (lt > limitMs) {
        throw new DropgateError({
          code: "LIFETIME_NOT_ALLOWED",
          message: `File lifetime too long. Server limit: ${maxHours} hours.`
        });
      }
    }
    if (encrypt2 && !caps.e2ee) {
      throw new DropgateError({
        code: "CAPABILITY_UNSUPPORTED",
        message: "End-to-end encryption is not supported on this server.",
        details: { capability: "e2ee" }
      });
    }
    return true;
  }
  _upload(opts) {
    const {
      files: rawFiles,
      lifetimeMs,
      encrypt: encrypt2,
      maxDownloads,
      filenameOverrides,
      signal,
      timeouts = {},
      retry = {}
    } = opts;
    const files = toFileSources(rawFiles);
    if (files.length === 0) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "At least one file is required." });
    }
    let currentObjectUpload = null;
    const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);
    let credentials = OperationCredentials.none;
    const cancelObjectUpload = async (uploadId) => {
      try {
        await fetchJson(this.fetchFn, `${this.baseUrl}/api/v4/upload`, {
          method: "DELETE",
          timeoutMs: 5e3,
          headers: { Accept: "application/json", "Dropgate-Upload": uploadId, ...credentials.headers() }
        });
      } catch {
      }
    };
    const work = async (ctx) => {
      const effectiveSignal = ctx.signal;
      const progress = ctx.update;
      const send = async (url, init) => {
        const attempt = () => fetchJson(this.fetchFn, url, { ...init, headers: { ...init.headers, ...credentials.headers() } });
        const out = await attempt();
        if (credentialExpired(out.res.status, out.json) && await credentials.renew(effectiveSignal)) return attempt();
        return out;
      };
      const filenames2 = files.map((f, i) => filenameOverrides?.[i] ?? f.name ?? "file");
      filenames2.forEach((name, index) => validateFilename(name, { index }));
      const compat = await this._connect({
        timeoutMs: timeouts.serverInfoMs ?? 5e3,
        signal: effectiveSignal
      });
      const { baseUrl, serverInfo } = compat;
      progress({ phase: "server-compat", text: compat.dgup.message });
      this._requireCompatible(compat, "dgup");
      const serverSupportsE2EE = Boolean(serverInfo?.capabilities?.upload?.e2ee);
      const effectiveEncrypt = encrypt2 ?? serverSupportsE2EE;
      this._validate({ files, lifetimeMs, encrypt: effectiveEncrypt, serverInfo });
      if (serverInfo?.capabilities?.upload?.credentialRequired === true) {
        credentials = await OperationCredentials.required(__privateGet(this, _auth), "hosted.upload", baseUrl, effectiveSignal);
      }
      const policy = retryPolicy(retry);
      return this._uploadObject({
        files,
        names: filenames2,
        encrypted: effectiveEncrypt,
        lifetimeMs,
        maxDownloads,
        compat,
        progress,
        signal: effectiveSignal,
        pausing: ctx.pausing,
        send,
        credentials,
        timeouts,
        policy,
        started: (uploadId) => {
          currentObjectUpload = uploadId;
        },
        finished: () => {
          currentObjectUpload = null;
        }
      });
    };
    return this._registry.add(startOperation({
      kind: "hosted.upload",
      parent: this._registry.scope,
      transport: this.transport,
      signal,
      initial: {
        status: "initializing",
        phase: "server-info",
        text: "Checking server...",
        percent: 0,
        processedBytes: 0,
        totalBytes: totalSizeBytes
      },
      work: (ctx) => {
        ctx.scope.onCancel(() => {
          if (currentObjectUpload) cancelObjectUpload(currentObjectUpload).catch(() => {
          });
        });
        return work(ctx);
      },
      finalSnapshot: (outcome, last) => {
        if (outcome.status === "completed") {
          return { ...last, status: "completed", phase: "done", text: "Upload successful!", percent: 100, processedBytes: totalSizeBytes };
        }
        if (outcome.status === "cancelled") return { ...last, status: "cancelled", text: "Upload cancelled." };
        return { ...last, status: "failed", text: outcome.error.message };
      },
      onEnd: (handle) => this._registry.remove(handle)
    }));
  }
  /**
   * Uploads one file or several as one Dropgate 4 object, the files' bytes one
   * after another: started with its header, sealed list of files and the
   * manage token's SHA-256, sent chunk by chunk (each chunk
   * of an encrypted one sealed once, and those same bytes sent again on a
   * retry), then finished. Gives the link, with the secret after its # for an
   * encrypted one, and the manage token: nothing else ever holds either.
   */
  async _uploadObject(p) {
    const { encrypted, compat, progress, signal, send, timeouts } = p;
    const { baseUrl, serverInfo } = compat;
    const chunkSize = serverChunkSize(serverInfo, this.chunkSize);
    if (!isChunkSize(chunkSize)) {
      throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's chunk size isn't one this version of Dropgate can use." });
    }
    const maxMB = Number(serverInfo?.capabilities?.upload?.maxSizeMB);
    const maxBytes = Number.isFinite(maxMB) && maxMB > 0 ? mbToBytes(maxMB) : 0;
    const sources2 = p.files;
    const files = sources2.map((source, i) => ({ name: p.names[i], size: source.size }));
    checkFiles(files);
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const several = files.length > 1;
    const manageToken = this._crypto.randomBytes(32);
    const manageTokenHash = bytesToBase64url(await this._crypto.sha256(manageToken), this.base64);
    let writer = null;
    let layout;
    if (encrypted) {
      if (!this._crypto.canEncrypt) {
        throw new DropgateError({
          code: "RUNTIME_UNSUPPORTED",
          message: "Web Crypto API not available. Encryption requires a secure context (HTTPS or localhost)."
        });
      }
      progress({ phase: "crypto", text: "Preparing encryption..." });
      try {
        writer = await createObject(this._crypto, { files, chunkSize, maxBytes });
      } catch (err) {
        throw DropgateError.is(err) ? err : new DropgateError({ code: "ENCRYPT_FAILED", cause: err });
      }
      layout = writer.layout;
    } else {
      layout = ObjectLayout.plain(totalSize, chunkSize);
    }
    progress({ phase: "init", text: "Reserving server storage..." });
    const start = await send(`${baseUrl}/api/v4/uploads`, {
      method: "POST",
      timeoutMs: timeouts.initMs ?? 15e3,
      signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        encrypted,
        size: layout.storedSize,
        ...writer ? { header: bytesToBase64url(writer.header, this.base64), meta: bytesToBase64url(writer.meta, this.base64) } : { files },
        lifetimeMs: p.lifetimeMs,
        ...p.maxDownloads !== void 0 ? { maxDownloads: p.maxDownloads } : {},
        manageTokenHash
      })
    });
    if (!start.res.ok) throw errorFromStatus(start.res.status, start.json, "The server refused to start the upload.");
    const { uploadId, chunks, deadline } = start.json ?? {};
    if (typeof uploadId !== "string" || !uploadId || chunks !== layout.chunkCount) {
      throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's answer to starting the upload wasn't understood." });
    }
    p.started(uploadId);
    const window2 = new RetryWindow();
    window2.heard(deadline);
    const sizes2 = files.map((f) => f.size);
    const totalChunks = layout.chunkCount;
    let held = new Uint8Array(totalChunks);
    const taken = new Uint8Array(totalChunks);
    let sending = null;
    const pauseMs = pauseLength(serverInfo);
    const pauseRequest = (route, dropped) => retrying(async () => {
      const out = await send(`${baseUrl}/api/v4/upload/${route}`, {
        method: "POST",
        timeoutMs: timeouts.initMs ?? 15e3,
        signal,
        headers: { Accept: "application/json", "Dropgate-Upload": uploadId }
      });
      if (out.res.ok) return out.json ?? {};
      const err = errorFromStatus(out.res.status, out.json, `The upload couldn't be ${route === "pause" ? "paused" : "resumed"}.`);
      throw err.code === "NOT_FOUND" ? dropped(err) : withRetryAfter(err, out.res);
    }, {
      policy: p.policy,
      window: window2,
      signal,
      random: (length) => this._crypto.randomBytes(length),
      waiting: ({ remainingMs }) => progress({
        text: `${route === "pause" ? "Pausing" : "Resuming"} failed. Retrying in ${(remainingMs / 1e3).toFixed(1)}s...`,
        deadline: window2.end
      }),
      expired: unreachableTooLong
    });
    const hooks = {
      pause: async () => {
        const said = await pauseRequest("pause", droppedUpload);
        const until = pausedUntil(said.deadline, pauseMs);
        window2.heard(until);
        return until;
      },
      resume: async () => {
        const said = await pauseRequest("resume", droppedPausedUpload);
        const received = chunkRanges(said.received, totalChunks);
        held = new Uint8Array(totalChunks);
        for (const [first, last] of received) held.fill(1, first, last + 1);
        for (let i = 0; i < totalChunks; i++) {
          if (held[i]) {
            taken[i] = 1;
            writer?.confirm(i);
          }
        }
        window2.heard(said.deadline);
      },
      expired: () => droppedPausedUpload()
    };
    if (pauseMs > 0) p.pausing.allow(hooks);
    else p.pausing.turnedOff();
    progress({ status: "uploading", ...several ? { totalFiles: files.length } : {} });
    for (let next = 0; ; ) {
      if (await p.pausing.checkpoint()) next = 0;
      while (next < totalChunks && held[next]) next++;
      if (next === totalChunks) {
        p.pausing.allow(null);
        if (!await p.pausing.checkpoint()) break;
        if (pauseMs > 0) p.pausing.allow(hooks);
        next = 0;
        continue;
      }
      const i = next;
      const { parts } = layout.chunkParts(i, sizes2);
      const processedBytes = Math.min(totalSize, i * chunkSize);
      progress({
        phase: "chunk",
        text: `Uploading chunk ${i + 1} of ${totalChunks}...`,
        percent: processedBytes / totalSize * 100,
        processedBytes,
        chunkIndex: i,
        totalChunks,
        deadline: null,
        // The file the chunk starts in; a chunk of padding alone is still the last file's.
        ...several ? { fileIndex: parts[0]?.file ?? files.length - 1 } : {}
      });
      if (sending?.index !== i) {
        if (taken[i]) {
          throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server no longer holds part of this upload that it had taken." });
        }
        let body2;
        if (parts.length === 1 && !writer) {
          body2 = await readRange(sources2[parts[0].file], parts[0].offset, parts[0].offset + parts[0].length);
        } else {
          const plaintext = new Uint8Array(layout.chunkLength(i));
          let at = 0;
          for (const part of parts) {
            plaintext.set(await readRange(sources2[part.file], part.offset, part.offset + part.length), at);
            at += part.length;
          }
          body2 = writer ? await writer.seal(i, plaintext) : plaintext;
        }
        sending = { index: i, body: body2, digest: this.base64.encode(await this._crypto.sha256(body2)) };
      }
      const { body, digest } = sending;
      try {
        await this._attemptChunkUpload(
          `${baseUrl}/api/v4/upload/chunks/${i}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Digest": `sha-256=:${digest}:`,
              "Dropgate-Upload": uploadId
            },
            body: new Blob([body])
          },
          { policy: p.policy, window: window2, timeoutMs: timeouts.chunkMs ?? 6e4, signal: p.pausing.signal, progress, chunkIndex: i, credentials: p.credentials }
        );
      } catch (err) {
        if (p.pausing.interrupted) continue;
        throw err;
      }
      held[i] = 1;
      taken[i] = 1;
      writer?.confirm(i);
      sending = null;
      next = i + 1;
    }
    progress({ status: "completing", phase: "complete", text: "Finalising upload...", percent: 100, processedBytes: totalSize });
    const finish = await retrying(async () => {
      const out = await send(`${baseUrl}/api/v4/upload/complete`, {
        method: "POST",
        timeoutMs: timeouts.completeMs ?? 3e4,
        signal,
        headers: { Accept: "application/json", "Dropgate-Upload": uploadId }
      });
      if (out.res.ok) return out;
      const err = errorFromStatus(out.res.status, out.json, "Finalisation failed.");
      throw err.code === "NOT_FOUND" ? droppedUpload(err) : withRetryAfter(err, out.res);
    }, {
      policy: p.policy,
      window: window2,
      signal,
      random: (length) => this._crypto.randomBytes(length),
      waiting: ({ remainingMs }) => progress({ text: `Finalising failed. Retrying in ${(remainingMs / 1e3).toFixed(1)}s...`, deadline: window2.end }),
      retrying: () => progress({ text: "Finalising upload..." }),
      expired: unreachableTooLong
    });
    const id = finish.json?.id;
    if (typeof id !== "string" || !UPLOAD_ID.test(id)) {
      throw new DropgateError({ code: "INVALID_RESPONSE", message: "Server did not return a valid upload id." });
    }
    p.finished();
    return {
      downloadUrl: writer ? `${baseUrl}/${id}#${bytesToBase64url(writer.secret(), this.base64)}` : `${baseUrl}/${id}`,
      id,
      manageToken: bytesToBase64url(manageToken, this.base64),
      files,
      transport: this.transport
    };
  }
  _download(opts) {
    const { id, secret } = hostedTarget(opts);
    return this._startDownload(opts, {
      read: async (compat, signal) => this._readObject(id, secret, compat, { timeoutMs: opts.timeoutMs ?? 6e4, signal }),
      // One lease for this download alone, paused with it, and released as it ends.
      lease: {
        take: (baseUrl, waitOpts) => this._takeLease(baseUrl, id, waitOpts),
        pause: (baseUrl, taken, run) => this._pauseLease(baseUrl, taken, run),
        resume: (baseUrl, taken, run) => this._renewLease(baseUrl, taken, run),
        done: (baseUrl, taken) => this._releaseLease(baseUrl, taken.lease)
      }
    });
  }
  /**
   * Checks a download's sink and files list, then starts it as an operation:
   * `read` gives the upload's metadata and opened object, and `lease` the
   * lease it's downloaded under.
   */
  _startDownload(opts, how) {
    const { asZip, sink, signal, timeoutMs = 6e4 } = opts;
    const policy = retryPolicy(opts.retry);
    const picked = opts.files;
    if (picked !== void 0 && (!Array.isArray(picked) || picked.length === 0 || picked.some((i) => !Number.isSafeInteger(i) || i < 0) || new Set(picked).size !== picked.length)) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "files lists which files to download, by index, each once." });
    }
    const chosenIndexes = picked ? [...picked].sort((a, b) => a - b) : void 0;
    const zipped = Boolean(asZip);
    const sinkFits = typeof sink === "function" ? !zipped : isDownloadSink(sink);
    if (!sinkFits) {
      throw new DropgateError({
        code: "INVALID_ARGUMENT",
        message: !sink ? "A download needs a sink, with write() and close(), for its bytes." : zipped ? "Files downloaded as a ZIP need one sink, with write() and close()." : "The sink needs write() and close(), or must be a function giving a sink."
      });
    }
    return this._registry.add(startOperation({
      kind: "hosted.download",
      parent: this._registry.scope,
      transport: this.transport,
      signal,
      initial: { status: "initializing", phase: "server-info", text: "Checking server...", percent: 0, processedBytes: 0, totalBytes: 0 },
      work: (ctx) => this._downloadObject(ctx, { sink, zipped, files: chosenIndexes, timeoutMs, policy, how }),
      finalSnapshot: (outcome, last) => {
        if (outcome.status === "completed") {
          return { ...last, status: "completed", phase: "done", text: "Download complete!", percent: 100, processedBytes: outcome.value.receivedBytes };
        }
        if (outcome.status === "cancelled") return { ...last, status: "cancelled", text: "Download cancelled." };
        return { ...last, status: "failed", text: outcome.error.message };
      },
      onEnd: (handle) => this._registry.remove(handle)
    }));
  }
  /**
   * Opens an upload for a page that may download it several times: its
   * metadata now, with no lease; then one lease, taken at the first download,
   * renewed every 2 minutes, shared by every download, and released at close().
   */
  async _open(opts) {
    const { id, secret } = hostedTarget(opts);
    const compat = await this._connect(opts);
    this._requireCompatible(compat, "dgup");
    const { baseUrl } = compat;
    const read = await this._readObject(id, secret, compat, opts);
    let lease = null;
    let taking = null;
    let renewTimer = null;
    let closed = false;
    const closing = new AbortController();
    const running = /* @__PURE__ */ new Set();
    let active = 0;
    const paused = /* @__PURE__ */ new Set();
    let leasePaused = false;
    const stopRenewing = () => {
      if (renewTimer !== null) clearInterval(renewTimer);
      renewTimer = null;
    };
    const startRenewing = () => {
      if (renewTimer !== null || !lease) return;
      renewTimer = setInterval(() => {
        renew().catch(() => {
        });
      }, LEASE_RENEW_MS);
      renewTimer.unref?.();
    };
    const pauseLease = async (held, run) => {
      stopRenewing();
      leasePaused = true;
      let deadline;
      if (run) {
        deadline = await this._pauseLease(baseUrl, held, run);
      } else {
        try {
          const { res, json } = await fetchJson(this.fetchFn, `${baseUrl}/api/v4/lease/pause`, {
            method: "POST",
            timeoutMs: 5e3,
            headers: { Accept: "application/json", "Dropgate-Lease": held.lease }
          });
          const said = json?.deadline;
          if (!res.ok || typeof said !== "number") throw new DropgateError({ code: "INVALID_RESPONSE" });
          deadline = said;
        } catch {
          leasePaused = false;
          startRenewing();
          return null;
        }
      }
      for (const other of paused) if (other !== run) other.deadline(deadline);
      return deadline;
    };
    const unpauseLease = () => {
      if (!leasePaused) return;
      leasePaused = false;
      startRenewing();
      for (const other of paused) other.deadline(null);
    };
    const renew = async () => {
      const held = lease;
      if (!held) return;
      try {
        const { res, json } = await fetchJson(this.fetchFn, `${baseUrl}/api/v4/lease/renew`, {
          method: "POST",
          timeoutMs: 5e3,
          headers: { Accept: "application/json", "Dropgate-Lease": held.lease }
        });
        if (res.ok) {
          held.deadline = json?.deadline;
        } else if (res.status === 404 && lease === held) {
          lease = null;
          stopRenewing();
        }
      } catch {
      }
    };
    const shared = {
      take: async (leaseUrl, waitOpts) => {
        if (closed) throw new DropgateError({ code: "OPERATION_CANCELLED" });
        let taken = lease;
        if (!taken) {
          taking ?? (taking = this._takeLease(leaseUrl, id, { ...waitOpts, signal: closing.signal }).then((got) => {
            lease = got;
            startRenewing();
            return got;
          }).finally(() => {
            taking = null;
          }));
          taken = await untilAborted(taking, waitOpts.signal);
        }
        active++;
        unpauseLease();
        return taken;
      },
      // One download paused holds the lease paused only once none under it runs.
      pause: async (_leaseUrl, taken, run) => {
        active--;
        paused.add(run);
        if (active > 0) return null;
        try {
          return await pauseLease(taken, run);
        } catch (err) {
          active++;
          paused.delete(run);
          leasePaused = false;
          startRenewing();
          throw err;
        }
      },
      resume: async (_leaseUrl, taken, run) => {
        await this._renewLease(baseUrl, taken, run);
        paused.delete(run);
        active++;
        unpauseLease();
      },
      // Downloads share the lease: only close() releases it. The last one
      // running to end, with another paused, leaves the lease paused.
      done: async (_leaseUrl, taken, run, wasPaused) => {
        if (wasPaused) {
          if (run) paused.delete(run);
          return;
        }
        active--;
        if (active === 0 && paused.size > 0 && lease === taken && !closed) await pauseLease(taken, null);
      }
    };
    const hidden2 = "[DropgateOpenedUpload]";
    return Object.freeze({
      metadata: read.meta,
      download: (o) => {
        try {
          if (closed) throw new DropgateError({ code: "INVALID_ARGUMENT", message: "This upload has been closed." });
          const handle = this._startDownload(o ?? {}, { read: async () => read, lease: shared });
          running.add(handle);
          handle.result.finally(() => running.delete(handle));
          return handle;
        } catch (err) {
          throw withTransport(err, this.transport);
        }
      },
      close: async () => {
        if (closed) return;
        closed = true;
        stopRenewing();
        closing.abort(new DropgateError({ code: "OPERATION_CANCELLED" }));
        const ending = [...running];
        for (const handle of ending) handle.cancel();
        const held = lease;
        lease = null;
        const released = held ? this._releaseLease(baseUrl, held.lease) : Promise.resolve();
        await Promise.all(ending.map((handle) => handle.result));
        await released;
      },
      toJSON: () => hidden2,
      toString: () => hidden2,
      [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]: () => hidden2
    });
  }
  /**
   * Downloads an upload under one lease, into its sink: the whole object, as
   * it's stored, each chunk of an encrypted one opened as it comes, to the one
   * marked last, padding included, so nothing can have been cut off; or, for
   * some of its files, only the chunks they're in, one run of chunks for each
   * run of files next to each other, and never a chunk that's only padding.
   * The last file, or the ZIP, is only finished once everything has come and
   * been checked. A connection that drops, or stalls, is asked again under the
   * same lease for the rest, from the next whole chunk; and if the server sends
   * anything but the rest of the same upload, none of it is written. A lease of
   * its own is released as soon as the download ends, however it ends, so it
   * counts at once.
   */
  async _downloadObject(ctx, o) {
    const progress = ctx.update;
    const downloadSignal = ctx.signal;
    const { sink, zipped, timeoutMs } = o;
    let baseUrl = this.baseUrl;
    let taken = null;
    let leaseRun = null;
    let paused = false;
    let open = null;
    try {
      const compat = await this._connect({ timeoutMs, signal: downloadSignal });
      progress({ phase: "server-compat", text: compat.dgup.message });
      this._requireCompatible(compat, "dgup");
      baseUrl = compat.baseUrl;
      progress({ phase: "metadata", text: "Fetching file info..." });
      const { meta, opened } = await o.how.read(compat, downloadSignal);
      const { files } = meta;
      const id = meta.id;
      const offsets = [];
      files.reduce((at, file) => {
        offsets.push(at);
        return at + file.size;
      }, 0);
      const indexes = chooseFiles(o.files, files.length);
      const wanted = new Set(indexes);
      const lastWanted = indexes[indexes.length - 1];
      const totalSize = indexes.reduce((sum, i) => sum + files[i].size, 0);
      const several = indexes.length > 1;
      if (several && !zipped && typeof sink !== "function") {
        throw new DropgateError({ code: "INVALID_ARGUMENT", message: "Several files downloaded apart need a function giving a sink for each file." });
      }
      progress({ status: "downloading", totalBytes: totalSize, ...several ? { totalFiles: indexes.length } : {} });
      taken = await o.how.lease.take(baseUrl, { timeoutMs, signal: downloadSignal, progress });
      const lease = taken;
      const window2 = new RetryWindow();
      window2.heard(lease.deadline);
      const pausing = ctx.pausing;
      const pauseMs = pauseLength(compat.serverInfo);
      const run = {
        policy: o.policy,
        window: window2,
        signal: downloadSignal,
        progress,
        deadline: (deadline) => pausing.extend(deadline === null ? null : pausedUntil(deadline, pauseMs))
      };
      leaseRun = run;
      const hooks = {
        pause: async () => {
          const deadline = await o.how.lease.pause(baseUrl, lease, run);
          paused = true;
          return deadline === null ? null : pausedUntil(deadline, pauseMs);
        },
        resume: async () => {
          await o.how.lease.resume(baseUrl, lease, run);
          paused = false;
        },
        expired: () => droppedDownload(true)
      };
      if (pauseMs > 0) pausing.allow(hooks);
      else pausing.turnedOff();
      const zipOut = zipped ? await SinkWriter.open(sink, { name: "", size: totalSize, index: 0 }) : null;
      open = zipOut;
      const zip2 = zipOut ? new StreamingZipWriter((chunk) => zipOut.write(chunk)) : null;
      const zipStep = async (run2) => {
        try {
          await run2();
        } catch (err) {
          if (err instanceof DropgateError && err.code === "INVALID_ARGUMENT") {
            throw new DropgateError({ code: "INTEGRITY_FAILED", message: "A file's bytes didn't match its size.", cause: err });
          }
          throw toDropgateError(err, "OUTPUT_WRITE_FAILED");
        }
      };
      let fileIndex = 0;
      let written = 0;
      let finished = 0;
      let current = null;
      let started = -1;
      const startFile = async (index) => {
        started = index;
        const file = files[index];
        progress({
          phase: several ? "file-start" : "downloading",
          text: several ? `Downloading file ${indexes.indexOf(index) + 1} of ${indexes.length}...` : "Downloading...",
          percent: written / totalSize * 100,
          processedBytes: written,
          ...several ? { fileIndex: index } : {}
        });
        if (zip2) {
          await zipStep(() => zip2.startFile(file.name, file.size));
        } else {
          current = await SinkWriter.open(sink, { name: file.name, size: file.size, index });
          open = current;
        }
      };
      const deliver = async (position, bytes) => {
        let at = 0;
        while (at < bytes.byteLength) {
          const here = position + at;
          while (fileIndex < files.length && here >= offsets[fileIndex] + files[fileIndex].size) fileIndex++;
          if (fileIndex === files.length) return;
          const fileEnd = offsets[fileIndex] + files[fileIndex].size;
          const length = Math.min(bytes.byteLength - at, fileEnd - here);
          if (wanted.has(fileIndex)) {
            const piece = bytes.subarray(at, at + length);
            if (started !== fileIndex) await startFile(fileIndex);
            if (zip2) {
              await zipStep(() => zip2.writeChunk(piece));
              await zipStep(() => zip2.drained());
            } else {
              await current.write(piece);
            }
            written += length;
            progress({ phase: "downloading", percent: written / totalSize * 100, processedBytes: written, ...several ? { fileIndex } : {} });
            if (here + length === fileEnd) {
              finished++;
              if (zip2) await zipStep(() => zip2.endFile());
              else if (fileIndex !== lastWanted) {
                await current.close();
                current = null;
                open = zipOut;
              }
            }
          }
          at += length;
        }
      };
      await startFile(indexes[0]);
      const size = opened ? opened.layout.storedSize : meta.totalSize;
      const whole = indexes.length === files.length;
      const runs = [];
      if (whole) {
        runs.push({ start: 0, end: opened ? opened.layout.length : meta.totalSize });
      } else {
        for (const index of indexes) {
          const last = runs[runs.length - 1];
          if (last && last.end === offsets[index]) last.end = offsets[index] + files[index].size;
          else runs.push({ start: offsets[index], end: offsets[index] + files[index].size });
        }
      }
      for (const run2 of runs) {
        const span = opened && !whole ? opened.layout.span(run2.start, run2.end - run2.start) : null;
        const lastChunk = opened ? span ? span.last : opened.layout.chunkCount - 1 : 0;
        let nextChunk = span ? span.first : 0;
        let plainAt = run2.start;
        let reconnecting = false;
        const fetchRest = async () => {
          const from = opened ? whole && nextChunk === 0 ? 0 : opened.layout.range(nextChunk, lastChunk).start : plainAt;
          const to = opened ? opened.layout.range(nextChunk, lastChunk).end - 1 : run2.end - 1;
          const ranged = from > 0 || to < size - 1;
          const { signal: waitSignal, waiting, cleanup } = makeWaitSignal(pausing.signal, timeoutMs);
          let stopWatching = () => {
          };
          const failed = (err, code) => waitSignal.aborted ? waitSignal.reason : toDropgateError(err, code);
          try {
            let res;
            try {
              res = await waiting(() => this.fetchFn(`${baseUrl}/api/v4/objects/${id}/content`, {
                method: "GET",
                // Only these bytes, and only if it's still the same upload: anything else is sent whole, and refused.
                headers: {
                  "Dropgate-Lease": lease.lease,
                  ...ranged ? { Range: to === size - 1 ? `bytes=${from}-` : `bytes=${from}-${to}`, "If-Range": lease.etag } : {}
                },
                signal: waitSignal
              }));
            } catch (err) {
              throw failed(err, "SERVER_UNREACHABLE");
            }
            if (!res.ok) throw withRetryAfter(errorFromStatus(res.status, await res.json().catch(() => null), "Download failed."), res);
            window2.heard();
            if (reconnecting) {
              reconnecting = false;
              progress({ deadline: null });
            }
            if (ranged) {
              if (res.status === 200) {
                throw new DropgateError({
                  code: "INTEGRITY_FAILED",
                  message: written > 0 ? "The server sent the whole upload again, not the rest of it, so it may have changed. Nothing more of it was written." : "The server sent the whole upload, not the part of it asked for, so it may have changed. None of it was written."
                });
              }
              const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get("Content-Range") ?? "");
              if (res.status !== 206 || !range || Number(range[1]) !== from || Number(range[2]) !== to || Number(range[3]) !== size) {
                throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server didn't send the part of the upload asked for." });
              }
            } else if (res.status !== 200) {
              throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server didn't send the whole upload." });
            }
            if (!res.body) throw new DropgateError({ code: "RUNTIME_UNSUPPORTED", message: "Streaming response not available." });
            const reader = res.body.getReader();
            const cancelRead = () => {
              reader.cancel(waitSignal.reason).catch(() => {
              });
            };
            waitSignal.addEventListener("abort", cancelRead, { once: true });
            stopWatching = () => waitSignal.removeEventListener("abort", cancelRead);
            async function* received() {
              for (; ; ) {
                let next;
                try {
                  next = await waiting(() => reader.read());
                } catch (err) {
                  throw failed(err, "CONNECTION_LOST");
                }
                if (waitSignal.aborted) throw waitSignal.reason;
                if (next.done) return;
                window2.heard();
                yield next.value;
              }
            }
            if (opened) {
              const chunks = from === 0 ? opened.read(received()) : opened.chunks(received(), nextChunk, lastChunk);
              for await (const { index, plaintext } of chunks) {
                await deliver(index * opened.layout.chunkSize, plaintext);
                nextChunk = index + 1;
              }
            } else {
              for await (const piece of received()) {
                if (plainAt + piece.byteLength > run2.end) {
                  throw new DropgateError({ code: "INTEGRITY_FAILED", message: "More data came than the upload holds." });
                }
                await deliver(plainAt, piece);
                plainAt += piece.byteLength;
              }
              if (plainAt !== run2.end) throw new DropgateError({ code: "INTEGRITY_FAILED", message: "The data ended before the last file did." });
            }
          } finally {
            stopWatching();
            cleanup();
          }
        };
        for (; ; ) {
          if (await pausing.checkpoint()) {
            progress({ text: several ? `Downloading file ${indexes.indexOf(started) + 1} of ${indexes.length}...` : "Downloading..." });
          }
          try {
            await retrying(fetchRest, {
              policy: o.policy,
              window: window2,
              signal: pausing.signal,
              random: (length) => this._crypto.randomBytes(length),
              // While it waits, the snapshot gives when the server stops holding the lease.
              waiting: ({ remainingMs }) => {
                reconnecting = true;
                progress({ text: `The connection was lost. Reconnecting in ${(remainingMs / 1e3).toFixed(1)}s...`, deadline: window2.end });
              },
              retrying: () => progress({ text: "Reconnecting..." })
            });
            break;
          } catch (err) {
            if (pausing.interrupted) continue;
            throw err;
          }
        }
      }
      if (finished !== indexes.length) throw new DropgateError({ code: "INTEGRITY_FAILED", message: "The data ended before the last file did." });
      pausing.allow(null);
      await pausing.checkpoint();
      progress({ status: "completing", phase: "complete", text: "Finishing the download..." });
      if (zip2) {
        await zipStep(() => zip2.finalize());
        await zipOut.close();
      } else {
        await current.close();
      }
      open = null;
      return {
        ...several ? { filenames: indexes.map((i) => files[i].name) } : { filename: files[indexes[0]].name },
        receivedBytes: written,
        wasEncrypted: meta.encrypted,
        transport: this.transport
      };
    } catch (err) {
      await open?.abort(downloadSignal.aborted ? downloadSignal.reason : err);
      throw toDropgateError(err, "CONNECTION_LOST");
    } finally {
      if (taken) await o.how.lease.done(baseUrl, taken, leaseRun, paused);
    }
  }
  /**
   * Takes a lease for one download of an upload. While other downloads hold
   * every place its download limit allows, the server says to wait: it asks
   * again when the server says to, until a place frees, the upload goes, or
   * the download is cancelled.
   */
  async _takeLease(baseUrl, id, { timeoutMs, signal, progress }) {
    for (; ; ) {
      const { res, json } = await fetchJson(this.fetchFn, `${baseUrl}/api/v4/objects/${id}/leases`, {
        method: "POST",
        timeoutMs,
        signal,
        headers: { Accept: "application/json" }
      });
      if (res.status === 423) {
        progress({ text: "Someone is downloading this right now." });
        await sleep(retryAfterMs(res, 5e3), signal);
        continue;
      }
      if (!res.ok) throw errorFromStatus(res.status, json, "The download could not start.");
      const { lease, etag, deadline } = json ?? {};
      if (typeof lease !== "string" || !base64urlToBytes(lease, 32, this.base64) || typeof etag !== "string" || !/^"[^"]+"$/.test(etag)) {
        throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's answer to starting the download wasn't understood." });
      }
      return { lease, etag, deadline };
    }
  }
  /**
   * Releases a download's lease, so it counts now (if it sent anything) and
   * frees its place. Best effort. Its request is made before this first
   * awaits anything, and kept alive, so it's sent even as a page closes.
   */
  async _releaseLease(baseUrl, lease) {
    try {
      await fetchJson(this.fetchFn, `${baseUrl}/api/v4/lease`, {
        method: "DELETE",
        timeoutMs: 5e3,
        keepalive: true,
        headers: { "Dropgate-Lease": lease }
      });
    } catch {
    }
  }
  /**
   * Asks the server to hold a paused download's lease for its pause length,
   * not its 5 minutes. Gives the server's deadline.
   */
  async _pauseLease(baseUrl, taken, run) {
    const said = await this._leaseRequest(baseUrl, taken, "pause", run);
    if (typeof said.deadline !== "number" || !Number.isFinite(said.deadline)) {
      throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's answer to the pause wasn't understood." });
    }
    taken.deadline = said.deadline;
    run.window.heard(said.deadline);
    return said.deadline;
  }
  /** Renews a download's lease, which ends a pause: the server holds it 5 more minutes. */
  async _renewLease(baseUrl, taken, run) {
    const said = await this._leaseRequest(baseUrl, taken, "renew", run);
    taken.deadline = said.deadline;
    run.window.heard(said.deadline);
  }
  /**
   * A pause or a renew of a download's lease, retried as its bytes are, until
   * the server stops holding the lease. A lease the server no longer has is
   * NOT_FOUND: the download was dropped.
   */
  _leaseRequest(baseUrl, taken, route, run) {
    const pausing = route === "pause";
    return retrying(async () => {
      const { res, json } = await fetchJson(this.fetchFn, `${baseUrl}/api/v4/lease/${route}`, {
        method: "POST",
        timeoutMs: 15e3,
        signal: run.signal,
        headers: { Accept: "application/json", "Dropgate-Lease": taken.lease }
      });
      if (res.ok) return json ?? {};
      const err = errorFromStatus(res.status, json, pausing ? "The download couldn't be paused." : "The download couldn't be resumed.");
      throw err.code === "NOT_FOUND" ? droppedDownload(!pausing, err) : withRetryAfter(err, res);
    }, {
      policy: run.policy,
      window: run.window,
      signal: run.signal,
      random: (length) => this._crypto.randomBytes(length),
      waiting: ({ remainingMs }) => run.progress({
        text: `${pausing ? "Pausing" : "Resuming"} failed. Retrying in ${(remainingMs / 1e3).toFixed(1)}s...`,
        deadline: run.window.end
      })
    });
  }
  async _directSend(opts) {
    const compat = await this._connect();
    this._requireCompatible(compat, "dgdtp");
    const { serverInfo } = compat;
    const p2pCaps = serverInfo?.capabilities?.p2p;
    if (!p2pCaps?.enabled) throw directTransferDisabled();
    const { host, port, secure } = parseServerUrl(this.baseUrl);
    const { path: peerjsPath, iceServers } = resolvePeerConfig({}, p2pCaps);
    const session = await startP2PSend({
      ...this._directEvents(opts),
      host,
      port,
      secure,
      peerjsPath,
      iceServers,
      serverInfo
    });
    return Object.assign(session, { transport: this.transport });
  }
  async _directReceive(opts) {
    const compat = await this._connect();
    this._requireCompatible(compat, "dgdtp");
    const { serverInfo } = compat;
    const p2pCaps = serverInfo?.capabilities?.p2p;
    if (!p2pCaps?.enabled) throw directTransferDisabled();
    const { host, port, secure } = parseServerUrl(this.baseUrl);
    const { path: peerjsPath, iceServers } = resolvePeerConfig({}, p2pCaps);
    const session = await startP2PReceive({
      ...this._directEvents(opts),
      host,
      port,
      secure,
      peerjsPath,
      iceServers,
      serverInfo
    });
    return Object.assign(session, { transport: this.transport });
  }
  /**
   * A direct transfer's options, with each event its listeners are given
   * carrying `transport`, and each error carrying it too, as every snapshot,
   * result and error a client gives does.
   */
  _directEvents(opts) {
    const transport = this.transport;
    const out = { ...opts };
    for (const name of DIRECT_EVENTS) {
      const listener = out[name];
      if (typeof listener !== "function") continue;
      out[name] = (evt) => listener(evt && typeof evt === "object" ? { ...evt, transport } : evt);
    }
    const onError = out.onError;
    if (typeof onError === "function") out.onError = (err) => onError(withTransport(err, transport));
    return out;
  }
  /**
   * Sends one chunk, the same bytes on every try. A try that can recover is
   * made again, after its backoff or the server's Retry-After, until the server
   * stops waiting for the upload; anything else the server says fails at once.
   */
  async _attemptChunkUpload(url, fetchOptions, opts) {
    const { policy, window: window2, timeoutMs, signal, progress, chunkIndex, credentials } = opts;
    const counted = (attempt) => policy.retries !== void 0 ? `(${attempt}/${policy.retries})` : `(retry ${attempt})`;
    await retrying(async () => {
      for (; ; ) {
        if (signal.aborted) throw signal.reason;
        const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);
        try {
          let res;
          try {
            const headers = { ...fetchOptions.headers, ...credentials.headers() };
            res = await this.fetchFn(url, { ...fetchOptions, headers, signal: s });
          } catch (err2) {
            throw toDropgateError(err2, "SERVER_UNREACHABLE");
          }
          const text = await res.text().catch(() => "");
          let said = { error: text };
          try {
            said = JSON.parse(text);
          } catch {
          }
          if (res.ok) {
            window2.heard(said?.deadline);
            return;
          }
          const err = errorFromStatus(res.status, said, `Chunk ${chunkIndex + 1} failed (HTTP ${res.status}).`);
          if (DropgateError.is(err, "AUTH_EXPIRED") && await credentials.renew(signal)) continue;
          if (err.code === "NOT_FOUND") throw droppedUpload(err);
          throw withRetryAfter(err, res);
        } finally {
          cleanup();
        }
      }
    }, {
      policy,
      window: window2,
      signal,
      random: (length) => this._crypto.randomBytes(length),
      // While it waits, the snapshot gives when the server stops waiting for the upload.
      waiting: ({ attempt, remainingMs }) => progress({
        phase: "retry-wait",
        text: `Chunk upload failed. Retrying in ${(remainingMs / 1e3).toFixed(1)}s... ${counted(attempt)}`,
        deadline: window2.end
      }),
      retrying: (attempt) => progress({ phase: "retry", text: `Chunk upload failed. Retrying now... ${counted(attempt)}` }),
      expired: unreachableTooLong
    });
  }
};
_auth = new WeakMap();
/** Core's own version, such as `4.0.0`. For display and logs: compatibility never depends on it. */
__publicField(DropgateClient, "version", CORE_VERSION);
/**
 * The protocol versions core speaks, each on its own: `dgup` for hosted
 * transfers and `dgdtp` for direct ones. A server works with this client
 * for a protocol when it speaks the same major.
 */
__publicField(DropgateClient, "protocols", PROTOCOLS);

// src/utils/lifetime.ts
var MULTIPLIERS = {
  minutes: 60 * 1e3,
  hours: 60 * 60 * 1e3,
  days: 24 * 60 * 60 * 1e3
};
function lifetimeToMs(value, unit) {
  const u = String(unit || "").toLowerCase();
  const v = Number(value);
  if (u === "unlimited") return 0;
  if (!Number.isFinite(v) || v <= 0) return 0;
  const m = MULTIPLIERS[u];
  if (!m) return 0;
  return Math.round(v * m);
}

// src/helpers.ts
var sources = Object.freeze({
  /** A FileSource that reads a browser `File` or `Blob`. A Blob with no name is called `file`. */
  blob: blobSource,
  /**
   * A FileSource that reads an open Node.js file handle. Its size is the file's
   * size now; closing the handle once the upload has ended is the caller's job.
   */
  fileHandle: fileHandleSource
});
var lifetime = Object.freeze({
  /** A lifetime in a unit (`minutes`, `hours`, `days`, or `unlimited`) in milliseconds, or 0 for unlimited or anything invalid. */
  toMs: lifetimeToMs
});
var sizes = Object.freeze({
  /**
   * How many bytes the server stores for an upload of one file, which its
   * maximum upload size is checked against: encrypted, with the header, each
   * chunk's tag, and the bytes added to hide the file's size, never past
   * `maxBytes` (so it's over that only when the file itself doesn't fit).
   */
  estimateUpload: estimateUploadBytes
});
var filenames = Object.freeze({
  /**
   * Checks a file name before it's sent, encrypted or not; core checks every
   * name it sends and receives this way.
   * @throws {DropgateError} INVALID_FILENAME if it's empty, over 255 UTF-8
   * bytes, or has a control character or path separator in it.
   */
  validate: (name) => validateFilename(name),
  /**
   * The name to save a received file under, the same on every OS: NFC, bidi
   * and zero-width characters shown as `[U+XXXX]`, `< > : " / \ | ? *` and
   * control characters as `_`, no trailing dots or spaces, `_` before a
   * Windows reserved name (`CON.txt`), within 255 UTF-8 bytes, never empty.
   */
  sanitize: sanitizeFilename,
  /**
   * The name itself if it isn't taken, or else `name (1).ext`, `name (2).ext`
   * and so on. `taken` is the names already used (compared without regard to
   * case) or a function that says whether a name is.
   */
  unique: uniqueFilename
});
var codes = Object.freeze({
  /**
   * A new random code, from secure random numbers only.
   * @throws {DropgateError} RUNTIME_UNSUPPORTED if there are none here (no `crypto.getRandomValues()`).
   */
  generate: () => generateP2PCode(),
  /** Whether a value is shaped like a code. */
  isLike: isP2PCodeLike
});
var hosts = Object.freeze({
  /** Whether a hostname is this machine (`localhost`, `127.0.0.1` or `::1`, also as `[::1]`). */
  isLocalhost: isLocalhostHostname,
  /** Whether a direct transfer can run here: a secure context, or this machine. */
  isSecureForDirect: isSecureContextForP2P
});
var zip = Object.freeze({
  /**
   * A ZIP writer that gives the archive's bytes to `onData` as they're
   * written: `startFile(name, size)`, `writeChunk(bytes)`, `endFile()`, then
   * `finalize()`. Each member's name is made safe and unique, and its bytes
   * must come to exactly its size. ZIP64 only where the archive needs it.
   * Await `drained()` to let a slow `onData` keep up.
   */
  writer: (onData) => new StreamingZipWriter(onData)
});
export {
  DropgateClient,
  DropgateError,
  ERROR_CODES,
  codes,
  filenames,
  hosts,
  lifetime,
  sizes,
  sources,
  zip
};
/*! Bundled license information:

@noble/curves/utils.js:
@noble/curves/abstract/modular.js:
@noble/curves/abstract/curve.js:
@noble/curves/abstract/edwards.js:
@noble/curves/abstract/montgomery.js:
@noble/curves/ed25519.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/ciphers/utils.js:
  (*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) *)
*/
