// Main's side of a chosen adapter (src/network-host.js), loaded in plain Node
// with a stand-in for Electron (helpers/main-process.mjs) and its clock mocked:
// when the network service runs, what the transfer session's proxy is, what
// main is told as the adapter goes, and which names are taken; and the location
// data's month and its monthly refresh, on folders of the test's own. The service
// itself is network-service.test.mjs's; the two together are the desktop
// project's desktop/network.spec.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeMain } from './helpers/main-process.mjs';
import { monthFromNow, writeLocationData } from './helpers/mmdb.mjs';

const CLIENT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { INTERFACE_UNAVAILABLE, NETWORK, NETWORK_SERVICE, MAX_INTERFACE_NAME, SETTINGS_CHECKS } = require('../src/constants.js');
const { interfaceOf, watchingOf } = require('../src/core/payloads.js');
const { FALLBACK_CODES, movesOn } = require('../src/core/servers.js');
const { shareUpload } = require('../src/core/share.js');

const ADAPTER = 'wg-amsterdam';
const LIST = [{ name: ADAPTER, addresses: ['10.64.12.7'] }, { name: 'Ethernet 3', addresses: ['192.168.1.242'] }];
const PORT = 50123;

/** Let what's waiting on promises go on, without moving the mocked clock. */
const settled = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

/** A default server's STUN server, as main reads it from its last check. */
const STUN = { url: 'stun:stun.example:3478', stun: 'stun.example', server: 'Share Space' };

function setUp({ name = null, commandLine = {}, updaterRefuses = false, check = false, bar = false, refresh = false, source = STUN, isPackaged = false, userData = null } = {}) {
    const main = fakeMain({ settings: { networkInterface: name, externalIpCheck: check, networkBar: bar, locationRefresh: refresh } });
    main.electron.app.commandLine = { hasSwitch: (which) => commandLine[which] === true };
    main.electron.app.isPackaged = isPackaged;
    if (userData) main.electron.app.getPath = (which) => (which === 'userData' ? userData : path.join(userData, which));
    let online = true;
    main.electron.net.isOnline = () => online;
    const set = [];
    main.kit.settings.set = (changes) => set.push(changes);
    const logged = [];
    main.kit.log = { warn: (line) => logged.push(line), info: (line) => logged.push(line), error: (line) => logged.push(line) };
    const updater = [];
    main.kit.updater = { setProxy: updaterRefuses ? () => Promise.reject(new Error('Refused.')) : async (config) => { updater.push(config); } };
    const proxies = [];
    const session = {
        setProxy: async (config) => proxies.push(config),
        closeAllConnections: async () => proxies.push('closed'),
    };
    const unavailable = [];
    const changing = [];
    const changes = [];
    const { createNetworkHost, NOWHERE } = main.load('../src/network-host.js');
    const sources = { now: source };
    const network = createNetworkHost({
        kit: main.kit,
        session,
        onUnavailable: (reason) => unavailable.push(reason),
        onChanging: () => changing.push(true),
        onChanged: (state) => changes.push(state),
        stunSource: () => sources.now,
    });
    /** What the running service says, as it says it. */
    const tell = async (message, child = main.processes.at(-1)) => {
        child.emit('message', message);
        await settled();
    };
    /** The running service starting up: listening, and its list. */
    const listening = async (list = LIST) => {
        await tell({ type: NETWORK_SERVICE.LISTENING, port: PORT, host: '::1' });
        await tell({ type: NETWORK_SERVICE.ADAPTERS, list });
    };
    const there = (addresses = { v4: '10.64.12.7', v6: null }) => tell({ type: NETWORK_SERVICE.STATE, name: ADAPTER, present: true, addresses });
    const gone = () => tell({ type: NETWORK_SERVICE.STATE, name: ADAPTER, present: false, addresses: { v4: null, v6: null } });
    return {
        main, network, proxies, updater, set, logged, unavailable, changing, changes, tell, listening, there, gone, NOWHERE, sources, setOnline: (now) => { online = now; },
    };
}

const toService = (child) => child.messages.filter(({ type }) => type === NETWORK_SERVICE.SET_INTERFACE).map(({ name }) => name);
const bound = { mode: 'fixed_servers', proxyRules: `socks5://[::1]:${PORT}`, proxyBypassRules: '<-loopback>' };

/** The network's state without its connection, which its own tests read. */
const adapterState = ({ name, present, adapters }) => ({ name, present, adapters });

/** What the service was asked of the External IP. */
const askedOf = (child) => child.messages.filter(({ type }) => type === NETWORK_SERVICE.CHECK_IP);

function timers(t, apis = ['setTimeout']) {
    t.after(() => mock.timers.reset());
    mock.timers.enable({ apis });
}

test('with no adapter chosen, the service is never started and the session is left as it is', async (t) => {
    timers(t);
    const { main, network, proxies, unavailable } = setUp();
    await settled();
    assert.deepEqual(main.processes, []);
    assert.deepEqual(proxies, []);
    assert.equal(network.refusal(), null);
    assert.deepEqual(adapterState(network.state()), { name: null, present: null, adapters: null });
    await network.whenSettled();
    assert.deepEqual(unavailable, []);
});

test('with no adapter chosen, the kit\'s updater is left as it was launched: it\'s never told anything', async (t) => {
    timers(t);
    const { network, updater, listening } = setUp();
    const watched = network.watch(true);
    await settled();
    await listening();
    await watched;
    await network.setInterface(null);
    await settled();
    assert.deepEqual(updater, []);
});

test('a launch with one chosen holds the kit\'s updater from the moment it starts: nowhere, then the service, with the session\'s own rules', async (t) => {
    timers(t);
    const { updater, listening, there, NOWHERE } = setUp({ name: ADAPTER });
    // Not awaited: its check at launch waits only for a proxy the kit has been given.
    assert.deepEqual(updater, [{ proxyRules: NOWHERE, proxyBypassRules: '<-loopback>' }], 'set as the host starts, never left to the system');
    await listening();
    const { proxyRules, proxyBypassRules } = bound;
    assert.deepEqual(updater.slice(1), [{ proxyRules, proxyBypassRules }]);
    await there();
    assert.equal(updater.length, 2, 'the adapter being there changes nothing');
});

