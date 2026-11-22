// The sharing code entry, on the home page and on a bare /p2p: one real text
// field drawn as eight boxes (four letters, a drawn dash, four digits).
// - Typing: the letters A to Z without I and O, upper-cased, then digits;
//   anything else is refused and changes nothing; Backspace, Delete, the
//   arrows, Home and End are the field's own.
// - There's no Go: the eighth character sends the code. Enter sends a whole
//   code again after something stopped it.
// - Pasting: a code in any form, or text with exactly one code in it, sends
//   it; a piece of a code goes in where the caret is if it fits; a link opens
//   (a hosted one with its key, a direct one its Ready to Connect, a Dropgate 3
//   one the older-version page); another server's link, and anything else,
//   say so on the line under the boxes.
// - One field to the accessibility tree, axe clean in both themes, and its
//   focus ring on the box where the next character goes.
import AxeBuilder from '@axe-core/playwright';
import crypto from 'node:crypto';
import { THEMES, expectFocusRings, useTheme } from '../helpers/contrast.mjs';
import { secretsOf } from '../helpers/privacy.mjs';
import { expect, test } from '../helpers/test.mjs';
import { pasteInto, typeIntoCodeBoxes } from '../helpers/webui.mjs';

const NOT_A_CODE = "That isn't a code or a Dropgate link.";
const HINT = 'Four letters, then four digits. It opens once all eight are in. You can paste a code or a link.';

/** Open the home page, once it has the server's settings. */
async function openHome(page) {
    await page.goto('/');
    await expect(page.locator('#securityText')).not.toHaveText(/checking/i);
}

/** The characters the boxes show, in order, '' for an empty one. */
const boxes = (page) => page.locator('.code-cell').allTextContents();

/** Expect the value and what the boxes show to be `value`, with nothing said under them. */
async function expectHolds(page, value) {
    await expect(page.locator('#codeInput')).toHaveValue(value);
    await expect.poll(() => boxes(page)).toEqual([...value.padEnd(8, ' ')].map((c) => c.trim()));
}

/** A code made up for one test, noted so the privacy check looks for it in what was sent. */
function madeUpCode(page) {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const code = `${Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('')}-${String(crypto.randomInt(10_000)).padStart(4, '0')}`;
    secretsOf(page).addCode(code);
    return code;
}

