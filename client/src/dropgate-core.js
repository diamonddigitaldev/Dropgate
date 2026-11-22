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
  OUTPUT_STALLED: { origin: "local", retryable: false, message: "Saving the received files stopped for 2 minutes, so the transfer ended." },
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
  SECURITY_POLICY_MISMATCH: { origin: "peer", retryable: false, message: "The connection couldn't be secured, so it was closed." },
  CODE_MISMATCH: { origin: "peer", retryable: false, message: "The code didn't match, so the connection was closed." },
  PEER_FAILED: { origin: "peer", retryable: false, message: "The other device reported an error." },
  PEER_CLOSED: { origin: "peer", retryable: false, message: "The other device closed Dropgate before the transfer finished." },
  PAUSE_LIMIT: { origin: "local", retryable: false, message: "The transfer was paused for longer than its pause limit allows." },
  INVALID_MESSAGE: { origin: "peer", retryable: false, message: "The other device sent something this version of Dropgate doesn't understand." },
  UNEXPECTED_ERROR: { origin: "local", retryable: false, message: "Something unexpected went wrong." }
};
var DropgateError = class _DropgateError extends Error {
  constructor(opts) {
    const info2 = ERROR_CODES[opts.code] ?? ERROR_CODES.UNEXPECTED_ERROR;
    super(opts.message ?? info2.message, opts.cause !== void 0 ? { cause: opts.cause } : void 0);
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
    this.origin = opts.origin ?? info2.origin;
    this.retryable = opts.retryable ?? info2.retryable;
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
function createHasher(hashCons, info2 = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info2 = checkOpts({}, info2, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info2);
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
function expand(hash, prk, info2, length = 32, _recycled) {
  ahash(hash);
  anumber(length, "length");
  abytes(prk, void 0, "prk");
  const olen = hash.outputLen;
  if (prk.length < olen)
    throw new Error('"prk" must be at least HashLen octets');
  if (length > 255 * olen)
    throw new Error("Length must be <= 255*HashLen");
  const blocks = Math.ceil(length / olen);
  if (info2 === void 0)
    info2 = EMPTY_BUFFER;
  else
    abytes(info2, void 0, "info");
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
    iWork.update(info2).update(HKDF_COUNTER).digestInto(T);
    oHash._cloneInto(worker).update(T).digestInto(T);
    okm.set(T, olen * counter);
  }
  HKDF_COUNTER[0] = blocks;
  if (blocks > 1)
    iHash.update(T);
  iHash.update(info2).update(HKDF_COUNTER).digestInto(T);
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
var hkdf = (hash, ikm, salt, info2, length) => {
  ahash(hash);
  if (salt === void 0)
    salt = new Uint8Array(hash.outputLen);
  const HMAC = hmac.create(hash, salt).update(ikm);
  return expand(hash, HMAC.digest(), info2, length, HMAC);
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
  const hkdf3 = (ikm, salt, info2, length) => asOwn(hkdf(sha256, ikm, salt, info2, length));
  const aead = (key, nonce, associatedData3) => {
    const bytes = keyBytes(key);
    checkNonce(nonce);
    return gcm(bytes, nonce, associatedData3);
  };
  const provider = {
    name,
    canEncrypt: true,
    randomBytes: randomBytes3,
    randomUUID,
    async generateKey() {
      return contentKey(randomBytes3(CONTENT_KEY_BYTES), true);
    },
    async importKey(raw, exportable = true) {
      checkContentKey(raw);
      return contentKey(own(raw), exportable);
    },
    async exportKey(key) {
      const held = ContentKey.handle(key, name);
      if (!held.exportable) throw new DropgateError({ code: "INVALID_ARGUMENT", message: "That key can't be exported." });
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
    async encryptWithNonce(key, nonce, plaintext, associatedData3) {
      return asOwn(aead(key, nonce, associatedData3).encrypt(plaintext));
    },
    async decryptWithNonce(key, nonce, sealed, associatedData3) {
      return asOwn(aead(key, nonce, associatedData3).decrypt(sealed));
    },
    async deriveContentKey(ikm, salt, info2) {
      return contentKey(hkdf3(ikm, salt, info2, CONTENT_KEY_BYTES), false);
    },
    async deriveMacKey(ikm, salt, info2) {
      return new MacKey(name, hkdf3(ikm, salt, info2, MAC_KEY_BYTES));
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
    async hkdf(ikm, salt, info2, length) {
      checkHkdfLength(length);
      return hkdf3(ikm, salt, info2, length);
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
var X25519_GENERATE_TRIES = 3;
var isOperationError = (err) => err?.name === "OperationError";
async function generateX25519(subtle) {
  for (let tries = 1; ; tries++) {
    try {
      return await subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
    } catch (err) {
      if (tries >= X25519_GENERATE_TRIES || !isOperationError(err)) throw err;
    }
  }
}
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
  const gcm2 = (nonce, associatedData3) => {
    checkNonce(nonce);
    return associatedData3 === void 0 ? { name: "AES-GCM", iv: own(nonce) } : { name: "AES-GCM", iv: own(nonce), additionalData: own(associatedData3) };
  };
  const hkdf3 = async (ikm, salt, info2, algorithm, usages) => {
    const base = await needSubtle().importKey("raw", own(ikm), "HKDF", false, ["deriveKey"]);
    return needSubtle().deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: own(salt), info: own(info2) },
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
    async importKey(raw, exportable = true) {
      checkContentKey(raw);
      const key = await needSubtle().importKey("raw", own(raw), { name: "AES-GCM" }, exportable, ["encrypt", "decrypt"]);
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
    async encryptWithNonce(key, nonce, plaintext, associatedData3) {
      return new Uint8Array(await needSubtle().encrypt(gcm2(nonce, associatedData3), cryptoKey(key), view(plaintext)));
    },
    async decryptWithNonce(key, nonce, sealed, associatedData3) {
      return new Uint8Array(await needSubtle().decrypt(gcm2(nonce, associatedData3), cryptoKey(key), view(sealed)));
    },
    async deriveContentKey(ikm, salt, info2) {
      return new ContentKey(name, await hkdf3(ikm, salt, info2, { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]));
    },
    async deriveMacKey(ikm, salt, info2) {
      return new MacKey(name, await hkdf3(ikm, salt, info2, { name: "HMAC", hash: "SHA-256", length: HMAC_KEY_BITS }, ["sign", "verify"]));
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
    async hkdf(ikm, salt, info2, length) {
      checkHkdfLength(length);
      const base = await needSubtle().importKey("raw", own(ikm), "HKDF", false, ["deriveBits"]);
      return new Uint8Array(await needSubtle().deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: own(salt), info: own(info2) },
        base,
        length * 8
      ));
    },
    equal: constantTimeEqual,
    async x25519Generate() {
      const pair = await generateX25519(needSubtle());
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
        if (isOperationError(err)) throw lowOrder();
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
    await generateX25519(subtle);
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

// src/dgdtp/codes.ts
var CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
var CODE_DIGITS = "0123456789";
var CODE_LETTER_COUNT = 4;
var CODE_DIGIT_COUNT = 4;
var DEFAULT_LOCATOR_LETTERS = 2;
var LETTER_BYTE_LIMIT = 240;
var DIGIT_BYTE_LIMIT = 250;
var TYPED_CODE = /^([A-HJ-NP-Za-hj-np-z]{4})-?([0-9]{4})$/;
var ascii = (text) => new TextEncoder().encode(text);
var invalidCode = () => new DropgateError({ code: "INVALID_CODE" });
var _bytes;
var _CodePassword = class _CodePassword {
  constructor(bytes) {
    __privateAdd(this, _bytes);
    __privateSet(this, _bytes, bytes);
    Object.freeze(this);
  }
  /** A password of these characters. */
  static of(characters) {
    return new _CodePassword(ascii(characters));
  }
  /**
   * The password's bytes, for the one CPace exchange that uses it: the caller
   * overwrites them once used. Undefined if it was spent or forgotten.
   */
  static spend(password) {
    if (!(password instanceof _CodePassword)) return void 0;
    const bytes = __privateGet(password, _bytes);
    __privateSet(password, _bytes, void 0);
    return bytes;
  }
  /** Overwrites the bytes, if they weren't spent. */
  forget() {
    __privateGet(this, _bytes)?.fill(0);
    __privateSet(this, _bytes, void 0);
  }
  toJSON() {
    return "[CodePassword]";
  }
  toString() {
    return "[CodePassword]";
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return "[CodePassword]";
  }
};
_bytes = new WeakMap();
var CodePassword = _CodePassword;
function checkLetters(letters) {
  if (letters !== 2 && letters !== 3) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A code has 2 or 3 locator letters." });
  }
}
function draw(provider, alphabet, limit, count) {
  let out = "";
  while (out.length < count) {
    const bytes = provider.randomBytes(count - out.length);
    for (const byte of bytes) {
      if (byte < limit) out += alphabet[byte % alphabet.length];
    }
    bytes.fill(0);
  }
  return out;
}
var drawLetters = (provider, count) => draw(provider, CODE_LETTERS, LETTER_BYTE_LIMIT, count);
var drawDigits = (provider, count) => draw(provider, CODE_DIGITS, DIGIT_BYTE_LIMIT, count);
var codeOf = (letters, digits) => `${letters}-${digits}`;
function generateCode(provider) {
  return codeOf(drawLetters(provider, CODE_LETTER_COUNT), drawDigits(provider, CODE_DIGIT_COUNT));
}
function newCode(provider, locator, letters = DEFAULT_LOCATOR_LETTERS) {
  checkLetters(letters);
  if (typeof locator !== "string" || locator.length !== letters || [...locator].some((c) => !CODE_LETTERS.includes(c))) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: `A locator is ${letters} of a code's letters.` });
  }
  const passwordLetters = drawLetters(provider, CODE_LETTER_COUNT - letters);
  const digits = drawDigits(provider, CODE_DIGIT_COUNT);
  const parts = { locator, password: CodePassword.of(passwordLetters + digits) };
  Object.defineProperty(parts, "code", { value: codeOf(locator + passwordLetters, digits), enumerable: false });
  return Object.freeze(parts);
}
function normalizeCode(value) {
  const match = typeof value === "string" ? TYPED_CODE.exec(value.replace(/\s+/g, "")) : null;
  if (!match) throw invalidCode();
  return codeOf(match[1].toUpperCase(), match[2]);
}
function isCodeLike(value) {
  return typeof value === "string" && TYPED_CODE.test(value.replace(/\s+/g, ""));
}
function parseCode(value, letters = DEFAULT_LOCATOR_LETTERS) {
  checkLetters(letters);
  const code = normalizeCode(value);
  return Object.freeze({
    locator: code.slice(0, letters),
    password: CodePassword.of(code.slice(letters).replace("-", ""))
  });
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
  return generateCode(provider);
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
  const header2 = res.headers.get("Retry-After");
  const seconds = header2 === null || header2.trim() === "" ? NaN : Number(header2);
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
  /**
   * The other device in a direct transfer cancelled it (or declined it): this
   * node and everything under it are cancelled, `by: 'peer'`. Returns false if
   * it was already cancelled or done.
   */
  cancelByPeer(declined = false) {
    if (this._cancellation || this.done) return false;
    this.settle({ by: "peer", source: this.label, ...declined ? { declined: true } : {} });
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
  const scope = opts.scope ?? new CancelScope(opts.kind, { parent: opts.parent, signal: opts.signal });
  const own2 = opts.ownPausing;
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
    if (!ended) publish({ ...snapshot, ...patch, canPause: own2 ? own2.canPause : pausing.canPause, transport: opts.transport });
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
  const stamped2 = (step) => () => {
    let running;
    try {
      running = step();
    } catch (err) {
      running = Promise.reject(err);
    }
    return running.catch((err) => {
      throw withTransport(err, opts.transport);
    });
  };
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
    pause: stamped2(() => own2 ? own2.pause() : pausing.pause()),
    resume: stamped2(() => own2 ? own2.resume() : pausing.resume())
  };
  return Object.assign(handle, opts.extend?.() ?? {});
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
var DIRECT_SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
function parseShareInput(value) {
  const raw = String(value ?? "").trim();
  const hashAt = raw.indexOf("#");
  const before = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const after = hashAt === -1 ? "" : raw.slice(hashAt + 1);
  const secret = after ? after : void 0;
  if (!/^https?:\/\//i.test(before)) {
    const typed = before.replace(/\s+/g, "");
    if (UUID_RE.test(typed)) return { kind: "hosted", locator: typed.toLowerCase(), ...secret ? { secret } : {} };
    return isCodeLike(typed) ? { kind: "direct", locator: normalizeCode(typed) } : null;
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
  if (path === "/p2p") {
    if (url.search !== "" || !secret || !DIRECT_SECRET_RE.test(secret)) return null;
    return { kind: "direct-link", locator: "", linkHost: url.host, secret };
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
  const invalid11 = (message) => new DropgateError({
    code: "INVALID_FILENAME",
    message,
    ...where.origin ? { origin: where.origin } : {},
    ...where.index === void 0 ? {} : { details: { index: where.index } }
  });
  if (typeof filename !== "string" || filename.trim().length === 0) {
    throw invalid11("A file name is empty.");
  }
  if (utf8Length(filename) > MAX_FILENAME_BYTES) {
    throw invalid11(`A file name is longer than ${MAX_FILENAME_BYTES} bytes.`);
  }
  if (CONTROL.test(filename)) {
    throw invalid11("A file name has a control character in it.");
  }
  if (/[/\\]/.test(filename)) {
    throw invalid11("A file name has a path in it.");
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
  /** The token alone, for the one place a direct send carries it (its CREATE message): null if there isn't one. */
  token() {
    return __privateGet(this, _token);
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
  let normalizedCode;
  try {
    normalizedCode = normalizeCode(String(code));
  } catch {
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
    const header2 = new Bytes(30 + nameBytes.length + (zip64 ? 20 : 0)).u32(LOCAL_HEADER).u16(zip64 ? VERSION_ZIP64 : VERSION_CLASSIC).u16(FLAGS).u16(0).u16(this.time).u16(this.date).u32(0).u32(zip64 ? MAX_32 : 0).u32(zip64 ? MAX_32 : 0).u16(nameBytes.length).u16(zip64 ? 20 : 0).raw(nameBytes);
    if (zip64) header2.u16(ZIP64_EXTRA).u16(16).u64(0).u64(0);
    this.current = { name: nameBytes, size, crc: 0, offset: this.offset, written: 0 };
    this.emit(header2.bytes);
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

// src/dgdtp/cpace.ts
var DSI = "CPace255";
var DSI_ISK = "CPace255_ISK";
var SHA512_BLOCK_BYTES = 128;
var FIELD_BYTES2 = 32;
var ascii2 = (text) => new TextEncoder().encode(text);
var concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
};
function prependLen(data) {
  const length = [];
  let n = data.byteLength;
  do {
    length.push(n < 128 ? n : n & 127 | 128);
    n = Math.floor(n / 128);
  } while (n > 0);
  return concat(Uint8Array.from(length), data);
}
function lvCat(...parts) {
  return concat(...parts.map(prependLen));
}
function generatorString(prs, ci, sid) {
  const dsi = ascii2(DSI);
  const zpad = Math.max(0, SHA512_BLOCK_BYTES - 1 - prependLen(prs).byteLength - prependLen(dsi).byteLength);
  return lvCat(dsi, prs, new Uint8Array(zpad), ci, sid);
}
async function calculateGenerator(provider, prs, ci, sid) {
  const input = generatorString(prs, ci, sid);
  let hash;
  try {
    hash = await provider.sha512(input);
  } finally {
    input.fill(0);
  }
  try {
    return provider.elligator2(hash.subarray(0, FIELD_BYTES2));
  } finally {
    hash.fill(0);
  }
}
async function shareOf(provider, scalar, generator) {
  return provider.x25519(scalar, generator);
}
async function newShare(provider, generator) {
  const { privateKey } = await provider.x25519Generate();
  return { scalar: privateKey, share: await shareOf(provider, privateKey, generator) };
}
function transcriptIr(ya, adA, yb, adB) {
  return concat(lvCat(ya, adA), lvCat(yb, adB));
}
async function deriveIsk(provider, input) {
  if (input.peerShare.byteLength !== FIELD_BYTES2) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: `A CPace share is ${FIELD_BYTES2} bytes.` });
  }
  const k = await provider.x25519(input.scalar, input.peerShare);
  if (allZero(k)) throw lowOrder();
  const hashed = concat(lvCat(ascii2(DSI_ISK), input.sid, k), input.transcript);
  k.fill(0);
  try {
    return await provider.sha512(hashed);
  } finally {
    hashed.fill(0);
  }
}
var CPACE_ROOM_NONCE_BYTES = 16;
var CPACE_ATTEMPT_ID_BYTES = 16;
var AD_BYTES = 3;
var CONFIRMATION_BYTES = 64;
var CPACE_MESSAGE1_BYTES = CPACE_ATTEMPT_ID_BYTES + FIELD_BYTES2 + AD_BYTES;
var CPACE_MESSAGE2_BYTES = FIELD_BYTES2 + AD_BYTES + CONFIRMATION_BYTES;
var CPACE_MESSAGE3_BYTES = CONFIRMATION_BYTES;
var ROLE_RECEIVER = 1;
var ROLE_SENDER = 2;
var CI_LABEL = "dropgate/4 dgdtp cpace";
var MAC_LABEL = "CPaceMac";
var mismatch = () => new DropgateError({ code: "CODE_MISMATCH" });
var invalid3 = (message) => new DropgateError({ code: "INVALID_ARGUMENT", message });
var cpaceAbort = () => new Uint8Array(0);
var isAbort = (message) => message instanceof Uint8Array && message.byteLength === 0;
function checkCpaceAbort(message) {
  if (isAbort(message)) throw mismatch();
}
var channelIdentifier = (locator) => lvCat(ascii2(CI_LABEL), ascii2("receiver"), ascii2("sender"), ascii2(locator));
var associatedData = (role, version) => Uint8Array.of(role, version.major, version.minor);
async function confirmationKey(provider, sid, isk) {
  const input = concat(ascii2(MAC_LABEL), sid, isk);
  try {
    return await provider.sha512(input);
  } finally {
    input.fill(0);
  }
}
var confirmation = (provider, macKey, share, ad) => provider.hmac("SHA-512", macKey, lvCat(share, ad));
async function confirms(provider, macKey, share, ad, received) {
  const expected = await confirmation(provider, macKey, share, ad);
  try {
    return provider.equal(expected, received);
  } finally {
    expected.fill(0);
  }
}
async function ownShare(provider, password, ci, sid) {
  const prs = CodePassword.spend(password);
  if (!prs) throw mismatch();
  let generator;
  try {
    generator = await calculateGenerator(provider, prs, ci, sid);
  } finally {
    prs.fill(0);
  }
  try {
    return await newShare(provider, generator);
  } finally {
    generator.fill(0);
  }
}
async function sessionKeys(provider, scalar, peerShare, sid, transcript) {
  let isk;
  try {
    isk = await deriveIsk(provider, { scalar, peerShare, sid, transcript });
  } catch (err) {
    if (DropgateError.is(err, "INVALID_ARGUMENT")) throw mismatch();
    throw err;
  }
  try {
    return { isk, macKey: await confirmationKey(provider, sid, isk) };
  } catch (err) {
    isk.fill(0);
    throw err;
  }
}
var versionOf = (ad) => Object.freeze({ major: ad[1], minor: ad[2] });
async function handIskOn(isk, handOn) {
  try {
    return await handOn(isk);
  } finally {
    isk.fill(0);
  }
}
var isBytes4 = (value, length) => value instanceof Uint8Array && value.byteLength === length;
var isByte = (n) => Number.isInteger(n) && n >= 0 && n <= 255;
function settingsOf(options, role) {
  if (!(options?.password instanceof CodePassword)) throw invalid3("A CPace exchange takes a code's password.");
  const { locator } = options;
  if (typeof locator !== "string" || locator.length !== 2 && locator.length !== 3 || [...locator].some((c) => !CODE_LETTERS.includes(c))) {
    throw invalid3("A locator is 2 or 3 of a code's letters.");
  }
  if (!isBytes4(options.roomNonce, CPACE_ROOM_NONCE_BYTES)) throw invalid3(`A room nonce is ${CPACE_ROOM_NONCE_BYTES} bytes.`);
  const version = options.version ?? PROTOCOLS.dgdtp;
  if (!isByte(version?.major) || !isByte(version?.minor)) throw invalid3("A DGDTP version is a major and a minor, each 0 to 255.");
  return {
    password: options.password,
    ci: channelIdentifier(locator),
    roomNonce: new Uint8Array(options.roomNonce),
    ad: associatedData(role, version)
  };
}
function checkHandOn(handOn) {
  if (typeof handOn !== "function") throw invalid3("The ISK is handed on to a function.");
}
function stepper(cleanUp, outOfTurn) {
  let step = "ready";
  const run = async (expected, next, work) => {
    if (step === "failed") throw mismatch();
    if (step !== expected) throw outOfTurn();
    step = "busy";
    try {
      const result = await work();
      step = next;
      return result;
    } catch (err) {
      step = "failed";
      cleanUp();
      throw err;
    }
  };
  const close = () => {
    step = "failed";
    cleanUp();
  };
  return { run, close };
}
function cpaceInitiator(provider, options) {
  const settings = settingsOf(options, ROLE_RECEIVER);
  if (!isBytes4(options.attemptId, CPACE_ATTEMPT_ID_BYTES)) throw invalid3(`An attempt ID is ${CPACE_ATTEMPT_ID_BYTES} bytes.`);
  const attemptId = new Uint8Array(options.attemptId);
  const sid = concat(settings.roomNonce, attemptId);
  let own2;
  const turn = stepper(() => {
    settings.password.forget();
    own2 = void 0;
  }, () => invalid3("That CPace message is out of turn."));
  return Object.freeze({
    writeMessage1() {
      return turn.run("ready", "sent", async () => {
        own2 = await ownShare(provider, settings.password, settings.ci, sid);
        return concat(attemptId, own2.share, settings.ad);
      });
    },
    async readMessage2(message, handOn) {
      checkHandOn(handOn);
      return turn.run("sent", "done", async () => {
        const { scalar, share: ya } = own2;
        own2 = void 0;
        if (!isBytes4(message, CPACE_MESSAGE2_BYTES)) throw mismatch();
        const yb = message.slice(0, FIELD_BYTES2);
        const adB = message.slice(FIELD_BYTES2, FIELD_BYTES2 + AD_BYTES);
        const tb = message.slice(FIELD_BYTES2 + AD_BYTES);
        if (adB[0] !== ROLE_SENDER) throw mismatch();
        const { isk, macKey } = await sessionKeys(provider, scalar, yb, sid, transcriptIr(ya, settings.ad, yb, adB));
        try {
          if (!await confirms(provider, macKey, yb, adB, tb)) throw mismatch();
          const message3 = await confirmation(provider, macKey, ya, settings.ad);
          macKey.fill(0);
          return { message3, peerVersion: versionOf(adB), result: await handIskOn(isk, handOn) };
        } finally {
          macKey.fill(0);
          isk.fill(0);
        }
      });
    },
    close: turn.close
  });
}
function cpaceResponder(provider, options) {
  const settings = settingsOf(options, ROLE_SENDER);
  let held;
  const forget = () => {
    held?.isk.fill(0);
    held?.macKey.fill(0);
    held = void 0;
  };
  const turn = stepper(() => {
    settings.password.forget();
    forget();
  }, mismatch);
  return Object.freeze({
    readMessage1(message) {
      return turn.run("ready", "responded", async () => {
        if (!isBytes4(message, CPACE_MESSAGE1_BYTES)) throw mismatch();
        const attemptId = message.slice(0, CPACE_ATTEMPT_ID_BYTES);
        const ya = message.slice(CPACE_ATTEMPT_ID_BYTES, CPACE_ATTEMPT_ID_BYTES + FIELD_BYTES2);
        const adA = message.slice(CPACE_ATTEMPT_ID_BYTES + FIELD_BYTES2);
        if (adA[0] !== ROLE_RECEIVER) throw mismatch();
        const sid = concat(settings.roomNonce, attemptId);
        const { scalar, share: yb } = await ownShare(provider, settings.password, settings.ci, sid);
        const keys = await sessionKeys(provider, scalar, ya, sid, transcriptIr(ya, adA, yb, settings.ad));
        held = { ...keys, ya, adA };
        const tb = await confirmation(provider, keys.macKey, yb, settings.ad);
        return { message2: concat(yb, settings.ad, tb), attemptId: new Uint8Array(attemptId), peerVersion: versionOf(adA) };
      });
    },
    async readMessage3(message, handOn) {
      checkHandOn(handOn);
      return turn.run("responded", "done", async () => {
        const { isk, macKey, ya, adA } = held;
        try {
          if (!isBytes4(message, CPACE_MESSAGE3_BYTES) || !await confirms(provider, macKey, ya, adA, message)) throw mismatch();
          macKey.fill(0);
          return { result: await handIskOn(isk, handOn) };
        } finally {
          forget();
        }
      });
    },
    close: turn.close
  });
}

// src/dgdtp/keys.ts
var ROOM_ID_BYTES = 16;
var PSK_BYTES = 32;
var LINK_SECRET_BYTES = 32;
var RESUME_SECRET_BYTES = 32;
var ISK_BYTES = 64;
var CLOSE_SECRET_BYTES = 32;
var BASE_BYTES = Object.freeze({
  link: LINK_SECRET_BYTES,
  code: ISK_BYTES,
  resume: RESUME_SECRET_BYTES
});
var INFO = {
  room: "dropgate/4 dgdtp room",
  psk: "dropgate/4 dgdtp psk",
  sealR2S: "dropgate/4 dgdtp signal r>s",
  sealS2R: "dropgate/4 dgdtp signal s>r",
  closeR2S: "dropgate/4 dgdtp close r>s",
  closeS2R: "dropgate/4 dgdtp close s>r"
};
var info = (label) => new TextEncoder().encode(label);
var invalid4 = (message) => new DropgateError({ code: "INVALID_ARGUMENT", message });
var isBytes5 = (value, length) => value instanceof Uint8Array && value.byteLength === length;
function contextOf(roomNonce, attemptId) {
  if (!isBytes5(roomNonce, CPACE_ROOM_NONCE_BYTES)) throw invalid4(`A room nonce is ${CPACE_ROOM_NONCE_BYTES} bytes.`);
  if (!isBytes5(attemptId, CPACE_ATTEMPT_ID_BYTES)) throw invalid4(`An attempt ID is ${CPACE_ATTEMPT_ID_BYTES} bytes.`);
  const ctx = new Uint8Array(CPACE_ROOM_NONCE_BYTES + CPACE_ATTEMPT_ID_BYTES);
  ctx.set(roomNonce);
  ctx.set(attemptId, CPACE_ROOM_NONCE_BYTES);
  return ctx;
}
async function deriveRoomId(provider, secret) {
  if (!isBytes5(secret, LINK_SECRET_BYTES)) throw invalid4(`A link's secret is ${LINK_SECRET_BYTES} bytes.`);
  return provider.hkdf(secret, new Uint8Array(0), info(INFO.room), ROOM_ID_BYTES);
}
var _roomNonce, _attemptId, _sealR2S, _sealS2R, _psk, _AttemptKeys_instances, need_fn;
var AttemptKeys = class {
  /** @internal deriveAttemptKeys() makes these. */
  constructor(mode, roomNonce, attemptId, keys) {
    __privateAdd(this, _AttemptKeys_instances);
    __publicField(this, "mode");
    __privateAdd(this, _roomNonce);
    __privateAdd(this, _attemptId);
    __privateAdd(this, _sealR2S);
    __privateAdd(this, _sealS2R);
    __privateAdd(this, _psk);
    this.mode = mode;
    __privateSet(this, _roomNonce, roomNonce);
    __privateSet(this, _attemptId, attemptId);
    __privateSet(this, _sealR2S, keys.sealR2S);
    __privateSet(this, _sealS2R, keys.sealS2R);
    __privateSet(this, _psk, keys.psk);
    Object.freeze(this);
  }
  /** The room's nonce, a copy: public. */
  get roomNonce() {
    return new Uint8Array(__privateGet(this, _roomNonce));
  }
  /** The attempt's ID, a copy: public. */
  get attemptId() {
    return new Uint8Array(__privateGet(this, _attemptId));
  }
  /** The key the receiver's sealed frames are under. */
  get sealR2S() {
    return __privateMethod(this, _AttemptKeys_instances, need_fn).call(this, __privateGet(this, _sealR2S));
  }
  /** The key the sender's sealed frames are under. */
  get sealS2R() {
    return __privateMethod(this, _AttemptKeys_instances, need_fn).call(this, __privateGet(this, _sealS2R));
  }
  /**
   * Hands Noise's PSK to `use` (which copies it, as noise.ts does), then
   * overwrites it, whatever `use` does. Once only: after that, and after
   * `forget()`, INVALID_ARGUMENT.
   */
  async usePsk(use) {
    if (typeof use !== "function") throw invalid4("The PSK is handed to a function.");
    const psk = __privateGet(this, _psk);
    if (!psk) throw invalid4("This attempt's PSK was already used, or its keys let go.");
    __privateSet(this, _psk, void 0);
    try {
      return await use(psk);
    } finally {
      psk.fill(0);
    }
  }
  /** Lets go of every key, the PSK overwritten if it wasn't used: the attempt is over. */
  forget() {
    __privateGet(this, _psk)?.fill(0);
    __privateSet(this, _psk, void 0);
    __privateSet(this, _sealR2S, void 0);
    __privateSet(this, _sealS2R, void 0);
  }
  toJSON() {
    return "[AttemptKeys]";
  }
  toString() {
    return "[AttemptKeys]";
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return "[AttemptKeys]";
  }
};
_roomNonce = new WeakMap();
_attemptId = new WeakMap();
_sealR2S = new WeakMap();
_sealS2R = new WeakMap();
_psk = new WeakMap();
_AttemptKeys_instances = new WeakSet();
need_fn = function(key) {
  if (!key) throw invalid4("This attempt's keys were let go.");
  return key;
};
async function deriveAttemptKeys(provider, options) {
  const mode = options?.mode;
  if (!Object.prototype.hasOwnProperty.call(BASE_BYTES, mode)) throw invalid4("An attempt is by link, by code or a resume.");
  const baseBytes = BASE_BYTES[mode];
  if (!isBytes5(options.base, baseBytes)) throw invalid4(`A ${mode} attempt's base secret is ${baseBytes} bytes.`);
  const ctx = contextOf(options.roomNonce, options.attemptId);
  const { base } = options;
  const [psk, sealR2S, sealS2R] = await Promise.allSettled([
    provider.hkdf(base, ctx, info(INFO.psk), PSK_BYTES),
    provider.deriveContentKey(base, ctx, info(INFO.sealR2S)),
    provider.deriveContentKey(base, ctx, info(INFO.sealS2R))
  ]);
  if (psk.status === "rejected" || sealR2S.status === "rejected" || sealS2R.status === "rejected") {
    if (psk.status === "fulfilled") psk.value.fill(0);
    throw [psk, sealR2S, sealS2R].find((result) => result.status === "rejected")?.reason;
  }
  return new AttemptKeys(mode, ctx.slice(0, CPACE_ROOM_NONCE_BYTES), ctx.slice(CPACE_ROOM_NONCE_BYTES), {
    psk: psk.value,
    sealR2S: sealR2S.value,
    sealS2R: sealS2R.value
  });
}
async function deriveCloseKeys(provider, options) {
  if (!isBytes5(options?.closeSecret, CLOSE_SECRET_BYTES)) throw invalid4(`A close secret is ${CLOSE_SECRET_BYTES} bytes.`);
  const ctx = contextOf(options.roomNonce, options.attemptId);
  const [closeR2S, closeS2R] = await Promise.all([
    provider.deriveContentKey(options.closeSecret, ctx, info(INFO.closeR2S)),
    provider.deriveContentKey(options.closeSecret, ctx, info(INFO.closeS2R))
  ]);
  return Object.freeze({
    closeR2S,
    closeS2R,
    roomNonce: ctx.slice(0, CPACE_ROOM_NONCE_BYTES),
    attemptId: ctx.slice(CPACE_ROOM_NONCE_BYTES)
  });
}

// src/dgdtp/noise.ts
var TEST_BUILD = false;
var NOISE_PROTOCOL_NAME = "Noise_NNpsk0_25519_AESGCM_SHA256";
var NOISE_TAG_BYTES = 16;
var NOISE_MAX_MESSAGE_BYTES = 65535;
var NOISE_MAX_RECORD_PLAINTEXT_BYTES = NOISE_MAX_MESSAGE_BYTES - NOISE_TAG_BYTES;
var NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES = 1024;
var NOISE_REKEY_INTERVAL = 65536;
var KEY_BYTES = 32;
var MIN_HANDSHAKE_MESSAGE_BYTES = KEY_BYTES + NOISE_TAG_BYTES;
var MAX_HANDSHAKE_MESSAGE_BYTES = MIN_HANDSHAKE_MESSAGE_BYTES + NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES;
var MAX_NONCE = (1n << 64n) - 1n;
var EMPTY = new Uint8Array(0);
var BASE_POINT = Uint8Array.of(9, ...new Uint8Array(KEY_BYTES - 1));
var concat2 = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
};
var invalid5 = (message) => new DropgateError({ code: "INVALID_ARGUMENT", message });
var insecure = () => new DropgateError({ code: "SECURITY_POLICY_MISMATCH" });
var exhausted = () => new DropgateError({
  code: "SECURITY_POLICY_MISMATCH",
  origin: "local",
  message: "This connection has sent every record its keys allow, so it was closed."
});
function nonceOf(n) {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, n, false);
  return nonce;
}
async function hkdf2(provider, ck, ikm, outputs) {
  const tempKey = await provider.hmac("SHA-256", ck, ikm);
  const out = [];
  try {
    out.push(await provider.hmac("SHA-256", tempKey, Uint8Array.of(1)));
    for (let i = 2; i <= outputs; i++) {
      const input = concat2(out[i - 2], Uint8Array.of(i));
      try {
        out.push(await provider.hmac("SHA-256", tempKey, input));
      } finally {
        input.fill(0);
      }
    }
    return out;
  } catch (err) {
    for (const part of out) part.fill(0);
    throw err;
  } finally {
    tempKey.fill(0);
  }
}
var _provider3, _key, _n, _CipherState_instances, needKey_fn;
var CipherState = class {
  constructor(provider) {
    __privateAdd(this, _CipherState_instances);
    __privateAdd(this, _provider3);
    __privateAdd(this, _key);
    __privateAdd(this, _n, 0n);
    __privateSet(this, _provider3, provider);
  }
  get n() {
    return __privateGet(this, _n);
  }
  set n(n) {
    __privateSet(this, _n, n);
  }
  /** A new key from `raw`, which is overwritten, and the nonce back to 0. */
  async initializeKey(raw) {
    try {
      __privateSet(this, _key, await __privateGet(this, _provider3).importKey(raw, false));
      __privateSet(this, _n, 0n);
    } finally {
      raw.fill(0);
    }
  }
  /**
   * `plaintext` sealed under the next nonce, with `ad` (Noise's
   * EncryptWithAd). Every use of this state has a key by then.
   */
  async encryptWithAd(ad, plaintext) {
    const key = __privateMethod(this, _CipherState_instances, needKey_fn).call(this);
    if (__privateGet(this, _n) >= MAX_NONCE) throw exhausted();
    const sealed = await __privateGet(this, _provider3).encryptWithNonce(key, nonceOf(__privateGet(this, _n)), plaintext, ad);
    __privateSet(this, _n, __privateGet(this, _n) + 1n);
    return sealed;
  }
  /** `sealed` opened under the next nonce, with `ad` (Noise's DecryptWithAd); SECURITY_POLICY_MISMATCH if it doesn't open. */
  async decryptWithAd(ad, sealed) {
    const key = __privateMethod(this, _CipherState_instances, needKey_fn).call(this);
    if (__privateGet(this, _n) >= MAX_NONCE) throw insecure();
    let plaintext;
    try {
      plaintext = await __privateGet(this, _provider3).decryptWithNonce(key, nonceOf(__privateGet(this, _n)), sealed, ad);
    } catch {
      throw insecure();
    }
    __privateSet(this, _n, __privateGet(this, _n) + 1n);
    return plaintext;
  }
  /** Noise's Rekey(): the key becomes the first 32 bytes of 32 zeros sealed under nonce 2^64 - 1. The nonce isn't reset. */
  async rekey() {
    const sealed = await __privateGet(this, _provider3).encryptWithNonce(__privateMethod(this, _CipherState_instances, needKey_fn).call(this), nonceOf(MAX_NONCE), new Uint8Array(KEY_BYTES));
    const n = __privateGet(this, _n);
    try {
      await this.initializeKey(sealed.subarray(0, KEY_BYTES));
    } finally {
      sealed.fill(0);
      __privateSet(this, _n, n);
    }
  }
  /** Lets go of the key. */
  forget() {
    __privateSet(this, _key, void 0);
  }
};
_provider3 = new WeakMap();
_key = new WeakMap();
_n = new WeakMap();
_CipherState_instances = new WeakSet();
needKey_fn = function() {
  if (!__privateGet(this, _key)) throw insecure();
  return __privateGet(this, _key);
};
var _provider4, _ck, _h, _SymmetricState_instances, replaceCk_fn;
var _SymmetricState = class _SymmetricState {
  constructor(provider) {
    __privateAdd(this, _SymmetricState_instances);
    __privateAdd(this, _provider4);
    __publicField(this, "cipher");
    __privateAdd(this, _ck);
    __privateAdd(this, _h);
    __privateSet(this, _provider4, provider);
    this.cipher = new CipherState(provider);
    __privateSet(this, _h, new TextEncoder().encode(NOISE_PROTOCOL_NAME));
    __privateSet(this, _ck, new Uint8Array(__privateGet(this, _h)));
  }
  /** InitializeSymmetric(name), then MixHash(prologue). */
  static async start(provider, prologue) {
    const state = new _SymmetricState(provider);
    await state.mixHash(prologue);
    return state;
  }
  async mixHash(data) {
    __privateSet(this, _h, await __privateGet(this, _provider4).sha256(concat2(__privateGet(this, _h), data)));
  }
  async mixKey(ikm) {
    const [ck, key] = await hkdf2(__privateGet(this, _provider4), __privateGet(this, _ck), ikm, 2);
    __privateMethod(this, _SymmetricState_instances, replaceCk_fn).call(this, ck);
    await this.cipher.initializeKey(key);
  }
  async mixKeyAndHash(ikm) {
    const [ck, hash, key] = await hkdf2(__privateGet(this, _provider4), __privateGet(this, _ck), ikm, 3);
    __privateMethod(this, _SymmetricState_instances, replaceCk_fn).call(this, ck);
    try {
      await this.mixHash(hash);
    } finally {
      hash.fill(0);
    }
    await this.cipher.initializeKey(key);
  }
  async encryptAndHash(plaintext) {
    const sealed = await this.cipher.encryptWithAd(__privateGet(this, _h), plaintext);
    await this.mixHash(sealed);
    return sealed;
  }
  async decryptAndHash(sealed) {
    const plaintext = await this.cipher.decryptWithAd(__privateGet(this, _h), sealed);
    await this.mixHash(sealed);
    return plaintext;
  }
  /** Split(): the initiator's sending key, then the responder's, each a CipherState; the hash, a copy. The chaining key is gone after. */
  async split() {
    const [k1, k2] = await hkdf2(__privateGet(this, _provider4), __privateGet(this, _ck), EMPTY, 2);
    const first = new CipherState(__privateGet(this, _provider4));
    const second = new CipherState(__privateGet(this, _provider4));
    try {
      await first.initializeKey(k1);
      await second.initializeKey(k2);
    } finally {
      k1.fill(0);
      k2.fill(0);
    }
    const handshakeHash = new Uint8Array(__privateGet(this, _h));
    this.forget();
    return { first, second, handshakeHash };
  }
  /** Overwrites the chaining key and lets go of the handshake's key. */
  forget() {
    __privateGet(this, _ck).fill(0);
    this.cipher.forget();
  }
};
_provider4 = new WeakMap();
_ck = new WeakMap();
_h = new WeakMap();
_SymmetricState_instances = new WeakSet();
replaceCk_fn = function(ck) {
  __privateGet(this, _ck).fill(0);
  __privateSet(this, _ck, ck);
};
var SymmetricState = _SymmetricState;
var _cipher, _rekeyEvery, _closed, _tail, _Direction_instances, next_fn, afterRecord_fn;
var Direction = class {
  constructor(cipher, rekeyEvery) {
    __privateAdd(this, _Direction_instances);
    __privateAdd(this, _cipher);
    __privateAdd(this, _rekeyEvery);
    __privateAdd(this, _closed, false);
    __privateAdd(this, _tail, Promise.resolve());
    __privateSet(this, _cipher, cipher);
    __privateSet(this, _rekeyEvery, rekeyEvery);
  }
  seal(plaintext) {
    if (plaintext.byteLength > NOISE_MAX_RECORD_PLAINTEXT_BYTES) {
      return Promise.reject(invalid5(`A record holds at most ${NOISE_MAX_RECORD_PLAINTEXT_BYTES} bytes.`));
    }
    const copy = new Uint8Array(plaintext);
    return __privateMethod(this, _Direction_instances, next_fn).call(this, async () => {
      const record = await __privateGet(this, _cipher).encryptWithAd(EMPTY, copy);
      await __privateMethod(this, _Direction_instances, afterRecord_fn).call(this);
      return record;
    });
  }
  open(record) {
    const copy = record instanceof Uint8Array ? new Uint8Array(record) : void 0;
    return __privateMethod(this, _Direction_instances, next_fn).call(this, async () => {
      if (!copy || copy.byteLength < NOISE_TAG_BYTES || copy.byteLength > NOISE_MAX_MESSAGE_BYTES) throw insecure();
      const plaintext = await __privateGet(this, _cipher).decryptWithAd(EMPTY, copy);
      await __privateMethod(this, _Direction_instances, afterRecord_fn).call(this);
      return plaintext;
    });
  }
  close() {
    __privateSet(this, _closed, true);
    __privateGet(this, _cipher).forget();
  }
  /** For tests only: where the nonce stands. */
  set nonce(n) {
    __privateGet(this, _cipher).n = n;
  }
};
_cipher = new WeakMap();
_rekeyEvery = new WeakMap();
_closed = new WeakMap();
_tail = new WeakMap();
_Direction_instances = new WeakSet();
/** Runs `step` after every earlier one; once one fails, the direction is closed, and every later one fails. */
next_fn = function(step) {
  const run = __privateGet(this, _tail).then(async () => {
    if (__privateGet(this, _closed)) throw insecure();
    try {
      return await step();
    } catch (err) {
      this.close();
      throw err;
    }
  });
  __privateSet(this, _tail, run.then(() => void 0, () => void 0));
  return run;
};
afterRecord_fn = async function() {
  if (__privateGet(this, _cipher).n % __privateGet(this, _rekeyEvery) === 0n) await __privateGet(this, _cipher).rekey();
};
var directions = /* @__PURE__ */ new WeakMap();
function transportOf(send, receive, handshakeHash) {
  const transport = Object.freeze({
    encrypt: (plaintext) => send.seal(plaintext),
    decrypt: (record) => receive.open(record),
    get handshakeHash() {
      return new Uint8Array(handshakeHash);
    },
    close() {
      send.close();
      receive.close();
    }
  });
  directions.set(transport, { send, receive });
  return transport;
}
function settingsOf2(options) {
  if (!(options?.prologue instanceof Uint8Array)) throw invalid5("A Noise prologue is bytes.");
  if (!(options.psk instanceof Uint8Array) || options.psk.byteLength !== KEY_BYTES) throw invalid5("A Noise PSK is 32 bytes.");
  let rekeyEvery = BigInt(NOISE_REKEY_INTERVAL);
  let ephemeral;
  if (options.testing !== void 0) {
    if (!TEST_BUILD) throw invalid5("A fixed ephemeral key and a lowered rekey interval are for tests only.");
    const { ephemeral: scalar, rekeyEvery: every } = options.testing;
    if (scalar !== void 0) {
      if (!(scalar instanceof Uint8Array) || scalar.byteLength !== KEY_BYTES) throw invalid5("An X25519 scalar is 32 bytes.");
      ephemeral = new Uint8Array(scalar);
    }
    if (every !== void 0) {
      if (!Number.isInteger(every) || every < 1 || every > NOISE_REKEY_INTERVAL) throw invalid5("A rekey interval is 1 to 65,536 records.");
      rekeyEvery = BigInt(every);
    }
  }
  return { prologue: new Uint8Array(options.prologue), psk: new Uint8Array(options.psk), ephemeral, rekeyEvery };
}
function checkPayload(payload) {
  if (!(payload instanceof Uint8Array)) throw invalid5("A handshake payload is bytes.");
  if (payload.byteLength > NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES) {
    throw invalid5(`A handshake payload is at most ${NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES} bytes.`);
  }
}
async function ephemeralKey(provider, settings) {
  if (!settings.ephemeral) return provider.x25519Generate();
  try {
    const privateKey = await provider.x25519FromScalar(settings.ephemeral);
    return { privateKey, publicKey: await provider.x25519(privateKey, BASE_POINT) };
  } finally {
    settings.ephemeral.fill(0);
  }
}
async function dh(provider, privateKey, publicKey) {
  try {
    return await provider.x25519(privateKey, publicKey);
  } catch (err) {
    if (DropgateError.is(err, "INVALID_ARGUMENT")) throw insecure();
    throw err;
  }
}
var handshakeLength = (message) => message instanceof Uint8Array && message.byteLength >= MIN_HANDSHAKE_MESSAGE_BYTES && message.byteLength <= MAX_HANDSHAKE_MESSAGE_BYTES;
function stepper2(cleanUp) {
  let step = "ready";
  return async (expected, next, run) => {
    if (step === "failed") throw insecure();
    if (step !== expected) throw invalid5("That Noise handshake message is out of turn.");
    step = "busy";
    try {
      const result = await run();
      step = next;
      return result;
    } catch (err) {
      step = "failed";
      cleanUp();
      throw err;
    }
  };
}
function noiseInitiator(provider, options) {
  const settings = settingsOf2(options);
  let state;
  let ephemeral;
  const turn = stepper2(() => {
    settings.psk.fill(0);
    state?.forget();
    ephemeral = void 0;
  });
  return Object.freeze({
    async writeMessage1(payload = EMPTY) {
      checkPayload(payload);
      return turn("ready", "sent", async () => {
        state = await SymmetricState.start(provider, settings.prologue);
        await state.mixKeyAndHash(settings.psk);
        settings.psk.fill(0);
        const e = await ephemeralKey(provider, settings);
        ephemeral = e.privateKey;
        await state.mixHash(e.publicKey);
        await state.mixKey(e.publicKey);
        return concat2(e.publicKey, await state.encryptAndHash(payload));
      });
    },
    readMessage2(message) {
      return turn("sent", "done", async () => {
        const ss = state;
        if (!handshakeLength(message)) throw insecure();
        const re = message.slice(0, KEY_BYTES);
        await ss.mixHash(re);
        await ss.mixKey(re);
        const shared = await dh(provider, ephemeral, re);
        ephemeral = void 0;
        try {
          await ss.mixKey(shared);
        } finally {
          shared.fill(0);
        }
        const payload = await ss.decryptAndHash(message.subarray(KEY_BYTES));
        const { first, second, handshakeHash } = await ss.split();
        state = void 0;
        return { payload, transport: transportOf(new Direction(first, settings.rekeyEvery), new Direction(second, settings.rekeyEvery), handshakeHash) };
      });
    }
  });
}
function noiseResponder(provider, options) {
  const settings = settingsOf2(options);
  let state;
  let re;
  const turn = stepper2(() => {
    settings.psk.fill(0);
    settings.ephemeral?.fill(0);
    state?.forget();
  });
  return Object.freeze({
    readMessage1(message) {
      return turn("ready", "read", async () => {
        if (!handshakeLength(message)) throw insecure();
        state = await SymmetricState.start(provider, settings.prologue);
        await state.mixKeyAndHash(settings.psk);
        settings.psk.fill(0);
        re = message.slice(0, KEY_BYTES);
        await state.mixHash(re);
        await state.mixKey(re);
        return state.decryptAndHash(message.subarray(KEY_BYTES));
      });
    },
    async writeMessage2(payload = EMPTY) {
      checkPayload(payload);
      return turn("read", "done", async () => {
        const ss = state;
        const e = await ephemeralKey(provider, settings);
        await ss.mixHash(e.publicKey);
        await ss.mixKey(e.publicKey);
        const shared = await dh(provider, e.privateKey, re);
        try {
          await ss.mixKey(shared);
        } finally {
          shared.fill(0);
        }
        const message = concat2(e.publicKey, await ss.encryptAndHash(payload));
        const { first, second, handshakeHash } = await ss.split();
        state = void 0;
        return { message, transport: transportOf(new Direction(second, settings.rekeyEvery), new Direction(first, settings.rekeyEvery), handshakeHash) };
      });
    }
  });
}

// src/dgdtp/messages.ts
var MESSAGE_TYPE = Object.freeze({
  BIND: 1,
  MANIFEST: 2,
  ACCEPT: 3,
  DATA: 4,
  BLOCK_END: 5,
  FILE_END: 6,
  CREDIT: 7,
  FINISH: 8,
  RESULT: 9,
  RESULT_ACK: 10,
  HOLD: 11,
  CLOSE: 12,
  CLOSE_ACK: 13,
  PING: 14,
  PONG: 15,
  RESUME: 16,
  RESUME_OK: 17,
  STATUS: 18
});
var MIN_RECORD_BYTES = 16384;
var HELLO_BYTES = 18;
var BIND_BYTES = 1 + CLOSE_SECRET_BYTES + HELLO_BYTES;
var MANIFEST_HEADER_BYTES = 9;
var DATA_HEADER_BYTES = 14;
var MANIFEST_VERSION = 1;
var BLOCK_BYTES = 1048576;
var MAX_MANIFEST_FILES = 1e4;
var MAX_MANIFEST_BYTES = 1048576;
var MAX_MEDIA_TYPE_BYTES = 127;
var MANIFEST_START_BYTES = 1 + 4 + 4 + 8;
var SHA256_BYTES = 32;
var ID_BYTES = 16;
var RESULT_BODY_BYTES = ID_BYTES + 1 + 4 + 8 + SHA256_BYTES;
var MANIFEST_LABEL = "dropgate/4 dgdtp manifest";
var CHECKPOINT_LABEL = "dropgate/4 dgdtp checkpoint";
var CHAIN_BLOCK = 1;
var CHAIN_FILE_END = 2;
var MAX_U32 = 4294967295;
var MAX_U64 = (1n << 64n) - 1n;
var CLOSE_REASONS = ["USER_CANCELLED", "USER_DECLINED", "APP_CLOSED", "PAUSE_LIMIT", "RECOVERY_EXHAUSTED", "FAILED", "TAKEN"];
var CLOSE_DETAILS = [
  "OUTPUT_WRITE_FAILED",
  "OUTPUT_STALLED",
  "SOURCE_UNAVAILABLE",
  "INTEGRITY_FAILED",
  "INVALID_MANIFEST",
  "INVALID_MESSAGE",
  "TIMED_OUT",
  "CAPABILITY_UNSUPPORTED"
];
var ASSURANCES = ["saved", "handed-off"];
var invalidMessage = () => new DropgateError({ code: "INVALID_MESSAGE" });
var invalidManifest = () => new DropgateError({ code: "INVALID_MANIFEST" });
var invalidArgument = (message) => new DropgateError({ code: "INVALID_ARGUMENT", message });
var encoder2 = new TextEncoder();
var strictDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
var _view, _at;
var Writer = class {
  constructor(length) {
    __publicField(this, "bytes");
    __privateAdd(this, _view);
    __privateAdd(this, _at, 0);
    this.bytes = new Uint8Array(length);
    __privateSet(this, _view, new DataView(this.bytes.buffer));
  }
  u8(value) {
    __privateGet(this, _view).setUint8(__privateGet(this, _at), value);
    __privateSet(this, _at, __privateGet(this, _at) + 1);
    return this;
  }
  u16(value) {
    __privateGet(this, _view).setUint16(__privateGet(this, _at), value);
    __privateSet(this, _at, __privateGet(this, _at) + 2);
    return this;
  }
  u32(value) {
    __privateGet(this, _view).setUint32(__privateGet(this, _at), value);
    __privateSet(this, _at, __privateGet(this, _at) + 4);
    return this;
  }
  u64(value) {
    __privateGet(this, _view).setBigUint64(__privateGet(this, _at), BigInt(value));
    __privateSet(this, _at, __privateGet(this, _at) + 8);
    return this;
  }
  raw(bytes) {
    this.bytes.set(bytes, __privateGet(this, _at));
    __privateSet(this, _at, __privateGet(this, _at) + bytes.byteLength);
    return this;
  }
  /** The record, checked to be exactly the length it was made for. */
  done() {
    if (__privateGet(this, _at) !== this.bytes.byteLength) throw new DropgateError({ code: "UNEXPECTED_ERROR", message: "A record was written short." });
    return this.bytes;
  }
};
_view = new WeakMap();
_at = new WeakMap();
var _bytes2, _view2, _fail, _at2, _Reader_instances, need_fn2;
var Reader = class {
  constructor(bytes, at, fail) {
    __privateAdd(this, _Reader_instances);
    __privateAdd(this, _bytes2);
    __privateAdd(this, _view2);
    __privateAdd(this, _fail);
    __privateAdd(this, _at2);
    __privateSet(this, _bytes2, bytes);
    __privateSet(this, _view2, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    __privateSet(this, _fail, fail);
    __privateSet(this, _at2, at);
  }
  get left() {
    return __privateGet(this, _bytes2).byteLength - __privateGet(this, _at2);
  }
  u8() {
    return __privateGet(this, _view2).getUint8(__privateMethod(this, _Reader_instances, need_fn2).call(this, 1));
  }
  u16() {
    return __privateGet(this, _view2).getUint16(__privateMethod(this, _Reader_instances, need_fn2).call(this, 2));
  }
  u32() {
    return __privateGet(this, _view2).getUint32(__privateMethod(this, _Reader_instances, need_fn2).call(this, 4));
  }
  u64() {
    return __privateGet(this, _view2).getBigUint64(__privateMethod(this, _Reader_instances, need_fn2).call(this, 8));
  }
  /** A 64-bit size or count, which must be at most 2^53 − 1. */
  size() {
    const value = this.u64();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw __privateGet(this, _fail).call(this);
    return Number(value);
  }
  raw(n) {
    const at = __privateMethod(this, _Reader_instances, need_fn2).call(this, n);
    return __privateGet(this, _bytes2).slice(at, at + n);
  }
  rest() {
    return this.raw(this.left);
  }
};
_bytes2 = new WeakMap();
_view2 = new WeakMap();
_fail = new WeakMap();
_at2 = new WeakMap();
_Reader_instances = new WeakSet();
need_fn2 = function(n) {
  if (__privateGet(this, _at2) + n > __privateGet(this, _bytes2).byteLength) throw __privateGet(this, _fail).call(this);
  const at = __privateGet(this, _at2);
  __privateSet(this, _at2, __privateGet(this, _at2) + n);
  return at;
};
var isBytes6 = (value, length) => value instanceof Uint8Array && value.byteLength === length;
function checkUint(value, max, what) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw invalidArgument(`${what} is a whole number from 0 to ${max}.`);
}
var checkU8 = (value, what) => checkUint(value, 255, what);
var checkU32 = (value, what) => checkUint(value, MAX_U32, what);
var checkSize = (value, what) => checkUint(value, Number.MAX_SAFE_INTEGER, what);
function checkId(value, what) {
  if (typeof value !== "bigint" || value < 0n || value > MAX_U64) throw invalidArgument(`${what} is 0 to 2^64 - 1.`);
}
function checkFixed(value, length, what) {
  if (!isBytes6(value, length)) throw invalidArgument(`${what} is ${length} bytes.`);
}
function checkHello(hello) {
  if (!hello || typeof hello !== "object") throw invalidArgument("A hello is required.");
  checkU8(hello.major, "A hello's major");
  checkU8(hello.minor, "A hello's minor");
  checkU32(hello.features, "A hello's features");
  checkUint(hello.maxRecord, NOISE_MAX_MESSAGE_BYTES, "A hello's largest record");
  if (hello.maxRecord < MIN_RECORD_BYTES) throw invalidArgument(`A hello's largest record is at least ${MIN_RECORD_BYTES}.`);
  checkU32(hello.pauseLimitSeconds, "A hello's pause limit");
  checkU32(hello.reconnectWindowSeconds, "A hello's reconnect window");
}
var writeHello = (w, hello) => w.u8(hello.major).u8(hello.minor).u32(hello.features).u32(hello.maxRecord).u32(hello.pauseLimitSeconds).u32(hello.reconnectWindowSeconds);
function readHello(r) {
  const hello = { major: r.u8(), minor: r.u8(), features: r.u32(), maxRecord: r.u32(), pauseLimitSeconds: r.u32(), reconnectWindowSeconds: r.u32() };
  if (hello.maxRecord < MIN_RECORD_BYTES || hello.maxRecord > NOISE_MAX_MESSAGE_BYTES) throw invalidMessage();
  return hello;
}
function encodeHello(hello) {
  checkHello(hello);
  return writeHello(new Writer(HELLO_BYTES), hello).done();
}
function decodeHello(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== HELLO_BYTES) throw invalidMessage();
  return readHello(new Reader(bytes, 0, invalidMessage));
}
function checkResult(result) {
  if (!result || typeof result !== "object") throw invalidArgument("A result is required.");
  checkFixed(result.commitId, ID_BYTES, "A result's commit ID");
  if (!ASSURANCES.includes(result.assurance)) throw invalidArgument("A result's assurance is saved or handed-off.");
  checkU32(result.fileCount, "A result's file count");
  checkSize(result.totalSize, "A result's total size");
  checkFixed(result.chain, SHA256_BYTES, "A result's chain");
}
var writeResult = (w, result) => w.raw(result.commitId).u8(ASSURANCES.indexOf(result.assurance) + 1).u32(result.fileCount).u64(result.totalSize).raw(result.chain);
function readResult(r) {
  const commitId = r.raw(ID_BYTES);
  const assurance = ASSURANCES[r.u8() - 1];
  if (!assurance) throw invalidMessage();
  return { commitId, assurance, fileCount: r.u32(), totalSize: r.size(), chain: r.raw(SHA256_BYTES) };
}
function checkFlag(value, what) {
  if (typeof value !== "boolean") throw invalidArgument(`${what} is true or false.`);
}
function encodeMessage(message) {
  const m = message;
  switch (m?.type) {
    case "bind":
      checkFixed(m.closeSecret, CLOSE_SECRET_BYTES, "BIND's close secret");
      checkHello(m.hello);
      return writeHello(new Writer(BIND_BYTES).u8(MESSAGE_TYPE.BIND).raw(m.closeSecret), m.hello).done();
    case "manifest": {
      checkUint(m.total, MAX_MANIFEST_BYTES, "A manifest's total");
      checkUint(m.offset, MAX_MANIFEST_BYTES, "A manifest fragment's offset");
      if (!(m.fragment instanceof Uint8Array) || m.fragment.byteLength < 1 || m.offset + m.fragment.byteLength > m.total) {
        throw invalidArgument("A manifest fragment is 1 byte or more, within the manifest's total.");
      }
      return new Writer(MANIFEST_HEADER_BYTES + m.fragment.byteLength).u8(MESSAGE_TYPE.MANIFEST).u32(m.total).u32(m.offset).raw(m.fragment).done();
    }
    case "accept":
      checkFixed(m.manifestHash, SHA256_BYTES, "ACCEPT's manifest hash");
      checkFixed(m.resumeSecret, RESUME_SECRET_BYTES, "ACCEPT's resume secret");
      checkSize(m.creditLimit, "ACCEPT's credit limit");
      if (!ASSURANCES.includes(m.sink)) throw invalidArgument("ACCEPT's sink is saved or handed-off.");
      return new Writer(74).u8(MESSAGE_TYPE.ACCEPT).raw(m.manifestHash).raw(m.resumeSecret).u64(m.creditLimit).u8(ASSURANCES.indexOf(m.sink) + 1).done();
    case "data":
      checkU32(m.fileIndex, "DATA's file index");
      checkSize(m.offset, "DATA's offset");
      if (!(m.bytes instanceof Uint8Array) || m.bytes.byteLength < 1) throw invalidArgument("DATA carries 1 byte or more.");
      return new Writer(DATA_HEADER_BYTES + m.bytes.byteLength).u8(MESSAGE_TYPE.DATA).u8(0).u32(m.fileIndex).u64(m.offset).raw(m.bytes).done();
    case "block-end":
      checkU32(m.fileIndex, "BLOCK_END's file index");
      checkSize(m.blockIndex, "BLOCK_END's block index");
      checkUint(m.length, BLOCK_BYTES, "BLOCK_END's length");
      checkFixed(m.hash, SHA256_BYTES, "BLOCK_END's hash");
      return new Writer(49).u8(MESSAGE_TYPE.BLOCK_END).u32(m.fileIndex).u64(m.blockIndex).u32(m.length).raw(m.hash).done();
    case "file-end":
      checkU32(m.fileIndex, "FILE_END's file index");
      checkSize(m.size, "FILE_END's size");
      checkSize(m.blockCount, "FILE_END's block count");
      checkFixed(m.chain, SHA256_BYTES, "FILE_END's chain");
      return new Writer(53).u8(MESSAGE_TYPE.FILE_END).u32(m.fileIndex).u64(m.size).u64(m.blockCount).raw(m.chain).done();
    case "credit":
      checkSize(m.revision, "CREDIT's revision");
      checkSize(m.limit, "CREDIT's limit");
      checkSize(m.consumed, "CREDIT's consumed");
      checkU32(m.filesDone, "CREDIT's files done");
      checkU32(m.verifiedFileIndex, "CREDIT's verified file index");
      checkSize(m.verifiedOffset, "CREDIT's verified offset");
      return new Writer(41).u8(MESSAGE_TYPE.CREDIT).u64(m.revision).u64(m.limit).u64(m.consumed).u32(m.filesDone).u32(m.verifiedFileIndex).u64(m.verifiedOffset).done();
    case "finish":
      checkU32(m.fileCount, "FINISH's file count");
      checkSize(m.totalSize, "FINISH's total size");
      checkFixed(m.manifestHash, SHA256_BYTES, "FINISH's manifest hash");
      checkFixed(m.chain, SHA256_BYTES, "FINISH's chain");
      return new Writer(77).u8(MESSAGE_TYPE.FINISH).u32(m.fileCount).u64(m.totalSize).raw(m.manifestHash).raw(m.chain).done();
    case "result":
      checkResult(m);
      return writeResult(new Writer(1 + RESULT_BODY_BYTES).u8(MESSAGE_TYPE.RESULT), m).done();
    case "result-ack":
      checkFixed(m.commitId, ID_BYTES, "RESULT_ACK's commit ID");
      return new Writer(17).u8(MESSAGE_TYPE.RESULT_ACK).raw(m.commitId).done();
    case "hold":
      checkFlag(m.held, "HOLD's held");
      if (m.reason !== "person" && m.reason !== "app") throw invalidArgument("HOLD's reason is person or app.");
      return new Writer(3).u8(MESSAGE_TYPE.HOLD).u8(m.held ? 1 : 0).u8(m.reason === "app" ? 2 : 1).done();
    case "close": {
      checkFixed(m.operationId, ID_BYTES, "CLOSE's operation ID");
      const reason = CLOSE_REASONS.indexOf(m.reason) + 1;
      if (reason === 0) throw invalidArgument("CLOSE's reason isn't one.");
      let detail = 0;
      if (m.detail !== void 0) {
        detail = CLOSE_DETAILS.indexOf(m.detail) + 1;
        if (detail === 0 || m.reason !== "FAILED") throw invalidArgument("CLOSE's detail is one of FAILED's.");
      }
      return new Writer(19).u8(MESSAGE_TYPE.CLOSE).raw(m.operationId).u8(reason).u8(detail).done();
    }
    case "close-ack": {
      checkFixed(m.operationId, ID_BYTES, "CLOSE_ACK's operation ID");
      checkFlag(m.finished, "CLOSE_ACK's finished");
      if (!m.finished) return new Writer(18).u8(MESSAGE_TYPE.CLOSE_ACK).raw(m.operationId).u8(0).done();
      checkResult(m.result);
      return writeResult(new Writer(18 + RESULT_BODY_BYTES).u8(MESSAGE_TYPE.CLOSE_ACK).raw(m.operationId).u8(1), m.result).done();
    }
    case "ping":
    case "pong":
      checkId(m.id, `${m.type.toUpperCase()}'s id`);
      return new Writer(9).u8(m.type === "ping" ? MESSAGE_TYPE.PING : MESSAGE_TYPE.PONG).u64(m.id).done();
    case "status": {
      checkId(m.id, "STATUS's id");
      if (m.kind === "ask") return new Writer(10).u8(MESSAGE_TYPE.STATUS).u8(1).u64(m.id).done();
      if (m.kind !== "answer") throw invalidArgument("STATUS is an ask or an answer.");
      checkU8(m.state, "STATUS's state");
      checkFlag(m.held, "STATUS's held");
      checkSize(m.consumed, "STATUS's consumed");
      if (m.result !== void 0) checkResult(m.result);
      const w = new Writer(m.result ? 21 + RESULT_BODY_BYTES : 21).u8(MESSAGE_TYPE.STATUS).u8(2).u64(m.id).u8(m.state).u8(m.held ? 1 : 0).u64(m.consumed).u8(m.result ? 1 : 0);
      return (m.result ? writeResult(w, m.result) : w).done();
    }
    default:
      throw invalidArgument("That isn't a record.");
  }
}
function flag(value) {
  if (value > 1) throw invalidMessage();
  return value === 1;
}
function decodeMessage(record) {
  if (!(record instanceof Uint8Array) || record.byteLength < 1) throw invalidMessage();
  const r = new Reader(record, 1, invalidMessage);
  const message = read(record[0], r);
  if (r.left !== 0) throw invalidMessage();
  return message;
}
function read(type, r) {
  switch (type) {
    case MESSAGE_TYPE.BIND:
      return { type: "bind", closeSecret: r.raw(CLOSE_SECRET_BYTES), hello: readHello(r) };
    case MESSAGE_TYPE.MANIFEST: {
      const total = r.u32();
      const offset = r.u32();
      const fragment = r.rest();
      if (total > MAX_MANIFEST_BYTES || fragment.byteLength < 1 || offset + fragment.byteLength > total) throw invalidMessage();
      return { type: "manifest", total, offset, fragment };
    }
    case MESSAGE_TYPE.ACCEPT: {
      const manifestHash2 = r.raw(SHA256_BYTES);
      const resumeSecret = r.raw(RESUME_SECRET_BYTES);
      const creditLimit = r.size();
      const sink = ASSURANCES[r.u8() - 1];
      if (!sink) throw invalidMessage();
      return { type: "accept", manifestHash: manifestHash2, resumeSecret, creditLimit, sink };
    }
    case MESSAGE_TYPE.DATA: {
      if (r.u8() !== 0) throw invalidMessage();
      const fileIndex = r.u32();
      const offset = r.size();
      if (r.left < 1) throw invalidMessage();
      return { type: "data", fileIndex, offset, bytes: r.rest() };
    }
    case MESSAGE_TYPE.BLOCK_END: {
      const fileIndex = r.u32();
      const blockIndex = r.size();
      const blockLength = r.u32();
      if (blockLength > BLOCK_BYTES) throw invalidMessage();
      return { type: "block-end", fileIndex, blockIndex, length: blockLength, hash: r.raw(SHA256_BYTES) };
    }
    case MESSAGE_TYPE.FILE_END:
      return { type: "file-end", fileIndex: r.u32(), size: r.size(), blockCount: r.size(), chain: r.raw(SHA256_BYTES) };
    case MESSAGE_TYPE.CREDIT:
      return {
        type: "credit",
        revision: r.size(),
        limit: r.size(),
        consumed: r.size(),
        filesDone: r.u32(),
        verifiedFileIndex: r.u32(),
        verifiedOffset: r.size()
      };
    case MESSAGE_TYPE.FINISH:
      return { type: "finish", fileCount: r.u32(), totalSize: r.size(), manifestHash: r.raw(SHA256_BYTES), chain: r.raw(SHA256_BYTES) };
    case MESSAGE_TYPE.RESULT:
      return { type: "result", ...readResult(r) };
    case MESSAGE_TYPE.RESULT_ACK:
      return { type: "result-ack", commitId: r.raw(ID_BYTES) };
    case MESSAGE_TYPE.HOLD:
      return { type: "hold", held: flag(r.u8()), reason: r.u8() === 2 ? "app" : "person" };
    case MESSAGE_TYPE.CLOSE: {
      const operationId = r.raw(ID_BYTES);
      const reason = CLOSE_REASONS[r.u8() - 1];
      const detail = CLOSE_DETAILS[r.u8() - 1];
      if (!reason) return { type: "close", operationId, reason: "FAILED" };
      return reason === "FAILED" && detail ? { type: "close", operationId, reason, detail } : { type: "close", operationId, reason };
    }
    case MESSAGE_TYPE.CLOSE_ACK: {
      const operationId = r.raw(ID_BYTES);
      const finished = flag(r.u8());
      return finished ? { type: "close-ack", operationId, finished, result: readResult(r) } : { type: "close-ack", operationId, finished };
    }
    case MESSAGE_TYPE.PING:
      return { type: "ping", id: r.u64() };
    case MESSAGE_TYPE.PONG:
      return { type: "pong", id: r.u64() };
    case MESSAGE_TYPE.STATUS: {
      const kind = r.u8();
      if (kind === 1) return { type: "status", kind: "ask", id: r.u64() };
      if (kind !== 2) throw invalidMessage();
      const id = r.u64();
      const state = r.u8();
      const held = flag(r.u8());
      const consumed = r.size();
      const hasResult = flag(r.u8());
      return hasResult ? { type: "status", kind: "answer", id, state, held, consumed, result: readResult(r) } : { type: "status", kind: "answer", id, state, held, consumed };
    }
    default:
      throw invalidMessage();
  }
}
var PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
function encodeManifest(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_MANIFEST_FILES) {
    throw invalidArgument(`A transfer offers 1 to ${MAX_MANIFEST_FILES} files.`);
  }
  let total = 0;
  let length = MANIFEST_START_BYTES;
  const parts = files.map((file, index) => {
    const { name, size, type } = file ?? {};
    validateFilename(name, { index });
    checkSize(size, "A file's size");
    total += size;
    if (!Number.isSafeInteger(total)) throw invalidArgument("The files add up to more than 2^53 - 1 bytes.");
    const nameBytes = encoder2.encode(name);
    const typeText = typeof type === "string" && type.length <= MAX_MEDIA_TYPE_BYTES && PRINTABLE_ASCII.test(type) ? type : "";
    length += 8 + 2 + nameBytes.byteLength + 1 + typeText.length;
    return { size, nameBytes, typeBytes: encoder2.encode(typeText) };
  });
  if (length > MAX_MANIFEST_BYTES) throw invalidArgument("The list of files is over 1 MiB.");
  const w = new Writer(length).u8(MANIFEST_VERSION).u32(BLOCK_BYTES).u32(files.length).u64(total);
  for (const { size, nameBytes, typeBytes } of parts) {
    w.u64(size).u16(nameBytes.byteLength).raw(nameBytes).u8(typeBytes.byteLength).raw(typeBytes);
  }
  return w.done();
}
function decodeManifest(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_MANIFEST_BYTES) throw invalidManifest();
  const r = new Reader(bytes, 0, invalidManifest);
  if (r.u8() !== MANIFEST_VERSION || r.u32() !== BLOCK_BYTES) throw invalidManifest();
  const count = r.u32();
  if (count < 1 || count > MAX_MANIFEST_FILES) throw invalidManifest();
  const totalSize = r.size();
  const files = [];
  let sum = 0;
  for (let index = 0; index < count; index++) {
    const size = r.size();
    const nameLength = r.u16();
    let name;
    try {
      name = strictDecoder.decode(r.raw(nameLength));
      validateFilename(name, { index, origin: "peer" });
    } catch {
      throw invalidManifest();
    }
    const typeLength = r.u8();
    if (typeLength > MAX_MEDIA_TYPE_BYTES) throw invalidManifest();
    const type = String.fromCharCode(...r.raw(typeLength));
    if (!PRINTABLE_ASCII.test(type)) throw invalidManifest();
    sum += size;
    files.push({ name, size, type });
  }
  if (r.left !== 0 || sum !== totalSize) throw invalidManifest();
  return { files, totalSize };
}
function manifestHash(provider, manifest) {
  const label = encoder2.encode(MANIFEST_LABEL);
  const input = new Uint8Array(label.byteLength + manifest.byteLength);
  input.set(label);
  input.set(manifest, label.byteLength);
  return provider.sha256(input);
}
function manifestFragmentBytes(recordBytes) {
  return recordBytes - NOISE_TAG_BYTES - MANIFEST_HEADER_BYTES;
}
function dataBytes(recordBytes) {
  return recordBytes - NOISE_TAG_BYTES - DATA_HEADER_BYTES;
}
function checkRecordBytes(recordBytes) {
  if (!Number.isInteger(recordBytes) || recordBytes < MIN_RECORD_BYTES || recordBytes > NOISE_MAX_MESSAGE_BYTES) {
    throw invalidArgument(`A record is ${MIN_RECORD_BYTES} to ${NOISE_MAX_MESSAGE_BYTES} bytes.`);
  }
}
function manifestRecords(manifest, recordBytes) {
  checkRecordBytes(recordBytes);
  const most = manifestFragmentBytes(recordBytes);
  const records = [];
  for (let offset = 0; offset < manifest.byteLength; offset += most) {
    records.push(encodeMessage({
      type: "manifest",
      total: manifest.byteLength,
      offset,
      fragment: manifest.subarray(offset, Math.min(manifest.byteLength, offset + most))
    }));
  }
  return records;
}
var _most, _bytes3, _received;
var ManifestAssembler = class {
  /** For records of `recordBytes`, with Noise's tag: the size both sides agreed. */
  constructor(recordBytes) {
    __privateAdd(this, _most);
    __privateAdd(this, _bytes3);
    __privateAdd(this, _received, 0);
    checkRecordBytes(recordBytes);
    __privateSet(this, _most, manifestFragmentBytes(recordBytes));
  }
  /** Whether the whole manifest has come. */
  get complete() {
    return __privateGet(this, _bytes3) !== void 0 && __privateGet(this, _received) === __privateGet(this, _bytes3).byteLength;
  }
  /** Takes one MANIFEST record's fields: the whole manifest once its last fragment is in, else undefined. */
  take(fragment) {
    const { total, offset } = fragment;
    const bytes = fragment.fragment;
    __privateGet(this, _bytes3) ?? __privateSet(this, _bytes3, new Uint8Array(total));
    const expected = Math.min(__privateGet(this, _most), total - __privateGet(this, _received));
    if (total !== __privateGet(this, _bytes3).byteLength || offset !== __privateGet(this, _received) || bytes.byteLength !== expected) throw invalidManifest();
    __privateGet(this, _bytes3).set(bytes, offset);
    __privateSet(this, _received, __privateGet(this, _received) + bytes.byteLength);
    return this.complete ? __privateGet(this, _bytes3) : void 0;
  }
};
_most = new WeakMap();
_bytes3 = new WeakMap();
_received = new WeakMap();
var u32Bytes = (n) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
};
var u64Bytes = (n) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n));
  return b;
};
function concat3(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}
function checkChain(chain) {
  checkFixed(chain, SHA256_BYTES, "A checkpoint");
}
function chainStart(provider, hashOfManifest) {
  checkFixed(hashOfManifest, SHA256_BYTES, "The manifest's hash");
  return provider.sha256(concat3(encoder2.encode(CHECKPOINT_LABEL), hashOfManifest));
}
function chainBlock(provider, chain, block) {
  checkChain(chain);
  checkU32(block.fileIndex, "A block's file index");
  checkSize(block.blockIndex, "A block's index");
  checkUint(block.length, BLOCK_BYTES, "A block's length");
  checkFixed(block.hash, SHA256_BYTES, "A block's hash");
  return provider.sha256(concat3(chain, Uint8Array.of(CHAIN_BLOCK), u32Bytes(block.fileIndex), u64Bytes(block.blockIndex), u32Bytes(block.length), block.hash));
}
function chainFileEnd(provider, chain, end) {
  checkChain(chain);
  checkU32(end.fileIndex, "A file's index");
  checkSize(end.size, "A file's size");
  checkSize(end.blockCount, "A file's block count");
  return provider.sha256(concat3(chain, Uint8Array.of(CHAIN_FILE_END), u32Bytes(end.fileIndex), u64Bytes(end.size), u64Bytes(end.blockCount)));
}
function blockCount(size) {
  checkSize(size, "A file's size");
  return Math.ceil(size / BLOCK_BYTES);
}

