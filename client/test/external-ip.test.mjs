// The External IP's source and the connection's health (`09` 18.11, 18.13), and
// its binding request on the wire, with nothing leaving the machine. When it's
// asked is network-host.test.mjs's, and the request held to an adapter is
// network-service.test.mjs's.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { bindingResponse, startStunServer } from '../../tests/integration/helpers/stun.mjs';

const require = createRequire(import.meta.url);
const { healthOf, stunSourceOf } = require('../src/core/external-ip.js');
const { addressesOf, hasIpv6 } = require('../src/core/adapters.js');
const { STUN_PORT, askBinding, bindingRequest, firstStunUrl, mappedAddress, stunTargetOf } = require('../src/core/stun.js');

const ID = Buffer.from('0123456789ab');
const SERVER = { name: 'Share Space' };
const answered = (p2p) => ({ ok: true, serverInfo: { capabilities: { p2p } } });

test('18.13: health is green, yellow and red exactly as the design has it', () => {
    const base = { online: true, name: null, present: null, on: false, checking: false, result: null };
    const tone = (now) => healthOf({ ...base, ...now }, 'Windows').tone;
    const OK = { ok: true, v4: '203.0.113.42' };
    const FAILED = { ok: false, reason: 'No answer.' };

    // Red: offline, or the chosen adapter gone. Neither is saved by anything else.
    assert.equal(tone({ online: false }), 'danger');
    assert.equal(tone({ online: false, name: 'wg0', present: true, on: true, result: OK }), 'danger');
    assert.equal(tone({ name: 'wg0', present: false }), 'danger');
    assert.equal(tone({ name: 'wg0', present: false, on: true, result: OK }), 'danger');
    assert.equal(tone({ name: 'wg0', present: false, on: true, checking: true }), 'danger');

    // Yellow: online, but the check (while it's on) failed or hasn't run.
    assert.equal(tone({ on: true }), 'warning');
    assert.equal(tone({ on: true, result: FAILED }), 'warning');
    assert.equal(tone({ name: 'wg0', present: true, on: true }), 'warning');
    assert.equal(tone({ name: 'wg0', present: true, on: true, result: FAILED }), 'warning');

    // Green: online, the adapter there, the check answered; with the check off, green needs no check.
    assert.equal(tone({}), 'success');
    assert.equal(tone({ name: 'wg0', present: true }), 'success');
    assert.equal(tone({ on: true, result: OK }), 'success');
    assert.equal(tone({ name: 'wg0', present: true, on: true, result: OK }), 'success');

    // A last answer, once the check's off, counts for nothing.
    assert.equal(tone({ on: false, result: FAILED }), 'success');

    // Being found out.
    assert.equal(tone({ on: true, checking: true }), 'running');
    assert.equal(tone({ name: 'wg0', present: null }), 'running');
});

test('18.13: each state says what it means, naming the OS and the adapter', () => {
    const base = { online: true, name: null, present: null, on: false, checking: false, result: null };
    assert.deepEqual(healthOf({ ...base, online: false }, 'Linux'), { tone: 'danger', text: 'Offline', title: 'Linux says this computer has no network connection.' });
    assert.deepEqual(healthOf({ ...base, name: 'wg0', present: false }, 'Windows'), {
        tone: 'danger', text: "wg0 isn't connected", title: "Dropgate is set to use only wg0 (Settings > Network), so it connects through nothing until it's back.",
    });
    assert.deepEqual(healthOf(base, 'Linux'), { tone: 'success', text: 'Connected', title: 'Connected, through whichever adapter Linux chooses.' });
    assert.deepEqual(healthOf(base, 'Windows'), { tone: 'success', text: 'Connected', title: 'Connected, through whichever adapter Windows chooses.' });
    assert.deepEqual(healthOf({ ...base, name: 'wg0', present: true }, 'Windows'), { tone: 'success', text: 'Connected through wg0', title: 'Connected. Dropgate uses only wg0.' });
    assert.deepEqual(healthOf({ ...base, on: true }, 'Windows'), { tone: 'warning', text: 'Connected · External IP Not Checked Yet', title: "Your External IP hasn't been checked since the app started." });
    assert.deepEqual(healthOf({ ...base, on: true, result: { ok: false, reason: 'Why.' } }, 'Windows'), { tone: 'warning', text: 'Connected · External IP Unavailable', title: 'Why.' });
    assert.equal(healthOf({ ...base, on: true, checking: true, stun: 'stun.example' }, 'Windows').title, 'Asking stun.example for your address.');
});

