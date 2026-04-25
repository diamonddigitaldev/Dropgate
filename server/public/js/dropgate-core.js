var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/constants.ts
var DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
var AES_GCM_IV_BYTES = 12;
var AES_GCM_TAG_BYTES = 16;
var ENCRYPTION_OVERHEAD_PER_CHUNK = AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES;
var MAX_IN_MEMORY_DOWNLOAD_BYTES = 100 * 1024 * 1024;

// src/errors.ts
var DropgateError = class extends Error {
  constructor(message, opts = {}) {
    super(message, opts.cause !== void 0 ? { cause: opts.cause } : void 0);
    __publicField(this, "code");
    __publicField(this, "details");
    this.name = this.constructor.name;
    this.code = opts.code || "DROPGATE_ERROR";
    this.details = opts.details;
  }
};
var DropgateValidationError = class extends DropgateError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || "VALIDATION_ERROR" });
  }
};
var DropgateNetworkError = class extends DropgateError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || "NETWORK_ERROR" });
  }
};
var DropgateProtocolError = class extends DropgateError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || "PROTOCOL_ERROR" });
  }
};
var DropgateAbortError = class extends DropgateError {
  constructor(message = "Operation aborted") {
    super(message, { code: "ABORT_ERROR" });
    this.name = "AbortError";
  }
};
var DropgateTimeoutError = class extends DropgateError {
  constructor(message = "Request timed out") {
    super(message, { code: "TIMEOUT_ERROR" });
    this.name = "TimeoutError";
  }
};

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
function getDefaultCrypto() {
  return globalThis.crypto;
}
function getDefaultFetch() {
  return globalThis.fetch?.bind(globalThis);
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
function arrayBufferToBase64(buf, adapter) {
  return bytesToBase64(new Uint8Array(buf), adapter);
}
function base64ToBytes(b64, adapter) {
  return getAdapter(adapter).decode(b64);
}

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

// src/utils/semver.ts
function parseSemverMajorMinor(version) {
  const parts = String(version || "").split(".").map((p) => Number(p));
  const major = Number.isFinite(parts[0]) ? parts[0] : 0;
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0;
  return { major, minor };
}

// src/utils/filename.ts
function validatePlainFilename(filename) {
  if (typeof filename !== "string" || filename.trim().length === 0) {
    throw new DropgateValidationError(
      "Invalid filename. Must be a non-empty string."
    );
  }
  if (filename.length > 255 || /[\/\\]/.test(filename)) {
    throw new DropgateValidationError(
      "Invalid filename. Contains illegal characters or is too long."
    );
  }
}

// src/utils/network.ts
function parseServerUrl(urlStr) {
  let normalized = urlStr.trim();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }
  const url = new URL(normalized);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : void 0,
    secure: url.protocol === "https:"
  };
}
function buildBaseUrl(opts) {
  const { host, port, secure } = opts;
  if (!host || typeof host !== "string") {
    throw new DropgateValidationError("Server host is required.");
  }
  const protocol = secure === false ? "http" : "https";
  const portSuffix = port ? `:${port}` : "";
  return `${protocol}://${host}${portSuffix}`;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason || new DropgateAbortError());
    }
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(signal.reason || new DropgateAbortError());
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
      abort(new DropgateTimeoutError());
    }, timeoutMs);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}
async function fetchJson(fetchFn, url, opts = {}) {
  const { timeoutMs, signal, ...rest } = opts;
  const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);
  try {
    const res = await fetchFn(url, { ...rest, signal: s });
    const text = await res.text();
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
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen / 4294967296 >>> 0, false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
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
      W[i] = view.getUint32(offset + i * 4, false);
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

// src/crypto/decrypt.ts
async function importKeyFromBase64(cryptoObj, keyB64, base64) {
  const adapter = base64 || getDefaultBase64();
  const keyBytes = adapter.decode(keyB64);
  const keyBuffer = new Uint8Array(keyBytes).buffer;
  return cryptoObj.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    true,
    ["decrypt"]
  );
}
async function decryptChunk(cryptoObj, encryptedData, key) {
  const iv = encryptedData.slice(0, AES_GCM_IV_BYTES);
  const ciphertext = encryptedData.slice(AES_GCM_IV_BYTES);
  return cryptoObj.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
}
async function decryptFilenameFromBase64(cryptoObj, encryptedFilenameB64, key, base64) {
  const adapter = base64 || getDefaultBase64();
  const encryptedBytes = adapter.decode(encryptedFilenameB64);
  const decryptedBuffer = await decryptChunk(cryptoObj, encryptedBytes, key);
  return new TextDecoder().decode(decryptedBuffer);
}

// src/crypto/index.ts
function digestToHex(hashBuffer) {
  const arr = new Uint8Array(hashBuffer);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
}
async function sha256Hex(cryptoObj, data) {
  if (cryptoObj?.subtle) {
    const hashBuffer = await cryptoObj.subtle.digest("SHA-256", data);
    return digestToHex(hashBuffer);
  }
  return digestToHex(sha256Fallback(data));
}
async function generateAesGcmKey(cryptoObj) {
  return cryptoObj.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}
async function exportKeyBase64(cryptoObj, key) {
  const raw = await cryptoObj.subtle.exportKey("raw", key);
  return arrayBufferToBase64(raw);
}

// src/crypto/encrypt.ts
async function encryptToBlob(cryptoObj, dataBuffer, key) {
  const iv = cryptoObj.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const encrypted = await cryptoObj.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    dataBuffer
  );
  return new Blob([iv, new Uint8Array(encrypted)]);
}
async function encryptFilenameToBase64(cryptoObj, filename, key) {
  const bytes = new TextEncoder().encode(String(filename));
  const blob = await encryptToBlob(cryptoObj, bytes.buffer, key);
  const buf = await blob.arrayBuffer();
  return arrayBufferToBase64(buf);
}

