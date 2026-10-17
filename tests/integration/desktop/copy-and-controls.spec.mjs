// The house's controls and copy, as a run of the app shows them:
// - every button on an upload's card is one size, whatever its state, its
//   variant, and while it's busy;
// - a button that says it's doing something ("Testing…", "Pausing…",
//   "Resuming…", "Deleting…") is disabled, with the kit's spinner;
// - every switch's help line says what the state it's in does, and changes as
//   it's flipped;
// - what the screens show keeps the copy rules the client's own tests check in
//   its source (client/test/copy.test.mjs: one-character ellipses, no "card",
//   a capital after a colon, bullet-separated items in Title Case), file names
//   and the server's address as they are.
import { copySlips } from '../../../client/test/helpers/copy.mjs';
import { madeUpFile } from '../helpers/files.mjs';
import { cardButton, expect, holdChunks, test, uploadCard, uploadCards } from '../helpers/desktop.mjs';

// Three 5 MiB chunks: the first goes through, the rest can be held.
const SIZE = 12_000_000;

test.use({ tlsProxy: true, serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '30' } });

/** Write a made-up file to the test's folder, pick it with Add Files, and return its card, by name. */
async function picked(desktop, window, name, size, seed) {
    const file = madeUpFile(name, size, seed);
    desktop.secrets.addFiles([file]);
    await window.locator('#file-input').setInputFiles([desktop.addFile(file)]);
    await expect(uploadCard(window).locator('.kit-card-name')).toHaveText(name);
    return uploadCards(window).filter({ has: window.locator('.kit-card-name', { hasText: name }) });
}

/** Note, in the window, every button that comes to say it's doing something: its label, whether it's disabled, and whether it has the kit's spinner. */
const watchBusyButtons = (window) => window.evaluate(() => {
    const seen = [];
    globalThis.__busySeen = seen;
    const note = () => {
        for (const button of document.querySelectorAll('button')) {
            const label = button.textContent.trim();
            if (!/ing…$/.test(label) || seen.some((s) => s.button === button && s.label === label)) continue;
            seen.push({ button, label, disabled: button.disabled, spinner: Boolean(button.querySelector('.spinner-border[aria-hidden="true"]')) });
        }
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
});
const busySeen = (window) => window.evaluate(() => globalThis.__busySeen.map(({ label, disabled, spinner }) => ({ label, disabled, spinner })));

/** Each card button's label and size: its padding, text, line height, border and height, as drawn. */
const cardButtonSizes = (window) => window.evaluate(() => [...document.querySelectorAll('#upload-grid .kit-card-actions button')].map((button) => {
    const style = getComputedStyle(button);
    return {
        label: button.textContent.trim(),
        size: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft, style.fontSize, style.lineHeight, style.borderTopWidth, `${button.getBoundingClientRect().height}px`].join(' '),
    };
}));

/** The words the window shows now: each visible element's own text, and its aria-label, title and placeholder. */
const shownWords = (window) => window.evaluate(() => {
    const words = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let element = walker.currentNode; element; element = walker.nextNode()) {
        if (!(element instanceof HTMLElement) || !element.checkVisibility()) continue;
        if (element.classList.contains('material-icons-round')) continue;
        const own = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('').trim();
        if (own) words.push(own);
        for (const attribute of ['aria-label', 'title', 'placeholder']) {
            if (element.getAttribute(attribute)) words.push(element.getAttribute(attribute));
        }
    }
    return words;
});

/** What a screen shows that breaks the copy rules, the names given read as names. */
async function copySlipsShown(window, names, where) {
    return (await shownWords(window)).flatMap((text) => copySlips(text, { names }).map((reason) => `${where}: ${reason} in "${text}"`));
}