test('18.11: the source is the default server\'s first stun: URL, from its last check, or why there\'s none', () => {
    assert.deepEqual(stunSourceOf(SERVER, answered({ enabled: true, iceServers: [{ urls: ['turn:t.example', 'stun:stun.example:3478', 'stun:second.example'] }] })), {
        url: 'stun:stun.example:3478', stun: 'stun.example', server: 'Share Space',
    });

    const none = stunSourceOf(null, null);
    assert.equal(none.url, undefined);
    assert.equal(none.waits, true, 'adding a server brings one');
    assert.match(none.reason, /no saved server/);

    const unchecked = stunSourceOf(SERVER, null);
    assert.equal(unchecked.unchecked, true);
    assert.equal(unchecked.waits, true);

    const failed = stunSourceOf(SERVER, { ok: false, code: 'SERVER_UNREACHABLE' });
    assert.equal(failed.waits, true, 'its next check may answer');
    assert.equal(failed.reason, "Share Space couldn't be reached, so its STUN server isn't known.");

    const off = stunSourceOf(SERVER, answered({ enabled: false }));
    assert.equal(off.waits, false);
    assert.equal(off.reason, "Share Space lists no STUN server (it has direct transfers off), so there's nothing to ask.");

    const noStun = stunSourceOf(SERVER, answered({ enabled: true, iceServers: [] }));
    assert.equal(noStun.reason, "Share Space lists no STUN server, so there's nothing to ask.");
    assert.equal(stunSourceOf(SERVER, answered({ enabled: true, iceServers: [{ urls: 'turn:t.example' }] })).url, undefined, 'a TURN server is no STUN server');
    assert.equal(stunSourceOf(SERVER, { ok: true }).url, undefined, 'a server that says nothing of it');
});

test('a stun: URL is read for a name or an address and a port, and nothing else is one', () => {
    assert.deepEqual(stunTargetOf('stun:stun.cloudflare.com:3478'), { host: 'stun.cloudflare.com', port: 3478 });
    assert.deepEqual(stunTargetOf('stun:stun.example'), { host: 'stun.example', port: STUN_PORT });
    assert.deepEqual(stunTargetOf('STUN:127.0.0.2:5000'), { host: '127.0.0.2', port: 5000 });
    assert.deepEqual(stunTargetOf('stun:[2001:db8::1]:3478'), { host: '2001:db8::1', port: 3478 });
    for (const bad of ['stuns:stun.example', 'turn:stun.example', 'http://stun.example', 'stun:', 'stun:a b', 'stun:example:0', 'stun:example:70000', 'stun:[not-v6]:3478', 'stun:example?transport=udp', 'stun:user@example', 7, null, undefined]) {
        assert.equal(stunTargetOf(bad), null, String(bad));
    }
    assert.equal(firstStunUrl([{ urls: 'stun:one.example' }, { urls: 'stun:two.example' }]), 'stun:one.example');
    assert.equal(firstStunUrl([{ urls: ['turn:t.example', 'nonsense', 'stun:two.example'] }]), 'stun:two.example');
    for (const none of [undefined, null, 'stun:one.example', [], [null], [{}], [{ urls: 7 }]]) assert.equal(firstStunUrl(none), null);
});

test('18.11: a binding request is its header and nothing else: nothing about the person, no software, no name', () => {
    const request = bindingRequest(ID);
    assert.equal(request.length, 20);
    assert.equal(request.readUInt16BE(0), 0x0001);
    assert.equal(request.readUInt16BE(2), 0, 'no attributes');
    assert.equal(request.readUInt32BE(4), 0x2112a442);
    assert.ok(request.subarray(8).equals(ID));
});