// src/dgdtp/prologue.ts
var FINGERPRINT_BYTES = 32;
var PROLOGUE_BYTES = 131;
var LABEL = new TextEncoder().encode("dropgate/4 dgdtp prologue");
var MODE_BYTE = Object.freeze({ link: 1, code: 2, resume: 3 });
var MAX_GENERATION = (1n << 64n) - 1n;
var SHA256_FINGERPRINT = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31}$/;
var invalid6 = (message) => new DropgateError({ code: "INVALID_ARGUMENT", message });
var insecure2 = () => new DropgateError({ code: "SECURITY_POLICY_MISMATCH" });
var isBytes7 = (value, length) => value instanceof Uint8Array && value.byteLength === length;
function sdpFingerprint(sdp) {
  if (typeof sdp !== "string") throw insecure2();
  let found;
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith("a=fingerprint:")) continue;
    const value = line.slice("a=fingerprint:".length).trim();
    const space = value.search(/[ \t]/);
    const hash = space < 0 ? value : value.slice(0, space);
    if (hash.toLowerCase() !== "sha-256") continue;
    const hex = space < 0 ? "" : value.slice(space).trim();
    if (!SHA256_FINGERPRINT.test(hex)) throw insecure2();
    const bytes = Uint8Array.from(hex.split(":"), (pair) => parseInt(pair, 16));
    if (found && !found.every((byte, i) => byte === bytes[i])) throw insecure2();
    found = bytes;
  }
  if (!found) throw insecure2();
  return found;
}
function buildPrologue(input) {
  const mode = input?.mode;
  if (!Object.prototype.hasOwnProperty.call(MODE_BYTE, mode)) throw invalid6("An attempt is by link, by code or a resume.");
  if (!isBytes7(input.roomNonce, CPACE_ROOM_NONCE_BYTES)) throw invalid6(`A room nonce is ${CPACE_ROOM_NONCE_BYTES} bytes.`);
  if (!isBytes7(input.attemptId, CPACE_ATTEMPT_ID_BYTES)) throw invalid6(`An attempt ID is ${CPACE_ATTEMPT_ID_BYTES} bytes.`);
  const { generation } = input;
  if (typeof generation !== "bigint" || generation < 0n || generation > MAX_GENERATION) throw invalid6("A generation is 0 to 2^64 - 1.");
  if (!isBytes7(input.receiverFingerprint, FINGERPRINT_BYTES) || !isBytes7(input.senderFingerprint, FINGERPRINT_BYTES)) {
    throw invalid6(`A fingerprint is ${FINGERPRINT_BYTES} bytes.`);
  }
  const major = input.major ?? PROTOCOLS.dgdtp.major;
  if (!Number.isInteger(major) || major < 0 || major > 255) throw invalid6("A DGDTP major is 0 to 255.");
  const out = new Uint8Array(PROLOGUE_BYTES);
  let at = 0;
  const put = (bytes) => {
    out.set(bytes, at);
    at += bytes.byteLength;
  };
  put(LABEL);
  put(Uint8Array.of(major, MODE_BYTE[mode]));
  put(input.roomNonce);
  put(input.attemptId);
  new DataView(out.buffer).setBigUint64(at, generation, false);
  at += 8;
  put(input.receiverFingerprint);
  put(input.senderFingerprint);
  return out;
}
function prologueFromSdp(input) {
  const { offer, answer, ...rest } = input ?? {};
  return buildPrologue({ ...rest, receiverFingerprint: sdpFingerprint(offer), senderFingerprint: sdpFingerprint(answer) });
}

