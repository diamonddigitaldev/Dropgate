// Delete, on a finished upload: it asks first ("Delete This Upload?"), shows
// "Deleting…" with the kit's spinner while the transfer window deletes it
// from its server with the upload's manage token, and then the upload is
// gone, and its card says so. The token stays in the transfer window from
// the upload's end until its card is removed or the app quits: no message to
// or from main ever carries it (the test preload writes down every 32-byte
// run in them), removing the card makes the transfer window forget it, and
// nothing in the profile holds it, after a Delete or after quitting with a
// finished upload. The server knows a token only by its SHA-256, which is how
// one never sent anywhere is looked for.
//
// End-to-end encrypted, through the TLS proxy, so the link carries a key.
import { createHash } from 'node:crypto';
import { madeUpFile } from '../helpers/files.mjs';
import { cardButton, expect, test, transfersIn, uploadCard, uploadCards } from '../helpers/desktop.mjs';
import { heldIn, holdsSecretHashed, secretHashedIn } from '../helpers/profile.mjs';

test.use({ tlsProxy: true });

const sha256 = (token) => createHash('sha256').update(Buffer.from(token, 'base64url')).digest('base64url');

/** Upload a made-up file from its card, and return its card and link once it's done. */
async function uploaded(desktop, window, name, seed) {
    const file = madeUpFile(name, 30_000, seed);
    desktop.secrets.addFiles([file]);
    await window.locator('#file-input').setInputFiles([desktop.addFile(file)]);
    // This one's card, by its name: uploadCard() is whichever is newest.
    await expect(uploadCard(window).locator('.kit-card-name')).toHaveText(name);
    const card = uploadCards(window).filter({ has: window.locator('.kit-card-name', { hasText: name }) });
    await cardButton(card, 'Upload').click();
    await expect(card.locator('.kit-card-status')).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
    const link = await card.getByRole('textbox', { name: 'Link' }).inputValue();
    desktop.secrets.addLink(link);
    return { file, card, link };
}

/** Each upload's manage token, as the server knows it: its SHA-256, from the request that started it. */
const tokenHashes = (server) => server.requests()
    .filter(({ method, url }) => method === 'POST' && url === '/api/v4/uploads')
    .map(({ body }) => JSON.parse(body.toString('utf8')).manageTokenHash);

/** The manage tokens deletes carried, from the server's side. */
const tokensSent = (server) => server.requests()
    .filter(({ method, url }) => method === 'DELETE' && /^\/api\/v4\/objects\//.test(url))
    .map(({ headers }) => headers['dropgate-manage-token']);

/** Every 32-byte run a message to or from main carried (the test preload's ipc-run). */
const runsThroughMain = (app) => app.eventsOf('ipc-run').map(({ run }) => run);

/** How many times main sent the transfer window something on a channel, as the app quit (the test preload's ipc-sizes). */
const sentToTransferWindow = (app, channel) => app.eventsOf('ipc-sizes').at(-1)?.sizes[`main → page ${channel}`]?.count ?? 0;

test('Delete asks first, shows "Deleting…" with its spinner, and the upload is gone; its token never passed through main, and the profile holds none of it', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    const host = new URL(desktop.serverUrl).host;
    const { file, card, link } = await uploaded(desktop, window, 'Deleted later é.bin', 300);
    const id = new URL(link).pathname.slice(1);
    const objectUrl = `${server.baseUrl}/api/v4/objects/${id}`;
    expect((await fetch(objectUrl)).status, 'the upload, on the server').toBe(200);

    // It asks first: Cancel deletes nothing.
    const asks = window.getByRole('alertdialog', { name: 'Delete This Upload?' });
    await cardButton(card, 'Delete').click();
    await expect(asks.locator('.kit-dialog-text')).toHaveText(`${host} removes it at once, and its link stops working.`);
    await asks.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(asks).toBeHidden();
    expect(tokensSent(server), 'deletes asked of the server').toEqual([]);

    // Deleting, it's busy, with the kit's spinner, until the server has answered.
    const transfer = await app.transferWindow();
    let held = null;
    await transfer.route('**/api/v4/objects/*', (route) => {
        if (route.request().method() !== 'DELETE') return route.continue();
        held = route;
        return undefined;
    });
    await cardButton(card, 'Delete').click();
    await asks.getByRole('button', { name: 'Delete', exact: true }).click();
    const busy = card.locator('.kit-card-actions').getByRole('button', { name: 'Deleting…', exact: true });
    await expect(busy).toBeDisabled();
    await expect(busy.locator('.spinner-border[aria-hidden="true"]')).toHaveCount(1);
    await expect.poll(() => held !== null, { message: 'the delete, held' }).toBe(true);
    await held.continue();

    await expect(card.locator('.kit-card-status')).toHaveText('Deleted from the server. Its link no longer works.');
    await expect(card.locator('.kit-card-actions').getByRole('button'), 'nothing left to do but remove it').toHaveCount(0);
    await expect(card.getByRole('textbox', { name: 'Link' }), 'its link, forgotten').toHaveCount(0);
    expect((await transfersIn(window))[0], "main's record").toMatchObject({ state: 'deleted', link: null, canDelete: false });
    expect((await fetch(objectUrl)).status, 'the upload, after the delete').toBe(404);

    // The token went from the transfer window to the server, and nowhere else.
    const [token] = tokensSent(server);
    expect(token, 'the manage token the delete carried').toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHashes(server), 'the token, the upload\'s own').toEqual([sha256(token)]);
    await app.quit();
    expect(runsThroughMain(app).filter((run) => run.includes(token)), 'the token, in a message to or from main').toEqual([]);
    expect(runsThroughMain(app).some((run) => run.includes(new URL(link).hash.slice(1))), 'the link\'s key did reach main, which copies it: the record works').toBe(true);
    const { hash } = new URL(link);
    expect(heldIn(desktop.profile, { texts: [token, link, hash.slice(1), id, file.name], bytes: [Buffer.from(token, 'base64url'), file.buffer] }),
        'what the profile holds of the deleted upload').toEqual([]);
});

