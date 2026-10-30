'use strict';

const os = require('os');
const net = require('net');

// The network adapters, as the OS lists them (os.networkInterfaces()): by the
// name it gives each ("Ethernet 3", "Tailscale" on Windows; eth0, wg0 on
// Linux), with the addresses it has now. Only adapters that are up with an
// address are listed. Electron's main process has no event for a change, so
// the network service polls the list: about 4 ms a call, once a second.

/** How often the watch reads the list. */
const WATCH_MS = 1_000;

const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');

/** Whether an address is a loopback one (127.0.0.0/8, ::1): it never leaves the machine. */
function isLoopback(address) {
    const family = net.isIP(address);
    return family !== 0 && LOOPBACK.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * An adapter's addresses a connection can be bound to: its first IPv4
 * address, and its first IPv6 one with no scope (a link-local fe80::
 * address reaches only its own link), or null for a family it hasn't got.
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>} interfaces - os.networkInterfaces()'s answer
 * @param {string} name
 * @returns {{ v4: string | null, v6: string | null } | null} null when it isn't listed
 */
function addressesOf(interfaces, name) {
    if (!Object.hasOwn(interfaces, name) || !Array.isArray(interfaces[name])) return null;
    const entries = interfaces[name];
    const v4 = entries.find((entry) => entry.family === 'IPv4' && net.isIPv4(entry.address))?.address ?? null;
    const v6 = entries.find((entry) => entry.family === 'IPv6' && net.isIPv6(entry.address) && !entry.scopeid && !/^fe[89ab]/i.test(entry.address))?.address ?? null;
    return { v4, v6 };
}

/**
 * The adapters a person can choose: each one up with an address, by name,
 * with its addresses, the system's loopback left out.
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>} interfaces
 * @returns {{ name: string, addresses: string[] }[]}
 */
function adapterList(interfaces) {
    return Object.entries(interfaces)
        .filter(([, entries]) => Array.isArray(entries) && entries.length > 0 && !entries.every((entry) => entry.internal))
        .map(([name, entries]) => ({ name, addresses: entries.map((entry) => entry.address) }));
}

/**
 * Watches one adapter, by its name: told each second whether it's still
 * listed and what its addresses are. A family's address that goes, or
 * changes, is told at the next read; so is the adapter going (its name no
 * longer listed, or no address left), and the list itself changing.
 */
class AdapterWatch {
    /**
     * @param {object} options
     * @param {() => NodeJS.Dict<os.NetworkInterfaceInfo[]>} [options.list] - os.networkInterfaces(), unless a test stands one in
     * @param {number} [options.intervalMs]
     * @param {(state: { name: string, present: boolean, addresses: { v4: string | null, v6: string | null } }, before: { v4: string | null, v6: string | null }) => void} [options.onState] - the watched adapter changed
     * @param {(list: { name: string, addresses: string[] }[]) => void} [options.onList] - the list changed
     */
    constructor({ list = os.networkInterfaces, intervalMs = WATCH_MS, onState = () => {}, onList = () => {} } = {}) {
        this.list = list;
        this.intervalMs = intervalMs;
        this.onState = onState;
        this.onList = onList;
        /** The adapter watched, by name, or null for none. */
        this.name = null;
        /** Its addresses at the last read; null until it's been read once. */
        this.addresses = null;
        this.listed = '';
        this.timer = null;
    }

    /** Read the list once: whatever changed is told. */
    read() {
        let interfaces;
        try {
            interfaces = this.list() ?? {};
        } catch {
            // The OS couldn't say: nothing is listed, so nothing is bound.
            interfaces = {};
        }
        const list = adapterList(interfaces);
        const listed = JSON.stringify(list);
        if (listed !== this.listed) {
            this.listed = listed;
            this.onList(list);
        }
        if (this.name === null) return;
        const now = addressesOf(interfaces, this.name) ?? { v4: null, v6: null };
        const before = this.addresses ?? { v4: null, v6: null };
        if (this.addresses && now.v4 === before.v4 && now.v6 === before.v6) return;
        this.addresses = now;
        this.onState({ name: this.name, present: Boolean(now.v4 || now.v6), addresses: { ...now } }, before);
    }

    /**
     * Watch this adapter (null: none), read at once: its state is told now,
     * whether it's there or not.
     * @param {string | null} name
     */
    watch(name) {
        this.name = name;
        this.addresses = null;
        this.read();
        if (!this.timer) {
            this.timer = setInterval(() => this.read(), this.intervalMs);
            this.timer.unref?.();
        }
    }

    /** Whether the watched adapter has an address now, of a family or either. */
    present(family) {
        if (family === 4) return Boolean(this.addresses?.v4);
        if (family === 6) return Boolean(this.addresses?.v6);
        return Boolean(this.addresses?.v4 || this.addresses?.v6);
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
    }
}

module.exports = { AdapterWatch, WATCH_MS, addressesOf, adapterList, isLoopback };