// src/dgdtp/timers.ts
var monotonic = () => typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
var GLOBAL_TIMERS = Object.freeze({
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  now: monotonic
});
var HANDSHAKE_TIMEOUT_MS = 15e3;
var ICE_TIMEOUT_MS = 3e4;
var SETUP_TIMEOUT_MS = 9e4;
var OFFER_TIMEOUT_MS = 6e5;
var PING_INTERVAL_MS = 5e3;
var MIN_NO_ANSWER_MS = 15e3;
var NO_ANSWER_RTTS = 6;
var NO_PROGRESS_MS = 3e4;
var STALL_SHOWN_MS = 3e4;
var STALL_FAILED_MS = 12e4;
var CLOSE_ACK_WAIT_MS = 2e3;
var LATE_CLOSE_WAIT_MS = 2e3;
var _timers, _due, _run, _id, _at3, _Deadline_instances, fire_fn;
var Deadline = class {
  constructor(timers, due, run) {
    __privateAdd(this, _Deadline_instances);
    __privateAdd(this, _timers);
    __privateAdd(this, _due);
    __privateAdd(this, _run);
    __privateAdd(this, _id);
    __privateAdd(this, _at3);
    __privateSet(this, _timers, timers);
    __privateSet(this, _due, due);
    __privateSet(this, _run, run);
  }
  /** Arms the timer for `due()`, unless it's already armed for then or sooner. */
  arm() {
    const at = __privateGet(this, _due).call(this);
    if (at === void 0) {
      this.stop();
      return;
    }
    if (__privateGet(this, _at3) !== void 0 && __privateGet(this, _at3) <= at) return;
    this.stop();
    __privateSet(this, _at3, at);
    __privateSet(this, _id, __privateGet(this, _timers).setTimeout(() => __privateMethod(this, _Deadline_instances, fire_fn).call(this), Math.max(0, at - __privateGet(this, _timers).now())));
  }
  stop() {
    if (__privateGet(this, _at3) !== void 0) __privateGet(this, _timers).clearTimeout(__privateGet(this, _id));
    __privateSet(this, _at3, void 0);
    __privateSet(this, _id, void 0);
  }
};
_timers = new WeakMap();
_due = new WeakMap();
_run = new WeakMap();
_id = new WeakMap();
_at3 = new WeakMap();
_Deadline_instances = new WeakSet();
fire_fn = function() {
  __privateSet(this, _at3, void 0);
  __privateSet(this, _id, void 0);
  const at = __privateGet(this, _due).call(this);
  if (at === void 0) return;
  if (at > __privateGet(this, _timers).now()) {
    this.arm();
    return;
  }
  __privateGet(this, _run).call(this);
};

// src/dgdtp/seal.ts
var SIGNAL_KIND = 16;
var CLOSE_KIND = 17;
var FRAME_HEADER_BYTES = 22;
var TAG_BYTES2 = 16;
var SMALL_BUCKET_BYTES = 512;
var SDP_BUCKET_BYTES = 2048;
var LARGE_BUCKET_BYTES = 8192;
var MAX_FRAME_BYTES = FRAME_HEADER_BYTES + LARGE_BUCKET_BYTES + TAG_BYTES2;
var MAX_FRAMES_EACH_WAY = 4096;
var INSIDE_HEADER_BYTES = 3;
var MAX_CLOSE_BODY_BYTES = SMALL_BUCKET_BYTES - INSIDE_HEADER_BYTES;
var AD_LABEL = new TextEncoder().encode("dropgate/4 dgdtp signal");
var ROOM_NONCE_BYTES = 16;
var ATTEMPT_ID_BYTES = 16;
var DIRECTION = { receiver: 1, sender: 2 };
var TYPE = { offer: 1, answer: 2, candidate: 3, "end-of-candidates": 4, restart: 5, close: 6 };
var NO_LINE_INDEX = 65535;
var SENT_BY = Object.freeze({
  offer: ["receiver"],
  answer: ["sender"],
  candidate: ["receiver", "sender"],
  "end-of-candidates": ["receiver", "sender"],
  restart: ["sender"]
});
var TYPE_NAMES = new Map(
  Object.keys(SENT_BY).map((name) => [TYPE[name], name])
);
var invalid7 = (message) => new DropgateError({ code: "INVALID_ARGUMENT", message });
var insecure3 = () => new DropgateError({ code: "SECURITY_POLICY_MISMATCH" });
var tooMany = () => new DropgateError({
  code: "SECURITY_POLICY_MISMATCH",
  origin: "local",
  message: "Setting up this connection took too many messages, so it was closed."
});
var encoder3 = new TextEncoder();
var decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function bucketFor(type, length) {
  if (type === TYPE.offer || type === TYPE.answer) {
    if (length <= SDP_BUCKET_BYTES) return SDP_BUCKET_BYTES;
    return length <= LARGE_BUCKET_BYTES ? LARGE_BUCKET_BYTES : void 0;
  }
  return length <= SMALL_BUCKET_BYTES ? SMALL_BUCKET_BYTES : void 0;
}
function inside(type, body) {
  const bucket = bucketFor(type, INSIDE_HEADER_BYTES + body.byteLength);
  if (bucket === void 0) {
    throw invalid7(type === TYPE.offer || type === TYPE.answer ? `An offer or answer is at most ${LARGE_BUCKET_BYTES - INSIDE_HEADER_BYTES} bytes.` : `That message is at most ${SMALL_BUCKET_BYTES - INSIDE_HEADER_BYTES} bytes.`);
  }
  const out = new Uint8Array(bucket);
  out[0] = type;
  new DataView(out.buffer).setUint16(1, body.byteLength, false);
  out.set(body, INSIDE_HEADER_BYTES);
  return out;
}
function lv(value) {
  const bytes = encoder3.encode(value ?? "");
  const out = new Uint8Array(2 + bytes.byteLength);
  new DataView(out.buffer).setUint16(0, bytes.byteLength, false);
  out.set(bytes, 2);
  return out;
}
var concat4 = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
};
var isText = (value) => typeof value === "string";
var isTextOrNull = (value) => value === null || typeof value === "string";
function encode(message, role) {
  const name = message?.type;
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(SENT_BY, name)) throw invalid7("That isn't a signalling message.");
  const type = name;
  if (!SENT_BY[type].includes(role)) throw invalid7(`The ${role} doesn't send that signalling message.`);
  switch (message.type) {
    case "offer":
    case "answer":
      if (!isText(message.sdp)) throw invalid7("An offer or answer is its SDP.");
      return { type: TYPE[type], body: encoder3.encode(message.sdp) };
    case "candidate": {
      const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = message;
      if (!isText(candidate) || !isTextOrNull(sdpMid) || !isTextOrNull(usernameFragment)) throw invalid7("A candidate is its string, sdpMid and usernameFragment.");
      if (sdpMLineIndex !== null && !(Number.isInteger(sdpMLineIndex) && sdpMLineIndex >= 0 && sdpMLineIndex < NO_LINE_INDEX)) {
        throw invalid7(`A candidate's sdpMLineIndex is 0 to ${NO_LINE_INDEX - 1}, or null.`);
      }
      const index = new Uint8Array(2);
      new DataView(index.buffer).setUint16(0, sdpMLineIndex ?? NO_LINE_INDEX, false);
      return { type: TYPE.candidate, body: concat4(lv(candidate), lv(sdpMid), index, lv(usernameFragment)) };
    }
    default:
      return { type: TYPE[type], body: new Uint8Array(0) };
  }
}
function readLv(body, at) {
  if (at + 2 > body.byteLength) throw insecure3();
  const length = new DataView(body.buffer, body.byteOffset).getUint16(at, false);
  const next = at + 2 + length;
  if (next > body.byteLength) throw insecure3();
  return { value: length === 0 ? null : utf82(body.subarray(at + 2, next)), next };
}
function utf82(bytes) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw insecure3();
  }
}
function readInside(padded) {
  const type = padded[0];
  const length = new DataView(padded.buffer, padded.byteOffset).getUint16(1, false);
  const end = INSIDE_HEADER_BYTES + length;
  if (bucketFor(type, end) !== padded.byteLength) throw insecure3();
  for (let i = end; i < padded.byteLength; i++) if (padded[i] !== 0) throw insecure3();
  return { type, body: padded.slice(INSIDE_HEADER_BYTES, end) };
}
function decode(type, body, from) {
  const name = TYPE_NAMES.get(type);
  if (!name || !SENT_BY[name].includes(from)) throw insecure3();
  switch (name) {
    case "offer":
    case "answer":
      return { type: name, sdp: utf82(body) };
    case "candidate": {
      const candidate = readLv(body, 0);
      const sdpMid = readLv(body, candidate.next);
      if (sdpMid.next + 2 > body.byteLength) throw insecure3();
      const index = new DataView(body.buffer, body.byteOffset).getUint16(sdpMid.next, false);
      const usernameFragment = readLv(body, sdpMid.next + 2);
      if (usernameFragment.next !== body.byteLength) throw insecure3();
      return {
        type: "candidate",
        candidate: candidate.value ?? "",
        sdpMid: sdpMid.value,
        sdpMLineIndex: index === NO_LINE_INDEX ? null : index,
        usernameFragment: usernameFragment.value
      };
    }
    default:
      if (body.byteLength !== 0) throw insecure3();
      return { type: name };
  }
}
function header(way, counter) {
  const out = new Uint8Array(FRAME_HEADER_BYTES);
  out[0] = way.kind;
  out[1] = way.direction;
  out.set(way.attemptId, 2);
  new DataView(out.buffer).setUint32(18, counter, false);
  return out;
}
function associatedData2(way, counter) {
  const tail = new Uint8Array(6);
  tail[0] = way.direction;
  new DataView(tail.buffer).setUint32(1, counter, false);
  tail[5] = way.kind;
  return concat4(AD_LABEL, way.roomNonce, way.attemptId, tail);
}
function nonceOf2(counter) {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setUint32(8, counter, false);
  return nonce;
}
async function sealFrame(provider, key, way, counter, padded) {
  try {
    return concat4(header(way, counter), await provider.encryptWithNonce(key, nonceOf2(counter), padded, associatedData2(way, counter)));
  } finally {
    padded.fill(0);
  }
}
var frameSize = (frame) => [SMALL_BUCKET_BYTES, SDP_BUCKET_BYTES, LARGE_BUCKET_BYTES].some((bucket) => frame.byteLength === FRAME_HEADER_BYTES + bucket + TAG_BYTES2);
async function openFrame(provider, key, way, counter, frame) {
  if (!frameSize(frame)) throw insecure3();
  const expected = header(way, counter);
  for (let i = 0; i < FRAME_HEADER_BYTES; i++) if (frame[i] !== expected[i]) throw insecure3();
  try {
    return await provider.decryptWithNonce(key, nonceOf2(counter), frame.subarray(FRAME_HEADER_BYTES), associatedData2(way, counter));
  } catch {
    throw insecure3();
  }
}
function queue(onFail) {
  let tail = Promise.resolve();
  let closed = false;
  const close = () => {
    closed = true;
    onFail();
  };
  const next = (step) => {
    const run = tail.then(async () => {
      if (closed) throw insecure3();
      try {
        return await step();
      } catch (err) {
        close();
        throw err;
      }
    });
    tail = run.then(() => void 0, () => void 0);
    return run;
  };
  return { next, close, get closed() {
    return closed;
  } };
}
var otherSide = (role) => role === "receiver" ? "sender" : "receiver";
function checkRole(role) {
  if (role !== "receiver" && role !== "sender") throw invalid7("A side is the receiver or the sender.");
}
function signalChannel(provider, options) {
  const { keys, role } = options ?? {};
  checkRole(role);
  if (!keys || typeof keys !== "object" || !("sealR2S" in keys)) throw invalid7("Signalling is sealed under an attempt's keys.");
  let sendKey = role === "receiver" ? keys.sealR2S : keys.sealS2R;
  let receiveKey = role === "receiver" ? keys.sealS2R : keys.sealR2S;
  const ctx = { roomNonce: keys.roomNonce, attemptId: keys.attemptId, kind: SIGNAL_KIND };
  const out = { ...ctx, direction: DIRECTION[role] };
  const into = { ...ctx, direction: DIRECTION[otherSide(role)] };
  const abortMayCome = keys.mode === "code" && role === "receiver";
  let sent = 0;
  let received = 0;
  const letGo = () => {
    sendKey = void 0;
    receiveKey = void 0;
  };
  const sending = queue(letGo);
  const receiving = queue(letGo);
  const end = () => {
    sending.close();
    receiving.close();
  };
  return Object.freeze({
    seal(message) {
      if (sending.closed) return Promise.reject(insecure3());
      let padded;
      try {
        const { type, body } = encode(message, role);
        padded = inside(type, body);
        body.fill(0);
      } catch (err) {
        return Promise.reject(err);
      }
      if (sent >= MAX_FRAMES_EACH_WAY) {
        padded.fill(0);
        end();
        return Promise.reject(tooMany());
      }
      const counter = sent++;
      return sending.next(async () => {
        try {
          return await sealFrame(provider, sendKey, out, counter, padded);
        } catch (err) {
          end();
          throw err;
        }
      });
    },
    open(frame) {
      const copy = frame instanceof Uint8Array ? new Uint8Array(frame) : void 0;
      return receiving.next(async () => {
        try {
          if (abortMayCome && received === 0) checkCpaceAbort(copy);
          if (!copy || received >= MAX_FRAMES_EACH_WAY) throw insecure3();
          const padded = await openFrame(provider, receiveKey, into, received, copy);
          try {
            const { type, body } = readInside(padded);
            const message = decode(type, body, otherSide(role));
            received += 1;
            return message;
          } finally {
            padded.fill(0);
          }
        } catch (err) {
          end();
          throw err;
        }
      });
    },
    get sent() {
      return sent;
    },
    get received() {
      return received;
    },
    close: end
  });
}
function closeChannel(provider, options) {
  const { keys, role } = options ?? {};
  checkRole(role);
  if (!keys || typeof keys !== "object" || !("closeR2S" in keys)) throw invalid7("A close is sealed under the close keys.");
  const sendKey = role === "receiver" ? keys.closeR2S : keys.closeS2R;
  const receiveKey = role === "receiver" ? keys.closeS2R : keys.closeR2S;
  const ctx = { roomNonce: new Uint8Array(keys.roomNonce), attemptId: new Uint8Array(keys.attemptId), kind: CLOSE_KIND };
  if (ctx.roomNonce.byteLength !== ROOM_NONCE_BYTES || ctx.attemptId.byteLength !== ATTEMPT_ID_BYTES) throw invalid7("A close is for one attempt.");
  const out = { ...ctx, direction: DIRECTION[role] };
  const into = { ...ctx, direction: DIRECTION[otherSide(role)] };
  let sealed = false;
  let opened = false;
  return Object.freeze({
    async seal(body) {
      if (!(body instanceof Uint8Array)) throw invalid7("A close's body is bytes.");
      if (body.byteLength > MAX_CLOSE_BODY_BYTES) throw invalid7(`A close's body is at most ${MAX_CLOSE_BODY_BYTES} bytes.`);
      if (sealed) throw invalid7("A connection has one close each way.");
      sealed = true;
      return sealFrame(provider, sendKey, out, 0, inside(TYPE.close, body));
    },
    async open(frame) {
      if (opened || !(frame instanceof Uint8Array)) return void 0;
      let padded;
      try {
        padded = await openFrame(provider, receiveKey, into, 0, new Uint8Array(frame));
      } catch {
        return void 0;
      }
      try {
        const { type, body } = readInside(padded);
        if (type !== TYPE.close || opened) return void 0;
        opened = true;
        return body;
      } catch {
        return void 0;
      } finally {
        padded.fill(0);
      }
    }
  });
}

// src/dgdtp/channel.ts
var DEFAULT_RECONNECT_WINDOW_SECONDS = 120;
var DATA_ABORT = Uint8Array.of(0);
var BIND_HELLO_AT = 1 + CLOSE_SECRET_BYTES;
var CODE_MISMATCH_WORDING = Object.freeze({
  receiver: "That code didn't match. Ask the sender for the new one.",
  sender: "Someone entered the wrong code. Here's a new one."
});
var invalid8 = (message) => new DropgateError({ code: "INVALID_ARGUMENT", message });
var insecure4 = () => new DropgateError({ code: "SECURITY_POLICY_MISMATCH" });
var lost = () => new DropgateError({ code: "CONNECTION_LOST" });
var couldntConnect = () => new DropgateError({ code: "TIMED_OUT", message: "Couldn't connect to the other device." });
var isBytes8 = (value, length) => value instanceof Uint8Array && value.byteLength === length;
function checkHello2(options) {
  if (options !== void 0 && (options === null || typeof options !== "object")) throw invalid8("A hello is its options.");
  const o = options ?? {};
  const fields = {
    major: o.major ?? PROTOCOLS.dgdtp.major,
    minor: o.minor ?? PROTOCOLS.dgdtp.minor,
    features: 0,
    pauseLimitSeconds: o.pauseLimitSeconds ?? 0,
    reconnectWindowSeconds: o.reconnectWindowSeconds ?? DEFAULT_RECONNECT_WINDOW_SECONDS
  };
  encodeHello({ ...fields, maxRecord: MIN_RECORD_BYTES });
  return fields;
}
function checkMajor(major, ownMajor, role) {
  if (major !== void 0 && major !== ownMajor) throw otherVersion(role, ownMajor, major);
}
function senderHelloOf(bytes, ownMajor) {
  checkMajor(bytes[0], ownMajor, "receiver");
  try {
    return decodeHello(bytes);
  } catch {
    throw insecure4();
  }
}
function otherVersion(role, own2, theirs) {
  const other = role === "receiver" ? "sender" : "receiver";
  const older = theirs < own2;
  return new DropgateError({
    code: "VERSION_UNSUPPORTED",
    origin: "peer",
    message: older ? `Update required: the ${other} is using an older version of Dropgate. They need to update.` : `Update required: the ${other} is using a newer version of Dropgate. Update this app to ${role === "receiver" ? "receive from" : "send to"} them.`,
    details: { component: "dgdtp", update: older ? "peer" : "client" }
  });
}
function checkPeer(peer) {
  if (!peer || typeof peer.dataChannel !== "function") throw invalid8("A direct transfer needs a peer connection.");
}
function checkPipe(pipe) {
  if (!pipe || typeof pipe.receive !== "function" || typeof pipe.send !== "function") {
    throw invalid8("An attempt needs the rendezvous's pipe.");
  }
}
function roomNonceOf(value) {
  if (!isBytes8(value, CPACE_ROOM_NONCE_BYTES)) throw new DropgateError({ code: "INVALID_RESPONSE" });
  return new Uint8Array(value);
}
function nextGeneration(previous) {
  if (typeof previous !== "bigint" || previous < 0n || previous >= MAX_GENERATION) throw invalid8("A previous generation is 0 to 2^64 - 2.");
  return previous + 1n;
}
var _provider5, _role, _pipe, _peer, _generation, _timers2, _keys, _signal, _close, _transport, _data, _maxRecord, _error, _ended, _handedOver, _lingering, _timer2, _outgoing, _offer, _answer, _earlyCandidates, _fail2, _failed, _closeBody, _Attempt_instances, race_fn, next_fn2, sendSignal_fn, within_fn, sendCandidate_fn, described_fn, readPipe_fn, take_fn, answerOffer_fn, prologue_fn, openData_fn, closeKeys_fn, opened_fn, release_fn;
var Attempt = class {
  constructor(provider, role, keys, pipe, peer, generation, timers) {
    __privateAdd(this, _Attempt_instances);
    __privateAdd(this, _provider5);
    __privateAdd(this, _role);
    __privateAdd(this, _pipe);
    __privateAdd(this, _peer);
    __privateAdd(this, _generation);
    __privateAdd(this, _timers2);
    __privateAdd(this, _keys);
    __privateAdd(this, _signal);
    __privateAdd(this, _close);
    __privateAdd(this, _transport);
    __privateAdd(this, _data);
    __privateAdd(this, _maxRecord, 0);
    __privateAdd(this, _error);
    __privateAdd(this, _ended, false);
    /** The channel was handed over: its owner closes it. */
    __privateAdd(this, _handedOver, false);
    /** Ended by the data channel going, with the pipe and the close keys kept for a late out-of-band close. */
    __privateAdd(this, _lingering, false);
    /** ICE's timer, then the handshake's. */
    __privateAdd(this, _timer2);
    __privateAdd(this, _outgoing, Promise.resolve());
    __privateAdd(this, _offer);
    __privateAdd(this, _answer);
    /**
     * This side's candidates found before its own offer or answer has gone:
     * some stacks (libdatachannel, under node-datachannel) start gathering as
     * the description is made, before it's applied. They're sent just after it,
     * so the first frame each way is always the offer or the answer.
     */
    __privateAdd(this, _earlyCandidates, []);
    __privateAdd(this, _fail2);
    __privateAdd(this, _failed);
    __privateAdd(this, _closeBody);
    __publicField(this, "closeReceived");
    __privateSet(this, _provider5, provider);
    __privateSet(this, _role, role);
    __privateSet(this, _keys, keys);
    __privateSet(this, _pipe, pipe);
    __privateSet(this, _peer, peer);
    __privateSet(this, _generation, generation);
    __privateSet(this, _timers2, timers);
    __privateSet(this, _signal, signalChannel(provider, { keys, role }));
    __privateSet(this, _failed, new Promise((_, reject) => {
      __privateSet(this, _fail2, reject);
    }));
    __privateGet(this, _failed).catch(() => void 0);
    this.closeReceived = new Promise((resolve) => {
      __privateSet(this, _closeBody, resolve);
    });
  }
  /** Starts the attempt's signalling: local candidates as they come, and the pipe's frames as they arrive. ICE has 30 s. */
  start(first) {
    __privateMethod(this, _Attempt_instances, within_fn).call(this, ICE_TIMEOUT_MS);
    __privateGet(this, _peer).onIceCandidate((candidate) => {
      if (__privateGet(this, _earlyCandidates)) __privateGet(this, _earlyCandidates).push(candidate);
      else __privateMethod(this, _Attempt_instances, sendCandidate_fn).call(this, candidate);
    });
    void __privateMethod(this, _Attempt_instances, readPipe_fn).call(this, first);
  }
  /** The receiver's offer, sealed first (counter 0), then applied. */
  async offer() {
    const sdp = await __privateMethod(this, _Attempt_instances, race_fn).call(this, __privateGet(this, _peer).createOffer());
    __privateSet(this, _offer, sdp);
    __privateMethod(this, _Attempt_instances, sendSignal_fn).call(this, { type: "offer", sdp });
    __privateMethod(this, _Attempt_instances, described_fn).call(this);
    await __privateMethod(this, _Attempt_instances, race_fn).call(this, __privateGet(this, _peer).setLocalDescription({ type: "offer", sdp }));
  }
  /**
   * The receiver's handshake and BIND, over the data channel: its hello says
   * the largest record its data channel takes. The sender's hello is checked
   * once BIND has gone, so a sender of another major hears this side's too.
   */
  async receiverHandshake(fields) {
    const data = await __privateMethod(this, _Attempt_instances, openData_fn).call(this);
    const prologue = __privateMethod(this, _Attempt_instances, prologue_fn).call(this);
    const keys = __privateGet(this, _keys);
    const initiator = await keys.usePsk((psk) => noiseInitiator(__privateGet(this, _provider5), { prologue, psk }));
    data.send(await __privateMethod(this, _Attempt_instances, race_fn).call(this, initiator.writeMessage1()));
    const { payload, transport } = await __privateMethod(this, _Attempt_instances, race_fn).call(this, initiator.readMessage2(await __privateMethod(this, _Attempt_instances, next_fn2).call(this, data)));
    __privateSet(this, _transport, transport);
    const closeSecret = __privateGet(this, _provider5).randomBytes(CLOSE_SECRET_BYTES);
    const hello = { ...fields, maxRecord: __privateGet(this, _maxRecord) };
    const bind = encodeMessage({ type: "bind", closeSecret, hello });
    try {
      data.send(await __privateMethod(this, _Attempt_instances, race_fn).call(this, transport.encrypt(bind)));
      await __privateMethod(this, _Attempt_instances, closeKeys_fn).call(this, closeSecret);
    } finally {
      bind.fill(0);
      closeSecret.fill(0);
    }
    return __privateMethod(this, _Attempt_instances, opened_fn).call(this, senderHelloOf(payload, fields.major), hello);
  }
  /**
   * The sender's handshake, its hello in Noise's second message, then the
   * receiver's BIND, over the data channel. A BIND whose hello says another
   * major is VERSION_UNSUPPORTED; a first record that isn't exactly a BIND,
   * SECURITY_POLICY_MISMATCH.
   */
  async senderHandshake(fields) {
    const data = await __privateMethod(this, _Attempt_instances, openData_fn).call(this);
    const prologue = __privateMethod(this, _Attempt_instances, prologue_fn).call(this);
    const keys = __privateGet(this, _keys);
    const responder = await keys.usePsk((psk) => noiseResponder(__privateGet(this, _provider5), { prologue, psk }));
    const payload1 = await __privateMethod(this, _Attempt_instances, race_fn).call(this, responder.readMessage1(await __privateMethod(this, _Attempt_instances, next_fn2).call(this, data)));
    if (payload1.byteLength !== 0) throw insecure4();
    const hello = { ...fields, maxRecord: __privateGet(this, _maxRecord) };
    const { message, transport } = await __privateMethod(this, _Attempt_instances, race_fn).call(this, responder.writeMessage2(encodeHello(hello)));
    __privateSet(this, _transport, transport);
    data.send(message);
    const bind = await __privateMethod(this, _Attempt_instances, race_fn).call(this, transport.decrypt(await __privateMethod(this, _Attempt_instances, next_fn2).call(this, data)));
    try {
      if (bind[0] !== MESSAGE_TYPE.BIND) throw insecure4();
      checkMajor(bind[BIND_HELLO_AT], fields.major, "sender");
      let read2;
      try {
        read2 = decodeMessage(bind);
      } catch {
        throw insecure4();
      }
      try {
        await __privateMethod(this, _Attempt_instances, closeKeys_fn).call(this, read2.closeSecret);
      } finally {
        read2.closeSecret.fill(0);
      }
      return __privateMethod(this, _Attempt_instances, opened_fn).call(this, read2.hello, hello);
    } finally {
      bind.fill(0);
    }
  }
  /**
   * Ends the attempt, once: every key let go, the data channel told (an empty
   * message) when its handshake or records went wrong, then everything closed.
   * Gives the attempt's error: the first one, as the screens should say it.
   */
  end(err) {
    if (__privateGet(this, _ended)) return __privateGet(this, _error) ?? insecure4();
    __privateSet(this, _ended, true);
    __privateGet(this, _timers2).clearTimeout(__privateGet(this, _timer2));
    __privateSet(this, _timer2, void 0);
    const error = err === void 0 ? new DropgateError({ code: "OPERATION_CANCELLED" }) : errorFor(err, __privateGet(this, _role));
    __privateSet(this, _error, error);
    if (__privateGet(this, _data) && error.code === "SECURITY_POLICY_MISMATCH") {
      try {
        __privateGet(this, _data).send(DATA_ABORT);
      } catch {
      }
    }
    __privateSet(this, _lingering, __privateGet(this, _handedOver) && error.code === "CONNECTION_LOST" && __privateGet(this, _close) !== void 0);
    __privateGet(this, _keys)?.forget();
    __privateSet(this, _keys, void 0);
    __privateGet(this, _signal)?.close();
    __privateSet(this, _signal, void 0);
    if (!__privateGet(this, _lingering)) __privateSet(this, _close, void 0);
    __privateGet(this, _transport)?.close();
    __privateSet(this, _transport, void 0);
    const closes = __privateGet(this, _lingering) ? [() => __privateGet(this, _data)?.close(), () => __privateGet(this, _peer).close()] : [() => __privateGet(this, _data)?.close(), () => __privateGet(this, _pipe).close(), () => __privateGet(this, _peer).close()];
    for (const close of closes) {
      try {
        close();
      } catch {
      }
    }
    __privateGet(this, _fail2).call(this, error);
    return error;
  }
};
_provider5 = new WeakMap();
_role = new WeakMap();
_pipe = new WeakMap();
_peer = new WeakMap();
_generation = new WeakMap();
_timers2 = new WeakMap();
_keys = new WeakMap();
_signal = new WeakMap();
_close = new WeakMap();
_transport = new WeakMap();
_data = new WeakMap();
_maxRecord = new WeakMap();
_error = new WeakMap();
_ended = new WeakMap();
_handedOver = new WeakMap();
_lingering = new WeakMap();
_timer2 = new WeakMap();
_outgoing = new WeakMap();
_offer = new WeakMap();
_answer = new WeakMap();
_earlyCandidates = new WeakMap();
_fail2 = new WeakMap();
_failed = new WeakMap();
_closeBody = new WeakMap();
_Attempt_instances = new WeakSet();
/** `promise`, or the attempt's failure if that comes first. */
race_fn = function(promise) {
  return Promise.race([promise, __privateGet(this, _failed)]);
};
next_fn2 = async function(pipe) {
  let message;
  try {
    message = await __privateMethod(this, _Attempt_instances, race_fn).call(this, pipe.receive());
  } catch (err) {
    if (__privateGet(this, _error)) throw __privateGet(this, _error);
    throw pipeError(err);
  }
  if (!(message instanceof Uint8Array)) throw insecure4();
  return message;
};
/** Seals `message` now, so its counter is the next, and sends it once every earlier frame has gone. */
sendSignal_fn = function(message) {
  const signal = __privateGet(this, _signal);
  if (!signal || __privateGet(this, _ended)) return;
  const sealed = signal.seal(message);
  __privateSet(this, _outgoing, __privateGet(this, _outgoing).then(() => sealed).then((frame) => {
    if (!__privateGet(this, _ended)) __privateGet(this, _pipe).send(frame);
  }).catch((err) => this.end(err)));
};
/** `ms` from now the attempt ends TIMED_OUT, unless the next step has re-armed or cleared the timer. */
within_fn = function(ms) {
  __privateGet(this, _timers2).clearTimeout(__privateGet(this, _timer2));
  __privateSet(this, _timer2, __privateGet(this, _timers2).setTimeout(() => {
    this.end(couldntConnect());
  }, ms));
};
/** One of this side's candidates, or the end of them, sealed and sent. */
sendCandidate_fn = function(candidate) {
  __privateMethod(this, _Attempt_instances, sendSignal_fn).call(this, candidate === null ? { type: "end-of-candidates" } : { type: "candidate", ...candidateOf(candidate) });
};
/** This side's offer or answer has gone: the candidates found before it follow, in order, and the rest as they come. */
described_fn = function() {
  const early = __privateGet(this, _earlyCandidates) ?? [];
  __privateSet(this, _earlyCandidates, void 0);
  for (const candidate of early) __privateMethod(this, _Attempt_instances, sendCandidate_fn).call(this, candidate);
};
readPipe_fn = async function(first) {
  let frame = first;
  for (; ; ) {
    if (frame === void 0) {
      try {
        frame = await __privateGet(this, _pipe).receive();
      } catch (err) {
        if (!__privateGet(this, _data)) this.end(pipeError(err));
        return;
      }
    }
    if (__privateGet(this, _ended)) {
      if (!__privateGet(this, _lingering)) return;
      if (frame[0] !== CLOSE_KIND) {
        frame = void 0;
        continue;
      }
    }
    try {
      await __privateMethod(this, _Attempt_instances, take_fn).call(this, frame);
    } catch (err) {
      this.end(err);
      return;
    }
    frame = void 0;
  }
};
take_fn = async function(frame) {
  if (frame instanceof Uint8Array && frame.byteLength > 0 && frame[0] === CLOSE_KIND) {
    const body = __privateGet(this, _close) ? await __privateGet(this, _close).open(frame) : void 0;
    if (body) __privateGet(this, _closeBody).call(this, body);
    return;
  }
  const signal = __privateGet(this, _signal);
  if (!signal) throw insecure4();
  const first = signal.received === 0;
  const message = await signal.open(frame);
  if (__privateGet(this, _role) === "sender") {
    if (first !== (message.type === "offer")) throw insecure4();
  } else if (first !== (message.type === "answer")) {
    throw insecure4();
  }
  switch (message.type) {
    case "offer":
      await __privateMethod(this, _Attempt_instances, answerOffer_fn).call(this, message.sdp);
      break;
    case "answer":
      __privateSet(this, _answer, message.sdp);
      await __privateGet(this, _peer).setRemoteDescription({ type: "answer", sdp: message.sdp });
      break;
    case "candidate":
    case "end-of-candidates":
      try {
        await __privateGet(this, _peer).addIceCandidate(message.type === "candidate" ? candidateOf(message) : null);
      } catch {
      }
      break;
    default:
      break;
  }
};
answerOffer_fn = async function(offer) {
  __privateSet(this, _offer, offer);
  await __privateGet(this, _peer).setRemoteDescription({ type: "offer", sdp: offer });
  const sdp = await __privateGet(this, _peer).createAnswer();
  __privateSet(this, _answer, sdp);
  __privateMethod(this, _Attempt_instances, sendSignal_fn).call(this, { type: "answer", sdp });
  __privateMethod(this, _Attempt_instances, described_fn).call(this);
  await __privateGet(this, _peer).setLocalDescription({ type: "answer", sdp });
};
/**
 * The prologue, once the data channel is open: both SDPs are known by then
 * (one that somehow isn't fails the fingerprint rule, SECURITY_POLICY_MISMATCH).
 */
