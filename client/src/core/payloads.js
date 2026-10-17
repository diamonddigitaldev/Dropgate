'use strict';

const path = require('path');

// What each channel takes, checked before main does anything with it: the
// window's, from its page (window.electronAPI), and the transfer window's
// (window.engine). Neither page is trusted: a value of the wrong kind, a
// number that isn't a safe whole number in range, a key nobody sent, or an ID
// main never made is refused here, and the handler goes no further. Each
// check gives back a copy of what it took, so nothing the page sent is kept
// or passed on as it came.

/** A UUID main made: an upload's ID, a handle, a call. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The most files one request may name: far more than anyone drops at once. */
const MAX_FILES = 10_000;

/** Windows' longest path, with its \\?\ prefix: no path is longer anywhere. */
const MAX_PATH = 32_767;

/** The longest server address, link, step or message main takes. */
const MAX_ADDRESS = 2_048;
const MAX_LINK = 8_192;
const MAX_TEXT = 1_000;

/** A file lifetime's units, as the page offers them, in ms (unlimited is 0). */
const LIFETIME_UNIT_MS = Object.freeze({ minutes: 60_000, hours: 3_600_000, days: 86_400_000, unlimited: 0 });

/** An upload's or a download's statuses, as core gives them: the steps while it runs, then its outcome's. */
const TRANSFER_STATUSES = Object.freeze(['initializing', 'uploading', 'downloading', 'paused', 'completing', 'completed', 'cancelled', 'failed']);

/** The most bytes a received file's name takes in UTF-16 code units: core refuses one over 255 bytes of UTF-8. */
const MAX_NAME = 255;

/**
 * A hosted upload's link, as Dropgate makes it: http(s), a host, the upload's
 * ID as the whole path, and for an encrypted one its secret after the #, 32
 * bytes in URL-safe base64 (43 characters). Nothing else: no user name or
 * password, no query.
 */
const HOSTED_PATH = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^#[A-Za-z0-9_-]{43}$/;

const isId = (value) => typeof value === 'string' && UUID.test(value);

/** A plain object with these keys at most, and these at least. */
const isRecord = (value, keys, required = keys) => typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key)) && required.every((key) => Object.hasOwn(value, key));

const isText = (value, max) => typeof value === 'string' && value.length <= max;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isWebLink = (value, max) => isText(value, max) && /^https?:\/\/[^\s]+$/i.test(value);

/**
 * files:add: dropped, picked or opened files' paths, each absolute. The one
 * channel that takes a path.
 * @returns {string[]}
 */
function pathList(paths) {
    const isPath = (p) => typeof p === 'string' && p.length <= MAX_PATH && !p.includes('\0') && path.isAbsolute(p);
    if (!Array.isArray(paths) || paths.length > MAX_FILES || !paths.every(isPath)) throw new Error('Expected a list of paths.');
    return [...paths];
}

/** file:revoke: a handle, as main made it. */
function handleOf(handle) {
    if (!isId(handle)) throw new Error('Expected a file.');
    return handle;
}

/** A list of handles: at least one, none twice. */
const handleList = (files) => Array.isArray(files) && files.length > 0 && files.length <= MAX_FILES && files.every(isId) && new Set(files).size === files.length;

/**
 * transfer:add-upload: the handles of the files to upload. Its options are
 * the server's settings for new uploads, which main gives it.
 * @returns {{ files: string[] }}
 */
function newUpload(request) {
    if (!isRecord(request, ['files']) || !handleList(request.files)) throw new Error('Expected files to upload.');
    return { files: [...request.files] };
}

/**
 * transfer:add-files: files to add to one of this window's uploads.
 * @param {(id: string) => boolean} own - Whether it's an upload of this window's.
 * @returns {{ id: string, files: string[] }}
 */
function filesToAdd(request, own) {
    if (!isRecord(request, ['id', 'files']) || !isId(request.id) || !own(request.id) || !handleList(request.files)) {
        throw new Error('Expected files to add to an upload of this window\'s.');
    }
    return { id: request.id, files: [...request.files] };
}

