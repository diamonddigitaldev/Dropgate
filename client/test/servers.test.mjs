// The saved servers (core/servers.js) and settings version 3: version 2's
// (or 1's) one server, with its settings for new uploads, becomes the first
// saved server and the default, once; the list keeps each server's address,
// name, settings for new uploads and Allow Fallback, in order, and the
// default; nothing a server check found is ever written. Run through the
// kit's own settings store, over a file kept in memory, as main runs it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { SETTINGS_DEFAULTS, SETTINGS_SCHEMA_VERSION, V3_STORE_KEYS, migrateSettings } = require('../src/constants.js');
const { NEW_SERVER, SERVER_KEYS, Servers, newServer, serversFrom } = require('../src/core/servers.js');

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createSettings } = require(path.join(CLIENT, 'node_modules', '@diamonddigitaldev', 'electron-kit', 'main', 'store.js'));

/** config.json, in memory: what electron-store would keep, by its keys. */
function memoryFile(contents) {
    const file = structuredClone(contents);
    return {
        file,
        store: {
            get: (key) => structuredClone(file[key]),
            set: (key, value) => { file[key] = structuredClone(value); },
            delete: (key) => { delete file[key]; },
        },
    };
}

/** The kit's settings over that file, with the client's defaults and migration, as main starts them. */
const kitSettings = (store, log = { info() {} }) => createSettings({
    defaults: SETTINGS_DEFAULTS, version: SETTINGS_SCHEMA_VERSION, migrate: migrateSettings, obsoleteKeys: V3_STORE_KEYS, memoryLog: true, open: () => store, log,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('settings version 3: a version 2 profile\'s server and its settings for new uploads become the first saved server, and the default, once', () => {
    const v2 = { serverURL: 'https://drop.example.com', lifetimeValue: 3, lifetimeUnit: 'days', maxDownloads: 5, downloadFolder: 'D:\\Saved', transfersAtOnce: 4, navCollapsed: true };
    const { file, store } = memoryFile({ settings: v2, settingsSchema: 2, windowBounds: { width: 900, height: 900 } });
    const said = [];
    const settings = kitSettings(store, { info: (line) => said.push(line) });

    const read = settings.get();
    const [server] = read.servers;
    assert.match(server.id, UUID);
    assert.deepEqual(server, { id: server.id, url: 'https://drop.example.com', name: 'drop.example.com', lifetime: { value: 3, unit: 'days' }, maxDownloads: 5, allowFallback: false });
    assert.equal(read.defaultServer, server.id);
    assert.deepEqual([read.downloadFolder, read.transfersAtOnce, read.navCollapsed], ['D:\\Saved', 4, true], 'version 2\'s own settings are kept as they were');
    assert.deepEqual(Object.keys(file).sort(), ['settings', 'settingsSchema', 'windowBounds']);
    assert.equal(file.settingsSchema, 3);
    for (const key of ['serverURL', 'lifetimeValue', 'lifetimeUnit', 'maxDownloads']) assert.ok(!Object.hasOwn(file.settings, key), `${key} is gone from config.json`);
    assert.deepEqual(said, ['Settings version 3: removing serverURL, lifetimeValue, lifetimeUnit, maxDownloads.']);

    // Once: the next start reads it as it was written, the same server by the same ID.
    assert.deepEqual(kitSettings(memoryFile(file).store).get().servers, [server]);
});

test('a version 1 profile goes to version 3 at once; one with no server has none saved; a lifetime of Unlimited is kept as 0', () => {
    const v1 = memoryFile({ settings: { serverURL: 'http://192.168.1.20:52443', lifetimeValue: 7, lifetimeUnit: 'unlimited', maxDownloads: 0 }, settingsSchema: 1 });
    const one = kitSettings(v1.store).get();
    assert.deepEqual([one.downloadFolder, one.transfersAtOnce], [null, 3]);
    assert.deepEqual(one.servers.map(({ url, name, lifetime, maxDownloads }) => ({ url, name, lifetime, maxDownloads })),
        [{ url: 'http://192.168.1.20:52443', name: '192.168.1.20:52443', lifetime: { value: 0, unit: 'unlimited' }, maxDownloads: 0 }]);
    assert.equal(v1.file.settingsSchema, 3);

    for (const serverURL of ['', '   ', undefined]) {
        const empty = memoryFile({ settings: { serverURL, lifetimeValue: 24, lifetimeUnit: 'hours', maxDownloads: 1 }, settingsSchema: 2 });
        assert.deepEqual([kitSettings(empty.store).get().servers, kitSettings(empty.store).get().defaultServer], [[], null], JSON.stringify(serverURL));
    }

    // Values no version wrote are a new server's.
    assert.deepEqual(serversFrom({ serverURL: 'drop.example.com', lifetimeValue: 'soon', lifetimeUnit: 'weeks', maxDownloads: -2 }).servers[0].lifetime, NEW_SERVER.lifetime);
    assert.equal(serversFrom({ serverURL: 'drop.example.com', maxDownloads: 2.5 }).servers[0].maxDownloads, NEW_SERVER.maxDownloads);
    // A new profile has none.
    assert.deepEqual([SETTINGS_DEFAULTS.servers, SETTINGS_DEFAULTS.defaultServer], [[], null]);
});

test('a new server starts at 24 hours and 1 download, held to its lifetime limit, with Allow Fallback off, and its own name or its host', () => {
    const info = (upload, name) => ({ name, version: '4.0.0', capabilities: { upload } });
    const keep = ({ id, ...rest }) => (assert.match(id, UUID), rest);
    assert.deepEqual(keep(newServer('https://drop.example.com', info({ maxLifetimeHours: 72, maxFileDownloads: 10 }, 'Share Space'))),
        { url: 'https://drop.example.com', name: 'Share Space', lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, allowFallback: false });
    assert.deepEqual(newServer('https://drop.example.com', info({ maxLifetimeHours: 6 })).lifetime, { value: 6, unit: 'hours' }, 'held to a shorter limit');
    assert.deepEqual(newServer('https://drop.example.com', info({ maxLifetimeHours: 0, maxFileDownloads: 0 })).lifetime, { value: 24, unit: 'hours' }, 'never Unlimited by default');
    assert.equal(newServer('https://drop.example.com', info({ maxFileDownloads: 0 })).maxDownloads, 1, 'never unlimited downloads by default');
    assert.equal(newServer('https://drop.example.com:8443', info({}, '   ')).name, 'drop.example.com:8443', 'no name of its own: its host');
    assert.equal(newServer('https://drop.example.com').name, 'drop.example.com');
    assert.equal(newServer('https://drop.example.com', info({}, 'x'.repeat(101))).name, 'drop.example.com', 'a name over 100 characters: its host');
});

test('the list keeps each server\'s address, name, settings for new uploads and Allow Fallback, in order, and the default; nothing a check found is written', () => {
    const { file, store } = memoryFile({});
    const servers = new Servers(kitSettings(store));
    // Everything a check finds, and more, as the transfer window answers it.
    const found = { name: 'Example Drop', version: '4.0.0', capabilities: { upload: { enabled: true, e2ee: true, maxLifetimeHours: 48, maxFileDownloads: 5, maxSizeMB: 500 } }, online: true };
    const first = servers.add('https://one.test', found).server;
    const second = servers.add('https://two.test', found).server;
    const third = servers.add('http://three.test', null).server;
    assert.equal(servers.list().defaultServer, first.id, 'the first saved is the default');
    assert.deepEqual(servers.add('HTTPS://ONE.TEST', found), { server: first, added: false }, 'one address is saved once');

    assert.ok(servers.move(third.id, -1));
    assert.ok(!servers.move(first.id, -1), 'the first can\'t go up');
    assert.ok(servers.setDefault(second.id));
    assert.ok(servers.setOptions(third.id, { lifetime: { value: 7, unit: 'unlimited' }, maxDownloads: 0, allowFallback: true }));
    assert.ok(!servers.setOptions('not one', { maxDownloads: 2 }));

    assert.deepEqual(file.settings.servers.map((s) => s.url), ['https://one.test', 'http://three.test', 'https://two.test'], 'in order');
    assert.equal(file.settings.defaultServer, second.id);
    assert.deepEqual(file.settings.servers[1], { ...third, lifetime: { value: 0, unit: 'unlimited' }, maxDownloads: 0, allowFallback: true });
    for (const kept of file.settings.servers) assert.deepEqual(Object.keys(kept), [...SERVER_KEYS], `${kept.url} keeps its own keys only`);
    const written = JSON.stringify(file);
    for (const word of ['version', 'capabilities', 'e2ee', 'maxLifetimeHours', 'maxSizeMB', 'online', 'status', '4.0.0']) {
        assert.ok(!written.includes(word), `config.json holds nothing a check found: ${word}`);
    }

    // The default removed: its place goes to the first left; the last removed, none.
    assert.ok(servers.remove(second.id));
    assert.equal(servers.default().id, first.id);
    servers.remove(first.id);
    servers.remove(third.id);
    assert.deepEqual(servers.list(), { servers: [], defaultServer: null });
    assert.equal(servers.default(), null);
});
