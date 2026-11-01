'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { Reader } = require('mmdb-lib');

// Country and ISP, looked up on this machine in DB-IP's free location data (IP
// to Country Lite and IP to ASN Lite, CC BY 4.0: Credits names them), with no
// Electron. The two files come with the app: the build downloads them
// (scripts/location-data.cjs), and they're never fetched by the app for this.
//
// A lookup sends nothing anywhere. The files are read for it and let go, as a
// check is rare and they're 18 MB; what it finds goes to whoever asked, and
// nothing here keeps it.

/** The two databases: each one's file, in the location data's folder, and how it names itself. */
const DATABASES = Object.freeze({
    country: Object.freeze({ file: 'dbip-country-lite.mmdb', type: /^DBIP-Country-Lite(?: |$)/ }),
    asn: Object.freeze({ file: 'dbip-asn-lite.mmdb', type: /^DBIP-ASN-Lite(?: |$)/ }),
});

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
    const { databaseType, description, ipVersion } = reader.metadata;
    if (!DATABASES[kind].type.test(String(databaseType))) throw new Error(`It says it's ${databaseType}, not DB-IP's ${kind} database.`);
    if (!String(description?.en).startsWith('DB-IP.com')) throw new Error("Its description doesn't name DB-IP.");
    if (ipVersion !== 6) throw new Error("It doesn't cover IPv6.");
    return reader;
}

/** The month a database was built in, as 2026-11: DB-IP's come out on the 1st, named for it. */
const monthOf = (reader) => new Date(reader.metadata.buildEpoch).toISOString().slice(0, 7);

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

/**
 * Look these External IPs up in the folder's databases.
 * @param {string} folder
 * @param {{ v4?: string | null, v6?: string | null }} ips
 * @returns {Promise<{ month: string, v4: ReturnType<typeof placeOf>, v6: ReturnType<typeof placeOf> } | null>} Null with no data to look in.
 */
async function lookUp(folder, { v4, v6 }) {
    const [country, asn] = await Promise.all([readDatabase(folder, 'country'), readDatabase(folder, 'asn')]);
    if (!country && !asn) return null;
    const databases = { country, asn };
    return { month: monthOf(country ?? asn), v4: v4 ? placeOf(databases, v4) : null, v6: v6 ? placeOf(databases, v6) : null };
}

module.exports = { DATABASES, lookUp, monthOf, openDatabase, placeOf };
