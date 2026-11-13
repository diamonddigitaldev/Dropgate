// Country and ISP, looked up on the machine: in a small test database
// of the tests' own, with every way off the machine watched; and the build that
// fetches DB-IP's two files, from a stand-in for db-ip.com on this machine, taking
// only what opens as DB-IP's; and the month held, read from each file's end, the
// newest of the app's own and the monthly refresh's winning (18.16). What the
// service tells main, and its refresh, are network-service.test.mjs's, and the app
// is desktop/location.spec.mjs' and desktop/location-refresh.spec.mjs'.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { KNOWN, WHOLE, countryRecord, locationDatabases, mmdb, writeLocationData } from './helpers/mmdb.mjs';

const require = createRequire(import.meta.url);
const { BASE_URL, DATABASES, lookUp, monthHeld, monthOf, newestData, openDatabase, placeOf } = require('../src/core/location.js');
const build = require('../scripts/location-data.cjs');

const CLIENT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(CLIENT, 'scripts', 'location-data.cjs');

const PLACES = {
    '203.0.113.42': { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 },
    '2001:db8:5:12::42': { code: 'GB', country: 'United Kingdom', isp: 'Example Broadband Ltd', asn: 64511 },
};

const folders = [];
const folder = () => {
    const made = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-location-'));
    folders.push(made);
    return made;
};
after(() => folders.forEach((made) => fs.rmSync(made, { recursive: true, force: true })));

/**
 * Run this with every way off the machine watched, and say what tried to leave:
 * sockets of either kind, either HTTP, Node's fetch and the OS's and c-ares' resolvers.
 */
async function offTheMachine(run) {
    const tried = [];
    const restore = [];
    const watch = (holder, name) => {
        const real = holder[name];
        holder[name] = function (...args) {
            tried.push(name);
            return real.apply(this, args);
        };
        restore.push(() => { holder[name] = real; });
    };
    watch(net.Socket.prototype, 'connect');
    watch(dgram.Socket.prototype, 'send');
    watch(dgram.Socket.prototype, 'bind');
    watch(dns, 'lookup');
    watch(dns.promises, 'lookup');
    watch(dns.Resolver.prototype, 'resolve');
    watch(dns.promises.Resolver.prototype, 'resolve');
    watch(http, 'request');
    watch(https, 'request');
    watch(globalThis, 'fetch');
    try {
        await run();
    } finally {
        for (const undo of restore) undo();
    }
    return tried;
}

test('18.14: a lookup gives the country, its code, and the AS\'s number and organisation, in English, for IPv4 and for IPv6', async () => {
    const data = folder();
    writeLocationData(data, PLACES);
    assert.deepEqual(await lookUp(data, { v4: '203.0.113.42', v6: '2001:db8:5:12::42' }), {
        month: '2026-11',
        v4: { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 },
        v6: { code: 'GB', country: 'United Kingdom', isp: 'Example Broadband Ltd', asn: 64511 },
    });
});

test('18.14: an address in neither database (a private one, say) has no place, and with no address nothing is looked up', async () => {
    const data = folder();
    writeLocationData(data, PLACES);
    assert.deepEqual(await lookUp(data, { v4: '10.0.0.1', v6: 'fd00::1' }), { month: '2026-11', v4: null, v6: null });
    assert.deepEqual(await lookUp(data, { v4: '203.0.113.42', v6: null }), { month: '2026-11', v4: PLACES['203.0.113.42'], v6: null });
    assert.deepEqual(await lookUp(data, {}), { month: '2026-11', v4: null, v6: null });
});

test('18.14: DB-IP\'s "Undefined" (ZZ) is no country: no flag to look for, and the ISP still stands', async () => {
    const data = folder();
    writeLocationData(data, { '203.0.113.5': { code: 'ZZ', country: 'Undefined', isp: 'Example Unplaced Ltd', asn: 64513 } });
    assert.deepEqual((await lookUp(data, { v4: '203.0.113.5' })).v4, { code: null, country: null, isp: 'Example Unplaced Ltd', asn: 64513 });
});

