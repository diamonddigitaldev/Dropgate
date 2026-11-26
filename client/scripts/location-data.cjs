'use strict';

// The location data the desktop app carries: DB-IP's IP to Country Lite and IP to
// ASN Lite (CC BY 4.0, credited in Credits), downloaded by the build, never by the
// app for a lookup, and never committed. They go in the app's resources, from
// client/location-data/ (electron-builder.cjs' extraResources).
//
//   node scripts/location-data.cjs                  This month's two files, unless
//                                                   they're there already. npm run build
//                                                   and the release's build run this.
//   node scripts/location-data.cjs --or-last-month  Or last month's, while this month's
//                                                   isn't out: DB-IP's come out in the first
//                                                   hours of the 1st, UTC. CI's own builds, which
//                                                   nobody installs.
//   node scripts/location-data.cjs --check <folder> Check a folder holds them: what the
//                                                   packaged app carries, say.
//
// A file is only taken if it opens as DB-IP's database: nothing else gets into
// the app's resources, as the tests are its only other source of an MMDB. Both are
// checked before either is written. electron-builder runs this file too, as
// its beforePack hook, so a build with no good data fails however it's started.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { LOCATION_DATA_FOLDER } = require('../src/constants');
const { BASE_URL, DATABASES, DOWNLOAD_MS, MAX_PACKED_BYTES, checkDatabase, monthAt, unpack, urlOf } = require('../src/core/location');

const FOLDER = path.join(__dirname, '..', LOCATION_DATA_FOLDER);

/** The month before this one. */
function monthBefore(month) {
    const [year, number] = month.split('-').map(Number);
    return monthAt(new Date(Date.UTC(year, number - 2, 1)));
}

/**
 * Whether a folder holds both, from one month: throws, saying why, if not.
 * @param {string} folder
 * @param {object} [options]
 * @param {string[]} [options.months] - The months that will do; any, without it.
 * @param {number} [options.minNodes]
 * @returns {string} The month they're from.
 */
function checkFolder(folder, { months, minNodes } = {}) {
    const found = Object.entries(DATABASES).map(([kind, { file }]) => {
        const place = path.join(folder, file);
        const held = fs.existsSync(place) ? fs.readFileSync(place) : null;
        if (!held) throw new Error(`${file} isn't in ${folder}.`);
        try {
            return checkDatabase(kind, held, { minNodes });
        } catch (error) {
            throw new Error(`${file}: ${error.message}`, { cause: error });
        }
    });
    if (found[0] !== found[1]) throw new Error(`The two files are from different months, ${found[0]} and ${found[1]}.`);
    if (months && !months.includes(found[0])) throw new Error(`They're from ${found[0]}, not ${months.join(' or ')}.`);
    return found[0];
}

/** One file's bytes, unpacked; a month not out yet says so, with its status. */
async function downloadFile(url, fetcher) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(DOWNLOAD_MS) });
    if (!response.ok) throw Object.assign(new Error(`${url} answered ${response.status}.`), { status: response.status });
    const packed = Buffer.from(await response.arrayBuffer());
    if (packed.length > MAX_PACKED_BYTES) throw new Error(`${url} is ${packed.length} bytes, far more than it should be.`);
    return unpack(packed);
}

/**
 * One month's two files, checked, then written. Neither is written unless both are good.
 * @returns {Promise<{ file: string, bytes: number, sha256: string }[]>}
 */
async function downloadMonth(month, { folder, base, fetcher, minNodes }) {
    const taken = [];
    for (const [kind, { file }] of Object.entries(DATABASES)) {
        const url = urlOf(kind, month, base);
        const bytes = await downloadFile(url, fetcher);
        try {
            checkDatabase(kind, bytes, { month, minNodes });
        } catch (error) {
            throw new Error(`${url}: ${error.message}`, { cause: error });
        }
        taken.push({ file, bytes });
    }
    fs.mkdirSync(folder, { recursive: true });
    return taken.map(({ file, bytes }) => {
        const place = path.join(folder, file);
        fs.writeFileSync(`${place}.next`, bytes);
        fs.renameSync(`${place}.next`, place);
        return { file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    });
}

/**
 * Make sure the folder holds this month's files, downloading them if not.
 * @param {object} [options]
 * @param {string} [options.folder]
 * @param {boolean} [options.orLastMonth] - Last month's will do, while this month's isn't out.
 * @param {string} [options.base]
 * @param {typeof fetch} [options.fetcher]
 * @param {Date} [options.now]
 * @param {number} [options.minNodes]
 * @param {(line: string) => void} [options.say]
 * @returns {Promise<string>} The month the folder now holds.
 */
async function ensureLocationData({ folder = FOLDER, orLastMonth = false, base = BASE_URL, fetcher = fetch, now = new Date(), minNodes, say = console.log } = {}) {
    const month = monthAt(now);
    let held;
    try {
        held = checkFolder(folder, { months: [month], minNodes });
    } catch {
        held = null;
    }
    if (held) {
        say(`Location data: ${folder} already holds ${month}'s.`);
        return month;
    }
    let taken;
    let got = month;
    try {
        taken = await downloadMonth(month, { folder, base, fetcher, minNodes });
    } catch (error) {
        if (!orLastMonth || error.status !== 404) throw error;
        got = monthBefore(month);
        say(`Location data: ${month}'s isn't out yet, so this takes ${got}'s.`);
        taken = await downloadMonth(got, { folder, base, fetcher, minNodes });
    }
    say(`Location data: ${got}'s, checked as DB-IP's, in ${folder}:`);
    for (const { file, bytes, sha256 } of taken) say(`  ${file}  ${bytes} bytes  sha256 ${sha256}`);
    return got;
}

/** Whether a folder's ready to be packed: good data, of this month or last. Throws, saying what to do, if not. */
function checkReady(folder, { now = new Date(), minNodes } = {}) {
    const month = monthAt(now);
    try {
        checkFolder(folder, { months: [month, monthBefore(month)], minNodes });
    } catch (error) {
        throw new Error(`The location data isn't ready, so the app can't be built. Run npm run location-data in client/ first. ${error.message}`, { cause: error });
    }
}

/** electron-builder's beforePack hook: nothing is packed without it. */
const beforePack = async () => checkReady(FOLDER);

module.exports = Object.assign(beforePack, { checkDatabase, checkFolder, checkReady, ensureLocationData, monthBefore, urlOf });

if (require.main === module) {
    const args = process.argv.slice(2);
    const asked = args[0] === '--check'
        ? (async () => console.log(`Location data: ${args[1]} holds DB-IP's two files, from ${checkFolder(path.resolve(args[1]))}.`))()
        : ensureLocationData({ orLastMonth: args.includes('--or-last-month') });
    asked.catch((error) => {
        console.error(`Location data: ${error.message}`);
        process.exit(1);
    });
}
