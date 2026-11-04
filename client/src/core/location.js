'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { promisify } = require('util');
const zlib = require('zlib');
const { Reader } = require('mmdb-lib');
const { parseMetadata } = require('mmdb-lib/lib/metadata');

// Country and ISP, looked up on this machine in DB-IP's free location data (IP
// to Country Lite and IP to ASN Lite, CC BY 4.0: Credits names them), with no
// Electron. The two files come with the app: the build downloads them
// (scripts/location-data.cjs), and they're never fetched by the app for a lookup.
// With the monthly refresh on, newer ones may be kept in the profile too
// (location-refresh.js), checked here as the build checks its own: the newest
// month held is the one used.
//
// A lookup sends nothing anywhere. The files are read for it and let go, as a
// check is rare and they're 18 MB; what it finds goes to whoever asked, and
// nothing here keeps it. The month held is read from the end of each file
// alone, where its metadata is, so main can say it without reading 18 MB.

/** The two databases: each one's file, in the location data's folder, and how it names itself. */
const DATABASES = Object.freeze({
    country: Object.freeze({ file: 'dbip-country-lite.mmdb', type: /^DBIP-Country-Lite(?: |$)/ }),
    asn: Object.freeze({ file: 'dbip-asn-lite.mmdb', type: /^DBIP-ASN-Lite(?: |$)/ }),
});

/** Where DB-IP keeps each month's files, packed. */
const BASE_URL = 'https://download.db-ip.com/free/';

/** DB-IP's address for one month's file. */
const urlOf = (kind, month, base = BASE_URL) => `${base}${DATABASES[kind].file.replace('.mmdb', `-${month}.mmdb.gz`)}`;

/** How long one file is given to download. */
const DOWNLOAD_MS = 120_000;

/** Each download's most, packed and unpacked: November 2026's are 4 and 5 MB, 8.5 and 9.6 MB. */
const MAX_PACKED_BYTES = 64 * 1024 * 1024;
const MAX_BYTES = 256 * 1024 * 1024;

/** The fewest nodes either has had (over a million): a small file naming itself DB-IP's isn't the database. */
const MIN_NODES = 500_000;

/** An address each must know, and how its record reads: Google's public DNS has been in both for as long as they've existed. */
const KNOWN_ADDRESS = '8.8.8.8';
const READS = Object.freeze({
    country: (record) => /^[A-Z]{2}$/.test(record?.country?.iso_code) && typeof record?.country?.names?.en === 'string',
    asn: (record) => Number.isSafeInteger(record?.autonomous_system_number) && typeof record?.autonomous_system_organization === 'string',
});

/** The most an MMDB's metadata may take, at the end of the file (MaxMind's spec), and its marker before it. */
const METADATA_BYTES = 128 * 1024 + 14;

/** A month as 2026-11, in UTC, as DB-IP's files are named. */
const monthAt = (date) => date.toISOString().slice(0, 7);

/** Whether a database's metadata names it as DB-IP's of this kind: throws, saying why, if not. */
function checkMetadata(kind, { databaseType, description, ipVersion }) {
    if (!DATABASES[kind].type.test(String(databaseType))) throw new Error(`It says it's ${databaseType}, not DB-IP's ${kind} database.`);
    if (!String(description?.en).startsWith('DB-IP.com')) throw new Error("Its description doesn't name DB-IP.");
    if (ipVersion !== 6) throw new Error("It doesn't cover IPv6.");
}

/**
 * Open one database, refusing whatever doesn't name itself as DB-IP's: a file
 * that isn't an MMDB throws in Reader, and another's (MaxMind's, or the other
 * of these two) in the checks after it.
 * @param {'country' | 'asn'} kind
 * @param {Buffer} bytes
 * @returns {Reader<any>}
 */
function openDatabase(kind, bytes) {
    const reader = new Reader(bytes);
    checkMetadata(kind, reader.metadata);
    return reader;
}

/** The month a database was built in, as 2026-11, from it or its metadata: DB-IP's come out on the 1st, named for it. */
const monthOf = (from) => monthAt(new Date((from.metadata ?? from).buildEpoch));

/**
 * Whether these bytes are DB-IP's database of this kind, whole, and of this
 * month if one's asked: throws, saying why, if not. The build checks its files
 * with it, and the refresh the ones it downloads.
 * @param {'country' | 'asn'} kind
 * @param {Buffer} bytes
 * @param {object} [options]
 * @param {string} [options.month]
 * @param {number} [options.minNodes]
 * @returns {string} The month it's from.
 */