test.describe('on the home page', () => {
    test('typing takes the letters, upper-cased, then digits, and refuses anything else without changing a thing', async ({ page }) => {
        await openHome(page);
        await page.locator('#codeInput').click();
        // A digit, an I and an O where letters go; a dash and a space anywhere; a letter where digits go.
        await page.keyboard.type('k1mIOp');
        await expectHolds(page, 'KMP');
        await page.keyboard.type('i r-');
        await expectHolds(page, 'KMPR');
        await page.keyboard.type('xO4');
        await expectHolds(page, 'KMPR4');
        await expect(page.locator('#code-status')).toHaveText('');
        await expect(page.locator('#code-hint')).toHaveText(HINT);
        await expect(page.locator('#code-hint')).toBeVisible();
    });

    test('Backspace, Delete, the arrows, Home, End and a selection work as in any field', async ({ page }) => {
        await openHome(page);
        await page.locator('#codeInput').click();
        await page.keyboard.type('KMPR48');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Backspace');
        // The digits move up into a letter's box, which shows it's wrong.
        await expectHolds(page, 'KMP48');
        await expect(page.locator('.code-cell.is-wrong')).toHaveCount(1);
        // Only what puts it right can go in there.
        await page.keyboard.type('7');
        await expectHolds(page, 'KMP48');
        await page.keyboard.type('R');
        await expectHolds(page, 'KMPR48');
        await expect(page.locator('.code-cell.is-wrong')).toHaveCount(0);
        await page.keyboard.press('Home');
        await page.keyboard.press('Delete');
        await expectHolds(page, 'MPR48');
        await page.keyboard.type('K');
        await expectHolds(page, 'KMPR48');
        await page.keyboard.press('End');
        await page.keyboard.type('2');
        await page.keyboard.press('Shift+ArrowLeft');
        await page.keyboard.press('Shift+ArrowLeft');
        await page.keyboard.press('Shift+ArrowLeft');
        await expect(page.locator('.code-cell.is-selected')).toHaveCount(3);
        await page.keyboard.type('9');
        await expectHolds(page, 'KMPR9');
        // A click puts the caret at the cell clicked (here before the 9), not where the input's hidden text would.
        const cell = await page.locator('.code-cell').nth(4).boundingBox();
        await page.mouse.click(cell.x + cell.width * 0.25, cell.y + cell.height / 2);
        await page.keyboard.press('Backspace');
        await expectHolds(page, 'KMP9');
        await page.keyboard.type('R');
        await expectHolds(page, 'KMPR9');
        // Enter with the code not whole does nothing.
        await page.keyboard.press('Enter');
        await expectHolds(page, 'KMPR9');
        await expect(page).toHaveURL(/\/$/);
    });

    test('the eighth character opens the receive page with the code after the #, with no Go to press', async ({ page, server }) => {
        await openHome(page);
        await expect(page.getByRole('button', { name: 'Go' })).toHaveCount(0);
        const code = madeUpCode(page);
        const opened = page.waitForRequest((r) => r.isNavigationRequest() && new URL(r.url()).pathname === '/p2p');
        await typeIntoCodeBoxes(page, code.toLowerCase());
        await opened;
        // The receive page takes the code out of its address before anything else.
        await expect(page).toHaveURL(`${server.baseUrl}/p2p`);
    });

    for (const [what, pasted] of [
        ['a code in lower case with spaces', (code) => ` ${code.toLowerCase().replace('-', ' ')} `],
        ['a code without its dash', (code) => code.replace('-', '')],
        ['text with one code in it', (code) => `Your code is ${code}. See you soon!`],
    ]) {
        test(`pasting ${what} opens the receive page`, async ({ page, server }) => {
            await openHome(page);
            const code = madeUpCode(page);
            await pasteInto(page.locator('#codeInput'), pasted(code));
            await expect(page).toHaveURL(`${server.baseUrl}/p2p`);
        });
    }

    test('a real paste from the clipboard, Ctrl+V, goes the same way', async ({ page, context, browserName, server }) => {
        test.skip(browserName !== 'chromium', 'Only Chromium lets a test put text on the system clipboard');
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await openHome(page);
        const code = madeUpCode(page);
        await page.evaluate((text) => navigator.clipboard.writeText(text), `The code: ${code}`);
        await page.locator('#codeInput').focus();
        await page.keyboard.press('ControlOrMeta+V');
        await expect(page).toHaveURL(`${server.baseUrl}/p2p`);
    });

    test('pasting a piece of a code puts it in where the caret is if it fits there, and otherwise says so and changes nothing', async ({ page, server }) => {
        await openHome(page);
        const code = madeUpCode(page);
        const field = page.locator('#codeInput');
        await pasteInto(field, code.slice(0, 4).toLowerCase());
        await expectHolds(page, code.slice(0, 4));
        // Letters where the digits go don't fit.
        await pasteInto(field, 'AB');
        await expect(page.locator('#code-status')).toHaveText(NOT_A_CODE);
        await expect(page.locator('#code-hint')).toBeHidden();
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        await expectHolds(page, code.slice(0, 4));
        // The digits do, and make it whole, so it opens.
        await pasteInto(field, code.slice(5));
        await expect(page).toHaveURL(`${server.baseUrl}/p2p`);
    });

    test("pasting anything that isn't a code or a link says so under the boxes, until the next change", async ({ page }) => {
        await openHome(page);
        const field = page.locator('#codeInput');
        for (const pasted of [
            'hello there',
            // Two codes: it can't tell which.
            'ABCD-1234 or EFGH-5678',
            // An upload's bare ID can't be typed or pasted any more: its link can.
            crypto.randomUUID(),
            'ABCO-1234',
            // A code's shape inside a longer run of digits isn't a code.
            'Ref ABCD-12345',
        ]) {
            await pasteInto(field, pasted);
            await expect(page.locator('#code-status'), pasted).toHaveText(NOT_A_CODE);
            await expectHolds(page, '');
        }
        await page.keyboard.type('K');
        await expect(page.locator('#code-status')).toHaveText('');
        await expect(field).not.toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator('#code-hint')).toBeVisible();
    });

    test("pasting another server's link says it must be from this one, and a link this server doesn't know isn't a Dropgate link", async ({ page, server }) => {
        await openHome(page);
        const field = page.locator('#codeInput');
        await pasteInto(field, `https://other.example.net/${crypto.randomUUID()}`);
        await expect(page.locator('#code-status')).toHaveText('URL must be from this server.');
        await pasteInto(field, `${server.baseUrl}/not-a-share`);
        await expect(page.locator('#code-status')).toHaveText(NOT_A_CODE);
        await expect(page).toHaveURL(`${server.baseUrl}/`);
    });

    test("pasting a direct transfer's link opens its Ready to Connect page, and nothing is connected", async ({ page, server }) => {
        await openHome(page);
        const secret = crypto.randomBytes(32).toString('base64url');
        const link = `${server.baseUrl}/p2p#${secret}`;
        secretsOf(page).addLink(link);
        let sockets = 0;
        page.on('websocket', () => { sockets += 1; });
        await pasteInto(page.locator('#codeInput'), link);
        await expect(page).toHaveURL(link);
        await expect(page.locator('#title')).toHaveText(/ready to connect|can't connect/i);
        expect(sockets, 'connections opened').toBe(0);
    });

    test('the field is one text box to the accessibility tree, with its label and hint, and axe finds nothing in either theme', async ({ page }) => {
        await openHome(page);
        await expect(page.locator('#codeCard')).toMatchAriaSnapshot(`
          - heading "Enter Sharing Code" [level=2]
          - text: Sharing code
          - textbox "Sharing code"
          - status
          - text: ${HINT}
        `);
        await expect(page.locator('#codeCard').getByRole('textbox')).toHaveCount(1);
        // The input lies over the cells, so every click and tap on them reaches it.
        const [input, cells] = [await page.locator('#codeInput').boundingBox(), await page.locator('.code-cells').boundingBox()];
        for (const side of ['x', 'y', 'width', 'height']) expect(Math.abs(input[side] - cells[side]), side).toBeLessThan(1);
        await expect(page.locator('#codeInput')).toHaveAccessibleDescription(HINT);
        await expect(page.locator('#codeInput')).toHaveAttribute('autocomplete', 'one-time-code');
        await expect(page.locator('#codeInput')).toHaveAttribute('autocapitalize', 'characters');
        await expect(page.locator('#codeInput')).toHaveAttribute('spellcheck', 'false');

        const found = [];
        for (const theme of THEMES) {
            await useTheme(page, theme);
            for (const [state, bring] of [
                ['empty', async () => { await page.locator('#codeInput').blur(); }],
                ['part-typed and focused', async () => { await page.locator('#codeInput').focus(); await page.keyboard.type('KMP'); }],
                ['with an error', async () => { await pasteInto(page.locator('#codeInput'), 'hello'); }],
            ]) {
                await bring();
                const { violations } = await new AxeBuilder({ page }).include('#codeCard').analyze();
                for (const v of violations) found.push(`${theme}, ${state}: ${v.id} on ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
                await page.locator('#codeInput').fill('');
            }
        }
        expect(found).toEqual([]);
    });

    test("the field's focus ring shows on the box where the next character goes", async ({ page }) => {
        await openHome(page);
        await page.locator('#codeInput').focus();
        await page.keyboard.type('KM');
        await expect(page.locator('.code-cell.is-active')).toHaveCount(1);
        expect(await page.locator('.code-cell').evaluateAll((all) => all.findIndex((box) => box.classList.contains('is-active')))).toBe(2);
        await page.locator('#codeInput').fill('');
        await page.locator('#codeInput').blur();
        await expect(page.locator('.code-cell.is-active')).toHaveCount(0);
        // Every Tab stop on the page, the code's field among them.
        await expectFocusRings(page, 'the home page');
    });

    test.describe('with direct transfer off', () => {
        test.use({ serverEnv: { ENABLE_P2P: 'false' } });

        test('a whole code that can\'t be opened stays, with why under it, and Enter tries it again', async ({ page }) => {
            await openHome(page);
            const code = madeUpCode(page);
            await typeIntoCodeBoxes(page, code);
            await expect(page.locator('#code-status')).toHaveText('Direct transfer is disabled on this server.');
            await expectHolds(page, code.replace('-', ''));
            // Everything the line says from here on.
            await page.evaluate(() => {
                window.__said = [];
                const line = document.querySelector('#code-status');
                new MutationObserver(() => window.__said.push(line.textContent)).observe(line, { subtree: true, childList: true, characterData: true });
            });
            await page.keyboard.press('Enter');
            await expect.poll(() => page.evaluate(() => window.__said)).toContain('Opening the transfer…');
            await expect(page.locator('#code-status')).toHaveText('Direct transfer is disabled on this server.');
        });
    });
});

test.describe('on a bare /p2p', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/p2p');
        const canConnect = await page.evaluate(() => typeof window.RTCPeerConnection === 'function');
        test.skip(!canConnect, "This browser can't make direct transfers, so the page never asks for a code");
        await expect(page.locator('#code-card')).toBeVisible();
    });

    test('typing a code connects here, and a code nobody is sending brings the boxes back with what to do', async ({ page, server }) => {
        const code = madeUpCode(page);
        await page.locator('#codeInput').click();
        await page.keyboard.type(code.toLowerCase());
        await expect(page.locator('#title')).toHaveText('Transfer Failed', { timeout: 30_000 });
        await expect(page.locator('#code-card')).toBeVisible();
        await expect(page.locator('#code-status')).toHaveText('Ask the sender for the code their page shows now.');
        await expectHolds(page, '');
        await expect(page).toHaveURL(`${server.baseUrl}/p2p`);
    });

    test("pasting a direct link opens its Ready to Connect here; pasting anything else says so, and nothing is typed while a link is opening", async ({ page, server }) => {
        await pasteInto(page.locator('#codeInput'), 'hello');
        await expect(page.locator('#code-status')).toHaveText(NOT_A_CODE);
        await pasteInto(page.locator('#codeInput'), `${server.baseUrl}/not-a-share`);
        await expect(page.locator('#code-status')).toHaveText(NOT_A_CODE);
        await pasteInto(page.locator('#codeInput'), `https://other.example.net/${crypto.randomUUID()}`);
        await expect(page.locator('#code-status')).toHaveText('URL must be from this server.');

        // This page asked the server nothing yet, so a direct link waits on its answer (is direct transfer on?):
        // held here, the link is still opening, and nothing can be typed meanwhile.
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        await page.route('**/api/info', async (route) => { await held; await route.continue(); });
        const secret = crypto.randomBytes(32).toString('base64url');
        const link = `${server.baseUrl}/p2p#${secret}`;
        secretsOf(page).addLink(link);
        await pasteInto(page.locator('#codeInput'), link);
        await expect(page.locator('#code-status')).toHaveText('Opening the link…');
        await page.keyboard.type('KMPR');
        await expectHolds(page, '');
        release();
        await expect(page.locator('#title')).toHaveText('Ready to Connect');
        await expect(page.locator('#code-card')).toBeHidden();
        await expect(page).toHaveURL(link);
    });

    test('the field is the same one text box there, and axe finds nothing in either theme', async ({ page }) => {
        await expect(page.locator('#code-card').getByRole('textbox')).toHaveCount(1);
        await expect(page.locator('#code-card').getByRole('textbox')).toHaveAccessibleName('Sharing code');
        const found = [];
        for (const theme of THEMES) {
            await useTheme(page, theme);
            const { violations } = await new AxeBuilder({ page }).include('#code-card').analyze();
            for (const v of violations) found.push(`${theme}: ${v.id} on ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        }
        expect(found).toEqual([]);
    });
});
