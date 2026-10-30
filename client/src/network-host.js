'use strict';

const path = require('path');
const { app, utilityProcess } = require('electron');
const { MAX_INTERFACE_NAME, NETWORK, NETWORK_SERVICE } = require('./constants');

// Main's side of a chosen adapter: the network service (network-service.js), a
// utility process holding the SOCKS5 proxy, and the transfer session's proxy
// settings, which point at it while an adapter is chosen.
//
// - The service runs while an adapter is chosen, and while Settings > Network
//   is shown, for the adapters it lists; it stops NETWORK.IDLE_MS after neither
//   is so. With no adapter chosen and the tab never opened, it never starts.
// - With an adapter chosen, the transfer session has one proxy, with no DIRECT
//   and loopback sent to it too, so nothing can connect but through it. Until
//   the service says where it listens, and from the moment it exits, the
//   session's proxy is NOWHERE: a port nothing can listen on, so nothing
//   connects. Neither is an IPv4 address, which is what could make Chromium
//   look up ipv4only.arpa past the proxy (core/network-service.js). With none chosen, it's the system's settings (none with
//   --no-proxy-server, as the tests launch the app, as the kit's updater does).
// - A launch with one chosen holds the transfer window's work until the service
//   has said whether it's there (whenSettled(): NETWORK.SETTLE_MS at most, and
//   then it's taken as gone), so the first check doesn't fail for nothing.
// - The adapter gone, or the service exiting, is told once (onUnavailable), for
//   main to fail what's running. Nothing restarts by itself, nothing moves to
//   another adapter, and the setting is left as it is. The service is started
//   again if it exits (NETWORK.RESTART_MS).
// - A change closes the session's connections, and comes after onChanging, for
//   main to stop what's running: a request already being answered keeps its
//   connection through closeAllConnections(), so it would carry on by its old
//   route.
// - The name saved is the person's choice, the one thing it keeps. A stored one
//   of the wrong kind is taken as a name no adapter has, never as "any".

/** A port nothing can listen on: connecting to it fails at once. */
const NOWHERE = 'socks5://[::1]:0';

/** Sent through the proxy too, so one path is held and tested: Chromium's own rule would send loopback direct. */
const LOOPBACK_TOO = '<-loopback>';

/** What's stored, as a name: null for any, and anything else no adapter is called. */
function savedName(stored) {
    if (stored === null || stored === undefined) return null;
    return typeof stored === 'string' ? stored.slice(0, MAX_INTERFACE_NAME) : String(stored);
}

/** The adapters the service lists, as the page takes them: nothing it didn't say. */
const listOf = (list) => (Array.isArray(list) ? list : [])
    .filter((adapter) => typeof adapter?.name === 'string' && Array.isArray(adapter.addresses))
    .map(({ name, addresses }) => ({ name, addresses: addresses.filter((address) => typeof address === 'string') }));

/**
 * Start main's side of the adapter. Call once the app is ready, before the
 * transfer window has any work.
 * @param {object} options
 * @param {any} options.kit - The kit, from start(): its settings and log.
 * @param {Electron.Session} options.session - The transfer session.
 * @param {(reason: string) => void} [options.onUnavailable] - The chosen adapter went, or the service exited: fail what's running, with this reason.
 * @param {() => void} [options.onChanging] - The person is changing the adapter: stop what's running, as it can't carry on on its old route.
 * @param {(state: { name: string | null, present: boolean | null, adapters: { name: string, addresses: string[] }[] | null }) => void} [options.onChanged] - For the window.
 */