prologue_fn = function() {
  const keys = __privateGet(this, _keys);
  return prologueFromSdp({
    mode: keys.mode,
    roomNonce: keys.roomNonce,
    attemptId: keys.attemptId,
    generation: __privateGet(this, _generation),
    offer: __privateGet(this, _offer),
    answer: __privateGet(this, _answer)
  });
};
openData_fn = async function() {
  const data = await __privateMethod(this, _Attempt_instances, race_fn).call(this, __privateGet(this, _peer).dataChannel());
  __privateSet(this, _data, data);
  __privateMethod(this, _Attempt_instances, within_fn).call(this, HANDSHAKE_TIMEOUT_MS);
  __privateSet(this, _maxRecord, recordLimit(data));
  return data;
};
closeKeys_fn = async function(closeSecret) {
  const keys = __privateGet(this, _keys);
  const closeKeys = await __privateMethod(this, _Attempt_instances, race_fn).call(this, deriveCloseKeys(__privateGet(this, _provider5), { closeSecret, roomNonce: keys.roomNonce, attemptId: keys.attemptId }));
  __privateSet(this, _close, closeChannel(__privateGet(this, _provider5), { keys: closeKeys, role: __privateGet(this, _role) }));
};
/** The channel, up: the set-up's timer stopped, the channel handed over to its owner, who closes it. */
opened_fn = function(hello, own2) {
  if (__privateGet(this, _ended)) throw __privateGet(this, _error) ?? insecure4();
  __privateGet(this, _timers2).clearTimeout(__privateGet(this, _timer2));
  __privateSet(this, _timer2, void 0);
  __privateSet(this, _handedOver, true);
  const keys = __privateGet(this, _keys);
  const transport = __privateGet(this, _transport);
  const data = __privateGet(this, _data);
  const handshakeHash = transport.handshakeHash;
  const { roomNonce, attemptId } = keys;
  const generation = __privateGet(this, _generation);
  const maxRecordBytes = __privateGet(this, _maxRecord);
  const maxPlaintext = maxRecordBytes - NOISE_TAG_BYTES;
  const attempt = this;
  const ended = () => __privateGet(attempt, _error) ?? insecure4();
  const peerHello = Object.freeze({ ...hello });
  const ownHello = Object.freeze({ ...own2 });
  return Object.freeze({
    role: __privateGet(this, _role),
    mode: keys.mode,
    generation,
    maxRecordBytes,
    peerHello,
    hello: ownHello,
    get roomNonce() {
      return new Uint8Array(roomNonce);
    },
    get attemptId() {
      return new Uint8Array(attemptId);
    },
    get handshakeHash() {
      return new Uint8Array(handshakeHash);
    },
    async send(plaintext) {
      if (__privateGet(attempt, _ended)) throw ended();
      if (plaintext instanceof Uint8Array && plaintext.byteLength > maxPlaintext) {
        throw invalid8(`A record here holds at most ${maxPlaintext} bytes.`);
      }
      try {
        data.send(await transport.encrypt(plaintext));
      } catch (err) {
        if (DropgateError.is(err, "INVALID_ARGUMENT")) throw err;
        throw attempt.end(err);
      }
    },
    async receive() {
      var _a;
      if (__privateGet(attempt, _ended)) throw ended();
      try {
        return await transport.decrypt(await __privateMethod(_a = attempt, _Attempt_instances, next_fn2).call(_a, data));
      } catch (err) {
        throw attempt.end(err);
      }
    },
    async writable() {
      try {
        await data.writable();
      } catch {
        throw attempt.end(lost());
      }
    },
    async sendClose(body) {
      const close = __privateGet(attempt, _close);
      if (!close) throw ended();
      __privateGet(attempt, _pipe).send(await close.seal(body));
    },
    closeReceived: this.closeReceived,
    close: () => {
      var _a;
      attempt.end();
      __privateMethod(_a = attempt, _Attempt_instances, release_fn).call(_a);
    },
    toJSON: () => "[SecureChannel]",
    toString: () => "[SecureChannel]",
    [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]: () => "[SecureChannel]"
  });
};
/** What a lost channel kept for a late close let go: the close keys and the rendezvous's pipe. */
release_fn = function() {
  if (!__privateGet(this, _lingering)) return;
  __privateSet(this, _lingering, false);
  __privateSet(this, _close, void 0);
  try {
    __privateGet(this, _pipe).close();
  } catch {
  }
};
function recordLimit(data) {
  const max = Math.floor(Math.min(NOISE_MAX_MESSAGE_BYTES, data.maxMessageBytes));
  if (!(max >= MIN_RECORD_BYTES)) {
    throw new DropgateError({
      code: "CAPABILITY_UNSUPPORTED",
      origin: "peer",
      message: "The other device's connection can't take messages as large as a direct transfer needs."
    });
  }
  return max;
}
var candidateOf = (c) => ({
  candidate: c.candidate,
  sdpMid: c.sdpMid ?? null,
  sdpMLineIndex: c.sdpMLineIndex ?? null,
  usernameFragment: c.usernameFragment ?? null
});
function errorFor(err, role) {
  if (DropgateError.is(err, "CODE_MISMATCH")) return new DropgateError({ code: "CODE_MISMATCH", message: CODE_MISMATCH_WORDING[role] });
  return toDropgateError(err);
}
async function guarded(role, open, work, timers) {
  let timer;
  let late = false;
  const running = work();
  const timeout = new Promise((_, reject) => {
    timer = timers.setTimeout(() => {
      late = true;
      reject(couldntConnect());
    }, SETUP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([running, timeout]);
  } catch (err) {
    for (const thing of open()) {
      try {
        thing?.close();
      } catch {
      }
    }
    if (late) running.then((channel) => channel.close(), () => void 0);
    throw errorFor(err, role);
  } finally {
    timers.clearTimeout(timer);
  }
}
var timersOf = (options) => options?.timers ?? GLOBAL_TIMERS;
async function receiverAttempt(provider, keys, pipe, peer, generation, hello, timers) {
  const attempt = new Attempt(provider, "receiver", keys, pipe, peer, generation, timers);
  try {
    attempt.start();
    await attempt.offer();
    return await attempt.receiverHandshake(hello);
  } catch (err) {
    throw attempt.end(err);
  }
}
async function senderAttempt(provider, keys, pipe, peer, generation, hello, timers, first) {
  const attempt = new Attempt(provider, "sender", keys, pipe, peer, generation, timers);
  try {
    attempt.start(first);
    return await attempt.senderHandshake(hello);
  } catch (err) {
    throw attempt.end(err);
  }
}
async function firstMessage(pipe) {
  let message;
  try {
    message = await pipe.receive();
  } catch (err) {
    throw pipeError(err);
  }
  if (!(message instanceof Uint8Array)) throw insecure4();
  return message;
}
function pipeError(err) {
  return DropgateError.is(err) ? err : lost();
}
async function connectByLink(provider, options) {
  const { rendezvous, peer, secret } = options ?? {};
  checkPeer(peer);
  if (!isBytes8(secret, LINK_SECRET_BYTES)) throw invalid8(`A link's secret is ${LINK_SECRET_BYTES} bytes.`);
  const hello = checkHello2(options.hello);
  const timers = timersOf(options);
  let pipe;
  return guarded("receiver", () => [pipe, peer], async () => {
    const roomId = await deriveRoomId(provider, secret);
    let joined;
    try {
      joined = await rendezvous.join({ roomId });
    } finally {
      roomId.fill(0);
    }
    pipe = joined?.pipe;
    checkPipe(pipe);
    const roomNonce = roomNonceOf(joined.roomNonce);
    const attemptId = provider.randomBytes(CPACE_ATTEMPT_ID_BYTES);
    const keys = await deriveAttemptKeys(provider, { mode: "link", base: secret, roomNonce, attemptId });
    return receiverAttempt(provider, keys, pipe, peer, 0n, hello, timers);
  }, timers);
}
async function connectByCode(provider, options) {
  const { rendezvous, peer } = options ?? {};
  checkPeer(peer);
  const hello = checkHello2(options.hello);
  const timers = timersOf(options);
  const { locator, password } = parseCode(options.code, options.letters);
  let pipe;
  let exchange;
  try {
    return await guarded("receiver", () => [pipe, peer], async () => {
      const joined = await rendezvous.join({ locator });
      pipe = joined?.pipe;
      checkPipe(pipe);
      const roomNonce = roomNonceOf(joined.roomNonce);
      const attemptId = provider.randomBytes(CPACE_ATTEMPT_ID_BYTES);
      exchange = cpaceInitiator(provider, { password, locator, roomNonce, attemptId });
      pipe.send(await exchange.writeMessage1());
      const message2 = await firstMessage(pipe);
      let keys;
      try {
        const { message3, result } = await exchange.readMessage2(message2, (isk) => deriveAttemptKeys(provider, { mode: "code", base: isk, roomNonce, attemptId }));
        keys = result;
        pipe.send(message3);
      } catch (err) {
        if (DropgateError.is(err, "CODE_MISMATCH")) pipe.send(cpaceAbort());
        throw err;
      }
      return receiverAttempt(provider, keys, pipe, peer, 0n, hello, timers);
    }, timers);
  } finally {
    exchange?.close();
    password.forget();
  }
}
var _target, _early, _NewsRelay_instances, pass_fn;
var NewsRelay = class {
  constructor() {
    __privateAdd(this, _NewsRelay_instances);
    __privateAdd(this, _target);
    __privateAdd(this, _early, []);
  }
  connect(target) {
    __privateSet(this, _target, target);
    for (const deliver of __privateGet(this, _early).splice(0)) deliver(target);
  }
  attempt(attempt) {
    __privateMethod(this, _NewsRelay_instances, pass_fn).call(this, (t) => t.attempt(attempt));
  }
  code(locator) {
    __privateMethod(this, _NewsRelay_instances, pass_fn).call(this, (t) => t.code(locator));
  }
  ended(err) {
    __privateMethod(this, _NewsRelay_instances, pass_fn).call(this, (t) => t.ended?.(err));
  }
};
_target = new WeakMap();
_early = new WeakMap();
_NewsRelay_instances = new WeakSet();
pass_fn = function(deliver) {
  if (__privateGet(this, _target)) deliver(__privateGet(this, _target));
  else __privateGet(this, _early).push(deliver);
};
var _provider6, _secret, _roomNonce2, _rendezvous, _letters, _codeWanted, _code, _bound, _incoming, _waiting2, _listeners, _ended2, _SenderRoom_instances, notify_fn, attempt_fn, newCode_fn, forgetCode_fn, end_fn;
var SenderRoom = class {
  /** @internal openRoom() makes these. */
  constructor(provider, secret, roomNonce, options = {}) {
    __privateAdd(this, _SenderRoom_instances);
    __privateAdd(this, _provider6);
    __privateAdd(this, _secret);
    __privateAdd(this, _roomNonce2);
    __privateAdd(this, _rendezvous);
    __privateAdd(this, _letters);
    __privateAdd(this, _codeWanted);
    __privateAdd(this, _code);
    /** Each attempt by code that came through the rendezvous's news, with the code it was for (none if none was shown). */
    __privateAdd(this, _bound, /* @__PURE__ */ new Map());
    __privateAdd(this, _incoming, []);
    __privateAdd(this, _waiting2, []);
    __privateAdd(this, _listeners, /* @__PURE__ */ new Set());
    __privateAdd(this, _ended2);
    __privateSet(this, _provider6, provider);
    __privateSet(this, _secret, secret);
    __privateSet(this, _roomNonce2, roomNonce);
    __privateSet(this, _code, options.code);
    __privateSet(this, _codeWanted, options.codeWanted ?? options.code !== void 0);
    __privateSet(this, _rendezvous, options.rendezvous);
    __privateSet(this, _letters, options.letters);
    options.news?.connect({
      attempt: (attempt) => __privateMethod(this, _SenderRoom_instances, attempt_fn).call(this, attempt),
      code: (locator) => __privateMethod(this, _SenderRoom_instances, newCode_fn).call(this, locator),
      ended: (err) => __privateMethod(this, _SenderRoom_instances, end_fn).call(this, err)
    });
    Object.freeze(this);
  }
  /** The link's secret, a copy, for the link the sender shares: undefined once the room is closed. */
  linkSecret() {
    return __privateGet(this, _secret) ? new Uint8Array(__privateGet(this, _secret)) : void 0;
  }
  /** The room's nonce, a copy: public. */
  get roomNonce() {
    return new Uint8Array(__privateGet(this, _roomNonce2));
  }
  /** The code for the sender's screen, until an attempt uses it and a new one comes. */
  get code() {
    return __privateGet(this, _code)?.code;
  }
  /** Whether a code is on the screen: `ready`; `unavailable` while none is free or the next is coming; `off` if none was asked for. */
  get codeState() {
    if (!__privateGet(this, _codeWanted)) return "off";
    return __privateGet(this, _code) ? "ready" : "unavailable";
  }
  /** Calls `listener` whenever `code` changes. Returns a function that stops it. */
  onCodeChange(listener) {
    __privateGet(this, _listeners).add(listener);
    return () => {
      __privateGet(this, _listeners).delete(listener);
    };
  }
  /**
   * The next attempt to reach the room, in the order they came. Rejects once
   * the room's connection to the rendezvous has ended, or the room is closed.
   */
  nextAttempt() {
    const ready = __privateGet(this, _incoming).shift();
    if (ready) return Promise.resolve(ready);
    if (__privateGet(this, _ended2)) return Promise.reject(__privateGet(this, _ended2));
    return new Promise((resolve, reject) => __privateGet(this, _waiting2).push({ resolve, reject }));
  }
  /**
   * A receiver was accepted: the room takes no new attempt and asks for no
   * more codes, every attempt but `keep` is dropped, and the code, if one is
   * shown, is let go.
   */
  lock(keep) {
    __privateGet(this, _rendezvous)?.lock?.(keep);
    __privateMethod(this, _SenderRoom_instances, forgetCode_fn).call(this);
    for (const [attempt, code] of __privateGet(this, _bound)) {
      if (attempt !== keep) {
        code?.password.forget();
        __privateGet(this, _bound).delete(attempt);
      }
    }
    for (const attempt of __privateGet(this, _incoming).splice(0)) {
      if (attempt === keep) __privateGet(this, _incoming).push(attempt);
      else attempt.pipe.close();
    }
  }
  /**
   * Takes one attempt to its secure channel. By code: CPace as the responder,
   * once per code, right or wrong (the code is gone afterwards; the link still
   * works). By link: the attempt's keys from the attempt ID in the receiver's
   * first frame. A resume: keys from R, the generation one past the last.
   */
  async accept(attempt, options) {
    const { peer } = options ?? {};
    checkPeer(peer);
    checkPipe(attempt?.pipe);
    const hello = checkHello2(options.hello);
    const timers = timersOf(options);
    const provider = __privateGet(this, _provider6);
    const { pipe } = attempt;
    const roomNonce = __privateGet(this, _roomNonce2);
    const open = () => [pipe, peer];
    if (attempt.by === "code") {
      let code;
      if (__privateGet(this, _bound).has(attempt)) {
        code = __privateGet(this, _bound).get(attempt);
        __privateGet(this, _bound).delete(attempt);
      } else {
        code = __privateGet(this, _code);
        __privateSet(this, _code, void 0);
        if (code) __privateMethod(this, _SenderRoom_instances, notify_fn).call(this);
      }
      return guarded("sender", open, async () => {
        if (!code) {
          pipe.send(cpaceAbort());
          throw new DropgateError({ code: "CODE_MISMATCH" });
        }
        const exchange = cpaceResponder(provider, { password: code.password, locator: code.locator, roomNonce });
        try {
          let keys;
          try {
            const { message2, attemptId } = await exchange.readMessage1(await firstMessage(pipe));
            pipe.send(message2);
            ({ result: keys } = await exchange.readMessage3(await firstMessage(pipe), (isk) => deriveAttemptKeys(provider, { mode: "code", base: isk, roomNonce, attemptId })));
          } catch (err) {
            if (DropgateError.is(err, "CODE_MISMATCH")) pipe.send(cpaceAbort());
            throw err;
          }
          return await senderAttempt(provider, keys, pipe, peer, 0n, hello, timers);
        } finally {
          exchange.close();
        }
      }, timers);
    }
    if (attempt.by === "resume") {
      const { resumeSecret } = attempt;
      if (!isBytes8(resumeSecret, RESUME_SECRET_BYTES)) throw invalid8(`A resume secret is ${RESUME_SECRET_BYTES} bytes.`);
      const generation = nextGeneration(attempt.previousGeneration);
      return guarded("sender", open, async () => {
        const first = await firstMessage(pipe);
        const keys = await deriveAttemptKeys(provider, { mode: "resume", base: resumeSecret, roomNonce, attemptId: attemptIdIn(first) });
        return senderAttempt(provider, keys, pipe, peer, generation, hello, timers, first);
      }, timers);
    }
    if (attempt.by !== "link") throw invalid8("An attempt comes by link, by code or as a resume.");
    return guarded("sender", open, async () => {
      const secret = __privateGet(this, _secret);
      if (!secret) throw invalid8("This room is closed.");
      const first = await firstMessage(pipe);
      const keys = await deriveAttemptKeys(provider, { mode: "link", base: secret, roomNonce, attemptId: attemptIdIn(first) });
      return senderAttempt(provider, keys, pipe, peer, 0n, hello, timers, first);
    }, timers);
  }
  /**
   * Closes the room: the link's secret overwritten, every code's password let
   * go, the attempts not yet taken closed, and the room closed on the
   * rendezvous.
   */
  close() {
    __privateGet(this, _secret)?.fill(0);
    __privateSet(this, _secret, void 0);
    __privateMethod(this, _SenderRoom_instances, forgetCode_fn).call(this);
    for (const code of __privateGet(this, _bound).values()) code?.password.forget();
    __privateGet(this, _bound).clear();
    for (const attempt of __privateGet(this, _incoming).splice(0)) attempt.pipe.close();
    __privateMethod(this, _SenderRoom_instances, end_fn).call(this, new DropgateError({ code: "OPERATION_CANCELLED" }));
    __privateGet(this, _rendezvous)?.close?.();
  }
  toJSON() {
    return "[SenderRoom]";
  }
  toString() {
    return "[SenderRoom]";
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return "[SenderRoom]";
  }
};
_provider6 = new WeakMap();
_secret = new WeakMap();
_roomNonce2 = new WeakMap();
_rendezvous = new WeakMap();
_letters = new WeakMap();
_codeWanted = new WeakMap();
_code = new WeakMap();
_bound = new WeakMap();
_incoming = new WeakMap();
_waiting2 = new WeakMap();
_listeners = new WeakMap();
_ended2 = new WeakMap();
_SenderRoom_instances = new WeakSet();
notify_fn = function() {
  for (const listener of [...__privateGet(this, _listeners)]) {
    try {
      listener();
    } catch {
    }
  }
};
attempt_fn = function(attempt) {
  if (__privateGet(this, _ended2)) {
    attempt.pipe.close();
    return;
  }
  if (attempt.by === "code") {
    __privateGet(this, _bound).set(attempt, __privateGet(this, _code));
    __privateSet(this, _code, void 0);
    __privateMethod(this, _SenderRoom_instances, notify_fn).call(this);
  }
  const waiter = __privateGet(this, _waiting2).shift();
  if (waiter) waiter.resolve(attempt);
  else __privateGet(this, _incoming).push(attempt);
};
/** The rendezvous gave a new locator (or none for now): a new password is drawn for it here. */
newCode_fn = function(locator) {
  if (__privateGet(this, _ended2) || !__privateGet(this, _codeWanted)) return;
  __privateMethod(this, _SenderRoom_instances, forgetCode_fn).call(this, false);
  if (locator !== void 0) {
    try {
      __privateSet(this, _code, newCode(__privateGet(this, _provider6), locator, __privateGet(this, _letters)));
    } catch {
    }
  }
  __privateMethod(this, _SenderRoom_instances, notify_fn).call(this);
};
/** Lets the shown code go, its password overwritten; listeners told unless `tell` is false. */
forgetCode_fn = function(tell = true) {
  const had = __privateGet(this, _code) !== void 0;
  __privateGet(this, _code)?.password.forget();
  __privateSet(this, _code, void 0);
  if (had && tell) __privateMethod(this, _SenderRoom_instances, notify_fn).call(this);
};
end_fn = function(err) {
  if (__privateGet(this, _ended2)) return;
  __privateSet(this, _ended2, err);
  for (const waiter of __privateGet(this, _waiting2).splice(0)) waiter.reject(err);
  __privateMethod(this, _SenderRoom_instances, forgetCode_fn).call(this);
};
function attemptIdIn(frame) {
  if (frame.byteLength < FRAME_HEADER_BYTES) throw insecure4();
  return frame.slice(2, 2 + CPACE_ATTEMPT_ID_BYTES);
}
async function openRoom(provider, options) {
  const { rendezvous } = options ?? {};
  if (!rendezvous || typeof rendezvous.create !== "function") throw invalid8("A room is opened on the rendezvous.");
  const secret = provider.randomBytes(LINK_SECRET_BYTES);
  const roomNonce = provider.randomBytes(CPACE_ROOM_NONCE_BYTES);
  const news = new NewsRelay();
  try {
    const roomId = await deriveRoomId(provider, secret);
    let created;
    try {
      created = await rendezvous.create({ roomId, roomNonce: new Uint8Array(roomNonce), code: options.code === true }, news);
    } finally {
      roomId.fill(0);
    }
    let code;
    if (options.code === true && created?.locator !== void 0) {
      try {
        code = newCode(provider, created.locator, options.letters);
      } catch {
        rendezvous.close?.();
        throw new DropgateError({ code: "INVALID_RESPONSE" });
      }
    }
    return new SenderRoom(provider, secret, roomNonce, {
      code: code && { locator: code.locator, password: code.password, code: code.code },
      codeWanted: options.code === true && rendezvous.givesCodes !== false,
      rendezvous,
      letters: options.letters,
      news
    });
  } catch (err) {
    secret.fill(0);
    throw toDropgateError(err);
  }
}

// src/dgdtp/webrtc.ts
var DATA_CHANNEL_LABEL = "dgdtp/4";
var LOW_WATER_BYTES = 256 * 1024;
var WRITABLE_POLL_MS = 10;
var DEFAULT_MAX_MESSAGE_SIZE = 65536;
var lost2 = () => new DropgateError({ code: "CONNECTION_LOST" });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => void 0);
  return { promise, resolve, reject };
}
function bytesOf(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) return new Uint8Array(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return new Uint8Array(0);
}
var _channel, _queue, _readers, _writers, _poll, _closed2, _gone, _onMessage, _onLow, _DataPipe_instances, deliver_fn, checkWritable_fn, stopWaiting_fn, stop_fn;
var DataPipe = class {
  constructor(channel, maxMessageBytes) {
    __privateAdd(this, _DataPipe_instances);
    __publicField(this, "maxMessageBytes");
    __privateAdd(this, _channel);
    __privateAdd(this, _queue, []);
    __privateAdd(this, _readers, []);
    __privateAdd(this, _writers, []);
    __privateAdd(this, _poll);
    /** Closed by this side: nothing more is taken. */
    __privateAdd(this, _closed2, false);
    /** Gone underneath: what came first is still taken. */
    __privateAdd(this, _gone, false);
    __privateAdd(this, _onMessage, (event) => __privateMethod(this, _DataPipe_instances, deliver_fn).call(this, event?.data));
    __privateAdd(this, _onLow, () => __privateMethod(this, _DataPipe_instances, checkWritable_fn).call(this));
    __privateSet(this, _channel, channel);
    this.maxMessageBytes = maxMessageBytes;
    channel.addEventListener("message", __privateGet(this, _onMessage));
  }
  send(message) {
    if (__privateGet(this, _closed2) || __privateGet(this, _gone) || __privateGet(this, _channel).readyState !== "open") throw lost2();
    if (message.byteLength > this.maxMessageBytes) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: `The data channel takes at most ${this.maxMessageBytes} bytes a message.` });
    }
    try {
      __privateGet(this, _channel).send(message);
    } catch {
      this.gone();
      throw lost2();
    }
  }
  receive() {
    if (__privateGet(this, _queue).length > 0) return Promise.resolve(__privateGet(this, _queue).shift());
    if (__privateGet(this, _closed2) || __privateGet(this, _gone)) return Promise.reject(lost2());
    return new Promise((resolve, reject) => __privateGet(this, _readers).push({ resolve, reject }));
  }
  writable() {
    if (__privateGet(this, _closed2) || __privateGet(this, _gone)) return Promise.reject(lost2());
    if (__privateGet(this, _channel).bufferedAmount <= LOW_WATER_BYTES) return Promise.resolve();
    return new Promise((resolve, reject) => {
      __privateGet(this, _writers).push({ resolve, reject });
      if (__privateGet(this, _writers).length === 1) {
        __privateGet(this, _channel).addEventListener("bufferedamountlow", __privateGet(this, _onLow));
        __privateSet(this, _poll, setInterval(__privateGet(this, _onLow), WRITABLE_POLL_MS));
      }
    });
  }
  close() {
    if (__privateGet(this, _closed2)) return;
    __privateSet(this, _closed2, true);
    __privateGet(this, _queue).length = 0;
    __privateMethod(this, _DataPipe_instances, stop_fn).call(this);
    try {
      __privateGet(this, _channel).close();
    } catch {
    }
  }
  /** The channel or the connection went: what came first is still taken, then receive() and writable() reject. */
  gone() {
    if (__privateGet(this, _gone)) return;
    __privateSet(this, _gone, true);
    __privateMethod(this, _DataPipe_instances, stop_fn).call(this);
  }
};
_channel = new WeakMap();
_queue = new WeakMap();
_readers = new WeakMap();
_writers = new WeakMap();
_poll = new WeakMap();
_closed2 = new WeakMap();
_gone = new WeakMap();
_onMessage = new WeakMap();
_onLow = new WeakMap();
_DataPipe_instances = new WeakSet();
deliver_fn = function(data) {
  const message = bytesOf(data);
  const reader = __privateGet(this, _readers).shift();
  if (reader) reader.resolve(message);
  else __privateGet(this, _queue).push(message);
};
checkWritable_fn = function() {
  if (__privateGet(this, _channel).bufferedAmount > LOW_WATER_BYTES) return;
  __privateMethod(this, _DataPipe_instances, stopWaiting_fn).call(this);
  for (const writer of __privateGet(this, _writers).splice(0)) writer.resolve();
};
stopWaiting_fn = function() {
  if (__privateGet(this, _poll) !== void 0) clearInterval(__privateGet(this, _poll));
  __privateSet(this, _poll, void 0);
  __privateGet(this, _channel).removeEventListener("bufferedamountlow", __privateGet(this, _onLow));
};
/** Every waiter told the pipe has ended, and the channel's listeners removed. */
stop_fn = function() {
  __privateMethod(this, _DataPipe_instances, stopWaiting_fn).call(this);
  for (const reader of __privateGet(this, _readers).splice(0)) reader.reject(lost2());
  for (const writer of __privateGet(this, _writers).splice(0)) writer.reject(lost2());
  __privateGet(this, _channel).removeEventListener("message", __privateGet(this, _onMessage));
};
var _pc, _opened, _channel2, _pipe2, _listener, _early2, _ended3, _WebRtcPeer_instances, candidate_fn, take_fn2, maxMessageBytes_fn, state_fn, lost_fn;
var WebRtcPeer = class {
  constructor(options) {
    __privateAdd(this, _WebRtcPeer_instances);
    __privateAdd(this, _pc);
    __privateAdd(this, _opened, deferred());
    __privateAdd(this, _channel2);
    __privateAdd(this, _pipe2);
    __privateAdd(this, _listener);
    __privateAdd(this, _early2, []);
    __privateAdd(this, _ended3, false);
    const { RTCPeerConnection: PeerConnectionClass, role } = options;
    const iceServers = (options.iceServers ?? []).map((server) => ({ ...server }));
    const pc = new PeerConnectionClass({ iceServers });
    __privateSet(this, _pc, pc);
    pc.addEventListener("icecandidate", (event) => __privateMethod(this, _WebRtcPeer_instances, candidate_fn).call(this, event?.candidate));
    pc.addEventListener("iceconnectionstatechange", () => __privateMethod(this, _WebRtcPeer_instances, state_fn).call(this));
    pc.addEventListener("connectionstatechange", () => __privateMethod(this, _WebRtcPeer_instances, state_fn).call(this));
    if (role === "receiver") {
      __privateMethod(this, _WebRtcPeer_instances, take_fn2).call(this, pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true }));
    } else {
      pc.addEventListener("datachannel", (event) => {
        const channel = event?.channel;
        if (!channel) return;
        if (__privateGet(this, _channel2) || channel.label !== DATA_CHANNEL_LABEL || channel.ordered === false) {
          try {
            channel.close();
          } catch {
          }
          return;
        }
        __privateMethod(this, _WebRtcPeer_instances, take_fn2).call(this, channel);
      });
    }
  }
  async createOffer() {
    return sdpOf(await __privateGet(this, _pc).createOffer());
  }
  async createAnswer() {
    return sdpOf(await __privateGet(this, _pc).createAnswer());
  }
  async setLocalDescription(description) {
    await __privateGet(this, _pc).setLocalDescription(description);
  }
  async setRemoteDescription(description) {
    await __privateGet(this, _pc).setRemoteDescription(description);
  }
  async addIceCandidate(candidate) {
    if (candidate === null) {
      await __privateGet(this, _pc).addIceCandidate();
      return;
    }
    const { candidate: line, sdpMid, sdpMLineIndex, usernameFragment } = candidate;
    await __privateGet(this, _pc).addIceCandidate({ candidate: line, sdpMid, sdpMLineIndex, usernameFragment });
  }
  onIceCandidate(listener) {
    __privateSet(this, _listener, listener);
    for (const candidate of __privateGet(this, _early2).splice(0)) listener(candidate);
  }
  dataChannel() {
    return __privateGet(this, _opened).promise;
  }
  close() {
    if (__privateGet(this, _ended3)) return;
    __privateSet(this, _ended3, true);
    __privateGet(this, _opened).reject(lost2());
    if (__privateGet(this, _pipe2)) {
      __privateGet(this, _pipe2).close();
    } else {
      try {
        __privateGet(this, _channel2)?.close();
      } catch {
      }
    }
    try {
      Promise.resolve(__privateGet(this, _pc).close()).catch(() => void 0);
    } catch {
    }
  }
};
_pc = new WeakMap();
_opened = new WeakMap();
_channel2 = new WeakMap();
_pipe2 = new WeakMap();
_listener = new WeakMap();
_early2 = new WeakMap();
_ended3 = new WeakMap();
_WebRtcPeer_instances = new WeakSet();
/** A local candidate as ICE finds it: the end of them is null (or undefined); an empty one, a section's end, is skipped. */
candidate_fn = function(value) {
  if (__privateGet(this, _ended3)) return;
  let candidate = null;
  if (value) {
    const c = value;
    if (typeof c.candidate !== "string" || c.candidate === "") return;
    candidate = {
      candidate: c.candidate,
      sdpMid: c.sdpMid ?? null,
      sdpMLineIndex: c.sdpMLineIndex ?? null,
      usernameFragment: c.usernameFragment ?? null
    };
  }
  if (__privateGet(this, _listener)) __privateGet(this, _listener).call(this, candidate);
  else __privateGet(this, _early2).push(candidate);
};
/** The one data channel: bytes, the low-water mark set, and the pipe made once it opens. */
take_fn2 = function(channel) {
  __privateSet(this, _channel2, channel);
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = LOW_WATER_BYTES;
  const open = () => {
    if (__privateGet(this, _ended3) || __privateGet(this, _pipe2)) return;
    __privateSet(this, _pipe2, new DataPipe(channel, __privateMethod(this, _WebRtcPeer_instances, maxMessageBytes_fn).call(this)));
    __privateGet(this, _opened).resolve(__privateGet(this, _pipe2));
  };
  channel.addEventListener("open", open);
  channel.addEventListener("close", () => __privateMethod(this, _WebRtcPeer_instances, lost_fn).call(this));
  if (channel.readyState === "open") open();
};
/** The largest message the data channel sends: the SCTP transport's max-message-size, or RFC 8841's default. */
maxMessageBytes_fn = function() {
  const size = __privateGet(this, _pc).sctp?.maxMessageSize;
  return typeof size === "number" ? size : DEFAULT_MAX_MESSAGE_SIZE;
};
/** ICE or the connection failed or closed: the data channel, open or not, is lost. */
state_fn = function() {
  const ice = __privateGet(this, _pc).iceConnectionState;
  const connection = __privateGet(this, _pc).connectionState;
  if (ice === "failed" || ice === "closed" || connection === "failed" || connection === "closed") __privateMethod(this, _WebRtcPeer_instances, lost_fn).call(this);
};
lost_fn = function() {
  __privateGet(this, _opened).reject(lost2());
  __privateGet(this, _pipe2)?.gone();
};
function sdpOf(description) {
  const sdp = description?.sdp;
  if (typeof sdp !== "string") throw new DropgateError({ code: "UNEXPECTED_ERROR", message: "The peer connection made no SDP." });
  return sdp;
}
function webRtcPeer(options) {
  if (typeof options?.RTCPeerConnection !== "function") {
    throw new DropgateError({ code: "RUNTIME_UNSUPPORTED", message: "A direct transfer needs WebRTC (RTCPeerConnection)." });
  }
  if (options.role !== "receiver" && options.role !== "sender") {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A peer connection is the receiver's or the sender's." });
  }
  return new WebRtcPeer(options);
}

// src/dgdtp/engine.ts
var CREDIT_WINDOW_BYTES = 4194304;
var CREDIT_STEP_BYTES = 262144;
var PUMP_HIGH_WATER_BYTES = 1048576;
var SOURCE_BLOCKS_AHEAD = 2;
var ENCRYPT_AHEAD = 8;
var MAX_UNFINISHED_FILE_ENDS = 8;
var RESULT_ACK_WAIT_MS = 2e3;
var MAX_PINGS_WAITING = 16;
var STATUS_STATE = Object.freeze({ OFFERED: 1, TRANSFERRING: 2, FINALISING: 3, FINISHED: 4 });
var _channel3, _handlers, _timers3, _control, _stream, _inFlight, _since, _wake, _busy, _idle, _closed3, _released, _inbox, _handling, _lostWith, _lastSent, _lastHeard, _srtt, _pings, _nextId, _pingTimer, _answerTimer, _acks, _Link_instances, stop_fn2, read_fn, answered_fn, takeId_fn, ping_fn, pong_fn, handle_fn, pump_fn, fromStream_fn, settleIdle_fn, end_fn2;
var Link = class {
  constructor(channel, handlers, timers = GLOBAL_TIMERS) {
    __privateAdd(this, _Link_instances);
    __publicField(this, "generation");
    /** The largest record either side may send: the smaller of the two hellos'. */
    __publicField(this, "recordBytes");
    __privateAdd(this, _channel3);
    __privateAdd(this, _handlers);
    __privateAdd(this, _timers3);
    __privateAdd(this, _control, []);
    __privateAdd(this, _stream);
    __privateAdd(this, _inFlight, []);
    /** Bytes handed to the channel since its buffer was last at the low-water mark. */
    __privateAdd(this, _since, 0);
    __privateAdd(this, _wake);
    __privateAdd(this, _busy, false);
    __privateAdd(this, _idle, []);
    /** Nothing more is sent or read: the link was closed, or its channel ended. */
    __privateAdd(this, _closed3, false);
    /** The channel itself closed, by the side. */
    __privateAdd(this, _released, false);
    /** Records read and not yet handled, in order. */
    __privateAdd(this, _inbox, []);
    __privateAdd(this, _handling, false);
    /** Why the channel ended, told once the inbox is empty. */
    __privateAdd(this, _lostWith);
    // Liveness.
    __privateAdd(this, _lastSent);
    __privateAdd(this, _lastHeard);
    __privateAdd(this, _srtt);
    __privateAdd(this, _pings, /* @__PURE__ */ new Map());
    __privateAdd(this, _nextId, 1n);
    __privateAdd(this, _pingTimer);
    __privateAdd(this, _answerTimer);
    __privateAdd(this, _acks, /* @__PURE__ */ new Map());
    __privateSet(this, _channel3, channel);
    __privateSet(this, _handlers, handlers);
    __privateSet(this, _timers3, timers);
    this.generation = channel.generation;
    this.recordBytes = Math.min(channel.maxRecordBytes, channel.peerHello.maxRecord);
    __privateSet(this, _lastSent, timers.now());
    __privateSet(this, _lastHeard, __privateGet(this, _lastSent));
    __privateSet(this, _pingTimer, new Deadline(timers, () => __privateGet(this, _closed3) ? void 0 : __privateGet(this, _lastSent) + PING_INTERVAL_MS, () => __privateMethod(this, _Link_instances, ping_fn).call(this)));
    __privateSet(this, _answerTimer, new Deadline(timers, () => __privateGet(this, _closed3) ? void 0 : __privateGet(this, _lastHeard) + this.noAnswerMs, () => {
      __privateMethod(this, _Link_instances, end_fn2).call(this, new DropgateError({ code: "CONNECTION_LOST", message: "The connection was lost, so the transfer couldn't continue." }));
    }));
  }
  /** Starts reading the other side's records (both ways), the pump and liveness. */
  start() {
    void __privateMethod(this, _Link_instances, read_fn).call(this);
    void __privateMethod(this, _Link_instances, pump_fn).call(this);
    __privateGet(this, _pingTimer).arm();
    __privateGet(this, _answerTimer).arm();
    __privateGet(this, _channel3).closeReceived.then((body) => {
      if (__privateGet(this, _released)) return;
      let message;
      try {
        message = decodeMessage(body);
      } catch {
        return;
      }
      if (message.type === "close") __privateGet(this, _handlers).close(message, this.generation);
    }, () => void 0);
  }
  /** The smoothed round trip, once a PONG has come. */
  get srtt() {
    return __privateGet(this, _srtt);
  }
  /** How long nothing may be heard before the connection is lost: max(15 s, 6 × the smoothed round trip). */
  get noAnswerMs() {
    return Math.max(MIN_NO_ANSWER_MS, NO_ANSWER_RTTS * (__privateGet(this, _srtt) ?? 0));
  }
  /** Sends a control record, ahead of anything of the stream not yet sent. */
  send(message) {
    this.sendRecord(encodeMessage(message));
  }
  /** A record already written: the manifest's. */
  sendRecord(record) {
    if (__privateGet(this, _closed3)) return;
    __privateGet(this, _control).push(record);
    this.wake();
  }
  /** Sets (or, with undefined, stops) the stream the pump draws from once no control record waits. */
  stream(source) {
    __privateSet(this, _stream, source);
    this.wake();
  }
  /** Something changed that may let a record go: credit, a block read, a control record, a hold let go. */
  wake() {
    const wake = __privateGet(this, _wake);
    __privateSet(this, _wake, void 0);
    wake?.();
  }
  /** Resolves once every record queued so far has been handed to the data channel (or the link has closed). */
  async flush() {
    while (!__privateGet(this, _closed3) && (__privateGet(this, _busy) || __privateGet(this, _control).length > 0)) {
      await new Promise((resolve) => __privateGet(this, _idle).push(resolve));
    }
    await Promise.allSettled([...__privateGet(this, _inFlight)]);
  }
  /**
   * Sends this side's one CLOSE: in-band (after whatever is already
   * encrypted) and sealed through the rendezvous, then waits up to 2 s for the
   * CLOSE_ACK, which it gives. With the data channel already gone it goes
   * through the rendezvous alone, and nothing is waited for.
   */
  async closeWith(message) {
    const record = encodeMessage(message);
    const key = idKey(message.operationId);
    let resolve;
    const acked = new Promise((res) => {
      resolve = res;
    });
    const inBand = !__privateGet(this, _closed3);
    if (inBand) {
      __privateGet(this, _acks).set(key, resolve);
      this.sendRecord(record);
    }
    const outOfBand = __privateGet(this, _released) ? Promise.resolve() : __privateGet(this, _channel3).sendClose(record).catch(() => void 0);
    if (!inBand) {
      await outOfBand;
      return void 0;
    }
    const timer = __privateGet(this, _timers3).setTimeout(() => resolve(void 0), CLOSE_ACK_WAIT_MS);
    const ack = await acked;
    __privateGet(this, _timers3).clearTimeout(timer);
    __privateGet(this, _acks).delete(key);
    await outOfBand;
    return ack;
  }
  /** Closes the link and its channel: nothing more is sent or read, and no late CLOSE is listened for. */
  close() {
    __privateMethod(this, _Link_instances, stop_fn2).call(this);
    if (__privateGet(this, _released)) return;
    __privateSet(this, _released, true);
    for (const resolve of __privateGet(this, _acks).values()) resolve(void 0);
    __privateGet(this, _acks).clear();
    try {
      __privateGet(this, _channel3).close();
    } catch {
    }
  }
  /** Whether nothing more is sent or read. */
  get closed() {
    return __privateGet(this, _closed3);
  }
  /** Asks the other side where it stands (STATUS): its answer comes to `statusHeard`. */
  askStatus() {
    this.send({ type: "status", kind: "ask", id: __privateMethod(this, _Link_instances, takeId_fn).call(this) });
  }
};
_channel3 = new WeakMap();
_handlers = new WeakMap();
_timers3 = new WeakMap();
_control = new WeakMap();
_stream = new WeakMap();
_inFlight = new WeakMap();
_since = new WeakMap();
_wake = new WeakMap();
_busy = new WeakMap();
_idle = new WeakMap();
_closed3 = new WeakMap();
_released = new WeakMap();
_inbox = new WeakMap();
_handling = new WeakMap();
_lostWith = new WeakMap();
_lastSent = new WeakMap();
_lastHeard = new WeakMap();
_srtt = new WeakMap();
_pings = new WeakMap();
_nextId = new WeakMap();
_pingTimer = new WeakMap();
_answerTimer = new WeakMap();
_acks = new WeakMap();
_Link_instances = new WeakSet();
stop_fn2 = function() {
  if (__privateGet(this, _closed3)) return;
  __privateSet(this, _closed3, true);
  __privateGet(this, _inbox).length = 0;
  __privateGet(this, _pingTimer).stop();
  __privateGet(this, _answerTimer).stop();
  __privateMethod(this, _Link_instances, settleIdle_fn).call(this);
  this.wake();
};
read_fn = async function() {
  for (; ; ) {
    let record;
    try {
      record = await __privateGet(this, _channel3).receive();
    } catch (err) {
      __privateSet(this, _lostWith, toDropgateError(err));
      if (!__privateGet(this, _handling)) __privateMethod(this, _Link_instances, end_fn2).call(this, __privateGet(this, _lostWith));
      return;
    }
    if (__privateGet(this, _closed3)) return;
    __privateSet(this, _lastHeard, __privateGet(this, _timers3).now());
    if (__privateMethod(this, _Link_instances, answered_fn).call(this, record)) continue;
    __privateGet(this, _handlers).arrived?.(record);
    __privateGet(this, _inbox).push(record);
    if (!__privateGet(this, _handling)) void __privateMethod(this, _Link_instances, handle_fn).call(this);
  }
};
/**
 * Records answered as they arrive, never waiting behind the side's work:
 * PING (with a PONG), PONG (the round trip), STATUS, CLOSE and CLOSE_ACK.
 * One that doesn't read is left for the side, in order, to refuse.
 */
