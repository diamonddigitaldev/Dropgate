// A small MMDB of the tests' own, made as they run, so nothing the tests read
// comes from outside and no binary is committed: the format MaxMind's spec gives
// (a binary tree of address bits, a data section, then metadata), with records
// as DB-IP's read (checked against its November 2026 files). Only whole addresses
// go in, which is all a test looks up.
import fs from 'node:fs';
import path from 'node:path';

const RECORD_BYTES = 3;
const NODE_BYTES = RECORD_BYTES * 2;
const SEPARATOR = 16;
const METADATA_MARKER = Buffer.concat([Buffer.from([0xab, 0xcd, 0xef]), Buffer.from('MaxMind.com')]);

const TYPE = Object.freeze({ STRING: 2, UINT16: 5, UINT32: 6, MAP: 7, UINT64: 9, ARRAY: 11 });

/** A field's control bytes: its type (those above 7 in a byte of their own) and its size. */
function control(type, size) {
    const first = (type <= 7 ? type : 0) << 5;
    const extended = type <= 7 ? [] : [type - 7];
    if (size < 29) return Buffer.from([first | size, ...extended]);
    if (size < 285) return Buffer.from([first | 29, ...extended, size - 29]);
    const more = size - 285;
    return Buffer.from([first | 30, ...extended, more >> 8, more & 0xff]);
}

/** A number's bytes, big-endian, with no leading zeros. */
function bigEndian(value) {
    const bytes = [];
    for (let rest = BigInt(value); rest > 0n; rest >>= 8n) bytes.unshift(Number(rest & 0xffn));
    return Buffer.from(bytes);
}

const number = (type, value) => {
    const bytes = bigEndian(value);
    return Buffer.concat([control(type, bytes.length), bytes]);
};

/** A value as the data section holds it. A number that isn't marked with a type is a uint32. */
function encode(value) {
    if (typeof value === 'string') {
        const bytes = Buffer.from(value);
        return Buffer.concat([control(TYPE.STRING, bytes.length), bytes]);
    }
    if (typeof value === 'number') return number(TYPE.UINT32, value);
    if (Array.isArray(value)) return Buffer.concat([control(TYPE.ARRAY, value.length), ...value.map(encode)]);
    if (value?.uint16 !== undefined) return number(TYPE.UINT16, value.uint16);
    if (value?.uint64 !== undefined) return number(TYPE.UINT64, value.uint64);
    const entries = Object.entries(value);
    return Buffer.concat([control(TYPE.MAP, entries.length), ...entries.flatMap(([key, held]) => [encode(key), encode(held)])]);
}

/** An address's bits as a 128-bit tree has them: IPv4 under 96 zeros, where a reader looks for it. */
function bitsOf(address) {
    const v4 = !address.includes(':');
    let value = 0n;
    if (v4) {
        for (const part of address.split('.')) value = (value << 8n) | BigInt(part);
    } else {
        const [head, tail = ''] = address.split('::');
        const groups = (part) => (part ? part.split(':') : []);
        const missing = 8 - groups(head).length - groups(tail).length;
        for (const group of [...groups(head), ...Array(address.includes('::') ? missing : 0).fill('0'), ...groups(tail)]) value = (value << 16n) | BigInt(`0x${group}`);
    }
    return value.toString(2).padStart(128, '0');
}

/**
 * A database's bytes.
 * @param {object} options
 * @param {Record<string, object>} options.records - Each whole address, and what it holds.
 * @param {string} [options.type] - What it says it is.
 * @param {string} [options.description]
 * @param {string} [options.month] - The month it says it was built in, as 2026-11.
 * @returns {Buffer}
 */
export function mmdb({ records, type = 'DBIP-Country-Lite', description = 'DB-IP.com - IP to Country', month = '2026-11' }) {
    const data = [];
    let dataLength = 0;
    const root = { children: [null, null] };
    let nodes = 1;
    for (const [address, record] of Object.entries(records)) {
        const encoded = encode(record);
        const offset = dataLength;
        data.push(encoded);
        dataLength += encoded.length;
        const bits = bitsOf(address);
        let node = root;
        for (let i = 0; i < bits.length - 1; i++) {
            const bit = Number(bits[i]);
            if (!node.children[bit]) {
                node.children[bit] = { children: [null, null] };
                nodes++;
            }
            node = node.children[bit];
        }
        node.children[Number(bits.at(-1))] = { offset };
    }

    // Numbered as they're met, so a child's number is known once its parent's written.
    const order = [root];
    for (const node of order) {
        for (const child of node.children) {
            if (child?.children) order.push(child);
        }
    }
    const numbers = new Map(order.map((node, index) => [node, index]));
    const tree = Buffer.alloc(nodes * NODE_BYTES);
    const recordOf = (child) => {
        if (!child) return nodes;
        return child.children ? numbers.get(child) : nodes + SEPARATOR + child.offset;
    };
    order.forEach((node, index) => node.children.forEach((child, side) => tree.writeUIntBE(recordOf(child), index * NODE_BYTES + side * RECORD_BYTES, RECORD_BYTES)));

    const metadata = encode({
        binary_format_major_version: { uint16: 2 },
        binary_format_minor_version: { uint16: 0 },
        build_epoch: { uint64: Date.parse(`${month}-01T02:47:39Z`) / 1000 },
        database_type: type,
        description: { en: description },
        ip_version: { uint16: 6 },
        languages: ['en'],
        node_count: nodes,
        record_size: { uint16: RECORD_BYTES * 8 },
    });
    return Buffer.concat([tree, Buffer.alloc(SEPARATOR), ...data, METADATA_MARKER, metadata]);
}

/** A country database's record, as DB-IP's reads. */
export const countryRecord = ({ code, country }) => ({
    continent: { code: 'EU', names: { en: 'Europe' } },
    country: { iso_code: code, names: { de: 'Anderswo', en: country } },
});

/** An ASN database's record, as DB-IP's reads. */
export const asnRecord = ({ isp, asn }) => ({ autonomous_system_number: asn, autonomous_system_organization: isp });

/** Google's public DNS, which the build's check asks each database for. */
export const KNOWN = '8.8.8.8';

/** The two databases' bytes, for these addresses. */
export function locationDatabases(places, { month = '2026-11' } = {}) {
    const known = { [KNOWN]: { code: 'US', country: 'United States', isp: 'Google LLC', asn: 15169 } };
    const all = Object.entries({ ...known, ...places });
    return {
        country: mmdb({ month, records: Object.fromEntries(all.map(([ip, place]) => [ip, countryRecord(place)])) }),
        asn: mmdb({ month, type: 'DBIP-ASN-Lite (compat=GeoLite2-ASN)', description: 'DB-IP.com - IP to ASN', records: Object.fromEntries(all.map(([ip, place]) => [ip, asnRecord(place)])) }),
    };
}

/**
 * Write the two databases in a folder, as the app's resources hold them.
 * @param {string} folder
 * @param {Record<string, { code: string, country: string, isp: string, asn: number }>} places - Each address, and where it is.
 */
export function writeLocationData(folder, places, options) {
    const { country, asn } = locationDatabases(places, options);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'dbip-country-lite.mmdb'), country);
    fs.writeFileSync(path.join(folder, 'dbip-asn-lite.mmdb'), asn);
}