/**
 * transfer:remove: uploads main made, none twice.
 * @param {(id: string) => boolean} known
 */
function transfersOf(request, known) {
    const ids = isRecord(request, ['ids']) ? request.ids : null;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_FILES || !ids.every((id) => isId(id) && known(id)) || new Set(ids).size !== ids.length) {
        throw new Error('Expected uploads.');
    }
    return [...ids];
}

/** A file lifetime: a value in a unit, not more than core can count in ms, and 0 for an unlimited one. */
function isLifetime(lifetime) {
    const unitMs = isRecord(lifetime, ['value', 'unit']) && Object.hasOwn(LIFETIME_UNIT_MS, lifetime.unit) ? LIFETIME_UNIT_MS[lifetime.unit] : undefined;
    const { value } = lifetime ?? {};
    return unitMs !== undefined && typeof value === 'number' && Number.isFinite(value) && value >= 0
        && (unitMs === 0 ? value === 0 : value > 0 && value * unitMs <= Number.MAX_SAFE_INTEGER);
}

/** An upload's options: its lifetime, download limit and whether it's encrypted. */
function uploadOptions(options) {
    if (!isRecord(options, ['lifetime', 'maxDownloads', 'encrypt'])) throw new Error('Expected an upload\'s options.');
    const { lifetime, maxDownloads, encrypt } = options;
    if (!isLifetime(lifetime)) throw new Error('Expected a file lifetime.');
    if (!isCount(maxDownloads)) throw new Error('Expected a download limit.');
    if (typeof encrypt !== 'boolean') throw new Error('Expected whether to encrypt.');
    return { lifetime: { value: lifetime.value, unit: lifetime.unit }, maxDownloads, encrypt };
}

/**
 * transfer:set-options: Advanced Options on one of this window's uploads
 * waiting: its lifetime, its download limit, and the files it keeps (their
 * indexes in it, in order, at least one), any of them, at least one. The
 * server's limits aren't checked here: the window offers only what the server
 * allows, and checks again as the upload starts (the server refuses anything
 * outside them too).
 * @param {(id: string) => boolean} own - Whether it's an upload of this window's, waiting.
 * @param {(id: string) => number} fileCount - How many files it has.
 * @returns {{ id: string, options: { lifetime?: { value: number, unit: string }, maxDownloads?: number, files?: number[] } }}
 */
function optionsOf(request, own, fileCount) {
    if (!isRecord(request, ['id', 'options']) || !isId(request.id) || !own(request.id)) throw new Error('Expected an upload of this window\'s waiting to start.');
    const { options } = request;
    const keys = ['lifetime', 'maxDownloads', 'files'];
    if (!isRecord(options, keys, []) || Object.keys(options).length === 0) throw new Error('Expected an upload\'s options.');
    if (Object.hasOwn(options, 'lifetime') && !isLifetime(options.lifetime)) throw new Error('Expected a file lifetime.');
    if (Object.hasOwn(options, 'maxDownloads') && !isCount(options.maxDownloads)) throw new Error('Expected a download limit.');
    if (Object.hasOwn(options, 'files') && !indexesOf(options.files, fileCount(request.id))) throw new Error('Expected the files it keeps.');
    const copy = {};
    if (options.lifetime) copy.lifetime = { value: options.lifetime.value, unit: options.lifetime.unit };
    if (Object.hasOwn(options, 'maxDownloads')) copy.maxDownloads = options.maxDownloads;
    if (options.files) copy.files = [...options.files];
    return { id: request.id, options: copy };
}

/** Indexes of a transfer's files: at least one, each a safe whole number below `count`, in order, none twice. */
const indexesOf = (files, count) => Array.isArray(files) && files.length > 0
    && files.every((index, i) => Number.isSafeInteger(index) && index >= 0 && index < count && (i === 0 || index > files[i - 1]));