// node_modules/fflate/esm/browser.js
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i = 0; i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  var r = new i32(b[30]);
  for (var i = 1; i < 30; ++i) {
    for (var j = b[i]; j < b[i + 1]; ++j) {
      r[j] = j - b[i] << 5 | i;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var et = /* @__PURE__ */ new u8(0);
var crct = /* @__PURE__ */ (function() {
  var t = new Int32Array(256);
  for (var i = 0; i < 256; ++i) {
    var c = i, k = 9;
    while (--k)
      c = (c & 1 && -306674912) ^ c >>> 1;
    t[i] = c;
  }
  return t;
})();
var crc = function() {
  var c = -1;
  return {
    p: function(d) {
      var cr = c;
      for (var i = 0; i < d.length; ++i)
        cr = crct[cr & 255 ^ d[i]] ^ cr >>> 8;
      c = cr;
    },
    d: function() {
      return ~c;
    }
  };
};
var mrg = function(a, b) {
  var o = {};
  for (var k in a)
    o[k] = a[k];
  for (var k in b)
    o[k] = b[k];
  return o;
};
var wbytes = function(d, b, v) {
  for (; v; ++b)
    d[b] = v, v >>>= 8;
};
var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder();
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}
function strToU8(str, latin1) {
  if (latin1) {
    var ar_1 = new u8(str.length);
    for (var i = 0; i < str.length; ++i)
      ar_1[i] = str.charCodeAt(i);
    return ar_1;
  }
  if (te)
    return te.encode(str);
  var l = str.length;
  var ar = new u8(str.length + (str.length >> 1));
  var ai = 0;
  var w = function(v) {
    ar[ai++] = v;
  };
  for (var i = 0; i < l; ++i) {
    if (ai + 5 > ar.length) {
      var n = new u8(ai + 8 + (l - i << 1));
      n.set(ar);
      ar = n;
    }
    var c = str.charCodeAt(i);
    if (c < 128 || latin1)
      w(c);
    else if (c < 2048)
      w(192 | c >> 6), w(128 | c & 63);
    else if (c > 55295 && c < 57344)
      c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
    else
      w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
  }
  return slc(ar, 0, ai);
}
var exfl = function(ex) {
  var le = 0;
  if (ex) {
    for (var k in ex) {
      var l = ex[k].length;
      if (l > 65535)
        err(9);
      le += l + 4;
    }
  }
  return le;
};
var wzh = function(d, b, f, fn, u, c, ce, co) {
  var fl2 = fn.length, ex = f.extra, col = co && co.length;
  var exl = exfl(ex);
  wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
  if (ce != null)
    d[b++] = 20, d[b++] = f.os;
  d[b] = 20, b += 2;
  d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
  d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
  var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119)
    err(10);
  wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
  if (c != -1) {
    wbytes(d, b, f.crc);
    wbytes(d, b + 4, c < 0 ? -c - 2 : c);
    wbytes(d, b + 8, f.size);
  }
  wbytes(d, b + 12, fl2);
  wbytes(d, b + 14, exl), b += 16;
  if (ce != null) {
    wbytes(d, b, col);
    wbytes(d, b + 6, f.attrs);
    wbytes(d, b + 10, ce), b += 14;
  }
  d.set(fn, b);
  b += fl2;
  if (exl) {
    for (var k in ex) {
      var exf = ex[k], l = exf.length;
      wbytes(d, b, +k);
      wbytes(d, b + 2, l);
      d.set(exf, b + 4), b += 4 + l;
    }
  }
  if (col)
    d.set(co, b), b += col;
  return b;
};
var wzf = function(o, b, c, d, e) {
  wbytes(o, b, 101010256);
  wbytes(o, b + 8, c);
  wbytes(o, b + 10, c);
  wbytes(o, b + 12, d);
  wbytes(o, b + 16, e);
};
var ZipPassThrough = /* @__PURE__ */ (function() {
  function ZipPassThrough2(filename) {
    this.filename = filename;
    this.c = crc();
    this.size = 0;
    this.compression = 0;
  }
  ZipPassThrough2.prototype.process = function(chunk, final) {
    this.ondata(null, chunk, final);
  };
  ZipPassThrough2.prototype.push = function(chunk, final) {
    if (!this.ondata)
      err(5);
    this.c.p(chunk);
    this.size += chunk.length;
    if (final)
      this.crc = this.c.d();
    this.process(chunk, final || false);
  };
  return ZipPassThrough2;
})();
var Zip = /* @__PURE__ */ (function() {
  function Zip2(cb) {
    this.ondata = cb;
    this.u = [];
    this.d = 1;
  }
  Zip2.prototype.add = function(file) {
    var _this = this;
    if (!this.ondata)
      err(5);
    if (this.d & 2)
      this.ondata(err(4 + (this.d & 1) * 8, 0, 1), null, false);
    else {
      var f = strToU8(file.filename), fl_1 = f.length;
      var com = file.comment, o = com && strToU8(com);
      var u = fl_1 != file.filename.length || o && com.length != o.length;
      var hl_1 = fl_1 + exfl(file.extra) + 30;
      if (fl_1 > 65535)
        this.ondata(err(11, 0, 1), null, false);
      var header = new u8(hl_1);
      wzh(header, 0, file, f, u, -1);
      var chks_1 = [header];
      var pAll_1 = function() {
        for (var _i = 0, chks_2 = chks_1; _i < chks_2.length; _i++) {
          var chk = chks_2[_i];
          _this.ondata(null, chk, false);
        }
        chks_1 = [];
      };
      var tr_1 = this.d;
      this.d = 0;
      var ind_1 = this.u.length;
      var uf_1 = mrg(file, {
        f,
        u,
        o,
        t: function() {
          if (file.terminate)
            file.terminate();
        },
        r: function() {
          pAll_1();
          if (tr_1) {
            var nxt = _this.u[ind_1 + 1];
            if (nxt)
              nxt.r();
            else
              _this.d = 1;
          }
          tr_1 = 1;
        }
      });
      var cl_1 = 0;
      file.ondata = function(err2, dat, final) {
        if (err2) {
          _this.ondata(err2, dat, final);
          _this.terminate();
        } else {
          cl_1 += dat.length;
          chks_1.push(dat);
          if (final) {
            var dd = new u8(16);
            wbytes(dd, 0, 134695760);
            wbytes(dd, 4, file.crc);
            wbytes(dd, 8, cl_1);
            wbytes(dd, 12, file.size);
            chks_1.push(dd);
            uf_1.c = cl_1, uf_1.b = hl_1 + cl_1 + 16, uf_1.crc = file.crc, uf_1.size = file.size;
            if (tr_1)
              uf_1.r();
            tr_1 = 1;
          } else if (tr_1)
            pAll_1();
        }
      };
      this.u.push(uf_1);
    }
  };
  Zip2.prototype.end = function() {
    var _this = this;
    if (this.d & 2) {
      this.ondata(err(4 + (this.d & 1) * 8, 0, 1), null, true);
      return;
    }
    if (this.d)
      this.e();
    else
      this.u.push({
        r: function() {
          if (!(_this.d & 1))
            return;
          _this.u.splice(-1, 1);
          _this.e();
        },
        t: function() {
        }
      });
    this.d = 3;
  };
  Zip2.prototype.e = function() {
    var bt = 0, l = 0, tl = 0;
    for (var _i = 0, _a2 = this.u; _i < _a2.length; _i++) {
      var f = _a2[_i];
      tl += 46 + f.f.length + exfl(f.extra) + (f.o ? f.o.length : 0);
    }
    var out = new u8(tl + 22);
    for (var _b2 = 0, _c = this.u; _b2 < _c.length; _b2++) {
      var f = _c[_b2];
      wzh(out, bt, f, f.f, f.u, -f.c - 2, l, f.o);
      bt += 46 + f.f.length + exfl(f.extra) + (f.o ? f.o.length : 0), l += f.b;
    }
    wzf(out, bt, this.u.length, tl, l);
    this.ondata(null, out, true);
    this.d = 2;
  };
  Zip2.prototype.terminate = function() {
    for (var _i = 0, _a2 = this.u; _i < _a2.length; _i++) {
      var f = _a2[_i];
      f.t();
    }
    this.d = 2;
  };
  return Zip2;
})();

// src/zip/stream-zip.ts
var StreamingZipWriter = class {
  constructor(onData) {
    __publicField(this, "zip");
    __publicField(this, "currentFile", null);
    __publicField(this, "onData");
    __publicField(this, "finalized", false);
    __publicField(this, "pendingWrites", Promise.resolve());
    this.onData = onData;
    this.zip = new Zip((err2, data, _final) => {
      if (err2) throw err2;
      this.pendingWrites = this.pendingWrites.then(() => this.onData(data));
    });
  }
  /**
   * Begin a new file entry in the ZIP.
   * Must call endFile() before starting another file.
   * @param name - Filename within the ZIP archive.
   */
  startFile(name) {
    if (this.currentFile) {
      throw new Error("Must call endFile() before starting a new file.");
    }
    if (this.finalized) {
      throw new Error("ZIP has already been finalized.");
    }
    const entry = new ZipPassThrough(name);
    this.zip.add(entry);
    this.currentFile = entry;
  }
  /**
   * Write a chunk of data to the current file entry.
   * @param data - The data chunk to write.
   */
  writeChunk(data) {
    if (!this.currentFile) {
      throw new Error("No file started. Call startFile() first.");
    }
    this.currentFile.push(data, false);
  }
  /**
   * End the current file entry.
   */
  endFile() {
    if (!this.currentFile) {
      throw new Error("No file to end.");
    }
    this.currentFile.push(new Uint8Array(0), true);
    this.currentFile = null;
  }
  /**
   * Finalize the ZIP archive. Must be called after all files are written.
   * Waits for all pending async writes to complete before resolving.
   */
  async finalize() {
    if (this.currentFile) {
      throw new Error("Cannot finalize with an open file. Call endFile() first.");
    }
    if (this.finalized) return;
    this.finalized = true;
    this.zip.end();
    await this.pendingWrites;
  }
};

// src/p2p/utils.ts
function isLocalhostHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
function isSecureContextForP2P(hostname, isSecureContext) {
  return Boolean(isSecureContext) || isLocalhostHostname(hostname || "");
}
function generateP2PCode(cryptoObj) {
  const crypto2 = cryptoObj || getDefaultCrypto();
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  if (crypto2) {
    const randomBytes = new Uint8Array(8);
    crypto2.getRandomValues(randomBytes);
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
  let a = "";
  for (let i = 0; i < 4; i++) {
    a += letters[Math.floor(Math.random() * letters.length)];
  }
  let b = "";
  for (let i = 0; i < 4; i++) {
    b += Math.floor(Math.random() * 10);
  }
  return `${a}-${b}`;
}
function isP2PCodeLike(code) {
  return /^[A-Z]{4}-\d{4}$/.test(String(code || "").trim());
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
        instance.on("error", (err2) => {
          try {
            instance.destroy();
          } catch {
          }
          reject(err2);
        });
      });
      return { peer, code: nextCode };
    } catch (err2) {
      lastError = err2;
      nextCode = codeGenerator();
    }
  }
  throw lastError || new DropgateNetworkError("Could not establish PeerJS connection.");
}

// src/p2p/protocol.ts
var P2P_PROTOCOL_VERSION = 3;
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
var P2P_MAX_UNACKED_CHUNKS = 32;
var P2P_END_ACK_TIMEOUT_MS = 15e3;
var P2P_END_ACK_RETRIES = 3;
var P2P_END_ACK_RETRY_DELAY_MS = 100;
var P2P_CLOSE_GRACE_PERIOD_MS = 2e3;

