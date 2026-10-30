// Every claim in the privacy docs that something isn't logged or stored names
// the test that proves it: a link to the test file, with the test's name as its
// text. The rules are checked on the real docs, and on planted mistakes, so they
// can't pass by checking nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRIVACY_DOCS, claimCounts, claimProblems } from './helpers/claims.mjs';
import { isFile, read } from './helpers/repo.mjs';
import { expectNone } from './helpers/report.mjs';

const repo = { isFile, read };

test('every claim in the privacy docs that something isn\'t logged or stored links the test that proves it, by its name', () => {
    expectNone(PRIVACY_DOCS.flatMap((doc) => claimProblems(doc, read(doc), repo)), 'Fix these claims or their links:');
});

test('the check finds the docs\' claims and their tests', () => {
    for (const doc of PRIVACY_DOCS) {
        const { claims, links } = claimCounts(doc, read(doc));
        assert.ok(claims >= 5,`expected ${doc}'s claims, but found ${claims}`);
        assert.ok(links >= claims, `expected a test link for each of ${doc}'s ${claims} claims, but found ${links}`);
    }
});

// A doc of planted mistakes, read as if it were docs/PRIVACY.md, against a test file of its own.
const TEST_FILE = 'server/test/example.test.mjs';
const planted = {
    isFile: (file) => file === TEST_FILE,
    read: () => "test('nothing reaches the log', () => {});\ndescribe(`at ${level}, every line is known`, () => {});\n",
};
const problemsIn = (markdown) => claimProblems('docs/PRIVACY.md', markdown, planted);

test('a claim with no test linked is a problem, in a paragraph, a list item, a list under "never include:" and a table', () => {
    for (const markdown of [
        'The server writes nothing to disk.',
        '- An upload ID is never logged.',
        "Dropgate's log messages never include:\n\n- File names\n- Keys",
        '| Data | Stored? | Why |\n|---|---|---|\n| **User agent** | **No** | Not needed. |',
        '| Data | Stored? | Why |\n|---|---|---|\n| **IP address** | In memory | Not written to disk. |',
    ]) {
        assert.equal(problemsIn(markdown).length, 1, markdown);
    }
});

test('a claim is met by a link to a test file naming one of its tests, whole, by its start with "…", or through a ${} in the name', () => {
    for (const markdown of [
        `Nothing is logged ([nothing reaches the log](../${TEST_FILE})).`,
        `Nothing is logged ([“nothing reaches…”](../${TEST_FILE})).`,
        `Nothing is logged ([at DEBUG, every line is known](../${TEST_FILE})).`,
        `Dropgate's log messages never include:\n\n- File names\n- Keys ([nothing reaches the log](../${TEST_FILE}))`,
    ]) {
        assert.deepEqual(problemsIn(markdown), [], markdown);
    }
});

test('a test link naming no test in its file, or to a file that isn\'t there, is a problem; a link to anything else isn\'t a test', () => {
    assert.match(problemsIn(`Nothing is logged ([nothing reaches the logs](../${TEST_FILE})).`)[0], /has no test named/);
    assert.match(problemsIn(`Nothing is logged ([something…](../${TEST_FILE})).`)[0], /has no test named/);
    assert.match(problemsIn('Nothing is logged ([nothing reaches the log](../server/test/gone.test.mjs)).')[0], /isn't there/);
    assert.match(problemsIn('Nothing is logged ([nothing reaches the log](../server/server.js)).')[0], /links no test/);
});

test('what isn\'t a claim needs no test: what is logged or stored, and what the operator should do', () => {
    for (const markdown of [
        'At `DEBUG`, an upload\'s start is logged, with its size.',
        '| Data | Stored? | Why |\n|---|---|---|\n| **Size** | Yes | Counting storage. |',
        '- Set `LOG_LEVEL` to the minimum necessary.',
    ]) {
        assert.deepEqual(problemsIn(markdown), [], markdown);
    }
});

// What the desktop app keeps, where and for how long, is stated in both docs:
// a section that loses one of these no longer says all it keeps.
const DESKTOP_KEEPS = {
    'docs/PRIVACY.md': {
        section: '## 🖥️ The desktop app',
        names: ['`config.json`', '**Your saved servers**', '**Allow Fallback**', '`Partial Downloads`', 'transfer window', 'manage token', 'Mark of the Web', 'tray',
            '`dropgate-bundle-'],
    },
    'docs/technical/DATA-PROCESSING.md': {
        section: '### 2.5 Dropgate Client (Electron)',
        names: ['`settingsSchema`', '**Saved servers**', '`servers`', '`defaultServer`', '**The fallback between saved servers**', '`downloadFolder`',
            '**The network adapter**', '`networkInterface`', '`networkBar`', '`externalIpCheck`', '`barShowsIpv4`', '`barShowsIpv6`', '`locationRefresh`',
            '`transfersAtOnce`', '`Partial Downloads`', '**The tray icon**', '**The Mark of the Web**', "**The app's own browser files**", 'transfer window',
            'manage token', '`dropgate-bundle-'],
    },
};

/** A doc's section: from its heading to the next heading of the same level or higher. */
function sectionOf(markdown, heading) {
    const lines = markdown.split(/\r?\n/);
    const start = lines.indexOf(heading);
    if (start === -1) return null;
    const level = heading.match(/^#+/)[0].length;
    const end = lines.findIndex((line, i) => i > start && /^#+\s/.test(line) && line.match(/^#+/)[0].length <= level);
    return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

test('the privacy docs say what the desktop app keeps: its settings and saved servers, the fallback, the partial folder, the tray, the transfer window\'s secrets, the bundle names and the Mark of the Web', () => {
    const missing = Object.entries(DESKTOP_KEEPS).flatMap(([doc, { section, names }]) => {
        const text = sectionOf(read(doc), section);
        if (text === null) return [`${doc}: no "${section}" section`];
        return names.filter((name) => !text.includes(name)).map((name) => `${doc}, "${section}": doesn't name ${name}`);
    });
    expectNone(missing, 'Say what the desktop app keeps:');
});

test('a section is read to the next heading of its level, so a name past it doesn\'t count', () => {
    const markdown = '## A\n\nkeeps `x`\n\n### A.1\n\nkeeps `y`\n\n## B\n\nkeeps `z`';
    assert.equal(sectionOf(markdown, '## A').includes('`y`'), true);
    assert.equal(sectionOf(markdown, '## A').includes('`z`'), false);
    assert.equal(sectionOf(markdown, '## C'), null);
});
