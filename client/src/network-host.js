'use strict';

const fs = require('fs');
const path = require('path');
const { app, net, utilityProcess } = require('electron');
const { LOCATION_DATA_FOLDER, MAX_INTERFACE_NAME, NETWORK, NETWORK_SERVICE, REFRESHED_DATA_FOLDER } = require('./constants');
const { ExternalIp, healthOf } = require('./core/external-ip');
const { monthAt, monthHeld } = require('./core/location');

// Main's side of a chosen adapter: the network service (network-service.js), a
// utility process holding the SOCKS5 proxy, and the transfer session's proxy
// settings, which point at it while an adapter is chosen.
//
// - The service runs while an adapter is chosen, while the External IP check is
//   on and the app has a window (a Share with Dropgate launch asks nothing), and
//   while Settings > Network is shown, for the adapters it lists; it stops
//   NETWORK.IDLE_MS after none is so. With no adapter chosen, the check off and
//   the tab never opened, it never starts.
// - The External IP (core/external-ip.js) is told what the network is, whenever
//   the service says it changed, and asks through the service. Its answer stays
//   here, in memory, with the country and ISP the service looked up on the machine,
//   in the location data it's told of as it's started. So does the connection's
//   health, from it, the adapter and the OS's word on being online (net.isOnline(),
//   which has no event, so it's read every NETWORK.ONLINE_MS while the service runs,
//   and while the bottom bar shows in a window: the bar alone starts nothing else).
// - With an adapter chosen, the transfer session has one proxy, with no DIRECT
//   and loopback sent to it too, so nothing can connect but through it. Until
//   the service says where it listens, and from the moment it exits, the
//   session's proxy is NOWHERE: a port nothing can listen on, so nothing
//   connects. Neither is an IPv4 address, which is what could make Chromium
//   look up ipv4only.arpa past the proxy (core/network-service.js). With none chosen, it's the system's settings (none with
//   --no-proxy-server, as the tests launch the app, as the kit's updater does).
// - The kit's updater has the same proxy, set as the session's is, so an update
//   check or download never goes direct either: with one chosen, from before
//   its first check at launch (the kit keeps a proxy until electron-updater
//   loads, and a check waits for one being set). With none chosen at launch it
//   isn't touched; choosing none later goes back to how the app was launched.
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
// - The location data's month, read here from the end of each file (its
//   metadata alone) as the first window opens, so Settings > Network and the
//   details can say it with nothing else running: the bottom bar starts nothing.
//   The newest of the app's own and the monthly refresh's is the one used (the
//   service picks it the same way); the refresh's are deleted once the app's own
//   are as new (a newer release brought them), and as its switch goes off.
// - The monthly refresh (locationRefresh, off by default): with the app showing
//   a window (a share's launch asks nothing), once a run, when the data held is
//   from an earlier month than this one (UTC, as DB-IP's files are named), the
//   service downloads that month's through the adapter: with one chosen, once
//   it's there. Turning the switch on is the person asking, so that goes too. A
//   failure, or the app quitting first, is tried again at the next launch, never
//   sooner; kept, it's used at once, and nothing more is asked that month.

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

/** Where the location data is: in the app's resources, as the build put it; from source, beside src/. */
const locationData = () => path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), LOCATION_DATA_FOLDER);

/** Where the monthly refresh keeps what it downloads: in the profile. */
const refreshedData = () => path.join(app.getPath('userData'), REFRESHED_DATA_FOLDER);

/** This month, as DB-IP names its files: 2026-11, in UTC. */
const thisMonth = () => monthAt(new Date(Date.now()));

/**
 * Start main's side of the adapter. Call once the app is ready, before the
 * transfer window has any work.
 * @param {object} options
 * @param {any} options.kit - The kit, from start(): its settings, log and updater.
 * @param {Electron.Session} options.session - The transfer session.
 * @param {(reason: string) => void} [options.onUnavailable] - The chosen adapter went, or the service exited: fail what's running, with this reason.
 * @param {() => void} [options.onChanging] - The person is changing the adapter: stop what's running, as it can't carry on on its old route.
 * @param {(state: { name: string | null, present: boolean | null, adapters: { name: string, addresses: string[] }[] | null, connection: object }) => void} [options.onChanged] - For the window.
 * @param {() => ReturnType<import('./core/external-ip').stunSourceOf>} [options.stunSource] - Where the External IP is asked, now.
 */
