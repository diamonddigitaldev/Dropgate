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

/** An upload's statuses, as core gives them: the steps while it runs, then its outcome's. */
const UPLOAD_STATUSES = Object.freeze(['initializing', 'uploading', 'paused', 'completing', 'completed', 'cancelled', 'failed']);

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

/**
 * transfer:add-upload: the handles of the files to upload and the upload's
 * options, as the page set them.
 * @returns {{ files: string[], options: { lifetime: { value: number, unit: string }, maxDownloads: number, encrypt: boolean } }}
 */
function newUpload(request) {
    if (!isRecord(request, ['files', 'options'], ['files'])) throw new Error('Expected files to upload.');
    const { files } = request;
    if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES || !files.every(isId)) throw new Error('Expected files to upload.');
    return { files: [...files], options: uploadOptions(request.options) };
}

/** An upload's options: its lifetime, download limit and whether it's encrypted. */
function uploadOptions(options) {
    if (!isRecord(options, ['lifetime', 'maxDownloads', 'encrypt'])) throw new Error('Expected an upload\'s options.');
    const { lifetime, maxDownloads, encrypt } = options;
    const unitMs = isRecord(lifetime, ['value', 'unit']) && Object.hasOwn(LIFETIME_UNIT_MS, lifetime.unit) ? LIFETIME_UNIT_MS[lifetime.unit] : undefined;
    // Not more than core can count in ms, and nothing for an unlimited one.
    const fits = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0
        && (unitMs === 0 ? value === 0 : value * unitMs <= Number.MAX_SAFE_INTEGER);
    if (unitMs === undefined || !fits(lifetime.value)) throw new Error('Expected a file lifetime.');
    if (!isCount(maxDownloads)) throw new Error('Expected a download limit.');
    if (typeof encrypt !== 'boolean') throw new Error('Expected whether to encrypt.');
    return { lifetime: { value: lifetime.value, unit: lifetime.unit }, maxDownloads, encrypt };
}

/**
 * transfer:pause, transfer:resume, transfer:cancel: one upload main made.
 * @param {(id: string) => boolean} known - Whether main has an upload by this ID.
 */
function uploadOf(request, known) {
    if (!isRecord(request, ['id']) || !isId(request.id) || !known(request.id)) throw new Error('Expected an upload.');
    return request.id;
}

/**
 * transfer:start: uploads main made, each one this window may start.
 * @param {(id: string) => boolean} startable
 */
function uploadsToStart(request, startable) {
    const ids = isRecord(request, ['ids']) ? request.ids : null;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_FILES || !ids.every((id) => isId(id) && startable(id))
        || new Set(ids).size !== ids.length) {
        throw new Error('Expected uploads waiting to start.');
    }
    return [...ids];
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
        && UPLOAD_STATUSES.includes(snapshot.status)
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

/** engine:finished: an upload's one outcome: its link, cancelled, or core's reason. */
function outcomeOf(result) {
    if (isRecord(result, ['status', 'link']) && result.status === 'success' && isWebLink(result.link, MAX_LINK)) {
        return { status: 'success', link: result.link };
    }
    if (isRecord(result, ['status']) && result.status === 'cancelled') return { status: 'cancelled' };
    if (isRecord(result, ['status', 'message']) && result.status === 'error' && isText(result.message, MAX_TEXT)) {
        return { status: 'error', message: result.message };
    }
    throw new Error('Expected how an upload running finished.');
}

/** engine:answer: a server check's answer, or a pause's or a resume's. */
function answerOf(kind, value) {
    const ok = kind === 'check'
        ? isRecord(value, ['ok', 'baseUrl', 'serverVersion', 'serverInfo', 'dgup', 'code', 'message'], ['ok']) && typeof value.ok === 'boolean'
        : isRecord(value, ['message'], []) && (value.message === undefined || isText(value.message, MAX_TEXT));
    if (!ok) throw new Error('Expected the answer to a call.');
    return value;
}

module.exports = {
    UUID,
    LIFETIME_UNIT_MS,
    isId,
    pathList,
    handleOf,
    newUpload,
    uploadOptions,
    uploadOf,
    uploadsToStart,
    serverAddress,
    linkOf,
    failureOf,
    snapshotOf,
    deadlineOf,
    outcomeOf,
    answerOf,
};