/**
 * transfer:set-options, on a download: Advanced Options (and Bulk Edit, one
 * call each) on one of this window's downloads waiting: the files it saves
 * (their indexes in it, in order, at least one) and whether as one ZIP, either
 * or both.
 * @param {(id: string) => boolean} own - Whether it's a download of this window's, waiting.
 * @param {(id: string) => number} fileCount - How many files it has.
 * @returns {{ id: string, options: { files?: number[], asZip?: boolean } }}
 */
function downloadOptionsOf(request, own, fileCount) {
    if (!isRecord(request, ['id', 'options']) || !isId(request.id) || !own(request.id)) throw new Error('Expected a download of this window\'s waiting to start.');
    const { options } = request;
    if (!isRecord(options, ['files', 'asZip'], []) || Object.keys(options).length === 0) throw new Error('Expected a download\'s options.');
    if (Object.hasOwn(options, 'files') && !indexesOf(options.files, fileCount(request.id))) throw new Error('Expected the files it saves.');
    if (Object.hasOwn(options, 'asZip') && typeof options.asZip !== 'boolean') throw new Error('Expected whether it\'s saved as one ZIP.');
    return {
        id: request.id,
        options: { ...(options.files ? { files: [...options.files] } : {}), ...(Object.hasOwn(options, 'asZip') ? { asZip: options.asZip } : {}) },
    };
}

/**
 * transfer:pause, transfer:resume, transfer:cancel, transfer:delete: one upload main made.
 * @param {(id: string) => boolean} known - Whether main has an upload by this ID.
 */
function uploadOf(request, known) {
    if (!isRecord(request, ['id']) || !isId(request.id) || !known(request.id)) throw new Error('Expected an upload.');
    return request.id;
}

/**
 * transfer:start: uploads main made, each one this window may start, and for
 * the window's own, whether they're end-to-end encrypted.
 * @param {(id: string) => boolean} startable
 * @returns {{ ids: string[], encrypt?: boolean }}
 */
function uploadsToStart(request, startable) {
    const ids = isRecord(request, ['ids', 'encrypt'], ['ids']) ? request.ids : null;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_FILES || !ids.every((id) => isId(id) && startable(id))
        || new Set(ids).size !== ids.length || !(request.encrypt === undefined || typeof request.encrypt === 'boolean')) {
        throw new Error('Expected uploads waiting to start.');
    }
    return { ids: [...ids], ...(request.encrypt === undefined ? {} : { encrypt: request.encrypt }) };
}

/**
 * server:check: a server's address, as typed: with http:// or https://, or
 * with no scheme (core reads it as https://), a port after its host's colon.
 * A path (C:\…, C:/…, /…, \\server\…), or any other scheme, is no address.
 */
function serverAddress(url) {
    const address = typeof url === 'string' ? url.trim() : '';
    // A colon not followed by a digit ends a scheme ("file:", "C:"); "localhost:3000" has a port.
    const scheme = address.match(/^([a-z][a-z0-9+.-]*):(?!\d)/i)?.[1];
    const web = /^https?:\/\/[^/]/i.test(address);
    if (address === '' || address.length > MAX_ADDRESS || /[\s\\\0]/.test(address) || path.isAbsolute(address) || (scheme && !web)) {
        throw new Error('Expected a server address.');
    }
    return address;
}

/** link:copy: an upload's link, to the web. */
function linkOf(link) {
    if (!isWebLink(link, MAX_LINK)) throw new Error('Expected a link.');
    return link;
}

/**
 * transfer:add-download: a link to a hosted upload, as Dropgate makes it
 * (HOSTED_PATH, SECRET), from a page that holds it until it's sent. Main
 * passes the link on to the transfer window, and keeps only where it points:
 * the server's address (its origin) and host, never the ID or the secret.
 * @returns {{ link: string, server: { url: string, allowInsecure: boolean }, host: string }}
 */
