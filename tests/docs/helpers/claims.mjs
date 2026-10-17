// The privacy docs' claims that something isn't logged or stored, and the tests
// that prove them. Each such claim links to a test, with the test's name as the
// link's text, so a reader sees what checks it and can open the test.
import path from 'node:path';
import { parseMarkdown } from './markdown.mjs';

/** The docs whose claims must each name their test. */
export const PRIVACY_DOCS = ['docs/PRIVACY.md', 'docs/technical/DATA-PROCESSING.md'];

const VERB = String.raw`(?:logged|logs|stored|stores|keeps|kept|writes|written|wrote|records|recorded|holds|held|persisted|retained|collected|saved)`;
const NEGATIVE = String.raw`(?:never|not|no|nothing|none|isn't|aren't|doesn't|don't|won't)`;
// "not stored", "never makes or keeps", "nothing is written": a negative, then
// the verb within three words.
const NEGATIVE_THEN_VERB = new RegExp(String.raw`\b${NEGATIVE}\b(?:\W+[\w'’]+){0,3}?\W+${VERB}\b`, 'i');
// "writes nothing", "keeps none", "holds no IP".
const VERB_THEN_NEGATIVE = new RegExp(String.raw`\b${VERB}\W+(?:nothing|none|no|never)\b`, 'i');
// "log messages never include:", "do not include:".
const LOGS_EXCLUDE = /\blog\w*\b.*\b(?:never|not)\b\W+include\b/i;
// A table row whose "Stored?" column says **No** or **Never**.
const STORED_NO = /^\*\*(?:no|never)\*\*/i;

const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
const TEST_FILE = /(?:^|\/)(?:test|tests)\/.*\.(?:test|spec)\.(?:m?js|ts)$/;

/**
 * Splits a doc into blocks: a paragraph, a list item (with its continuation
 * lines) or a table row. A paragraph ending in ":" just before a list is one
 * block with the list, so "never include:" covers the items under it.
 * @returns {{ line: number, prose: string, raw: string, stored?: string }[]}
 */
export function blocksOf(markdown) {
    const { lines, tables } = parseMarkdown(markdown);
    const stored = new Map();
    for (const table of tables) {
        const at = table.header.findIndex((h) => /^stored\??$/i.test(h));
        for (const row of table.rows) stored.set(row.line, at === -1 ? undefined : row.cells[at]?.text ?? '');
    }
    const blocks = [];
    let current = null; // the block lines are added to
    let leadIn = null; // a paragraph ending in ":" whose list joins it
    const add = (block, line) => {
        block.prose += ` ${line.prose}`;
        block.raw += `\n${line.raw}`;
    };
    for (const line of lines) {
        const { raw } = line;
        if (!raw.trim() && !line.fenced) {
            if (current && !current.listItem && /:\s*$/.test(current.raw)) leadIn = current;
            current = null;
            continue;
        }
        if (line.fenced || /^\s*#/.test(raw) || line.inTable) {
            current = leadIn = null;
            if (line.inTable && stored.has(line.number)) {
                blocks.push({ line: line.number, prose: line.prose, raw, stored: stored.get(line.number) });
            }
            continue;
        }
        if (LIST_ITEM.test(raw)) {
            if (leadIn) {
                add(leadIn, line);
                current = leadIn;
                continue;
            }
            current = { line: line.number, prose: line.prose, raw, listItem: true };
            blocks.push(current);
            continue;
        }
        if (current) {
            add(current, line);
            continue;
        }
        leadIn = null;
        current = { line: line.number, prose: line.prose, raw };
        blocks.push(current);
    }
    return blocks;
}

/** Whether a block says that something isn't logged or stored. */
export function isClaim(block) {
    if (block.stored !== undefined && STORED_NO.test(block.stored.trim())) return true;
    return NEGATIVE_THEN_VERB.test(block.prose) || VERB_THEN_NEGATIVE.test(block.prose) || LOGS_EXCLUDE.test(block.prose);
}

/**
 * The links in a block to a test file: `{ name, file }`, the name being the
 * link's text without quotes; `…` at its end means "starts with".
 */
export function testLinks(block, docFile) {
    const found = [];
    for (const match of block.raw.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
        const target = match[2].split('#')[0];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        const file = path.posix.normalize(path.posix.join(path.posix.dirname(docFile), decodeURIComponent(target)));
        if (!TEST_FILE.test(file)) continue;
        found.push({ name: match[1].trim().replace(/^[“"]|[”"]$/g, ''), file });
    }
    return found;
}

/**
 * The names of a test file's tests and groups, as written: node:test's and
 * Vitest's `test()`, `it()` and `describe()`, and Playwright's
 * `test.describe()`. In a template literal, `${…}` stands for anything.
 * @returns {{ text: string, pattern: RegExp }[]}
 */
export function testNames(source) {
    const names = [];
    const call = /\b(?:test|it|describe)(?:\.(?:describe|only|skip|fails|serial|concurrent))?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
    for (const [, quote, body] of source.matchAll(call)) {
        const text = body.replace(/\\(.)/g, '$1');
        const parts = quote === '`' ? text.split(/\$\{[^}]*\}/) : [text];
        names.push({ text, pattern: new RegExp(`^${parts.map(escapeRegExp).join('.*')}$`) });
    }
    return names;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether a link's name is one of the names: the whole name, or, ending in `…`, the start of one. */
export function namesTest(name, names) {
    const start = /…$/.test(name) ? name.replace(/\s*…$/, '') : null;
    return names.some(({ text, pattern }) => (start === null ? pattern.test(name) : text.startsWith(start)));
}

/**
 * Every problem with a privacy doc's claims: a claim with no test linked, and
 * a test link whose file isn't there or has no test of that name.
 * @param {string} docFile - The doc's path from the repository root.
 * @param {string} markdown
 * @param {{ isFile: (file: string) => boolean, read: (file: string) => string }} repo
 */
export function claimProblems(docFile, markdown, { isFile, read }) {
    const problems = [];
    const namesByFile = new Map();
    for (const block of blocksOf(markdown)) {
        const links = testLinks(block, docFile);
        if (isClaim(block) && links.length === 0) {
            problems.push(`${docFile}:${block.line}: says something isn't logged or stored, but links no test: ${block.prose.trim().slice(0, 100)}`);
        }
        for (const { name, file } of links) {
            if (!isFile(file)) {
                problems.push(`${docFile}:${block.line}: links ${file}, which isn't there`);
                continue;
            }
            if (!namesByFile.has(file)) namesByFile.set(file, testNames(read(file)));
            if (!namesTest(name, namesByFile.get(file))) problems.push(`${docFile}:${block.line}: ${file} has no test named "${name}"`);
        }
    }
    return problems;
}

/** How many claims a doc makes, and how many test links it has. */
export function claimCounts(docFile, markdown) {
    const blocks = blocksOf(markdown);
    return {
        claims: blocks.filter(isClaim).length,
        links: blocks.reduce((n, block) => n + testLinks(block, docFile).length, 0),
    };
}
