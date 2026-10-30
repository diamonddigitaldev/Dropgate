// Where a download lands, whatever its name: every awkward name, received
// through a real download, is saved inside its folder under the name core
// makes safe (filenames.sanitize()), with no stream made from a name on
// Windows (a:b is a file named a_b): no stream but the Mark of the Web, which
// every file saved there carries; a deep folder and a long name
// either work or fail with a clear reason, and never leave a partial file
// behind.
//
// The uploads are made by the test with the client's own copy of core
// (helpers/hosted.mjs), under names no file on disk could have. A name with
// a path in it (..\..\x) can't be sent at all: core refuses it, and the file
// service's own test saves it as the made-safe name (client
// test/file-outputs.test.mjs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { madeUpFile, summary } from '../helpers/files.mjs';
import { addLink, cardButton, downloadCard, downloadStatus, expect, pickFolder, test } from '../helpers/desktop.mjs';
import { uploadWithCore } from '../helpers/hosted.mjs';
import { filenames } from '../../../client/src/dropgate-core.js';

const NAMES = ['ünïcode.txt', '日本語のファイル.txt', 'emoji 😀.txt', 'photo‮gnp.exe', 'family‍.txt', 'CON.txt', 'a.', 'a:b'];

/** The partial folder in the app's profile: where a download is written until it's whole. */
const partialsOf = (desktop) => path.join(desktop.profile, 'Partial Downloads');
const listing = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

/** The streams a file has on Windows' NTFS, besides its own data: the Mark of the Web's alone. */
function streamsOf(file) {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Item -LiteralPath $env:TARGET -Stream *).Stream -join "|"'], {
        env: { ...process.env, TARGET: file },
        encoding: 'utf8',
    });
    return out.trim().split('|').filter((stream) => stream && stream !== ':$DATA');
}

test('every awkward name, received through a real download, lands inside the folder under its made-safe name, with no stream but the mark', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    for (const [i, name] of NAMES.entries()) {
        const file = madeUpFile(name, 1_000 + i, 70 + i);
        // A name of a few bytes (a., a:b) turns up by chance in an encrypted chunk's random bytes, so only
        // the longer ones are looked for in what the server got; every one is still checked on disk below.
        if (Buffer.byteLength(name) >= 6) desktop.secrets.addFiles([file]);
        const { link } = await uploadWithCore(server, [file]);
        desktop.secrets.addLink(link);
        await addLink(window, link);
        await expect(downloadStatus(window), name).toHaveText('Ready');
        await cardButton(downloadCard(window), 'Download').click();
        await expect(downloadStatus(window), name).toHaveText('Saved to Downloads', { timeout: 30_000 });
        const saved = path.join(desktop.downloads, filenames.sanitize(name));
        expect(summary(fs.readFileSync(saved)), name).toEqual(summary(file.buffer));
    }
    // On disk, read back with readdir: each made-safe name, inside the folder, and nothing else anywhere.
    expect(listing(desktop.downloads)).toEqual(NAMES.map((name) => filenames.sanitize(name)).sort());
    expect(listing(desktop.downloads)).toContain('_CON.txt');
    expect(listing(desktop.downloads)).toContain('a_b');
    expect(listing(desktop.downloads)).toContain('photo[U+202E]gnp.exe');
    expect(listing(desktop.root).filter((entry) => !['profile', 'Secret Folder', 'Downloads', 'adapters.json'].includes(entry) && !/^(events|netlog)-/.test(entry)), 'beside the folder').toEqual([]);
    expect(listing(partialsOf(desktop)), 'the partial folder, once they\'re saved').toEqual([]);
    if (process.platform === 'win32') {
        for (const entry of listing(desktop.downloads)) expect(streamsOf(path.join(desktop.downloads, entry)), entry).toEqual(['Zone.Identifier']);
    }
});

test('a deep folder and a long name are saved, long-path aware; a folder gone fails with a clear reason and leaves no partial file', async ({ desktop, server }) => {
    let deep = path.join(desktop.root, 'Deep');
    while (deep.length < 300) deep = path.join(deep, 'a folder with a long name for the test');
    fs.mkdirSync(deep, { recursive: true });
    const name = `${'n'.repeat(196)}.bin`;
    const file = madeUpFile(name, 50_000, 80);
    desktop.secrets.addFiles([file]);
    const { link } = await uploadWithCore(server, [file]);
    desktop.secrets.addLink(link);

    const app = await desktop.launch();
    const window = await app.window();
    await pickFolder(app, deep);
    await addLink(window, link);
    await expect(downloadStatus(window)).toHaveText('Ready');
    await downloadCard(window).getByRole('combobox', { name: 'Save to' }).selectOption({ label: 'Choose Folder…' });
    await cardButton(downloadCard(window), 'Download').click();
    await expect(downloadStatus(window)).toHaveText(/^Saved to a folder with a long name for the test$/, { timeout: 30_000 });
    expect(path.join(deep, name).length, 'the saved file\'s path').toBeGreaterThan(400);
    expect(summary(fs.readFileSync(path.join(deep, name)))).toEqual(summary(file.buffer));
    expect(listing(partialsOf(desktop))).toEqual([]);

    // A folder chosen, then gone before Download: the reason, and nothing left of the file.
    const gone = path.join(desktop.root, 'Gone Folder');
    fs.mkdirSync(gone);
    const other = madeUpFile('Never saved.bin', 20_000, 81);
    desktop.secrets.addFiles([other]);
    const second = await uploadWithCore(server, [other]);
    desktop.secrets.addLink(second.link);
    await pickFolder(app, gone);
    await addLink(window, second.link);
    await expect(downloadStatus(window)).toHaveText('Ready');
    await downloadCard(window).getByRole('combobox', { name: 'Save to' }).selectOption({ label: 'Choose Folder…' });
    fs.rmSync(gone, { recursive: true });
    await cardButton(downloadCard(window), 'Download').click();
    await expect(downloadStatus(window)).toHaveText("Failed: The folder to save to isn't there any more.", { timeout: 30_000 });
    expect(listing(partialsOf(desktop)), 'the partial folder').toEqual([]);
    expect(fs.existsSync(gone), 'the folder isn\'t made again').toBe(false);
    await expect(cardButton(downloadCard(window), 'Retry')).toBeVisible();
});