function downloadLink(request) {
    const link = isRecord(request, ['link']) ? request.link : null;
    let url = null;
    if (isText(link, MAX_LINK) && /^https?:\/\/[^\s]+$/i.test(link)) {
        try {
            url = new URL(link);
        } catch {
            url = null;
        }
    }
    const ok = url && !url.username && !url.password && url.search === '' && HOSTED_PATH.test(url.pathname) && (url.hash === '' || SECRET.test(url.hash));
    if (!ok) throw new Error('Expected a link to an upload.');
    return { link, server: { url: url.origin, allowInsecure: url.protocol === 'http:' }, host: url.host };
}

/**
 * transfer:save-to: downloads of this window's waiting, and where they're
 * saved: 'default' (Settings > Transfers' folder) or a folder this window
 * chose (folder:choose), by the ID main made for it.
 * @param {(id: string) => boolean} own - Whether it's a download of this window's, waiting.
 * @param {(folder: string) => boolean} chosen - Whether main made this folder's ID for this window.
 * @returns {{ ids: string[], folder: string }}
 */
function saveToOf(request, own, chosen) {
    const ids = isRecord(request, ['ids', 'folder']) ? request.ids : null;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_FILES || !ids.every((id) => isId(id) && own(id)) || new Set(ids).size !== ids.length) {
        throw new Error('Expected downloads of this window\'s waiting to start.');
    }
    if (!(request.folder === 'default' || (isId(request.folder) && chosen(request.folder)))) throw new Error('Expected a folder this window chose.');
    return { ids: [...ids], folder: request.folder };
}

/**
 * folder:set-default: a folder this window chose (folder:choose), or null for
 * the system's Downloads folder.
 * @param {(folder: string) => boolean} chosen
 */
function defaultFolderOf(request, chosen) {
    const folder = isRecord(request, ['folder']) ? request.folder : undefined;
    if (!(folder === null || (isId(folder) && chosen(folder)))) throw new Error('Expected a folder this window chose.');
    return folder;
}

/**
 * The kit's settings:set, as main answers it: a plain object of changes,
 * none to a setting only main changes, and transfers at once a whole number
 * in its range. The kit checks the rest (each a known setting, of its kind).
 * @param {readonly string[]} mainOnly
 * @param {{ MIN: number, MAX: number }} atOnce
 */
function settingsChangesOf(changes, mainOnly, atOnce) {
    if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) throw new Error('Expected settings to change.');
    const named = mainOnly.filter((key) => Object.hasOwn(changes, key));
    if (named.length > 0) throw new Error(`${named.join(', ')} can't be changed from the page.`);
    if (Object.hasOwn(changes, 'transfersAtOnce')) {
        const n = changes.transfersAtOnce;
        if (!Number.isSafeInteger(n) || n < atOnce.MIN || n > atOnce.MAX) throw new Error(`Expected transfers at once from ${atOnce.MIN} to ${atOnce.MAX}.`);
    }
    return { ...changes };
}

/** upload:finished: why an upload the page made never started. */
function failureOf(result) {
    if (!isRecord(result, ['status', 'error']) || result.status !== 'error' || !isText(result.error, MAX_TEXT)) {
        throw new Error('Expected why the upload never started.');
    }
    return { status: 'error', error: result.error };
}

// --- The transfer window's ---

/** engine:update: core's snapshot of an upload, its own fields only, which never name a file or hold a key. */
function snapshotOf(snapshot) {
    const fields = ['status', 'phase', 'text', 'percent', 'processedBytes', 'totalBytes', 'fileIndex', 'totalFiles', 'canPause', 'deadline'];
    const optional = (value, ok) => value === undefined || ok(value);
    const ok = isRecord(snapshot, fields, ['status'])
        && TRANSFER_STATUSES.includes(snapshot.status)
        && optional(snapshot.phase, (v) => isText(v, 64))
        && optional(snapshot.text, (v) => isText(v, MAX_TEXT))
        && optional(snapshot.percent, (v) => typeof v === 'number' && v >= 0 && v <= 100)
        && ['processedBytes', 'totalBytes', 'fileIndex', 'totalFiles'].every((field) => optional(snapshot[field], isCount))
        && optional(snapshot.canPause, (v) => typeof v === 'boolean')
        && optional(snapshot.deadline, (v) => v === null || isCount(v));
    if (!ok) throw new Error('Expected a snapshot of an upload running.');
    return Object.fromEntries(fields.filter((field) => snapshot[field] !== undefined).map((field) => [field, snapshot[field]]));
}