// src/p2p/send.ts
var P2P_UNACKED_CHUNK_TIMEOUT_MS = 3e4;
function generateSessionId() {
  return crypto.randomUUID();
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
    cryptoObj,
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
    throw new DropgateValidationError("At least one file is required.");
  }
  if (!Peer) {
    throw new DropgateValidationError(
      "PeerJS Peer constructor is required. Install peerjs and pass it as the Peer option."
    );
  }
  const p2pCaps = serverInfo?.capabilities?.p2p;
  if (serverInfo && !p2pCaps?.enabled) {
    throw new DropgateValidationError("Direct transfer is disabled on this server.");
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
  const finalCodeGenerator = codeGenerator || (() => generateP2PCode(cryptoObj));
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
  const safeError = (err2) => {
    if (state === "closed" || state === "completed" || state === "cancelled") return;
    transitionTo("closed");
    onError?.(err2);
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
            throw new DropgateNetworkError("Receiver stopped acknowledging chunks");
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
        throw new DropgateNetworkError("Connection closed during completion.");
      }
    }
    throw new DropgateNetworkError("Receiver did not confirm completion after retries.");
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
          safeError(new DropgateNetworkError(msg.message || "Receiver reported an error."));
          break;
        case "cancelled":
          if (state === "cancelled" || state === "closed" || state === "completed") return;
          transitionTo("cancelled");
          onCancel?.({ cancelledBy: "receiver", message: msg.reason });
          cleanup();
          break;
      }
    });
    conn.on("open", async () => {
      try {
        if (isStopped()) return;
        startHealthMonitoring(conn);
        conn.send({
          t: "hello",
          protocolVersion: P2P_PROTOCOL_VERSION,
          sessionId
        });
        const receiverVersion = await Promise.race([
          helloPromise,
          sleep(1e4).then(() => null)
        ]);
        if (isStopped()) return;
        if (receiverVersion === null) {
          throw new DropgateNetworkError("Receiver did not respond to handshake.");
        } else if (receiverVersion !== P2P_PROTOCOL_VERSION) {
          throw new DropgateNetworkError(
            `Protocol version mismatch: sender v${P2P_PROTOCOL_VERSION}, receiver v${receiverVersion}`
          );
        }
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
              throw new DropgateNetworkError(`Receiver did not confirm receipt of file ${fi + 1}/${files.length}.`);
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
          throw new DropgateNetworkError("Receiver reported an incomplete transfer.");
        }
        reportProgress({ received: ackReceived || ackTotal, total: ackTotal });
        safeComplete();
      } catch (err2) {
        safeError(err2);
      }
    });
    conn.on("error", (err2) => {
      safeError(err2);
    });
    conn.on("close", () => {
      if (state === "closed" || state === "completed" || state === "cancelled") {
        cleanup();
        return;
      }
      if (state === "awaiting_ack") {
        setTimeout(() => {
          if (state === "awaiting_ack") {
            safeError(new DropgateNetworkError("Connection closed while awaiting confirmation."));
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
    watchdogTimeoutMs = 15e3,
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
    throw new DropgateValidationError("No sharing code was provided.");
  }
  if (!Peer) {
    throw new DropgateValidationError(
      "PeerJS Peer constructor is required. Install peerjs and pass it as the Peer option."
    );
  }
  const p2pCaps = serverInfo?.capabilities?.p2p;
  if (serverInfo && !p2pCaps?.enabled) {
    throw new DropgateValidationError("Direct transfer is disabled on this server.");
  }
  const normalizedCode = String(code).trim().replace(/\s+/g, "").toUpperCase();
  if (!isP2PCodeLike(normalizedCode)) {
    throw new DropgateValidationError("Invalid direct transfer code.");
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
        safeError(new DropgateNetworkError("Connection timed out (no data received)."));
      }
    }, watchdogTimeoutMs);
  };
  const clearWatchdog = () => {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };
  const safeError = (err2) => {
    if (state === "closed" || state === "completed" || state === "cancelled") return;
    transitionTo("closed");
    onError?.(err2);
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
  peer.on("error", (err2) => {
    safeError(err2);
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
      try {
        if (data instanceof ArrayBuffer || ArrayBuffer.isView(data) || typeof Blob !== "undefined" && data instanceof Blob) {
          if (state !== "transferring") {
            throw new DropgateValidationError(
              "Received binary data before transfer was accepted. Possible malicious sender."
            );
          }
          resetWatchdog();
          if (writeQueueDepth >= MAX_WRITE_QUEUE_DEPTH) {
            throw new DropgateNetworkError("Write queue overflow - receiver cannot keep up");
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
              throw new DropgateValidationError(
                `Chunk size mismatch: expected ${expectedSize}, got ${buf.byteLength}`
              );
            }
            const newReceived = received + buf.byteLength;
            if (total > 0 && newReceived > total) {
              throw new DropgateValidationError(
                `Received more data than expected: ${newReceived} > ${total}`
              );
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
          }).catch((err2) => {
            try {
              conn.send({
                t: "error",
                message: err2?.message || "Receiver write failed."
              });
            } catch {
            }
            safeError(err2);
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
              throw new DropgateValidationError(`Too many files: ${fileListMsg.fileCount}`);
            }
            const sumSize = fileListMsg.files.reduce((sum, f) => sum + f.size, 0);
            if (sumSize !== fileListMsg.totalSize) {
              throw new DropgateValidationError(
                `File list size mismatch: declared ${fileListMsg.totalSize}, actual sum ${sumSize}`
              );
            }
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
              throw new DropgateValidationError(
                "Received chunk message before transfer was accepted."
              );
            }
            if (chunkMsg.seq !== expectedChunkSeq) {
              throw new DropgateValidationError(
                `Chunk sequence error: expected ${expectedChunkSeq}, got ${chunkMsg.seq}`
              );
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
              const err2 = new DropgateNetworkError(
                "Transfer ended before all data was received."
              );
              try {
                conn.send({ t: "error", message: err2.message });
              } catch {
              }
              throw err2;
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
            throw new DropgateNetworkError(msg.message || "Sender reported an error.");
          case "cancelled":
            if (state === "cancelled" || state === "closed" || state === "completed") return;
            transitionTo("cancelled");
            onCancel?.({ cancelledBy: "sender", message: msg.reason });
            cleanup();
            break;
        }
      } catch (err2) {
        safeError(err2);
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
        safeError(new DropgateNetworkError("Sender disconnected before file details were received."));
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
async function getServerInfo(opts) {
  const { server, timeoutMs = 5e3, signal, fetchFn: customFetch } = opts;
  const fetchFn = customFetch || getDefaultFetch();
  if (!fetchFn) {
    throw new DropgateValidationError("No fetch() implementation found.");
  }
  const baseUrl = resolveServerToBaseUrl(server);
  try {
    const { res, json } = await fetchJson(
      fetchFn,
      `${baseUrl}/api/info`,
      {
        method: "GET",
        timeoutMs,
        signal,
        headers: { Accept: "application/json" }
      }
    );
    if (res.ok && json && typeof json === "object" && "version" in json) {
      return { baseUrl, serverInfo: json };
    }
    throw new DropgateProtocolError(
      `Server info request failed (status ${res.status}).`
    );
  } catch (err2) {
    if (err2 instanceof DropgateError) throw err2;
    throw new DropgateNetworkError("Could not reach server /api/info.", {
      cause: err2
    });
  }
}
var DropgateClient = class {
  /**
   * Create a new DropgateClient instance.
   * @param opts - Client configuration options including server URL.
   * @throws {DropgateValidationError} If clientVersion or server is missing or invalid.
   */
  constructor(opts) {
    /** Client version string for compatibility checking. */
    __publicField(this, "clientVersion");
    /** Chunk size in bytes for upload splitting. */
    __publicField(this, "chunkSize");
    /** Fetch implementation used for HTTP requests. */
    __publicField(this, "fetchFn");
    /** Crypto implementation for encryption operations. */
    __publicField(this, "cryptoObj");
    /** Base64 encoder/decoder for binary data. */
    __publicField(this, "base64");
    /** Resolved base URL (e.g. 'https://dropgate.link'). May change during HTTP fallback. */
    __publicField(this, "baseUrl");
    /** Whether to automatically retry with HTTP when HTTPS fails. */
    __publicField(this, "_fallbackToHttp");
    /** Cached compatibility result (null until first connect()). */
    __publicField(this, "_compat", null);
    /** In-flight connect promise to deduplicate concurrent calls. */
    __publicField(this, "_connectPromise", null);
    if (!opts || typeof opts.clientVersion !== "string") {
      throw new DropgateValidationError(
        "DropgateClient requires clientVersion (string)."
      );
    }
    if (!opts.server) {
      throw new DropgateValidationError(
        "DropgateClient requires server (URL string or ServerTarget object)."
      );
    }
    this.clientVersion = opts.clientVersion;
    this.chunkSize = Number.isFinite(opts.chunkSize) ? opts.chunkSize : DEFAULT_CHUNK_SIZE;
    const fetchFn = opts.fetchFn || getDefaultFetch();
    if (!fetchFn) {
      throw new DropgateValidationError("No fetch() implementation found.");
    }
    this.fetchFn = fetchFn;
    const cryptoObj = opts.cryptoObj || getDefaultCrypto();
    if (!cryptoObj) {
      throw new DropgateValidationError("No crypto implementation found.");
    }
    this.cryptoObj = cryptoObj;
    this.base64 = opts.base64 || getDefaultBase64();
    this._fallbackToHttp = Boolean(opts.fallbackToHttp);
    this.baseUrl = resolveServerToBaseUrl(opts.server);
  }
  /**
   * Get the server target (host, port, secure) derived from the current baseUrl.
   * Useful for passing to standalone functions that still need a ServerTarget.
   */
  get serverTarget() {
    const url = new URL(this.baseUrl);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : void 0,
      secure: url.protocol === "https:"
    };
  }
  /**
   * Connect to the server: fetch server info and check version compatibility.
   * Results are cached — subsequent calls return instantly without network requests.
   * Concurrent calls are deduplicated.
   *
   * @param opts - Optional timeout and abort signal.
   * @returns Compatibility result with server info.
   * @throws {DropgateNetworkError} If the server cannot be reached.
   * @throws {DropgateProtocolError} If the server returns an invalid response.
   */
  async connect(opts) {
    if (this._compat) return this._compat;
    if (!this._connectPromise) {
      this._connectPromise = this._fetchAndCheckCompat(opts).finally(() => {
        this._connectPromise = null;
      });
    }
    return this._connectPromise;
  }
  async _fetchAndCheckCompat(opts) {
    const { timeoutMs = 5e3, signal } = opts ?? {};
    let baseUrl = this.baseUrl;
    let serverInfo;
    try {
      const result = await getServerInfo({
        server: baseUrl,
        timeoutMs,
        signal,
        fetchFn: this.fetchFn
      });
      baseUrl = result.baseUrl;
      serverInfo = result.serverInfo;
    } catch (err2) {
      if (this._fallbackToHttp && this.baseUrl.startsWith("https://")) {
        const httpBaseUrl = this.baseUrl.replace("https://", "http://");
        try {
          const result = await getServerInfo({
            server: httpBaseUrl,
            timeoutMs,
            signal,
            fetchFn: this.fetchFn
          });
          this.baseUrl = httpBaseUrl;
          baseUrl = result.baseUrl;
          serverInfo = result.serverInfo;
        } catch {
          if (err2 instanceof DropgateError) throw err2;
          throw new DropgateNetworkError("Could not connect to the server.", { cause: err2 });
        }
      } else {
        if (err2 instanceof DropgateError) throw err2;
        throw new DropgateNetworkError("Could not connect to the server.", { cause: err2 });
      }
    }
    const compat = this._checkVersionCompat(serverInfo);
    this._compat = { ...compat, serverInfo, baseUrl };
    return this._compat;
  }
  /**
   * Pure version compatibility check (no network calls).
   */
  _checkVersionCompat(serverInfo) {
    const serverVersion = String(serverInfo?.version || "0.0.0");
    const clientVersion = String(this.clientVersion || "0.0.0");
    const c = parseSemverMajorMinor(clientVersion);
    const s = parseSemverMajorMinor(serverVersion);
    if (c.major !== s.major) {
      return {
        compatible: false,
        clientVersion,
        serverVersion,
        message: `Incompatible versions. Client v${clientVersion}, Server v${serverVersion}${serverInfo?.name ? ` (${serverInfo.name})` : ""}.`
      };
    }
    if (c.minor > s.minor) {
      return {
        compatible: true,
        clientVersion,
        serverVersion,
        message: `Client (v${clientVersion}) is newer than Server (v${serverVersion})${serverInfo?.name ? ` (${serverInfo.name})` : ""}. Some features may not work.`
      };
    }
    return {
      compatible: true,
      clientVersion,
      serverVersion,
      message: `Server: v${serverVersion}, Client: v${clientVersion}${serverInfo?.name ? ` (${serverInfo.name})` : ""}.`
    };
  }
  /**
   * Resolve a user-entered sharing code or URL via the server.
   * @param value - The sharing code or URL to resolve.
   * @param opts - Optional timeout and abort signal.
   * @returns The resolved share target information.
   * @throws {DropgateProtocolError} If the share lookup fails.
   */
  async resolveShareTarget(value, opts) {
    const { timeoutMs = 5e3, signal } = opts ?? {};
    const compat = await this.connect(opts);
    if (!compat.compatible) {
      throw new DropgateValidationError(compat.message);
    }
    const { baseUrl } = compat;
    const { res, json } = await fetchJson(
      this.fetchFn,
      `${baseUrl}/api/resolve`,
      {
        method: "POST",
        timeoutMs,
        signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ value })
      }
    );
    if (!res.ok) {
      const msg = (json && typeof json === "object" && "error" in json ? json.error : null) || `Share lookup failed (status ${res.status}).`;
      throw new DropgateProtocolError(msg, { details: json });
    }
    return json || { valid: false, reason: "Unknown response." };
  }
  /**
   * Fetch metadata for a single file from the server.
   * @param fileId - The file ID to fetch metadata for.
   * @param opts - Optional connection options (timeout, signal).
   * @returns File metadata including size, filename, and encryption status.
   * @throws {DropgateNetworkError} If the server cannot be reached.
   * @throws {DropgateProtocolError} If the file is not found or server returns an error.
   */
  async getFileMetadata(fileId, opts) {
    if (!fileId || typeof fileId !== "string") {
      throw new DropgateValidationError("File ID is required.");
    }
    const { timeoutMs = 5e3, signal } = opts ?? {};
    const url = `${this.baseUrl}/api/file/${encodeURIComponent(fileId)}/meta`;
    const { res, json } = await fetchJson(this.fetchFn, url, {
      method: "GET",
      timeoutMs,
      signal
    });
    if (!res.ok) {
      const msg = (json && typeof json === "object" && "error" in json ? json.error : null) || `Failed to fetch file metadata (status ${res.status}).`;
      throw new DropgateProtocolError(msg, { details: json });
    }
    return json;
  }
  /**
   * Fetch metadata for a bundle from the server and derive computed fields.
   * For sealed bundles, decrypts the manifest to extract file list.
   * Automatically derives totalSizeBytes and fileCount from the files array.
   * @param bundleId - The bundle ID to fetch metadata for.
   * @param keyB64 - Base64-encoded decryption key (required for encrypted bundles).
   * @param opts - Optional connection options (timeout, signal).
   * @returns Complete bundle metadata with all files and computed fields.
   * @throws {DropgateNetworkError} If the server cannot be reached.
   * @throws {DropgateProtocolError} If the bundle is not found or server returns an error.
   * @throws {DropgateValidationError} If decryption key is missing for encrypted bundle.
   */
  async getBundleMetadata(bundleId, keyB64, opts) {
    if (!bundleId || typeof bundleId !== "string") {
      throw new DropgateValidationError("Bundle ID is required.");
    }
    const { timeoutMs = 5e3, signal } = opts ?? {};
    const url = `${this.baseUrl}/api/bundle/${encodeURIComponent(bundleId)}/meta`;
    const { res, json } = await fetchJson(this.fetchFn, url, {
      method: "GET",
      timeoutMs,
      signal
    });
    if (!res.ok) {
      const msg = (json && typeof json === "object" && "error" in json ? json.error : null) || `Failed to fetch bundle metadata (status ${res.status}).`;
      throw new DropgateProtocolError(msg, { details: json });
    }
    const serverMeta = json;
    let files = [];
    if (serverMeta.sealed && serverMeta.encryptedManifest) {
      if (!keyB64) {
        throw new DropgateValidationError(
          "Decryption key (keyB64) is required for encrypted sealed bundles."
        );
      }
      const key = await importKeyFromBase64(this.cryptoObj, keyB64);
      const encryptedBytes = this.base64.decode(serverMeta.encryptedManifest);
      const decryptedBuffer = await decryptChunk(this.cryptoObj, encryptedBytes, key);
      const manifestJson = new TextDecoder().decode(decryptedBuffer);
      const manifest = JSON.parse(manifestJson);
      files = manifest.files.map((f) => ({
        fileId: f.fileId,
        sizeBytes: f.sizeBytes,
        filename: f.name
      }));
    } else if (serverMeta.files) {
      files = serverMeta.files;
      if (serverMeta.isEncrypted) {
        const encryptedChunkSize = this.chunkSize + ENCRYPTION_OVERHEAD_PER_CHUNK;
        for (const f of files) {
          if (f.sizeBytes > 0) {
            const numChunks = Math.ceil(f.sizeBytes / encryptedChunkSize);
            f.sizeBytes = f.sizeBytes - numChunks * ENCRYPTION_OVERHEAD_PER_CHUNK;
          }
        }
      }
    } else {
      throw new DropgateProtocolError("Invalid bundle metadata: missing files or manifest.");
    }
    const totalSizeBytes = files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
    const fileCount = files.length;
    return {
      isEncrypted: serverMeta.isEncrypted,
      sealed: serverMeta.sealed,
      encryptedManifest: serverMeta.encryptedManifest,
      files,
      totalSizeBytes,
      fileCount
    };
  }
  /**
   * Validate file and upload settings against server capabilities.
   * @param opts - Validation options containing file, settings, and server info.
   * @returns True if validation passes.
   * @throws {DropgateValidationError} If any validation check fails.
   */
  validateUploadInputs(opts) {
    const { files: rawFiles, lifetimeMs, encrypt, serverInfo } = opts;
    const caps = serverInfo?.capabilities?.upload;
    if (!caps || !caps.enabled) {
      throw new DropgateValidationError("Server does not support file uploads.");
    }
    const files = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
    if (files.length === 0) {
      throw new DropgateValidationError("At least one file is required.");
    }
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileSize = Number(file?.size || 0);
      if (!file || !Number.isFinite(fileSize) || fileSize <= 0) {
        throw new DropgateValidationError(`File at index ${i} is missing or invalid.`);
      }
      const maxMB = Number(caps.maxSizeMB);
      if (Number.isFinite(maxMB) && maxMB > 0) {
        const limitBytes = maxMB * 1e3 * 1e3;
        const validationChunkSize = Number.isFinite(caps.chunkSize) && caps.chunkSize > 0 ? caps.chunkSize : this.chunkSize;
        const totalChunks = Math.ceil(fileSize / validationChunkSize);
        const estimatedBytes = estimateTotalUploadSizeBytes(
          fileSize,
          totalChunks,
          Boolean(encrypt)
        );
        if (estimatedBytes > limitBytes) {
          const msg = encrypt ? `File at index ${i} too large once encryption overhead is included. Server limit: ${maxMB} MB.` : `File at index ${i} too large. Server limit: ${maxMB} MB.`;
          throw new DropgateValidationError(msg);
        }
      }
    }
    const maxHours = Number(caps.maxLifetimeHours);
    const lt = Number(lifetimeMs);
    if (!Number.isFinite(lt) || lt < 0 || !Number.isInteger(lt)) {
      throw new DropgateValidationError(
        "Invalid lifetime. Must be a non-negative integer (milliseconds)."
      );
    }
    if (Number.isFinite(maxHours) && maxHours > 0) {
      const limitMs = Math.round(maxHours * 60 * 60 * 1e3);
      if (lt === 0) {
        throw new DropgateValidationError(
          `Server does not allow unlimited file lifetime. Max: ${maxHours} hours.`
        );
      }
      if (lt > limitMs) {
        throw new DropgateValidationError(
          `File lifetime too long. Server limit: ${maxHours} hours.`
        );
      }
    }
    if (encrypt && !caps.e2ee) {
      throw new DropgateValidationError(
        "End-to-end encryption is not supported on this server."
      );
    }
    return true;
  }
  /**
   * Upload one or more files to the server with optional encryption.
   * Single files use the standard upload protocol.
   * Multiple files use the bundle protocol, grouping files under a single download link.
   *
   * @param opts - Upload options including file(s) and settings.
   * @returns Upload session with result promise and cancellation support.
   */
  async uploadFiles(opts) {
    const {
      files: rawFiles,
      lifetimeMs,
      encrypt,
      maxDownloads,
      filenameOverrides,
      onProgress,
      onCancel,
      signal,
      timeouts = {},
      retry = {}
    } = opts;
    const files = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
    if (files.length === 0) {
      throw new DropgateValidationError("At least one file is required.");
    }
    const internalController = signal ? null : new AbortController();
    const effectiveSignal = signal || internalController?.signal;
    let uploadState = "initializing";
    const currentUploadIds = [];
    const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);
    const uploadPromise = (async () => {
      try {
        const progress = (evt) => {
          try {
            if (onProgress) onProgress(evt);
          } catch {
          }
        };
        progress({ phase: "server-info", text: "Checking server...", percent: 0, processedBytes: 0, totalBytes: totalSizeBytes });
        const compat = await this.connect({
          timeoutMs: timeouts.serverInfoMs ?? 5e3,
          signal: effectiveSignal
        });
        const { baseUrl, serverInfo } = compat;
        progress({ phase: "server-compat", text: compat.message, percent: 0, processedBytes: 0, totalBytes: totalSizeBytes });
        if (!compat.compatible) {
          throw new DropgateValidationError(compat.message);
        }
        const filenames = files.map((f, i) => filenameOverrides?.[i] ?? f.name ?? "file");
        const serverSupportsE2EE = Boolean(serverInfo?.capabilities?.upload?.e2ee);
        const effectiveEncrypt = encrypt ?? serverSupportsE2EE;
        if (!effectiveEncrypt) {
          for (const name of filenames) validatePlainFilename(name);
        }
        this.validateUploadInputs({ files, lifetimeMs, encrypt: effectiveEncrypt, serverInfo });
        let cryptoKey = null;
        let keyB64 = null;
        const transmittedFilenames = [];
        if (effectiveEncrypt) {
          if (!this.cryptoObj?.subtle) {
            throw new DropgateValidationError(
              "Web Crypto API not available (crypto.subtle). Encryption requires a secure context (HTTPS or localhost)."
            );
          }
          progress({ phase: "crypto", text: "Generating encryption key...", percent: 0, processedBytes: 0, totalBytes: totalSizeBytes });
          try {
            cryptoKey = await generateAesGcmKey(this.cryptoObj);
            keyB64 = await exportKeyBase64(this.cryptoObj, cryptoKey);
            for (const name of filenames) {
              transmittedFilenames.push(
                await encryptFilenameToBase64(this.cryptoObj, name, cryptoKey)
              );
            }
          } catch (err2) {
            throw new DropgateError("Failed to prepare encryption.", { code: "CRYPTO_PREP_FAILED", cause: err2 });
          }
        } else {
          transmittedFilenames.push(...filenames);
        }
        const serverChunkSize = serverInfo?.capabilities?.upload?.chunkSize;
        const effectiveChunkSize = Number.isFinite(serverChunkSize) && serverChunkSize > 0 ? serverChunkSize : this.chunkSize;
        const retries = Number.isFinite(retry.retries) ? retry.retries : 5;
        const baseBackoffMs = Number.isFinite(retry.backoffMs) ? retry.backoffMs : 1e3;
        const maxBackoffMs = Number.isFinite(retry.maxBackoffMs) ? retry.maxBackoffMs : 3e4;
        if (files.length === 1) {
          const file = files[0];
          const totalChunks = Math.ceil(file.size / effectiveChunkSize);
          const totalUploadSize = estimateTotalUploadSizeBytes(file.size, totalChunks, effectiveEncrypt);
          progress({ phase: "init", text: "Reserving server storage...", percent: 0, processedBytes: 0, totalBytes: file.size });
          const initRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/init`, {
            method: "POST",
            timeoutMs: timeouts.initMs ?? 15e3,
            signal: effectiveSignal,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              filename: transmittedFilenames[0],
              lifetime: lifetimeMs,
              isEncrypted: effectiveEncrypt,
              totalSize: totalUploadSize,
              totalChunks,
              ...maxDownloads !== void 0 ? { maxDownloads } : {}
            })
          });
          if (!initRes.res.ok) {
            const errorJson = initRes.json;
            throw new DropgateProtocolError(errorJson?.error || `Server initialisation failed: ${initRes.res.status}`, { details: initRes.json || initRes.text });
          }
          const uploadId = initRes.json?.uploadId;
          if (!uploadId) throw new DropgateProtocolError("Server did not return a valid uploadId.");
          currentUploadIds.push(uploadId);
          uploadState = "uploading";
          await this._uploadFileChunks({
            file,
            uploadId,
            cryptoKey,
            effectiveChunkSize,
            totalChunks,
            totalUploadSize,
            baseOffset: 0,
            totalBytesAllFiles: file.size,
            progress,
            signal: effectiveSignal,
            baseUrl,
            retries,
            backoffMs: baseBackoffMs,
            maxBackoffMs,
            chunkTimeoutMs: timeouts.chunkMs ?? 6e4
          });
          progress({ phase: "complete", text: "Finalising upload...", percent: 100, processedBytes: file.size, totalBytes: file.size });
          uploadState = "completing";
          const completeRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/complete`, {
            method: "POST",
            timeoutMs: timeouts.completeMs ?? 3e4,
            signal: effectiveSignal,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ uploadId })
          });
          if (!completeRes.res.ok) {
            const errorJson = completeRes.json;
            throw new DropgateProtocolError(errorJson?.error || "Finalisation failed.", { details: completeRes.json || completeRes.text });
          }
          const fileId = completeRes.json?.id;
          if (!fileId) throw new DropgateProtocolError("Server did not return a valid file id.");
          let downloadUrl2 = `${baseUrl}/${fileId}`;
          if (effectiveEncrypt && keyB64) downloadUrl2 += `#${keyB64}`;
          progress({ phase: "done", text: "Upload successful!", percent: 100, processedBytes: file.size, totalBytes: file.size });
          uploadState = "completed";
          return {
            downloadUrl: downloadUrl2,
            fileId,
            uploadId,
            baseUrl,
            ...effectiveEncrypt && keyB64 ? { keyB64 } : {}
          };
        }
        const fileManifest = files.map((f, i) => {
          const totalChunks = Math.ceil(f.size / effectiveChunkSize);
          const totalUploadSize = estimateTotalUploadSizeBytes(f.size, totalChunks, effectiveEncrypt);
          return { filename: transmittedFilenames[i], totalSize: totalUploadSize, totalChunks };
        });
        progress({ phase: "init", text: `Reserving server storage for ${files.length} files...`, percent: 0, processedBytes: 0, totalBytes: totalSizeBytes, totalFiles: files.length });
        const initBundleRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/init-bundle`, {
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
          const errorJson = initBundleRes.json;
          throw new DropgateProtocolError(errorJson?.error || `Bundle initialisation failed: ${initBundleRes.res.status}`, { details: initBundleRes.json || initBundleRes.text });
        }
        const bundleInitJson = initBundleRes.json;
        const bundleUploadId = bundleInitJson?.bundleUploadId;
        const fileUploadIds = bundleInitJson?.fileUploadIds;
        if (!bundleUploadId || !fileUploadIds || fileUploadIds.length !== files.length) {
          throw new DropgateProtocolError("Server did not return valid bundle upload IDs.");
        }
        currentUploadIds.push(...fileUploadIds);
        uploadState = "uploading";
        const fileResults = [];
        let cumulativeBytes = 0;
        for (let fi = 0; fi < files.length; fi++) {
          const file = files[fi];
          const uploadId = fileUploadIds[fi];
          const totalChunks = fileManifest[fi].totalChunks;
          const totalUploadSize = fileManifest[fi].totalSize;
          progress({
            phase: "file-start",
            text: `Uploading file ${fi + 1} of ${files.length}: ${filenames[fi]}`,
            percent: totalSizeBytes > 0 ? cumulativeBytes / totalSizeBytes * 100 : 0,
            processedBytes: cumulativeBytes,
            totalBytes: totalSizeBytes,
            fileIndex: fi,
            totalFiles: files.length,
            currentFileName: filenames[fi]
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
            retries,
            backoffMs: baseBackoffMs,
            maxBackoffMs,
            chunkTimeoutMs: timeouts.chunkMs ?? 6e4,
            fileIndex: fi,
            totalFiles: files.length,
            currentFileName: filenames[fi]
          });
          const completeRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/complete`, {
            method: "POST",
            timeoutMs: timeouts.completeMs ?? 3e4,
            signal: effectiveSignal,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ uploadId })
          });
          if (!completeRes.res.ok) {
            const errorJson = completeRes.json;
            throw new DropgateProtocolError(errorJson?.error || `File ${fi + 1} finalisation failed.`, { details: completeRes.json || completeRes.text });
          }
          const fileId = completeRes.json?.id;
          if (!fileId) throw new DropgateProtocolError(`Server did not return a valid file id for file ${fi + 1}.`);
          fileResults.push({ fileId, name: filenames[fi], size: file.size });
          cumulativeBytes += file.size;
          progress({
            phase: "file-complete",
            text: `File ${fi + 1} of ${files.length} uploaded.`,
            percent: totalSizeBytes > 0 ? cumulativeBytes / totalSizeBytes * 100 : 0,
            processedBytes: cumulativeBytes,
            totalBytes: totalSizeBytes,
            fileIndex: fi,
            totalFiles: files.length,
            currentFileName: filenames[fi]
          });
        }
        progress({ phase: "complete", text: "Finalising bundle...", percent: 100, processedBytes: totalSizeBytes, totalBytes: totalSizeBytes });
        uploadState = "completing";
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
          const encryptedBlob = await encryptToBlob(this.cryptoObj, manifestBytes.buffer, cryptoKey);
          const encryptedBuffer = new Uint8Array(await encryptedBlob.arrayBuffer());
          encryptedManifestB64 = this.base64.encode(encryptedBuffer);
        }
        const completeBundleRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/complete-bundle`, {
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
          const errorJson = completeBundleRes.json;
          throw new DropgateProtocolError(errorJson?.error || "Bundle finalisation failed.", { details: completeBundleRes.json || completeBundleRes.text });
        }
        const bundleId = completeBundleRes.json?.bundleId;
        if (!bundleId) throw new DropgateProtocolError("Server did not return a valid bundle id.");
        let downloadUrl = `${baseUrl}/b/${bundleId}`;
        if (effectiveEncrypt && keyB64) downloadUrl += `#${keyB64}`;
        progress({ phase: "done", text: "Upload successful!", percent: 100, processedBytes: totalSizeBytes, totalBytes: totalSizeBytes });
        uploadState = "completed";
        return {
          downloadUrl,
          bundleId,
          baseUrl,
          files: fileResults,
          ...effectiveEncrypt && keyB64 ? { keyB64 } : {}
        };
      } catch (err2) {
        if (err2 instanceof Error && (err2.name === "AbortError" || err2.message?.includes("abort"))) {
          uploadState = "cancelled";
          onCancel?.();
        } else {
          uploadState = "error";
        }
        throw err2;
      }
    })();
    const callCancelEndpoint = async (uploadId) => {
      try {
        await fetchJson(this.fetchFn, `${this.baseUrl}/upload/cancel`, {
          method: "POST",
          timeoutMs: 5e3,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ uploadId })
        });
      } catch {
      }
    };
    return {
      result: uploadPromise,
      cancel: (reason) => {
        if (uploadState === "completed" || uploadState === "cancelled") return;
        uploadState = "cancelled";
        for (const id of currentUploadIds) {
          callCancelEndpoint(id).catch(() => {
          });
        }
        internalController?.abort(new DropgateAbortError(reason || "Upload cancelled by user."));
      },
      getStatus: () => uploadState
    };
  }
  /**
   * Upload a single file's chunks to the server. Used internally by uploadFiles().
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
      retries,
      backoffMs,
      maxBackoffMs,
      chunkTimeoutMs,
      fileIndex,
      totalFiles,
      currentFileName
    } = params;
    for (let i = 0; i < totalChunks; i++) {
      if (signal?.aborted) {
        throw signal.reason || new DropgateAbortError();
      }
      const start = i * effectiveChunkSize;
      const end = Math.min(start + effectiveChunkSize, file.size);
      const chunkSlice = file.slice(start, end);
      const processedBytes = baseOffset + start;
      const percent = totalBytesAllFiles > 0 ? processedBytes / totalBytesAllFiles * 100 : 0;
      progress({
        phase: "chunk",
        text: `Uploading chunk ${i + 1} of ${totalChunks}...`,
        percent,
        processedBytes,
        totalBytes: totalBytesAllFiles,
        chunkIndex: i,
        totalChunks,
        ...fileIndex !== void 0 ? { fileIndex, totalFiles, currentFileName } : {}
      });
      const chunkBuffer = await chunkSlice.arrayBuffer();
      let uploadBlob;
      if (cryptoKey) {
        uploadBlob = await encryptToBlob(this.cryptoObj, chunkBuffer, cryptoKey);
      } else {
        uploadBlob = new Blob([chunkBuffer]);
      }
      if (uploadBlob.size > effectiveChunkSize + 1024) {
        throw new DropgateValidationError("Chunk too large (client-side). Check chunk size settings.");
      }
      const toHash = await uploadBlob.arrayBuffer();
      const hashHex = await sha256Hex(this.cryptoObj, toHash);
      await this._attemptChunkUpload(
        `${baseUrl}/upload/chunk`,
        { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Upload-ID": uploadId, "X-Chunk-Index": String(i), "X-Chunk-Hash": hashHex }, body: uploadBlob },
        { retries, backoffMs, maxBackoffMs, timeoutMs: chunkTimeoutMs, signal, progress, chunkIndex: i, totalChunks, chunkSize: effectiveChunkSize, fileSizeBytes: totalBytesAllFiles }
      );
    }
  }
  /**
   * Download one or more files from the server with optional decryption.
   *
   * For single files, use `fileId`. For bundles, use `bundleId`.
   * With `asZip: true` on bundles, streams a ZIP archive via `onData`.
   * Without `asZip`, delivers files individually via `onFileStart`/`onFileData`/`onFileEnd`.
   *
   * @param opts - Download options including file/bundle ID and optional key.
   * @returns Download result containing filename(s) and received bytes.
   */
  async downloadFiles(opts) {
    const {
      fileId,
      bundleId,
      keyB64,
      asZip,
      zipFilename: _zipFilename,
      onProgress,
      onData,
      onFileStart,
      onFileData,
      onFileEnd,
      signal,
      timeoutMs = 6e4
    } = opts;
    const progress = (evt) => {
      try {
        if (onProgress) onProgress(evt);
      } catch {
      }
    };
    if (!fileId && !bundleId) {
      throw new DropgateValidationError("Either fileId or bundleId is required.");
    }
    progress({ phase: "server-info", text: "Checking server...", processedBytes: 0, totalBytes: 0, percent: 0 });
    const compat = await this.connect({ timeoutMs, signal });
    const { baseUrl } = compat;
    progress({ phase: "server-compat", text: compat.message, processedBytes: 0, totalBytes: 0, percent: 0 });
    if (!compat.compatible) throw new DropgateValidationError(compat.message);
    if (fileId) {
      return this._downloadSingleFile({ fileId, keyB64, onProgress, onData, signal, timeoutMs, baseUrl, compat });
    }
    progress({ phase: "metadata", text: "Fetching bundle info...", processedBytes: 0, totalBytes: 0, percent: 0 });
    let bundleMeta;
    try {
      bundleMeta = await this.getBundleMetadata(bundleId, keyB64, { timeoutMs, signal });
    } catch (err2) {
      if (err2 instanceof DropgateError) throw err2;
      if (err2 instanceof Error && err2.name === "AbortError") throw new DropgateAbortError("Download cancelled.");
      throw new DropgateNetworkError("Could not fetch bundle metadata.", { cause: err2 });
    }
    const isEncrypted = Boolean(bundleMeta.isEncrypted);
    const totalBytes = bundleMeta.totalSizeBytes || 0;
    let cryptoKey;
    const filenames = [];
    if (isEncrypted) {
      if (!keyB64) throw new DropgateValidationError("Decryption key is required for encrypted bundles.");
      if (!this.cryptoObj?.subtle) throw new DropgateValidationError("Web Crypto API not available for decryption.");
      try {
        cryptoKey = await importKeyFromBase64(this.cryptoObj, keyB64, this.base64);
        if (bundleMeta.sealed && bundleMeta.encryptedManifest) {
          const encryptedBytes = this.base64.decode(bundleMeta.encryptedManifest);
          const decryptedBuffer = await decryptChunk(this.cryptoObj, encryptedBytes, cryptoKey);
          const manifestJson = new TextDecoder().decode(decryptedBuffer);
          const manifest = JSON.parse(manifestJson);
          bundleMeta.files = manifest.files.map((f) => ({
            fileId: f.fileId,
            sizeBytes: f.sizeBytes,
            filename: f.name
          }));
          bundleMeta.fileCount = bundleMeta.files.length;
          for (const f of bundleMeta.files) {
            filenames.push(f.filename || "file");
          }
        } else {
          for (const f of bundleMeta.files) {
            filenames.push(await decryptFilenameFromBase64(this.cryptoObj, f.encryptedFilename, cryptoKey, this.base64));
          }
        }
      } catch (err2) {
        throw new DropgateError("Failed to decrypt bundle manifest.", { code: "DECRYPT_MANIFEST_FAILED", cause: err2 });
      }
    } else {
      for (const f of bundleMeta.files) {
        filenames.push(f.filename || "file");
      }
    }
    let totalReceivedBytes = 0;
    if (asZip && onData) {
      const zipWriter = new StreamingZipWriter(onData);
      for (let fi = 0; fi < bundleMeta.files.length; fi++) {
        const fileMeta = bundleMeta.files[fi];
        const name = filenames[fi];
        progress({
          phase: "zipping",
          text: `Downloading ${name}...`,
          percent: totalBytes > 0 ? totalReceivedBytes / totalBytes * 100 : 0,
          processedBytes: totalReceivedBytes,
          totalBytes,
          fileIndex: fi,
          totalFiles: bundleMeta.files.length,
          currentFileName: name
        });
        zipWriter.startFile(name);
        const baseReceivedBytes = totalReceivedBytes;
        const bytesReceived = await this._streamFileIntoCallback(
          baseUrl,
          fileMeta.fileId,
          isEncrypted,
          cryptoKey,
          compat,
          signal,
          timeoutMs,
          (chunk) => {
            zipWriter.writeChunk(chunk);
          },
          (fileBytes) => {
            const current = baseReceivedBytes + fileBytes;
            progress({
              phase: "zipping",
              text: `Downloading ${name}...`,
              percent: totalBytes > 0 ? current / totalBytes * 100 : 0,
              processedBytes: current,
              totalBytes,
              fileIndex: fi,
              totalFiles: bundleMeta.files.length,
              currentFileName: name
            });
          }
        );
        zipWriter.endFile();
        totalReceivedBytes += bytesReceived;
      }
      await zipWriter.finalize();
      try {
        await fetchJson(this.fetchFn, `${baseUrl}/api/bundle/${bundleId}/downloaded`, {
          method: "POST",
          timeoutMs: 5e3,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: "{}"
        });
      } catch {
      }
      progress({ phase: "complete", text: "Download complete!", percent: 100, processedBytes: totalReceivedBytes, totalBytes });
      return { filenames, receivedBytes: totalReceivedBytes, wasEncrypted: isEncrypted };
    } else {
      const dataCallback = onFileData || onData;
      for (let fi = 0; fi < bundleMeta.files.length; fi++) {
        const fileMeta = bundleMeta.files[fi];
        const name = filenames[fi];
        progress({
          phase: "downloading",
          text: `Downloading ${name}...`,
          percent: totalBytes > 0 ? totalReceivedBytes / totalBytes * 100 : 0,
          processedBytes: totalReceivedBytes,
          totalBytes,
          fileIndex: fi,
          totalFiles: bundleMeta.files.length,
          currentFileName: name
        });
        onFileStart?.({ name, size: fileMeta.sizeBytes, index: fi });
        const baseReceivedBytes = totalReceivedBytes;
        const bytesReceived = await this._streamFileIntoCallback(
          baseUrl,
          fileMeta.fileId,
          isEncrypted,
          cryptoKey,
          compat,
          signal,
          timeoutMs,
          dataCallback ? (chunk) => dataCallback(chunk) : void 0,
          (fileBytes) => {
            const current = baseReceivedBytes + fileBytes;
            progress({
              phase: "downloading",
              text: `Downloading ${name}...`,
              percent: totalBytes > 0 ? current / totalBytes * 100 : 0,
              processedBytes: current,
              totalBytes,
              fileIndex: fi,
              totalFiles: bundleMeta.files.length,
              currentFileName: name
            });
          }
        );
        onFileEnd?.({ name, index: fi });
        totalReceivedBytes += bytesReceived;
      }
      progress({ phase: "complete", text: "Download complete!", percent: 100, processedBytes: totalReceivedBytes, totalBytes });
      return { filenames, receivedBytes: totalReceivedBytes, wasEncrypted: isEncrypted };
    }
  }
  /**
   * Download a single file, handling encryption/decryption internally.
   * Preserves the original downloadFile() behavior.
   */
  async _downloadSingleFile(params) {
    const { fileId, keyB64, onProgress, onData, signal, timeoutMs, baseUrl, compat } = params;
    const progress = (evt) => {
      try {
        if (onProgress) onProgress(evt);
      } catch {
      }
    };
    progress({ phase: "metadata", text: "Fetching file info...", processedBytes: 0, totalBytes: 0, percent: 0 });
    let metadata;
    try {
      metadata = await this.getFileMetadata(fileId, { timeoutMs, signal });
    } catch (err2) {
      if (err2 instanceof DropgateError) throw err2;
      if (err2 instanceof Error && err2.name === "AbortError") throw new DropgateAbortError("Download cancelled.");
      throw new DropgateNetworkError("Could not fetch file metadata.", { cause: err2 });
    }
    const isEncrypted = Boolean(metadata.isEncrypted);
    const encryptedTotalBytes = metadata.sizeBytes || 0;
    let totalBytes = encryptedTotalBytes;
    if (isEncrypted && encryptedTotalBytes > 0) {
      const downloadChunkSize = Number.isFinite(compat.serverInfo?.capabilities?.upload?.chunkSize) && compat.serverInfo.capabilities.upload.chunkSize > 0 ? compat.serverInfo.capabilities.upload.chunkSize : this.chunkSize;
      const encryptedChunkSize = downloadChunkSize + ENCRYPTION_OVERHEAD_PER_CHUNK;
      const numChunks = Math.ceil(encryptedTotalBytes / encryptedChunkSize);
      totalBytes = encryptedTotalBytes - numChunks * ENCRYPTION_OVERHEAD_PER_CHUNK;
    }
    if (!onData && totalBytes > MAX_IN_MEMORY_DOWNLOAD_BYTES) {
      const sizeMB = Math.round(totalBytes / (1024 * 1024));
      const limitMB = Math.round(MAX_IN_MEMORY_DOWNLOAD_BYTES / (1024 * 1024));
      throw new DropgateValidationError(
        `File is too large (${sizeMB}MB) to download without streaming. Provide an onData callback to stream files larger than ${limitMB}MB.`
      );
    }
    let filename;
    let cryptoKey;
    if (isEncrypted) {
      if (!keyB64) throw new DropgateValidationError("Decryption key is required for encrypted files.");
      if (!this.cryptoObj?.subtle) throw new DropgateValidationError("Web Crypto API not available for decryption.");
      progress({ phase: "decrypting", text: "Preparing decryption...", processedBytes: 0, totalBytes: 0, percent: 0 });
      try {
        cryptoKey = await importKeyFromBase64(this.cryptoObj, keyB64, this.base64);
        filename = await decryptFilenameFromBase64(this.cryptoObj, metadata.encryptedFilename, cryptoKey, this.base64);
      } catch (err2) {
        throw new DropgateError("Failed to decrypt filename.", { code: "DECRYPT_FILENAME_FAILED", cause: err2 });
      }
    } else {
      filename = metadata.filename || "file";
    }
    progress({ phase: "downloading", text: "Starting download...", percent: 0, processedBytes: 0, totalBytes });
    const dataChunks = [];
    const collectData = !onData;
    const receivedBytes = await this._streamFileIntoCallback(
      baseUrl,
      fileId,
      isEncrypted,
      cryptoKey,
      compat,
      signal,
      timeoutMs,
      async (chunk) => {
        if (collectData) {
          dataChunks.push(chunk);
        } else {
          await onData(chunk);
        }
      },
      (bytes) => {
        progress({
          phase: "downloading",
          text: "Downloading...",
          percent: totalBytes > 0 ? bytes / totalBytes * 100 : 0,
          processedBytes: bytes,
          totalBytes
        });
      }
    );
    progress({ phase: "complete", text: "Download complete!", percent: 100, processedBytes: receivedBytes, totalBytes });
    let data;
    if (collectData && dataChunks.length > 0) {
      const totalLength = dataChunks.reduce((sum, c) => sum + c.length, 0);
      data = new Uint8Array(totalLength);
      let offset = 0;
      for (const c of dataChunks) {
        data.set(c, offset);
        offset += c.length;
      }
    }
    return {
      filename,
      receivedBytes,
      wasEncrypted: isEncrypted,
      ...data ? { data } : {}
    };
  }
  /**
   * Stream a single file's content into a callback, handling decryption if needed.
   * Returns total bytes received from the network (encrypted size).
   */
  async _streamFileIntoCallback(baseUrl, fileId, isEncrypted, cryptoKey, compat, signal, timeoutMs, onChunk, onBytesReceived) {
    const { signal: downloadSignal, cleanup: downloadCleanup } = makeAbortSignal(signal, timeoutMs);
    let receivedBytes = 0;
    try {
      const downloadRes = await this.fetchFn(`${baseUrl}/api/file/${fileId}`, {
        method: "GET",
        signal: downloadSignal
      });
      if (!downloadRes.ok) throw new DropgateProtocolError(`Download failed (status ${downloadRes.status}).`);
      if (!downloadRes.body) throw new DropgateProtocolError("Streaming response not available.");
      const reader = downloadRes.body.getReader();
      if (isEncrypted && cryptoKey) {
        const downloadChunkSize = Number.isFinite(compat.serverInfo?.capabilities?.upload?.chunkSize) && compat.serverInfo.capabilities.upload.chunkSize > 0 ? compat.serverInfo.capabilities.upload.chunkSize : this.chunkSize;
        const ENCRYPTED_CHUNK_SIZE = downloadChunkSize + ENCRYPTION_OVERHEAD_PER_CHUNK;
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
          if (signal?.aborted) throw new DropgateAbortError("Download cancelled.");
          const { done, value } = await reader.read();
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
            const decryptedBuffer = await decryptChunk(this.cryptoObj, encryptedChunk, cryptoKey);
            receivedBytes += decryptedBuffer.byteLength;
            if (onBytesReceived) onBytesReceived(receivedBytes);
            if (onChunk) await onChunk(new Uint8Array(decryptedBuffer));
          }
        }
        if (pendingLength > 0) {
          const buffer = flushPending();
          const decryptedBuffer = await decryptChunk(this.cryptoObj, buffer, cryptoKey);
          receivedBytes += decryptedBuffer.byteLength;
          if (onBytesReceived) onBytesReceived(receivedBytes);
          if (onChunk) await onChunk(new Uint8Array(decryptedBuffer));
        }
      } else {
        while (true) {
          if (signal?.aborted) throw new DropgateAbortError("Download cancelled.");
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes += value.length;
          if (onBytesReceived) onBytesReceived(receivedBytes);
          if (onChunk) await onChunk(value);
        }
      }
    } catch (err2) {
      if (err2 instanceof DropgateError) throw err2;
      if (err2 instanceof Error && err2.name === "AbortError") throw new DropgateAbortError("Download cancelled.");
      throw new DropgateNetworkError("Download failed.", { cause: err2 });
    } finally {
      downloadCleanup();
    }
    return receivedBytes;
  }
  /**
   * Start a P2P send session. Connects to the signalling server and waits for a receiver.
   *
   * Server info, peerjsPath, iceServers, and cryptoObj are provided automatically
   * from the client's cached server info and configuration.
   *
   * @param opts - P2P send options (file, Peer constructor, callbacks, tuning).
   * @returns P2P send session with control methods.
   * @throws {DropgateValidationError} If P2P is not enabled on the server.
   * @throws {DropgateNetworkError} If the signalling server cannot be reached.
   */
  async p2pSend(opts) {
    const compat = await this.connect();
    if (!compat.compatible) {
      throw new DropgateValidationError(compat.message);
    }
    const { serverInfo } = compat;
    const p2pCaps = serverInfo?.capabilities?.p2p;
    if (!p2pCaps?.enabled) {
      throw new DropgateValidationError("Direct transfer is disabled on this server.");
    }
    const { host, port, secure } = this.serverTarget;
    const { path: peerjsPath, iceServers } = resolvePeerConfig({}, p2pCaps);
    return startP2PSend({
      ...opts,
      host,
      port,
      secure,
      peerjsPath,
      iceServers,
      serverInfo,
      cryptoObj: this.cryptoObj
    });
  }
  /**
   * Start a P2P receive session. Connects to a sender via their sharing code.
   *
   * Server info, peerjsPath, and iceServers are provided automatically
   * from the client's cached server info.
   *
   * @param opts - P2P receive options (code, Peer constructor, callbacks, tuning).
   * @returns P2P receive session with control methods.
   * @throws {DropgateValidationError} If P2P is not enabled on the server.
   * @throws {DropgateNetworkError} If the signalling server cannot be reached.
   */
  async p2pReceive(opts) {
    const compat = await this.connect();
    if (!compat.compatible) {
      throw new DropgateValidationError(compat.message);
    }
    const { serverInfo } = compat;
    const p2pCaps = serverInfo?.capabilities?.p2p;
    if (!p2pCaps?.enabled) {
      throw new DropgateValidationError("Direct transfer is disabled on this server.");
    }
    const { host, port, secure } = this.serverTarget;
    const { path: peerjsPath, iceServers } = resolvePeerConfig({}, p2pCaps);
    return startP2PReceive({
      ...opts,
      host,
      port,
      secure,
      peerjsPath,
      iceServers,
      serverInfo
    });
  }
  async _attemptChunkUpload(url, fetchOptions, opts) {
    const {
      retries,
      backoffMs,
      maxBackoffMs,
      timeoutMs,
      signal,
      progress,
      chunkIndex,
      totalChunks,
      chunkSize,
      fileSizeBytes
    } = opts;
    let attemptsLeft = retries;
    let currentBackoff = backoffMs;
    const maxRetries = retries;
    while (true) {
      if (signal?.aborted) {
        throw signal.reason || new DropgateAbortError();
      }
      const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);
      try {
        const res = await this.fetchFn(url, { ...fetchOptions, signal: s });
        if (res.ok) return;
        const text = await res.text().catch(() => "");
        const err2 = new DropgateProtocolError(
          `Chunk ${chunkIndex + 1} failed (HTTP ${res.status}).`,
          {
            details: { status: res.status, bodySnippet: text.slice(0, 120) }
          }
        );
        throw err2;
      } catch (err2) {
        cleanup();
        if (err2 instanceof Error && (err2.name === "AbortError" || err2.code === "ABORT_ERR")) {
          throw err2;
        }
        if (signal?.aborted) {
          throw signal.reason || new DropgateAbortError();
        }
        if (attemptsLeft <= 0) {
          throw err2 instanceof DropgateError ? err2 : new DropgateNetworkError("Chunk upload failed.", { cause: err2 });
        }
        const attemptNumber = maxRetries - attemptsLeft + 1;
        const processedBytes = chunkIndex * chunkSize;
        const percent = chunkIndex / totalChunks * 100;
        let remaining = currentBackoff;
        const tick = 100;
        while (remaining > 0) {
          const secondsLeft = (remaining / 1e3).toFixed(1);
          progress({
            phase: "retry-wait",
            text: `Chunk upload failed. Retrying in ${secondsLeft}s... (${attemptNumber}/${maxRetries})`,
            percent,
            processedBytes,
            totalBytes: fileSizeBytes,
            chunkIndex,
            totalChunks
          });
          await sleep(Math.min(tick, remaining), signal);
          remaining -= tick;
        }
        progress({
          phase: "retry",
          text: `Chunk upload failed. Retrying now... (${attemptNumber}/${maxRetries})`,
          percent,
          processedBytes,
          totalBytes: fileSizeBytes,
          chunkIndex,
          totalChunks
        });
        attemptsLeft -= 1;
        currentBackoff = Math.min(currentBackoff * 2, maxBackoffMs);
        continue;
      } finally {
        cleanup();
      }
    }
  }
};
export {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  DEFAULT_CHUNK_SIZE,
  DropgateAbortError,
  DropgateClient,
  DropgateError,
  DropgateNetworkError,
  DropgateProtocolError,
  DropgateTimeoutError,
  DropgateValidationError,
  ENCRYPTION_OVERHEAD_PER_CHUNK,
  StreamingZipWriter,
  arrayBufferToBase64,
  base64ToBytes,
  buildBaseUrl,
  bytesToBase64,
  decryptChunk,
  decryptFilenameFromBase64,
  encryptFilenameToBase64,
  encryptToBlob,
  estimateTotalUploadSizeBytes,
  exportKeyBase64,
  fetchJson,
  generateAesGcmKey,
  generateP2PCode,
  getDefaultBase64,
  getDefaultCrypto,
  getDefaultFetch,
  getServerInfo,
  importKeyFromBase64,
  isLocalhostHostname,
  isP2PCodeLike,
  isSecureContextForP2P,
  lifetimeToMs,
  makeAbortSignal,
  parseSemverMajorMinor,
  parseServerUrl,
  sha256Hex,
  sleep,
  validatePlainFilename
};
//# sourceMappingURL=index.js.map