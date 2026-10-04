// #93: opening files with the desktop app ("Open with", files dropped on its
// icon or its .exe, a second launch while it's open) adds every one of them to
// Upload. v3 opened the app and added nothing. The kit hands them to the page
// as files:opened, gathered for 500 ms; a Share with Dropgate launch's files
// (the file, then --upload) are uploaded in the background instead, so they
// never reach Upload's list.
import { madeUpFile } from '../helpers/files.mjs';
import { expect, test } from '../helpers/desktop.mjs';

/** The names in Upload's list of files. */
const listed = (window) => window.locator('#file-list .file-row-name');

/** Write some made-up files for the app to open, and return their paths. */
function filesFor(desktop, secrets, names) {
    const files = names.map((name, i) => madeUpFile(name, 20_000 + i, 60 + i));
    secrets.addFiles(files);
    return files.map((file) => desktop.addFile(file));
}

test('a first launch with one file adds it to Upload, and a second launch while it\'s open adds one more', async ({ desktop, secrets }) => {
    const [first, second] = filesFor(desktop, secrets, ['Holiday plans.bin', 'Tax return.bin']);
    const app = await desktop.launch(first);
    const window = await app.window();
    await expect(listed(window), 'Upload, after a launch with one file').toHaveText(['Holiday plans.bin']);

    expect(await desktop.launchAgain(second), "the second launch's exit code").toBe(0);
    await expect(listed(window), 'Upload, after a second launch with one more').toHaveText(['Holiday plans.bin', 'Tax return.bin']);
    expect(app.running).toBe(true);
});

test('a first launch with several files adds them all, and so does a second launch with several', async ({ desktop, secrets }) => {
    const paths = filesFor(desktop, secrets, ['a report.bin', 'ünïcode notes.bin', 'scan 3.bin', 'scan 4.bin', 'scan 5.bin']);
    const app = await desktop.launch(...paths.slice(0, 3));
    const window = await app.window();
    await expect(listed(window), 'Upload, after a launch with three files').toHaveText(['a report.bin', 'ünïcode notes.bin', 'scan 3.bin']);
    await expect(window.locator('#file-count')).toHaveText('3 files selected');

    expect(await desktop.launchAgain(...paths.slice(3)), "the second launch's exit code").toBe(0);
    await expect(listed(window), 'Upload, after a second launch with two more').toHaveText(['a report.bin', 'ünïcode notes.bin', 'scan 3.bin', 'scan 4.bin', 'scan 5.bin']);
});

test('opened from Settings, the app shows Upload with the files it was given', async ({ desktop, secrets }) => {
    const [file] = filesFor(desktop, secrets, ['Shown on Upload.bin']);
    const app = await desktop.launch();
    const window = await app.window();
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(window.locator('#upload-view')).toBeHidden();

    expect(await desktop.launchAgain(file)).toBe(0);
    await expect(window.locator('#upload-view'), 'Upload, shown for the file').toBeVisible();
    await expect(listed(window)).toHaveText(['Shown on Upload.bin']);
});

test('a Share with Dropgate launch while the app is open uploads in the background, and adds nothing to Upload', async ({ desktop, secrets }) => {
    const [file] = filesFor(desktop, secrets, ['Shared not opened.bin']);
    const app = await desktop.launch();
    const window = await app.window();

    // With no server set, the background upload stops at once, after the kit's 500 ms would have passed.
    expect(await desktop.launchAgain(file, '--upload')).toBe(0);
    await expect.poll(() => app.eventsOf('upload-finished').map(({ status, error }) => ({ status, error })),
        { message: 'how the background upload finished' }).toEqual([{ status: 'error', error: 'Server URL is not configured.' }]);
    await expect(listed(window), "Upload's list").toHaveCount(0);
    await expect(window.locator('#file-list-section')).toBeHidden();
});
