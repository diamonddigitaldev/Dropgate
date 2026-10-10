const LOG_LEVELS = { NONE: -1, ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const normalizeLogLevel = (value) => {
    const upper = String(value || '').trim().toUpperCase();
    return LOG_LEVELS[upper] !== undefined ? upper : 'INFO';
};
const rawLogLevel = process.env.LOG_LEVEL;
const LOG_LEVEL = normalizeLogLevel(rawLogLevel || 'INFO');
const LOG_LEVEL_NUM = LOG_LEVELS[LOG_LEVEL];

const shouldLog = (level) => {
    const normalized = normalizeLogLevel(level);
    return LOG_LEVELS[normalized] <= LOG_LEVEL_NUM;
};

const log = (level, message) => {
    const normalized = normalizeLogLevel(level);
    if (!shouldLog(normalized)) return;
    const prefix = `[${new Date().toISOString()}] [${normalized}]`;
    const out = `${prefix} ${message}`;
    if (normalized === 'ERROR') return console.error(out);
    if (normalized === 'WARN') return console.warn(out);
    if (normalized === 'INFO') return console.info(out);
    return console.debug(out);
};

if (rawLogLevel && normalizeLogLevel(rawLogLevel) === 'INFO' && String(rawLogLevel).trim().toUpperCase() !== 'INFO') {
    log('warn', 'Invalid LOG_LEVEL value. Defaulting to INFO.');
}

/**
 * What kind of error this is, for a log line: its name and its system code, as
 * in " (Error, ENOENT)". Never its message or stack, which can hold a path, an
 * ID or part of a request.
 */
const describeError = (err) => {
    const parts = [];
    if (/^[A-Za-z]{1,40}$/.test(String(err?.name))) parts.push(err.name);
    if (/^[A-Z][A-Z0-9_]{1,40}$/.test(String(err?.code))) parts.push(err.code);
    return parts.length ? ` (${parts.join(', ')})` : '';
};

// Node would print the error's stack, outside LOG_LEVEL. The server still stops.
const stopOnError = (err) => {
    log('error', `Dropgate Server stopped after an unexpected error${describeError(err)}.`);
    process.exit(1);
};
process.on('uncaughtException', stopOnError);
process.on('unhandledRejection', stopOnError);

log('info', 'Dropgate Server is starting...');
log('info', `Log level: ${LOG_LEVEL}`);

const { version } = require('./package.json');

// The protocol versions this server speaks, each on its own, which clients
// check before anything else: the same major works together, and a minor
// only adds to it. `version` is for display only.
const PROTOCOLS = Object.freeze({
    dgup: Object.freeze({ major: 4, minor: 0 }),
    dgdtp: Object.freeze({ major: 4, minor: 0 }),
});
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const rateLimit = require('express-rate-limit').default;
const helmet = require('helmet').default;
const cors = require('cors');
const { ExpressPeerServer } = require('peer');
const { create: contentDisposition } = require('content-disposition');
const { QuickDB, MemoryDriver, SqliteDriver } = require('quick.db');
const { v4: uuidv4 } = require('uuid');

const port = process.env.SERVER_PORT || 52443;
const serverName = process.env.SERVER_NAME || 'Dropgate Server';
log('info', `Server Name: ${serverName}`);

const enableWebUI = process.env.ENABLE_WEB_UI !== 'false';
const enableP2P = process.env.ENABLE_P2P !== 'false';
const enableUpload = process.env.ENABLE_UPLOAD === 'true';
if (!enableUpload && !enableP2P) {
    log('error', 'Both UPLOAD and P2P are disabled. At least one protocol must be enabled for the server to function.');
    process.exit(1);
};

log('info', `Upload Protocol Enabled: ${enableUpload}`);
log('info', `Peer-to-Peer (P2P) Enabled: ${enableP2P}`);
log('info', `Web UI Enabled: ${enableWebUI}`);

// ===== P2P (WebRTC) configuration exposed to clients via /api/info =====
const PEERJS_MOUNT_PATH = '/peerjs';

const parseList = (raw) => {
    if (!raw) return [];
    return String(raw)
        .split(/[\s,]+/g)
        .map((s) => s.trim())
        .filter(Boolean);
};

/**
 * Parse an environment variable as a non-negative integer.
 * @param {string} envName - Name of the env var for error messages
 * @param {string|undefined} raw - Raw env var value
 * @param {number} defaultValue - Default if not set
 * @returns {number} Parsed integer value
 */
const parseEnvInt = (envName, raw, defaultValue) => {
    const value = raw !== undefined ? raw : defaultValue;
    const num = Number(value);
    if (isNaN(num) || num < 0 || !Number.isInteger(num)) {
        log('error', `Invalid ${envName} environment variable. It must be a non-negative integer.`);
        process.exit(1);
    }
    return num;
};

/**
 * Parse an environment variable as a non-negative number (allows decimals).
 * @param {string} envName - Name of the env var for error messages
 * @param {string|undefined} raw - Raw env var value
 * @param {number} defaultValue - Default if not set
 * @returns {number} Parsed numeric value
 */
const parseEnvNumber = (envName, raw, defaultValue) => {
    const value = raw !== undefined ? raw : defaultValue;
    const num = Number(value);
    if (isNaN(num) || num < 0) {
        log('error', `Invalid ${envName} environment variable. It must be a non-negative number.`);
        process.exit(1);
    }
    return num;
};

// Default: public STUN (Cloudflare) so P2P works out of the box.
const p2pStunUrls = process.env.P2P_STUN_SERVERS
    ? parseList(process.env.P2P_STUN_SERVERS)
    : ['stun:stun.cloudflare.com:3478'];

const p2pIceServers = [];
if (p2pStunUrls.length) p2pIceServers.push({ urls: p2pStunUrls });

const uploadEnableE2EE = process.env.UPLOAD_ENABLE_E2EE !== 'false';
if (enableUpload) log('info', `Upload End-to-End Encryption (E2EE) Enabled: ${uploadEnableE2EE}`);

if (enableUpload && uploadEnableE2EE) {
    log('warn', 'Upload E2EE is enabled. The server MUST be running behind a reverse proxy that provides a secure HTTPS connection.');
    log('warn', 'Failure to provide a secure context will cause client-side decryption to fail in the browser.');
}

if (enableP2P) {
    log('warn', 'P2P is enabled. The server MUST be running behind a reverse proxy that provides HTTPS.');
    log('warn', 'Failure to provide a secure context will prevent P2P transfers from working in browsers.');
    log('info', `P2P_STUN_SERVERS: ${p2pStunUrls.length ? p2pStunUrls.join(', ') : 'None'}`);
    log('info', `PeerJS Debug Logging: ${process.env.PEERJS_DEBUG === 'true'}`);
}

const app = express();
// We create the HTTP server manually so we can attach a PeerServer
// to the same port/path (fixed mount: /peerjs).
const server = http.createServer(app);

// Everything the server keeps is in data/, one folder to map and back up. Its
// uploads are in data/uploads/, which default mode clears; the rest of data/
// is the server's own, never cleaned (nothing uses it yet).
const dataDir = path.join(__dirname, 'data');
const uploadDir = path.join(dataDir, 'uploads');
const tmpDir = path.join(uploadDir, 'tmp');
// Stored uploads, in Dropgate 4's format.
const objectsDir = path.join(uploadDir, 'objects');
// Says which version's layout uploads/ holds, so a later version can tell.
const storageMarker = path.join(uploadDir, 'dropgate-storage.json');
const STORAGE_FORMAT = 4;

// Sizes count in 1024s: a MB is 1024 × 1024 bytes, and a GB 1024 MB.
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const cleanupDir = (dirPath) => {
    if (fs.existsSync(dirPath)) {
        log('info', `Cleaning directory: ${dirPath}`);
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            fs.rmSync(path.join(dirPath, file), { recursive: true, force: true });
        }
    }
};

const createDirIfNotExists = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

// Storage used is the uploads stored, in objects/, and the space reserved for
// those in progress. So uploads in progress (tmp/, counted by their
// reservations), the database and the format marker don't count.
const getStoredSize = () => {
    let size = 0;
    if (fs.existsSync(objectsDir)) {
        for (const file of fs.readdirSync(objectsDir)) size += fs.statSync(path.join(objectsDir, file)).size;
    }
    return size;
};

// What a persistent Dropgate 3 server left in uploads/: its two databases, with
// SQLite's own files beside them, and its stored files, named by their IDs.
// Dropgate 4 can't serve any of it, and its links stopped working when 4 started.
const V3_DATABASES = ['file-database.sqlite', 'bundle-database.sqlite'];
const SQLITE_SIDE_FILES = ['', '-wal', '-shm', '-journal'];
const V3_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Delete exactly Dropgate 3's layout in uploads/, and nothing else there.
 * Says how many uploads went, and whether anything did; never which.
 */
