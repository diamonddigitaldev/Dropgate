// Advanced Options, on an upload waiting (its card's tune) or several (Bulk
// Edit on the bulk bar): its file lifetime and download limit, offering only
// what the server allows (Unlimited greyed out where it isn't allowed; Apply
// off, with the help line saying why, for a value outside), how it will be
// sent (shown, never a control), and an upload of several files' own files,
// each with its Remove. Its settings line names what differs from the
// server's settings for new uploads. An upload whose options get past that,
// from an edited config.json or by the bridge itself, is stopped at its start
// by the kit's warning: "Use the Server's Limits" goes on with them, Cancel
// leaves it waiting. What the server is asked for is checked at the server.
import fs from 'node:fs';
import path from 'node:path';
import { madeUpFile } from '../helpers/files.mjs';
import { cardButton, dropFiles, expect, test, transfersIn, uploadCard, uploadCards, uploadsStarted } from '../helpers/desktop.mjs';

test.use({ tlsProxy: true });

const HOUR = 3_600_000;

/** Write made-up files to the test's folder, and return them with their paths. */
function filesFor(desktop, names, seed) {
    return names.map((name, i) => {
        const file = madeUpFile(name, 30_000, seed + i);
        desktop.secrets.addFiles([file]);
        return { ...file, path: desktop.addFile(file) };
    });
}

/** The server's address as the app names it: its host. */
const hostOf = (desktop) => new URL(desktop.serverUrl).host;

const advancedOptions = (window) => window.getByRole('dialog', { name: 'Advanced Options' });

/** A select's options: value, text and whether it's greyed out. */
const optionsOf = (select) => select.evaluate((element) => [...element.options].map((option) => [option.value, option.textContent, option.disabled]));