answered_fn = function(record) {
  const type = record[0];
  if (type !== MESSAGE_TYPE.PING && type !== MESSAGE_TYPE.PONG && type !== MESSAGE_TYPE.STATUS && type !== MESSAGE_TYPE.CLOSE && type !== MESSAGE_TYPE.CLOSE_ACK) {
    return false;
  }
  let message;
  try {
    message = decodeMessage(record);
  } catch {
    return false;
  }
  switch (message.type) {
    case "ping":
      this.send({ type: "pong", id: message.id });
      break;
    case "pong":
      __privateMethod(this, _Link_instances, pong_fn).call(this, message.id);
      break;
    case "status":
      if (message.kind === "ask") this.send({ type: "status", kind: "answer", id: message.id, ...__privateGet(this, _handlers).status() });
      else __privateGet(this, _handlers).statusHeard?.(message, this.generation);
      break;
    case "close":
      __privateGet(this, _handlers).close(message, this.generation);
      break;
    case "close-ack":
      __privateGet(this, _acks).get(idKey(message.operationId))?.(message);
      break;
    default:
      return false;
  }
  return true;
};
takeId_fn = function() {
  const id = __privateGet(this, _nextId);
  __privateSet(this, _nextId, __privateGet(this, _nextId) + 1n);
  return id;
};
ping_fn = function() {
  const id = __privateMethod(this, _Link_instances, takeId_fn).call(this);
  __privateGet(this, _pings).set(id, __privateGet(this, _timers3).now());
  if (__privateGet(this, _pings).size > MAX_PINGS_WAITING) __privateGet(this, _pings).delete(__privateGet(this, _pings).keys().next().value);
  this.send({ type: "ping", id });
  __privateSet(this, _lastSent, __privateGet(this, _timers3).now());
  __privateGet(this, _pingTimer).arm();
};
/** A PONG: the round trip into the smoothed RTT (7/8 the old, 1/8 the new). An unknown one is passed over. */
pong_fn = function(id) {
  const sentAt = __privateGet(this, _pings).get(id);
  if (sentAt === void 0) return;
  __privateGet(this, _pings).delete(id);
  const rtt = __privateGet(this, _timers3).now() - sentAt;
  __privateSet(this, _srtt, __privateGet(this, _srtt) === void 0 ? rtt : (7 * __privateGet(this, _srtt) + rtt) / 8);
};
handle_fn = async function() {
  __privateSet(this, _handling, true);
  while (__privateGet(this, _inbox).length > 0 && !__privateGet(this, _closed3)) {
    await __privateGet(this, _handlers).record({ generation: this.generation, record: __privateGet(this, _inbox).shift() });
  }
  __privateSet(this, _handling, false);
  if (__privateGet(this, _lostWith)) __privateMethod(this, _Link_instances, end_fn2).call(this, __privateGet(this, _lostWith));
};
pump_fn = async function() {
  while (!__privateGet(this, _closed3)) {
    const record = __privateGet(this, _control).shift() ?? __privateMethod(this, _Link_instances, fromStream_fn).call(this);
    if (!record) {
      __privateSet(this, _busy, false);
      __privateMethod(this, _Link_instances, settleIdle_fn).call(this);
      await new Promise((resolve) => {
        __privateSet(this, _wake, resolve);
      });
      continue;
    }
    __privateSet(this, _busy, true);
    try {
      if (__privateGet(this, _since) >= PUMP_HIGH_WATER_BYTES - LOW_WATER_BYTES) {
        await Promise.all(__privateGet(this, _inFlight).splice(0));
        await __privateGet(this, _channel3).writable();
        __privateSet(this, _since, 0);
      }
      if (__privateGet(this, _closed3)) return;
      const sending = __privateGet(this, _channel3).send(record);
      sending.catch(() => void 0);
      __privateGet(this, _inFlight).push(sending);
      __privateSet(this, _since, __privateGet(this, _since) + (record.byteLength + NOISE_TAG_BYTES));
      __privateSet(this, _lastSent, __privateGet(this, _timers3).now());
      if (__privateGet(this, _inFlight).length >= ENCRYPT_AHEAD) await __privateGet(this, _inFlight).shift();
    } catch (err) {
      __privateMethod(this, _Link_instances, end_fn2).call(this, err);
      return;
    }
  }
};
fromStream_fn = function() {
  const message = __privateGet(this, _stream)?.next();
  return message && encodeMessage(message);
};
settleIdle_fn = function() {
  for (const resolve of __privateGet(this, _idle).splice(0)) resolve();
};
/** The channel ended under the link, or the other side went quiet: the side is told, and closes the link when it's ready. */
end_fn2 = function(err) {
  if (__privateGet(this, _closed3)) return;
  __privateMethod(this, _Link_instances, stop_fn2).call(this);
  __privateGet(this, _handlers).ended(toDropgateError(err));
};
var idKey = (id) => Array.from(id, (b) => b.toString(16).padStart(2, "0")).join("");
function readRecord(record) {
  return decodeMessage(record);
}
function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
var invalidMessage2 = () => new DropgateError({ code: "INVALID_MESSAGE" });
var integrityFailed = (message) => new DropgateError({ code: "INTEGRITY_FAILED", origin: "peer", message });
var offerTimedOut = () => new DropgateError({ code: "TIMED_OUT", origin: "local", message: "The offer wasn't accepted within 10 minutes." });
var CLOSE_DETAILS2 = /* @__PURE__ */ new Set([
  "OUTPUT_WRITE_FAILED",
  "OUTPUT_STALLED",
  "SOURCE_UNAVAILABLE",
  "INTEGRITY_FAILED",
  "INVALID_MANIFEST",
  "INVALID_MESSAGE",
  "TIMED_OUT",
  "CAPABILITY_UNSUPPORTED"
]);
function closeFor(err) {
  switch (err.code) {
    case "CONNECTION_LOST":
    case "SECURITY_POLICY_MISMATCH":
    case "PEER_FAILED":
    case "PEER_CLOSED":
      return void 0;
    case "OPERATION_CANCELLED":
      return { reason: "USER_CANCELLED" };
    case "PAUSE_LIMIT":
      return err.details?.by === "peer" ? void 0 : { reason: "PAUSE_LIMIT" };
    default:
      if (err.origin === "peer" && err.code === "REQUEST_REJECTED") return void 0;
      return CLOSE_DETAILS2.has(err.code) ? { reason: "FAILED", detail: err.code } : { reason: "FAILED" };
  }
}
var PEER_FAILED_WORDS = Object.freeze({
  // The receiver hears these from the sender.
  receiver: Object.freeze({
    SOURCE_UNAVAILABLE: "The sender's file couldn't be read.",
    INVALID_MESSAGE: "The sender's device couldn't understand what this device sent.",
    other: "The sender's device reported an error."
  }),
  // The sender hears these from the receiver.
  sender: Object.freeze({
    OUTPUT_WRITE_FAILED: "The receiver couldn't save the file.",
    OUTPUT_STALLED: "The receiver's device stopped saving the file.",
    INTEGRITY_FAILED: "The file didn't arrive intact.",
    INVALID_MANIFEST: "The receiver couldn't read the list of files.",
    INVALID_MESSAGE: "The receiver's device couldn't understand what this device sent.",
    other: "The receiver's device reported an error."
  })
});
var OTHER = Object.freeze({ sender: "receiver", receiver: "sender" });
function pauseLimitWords(seconds) {
  const [n, unit] = seconds % 86400 === 0 ? [seconds / 86400, "day"] : seconds % 3600 === 0 ? [seconds / 3600, "hour"] : seconds % 60 === 0 ? [seconds / 60, "minute"] : [seconds, "second"];
  return `${n}-${unit}`;
}
function pauseLimitReached(side, by, limitSeconds) {
  const after = limitSeconds > 0 ? `after a ${pauseLimitWords(limitSeconds)} pause` : "after a pause";
  return new DropgateError({
    code: "PAUSE_LIMIT",
    origin: by === "self" ? "local" : "peer",
    message: by === "self" ? `Your app ended the transfer ${after}.` : `The ${OTHER[side]}'s app ended the transfer ${after}.`,
    details: { by }
  });
}
function outcomeOfClose(close, side, peerPauseLimitSeconds = 0) {
  switch (close.reason) {
    case "USER_CANCELLED":
      return { state: "cancelled", by: "peer" };
    case "USER_DECLINED":
      return side === "sender" ? { state: "cancelled", by: "peer", declined: true } : { state: "cancelled", by: "peer" };
    case "APP_CLOSED":
      return {
        state: "failed",
        error: new DropgateError({ code: "PEER_CLOSED", message: `The ${OTHER[side]} closed Dropgate before the transfer finished.` })
      };
    case "PAUSE_LIMIT":
      return { state: "failed", error: pauseLimitReached(side, "peer", peerPauseLimitSeconds) };
    case "TAKEN":
      if (side === "receiver") {
        return {
          state: "failed",
          error: new DropgateError({ code: "REQUEST_REJECTED", origin: "peer", message: "This transfer is already going to someone else." })
        };
      }
      break;
    case "FAILED":
      if (close.detail === "TIMED_OUT") {
        return { state: "failed", error: new DropgateError({ code: "TIMED_OUT", origin: "peer", message: "The offer wasn't accepted within 10 minutes." }) };
      }
      break;
    default:
      break;
  }
  const reason = close.reason === "FAILED" ? close.detail : close.reason === "TAKEN" ? void 0 : close.reason;
  const words = PEER_FAILED_WORDS[side];
  return {
    state: "failed",
    error: new DropgateError({
      code: "PEER_FAILED",
      message: (reason && words[reason]) ?? words.other,
      ...reason ? { details: { reason } } : {}
    })
  };
}
var _timers4, _ownMs, _peerMs, _limitReached, _timer3, _deadline2, _Holds_instances, stopped_fn, running_fn;
var Holds = class {
  /** Limits in seconds, 0 for none: this side's and the other side's, from the two hellos. */
  constructor(timers, ownLimitSeconds, peerLimitSeconds, limitReached) {
    __privateAdd(this, _Holds_instances);
    __publicField(this, "self", false);
    __publicField(this, "peer", false);
    __privateAdd(this, _timers4);
    __privateAdd(this, _ownMs);
    __privateAdd(this, _peerMs);
    __privateAdd(this, _limitReached);
    __privateAdd(this, _timer3);
    __privateAdd(this, _deadline2, null);
    __privateSet(this, _timers4, timers);
    __privateSet(this, _ownMs, ownLimitSeconds * 1e3);
    __privateSet(this, _peerMs, peerLimitSeconds * 1e3);
    __privateSet(this, _limitReached, limitReached);
  }
  get held() {
    return this.self || this.peer;
  }
  get pausedBy() {
    return this.self && this.peer ? "both" : this.self ? "self" : this.peer ? "peer" : null;
  }
  /** When the transfer ends unless both sides resume first, in milliseconds since the epoch; null when not held or no limit is set. */
  get deadline() {
    return __privateGet(this, _deadline2);
  }
  /** Sets one side's hold. Whether anything changed. */
  set(who, held) {
    if (this[who] === held) return false;
    const was = this.held;
    this[who] = held;
    if (!was && this.held) __privateMethod(this, _Holds_instances, stopped_fn).call(this);
    else if (was && !this.held) __privateMethod(this, _Holds_instances, running_fn).call(this);
    return true;
  }
  /** Every hold let go, and the limit's timer stopped: the transfer has ended, or is past holding. */
  clear() {
    this.self = false;
    this.peer = false;
    __privateMethod(this, _Holds_instances, running_fn).call(this);
  }
};
_timers4 = new WeakMap();
_ownMs = new WeakMap();
_peerMs = new WeakMap();
_limitReached = new WeakMap();
_timer3 = new WeakMap();
_deadline2 = new WeakMap();
_Holds_instances = new WeakSet();
stopped_fn = function() {
  const limits = [__privateGet(this, _ownMs), __privateGet(this, _peerMs)].filter((ms) => ms > 0);
  __privateSet(this, _deadline2, limits.length > 0 ? Date.now() + Math.min(...limits) : null);
  if (__privateGet(this, _ownMs) > 0) __privateSet(this, _timer3, __privateGet(this, _timers4).setTimeout(() => __privateGet(this, _limitReached).call(this), __privateGet(this, _ownMs)));
};
running_fn = function() {
  if (__privateGet(this, _timer3) !== void 0) __privateGet(this, _timers4).clearTimeout(__privateGet(this, _timer3));
  __privateSet(this, _timer3, void 0);
  __privateSet(this, _deadline2, null);
};
var _timers5, _changed, _failed2, _waiting3, _held, _stalled, _shown, _fail3, _stopped2, _StallWatch_instances, start_fn, clear_fn;
var StallWatch = class {
  constructor(timers, changed, failed) {
    __privateAdd(this, _StallWatch_instances);
    __privateAdd(this, _timers5);
    __privateAdd(this, _changed);
    __privateAdd(this, _failed2);
    __privateAdd(this, _waiting3, 0);
    __privateAdd(this, _held, false);
    __privateAdd(this, _stalled, false);
    __privateAdd(this, _shown);
    __privateAdd(this, _fail3);
    __privateAdd(this, _stopped2, false);
    __privateSet(this, _timers5, timers);
    __privateSet(this, _changed, changed);
    __privateSet(this, _failed2, failed);
  }
  /** Whether what the side waits on has taken 30 s or more. */
  get stalled() {
    return __privateGet(this, _stalled);
  }
  /** `work`, watched. */
  async during(work) {
    __privateSet(this, _waiting3, __privateGet(this, _waiting3) + 1);
    if (__privateGet(this, _waiting3) === 1) __privateMethod(this, _StallWatch_instances, start_fn).call(this);
    try {
      return await work;
    } finally {
      __privateSet(this, _waiting3, __privateGet(this, _waiting3) - 1);
      if (__privateGet(this, _waiting3) === 0) __privateMethod(this, _StallWatch_instances, clear_fn).call(this);
    }
  }
  /** The transfer is held (or runs again): nothing counts as stalled while it's held. */
  hold(held) {
    if (__privateGet(this, _held) === held) return;
    __privateSet(this, _held, held);
    if (held) __privateMethod(this, _StallWatch_instances, clear_fn).call(this);
    else if (__privateGet(this, _waiting3) > 0) __privateMethod(this, _StallWatch_instances, start_fn).call(this);
  }
  /** The transfer has ended: no timer runs again. */
  stop() {
    __privateSet(this, _stopped2, true);
    __privateMethod(this, _StallWatch_instances, clear_fn).call(this);
  }
};
_timers5 = new WeakMap();
_changed = new WeakMap();
_failed2 = new WeakMap();
_waiting3 = new WeakMap();
_held = new WeakMap();
_stalled = new WeakMap();
_shown = new WeakMap();
_fail3 = new WeakMap();
_stopped2 = new WeakMap();
_StallWatch_instances = new WeakSet();
start_fn = function() {
  if (__privateGet(this, _held) || __privateGet(this, _stopped2)) return;
  __privateSet(this, _shown, __privateGet(this, _timers5).setTimeout(() => {
    __privateSet(this, _stalled, true);
    __privateGet(this, _changed).call(this);
  }, STALL_SHOWN_MS));
  __privateSet(this, _fail3, __privateGet(this, _timers5).setTimeout(() => __privateGet(this, _failed2).call(this), STALL_FAILED_MS));
};
clear_fn = function() {
  if (__privateGet(this, _shown) !== void 0) __privateGet(this, _timers5).clearTimeout(__privateGet(this, _shown));
  if (__privateGet(this, _fail3) !== void 0) __privateGet(this, _timers5).clearTimeout(__privateGet(this, _fail3));
  __privateSet(this, _shown, void 0);
  __privateSet(this, _fail3, void 0);
  if (__privateGet(this, _stalled)) {
    __privateSet(this, _stalled, false);
    __privateGet(this, _changed).call(this);
  }
};
function deferred2() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => void 0);
  return { promise, resolve, reject };
}
async function within(work, ms, timers) {
  let timer;
  await Promise.race([
    work.catch(() => void 0),
    new Promise((resolve) => {
      timer = timers.setTimeout(resolve, ms);
    })
  ]);
  timers.clearTimeout(timer);
}
var _listeners2;
var Listeners = class {
  constructor() {
    __privateAdd(this, _listeners2, /* @__PURE__ */ new Set());
  }
  add(listener) {
    __privateGet(this, _listeners2).add(listener);
    return () => {
      __privateGet(this, _listeners2).delete(listener);
    };
  }
  notify() {
    for (const listener of [...__privateGet(this, _listeners2)]) {
      try {
        listener();
      } catch {
      }
    }
  }
};
_listeners2 = new WeakMap();

// src/dgdtp/receive.ts
var noLongerOffered = () => new DropgateError({ code: "INVALID_ARGUMENT", message: "There is no offer waiting to be accepted or declined." });
var cantPause = () => new DropgateError({ code: "PAUSE_UNAVAILABLE", message: "A direct transfer can be paused once it has been accepted, until all its data has arrived." });
var connectionLost = () => new DropgateError({ code: "CONNECTION_LOST", message: "The connection was lost, so the transfer couldn't continue." });
var _provider7, _link, _timers6, _generation2, _listeners3, _offer2, _done, _assembler, _maxData, _holds, _stall, _peerPauseLimit, _phase, _state2, _outcome, _files, _totalSize, _manifestHash, _chain, _resumeSecret, _assurance, _result, _sink, _zipOut, _zip, _current, _opened2, _fileIndex, _fileOffset, _blockIndex, _block, _blockFill, _received2, _consumed, _limit, _revision, _filesDone, _creditedAt, _creditOwed, _ackTimer, _offerTimer, _lostTimer, _lastDataAt, _noProgress, _peerStatus, _peerClosed, _pendingClose, _DirectReceiver_instances, arrived_fn, live_fn, take_fn3, manifest_fn, data_fn, blockEnd_fn, fileEnd_fn, finish_fn, resultAck_fn, hold_fn, holdChanged_fn, noProgressDue_fn, status_fn, statusHeard_fn, closeHeard_fn, answerClose_fn, blockLength_fn, openFile_fn, write_fn, zipStep_fn, zipAsync_fn, creditMoved_fn, sendCredit_fn, setState_fn, complete_fn, lost_fn2, fail_fn, clearOfferTimer_fn, quiet_fn, end_fn3;
var DirectReceiver = class {
  constructor(provider, channel, options = {}) {
    __privateAdd(this, _DirectReceiver_instances);
    __privateAdd(this, _provider7);
    __privateAdd(this, _link);
    __privateAdd(this, _timers6);
    __privateAdd(this, _generation2);
    __privateAdd(this, _listeners3, new Listeners());
    __privateAdd(this, _offer2, deferred2());
    __privateAdd(this, _done, deferred2());
    __privateAdd(this, _assembler);
    __privateAdd(this, _maxData);
    __privateAdd(this, _holds);
    __privateAdd(this, _stall);
    __privateAdd(this, _peerPauseLimit);
    __privateAdd(this, _phase, "offer");
    __privateAdd(this, _state2, "connecting");
    __privateAdd(this, _outcome);
    __privateAdd(this, _files, []);
    __privateAdd(this, _totalSize, 0);
    __privateAdd(this, _manifestHash);
    __privateAdd(this, _chain);
    __privateAdd(this, _resumeSecret);
    __privateAdd(this, _assurance, "saved");
    __privateAdd(this, _result);
    // The output.
    __privateAdd(this, _sink);
    __privateAdd(this, _zipOut);
    __privateAdd(this, _zip);
    __privateAdd(this, _current);
    __privateAdd(this, _opened2, -1);
    // Where the files stand.
    __privateAdd(this, _fileIndex, 0);
    __privateAdd(this, _fileOffset, 0);
    __privateAdd(this, _blockIndex, 0);
    __privateAdd(this, _block);
    __privateAdd(this, _blockFill, 0);
    __privateAdd(this, _received2, 0);
    __privateAdd(this, _consumed, 0);
    __privateAdd(this, _limit, 0);
    __privateAdd(this, _revision, 0);
    __privateAdd(this, _filesDone, 0);
    __privateAdd(this, _creditedAt, 0);
    /** A CREDIT held back while the transfer was held. */
    __privateAdd(this, _creditOwed, false);
    // Timers, and the end.
    __privateAdd(this, _ackTimer);
    __privateAdd(this, _offerTimer);
    __privateAdd(this, _lostTimer);
    __privateAdd(this, _lastDataAt, 0);
    __privateAdd(this, _noProgress);
    __privateAdd(this, _peerStatus);
    /** The other side's CLOSE has been heard: another is ignored. */
    __privateAdd(this, _peerClosed, false);
    /** A CLOSE heard while the files were being finished, answered once they are. */
    __privateAdd(this, _pendingClose);
    if (channel?.role !== "receiver") throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A receive runs over the receiver's channel." });
    __privateSet(this, _provider7, provider);
    __privateSet(this, _timers6, options.timers ?? GLOBAL_TIMERS);
    __privateSet(this, _generation2, channel.generation);
    const g = __privateGet(this, _generation2);
    __privateSet(this, _peerPauseLimit, channel.peerHello.pauseLimitSeconds);
    __privateSet(this, _holds, new Holds(__privateGet(this, _timers6), channel.hello?.pauseLimitSeconds ?? 0, __privateGet(this, _peerPauseLimit), () => {
      __privateMethod(this, _DirectReceiver_instances, fail_fn).call(this, pauseLimitReached("receiver", "self", channel.hello.pauseLimitSeconds), g);
    }));
    __privateSet(this, _stall, new StallWatch(__privateGet(this, _timers6), () => __privateGet(this, _listeners3).notify(), () => {
      __privateMethod(this, _DirectReceiver_instances, fail_fn).call(this, new DropgateError({ code: "OUTPUT_STALLED" }), g);
    }));
    __privateSet(this, _noProgress, new Deadline(__privateGet(this, _timers6), () => __privateMethod(this, _DirectReceiver_instances, noProgressDue_fn).call(this), () => {
      __privateSet(this, _lastDataAt, __privateGet(this, _timers6).now());
      __privateGet(this, _link).askStatus();
      __privateGet(this, _noProgress).arm();
    }));
    __privateSet(this, _link, new Link(channel, {
      arrived: (record) => __privateMethod(this, _DirectReceiver_instances, arrived_fn).call(this, record),
      record: (inbound) => this.deliver(inbound),
      ended: (err) => __privateMethod(this, _DirectReceiver_instances, lost_fn2).call(this, err),
      close: (message, generation) => __privateMethod(this, _DirectReceiver_instances, closeHeard_fn).call(this, message, generation),
      status: () => __privateMethod(this, _DirectReceiver_instances, status_fn).call(this),
      statusHeard: (answer, generation) => __privateMethod(this, _DirectReceiver_instances, statusHeard_fn).call(this, answer, generation)
    }, __privateGet(this, _timers6)));
    __privateSet(this, _assembler, new ManifestAssembler(__privateGet(this, _link).recordBytes));
    __privateSet(this, _maxData, dataBytes(__privateGet(this, _link).recordBytes));
    __privateGet(this, _link).start();
  }
  /** Where the transfer stands. */
  get state() {
    return __privateGet(this, _state2);
  }
  /** How it ended, once it has. */
  get done() {
    return __privateGet(this, _done).promise;
  }
  /** Whether `pause()` can be called now: from ACCEPT until all the data has arrived (FINISH). */
  get canPause() {
    return __privateGet(this, _phase) === "receiving";
  }
  /** Who holds the transfer: this side, the sender, both, or no one. */
  get pausedBy() {
    return __privateGet(this, _holds).pausedBy;
  }
  /** While held: when the transfer ends unless both sides resume first (ms since the epoch, the earlier of both limits); else null. */
  get deadline() {
    return __privateGet(this, _holds).deadline;
  }
  /** Whether writing the files has taken 30 s or more for the step it's on. */
  get stalled() {
    return __privateGet(this, _stall).stalled;
  }
  /** The sender's last answer to a STATUS ask, if one has come. */
  get peerStatus() {
    return __privateGet(this, _peerStatus);
  }
  /** How far it is: the bytes written to the sink, and the file being received (0-based; the count once all are in). */
  get progress() {
    return { consumed: __privateGet(this, _consumed), fileIndex: __privateGet(this, _fileIndex) };
  }
  /**
   * Calls `listener` whenever `state`, `pausedBy`, `deadline`, `stalled`, `peerStatus` or `progress` changes. Returns a
   * function that stops it.
   */
  onChange(listener) {
    return __privateGet(this, _listeners3).add(listener);
  }
  /** The sender's files, once the whole list has come and been checked. Rejects if the transfer ends first. */
  offer() {
    return __privateGet(this, _offer2).promise;
  }
  /**
   * Accepts the offer into `options.sink`. INVALID_ARGUMENT, with nothing sent
   * and the offer still waiting, for no sink, one without `write()` and
   * `close()`, or several files apart into one sink. A sink that can't be had
   * fails the receive OUTPUT_WRITE_FAILED before anything is accepted.
   */
  async accept(options) {
    await this.offer();
    if (__privateGet(this, _phase) !== "offered") throw noLongerOffered();
    const { sink, asZip = false, handOff = false } = options ?? {};
    if (typeof sink !== "function" && !isDownloadSink(sink)) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A direct transfer is received into a sink: one, or a function giving one for each file." });
    }
    if (__privateGet(this, _files).length > 1 && !asZip && typeof sink !== "function") {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "Several files received apart need a function giving a sink for each file." });
    }
    __privateSet(this, _phase, "accepting");
    __privateMethod(this, _DirectReceiver_instances, clearOfferTimer_fn).call(this);
    __privateSet(this, _sink, sink);
    __privateSet(this, _assurance, handOff ? "handed-off" : "saved");
    const g = __privateGet(this, _generation2);
    try {
      if (asZip) {
        const zipOut = await SinkWriter.open(sink, { name: "", size: __privateGet(this, _totalSize), index: 0 });
        __privateSet(this, _zipOut, zipOut);
        __privateSet(this, _zip, new StreamingZipWriter((chunk) => zipOut.write(chunk)));
      }
      await __privateMethod(this, _DirectReceiver_instances, openFile_fn).call(this, 0, g);
    } catch (err) {
      __privateMethod(this, _DirectReceiver_instances, fail_fn).call(this, err, g);
      throw toDropgateError(err);
    }
    if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) throw new DropgateError({ code: "OPERATION_CANCELLED" });
    const resumeSecret = __privateGet(this, _provider7).randomBytes(RESUME_SECRET_BYTES);
    __privateSet(this, _resumeSecret, resumeSecret);
    __privateSet(this, _limit, CREDIT_WINDOW_BYTES);
    __privateSet(this, _chain, await chainStart(__privateGet(this, _provider7), __privateGet(this, _manifestHash)));
    if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) throw new DropgateError({ code: "OPERATION_CANCELLED" });
    __privateGet(this, _link).send({
      type: "accept",
      manifestHash: __privateGet(this, _manifestHash),
      resumeSecret,
      creditLimit: __privateGet(this, _limit),
      sink: __privateGet(this, _assurance)
    });
    __privateSet(this, _phase, "receiving");
    __privateSet(this, _lastDataAt, __privateGet(this, _timers6).now());
    __privateGet(this, _noProgress).arm();
    __privateMethod(this, _DirectReceiver_instances, setState_fn).call(this, "transferring");
  }
  /** Declines the offer: the sender is told (CLOSE, USER_DECLINED), and this side ends cancelled. */
  decline() {
    if (__privateGet(this, _phase) !== "offer" && __privateGet(this, _phase) !== "offered") throw noLongerOffered();
    void __privateMethod(this, _DirectReceiver_instances, end_fn3).call(this, { state: "cancelled", by: "self" }, { reason: "USER_DECLINED" });
  }
  /**
   * Cancels: the sender told (CLOSE, USER_CANCELLED), the sink aborted. Once
   * RESULT has gone the files are saved, and a cancel can't undo that: the
   * transfer completes.
   */
  cancel() {
    if (__privateGet(this, _phase) === "result") {
      __privateMethod(this, _DirectReceiver_instances, complete_fn).call(this);
      return;
    }
    void __privateMethod(this, _DirectReceiver_instances, end_fn3).call(this, { state: "cancelled", by: "self" }, { reason: "USER_CANCELLED" });
  }
  /**
   * The app is closing (a page hidden for good, the desktop quitting): the
   * sender told (CLOSE, APP_CLOSED, both ways, best effort), and this side
   * ends cancelled.
   */
  appClosed() {
    if (__privateGet(this, _phase) === "result") {
      __privateMethod(this, _DirectReceiver_instances, complete_fn).call(this);
      return;
    }
    void __privateMethod(this, _DirectReceiver_instances, end_fn3).call(this, { state: "cancelled", by: "self" }, { reason: "APP_CLOSED" });
  }
  /** Holds the transfer (HOLD): no more credit is given; what's on its way is still saved. PAUSE_UNAVAILABLE unless `canPause`. */
  pause() {
    if (!this.canPause) throw cantPause();
    if (!__privateGet(this, _holds).set("self", true)) return;
    __privateGet(this, _link).send({ type: "hold", held: true, reason: "person" });
    __privateMethod(this, _DirectReceiver_instances, holdChanged_fn).call(this);
  }
  /** Lets this side's hold go (HOLD): the transfer runs again once the sender holds it no more. Nothing if this side doesn't hold it. */
  resume() {
    if (__privateGet(this, _phase) !== "receiving" || !__privateGet(this, _holds).set("self", false)) return;
    __privateGet(this, _link).send({ type: "hold", held: false, reason: "person" });
    __privateMethod(this, _DirectReceiver_instances, holdChanged_fn).call(this);
  }
  /**
   * One record from the other side, with its connection's generation. The
   * channel's own records come here; so can a test's. One from another
   * generation, or after the end, is dropped and touches nothing.
   * @internal
   */
  async deliver(inbound) {
    const g = inbound.generation;
    if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
    try {
      await __privateMethod(this, _DirectReceiver_instances, take_fn3).call(this, readRecord(inbound.record), g);
    } catch (err) {
      __privateMethod(this, _DirectReceiver_instances, fail_fn).call(this, err, g);
    }
  }
};
_provider7 = new WeakMap();
_link = new WeakMap();
_timers6 = new WeakMap();
_generation2 = new WeakMap();
_listeners3 = new WeakMap();
_offer2 = new WeakMap();
_done = new WeakMap();
_assembler = new WeakMap();
_maxData = new WeakMap();
_holds = new WeakMap();
_stall = new WeakMap();
_peerPauseLimit = new WeakMap();
_phase = new WeakMap();
_state2 = new WeakMap();
_outcome = new WeakMap();
_files = new WeakMap();
_totalSize = new WeakMap();
_manifestHash = new WeakMap();
_chain = new WeakMap();
_resumeSecret = new WeakMap();
_assurance = new WeakMap();
_result = new WeakMap();
_sink = new WeakMap();
_zipOut = new WeakMap();
_zip = new WeakMap();
_current = new WeakMap();
_opened2 = new WeakMap();
_fileIndex = new WeakMap();
_fileOffset = new WeakMap();
_blockIndex = new WeakMap();
_block = new WeakMap();
_blockFill = new WeakMap();
_received2 = new WeakMap();
_consumed = new WeakMap();
_limit = new WeakMap();
_revision = new WeakMap();
_filesDone = new WeakMap();
_creditedAt = new WeakMap();
_creditOwed = new WeakMap();
_ackTimer = new WeakMap();
_offerTimer = new WeakMap();
_lostTimer = new WeakMap();
_lastDataAt = new WeakMap();
_noProgress = new WeakMap();
_peerStatus = new WeakMap();
_peerClosed = new WeakMap();
_pendingClose = new WeakMap();
_DirectReceiver_instances = new WeakSet();
/**
 * Each record as it arrives, while earlier ones may still be waiting on the
 * sink: DATA is counted against the credit given, so a sender that sends
 * past it is refused at once, never held in memory unread.
 */