const removeV3Leftovers = () => {
    let uploads = 0;
    let removed = false;
    for (const entry of fs.readdirSync(uploadDir, { withFileTypes: true })) {
        if (entry.isFile() && V3_FILE_NAME.test(entry.name)) {
            fs.rmSync(path.join(uploadDir, entry.name), { force: true });
            uploads++;
            removed = true;
        }
    }
    for (const database of V3_DATABASES) {
        for (const suffix of SQLITE_SIDE_FILES) {
            const file = path.join(uploadDir, 'db', database + suffix);
            if (fs.existsSync(file) && fs.statSync(file).isFile()) {
                fs.rmSync(file, { force: true });
                removed = true;
            }
        }
    }
    return { uploads, removed };
};

let preserveUploads = false;
let maxFileSizeMB = 0;
let maxStorageGB = 0;
let maxFileLifetimeHours = 0;
let MAX_FILE_SIZE_BYTES = Infinity;
let MAX_STORAGE_BYTES = Infinity;
let MAX_FILE_LIFETIME_MS = Infinity;
let maxFileDownloads = 1;
let uploadChunkSizeBytes = 5 * 1024 * 1024;
let maxPauseMinutes = 60;
let currentDiskUsage = 0;
// Dropgate 4's stored uploads' records, by ID.
let objectDatabase = null;
// Dropgate 4's uploads in progress, by upload ID, in memory only: what each
// will be, the chunks the server holds with their digests, and its deadline.
// Nothing in one says who sent it.
let v4Uploads = null;
// A finished upload's answer, by upload ID, kept a few minutes so that
// finishing again gets the same answer.
let v4Finished = null;
// Dropgate 4's download leases, by lease ID, and each stored upload's open
// leases, in memory only. A lease says which upload it's for and how far it
// has got, never who holds it, and none survives a restart.
let v4Leases = null;
let v4LeasesByObject = null;

// Security: Mutex for atomic quota checking (prevents TOCTOU race condition)
let quotaLock = Promise.resolve();
const acquireQuotaLock = () => {
    let release;
    const acquire = new Promise(resolve => { release = resolve; });
    const previousLock = quotaLock;
    quotaLock = acquire;
    return previousLock.then(() => release);
};

// The space held for the uploads in progress.
const reservedBytes = () => {
    let total = 0;
    v4Uploads.forEach((u) => { total += u.size; });
    return total;
};

// Security: Limits to prevent DoS attacks
const MAX_CHUNKS = 100000; // Maximum chunks per upload (~500GB at 5MB chunks)
const MAX_BUNDLE_FILES = 1000; // Maximum files per upload

if (enableUpload) {
    preserveUploads = process.env.UPLOAD_PRESERVE_UPLOADS === 'true';
    log('info', `UPLOAD_PRESERVE_UPLOADS: ${preserveUploads}`);

    maxFileSizeMB = parseEnvInt('UPLOAD_MAX_FILE_SIZE_MB', process.env.UPLOAD_MAX_FILE_SIZE_MB, 100);
    MAX_FILE_SIZE_BYTES = maxFileSizeMB === 0 ? Infinity : maxFileSizeMB * MIB;
    log('info', `UPLOAD_MAX_FILE_SIZE_MB: ${maxFileSizeMB} MB`);
    if (maxFileSizeMB === 0) {
        log('warn', 'UPLOAD_MAX_FILE_SIZE_MB is set to 0! Files of any size can be uploaded.');
    }

    // Dropgate 4 removed per-file limits: a bundle is one upload, and the limit
    // applies to all of it. A server set to per-file would allow less than its
    // operator meant, so it doesn't start. This check goes in a later version.
    const bundleSizeModeRaw = process.env.UPLOAD_BUNDLE_SIZE_MODE;
    if (bundleSizeModeRaw !== undefined) {
        if (bundleSizeModeRaw.trim().toLowerCase() === 'per-file') {
            log('error', 'UPLOAD_BUNDLE_SIZE_MODE was removed in Dropgate 4, and per-file size limits with it: UPLOAD_MAX_FILE_SIZE_MB now applies to the whole upload, all its files together. Remove UPLOAD_BUNDLE_SIZE_MODE to start the server.');
            process.exit(1);
        }
        log('warn', 'UPLOAD_BUNDLE_SIZE_MODE was removed in Dropgate 4 and is ignored: UPLOAD_MAX_FILE_SIZE_MB applies to the whole upload, all its files together.');
    }

    maxStorageGB = parseEnvNumber('UPLOAD_MAX_STORAGE_GB', process.env.UPLOAD_MAX_STORAGE_GB, 10);
    MAX_STORAGE_BYTES = maxStorageGB === 0 ? Infinity : maxStorageGB * GIB;
    log('info', `UPLOAD_MAX_STORAGE_GB: ${maxStorageGB} GB`);
    if (maxStorageGB === 0) {
        log('warn', 'UPLOAD_MAX_STORAGE_GB is set to 0! Consider setting a limit on total storage used by uploaded files to prevent disk exhaustion.');
    }

    if (maxFileSizeMB > (maxStorageGB * 1024) && maxStorageGB !== 0) {
        log('warn', 'UPLOAD_MAX_FILE_SIZE_MB is larger than UPLOAD_MAX_STORAGE_GB! Any uploads larger than the allocated storage quota will be rejected.');
    }

    maxFileLifetimeHours = parseEnvNumber('UPLOAD_MAX_FILE_LIFETIME_HOURS', process.env.UPLOAD_MAX_FILE_LIFETIME_HOURS, 24);
    MAX_FILE_LIFETIME_MS = maxFileLifetimeHours === 0 ? Infinity : maxFileLifetimeHours * 60 * 60 * 1000;
    log('info', `UPLOAD_MAX_FILE_LIFETIME_HOURS: ${maxFileLifetimeHours} hours`);
    if (maxFileLifetimeHours === 0) {
        log('warn', 'UPLOAD_MAX_FILE_LIFETIME_HOURS is set to 0! Files will never expire.');
    }

    maxFileDownloads = parseEnvInt('UPLOAD_MAX_FILE_DOWNLOADS', process.env.UPLOAD_MAX_FILE_DOWNLOADS, 1);
    log('info', `UPLOAD_MAX_FILE_DOWNLOADS: ${maxFileDownloads}`);
    if (maxFileDownloads === 0) {
        log('warn', 'UPLOAD_MAX_FILE_DOWNLOADS is set to 0! Files can be downloaded unlimited times.');
    }

    uploadChunkSizeBytes = parseEnvInt('UPLOAD_CHUNK_SIZE_BYTES', process.env.UPLOAD_CHUNK_SIZE_BYTES, 5 * 1024 * 1024);
    if (uploadChunkSizeBytes < 65536) {
        log('error', 'UPLOAD_CHUNK_SIZE_BYTES must be at least 65536 (64KB). Smaller values cause extreme fragmentation and per-chunk overhead.');
        process.exit(1);
    }
    // The most an upload's object can say it uses, and each chunk is held in memory as it arrives.
    if (uploadChunkSizeBytes > 64 * MIB) {
        log('error', 'UPLOAD_CHUNK_SIZE_BYTES must be at most 67108864 (64 MB).');
        process.exit(1);
    }
    log('info', `UPLOAD_CHUNK_SIZE_BYTES: ${uploadChunkSizeBytes} bytes (${(uploadChunkSizeBytes / MIB).toFixed(2)} MB)`);

    // How long a paused upload is kept, in whole minutes: 1 to 1440 (a day), or 0 to turn pausing off.
    const maxPauseMinutesRaw = process.env.UPLOAD_MAX_PAUSE_MINUTES;
    if (maxPauseMinutesRaw !== undefined) {
        const text = maxPauseMinutesRaw.trim();
        if (!/^\d{1,4}$/.test(text) || Number(text) > 1440) {
            log('error', 'Invalid UPLOAD_MAX_PAUSE_MINUTES environment variable. It must be a whole number of minutes from 1 to 1440, or 0 to turn pausing off.');
            process.exit(1);
        }
        maxPauseMinutes = Number(text);
    }
    log('info', `UPLOAD_MAX_PAUSE_MINUTES: ${maxPauseMinutes === 0 ? '0 (pausing is off)' : `${maxPauseMinutes} minutes`}`);

    if (!preserveUploads) {
        log('info', 'Clearing any existing uploads on startup...');
        cleanupDir(uploadDir);
    }
    log('info', 'Clearing any uploads left in progress...');
    cleanupDir(tmpDir);

    createDirIfNotExists(uploadDir);
    createDirIfNotExists(tmpDir);
    createDirIfNotExists(objectsDir);
    if (preserveUploads) {
        createDirIfNotExists(path.join(uploadDir, 'db'));
        // Default mode has just cleared them with everything else.
        const leftovers = removeV3Leftovers();
        if (leftovers.removed) {
            log('info', `Removed ${leftovers.uploads} ${leftovers.uploads === 1 ? 'upload' : 'uploads'} left by Dropgate 3. Dropgate 4 can't serve them, and their links stopped working when it started.`);
        }
    }
    fs.writeFileSync(storageMarker, `${JSON.stringify({ format: STORAGE_FORMAT })}\n`);

    currentDiskUsage = getStoredSize();
    setInterval(() => { currentDiskUsage = getStoredSize(); }, 300000); // Sync every 5 minutes in case of discrepancies
    if (maxStorageGB !== 0) {
        log('info', `Current server capacity: ${(currentDiskUsage / GIB).toFixed(2)} GB / ${maxStorageGB} GB`);
    }

    if (preserveUploads) {
        const driver = new SqliteDriver(path.join(uploadDir, 'db', 'objects.sqlite'));
        // SQLite leaves a deleted record's bytes in the file until something
        // overwrites them. This writes zeros over them as it deletes, so an
        // upload that's gone leaves nothing behind.
        driver.database.pragma('secure_delete = ON');
        objectDatabase = new QuickDB({ driver });
    } else {
        objectDatabase = new QuickDB({ driver: new MemoryDriver() });
    }
    v4Uploads = new Map();
    v4Finished = new Map();
    v4Leases = new Map();
    v4LeasesByObject = new Map();
    log('info', `File database is ready. (${preserveUploads ? 'persistent' : 'in-memory'})`);
} else {
    log('info', 'Upload protocol disabled. Cleaning up upload directory...');
    cleanupDir(uploadDir);
}
createDirIfNotExists(dataDir);
log('info', 'Configuring server endpoints and middleware...');