test('18.14: with one database, what the other holds is null; with no data, or a file that isn\'t DB-IP\'s, there\'s no answer, and it doesn\'t throw', async () => {
    const data = folder();
    writeLocationData(data, PLACES);
    fs.rmSync(path.join(data, DATABASES.asn.file));
    assert.deepEqual((await lookUp(data, { v4: '203.0.113.42' })).v4, { code: 'NL', country: 'Netherlands', isp: null, asn: null });

    assert.equal(await lookUp(folder(), { v4: '203.0.113.42' }), null, 'an empty folder');
    assert.equal(await lookUp(path.join(data, 'nowhere'), { v4: '203.0.113.42' }), null, 'no folder');

    const notDbIp = folder();
    for (const { file } of Object.values(DATABASES)) fs.writeFileSync(path.join(notDbIp, file), mmdb({ type: 'GeoLite2-Country', description: 'GeoLite2 Country database', records: { '203.0.113.42': countryRecord(PLACES['203.0.113.42']) } }));
    assert.equal(await lookUp(notDbIp, { v4: '203.0.113.42' }), null, 'another\'s database');
});

test('18.14: a lookup makes no request: no socket of either kind, no HTTP, no fetch, no DNS', async () => {
    const data = folder();
    writeLocationData(data, PLACES);
    let found;
    const tried = await offTheMachine(async () => {
        found = await lookUp(data, { v4: '203.0.113.42', v6: '2001:db8:5:12::42' });
    });
    assert.deepEqual(tried, []);
    assert.equal(found.v4.code, 'NL', 'it looked something up');

    // The watch itself: each of these would be seen.
    const seen = await offTheMachine(async () => {
        await fetch('http://127.0.0.1:9/').catch(() => {});
        await dns.promises.lookup('localhost').catch(() => {});
        await new Promise((resolve) => {
            const socket = dgram.createSocket('udp4');
            socket.send(Buffer.alloc(1), 9, '127.0.0.1', () => socket.close(resolve));
        });
    });
    for (const name of ['fetch', 'lookup', 'send']) assert.ok(seen.includes(name), `${name} would be seen`);
});