arrived_fn = function(record) {
  if (record[0] !== MESSAGE_TYPE.DATA || record.byteLength <= DATA_HEADER_BYTES) return;
  __privateSet(this, _received2, __privateGet(this, _received2) + (record.byteLength - DATA_HEADER_BYTES));
  __privateSet(this, _lastDataAt, __privateGet(this, _timers6).now());
  if (__privateGet(this, _received2) > __privateGet(this, _limit)) __privateMethod(this, _DirectReceiver_instances, fail_fn).call(this, invalidMessage2(), __privateGet(this, _generation2));
};
/** Whether an effect of generation `g` may still touch anything. */
live_fn = function(g) {
  return __privateGet(this, _phase) !== "ended" && g === __privateGet(this, _generation2);
};
take_fn3 = async function(message, g) {
  switch (message.type) {
    case "manifest":
      return __privateMethod(this, _DirectReceiver_instances, manifest_fn).call(this, message, g);
    case "data":
      return __privateMethod(this, _DirectReceiver_instances, data_fn).call(this, message, g);
    case "block-end":
      return __privateMethod(this, _DirectReceiver_instances, blockEnd_fn).call(this, message, g);
    case "file-end":
      return __privateMethod(this, _DirectReceiver_instances, fileEnd_fn).call(this, message, g);
    case "finish":
      return __privateMethod(this, _DirectReceiver_instances, finish_fn).call(this, message, g);
    case "result-ack":
      return __privateMethod(this, _DirectReceiver_instances, resultAck_fn).call(this, message);
    case "hold":
      return __privateMethod(this, _DirectReceiver_instances, hold_fn).call(this, message);
    default:
      throw invalidMessage2();
  }
};
manifest_fn = async function(m, g) {
  const bytes = __privateGet(this, _assembler).take(m);
  if (!bytes) return;
  const manifest = decodeManifest(bytes);
  const hash = await manifestHash(__privateGet(this, _provider7), bytes);
  if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
  __privateSet(this, _files, manifest.files);
  __privateSet(this, _totalSize, manifest.totalSize);
  __privateSet(this, _manifestHash, hash);
  __privateSet(this, _phase, "offered");
  __privateSet(this, _offerTimer, __privateGet(this, _timers6).setTimeout(() => __privateMethod(this, _DirectReceiver_instances, fail_fn).call(this, offerTimedOut(), g), OFFER_TIMEOUT_MS));
  __privateMethod(this, _DirectReceiver_instances, setState_fn).call(this, "offered");
  __privateGet(this, _offer2).resolve(Object.freeze({
    files: Object.freeze(manifest.files.map((file) => Object.freeze({ ...file }))),
    totalSize: manifest.totalSize
  }));
};
data_fn = function(m, g) {
  const file = __privateGet(this, _files)[__privateGet(this, _fileIndex)];
  if (!file || m.fileIndex !== __privateGet(this, _fileIndex) || m.offset !== __privateGet(this, _fileOffset)) throw invalidMessage2();
  const blockLength = __privateMethod(this, _DirectReceiver_instances, blockLength_fn).call(this, file);
  const left = blockLength - __privateGet(this, _blockFill);
  if (left <= 0 || m.bytes.byteLength !== Math.min(__privateGet(this, _maxData), left)) throw invalidMessage2();
  __privateGet(this, _block) ?? __privateSet(this, _block, new Uint8Array(blockLength));
  __privateGet(this, _block).set(m.bytes, __privateGet(this, _blockFill));
  __privateSet(this, _blockFill, __privateGet(this, _blockFill) + m.bytes.byteLength);
  __privateSet(this, _fileOffset, __privateGet(this, _fileOffset) + m.bytes.byteLength);
  return __privateMethod(this, _DirectReceiver_instances, openFile_fn).call(this, __privateGet(this, _fileIndex), g);
};
blockEnd_fn = async function(m, g) {
  if (__privateGet(this, _phase) !== "receiving") throw invalidMessage2();
  const file = __privateGet(this, _files)[__privateGet(this, _fileIndex)];
  if (!file || m.fileIndex !== __privateGet(this, _fileIndex) || m.blockIndex !== __privateGet(this, _blockIndex)) throw invalidMessage2();
  const blockLength = __privateMethod(this, _DirectReceiver_instances, blockLength_fn).call(this, file);
  if (blockLength <= 0 || __privateGet(this, _blockFill) !== blockLength || m.length !== blockLength) throw invalidMessage2();
  const block = __privateGet(this, _block);
  const hash = await __privateGet(this, _provider7).sha256(block);
  if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
  if (!sameBytes(hash, m.hash)) throw integrityFailed("A block of a file didn't match its hash.");
  const chain = await chainBlock(__privateGet(this, _provider7), __privateGet(this, _chain), { fileIndex: m.fileIndex, blockIndex: m.blockIndex, length: blockLength, hash });
  if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
  __privateSet(this, _chain, chain);
  __privateSet(this, _block, void 0);
  __privateSet(this, _blockFill, 0);
  __privateSet(this, _blockIndex, __privateGet(this, _blockIndex) + 1);
  await __privateMethod(this, _DirectReceiver_instances, write_fn).call(this, block, g);
  if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
  __privateSet(this, _consumed, __privateGet(this, _consumed) + blockLength);
  __privateMethod(this, _DirectReceiver_instances, creditMoved_fn).call(this, false);
  __privateGet(this, _listeners3).notify();
};
fileEnd_fn = async function(m, g) {
  if (__privateGet(this, _phase) !== "receiving") throw invalidMessage2();
  const file = __privateGet(this, _files)[__privateGet(this, _fileIndex)];
  if (!file || m.fileIndex !== __privateGet(this, _fileIndex)) throw invalidMessage2();
  const blocks = blockCount(file.size);
  if (m.size !== file.size || m.blockCount !== blocks) throw integrityFailed("A file's end didn't match the list of files.");
  if (__privateGet(this, _blockIndex) !== blocks || __privateGet(this, _blockFill) !== 0) throw invalidMessage2();
  const chain = await chainFileEnd(__privateGet(this, _provider7), __privateGet(this, _chain), { fileIndex: m.fileIndex, size: file.size, blockCount: blocks });
  if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
  if (!sameBytes(chain, m.chain)) throw integrityFailed("A file's checkpoint didn't match.");
  __privateSet(this, _chain, chain);
  await __privateMethod(this, _DirectReceiver_instances, openFile_fn).call(this, __privateGet(this, _fileIndex), g);
  if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
  const last = __privateGet(this, _fileIndex) === __privateGet(this, _files).length - 1;
  if (__privateGet(this, _zip)) {
    __privateMethod(this, _DirectReceiver_instances, zipStep_fn).call(this, () => __privateGet(this, _zip).endFile());
    __privateSet(this, _filesDone, __privateGet(this, _filesDone) + 1);
  } else if (!last) {
    const sink = __privateGet(this, _current);
    __privateSet(this, _current, void 0);
    await __privateGet(this, _stall).during(sink.close());
    if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
    __privateSet(this, _filesDone, __privateGet(this, _filesDone) + 1);
  }
  __privateSet(this, _fileIndex, __privateGet(this, _fileIndex) + 1);
  __privateSet(this, _fileOffset, 0);
  __privateSet(this, _blockIndex, 0);
  __privateMethod(this, _DirectReceiver_instances, creditMoved_fn).call(this, true);
  __privateGet(this, _listeners3).notify();
};
finish_fn = async function(m, g) {
  if (__privateGet(this, _phase) !== "receiving" || __privateGet(this, _fileIndex) !== __privateGet(this, _files).length) throw invalidMessage2();
  if (m.fileCount !== __privateGet(this, _files).length || m.totalSize !== __privateGet(this, _totalSize) || !sameBytes(m.manifestHash, __privateGet(this, _manifestHash)) || !sameBytes(m.chain, __privateGet(this, _chain))) {
    throw integrityFailed("The transfer's end didn't match what arrived.");
  }
  __privateSet(this, _phase, "finalising");
  __privateGet(this, _holds).clear();
  __privateGet(this, _stall).hold(false);
  __privateGet(this, _noProgress).stop();
  __privateMethod(this, _DirectReceiver_instances, setState_fn).call(this, "finalising");
  __privateGet(this, _listeners3).notify();
  if (__privateGet(this, _zip)) {
    await __privateGet(this, _stall).during(__privateMethod(this, _DirectReceiver_instances, zipAsync_fn).call(this, () => __privateGet(this, _zip).finalize()));
    if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
    await __privateGet(this, _stall).during(__privateGet(this, _zipOut).close());
  } else {
    await __privateGet(this, _stall).during(__privateGet(this, _current).close());
  }
  if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
  __privateSet(this, _current, void 0);
  __privateSet(this, _zipOut, void 0);
  const result = {
    commitId: __privateGet(this, _provider7).randomBytes(16),
    assurance: __privateGet(this, _assurance),
    fileCount: __privateGet(this, _files).length,
    totalSize: __privateGet(this, _totalSize),
    chain: __privateGet(this, _chain)
  };
  __privateSet(this, _result, result);
  __privateGet(this, _link).send({ type: "result", ...result });
  __privateSet(this, _phase, "result");
  if (__privateGet(this, _pendingClose)) {
    __privateMethod(this, _DirectReceiver_instances, answerClose_fn).call(this, __privateGet(this, _pendingClose));
    return;
  }
  __privateSet(this, _ackTimer, __privateGet(this, _timers6).setTimeout(() => {
    if (__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) __privateMethod(this, _DirectReceiver_instances, complete_fn).call(this);
  }, RESULT_ACK_WAIT_MS));
};
resultAck_fn = function(m) {
  if (__privateGet(this, _phase) !== "result") throw invalidMessage2();
  if (sameBytes(m.commitId, __privateGet(this, _result).commitId)) __privateMethod(this, _DirectReceiver_instances, complete_fn).call(this);
};
/** The sender's HOLD: heard from ACCEPT until FINISH, passed over otherwise (once all the data is in, nothing is left to hold). */
hold_fn = function(m) {
  if (__privateGet(this, _phase) !== "receiving") return;
  if (__privateGet(this, _holds).set("peer", m.held)) __privateMethod(this, _DirectReceiver_instances, holdChanged_fn).call(this);
};
/** A hold began or ended: stalls stop counting while held; when it runs again, any CREDIT held back goes. */
holdChanged_fn = function() {
  const held = __privateGet(this, _holds).held;
  __privateGet(this, _stall).hold(held);
  if (!held) {
    __privateSet(this, _lastDataAt, __privateGet(this, _timers6).now());
    if (__privateGet(this, _creditOwed)) __privateMethod(this, _DirectReceiver_instances, sendCredit_fn).call(this);
    __privateGet(this, _noProgress).arm();
  }
  __privateGet(this, _listeners3).notify();
};
/** When to ask the sender where it stands: credit given, nothing held, and no data for 30 s. */
noProgressDue_fn = function() {
  if (__privateGet(this, _phase) !== "receiving" || __privateGet(this, _holds).held || __privateGet(this, _received2) >= __privateGet(this, _limit)) return void 0;
  return __privateGet(this, _lastDataAt) + NO_PROGRESS_MS;
};
status_fn = function() {
  const state = __privateGet(this, _phase) === "offered" ? STATUS_STATE.OFFERED : __privateGet(this, _phase) === "receiving" ? STATUS_STATE.TRANSFERRING : __privateGet(this, _phase) === "finalising" ? STATUS_STATE.FINALISING : __privateGet(this, _result) && (__privateGet(this, _phase) === "result" || __privateGet(this, _outcome)?.state === "completed") ? STATUS_STATE.FINISHED : 0;
  const result = state === STATUS_STATE.FINISHED ? { result: __privateGet(this, _result) } : {};
  return { state, held: __privateGet(this, _holds).self, consumed: __privateGet(this, _consumed), ...result };
};
statusHeard_fn = function(answer, g) {
  if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
  __privateSet(this, _peerStatus, Object.freeze({ state: answer.state, held: answer.held, consumed: answer.consumed }));
  __privateGet(this, _listeners3).notify();
};
/**
 * The sender's CLOSE, by either path, as it arrives. A second is ignored.
 * One that comes while the files are being finished is answered once they
 * are: CLOSE_ACK{finished} with the RESULT, and the receive completes.
 */
closeHeard_fn = function(m, g) {
  if (g !== __privateGet(this, _generation2) || __privateGet(this, _peerClosed)) return;
  __privateSet(this, _peerClosed, true);
  if (__privateGet(this, _phase) === "finalising") {
    __privateSet(this, _pendingClose, m);
    return;
  }
  __privateMethod(this, _DirectReceiver_instances, answerClose_fn).call(this, m);
};
/** CLOSE_ACK, then this side ends as the CLOSE says, unless the files are already saved: then it's completed. */
answerClose_fn = function(m) {
  __privateSet(this, _pendingClose, void 0);
  const result = __privateGet(this, _phase) === "result" || __privateGet(this, _outcome)?.state === "completed" ? __privateGet(this, _result) : void 0;
  if (result) {
    __privateGet(this, _link).send({ type: "close-ack", operationId: m.operationId, finished: true, result });
    __privateMethod(this, _DirectReceiver_instances, complete_fn).call(this);
    return;
  }
  __privateGet(this, _link).send({ type: "close-ack", operationId: m.operationId, finished: false });
  void __privateMethod(this, _DirectReceiver_instances, end_fn3).call(this, outcomeOfClose(m, "receiver", __privateGet(this, _peerPauseLimit)));
};
/** The length of the block being received. */
blockLength_fn = function(file) {
  return Math.min(BLOCK_BYTES, file.size - __privateGet(this, _blockIndex) * BLOCK_BYTES);
};
openFile_fn = async function(index, g) {
  if (__privateGet(this, _opened2) >= index) return;
  __privateSet(this, _opened2, index);
  const file = __privateGet(this, _files)[index];
  if (__privateGet(this, _zip)) {
    __privateMethod(this, _DirectReceiver_instances, zipStep_fn).call(this, () => __privateGet(this, _zip).startFile(file.name, file.size));
    return;
  }
  const opening = SinkWriter.open(__privateGet(this, _sink), { name: file.name, size: file.size, index });
  const sink = index === 0 ? await opening : await __privateGet(this, _stall).during(opening);
  if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) {
    await sink.abort(new DropgateError({ code: "OPERATION_CANCELLED" }));
    return;
  }
  __privateSet(this, _current, sink);
};
write_fn = async function(block, g) {
  if (__privateGet(this, _zip)) {
    const zip2 = __privateGet(this, _zip);
    __privateMethod(this, _DirectReceiver_instances, zipStep_fn).call(this, () => zip2.writeChunk(block));
    await __privateGet(this, _stall).during(__privateMethod(this, _DirectReceiver_instances, zipAsync_fn).call(this, () => zip2.drained()));
    return;
  }
  if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
  await __privateGet(this, _stall).during(__privateGet(this, _current).write(block));
};
/** A ZIP writer's step: its refusal of a size is the sender's bytes not matching; anything else the output's. */
zipStep_fn = function(run) {
  try {
    run();
  } catch (err) {
    throw zipError(err);
  }
};
zipAsync_fn = async function(run) {
  try {
    await run();
  } catch (err) {
    throw zipError(err);
  }
};
/**
 * What's written moved: CREDIT once it has moved 256 KiB since the last, or
 * at once (`now`) as a file finishes. Writes are whole blocks, so every one
 * either moves 1 MiB or ends a file (a shorter block is always a file's
 * last): no CREDIT ever waits on a timer. While the transfer is held none
 * goes; it's sent once it runs again.
 */
creditMoved_fn = function(now) {
  if (__privateGet(this, _phase) !== "receiving") return;
  if (!now && __privateGet(this, _consumed) - __privateGet(this, _creditedAt) < CREDIT_STEP_BYTES) return;
  if (__privateGet(this, _holds).held) {
    __privateSet(this, _creditOwed, true);
    return;
  }
  __privateMethod(this, _DirectReceiver_instances, sendCredit_fn).call(this);
};
sendCredit_fn = function() {
  __privateSet(this, _creditOwed, false);
  __privateSet(this, _revision, __privateGet(this, _revision) + 1);
  __privateSet(this, _limit, __privateGet(this, _consumed) + CREDIT_WINDOW_BYTES);
  __privateSet(this, _creditedAt, __privateGet(this, _consumed));
  __privateGet(this, _link).send({
    type: "credit",
    revision: __privateGet(this, _revision),
    limit: __privateGet(this, _limit),
    consumed: __privateGet(this, _consumed),
    filesDone: __privateGet(this, _filesDone),
    verifiedFileIndex: __privateGet(this, _fileIndex),
    verifiedOffset: __privateGet(this, _blockIndex) * BLOCK_BYTES
  });
  __privateGet(this, _noProgress).arm();
};
setState_fn = function(state) {
  if (__privateGet(this, _state2) === state) return;
  __privateSet(this, _state2, state);
  __privateGet(this, _listeners3).notify();
};
complete_fn = function() {
  void __privateMethod(this, _DirectReceiver_instances, end_fn3).call(this, { state: "completed", assurance: __privateGet(this, _assurance) });
};
/**
 * The channel ended under the transfer: completed if RESULT has gone (the
 * files are saved). A lost connection listens 2 s for the sender's CLOSE
 * through the rendezvous, which ends it as that says; else it ends
 * CONNECTION_LOST. Any other end is as the channel says.
 */
lost_fn2 = function(err) {
  if (__privateGet(this, _phase) === "result") {
    __privateMethod(this, _DirectReceiver_instances, complete_fn).call(this);
    return;
  }
  if (__privateGet(this, _phase) === "ended") return;
  if (err.code !== "CONNECTION_LOST") {
    void __privateMethod(this, _DirectReceiver_instances, end_fn3).call(this, { state: "failed", error: err });
    return;
  }
  __privateMethod(this, _DirectReceiver_instances, quiet_fn).call(this);
  const g = __privateGet(this, _generation2);
  __privateSet(this, _lostTimer, __privateGet(this, _timers6).setTimeout(() => {
    if (__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) void __privateMethod(this, _DirectReceiver_instances, end_fn3).call(this, { state: "failed", error: connectionLost() });
  }, LATE_CLOSE_WAIT_MS));
};
/** This side failed, in generation `g`: the sender told with a CLOSE. A failure from another generation is dropped. */
fail_fn = function(err, g) {
  if (!__privateMethod(this, _DirectReceiver_instances, live_fn).call(this, g)) return;
  const error = toDropgateError(err);
  void __privateMethod(this, _DirectReceiver_instances, end_fn3).call(this, { state: "failed", error }, closeFor(error));
};
clearOfferTimer_fn = function() {
  if (__privateGet(this, _offerTimer) !== void 0) __privateGet(this, _timers6).clearTimeout(__privateGet(this, _offerTimer));
  __privateSet(this, _offerTimer, void 0);
};
/** Every timer of the transfer stopped: it's ending, or waiting to hear why its connection went. */
quiet_fn = function() {
  __privateMethod(this, _DirectReceiver_instances, clearOfferTimer_fn).call(this);
  if (__privateGet(this, _ackTimer) !== void 0) __privateGet(this, _timers6).clearTimeout(__privateGet(this, _ackTimer));
  __privateSet(this, _ackTimer, void 0);
  __privateGet(this, _noProgress).stop();
  __privateGet(this, _stall).stop();
  __privateGet(this, _holds).clear();
};
end_fn3 = async function(outcome, close) {
  if (__privateGet(this, _phase) === "ended") return;
  __privateSet(this, _phase, "ended");
  __privateSet(this, _outcome, outcome);
  __privateMethod(this, _DirectReceiver_instances, quiet_fn).call(this);
  if (__privateGet(this, _lostTimer) !== void 0) __privateGet(this, _timers6).clearTimeout(__privateGet(this, _lostTimer));
  __privateGet(this, _resumeSecret)?.fill(0);
  __privateSet(this, _resumeSecret, void 0);
  __privateSet(this, _block, void 0);
  if (outcome.state !== "completed") {
    const reason = outcome.state === "failed" ? outcome.error : new DropgateError({ code: "OPERATION_CANCELLED" });
    for (const sink of [__privateGet(this, _current), __privateGet(this, _zipOut)]) void sink?.abort(reason);
  }
  __privateSet(this, _current, void 0);
  __privateSet(this, _zipOut, void 0);
  __privateSet(this, _zip, void 0);
  const ended = outcome.state === "failed" ? outcome.error : new DropgateError({ code: "OPERATION_CANCELLED" });
  __privateGet(this, _offer2).reject(ended);
  __privateSet(this, _state2, outcome.state);
  __privateGet(this, _done).resolve(outcome);
  __privateGet(this, _listeners3).notify();
  __privateGet(this, _link).stream(void 0);
  if (__privateGet(this, _pendingClose)) {
    __privateGet(this, _link).send({ type: "close-ack", operationId: __privateGet(this, _pendingClose).operationId, finished: false });
    __privateSet(this, _pendingClose, void 0);
  }
  if (close && !__privateGet(this, _peerClosed)) {
    await __privateGet(this, _link).closeWith({ type: "close", operationId: __privateGet(this, _provider7).randomBytes(16), ...close });
  } else {
    await within(__privateGet(this, _link).flush(), CLOSE_ACK_WAIT_MS, __privateGet(this, _timers6));
  }
  __privateGet(this, _link).close();
};
function zipError(err) {
  if (DropgateError.is(err, "INVALID_ARGUMENT")) return integrityFailed("A file's bytes didn't match its size.");
  return toDropgateError(err, "OUTPUT_WRITE_FAILED");
}
function receiveDirect(provider, channel, options) {
  return new DirectReceiver(provider, channel, options);
}

// src/dgdtp/rendezvous.ts
var RENDEZVOUS_PATH = "/api/v4/rendezvous";
var RENEW_INTERVAL_MS = 4 * 6e4;
var CODE_RETRY_MS = 15e3;
var RENDEZVOUS_TYPE = Object.freeze({
  CREATE: 1,
  CODE: 2,
  RENEW: 3,
  SEND: 4,
  DROP: 5,
  LOCK: 6,
  CREATED: 129,
  CODE_IS: 130,
  ATTEMPT: 131,
  FRAME_TO_SENDER: 132,
  GONE_TO_SENDER: 133,
  CODE_GONE: 134,
  JOIN: 17,
  RECEIVER_SEND: 18,
  JOINED: 145,
  FRAME_TO_RECEIVER: 146,
  GONE_TO_RECEIVER: 147,
  ERROR: 255
});
var RENDEZVOUS_ERROR = Object.freeze({
  VERSION_UNSUPPORTED: 1,
  NOT_FOUND: 2,
  BUSY: 3,
  MALFORMED: 4,
  LIMIT: 5,
  AUTH_REQUIRED: 6,
  AUTH_EXPIRED: 7,
  AUTH_DENIED: 8
});
var MAX_CREDENTIAL_BYTES = 8192;
var TOKEN682 = /^[A-Za-z0-9\-._~+/]+=*$/;
var CLOSE_NORMAL = 1e3;
var BY = Object.freeze({ link: 1, code: 2 });
var GLOBAL_TIMERS2 = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle)
};
function rendezvousUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw invalid9("A server address is http: or https:.");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${RENDEZVOUS_PATH}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
var invalid9 = (message) => new DropgateError({ code: "INVALID_ARGUMENT", message });
var invalidResponse = () => new DropgateError({ code: "INVALID_RESPONSE" });
var lost3 = () => new DropgateError({ code: "CONNECTION_LOST" });
var unreachable = () => new DropgateError({ code: "SERVER_UNREACHABLE" });
var ascii3 = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));
function bytesOf2(...parts) {
  const length = parts.reduce((n, p) => n + (typeof p === "number" ? 1 : p.byteLength), 0);
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    if (typeof part === "number") out[at++] = part;
    else {
      out.set(part, at);
      at += part.byteLength;
    }
  }
  return out;
}
function checkVersion(version) {
  for (const n of [version?.major, version?.minor]) {
    if (!Number.isInteger(n) || n < 0 || n > 255) throw invalid9("A protocol version is two numbers, 0 to 255.");
  }
}
function checkFrame(frame) {
  if (!(frame instanceof Uint8Array) || frame.byteLength > MAX_FRAME_BYTES) throw invalid9(`A frame is at most ${MAX_FRAME_BYTES} bytes.`);
}
function checkTag(tag) {
  if (!Number.isInteger(tag) || tag < 1 || tag > 255) throw invalid9("A tag is 1 to 255.");
}
function checkCredential(credential) {
  if (typeof credential !== "string" || credential.length > MAX_CREDENTIAL_BYTES || credential !== "" && !TOKEN682.test(credential)) {
    throw invalid9("A credential is an RFC 6750 token68 of at most 8,192 characters.");
  }
}
var isLocator = (value) => typeof value === "string" && (value.length === 2 || value.length === 3) && [...value].every((c) => CODE_LETTERS.includes(c));
var rendezvousMessage = Object.freeze({
  /** CREATE: major ‖ minor ‖ roomId (16) ‖ roomNonce (16) ‖ flags (bit 0 a code wanted) ‖ credential length (2) ‖ credential. */
  create(options) {
    const { version, roomId, roomNonce, code, credential = "" } = options;
    checkVersion(version);
    if (!(roomId instanceof Uint8Array) || roomId.byteLength !== ROOM_ID_BYTES) throw invalid9(`A room ID is ${ROOM_ID_BYTES} bytes.`);
    if (!(roomNonce instanceof Uint8Array) || roomNonce.byteLength !== CPACE_ROOM_NONCE_BYTES) throw invalid9(`A room nonce is ${CPACE_ROOM_NONCE_BYTES} bytes.`);
    checkCredential(credential);
    const length = Uint8Array.of(credential.length >> 8, credential.length & 255);
    return bytesOf2(RENDEZVOUS_TYPE.CREATE, version.major, version.minor, roomId, roomNonce, code ? 1 : 0, length, ascii3(credential));
  },
  /** JOIN: major ‖ minor ‖ by (1 room ID, 2 locator) ‖ roomId (16), or locator length (1) ‖ locator. */
  join(options) {
    const { version } = options;
    checkVersion(version);
    if ("roomId" in options) {
      if (!(options.roomId instanceof Uint8Array) || options.roomId.byteLength !== ROOM_ID_BYTES) throw invalid9(`A room ID is ${ROOM_ID_BYTES} bytes.`);
      return bytesOf2(RENDEZVOUS_TYPE.JOIN, version.major, version.minor, BY.link, options.roomId);
    }
    if (!isLocator(options.locator)) throw invalid9("A locator is 2 or 3 of a code's letters.");
    return bytesOf2(RENDEZVOUS_TYPE.JOIN, version.major, version.minor, BY.code, options.locator.length, ascii3(options.locator));
  },
  code: () => bytesOf2(RENDEZVOUS_TYPE.CODE),
  renew: () => bytesOf2(RENDEZVOUS_TYPE.RENEW),
  lock: () => bytesOf2(RENDEZVOUS_TYPE.LOCK),
  /** The sender's SEND: tag ‖ frame. */
  send(tag, frame) {
    checkTag(tag);
    checkFrame(frame);
    return bytesOf2(RENDEZVOUS_TYPE.SEND, tag, frame);
  },
  drop(tag) {
    checkTag(tag);
    return bytesOf2(RENDEZVOUS_TYPE.DROP, tag);
  },
  /** A receiver's SEND: frame. */
  receiverSend(frame) {
    checkFrame(frame);
    return bytesOf2(RENDEZVOUS_TYPE.RECEIVER_SEND, frame);
  }
});
function readServerMessage(bytes, to) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) throw invalidResponse();
  const type = bytes[0];
  const length = bytes.byteLength;
  const fixed = (n) => {
    if (length !== n) throw invalidResponse();
  };
  if (type === RENDEZVOUS_TYPE.ERROR) {
    if (length < 2) throw invalidResponse();
    const code = bytes[1];
    if (code === RENDEZVOUS_ERROR.VERSION_UNSUPPORTED) {
      fixed(4);
      return { type: "error", code, server: Object.freeze({ major: bytes[2], minor: bytes[3] }) };
    }
    fixed(2);
    return { type: "error", code };
  }
  if (to === "sender") {
    switch (type) {
      case RENDEZVOUS_TYPE.CREATED:
      case RENDEZVOUS_TYPE.CODE_IS: {
        if (length < 2) throw invalidResponse();
        fixed(2 + bytes[1]);
        const locator = String.fromCharCode(...bytes.subarray(2));
        if (locator !== "" && !isLocator(locator)) throw invalidResponse();
        return { type: type === RENDEZVOUS_TYPE.CREATED ? "created" : "code-is", locator: locator || null };
      }
      case RENDEZVOUS_TYPE.ATTEMPT: {
        fixed(3);
        if (bytes[1] === 0) throw invalidResponse();
        const by = bytes[2] === BY.link ? "link" : bytes[2] === BY.code ? "code" : void 0;
        if (!by) throw invalidResponse();
        return { type: "attempt", tag: bytes[1], by };
      }
      case RENDEZVOUS_TYPE.FRAME_TO_SENDER:
        if (length < 2 || length > 2 + MAX_FRAME_BYTES || bytes[1] === 0) throw invalidResponse();
        return { type: "frame", tag: bytes[1], frame: bytes.slice(2) };
      case RENDEZVOUS_TYPE.GONE_TO_SENDER:
        fixed(2);
        if (bytes[1] === 0) throw invalidResponse();
        return { type: "gone", tag: bytes[1] };
      case RENDEZVOUS_TYPE.CODE_GONE:
        fixed(1);
        return { type: "code-gone" };
      default:
        throw invalidResponse();
    }
  }
  switch (type) {
    case RENDEZVOUS_TYPE.JOINED:
      fixed(1 + CPACE_ROOM_NONCE_BYTES);
      return { type: "joined", roomNonce: bytes.slice(1) };
    case RENDEZVOUS_TYPE.FRAME_TO_RECEIVER:
      if (length > 1 + MAX_FRAME_BYTES) throw invalidResponse();
      return { type: "frame", frame: bytes.slice(1) };
    case RENDEZVOUS_TYPE.GONE_TO_RECEIVER:
      fixed(1);
      return { type: "gone" };
    default:
      throw invalidResponse();
  }
}
function rendezvousError(code, server, version = PROTOCOLS.dgdtp) {
  switch (code) {
    case RENDEZVOUS_ERROR.VERSION_UNSUPPORTED: {
      const check = checkProtocol(version, server);
      if (check.compatible) return invalidResponse();
      return new DropgateError({
        code: "VERSION_UNSUPPORTED",
        message: check.message,
        details: { component: "dgdtp", update: check.update, client: check.client, server: check.server }
      });
    }
    case RENDEZVOUS_ERROR.NOT_FOUND:
      return new DropgateError({ code: "NOT_FOUND", message: "No transfer has that code or link. It may have ended, or the code was used." });
    case RENDEZVOUS_ERROR.BUSY:
      return new DropgateError({ code: "REQUEST_REJECTED", message: "This transfer is already going to someone else." });
    case RENDEZVOUS_ERROR.AUTH_REQUIRED:
      return new DropgateError({ code: "AUTH_REQUIRED" });
    case RENDEZVOUS_ERROR.AUTH_EXPIRED:
      return new DropgateError({ code: "AUTH_EXPIRED" });
    case RENDEZVOUS_ERROR.AUTH_DENIED:
      return new DropgateError({ code: "AUTH_DENIED" });
    default:
      return invalidResponse();
  }
}
var _ws, _open, _ended4, _onOpenFailed;
var Socket = class {
  constructor(options, onMessage, onEnd) {
    __privateAdd(this, _ws);
    __privateAdd(this, _open, false);
    __privateAdd(this, _ended4, false);
    __publicField(this, "opened");
    __privateAdd(this, _onOpenFailed);
    const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
    if (typeof WebSocketImpl !== "function") {
      throw new DropgateError({ code: "RUNTIME_UNSUPPORTED", message: "A direct transfer needs WebSocket." });
    }
    let ws;
    try {
      ws = new WebSocketImpl(options.url);
    } catch {
      throw unreachable();
    }
    __privateSet(this, _ws, ws);
    ws.binaryType = "arraybuffer";
    this.opened = new Promise((resolve, reject) => {
      __privateSet(this, _onOpenFailed, reject);
      ws.addEventListener("open", () => {
        if (__privateGet(this, _ended4)) return;
        __privateSet(this, _open, true);
        resolve();
      });
    });
    this.opened.catch(() => void 0);
    ws.addEventListener("message", (event) => {
      if (__privateGet(this, _ended4)) return;
      const data = event?.data;
      onMessage(data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(0));
    });
    ws.addEventListener("close", () => {
      if (__privateGet(this, _ended4)) return;
      __privateSet(this, _ended4, true);
      __privateGet(this, _onOpenFailed).call(this, unreachable());
      onEnd();
    });
    ws.addEventListener("error", () => void 0);
  }
  /** Whether it opened and hasn't ended. */
  get live() {
    return __privateGet(this, _open) && !__privateGet(this, _ended4);
  }
  send(bytes) {
    if (!this.live) return;
    try {
      __privateGet(this, _ws).send(bytes);
    } catch {
      this.close();
    }
  }
  /** Closes it, once; what it was sent afterwards is ignored. */
  close() {
    if (__privateGet(this, _ended4)) return;
    __privateSet(this, _ended4, true);
    __privateGet(this, _onOpenFailed).call(this, lost3());
    try {
      __privateGet(this, _ws).close(CLOSE_NORMAL);
    } catch {
    }
  }
};
_ws = new WeakMap();
_open = new WeakMap();
_ended4 = new WeakMap();
_onOpenFailed = new WeakMap();
var _send, _onClose, _queue2, _readers2, _closed4, _ended5;
var FramePipe = class {
  constructor(send, onClose) {
    __privateAdd(this, _send);
    __privateAdd(this, _onClose);
    __privateAdd(this, _queue2, []);
    __privateAdd(this, _readers2, []);
    __privateAdd(this, _closed4, false);
    __privateAdd(this, _ended5);
    __privateSet(this, _send, send);
    __privateSet(this, _onClose, onClose);
  }
  send(message) {
    checkFrame(message);
    if (__privateGet(this, _closed4) || __privateGet(this, _ended5)) return;
    __privateGet(this, _send).call(this, message);
  }
  receive() {
    if (__privateGet(this, _queue2).length > 0) return Promise.resolve(__privateGet(this, _queue2).shift());
    if (__privateGet(this, _closed4)) return Promise.reject(lost3());
    if (__privateGet(this, _ended5)) return Promise.reject(__privateGet(this, _ended5));
    return new Promise((resolve, reject) => __privateGet(this, _readers2).push({ resolve, reject }));
  }
  /** Nothing to watch: the socket's buffer is the server's to bound. */
  writable() {
    if (__privateGet(this, _closed4)) return Promise.reject(lost3());
    if (__privateGet(this, _ended5)) return Promise.reject(__privateGet(this, _ended5));
    return Promise.resolve();
  }
  /** Ended by this side: nothing more is taken. */
  close() {
    if (__privateGet(this, _closed4)) return;
    __privateSet(this, _closed4, true);
    __privateGet(this, _queue2).length = 0;
    for (const reader of __privateGet(this, _readers2).splice(0)) reader.reject(lost3());
    __privateGet(this, _onClose).call(this);
  }
  /** @internal The other side's next frame. */
  deliver(frame) {
    if (__privateGet(this, _closed4) || __privateGet(this, _ended5)) return;
    const reader = __privateGet(this, _readers2).shift();
    if (reader) reader.resolve(frame);
    else __privateGet(this, _queue2).push(frame);
  }
  /** @internal Ended underneath: what came first is still taken, then receive() rejects with `err`. */
  end(err) {
    if (__privateGet(this, _closed4) || __privateGet(this, _ended5)) return;
    __privateSet(this, _ended5, err);
    for (const reader of __privateGet(this, _readers2).splice(0)) reader.reject(err);
  }
  get ended() {
    return __privateGet(this, _closed4) || __privateGet(this, _ended5) !== void 0;
  }
};
_send = new WeakMap();
_onClose = new WeakMap();
_queue2 = new WeakMap();
_readers2 = new WeakMap();
_closed4 = new WeakMap();
_ended5 = new WeakMap();
function checkCodeLetters(codeLetters) {
  if (codeLetters !== 0 && codeLetters !== 2 && codeLetters !== 3) throw invalid9("A server's code letters are 0, 2 or 3.");
}
var _options, _version, _codeLetters, _timers7, _socket, _news, _created, _attempts, _wantCode, _locked, _ended6, _renewTimer, _askTimer, _SenderRendezvousClient_instances, message_fn, takeLocator_fn, noCode_fn, askForCode_fn, stopTimers_fn, attempt_fn2, frame_fn, gone_fn, dropped_fn, settleCode_fn, end_fn4;
var SenderRendezvousClient = class {
  constructor(options) {
    __privateAdd(this, _SenderRendezvousClient_instances);
    __privateAdd(this, _options);
    __privateAdd(this, _version);
    __privateAdd(this, _codeLetters);
    __privateAdd(this, _timers7);
    __privateAdd(this, _socket);
    __privateAdd(this, _news);
    __privateAdd(this, _created);
    __privateAdd(this, _attempts, /* @__PURE__ */ new Map());
    __privateAdd(this, _wantCode, false);
    __privateAdd(this, _locked, false);
    __privateAdd(this, _ended6);
    __privateAdd(this, _renewTimer);
    __privateAdd(this, _askTimer);
    /** Whether the server gives codes: its code letters aren't 0. */
    __publicField(this, "givesCodes");
    if (!options || typeof options.url !== "string") throw invalid9("The rendezvous needs its address.");
    checkCodeLetters(options.codeLetters);
    __privateSet(this, _options, options);
    __privateSet(this, _version, options.version ?? PROTOCOLS.dgdtp);
    checkVersion(__privateGet(this, _version));
    __privateSet(this, _codeLetters, options.codeLetters);
    this.givesCodes = options.codeLetters !== 0;
    __privateSet(this, _timers7, options.timers ?? GLOBAL_TIMERS2);
    if (options.credential !== void 0) checkCredential(options.credential);
  }
  /**
   * Opens the room: a code asked for only when one is wanted and the server
   * gives them. Resolves with the code's locator, if one was free.
   */
  async create(room, news) {
    if (__privateGet(this, _socket)) throw invalid9("A rendezvous opens one room.");
    const wantCode = room?.code === true && __privateGet(this, _codeLetters) !== 0;
    const create = rendezvousMessage.create({ version: __privateGet(this, _version), roomId: room.roomId, roomNonce: room.roomNonce, code: wantCode, credential: __privateGet(this, _options).credential });
    __privateSet(this, _news, news);
    __privateSet(this, _wantCode, wantCode);
    const socket = new Socket(__privateGet(this, _options), (bytes) => __privateMethod(this, _SenderRendezvousClient_instances, message_fn).call(this, bytes), () => __privateMethod(this, _SenderRendezvousClient_instances, end_fn4).call(this, lost3()));
    __privateSet(this, _socket, socket);
    const created = new Promise((resolve, reject) => {
      __privateSet(this, _created, { resolve, reject });
    });
    created.catch(() => void 0);
    try {
      await socket.opened;
    } catch (err) {
      __privateMethod(this, _SenderRendezvousClient_instances, end_fn4).call(this, err);
      throw err;
    }
    socket.send(create);
    const locator = await created;
    return locator === void 0 ? {} : { locator };
  }
  /**
   * A receiver was accepted: the room is locked (no new attempt by link or
   * code, its unused code released), every attempt but `keep` dropped, and
   * no more codes asked for.
   */
  lock(keep) {
    if (__privateGet(this, _locked) || __privateGet(this, _ended6)) return;
    __privateSet(this, _locked, true);
    __privateMethod(this, _SenderRendezvousClient_instances, stopTimers_fn).call(this);
    __privateGet(this, _socket)?.send(rendezvousMessage.lock());
    for (const attempt of [...__privateGet(this, _attempts).values()]) {
      if (attempt.incoming !== keep) attempt.pipe.close();
    }
  }
  /** Closes the room's socket: every attempt's pipe ends. */
  close() {
    __privateMethod(this, _SenderRendezvousClient_instances, end_fn4).call(this, new DropgateError({ code: "OPERATION_CANCELLED" }));
  }
  toJSON() {
    return "[SenderRendezvous]";
  }
  toString() {
    return "[SenderRendezvous]";
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return "[SenderRendezvous]";
  }
};
_options = new WeakMap();
_version = new WeakMap();
_codeLetters = new WeakMap();
_timers7 = new WeakMap();
_socket = new WeakMap();
_news = new WeakMap();
_created = new WeakMap();
_attempts = new WeakMap();
_wantCode = new WeakMap();
_locked = new WeakMap();
_ended6 = new WeakMap();
_renewTimer = new WeakMap();
_askTimer = new WeakMap();
_SenderRendezvousClient_instances = new WeakSet();
message_fn = function(bytes) {
  let message;
  try {
    message = readServerMessage(bytes, "sender");
  } catch (err) {
    __privateMethod(this, _SenderRendezvousClient_instances, end_fn4).call(this, err);
    return;
  }
  if (message.type === "error") {
    __privateMethod(this, _SenderRendezvousClient_instances, end_fn4).call(this, rendezvousError(message.code, message.server, __privateGet(this, _version)));
    return;
  }
  if (__privateGet(this, _created)) {
    if (message.type !== "created" || message.locator !== null && !__privateMethod(this, _SenderRendezvousClient_instances, takeLocator_fn).call(this, message.locator)) {
      __privateMethod(this, _SenderRendezvousClient_instances, end_fn4).call(this, invalidResponse());
      return;
    }
    const { resolve } = __privateGet(this, _created);
    __privateSet(this, _created, void 0);
    if (message.locator === null) __privateMethod(this, _SenderRendezvousClient_instances, noCode_fn).call(this);
    resolve(message.locator ?? void 0);
    return;
  }
  switch (message.type) {
    case "code-is":
      if (__privateGet(this, _locked)) return;
      if (message.locator === null) {
        __privateMethod(this, _SenderRendezvousClient_instances, noCode_fn).call(this);
        __privateGet(this, _news)?.code(void 0);
      } else if (__privateMethod(this, _SenderRendezvousClient_instances, takeLocator_fn).call(this, message.locator)) {
        __privateGet(this, _news)?.code(message.locator);
      } else {
        __privateMethod(this, _SenderRendezvousClient_instances, end_fn4).call(this, invalidResponse());
      }
      return;
    case "code-gone":
      __privateMethod(this, _SenderRendezvousClient_instances, stopTimers_fn).call(this);
      __privateGet(this, _news)?.code(void 0);
      __privateMethod(this, _SenderRendezvousClient_instances, askForCode_fn).call(this);
      return;
    case "attempt":
      __privateMethod(this, _SenderRendezvousClient_instances, attempt_fn2).call(this, message.tag, message.by);
      return;
    case "frame":
      if ("tag" in message) __privateMethod(this, _SenderRendezvousClient_instances, frame_fn).call(this, message.tag, message.frame);
      return;
    case "gone":
      if ("tag" in message) __privateMethod(this, _SenderRendezvousClient_instances, gone_fn).call(this, message.tag);
      return;
    default:
      __privateMethod(this, _SenderRendezvousClient_instances, end_fn4).call(this, invalidResponse());
  }
};
/** A locator the server gave: the server's length, when a code is wanted; renewed from now on. */
takeLocator_fn = function(locator) {
  if (!__privateGet(this, _wantCode) || locator.length !== __privateGet(this, _codeLetters)) return false;
  __privateMethod(this, _SenderRendezvousClient_instances, stopTimers_fn).call(this);
  const renew = () => {
    __privateSet(this, _renewTimer, __privateGet(this, _timers7).setTimeout(() => {
      __privateGet(this, _socket)?.send(rendezvousMessage.renew());
      renew();
    }, RENEW_INTERVAL_MS));
  };
  renew();
  return true;
};
/** No code free: asked for again every 15 seconds, while one is wanted. (Nothing comes here once locked.) */
noCode_fn = function() {
  __privateMethod(this, _SenderRendezvousClient_instances, stopTimers_fn).call(this);
  if (!__privateGet(this, _wantCode)) return;
  __privateSet(this, _askTimer, __privateGet(this, _timers7).setTimeout(() => __privateMethod(this, _SenderRendezvousClient_instances, askForCode_fn).call(this), CODE_RETRY_MS));
};
/** Asks for a code now, unless a receiver has been accepted. Only a room that wants codes is given one, or attempts by one. */
askForCode_fn = function() {
  __privateMethod(this, _SenderRendezvousClient_instances, stopTimers_fn).call(this);
  if (__privateGet(this, _locked) || __privateGet(this, _ended6)) return;
  __privateGet(this, _socket)?.send(rendezvousMessage.code());
};
stopTimers_fn = function() {
  if (__privateGet(this, _renewTimer) !== void 0) __privateGet(this, _timers7).clearTimeout(__privateGet(this, _renewTimer));
  if (__privateGet(this, _askTimer) !== void 0) __privateGet(this, _timers7).clearTimeout(__privateGet(this, _askTimer));
  __privateSet(this, _renewTimer, void 0);
  __privateSet(this, _askTimer, void 0);
};
attempt_fn2 = function(tag, by) {
  if (__privateGet(this, _attempts).has(tag) || by === "code" && !__privateGet(this, _wantCode)) {
    __privateMethod(this, _SenderRendezvousClient_instances, end_fn4).call(this, invalidResponse());
    return;
  }
  if (__privateGet(this, _locked)) {
    __privateGet(this, _socket)?.send(rendezvousMessage.drop(tag));
    return;
  }
  const pipe = new FramePipe(
    (frame) => __privateGet(this, _socket)?.send(rendezvousMessage.send(tag, frame)),
    () => __privateMethod(this, _SenderRendezvousClient_instances, dropped_fn).call(this, tag)
  );
  const incoming = { by, pipe };
  const attempt = { tag, by, pipe, incoming, codeSettled: false };
  __privateGet(this, _attempts).set(tag, attempt);
  __privateGet(this, _news)?.attempt(incoming);
};
frame_fn = function(tag, frame) {
  const attempt = __privateGet(this, _attempts).get(tag);
  if (!attempt) return;
  attempt.pipe.deliver(frame);
  __privateMethod(this, _SenderRendezvousClient_instances, settleCode_fn).call(this, attempt);
};
gone_fn = function(tag) {
  const attempt = __privateGet(this, _attempts).get(tag);
  if (!attempt) return;
  __privateGet(this, _attempts).delete(tag);
  attempt.pipe.end(lost3());
  __privateMethod(this, _SenderRendezvousClient_instances, settleCode_fn).call(this, attempt);
};
/** This side ended an attempt: the server is told, unless it's gone already. */
dropped_fn = function(tag) {
  const attempt = __privateGet(this, _attempts).get(tag);
  if (!attempt) return;
  __privateGet(this, _attempts).delete(tag);
  __privateGet(this, _socket)?.send(rendezvousMessage.drop(tag));
  __privateMethod(this, _SenderRendezvousClient_instances, settleCode_fn).call(this, attempt);
};
/** After an attempt by code, its code is never shown again: a new one is asked for, once. */
settleCode_fn = function(attempt) {
  if (attempt.by !== "code" || attempt.codeSettled) return;
  attempt.codeSettled = true;
  __privateMethod(this, _SenderRendezvousClient_instances, askForCode_fn).call(this);
};
/** The room ends: its socket closed, every attempt's pipe ended with `err`, the room told. */
end_fn4 = function(err) {
  if (__privateGet(this, _ended6)) return;
  __privateSet(this, _ended6, err);
  __privateMethod(this, _SenderRendezvousClient_instances, stopTimers_fn).call(this);
  __privateGet(this, _socket)?.close();
  for (const attempt of __privateGet(this, _attempts).values()) attempt.pipe.end(err.code === "OPERATION_CANCELLED" ? lost3() : err);
  __privateGet(this, _attempts).clear();
  if (__privateGet(this, _created)) {
    __privateGet(this, _created).reject(err);
    __privateSet(this, _created, void 0);
  } else {
    __privateGet(this, _news)?.ended?.(err);
  }
};
function senderRendezvous(options) {
  return new SenderRendezvousClient(options);
}
function receiverRendezvous(options) {
  if (!options || typeof options.url !== "string") throw invalid9("The rendezvous needs its address.");
  checkCodeLetters(options.codeLetters);
  const version = options.version ?? PROTOCOLS.dgdtp;
  checkVersion(version);
  const { codeLetters } = options;
  return Object.freeze({
    async join(by) {
      if (by && "locator" in by) {
        if (codeLetters === 0) {
          throw new DropgateError({ code: "CAPABILITY_UNSUPPORTED", message: "This server doesn't use codes. Ask the sender for the link." });
        }
        if (typeof by.locator !== "string" || by.locator.length !== codeLetters) throw invalid9(`This server's codes have ${codeLetters} locator letters.`);
      }
      const join = rendezvousMessage.join({ version, ...by });
      let joined;
      const answer = new Promise((resolve, reject) => {
        joined = { resolve, reject };
      });
      answer.catch(() => void 0);
      let socket;
      const pipe = new FramePipe((frame) => socket.send(rendezvousMessage.receiverSend(frame)), () => socket.close());
      const end = (err) => {
        socket.close();
        if (joined) {
          joined.reject(err);
          joined = void 0;
        } else {
          pipe.end(err);
        }
      };
      socket = new Socket(options, (bytes) => {
        let message;
        try {
          message = readServerMessage(bytes, "receiver");
        } catch (err) {
          end(err);
          return;
        }
        if (message.type === "error") {
          end(rendezvousError(message.code, message.server, version));
        } else if (joined) {
          if (message.type !== "joined") {
            end(invalidResponse());
            return;
          }
          joined.resolve(message.roomNonce);
          joined = void 0;
        } else if (message.type === "frame") {
          pipe.deliver(message.frame);
        } else if (message.type === "gone") {
          end(lost3());
        } else {
          end(invalidResponse());
        }
      }, () => end(lost3()));
      await socket.opened;
      socket.send(join);
      const roomNonce = await answer;
      return { roomNonce, pipe };
    },
    toJSON: () => "[ReceiverRendezvous]",
    toString: () => "[ReceiverRendezvous]"
  });
}