test('a Delete the server refuses says why, and the upload stays, with its Delete', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    const { card } = await uploaded(desktop, window, 'Refused delete.bin', 310);
    const transfer = await app.transferWindow();
    await transfer.route('**/api/v4/objects/*', (route) => (route.request().method() === 'DELETE'
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The server is busy.' }) })
        : route.continue()));
    await cardButton(card, 'Delete').click();
    await window.getByRole('alertdialog', { name: 'Delete This Upload?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(window.getByText(/^Couldn't delete Refused delete\.bin: [A-Z]/)).toBeVisible();
    await expect(card.locator('.kit-card-status')).toHaveText('Uploaded · End-to-End Encrypted');
    await expect(cardButton(card, 'Delete'), 'its Delete, back').toBeEnabled();
});

test('removing a finished upload makes the transfer window forget its token; quitting with one finished forgets it too, and nothing on disk or through main ever held it', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    const first = await uploaded(desktop, window, 'Removed when done.bin', 320);
    const second = await uploaded(desktop, window, 'Cleared when done.bin', 321);
    const third = await uploaded(desktop, window, 'Still there at quit.bin', 322);

    // Its ×, then Clear Finished: each a token the transfer window forgets.
    await first.card.getByRole('button', { name: 'Remove Removed when done.bin' }).click();
    await expect(uploadCards(window)).toHaveCount(2);
    await second.card.locator('.kit-card-meta').click();
    await window.locator('#upload-bulk').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(uploadCards(window)).toHaveCount(1);
    await expect(cardButton(third.card, 'Delete'), 'the one left can still be deleted').toBeEnabled();
    await app.quit();
    expect(sentToTransferWindow(app, 'engine:forget'), 'forgotten, as each card went').toBe(2);
    expect(sentToTransferWindow(app, 'engine:quit'), 'the last forgotten as the app quit').toBe(1);
    expect(tokensSent(server), 'no delete was asked for').toEqual([]);

    // None of the three tokens, known to the server only by their hashes, passed through main or is on disk.
    const hashes = tokenHashes(server);
    expect(hashes).toHaveLength(3);
    for (const hash of hashes) {
        expect(runsThroughMain(app).filter((run) => holdsSecretHashed(run, hash)), 'a token, in a message to or from main').toEqual([]);
        expect(secretHashedIn(desktop.profile, hash), 'a token, in the profile').toEqual([]);
    }
    // The scan works: a link's key is found by its own hash.
    const key = new URL(third.link).hash.slice(1);
    expect(holdsSecretHashed(`… ${key} …`, sha256(key))).toBe(true);
    expect(heldIn(desktop.profile, { texts: [first.link, second.link, third.link], bytes: [] }), 'a link, in the profile').toEqual([]);
});
