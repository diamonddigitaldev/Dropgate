// Share with Dropgate's upload, as main makes it with no window: Settings'
// lifetime and download limit held to the server's, as Upload holds them,
// end-to-end encrypted when the server can be over HTTPS, and the same
// messages as Upload's when it can't go.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { shareUpload } = require('../src/core/share.js');

const SETTINGS = { serverURL: 'https://dropgate.test', lifetimeValue: 30, lifetimeUnit: 'minutes', maxDownloads: 3 };

/** A server check's answer, from the transfer window, with these upload capabilities. */
const checked = (upload, change = {}) => ({
    ok: true,
    baseUrl: 'https://dropgate.test',
    serverVersion: '4.0.0',
    serverInfo: { name: 'Test', version: '4.0.0', capabilities: { upload: { enabled: true, e2ee: true, maxLifetimeHours: 24, maxFileDownloads: 5, ...upload } } },
    dgup: { compatible: true, message: 'Compatible.' },
    ...change,
});

test('a share goes with Settings\' lifetime and download limit, encrypted on a server with E2EE over HTTPS', () => {
    assert.deepEqual(shareUpload(SETTINGS, checked()), {
        ok: true,
        options: { lifetime: { value: 30, unit: 'minutes' }, maxDownloads: 3, encrypt: true },
    });
});

test('it isn\'t encrypted on a server without E2EE, or one reached over plain HTTP', () => {
    assert.equal(shareUpload(SETTINGS, checked({ e2ee: false })).options.encrypt, false);
    assert.equal(shareUpload(SETTINGS, checked({}, { baseUrl: 'http://dropgate.test' })).options.encrypt, false);
});

test('Settings are held to the server\'s limits, as Upload holds them', () => {
    const options = (settings, upload) => shareUpload({ ...SETTINGS, ...settings }, checked(upload)).options;
    // Unlimited, where the server has a lifetime limit: the limit, up to 24 hours.
    assert.deepEqual(options({ lifetimeUnit: 'unlimited', lifetimeValue: 0 }, { maxLifetimeHours: 6 }).lifetime, { value: 6, unit: 'hours' });
    assert.deepEqual(options({ lifetimeUnit: 'unlimited', lifetimeValue: 0 }, { maxLifetimeHours: 72 }).lifetime, { value: 24, unit: 'hours' });
    assert.deepEqual(options({ lifetimeUnit: 'unlimited', lifetimeValue: 7 }, { maxLifetimeHours: 0 }).lifetime, { value: 0, unit: 'unlimited' });
    // A lifetime of nothing is half an hour.
    assert.deepEqual(options({ lifetimeValue: 0, lifetimeUnit: 'hours' }).lifetime, { value: 0.5, unit: 'hours' });
    // A download limit above the server's, or Unlimited where it isn't allowed, is the server's; a server of single-use links, 1.
    assert.equal(options({ maxDownloads: 9 }, { maxFileDownloads: 5 }).maxDownloads, 5);
    assert.equal(options({ maxDownloads: 0 }, { maxFileDownloads: 5 }).maxDownloads, 5);
    assert.equal(options({ maxDownloads: 0 }, { maxFileDownloads: 0 }).maxDownloads, 0);
    assert.equal(options({ maxDownloads: 4 }, { maxFileDownloads: 1 }).maxDownloads, 1);
});

test('a share doesn\'t go, with Upload\'s own message, when the server can\'t take it', () => {
    const message = (check, settings = SETTINGS) => shareUpload(settings, check).message;
    assert.equal(message({ ok: false, code: 'NETWORK', message: 'fetch failed' }), 'Could not connect to the server.');
    assert.equal(message(checked({}, { serverInfo: null })), 'Cannot determine the server\'s version or capabilities.');
    assert.equal(message(checked({ enabled: false })), 'File uploads are disabled on this server.');
    assert.equal(message(checked({}, { dgup: { compatible: false, message: 'Update required: this server is older.' } })), 'Update required: this server is older.');
    assert.equal(message(checked({ maxLifetimeHours: 24 }), { ...SETTINGS, lifetimeValue: 2, lifetimeUnit: 'days' }), 'File lifetime too long. Server limit: 24 hours.');
    assert.equal(message(checked({ maxLifetimeHours: 1.5 }), { ...SETTINGS, lifetimeValue: 2, lifetimeUnit: 'hours' }), 'File lifetime too long. Server limit: 1.5 hours.');
});