// src/dgdtp/send.ts
var cantPause2 = () => new DropgateError({ code: "PAUSE_UNAVAILABLE", message: "A direct transfer can be paused once it has been accepted, until all its data has been sent." });
var connectionLost2 = () => new DropgateError({ code: "CONNECTION_LOST", message: "The connection was lost, so the transfer couldn't continue." });
var _host, _link2, _generation3, _maxData2, _holds2, _stall2, _peerPauseLimit2, _phase2, _resumeSecret2, _assurance2, _queue3, _producerWake, _finalChain, _submitted, _limit2, _revision2, _consumed2, _filesDone2, _fileEndsSent, _offerTimer2, _lostTimer2, _linger, _peerStatus2, _peerClosed2, _settled, _SenderSession_instances, live_fn2, take_fn4, accept_fn, credit_fn, resultMatches_fn, result_fn, hold_fn2, holdChanged_fn2, status_fn2, statusHeard_fn2, closeHeard_fn2, produce_fn, next_fn3, wakeProducer_fn, cancelWhileFinalising_fn, lost_fn3, fail_fn2, clearOfferTimer_fn2, quiet_fn2, end_fn5, ending_fn2;
var SenderSession = class {
  constructor(host, channel, attempt) {
    __privateAdd(this, _SenderSession_instances);
    __publicField(this, "attempt");
    __privateAdd(this, _host);
    __privateAdd(this, _link2);
    __privateAdd(this, _generation3);
    __privateAdd(this, _maxData2);
    __privateAdd(this, _holds2);
    __privateAdd(this, _stall2);
    __privateAdd(this, _peerPauseLimit2);
    __privateAdd(this, _phase2, "offered");
    __privateAdd(this, _resumeSecret2);
    __privateAdd(this, _assurance2, "saved");
    // The stream.
    __privateAdd(this, _queue3, []);
    __privateAdd(this, _producerWake);
    __privateAdd(this, _finalChain);
    __privateAdd(this, _submitted, 0);
    __privateAdd(this, _limit2, 0);
    __privateAdd(this, _revision2, 0);
    __privateAdd(this, _consumed2, 0);
    __privateAdd(this, _filesDone2, 0);
    __privateAdd(this, _fileEndsSent, 0);
    // Timers, and the end.
    __privateAdd(this, _offerTimer2);
    __privateAdd(this, _lostTimer2);
    /** Completed: the channel waits this long for the receiver to close it. */
    __privateAdd(this, _linger);
    __privateAdd(this, _peerStatus2);
    /** The receiver's CLOSE has been heard: another is ignored. */
    __privateAdd(this, _peerClosed2, false);
    __privateAdd(this, _settled, deferred2());
    if (channel?.role !== "sender") throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A send runs over the sender's channel." });
    __privateSet(this, _host, host);
    this.attempt = attempt;
    __privateSet(this, _generation3, channel.generation);
    const g = __privateGet(this, _generation3);
    const timers = host.timers;
    __privateSet(this, _peerPauseLimit2, channel.peerHello.pauseLimitSeconds);
    __privateSet(this, _holds2, new Holds(timers, channel.hello?.pauseLimitSeconds ?? 0, __privateGet(this, _peerPauseLimit2), () => {
      __privateMethod(this, _SenderSession_instances, fail_fn2).call(this, pauseLimitReached("sender", "self", channel.hello.pauseLimitSeconds), g);
    }));
    __privateSet(this, _stall2, new StallWatch(timers, () => host.moved(this), () => {
      __privateMethod(this, _SenderSession_instances, fail_fn2).call(this, new DropgateError({ code: "SOURCE_UNAVAILABLE", message: "Reading a file stopped for 2 minutes, so the transfer ended." }), g);
    }));
    __privateSet(this, _link2, new Link(channel, {
      record: (inbound) => this.deliver(inbound),
      ended: (err) => __privateMethod(this, _SenderSession_instances, lost_fn3).call(this, err),
      close: (message, generation) => __privateMethod(this, _SenderSession_instances, closeHeard_fn2).call(this, message, generation),
      status: () => __privateMethod(this, _SenderSession_instances, status_fn2).call(this),
      statusHeard: (answer, generation) => __privateMethod(this, _SenderSession_instances, statusHeard_fn2).call(this, answer, generation)
    }, timers));
    __privateSet(this, _maxData2, dataBytes(__privateGet(this, _link2).recordBytes));
  }
  get phase() {
    return __privateGet(this, _phase2);
  }
  /** Resolves once the session has ended and told its receiver (its CLOSE sent both ways, 2 s at most). */
  get settled() {
    return __privateGet(this, _settled).promise;
  }
  /** Whether `pause()` can be called now: from ACCEPT until FINISH has gone. */
  get canPause() {
    return __privateGet(this, _phase2) === "transferring";
  }
  /** Who holds the transfer: this side, the receiver, both, or no one. */
  get pausedBy() {
    return __privateGet(this, _holds2).pausedBy;
  }
  /** While held: when the transfer ends unless both sides resume first (ms since the epoch); else null. */
  get deadline() {
    return __privateGet(this, _holds2).deadline;
  }
  /** Whether reading a file has taken 30 s or more for the block it's on. */
  get stalled() {
    return __privateGet(this, _stall2).stalled;
  }
  /** The receiver's last answer to a STATUS ask, if one has come. */
  get peerStatus() {
    return __privateGet(this, _peerStatus2);
  }
  /** The bytes the receiver has written, as its last CREDIT said. */
  get consumed() {
    return __privateGet(this, _consumed2);
  }
  /** The files the receiver has finished, as its last CREDIT said. */
  get filesDone() {
    return __privateGet(this, _filesDone2);
  }
  /** Sends the list of files, in records the size both hellos allow, and starts reading the receiver's. The offer has 10 minutes. */
  start() {
    for (const record of manifestRecords(__privateGet(this, _host).manifest, __privateGet(this, _link2).recordBytes)) __privateGet(this, _link2).sendRecord(record);
    const g = __privateGet(this, _generation3);
    __privateSet(this, _offerTimer2, __privateGet(this, _host).timers.setTimeout(() => __privateMethod(this, _SenderSession_instances, fail_fn2).call(this, offerTimedOut(), g), OFFER_TIMEOUT_MS));
    __privateGet(this, _link2).start();
  }
  /**
   * One record from the receiver, with its connection's generation. One from
   * another generation, or after the end, is dropped and touches nothing.
   * @internal
   */
  async deliver(inbound) {
    const g = inbound.generation;
    if (!__privateMethod(this, _SenderSession_instances, live_fn2).call(this, g)) return;
    try {
      await __privateMethod(this, _SenderSession_instances, take_fn4).call(this, readRecord(inbound.record), g);
    } catch (err) {
      __privateMethod(this, _SenderSession_instances, fail_fn2).call(this, err, g);
    }
  }
  /** Another receiver was chosen: this one is told TAKEN, and its session ends. */
  taken() {
    if (__privateGet(this, _phase2) === "ended") return;
    void __privateMethod(this, _SenderSession_instances, end_fn5).call(this, { state: "failed", error: new DropgateError({ code: "REQUEST_REJECTED", message: "Another receiver accepted first." }) }, { reason: "TAKEN" });
  }
  /** Holds the transfer (HOLD): no more of it is sent until neither side holds it. PAUSE_UNAVAILABLE unless `canPause`. */
  pause() {
    if (!this.canPause) throw cantPause2();
    if (!__privateGet(this, _holds2).set("self", true)) return;
    __privateGet(this, _link2).send({ type: "hold", held: true, reason: "person" });
    __privateMethod(this, _SenderSession_instances, holdChanged_fn2).call(this);
  }
  /** Lets this side's hold go (HOLD): the transfer runs again once the receiver holds it no more. Nothing if this side doesn't hold it. */
  resume() {
    if (__privateGet(this, _phase2) !== "transferring" || !__privateGet(this, _holds2).set("self", false)) return;
    __privateGet(this, _link2).send({ type: "hold", held: false, reason: "person" });
    __privateMethod(this, _SenderSession_instances, holdChanged_fn2).call(this);
  }
  /**
   * Cancels this receiver's transfer: told with CLOSE{USER_CANCELLED} after
   * whatever is already encrypted. Once FINISH has gone, the receiver may
   * already have saved the files: its answer is waited for (2 s at most), and
   * a RESULT, or a CLOSE_ACK that carries one, completes the send instead.
   */
  cancel() {
    if (__privateGet(this, _phase2) === "finalising") {
      void __privateMethod(this, _SenderSession_instances, cancelWhileFinalising_fn).call(this);
      return;
    }
    void __privateMethod(this, _SenderSession_instances, end_fn5).call(this, { state: "cancelled", by: "self" }, { reason: "USER_CANCELLED" });
  }
  /** Ends the session with `outcome`, the receiver told with `close`: the send has ended. Resolves once it's told. */
  endWith(outcome, close) {
    return __privateMethod(this, _SenderSession_instances, end_fn5).call(this, outcome, close);
  }
};
_host = new WeakMap();
_link2 = new WeakMap();
_generation3 = new WeakMap();
_maxData2 = new WeakMap();
_holds2 = new WeakMap();
_stall2 = new WeakMap();
_peerPauseLimit2 = new WeakMap();
_phase2 = new WeakMap();
_resumeSecret2 = new WeakMap();
_assurance2 = new WeakMap();
_queue3 = new WeakMap();
_producerWake = new WeakMap();
_finalChain = new WeakMap();
_submitted = new WeakMap();
_limit2 = new WeakMap();
_revision2 = new WeakMap();
_consumed2 = new WeakMap();
_filesDone2 = new WeakMap();
_fileEndsSent = new WeakMap();
_offerTimer2 = new WeakMap();
_lostTimer2 = new WeakMap();
_linger = new WeakMap();
_peerStatus2 = new WeakMap();
_peerClosed2 = new WeakMap();
_settled = new WeakMap();
_SenderSession_instances = new WeakSet();
live_fn2 = function(g) {
  return __privateGet(this, _phase2) !== "ended" && g === __privateGet(this, _generation3);
};
take_fn4 = async function(message, g) {
  switch (message.type) {
    case "accept":
      return __privateMethod(this, _SenderSession_instances, accept_fn).call(this, message, g);
    case "credit":
      return __privateMethod(this, _SenderSession_instances, credit_fn).call(this, message);
    case "result":
      return __privateMethod(this, _SenderSession_instances, result_fn).call(this, message);
    case "hold":
      return __privateMethod(this, _SenderSession_instances, hold_fn2).call(this, message);
    default:
      throw invalidMessage2();
  }
};
accept_fn = async function(m, g) {
  if (__privateGet(this, _phase2) !== "offered") throw invalidMessage2();
  if (!sameBytes(m.manifestHash, __privateGet(this, _host).manifestHash) || m.creditLimit > CREDIT_WINDOW_BYTES) throw invalidMessage2();
  __privateMethod(this, _SenderSession_instances, clearOfferTimer_fn2).call(this);
  if (!__privateGet(this, _host).accepted(this)) {
    this.taken();
    return;
  }
  __privateSet(this, _resumeSecret2, new Uint8Array(m.resumeSecret));
  __privateSet(this, _assurance2, m.sink);
  __privateSet(this, _limit2, m.creditLimit);
  __privateSet(this, _phase2, "transferring");
  __privateGet(this, _host).moved(this);
  __privateGet(this, _link2).stream({ next: () => __privateMethod(this, _SenderSession_instances, next_fn3).call(this) });
  void __privateMethod(this, _SenderSession_instances, produce_fn).call(this, g);
};
credit_fn = function(m) {
  if (__privateGet(this, _phase2) !== "transferring" && __privateGet(this, _phase2) !== "finalising" && __privateGet(this, _phase2) !== "closing") throw invalidMessage2();
  if (m.revision <= __privateGet(this, _revision2) || m.limit < __privateGet(this, _limit2) || m.consumed < __privateGet(this, _consumed2) || m.filesDone < __privateGet(this, _filesDone2) || m.consumed > __privateGet(this, _submitted) || m.limit - m.consumed > CREDIT_WINDOW_BYTES || m.filesDone > __privateGet(this, _fileEndsSent)) {
    throw invalidMessage2();
  }
  __privateSet(this, _revision2, m.revision);
  __privateSet(this, _limit2, m.limit);
  __privateSet(this, _consumed2, m.consumed);
  __privateSet(this, _filesDone2, m.filesDone);
  __privateGet(this, _link2).wake();
  __privateGet(this, _host).moved(this);
};
/** Whether a receiver's result is what was sent and accepted: the same totals and chain, the files where ACCEPT said they'd go. */
resultMatches_fn = function(m) {
  return m.fileCount === __privateGet(this, _host).files.length && m.totalSize === __privateGet(this, _host).totalSize && sameBytes(m.chain, __privateGet(this, _finalChain)) && m.assurance === __privateGet(this, _assurance2);
};
result_fn = async function(m) {
  if (__privateGet(this, _phase2) !== "finalising" && __privateGet(this, _phase2) !== "closing") throw invalidMessage2();
  if (!__privateMethod(this, _SenderSession_instances, resultMatches_fn).call(this, m)) throw invalidMessage2();
  __privateGet(this, _link2).send({ type: "result-ack", commitId: m.commitId });
  void __privateMethod(this, _SenderSession_instances, end_fn5).call(this, { state: "completed", assurance: m.assurance });
};
/** The receiver's HOLD: heard from ACCEPT until FINISH has gone, passed over otherwise (nothing is left to hold). */
hold_fn2 = function(m) {
  if (__privateGet(this, _phase2) !== "transferring") return;
  if (__privateGet(this, _holds2).set("peer", m.held)) __privateMethod(this, _SenderSession_instances, holdChanged_fn2).call(this);
};
/** A hold began or ended: reads stop counting as stalled while held; when it runs again, the stream goes on. */
holdChanged_fn2 = function() {
  __privateGet(this, _stall2).hold(__privateGet(this, _holds2).held);
  if (!__privateGet(this, _holds2).held) __privateGet(this, _link2).wake();
  __privateGet(this, _host).moved(this);
};
status_fn2 = function() {
  const state = __privateGet(this, _phase2) === "offered" ? STATUS_STATE.OFFERED : __privateGet(this, _phase2) === "transferring" ? STATUS_STATE.TRANSFERRING : __privateGet(this, _phase2) === "finalising" || __privateGet(this, _phase2) === "closing" ? STATUS_STATE.FINALISING : 0;
  return { state, held: __privateGet(this, _holds2).self, consumed: __privateGet(this, _consumed2) };
};
statusHeard_fn2 = function(answer, g) {
  if (!__privateMethod(this, _SenderSession_instances, live_fn2).call(this, g)) return;
  __privateSet(this, _peerStatus2, Object.freeze({ state: answer.state, held: answer.held, consumed: answer.consumed }));
  __privateGet(this, _host).moved(this);
};
/**
 * The receiver's CLOSE, by either path, as it arrives: answered with
 * CLOSE_ACK, and the session ends as it says. A second is ignored. One that
 * crosses this side's own cancel leaves it cancelled.
 */
closeHeard_fn2 = function(m, g) {
  if (g !== __privateGet(this, _generation3) || __privateGet(this, _peerClosed2)) return;
  __privateSet(this, _peerClosed2, true);
  __privateGet(this, _link2).send({ type: "close-ack", operationId: m.operationId, finished: false });
  if (__privateGet(this, _phase2) === "closing") {
    void __privateMethod(this, _SenderSession_instances, end_fn5).call(this, { state: "cancelled", by: "self" });
    return;
  }
  void __privateMethod(this, _SenderSession_instances, end_fn5).call(this, outcomeOfClose(m, "sender", __privateGet(this, _peerPauseLimit2)));
};
produce_fn = async function(g) {
  const { provider, files, sizes: sizes2 } = __privateGet(this, _host);
  try {
    let chain = await chainStart(provider, __privateGet(this, _host).manifestHash);
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const size = sizes2[fileIndex];
      const blocks = blockCount(size);
      for (let blockIndex = 0; blockIndex < blocks; blockIndex++) {
        while (__privateGet(this, _queue3).filter((p) => p.kind === "block").length >= SOURCE_BLOCKS_AHEAD) {
          await new Promise((resolve) => {
            __privateSet(this, _producerWake, resolve);
          });
          if (!__privateMethod(this, _SenderSession_instances, live_fn2).call(this, g)) return;
        }
        const start = blockIndex * BLOCK_BYTES;
        const bytes = await __privateGet(this, _stall2).during(readRange(files[fileIndex], start, Math.min(size, start + BLOCK_BYTES)));
        if (!__privateMethod(this, _SenderSession_instances, live_fn2).call(this, g)) return;
        const hash = await provider.sha256(bytes);
        chain = await chainBlock(provider, chain, { fileIndex, blockIndex, length: bytes.byteLength, hash });
        if (!__privateMethod(this, _SenderSession_instances, live_fn2).call(this, g)) return;
        __privateGet(this, _queue3).push({ kind: "block", fileIndex, blockIndex, bytes, hash, sent: 0 });
        __privateGet(this, _link2).wake();
      }
      chain = await chainFileEnd(provider, chain, { fileIndex, size, blockCount: blocks });
      if (!__privateMethod(this, _SenderSession_instances, live_fn2).call(this, g)) return;
      __privateGet(this, _queue3).push({ kind: "file-end", fileIndex, size, blockCount: blocks, chain });
      __privateGet(this, _link2).wake();
    }
    __privateGet(this, _queue3).push({ kind: "finish", chain });
    __privateGet(this, _link2).wake();
  } catch (err) {
    __privateMethod(this, _SenderSession_instances, fail_fn2).call(this, err, g);
  }
};
/** The stream's next record, if one is ready and may go now: nothing while either side holds the transfer. */
next_fn3 = function() {
  if (__privateGet(this, _phase2) !== "transferring" || __privateGet(this, _holds2).held) return void 0;
  const step = __privateGet(this, _queue3)[0];
  if (!step) return void 0;
  switch (step.kind) {
    case "block": {
      if (step.sent < step.bytes.byteLength) {
        const n = Math.min(__privateGet(this, _maxData2), step.bytes.byteLength - step.sent);
        if (__privateGet(this, _submitted) + n > __privateGet(this, _limit2)) return void 0;
        const at = step.sent;
        step.sent += n;
        __privateSet(this, _submitted, __privateGet(this, _submitted) + n);
        return { type: "data", fileIndex: step.fileIndex, offset: step.blockIndex * BLOCK_BYTES + at, bytes: step.bytes.subarray(at, at + n) };
      }
      __privateGet(this, _queue3).shift();
      __privateMethod(this, _SenderSession_instances, wakeProducer_fn).call(this);
      return { type: "block-end", fileIndex: step.fileIndex, blockIndex: step.blockIndex, length: step.bytes.byteLength, hash: step.hash };
    }
    case "file-end":
      if (__privateGet(this, _fileEndsSent) - __privateGet(this, _filesDone2) >= MAX_UNFINISHED_FILE_ENDS) return void 0;
      __privateGet(this, _queue3).shift();
      __privateSet(this, _fileEndsSent, __privateGet(this, _fileEndsSent) + 1);
      return { type: "file-end", fileIndex: step.fileIndex, size: step.size, blockCount: step.blockCount, chain: step.chain };
    default:
      __privateGet(this, _queue3).shift();
      __privateSet(this, _finalChain, step.chain);
      __privateSet(this, _phase2, "finalising");
      __privateGet(this, _stall2).stop();
      __privateGet(this, _host).moved(this);
      return {
        type: "finish",
        fileCount: __privateGet(this, _host).files.length,
        totalSize: __privateGet(this, _host).totalSize,
        manifestHash: __privateGet(this, _host).manifestHash,
        chain: step.chain
      };
  }
};
wakeProducer_fn = function() {
  const wake = __privateGet(this, _producerWake);
  __privateSet(this, _producerWake, void 0);
  wake?.();
};
cancelWhileFinalising_fn = async function() {
  __privateSet(this, _phase2, "closing");
  const ack = await __privateGet(this, _link2).closeWith({ type: "close", operationId: __privateGet(this, _host).provider.randomBytes(16), reason: "USER_CANCELLED" });
  if (__privateGet(this, _phase2) === "ended") return;
  if (ack?.finished && __privateMethod(this, _SenderSession_instances, resultMatches_fn).call(this, ack.result)) {
    __privateGet(this, _link2).send({ type: "result-ack", commitId: ack.result.commitId });
    void __privateMethod(this, _SenderSession_instances, end_fn5).call(this, { state: "completed", assurance: ack.result.assurance });
    return;
  }
  void __privateMethod(this, _SenderSession_instances, end_fn5).call(this, { state: "cancelled", by: "self" });
};
/**
 * The channel ended under the session: lost as the channel says, unless the
 * session has already ended (then the link is closed). A lost connection
 * listens 2 s for the receiver's CLOSE through the rendezvous first.
 */
lost_fn3 = function(err) {
  if (__privateGet(this, _phase2) === "ended") {
    if (__privateGet(this, _linger) !== void 0) __privateGet(this, _host).timers.clearTimeout(__privateGet(this, _linger));
    __privateSet(this, _linger, void 0);
    __privateGet(this, _link2).close();
    return;
  }
  if (__privateGet(this, _phase2) === "closing") {
    void __privateMethod(this, _SenderSession_instances, end_fn5).call(this, { state: "cancelled", by: "self" });
    return;
  }
  if (err.code !== "CONNECTION_LOST") {
    void __privateMethod(this, _SenderSession_instances, end_fn5).call(this, { state: "failed", error: err });
    return;
  }
  __privateMethod(this, _SenderSession_instances, quiet_fn2).call(this);
  const g = __privateGet(this, _generation3);
  __privateSet(this, _lostTimer2, __privateGet(this, _host).timers.setTimeout(() => {
    if (__privateMethod(this, _SenderSession_instances, live_fn2).call(this, g)) void __privateMethod(this, _SenderSession_instances, end_fn5).call(this, { state: "failed", error: connectionLost2() });
  }, LATE_CLOSE_WAIT_MS));
};
/** This side failed, in generation `g`: the receiver told with a CLOSE. A failure from another generation is dropped. */
fail_fn2 = function(err, g) {
  if (!__privateMethod(this, _SenderSession_instances, live_fn2).call(this, g)) return;
  const error = toDropgateError(err);
  void __privateMethod(this, _SenderSession_instances, end_fn5).call(this, { state: "failed", error }, closeFor(error));
};
clearOfferTimer_fn2 = function() {
  if (__privateGet(this, _offerTimer2) !== void 0) __privateGet(this, _host).timers.clearTimeout(__privateGet(this, _offerTimer2));
  __privateSet(this, _offerTimer2, void 0);
};
/** Every timer of the transfer stopped: it's ending, or waiting to hear why its connection went. */
quiet_fn2 = function() {
  __privateMethod(this, _SenderSession_instances, clearOfferTimer_fn2).call(this);
  __privateGet(this, _stall2).stop();
  __privateGet(this, _holds2).clear();
};
end_fn5 = async function(outcome, close) {
  if (__privateGet(this, _phase2) === "ended") return;
  __privateSet(this, _phase2, "ended");
  try {
    await __privateMethod(this, _SenderSession_instances, ending_fn2).call(this, outcome, close);
  } finally {
    __privateGet(this, _settled).resolve();
  }
};
ending_fn2 = async function(outcome, close) {
  __privateMethod(this, _SenderSession_instances, quiet_fn2).call(this);
  if (__privateGet(this, _lostTimer2) !== void 0) __privateGet(this, _host).timers.clearTimeout(__privateGet(this, _lostTimer2));
  __privateGet(this, _resumeSecret2)?.fill(0);
  __privateSet(this, _resumeSecret2, void 0);
  __privateGet(this, _queue3).length = 0;
  __privateMethod(this, _SenderSession_instances, wakeProducer_fn).call(this);
  __privateGet(this, _link2).stream(void 0);
  __privateGet(this, _host).ended(this, outcome);
  if (close && !__privateGet(this, _peerClosed2)) {
    await __privateGet(this, _link2).closeWith({ type: "close", operationId: __privateGet(this, _host).provider.randomBytes(16), ...close });
  } else {
    await within(__privateGet(this, _link2).flush(), outcome.state === "completed" ? RESULT_ACK_WAIT_MS : CLOSE_ACK_WAIT_MS, __privateGet(this, _host).timers);
  }
  if (outcome.state === "completed" && !__privateGet(this, _link2).closed) {
    __privateSet(this, _linger, __privateGet(this, _host).timers.setTimeout(() => __privateGet(this, _link2).close(), RESULT_ACK_WAIT_MS));
    return;
  }
  __privateGet(this, _link2).close();
};
function closeOnFinish(outcome) {
  if (outcome.state === "completed") return void 0;
  if (outcome.state === "cancelled") return { reason: "USER_CANCELLED" };
  return closeFor(outcome.error) ?? { reason: "FAILED" };
}
var _options2, _sessions, _listeners4, _attemptListeners, _done2, _ending, _chosen, _state3, _ended7, _connecting, _DirectSender_instances, settleWaiting_fn, takeAttempts_fn, take_fn5, tellAttempt_fn, setState_fn2, finish_fn2;
var DirectSender = class {
  /** @internal sendDirect() makes these. */
  constructor(provider, options, room, made) {
    __privateAdd(this, _DirectSender_instances);
    __publicField(this, "provider");
    __publicField(this, "files");
    __publicField(this, "sizes");
    __publicField(this, "totalSize");
    __publicField(this, "manifest");
    __publicField(this, "manifestHash");
    __publicField(this, "timers");
    /** The room: its link's secret and its code. */
    __publicField(this, "room");
    __privateAdd(this, _options2);
    __privateAdd(this, _sessions, /* @__PURE__ */ new Set());
    __privateAdd(this, _listeners4, new Listeners());
    __privateAdd(this, _attemptListeners, /* @__PURE__ */ new Set());
    __privateAdd(this, _done2, deferred2());
    /** Every session that has ended or is ending: the room closes once each has told its receiver. */
    __privateAdd(this, _ending, /* @__PURE__ */ new Set());
    __privateAdd(this, _chosen);
    __privateAdd(this, _state3, "waiting");
    __privateAdd(this, _ended7, false);
    /** Receivers' attempts still being set up (signalling, the handshake). */
    __privateAdd(this, _connecting, 0);
    this.provider = provider;
    __privateSet(this, _options2, options);
    this.files = Object.freeze([...options.files]);
    this.sizes = Object.freeze(made.sizes);
    this.totalSize = made.totalSize;
    this.manifest = made.manifest;
    this.manifestHash = made.manifestHash;
    this.timers = options.timers ?? GLOBAL_TIMERS;
    this.room = room;
    void __privateMethod(this, _DirectSender_instances, takeAttempts_fn).call(this);
  }
  /** Where the send stands. */
  get state() {
    return __privateGet(this, _state3);
  }
  /** How it ended, once it has. */
  get done() {
    return __privateGet(this, _done2).promise;
  }
  /** Whether `pause()` can be called now: from the chosen receiver's ACCEPT until FINISH has gone. */
  get canPause() {
    return !__privateGet(this, _ended7) && (__privateGet(this, _chosen)?.canPause ?? false);
  }
  /** Who holds the transfer: this side, the receiver, both, or no one. */
  get pausedBy() {
    return __privateGet(this, _chosen)?.pausedBy ?? null;
  }
  /** While held: when the transfer ends unless both sides resume first (ms since the epoch); else null. */
  get deadline() {
    return __privateGet(this, _chosen)?.deadline ?? null;
  }
  /** Whether reading a file has taken 30 s or more for the block it's on. */
  get stalled() {
    return __privateGet(this, _chosen)?.stalled ?? false;
  }
  /** The chosen receiver's last answer to a STATUS ask, if one has come. */
  get peerStatus() {
    return __privateGet(this, _chosen)?.peerStatus;
  }
  /** Whether a receiver has accepted: from then on the room takes no one else. */
  get chosen() {
    return __privateGet(this, _chosen) !== void 0;
  }
  /** How far the chosen receiver is: the bytes it has written, and the files it has finished (both 0 until one is chosen). */
  get progress() {
    return { consumed: __privateGet(this, _chosen)?.consumed ?? 0, filesDone: __privateGet(this, _chosen)?.filesDone ?? 0 };
  }
  /**
   * Calls `listener` whenever `state`, `pausedBy`, `deadline`, `stalled`, `peerStatus` or `progress` changes. Returns a
   * function that stops it.
   */
  onChange(listener) {
    return __privateGet(this, _listeners4).add(listener);
  }
  /** Calls `listener` with the error of each receiver's attempt that ends without being chosen (a wrong code, say). */
  onAttemptEnded(listener) {
    __privateGet(this, _attemptListeners).add(listener);
    return () => {
      __privateGet(this, _attemptListeners).delete(listener);
    };
  }
  /** Holds the transfer: PAUSE_UNAVAILABLE unless `canPause`. */
  pause() {
    if (!this.canPause) throw cantPause2();
    __privateGet(this, _chosen).pause();
  }
  /** Lets this side's hold go. */
  resume() {
    if (!__privateGet(this, _ended7)) __privateGet(this, _chosen)?.resume();
  }
  /**
   * Cancels the send: every receiver told (CLOSE, USER_CANCELLED), the room
   * closed. Once FINISH has gone, the receiver's answer decides it: the send
   * may turn out completed.
   */
  cancel() {
    if (__privateGet(this, _ended7)) return;
    if (__privateGet(this, _chosen)?.phase === "finalising") {
      __privateGet(this, _chosen).cancel();
      return;
    }
    __privateMethod(this, _DirectSender_instances, finish_fn2).call(this, { state: "cancelled", by: "self" });
  }
  /** The app is closing: every receiver told (CLOSE, APP_CLOSED, both ways, best effort), and the send ends cancelled. */
  appClosed() {
    __privateMethod(this, _DirectSender_instances, finish_fn2).call(this, { state: "cancelled", by: "self" }, { reason: "APP_CLOSED" });
  }
  /** @internal */
  accepted(session) {
    if (__privateGet(this, _ended7)) return false;
    __privateSet(this, _chosen, session);
    this.room.lock(session.attempt);
    for (const other of __privateGet(this, _sessions)) if (other !== session) other.taken();
    return true;
  }
  /** @internal */
  moved(session) {
    if (session !== __privateGet(this, _chosen) || __privateGet(this, _ended7)) return;
    const state = session.phase === "finalising" || session.phase === "closing" ? "finalising" : "transferring";
    if (__privateGet(this, _state3) !== state) __privateMethod(this, _DirectSender_instances, setState_fn2).call(this, state);
    else __privateGet(this, _listeners4).notify();
  }
  /** @internal */
  ended(session, outcome) {
    __privateGet(this, _sessions).delete(session);
    __privateGet(this, _ending).add(session);
    if (__privateGet(this, _ended7)) return;
    if (session === __privateGet(this, _chosen)) {
      __privateMethod(this, _DirectSender_instances, finish_fn2).call(this, outcome);
      return;
    }
    if (outcome.state === "cancelled" && outcome.by === "peer" && outcome.declined || outcome.state === "failed" && outcome.error.code === "TIMED_OUT") {
      __privateMethod(this, _DirectSender_instances, finish_fn2).call(this, outcome);
      return;
    }
    if (outcome.state === "failed") __privateMethod(this, _DirectSender_instances, tellAttempt_fn).call(this, outcome.error);
    __privateMethod(this, _DirectSender_instances, settleWaiting_fn).call(this);
  }
};
_options2 = new WeakMap();
_sessions = new WeakMap();
_listeners4 = new WeakMap();
_attemptListeners = new WeakMap();
_done2 = new WeakMap();
_ending = new WeakMap();
_chosen = new WeakMap();
_state3 = new WeakMap();
_ended7 = new WeakMap();
_connecting = new WeakMap();
_DirectSender_instances = new WeakSet();
/** With no receiver offered and none chosen: `connecting` while an attempt is being set up, else `waiting`. */
settleWaiting_fn = function() {
  if (__privateGet(this, _chosen) || __privateGet(this, _sessions).size > 0) return;
  __privateMethod(this, _DirectSender_instances, setState_fn2).call(this, __privateGet(this, _connecting) > 0 ? "connecting" : "waiting");
};
takeAttempts_fn = async function() {
  for (; ; ) {
    let attempt;
    try {
      attempt = await this.room.nextAttempt();
    } catch (err) {
      if (!__privateGet(this, _chosen)) __privateMethod(this, _DirectSender_instances, finish_fn2).call(this, { state: "failed", error: toDropgateError(err) });
      return;
    }
    if (__privateGet(this, _ended7)) {
      attempt.pipe.close();
      return;
    }
    void __privateMethod(this, _DirectSender_instances, take_fn5).call(this, attempt);
  }
};
take_fn5 = async function(attempt) {
  let channel;
  __privateSet(this, _connecting, __privateGet(this, _connecting) + 1);
  __privateMethod(this, _DirectSender_instances, settleWaiting_fn).call(this);
  try {
    channel = await this.room.accept(attempt, { peer: __privateGet(this, _options2).peer(), hello: __privateGet(this, _options2).hello, timers: this.timers });
  } catch (err) {
    __privateSet(this, _connecting, __privateGet(this, _connecting) - 1);
    if (!__privateGet(this, _ended7)) {
      __privateMethod(this, _DirectSender_instances, tellAttempt_fn).call(this, toDropgateError(err));
      __privateMethod(this, _DirectSender_instances, settleWaiting_fn).call(this);
    }
    return;
  }
  __privateSet(this, _connecting, __privateGet(this, _connecting) - 1);
  if (__privateGet(this, _ended7) || __privateGet(this, _chosen)) {
    channel.close();
    return;
  }
  const session = new SenderSession(this, channel, attempt);
  __privateGet(this, _sessions).add(session);
  session.start();
  __privateMethod(this, _DirectSender_instances, setState_fn2).call(this, "offered");
};
tellAttempt_fn = function(err) {
  for (const listener of [...__privateGet(this, _attemptListeners)]) {
    try {
      listener(err);
    } catch {
    }
  }
};
setState_fn2 = function(state) {
  if (__privateGet(this, _state3) === state || __privateGet(this, _ended7)) return;
  __privateSet(this, _state3, state);
  __privateGet(this, _listeners4).notify();
};
/**
 * Ends the send, once: every receiver still connected told (`close`, or as
 * the outcome says), then the room closed, once those CLOSEs have gone both
 * ways (2 s at most).
 */