test('the kit\'s updater follows the session through everything that changes its proxy, and through nothing else', async (t) => {
    timers(t);
    const { main, network, proxies, updater, listening, there, gone, NOWHERE } = setUp({ name: ADAPTER });
    await listening();
    await there();
    const { proxyRules, proxyBypassRules } = bound;
    const session = () => proxies.filter((config) => config !== 'closed').map((config) => config.proxyRules ?? config.mode);
    const updaters = () => updater.map((config) => config?.proxyRules ?? config);

    // Gone, the service refuses for both: nothing to change, as a change would cut a download for no reason.
    const before = updater.length;
    await gone();
    await there();
    assert.equal(updater.length, before);

    // The service exiting: nowhere at once, then its new port.
    main.processes[0].emit('exit', 1);
    await settled();
    assert.equal(updaters().at(-1), NOWHERE);
    assert.equal(session().at(-1), NOWHERE);
    mock.timers.tick(NETWORK.RESTART_MS);
    await settled();
    await listening();
    assert.equal(updaters().at(-1), proxyRules);
    assert.equal(session().at(-1), proxyRules);
    assert.equal(updater.at(-1).proxyBypassRules, proxyBypassRules);

    // Any interface, and back.
    await there();
    await network.setInterface(null);
    assert.equal(updater.at(-1), null, 'back to how the app was launched');
    const answer = network.setInterface(ADAPTER);
    await settled();
    assert.equal(updaters().at(-1), proxyRules);
    await there();
    await answer;
});

test('the kit\'s updater refusing its proxy holds nothing else up: the kit logs it', async (t) => {
    timers(t);
    const { network, proxies, listening, there } = setUp({ name: ADAPTER, updaterRefuses: true });
    await listening();
    await there();
    await network.whenSettled();
    assert.deepEqual(proxies.slice(-2), [bound, 'closed']);
    assert.equal(network.state().present, true);
});