app.set('trust proxy', 1); // Trust the first hop from a reverse proxy
app.disable('x-powered-by');

// Templating
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// The API answers any origin: the desktop app and other integrators call it
// from their own, and no cookie is ever set or sent, so there's nothing for
// another site to borrow. It allows the headers Dropgate's requests send, and
// lets a script read the ones its answers carry. Pages get no CORS headers.
const API_CORS = {
    allowedHeaders: ['Content-Type', 'Content-Digest', 'Range', 'If-Range', 'Authorization', 'Dropgate-Upload', 'Dropgate-Lease', 'Dropgate-Manage-Token'],
    exposedHeaders: ['ETag', 'Content-Range', 'Accept-Ranges', 'Retry-After', 'Content-Length'],
};
app.use('/api', cors(API_CORS));

// Dropgate 3's API paths. A Dropgate 3 client stops before them, at /api/info,
// which says this server speaks version 4; anything that asks anyway is told
// to update, whatever it sent, before any body is read.
const fromDropgate3 = (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(410).json({ code: 'VERSION_UNSUPPORTED', error: 'This server runs Dropgate 4. Update the app to use it.' });
};
app.use('/upload', cors(API_CORS));
app.use('/upload', fromDropgate3);
app.use('/api/file', fromDropgate3);
app.use('/api/bundle', fromDropgate3);
// An upload's start carries its sealed file list, up to 1 MiB before base64url.
const jsonBody = express.json({ limit: '1mb' });
const uploadStartBody = express.json({ limit: '2mb' });
app.use((req, res, next) => (req.path === '/api/v4/uploads' ? uploadStartBody : jsonBody)(req, res, next));
app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('base64');
    next();
});

// Use Helmet for security headers, but leave HSTS to the reverse proxy.
app.use(
    helmet({
        hsts: false, // HSTS should be handled by the reverse proxy
        crossOriginOpenerPolicy: { policy: 'same-origin' },
        crossOriginResourcePolicy: { policy: 'same-origin' },
        contentSecurityPolicy: {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                'upgrade-insecure-requests': null, // This should also be managed by the proxy
                'script-src': ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
                'style-src': ["'self'", "'unsafe-inline'"], // Required for inline style attributes
                'connect-src': ["'self'"],
                'frame-src': ["'self'"],
                'worker-src': ["'self'", 'blob:'],
                'child-src': ["'self'", 'blob:'],
                'base-uri': ["'self'"],
                'form-action': ["'self'"],
                'object-src': ["'none'"],
                'frame-ancestors': ["'self'"],
                'font-src': ["'self'"],
                'media-src': ["'none'"],
            },
        },
        permittedCrossDomainPolicies: { permittedPolicies: 'none' }, // Block Flash/PDF cross-domain access
    })
);

// Disable unnecessary browser features via Permissions-Policy.
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), autoplay=(), fullscreen=(self)');
    next();
});

// Static assets (after Helmet so headers apply)
app.use(express.static(path.join(__dirname, 'public')));

// Helper to serve vendor files
const serveVendorFile = (filePath, contentType) => (req, res) => {
    try {
        const p = path.join(__dirname, 'node_modules', filePath);
        if (!fs.existsSync(p)) return res.status(404).end();
        res.setHeader('Content-Type', contentType);
        res.sendFile(p);
    } catch {
        res.status(404).end();
    }
};

// Vendor files
app.get('/vendor/bootstrap/bootstrap.min.css', serveVendorFile('bootstrap/dist/css/bootstrap.min.css', 'text/css; charset=utf-8'));
app.get('/vendor/bootstrap/bootstrap.min.js', serveVendorFile('bootstrap/dist/js/bootstrap.min.js', 'application/javascript; charset=utf-8'));
app.get('/vendor/streamsaver/streamsaver.js', serveVendorFile('streamsaver/StreamSaver.js', 'application/javascript; charset=utf-8'));
app.get('/vendor/streamsaver/mitm.html', (req, res) => res.render('pages/mitm'));
app.get('/vendor/streamsaver/sw.js', serveVendorFile('streamsaver/sw.js', 'application/javascript; charset=utf-8'));
// Any other request under StreamSaver's folder is a download address that only
// its service worker answers, which a browser has sent here instead: Firefox's
// own Resume does, once the page's stream has gone. Answering it with a page
// would have the browser save that page as the file, marked complete, so the
// connection is dropped, and the browser marks the download failed.
app.use('/vendor/streamsaver/', (req) => req.socket.destroy());
app.get('/vendor/peerjs/peerjs.min.js', serveVendorFile('peerjs/dist/peerjs.min.js', 'application/javascript; charset=utf-8'));
app.get('/vendor/qr-code-styling/qr-code-styling.js', serveVendorFile('qr-code-styling/lib/qr-code-styling.js', 'application/javascript; charset=utf-8'));
app.get('/vendor/material-icons/round.css', serveVendorFile('material-icons/iconfont/round.css', 'text/css; charset=utf-8'));
app.get('/vendor/material-icons/material-icons-round.woff2', serveVendorFile('material-icons/iconfont/material-icons-round.woff2', 'font/woff2'));
app.get('/vendor/material-icons/material-icons-round.woff', serveVendorFile('material-icons/iconfont/material-icons-round.woff', 'font/woff'));

const rateLimitWindowMs = process.env.RATE_LIMIT_WINDOW_MS ? process.env.RATE_LIMIT_WINDOW_MS : 60000;
const rateLimitMaxRequests = process.env.RATE_LIMIT_MAX_REQUESTS ? process.env.RATE_LIMIT_MAX_REQUESTS : 25;
if (isNaN(rateLimitWindowMs) || rateLimitWindowMs < 0 || !Number.isInteger(Number(rateLimitWindowMs))) {
    log('error', 'Invalid RATE_LIMIT_WINDOW_MS environment variable. It must be a non-negative integer.');
    process.exit(1);
}
if (isNaN(rateLimitMaxRequests) || rateLimitMaxRequests < 0 || !Number.isInteger(Number(rateLimitMaxRequests))) {
    log('error', 'Invalid RATE_LIMIT_MAX_REQUESTS environment variable. It must be a non-negative integer.');
    process.exit(1);
}

if (Number(rateLimitMaxRequests) === 0) {
    log('warn', 'RATE_LIMIT_MAX_REQUESTS is set to 0! Rate limiting is disabled.');
}

if (Number(rateLimitWindowMs) === 0) {
    log('warn', 'RATE_LIMIT_WINDOW_MS is set to 0! Rate limiting is disabled.');
}

log('info', `RATE_LIMIT_WINDOW_MS: ${rateLimitWindowMs} ms`);
log('info', `RATE_LIMIT_MAX_REQUESTS: ${rateLimitMaxRequests} requests`);
let limiter = (_req, _res, next) => next();
if (Number(rateLimitMaxRequests) > 0 && Number(rateLimitWindowMs) > 0) {
    limiter = rateLimit({
        windowMs: Number(rateLimitWindowMs),
        max: Number(rateLimitMaxRequests),
        standardHeaders: true,
        legacyHeaders: false,
        // The limiter's own checks, such as a reverse proxy sending a client
        // address it can't read, go through LOG_LEVEL by their code only: their
        // messages can quote the address.
        logger: {
            warn: (err) => log('warn', `The rate limiter reported a problem with the server's setup${describeError(err)}.`),
            error: (err) => log('error', `The rate limiter reported a problem with the server's setup${describeError(err)}.`),
        },
        handler: (_req, res) => {
            log('warn', 'Rate limit triggered. Request blocked.');
            res.status(429).json({ code: 'RATE_LIMITED', error: 'Too many requests, please try again later.' });
        },
    });
}