test('an answer is read for the address of the family asked, with its ID, and anything else is no answer', () => {
    const request = bindingRequest(ID);
    const v4 = bindingResponse(request, { address: '203.0.113.42', port: 40_000 });
    const v6 = bindingResponse(request, { address: '2001:db8:5:12::42', port: 40_000 });
    assert.equal(mappedAddress(v4, ID, 4), '203.0.113.42');
    assert.equal(mappedAddress(v6, ID, 6), '2001:db8:5:12::42');
    assert.equal(mappedAddress(v4, ID, 6), null, 'the other family');
    assert.equal(mappedAddress(v6, ID, 4), null, 'the other family');
    assert.equal(mappedAddress(v4, Buffer.from('xxxxxxxxxxxx'), 4), null, 'another ID');
    assert.equal(mappedAddress(request, ID, 4), null, 'a request');
    assert.equal(mappedAddress(v4.subarray(0, 24), ID, 4), null, 'cut short');
    assert.equal(mappedAddress(Buffer.alloc(0), ID, 4), null, 'nothing');

    // A server of the older RFC gives MAPPED-ADDRESS, unmasked.
    const old = Buffer.alloc(32);
    request.copy(old);
    old.writeUInt16BE(0x0101, 0);
    old.writeUInt16BE(12, 2);
    old.writeUInt16BE(0x0001, 20);
    old.writeUInt16BE(8, 22);
    old.writeUInt8(1, 25);
    old.writeUInt16BE(40_000, 26);
    Buffer.from([203, 0, 113, 42]).copy(old, 28);
    assert.equal(mappedAddress(old, ID, 4), '203.0.113.42');

    // An attribute that runs past the message.
    const long = Buffer.from(v4);
    long.writeUInt16BE(200, 22);
    assert.equal(mappedAddress(long, ID, 4), null);
});

test('18.11: asked once, it gives the responder\'s answer and a round trip', async () => {
    const stun = await startStunServer({ address: '127.0.0.2', mapped: { v4: '203.0.113.42' } });
    try {
        const { signal } = new AbortController();
        const answer = await askBinding({ address: '127.0.0.2', family: 4, port: stun.port, local: '127.0.0.3', signal });
        assert.equal(answer.ip, '203.0.113.42');
        assert.ok(Number.isInteger(answer.ms) && answer.ms >= 0);
        assert.deepEqual(stun.requests.map(({ source, family }) => ({ source, family })), [{ source: '127.0.0.3', family: 4 }]);
        assert.equal(stun.requests[0].bytes.length, 20);
    } finally {
        await stun.stop();
    }
});

test('18.11: it\'s sent once: a server that doesn\'t answer gets no second request, and the wait ends when it\'s stopped', async () => {
    const stun = await startStunServer({ address: '127.0.0.2', silent: true });
    try {
        const controller = new AbortController();
        const asking = askBinding({ address: '127.0.0.2', family: 4, port: stun.port, signal: controller.signal });
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        controller.abort(Object.assign(new Error('Enough.'), { code: 'ETIMEDOUT' }));
        await assert.rejects(asking, /Enough/);
        assert.equal(stun.requests.length, 1);
    } finally {
        await stun.stop();
    }
    await assert.rejects(askBinding({ address: '127.0.0.2', family: 4, port: 1, signal: AbortSignal.abort(new Error('Before it began.')) }), /Before it began/);
});

test('an adapter\'s IPv6 address is a public one where it has one, else any that reaches past its link; the machine has one only off its loopback', () => {
    const entry = (address, more = {}) => ({ address, family: 'IPv6', internal: false, scopeid: 0, ...more });
    const list = (...entries) => ({ eth0: entries });
    assert.equal(addressesOf(list(entry('fd00::5'), entry('2001:db8::5')), 'eth0').v6, '2001:db8::5', 'a router\'s private one first');
    assert.equal(addressesOf(list(entry('fc00:bbbb::5')), 'eth0').v6, 'fc00:bbbb::5', 'a VPN\'s, behind its NAT');
    assert.equal(addressesOf(list(entry('fe80::5', { scopeid: 3 })), 'eth0').v6, null);

    assert.equal(hasIpv6(list(entry('2001:db8::5'))), true);
    assert.equal(hasIpv6(list(entry('fe80::5', { scopeid: 3 }))), false);
    assert.equal(hasIpv6({ lo: [entry('::1', { internal: true })] }), false);
    assert.equal(hasIpv6({ eth0: [{ address: '192.168.1.2', family: 'IPv4', internal: false }] }), false);
    assert.equal(hasIpv6({}), false);
});
