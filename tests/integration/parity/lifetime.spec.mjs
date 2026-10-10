// Parity: an upload given a short lifetime on the home page is still there
// part-way through it, and gone from the link and the server once it has passed.
//
// The server's clock is moved forward rather than waited on. The server removes
// expired uploads in a sweep that runs every minute, and moving the clock runs
// that sweep too.
import { madeUpFile } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { expectGone, openLink, uploadFromHomePage } from '../helpers/webui.mjs';

test.use({ serverClock: true });

const MINUTE = 60_000;
// The page's default is 24 hours, so this only passes if the setting is used.
const LIFETIME = { value: 5, unit: 'minutes' };

const bundleFiles = (seed) => [
    madeUpFile('agenda.txt', 1_000, seed),
    madeUpFile('slides (final).pdf', 200_000, seed + 1),
];

test.describe('a single file, end-to-end encrypted', () => {
    test('uploaded with a five-minute lifetime, is still there after three minutes and gone after six', async ({ page, server }) => {
        const file = madeUpFile('Short-lived notes é.bin', 100_000, 40);
        const link = await uploadFromHomePage(page, [file], { encrypted: true, lifetime: LIFETIME });

        await server.advanceClock(3 * MINUTE);
        expect((await openLink(page, link))?.status(), 'the download page after three minutes').toBe(200);
        await expect(page.locator('#file-name')).toHaveText(file.name);
        expect(server.storedFiles(), 'files the server holds after three minutes').toHaveLength(1);

        await server.advanceClock(3 * MINUTE);
        await expectGone(page, link);
        expect(server.storedFiles(), 'files the server holds after six minutes').toEqual([]);
    });
});

test.describe('a bundle, end-to-end encrypted', () => {
    test('uploaded with a five-minute lifetime, is still there after three minutes and gone after six', async ({ page, server }) => {
        const files = bundleFiles(41);
        const link = await uploadFromHomePage(page, files, { encrypted: true, lifetime: LIFETIME });

        await server.advanceClock(3 * MINUTE);
        expect((await openLink(page, link))?.status(), 'the bundle page after three minutes').toBe(200);
        await expect(page.locator('#bundle-file-count')).toHaveText(String(files.length));
        expect(server.storedFiles(), 'uploads the server holds after three minutes: the bundle is one').toHaveLength(1);

        await server.advanceClock(3 * MINUTE);
        await expectGone(page, link);
        expect(server.storedFiles(), 'files the server holds after six minutes').toEqual([]);
    });
});

test.describe('a bundle, unencrypted', () => {
    test.use({ serverEnv: { UPLOAD_ENABLE_E2EE: 'false' } });

    test('uploaded with a five-minute lifetime, is still there after three minutes and gone after six', async ({ page, server }) => {
        const files = bundleFiles(43);
        const link = await uploadFromHomePage(page, files, { encrypted: false, lifetime: LIFETIME });

        await server.advanceClock(3 * MINUTE);
        expect((await openLink(page, link))?.status(), 'the bundle page after three minutes').toBe(200);
        await expect(page.locator('#bundle-file-count')).toHaveText(String(files.length));
        expect(server.storedFiles(), 'uploads the server holds after three minutes: the bundle is one').toHaveLength(1);

        await server.advanceClock(3 * MINUTE);
        await expectGone(page, link);
        expect(server.storedFiles(), 'files the server holds after six minutes').toEqual([]);
    });
});