const apiRouter = express.Router();
// Dropgate 4's routes. Their answers are never cached.
const v4Router = express.Router();
v4Router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// Express hands a router's error on without the path the router is mounted
// at, so each router notes the route's pattern (never the request's path,
// which can hold an ID) for the last handler's log line.
const noteRoute = (err, req, res, next) => {
    if (req.route?.path && !res.locals.failedRoute) res.locals.failedRoute = `${req.method} ${req.baseUrl}${req.route.path}`;
    next(err);
};

// An upload is gone the moment it expires: every route answers as if it had
// never existed, and the expiry sweep removes its bytes later.
const isLive = (record) => Boolean(record) && !(record.expiresAt && record.expiresAt <= Date.now());

// ===== Dropgate 4's uploads =====
// One upload is one object, a file or a bundle alike: started, sent in chunks
// that can be sent again, then finished. Every route after the start names the
// upload in the Dropgate-Upload header, never in its URL.

// An encrypted object starts with a 60-byte header, and every chunk carries a
// 16-byte tag. The server reads only the header's format and chunk size.
const OBJECT_HEADER_BYTES = 60;
const CHUNK_TAG_BYTES = 16;
const OBJECT_MAGIC = Buffer.from('DGUP', 'ascii');
const OBJECT_VERSION = 4;
const OBJECT_SUITE = 1;
// The sealed file list: a 12-byte nonce and a 16-byte tag around at most 1 MiB.
const MAX_META_BYTES = MIB + 28;
// An upload with no request for this long ends, unless it's paused.
const UPLOAD_QUIET_MS = 5 * 60 * 1000;
// How long a finished upload's answer is kept for a repeated finish.
const FINISHED_ANSWER_MS = 5 * 60 * 1000;

/** The bytes a base64url string (no padding) holds, if it's exactly that, and `length` of them when given. */
const fromBase64url = (value, length) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return null;
    return length === undefined || bytes.length === length ? bytes : null;
};

/** The one file name rule: not empty, at most 255 UTF-8 bytes, no control character, no path separator. */
const isValidFileName = (name) => typeof name === 'string'
    && name.trim().length > 0
    && Buffer.byteLength(name, 'utf8') <= 255
    && !/\p{Cc}/u.test(name)
    && !/[/\\]/.test(name);

/** The SHA-256 digest in a Content-Digest header (`sha-256=:<base64>:`), or null. */
const sha256FromContentDigest = (header) => {
    if (typeof header !== 'string') return null;
    for (const member of header.split(',')) {
        const match = /^\s*sha-256=:([A-Za-z0-9+/]+={0,2}):\s*$/.exec(member);
        if (match) {
            const digest = Buffer.from(match[1], 'base64');
            return digest.length === 32 ? digest : null;
        }
    }
    return null;
};

/**
 * How many chunks an upload of `size` stored bytes has at chunk size `chunkSize`,
 * or 0 when no object can be that size: an encrypted object's chunks are each
 * `chunkSize` + 16 bytes, but the last, which is 17 to `chunkSize` + 16.
 */
const chunkCountFor = (encrypted, size, chunkSize) => {
    if (!encrypted) return Math.ceil(size / chunkSize);
    const body = size - OBJECT_HEADER_BYTES;
    if (body <= CHUNK_TAG_BYTES) return 0;
    const stride = chunkSize + CHUNK_TAG_BYTES;
    const count = Math.ceil(body / stride);
    return body - (count - 1) * stride > CHUNK_TAG_BYTES ? count : 0;
};

/** Where chunk `index` of an upload goes in its object, and how long it is. */
const chunkPlace = (upload, index) => {
    const base = upload.encrypted ? OBJECT_HEADER_BYTES : 0;
    const stride = upload.encrypted ? upload.chunkSize + CHUNK_TAG_BYTES : upload.chunkSize;
    const offset = base + index * stride;
    return { offset, length: index === upload.chunks - 1 ? upload.size - offset : stride };
};

/** The chunks an upload holds, as inclusive ranges: [[0, 11], [13, 13]]. */
const receivedRanges = (upload) => {
    const ranges = [];
    for (const index of [...upload.received.keys()].sort((a, b) => a - b)) {
        const last = ranges[ranges.length - 1];
        if (last && last[1] === index - 1) last[1] = index;
        else ranges.push([index, index]);
    }
    return ranges;
};

// Every unknown, ended, dropped or deleted upload, and every unknown or ended
// download, gets the same answer, so nothing says which.
const uploadNotFound = (res) => res.status(404).json({ code: 'NOT_FOUND', error: 'The server has no such upload.' });

