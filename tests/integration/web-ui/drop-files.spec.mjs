// Files dropped on the home page are told from folders by what the drop says
// of each, never by reading them. A file of several GB with no type, as an ISO
// has on Windows, is taken like any other, and nothing reads it before Upload;
// a folder is skipped, and the page says so as the desktop app does. (Dropgate
// 3 read every file with no type whole to find out, so a large one failed to
// read and was refused as a folder, and one that read was held in memory.)
//
// The file is sparse, so nothing of its 5 GB is written to disk. Playwright
// drags from disk only in Chromium (dropFromDisk), so the folder is dropped
// there alone; in Firefox and WebKit the file is dropped by script, with the
// browser's own entry for it.
import fs from 'node:fs';
import path from 'node:path';
import { sparseFile } from '../helpers/files.mjs';
import { secretsOf } from '../helpers/privacy.mjs';
import { expect, test } from '../helpers/test.mjs';
import { dropFromDisk } from '../helpers/webui.mjs';

/** 5 GiB: more than a browser will read into memory at once. */
const SIZE = 5 * 1024 ** 3;

/**
 * In the page, before its own scripts: note each file a drop holds (its name,
 * size and type), and every way the page could read a file. A read of a whole
 * file is noted and stopped, so a page that would read 5 GB doesn't fill the
 * browser's memory meanwhile; a slice, the start of reading part of one, is
 * only noted.
 */
function watchFiles() {
    globalThis.__dropped = [];
    globalThis.__fileReads = [];
    window.addEventListener('drop', (e) => {
        for (const f of e.dataTransfer?.files ?? []) globalThis.__dropped.push({ name: f.name, size: f.size, type: f.type });
    }, { capture: true });
    const watch = (proto, names, fileOf, { stop }) => {
        for (const name of names) {
            const original = proto[name];
            if (typeof original !== 'function') continue;
            proto[name] = function (...args) {
                const file = fileOf(this, args);
                if (file instanceof File) {
                    globalThis.__fileReads.push(`${name}(${file.name})`);
                    if (stop) throw new Error(`The test stopped ${name}() of ${file.name}.`);
                }
                return original.apply(this, args);
            };
        }
    };
    watch(FileReader.prototype, ['readAsArrayBuffer', 'readAsBinaryString', 'readAsDataURL', 'readAsText'], (_reader, args) => args[0], { stop: true });
    watch(Blob.prototype, ['arrayBuffer', 'bytes', 'stream', 'text'], (blob) => blob, { stop: true });
    watch(Blob.prototype, ['slice'], (blob) => blob, { stop: false });
}

// No size limit, so the page has nothing to say of the file's size.
test.use({ serverEnv: { UPLOAD_MAX_FILE_SIZE_MB: '0' } });

test('a 5 GB file with no type, dropped with a folder, is taken and read by nothing before Upload; the folder is skipped, saying so', async ({ page, browserName }) => {
    const disc = sparseFile('Disc image é', SIZE);
    try {
        const folder = path.join(disc.dir, 'Photos é');
        fs.mkdirSync(folder);
        fs.writeFileSync(path.join(folder, 'Inside é.txt'), 'x');
        // Nothing is uploaded, so none of them may reach the server.
        secretsOf(page).addFiles([{ name: 'Disc image é' }, { name: 'Photos é' }, { name: 'Inside é.txt' }]);

        await page.addInitScript(watchFiles);
        await page.goto('/');
        await expect(page.locator('#securityText')).not.toHaveText(/checking/i);
        const withFolder = browserName === 'chromium';
        await dropFromDisk(page, page.locator('#dropzone'), withFolder ? [disc.path, folder] : [disc.path]);

        await expect(page.locator('.file-row-name')).toHaveText(['Disc image é']);
        await expect(page.locator('.file-row-size')).toHaveText(['5.0 GB']);
        await expect(page.locator('#startBtn')).toBeEnabled();
        const toasts = page.locator('#toast-host .toast-note');
        if (withFolder) {
            await expect(toasts).toHaveCount(1);
            await expect(toasts).toHaveClass(/\btoast-warning\b/);
            await expect(toasts.locator('.toast-body')).toHaveText("Skipped 1 folder: Folders can't be uploaded.");
        } else {
            await expect(toasts).toHaveCount(0);
        }

        const dropped = await page.evaluate(() => globalThis.__dropped);
        expect(dropped, 'the file as the drop gave it: no type').toContainEqual({ name: 'Disc image é', size: SIZE, type: '' });
        expect(dropped.map((f) => f.name), 'what the drop held').toEqual(withFolder ? ['Disc image é', 'Photos é'] : ['Disc image é']);
        expect(await page.evaluate(() => globalThis.__fileReads), 'files read before Upload').toEqual([]);
    } finally {
        disc.remove();
    }
});