function createNetworkHost({
    kit, session, onUnavailable = () => {}, onChanging = () => {}, onChanged = () => {}, stunSource = () => ({ reason: "There's no saved server, so there's no STUN server to ask.", waits: true, server: null }),
}) {
    /** The adapter chosen, by name, or null for any. */
    let name = savedName(kit.settings.get().networkInterface);
    /** Whether the External IP check's switch is on, and whether the app has had a window: a share's launch alone asks nothing. */
    let checkWanted = kit.settings.get().externalIpCheck === true;
    let windowed = false;
    /** Whether the bottom bar is on (networkBar): it shows the health, so the OS's word on being online is read for it. */
    let barOn = kit.settings.get().networkBar === true;
    /** The OS's word on being online, as last read. */
    let online = net.isOnline();
    let onlineTimer = null;
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
    /**
     * The location data: the month used and the app's own, once read (null
     * till then; a month null with none); the refresh's switch, whether it's
     * been asked for this run, and whether it's under way.
     */
    let location = null;
    let readingLocation = Promise.resolve();
    let refreshOn = kit.settings.get().locationRefresh === true;
    let refreshTried = false;
    let refreshing = false;

    const external = new ExternalIp({
        source: stunSource,
        isOnline: () => net.isOnline(),
        via: () => name,
        send: ({ id, stun }) => child?.postMessage({ type: NETWORK_SERVICE.CHECK_IP, id, stun }),
        changed: () => onChanged(state()),
    });

    /** What the window draws, and with what health. */
    function state() {
        online = net.isOnline();
        const shown = name === null ? null : present;
        const view = external.view();
        return { name, present: shown, adapters, location, connection: { ...view, health: healthOf({ online, name, present: shown, ...view }) } };
    }

    /**
     * Read which location data is used, and its month: the refresh's while its
     * switch is on and it's newer than the app's own, which it's deleted for
     * otherwise. Each read after the last.
     */
    function readLocation() {
        readingLocation = readingLocation.then(async () => {
            const refreshed = refreshedData();
            const [own, kept] = await Promise.all([monthHeld(locationData()), monthHeld(refreshed)]);
            const used = refreshOn && kept !== null && (own === null || kept > own);
            if (!used) {
                await fs.promises.rm(refreshed, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
                    .catch((error) => kit.log.warn(`Couldn't delete the refreshed location data (${error?.code ?? 'error'}).`));
            }
            location = { month: used ? kept : own, own };
        });
        return readingLocation;
    }

    /** Whether the refresh is due: on, the data read (as a window opens: a share's launch reads nothing) and from before this month, and not asked for yet this run. */
    const refreshDue = () => refreshOn && !closing && location !== null && !refreshTried
        && (location.month === null || location.month < thisMonth());

    /** Ask the service for this month's location data, if it's due and the network can carry it: with an adapter chosen, once it's there. */
    function refreshIfDue() {
        if (!refreshDue() || (name !== null && present !== true)) return;
        refreshTried = true;
        refreshing = true;
        clearTimeout(idleTimer);
        idleTimer = null;
        startService();
        // A service just started is asked once it listens.
        if (port !== null) child.postMessage({ type: NETWORK_SERVICE.REFRESH_LOCATION, month: thisMonth() });
    }

    /** The service's word on the refresh: what's kept is read again, and used from now on. */
    function refreshed(message) {
        if (!refreshing) return;
        refreshing = false;
        if (typeof message.month === 'string') kit.log.info('The location data was refreshed.');
        else kit.log.warn(`The location data couldn't be refreshed (${message.error === 'refused' ? "the files weren't DB-IP's" : "DB-IP couldn't be reached"}). It's tried again at the next launch.`);
        readLocation().then(() => onChanged(state()));
        idleSoon();
    }

    /** The network as the External IP goes through it: the chosen adapter's addresses, or with none, every adapter's. */
    const listAsNetwork = () => (adapters ? JSON.stringify(adapters) : null);

    /** Why nothing can connect now: the chosen adapter is gone, or the service with it. Null otherwise, and before it's known. */
    const refusal = () => (name !== null && present === false ? `${name} isn't connected.` : null);

    /** The one proxy for everything, with an adapter chosen: the service, or nowhere while it isn't there. */
    const held = () => ({ proxyRules: port === null ? NOWHERE : `socks5://${proxyHost}:${port}`, proxyBypassRules: LOOPBACK_TOO });

    /** The transfer session's proxy, as things are now. */
    function proxy() {
        if (name === null) return app.commandLine?.hasSwitch('no-proxy-server') ? { mode: 'direct' } : { mode: 'system' };
        return { mode: 'fixed_servers', ...held() };
    }

    /** Give the session its proxy, after any set before, and close its connections; the updater's, in the same breath. */
    function applyProxy() {
        // Now, not after the session's: an update check waits only for a proxy the kit has been given. The kit logs a failure itself.
        const updater = kit.updater.setProxy(name === null ? null : held()).catch(() => {});
        applying = applying.then(async () => {
            await session.setProxy(proxy());
            await session.closeAllConnections();
            await updater;
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
                if (refreshing) child.postMessage({ type: NETWORK_SERVICE.REFRESH_LOCATION, month: thisMonth() });
                break;
            case NETWORK_SERVICE.ADAPTERS:
                adapters = listOf(message.list);
                for (const resolve of listing.splice(0)) resolve();
                if (name === null) external.networkIs(listAsNetwork());
                onChanged(state());
                break;
            case NETWORK_SERVICE.STATE: {
                // One for a choice since changed.
                if (message.name !== name) return;
                if (!message.present) {
                    external.networkIs(null, { forget: true });
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
                    external.networkIs(JSON.stringify(message.addresses));
                    refreshIfDue();
                    onChanged(state());
                });
                break;
            }
            case NETWORK_SERVICE.IP_RESULT:
                external.heard(message);
                break;
            case NETWORK_SERVICE.LOCATION_REFRESHED:
                refreshed(message);
                break;
            default:
                break;
        }
    }

    /** Whether the service is needed now. */
    const needed = () => !closing && (name !== null || watching || external.on || refreshing);

    /** The OS's word on being online has no event: read while the service runs, and told as it changes. */
    function readOnline() {
        const now = net.isOnline();
        if (now === online) return;
        online = now;
        onChanged(state());
    }

    /** Read it while the service runs, or the bottom bar shows in a window; not otherwise. */
    function followOnline() {
        const wanted = !closing && (child !== null || (barOn && windowed));
        if (wanted && !onlineTimer) {
            onlineTimer = setInterval(readOnline, NETWORK.ONLINE_MS);
            onlineTimer.unref?.();
        } else if (!wanted && onlineTimer) {
            clearInterval(onlineTimer);
            onlineTimer = null;
        }
    }

    /** Start the service, if it's needed, or asked for: a name can't be checked without its list. */
    function startService(asked = false) {
        clearTimeout(restartTimer);
        restartTimer = null;
        if (child || !(asked || needed())) return;
        const started = utilityProcess.fork(path.join(__dirname, 'network-service.js'), [locationData(), refreshedData()], {
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
        followOnline();
    }

    /** The service has exited: by itself, nothing connects until it's back. */
    function exited() {
        const told = stopping;
        clearTimeout(stopTimer);
        stopTimer = null;
        stopping = false;
        child = null;
        followOnline();
        port = null;
        proxyHost = null;
        adapters = null;
        external.networkIs(null);
        // A refresh it took with it is tried at the next launch.
        refreshing = false;
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

    /** With nothing needing it, the service stops after a while. */
    function idleSoon() {
        clearTimeout(idleTimer);
        idleTimer = null;
        if (!child || needed()) return;
        idleTimer = setTimeout(() => {
            idleTimer = null;
            if (!child || needed()) return;
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
        external.networkIs(null, { forget: true });
        kit.settings.set({ networkInterface: next });
        await applyProxy();
        child?.postMessage({ type: NETWORK_SERVICE.SET_INTERFACE, name });
        if (next !== null) {
            await awaitReport();
        } else {
            settle();
            external.networkIs(listAsNetwork());
        }
        idleSoon();
        onChanged(state());
        return state();
    }

    /** The check on, or off, as the switch and the app's windows have it. */
    function applyCheck() {
        external.setOn(checkWanted && windowed);
        if (external.on) {
            clearTimeout(idleTimer);
            idleTimer = null;
            startService();
        } else {
            idleSoon();
        }
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

        /** A window has opened: the check, if its switch is on, runs from here; the location data is read, and refreshed if it's due. */
        windowOpened() {
            if (windowed) return;
            windowed = true;
            followOnline();
            applyCheck();
            readLocation().then(() => {
                refreshIfDue();
                onChanged(state());
            });
        },

        /**
         * Refresh location data monthly, as the switch is now: on, it's refreshed
         * now if it's due; off, the refresh's files go, and the app's own are used.
         * @param {boolean} on
         */
        setRefresh(on) {
            if (on === refreshOn) return;
            refreshOn = on;
            if (on) refreshIfDue();
            else if (windowed) readLocation().then(() => onChanged(state()));
        },

        /**
         * The bottom bar, on or off, as its switch is now: nothing but the OS's word
         * on being online is read for it, and nothing is started.
         * @param {boolean} on
         */
        setBar(on) {
            barOn = on;
            followOnline();
        },

        /**
         * Check my External IP, as the switch is now.
         * @param {boolean} on
         */
        setCheck(on) {
            checkWanted = on;
            applyCheck();
        },

        /** The default server's been checked: the launch's check may have been waiting for it. */
        serverChecked: () => external.serverChecked(),

        /** Check Again. The answer's the state now: the result is pushed when it comes. */
        checkAgain() {
            external.checkAgain();
            return state();
        },

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
            clearInterval(onlineTimer);
            external.stop();
            settle();
            child?.kill();
            child = null;
        },
    };
}

module.exports = { createNetworkHost, NOWHERE };