if (enableUpload) {
    // An upload's credential is checked here, on every upload route, once the
    // server can ask for one (capabilities.upload.credentialRequired). It asks
    // for none yet, so this checks nothing. It must never log the credential.
    const uploadCredential = (_req, _res, next) => next();

    // The routes after the start skip the rate limiter for an upload that's
    // in progress, or just finished, as Dropgate 3's did.
    const v4UploadAuth = (req, res, next) => {
        const uploadId = req.get('Dropgate-Upload');
        if (uploadId && (v4Uploads.has(uploadId) || v4Finished.has(uploadId))) return next();
        return limiter(req, res, next);
    };

    const sizeInMB = (bytes) => (bytes / MIB).toFixed(2);

    const invalidRequest = (res, field) => res.status(400).json({
        code: 'INVALID_REQUEST',
        error: 'A field of the request is missing or wrong.',
        ...(field ? { details: { field } } : {}),
    });

    /** Ends an upload: its timer, its temp file and its reservation go. */
    const dropUpload = (upload) => {
        if (v4Uploads.get(upload.id) !== upload) return false;
        clearTimeout(upload.timer);
        v4Uploads.delete(upload.id);
        // A chunk still being written removes it when it's done (see the chunk route).
        try { fs.rmSync(upload.tempFilePath, { force: true }); } catch { }
        return true;
    };

    /** The upload ends at once `ms` from now, unless something renews it. */
    const setDeadline = (upload, ms) => {
        clearTimeout(upload.timer);
        upload.deadline = Date.now() + ms;
        upload.timer = setTimeout(() => endAtDeadline(upload), ms);
    };

    const endAtDeadline = (upload) => {
        if (v4Uploads.get(upload.id) !== upload) return;
        // A chunk still arriving isn't quiet.
        if (upload.busy > 0) return setDeadline(upload, UPLOAD_QUIET_MS);
        dropUpload(upload);
        log('debug', `Upload ended at its deadline${upload.paused ? ' while paused' : ''}. Released ${sizeInMB(upload.size)} MB.`);
    };

    /** Any request renews a quiet upload's deadline; only pausing renews a paused one's. */
    const renew = (upload) => {
        if (!upload.paused) setDeadline(upload, UPLOAD_QUIET_MS);
    };

    /** The upload the request names, if it's in progress and not being finished. */
    const requestedUpload = (req) => {
        const upload = v4Uploads.get(req.get('Dropgate-Upload'));
        if (!upload || upload.finishing) return null;
        if (upload.deadline <= Date.now()) endAtDeadline(upload);
        return v4Uploads.get(upload.id) === upload ? upload : null;
    };

    v4Router.post('/uploads', limiter, uploadCredential, async (req, res) => {
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) return invalidRequest(res);
        const { encrypted, size, header, meta, files, lifetimeMs, maxDownloads } = body;

        if (typeof encrypted !== 'boolean') return invalidRequest(res, 'encrypted');
        if (!Number.isSafeInteger(size) || size < 1) return invalidRequest(res, 'size');
        let headerBytes = null;
        let manifest = null;
        if (encrypted) {
            headerBytes = fromBase64url(header, OBJECT_HEADER_BYTES);
            if (!headerBytes) return invalidRequest(res, 'header');
            const metaBytes = fromBase64url(meta);
            if (!metaBytes || metaBytes.length <= 28 || metaBytes.length > MAX_META_BYTES) return invalidRequest(res, 'meta');
            if (files !== undefined) return invalidRequest(res, 'files');
        } else {
            if (header !== undefined) return invalidRequest(res, 'header');
            if (meta !== undefined) return invalidRequest(res, 'meta');
            if (!Array.isArray(files) || files.length < 1 || files.length > MAX_BUNDLE_FILES) return invalidRequest(res, 'files');
            manifest = [];
            let total = 0;
            for (const file of files) {
                if (!file || !isValidFileName(file.name) || !Number.isSafeInteger(file.size) || file.size < 1) return invalidRequest(res, 'files');
                total += file.size;
                manifest.push({ name: file.name, size: file.size });
            }
            if (total !== size) return invalidRequest(res, 'files');
        }
        if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 0) return invalidRequest(res, 'lifetimeMs');
        if (maxDownloads !== undefined && (!Number.isSafeInteger(maxDownloads) || maxDownloads < 0)) return invalidRequest(res, 'maxDownloads');
        if (!fromBase64url(body.manageTokenHash, 32)) return invalidRequest(res, 'manageTokenHash');

        if (encrypted && !uploadEnableE2EE) {
            return res.status(400).json({ code: 'E2EE_DISABLED', error: 'This server doesn\'t accept encrypted uploads.' });
        }
        if (encrypted) {
            const known = headerBytes.subarray(0, 4).equals(OBJECT_MAGIC)
                && headerBytes[4] === OBJECT_VERSION && headerBytes[5] === OBJECT_SUITE
                && headerBytes[6] === 0 && headerBytes[7] === 0;
            if (!known) {
                return res.status(400).json({ code: 'UNSUPPORTED_OBJECT', error: 'This upload is in a format this server doesn\'t store.' });
            }
            if (headerBytes.readUInt32BE(8) !== uploadChunkSizeBytes) {
                return res.status(400).json({ code: 'CHUNK_SIZE_MISMATCH', error: 'This upload\'s chunk size isn\'t the server\'s.' });
            }
        }
        const chunks = chunkCountFor(encrypted, size, uploadChunkSizeBytes);
        if (chunks === 0 || chunks > MAX_CHUNKS) return invalidRequest(res, 'size');
        if (size > MAX_FILE_SIZE_BYTES) {
            return res.status(413).json({ code: 'TOO_LARGE', error: `This upload is over the server's limit of ${maxFileSizeMB} MB.` });
        }

        if (MAX_FILE_LIFETIME_MS !== Infinity) {
            if (lifetimeMs === 0) {
                return res.status(400).json({ code: 'LIFETIME_NOT_ALLOWED', error: `This server doesn't keep uploads without a limit: at most ${maxFileLifetimeHours} hours.` });
            }
            if (lifetimeMs > MAX_FILE_LIFETIME_MS) {
                return res.status(400).json({ code: 'LIFETIME_NOT_ALLOWED', error: `This server keeps uploads for at most ${maxFileLifetimeHours} hours.` });
            }
        }

        // Dropgate 3's rules: a server limit of 1 is always 1; otherwise the
        // upload's own, within the server's.
        let effectiveMaxDownloads = maxFileDownloads;
        if (maxDownloads !== undefined && maxFileDownloads !== 1) {
            if (maxFileDownloads !== 0 && maxDownloads === 0) {
                return res.status(400).json({ code: 'DOWNLOADS_NOT_ALLOWED', error: `This server doesn't allow unlimited downloads: at most ${maxFileDownloads}.` });
            }
            if (maxFileDownloads !== 0 && maxDownloads > maxFileDownloads) {
                return res.status(400).json({ code: 'DOWNLOADS_NOT_ALLOWED', error: `This server allows at most ${maxFileDownloads} downloads.` });
            }
            effectiveMaxDownloads = maxDownloads;
        }

        const releaseLock = await acquireQuotaLock();
        let upload;
        try {
            const reserved = reservedBytes();
            if (currentDiskUsage + reserved + size > MAX_STORAGE_BYTES) {
                log('debug', `Upload rejected due to insufficient storage. Current usage: ${(currentDiskUsage / GIB).toFixed(2)} GB, Reserved: ${(reserved / GIB).toFixed(2)} GB, Requested: ${(size / GIB).toFixed(2)} GB.`);
                return res.status(507).json({ code: 'SERVER_FULL', error: 'The server is out of space. Try again later.' });
            }
            const id = uuidv4();
            const tempFilePath = path.join(tmpDir, id);
            fs.writeFileSync(tempFilePath, encrypted ? headerBytes : '');
            upload = {
                id,
                tempFilePath,
                encrypted,
                size,
                chunkSize: uploadChunkSizeBytes,
                chunks,
                meta: encrypted ? meta : undefined,
                files: manifest ?? undefined,
                lifetimeMs,
                maxDownloads: effectiveMaxDownloads,
                manageTokenHash: body.manageTokenHash,
                // Chunk index → SHA-256 digest: those written, and those being written.
                received: new Map(),
                writing: new Map(),
                paused: false,
                deadline: 0,
                timer: null,
                busy: 0,
                finishing: null,
            };
            v4Uploads.set(id, upload);
            setDeadline(upload, UPLOAD_QUIET_MS);
        } finally {
            releaseLock();
        }

        log('debug', `Upload started. Reserved ${sizeInMB(size)} MB.`);
        res.status(201).json({ uploadId: upload.id, chunks, chunkSize: upload.chunkSize, deadline: upload.deadline });
    });

    v4Router.put('/upload/chunks/:index', v4UploadAuth, uploadCredential, async (req, res) => {
        // An answer before the body is read closes the connection, so the rest
        // of the body is never read.
        res.set('Connection', 'close');
        const upload = requestedUpload(req);
        if (!upload) return uploadNotFound(res);
        renew(upload);
        // Only a chunk sent while paused resumes the upload: one already on its
        // way when the pause came was stopped by it, and leaves it paused.
        const sentWhilePaused = upload.paused;

        const index = /^\d{1,6}$/.test(req.params.index) ? Number(req.params.index) : -1;
        if (index < 0 || index >= upload.chunks) {
            return res.status(400).json({ code: 'INVALID_CHUNK', error: 'There is no chunk with that index in this upload.' });
        }
        const { offset, length } = chunkPlace(upload, index);
        const wrongLength = () => res.status(400).json({ code: 'INVALID_CHUNK', error: 'That chunk is the wrong length.' });
        const declared = req.get('Content-Length');
        if (declared !== undefined && Number(declared) !== length) return wrongLength();
        const digest = sha256FromContentDigest(req.get('Content-Digest'));
        const digestMismatch = () => res.status(400).json({ code: 'DIGEST_MISMATCH', error: 'The chunk\'s Content-Digest is missing, or doesn\'t match its bytes.' });
        if (!digest) return digestMismatch();
        res.removeHeader('Connection');

        upload.busy++;
        let body;
        try {
            // Read no more than the chunk's length: one byte past it, and it's refused.
            body = await new Promise((resolve) => {
                // A body sent as JSON was read already, and isn't a chunk.
                if (req.readableEnded) return resolve({ bytes: Buffer.alloc(0) });
                const parts = [];
                let received = 0;
                const done = (result) => {
                    req.off('data', onData);
                    req.off('end', onEnd);
                    req.off('close', onClose);
                    req.off('error', onClose);
                    resolve(result);
                };
                const onData = (part) => {
                    received += part.length;
                    if (received > length) return done({ tooLong: true });
                    parts.push(part);
                };
                const onEnd = () => done({ bytes: Buffer.concat(parts, received) });
                // The connection went before the whole chunk came: nothing is kept.
                const onClose = () => done({ dropped: true });
                req.on('data', onData);
                req.on('end', onEnd);
                req.on('close', onClose);
                req.on('error', onClose);
            });
        } finally {
            upload.busy--;
        }
        if (body.dropped) return renew(upload);
        if (body.tooLong) {
            res.set('Connection', 'close');
            return wrongLength();
        }
        if (v4Uploads.get(upload.id) !== upload) return uploadNotFound(res);
        renew(upload);
        if (body.bytes.length !== length) return wrongLength(res);
        if (!crypto.createHash('sha256').update(body.bytes).digest().equals(digest)) return digestMismatch(res);

        // A chunk the server already holds isn't written again: the same bytes are
        // fine, different bytes are refused. It compares the digests it kept.
        const held = upload.received.get(index) ?? upload.writing.get(index);
        if (!held) {
            upload.writing.set(index, digest);
            try {
                const file = await fs.promises.open(upload.tempFilePath, 'r+');
                try {
                    await file.write(body.bytes, 0, length, offset);
                } finally {
                    await file.close();
                }
            } catch (err) {
                upload.writing.delete(index);
                // A cancelled or ended upload's file is gone, which isn't the server's fault.
                if (v4Uploads.get(upload.id) !== upload) return uploadNotFound(res);
                throw err;
            }
            upload.writing.delete(index);
            if (v4Uploads.get(upload.id) !== upload) {
                // It ended while this chunk was being written, so its file is this chunk's to remove.
                fs.rm(upload.tempFilePath, { force: true }, () => { });
                return uploadNotFound(res);
            }
            upload.received.set(index, digest);
            log('debug', `Received chunk ${index + 1}/${upload.chunks}. Size: ${(length / 1024).toFixed(2)} KB`);
        } else if (!held.equals(digest)) {
            return res.status(409).json({ code: 'CHUNK_CONFLICT', error: 'The server already holds different bytes for that chunk.' });
        }

        // A chunk sent while paused resumes the upload.
        if (upload.paused && sentWhilePaused) {
            upload.paused = false;
            log('debug', 'Upload resumed.');
        }
        renew(upload);
        res.status(200).json({ deadline: upload.deadline });
    });

    v4Router.get('/upload', v4UploadAuth, uploadCredential, (req, res) => {
        const upload = requestedUpload(req);
        if (!upload) return uploadNotFound(res);
        renew(upload);
        res.status(200).json({ chunks: upload.chunks, received: receivedRanges(upload), paused: upload.paused, deadline: upload.deadline });
    });

    v4Router.post('/upload/pause', v4UploadAuth, uploadCredential, (req, res) => {
        const upload = requestedUpload(req);
        if (!upload) return uploadNotFound(res);
        if (maxPauseMinutes === 0) {
            renew(upload);
            return res.status(409).json({ code: 'PAUSE_DISABLED', error: 'Pausing is turned off on this server.' });
        }
        // Pausing again renews the pause from now.
        upload.paused = true;
        setDeadline(upload, maxPauseMinutes * 60 * 1000);
        log('debug', 'Upload paused.');
        res.status(200).json({ paused: true, deadline: upload.deadline });
    });

    v4Router.post('/upload/resume', v4UploadAuth, uploadCredential, (req, res) => {
        const upload = requestedUpload(req);
        if (!upload) return uploadNotFound(res);
        if (upload.paused) log('debug', 'Upload resumed.');
        upload.paused = false;
        renew(upload);
        res.status(200).json({ paused: false, deadline: upload.deadline, received: receivedRanges(upload) });
    });

    v4Router.post('/upload/complete', v4UploadAuth, uploadCredential, async (req, res) => {
        // Finishing again gets the same answer, while it's kept.
        const uploadId = req.get('Dropgate-Upload');
        const finished = uploadId ? v4Finished.get(uploadId) : undefined;
        if (finished) return res.status(201).json({ id: finished.id });
        const finishing = uploadId ? v4Uploads.get(uploadId)?.finishing : null;
        if (finishing) return res.status(201).json({ id: await finishing });

        const upload = requestedUpload(req);
        if (!upload) return uploadNotFound(res);
        if (upload.received.size !== upload.chunks) {
            renew(upload);
            return res.status(409).json({
                code: 'UPLOAD_INCOMPLETE',
                error: 'The server doesn\'t hold every chunk of this upload yet.',
                details: { received: receivedRanges(upload) },
            });
        }
        upload.finishing = finishUpload(upload);
        res.status(201).json({ id: await upload.finishing });
    });

    /** Stores a whole upload as its object, writes its record, and ends it. Gives the object's ID. */
    const finishUpload = async (upload) => {
        clearTimeout(upload.timer);
        const id = uuidv4();
        const objectPath = path.join(objectsDir, id);
        try {
            if (fs.statSync(upload.tempFilePath).size !== upload.size) throw new Error('The upload is not the size it was started with.');
            fs.renameSync(upload.tempFilePath, objectPath);
            // The record: only what serving and ending the upload needs. Its ID
            // is the object's file name. No creation time, address or account.
            const record = {
                encrypted: upload.encrypted,
                size: upload.size,
                ...(upload.encrypted ? { meta: upload.meta } : { files: upload.files }),
                expiresAt: upload.lifetimeMs > 0 ? Date.now() + upload.lifetimeMs : null,
                maxDownloads: upload.maxDownloads,
                ...(upload.maxDownloads > 0 ? { downloadCount: 0 } : {}),
                manageTokenHash: upload.manageTokenHash,
            };
            await objectDatabase.set(id, record);
        } catch (err) {
            fs.rmSync(objectPath, { force: true });
            dropUpload(upload);
            throw err;
        }
        currentDiskUsage += upload.size;
        v4Uploads.delete(upload.id);
        const forget = setTimeout(() => v4Finished.delete(upload.id), FINISHED_ANSWER_MS);
        v4Finished.set(upload.id, { id, forget });
        log('debug', `Upload finished.${maxStorageGB !== 0 ? ` Server capacity: ${(currentDiskUsage / GIB).toFixed(2)} GB / ${maxStorageGB} GB.` : ''}`);
        return id;
    };

    // Cancelling never removes a finished upload: that's the uploader's delete, with its manage token.
    v4Router.delete('/upload', v4UploadAuth, uploadCredential, (req, res) => {
        const upload = requestedUpload(req);
        if (!upload) return uploadNotFound(res);
        dropUpload(upload);
        log('debug', `Upload cancelled by client. Released ${sizeInMB(upload.size)} MB.`);
        res.status(204).end();
    });
}