test('every card button is one size, busy or not; every button that says it\'s doing something is disabled with the kit\'s spinner; and the screens keep the copy rules', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    await watchBusyButtons(window);
    const host = new URL(desktop.serverUrl).host;
    const names = [host, desktop.serverUrl];
    const slips = [];

    // Test, in Settings > Server: "Testing…".
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: 'Server' }).click();
    await window.locator('#test-connection-btn').click();
    await expect(window.locator('#connection-status')).toHaveText(/connection successful/i);
    await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();

    // An upload done, one cancelled (Retry), one running (Pause, Cancel), one waiting (Upload).
    const done = await picked(desktop, window, 'Finished é.bin', 30_000, 400);
    names.push('Finished é.bin');
    await cardButton(done, 'Upload').click();
    await expect(done.locator('.kit-card-status')).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
    desktop.secrets.addLink(await done.getByRole('textbox', { name: 'Link' }).inputValue());
    const chunks = await holdChunks(await app.transferWindow());
    const cancelled = await picked(desktop, window, 'cancelled lower case.bin', SIZE, 401);
    names.push('cancelled lower case.bin');
    await cardButton(cancelled, 'Upload').click();
    await expect.poll(() => chunks.uploads().length, { message: 'its chunks, held' }).toBe(1);
    await cardButton(cancelled, 'Cancel').click();
    await expect(cancelled.locator('.kit-card-status')).toHaveText('Cancelled');
    const running = await picked(desktop, window, 'Running big.bin', SIZE, 402);
    names.push('Running big.bin');
    await cardButton(running, 'Upload').click();
    await expect(cardButton(running, 'Pause')).toBeEnabled({ timeout: 15_000 });
    const waiting = await picked(desktop, window, 'Waiting.bin', 30_000, 403);
    names.push('Waiting.bin');
    slips.push(...await copySlipsShown(window, names, 'Upload'));

    // Pause, held at the server: "Pausing…", busy, measured with the rest.
    const transfer = await app.transferWindow();
    let pauseHeld = null;
    await transfer.route('**/api/v4/upload/pause', (route) => {
        pauseHeld = route;
    });
    await cardButton(running, 'Pause').click();
    await expect.poll(() => pauseHeld !== null, { message: 'the pause, held' }).toBe(true);
    const whileBusy = await cardButtonSizes(window);
    await pauseHeld.continue();
    await expect(running.locator('.kit-card-status')).toHaveText(/^Paused\. Kept until /);
    const whilePaused = await cardButtonSizes(window);
    slips.push(...await copySlipsShown(window, names, 'Upload, one paused'));

    const all = [...whileBusy, ...whilePaused];
    expect(new Set(all.map(({ label }) => label)), 'the buttons measured').toEqual(new Set(['Copy Link', 'Delete', 'Retry', 'Pausing…', 'Resume', 'Cancel', 'Upload']));
    for (const { label, size } of all) expect(size, `${label}, beside ${all[0].label}`).toBe(all[0].size);

    // Resume: "Resuming…"; then it finishes.
    await cardButton(running, 'Resume').click();
    await expect(running.locator('.kit-card-status')).toHaveText(/^Uploading/);
    chunks.release();
    await expect(running.locator('.kit-card-status')).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
    desktop.secrets.addLink(await running.getByRole('textbox', { name: 'Link' }).inputValue());

    // Advanced Options, and the Delete it asks first, keep the rules too.
    await waiting.getByRole('button', { name: 'Advanced Options' }).click();
    await expect(window.getByRole('dialog', { name: 'Advanced Options' })).toBeVisible();
    slips.push(...await copySlipsShown(window, names, 'Advanced Options'));
    await window.getByRole('dialog', { name: 'Advanced Options' }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await cardButton(done, 'Delete').click();
    const asks = window.getByRole('alertdialog', { name: 'Delete This Upload?' });
    await expect(asks).toBeVisible();
    slips.push(...await copySlipsShown(window, names, 'Delete This Upload?'));
    await asks.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(done.locator('.kit-card-status')).toHaveText('Deleted from the server. Its link no longer works.');
    slips.push(...await copySlipsShown(window, names, 'Upload, one deleted'));

    expect(await busySeen(window), 'each button that said it was doing something').toEqual(['Testing…', 'Pausing…', 'Resuming…', 'Deleting…'].map((label) => ({ label, disabled: true, spinner: true })));
    expect(slips, 'what the screens showed against the copy rules').toEqual([]);
});

test('every switch\'s help line says what its state does, and changes as it\'s flipped; Settings\' tabs keep the copy rules', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    const names = [new URL(desktop.serverUrl).host, desktop.serverUrl];
    const slips = [];
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    for (const tab of ['Server', 'Privacy', 'Update', 'Credits']) {
        await window.getByRole('tab', { name: tab }).click();
        await expect(window.getByRole('tabpanel')).toBeVisible();
        slips.push(...await copySlipsShown(window, names, `Settings > ${tab}`));
    }
    expect(slips, 'what Settings showed against the copy rules').toEqual([]);

    // Privacy's, in the mockup's words, and the kit's own on Update.
    const help = (sw) => sw.evaluate((input) => document.getElementById(input.getAttribute('aria-describedby')).textContent);
    await window.getByRole('tab', { name: 'Privacy' }).click();
    const keep = window.getByRole('switch', { name: 'Keep log on disk for troubleshooting' });
    await expect(keep).not.toBeChecked();
    expect(await help(keep)).toBe("The app's log is kept in memory only, and goes when the app closes.");
    await keep.click();
    expect(await help(keep)).toBe("The app's log is also kept in a file on this computer, with none of your file names, folders or links in it, so you can send it with a bug report. Turning it off deletes the file.");
    await keep.click();
    expect(await help(keep)).toBe("The app's log is kept in memory only, and goes when the app closes.");

    let switches = 0;
    for (const tab of ['Server', 'Privacy', 'Update']) {
        await window.getByRole('tab', { name: tab }).click();
        for (const sw of await window.getByRole('tabpanel').getByRole('switch').all()) {
            switches++;
            const name = await sw.evaluate((input) => input.labels[0]?.textContent);
            const first = await help(sw);
            await sw.click();
            const flipped = await help(sw);
            expect(flipped, `${name}: its help, flipped`).not.toBe(first);
            expect(flipped, `${name}: its help says what happens, with no "On:" or "Off:"`).not.toMatch(/^(On|Off):/);
            await sw.click();
            expect(await help(sw), `${name}: its help, flipped back`).toBe(first);
        }
    }
    expect(switches, 'the switches found').toBe(2);
});
