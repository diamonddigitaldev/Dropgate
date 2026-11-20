// #93: opening files with the desktop app ("Open with", files dropped on its
// icon or its .exe, a second launch while it's open) adds every one of them to
// Upload. v3 opened the app and added nothing. The kit hands them to the page
// as files:opened, gathered for 500 ms: the files of one opening are one
// upload, waiting on Upload as a card of its own. A Share with Dropgate
// launch's files (the file, then --upload) are uploaded in the background
// instead, so they never reach Upload as one opened.
import { madeUpFile } from '../helpers/files.mjs';
import { dropFiles, expect, test, uploadCard } from '../helpers/desktop.mjs';

/** The names of Upload's uploads: a file's own, or how many files. */
const listed = (window) => window.locator('#upload-grid .kit-card .kit-card-name');

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

test('a first launch with several files adds them all, as one upload, and so does a second launch with several', async ({ desktop, secrets }) => {
    const paths = filesFor(desktop, secrets, ['a report.bin', 'ünïcode notes.bin', 'scan 3.bin', 'scan 4.bin', 'scan 5.bin']);
    const app = await desktop.launch(...paths.slice(0, 3));
    const window = await app.window();
    await expect(listed(window), 'Upload, after a launch with three files').toHaveText(['3 files']);
    await expect(uploadCard(window).locator('.kit-card-meta')).toHaveText(/ · a report\.bin and 2 More$/);

    expect(await desktop.launchAgain(...paths.slice(3)), "the second launch's exit code").toBe(0);
    await expect(listed(window), 'Upload, after a second launch with two more').toHaveText(['3 files', '2 files']);
    await expect(uploadCard(window).locator('.kit-card-meta')).toHaveText(/ · scan 4\.bin and 1 More$/);
});

test('a file already in an upload waiting isn\'t added to it again, and the app says so', async ({ desktop, secrets }) => {
    const [first, second] = filesFor(desktop, secrets, ['Already here.bin', 'New one.bin']);
    const app = await desktop.launch(first);
    const window = await app.window();
    await expect(listed(window)).toHaveText(['Already here.bin']);

    await dropFiles(window, uploadCard(window), [first, second]);
    await expect(listed(window), 'Upload, after the same file and a new one, dropped on it').toHaveText(['2 files']);
    await expect(uploadCard(window).locator('.kit-card-meta')).toHaveText(/ · Already here\.bin and 1 More$/);
    await expect(window.getByText('Skipped 1 file already in that upload.'), 'the toast').toBeVisible();
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
    await expect(listed(window), "Upload's uploads").toHaveCount(0);
    await expect(window.locator('#empty-state')).toBeVisible();
});