/** engine:pause-ending: when a paused upload's server drops it, in ms since 1970. */
function deadlineOf(deadline) {
    if (!Number.isSafeInteger(deadline) || deadline <= 0) throw new Error('Expected a deadline of an upload running.');
    return deadline;
}

/**
 * engine:finished: a transfer's one outcome: an upload's link, a download's
 * completion (no link: its file is in its folder), cancelled, or core's
 * reason. Which kind may end how is main's to check (transfer-host.js).
 */
function outcomeOf(result) {
    if (isRecord(result, ['status', 'link']) && result.status === 'success' && isWebLink(result.link, MAX_LINK)) {
        return { status: 'success', link: result.link };
    }
    if (isRecord(result, ['status']) && result.status === 'success') return { status: 'success' };
    if (isRecord(result, ['status']) && result.status === 'cancelled') return { status: 'cancelled' };
    if (isRecord(result, ['status', 'message']) && result.status === 'error' && isText(result.message, MAX_TEXT)) {
        return { status: 'error', message: result.message };
    }
    throw new Error('Expected how an upload running finished.');
}

/**
 * A download's list of files, as core read it from the server (decrypted):
 * each name (core's file name rule: at most 255 bytes, so as many UTF-16
 * units) and size, at least one file, and whether it's encrypted.
 */
const isFileList = (value) => isRecord(value, ['files', 'encrypted']) && typeof value.encrypted === 'boolean'
    && Array.isArray(value.files) && value.files.length > 0 && value.files.length <= MAX_FILES
    && value.files.every((file) => isRecord(file, ['name', 'size']) && isText(file.name, MAX_NAME) && file.name.length > 0 && isCount(file.size));

/**
 * engine:answer: a server check's answer; a metadata read's (the list of
 * files, or why it couldn't be read); or a pause's, a resume's, a delete's or
 * a quit's (core's reason when it couldn't, or nothing).
 */
function answerOf(kind, value) {
    const reason = isRecord(value, ['message'], []) && (value.message === undefined || isText(value.message, MAX_TEXT));
    let ok;
    if (kind === 'check') ok = isRecord(value, ['ok', 'baseUrl', 'serverVersion', 'serverInfo', 'dgup', 'code', 'message'], ['ok']) && typeof value.ok === 'boolean';
    else if (kind === 'metadata') ok = isFileList(value) || (reason && typeof value.message === 'string');
    else ok = reason;
    if (!ok) throw new Error('Expected the answer to a call.');
    if (kind === 'metadata' && value.files) {
        return { files: value.files.map(({ name, size }) => ({ name, size })), encrypted: value.encrypted };
    }
    return value;
}

// --- The file service's ---

/**
 * saved: where a download landed, for Show in Folder (a bundle saved as
 * files: its own folder, for Open Folder): its output, as main granted it,
 * and an absolute path.
 * @param {(output: string) => boolean} granted
 */
function savedOf(message, granted) {
    const ok = isRecord(message, ['type', 'output', 'path']) && message.type === 'saved' && isId(message.output) && granted(message.output)
        && isText(message.path, MAX_PATH) && !message.path.includes('\0') && path.isAbsolute(message.path);
    if (!ok) throw new Error('Expected where a download was saved.');
    return { output: message.output, path: message.path };
}

module.exports = {
    UUID,
    LIFETIME_UNIT_MS,
    isId,
    pathList,
    handleOf,
    newUpload,
    filesToAdd,
    transfersOf,
    uploadOptions,
    optionsOf,
    downloadOptionsOf,
    uploadOf,
    uploadsToStart,
    serverAddress,
    linkOf,
    downloadLink,
    saveToOf,
    defaultFolderOf,
    settingsChangesOf,
    failureOf,
    snapshotOf,
    deadlineOf,
    outcomeOf,
    answerOf,
    savedOf,
};