function createNetworkHost({ kit, session, onUnavailable = () => {}, onChanging = () => {}, onChanged = () => {} }) {
    /** The adapter chosen, by name, or null for any. */
    let name = savedName(kit.settings.get().networkInterface);
    /** Whether it's there: null until the service has said. */
    let present = null;
    /** The service, its proxy's port, and the adapters it last listed. */
    let child = null;
    let port = null;
    let proxyHost = null;
    let adapters = null;
    /** Whether the service was told to stop: its exit is no failure. */
    let stopping = false;
    /** Whether Settings > Network is shown, so the service's list is wanted. */
    let watching = false;
    let closing = false;
    let restartTimer = null;
    let idleTimer = null;
    let stopTimer = null;
    let settleTimer = null;
    /** Those waiting to hear whether the adapter's there, and for the list of adapters. */
    let settling = [];
    let listing = [];
    /** The proxy being set, and the change being made: each after the last. */
    let applying = Promise.resolve();
    let changing = Promise.resolve();
    /** Which of the service's reports is the newest: one that waited for the proxy is dropped if another came since. */
    let reports = 0;

    /** What the window draws. */
    const state = () => ({ name, present: name === null ? null : present, adapters });

    /** Why nothing can connect now: the chosen adapter is gone, or the service with it. Null otherwise, and before it's known. */
    const refusal = () => (name !== null && present === false ? `${name} isn't connected.` : null);

    /** The transfer session's proxy, as things are now. */
    function proxy() {
        if (name === null) return app.commandLine?.hasSwitch('no-proxy-server') ? { mode: 'direct' } : { mode: 'system' };
        const rules = port === null ? NOWHERE : `socks5://${proxyHost}:${port}`;
        return { mode: 'fixed_servers', proxyRules: rules, proxyBypassRules: LOOPBACK_TOO };
    }

    /** Give the session its proxy, after any set before, and close its connections. */
    function applyProxy() {
        applying = applying.then(async () => {
            await session.setProxy(proxy());
            await session.closeAllConnections();
        }).catch((error) => kit.log.warn(`Couldn't set the transfer session's proxy (${error?.name ?? 'error'}).`));
        return applying;
    }

    /** It's known now whether the adapter's there: what waited for that goes on. */
    function settle() {
        clearTimeout(settleTimer);
        settleTimer = null;
        for (const resolve of settling.splice(0)) resolve();
    }

    /** The adapter isn't there: told once, however it went. */
    function lost() {
        const told = present === false;
        present = false;
        reports++;
        settle();
        if (!told && name !== null) onUnavailable(refusal());
    }

    /** What the service said. */
    function heard(message) {
        switch (message?.type) {
            case NETWORK_SERVICE.LISTENING:
                if (!Number.isSafeInteger(message.port) || !['::1', '127.0.0.1'].includes(message.host)) return;
                port = message.port;
                proxyHost = message.host === '::1' ? '[::1]' : message.host;
                if (name !== null) {
                    applyProxy();
                    child.postMessage({ type: NETWORK_SERVICE.SET_INTERFACE, name });
                }
                break;
            case NETWORK_SERVICE.ADAPTERS:
                adapters = listOf(message.list);
                for (const resolve of listing.splice(0)) resolve();
                onChanged(state());
                break;
            case NETWORK_SERVICE.STATE: {
                // One for a choice since changed.
                if (message.name !== name) return;
                if (!message.present) {
                    lost();
                    onChanged(state());
                    return;
                }
                // There: usable once the session's proxy points at the service.
                const report = ++reports;
                applying.then(() => {
                    if (report !== reports) return;
                    present = true;
                    settle();
                    onChanged(state());
                });
                break;
            }
            default:
                break;
        }
    }

    /** Whether the service is needed now. */
    const needed = () => !closing && (name !== null || watching);

    /** Start the service, if it's needed, or asked for: a name can't be checked without its list. */
    function startService(asked = false) {
        clearTimeout(restartTimer);
        restartTimer = null;
        if (child || !(asked || needed())) return;
        const started = utilityProcess.fork(path.join(__dirname, 'network-service.js'), [], {
            serviceName: 'Dropgate Client Network Service',
            stdio: 'ignore',
        });
        child = started;
        started.on('message', (message) => {
            if (child === started) heard(message);
        });
        started.on('exit', () => {
            if (child === started) exited();
        });
    }

    /** The service has exited: by itself, nothing connects until it's back. */
    function exited() {
        const told = stopping;
        clearTimeout(stopTimer);
        stopTimer = null;
        stopping = false;
        child = null;
        port = null;
        proxyHost = null;
        adapters = null;
        if (closing) return;
        if (name !== null) {
            applyProxy();
            if (!told) {
                lost();
                onChanged(state());
            }
        }
        if (needed()) restartTimer = setTimeout(() => startService(), told ? 0 : NETWORK.RESTART_MS);
    }

    /** With no adapter chosen and the tab not shown, the service stops after a while. */
    function idleSoon() {
        clearTimeout(idleTimer);
        idleTimer = null;
        if (!child || name !== null || watching) return;
        idleTimer = setTimeout(() => {
            idleTimer = null;
            if (!child || name !== null || watching) return;
            stopping = true;
            const stopped = child;
            stopped.postMessage({ type: NETWORK_SERVICE.STOP });
            stopTimer = setTimeout(() => stopped.kill(), NETWORK.STOP_MS);
        }, NETWORK.IDLE_MS);
    }

    /** The service's list of adapters, as it is now: it's started for it if need be. */
    function listed() {
        startService(true);
        if (adapters) return Promise.resolve(adapters);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                listing = listing.filter((waiting) => waiting !== done);
                reject(new Error("The adapters couldn't be listed."));
            }, NETWORK.SETTLE_MS);
            const done = () => {
                clearTimeout(timer);
                resolve(adapters);
            };
            listing.push(done);
        });
    }

    /** Wait to hear whether the adapter's there, NETWORK.SETTLE_MS at most: not heard by then, it's taken as gone. */
    function awaitReport() {
        return new Promise((resolve) => {
            settling.push(resolve);
            settleTimer ??= setTimeout(() => {
                settleTimer = null;
                lost();
                onChanged(state());
            }, NETWORK.SETTLE_MS);
        });
    }

    /** Make the change: what runs is stopped, the session is given its proxy, then the service its adapter. */
    async function change(next) {
        if (next !== null) {
            // Started for this alone, with none chosen, the service stops again if the name isn't taken.
            const list = await listed().catch((error) => {
                idleSoon();
                throw error;
            });
            if (!list.some((adapter) => adapter.name === next)) {
                idleSoon();
                throw new Error(`${next} isn't connected.`);
            }
        }
        if (next === name) return state();
        onChanging();
        name = next;
        present = null;
        reports++;
        kit.settings.set({ networkInterface: next });
        await applyProxy();
        child?.postMessage({ type: NETWORK_SERVICE.SET_INTERFACE, name });
        if (next !== null) await awaitReport();
        else settle();
        idleSoon();
        onChanged(state());
        return state();
    }

    if (name !== null) {
        // Nothing connects until the service is there: set before the transfer window has any work.
        applyProxy();
        awaitReport();
        startService();
    }

    return {
        state,
        refusal,

        /** Once it's known whether the chosen adapter is there, with the session's proxy set: the transfer window's work waits for it. */
        whenSettled: () => (name !== null && present === null ? new Promise((resolve) => settling.push(resolve)) : Promise.resolve()).then(() => applying),

        /**
         * Settings > Network is shown or not: while it is, the service runs, and
         * its list reaches the window.
         * @param {boolean} on
         */
        async watch(on) {
            watching = on;
            if (on) {
                clearTimeout(idleTimer);
                idleTimer = null;
                await listed().catch(() => {});
            } else {
                idleSoon();
            }
            return state();
        },

        /**
         * Hold every connection to this adapter, or none (null). Only a name the
         * service lists now is taken; the answer's the state once the service
         * has said it's there.
         * @param {string | null} next
         */
        setInterface(next) {
            const made = changing.then(() => change(next));
            changing = made.catch(() => {});
            return made;
        },

        /** The app is quitting: the service goes, with no restart. Nothing connects after it. */
        close() {
            closing = true;
            for (const timer of [restartTimer, idleTimer, stopTimer, settleTimer]) clearTimeout(timer);
            settle();
            child?.kill();
            child = null;
        },
    };
}

module.exports = { createNetworkHost, NOWHERE };