test('a machine with no IPv6 loopback has the session\'s proxy on 127.0.0.1, where the service says it listens; nothing else it says is taken', async (t) => {
    timers(t);
    const { proxies, tell, NOWHERE } = setUp({ name: ADAPTER });
    await settled();
    await tell({ type: NETWORK_SERVICE.LISTENING, port: PORT, host: '10.0.0.1' });
    assert.equal(proxies.filter((config) => config !== 'closed').length, 1, 'somewhere that isn\'t loopback is ignored');
    assert.equal(proxies[0].proxyRules, NOWHERE);
    assert.match(NOWHERE, /^socks5:\/\/\[::1\]:0$/, 'not an IPv4 address: Chromium could look up ipv4only.arpa past the proxy for one');
    await tell({ type: NETWORK_SERVICE.LISTENING, port: PORT, host: '127.0.0.1' });
    assert.deepEqual(proxies.slice(-2), [{ mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${PORT}`, proxyBypassRules: '<-loopback>' }, 'closed']);
});

test('a launch with one chosen points the session at nothing, then at the service, once it says it\'s there; the transfer window\'s work waits for it', async (t) => {
    timers(t);
    const { main, network, proxies, listening, there, NOWHERE } = setUp({ name: ADAPTER });
    await settled();
    assert.equal(main.processes.length, 1, 'started at once');
    assert.deepEqual(proxies, [{ mode: 'fixed_servers', proxyRules: NOWHERE, proxyBypassRules: '<-loopback>' }, 'closed'], 'no DIRECT at any moment');

    let heard = false;
    network.whenSettled().then(() => { heard = true; });
    await settled();
    assert.equal(heard, false);

    await listening();
    assert.deepEqual(toService(main.processes[0]), [ADAPTER]);
    assert.deepEqual(proxies.slice(2), [bound, 'closed']);
    assert.equal(heard, false, 'still not known whether it\'s there');
    assert.equal(network.refusal(), null, 'nor is it refused until it is');

    await there();
    assert.equal(heard, true);
    assert.equal(network.refusal(), null);
    assert.equal(network.state().present, true);
});

test('a launch that never hears of its adapter takes it as gone, after NETWORK.SETTLE_MS, with the session still pointing at nothing', async (t) => {
    timers(t);
    assert.equal(NETWORK.SETTLE_MS, 5_000);
    const { network, proxies, unavailable, NOWHERE } = setUp({ name: ADAPTER });
    await settled();
    mock.timers.tick(4_999);
    assert.deepEqual(unavailable, []);
    mock.timers.tick(1);
    await settled();
    assert.deepEqual(unavailable, [`${ADAPTER} isn't connected.`]);
    assert.equal(network.refusal(), `${ADAPTER} isn't connected.`);
    assert.deepEqual(proxies.filter((config) => config !== 'closed'), [{ mode: 'fixed_servers', proxyRules: NOWHERE, proxyBypassRules: '<-loopback>' }]);
    await network.whenSettled();
});

test('a stored adapter of the wrong kind is a name no adapter has, never any interface', async (t) => {
    timers(t);
    const { network, proxies, NOWHERE } = setUp({ name: 7 });
    await settled();
    assert.equal(network.state().name, '7');
    assert.deepEqual(proxies[0], { mode: 'fixed_servers', proxyRules: NOWHERE, proxyBypassRules: '<-loopback>' });
});

test('the adapter going is told once, with its name; back, it\'s usable again, nothing else being done; the setting is left as it was', async (t) => {
    timers(t);
    const { main, network, proxies, set, unavailable, listening, there, gone, changes } = setUp({ name: ADAPTER });
    await listening();
    await there();
    const before = proxies.length;

    await gone();
    await gone();
    assert.deepEqual(unavailable, [`${ADAPTER} isn't connected.`], 'once, for its going');
    assert.equal(network.refusal(), `${ADAPTER} isn't connected.`);
    assert.equal(changes.at(-1).present, false);
    assert.equal(changes.at(-1).name, ADAPTER, 'still chosen');
    assert.equal(proxies.length, before, 'the session still has the service: which refuses');

    await there();
    assert.equal(network.refusal(), null);
    assert.equal(changes.at(-1).present, true);
    assert.deepEqual(unavailable, [`${ADAPTER} isn't connected.`], 'nothing failed for its coming back');
    assert.deepEqual(set, [], 'nothing changes it but the person');
    assert.equal(main.processes.length, 1, 'the service stayed');
});

test('a report that waited for the proxy doesn\'t undo its going', async (t) => {
    timers(t);
    const { network, listening, there, gone } = setUp({ name: ADAPTER });
    await listening();
    const coming = there();
    await gone();
    await coming;
    assert.equal(network.refusal(), `${ADAPTER} isn't connected.`);
});

test('the service exiting points the session at nothing at once, fails as for gone, and it\'s started again', async (t) => {
    timers(t);
    assert.equal(NETWORK.RESTART_MS, 1_000);
    const { main, network, proxies, unavailable, listening, there, NOWHERE } = setUp({ name: ADAPTER });
    await listening();
    await there();
    const before = proxies.length;

    main.processes[0].emit('exit', 1);
    await settled();
    assert.deepEqual(proxies.slice(before), [{ mode: 'fixed_servers', proxyRules: NOWHERE, proxyBypassRules: '<-loopback>' }, 'closed']);
    assert.deepEqual(unavailable, [`${ADAPTER} isn't connected.`]);
    assert.equal(network.refusal(), `${ADAPTER} isn't connected.`);
    assert.equal(network.state().adapters, null, 'its list went with it');

    assert.equal(main.processes.length, 1);
    mock.timers.tick(NETWORK.RESTART_MS);
    assert.equal(main.processes.length, 2);

    // An old process's word counts for nothing.
    await listening();
    assert.deepEqual(toService(main.processes[1]), [ADAPTER], 'told its adapter again');
    assert.equal(network.refusal(), `${ADAPTER} isn't connected.`, 'until it says it\'s there');
    await there();
    assert.equal(network.refusal(), null);
    assert.deepEqual(proxies.slice(-2), [bound, 'closed']);
});

test('quitting takes the service with no restart', async (t) => {
    timers(t);
    const { main, network, listening, there } = setUp({ name: ADAPTER });
    await listening();
    await there();
    network.close();
    assert.equal(main.processes[0].killed, true);
    main.processes[0].emit('exit', 0);
    mock.timers.tick(NETWORK.RESTART_MS * 10);
    assert.equal(main.processes.length, 1);
});

test('Settings > Network shown starts the service for its list; hidden, with none chosen, it stops after NETWORK.IDLE_MS; shown again, it stays', async (t) => {
    timers(t);
    assert.equal(NETWORK.IDLE_MS, 30_000);
    const { main, network, listening } = setUp();

    // Hidden, as the page first says: nothing starts.
    assert.deepEqual(adapterState(await network.watch(false)), { name: null, present: null, adapters: null });
    assert.deepEqual(main.processes, []);

    const shown = network.watch(true);
    assert.equal(main.processes.length, 1);
    await listening();
    assert.deepEqual((await shown).adapters, LIST);
    const [child] = main.processes;
    assert.deepEqual(toService(child), [], 'told of no adapter: none is chosen');

    await network.watch(false);
    mock.timers.tick(NETWORK.IDLE_MS - 1);
    await network.watch(true);
    mock.timers.tick(NETWORK.IDLE_MS * 2);
    assert.deepEqual(child.messages.filter(({ type }) => type === NETWORK_SERVICE.STOP), [], 'shown again in time');

    await network.watch(false);
    mock.timers.tick(NETWORK.IDLE_MS);
    assert.deepEqual(child.messages.filter(({ type }) => type === NETWORK_SERVICE.STOP), [{ type: NETWORK_SERVICE.STOP }]);
    mock.timers.tick(NETWORK.STOP_MS);
    assert.equal(child.killed, true, 'if it won\'t stop by itself');
    child.emit('exit', 0);
    mock.timers.tick(NETWORK.RESTART_MS * 10);
    assert.equal(main.processes.length, 1, 'not started again: its stopping was no failure');
});

test('set-interface takes a name the service lists now, or none, saves it, and points the session at the service; anything else is refused, nothing changing', async (t) => {
    timers(t);
    const { main, network, proxies, set, changing, listening, there } = setUp();

    const refused = network.setInterface('Not There');
    await settled();
    assert.equal(main.processes.length, 1, 'started, to list what\'s there');
    await listening();
    await assert.rejects(refused, /Not There isn't connected\./);
    assert.deepEqual(set, []);
    assert.deepEqual(proxies, []);
    assert.deepEqual(changing, []);
    assert.equal(network.state().name, null);

    const chosen = network.setInterface(ADAPTER);
    await settled();
    assert.deepEqual(changing, [true], 'what runs is stopped first');
    assert.deepEqual(set, [{ networkInterface: ADAPTER }]);
    assert.deepEqual(proxies, [bound, 'closed']);
    assert.deepEqual(toService(main.processes[0]), [ADAPTER]);
    await there();
    assert.deepEqual((await chosen).present, true);

    // The same again changes nothing, and stops nothing.
    await network.setInterface(ADAPTER);
    assert.deepEqual(changing, [true]);
    assert.deepEqual(set, [{ networkInterface: ADAPTER }]);
});

test('going back to any interface gives the session the system\'s settings, closes its connections, and the service stops after a while', async (t) => {
    timers(t);
    const { main, network, proxies, set, changing, listening, there } = setUp({ name: ADAPTER });
    await listening();
    await there();
    const before = proxies.length;

    const answer = await network.setInterface(null);
    assert.deepEqual(adapterState(answer), { name: null, present: null, adapters: LIST });
    assert.deepEqual(changing, [true]);
    assert.deepEqual(set, [{ networkInterface: null }]);
    assert.deepEqual(proxies.slice(before), [{ mode: 'system' }, 'closed']);
    assert.deepEqual(toService(main.processes[0]), [ADAPTER, null]);
    assert.equal(network.refusal(), null);

    mock.timers.tick(NETWORK.IDLE_MS);
    assert.deepEqual(main.processes[0].messages.at(-1), { type: NETWORK_SERVICE.STOP });
});

test('launched with --no-proxy-server, as the tests are, any interface goes direct: the system\'s settings would look for a proxy', async (t) => {
    timers(t);
    const { network, proxies, listening, there } = setUp({ name: ADAPTER, commandLine: { 'no-proxy-server': true } });
    await listening();
    await there();
    await network.setInterface(null);
    assert.deepEqual(proxies.slice(-2), [{ mode: 'direct' }, 'closed']);
});

test('a state for an adapter since changed is ignored', async (t) => {
    timers(t);
    const { network, unavailable, listening, there, tell } = setUp({ name: ADAPTER });
    await listening();
    await there();
    await tell({ type: NETWORK_SERVICE.STATE, name: 'Ethernet 3', present: false, addresses: { v4: null, v6: null } });
    assert.deepEqual(unavailable, []);
    assert.equal(network.refusal(), null);
});

// --- The External IP (`09` 18.11, 18.12): when it's asked, as main decides ---

test('with the check off (the default), the service never starts for it and nothing is asked, whatever the network does', async (t) => {
    timers(t);
    const { main, network, listening } = setUp();
    network.windowOpened();
    network.serverChecked();
    await settled();
    assert.deepEqual(main.processes, [], 'no service');

    // Running for the tab: its list changing asks nothing.
    const shown = network.watch(true);
    await listening();
    await shown;
    await listening([...LIST, { name: 'Tailscale', addresses: ['100.80.130.2'] }]);
    mock.timers.tick(NETWORK.IP_SETTLE_MS * 10);
    network.checkAgain();
    await settled();
    assert.deepEqual(askedOf(main.processes[0]), []);
    assert.deepEqual(network.state().connection.result, null);
});

test('on, a launch with no window (a share) starts nothing and asks nothing; its window opening does', async (t) => {
    timers(t);
    const { main, network, listening } = setUp({ check: true });
    await settled();
    assert.deepEqual(main.processes, [], 'a share asks nothing');
    network.windowOpened();
    assert.equal(main.processes.length, 1);
    await listening();
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    assert.deepEqual(askedOf(main.processes[0]), [{ type: NETWORK_SERVICE.CHECK_IP, id: 1, stun: STUN.url }]);
});

test('on, it asks once at launch and never on a timer; once when the network changes, however many changes make it; once per Check Again', async (t) => {
    timers(t, ['setTimeout', 'setInterval']);
    const { main, network, listening, tell, changes } = setUp({ check: true });
    network.windowOpened();
    await listening();
    const [child] = main.processes;
    const answer = (id) => tell({ type: NETWORK_SERVICE.IP_RESULT, id, v4: '203.0.113.42', v6: '2001:db8:5:12::42', latency: 18 });

    assert.equal(network.state().connection.checking, true, 'it says so from here');
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    assert.equal(askedOf(child).length, 1, 'at launch');
    await answer(1);
    const { result, health } = network.state().connection;
    assert.deepEqual({ ...result, at: 0 }, { ok: true, v4: '203.0.113.42', v6: '2001:db8:5:12::42', latency: 18, at: 0, via: null, stun: STUN.stun, places: { v4: null, v6: null }, month: null });
    assert.equal(health.tone, 'success');
    assert.deepEqual(changes.at(-1).connection.result, result, 'pushed');

    // A day later: nothing. No timer of any length asks.
    for (let hour = 0; hour < 24; hour += 1) mock.timers.tick(3_600_000);
    assert.equal(askedOf(child).length, 1, 'never on a timer');

    // A VPN coming up: three changes in a row, one request, after the last.
    const moved = (address) => tell({ type: NETWORK_SERVICE.ADAPTERS, list: [{ name: ADAPTER, addresses: [address] }] });
    await moved('10.64.12.8');
    mock.timers.tick(NETWORK.IP_SETTLE_MS - 1);
    await moved('10.64.12.9');
    mock.timers.tick(NETWORK.IP_SETTLE_MS - 1);
    await moved('10.64.12.10');
    assert.equal(askedOf(child).length, 1);
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    assert.equal(askedOf(child).length, 2, 'once for the change');
    await answer(2);

    // The same list again asks nothing, and nor does one that's back before it settled.
    await moved('10.64.12.10');
    mock.timers.tick(NETWORK.IP_SETTLE_MS * 2);
    assert.equal(askedOf(child).length, 2);
    await moved('10.64.12.11');
    assert.equal(network.state().connection.checking, true);
    await moved('10.64.12.10');
    assert.equal(network.state().connection.checking, false);
    mock.timers.tick(NETWORK.IP_SETTLE_MS * 2);
    assert.equal(askedOf(child).length, 2);

    network.checkAgain();
    assert.equal(askedOf(child).length, 3, 'Check Again');
    network.checkAgain();
    assert.equal(askedOf(child).length, 3, 'not again while one is under way');
    await answer(3);
    network.checkAgain();
    assert.equal(askedOf(child).length, 4);
});

test('with an adapter chosen, its addresses are what count: another adapter changing asks nothing; gone, what was known goes; back, it asks', async (t) => {
    timers(t);
    const { main, network, listening, there, gone, tell } = setUp({ name: ADAPTER, check: true });
    network.windowOpened();
    await listening();
    await there();
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    const [child] = main.processes;
    assert.equal(askedOf(child).length, 1, 'at launch, once it\'s there');
    await tell({ type: NETWORK_SERVICE.IP_RESULT, id: 1, v4: '203.0.113.42', v6: null, latency: 18 });
    assert.equal(network.state().connection.result.via, ADAPTER);

    await tell({ type: NETWORK_SERVICE.ADAPTERS, list: [...LIST, { name: 'Tailscale', addresses: ['100.80.130.2'] }] });
    mock.timers.tick(NETWORK.IP_SETTLE_MS * 2);
    assert.equal(askedOf(child).length, 1, 'another adapter');

    await there({ v4: '10.64.12.8', v6: null });
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    assert.equal(askedOf(child).length, 2, 'its address changed');
    await tell({ type: NETWORK_SERVICE.IP_RESULT, id: 2, v4: '203.0.113.43', v6: null, latency: 19 });

    await gone();
    assert.equal(network.state().connection.result, null, 'what was known went with it');
    assert.equal(network.state().connection.health.tone, 'danger');
    network.checkAgain();
    mock.timers.tick(NETWORK.IP_SETTLE_MS * 2);
    assert.equal(askedOf(child).length, 2, 'nothing is asked through nothing');

    await there({ v4: '10.64.12.8', v6: null });
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    assert.equal(askedOf(child).length, 3, 'back');
});

test('an answer for a request since dropped is ignored: the adapter changing, or the switch going off, mid-request', async (t) => {
    timers(t);
    const { main, network, listening, there, tell } = setUp({ name: ADAPTER, check: true });
    network.windowOpened();
    await listening();
    await there();
    mock.timers.tick(NETWORK.IP_SETTLE_MS);

    await there({ v4: '10.64.12.8', v6: null });
    await tell({ type: NETWORK_SERVICE.IP_RESULT, id: 1, v4: '203.0.113.42', v6: null, latency: 18 });
    assert.equal(network.state().connection.result, null, 'the old adapter\'s address');
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    assert.equal(askedOf(main.processes[0]).length, 2);

    network.setCheck(false);
    await tell({ type: NETWORK_SERVICE.IP_RESULT, id: 2, v4: '203.0.113.42', v6: null, latency: 18 });
    assert.equal(network.state().connection.result, null);
    assert.equal(network.state().connection.on, false);
});

test('with no STUN server to ask, nothing is, and the state says why; one waiting on the default server\'s check goes when it comes', async (t) => {
    timers(t);
    const { main, network, listening, sources } = setUp({ check: true, source: { reason: 'Not yet.', waits: true, unchecked: true, server: 'Share Space' } });
    network.windowOpened();
    await listening();
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    const [child] = main.processes;
    assert.deepEqual(askedOf(child), []);
    assert.equal(network.state().connection.result, null, 'nothing to say yet');
    assert.equal(network.state().connection.health.text, 'Connected · External IP Not Checked Yet');

    // No STUN server: said, and no later check brings a request by itself.
    sources.now = { reason: 'Share Space lists no STUN server.', waits: false, server: 'Share Space' };
    network.serverChecked();
    assert.deepEqual(askedOf(child), []);
    assert.deepEqual(network.state().connection.result, { ok: false, reason: 'Share Space lists no STUN server.' });
    assert.equal(network.state().connection.health.text, 'Connected · External IP Unavailable');
    assert.equal(network.state().connection.health.title, 'Share Space lists no STUN server.');
    sources.now = STUN;
    network.serverChecked();
    assert.deepEqual(askedOf(child), [], 'nothing was waiting');
    // Check Again reads it afresh.
    network.checkAgain();
    assert.equal(askedOf(child).length, 1);
});

test('the launch\'s check goes when the default server\'s first check says where to ask, and that check going again later asks nothing more', async (t) => {
    timers(t);
    const { main, network, listening, sources, tell } = setUp({ check: true, source: { reason: 'Not yet.', waits: true, unchecked: true, server: 'Share Space' } });
    network.windowOpened();
    await listening();
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    const [child] = main.processes;
    sources.now = STUN;
    network.serverChecked();
    assert.equal(askedOf(child).length, 1);
    await tell({ type: NETWORK_SERVICE.IP_RESULT, id: 1, v4: '203.0.113.42', v6: null, latency: 18 });
    network.serverChecked();
    network.serverChecked();
    assert.equal(askedOf(child).length, 1, 'the default is checked before each upload too');
});

test('a failed answer says why, as yellow; nothing is asked again until the network or the person says', async (t) => {
    timers(t);
    const { main, network, listening, tell } = setUp({ check: true });
    network.windowOpened();
    await listening();
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    await tell({ type: NETWORK_SERVICE.IP_RESULT, id: 1, error: 'timeout' });
    assert.deepEqual(network.state().connection.result, { ok: false, reason: 'stun.example didn\'t answer within 5 seconds.' });
    assert.equal(network.state().connection.health.tone, 'warning');
    mock.timers.tick(3_600_000);
    assert.equal(askedOf(main.processes[0]).length, 1);
    network.checkAgain();
    await tell({ type: NETWORK_SERVICE.IP_RESULT, id: 2, error: 'unreachable' });
    assert.deepEqual(network.state().connection.result, { ok: false, reason: 'stun.example couldn\'t be reached.' });
    // A word from the service that isn't an address is no address.
    network.checkAgain();
    await tell({ type: NETWORK_SERVICE.IP_RESULT, id: 3, v4: '<b>not an address</b>', v6: null, latency: 18 });
    assert.equal(network.state().connection.result.ok, false);
});

test('offline, nothing is asked; the OS\'s word is read as the service runs, and told as it changes', async (t) => {
    timers(t, ['setTimeout', 'setInterval']);
    const { main, network, listening, setOnline, changes } = setUp({ check: true });
    network.windowOpened();
    await listening();
    setOnline(false);
    mock.timers.tick(NETWORK.ONLINE_MS);
    assert.equal(changes.at(-1).connection.health.tone, 'danger');
    assert.equal(changes.at(-1).connection.health.text, 'Offline');
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    network.checkAgain();
    assert.deepEqual(askedOf(main.processes[0]), []);

    setOnline(true);
    mock.timers.tick(NETWORK.ONLINE_MS);
    assert.notEqual(changes.at(-1).connection.health.tone, 'danger');
});

test('18.15: the bottom bar starts nothing: with no adapter and the check off, only the OS\'s word on being online is read for it, and only while a window has it', async (t) => {
    timers(t, ['setTimeout', 'setInterval']);
    const { main, network, setOnline, changes } = setUp({ bar: true });
    // On, even as its switch is given again, a launch only to share has no bar to draw.
    network.setBar(true);
    setOnline(false);
    mock.timers.tick(NETWORK.ONLINE_MS * 3);
    assert.equal(changes.length, 0, 'a launch only to share has no bar to draw');

    network.windowOpened();
    mock.timers.tick(NETWORK.ONLINE_MS);
    assert.equal(changes.at(-1).connection.health.short, 'Offline');
    setOnline(true);
    mock.timers.tick(NETWORK.ONLINE_MS);
    assert.equal(changes.at(-1).connection.health.short, 'Connected');
    assert.equal(main.processes.length, 0, 'no service, and so nothing sent');

    // Off: read no more.
    network.setBar(false);
    const told = changes.length;
    setOnline(false);
    mock.timers.tick(NETWORK.ONLINE_MS * 3);
    assert.equal(changes.length, told);
    // On again, from the switch.
    network.setBar(true);
    mock.timers.tick(NETWORK.ONLINE_MS);
    assert.equal(changes.at(-1).connection.health.short, 'Offline');
    assert.equal(main.processes.length, 0);
    network.close();
});

test('the switch turned on asks at once, the service started for it; off, what was known goes, and with nothing else needing it the service stops', async (t) => {
    timers(t);
    const { main, network, listening, tell } = setUp();
    network.windowOpened();
    network.setCheck(true);
    assert.equal(main.processes.length, 1, 'started for it');
    await listening();
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    const [child] = main.processes;
    assert.equal(askedOf(child).length, 1);
    await tell({ type: NETWORK_SERVICE.IP_RESULT, id: 1, v4: '203.0.113.42', v6: null, latency: 18 });

    // Off and on with the service still up: on asks at once, it being the person's asking.
    network.setCheck(false);
    assert.equal(network.state().connection.result, null);
    network.setCheck(true);
    assert.equal(askedOf(child).length, 2);

    network.setCheck(false);
    mock.timers.tick(NETWORK.IDLE_MS);
    assert.deepEqual(child.messages.at(-1), { type: NETWORK_SERVICE.STOP });
});

test('on, the service stays with nothing else asking for it, and is started again if it exits: the same network asks nothing more, a request it took with it does', async (t) => {
    timers(t);
    const { main, network, listening, tell } = setUp({ check: true });
    network.windowOpened();
    await listening();
    mock.timers.tick(NETWORK.IDLE_MS * 10);
    const [first] = main.processes;
    assert.deepEqual(first.messages.filter(({ type }) => type === NETWORK_SERVICE.STOP), []);
    await tell({ type: NETWORK_SERVICE.IP_RESULT, id: 1, v4: '203.0.113.42', v6: null, latency: 18 });
    const { result } = network.state().connection;
    assert.equal(result.ok, true);

    first.emit('exit', 1);
    mock.timers.tick(NETWORK.RESTART_MS);
    assert.equal(main.processes.length, 2);
    await listening();
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    assert.deepEqual(askedOf(main.processes[1]), [], 'the same network');
    assert.deepEqual(network.state().connection.result, result, 'still known');

    network.checkAgain();
    assert.equal(askedOf(main.processes[1]).length, 1);
    main.processes[1].emit('exit', 1);
    mock.timers.tick(NETWORK.RESTART_MS);
    await listening();
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    assert.equal(askedOf(main.processes[2]).length, 1, 'the request it took with it');
});

test('what it finds is never written or logged: main holds it, and only the window hears it', async (t) => {
    timers(t);
    const { network, listening, tell, set, logged } = setUp({ check: true });
    network.windowOpened();
    await listening();
    mock.timers.tick(NETWORK.IP_SETTLE_MS);
    const NL = { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 };
    const GB = { code: 'GB', country: 'United Kingdom', isp: 'Example Broadband Ltd', asn: 64511 };
    await tell({ type: NETWORK_SERVICE.IP_RESULT, id: 1, v4: '203.0.113.42', v6: '2001:db8:5:12::42', latency: 18, location: { month: '2026-11', v4: NL, v6: GB } });
    const { result, warning } = network.state().connection;
    assert.equal(result.v4, '203.0.113.42');
    assert.deepEqual(result.places, { v4: NL, v6: GB });
    assert.match(warning, /\(NL and GB\)/);
    assert.deepEqual(set, [], 'the settings');
    assert.deepEqual(logged, [], 'the log');
});

test('18.14, 18.16: the service is told where the location data is, as its two arguments: the app\'s resources (once packaged; beside src/ from source), then the refresh\'s, in the profile', async (t) => {
    timers(t);
    const profile = path.join(os.tmpdir(), 'stand-in-profile');
    const fromSource = setUp({ check: true, userData: profile });
    fromSource.network.windowOpened();
    const [unpackaged] = fromSource.main.processes;
    assert.equal(unpackaged.args.length, 2);
    assert.equal(path.relative(CLIENT, unpackaged.args[0]), 'location-data');
    assert.equal(unpackaged.args[1], path.join(profile, 'Location Data'));

    const resources = path.join(CLIENT, 'stand-in-resources');
    process.resourcesPath = resources;
    t.after(() => { delete process.resourcesPath; });
    const packaged = setUp({ check: true, isPackaged: true, userData: profile });
    packaged.network.windowOpened();
    assert.deepEqual(packaged.main.processes[0].args, [path.join(resources, 'location-data'), path.join(profile, 'Location Data')]);
});

// --- The location data's month and its monthly refresh (`09` 18.16) ---

const PLACES = { '203.0.113.42': { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 } };
const THIS_MONTH = monthFromNow(0);
const LAST_MONTH = monthFromNow(-1);

/** The app's resources and its profile, as folders of the test's own: the app's own data of one month, and the refresh's of another, if any. */
function locationFolders(t, { own = null, refreshed = null } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-host-location-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const resources = path.join(root, 'resources');
    const userData = path.join(root, 'profile');
    process.resourcesPath = resources;
    t.after(() => { delete process.resourcesPath; });
    if (own) writeLocationData(path.join(resources, 'location-data'), PLACES, { month: own });
    if (refreshed) writeLocationData(path.join(userData, 'Location Data'), PLACES, { month: refreshed });
    return { userData, refreshedData: path.join(userData, 'Location Data') };
}

/** Wait, letting files be read, until this holds, 5 s at most: the mocked clock isn't moved. */
async function until(holds, what) {
    const end = Date.now() + 5_000;
    while (!holds() && Date.now() < end) await new Promise((resolve) => setImmediate(resolve));
    assert.ok(holds(), what);
}

/** What the service was asked of the location data. */
const refreshesOf = (main) => main.processes.flatMap((child) => child.messages).filter(({ type }) => type === NETWORK_SERVICE.REFRESH_LOCATION);

test('18.16: off (the default), nothing is asked for it, whatever the month held; the month is read as the window opens, with nothing started; a refresh\'s files left from before are deleted', async (t) => {
    timers(t);
    const { userData, refreshedData } = locationFolders(t, { own: LAST_MONTH, refreshed: THIS_MONTH });
    const { main, network, changes } = setUp({ isPackaged: true, userData });
    assert.equal(network.state().location, null, 'not read before a window');
    network.windowOpened();
    await until(() => network.state().location !== null, 'the month read');
    assert.deepEqual(network.state().location, { month: LAST_MONTH, own: LAST_MONTH }, "the app's own: the refresh is off");
    await until(() => changes.at(-1)?.location !== null && changes.at(-1)?.location !== undefined, 'the window told');
    assert.deepEqual(changes.at(-1).location, { month: LAST_MONTH, own: LAST_MONTH });
    assert.equal(fs.existsSync(refreshedData), false, "the refresh's files, deleted");
    mock.timers.tick(NETWORK.IDLE_MS * 10);
    assert.deepEqual(main.processes, [], 'nothing started for it');
    assert.deepEqual(refreshesOf(main), []);
});

test('18.16: with no data at all (from source, nothing fetched), the month is none', async (t) => {
    timers(t);
    const { userData } = locationFolders(t);
    const { network } = setUp({ isPackaged: true, userData });
    network.windowOpened();
    await until(() => network.state().location !== null, 'read');
    assert.deepEqual(network.state().location, { month: null, own: null });
});

test('18.16: on, with the data from an earlier month, the service is asked once for this month as the first window opens, once it listens; kept, it\'s used at once, and nothing more is asked that month', async (t) => {
    timers(t);
    const { userData, refreshedData } = locationFolders(t, { own: LAST_MONTH });
    const { main, network, listening, tell, changes, logged } = setUp({ isPackaged: true, userData, refresh: true });
    await settled();
    assert.deepEqual(main.processes, [], 'a share asks nothing');
    network.windowOpened();
    await until(() => main.processes.length === 1, 'the service started for it');
    assert.deepEqual(refreshesOf(main), [], 'not before it listens');
    await listening();
    assert.deepEqual(refreshesOf(main), [{ type: NETWORK_SERVICE.REFRESH_LOCATION, month: THIS_MONTH }]);
    mock.timers.tick(NETWORK.IDLE_MS * 2);
    assert.ok(!main.processes[0].messages.some(({ type }) => type === NETWORK_SERVICE.STOP), 'kept running while it downloads');

    // The service kept this month's: main reads it, and it's the one used.
    writeLocationData(refreshedData, PLACES, { month: THIS_MONTH });
    await tell({ type: NETWORK_SERVICE.LOCATION_REFRESHED, month: THIS_MONTH });
    await until(() => network.state().location?.month === THIS_MONTH, 'used at once');
    assert.deepEqual(network.state().location, { month: THIS_MONTH, own: LAST_MONTH });
    await until(() => changes.at(-1)?.location?.month === THIS_MONTH, 'the window told');
    assert.ok(logged.includes('The location data was refreshed.'));
    mock.timers.tick(NETWORK.IDLE_MS);
    assert.deepEqual(main.processes[0].messages.at(-1), { type: NETWORK_SERVICE.STOP }, 'with nothing else needing it, it stops');

    // Not again that month: off and on, or another launch.
    network.setRefresh(false);
    await until(() => !fs.existsSync(refreshedData), "off, the refresh's files go");
    await until(() => network.state().location?.month === LAST_MONTH, "off, the app's own are used");
    network.setRefresh(true);
    await settled();
    assert.equal(refreshesOf(main).length, 1, 'asked once this run');
    writeLocationData(refreshedData, PLACES, { month: THIS_MONTH });
    const again = setUp({ isPackaged: true, userData, refresh: true });
    again.network.windowOpened();
    await until(() => again.network.state().location !== null, 'read');
    assert.deepEqual(again.network.state().location, { month: THIS_MONTH, own: LAST_MONTH });
    await settled();
    assert.deepEqual(again.main.processes, [], "nothing asked: the data is this month's");
});

test('18.16: a failure, the files refused, or the service exiting with it, is tried again at the next launch, never sooner: not by the switch, not by another window', async (t) => {
    timers(t);
    const { userData } = locationFolders(t, { own: LAST_MONTH });
    for (const ending of [{ error: 'unreachable' }, { error: 'refused' }, 'exit']) {
        const { main, network, listening, tell, logged } = setUp({ isPackaged: true, userData, refresh: true });
        network.windowOpened();
        await until(() => main.processes.length === 1, 'started');
        await listening();
        assert.equal(refreshesOf(main).length, 1);
        if (ending === 'exit') {
            main.processes[0].emit('exit', 1);
            mock.timers.tick(NETWORK.RESTART_MS);
            assert.equal(main.processes.length, 1, 'not started again for it');
        } else {
            await tell({ type: NETWORK_SERVICE.LOCATION_REFRESHED, ...ending });
            assert.match(logged.at(-1), ending.error === 'refused' ? /the files weren't DB-IP's\). It's tried again at the next launch\.$/ : /DB-IP couldn't be reached\). It's tried again at the next launch\.$/);
        }
        await until(() => network.state().location?.month === LAST_MONTH, 'the old data kept');
        network.setRefresh(false);
        network.setRefresh(true);
        network.windowOpened();
        await settled();
        assert.equal(refreshesOf(main).length, 1, `${JSON.stringify(ending)}: once this run`);
    }
    const next = setUp({ isPackaged: true, userData, refresh: true });
    next.network.windowOpened();
    await until(() => next.main.processes.length === 1, 'the next launch tries again');
});

test('18.16: turned on, it\'s the person asking: refreshed then if it\'s due; not if the data held is this month\'s', async (t) => {
    timers(t);
    const { userData } = locationFolders(t, { own: LAST_MONTH });
    const { main, network, listening } = setUp({ isPackaged: true, userData });
    network.windowOpened();
    await until(() => network.state().location !== null, 'read');
    assert.deepEqual(main.processes, []);
    network.setRefresh(true);
    assert.equal(main.processes.length, 1, 'started for it');
    await listening();
    assert.deepEqual(refreshesOf(main), [{ type: NETWORK_SERVICE.REFRESH_LOCATION, month: THIS_MONTH }]);

    const current = locationFolders(t, { own: THIS_MONTH });
    const fresh = setUp({ isPackaged: true, userData: current.userData });
    fresh.network.windowOpened();
    await until(() => fresh.network.state().location !== null, 'read');
    fresh.network.setRefresh(true);
    await settled();
    assert.deepEqual(fresh.main.processes, [], 'nothing due');
});

test('18.16: with an adapter chosen, it\'s asked once the adapter\'s there, never while it isn\'t', async (t) => {
    timers(t);
    const { userData } = locationFolders(t, { own: LAST_MONTH });
    const { main, network, listening, there, gone } = setUp({ isPackaged: true, userData, refresh: true, name: ADAPTER });
    network.windowOpened();
    await until(() => network.state().location !== null, 'read');
    await listening();
    await gone();
    await settled();
    assert.deepEqual(refreshesOf(main), [], 'gone: nothing asked');
    await there();
    await until(() => refreshesOf(main).length === 1, "asked once it's there");
    await gone();
    await there();
    await settled();
    assert.equal(refreshesOf(main).length, 1);
});

test('18.16: the newest month wins: the refresh\'s while it\'s newer than the app\'s own; a newer release\'s own replaces it, which is deleted; one cut off between its files isn\'t whole', async (t) => {
    timers(t);
    const newer = locationFolders(t, { own: LAST_MONTH, refreshed: THIS_MONTH });
    const kept = setUp({ isPackaged: true, userData: newer.userData, refresh: true });
    kept.network.windowOpened();
    await until(() => kept.network.state().location !== null, 'read');
    assert.deepEqual(kept.network.state().location, { month: THIS_MONTH, own: LAST_MONTH });
    assert.ok(fs.existsSync(newer.refreshedData));
    await settled();
    assert.deepEqual(kept.main.processes, [], 'nothing due');

    const release = locationFolders(t, { own: THIS_MONTH, refreshed: LAST_MONTH });
    const replaced = setUp({ isPackaged: true, userData: release.userData, refresh: true });
    replaced.network.windowOpened();
    await until(() => replaced.network.state().location !== null, 'read');
    assert.deepEqual(replaced.network.state().location, { month: THIS_MONTH, own: THIS_MONTH });
    assert.equal(fs.existsSync(release.refreshedData), false, 'the older, deleted');
    assert.deepEqual(replaced.main.processes, [], 'nothing due');

    // A refresh cut off between its two files isn't whole: the app's own are used, and it's due again.
    const cut = locationFolders(t, { own: LAST_MONTH, refreshed: THIS_MONTH });
    const older = locationFolders(t, { refreshed: LAST_MONTH });
    fs.copyFileSync(path.join(older.refreshedData, 'dbip-asn-lite.mmdb'), path.join(cut.refreshedData, 'dbip-asn-lite.mmdb'));
    process.resourcesPath = path.join(path.dirname(cut.userData), 'resources');
    const partial = setUp({ isPackaged: true, userData: cut.userData, refresh: true });
    partial.network.windowOpened();
    await until(() => partial.network.state().location !== null, 'read');
    assert.deepEqual(partial.network.state().location, { month: LAST_MONTH, own: LAST_MONTH });
    await until(() => partial.main.processes.length === 1, 'due again');
});

test('network:set-interface and network:watch take only what they should, and the setting only a name or null', () => {
    assert.equal(interfaceOf({ name: 'Ethernet 3' }), 'Ethernet 3');
    assert.equal(interfaceOf({ name: null }), null);
    for (const bad of [undefined, null, {}, { name: '' }, { name: 7 }, { name: ['x'] }, { name: 'x'.repeat(MAX_INTERFACE_NAME + 1) }, { name: 'x', more: 1 }]) {
        assert.throws(() => interfaceOf(bad), /network adapter's name/, JSON.stringify(bad));
    }
    assert.equal(watchingOf({ on: true }), true);
    for (const bad of [undefined, {}, { on: 1 }, { on: true, more: 1 }]) assert.throws(() => watchingOf(bad), /Settings > Network/);

    const { networkInterface } = SETTINGS_CHECKS;
    for (const good of [null, 'Ethernet 3']) assert.equal(networkInterface(good), true);
    for (const bad of ['', 7, {}, 'x'.repeat(MAX_INTERFACE_NAME + 1)]) assert.equal(networkInterface(bad), false);
});

test('INTERFACE_UNAVAILABLE moves nothing: it\'s no fallback code, and a share says it, not that it couldn\'t connect', () => {
    assert.ok(!FALLBACK_CODES.includes(INTERFACE_UNAVAILABLE));
    const upload = { options: { allowFallback: true } };
    assert.equal(movesOn(upload, { status: 'error', code: INTERFACE_UNAVAILABLE, begun: false }), false);
    assert.equal(movesOn(upload, { status: 'error', code: 'SERVER_UNREACHABLE', begun: false }), true, 'a code that does, so this says something');
    assert.deepEqual(shareUpload({ lifetime: { value: 1, unit: 'hours' }, maxDownloads: 1 }, { ok: false, code: INTERFACE_UNAVAILABLE, message: `${ADAPTER} isn't connected.` }), { ok: false, message: `${ADAPTER} isn't connected.` });
    assert.deepEqual(shareUpload({ lifetime: { value: 1, unit: 'hours' }, maxDownloads: 1 }, { ok: false, code: 'SERVER_UNREACHABLE', message: 'x' }), { ok: false, message: 'Could not connect to the server.' });
});