test('18.14: the code keeps nothing of a lookup, and asks nothing but its files', () => {
    const source = fs.readFileSync(new URL('../src/core/location.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /require\('(http|https|dns|dgram|tls|electron)'\)|\bfetch\(|writeFile|appendFile|console\./);
});

test('18.16: the month held is read from the end of each file alone, as DB-IP\'s; a folder isn\'t whole without both, of one month', async () => {
    const data = folder();
    assert.equal(await monthHeld(data), null, 'nothing there');
    writeLocationData(data, PLACES, { month: '2026-10' });
    assert.equal(await monthHeld(data), '2026-10');

    // Only the end is read: the metadata, not the 18 MB before it.
    const opened = [];
    const realOpen = fs.promises.open;
    fs.promises.open = async (...args) => {
        const file = await realOpen(...args);
        const realRead = file.read.bind(file);
        file.read = async (options) => {
            opened.push(options.buffer.length);
            return realRead(options);
        };
        return file;
    };
    const whole = folder();
    writeLocationData(whole, PLACES, { minNodes: WHOLE });
    try {
        assert.equal(await monthHeld(whole), '2026-11');
    } finally {
        fs.promises.open = realOpen;
    }
    assert.deepEqual(opened, [128 * 1024 + 14, 128 * 1024 + 14], 'each file\'s last 128 KiB and its marker');
    assert.ok(fs.statSync(path.join(whole, DATABASES.country.file)).size > 1024 * 1024);

    fs.writeFileSync(path.join(data, DATABASES.asn.file), locationDatabases(PLACES, { month: '2026-09' }).asn);
    assert.equal(await monthHeld(data), null, 'two months: a refresh cut off between its files');
    fs.writeFileSync(path.join(data, DATABASES.asn.file), mmdb({ type: 'GeoLite2-ASN', description: 'GeoLite2 ASN database', records: {} }));
    assert.equal(await monthHeld(data), null, "another's database");
    fs.writeFileSync(path.join(data, DATABASES.asn.file), Buffer.from('<html>Not a database</html>'));
    assert.equal(await monthHeld(data), null, 'no database');
    fs.rmSync(path.join(data, DATABASES.asn.file));
    assert.equal(await monthHeld(data), null, 'one file');
});

test('18.16: of the app\'s own and the refresh\'s, the newest month is the one looked in; on a tie, the app\'s own; one not whole is passed over', async () => {
    const own = folder();
    const refreshed = folder();
    writeLocationData(own, PLACES, { month: '2026-10' });
    writeLocationData(refreshed, { '203.0.113.42': { code: 'GB', country: 'United Kingdom', isp: 'Example Broadband Ltd', asn: 64511 } }, { month: '2026-11' });
    assert.deepEqual(await newestData([own, refreshed]), { folder: refreshed, month: '2026-11' });
    assert.equal((await lookUp([own, refreshed], { v4: '203.0.113.42' })).v4.code, 'GB');

    writeLocationData(own, PLACES, { month: '2026-12' });
    assert.deepEqual(await newestData([own, refreshed]), { folder: own, month: '2026-12' }, 'a newer release\'s own');
    assert.equal((await lookUp([own, refreshed], { v4: '203.0.113.42' })).v4.code, 'NL');

    writeLocationData(own, PLACES, { month: '2026-11' });
    assert.deepEqual(await newestData([own, refreshed]), { folder: own, month: '2026-11' }, 'a tie');

    fs.rmSync(path.join(own, DATABASES.asn.file));
    assert.deepEqual(await newestData([own, refreshed]), { folder: refreshed, month: '2026-11' }, 'not whole');
    assert.equal(await newestData([folder(), folder()]), null);
    assert.equal((await lookUp([own, folder()], { v4: '203.0.113.42' })).v4.country, 'Netherlands', 'none whole: the first, for what it has');
});

test('18.16: the refresh asks nothing but DB-IP\'s address, over HTTPS, and writes nothing but its two files in the folder it\'s given', () => {
    const source = fs.readFileSync(new URL('../src/core/location-refresh.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /require\('(http|dns|dgram|net|tls|electron)'\)|\bfetch\(|appendFile|console\./);
    assert.match(source, /require\('https'\)/);
    assert.equal(BASE_URL, 'https://download.db-ip.com/free/');
    assert.deepEqual(source.match(/fs\.promises\.\w+/g).sort(), ['fs.promises.mkdir', 'fs.promises.rename', 'fs.promises.rm', 'fs.promises.writeFile']);
});

test('the bad address and the record with nothing are no place', () => {
    const reader = openDatabase('country', locationDatabases(PLACES).country);
    assert.equal(placeOf({ country: reader, asn: null }, 'not an address'), null);
    assert.equal(monthOf(reader), '2026-11');
});

// --- The build ---

const databases = locationDatabases(PLACES);
const PACKED = { country: zlib.gzipSync(databases.country), asn: zlib.gzipSync(databases.asn) };
const NOW = new Date('2026-11-15T12:00:00Z');

/** A stand-in for db-ip.com's fetch: what each URL answers, by its file name. */
function stand(files) {
    const asked = [];
    const fetcher = async (url) => {
        asked.push(url);
        const name = url.split('/').at(-1);
        return name in files ? new Response(files[name]) : new Response('Not found', { status: 404 });
    };
    return { asked, fetcher };
}

const nov = (country = PACKED.country, asn = PACKED.asn) => ({ 'dbip-country-lite-2026-11.mmdb.gz': country, 'dbip-asn-lite-2026-11.mmdb.gz': asn });
const quiet = () => {};

/** What ensureLocationData() does with these answers, in a new folder, with the test database's size allowed. */
async function fetched(files, options = {}) {
    const into = folder();
    const { asked, fetcher } = stand(files);
    let month = null;
    let error = null;
    try {
        month = await build.ensureLocationData({ folder: into, base: 'https://db-ip.test/free/', fetcher, now: NOW, minNodes: 1, say: quiet, ...options });
    } catch (caught) {
        error = caught;
    }
    return { into, asked, month, error, files: fs.readdirSync(into) };
}

test('18.14: the build downloads this month\'s two files, from DB-IP\'s address, unpacks them and keeps them under their own names', async () => {
    const { into, asked, month, error, files } = await fetched(nov());
    assert.equal(error, null);
    assert.equal(month, '2026-11');
    assert.deepEqual(asked, ['https://db-ip.test/free/dbip-country-lite-2026-11.mmdb.gz', 'https://db-ip.test/free/dbip-asn-lite-2026-11.mmdb.gz']);
    assert.deepEqual(files.sort(), ['dbip-asn-lite.mmdb', 'dbip-country-lite.mmdb']);
    assert.equal((await lookUp(into, { v4: '203.0.113.42' })).v4.asn, 64500);
    assert.equal(build.urlOf('asn', '2026-11', 'https://download.db-ip.com/free/'), 'https://download.db-ip.com/free/dbip-asn-lite-2026-11.mmdb.gz');
});

test('18.14: the build refuses a file that doesn\'t open as DB-IP\'s database, and writes neither', async () => {
    const pack = (bytes) => zlib.gzipSync(bytes);
    const record = { [KNOWN]: countryRecord({ code: 'US', country: 'United States' }) };
    const refusals = {
        'an error page, not packed': [Buffer.from('<html>Rate limited</html>'), /incorrect header check|not in gzip format/i],
        // mmdb-lib's own words, whichever it finds first.
        'an error page, packed': [pack(Buffer.from('<html>Rate limited</html>')), /cannot parse|unknown type/i],
        'bytes that are no database': [pack(Buffer.alloc(4096, 7)), /cannot parse|unknown type/i],
        "MaxMind's database": [pack(mmdb({ type: 'GeoLite2-Country', description: 'GeoLite2 Country database', records: record })), /GeoLite2-Country/],
        "one that doesn't name DB-IP": [pack(mmdb({ description: 'Somebody else', records: record })), /doesn't name DB-IP/],
        'the wrong one of the two': [PACKED.asn, /DBIP-ASN-Lite/],
        'a month that isn\'t this one': [pack(locationDatabases(PLACES, { month: '2026-10' }).country), /from 2026-10, not 2026-11/],
        "records that don't read as DB-IP's": [pack(mmdb({ records: { [KNOWN]: { nothing: 'here' } } })), /doesn't read as/],
        'one without the known address': [pack(mmdb({ records: { '203.0.113.42': countryRecord(PLACES['203.0.113.42']) } })), /doesn't read as/],
    };
    for (const [what, [bytes, reason]] of Object.entries(refusals)) {
        const { error, files } = await fetched(nov(bytes));
        assert.match(String(error?.message), reason, what);
        assert.deepEqual(files, [], `${what}: nothing is written`);
    }

    // The second file bad: the first, though good, isn't kept.
    const { error, files } = await fetched(nov(PACKED.country, PACKED.country));
    assert.match(error.message, /DBIP-Country-Lite/);
    assert.deepEqual(files, []);
});

test('18.14: the build refuses a small file calling itself DB-IP\'s, as the whole database has over a million nodes', async () => {
    const { error, files } = await fetched(nov(), { minNodes: undefined });
    assert.match(error.message, /only \d+ nodes/);
    assert.deepEqual(files, []);
    assert.throws(() => build.checkDatabase('country', databases.country), /only \d+ nodes/);
    assert.equal(build.checkDatabase('country', databases.country, { minNodes: 1 }), '2026-11');
});

test('18.14: the build fails if it can\'t get them: nothing there this month, an error, or no answer; only asked to does it take last month\'s, and only for a month not out', async () => {
    const none = await fetched({});
    assert.match(none.error.message, /answered 404/);
    assert.deepEqual(none.files, []);

    const october = locationDatabases(PLACES, { month: '2026-10' });
    const lastMonth = { 'dbip-country-lite-2026-10.mmdb.gz': zlib.gzipSync(october.country), 'dbip-asn-lite-2026-10.mmdb.gz': zlib.gzipSync(october.asn) };
    const strict = await fetched(lastMonth);
    assert.match(strict.error.message, /2026-11\.mmdb\.gz answered 404/, 'a release never takes last month\'s');
    assert.deepEqual(strict.files, []);

    const allowed = await fetched(lastMonth, { orLastMonth: true });
    assert.equal(allowed.error, null);
    assert.equal(allowed.month, '2026-10');

    // A bad file, or a server failing, isn't a month not out yet.
    const bad = await fetched({ ...lastMonth, ...nov(Buffer.from('no')) }, { orLastMonth: true });
    assert.match(bad.error.message, /incorrect header check|not in gzip format/i);
    const failing = await fetched({}, { orLastMonth: true, fetcher: async () => new Response('', { status: 500 }) });
    assert.match(failing.error.message, /answered 500/);
    const gone = await fetched({}, { fetcher: async () => { throw new Error('No connection.'); } });
    assert.match(gone.error.message, /No connection/);
    assert.equal(build.monthBefore('2027-01'), '2026-12');
});

test('18.14: this month\'s files already there are left alone, and asked for by nobody; an earlier month\'s are replaced', async () => {
    const into = folder();
    writeLocationData(into, PLACES);
    const asked = stand(nov());
    assert.equal(await build.ensureLocationData({ folder: into, base: 'https://db-ip.test/', fetcher: asked.fetcher, now: NOW, minNodes: 1, say: quiet }), '2026-11');
    assert.deepEqual(asked.asked, []);

    const older = folder();
    writeLocationData(older, PLACES, { month: '2026-10' });
    const again = stand(nov());
    assert.equal(await build.ensureLocationData({ folder: older, base: 'https://db-ip.test/', fetcher: again.fetcher, now: NOW, minNodes: 1, say: quiet }), '2026-11');
    assert.equal(again.asked.length, 2);
    assert.equal(monthOf(openDatabase('country', fs.readFileSync(path.join(older, DATABASES.country.file)))), '2026-11');
});

test('18.14: a folder checked: both there, DB-IP\'s, from one month, of a month that will do', () => {
    const into = folder();
    assert.throws(() => build.checkFolder(into, { minNodes: 1 }), /isn't in/);
    writeLocationData(into, PLACES);
    assert.equal(build.checkFolder(into, { minNodes: 1 }), '2026-11');
    assert.throws(() => build.checkFolder(into, { minNodes: 1, months: ['2026-12'] }), /from 2026-11, not 2026-12/);
    assert.throws(() => build.checkFolder(into), /only \d+ nodes/);
    fs.writeFileSync(path.join(into, DATABASES.asn.file), locationDatabases(PLACES, { month: '2026-10' }).asn);
    assert.throws(() => build.checkFolder(into, { minNodes: 1 }), /different months, 2026-11 and 2026-10/);
    fs.writeFileSync(path.join(into, DATABASES.asn.file), databases.country);
    assert.throws(() => build.checkFolder(into, { minNodes: 1 }), /dbip-asn-lite\.mmdb: It says it's DBIP-Country-Lite/);
});

test('18.14: nothing is packed without good data of this month or last, however the build was started', () => {
    const empty = folder();
    assert.throws(() => build.checkReady(empty, { now: NOW, minNodes: 1 }), /The location data isn't ready, so the app can't be built\. Run npm run location-data .*isn't in/);

    const into = folder();
    writeLocationData(into, PLACES, { month: '2026-10' });
    build.checkReady(into, { now: NOW, minNodes: 1 });
    assert.throws(() => build.checkReady(into, { now: new Date('2026-12-15T12:00:00Z'), minNodes: 1 }), /from 2026-10, not 2026-12 or 2026-11/);
    assert.throws(() => build.checkReady(into, { now: NOW }), /only \d+ nodes/);
    for (const { file } of Object.values(DATABASES)) fs.writeFileSync(path.join(into, file), mmdb({ type: 'GeoLite2-Country', description: 'GeoLite2 Country database', records: {} }));
    assert.throws(() => build.checkReady(into, { now: NOW, minNodes: 1 }), /GeoLite2-Country/);
});

test('18.14: its command line fails, with a message, on a folder that isn\'t ready', () => {
    const empty = folder();
    const { status, stderr } = spawnSync(process.execPath, [SCRIPT, '--check', empty], { encoding: 'utf8' });
    assert.equal(status, 1);
    assert.match(stderr, /^Location data: dbip-country-lite\.mmdb isn't in /);

    const small = folder();
    writeLocationData(small, PLACES);
    assert.match(spawnSync(process.execPath, [SCRIPT, '--check', small], { encoding: 'utf8' }).stderr, /only \d+ nodes/);
});

test('18.14: every way of building goes through the check, and the data goes in the app\'s resources, never in app.asar', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(CLIENT, 'package.json'), 'utf8'));
    assert.match(packageJson.scripts.build, /^npm run location-data && electron-builder$/);
    assert.equal(packageJson.scripts['location-data'], 'node scripts/location-data.cjs');
    const config = require('../electron-builder.cjs');
    assert.equal(config.beforePack, './scripts/location-data.cjs', "electron-builder's hook, however it's started");
    assert.equal(typeof build, 'function', 'the file is the hook');
    assert.deepEqual(config.extraResources, [{ from: 'location-data', to: 'location-data', filter: ['*.mmdb'] }]);
    assert.ok(!config.files.some((pattern) => /location-data|\.mmdb/.test(pattern)));
});

test('18.14: DB-IP\'s files are never committed: they\'re ignored, and git has none, nor any database at all', () => {
    assert.match(fs.readFileSync(path.join(CLIENT, '.gitignore'), 'utf8'), /^location-data\/$/m);
    const tracked = execFileSync('git', ['ls-files', '--', '*.mmdb', '*.mmdb.gz'], { cwd: CLIENT, encoding: 'utf8' });
    assert.equal(tracked.trim(), '');
    const ignored = spawnSync('git', ['check-ignore', '-q', 'location-data/dbip-country-lite.mmdb'], { cwd: CLIENT });
    assert.equal(ignored.status, 0);
});

test('18.14: the flags are flag-icons\' 4x3 SVGs, kept in the package without what the app doesn\'t load, with its notice', () => {
    const config = require('../electron-builder.cjs');
    const packageJson = JSON.parse(fs.readFileSync(path.join(CLIENT, 'package.json'), 'utf8'));
    assert.ok(packageJson.dependencies['flag-icons'] && packageJson.dependencies['mmdb-lib']);
    for (const dropped of ['!node_modules/flag-icons/{css,sass}{,/**/*}', '!node_modules/flag-icons/flags/1x1{,/**/*}']) assert.ok(config.files.includes(dropped), dropped);
    assert.ok(!config.files.some((pattern) => /flag-icons\/.*(LICENSE|4x3)/.test(pattern)));
    const flags = path.join(CLIENT, 'node_modules', 'flag-icons', 'flags', '4x3');
    for (const code of ['nl', 'gb', 'us', 'de']) assert.ok(fs.statSync(path.join(flags, `${code}.svg`)).size > 0, code);
    assert.ok(fs.existsSync(path.join(CLIENT, 'node_modules', 'flag-icons', 'LICENSE')));
});

test('18.14: Credits names DB-IP and flag-icons, each linked, and CC BY\'s licence', () => {
    const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.ok(main.includes("['Location data: ', { text: 'IP Geolocation by DB-IP', href: 'https://db-ip.com' }, ', licensed under the ', { text: 'Creative Commons Attribution 4.0 International License', href: 'https://creativecommons.org/licenses/by/4.0/' }, '.']"));
    assert.ok(main.includes("['Country flags from ', { text: 'flag-icons', href: 'https://github.com/lipis/flag-icons' }, ', licensed under the MIT License.']"));
});
