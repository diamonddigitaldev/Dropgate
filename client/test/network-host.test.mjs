// Main's side of a chosen adapter (src/network-host.js), loaded in plain Node
// with a stand-in for Electron (helpers/main-process.mjs) and its clock mocked:
// when the network service runs, what the transfer session's proxy is, what
// main is told as the adapter goes, and which names are taken. The service
// itself is network-service.test.mjs's; the two together are the desktop
// project's desktop/network.spec.mjs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mock, test } from 'node:test';
import { fakeMain } from './helpers/main-process.mjs';

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

function setUp({ name = null, commandLine = {} } = {}) {
    const main = fakeMain({ settings: { networkInterface: name } });
    main.electron.app.commandLine = { hasSwitch: (which) => commandLine[which] === true };
    const set = [];
    main.kit.settings.set = (changes) => set.push(changes);
    main.kit.log = { warn: () => {} };
    const proxies = [];
    const session = {
        setProxy: async (config) => proxies.push(config),
        closeAllConnections: async () => proxies.push('closed'),
    };
    const unavailable = [];
    const changing = [];
    const changes = [];
    const { createNetworkHost, NOWHERE } = main.load('../src/network-host.js');
    const network = createNetworkHost({
        kit: main.kit,
        session,
        onUnavailable: (reason) => unavailable.push(reason),
        onChanging: () => changing.push(true),
        onChanged: (state) => changes.push(state),
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
    return { main, network, proxies, set, unavailable, changing, changes, tell, listening, there, gone, NOWHERE };
}

const toService = (child) => child.messages.filter(({ type }) => type === NETWORK_SERVICE.SET_INTERFACE).map(({ name }) => name);
const bound = { mode: 'fixed_servers', proxyRules: `socks5://[::1]:${PORT}`, proxyBypassRules: '<-loopback>' };

function timers(t) {
    t.after(() => mock.timers.reset());
    mock.timers.enable({ apis: ['setTimeout'] });
}

test('with no adapter chosen, the service is never started and the session is left as it is', async (t) => {
    timers(t);
    const { main, network, proxies, unavailable } = setUp();
    await settled();
    assert.deepEqual(main.processes, []);
    assert.deepEqual(proxies, []);
    assert.equal(network.refusal(), null);
    assert.deepEqual(network.state(), { name: null, present: null, adapters: null });
    await network.whenSettled();
    assert.deepEqual(unavailable, []);
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
    assert.deepEqual(await network.watch(false), { name: null, present: null, adapters: null });
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
    assert.deepEqual(answer, { name: null, present: null, adapters: LIST });
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
