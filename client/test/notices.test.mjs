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
});