// ===== Dropgate 4's downloads =====
// A stored upload's metadata takes nothing and counts nothing. Its bytes are
// sent under a lease, named in the Dropgate-Lease header, and one lease is one
// download: it counts once, when it ends, if it served any byte, whether it was
// released or ran out. At its download limit the upload goes at once.

// A lease with no request for this long ends, unless it's paused.
const LEASE_QUIET_MS = 5 * 60 * 1000;
// How long a download that has to wait for another to end is asked to wait before trying again.
const DOWNLOADS_BUSY_RETRY_SECONDS = 5;
const OBJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const capacityNote = () => (maxStorageGB !== 0 ? ` Server capacity: ${(currentDiskUsage / GIB).toFixed(2)} GB / ${maxStorageGB} GB.` : '');

// A stored upload's count, its leases being taken and ended, and its removal
// happen one at a time, so two downloads can't both take a limit's last place.
let objectQueue = Promise.resolve();
const withObjectLock = (fn) => {
    const run = objectQueue.then(fn);
    objectQueue = run.catch(() => { });
    return run;
};

/**
 * A stored upload's record, if it's there and live. An encrypted one is only
 * served while the server has E2EE on; `anyEncryption` finds it either way.
 */
const getLiveObject = async (id, { anyEncryption = false } = {}) => {
    if (typeof id !== 'string' || !OBJECT_ID.test(id)) return null;
    const record = await objectDatabase.get(id);
    if (!isLive(record)) return null;
    return record.encrypted && !uploadEnableE2EE && !anyEncryption ? null : record;
};

const openLeases = (objectId) => v4LeasesByObject.get(objectId)?.size ?? 0;

/** A new lease on a stored upload: which one, how far it has got, and its deadline. Nothing about who took it. */
const newLease = (objectId) => ({
    id: crypto.randomBytes(32).toString('base64url'),
    objectId,
    served: false,
    paused: false,
    deadline: 0,
    timer: null,
    // The answers sending its bytes now, each with the stream it reads.
    sending: new Set(),
});

/** The lease ends `ms` from now, unless something renews it. */
const setLeaseDeadline = (lease, ms) => {
    clearTimeout(lease.timer);
    lease.deadline = Date.now() + ms;
    lease.timer = setTimeout(() => leaseAtDeadline(lease), ms);
};

const leaseAtDeadline = (lease) => {
    if (v4Leases.get(lease.id) !== lease) return undefined;
    // A lease whose bytes are being sent isn't quiet.
    if (lease.sending.size > 0) return setLeaseDeadline(lease, LEASE_QUIET_MS);
    return endLease(lease);
};

/** A request for a lease's bytes, or to renew it, keeps it 5 more minutes, unpaused. */
const renewLease = (lease) => {
    lease.paused = false;
    setLeaseDeadline(lease, LEASE_QUIET_MS);
};

/** Takes a lease out of memory, and stops anything it's sending. It counts nothing. */
const forgetLease = (lease) => {
    clearTimeout(lease.timer);
    v4Leases.delete(lease.id);
    const leases = v4LeasesByObject.get(lease.objectId);
    leases?.delete(lease);
    if (leases?.size === 0) v4LeasesByObject.delete(lease.objectId);
    for (const { res, stream } of lease.sending) {
        stream.destroy();
        res.destroy();
    }
    lease.sending.clear();
};

/** Removes a stored upload at once: its bytes, its record, its storage, and every lease on it, uncounted. */
const removeObject = async (id, record) => {
    for (const lease of [...(v4LeasesByObject.get(id) ?? [])]) forgetLease(lease);
    fs.rmSync(path.join(objectsDir, id), { force: true, maxRetries: 3 });
    await objectDatabase.delete(id);
    currentDiskUsage = Math.max(0, currentDiskUsage - record.size);
};

/** Ends a lease, released or run out. If it served any byte, that's one download. */
const endLease = (lease) => {
    if (v4Leases.get(lease.id) !== lease) return Promise.resolve();
    forgetLease(lease);
    if (!lease.served) return Promise.resolve();
    return withObjectLock(async () => {
        const record = await getLiveObject(lease.objectId, { anyEncryption: true });
        if (!record) return;
        if (!(record.maxDownloads > 0)) {
            log('debug', 'Download counted (unlimited downloads).');
            return;
        }
        const count = (record.downloadCount || 0) + 1;
        if (count >= record.maxDownloads && openLeases(lease.objectId) === 0) {
            await removeObject(lease.objectId, record);
            log('debug', `Upload deleted at its download limit (${count}/${record.maxDownloads} downloads).${capacityNote()}`);
        } else {
            await objectDatabase.set(lease.objectId, { ...record, downloadCount: count });
            log('debug', `Download counted (${count}/${record.maxDownloads} downloads).`);
        }
    });
};

