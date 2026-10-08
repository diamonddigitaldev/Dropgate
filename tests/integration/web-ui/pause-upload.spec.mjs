// Pausing an upload from the home page: Pause stops it part-way, the page shows
// until when the server keeps it, and Resume carries it on to a link that
// downloads byte for byte. Nothing resumes by itself: still paused at the
// server's deadline, the upload ends. Pause isn't there on a server with
// pausing turned off, and the download pages have none: a browser's own
// download manager does that.
import { madeUpFile, summary } from '../helpers/files.mjs';
import { secretsOf } from '../helpers/privacy.mjs';
import { expect, test } from '../helpers/test.mjs';
import { download, openLink, uploadFromHomePage } from '../helpers/webui.mjs';

// Three 5 MiB chunks.
const SIZE = 12_000_000;
const MINUTE = 60_000;

/** The server's requests as `METHOD /path`, with their headers. */
const requests = (server) => server.requests().map((r) => ({ ...r, route: `${r.method} ${new URL(r.url, server.baseUrl).pathname}` }));

/**
 * Lets the upload's first chunk through, and holds every one after it until
 * `release()`; each chunk the page sends is noted with its Content-Digest.
 */
async function holdChunks(page) {
    const sent = [];
    let holding = true;
    await page.route('**/api/v4/upload/chunks/*', (route) => {
        const index = Number(new URL(route.request().url()).pathname.split('/').pop());
        sent.push({ index, digest: route.request().headers()['content-digest'] });
        if (holding && sent.length > 1) return undefined;
        return route.continue();
    });
    return { sent, release: () => { holding = false; } };
}

/** Choose a file on the home page and start uploading it, as uploadFromHomePage() does, without waiting for the end. */
async function startUpload(page, file, { encrypted }) {
    secretsOf(page).addFiles([file], { storedByServer: !encrypted });
    await page.goto('/');
    await expect(page.locator('#securityText')).toHaveText(encrypted ? /will be end-to-end encrypted/i : /will not be encrypted/i);
    await page.locator('#fileInput').setInputFiles([file]);
    await page.locator('#startBtn').click();
    if (!encrypted) await page.locator('#confirmInsecureUpload').click();
}

/** The local time a deadline `minutes` from now is, and a minute after it, in the page's own format. */
const shownTimes = (page, minutes) => page.evaluate(({ ms, minute }) => [ms, ms + minute].map((after) => new Date(Date.now() + after)
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })), { ms: minutes * MINUTE, minute: MINUTE });

for (const encrypted of [false, true]) {
    test.describe(encrypted ? 'end-to-end encrypted' : 'unencrypted', () => {
        test.use({ serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '30', ...(encrypted ? {} : { UPLOAD_ENABLE_E2EE: 'false' }) } });

        test("an upload paused part-way shows until when the server keeps it, resumes, and its link downloads byte for byte", async ({ page, server }) => {
            const file = madeUpFile(`Paused ${encrypted ? 'sealed' : 'plain'} é.bin`, SIZE, encrypted ? 31 : 32);
            const chunks = await holdChunks(page);
            await startUpload(page, file, { encrypted });

            const pause = page.locator('#pauseStandardUpload');
            const resume = page.locator('#resumeStandardUpload');
            await expect.poll(() => chunks.sent.length, { message: 'the second chunk should be on its way' }).toBe(2);
            await expect(pause).toBeEnabled();
            await expect(resume).toBeHidden();
            const [shortly, aMinuteLater] = await shownTimes(page, 30);
            await pause.click();

            await expect(page.locator('#progressTitle')).toHaveText(/upload paused/i);
            await expect(page.locator('#progressSub')).toHaveText(/^Paused\. The server keeps this upload until .+\.$/);
            const sub = await page.locator('#progressSub').innerText();
            expect([shortly, aMinuteLater].some((time) => sub.includes(`until ${time}.`)), `"${sub}" gives the server's 30 minutes as a local time`).toBe(true);
            await expect(resume).toBeEnabled();
            await expect(pause).toBeHidden();
            await expect(page.locator('#cancelStandardUpload')).toBeVisible();

            // Nothing resumes by itself, and Escape doesn't take the paused upload's card away.
            await page.keyboard.press('Escape');
            await page.waitForTimeout(1_000);
            await expect(page.locator('#progressTitle')).toHaveText(/upload paused/i);
            await expect(resume).toBeVisible();
            expect(chunks.sent, 'chunks sent while paused').toHaveLength(2);

            chunks.release();
            await resume.click();
            await expect(page.locator('#shareCard')).toBeVisible({ timeout: 30_000 });
            await expect(page.locator('#shareTitle')).toHaveText(/upload complete/i);
            const link = await page.locator('#shareLink').inputValue();
            secretsOf(page).addLink(link);

            // One pause and one resume; the stopped chunk went again exactly as it was, and each chunk reached the server once.
            const all = requests(server);
            expect(all.filter((r) => r.route === 'POST /api/v4/upload/pause')).toHaveLength(1);
            expect(all.filter((r) => r.route === 'POST /api/v4/upload/resume')).toHaveLength(1);
            expect(chunks.sent.map(({ index }) => index), 'chunks the page sent').toEqual([0, 1, 1, 2]);
            expect(chunks.sent[2].digest, 'the stopped chunk, sent again').toBe(chunks.sent[1].digest);
            expect(all.filter((r) => r.route.startsWith('PUT /api/v4/upload/chunks/')).map((r) => r.route.split('/').pop()), 'chunks the server got')
                .toEqual(['0', '1', '2']);

            await page.unrouteAll({ behavior: 'ignoreErrors' });
            await openLink(page, link);
            await expect(page.locator('#file-name')).toHaveText(file.name);
            const got = await download(page, page.locator('#download-button'));
            await expect(page.locator('#status-title')).toHaveText(/download complete/i);
            expect(got.name).toBe(file.name);
            expect(summary(got.bytes)).toEqual(summary(file.buffer));
        });
    });
}