finish_fn2 = function(outcome, close) {
  if (__privateGet(this, _ended7)) return;
  __privateSet(this, _ended7, true);
  __privateSet(this, _state3, outcome.state);
  const why = close ?? closeOnFinish(outcome);
  for (const session of [...__privateGet(this, _sessions)]) {
    if (session !== __privateGet(this, _chosen) || outcome.state !== "completed") void session.endWith({ state: "cancelled", by: "self" }, why);
  }
  __privateGet(this, _sessions).clear();
  void Promise.allSettled([...__privateGet(this, _ending)].map((session) => session.settled)).then(() => this.room.close());
  __privateGet(this, _done2).resolve(outcome);
  __privateGet(this, _listeners4).notify();
};
async function sendDirect(provider, options) {
  const { files, rendezvous, peer } = options ?? {};
  if (typeof peer !== "function") throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A direct send needs a peer connection for each receiver." });
  if (!Array.isArray(files)) throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A direct send takes a list of files." });
  files.forEach((file, index) => {
    if (!file || typeof file.read !== "function" || typeof file.name !== "string") {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: `File at index ${index} is missing or invalid.`, details: { index } });
    }
  });
  const manifest = encodeManifest(files.map((file) => ({ name: file.name, size: file.size, type: file.type ?? "" })));
  const sizes2 = files.map((file) => file.size);
  const totalSize = sizes2.reduce((sum, size) => sum + size, 0);
  const hash = await manifestHash(provider, manifest);
  const room = await openRoom(provider, { rendezvous, code: options.code === true, letters: options.letters });
  return new DirectSender(provider, options, room, { sizes: sizes2, totalSize, manifest, manifestHash: hash });
}

// src/client/direct.ts
var DEFAULT_DIRECT_SETTINGS = Object.freeze({ pauseLimitMs: null, reconnectWindowMs: 12e4, stun: true });
var MIN_PAUSE_LIMIT_MS = 6e4;
var MAX_PAUSE_LIMIT_MS = 6048e5;
var MIN_RECONNECT_WINDOW_MS = 1e4;
var MAX_RECONNECT_WINDOW_MS = 36e5;
var DIRECT_LINK_PATH = "/p2p";
var SETTINGS = ["pauseLimitMs", "reconnectWindowMs", "stun"];
var invalid10 = (message) => new DropgateError({ code: "INVALID_ARGUMENT", message });
var cantResume = () => new DropgateError({ code: "PAUSE_UNAVAILABLE", message: "This device hasn't paused the transfer, so there's nothing for it to resume." });
var cantPauseYet = () => new DropgateError({ code: "PAUSE_UNAVAILABLE", message: "A direct transfer can be paused once it has been accepted, until all its data has arrived." });
var hasEnded = () => invalid10("This transfer has ended.");
function wholeSecondsWithin(ms, min, max) {
  return typeof ms === "number" && Number.isSafeInteger(ms) && ms % 1e3 === 0 && ms >= min && ms <= max;
}
function directSettings(value, base) {
  if (value === void 0) return base;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalid10("direct is an object of pauseLimitMs, reconnectWindowMs and stun, each optional.");
  }
  for (const key of Object.keys(value)) {
    if (!SETTINGS.includes(key)) throw invalid10("direct takes pauseLimitMs, reconnectWindowMs and stun only.");
  }
  const pauseLimitMs = value.pauseLimitMs === void 0 ? base.pauseLimitMs : value.pauseLimitMs;
  if (pauseLimitMs !== null && !wholeSecondsWithin(pauseLimitMs, MIN_PAUSE_LIMIT_MS, MAX_PAUSE_LIMIT_MS)) {
    throw invalid10("direct.pauseLimitMs is null for no limit, or a whole number of seconds from one minute to one week, in milliseconds (60000 to 604800000).");
  }
  const reconnectWindowMs = value.reconnectWindowMs === void 0 ? base.reconnectWindowMs : value.reconnectWindowMs;
  if (!wholeSecondsWithin(reconnectWindowMs, MIN_RECONNECT_WINDOW_MS, MAX_RECONNECT_WINDOW_MS)) {
    throw invalid10("direct.reconnectWindowMs is a whole number of seconds from 10 seconds to one hour, in milliseconds (10000 to 3600000).");
  }
  const stun = value.stun === void 0 ? base.stun : value.stun;
  if (typeof stun !== "boolean") throw invalid10("direct.stun is true or false.");
  return Object.freeze({ pauseLimitMs, reconnectWindowMs, stun });
}
function helloOf(settings) {
  return {
    pauseLimitSeconds: settings.pauseLimitMs === null ? 0 : settings.pauseLimitMs / 1e3,
    reconnectWindowSeconds: settings.reconnectWindowMs / 1e3
  };
}
function directLink(baseUrl, secret, base64) {
  return `${baseUrl}${DIRECT_LINK_PATH}#${bytesToBase64url(secret, base64)}`;
}
function linkSecret(link, baseUrl, base64) {
  const notALink = () => invalid10("That isn't a direct transfer link: it's https://<server>/p2p#, then the secret.");
  if (typeof link !== "string") throw notALink();
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    throw notALink();
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw notALink();
  if (url.host !== new URL(baseUrl).host) throw invalid10("URL must be from this server.");
  if (url.pathname !== DIRECT_LINK_PATH || url.search !== "" || url.username !== "" || url.password !== "") throw notALink();
  const secret = base64urlToBytes(url.hash.slice(1), LINK_SECRET_BYTES, base64);
  if (!secret) throw notALink();
  return secret;
}
function appClosing(host) {
  for (const close of [...host.appClosers]) close();
}
function directServer(host, compat) {
  host.requireDirect(compat);
  const p2p = compat.serverInfo?.capabilities?.p2p;
  if (!p2p?.enabled) throw directTransferDisabled();
  const letters = p2p.codeLetters;
  if (letters !== 0 && letters !== 2 && letters !== 3) {
    throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's direct transfer settings weren't understood." });
  }
  const iceServers = Array.isArray(p2p.iceServers) ? p2p.iceServers : [];
  return { codeLetters: letters, iceServers, credentialRequired: p2p.credentialRequired === true };
}
function peerConnectionClass(given) {
  const found = given ?? globalThis.RTCPeerConnection;
  if (typeof found !== "function") {
    throw new DropgateError({
      code: "RUNTIME_UNSUPPORTED",
      message: "There's no RTCPeerConnection here for a direct transfer. In Node, pass a library's as the client's RTCPeerConnection option."
    });
  }
  return found;
}
function webSocketClass() {
  const found = globalThis.WebSocket;
  if (typeof found !== "function") {
    throw new DropgateError({ code: "RUNTIME_UNSUPPORTED", message: "There's no WebSocket here for a direct transfer." });
  }
  return found;
}
function untilAborted(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
function runningStatus(state, pausedBy) {
  return state === "transferring" && pausedBy !== null ? "paused" : state;
}
var ENDED = /* @__PURE__ */ new Set(["completed", "cancelled", "failed"]);
function runningText(side, status, pausedBy) {
  const other = side === "sender" ? "receiver" : "sender";
  switch (status) {
    case "waiting":
      return "Waiting for the receiver to connect.";
    case "connecting":
      return `Connecting to the ${other}...`;
    case "offered":
      return side === "sender" ? "Connected. Waiting for them to accept." : "Connected. Waiting for you to accept.";
    case "transferring":
      return side === "sender" ? "Sending..." : "Receiving...";
    case "paused":
      return pausedBy === "both" ? "Paused by both of you." : pausedBy === "self" ? "You paused the transfer." : `The ${other} paused the transfer.`;
    case "finalising":
      return side === "sender" ? "Waiting for the receiver to finish saving..." : "Saving the files...";
    default:
      return "";
  }
}
function endText(side, outcome) {
  const other = side === "sender" ? "receiver" : "sender";
  if (outcome.status === "completed") {
    if (side === "sender") return outcome.value.assurance === "saved" ? "The receiver has the files." : "Delivered to the receiver's browser.";
    return outcome.value.assurance === "saved" ? "The files are saved." : "Handed to your browser. Check your downloads.";
  }
  if (outcome.status === "cancelled") {
    if (outcome.cancellation.by !== "peer") return "Transfer cancelled.";
    return outcome.cancellation.declined ? "The receiver declined the transfer." : `The ${other} cancelled the transfer.`;
  }
  return outcome.error.message;
}
function percentOf(done, total) {
  return total > 0 ? Math.min(100, Math.floor(done * 100 / total)) : 0;
}
function handleValue(outcome, scope, files, totalBytes, transport) {
  if (outcome.state === "completed") return { assurance: outcome.assurance, files, totalBytes, transport };
  if (outcome.state === "cancelled") {
    if (!scope.cancellation) {
      if (outcome.by === "peer") scope.cancelByPeer(outcome.declined === true);
      else scope.cancel();
    }
    throw scope.signal.reason;
  }
  throw outcome.error;
}
function finalFields(side, outcome, last) {
  const done = outcome.status === "completed" ? { percent: 100, processedBytes: outcome.value.totalBytes, totalBytes: outcome.value.totalBytes, fileIndex: Math.max(0, outcome.value.files - 1) } : {};
  return { ...last, ...done, status: outcome.status, text: endText(side, outcome), stalled: false };
}
function deferred3() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => void 0);
  return { promise, resolve, reject };
}
function stamped(transport, step) {
  return (...args) => {
    let running;
    try {
      running = step(...args);
    } catch (err) {
      running = Promise.reject(err);
    }
    return running.catch((err) => {
      throw withTransport(err, transport);
    });
  };
}
async function startDirectSend(host, opts) {
  if (opts === null || typeof opts !== "object") throw invalid10("A direct send takes its options: { files }.");
  const files = toFileSources(opts.files);
  if (files.length === 0) throw invalid10("At least one file is required.");
  if (opts.code !== void 0 && typeof opts.code !== "boolean") throw invalid10("code is true or false.");
  const settings = directSettings(opts.direct, host.settings);
  const RTCPeerConnection = peerConnectionClass(host.RTCPeerConnection);
  const WebSocket = webSocketClass();
  const scope = new CancelScope("direct.send", { parent: host.registry.scope, signal: opts.signal });
  let sender;
  const closeForApp = () => sender ? sender.appClosed() : scope.cancel();
  host.appClosers.add(closeForApp);
  try {
    scope.throwIfCancelled();
    const server = directServer(host, await host.connect({ signal: scope.signal }));
    const credential = server.credentialRequired ? await host.credential(scope.signal) : void 0;
    scope.throwIfCancelled();
    const opening = sendDirect(host.provider, {
      files,
      code: opts.code !== false,
      letters: server.codeLetters === 0 ? void 0 : server.codeLetters,
      hello: helloOf(settings),
      rendezvous: senderRendezvous({
        url: rendezvousUrl(host.baseUrl),
        codeLetters: server.codeLetters,
        WebSocket,
        ...credential !== void 0 ? { credential } : {}
      }),
      peer: () => webRtcPeer({ RTCPeerConnection, role: "sender", iceServers: settings.stun ? server.iceServers : [] })
    });
    opening.then((opened) => {
      if (scope.cancellation) opened.cancel();
    }, () => void 0);
    sender = await untilAborted(opening, scope.signal);
  } catch (err) {
    host.appClosers.delete(closeForApp);
    const reason = scope.cancellation ? scope.signal.reason : err;
    scope.finish();
    throw reason;
  }
  return sendHandle(host, scope, sender, files.length, closeForApp);
}
function sendHandle(host, scope, sender, count, closeForApp) {
  const { transport } = host;
  const totalBytes = sender.totalSize;
  scope.onCancel(() => sender.cancel());
  const fields = () => {
    const { consumed, filesDone } = sender.progress;
    const pausedBy = sender.pausedBy;
    const status = runningStatus(sender.state, pausedBy);
    return {
      status,
      text: runningText("sender", status, pausedBy),
      code: sender.room.codeState,
      percent: percentOf(consumed, totalBytes),
      processedBytes: consumed,
      totalBytes,
      fileIndex: Math.min(filesDone, Math.max(0, count - 1)),
      totalFiles: count,
      stalled: sender.stalled,
      pausedBy,
      deadline: sender.deadline
    };
  };
  const pausing = {
    get canPause() {
      return sender.canPause;
    },
    pause: async () => sender.pause(),
    resume: async () => {
      if (sender.pausedBy !== "self" && sender.pausedBy !== "both") throw cantResume();
      sender.resume();
    }
  };
  const share = () => {
    const closed = Object.freeze({ link: null, code: null });
    if (sender.chosen || ENDED.has(sender.state)) return closed;
    const secret = sender.room.linkSecret();
    if (!secret) return closed;
    try {
      return Object.freeze({ link: directLink(host.baseUrl, secret, host.base64), code: sender.room.code ?? null });
    } finally {
      secret.fill(0);
    }
  };
  return host.registry.add(startOperation({
    kind: "direct.send",
    scope,
    transport,
    initial: fields(),
    ownPausing: pausing,
    work: async (ctx) => {
      const publish = () => {
        if (!ENDED.has(sender.state)) ctx.update(fields());
      };
      const stops = [sender.onChange(publish), sender.room.onCodeChange(publish)];
      publish();
      try {
        return handleValue(await sender.done, ctx.scope, count, totalBytes, transport);
      } finally {
        for (const stop of stops) stop();
      }
    },
    finalSnapshot: (outcome, last) => finalFields("sender", outcome, { ...last, code: sender.room.codeState }),
    onEnd: (handle) => {
      host.appClosers.delete(closeForApp);
      host.registry.remove(handle);
    },
    extend: () => ({ share })
  }));
}
var _rendezvous2, _signal2, _peer2, _pipe3, _stop;
var CancellableJoin = class {
  constructor(rendezvous, signal, peer) {
    __privateAdd(this, _rendezvous2);
    __privateAdd(this, _signal2);
    __privateAdd(this, _peer2);
    __privateAdd(this, _pipe3);
    __privateAdd(this, _stop, () => {
      __privateGet(this, _pipe3)?.close();
      try {
        __privateGet(this, _peer2).close();
      } catch {
      }
    });
    __privateSet(this, _rendezvous2, rendezvous);
    __privateSet(this, _signal2, signal);
    __privateSet(this, _peer2, peer);
    signal.addEventListener("abort", __privateGet(this, _stop), { once: true });
  }
  join(by) {
    const joining = __privateGet(this, _rendezvous2).join(by);
    joining.then((joined) => {
      __privateSet(this, _pipe3, joined.pipe);
      if (__privateGet(this, _signal2).aborted) joined.pipe.close();
    }, () => void 0);
    return untilAborted(joining, __privateGet(this, _signal2));
  }
  connected() {
    __privateGet(this, _signal2).removeEventListener("abort", __privateGet(this, _stop));
  }
};
_rendezvous2 = new WeakMap();
_signal2 = new WeakMap();
_peer2 = new WeakMap();
_pipe3 = new WeakMap();
_stop = new WeakMap();
async function startDirectReceive(host, opts) {
  if (opts === null || typeof opts !== "object") throw invalid10("A direct receive takes the sender's link or code: { link } or { code }.");
  const byLink = opts.link !== void 0;
  if (byLink === (opts.code !== void 0)) throw invalid10("A direct receive takes the sender's link or its code, one of the two.");
  const secret = byLink ? linkSecret(opts.link, host.baseUrl, host.base64) : void 0;
  const code = byLink ? void 0 : normalizeCode(opts.code);
  const settings = directSettings(opts.direct, host.settings);
  const RTCPeerConnection = peerConnectionClass(host.RTCPeerConnection);
  const WebSocket = webSocketClass();
  const { transport, provider } = host;
  let receiver;
  const engine = deferred3();
  let ended = false;
  let answered = false;
  let count = 0;
  let totalBytes = 0;
  const fields = (r) => {
    const { consumed, fileIndex } = r.progress;
    const pausedBy = r.pausedBy;
    const status = runningStatus(r.state, pausedBy);
    return {
      status,
      text: runningText("receiver", status, pausedBy),
      percent: percentOf(consumed, totalBytes),
      processedBytes: consumed,
      totalBytes,
      fileIndex: Math.min(fileIndex, Math.max(0, count - 1)),
      totalFiles: count,
      stalled: r.stalled,
      pausedBy,
      deadline: r.deadline
    };
  };
  const work = async (ctx) => {
    let channelSecret = secret;
    try {
      const server = directServer(host, await host.connect({ signal: ctx.signal }));
      if (code !== void 0 && server.codeLetters === 0) {
        throw new DropgateError({ code: "CAPABILITY_UNSUPPORTED", message: "This server doesn't use codes. Ask the sender for the link." });
      }
      const peer = webRtcPeer({ RTCPeerConnection, role: "receiver", iceServers: settings.stun ? server.iceServers : [] });
      const rendezvous = new CancellableJoin(
        receiverRendezvous({ url: rendezvousUrl(host.baseUrl), codeLetters: server.codeLetters, WebSocket }),
        ctx.signal,
        peer
      );
      const hello = helloOf(settings);
      const connecting = channelSecret ? connectByLink(provider, { rendezvous, peer, secret: channelSecret, hello }) : connectByCode(provider, { rendezvous, peer, code, letters: server.codeLetters, hello });
      connecting.then((channel2) => {
        if (ctx.signal.aborted) channel2.close();
      }, () => void 0);
      const channel = await untilAborted(connecting, ctx.signal);
      rendezvous.connected();
      receiver = receiveDirect(provider, channel);
    } finally {
      channelSecret?.fill(0);
      channelSecret = void 0;
    }
    const r = receiver;
    ctx.scope.onCancel(() => r.cancel());
    const publish = () => {
      if (!ENDED.has(r.state)) ctx.update(fields(r));
    };
    const stop = r.onChange(publish);
    r.offer().then((offer2) => {
      count = offer2.files.length;
      totalBytes = offer2.totalSize;
      publish();
    }, () => void 0);
    engine.resolve(r);
    publish();
    try {
      return handleValue(await r.done, ctx.scope, count, totalBytes, transport);
    } finally {
      stop();
    }
  };
  const pausing = {
    get canPause() {
      return receiver?.canPause ?? false;
    },
    pause: async () => {
      if (!receiver) throw cantPauseYet();
      receiver.pause();
    },
    resume: async () => {
      if (!receiver || receiver.pausedBy !== "self" && receiver.pausedBy !== "both") throw cantResume();
      receiver.resume();
    }
  };
  const answering = () => {
    if (ended) throw hasEnded();
    if (answered) throw invalid10("The offer has already been accepted or declined.");
    answered = true;
  };
  const offer = () => engine.promise.then((r) => r.offer());
  const accept = async (options) => {
    const { sink, asZip = false, handOff = false } = options ?? {};
    if (typeof sink !== "function" && !isDownloadSink(sink)) {
      throw invalid10("A direct transfer is received into a sink, with write() and close(), or a function giving one for each file.");
    }
    if (typeof asZip !== "boolean" || typeof handOff !== "boolean") throw invalid10("asZip and handOff are true or false.");
    if (asZip && typeof sink === "function") throw invalid10("Files received as a ZIP need one sink, with write() and close().");
    answering();
    const r = await engine.promise;
    try {
      await r.accept({ sink, asZip, handOff });
    } catch (err) {
      if (DropgateError.is(err, "INVALID_ARGUMENT") && r.state === "offered") answered = false;
      throw err;
    }
  };
  const decline = async () => {
    answering();
    (await engine.promise).decline();
  };
  const handle = startOperation({
    kind: "direct.receive",
    parent: host.registry.scope,
    signal: opts.signal,
    transport,
    initial: {
      status: "connecting",
      text: runningText("receiver", "connecting", null),
      percent: 0,
      processedBytes: 0,
      totalBytes: 0,
      fileIndex: 0,
      totalFiles: 0,
      stalled: false
    },
    ownPausing: pausing,
    work,
    finalSnapshot: (outcome, last) => finalFields("receiver", outcome, last),
    onEnd: (h) => {
      ended = true;
      host.appClosers.delete(closeForApp);
      host.registry.remove(h);
    },
    extend: () => ({
      offer: stamped(transport, offer),
      accept: stamped(transport, accept),
      decline: stamped(transport, decline)
    })
  });
  function closeForApp() {
    if (receiver) receiver.appClosed();
    else handle.cancel();
  }
  if (!ended) host.appClosers.add(closeForApp);
  void handle.result.then((outcome) => {
    engine.reject(outcome.status === "failed" ? outcome.error : new DropgateError({ code: "OPERATION_CANCELLED", details: { cancellation: outcome.status === "cancelled" ? outcome.cancellation : void 0 } }));
  });
  return host.registry.add(handle);
}

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
var INFO2 = {
  header: "dropgate/4 header",
  payload: "dropgate/4 payload",
  meta: "dropgate/4 meta"
};
async function deriveObjectKeys(provider, secret, salt) {
  if (secret.byteLength !== SECRET_BYTES) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A link's secret is 32 bytes." });
  }
  const info2 = (label) => new TextEncoder().encode(label);
  const [header2, payload, meta] = await Promise.all([
    provider.deriveMacKey(secret, salt, info2(INFO2.header)),
    provider.deriveContentKey(secret, salt, info2(INFO2.payload)),
    provider.deriveContentKey(secret, salt, info2(INFO2.meta))
  ]);
  return Object.freeze({ header: header2, payload, meta });
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
var _provider8, _key2, _layout, _sealed, _kept;
var ChunkSealer = class {
  constructor(provider, payloadKey, layout) {
    __privateAdd(this, _provider8);
    __privateAdd(this, _key2);
    __privateAdd(this, _layout);
    __privateAdd(this, _sealed);
    __privateAdd(this, _kept, /* @__PURE__ */ new Map());
    __privateSet(this, _provider8, provider);
    __privateSet(this, _key2, payloadKey);
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
      sealed = await __privateGet(this, _provider8).encryptWithNonce(__privateGet(this, _key2), chunkNonce(index, __privateGet(this, _layout).isLast(index)), plaintext);
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
_provider8 = new WeakMap();
_key2 = new WeakMap();
_layout = new WeakMap();
_sealed = new WeakMap();
_kept = new WeakMap();
var _provider9, _key3, _layout2, _last, _next;
var ChunkOpener = class {
  constructor(provider, payloadKey, layout, first = 0, last = layout.chunkCount - 1) {
    __privateAdd(this, _provider9);
    __privateAdd(this, _key3);
    __privateAdd(this, _layout2);
    __privateAdd(this, _last);
    __privateAdd(this, _next);
    layout.range(first, last);
    __privateSet(this, _provider9, provider);
    __privateSet(this, _key3, payloadKey);
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
      plaintext = await __privateGet(this, _provider9).decryptWithNonce(__privateGet(this, _key3), chunkNonce(index, __privateGet(this, _layout2).isLast(index)), sealed);
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
_provider9 = new WeakMap();
_key3 = new WeakMap();
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
function bucketFor2(length) {
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
function encodeManifest2(files) {
  checkFiles(files);
  const json = new TextEncoder().encode(JSON.stringify({ files: files.map(({ name, size }) => ({ name, size })) }));
  const padded = new Uint8Array(bucketFor2(LENGTH_BYTES + json.byteLength));
  new DataView(padded.buffer).setUint32(0, json.byteLength, false);
  padded.set(json, LENGTH_BYTES);
  return padded;
}
var broken = (message) => new DropgateError({ code: "INTEGRITY_FAILED", message });
function decodeManifest2(padded) {
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
var _secret2, _sealer;
var ObjectWriter = class {
  /** @internal Made by `createObject()`. */
  constructor(parts) {
    __publicField(this, "header");
    __publicField(this, "meta");
    __publicField(this, "layout");
    __publicField(this, "files");
    __privateAdd(this, _secret2);
    __privateAdd(this, _sealer);
    __privateSet(this, _secret2, parts.secret);
    __privateSet(this, _sealer, parts.sealer);
    this.header = parts.header;
    this.meta = parts.meta;
    this.layout = parts.layout;
    this.files = Object.freeze(parts.files);
    Object.freeze(this);
  }
  /** The link's secret: a copy, for the link alone. */
  secret() {
    return __privateGet(this, _secret2).slice();
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
_secret2 = new WeakMap();
_sealer = new WeakMap();
async function createObject(provider, opts) {
  checkFiles(opts.files);
  const length = opts.files.reduce((sum, file) => sum + file.size, 0);
  const layout = ObjectLayout.encrypted(paddedLength(length, opts.chunkSize, opts.maxBytes ?? 0), opts.chunkSize);
  const manifest = encodeManifest2(opts.files);
  const secret = opts.secret ? opts.secret.slice() : provider.randomBytes(SECRET_BYTES);
  const salt = opts.salt ? opts.salt.slice() : provider.randomBytes(SALT_BYTES);
  const fields = headerFields(opts.chunkSize, salt);
  const keys = await deriveObjectKeys(provider, secret, salt);
  const mac = await provider.hmacSha256(keys.header, fields);
  const header2 = new Uint8Array(HEADER_BYTES);
  header2.set(fields);
  header2.set(mac, fields.byteLength);
  return new ObjectWriter({
    secret,
    header: header2,
    meta: await sealMeta(provider, keys.meta, manifest),
    layout,
    files: withOffsets(opts.files),
    sealer: new ChunkSealer(provider, keys.payload, layout)
  });
}
var _provider10, _keys2;
var OpenedObject = class {
  /** @internal Made by `openObject()`. */
  constructor(provider, keys, header2, layout, files) {
    __publicField(this, "header");
    __publicField(this, "layout");
    __publicField(this, "files");
    /** The files' bytes added up: the plaintext before the padding. */
    __publicField(this, "totalSize");
    __privateAdd(this, _provider10);
    __privateAdd(this, _keys2);
    __privateSet(this, _provider10, provider);
    __privateSet(this, _keys2, keys);
    this.header = header2;
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
    return new ChunkOpener(__privateGet(this, _provider10), __privateGet(this, _keys2).payload, this.layout, first, last);
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
    const header2 = this.header;
    let seen = 0;
    async function* afterHeader() {
      for await (const piece of bytes) {
        const inHeader = Math.min(piece.byteLength, HEADER_BYTES - seen);
        for (let i = 0; i < inHeader; i++) {
          if (piece[i] !== header2[seen + i]) {
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
_provider10 = new WeakMap();
_keys2 = new WeakMap();
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
  const files = withOffsets(decodeManifest2(manifest));
  const layout = ObjectLayout.fromStoredSize(opts.size, parsed.chunkSize);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > layout.length) {
    throw new DropgateError({ code: "INTEGRITY_FAILED", message: "The list of files doesn't fit the object." });
  }
  return new OpenedObject(provider, keys, opts.header.slice(), layout, files);
}

// src/client/DropgateClient.ts
function isPeerJsCall(opts) {
  return opts !== null && typeof opts === "object" && "Peer" in opts;
}
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
function untilAborted2(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
function retryAfterMs(res, fallback) {
  const header2 = res.headers.get("Retry-After");
  const seconds = header2 === null || header2.trim() === "" ? NaN : Number(header2);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 60) * 1e3 : fallback;
}
var _auth, _direct, _RTCPeerConnection;
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
    /** Direct transfers' settings, which each transfer's override. */
    __privateAdd(this, _direct);
    /** The client's `RTCPeerConnection` option, if it was given one. */
    __privateAdd(this, _RTCPeerConnection);
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
    try {
      __privateSet(this, _direct, directSettings(opts.direct, DEFAULT_DIRECT_SETTINGS));
    } catch (err) {
      throw withTransport(err, this.transport);
    }
    if (opts.RTCPeerConnection !== void 0 && typeof opts.RTCPeerConnection !== "function") {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "RTCPeerConnection must be an RTCPeerConnection class.", transport: this.transport });
    }
    __privateSet(this, _RTCPeerConnection, opts.RTCPeerConnection);
    const transport = this.transport;
    const stamped2 = (fn) => (...args) => {
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
      connect: stamped2((o) => this._connect(o)),
      info: stamped2((o) => this._fetchInfo(o).then((serverInfo) => ({ ...serverInfo, transport }))),
      on: stamped2((event, listener) => this._on(event, listener))
    });
    this.hosted = Object.freeze({
      upload: stamped2((o) => this._upload(o)),
      download: stamped2((o) => this._download(o)),
      metadata: stamped2((o) => this._metadata(o)),
      open: stamped2((o) => this._open(o)),
      validate: stamped2((o) => this._validate(o)),
      delete: stamped2((o) => this._delete(o))
    });
    const directHost = this._directHost();
    this.direct = Object.freeze({
      send: stamped2((o) => isPeerJsCall(o) ? this._directSend(o) : startDirectSend(directHost, o)),
      receive: stamped2((o) => isPeerJsCall(o) ? this._directReceive(o) : startDirectReceive(directHost, o)),
      appClosing: () => appClosing(directHost)
    });
    this.links = Object.freeze({
      resolve: stamped2((value, o) => this._resolve(value, o))
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
    if (input.kind === "direct" || input.kind === "direct-link") {
      if (!compat.serverInfo?.capabilities?.p2p?.enabled) return refused2("Direct transfer is disabled on this server.");
      if (input.kind === "direct-link") return { valid: true, type: "p2p", target: `/p2p#${input.secret}`, transport };
      if (input.linkHost !== void 0) return { valid: true, type: "p2p", target: `/p2p/${encodeURIComponent(input.locator)}`, transport };
      return { valid: true, type: "p2p", target: `/p2p#${input.locator}`, transport };
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
      const header2 = base64urlToBytes(raw.header, HEADER_BYTES, this.base64);
      const meta = base64urlToBytes(raw.meta, void 0, this.base64);
      if (!header2 || !meta) {
        throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's details of the upload weren't understood." });
      }
      const secretBytes = base64urlToBytes(secret, SECRET_BYTES, this.base64);
      if (!secretBytes) throw new DropgateError({ code: "DECRYPT_FAILED" });
      opened = await openObject(this._crypto, { secret: secretBytes, header: header2, meta, size });
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
    const read2 = await this._readObject(id, secret, compat, opts);
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
          taken = await untilAborted2(taking, waitOpts.signal);
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
      metadata: read2.meta,
      download: (o) => {
        try {
          if (closed) throw new DropgateError({ code: "INVALID_ARGUMENT", message: "This upload has been closed." });
          const handle = this._startDownload(o ?? {}, { read: async () => read2, lease: shared });
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
  /** What a direct transfer's handle needs of this client. */
  _directHost() {
    const auth = __privateGet(this, _auth);
    const baseUrl = this.baseUrl;
    return Object.freeze({
      provider: this._crypto,
      baseUrl,
      transport: this.transport,
      base64: this.base64,
      registry: this._registry,
      settings: __privateGet(this, _direct),
      RTCPeerConnection: __privateGet(this, _RTCPeerConnection),
      connect: (o) => this._connect(o),
      requireDirect: (compat) => this._requireCompatible(compat, "dgdtp"),
      appClosers: /* @__PURE__ */ new Set(),
      credential: async (signal) => {
        const credentials = await OperationCredentials.required(auth, "direct.send", baseUrl, signal);
        return credentials.token();
      }
    });
  }
  /** Dropgate 3's PeerJS send, for the calls that still pass its `Peer`. */
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
  /** Dropgate 3's PeerJS receive, for the calls that still pass its `Peer`. */
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
_direct = new WeakMap();
_RTCPeerConnection = new WeakMap();
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
   * Whether a value is a code as someone might type it: four of the letters
   * A–Z without I and O, then four digits. Spaces and lower case are fine,
   * and the dash may be left out.
   */
  isLike: isCodeLike
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