/** The upload card named so. */
const named = (window, name) => uploadCards(window).filter({ has: window.locator('.kit-card-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });

test.describe('on a server that keeps files up to 24 hours and allows up to 5 downloads', () => {
    test.use({ serverEnv: { UPLOAD_MAX_FILE_LIFETIME_HOURS: '24', UPLOAD_MAX_FILE_DOWNLOADS: '5' } });

    test('Advanced Options offers only what the server allows, says why Apply is off, shows the encryption as no control, takes out a file, and the upload goes as set', async ({ desktop, server, page }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        const host = hostOf(desktop);
        const files = filesFor(desktop, ['Kept first é.bin', 'Taken out.bin', 'Kept last.bin'], 200);
        await window.locator('#file-input').setInputFiles(files.map((file) => file.path));
        const card = uploadCard(window);
        await expect(card.locator('.kit-card-name')).toHaveText('3 files');
        await expect(card.locator('.kit-card-settings'), 'nothing differs from the server\'s settings for new uploads').toBeHidden();

        await card.getByRole('button', { name: 'Advanced Options' }).click();
        const dialog = advancedOptions(window);
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.kit-dialog-text')).toHaveText('3 files');
        const lifetime = dialog.getByLabel('File lifetime');
        const unit = dialog.getByRole('combobox', { name: 'Unit' });
        const downloads = dialog.getByLabel('Max downloads');
        const apply = dialog.getByRole('button', { name: 'Apply', exact: true });
        expect(await optionsOf(unit), 'the units, Unlimited greyed out').toEqual([
            ['minutes', 'Minutes', false], ['hours', 'Hours', false], ['days', 'Days', false], ['unlimited', 'Unlimited (not allowed by the server)', true],
        ]);
        await expect(lifetime).toHaveValue('24');
        await expect(unit).toHaveValue('hours');
        await expect(downloads).toHaveValue('1');
        await expect(dialog.locator('#options-lifetime-help')).toHaveText(`${host} keeps files up to 24 hours.`);
        await expect(dialog.locator('#options-downloads-help')).toHaveText(`${host} allows up to 5 downloads.`);
        await expect(apply).toBeEnabled();

        // The encryption is shown, and nothing switches it off.
        await expect(dialog.locator('.options-encryption')).toHaveText(`verifiedEnd-to-end encrypted. ${host} can't read your files or their names.`);
        // Its one switch is Allow Fallback (phase 14): none is the encryption's.
        await expect(dialog.getByRole('switch'), 'a switch in Advanced Options').toHaveCount(1);
        await expect(dialog.getByRole('switch'), 'its one switch').toHaveAccessibleName('Allow Fallback');
        await expect(dialog.getByRole('checkbox'), 'a box in Advanced Options').toHaveCount(0);

        // A value outside the server's limits turns Apply off, and its help line says why.
        await lifetime.fill('2');
        await unit.selectOption('days');
        await expect(dialog.locator('#options-lifetime-help')).toHaveText(`Too long for ${host}, which keeps files up to 24 hours.`);
        await expect(dialog.locator('#options-lifetime-help')).toHaveClass(/text-danger-emphasis/);
        await expect(apply).toBeDisabled();
        await unit.selectOption('hours');
        await lifetime.fill('12');
        await expect(apply).toBeEnabled();
        await downloads.fill('6');
        await expect(dialog.locator('#options-downloads-help')).toHaveText(`Too many for ${host}, which allows up to 5 downloads.`);
        await expect(apply).toBeDisabled();
        await downloads.fill('0');
        await expect(dialog.locator('#options-downloads-help')).toHaveText(`${host} doesn't allow unlimited downloads. It allows up to 5 downloads.`);
        await expect(apply).toBeDisabled();
        await lifetime.fill('');
        await expect(dialog.locator('#options-lifetime-help')).toHaveText('Enter a lifetime of more than 0.');
        await lifetime.fill('12');
        await downloads.fill('3');
        await expect(dialog.locator('#options-downloads-help')).toHaveText(`${host} allows up to 5 downloads.`);
        await expect(apply).toBeEnabled();

        // Its files, each with its own Remove: the last one left can't be taken out.
        const list = dialog.getByRole('list', { name: 'Files' });
        await expect(list.getByRole('listitem')).toHaveText([/^insert_drive_fileKept first é\.bin/, /^insert_drive_fileTaken out\.bin/, /^insert_drive_fileKept last\.bin/]);
        await list.getByRole('button', { name: 'Remove Taken out.bin' }).click();
        await expect(list.getByRole('listitem')).toHaveCount(2);
        await apply.click();
        await expect(dialog).toBeHidden();

        // The card says what differs, and main's upload has it.
        await expect(card.locator('.kit-card-name')).toHaveText('2 files');
        await expect(card.locator('.kit-card-settings')).toHaveText('12 Hours · 3 Downloads');
        const [made] = await transfersIn(window);
        expect(made.files.map(({ name }) => name)).toEqual(['Kept first é.bin', 'Kept last.bin']);
        expect([made.options.lifetime, made.options.maxDownloads]).toEqual([{ value: 12, unit: 'hours' }, 3]);

        // Cancel leaves it as it was.
        await card.getByRole('button', { name: 'Advanced Options' }).click();
        await advancedOptions(window).getByLabel('Max downloads').fill('5');
        await advancedOptions(window).getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(advancedOptions(window)).toHaveCount(0);
        await expect(card.locator('.kit-card-settings')).toHaveText('12 Hours · 3 Downloads');

        // It goes as set: the server is asked for 12 hours and 3 downloads, of its two files.
        await cardButton(card, 'Upload').click();
        await expect(card.locator('.kit-card-status')).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
        await expect(card.getByRole('button', { name: 'Advanced Options' }), 'once it has started, its options are sealed').toBeDisabled();
        expect(uploadsStarted(server).map(({ lifetimeMs, maxDownloads }) => [lifetimeMs, maxDownloads])).toEqual([[12 * HOUR, 3]]);
        const link = await card.getByRole('textbox', { name: 'Link' }).inputValue();
        desktop.secrets.addLink(link);
        await page.goto(desktop.receivingUrl(link));
        await expect(page.locator('#bundle-file-count')).toHaveText('2');
    });

    test('an upload whose options are outside the server\'s limits at its start, from an edited config.json, stops at the kit\'s warning: Cancel leaves it waiting, "Use the Server\'s Limits" goes on with them', async ({ desktop, server }) => {
        let app = await desktop.launch();
        let window = await app.window();
        await desktop.setUp(window);
        await app.quit();
        // config.json edited by hand: a week, past the server's 24 hours.
        const config = path.join(desktop.profile, 'config.json');
        const saved = JSON.parse(fs.readFileSync(config, 'utf8'));
        const [savedServer] = saved.settings.servers;
        fs.writeFileSync(config, JSON.stringify({ ...saved, settings: { ...saved.settings, servers: [{ ...savedServer, lifetime: { value: 7, unit: 'days' } }] } }));

        app = await desktop.launch();
        window = await app.window();
        const host = hostOf(desktop);
        const [file] = filesFor(desktop, ['A week asked.bin'], 210);
        await window.locator('#file-input').setInputFiles([file.path]);
        const card = uploadCard(window);
        expect((await transfersIn(window))[0].options.lifetime, 'what main gave it, from config.json').toEqual({ value: 7, unit: 'days' });

        const warning = window.getByRole('alertdialog', { name: "Outside This Server's Limits" });
        await cardButton(card, 'Upload').click();
        await expect(warning).toBeVisible();
        await expect(warning.locator('.kit-dialog-text')).toHaveText(`${host} keeps files up to 24 hours and allows up to 5 downloads. This upload asks for 7 days and 1 download.`);
        await expect(warning.locator('.kit-dialog-detail')).toHaveText('The server may have lowered its limits since this upload was added.');
        await warning.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(warning).toBeHidden();
        await expect(card.locator('.kit-card-status'), 'Cancel leaves it waiting').toHaveText('Ready');
        expect(uploadsStarted(server), 'nothing asked of the server').toEqual([]);

        await cardButton(card, 'Upload').click();
        await warning.getByRole('button', { name: "Use the Server's Limits", exact: true }).click();
        await expect(card.locator('.kit-card-status')).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
        expect(uploadsStarted(server).map(({ lifetimeMs, maxDownloads }) => [lifetimeMs, maxDownloads]), 'what the server was asked for').toEqual([[24 * HOUR, 1]]);
        await expect(card.locator('.kit-card-settings'), 'it went with the server\'s limit, not Settings\' week').toHaveText('24 Hours');
        desktop.secrets.addLink(await card.getByRole('textbox', { name: 'Link' }).inputValue());
    });

    test('uploads given options outside the limits by the bridge itself are stopped together at Upload All, and go on held to them', async ({ desktop, server }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        const host = hostOf(desktop);
        const files = filesFor(desktop, ['Past the limit one.bin', 'Past the limit two.bin', 'Within it.bin'], 220);
        for (const file of files) await dropFiles(window, window.locator('#upload-area'), [file.path]);
        await expect(uploadCards(window)).toHaveCount(3);
        const [one, two] = await transfersIn(window);
        // What the page never offers, given to main straight through its bridge.
        await window.evaluate(([a, b]) => Promise.all([
            window.electronAPI.setTransferOptions(a, { lifetime: { value: 0, unit: 'unlimited' }, maxDownloads: 50 }),
            window.electronAPI.setTransferOptions(b, { maxDownloads: 0 }),
        ]), [one.id, two.id]);
        await expect(named(window, 'Past the limit one.bin').locator('.kit-card-settings')).toHaveText('No Time Limit · 50 Downloads');
        await expect(named(window, 'Past the limit two.bin').locator('.kit-card-settings')).toHaveText('Unlimited Downloads');

        await window.locator('#action-bar').getByRole('button', { name: 'Upload All', exact: true }).click();
        const warning = window.getByRole('alertdialog', { name: "Outside This Server's Limits" });
        await expect(warning.locator('.kit-dialog-text')).toHaveText(`${host} keeps files up to 24 hours and allows up to 5 downloads. 2 uploads here ask for more than that.`);
        await warning.getByRole('button', { name: "Use the Server's Limits", exact: true }).click();
        for (const file of files) {
            await expect(named(window, file.name).locator('.kit-card-status'), file.name).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
            desktop.secrets.addLink(await named(window, file.name).getByRole('textbox', { name: 'Link' }).inputValue());
        }
        expect(uploadsStarted(server).map(({ lifetimeMs, maxDownloads }) => [lifetimeMs, maxDownloads]).sort(), 'what the server was asked for')
            .toEqual([[24 * HOUR, 5], [24 * HOUR, 5], [24 * HOUR, 1]].sort());
    });
});

test.describe('on a server with no time limit and any number of downloads', () => {
    test.use({ serverEnv: { UPLOAD_MAX_FILE_LIFETIME_HOURS: '0', UPLOAD_MAX_FILE_DOWNLOADS: '0' } });

    test('Bulk Edit sets the options of those selected, Unlimited allowed where the server has no limit', async ({ desktop, server }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        const host = hostOf(desktop);
        const files = filesFor(desktop, ['Edited one.bin', 'Left as it was.bin', 'Edited two.bin'], 230);
        for (const file of files) await dropFiles(window, window.locator('#upload-area'), [file.path]);
        await expect(uploadCards(window)).toHaveCount(3);
        const bulk = window.locator('#upload-bulk');
        await expect(bulk.getByRole('button', { name: 'Bulk Edit', exact: true }), 'with nothing selected').toHaveCount(0);

        await named(window, 'Edited one.bin').locator('.kit-card-meta').click();
        await named(window, 'Edited two.bin').locator('.kit-card-meta').click({ modifiers: ['Control'] });
        await bulk.getByRole('button', { name: 'Bulk Edit', exact: true }).click();
        const dialog = advancedOptions(window);
        await expect(dialog.locator('.kit-dialog-text')).toHaveText('For the 2 uploads selected.');
        await expect(dialog.getByRole('list', { name: 'Files' }), 'no files to choose for several').toHaveCount(0);
        const unit = dialog.getByRole('combobox', { name: 'Unit' });
        expect((await optionsOf(unit)).at(-1), 'Unlimited, allowed').toEqual(['unlimited', 'Unlimited', false]);
        await expect(dialog.locator('#options-lifetime-help')).toHaveText(`${host} has no time limit.`);
        await expect(dialog.locator('#options-downloads-help')).toHaveText('0 means unlimited downloads.');
        await unit.selectOption('unlimited');
        await expect(dialog.getByLabel('File lifetime'), 'no value for no limit').toBeDisabled();
        await dialog.getByLabel('Max downloads').fill('0');
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click();

        for (const name of ['Edited one.bin', 'Edited two.bin']) {
            await expect(named(window, name).locator('.kit-card-settings'), name).toHaveText('No Time Limit · Unlimited Downloads');
        }
        await expect(named(window, 'Left as it was.bin').locator('.kit-card-settings')).toBeHidden();
        expect((await transfersIn(window)).map(({ options: { lifetime, maxDownloads } }) => [lifetime.unit, maxDownloads])).toEqual([['unlimited', 0], ['hours', 1], ['unlimited', 0]]);

        // The kit's form fades out as its prompts do; until it's gone, Escape is its, not the selection's.
        await expect(dialog).toHaveCount(0);
        await window.keyboard.press('Escape');
        await window.locator('#action-bar').getByRole('button', { name: 'Upload All', exact: true }).click();
        for (const file of files) {
            await expect(named(window, file.name).locator('.kit-card-status'), file.name).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
            desktop.secrets.addLink(await named(window, file.name).getByRole('textbox', { name: 'Link' }).inputValue());
        }
        expect(uploadsStarted(server).map(({ lifetimeMs, maxDownloads }) => [lifetimeMs, maxDownloads]).sort(), 'no limit asked for twice')
            .toEqual([[0, 0], [0, 0], [24 * HOUR, 1]].sort());
    });
});
