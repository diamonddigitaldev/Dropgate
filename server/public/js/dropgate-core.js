// Built from packages/dropgate-core by `npm run build` there. Don't edit this file:
// change core's source and build it again. CI fails if this doesn't match the build.
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

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
  INVALID_FILENAME: { origin: "local", retryable: false, message: "A file name is empty, too long, or has a path in it." },
  INVALID_CODE: { origin: "local", retryable: false, message: "That isn't a valid sharing code." },
  FILE_EMPTY: { origin: "local", retryable: false, message: "Empty files (0 bytes) cannot be uploaded." },
  FILE_TOO_LARGE: { origin: "server", retryable: false, message: "The upload is larger than the server's limit." },
  LIFETIME_NOT_ALLOWED: { origin: "server", retryable: false, message: "The server doesn't allow that file lifetime." },
  CAPABILITY_UNSUPPORTED: { origin: "server", retryable: false, message: "The server doesn't support this." },
  VERSION_UNSUPPORTED: { origin: "server", retryable: false, message: "This version of Dropgate can't work with the server." },
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
    this.name = "DropgateError";
    this.code = opts.code in ERROR_CODES ? opts.code : "UNEXPECTED_ERROR";
    this.origin = opts.origin ?? info.origin;
    this.retryable = opts.retryable ?? info.retryable;
    if (opts.status !== void 0) this.status = opts.status;
    if (opts.details !== void 0) this.details = opts.details;
  }
  /** Whether `err` is a DropgateError, with `code` if one is given. */
  static is(err2, code) {
    return err2 instanceof _DropgateError && (code === void 0 || err2.code === code);
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
      ...this.details !== void 0 ? { details: this.details } : {}
    };
  }
};
function errorFromStatus(status, json, fallback) {
  const said = json && typeof json === "object" && "error" in json ? json.error : void 0;
  const serverMessage = typeof said === "string" && said.trim() && said.length <= 200 ? said.trim() : void 0;
  const code = status === 404 || status === 410 ? "NOT_FOUND" : status === 413 ? "FILE_TOO_LARGE" : status === 429 ? "RATE_LIMITED" : status === 507 ? "SERVER_FULL" : status >= 500 ? "SERVER_ERROR" : "REQUEST_REJECTED";
  return new DropgateError({ code, status, message: serverMessage ?? fallback });
}
function directTransferDisabled() {
  return new DropgateError({
    code: "CAPABILITY_UNSUPPORTED",
    message: "Direct transfer is disabled on this server.",
    details: { capability: "p2p" }
  });
}
function toDropgateError(err2, fallback = "UNEXPECTED_ERROR", message) {
  if (err2 instanceof DropgateError) return err2;
  const name = err2 instanceof Error || err2 && typeof err2 === "object" && "name" in err2 ? err2.name : void 0;
  if (name === "TimeoutError") return new DropgateError({ code: "TIMED_OUT", cause: err2 });
  if (name === "AbortError") return new DropgateError({ code: "OPERATION_CANCELLED", cause: err2 });
  return new DropgateError({ code: fallback, cause: err2, ...message ? { message } : {} });
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
async function settle(scope, work) {
  try {
    const value = await work();
    return { status: "completed", value };
  } catch (err2) {
    const cancellation = scope.cancellation;
    if (cancellation) return { status: "cancelled", cancellation };
    return { status: "failed", error: toDropgateError(err2) };
  } finally {
    scope.finish();
  }
}

// src/operation.ts
function newOperationId() {
  const cryptoObj = globalThis.crypto;
  if (typeof cryptoObj?.randomUUID === "function") return cryptoObj.randomUUID();
  const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function startOperation(opts) {
  const scope = new CancelScope(opts.kind, { parent: opts.parent, signal: opts.signal });
  const listeners = /* @__PURE__ */ new Set();
  let snapshot = Object.freeze({ ...opts.initial });
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
    update: (patch) => {
      if (!ended) publish({ ...snapshot, ...patch });
    }
  };
  const run = async () => {
    await Promise.resolve();
    scope.throwIfCancelled();
    return opts.work(ctx);
  };
  const result = settle(scope, run).then((outcome) => {
    ended = true;
    try {
      opts.onEnd?.(handle);
    } catch {
    }
    publish(opts.finalSnapshot(outcome, snapshot));
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
    } catch (err2) {
      throw new DropgateError({ code: "OUTPUT_WRITE_FAILED", cause: err2 });
    }
    if (!isDownloadSink(sink)) {
      throw new DropgateError({ code: "OUTPUT_WRITE_FAILED", message: "The function giving a sink gave something without write() and close()." });
    }
    return new _SinkWriter(sink);
  }
  async write(chunk) {
    try {
      await this.sink.write(chunk);
    } catch (err2) {
      throw toDropgateError(err2, "OUTPUT_WRITE_FAILED");
    }
  }
  async close() {
    this.done = true;
    try {
      await this.sink.close();
    } catch (err2) {
      throw toDropgateError(err2, "OUTPUT_WRITE_FAILED");
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
  } catch (err2) {
    throw new DropgateError({ code: "SOURCE_UNAVAILABLE", cause: err2 });
  }
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength !== end - start) {
    throw new DropgateError({
      code: "SOURCE_UNAVAILABLE",
      message: "A file gave a different number of bytes than asked for. It may have changed while it was read."
    });
  }
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.buffer instanceof ArrayBuffer ? view : new Uint8Array(view);
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
function getDefaultCrypto() {
  return globalThis.crypto;
}
function getDefaultFetch() {
  return globalThis.fetch?.bind(globalThis);
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
  } catch (err2) {
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "The server address is not a valid URL.", cause: err2 });
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
function withoutCredentials(fetchFn) {
  return (input, init) => fetchFn(input, { ...init, credentials: "omit" });
}
async function fetchJson(fetchFn, url, opts = {}) {
  const { timeoutMs, signal, ...rest } = opts;
  const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);
  try {
    let res;
    try {
      res = await fetchFn(url, { ...rest, signal: s });
    } catch (err2) {
      throw toDropgateError(err2, "SERVER_UNREACHABLE");
    }
    let text;
    try {
      text = await res.text();
    } catch (err2) {
      throw toDropgateError(err2, "CONNECTION_LOST");
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

// src/utils/share-link.ts
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseShareInput(value) {
  const raw = String(value ?? "").trim();
  const hashAt = raw.indexOf("#");
  const before = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const after = hashAt === -1 ? "" : raw.slice(hashAt + 1);
  const secret = after ? after : void 0;
  if (!/^https?:\/\//i.test(before)) {
    const locator2 = before.replace(/\s+/g, "");
    return locator2 ? { locator: locator2, ...secret ? { secret } : {} } : null;
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
  let locator = null;
  if (path.startsWith("/p2p/")) {
    locator = path.slice("/p2p/".length).replace(/\s+/g, "").toUpperCase();
  } else if (path.startsWith("/b/")) {
    locator = path.slice("/b/".length);
  } else {
    locator = path.slice(1);
  }
  if (!locator || !path.startsWith("/p2p/") && !UUID_RE.test(locator)) return null;
  return { locator, linkHost: url.host, ...secret ? { secret } : {} };
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
    throw new DropgateError({ code: "INVALID_FILENAME", message: "Invalid filename. Must be a non-empty string." });
  }
  if (filename.length > 255 || /[\/\\]/.test(filename)) {
    throw new DropgateError({ code: "INVALID_FILENAME", message: "Invalid filename. Contains illegal characters or is too long." });
  }
}

// src/utils/size.ts
function estimateUploadBytes(sizeBytes, opts) {
  const base = Number(sizeBytes) || 0;
  if (!opts.encrypted || base <= 0) return base;
  const chunkSize = Number.isFinite(opts.chunkSize) && opts.chunkSize > 0 ? opts.chunkSize : DEFAULT_CHUNK_SIZE;
  return base + Math.ceil(base / chunkSize) * ENCRYPTION_OVERHEAD_PER_CHUNK;
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
function arrayBufferToBase64(buf, adapter) {
  return bytesToBase64(new Uint8Array(buf), adapter);
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
  throw lastError || new DropgateError({ code: "SERVER_UNREACHABLE", message: "Could not establish PeerJS connection." });
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
var P2P_MAX_UNACKED_CHUNKS = 64;
var P2P_END_ACK_TIMEOUT_MS = 15e3;
var P2P_END_ACK_RETRIES = 3;
var P2P_END_ACK_RETRY_DELAY_MS = 100;
var P2P_CLOSE_GRACE_PERIOD_MS = 2e3;

// src/p2p/send.ts
var P2P_UNACKED_CHUNK_TIMEOUT_MS = 6e4;
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
    throw new DropgateError({ code: "INVALID_ARGUMENT", message: "At least one file is required." });
  }
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
          onCancel?.({ cancelledBy: "receiver", message: msg.reason });
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
              throw new DropgateError({ code: "INVALID_MANIFEST", message: `Too many files: ${fileListMsg.fileCount}` });
            }
            const sumSize = fileListMsg.files.reduce((sum, f) => sum + f.size, 0);
            if (sumSize !== fileListMsg.totalSize) {
              throw new DropgateError({
                code: "INVALID_MANIFEST",
                message: `File list size mismatch: declared ${fileListMsg.totalSize}, actual sum ${sumSize}`
              });
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
              const err2 = new DropgateError({
                code: "CONNECTION_LOST",
                message: "Transfer ended before all data was received."
              });
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
            throw new DropgateError({ code: "PEER_FAILED", message: "The sender reported an error." });
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
  // determined by compression function
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
    __publicField(this, "failed", null);
    this.onData = onData;
    this.zip = new Zip((err2, data) => {
      if (err2) {
        this.failed ?? (this.failed = { error: err2 });
        return;
      }
      this.pendingWrites = this.pendingWrites.then(() => this.failed ? void 0 : this.onData(data)).catch((error) => {
        this.failed ?? (this.failed = { error });
      });
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
  /** Waits until `onData` has taken everything written so far. Throws its error if it failed. */
  async drained() {
    await this.pendingWrites;
    if (this.failed) throw this.failed.error;
  }
  /**
   * Finalize the ZIP archive. Must be called after all files are written.
   * Waits for all pending async writes to complete before resolving.
   */
  async finalize() {
    if (this.currentFile) {
      throw new Error("Cannot finalize with an open file. Call endFile() first.");
    }
    if (!this.finalized) {
      this.finalized = true;
      this.zip.end();
    }
    await this.drained();
  }
};

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
var DropgateClient = class {
  /**
   * Create a new DropgateClient instance.
   * @param opts - Client configuration options including server URL.
   * @throws {DropgateError} INVALID_ARGUMENT if clientVersion or server is missing or invalid;
   * RUNTIME_UNSUPPORTED if there's no fetch() or crypto.
   */
  constructor(opts) {
    /** Client version string for compatibility checking. */
    __publicField(this, "clientVersion");
    /** Chunk size in bytes for upload splitting. */
    __publicField(this, "chunkSize");
    /** Fetch implementation used for HTTP requests. Every request it makes omits credentials (no cookies). */
    __publicField(this, "fetchFn");
    /** Crypto implementation for encryption operations. */
    __publicField(this, "cryptoObj");
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
    /** Resolved base URL (e.g. 'https://dropgate.link'). May change during HTTP fallback. */
    __publicField(this, "baseUrl");
    /** Whether to automatically retry with HTTP when HTTPS fails. */
    __publicField(this, "_fallbackToHttp");
    /** Cached compatibility result (null until the first connect). */
    __publicField(this, "_compat", null);
    /** In-flight connect promise to deduplicate concurrent calls. */
    __publicField(this, "_connectPromise", null);
    /** The running operations, and the root of the cancellation tree. */
    __publicField(this, "_registry", new OperationRegistry());
    if (!opts || typeof opts.clientVersion !== "string") {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "DropgateClient requires clientVersion (string)." });
    }
    if (!opts.server) {
      throw new DropgateError({
        code: "INVALID_ARGUMENT",
        message: "DropgateClient requires server (URL string or ServerTarget object)."
      });
    }
    this.clientVersion = opts.clientVersion;
    this.chunkSize = Number.isFinite(opts.chunkSize) ? opts.chunkSize : DEFAULT_CHUNK_SIZE;
    const fetchFn = opts.fetchFn || getDefaultFetch();
    if (!fetchFn) {
      throw new DropgateError({ code: "RUNTIME_UNSUPPORTED", message: "No fetch() implementation found." });
    }
    this.fetchFn = withoutCredentials(fetchFn);
    const cryptoObj = opts.cryptoObj || getDefaultCrypto();
    if (!cryptoObj) {
      throw new DropgateError({ code: "RUNTIME_UNSUPPORTED", message: "No crypto implementation found." });
    }
    this.cryptoObj = cryptoObj;
    this.base64 = opts.base64 || getDefaultBase64();
    this._fallbackToHttp = Boolean(opts.fallbackToHttp);
    this.baseUrl = resolveServerToBaseUrl(opts.server);
    const client = this;
    this.server = Object.freeze({
      get baseUrl() {
        return client.baseUrl;
      },
      connect: (o) => this._connect(o),
      info: (o) => this._fetchInfo(this.baseUrl, o).then(({ serverInfo }) => serverInfo)
    });
    this.hosted = Object.freeze({
      upload: (o) => this._upload(o),
      download: (o) => this._download(o),
      metadata: (o) => this._metadata(o),
      validate: (o) => this._validate(o)
    });
    this.direct = Object.freeze({
      send: (o) => this._directSend(o),
      receive: (o) => this._directReceive(o)
    });
    this.links = Object.freeze({
      resolve: (value, o) => this._resolve(value, o)
    });
    this.operations = this._registry.api;
  }
  /** Asks a server for its info. */
  async _fetchInfo(baseUrl, opts) {
    const { timeoutMs = 5e3, signal } = opts ?? {};
    const { res, json } = await fetchJson(this.fetchFn, `${baseUrl}/api/info`, {
      method: "GET",
      timeoutMs,
      signal,
      headers: { Accept: "application/json" }
    });
    if (res.ok && json && typeof json === "object" && "version" in json) {
      return { baseUrl, serverInfo: json };
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
    let baseUrl = this.baseUrl;
    let serverInfo;
    try {
      const result = await this._fetchInfo(baseUrl, opts);
      baseUrl = result.baseUrl;
      serverInfo = result.serverInfo;
    } catch (err2) {
      if (this._fallbackToHttp && this.baseUrl.startsWith("https://")) {
        const httpBaseUrl = this.baseUrl.replace("https://", "http://");
        try {
          const result = await this._fetchInfo(httpBaseUrl, opts);
          this.baseUrl = httpBaseUrl;
          baseUrl = result.baseUrl;
          serverInfo = result.serverInfo;
        } catch {
          throw toDropgateError(err2, "SERVER_UNREACHABLE");
        }
      } else {
        throw toDropgateError(err2, "SERVER_UNREACHABLE");
      }
    }
    const compat = this._checkVersionCompat(serverInfo);
    this._compat = { ...compat, serverInfo, baseUrl };
    return this._compat;
  }
  /** Throws VERSION_UNSUPPORTED if the server's and this client's versions don't work together. */
  _requireCompatible(compat) {
    if (compat.compatible) return;
    throw new DropgateError({
      code: "VERSION_UNSUPPORTED",
      message: compat.message,
      details: { clientVersion: compat.clientVersion, serverVersion: compat.serverVersion }
    });
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
  async _resolve(value, opts) {
    const { timeoutMs = 5e3, signal } = opts ?? {};
    const input = parseShareInput(value);
    if (!input) {
      return { valid: false, reason: "Unrecognised sharing link." };
    }
    const compat = await this._connect(opts);
    this._requireCompatible(compat);
    const { baseUrl } = compat;
    if (input.linkHost !== void 0 && input.linkHost !== new URL(baseUrl).host) {
      return { valid: false, reason: "URL must be from this server." };
    }
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
        body: JSON.stringify({ value: input.locator })
      }
    );
    if (!res.ok) throw errorFromStatus(res.status, json, "Share lookup failed.");
    const result = json || { valid: false, reason: "Unknown response." };
    if (result.valid && result.target && input.secret && (result.type === "file" || result.type === "bundle")) {
      return { ...result, target: `${result.target}#${input.secret}` };
    }
    return result;
  }
  async _metadata(opts) {
    const { fileId, bundleId } = opts ?? {};
    if (!(fileId && typeof fileId === "string") && !(bundleId && typeof bundleId === "string")) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "Either fileId or bundleId is required." });
    }
    const compat = await this._connect(opts);
    this._requireCompatible(compat);
    return (await this._readMetadata(opts, compat)).meta;
  }
  /**
   * Reads an upload's metadata from the server, decrypting its file names, and
   * gives the key too, for its download.
   */
  async _readMetadata(opts, compat) {
    const { fileId, bundleId, keyB64, timeoutMs = 5e3, signal } = opts;
    const { baseUrl, serverInfo } = compat;
    const chunkSize = serverChunkSize(serverInfo, this.chunkSize);
    const path = fileId ? `/api/file/${encodeURIComponent(fileId)}/meta` : `/api/bundle/${encodeURIComponent(bundleId)}/meta`;
    const { res, json } = await fetchJson(this.fetchFn, `${baseUrl}${path}`, { method: "GET", timeoutMs, signal });
    if (!res.ok) throw errorFromStatus(res.status, json, fileId ? "Failed to fetch file metadata." : "Failed to fetch bundle metadata.");
    if (!json || typeof json !== "object") {
      throw new DropgateError({ code: "INVALID_RESPONSE", message: "The server sent no metadata." });
    }
    const raw = json;
    const isEncrypted = Boolean(raw.isEncrypted);
    let cryptoKey;
    if (isEncrypted) {
      if (!keyB64) throw new DropgateError({ code: "KEY_REQUIRED" });
      if (!this.cryptoObj?.subtle) {
        throw new DropgateError({
          code: "RUNTIME_UNSUPPORTED",
          message: "Web Crypto API not available for decryption. Encrypted uploads need a secure context (HTTPS or localhost)."
        });
      }
    }
    const decrypt = async (run) => {
      try {
        cryptoKey ?? (cryptoKey = await importKeyFromBase64(this.cryptoObj, keyB64, this.base64));
        return await run(cryptoKey);
      } catch (err2) {
        throw new DropgateError({ code: "DECRYPT_FAILED", cause: err2 });
      }
    };
    const decryptName = (encrypted) => decrypt((key) => decryptFilenameFromBase64(this.cryptoObj, String(encrypted ?? ""), key, this.base64));
    if (fileId) {
      const stored = Number(raw.sizeBytes) || 0;
      return {
        meta: {
          kind: "file",
          fileId,
          isEncrypted,
          name: isEncrypted ? await decryptName(raw.encryptedFilename) : raw.filename || "file",
          sizeBytes: isEncrypted ? plaintextBytes(stored, chunkSize) : stored
        },
        cryptoKey
      };
    }
    let files;
    const sealed = Boolean(raw.sealed && raw.encryptedManifest);
    if (sealed) {
      const manifest = await decrypt(async (key) => {
        const decrypted = await decryptChunk(this.cryptoObj, this.base64.decode(raw.encryptedManifest), key);
        const parsed = JSON.parse(new TextDecoder().decode(decrypted));
        if (!Array.isArray(parsed?.files)) throw new TypeError("The manifest has no files.");
        return parsed.files;
      });
      files = manifest.map((f) => ({ fileId: f.fileId, name: f.name || "file", sizeBytes: Number(f.sizeBytes) || 0 }));
    } else if (Array.isArray(raw.files)) {
      files = [];
      for (const f of raw.files) {
        const stored = Number(f.sizeBytes) || 0;
        files.push({
          fileId: f.fileId,
          name: isEncrypted ? await decryptName(f.encryptedFilename) : f.filename || "file",
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
  _validate(opts) {
    const { files: rawFiles, lifetimeMs, encrypt, serverInfo } = opts;
    const caps = serverInfo?.capabilities?.upload;
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
        const limitBytes = maxMB * 1e3 * 1e3;
        const validationChunkSize = serverChunkSize(serverInfo, this.chunkSize);
        const totalChunks = Math.ceil(fileSize / validationChunkSize);
        const estimatedBytes = estimateTotalUploadSizeBytes(
          fileSize,
          totalChunks,
          Boolean(encrypt)
        );
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
    const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);
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
    const work = async (ctx) => {
      const effectiveSignal = ctx.signal;
      const progress = ctx.update;
      const compat = await this._connect({
        timeoutMs: timeouts.serverInfoMs ?? 5e3,
        signal: effectiveSignal
      });
      const { baseUrl, serverInfo } = compat;
      progress({ phase: "server-compat", text: compat.message });
      this._requireCompatible(compat);
      const filenames2 = files.map((f, i) => filenameOverrides?.[i] ?? f.name ?? "file");
      const serverSupportsE2EE = Boolean(serverInfo?.capabilities?.upload?.e2ee);
      const effectiveEncrypt = encrypt ?? serverSupportsE2EE;
      if (!effectiveEncrypt) {
        for (const name of filenames2) validatePlainFilename(name);
      }
      this._validate({ files, lifetimeMs, encrypt: effectiveEncrypt, serverInfo });
      let cryptoKey = null;
      let keyB64 = null;
      const transmittedFilenames = [];
      if (effectiveEncrypt) {
        if (!this.cryptoObj?.subtle) {
          throw new DropgateError({
            code: "RUNTIME_UNSUPPORTED",
            message: "Web Crypto API not available (crypto.subtle). Encryption requires a secure context (HTTPS or localhost)."
          });
        }
        progress({ phase: "crypto", text: "Generating encryption key..." });
        try {
          cryptoKey = await generateAesGcmKey(this.cryptoObj);
          keyB64 = await exportKeyBase64(this.cryptoObj, cryptoKey);
          for (const name of filenames2) {
            transmittedFilenames.push(
              await encryptFilenameToBase64(this.cryptoObj, name, cryptoKey)
            );
          }
        } catch (err2) {
          throw new DropgateError({ code: "ENCRYPT_FAILED", cause: err2 });
        }
      } else {
        transmittedFilenames.push(...filenames2);
      }
      const serverChunkSize2 = serverInfo?.capabilities?.upload?.chunkSize;
      const effectiveChunkSize = Number.isFinite(serverChunkSize2) && serverChunkSize2 > 0 ? serverChunkSize2 : this.chunkSize;
      const retries = Number.isFinite(retry.retries) ? retry.retries : 5;
      const baseBackoffMs = Number.isFinite(retry.backoffMs) ? retry.backoffMs : 1e3;
      const maxBackoffMs = Number.isFinite(retry.maxBackoffMs) ? retry.maxBackoffMs : 3e4;
      if (files.length === 1) {
        const file = files[0];
        const totalChunks = Math.ceil(file.size / effectiveChunkSize);
        const totalUploadSize = estimateTotalUploadSizeBytes(file.size, totalChunks, effectiveEncrypt);
        progress({ phase: "init", text: "Reserving server storage..." });
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
          throw errorFromStatus(initRes.res.status, initRes.json, "Server initialisation failed.");
        }
        const uploadId = initRes.json?.uploadId;
        if (!uploadId) throw new DropgateError({ code: "INVALID_RESPONSE", message: "Server did not return a valid uploadId." });
        currentUploadIds.push(uploadId);
        progress({ status: "uploading" });
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
        progress({ status: "completing", phase: "complete", text: "Finalising upload...", percent: 100, processedBytes: file.size });
        const completeRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/complete`, {
          method: "POST",
          timeoutMs: timeouts.completeMs ?? 3e4,
          signal: effectiveSignal,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ uploadId })
        });
        if (!completeRes.res.ok) {
          throw errorFromStatus(completeRes.res.status, completeRes.json, "Finalisation failed.");
        }
        const fileId = completeRes.json?.id;
        if (!fileId) throw new DropgateError({ code: "INVALID_RESPONSE", message: "Server did not return a valid file id." });
        let downloadUrl2 = `${baseUrl}/${fileId}`;
        if (effectiveEncrypt && keyB64) downloadUrl2 += `#${keyB64}`;
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
      progress({ phase: "init", text: `Reserving server storage for ${files.length} files...`, totalFiles: files.length });
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
          retries,
          backoffMs: baseBackoffMs,
          maxBackoffMs,
          chunkTimeoutMs: timeouts.chunkMs ?? 6e4
        });
        const completeRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/complete`, {
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
        throw errorFromStatus(completeBundleRes.res.status, completeBundleRes.json, "Bundle finalisation failed.");
      }
      const bundleId = completeBundleRes.json?.bundleId;
      if (!bundleId) throw new DropgateError({ code: "INVALID_RESPONSE", message: "Server did not return a valid bundle id." });
      let downloadUrl = `${baseUrl}/b/${bundleId}`;
      if (effectiveEncrypt && keyB64) downloadUrl += `#${keyB64}`;
      return {
        downloadUrl,
        bundleId,
        baseUrl,
        files: fileResults,
        ...effectiveEncrypt && keyB64 ? { keyB64 } : {}
      };
    };
    return this._registry.add(startOperation({
      kind: "hosted.upload",
      parent: this._registry.scope,
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
  _download(opts) {
    const { fileId, bundleId, keyB64, asZip, sink, signal, timeoutMs = 6e4 } = opts ?? {};
    if (!(fileId && typeof fileId === "string") && !(bundleId && typeof bundleId === "string")) {
      throw new DropgateError({ code: "INVALID_ARGUMENT", message: "Either fileId or bundleId is required." });
    }
    const zipped = Boolean(bundleId && asZip);
    const sinkFits = typeof sink === "function" ? !zipped : isDownloadSink(sink) && (Boolean(fileId) || zipped);
    if (!sinkFits) {
      throw new DropgateError({
        code: "INVALID_ARGUMENT",
        message: !sink ? "A download needs a sink, with write() and close(), for its bytes." : zipped ? "A bundle downloaded as a ZIP needs one sink, with write() and close()." : fileId ? "The sink needs write() and close(), or must be a function giving a sink." : "A bundle downloaded as separate files needs a function giving a sink for each file."
      });
    }
    const work = async (ctx) => {
      const progress = ctx.update;
      const downloadSignal = ctx.signal;
      let open = null;
      try {
        const compat = await this._connect({ timeoutMs, signal: downloadSignal });
        progress({ phase: "server-compat", text: compat.message });
        this._requireCompatible(compat);
        const { baseUrl } = compat;
        progress({ phase: "metadata", text: fileId ? "Fetching file info..." : "Fetching bundle info..." });
        const target = fileId ? { fileId } : { bundleId };
        const { meta, cryptoKey } = await this._readMetadata({ ...target, keyB64, timeoutMs, signal: downloadSignal }, compat);
        const files = meta.kind === "file" ? [meta] : meta.files;
        const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
        const several = meta.kind === "bundle";
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
            } catch (err2) {
              throw toDropgateError(err2, "OUTPUT_WRITE_FAILED");
            }
          };
          for (let fi = 0; fi < files.length; fi++) {
            fileStarts(fi);
            zip2.startFile(files[fi].name);
            const done = written;
            written += await this._streamFile(files[fi].fileId, streamOpts, async (chunk) => {
              zip2.writeChunk(chunk);
              await drained();
            }, counted(fi, done));
            zip2.endFile();
          }
          progress({ status: "completing", phase: "complete", text: "Finishing the download..." });
          try {
            await zip2.finalize();
          } catch (err2) {
            throw toDropgateError(err2, "OUTPUT_WRITE_FAILED");
          }
          await out.close();
          open = null;
          try {
            await fetchJson(this.fetchFn, `${baseUrl}/api/bundle/${encodeURIComponent(bundleId)}/downloaded`, {
              method: "POST",
              timeoutMs: 5e3,
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: "{}"
            });
          } catch {
          }
        } else {
          for (let fi = 0; fi < files.length; fi++) {
            const file = files[fi];
            fileStarts(fi);
            const out = await SinkWriter.open(sink, { name: file.name, size: file.sizeBytes, index: fi });
            open = out;
            const done = written;
            written += await this._streamFile(file.fileId, streamOpts, (chunk) => out.write(chunk), counted(fi, done));
            if (fi === files.length - 1) progress({ status: "completing", phase: "complete", text: "Finishing the download..." });
            await out.close();
            open = null;
          }
        }
        return {
          ...meta.kind === "file" ? { filename: meta.name } : { filenames: meta.files.map((f) => f.name) },
          receivedBytes: written,
          wasEncrypted: meta.isEncrypted
        };
      } catch (err2) {
        await open?.abort(downloadSignal.aborted ? downloadSignal.reason : err2);
        throw err2;
      }
    };
    return this._registry.add(startOperation({
      kind: "hosted.download",
      parent: this._registry.scope,
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
   * Streams one file's bytes from the server into `deliver`, decrypting them
   * if it's encrypted, awaiting each delivery before reading on. Returns how
   * many bytes were delivered.
   */
  async _streamFile(fileId, opts, deliverChunk, onBytesDelivered) {
    const { baseUrl, isEncrypted, cryptoKey, compat, signal, timeoutMs } = opts;
    const { signal: downloadSignal, cleanup: downloadCleanup } = makeAbortSignal(signal, timeoutMs);
    let deliveredBytes = 0;
    let stopWatching = () => {
    };
    const step = async (code, run) => {
      try {
        return await run();
      } catch (err2) {
        if (downloadSignal.aborted) throw downloadSignal.reason;
        throw toDropgateError(err2, code);
      }
    };
    try {
      let downloadRes;
      try {
        downloadRes = await this.fetchFn(`${baseUrl}/api/file/${encodeURIComponent(fileId)}`, {
          method: "GET",
          signal: downloadSignal
        });
      } catch (err2) {
        throw toDropgateError(err2, "SERVER_UNREACHABLE");
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
        const next = await step("CONNECTION_LOST", () => reader.read());
        if (downloadSignal.aborted) throw downloadSignal.reason;
        return next;
      };
      const decrypt = (chunk) => step("INTEGRITY_FAILED", () => decryptChunk(this.cryptoObj, chunk, cryptoKey));
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
    } catch (err2) {
      throw toDropgateError(err2, "CONNECTION_LOST");
    } finally {
      stopWatching();
      downloadCleanup();
    }
    return deliveredBytes;
  }
  async _directSend(opts) {
    const compat = await this._connect();
    this._requireCompatible(compat);
    const { serverInfo } = compat;
    const p2pCaps = serverInfo?.capabilities?.p2p;
    if (!p2pCaps?.enabled) throw directTransferDisabled();
    const { host, port, secure } = parseServerUrl(this.baseUrl);
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
  async _directReceive(opts) {
    const compat = await this._connect();
    this._requireCompatible(compat);
    const { serverInfo } = compat;
    const p2pCaps = serverInfo?.capabilities?.p2p;
    if (!p2pCaps?.enabled) throw directTransferDisabled();
    const { host, port, secure } = parseServerUrl(this.baseUrl);
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
      retries,
      backoffMs,
      maxBackoffMs,
      chunkTimeoutMs
    } = params;
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
      let uploadBlob;
      if (cryptoKey) {
        try {
          uploadBlob = await encryptToBlob(this.cryptoObj, chunkBytes, cryptoKey);
        } catch (err2) {
          throw new DropgateError({ code: "ENCRYPT_FAILED", cause: err2 });
        }
      } else {
        uploadBlob = new Blob([chunkBytes]);
      }
      if (uploadBlob.size > effectiveChunkSize + 1024) {
        throw new DropgateError({ code: "INVALID_ARGUMENT", message: "Chunk too large (client-side). Check chunk size settings." });
      }
      const toHash = await uploadBlob.arrayBuffer();
      const hashHex = await sha256Hex(this.cryptoObj, toHash);
      await this._attemptChunkUpload(
        `${baseUrl}/upload/chunk`,
        { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Upload-ID": uploadId, "X-Chunk-Index": String(i), "X-Chunk-Hash": hashHex }, body: uploadBlob },
        { retries, backoffMs, maxBackoffMs, timeoutMs: chunkTimeoutMs, signal, progress, chunkIndex: i }
      );
    }
  }
  async _attemptChunkUpload(url, fetchOptions, opts) {
    const {
      retries,
      backoffMs,
      maxBackoffMs,
      timeoutMs,
      signal,
      progress,
      chunkIndex
    } = opts;
    let attemptsLeft = retries;
    let currentBackoff = backoffMs;
    const maxRetries = retries;
    while (true) {
      if (signal?.aborted) {
        throw signal.reason || new DropgateError({ code: "OPERATION_CANCELLED" });
      }
      const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);
      try {
        let res;
        try {
          res = await this.fetchFn(url, { ...fetchOptions, signal: s });
        } catch (err2) {
          throw toDropgateError(err2, "SERVER_UNREACHABLE");
        }
        if (res.ok) return;
        const text = await res.text().catch(() => "");
        throw errorFromStatus(res.status, { error: text }, `Chunk ${chunkIndex + 1} failed (HTTP ${res.status}).`);
      } catch (err2) {
        cleanup();
        if (signal?.aborted) {
          throw signal.reason || new DropgateError({ code: "OPERATION_CANCELLED" });
        }
        if (DropgateError.is(err2, "OPERATION_CANCELLED")) throw err2;
        if (attemptsLeft <= 0) throw toDropgateError(err2, "SERVER_UNREACHABLE");
        const attemptNumber = maxRetries - attemptsLeft + 1;
        let remaining = currentBackoff;
        const tick = 100;
        while (remaining > 0) {
          const secondsLeft = (remaining / 1e3).toFixed(1);
          progress({
            phase: "retry-wait",
            text: `Chunk upload failed. Retrying in ${secondsLeft}s... (${attemptNumber}/${maxRetries})`
          });
          await sleep(Math.min(tick, remaining), signal);
          remaining -= tick;
        }
        progress({
          phase: "retry",
          text: `Chunk upload failed. Retrying now... (${attemptNumber}/${maxRetries})`
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
  /** How many bytes an upload of a file sends: its size, plus each chunk's encryption overhead if it's encrypted. */
  estimateUpload: estimateUploadBytes
});
var filenames = Object.freeze({
  /**
   * Checks a file name that will be sent to the server as it is (an
   * unencrypted upload's).
   * @throws {DropgateError} INVALID_FILENAME if it's empty, too long, or has a path in it.
   */
  validate: validatePlainFilename
});
var codes = Object.freeze({
  /** A new random code. */
  generate: generateP2PCode,
  /** Whether a value is shaped like a code. */
  isLike: isP2PCodeLike
});
var hosts = Object.freeze({
  /** Whether a hostname is this machine (`localhost`, `127.0.0.1` or `::1`). */
  isLocalhost: isLocalhostHostname,
  /** Whether a direct transfer can run here: a secure context, or this machine. */
  isSecureForDirect: isSecureContextForP2P
});
var zip = Object.freeze({
  /**
   * A ZIP writer that gives the archive's bytes to `onData` as they're
   * written: `startFile(name)`, `writeChunk(bytes)`, `endFile()`, then
   * `finalize()`. Await `drained()` to let a slow `onData` keep up.
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
