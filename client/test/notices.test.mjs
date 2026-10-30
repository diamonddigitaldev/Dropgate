// What notifications and the tray say of transfers (src/core/notices.js):
// several ending together in one notification, counts in Title Case titles,
// a failure counted, a cancel told of by no one, and never a file's name.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { countsLine, endNotice } = require('../src/core/notices.js');

const ok = { kind: 'upload', status: 'success' };
const failed = (error) => ({ kind: 'upload', status: 'error', error });
const cancelled = { kind: 'upload', status: 'cancelled' };

/** Every word of a title starts with a capital (or is a number). */
const titleCase = (title) => title.split(' ').every((word) => /^[A-Z0-9]/.test(word));

test('one upload ending is told of as before', () => {
    assert.deepEqual(endNotice([ok]), { title: 'Upload Successful', body: 'Link copied to clipboard.' });
    assert.deepEqual(endNotice([failed('The server dropped this paused upload.')]), { title: 'Upload Failed', body: 'The server dropped this paused upload.' });
    assert.deepEqual(endNotice([failed('')]), { title: 'Upload Failed', body: 'An unknown error occurred.' });
});

test('several ending together are one notification, with counts, and a failure counted', () => {
    assert.deepEqual(endNotice([ok, ok, ok]), { title: '3 Uploads Finished', body: 'The latest link is copied to the clipboard.' });
    assert.deepEqual(endNotice([ok, failed('A file changed after the upload started.'), ok]),
        { title: '3 Uploads Finished', body: '2 succeeded, 1 failed. The latest link is copied to the clipboard.' });
    assert.deepEqual(endNotice([failed('x'), failed('y')]), { title: '2 Uploads Failed', body: "None of them finished, so there's no link." });
});

test('a cancelled one is told of by no one', () => {
    assert.equal(endNotice([]), null);
    assert.equal(endNotice([cancelled, cancelled]), null);
    assert.deepEqual(endNotice([cancelled, ok]), { title: 'Upload Successful', body: 'Link copied to clipboard.' });
});

test('every title is Title Case, and no notification carries anything but counts and core\'s reason', () => {
    const cases = [[ok], [failed('Reason.')], [ok, ok], [ok, failed('Reason.')], [failed('a'), failed('b')]];
    for (const ends of cases) {
        const { title, body } = endNotice(ends);
        assert.ok(titleCase(title), title);
        assert.doesNotMatch(body, /\.bin|[\\/]/, body);
    }
});

test('the tray says how many are going, in Title Case between bullets', () => {
    assert.equal(countsLine({ running: 2, paused: 1, queued: 1 }), '2 Uploading • 1 Paused • 1 Queued');
    assert.equal(countsLine({ running: 1, paused: 0, queued: 0 }), '1 Uploading');
    assert.equal(countsLine({ running: 0, paused: 0, queued: 0 }), 'Nothing Running');
    assert.equal(countsLine({ running: 3, paused: 0, queued: 1, downloading: 2 }), '1 Uploading • 2 Downloading • 1 Queued');
    assert.equal(countsLine({ running: 1, paused: 1, queued: 0, downloading: 1 }), '1 Downloading • 1 Paused');
});

test('a download ending is told of as its own, with no link, and never its name or its folder', () => {
    const saved = { kind: 'download', status: 'success' };
    const lost = { kind: 'download', status: 'error', error: 'The server dropped this paused download.' };
    assert.deepEqual(endNotice([saved]), { title: 'Download Successful', body: "It's saved in its folder." });
    assert.deepEqual(endNotice([lost]), { title: 'Download Failed', body: 'The server dropped this paused download.' });
    assert.deepEqual(endNotice([saved, saved]), { title: '2 Downloads Finished', body: 'Each is saved in its folder.' });
    assert.deepEqual(endNotice([lost, lost]), { title: '2 Downloads Failed', body: 'None of them finished.' });
    // Uploads and downloads together are transfers; only an upload's link is on the clipboard.
    assert.deepEqual(endNotice([ok, saved]), { title: '2 Transfers Finished', body: 'The latest link is copied to the clipboard.' });
    assert.deepEqual(endNotice([saved, failed('Reason.')]), { title: '2 Transfers Finished', body: '1 succeeded, 1 failed.' });
    assert.deepEqual(endNotice([ok, lost, saved]), { title: '3 Transfers Finished', body: '2 succeeded, 1 failed. The latest link is copied to the clipboard.' });
    for (const ends of [[saved], [lost], [saved, saved], [ok, saved], [saved, lost]]) assert.ok(titleCase(endNotice(ends).title));
});
