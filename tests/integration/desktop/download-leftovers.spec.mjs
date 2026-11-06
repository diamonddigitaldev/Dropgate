// What a download that doesn't finish leaves: nothing. Cancelled while it
// runs, a file's partial is deleted and nothing reaches its folder; a
// bundle's files already whole are deleted with the one being written, and
// no folder is made for them; a ZIP part-written goes too. And when the app
// is killed mid-download (a crash), its partial file is left in the partial
// folder in the profile, under a random name, until the next start empties
// that folder before anything runs.
//
// The uploads are made by the test with the client's own copy of core
// (helpers/hosted.mjs), end-to-end encrypted, to a server whose uploads are in
// 64 KiB chunks (a download decrypts and writes a chunk at a time), and each
// download stalls part-way while the test looks at it: a bundle's first file
// whole and its second begun.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { madeUpFile } from '../helpers/files.mjs';
import { addLink, cardButton, downloadCard, downloadStatus, expect, test } from '../helpers/desktop.mjs';
import { uploadWithCore } from '../helpers/hosted.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The partial folder in the app's profile: where a download is written until it's whole. */
const partialsOf = (desktop) => path.join(desktop.profile, 'Partial Downloads');
const listing = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const advancedOptions = (window) => window.getByRole('dialog', { name: 'Advanced Options' });

/**
 * From now on, the transfer window's downloads stall part-way: each
 * response's body passes on its first `bytes` and then nothing more, as a
 * connection gone quiet would, until the download is cancelled or the app
 * ends. (The page's fetch is wrapped; core calls it as it goes.) Chromium's
 * own throttling can't do this: it holds a whole body back.
 */
function stallAfter(downloader, bytes) {
    return downloader.evaluate((limit) => {
        const real = window.fetch;
        window.fetch = async (input, init) => {
            const response = await real(input, init);
            if (!String(input).endsWith('/content') || !response.body) return response;
            const reader = response.body.getReader();
            let passed = 0;
            const body = new ReadableStream({
                async pull(controller) {
                    // The rest never comes.
                    if (passed >= limit) return new Promise(() => {});
                    const { done, value } = await reader.read();
                    if (done) {
                        controller.close();
                        return undefined;
                    }
                    const piece = value.subarray(0, limit - passed);
                    passed += piece.byteLength;
                    controller.enqueue(piece);
                    return undefined;
                },
                cancel: (reason) => reader.cancel(reason),
            });
            return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        };
    }, bytes);
}

/**
 * The size of each file in a folder, through a handle of its own: on Windows,
 * a folder's listing gives a file another process is writing the size it had
 * when it was opened.
 */