/** The lease a request names, if it's open and its upload is still there, with the upload's record. */
const requestedLease = async (leaseId) => {
    const lease = typeof leaseId === 'string' ? v4Leases.get(leaseId) : undefined;
    if (!lease) return null;
    if (lease.deadline <= Date.now()) await leaseAtDeadline(lease);
    if (v4Leases.get(lease.id) !== lease) return null;
    const record = await getLiveObject(lease.objectId);
    if (v4Leases.get(lease.id) !== lease) return null;
    if (!record) {
        // Expired, or encrypted on a server that has turned E2EE off: nothing more is sent under it.
        forgetLease(lease);
        return null;
    }
    return { lease, record };
};

/**
 * The one byte range a Range header asks for, as [first, last] within `length`
 * bytes, or null when it's anything else or past the end. A last byte past the
 * end is the end, and `bytes=-n` is the last n bytes.
 */
const byteRange = (header, length) => {
    const match = /^bytes=(\d{0,16})-(\d{0,16})$/.exec(header.trim());
    if (!match || (match[1] === '' && match[2] === '')) return null;
    if (match[1] === '') {
        const suffix = Number(match[2]);
        return suffix > 0 ? [Math.max(0, length - suffix), length - 1] : null;
    }
    const first = Number(match[1]);
    const last = match[2] === '' ? length - 1 : Math.min(Number(match[2]), length - 1);
    return first < length && first <= last ? [first, last] : null;
};

// The headers an answer carrying bytes has, which an error answer mustn't.
const BYTES_HEADERS = ['Accept-Ranges', 'ETag', 'Content-Type', 'Content-Length', 'Content-Range', 'Content-Disposition'];

/**
 * Sends `length` bytes of a lease's upload from `offset` (all of it, or one
 * file of a bundle), whole or the one range the request asks for. An If-Range
 * that isn't the upload's ETag gets the whole of them. `name`, when given, is
 * the name the browser saves it under.
 */
const sendObjectBytes = (req, res, lease, { offset, length, name }) => {
    // An object never changes and its ID is never reused, so the ID is its ETag.
    const etag = `"${lease.objectId}"`;
    let first = 0;
    let last = length - 1;
    const range = req.get('Range');
    const ifRange = req.get('If-Range');
    if (range !== undefined && (ifRange === undefined || ifRange === etag)) {
        const asked = byteRange(range, length);
        if (!asked) {
            res.set('Content-Range', `bytes */${length}`);
            return res.status(416).json({ code: 'RANGE_NOT_SATISFIABLE', error: 'The server can\'t send that range of bytes.' });
        }
        [first, last] = asked;
        res.status(206);
        res.set('Content-Range', `bytes ${first}-${last}/${length}`);
    }
    res.set({
        'Accept-Ranges': 'bytes',
        ETag: etag,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(last - first + 1),
        'Content-Disposition': name ? contentDisposition(name) : 'attachment',
    });
    renewLease(lease);
    if (req.method === 'HEAD') return res.end();

    const stream = fs.createReadStream(path.join(objectsDir, lease.objectId), { start: offset + first, end: offset + last });
    const sending = { res, stream };
    lease.sending.add(sending);
    stream.once('data', () => { lease.served = true; });
    stream.on('error', () => {
        if (res.headersSent) return res.destroy();
        // Gone from disk since it was found.
        for (const header of BYTES_HEADERS) res.removeHeader(header);
        return uploadNotFound(res);
    });
    res.on('close', () => {
        stream.destroy();
        lease.sending.delete(sending);
        // Its 5 minutes start again once the bytes stop.
        if (v4Leases.get(lease.id) === lease && !lease.paused) setLeaseDeadline(lease, LEASE_QUIET_MS);
    });
    stream.pipe(res);
    return undefined;
};

if (enableUpload) {
    // An upload's metadata and its leases skip the rate limiter while it's
    // there, as Dropgate 3's downloads did; asking about one that isn't is limited.
    const v4ObjectAuth = async (req, res, next) => ((await getLiveObject(req.params.id)) ? next() : limiter(req, res, next));

    // The requests under a lease skip the rate limiter while it's open.
    const v4LeaseAuth = (req, res, next) => {
        const leaseId = req.params.lease ?? req.get('Dropgate-Lease');
        if (leaseId && v4Leases.has(leaseId)) return next();
        return limiter(req, res, next);
    };

    v4Router.get('/objects/:id', v4ObjectAuth, async (req, res) => {
        const id = req.params.id;
        const record = await getLiveObject(id);
        if (!record) return uploadNotFound(res);
        if (!record.encrypted) return res.status(200).json({ encrypted: false, size: record.size, files: record.files });

        // The header is the object's first 60 bytes, so a client can check it before asking for any of the rest.
        const header = Buffer.alloc(OBJECT_HEADER_BYTES);
        try {
            const file = await fs.promises.open(path.join(objectsDir, id), 'r');
            try {
                const { bytesRead } = await file.read(header, 0, OBJECT_HEADER_BYTES, 0);
                if (bytesRead !== OBJECT_HEADER_BYTES) return uploadNotFound(res);
            } finally {
                await file.close();
            }
        } catch (err) {
            if (err.code === 'ENOENT') return uploadNotFound(res);
            throw err;
        }
        return res.status(200).json({ encrypted: true, size: record.size, header: header.toString('base64url'), meta: record.meta });
    });

    v4Router.post('/objects/:id/leases', v4ObjectAuth, async (req, res) => {
        const id = req.params.id;
        const taken = await withObjectLock(async () => {
            const record = await getLiveObject(id);
            if (!record) return null;
            // Every open lease may yet count, so a new one waits while they and the counted downloads make the limit.
            if (record.maxDownloads > 0 && openLeases(id) + (record.downloadCount || 0) >= record.maxDownloads) return { busy: true };
            const lease = newLease(id);
            v4Leases.set(lease.id, lease);
            if (!v4LeasesByObject.has(id)) v4LeasesByObject.set(id, new Set());
            v4LeasesByObject.get(id).add(lease);
            setLeaseDeadline(lease, LEASE_QUIET_MS);
            return { lease };
        });
        if (!taken) return uploadNotFound(res);
        if (taken.busy) {
            res.set('Retry-After', String(DOWNLOADS_BUSY_RETRY_SECONDS));
            return res.status(423).json({ code: 'DOWNLOADS_BUSY', error: 'Someone is downloading this right now. Try again shortly.' });
        }
        log('debug', 'Download lease taken.');
        return res.status(201).json({ lease: taken.lease.id, deadline: taken.lease.deadline, etag: `"${id}"` });
    });

    v4Router.post('/lease/renew', v4LeaseAuth, async (req, res) => {
        const found = await requestedLease(req.get('Dropgate-Lease'));
        if (!found) return uploadNotFound(res);
        renewLease(found.lease);
        return res.status(200).json({ deadline: found.lease.deadline });
    });

    v4Router.post('/lease/pause', v4LeaseAuth, async (req, res) => {
        const found = await requestedLease(req.get('Dropgate-Lease'));
        if (!found) return uploadNotFound(res);
        if (maxPauseMinutes === 0) {
            renewLease(found.lease);
            return res.status(409).json({ code: 'PAUSE_DISABLED', error: 'Pausing is turned off on this server.' });
        }
        // Pausing again renews the pause from now.
        found.lease.paused = true;
        setLeaseDeadline(found.lease, maxPauseMinutes * 60 * 1000);
        log('debug', 'Download lease paused.');
        return res.status(200).json({ paused: true, deadline: found.lease.deadline });
    });

    v4Router.delete('/lease', v4LeaseAuth, async (req, res) => {
        const found = await requestedLease(req.get('Dropgate-Lease'));
        if (!found) return uploadNotFound(res);
        await endLease(found.lease);
        return res.status(204).end();
    });

    v4Router.get('/objects/:id/content', v4LeaseAuth, async (req, res) => {
        const leaseId = req.get('Dropgate-Lease');
        if (!leaseId) return res.status(400).json({ code: 'LEASE_REQUIRED', error: 'A download needs a lease, in the Dropgate-Lease header.' });
        const found = await requestedLease(leaseId);
        if (!found || found.lease.objectId !== req.params.id) return uploadNotFound(res);
        const { record } = found;
        // Only an unencrypted single file's name is known to the server, so only it is named.
        const name = !record.encrypted && record.files.length === 1 ? record.files[0].name : null;
        return sendObjectBytes(req, res, found.lease, { offset: 0, length: record.size, name });
    });

    // A page with no secure context hands an unencrypted download to the
    // browser itself, which can't send a header, so these put the lease in the
    // URL. The browser's own resume asks again under the same lease. They never
    // serve an encrypted upload.
    v4Router.get('/leases/:lease', v4LeaseAuth, async (req, res) => {
        const found = await requestedLease(req.params.lease);
        if (!found || found.record.encrypted) return uploadNotFound(res);
        const { record } = found;
        const name = record.files.length === 1 ? record.files[0].name : null;
        return sendObjectBytes(req, res, found.lease, { offset: 0, length: record.size, name });
    });

    v4Router.get('/leases/:lease/files/:index', v4LeaseAuth, async (req, res) => {
        const found = await requestedLease(req.params.lease);
        if (!found || found.record.encrypted) return uploadNotFound(res);
        const { files } = found.record;
        const index = /^\d{1,4}$/.test(req.params.index) ? Number(req.params.index) : -1;
        if (index < 0 || index >= files.length) return uploadNotFound(res);
        // A file of an unencrypted upload is a plain byte range of it, after the files before it.
        const offset = files.slice(0, index).reduce((total, file) => total + file.size, 0);
        return sendObjectBytes(req, res, found.lease, { offset, length: files[index].size, name: files[index].name });
    });

    // The uploader's own delete, with the manage token only the uploader's page
    // or app holds. The record keeps only the token's SHA-256.
    v4Router.delete('/objects/:id', limiter, async (req, res) => {
        const id = req.params.id;
        const token = fromBase64url(req.get('Dropgate-Manage-Token') ?? '', 32);
        const outcome = await withObjectLock(async () => {
            const record = await getLiveObject(id, { anyEncryption: true });
            if (!record) return 'not found';
            const given = crypto.createHash('sha256').update(token ?? Buffer.alloc(0)).digest();
            const matches = crypto.timingSafeEqual(given, Buffer.from(record.manageTokenHash, 'base64url'));
            if (!token || !matches) return 'denied';
            await removeObject(id, record);
            return 'deleted';
        });
        if (outcome === 'not found') return uploadNotFound(res);
        if (outcome === 'denied') return res.status(403).json({ code: 'MANAGE_DENIED', error: 'That manage token isn\'t this upload\'s.' });
        log('debug', 'Upload deleted by its uploader.');
        return res.status(204).end();
    });
}

