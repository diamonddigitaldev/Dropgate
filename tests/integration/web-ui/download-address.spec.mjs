// The address a download page's file is saved from. The page streams each file
// to disk through StreamSaver, whose service worker answers the download's
// address inside the browser. A browser can still send that address to the
// server: Firefox's own Resume does, once the page's stream has gone. So the
// address is random and holds no file name, and the name reaches the browser
// only in the download's Content-Disposition header, which saves the file under it.
import { madeUpFile } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { uploadFromHomePage } from '../helpers/webui.mjs';

/** Start a download from `trigger`, and give its name and the address it came from once it's saved. */
async function saved(page, trigger) {
    const started = page.waitForEvent('download');
    await trigger.click();
    const dl = await started;
    expect(await dl.failure(), 'download failure').toBeNull();
    return { name: dl.suggestedFilename(), url: dl.url() };
}

/** Each way a name could be in an address. */
const formsOf = (name) => [name, encodeURIComponent(name), encodeURI(name), name.replace(/ /g, '+')];

test('the addresses a file and a ZIP are saved from hold no file name, and each saves under its own name', async ({ page }) => {
    const files = [madeUpFile('Quarterly report (final).pdf', 50_000, 61), madeUpFile('Notes für Alex.txt', 2_000, 62)];
    const link = await uploadFromHomePage(page, files, { encrypted: true });
    await page.goto(link);
    await page.locator('#toggle-file-list').click();

    const got = [];
    for (const file of files) got.push({ expected: file.name, ...await saved(page, page.getByTitle(`Download ${file.name}`, { exact: true })) });
    got.push({ expected: /^dropgate-bundle-.+\.zip$/, ...await saved(page, page.locator('#download-all-button')) });

    for (const { expected, name, url } of got) {
        if (typeof expected === 'string') expect(name).toBe(expected); else expect(name).toMatch(expected);
        for (const form of [...formsOf(name), ...files.flatMap((f) => formsOf(f.name))]) {
            expect(url, `the address ${name} was saved from`).not.toContain(form);
        }
    }
});

test('the address a single file is saved from holds no file name, and it saves under its own name', async ({ page }) => {
    const file = madeUpFile('Holiday plans é.bin', 40_000, 63);
    const link = await uploadFromHomePage(page, [file], { encrypted: true });
    await page.goto(link);
    const { name, url } = await saved(page, page.locator('#download-button'));
    expect(name).toBe(file.name);
    for (const form of formsOf(file.name)) expect(url, 'the address it was saved from').not.toContain(form);
});