const sizesIn = (dir) => listing(dir).map((name) => {
    let fd;
    try {
        fd = fs.openSync(path.join(dir, name), 'r');
        return fs.fstatSync(fd).size;
    } catch {
        // Gone since it was listed.
        return 0;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
});

// Small chunks, so a few hundred kilobytes in, a download has written some of its files.
test.use({ serverEnv: { UPLOAD_CHUNK_SIZE_BYTES: '65536' } });

test('cancelled while it runs, a download leaves nothing: one file, a bundle with a file already whole, and a ZIP part-written', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();

    for (const shape of ['one file', 'files', 'zip']) {
        const files = shape === 'one file'
            ? [madeUpFile(`Cancelled ${shape} é.bin`, 4_000_000, 101)]
            : [madeUpFile(`First of the ${shape} é.bin`, 50_000, 102), madeUpFile(`Second of the ${shape} é.bin`, 4_000_000, 103)];
        desktop.secrets.addFiles(files);
        const { link } = await uploadWithCore(server, files);
        desktop.secrets.addLink(link);
        await addLink(window, link);
        await expect(downloadStatus(window), shape).toHaveText('Ready');
        const card = downloadCard(window);
        if (shape === 'zip') {
            await card.getByRole('button', { name: 'Advanced Options' }).click();
            await advancedOptions(window).getByRole('switch', { name: 'Save as one ZIP' }).check();
            await advancedOptions(window).getByRole('button', { name: 'Apply' }).click();
            await expect(card.locator('.kit-card-settings')).toHaveText('As One ZIP');
        }

        // Part-way: written so far in the partial folder alone, under random names (a bundle's first file
        // whole, its second begun; a ZIP, its first member and part of the second).
        await stallAfter(await app.transferWindow(), 200_000);
        await cardButton(card, 'Download').click();
        const begun = shape === 'files' ? (sizes) => sizes.length === 2 && sizes.includes(50_000) && sizes.some((size) => size > 0 && size !== 50_000)
            : shape === 'zip' ? (sizes) => sizes.length === 1 && sizes[0] > 60_000 : (sizes) => sizes.length === 1 && sizes[0] > 0;
        await expect.poll(() => begun(sizesIn(partialsOf(desktop))), { message: `${shape}: part-way, in the partial folder`, timeout: 20_000 }).toBe(true);
        expect(listing(partialsOf(desktop)).every((name) => UUID.test(name))).toBe(true);
        await expect(downloadStatus(window), `${shape}: still going`).toHaveText(/^Downloading \d+%/);
        expect(listing(desktop.downloads), `${shape}: Downloads, while it runs`).toEqual([]);

        await cardButton(card, 'Cancel').click();
        await expect(downloadStatus(window), shape).toHaveText('Cancelled');
        await expect.poll(() => listing(partialsOf(desktop)), { message: `${shape}: the partial folder, once it's cancelled` }).toEqual([]);
        expect(listing(desktop.downloads), `${shape}: Downloads, once it's cancelled (no file, no folder)`).toEqual([]);
    }
});

test('killed mid-download, the app leaves its partial file in the profile; the next start empties the partial folder before anything runs', async ({ desktop, server }) => {
    const file = madeUpFile('Crashed download é.bin', 4_000_000, 111);
    desktop.secrets.addFiles([file]);
    const { link } = await uploadWithCore(server, [file]);
    desktop.secrets.addLink(link);

    const app = await desktop.launch();
    const window = await app.window();
    await addLink(window, link);
    await expect(downloadStatus(window)).toHaveText('Ready');
    await stallAfter(await app.transferWindow(), 200_000);
    await cardButton(downloadCard(window), 'Download').click();
    await expect.poll(() => sizesIn(partialsOf(desktop)).some((size) => size > 0), { message: 'part-way, in the partial folder', timeout: 20_000 }).toBe(true);

    // The app killed, as a crash would end it, every process of it at once: nothing of it gets to clean up.
    // (Killed alone, Windows' main process leaves its children holding the profile a moment longer, and
    // the next launch hands itself to them as to a running app.)
    const [written] = listing(partialsOf(desktop));
    const { pid } = app.app.process();
    if (process.platform === 'win32') execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
    else app.app.process().kill('SIGKILL');
    await app.exited();
    // What a crash can leave, whether or not the file service got to delete its own as it went: one planted
    // too, so the next start has something to empty either way.
    fs.mkdirSync(partialsOf(desktop), { recursive: true });
    fs.writeFileSync(path.join(partialsOf(desktop), randomUUID()), file.buffer.subarray(0, 10_000));
    expect(listing(partialsOf(desktop)).length, 'leftovers, after the crash').toBeGreaterThanOrEqual(1);
    // Killed whole on Windows, its file service never got to delete the download's partial.
    if (process.platform === 'win32') expect(listing(partialsOf(desktop)), "the download's own partial, after the crash").toContain(written);

    const again = await desktop.launch();
    await again.window();
    expect(listing(partialsOf(desktop)), 'the partial folder, at the next start').toEqual([]);
    expect(listing(desktop.downloads), 'nothing reached Downloads').toEqual([]);
    await again.quit();
});