apiRouter.get('/info', limiter, (req, res) => {
    // The limits are what the operator set. maxSizeMB counts in 1024s, and
    // maxPauseMinutes is 0 when pausing is off. Nothing asks for a credential yet.
    const uploadCapabilities = enableUpload ? {
        enabled: true,
        e2ee: uploadEnableE2EE,
        maxSizeMB: maxFileSizeMB,
        maxLifetimeHours: maxFileLifetimeHours,
        maxFileDownloads: maxFileDownloads,
        chunkSize: uploadChunkSizeBytes,
        maxPauseMinutes: maxPauseMinutes,
        credentialRequired: false,
    } : { enabled: false };

    const p2pCapabilities = {
        enabled: enableP2P,
        peerjsPath: enableP2P ? PEERJS_MOUNT_PATH : undefined,
        iceServers: enableP2P ? p2pIceServers : undefined,
        peerjsDebugLogging: enableP2P ? (process.env.PEERJS_DEBUG === 'true') : undefined,
    };

    res.set('Cache-Control', 'no-store');
    res.status(200).json({
        name: serverName,
        version: version,
        protocols: PROTOCOLS,
        logLevel: LOG_LEVEL,
        capabilities: {
            upload: uploadCapabilities,
            p2p: p2pCapabilities,
            webUI: {
                enabled: enableWebUI
            },
            accounts: {
                enabled: false
            }
        }
    });
});

// Anything under /api that isn't a route is a JSON error, as every API error is.
const apiNotFound = (_req, res) => res.set('Cache-Control', 'no-store').status(404).json({ code: 'NOT_FOUND', error: 'There is nothing here.' });
apiRouter.use(apiNotFound);
v4Router.use(noteRoute);
apiRouter.use(noteRoute);
app.use('/api/v4', v4Router);
app.use('/api/v4', apiNotFound);
app.use('/api', apiRouter);

// ===== PeerJS signalling server (PeerServer) =====
// Mounted at a fixed path: /peerjs
if (enableP2P) {
    const peerServer = ExpressPeerServer(server, {
        path: '/',
        debug: process.env.PEERJS_DEBUG === 'true',
        proxied: true,
    });
    app.use(PEERJS_MOUNT_PATH, peerServer);
    log('info', `PeerServer mounted at ${PEERJS_MOUNT_PATH}`);
}

// P2P receiver page
app.get('/p2p/:code', limiter, (req, res) => {
    if (!enableP2P) return res.status(404).render('pages/404', { serverName });
    return res.status(200).render('pages/download-p2p', { code: req.params.code, serverName });
});

// Web UI landing page
app.get('/', limiter, (req, res) => {
    if (!enableWebUI) return res.status(200).send('Dropgate Server is running. Web UI is disabled.');
    return res.status(200).render('pages/index', { serverName });
});

// Download pages
if (enableUpload) {
    // An upload's download page, for one file and several alike. It's the same
    // over HTTP and HTTPS: the page reads the upload's metadata itself, which
    // says how many files it has (once decrypted, for an encrypted one), and
    // checks for itself whether it can decrypt here (isSecureContext), which a
    // server can't tell from the request. An encrypted upload on a server with
    // E2EE off isn't there.
    app.get('/:id', limiter, async (req, res) => {
        if (!(await getLiveObject(req.params.id))) return res.status(404).render('pages/404', { serverName });
        return res.status(200).render('pages/download', { serverName });
    });
}

// A Dropgate 3 bundle's link. Nothing Dropgate 4 makes has one, and no upload
// it was made for can be served, so the page says it's from an older version.
app.get('/b/:id', limiter, (_req, res) => res.status(410).render('pages/older-version', { serverName }));

// 404 fallback
app.use((_req, res) => res.status(404).render('pages/404', { serverName }));

// The last handler, for anything that went wrong while answering. The answer
// says only that, in JSON like every API error. The log line goes through
// LOG_LEVEL and names the route's pattern and the error's kind: never its
// message or stack, a header, a body, a path or an ID. Express's own handler
// would print the stack whatever LOG_LEVEL says.
app.use((err, req, res, _next) => {
    // A request body that couldn't be read is the client's: body-parser's errors say so.
    const clientError = err?.expose === true && err.status >= 400 && err.status < 500;
    if (clientError) {
        log('debug', 'Refused a request whose body could not be read.');
    } else {
        const route = res.locals.failedRoute ?? (req.route?.path ? `${req.method} ${req.route.path}` : null);
        log('error', `Unexpected error while answering a request${route ? ` to ${route}` : ''}${describeError(err)}.`);
    }
    // Part of an answer has gone already, so the client must see it fail.
    if (res.headersSent) return req.socket.destroy();
    if (clientError && err.status === 413) {
        return res.status(413).json({ code: 'TOO_LARGE', error: 'The request is too large.' });
    }
    if (clientError) {
        return res.status(400).json({ code: 'INVALID_REQUEST', error: 'The request could not be read.' });
    }
    return res.status(500).json({ code: 'SERVER_ERROR', error: 'Something went wrong on the server.' });
});

if (enableUpload) {
    // Every minute, the uploads whose lifetime has ended go: each is one object, a file or a bundle
    // alike. They're already answered as missing; this removes their bytes and records. Their open
    // leases end with them, uncounted.
    const removeExpiredUploads = async () => {
        const now = Date.now();
        for (const record of await objectDatabase.all()) {
            if (record.value?.expiresAt && record.value.expiresAt < now) {
                log('debug', 'Upload expired. Deleting...');
                await withObjectLock(async () => {
                    // Unless a download or its uploader removed it meanwhile.
                    const current = await objectDatabase.get(record.id);
                    if (current) await removeObject(record.id, current);
                });
            }
        }
    };
    setInterval(removeExpiredUploads, 60000);
}

// Not being able to listen, such as when the port is taken, stops the server.
server.on('error', (err) => {
    log('error', `Dropgate Server couldn't listen on port ${port}${describeError(err)}.`);
    process.exit(1);
});

server.listen(port, () => {
    log('info', `Dropgate Server v${version} is running. | SERVER_PORT: ${port}`);
});

const handleShutdown = () => {
    log('info', 'Dropgate Server is shutting down...');
    if (enableUpload && !preserveUploads) {
        log('info', 'Clearing uploads and temp files upon shutdown...');
        cleanupDir(tmpDir);
        cleanupDir(uploadDir);
        log('info', 'Cleanup complete.');
    }
    // Gracefully stop accepting new connections.
    try {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1500).unref();
    } catch {
        process.exit(0);
    }
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
