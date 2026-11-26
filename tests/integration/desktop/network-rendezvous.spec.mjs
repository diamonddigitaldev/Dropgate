// The rendezvous through a chosen adapter. Direct transfers find each other
// through the server's rendezvous, a WebSocket core opens from the transfer
// window. That window's session is the one every request to a server goes
// through, so with an adapter chosen in Settings > Network the WebSocket goes
// through the network service too, bound to it, and the moment the adapter goes
// it's closed with everything else. The transfer page's CSP lets it open
// (ws: and wss:).
//
// The adapter is a stand-in, a loopback address the server doesn't listen as
// (network-stand-in.cjs), so the server's record of where each connection came
// from tells a bound one from any other, and nothing leaves the machine. Its
// going is the service's list no longer holding it. The desktop app's own
// direct transfers, and their refusal while an adapter is chosen, come later:
// this opens the rendezvous with core in the transfer window's page.
import { STAND_IN, STAND_IN_ADDRESS, expect, test } from '../helpers/desktop.mjs';

/** How soon the socket is closed: one read of the adapters, and the service's stop. */
const AT_ONCE_MS = 2_000;

/** The stand-in adapter chosen in Settings > Network, as a person does. */
async function chooseStandIn(window) {
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: 'Network' }).click();
    await window.locator('#network-interface').selectOption({ label: `${STAND_IN} · ${STAND_IN_ADDRESS}` });
    await expect(window.locator('#network-interface-help')).toHaveText(new RegExp(`^Dropgate connects only through ${STAND_IN},`));
}

/** Where a connection came from, as the server saw it: an IPv4 address as itself. */
const sourceOf = ({ source }) => String(source).replace(/^::ffff:/, '');

/** The upgrades to the rendezvous the server has had. */
const rendezvousUpgrades = (server) => server.requests().filter(({ url }) => new URL(url, 'http://server').pathname === '/api/v4/rendezvous');

/**
 * In the transfer window's page, core's own direct send: it opens its room on
 * the server's rendezvous, and resolves once the server has it. Its outcome is
 * kept, with when it came, for the test to read.
 */
const openRoom = (transfer, baseUrl) => transfer.evaluate(async (url) => {
    const { DropgateClient } = await import('./dropgate-core.js');
    const client = new DropgateClient({ server: url });
    const send = await client.direct.send({ files: new File([new Uint8Array(64)], 'room.bin'), code: false });
    const room = { ended: null };
    window.__room = room;
    send.result.then((outcome) => {
        room.ended = { at: performance.now(), status: outcome.status, code: outcome.status === 'failed' ? outcome.error.code : null };
    });
    return { link: send.share().link };
}, baseUrl);

test.use({ serverHeld: true });

test("with an adapter chosen, core's rendezvous from the transfer window reaches the server from the adapter's address, and is closed the moment the adapter goes", async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await chooseStandIn(window);
    // Test is the transfer window's first work.
    await desktop.setUp(window);
    const transfer = await app.transferWindow();

    const before = rendezvousUpgrades(server).length;
    const { link } = await openRoom(transfer, server.baseUrl);
    desktop.secrets.addLink(link);
    const upgrades = rendezvousUpgrades(server).slice(before);
    expect(upgrades.length, 'WebSockets opened to the rendezvous').toBe(1);
    expect(upgrades.map(sourceOf), 'where it came from').toEqual([STAND_IN_ADDRESS]);
    expect(await server.rendezvousHeld(), 'what the rendezvous holds').toMatchObject({ sockets: 1, rooms: 1 });
    expect(app.eventsOf('csp'), "what the page's CSP refused").toEqual([]);

    const went = await transfer.evaluate(() => performance.now());
    const wentAt = Date.now();
    desktop.setAdapters({});
    await expect.poll(() => transfer.evaluate(() => window.__room.ended), { message: 'the send ended', timeout: AT_ONCE_MS + 1_000 })
        .toMatchObject({ status: 'failed' });
    const ended = await transfer.evaluate(() => window.__room.ended);
    expect(ended.at - went, 'how soon it ended, in ms').toBeLessThan(AT_ONCE_MS + 500);
    await expect.poll(() => server.rendezvousHeld(), { message: 'the server let the socket go', timeout: AT_ONCE_MS })
        .toMatchObject({ sockets: 0, rooms: 0 });
    expect(Date.now() - wentAt, 'how soon the server saw it go, in ms').toBeLessThan(AT_ONCE_MS + 1_000);
    expect(rendezvousUpgrades(server).slice(before).map(sourceOf), 'nothing opened again, from anywhere').toEqual([STAND_IN_ADDRESS]);
});
