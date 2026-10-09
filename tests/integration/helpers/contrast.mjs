// Colour contrast, as axe-core sees it: every text pairing on the page, in the
// light theme and the dark one, must meet WCAG 2.2 AA (4.5:1, or 3:1 for large
// text). axe is put into the page by the test alone; the pages never load it.
//
// The pages follow the browser's colour scheme (theme.js sets data-bs-theme
// from it), so each theme is the same page, asked for again with
// page.emulateMedia(). Every page fades in, and a toast slides in, so the check
// waits for the page's animations to finish first: a colour part-way through a
// fade isn't the one a person reads.
import AxeBuilder from '@axe-core/playwright';
import { expect } from './test.mjs';

export const THEMES = ['light', 'dark'];

/** Wait until nothing on the page is animating or transitioning, but what repeats for ever (a pulse). */
export async function settled(page) {
    await page.waitForFunction(() => document.getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .every((a) => a.playState !== 'running' && a.playState !== 'pending'));
}

/** Show the page in `theme` ('light' or 'dark'), and wait for it to apply. */
export async function useTheme(page, theme) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
    await settled(page);
}

/**
 * axe's color-contrast failures on the page as it is now, one line each: the
 * element, its ratio, and its colours.
 * @param {import('@playwright/test').Page} page
 */
export async function contrastFailures(page) {
    const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    return violations.flatMap((v) => v.nodes.map((node) => {
        const data = node.any.find((check) => check.id === 'color-contrast')?.data ?? {};
        return `${node.target.join(' ')}: ${data.contrastRatio}:1 (${data.fgColor} on ${data.bgColor}, needs ${data.expectedContrastRatio})`;
    }));
}

/** An `rgb()` or `rgba()` colour's channels, 0–255. */
const channels = (css) => css.match(/[\d.]+/g).slice(0, 3).map(Number);

/** WCAG's contrast ratio between two opaque colours, as CSS gives them. */
export function contrastRatio(a, b) {
    const luminance = (css) => {
        const [r, g, bl] = channels(css).map((c) => {
            const s = c / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/**
 * Expect every place the keyboard's focus goes, Tab by Tab from the top (or
 * round a modal, which keeps the focus), to be visible and to show a solid
 * ring at least 2px wide, at 3:1 or more against the page, in both themes.
 * Leaves the page in the light theme.
 * @param {import('@playwright/test').Page} page
 * @param {string} what - The page, or the state it's in, for the failure message.
 */
export async function expectFocusRings(page, what) {
    const found = [];
    for (const theme of THEMES) {
        await useTheme(page, theme);
        await page.evaluate(() => document.activeElement?.blur());
        const seen = [];
        for (let i = 0; i < 40; i++) {
            await page.keyboard.press('Tab');
            const stop = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el || el === document.body) return null;
                const s = getComputedStyle(el);
                const box = el.getBoundingClientRect();
                return {
                    name: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent).trim().slice(0, 30)}"`,
                    focusVisible: el.matches(':focus-visible'),
                    shown: box.width > 1 && box.height > 1,
                    style: s.outlineStyle,
                    width: parseFloat(s.outlineWidth),
                    colour: s.outlineColor,
                    page: getComputedStyle(document.body).backgroundColor,
                };
            });
            // Back to the start: the page's own controls, or a modal's, have all had the focus.
            if (!stop || seen.includes(stop.name)) break;
            seen.push(stop.name);
            const ratio = contrastRatio(stop.colour, stop.page);
            if (!stop.shown) found.push(`${theme}: ${stop.name} takes the focus, but can't be seen`);
            else if (!stop.focusVisible || stop.style !== 'solid' || stop.width < 2 || ratio < 3) {
                found.push(`${theme}: ${stop.name}: ${stop.style} ${stop.width}px ${stop.colour}, ${ratio.toFixed(2)}:1 on ${stop.page}`);
            }
        }
        if (seen.length === 0) found.push(`${theme}: Tab reached nothing`);
    }
    await useTheme(page, 'light');
    expect(found, `focus rings on ${what}`).toEqual([]);
}

/**
 * Expect every text pairing on the page, as it is now, to meet AA in both
 * themes. Leaves the page in the light theme.
 * @param {import('@playwright/test').Page} page
 * @param {string} what - The page, or the state it's in, for the failure message.
 * @param {() => Promise<void>} [show] - Brings the state about again in each
 *   theme, once the theme is in force: for something that doesn't stay, such
 *   as a toast.
 */
export async function expectContrast(page, what, show) {
    const found = [];
    for (const theme of THEMES) {
        await useTheme(page, theme);
        if (show) {
            await show();
            await settled(page);
        }
        for (const line of await contrastFailures(page)) found.push(`${theme}: ${line}`);
    }
    await useTheme(page, 'light');
    expect(found, `text below AA on ${what}`).toEqual([]);
}