test.describe('with pausing turned off on the server', () => {
    test.use({ serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '0' } });

    test('an upload has no Pause', async ({ page, server }) => {
        const file = madeUpFile('Not paused é.bin', SIZE, 33);
        const chunks = await holdChunks(page);
        await startUpload(page, file, { encrypted: true });

        // The server has taken the upload, which could otherwise pause by now.
        await expect.poll(() => chunks.sent.length, { message: 'the second chunk should be on its way' }).toBe(2);
        await expect(page.locator('#cancelStandardUpload')).toBeVisible();
        await expect(page.locator('#pauseStandardUpload')).toBeHidden();
        await expect(page.getByRole('button', { name: /pause|resume/i })).toHaveCount(0);

        await page.locator('#cancelStandardUpload').click();
        await expect(page.locator('#statusAlert')).toHaveText(/upload cancelled/i);
        expect(requests(server).filter((r) => r.route.startsWith('POST /api/v4/upload/pause'))).toEqual([]);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    });
});

test.describe("at the server's deadline", () => {
    test.use({ serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '1' }, serverClock: true });

    test('a paused upload ends, saying the server dropped it, and nothing resumes it', async ({ page, server }) => {
        // The page's clock is moved forward rather than waited on, and the server's with it.
        await page.clock.install();
        const file = madeUpFile('Paused too long é.bin', SIZE, 34);
        const chunks = await holdChunks(page);
        await startUpload(page, file, { encrypted: true });

        await expect.poll(() => chunks.sent.length, { message: 'the second chunk should be on its way' }).toBe(2);
        await page.locator('#pauseStandardUpload').click();
        await expect(page.locator('#progressTitle')).toHaveText(/upload paused/i);

        await page.clock.fastForward(MINUTE + 5_000);
        await server.advanceClock(MINUTE + 5_000);
        await expect(page.locator('#progressTitle')).toHaveText(/upload failed/i);
        await expect(page.locator('#progressSub')).toHaveText(/the server dropped this paused upload/i);
        await expect(page.getByRole('button', { name: /pause|resume|cancel/i })).toHaveCount(0);
        expect(chunks.sent, 'chunks sent after the pause').toHaveLength(2);
        expect(requests(server).filter((r) => r.route === 'POST /api/v4/upload/resume')).toEqual([]);

        // The server no longer has it either.
        const uploadId = requests(server).find((r) => r.route.startsWith('PUT /api/v4/upload/chunks/')).headers['dropgate-upload'];
        const status = await page.request.get('/api/v4/upload', { headers: { 'Dropgate-Upload': uploadId } });
        expect(status.status(), 'the upload, asked for on the server').toBe(404);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    });
});

test.describe('the download pages', () => {
    test.use({ serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '30' } });

    /** Holds every content request until `release()`, so a download is part-way. */
    async function holdContent(page) {
        const held = [];
        let holding = true;
        await page.route('**/api/v4/objects/*/content', (route) => {
            if (!holding) return route.continue();
            held.push(route);
            return undefined;
        });
        return {
            held,
            release: async () => {
                holding = false;
                for (const route of held.splice(0)) await route.continue();
            },
        };
    }

    test("have no Pause, for one file or several, before or during a download", async ({ page }) => {
        const one = madeUpFile('Downloaded whole é.bin', 300_000, 35);
        const several = [madeUpFile('One of two é.bin', 300_000, 36), madeUpFile('Two of two é.bin', 300_000, 37)];
        const oneLink = await uploadFromHomePage(page, [one], { encrypted: true });
        const severalLink = await uploadFromHomePage(page, several, { encrypted: true });
        const noPause = () => expect(page.getByRole('button', { name: /pause|resume/i }), 'Pause or Resume on the page').toHaveCount(0);

        const content = await holdContent(page);
        await openLink(page, oneLink);
        await expect(page.locator('#download-button')).toBeVisible();
        await noPause();
        const gotOne = download(page, page.locator('#download-button'));
        await expect.poll(() => content.held.length, { message: 'the download should be on its way' }).toBe(1);
        await noPause();
        await content.release();
        expect(summary((await gotOne).bytes)).toEqual(summary(one.buffer));
        await expect(page.locator('#status-title')).toHaveText(/download complete/i);
        await noPause();

        await page.unrouteAll({ behavior: 'ignoreErrors' });
        const bundleContent = await holdContent(page);
        await openLink(page, severalLink);
        await expect(page.locator('#download-all-button')).toBeVisible();
        await noPause();
        const zip = download(page, page.locator('#download-all-button'));
        await expect.poll(() => bundleContent.held.length, { message: 'the ZIP should be on its way' }).toBe(1);
        await noPause();
        await bundleContent.release();
        await zip;
        await noPause();
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    });
});
