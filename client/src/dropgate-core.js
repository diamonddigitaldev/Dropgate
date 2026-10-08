// Built from packages/dropgate-core by `npm run build` there. Don't edit this file:
// change core's source and build it again. CI fails if this doesn't match the build.
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
var AES_GCM_TAG_BYTES = 16;
var ENCRYPTION_OVERHEAD_PER_CHUNK = AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES;

// src/errors.ts
var ERROR_CODES = {
  INVALID_ARGUMENT: { origin: "local", retryable: false, message: "An option passed to Dropgate is missing or invalid." },
  RUNTIME_UNSUPPORTED: { origin: "local", retryable: false, message: "This environment lacks something Dropgate needs." },
  OPERATION_CANCELLED: { origin: "local", retryable: false, message: "The operation was cancelled." },
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

// src/crypto/sha256-fallback.ts
var K = new Uint32Array([
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
function rotr(x, n) {
  return x >>> n | x << 32 - n;
}
function sha256Fallback(data) {
  const bytes = new Uint8Array(data);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(
    Math.ceil((bytes.length + 9) / 64) * 64
  );
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view2 = new DataView(padded.buffer);
  view2.setUint32(padded.length - 8, bitLen / 4294967296 >>> 0, false);
  view2.setUint32(padded.length - 4, bitLen >>> 0, false);
  let h0 = 1779033703;
  let h1 = 3144134277;
  let h2 = 1013904242;
  let h3 = 2773480762;
  let h4 = 1359893119;
  let h5 = 2600822924;
  let h6 = 528734635;
  let h7 = 1541459225;
  const W = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view2.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ W[i - 15] >>> 3;
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ W[i - 2] >>> 10;
      W[i] = W[i - 16] + s0 + W[i - 7] + s1 | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const temp1 = h + S1 + ch + K[i] + W[i] | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = S0 + maj | 0;
      h = g;
      g = f;
      f = e;
      e = d + temp1 | 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 | 0;
    }
    h0 = h0 + a | 0;
    h1 = h1 + b | 0;
    h2 = h2 + c | 0;
    h3 = h3 + d | 0;
    h4 = h4 + e | 0;
    h5 = h5 + f | 0;
    h6 = h6 + g | 0;
    h7 = h7 + h | 0;
  }
  const result = new ArrayBuffer(32);
  const out = new DataView(result);
  out.setUint32(0, h0, false);
  out.setUint32(4, h1, false);
  out.setUint32(8, h2, false);
  out.setUint32(12, h3, false);
  out.setUint32(16, h4, false);
  out.setUint32(20, h5, false);
  out.setUint32(24, h6, false);
  out.setUint32(28, h7, false);
  return result;
}

// src/crypto/provider.ts
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
var own = (bytes) => new Uint8Array(bytes);
var view = (bytes) => bytes.buffer instanceof ArrayBuffer ? bytes : own(bytes);
var HMAC_KEY_BITS = 256;
var noEncryption = () => new DropgateError({
  code: "RUNTIME_UNSUPPORTED",
  message: "Web Crypto API not available (crypto.subtle). Encryption needs a secure context (HTTPS or localhost)."
});
function webCryptoProvider(webCrypto) {
  const subtle = webCrypto.subtle;
  const name = "webcrypto";
  const needSubtle = () => {
    if (!subtle) throw noEncryption();
    return subtle;
  };
  const cryptoKey = (key) => ContentKey.handle(key, name);
  const macKey = (key) => MacKey.handle(key, name);
  const nonceOf = (nonce) => {
    if (nonce.byteLength !== AES_GCM_IV_BYTES) throw new DropgateError({ code: "INVALID_ARGUMENT", message: "An AES-GCM nonce is 12 bytes." });
    return own(nonce);
  };
  const hkdf = async (ikm, salt, info, algorithm, usages) => {
    const base = await needSubtle().importKey("raw", own(ikm), "HKDF", false, ["deriveKey"]);
    return needSubtle().deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: own(salt), info: own(info) },
      base,
      algorithm,
      false,
      usages
    );
  };
  const randomBytes = (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 65536) webCrypto.getRandomValues(out.subarray(i, Math.min(length, i + 65536)));
    return out;
  };
  const provider = {
    name,
    canEncrypt: Boolean(subtle),
    randomBytes,
    randomUUID() {
      if (typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID();
      const bytes = randomBytes(16);
      bytes[6] = bytes[6] & 15 | 64;
      bytes[8] = bytes[8] & 63 | 128;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
    async generateKey() {
      const key = await needSubtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
      return new ContentKey(name, key);
    },
    async importKey(raw) {
      if (raw.byteLength !== 32) throw new DropgateError({ code: "INVALID_ARGUMENT", message: "A content key is 32 bytes." });
      const key = await needSubtle().importKey("raw", own(raw), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
      return new ContentKey(name, key);
    },
    async exportKey(key) {
      return new Uint8Array(await needSubtle().exportKey("raw", cryptoKey(key)));
    },
    async encrypt(key, plaintext) {
      const iv = randomBytes(AES_GCM_IV_BYTES);
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
    async encryptWithNonce(key, nonce, plaintext) {
      return new Uint8Array(await needSubtle().encrypt({ name: "AES-GCM", iv: nonceOf(nonce) }, cryptoKey(key), view(plaintext)));
    },
    async decryptWithNonce(key, nonce, sealed) {
      return new Uint8Array(await needSubtle().decrypt({ name: "AES-GCM", iv: nonceOf(nonce) }, cryptoKey(key), view(sealed)));
    },
    async deriveContentKey(ikm, salt, info) {
      return new ContentKey(name, await hkdf(ikm, salt, info, { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]));
    },
    async deriveMacKey(ikm, salt, info) {
      return new MacKey(name, await hkdf(ikm, salt, info, { name: "HMAC", hash: "SHA-256", length: HMAC_KEY_BITS }, ["sign", "verify"]));
    },
    async hmacSha256(key, data) {
      return new Uint8Array(await needSubtle().sign("HMAC", macKey(key), view(data)));
    },
    async verifyHmacSha256(key, mac, data) {
      return needSubtle().verify("HMAC", macKey(key), own(mac), view(data));
    },
    async sha256(data) {
      if (subtle) return new Uint8Array(await subtle.digest("SHA-256", own(data)));
      return new Uint8Array(sha256Fallback(own(data).buffer));
    }
  };
  return Object.freeze(provider);
}
function cryptoProvider() {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.getRandomValues !== "function") {
    throw new DropgateError({
      code: "RUNTIME_UNSUPPORTED",
      message: "No secure random numbers here (crypto.getRandomValues())."
    });
  }
  return webCryptoProvider(webCrypto);
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
  const randomBytes = provider.randomBytes(8);
  let letterPart = "";
  for (let i = 0; i < 4; i++) {
    letterPart += letters[randomBytes[i] % letters.length];
  }
  let numberPart = "";
  for (let i = 4; i < 8; i++) {
    numberPart += (randomBytes[i] % 10).toString();
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

// src/operation.ts
function newOperationId() {
  return cryptoProvider().randomUUID();
}
function startOperation(opts) {
  const scope = new CancelScope(opts.kind, { parent: opts.parent, signal: opts.signal });
  const listeners = /* @__PURE__ */ new Set();
  let snapshot = Object.freeze({ ...opts.initial, transport: opts.transport });
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
  const ctx = {
    scope,
    signal: scope.signal,
    // A patch can't change the transport.
    update: (patch) => {
      if (!ended) publish({ ...snapshot, ...patch, transport: opts.transport });
    }
  };
  const run = async () => {
    await Promise.resolve();
    scope.throwIfCancelled();
    return opts.work(ctx);
  };
  const result = settle(scope, run, opts.transport).then((outcome) => {
    ended = true;
    try {
      opts.onEnd?.(handle);
    } catch {
    }
    publish({ ...opts.finalSnapshot(outcome, snapshot), transport: opts.transport });
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
    }
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
async function fileHandleSource(handle, opts) {
  const { size } = await handle.stat();
  return {
    name: opts.name,
    size,
    ...opts.type ? { type: opts.type } : {},
    async read(start, end) {
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
  const invalid2 = (message) => new DropgateError({
    code: "INVALID_FILENAME",
    message,
    ...where.origin ? { origin: where.origin } : {},
    ...where.index === void 0 ? {} : { details: { index: where.index } }
  });
  if (typeof filename !== "string" || filename.trim().length === 0) {
    throw invalid2("A file name is empty.");
  }
  if (utf8Length(filename) > MAX_FILENAME_BYTES) {
    throw invalid2(`A file name is longer than ${MAX_FILENAME_BYTES} bytes.`);
  }
  if (CONTROL.test(filename)) {
    throw invalid2("A file name has a control character in it.");
  }
  if (/[/\\]/.test(filename)) {
    throw invalid2("A file name has a path in it.");
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
var invalid = (message) => new DropgateError({ code: "INVALID_ARGUMENT", message });
var isLength = (n) => Number.isSafeInteger(n) && n >= 0;
var isChunkSize = (chunkSize) => Number.isSafeInteger(chunkSize) && chunkSize >= MIN_CHUNK_SIZE && chunkSize <= MAX_CHUNK_SIZE;
var checkChunkSize = (chunkSize) => {
  if (!isChunkSize(chunkSize)) throw invalid("A chunk size is from 64 KiB to 64 MiB.");
};
var bitLength = (n) => {
  let bits = 0;
  for (let rest = n; rest >= 1; rest = Math.floor(rest / 2)) bits++;
  return bits;
};
function padme(length) {
  if (!isLength(length)) throw invalid("A length is a whole number of bytes.");
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
  if (!isLength(length) || length < 1) throw invalid("An object holds at least one byte.");
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
    if (!isLength(length) || length < 1) throw invalid("An object holds at least one byte.");
    return new _ObjectLayout(true, length, chunkSize);
  }
  /** An unencrypted object: the files' bytes, with no header, tags or padding. */
  static plain(length, chunkSize) {
    checkChunkSize(chunkSize);
    if (!isLength(length) || length < 1) throw invalid("An object holds at least one byte.");
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
    if (last < first) throw invalid("A range ends before it starts.");
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
      throw invalid("That run of bytes isn't in the object.");
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
  if (!Number.isSafeInteger(index) || index < 0 || index >= this.chunkCount) throw invalid("No chunk has that index.");
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
function plaintextBytes(storedBytes, chunkSize) {
  if (!(storedBytes > 0)) return 0;
  const chunks = Math.ceil(storedBytes / (chunkSize + ENCRYPTION_OVERHEAD_PER_CHUNK));
  return storedBytes - chunks * ENCRYPTION_OVERHEAD_PER_CHUNK;
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

// src/crypto/index.ts
async function sha256Hex(provider, data) {
  const digest = await provider.sha256(data);
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
async function keyToBase64(provider, key, base64) {
  return base64.encode(await provider.exportKey(key));
}
async function keyFromBase64(provider, keyB64, base64) {
  return provider.importKey(base64.decode(keyB64));
}
async function encryptName(provider, name, key, base64) {
  return base64.encode(await provider.encrypt(key, new TextEncoder().encode(String(name))));
}
async function decryptName(provider, sealedB64, key, base64) {
  return new TextDecoder().decode(await provider.decrypt(key, base64.decode(sealedB64)));
}

// src/credentials.ts
var TOKEN68 = /^[A-Za-z0-9\-._~+/]+=*$/;
var MAX_TOKEN_LENGTH = 8192;
var _provider2, _operation, _baseUrl, _token, _renewed, _OperationCredentials_instances, ask_fn;
var _OperationCredentials = class _OperationCredentials {
  constructor(provider, operation, baseUrl) {
    __privateAdd(this, _OperationCredentials_instances);
    __privateAdd(this, _provider2);
    __privateAdd(this, _operation);
    __privateAdd(this, _baseUrl);
    __privateAdd(this, _token, null);
    __privateAdd(this, _renewed, false);
    __privateSet(this, _provider2, provider);
    __privateSet(this, _operation, operation);
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
_operation = new WeakMap();
_baseUrl = new WeakMap();
_token = new WeakMap();
_renewed = new WeakMap();
_OperationCredentials_instances = new WeakSet();
ask_fn = async function(reason, signal) {
  if (signal.aborted) throw signal.reason;
  const request = Object.freeze({ operation: __privateGet(this, _operation), reason, baseUrl: __privateGet(this, _baseUrl), signal });
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
function estimateTotalUploadSizeBytes(fileSizeBytes, totalChunks, isEncrypted) {
  const base = Number(fileSizeBytes) || 0;
  if (!isEncrypted) return base;
  return base + (Number(totalChunks) || 0) * ENCRYPTION_OVERHEAD_PER_CHUNK;
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
  const { id, bundleId } = opts ?? {};
  if (typeof id === "string" && id && bundleId === void 0) return { id, secret: opts?.secret };
  if (typeof bundleId === "string" && bundleId && id === void 0) return { bundleId, keyB64: opts?.keyB64 };
  throw new DropgateError({ code: "INVALID_ARGUMENT", message: "Either id or bundleId is required." });
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
function unreachableTooLong(cause) {
  if (cause.code === "NOT_FOUND") return cause;
  return new DropgateError({
    code: "NOT_FOUND",
    message: "The server dropped this upload: it couldn't be reached for longer than the server waits.",
    cause
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
    if (target.id !== void 0) return (await this._readObject(target.id, target.secret, compat, opts)).meta;
    return (await this._readMetadata({ bundleId: target.bundleId, keyB64: target.keyB64, timeoutMs: opts.timeoutMs, signal: opts.signal }, compat)).meta;
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
  /**
   * Reads a bundle's metadata from the server, decrypting its file names, and
   * gives the key too, for its download.
   */
  async _readMetadata(opts, compat) {
    const { bundleId, keyB64, timeoutMs = 5e3, signal } = opts;
    const { baseUrl, serverInfo } = compat;
    const chunkSize = serverChunkSize(serverInfo, this.chunkSize);
    const { res, json } = await fetchJson(this.fetchFn, `${baseUrl}/api/bundle/${encodeURIComponent(bundleId)}/meta`, { method: "GET", timeoutMs, signal });
    if (!res.ok) throw errorFromStatus(res.status, json, "Failed to fetch bundle metadata.");
    if (!json || typeof json !== "object") {
      throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server sent no metadata." });
    }
    const raw = json;
    const isEncrypted = Boolean(raw.isEncrypted);
    let cryptoKey;
    if (isEncrypted) {
      if (!keyB64) throw new DropgateError({ code: "KEY_REQUIRED" });
      if (!this._crypto.canEncrypt) {
        throw new DropgateError({
          code: "RUNTIME_UNSUPPORTED",
          message: "Web Crypto API not available for decryption. Encrypted uploads need a secure context (HTTPS or localhost)."
        });
      }
    }
    const decrypt = async (run) => {
      try {
        cryptoKey ?? (cryptoKey = await keyFromBase64(this._crypto, keyB64, this.base64));
        return await run(cryptoKey);
      } catch (err) {
        throw new DropgateError({ code: "DECRYPT_FAILED", cause: err });
      }
    };
    const openName = (encrypted) => decrypt((key) => decryptName(this._crypto, String(encrypted ?? ""), key, this.base64));
    const received = (name, index) => {
      validateFilename(name, { origin: "server", ...index === void 0 ? {} : { index } });
      return name;
    };
    let files;
    const sealed = Boolean(raw.sealed && raw.encryptedManifest);
    if (sealed) {
      const manifest = await decrypt(async (key) => {
        const decrypted = await this._crypto.decrypt(key, this.base64.decode(raw.encryptedManifest));
        const parsed = JSON.parse(new TextDecoder().decode(decrypted));
        if (!Array.isArray(parsed?.files)) throw new TypeError("The manifest has no files.");
        return parsed.files;
      });
      files = manifest.map((f, i) => ({ fileId: f.fileId, name: received(f.name || "file", i), sizeBytes: Number(f.sizeBytes) || 0 }));
    } else if (Array.isArray(raw.files)) {
      files = [];
      for (const f of raw.files) {
        const stored = Number(f.sizeBytes) || 0;
        files.push({
          fileId: f.fileId,
          name: received(isEncrypted ? await openName(f.encryptedFilename) : f.filename || "file", files.length),
          // An unsealed encrypted bundle's sizes are what the server stored, ciphertext.
          sizeBytes: isEncrypted ? plaintextBytes(stored, chunkSize) : stored
        });
      }
    } else {
      throw new DropgateError({ code: "INVALID_RESPONSE", message: "Invalid bundle metadata: missing files or manifest." });
    }
    return {
      meta: {
        kind: "bundle",
        transport: this.transport,
        bundleId,
        isEncrypted,
        sealed,
        files,
        fileCount: files.length,
        totalSizeBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0)
      },
      cryptoKey
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
    const encrypt = opts.encrypt ?? Boolean(caps?.e2ee);
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
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileSize = Number(file?.size);
      if (!file || !Number.isFinite(fileSize) || fileSize < 0) {
        throw new DropgateError({ code: "INVALID_ARGUMENT", message: `File at index ${i} is missing or invalid.`, details: { index: i } });
      }
      if (fileSize === 0) {
        throw new DropgateError({ code: "FILE_EMPTY", details: { index: i } });
      }
      const maxMB = Number(caps.maxSizeMB);
      if (Number.isFinite(maxMB) && maxMB > 0) {
        const limitBytes = mbToBytes(maxMB);
        const validationChunkSize = serverChunkSize(serverInfo, this.chunkSize);
        const estimatedBytes = files.length === 1 ? estimateUploadBytes(fileSize, { encrypted: encrypt, chunkSize: validationChunkSize, maxBytes: limitBytes }) : estimateTotalUploadSizeBytes(fileSize, Math.ceil(fileSize / validationChunkSize), encrypt);
        if (estimatedBytes > limitBytes) {
          const msg = encrypt ? `File at index ${i} too large once encryption overhead is included. Server limit: ${maxMB} MB.` : `File at index ${i} too large. Server limit: ${maxMB} MB.`;
          throw new DropgateError({ code: "FILE_TOO_LARGE", message: msg, details: { index: i } });
        }
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
    if (encrypt && !caps.e2ee) {
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
      encrypt,
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
    const currentUploadIds = [];
    let currentObjectUpload = null;
    const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);
    let credentials = OperationCredentials.none;
    const callCancelEndpoint = async (uploadId) => {
      try {
        await fetchJson(this.fetchFn, `${this.baseUrl}/upload/cancel`, {
          method: "POST",
          timeoutMs: 5e3,
          headers: { "Content-Type": "application/json", Accept: "application/json", ...credentials.headers() },
          body: JSON.stringify({ uploadId })
        });
      } catch {
      }
    };
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
      const effectiveEncrypt = encrypt ?? serverSupportsE2EE;
      this._validate({ files, lifetimeMs, encrypt: effectiveEncrypt, serverInfo });
      if (serverInfo?.capabilities?.upload?.credentialRequired === true) {
        credentials = await OperationCredentials.required(__privateGet(this, _auth), "hosted.upload", baseUrl, effectiveSignal);
      }
      const policy = retryPolicy(retry);
      if (files.length === 1) {
        return this._uploadObject({
          file: files[0],
          name: filenames2[0],
          encrypted: effectiveEncrypt,
          lifetimeMs,
          maxDownloads,
          compat,
          progress,
          signal: effectiveSignal,
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
      }
      let cryptoKey = null;
      let keyB64 = null;
      const transmittedFilenames = [];
      if (effectiveEncrypt) {
        if (!this._crypto.canEncrypt) {
          throw new DropgateError({
            code: "RUNTIME_UNSUPPORTED",
            message: "Web Crypto API not available. Encryption requires a secure context (HTTPS or localhost)."
          });
        }
        progress({ phase: "crypto", text: "Generating encryption key..." });
        try {
          cryptoKey = await this._crypto.generateKey();
          keyB64 = await keyToBase64(this._crypto, cryptoKey, this.base64);
          for (const name of filenames2) {
            transmittedFilenames.push(await encryptName(this._crypto, name, cryptoKey, this.base64));
          }
        } catch (err) {
          throw new DropgateError({ code: "ENCRYPT_FAILED", cause: err });
        }
      } else {
        transmittedFilenames.push(...filenames2);
      }
      const serverChunkSize2 = serverInfo?.capabilities?.upload?.chunkSize;
      const effectiveChunkSize = Number.isFinite(serverChunkSize2) && serverChunkSize2 > 0 ? serverChunkSize2 : this.chunkSize;
      const fileManifest = files.map((f, i) => {
        const totalChunks = Math.ceil(f.size / effectiveChunkSize);
        const totalUploadSize = estimateTotalUploadSizeBytes(f.size, totalChunks, effectiveEncrypt);
        return { filename: transmittedFilenames[i], totalSize: totalUploadSize, totalChunks };
      });
      progress({ phase: "init", text: `Reserving server storage for ${files.length} files...`, totalFiles: files.length });
      const initBundleRes = await send(`${baseUrl}/upload/init-bundle`, {
        method: "POST",
        timeoutMs: timeouts.initMs ?? 15e3,
        signal: effectiveSignal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          fileCount: files.length,
          files: fileManifest,
          lifetime: lifetimeMs,
          isEncrypted: effectiveEncrypt,
          ...maxDownloads !== void 0 ? { maxDownloads } : {}
        })
      });
      if (!initBundleRes.res.ok) {
        throw errorFromStatus(initBundleRes.res.status, initBundleRes.json, "Bundle initialisation failed.");
      }
      const bundleInitJson = initBundleRes.json;
      const bundleUploadId = bundleInitJson?.bundleUploadId;
      const fileUploadIds = bundleInitJson?.fileUploadIds;
      if (!bundleUploadId || !fileUploadIds || fileUploadIds.length !== files.length) {
        throw new DropgateError({ code: "INVALID_RESPONSE", message: "Server did not return valid bundle upload IDs." });
      }
      currentUploadIds.push(...fileUploadIds);
      progress({ status: "uploading" });
      const fileResults = [];
      let cumulativeBytes = 0;
      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi];
        const uploadId = fileUploadIds[fi];
        const totalChunks = fileManifest[fi].totalChunks;
        const totalUploadSize = fileManifest[fi].totalSize;
        progress({
          phase: "file-start",
          text: `Uploading file ${fi + 1} of ${files.length}...`,
          percent: totalSizeBytes > 0 ? cumulativeBytes / totalSizeBytes * 100 : 0,
          processedBytes: cumulativeBytes,
          fileIndex: fi,
          totalFiles: files.length
        });
        await this._uploadFileChunks({
          file,
          uploadId,
          cryptoKey,
          effectiveChunkSize,
          totalChunks,
          totalUploadSize,
          baseOffset: cumulativeBytes,
          totalBytesAllFiles: totalSizeBytes,
          progress,
          signal: effectiveSignal,
          baseUrl,
          policy,
          chunkTimeoutMs: timeouts.chunkMs ?? 6e4,
          credentials
        });
        const completeRes = await send(`${baseUrl}/upload/complete`, {
          method: "POST",
          timeoutMs: timeouts.completeMs ?? 3e4,
          signal: effectiveSignal,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ uploadId })
        });
        if (!completeRes.res.ok) {
          throw errorFromStatus(completeRes.res.status, completeRes.json, `File ${fi + 1} finalisation failed.`);
        }
        const fileId = completeRes.json?.id;
        if (!fileId) throw new DropgateError({ code: "INVALID_RESPONSE", message: `Server did not return a valid file id for file ${fi + 1}.` });
        fileResults.push({ fileId, name: filenames2[fi], size: file.size });
        cumulativeBytes += file.size;
        progress({
          phase: "file-complete",
          text: `File ${fi + 1} of ${files.length} uploaded.`,
          percent: totalSizeBytes > 0 ? cumulativeBytes / totalSizeBytes * 100 : 0,
          processedBytes: cumulativeBytes
        });
      }
      progress({ status: "completing", phase: "complete", text: "Finalising bundle...", percent: 100, processedBytes: totalSizeBytes });
      let encryptedManifestB64;
      if (effectiveEncrypt && cryptoKey) {
        const manifest = JSON.stringify({
          files: fileResults.map((r) => ({
            fileId: r.fileId,
            name: r.name,
            sizeBytes: r.size
          }))
        });
        const manifestBytes = new TextEncoder().encode(manifest);
        encryptedManifestB64 = this.base64.encode(await this._crypto.encrypt(cryptoKey, manifestBytes));
      }
      const completeBundleRes = await send(`${baseUrl}/upload/complete-bundle`, {
        method: "POST",
        timeoutMs: timeouts.completeMs ?? 3e4,
        signal: effectiveSignal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          bundleUploadId,
          ...encryptedManifestB64 ? { encryptedManifest: encryptedManifestB64 } : {}
        })
      });
      if (!completeBundleRes.res.ok) {
        throw errorFromStatus(completeBundleRes.res.status, completeBundleRes.json, "Bundle finalisation failed.");
      }
      const bundleId = completeBundleRes.json?.bundleId;
      if (!bundleId) throw new DropgateError({ code: "INVALID_RESPONSE", message: "Server did not return a valid bundle id." });
      let downloadUrl = `${baseUrl}/b/${bundleId}`;
      if (effectiveEncrypt && keyB64) downloadUrl += `#${keyB64}`;
      return {
        downloadUrl,
        id: bundleId,
        files: fileResults.map(({ name, size }) => ({ name, size })),
        transport: this.transport
      };
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
          for (const id of currentUploadIds) callCancelEndpoint(id).catch(() => {
          });
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
   * Uploads one file as a Dropgate 4 object: started with its header, sealed
   * file list and the manage token's SHA-256, sent chunk by chunk (each chunk
   * of an encrypted one sealed once, and those same bytes sent again on a
   * retry), then finished. Gives the link, with the secret after its # for an
   * encrypted one, and the manage token: nothing else ever holds either.
   */
  async _uploadObject(p) {
    const { file, name, encrypted, compat, progress, signal, send, timeouts } = p;
    const { baseUrl, serverInfo } = compat;
    const chunkSize = serverChunkSize(serverInfo, this.chunkSize);
    if (!isChunkSize(chunkSize)) {
      throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server's chunk size isn't one this version of Dropgate can use." });
    }
    const maxMB = Number(serverInfo?.capabilities?.upload?.maxSizeMB);
    const maxBytes = Number.isFinite(maxMB) && maxMB > 0 ? mbToBytes(maxMB) : 0;
    const files = [{ name, size: file.size }];
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
      layout = ObjectLayout.plain(file.size, chunkSize);
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
    progress({ status: "uploading" });
    const totalChunks = layout.chunkCount;
    for (let i = 0; i < totalChunks; i++) {
      if (signal.aborted) throw signal.reason || new DropgateError({ code: "OPERATION_CANCELLED" });
      const processedBytes = Math.min(file.size, i * chunkSize);
      progress({
        phase: "chunk",
        text: `Uploading chunk ${i + 1} of ${totalChunks}...`,
        percent: processedBytes / file.size * 100,
        processedBytes,
        chunkIndex: i,
        totalChunks
      });
      let body;
      if (writer) {
        const { parts } = writer.chunkParts(i);
        const plaintext = new Uint8Array(layout.chunkLength(i));
        let at = 0;
        for (const part of parts) {
          plaintext.set(await readRange(file, part.offset, part.offset + part.length), at);
          at += part.length;
        }
        body = await writer.seal(i, plaintext);
      } else {
        const { start: from, end: to } = layout.chunkBytes(i);
        body = await readRange(file, from, to);
      }
      const digest = this.base64.encode(await this._crypto.sha256(body));
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
        { policy: p.policy, window: window2, timeoutMs: timeouts.chunkMs ?? 6e4, signal, progress, chunkIndex: i, credentials: p.credentials }
      );
      writer?.confirm(i);
    }
    progress({ status: "completing", phase: "complete", text: "Finalising upload...", percent: 100, processedBytes: file.size });
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
      waiting: ({ remainingMs }) => progress({ text: `Finalising failed. Retrying in ${(remainingMs / 1e3).toFixed(1)}s...` }),
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
    const target = hostedTarget(opts);
    const { asZip, sink, signal, timeoutMs = 6e4 } = opts;
    const policy = retryPolicy(opts.retry);
    const picked = opts.files;
    if (picked !== void 0 && (!Array.isArray(picked) || picked.length === 0 || picked.some((i) => !Number.isSafeInteger(i) || i < 0) || new Set(picked).size !== picked.length)) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "files lists which files to download, by index, each once." });
    }
    const chosenIndexes = picked ? [...picked].sort((a, b) => a - b) : void 0;
    const zipped = Boolean(asZip);
    const sinkFits = typeof sink === "function" ? !zipped : isDownloadSink(sink) && (target.id !== void 0 || zipped);
    if (!sinkFits) {
      throw new DropgateError({
        code: "INVALID_ARGUMENT",
        message: !sink ? "A download needs a sink, with write() and close(), for its bytes." : zipped ? "Files downloaded as a ZIP need one sink, with write() and close()." : target.id !== void 0 ? "The sink needs write() and close(), or must be a function giving a sink." : "A bundle downloaded as separate files needs a function giving a sink for each file."
      });
    }
    const bundleWork = async (ctx, bundleId, keyB64) => {
      const progress = ctx.update;
      const downloadSignal = ctx.signal;
      let open = null;
      try {
        const compat = await this._connect({ timeoutMs, signal: downloadSignal });
        progress({ phase: "server-compat", text: compat.dgup.message });
        this._requireCompatible(compat, "dgup");
        const { baseUrl } = compat;
        progress({ phase: "metadata", text: "Fetching bundle info..." });
        const { meta, cryptoKey } = await this._readMetadata({ bundleId, keyB64, timeoutMs, signal: downloadSignal }, compat);
        const indexes = chooseFiles(chosenIndexes, meta.files.length);
        const files = indexes.map((i) => meta.files[i]);
        const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
        const several = true;
        progress({ status: "downloading", totalBytes, ...several ? { totalFiles: files.length } : {} });
        const streamOpts = { baseUrl, isEncrypted: meta.isEncrypted, cryptoKey, compat, signal: downloadSignal, timeoutMs };
        let written = 0;
        const counted = (fileIndex, done) => (fileBytes) => {
          const processedBytes = done + fileBytes;
          progress({
            phase: "downloading",
            percent: totalBytes > 0 ? processedBytes / totalBytes * 100 : 0,
            processedBytes,
            ...several ? { fileIndex } : {}
          });
        };
        const fileStarts = (fi) => {
          progress({
            phase: several ? "file-start" : "downloading",
            text: several ? `Downloading file ${fi + 1} of ${files.length}...` : "Downloading...",
            percent: totalBytes > 0 ? written / totalBytes * 100 : 0,
            processedBytes: written,
            ...several ? { fileIndex: fi } : {}
          });
        };
        if (zipped) {
          const out = await SinkWriter.open(sink, { name: "", size: totalBytes, index: 0 });
          open = out;
          const zip2 = new StreamingZipWriter((chunk) => out.write(chunk));
          const drained = async () => {
            try {
              await zip2.drained();
            } catch (err) {
              throw toDropgateError(err, "OUTPUT_WRITE_FAILED");
            }
          };
          const sized = (run) => {
            try {
              run();
            } catch (err) {
              if (err instanceof DropgateError && err.code === "INVALID_ARGUMENT") {
                throw new DropgateError({ code: "INTEGRITY_FAILED", message: "A file's bytes didn't match its size.", cause: err });
              }
              throw toDropgateError(err, "OUTPUT_WRITE_FAILED");
            }
          };
          for (let fi = 0; fi < files.length; fi++) {
            fileStarts(indexes[fi]);
            zip2.startFile(files[fi].name, files[fi].sizeBytes);
            const done = written;
            written += await this._streamFile(files[fi].fileId, streamOpts, async (chunk) => {
              sized(() => zip2.writeChunk(chunk));
              await drained();
            }, counted(indexes[fi], done));
            sized(() => zip2.endFile());
          }
          progress({ status: "completing", phase: "complete", text: "Finishing the download..." });
          try {
            await zip2.finalize();
          } catch (err) {
            throw toDropgateError(err, "OUTPUT_WRITE_FAILED");
          }
          await out.close();
          open = null;
          if (files.length === meta.files.length) {
            try {
              await fetchJson(this.fetchFn, `${baseUrl}/api/bundle/${encodeURIComponent(bundleId)}/downloaded`, {
                method: "POST",
                timeoutMs: 5e3,
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: "{}"
              });
            } catch {
            }
          }
        } else {
          for (let fi = 0; fi < files.length; fi++) {
            const file = files[fi];
            fileStarts(indexes[fi]);
            const out = await SinkWriter.open(sink, { name: file.name, size: file.sizeBytes, index: indexes[fi] });
            open = out;
            const done = written;
            written += await this._streamFile(file.fileId, streamOpts, (chunk) => out.write(chunk), counted(indexes[fi], done));
            if (fi === files.length - 1) progress({ status: "completing", phase: "complete", text: "Finishing the download..." });
            await out.close();
            open = null;
          }
        }
        return {
          filenames: files.map((f) => f.name),
          receivedBytes: written,
          wasEncrypted: meta.isEncrypted,
          transport: this.transport
        };
      } catch (err) {
        await open?.abort(downloadSignal.aborted ? downloadSignal.reason : err);
        throw err;
      }
    };
    const work = (ctx) => target.id !== void 0 ? this._downloadObject(ctx, { id: target.id, secret: target.secret, sink, zipped, files: chosenIndexes, timeoutMs, policy }) : bundleWork(ctx, target.bundleId, target.keyB64);
    return this._registry.add(startOperation({
      kind: "hosted.download",
      parent: this._registry.scope,
      transport: this.transport,
      signal,
      initial: { status: "initializing", phase: "server-info", text: "Checking server...", percent: 0, processedBytes: 0, totalBytes: 0 },
      work,
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
   * Downloads an upload under one lease: the whole object, as it's stored,
   * each chunk of an encrypted one opened as it comes, to the one marked last,
   * padding included, so nothing can have been cut off; and its files written
   * out in order. The last file, or the ZIP, is only finished once everything
   * has come and been checked. A connection that drops, or stalls, is asked
   * again under the same lease for the rest, from the next whole chunk; and if
   * the server sends anything but the rest of the same upload, none of it is
   * written. The lease is released as soon as the download ends, however it
   * ends, so it counts at once.
   */
  async _downloadObject(ctx, o) {
    const progress = ctx.update;
    const downloadSignal = ctx.signal;
    const { id, secret, sink, zipped, timeoutMs } = o;
    let baseUrl = this.baseUrl;
    let lease = null;
    let open = null;
    try {
      const compat = await this._connect({ timeoutMs, signal: downloadSignal });
      progress({ phase: "server-compat", text: compat.dgup.message });
      this._requireCompatible(compat, "dgup");
      baseUrl = compat.baseUrl;
      progress({ phase: "metadata", text: "Fetching file info..." });
      const { meta, opened } = await this._readObject(id, secret, compat, { timeoutMs, signal: downloadSignal });
      const { files } = meta;
      const indexes = chooseFiles(o.files, files.length);
      const wanted = new Set(indexes);
      const lastWanted = indexes[indexes.length - 1];
      const totalSize = indexes.reduce((sum, i) => sum + files[i].size, 0);
      const several = indexes.length > 1;
      if (several && !zipped && typeof sink !== "function") {
        throw new DropgateError({ code: "INVALID_ARGUMENT", message: "Several files downloaded apart need a function giving a sink for each file." });
      }
      progress({ status: "downloading", totalBytes: totalSize, ...several ? { totalFiles: indexes.length } : {} });
      const taken = await this._takeLease(baseUrl, id, { timeoutMs, signal: downloadSignal, progress });
      lease = taken.lease;
      const window2 = new RetryWindow();
      window2.heard(taken.deadline);
      const zipOut = zipped ? await SinkWriter.open(sink, { name: "", size: totalSize, index: 0 }) : null;
      open = zipOut;
      const zip2 = zipOut ? new StreamingZipWriter((chunk) => zipOut.write(chunk)) : null;
      const zipStep = async (run) => {
        try {
          await run();
        } catch (err) {
          if (err instanceof DropgateError && err.code === "INVALID_ARGUMENT") {
            throw new DropgateError({ code: "INTEGRITY_FAILED", message: "A file's bytes didn't match its size.", cause: err });
          }
          throw toDropgateError(err, "OUTPUT_WRITE_FAILED");
        }
      };
      let fileIndex = 0;
      let fileWritten = 0;
      let written = 0;
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
      const deliver = async (bytes) => {
        let at = 0;
        while (at < bytes.byteLength && fileIndex < files.length) {
          const piece = bytes.subarray(at, at + Math.min(bytes.byteLength - at, files[fileIndex].size - fileWritten));
          if (wanted.has(fileIndex)) {
            if (started !== fileIndex) await startFile(fileIndex);
            if (zip2) {
              await zipStep(() => zip2.writeChunk(piece));
              await zipStep(() => zip2.drained());
            } else {
              await current.write(piece);
            }
            written += piece.byteLength;
            progress({ phase: "downloading", percent: written / totalSize * 100, processedBytes: written, ...several ? { fileIndex } : {} });
          }
          at += piece.byteLength;
          fileWritten += piece.byteLength;
          if (fileWritten === files[fileIndex].size) {
            if (wanted.has(fileIndex)) {
              if (zip2) await zipStep(() => zip2.endFile());
              else if (fileIndex !== lastWanted) {
                await current.close();
                current = null;
                open = zipOut;
              }
            }
            fileIndex++;
            fileWritten = 0;
          }
        }
      };
      await startFile(indexes[0]);
      const size = opened ? opened.layout.storedSize : meta.totalSize;
      let nextChunk = 0;
      let plainWritten = 0;
      await retrying(async () => {
        const from = opened ? nextChunk === 0 ? 0 : opened.layout.range(nextChunk).start : plainWritten;
        const { signal: waitSignal, waiting, cleanup } = makeWaitSignal(downloadSignal, timeoutMs);
        let stopWatching = () => {
        };
        const failed = (err, code) => waitSignal.aborted ? waitSignal.reason : toDropgateError(err, code);
        try {
          let res;
          try {
            res = await waiting(() => this.fetchFn(`${baseUrl}/api/v4/objects/${id}/content`, {
              method: "GET",
              // The rest of it, and only if it's still the same upload: anything else is sent whole, and refused.
              headers: { "Dropgate-Lease": lease, ...from > 0 ? { Range: `bytes=${from}-`, "If-Range": taken.etag } : {} },
              signal: waitSignal
            }));
          } catch (err) {
            throw failed(err, "SERVER_UNREACHABLE");
          }
          if (!res.ok) throw withRetryAfter(errorFromStatus(res.status, await res.json().catch(() => null), "Download failed."), res);
          window2.heard();
          if (from > 0) {
            if (res.status === 200) {
              throw new DropgateError({ code: "INTEGRITY_FAILED", message: "The server sent the whole upload again, not the rest of it, so it may have changed. Nothing more of it was written." });
            }
            const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get("Content-Range") ?? "");
            if (res.status !== 206 || !range || Number(range[1]) !== from || Number(range[2]) !== size - 1 || Number(range[3]) !== size) {
              throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server didn't send the rest of the upload." });
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
            const chunks = from === 0 ? opened.read(received()) : opened.chunks(received(), nextChunk);
            for await (const { index, plaintext } of chunks) {
              await deliver(plaintext);
              nextChunk = index + 1;
            }
          } else {
            for await (const piece of received()) {
              if (plainWritten + piece.byteLength > meta.totalSize) {
                throw new DropgateError({ code: "INTEGRITY_FAILED", message: "More data came than the upload holds." });
              }
              await deliver(piece);
              plainWritten += piece.byteLength;
            }
          }
        } finally {
          stopWatching();
          cleanup();
        }
      }, {
        policy: o.policy,
        window: window2,
        signal: downloadSignal,
        random: (length) => this._crypto.randomBytes(length),
        waiting: ({ remainingMs }) => progress({ text: `The connection was lost. Reconnecting in ${(remainingMs / 1e3).toFixed(1)}s...` }),
        retrying: () => progress({ text: "Reconnecting..." })
      });
      if (fileIndex !== files.length) throw new DropgateError({ code: "INTEGRITY_FAILED", message: "The data ended before the last file did." });
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
      if (lease) await this._releaseLease(baseUrl, lease);
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
  /** Releases a download's lease, so it counts now (if it sent anything) and frees its place. Best effort. */
  async _releaseLease(baseUrl, lease) {
    try {
      await fetchJson(this.fetchFn, `${baseUrl}/api/v4/lease`, {
        method: "DELETE",
        timeoutMs: 5e3,
        headers: { "Dropgate-Lease": lease }
      });
    } catch {
    }
  }
  /**
   * Streams one file's bytes from the server into `deliver`, decrypting them
   * if it's encrypted, awaiting each delivery before reading on. Returns how
   * many bytes were delivered.
   */
  async _streamFile(fileId, opts, deliverChunk, onBytesDelivered) {
    const { baseUrl, isEncrypted, cryptoKey, compat, signal, timeoutMs } = opts;
    const { signal: downloadSignal, waiting, cleanup: downloadCleanup } = makeWaitSignal(signal, timeoutMs);
    let deliveredBytes = 0;
    let stopWatching = () => {
    };
    const step = async (code, run) => {
      try {
        return await run();
      } catch (err) {
        if (downloadSignal.aborted) throw downloadSignal.reason;
        throw toDropgateError(err, code);
      }
    };
    try {
      let downloadRes;
      try {
        downloadRes = await waiting(() => this.fetchFn(`${baseUrl}/api/file/${encodeURIComponent(fileId)}`, {
          method: "GET",
          signal: downloadSignal
        }));
      } catch (err) {
        throw toDropgateError(err, "SERVER_UNREACHABLE");
      }
      if (!downloadRes.ok) throw errorFromStatus(downloadRes.status, null, "Download failed.");
      if (!downloadRes.body) throw new DropgateError({ code: "RUNTIME_UNSUPPORTED", message: "Streaming response not available." });
      const reader = downloadRes.body.getReader();
      const cancelRead = () => {
        reader.cancel(downloadSignal.reason).catch(() => {
        });
      };
      downloadSignal.addEventListener("abort", cancelRead, { once: true });
      stopWatching = () => downloadSignal.removeEventListener("abort", cancelRead);
      const read = async () => {
        const next = await step("CONNECTION_LOST", () => waiting(() => reader.read()));
        if (downloadSignal.aborted) throw downloadSignal.reason;
        return next;
      };
      const decrypt = (chunk) => step("INTEGRITY_FAILED", () => this._crypto.decrypt(cryptoKey, chunk));
      const deliver = async (chunk) => {
        await step("OUTPUT_WRITE_FAILED", () => deliverChunk(chunk));
        deliveredBytes += chunk.byteLength;
        onBytesDelivered(deliveredBytes);
      };
      if (isEncrypted && cryptoKey) {
        const ENCRYPTED_CHUNK_SIZE = serverChunkSize(compat.serverInfo, this.chunkSize) + ENCRYPTION_OVERHEAD_PER_CHUNK;
        const pendingChunks = [];
        let pendingLength = 0;
        const flushPending = () => {
          if (pendingChunks.length === 0) return new Uint8Array(0);
          if (pendingChunks.length === 1) {
            const result2 = pendingChunks[0];
            pendingChunks.length = 0;
            pendingLength = 0;
            return result2;
          }
          const result = new Uint8Array(pendingLength);
          let offset = 0;
          for (const chunk of pendingChunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          pendingChunks.length = 0;
          pendingLength = 0;
          return result;
        };
        while (true) {
          if (downloadSignal.aborted) throw downloadSignal.reason;
          const { done, value } = await read();
          if (done) break;
          pendingChunks.push(value);
          pendingLength += value.length;
          while (pendingLength >= ENCRYPTED_CHUNK_SIZE) {
            const buffer = flushPending();
            const encryptedChunk = buffer.subarray(0, ENCRYPTED_CHUNK_SIZE);
            if (buffer.length > ENCRYPTED_CHUNK_SIZE) {
              pendingChunks.push(buffer.subarray(ENCRYPTED_CHUNK_SIZE));
              pendingLength = buffer.length - ENCRYPTED_CHUNK_SIZE;
            }
            await deliver(new Uint8Array(await decrypt(encryptedChunk)));
          }
        }
        if (pendingLength > 0) {
          await deliver(new Uint8Array(await decrypt(flushPending())));
        }
      } else {
        while (true) {
          if (downloadSignal.aborted) throw downloadSignal.reason;
          const { done, value } = await read();
          if (done) break;
          await deliver(value);
        }
      }
    } catch (err) {
      throw toDropgateError(err, "CONNECTION_LOST");
    } finally {
      stopWatching();
      downloadCleanup();
    }
    return deliveredBytes;
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
   * Upload a single file's chunks to the server. Used by hosted.upload().
   */
  async _uploadFileChunks(params) {
    const {
      file,
      uploadId,
      cryptoKey,
      effectiveChunkSize,
      totalChunks,
      baseOffset,
      totalBytesAllFiles,
      progress,
      signal,
      baseUrl,
      policy,
      chunkTimeoutMs,
      credentials
    } = params;
    const window2 = new RetryWindow();
    for (let i = 0; i < totalChunks; i++) {
      if (signal.aborted) {
        throw signal.reason || new DropgateError({ code: "OPERATION_CANCELLED" });
      }
      const start = i * effectiveChunkSize;
      const end = Math.min(start + effectiveChunkSize, file.size);
      const processedBytes = baseOffset + start;
      const percent = totalBytesAllFiles > 0 ? processedBytes / totalBytesAllFiles * 100 : 0;
      progress({
        phase: "chunk",
        text: `Uploading chunk ${i + 1} of ${totalChunks}...`,
        percent,
        processedBytes,
        chunkIndex: i,
        totalChunks
      });
      const chunkBytes = await readRange(file, start, end);
      let uploadBytes;
      if (cryptoKey) {
        try {
          uploadBytes = await this._crypto.encrypt(cryptoKey, chunkBytes);
        } catch (err) {
          throw new DropgateError({ code: "ENCRYPT_FAILED", cause: err });
        }
      } else {
        uploadBytes = chunkBytes;
      }
      if (uploadBytes.byteLength > effectiveChunkSize + 1024) {
        throw new DropgateError({ code: "INVALID_ARGUMENT", message: "Chunk too large (client-side). Check chunk size settings." });
      }
      const hashHex = await sha256Hex(this._crypto, uploadBytes);
      await this._attemptChunkUpload(
        `${baseUrl}/upload/chunk`,
        { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Upload-ID": uploadId, "X-Chunk-Index": String(i), "X-Chunk-Hash": hashHex }, body: new Blob([uploadBytes]) },
        { policy, window: window2, timeoutMs: chunkTimeoutMs, signal, progress, chunkIndex: i, credentials }
      );
    }
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
      waiting: ({ attempt, remainingMs }) => progress({
        phase: "retry-wait",
        text: `Chunk upload failed. Retrying in ${(remainingMs / 1e3).toFixed(1)}s... ${counted(attempt)}`
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
