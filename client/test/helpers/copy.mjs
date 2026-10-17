// The words the client can show: every string literal in its own source (not
// core's build), and the text and named attributes of its pages, for the
// house's copy rules (test/copy.test.mjs). Read without running anything:
// comments and regular expressions are skipped, and a template literal's
// ${…} reads as "X", a name or a number the rules leave as it is.
import { readFileSync, readdirSync } from 'node:fs';

const SRC = new URL('../../src/', import.meta.url);

/** What a placeholder for a template literal's ${…} reads as: a name or a number, never recased. */
export const PLACEHOLDER = 'X';

/** After one of these (or nothing), a "/" starts a regular expression; after anything else, it divides. */
const BEFORE_REGEX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', 'return', 'typeof', 'case', 'void', 'delete', 'in', 'of', 'new', 'throw']);

/**
 * Every string literal in a script, in order: { text, line }. A template
 * literal's expressions are scanned for literals of their own too.
 * @param {string} code
 */
export function literalsIn(code) {
    const found = [];
    const lineAt = (i) => code.slice(0, i).split('\n').length;

    /** A quoted string from its opening quote: its text, and where it ends. */
    function quoted(start) {
        const quote = code[start];
        let text = '';
        let i = start + 1;
        while (i < code.length && code[i] !== quote) {
            if (code[i] === '\\') {
                text += code[i + 1];
                i += 2;
            } else {
                text += code[i++];
            }
        }
        return { text, end: i + 1 };
    }

    /** A template literal from its backtick: its text with each ${…} as the placeholder, and where it ends. */
    function template(start) {
        let text = '';
        let i = start + 1;
        while (i < code.length && code[i] !== '`') {
            if (code[i] === '\\') {
                text += code[i + 1];
                i += 2;
            } else if (code[i] === '$' && code[i + 1] === '{') {
                i = scan(i + 2, true) + 1;
                text += PLACEHOLDER;
            } else {
                text += code[i++];
            }
        }
        return { text, end: i + 1 };
    }

    /** Scan code from `start`, noting its literals; with `inside`, up to the "}" that closes a ${…}, whose index it returns. */
    function scan(start, inside) {
        let depth = 0;
        let last = '';
        let i = start;
        while (i < code.length) {
            const c = code[i];
            if (c === '/' && code[i + 1] === '/') {
                while (i < code.length && code[i] !== '\n') i++;
            } else if (c === '/' && code[i + 1] === '*') {
                i = code.indexOf('*/', i + 2) + 2;
            } else if (c === "'" || c === '"' || c === '`') {
                const { text, end } = c === '`' ? template(i) : quoted(i);
                found.push({ text, line: lineAt(i) });
                i = end;
                last = 'a';
            } else if (c === '/' && BEFORE_REGEX.has(last)) {
                // A regular expression: to its closing slash outside a [class], then its flags.
                let inClass = false;
                i++;
                while (i < code.length && code[i] !== '\n') {
                    if (code[i] === '\\') i += 2;
                    else if (code[i] === '[') inClass = true, i++;
                    else if (code[i] === ']') inClass = false, i++;
                    else if (code[i] === '/' && !inClass) break;
                    else i++;
                }
                i++;
                while (/[a-z]/i.test(code[i] ?? '')) i++;
                last = 'a';
            } else if (/[A-Za-z0-9_$]/.test(c)) {
                let word = '';
                while (i < code.length && /[A-Za-z0-9_$]/.test(code[i])) word += code[i++];
                last = BEFORE_REGEX.has(word) ? word : 'a';
            } else {
                if (c === '{') depth++;
                if (c === '}') {
                    if (inside && depth === 0) return i;
                    depth--;
                }
                if (!/\s/.test(c)) last = c;
                i++;
            }
        }
        return i;
    }

    scan(0, false);
    return found;
}

/**
 * A page's words: its text, and its aria-label, title, placeholder and alt
 * attributes, with its scripts, styles and comments left out. { text, line }.
 * @param {string} html
 */
export function wordsInPage(html) {
    const found = [];
    const lineAt = (i) => html.slice(0, i).split('\n').length;
    const blanked = html.replace(/<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, (m) => m.replace(/[^\n]/g, ' '));
    for (const match of blanked.matchAll(/>([^<]+)</g)) {
        const text = match[1].trim();
        if (text) found.push({ text: text.replace(/\s+/g, ' '), line: lineAt(match.index) });
    }
    for (const match of blanked.matchAll(/\s(?:aria-label|title|placeholder|alt)="([^"]*)"/g)) {
        if (match[1]) found.push({ text: match[1], line: lineAt(match.index) });
    }
    return found;
}

/** Short words a Title Case item leaves small after its first. */
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'via', 'with']);

/** Whether a word (and each part of a hyphenated one) is in Title Case: a capital, a number or a name, or a short word after the first. */
function titleCased(word, first) {
    const bare = word.replace(/^[("'“]+|[)"'”,;:]+$/g, '');
    const [head, ...rest] = bare.split('-');
    const ok = (part, leading) => !/^[a-z]/.test(part) || (!leading && SMALL.has(part));
    return ok(head, first) && rest.every((part) => ok(part, false));
}

/** The bullet-separated items (" · ", or the tray's " • ") in a text that aren't in Title Case, but those that are sentences. */
export function untitled(text) {
    if (!/ [·•] /.test(text)) return [];
    return text.split(/ [·•] /).map((item) => item.trim()).filter((item) => item && !/[.!?]$/.test(item))
        .filter((item) => !item.split(/\s+/).every((word, i) => titleCased(word, i === 0)));
}

/**
 * How a text breaks the house's copy rules, as a list of reasons (none when
 * it keeps them): a three-dot ellipsis, the word "card", a small letter
 * after a colon (a version, "v4.0.0", is a number), and a bullet-separated
 * item not in Title Case. A name in `names` (a file's, a server's address) is
 * read as the placeholder: it's never recased, so it's never checked.
 * @param {string} text
 * @param {{ names?: string[] }} [options]
 */
export function copySlips(text, { names = [] } = {}) {
    let read = text;
    for (const name of [...names].sort((a, b) => b.length - a.length)) read = read.split(name).join(PLACEHOLDER);
    const slips = [];
    if (read.includes('...')) slips.push('a three-dot ellipsis');
    // A class or a selector ("upload-card", ".kit-card-name") is code, joined to its word by "-", "_" or a "." before more of it.
    if (/(^|[^-._\w])cards?(?![-_\w]|\.\w)/i.test(read)) slips.push('the word "card"');
    if ([...read.matchAll(/:\s+(\S+)/g)].some(([, word]) => /^[a-z]/.test(word) && !/^v(\d|X)/.test(word))) slips.push('a small letter after a colon');
    for (const item of untitled(read)) slips.push(`"${item}" not in Title Case`);
    return slips;
}

/** The client's own scripts (every one in src/ and src/core/, but core's build) and its pages, by name. */
export function clientSources() {
    const scripts = [...readdirSync(SRC).filter((name) => name.endsWith('.js') && name !== 'dropgate-core.js'),
        ...readdirSync(new URL('core/', SRC)).filter((name) => name.endsWith('.js')).map((name) => `core/${name}`)];
    const pages = readdirSync(SRC).filter((name) => name.endsWith('.html'));
    const read = (name) => readFileSync(new URL(name, SRC), 'utf8');
    return {
        scripts: scripts.map((name) => ({ name, words: literalsIn(read(name)) })),
        pages: pages.map((name) => ({ name, words: wordsInPage(read(name)) })),
    };
}