function checkDatabase(kind, bytes, { month, minNodes = MIN_NODES } = {}) {
    const reader = openDatabase(kind, bytes);
    if (reader.metadata.nodeCount < minNodes) throw new Error(`It has only ${reader.metadata.nodeCount} nodes, so it isn't the whole database.`);
    if (!READS[kind](reader.get(KNOWN_ADDRESS))) throw new Error(`It doesn't read as DB-IP's records do, for ${KNOWN_ADDRESS}.`);
    const built = monthOf(reader);
    if (month && built !== month) throw new Error(`It's from ${built}, not ${month}.`);
    return built;
}

const gunzip = promisify(zlib.gunzip);

/** A downloaded file's bytes, unpacked, refusing more than any of DB-IP's could be. */
const unpack = (packed) => gunzip(packed, { maxOutputLength: MAX_BYTES });

/** How DB-IP's records say they don't know the country (named "Undefined"): no country, and flag-icons has no flag for it. */
const NO_COUNTRY = 'ZZ';

/**
 * What the databases hold of one address: an English name, as the app has only
 * English; null with nothing at all (a private address is in neither).
 * @param {{ country: Reader<any> | null, asn: Reader<any> | null }} databases
 * @param {string} ip
 * @returns {{ code: string | null, country: string | null, isp: string | null, asn: number | null } | null}
 */
function placeOf({ country, asn }, ip) {
    if (!net.isIP(ip)) return null;
    const listed = country?.get(ip)?.country;
    const found = listed?.iso_code === NO_COUNTRY ? null : listed;
    const network = asn?.get(ip);
    const place = {
        code: found?.iso_code ?? null,
        country: found?.names?.en ?? null,
        isp: network?.autonomous_system_organization ?? null,
        asn: network?.autonomous_system_number ?? null,
    };
    return Object.values(place).some((value) => value !== null) ? place : null;
}

/** One database from the folder, or null where it's not there or won't open (from source, nothing's been fetched). */
async function readDatabase(folder, kind) {
    try {
        return openDatabase(kind, await fs.promises.readFile(path.join(folder, DATABASES[kind].file)));
    } catch {
        return null;
    }
}

/** One database's month, from its metadata alone, at the end of the file: null where it's not there or not DB-IP's. */
async function monthOfFile(folder, kind) {
    let file;
    try {
        file = await fs.promises.open(path.join(folder, DATABASES[kind].file), 'r');
        const { size } = await file.stat();
        const length = Math.min(size, METADATA_BYTES);
        const { buffer } = await file.read({ buffer: Buffer.alloc(length), position: size - length });
        const metadata = parseMetadata(buffer);
        checkMetadata(kind, metadata);
        return monthOf(metadata);
    } catch {
        return null;
    } finally {
        await file?.close().catch(() => {});
    }
}

/**
 * The month a folder's data is from, as 2026-11: null unless both files are
 * there, name themselves as DB-IP's, and are from one month (a refresh cut off
 * between its two writes isn't whole).
 * @param {string} folder
 * @returns {Promise<string | null>}
 */
async function monthHeld(folder) {
    const [country, asn] = await Promise.all([monthOfFile(folder, 'country'), monthOfFile(folder, 'asn')]);
    return country && country === asn ? country : null;
}

/**
 * Of these folders, the one with the newest data, and its month: on a tie, the
 * first. Null with none whole.
 * @param {string[]} folders - The app's own first, then the refresh's.
 * @returns {Promise<{ folder: string, month: string } | null>}
 */
async function newestData(folders) {
    const months = await Promise.all(folders.map(monthHeld));
    let newest = null;
    folders.forEach((folder, index) => {
        if (months[index] && (!newest || months[index] > newest.month)) newest = { folder, month: months[index] };
    });
    return newest;
}

/**
 * Look these External IPs up in the location data: the folder's, or of several,
 * the one with the newest (the first, with none whole, for what it has).
 * @param {string | string[]} folders
 * @param {{ v4?: string | null, v6?: string | null }} ips
 * @returns {Promise<{ month: string, v4: ReturnType<typeof placeOf>, v6: ReturnType<typeof placeOf> } | null>} Null with no data to look in.
 */
async function lookUp(folders, { v4, v6 }) {
    const list = [folders].flat();
    const folder = list.length > 1 ? (await newestData(list))?.folder ?? list[0] : list[0];
    const [country, asn] = await Promise.all([readDatabase(folder, 'country'), readDatabase(folder, 'asn')]);
    if (!country && !asn) return null;
    const databases = { country, asn };
    return { month: monthOf(country ?? asn), v4: v4 ? placeOf(databases, v4) : null, v6: v6 ? placeOf(databases, v6) : null };
}

module.exports = {
    BASE_URL, DATABASES, DOWNLOAD_MS, MAX_PACKED_BYTES, MIN_NODES, checkDatabase, lookUp, monthAt, monthHeld, monthOf, newestData, openDatabase, placeOf, unpack, urlOf,
};
