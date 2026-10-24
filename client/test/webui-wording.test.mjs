// The Web UI says what the desktop app says, wherever the two say the same
// thing, and keeps the desktop app's copy rules (Will, 2026-10-23: "The Web UI
// needs to match the desktop's wording on as many things as closely as
// possible."). Read from both apps' sources without running either
// (helpers/copy.mjs): every string literal of their scripts, a template
// literal's ${…} read as X, and their pages' text and named attributes.
// - Each pair below is one thing both show, in the words both use, with the
//   file each says it in: the desktop app's own scripts and page, or the kit's
//   (its prompts, toasts and drop zone); the server's Web UI pages and scripts.
//   A change to one app's words without the other's turns its pair red.
// - Where the two can't match, the Web UI's words are its own and aren't here:
//   what only a browser does (Direct Transfer, Enter Sharing Code, the
//   browser's own downloads, StreamSaver), and the page's one button for each
//   step ("Start Upload", "Start Download", "Download All as ZIP"), where the
//   desktop app has one on each upload's card. So are a tab's title ("42% -
//   Dropgate", the number first, as a narrow tab shows it) and a link from an
//   older version, which the server can't open and the app can't download.
// - The Web UI's own words keep the house's rules, as the desktop app's do
//   (copy.test.mjs): a one-character ellipsis, a capital after a colon, Title
//   Case between bullets, and no "card".
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { copySlips, literalsIn, PLACEHOLDER, wordsInPage } from './helpers/copy.mjs';

const X = PLACEHOLDER;
const CLIENT = new URL('../src/', import.meta.url);
const SERVER = new URL('../../server/', import.meta.url);
// The kit's page script: its prompts' buttons, its toasts' close and its drop zone's.
const KIT_PAGE = path.join(path.dirname(createRequire(import.meta.url).resolve('@diamonddigitaldev/electron-kit/package.json')), 'page', 'kit.js');

/** A page's text as the browser shows it: its EJS tags gone, its entities read. */
function pageText(source) {
    const blanked = source.replace(/<%[\s\S]*?%>/g, (m) => m.replace(/[^\n]/g, ' '));
    return wordsInPage(blanked).map(({ text, line }) => ({
        text: text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        line,
    }));
}

/** The words in one file, by its kind: a script's literals, or a page's text. */
function wordsOf(file) {
    const source = readFileSync(file, 'utf8');
    return /\.(ejs|html)$/.test(file) ? pageText(source) : literalsIn(source);
}

/** The Web UI's own scripts and pages, by their path in server/: not core's build, nor StreamSaver's page, which shows nothing. */
function webSources() {
    const scripts = readdirSync(new URL('public/js/', SERVER)).filter((name) => name.endsWith('.js') && name !== 'dropgate-core.js').map((name) => `public/js/${name}`);
    const pages = ['pages', 'partials'].flatMap((dir) => readdirSync(new URL(`views/${dir}/`, SERVER))
        .filter((name) => name.endsWith('.ejs') && name !== 'mitm.ejs').map((name) => `views/${dir}/${name}`));
    return [...scripts, ...pages];
}

/** The words of a side's file, each with how many times it says them: the desktop app's (src/, or "kit") or the Web UI's (server/). */
const cache = new Map();
function realWords(side, file) {
    const key = `${side}:${file}`;
    if (!cache.has(key)) {
        const where = side === 'web' ? new URL(file, SERVER) : file === 'kit' ? KIT_PAGE : new URL(file, CLIENT);
        const counts = new Map();
        for (const { text } of wordsOf(where)) counts.set(text, (counts.get(text) ?? 0) + 1);
        cache.set(key, counts);
    }
    return cache.get(key);
}

/**
 * The things both apps show, in the words both use. `desktop` is the file in
 * client/src/ that says it ("kit" for the kit's page script), `web` the file
 * in server/ that does; `webTimes`, where the Web UI says it in more than one
 * place, how many, so one of them changing alone is caught too.
 */
const PAIRS = [
    // The drop zone.
    { what: 'the drop zone', text: 'Drag & Drop Files Here', desktop: 'renderer.js', web: 'views/pages/index.ejs' },
    { what: "the drop zone's button", text: 'Select Files', desktop: 'kit', web: 'views/pages/index.ejs' },
    { what: 'a folder dropped', text: `Skipped ${X}: Folders can't be uploaded.`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'an empty file dropped or picked', text: 'empty file', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: "a file's Remove", text: 'Remove', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: "a file's Remove, named", text: `Remove ${X}`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    // The options, and what the server allows.
    { what: 'the file lifetime field', text: 'File lifetime', desktop: 'renderer.js', web: 'views/pages/index.ejs' },
    { what: 'the download limit field', text: 'Max downloads', desktop: 'renderer.js', web: 'views/pages/index.ejs' },
    ...['Minutes', 'Hours', 'Days', 'Unlimited'].map((unit) => ({ what: `the lifetime unit ${unit}`, text: unit, desktop: 'renderer.js', web: 'views/pages/index.ejs' })),
    { what: 'Unlimited, on a server with a limit', text: 'Unlimited (not allowed by the server)', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'a lifetime within the limit', text: `Up to ${X}.`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'a server with no time limit', text: 'No time limit on this server.', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'a lifetime too long', text: `Too long: This server keeps files up to ${X}.`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'a server that allows one download', text: 'This server allows 1 download.', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'a server with no download limit', text: '0 means unlimited downloads.', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'a download limit that is no number, with no limit', text: 'Enter a whole number: 0 or more.', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'a download limit that is no number', text: `Enter a whole number from 1 to ${X}.`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'unlimited downloads, on a server with a limit', text: `This server doesn't allow unlimited downloads. It allows up to ${X}.`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'too many downloads', text: `Too many: This server allows up to ${X}.`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'a server with uploads off', text: 'File uploads are disabled on this server.', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: "a server that can't be reached", text: 'Could not connect to the server.', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    // How an upload will go.
    { what: 'an upload end-to-end encrypted', text: `End-to-end encrypted. ${X} can't read your files or their names.`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'a server without end-to-end encryption', text: `Not encrypted: ${X} doesn't support end-to-end encryption, so the server can read your files.`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'a server on plain HTTP', text: `Not encrypted: ${X} is plain HTTP, so the server can read your files.`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: "the Upload Security Warning's title", text: 'Upload Security Warning', desktop: 'renderer.js', web: 'views/pages/index.ejs' },
    { what: 'the Upload Security Warning', text: 'This server does not support end-to-end encryption. Your file will be uploaded without encryption.', desktop: 'renderer.js', web: 'views/pages/index.ejs' },
    { what: "the Upload Security Warning's detail", text: 'The server administrator may be able to access your file contents.', desktop: 'renderer.js', web: 'views/pages/index.ejs' },
    { what: "the Upload Security Warning's yes", text: 'Upload Anyway', desktop: 'renderer.js', web: 'views/pages/index.ejs' },
    { what: "a prompt's no", text: 'Cancel', desktop: 'kit', web: 'views/pages/index.ejs' },
    // An upload under way.
    { what: 'an upload starting', text: 'Starting…', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'an upload under way', text: `Uploading ${X}%${X}`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'which file of several is going', text: ` · File ${X} of ${X}`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'an upload paused', text: `Paused. Kept until ${X}.`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'Pause', text: 'Pause', desktop: 'renderer.js', web: 'views/pages/index.ejs' },
    { what: 'Resume', text: 'Resume', desktop: 'renderer.js', web: 'views/pages/index.ejs' },
    { what: 'an upload done, end-to-end encrypted', text: 'Uploaded · End-to-End Encrypted', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'an upload done, not encrypted', text: 'Uploaded · Not Encrypted', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'an upload failed', text: `Upload failed: ${X}`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'an upload that stopped with no reason', text: 'The upload stopped.', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    // Its link, and Delete.
    { what: 'Copy Link', text: 'Copy Link', desktop: 'renderer.js', web: 'views/pages/index.ejs' },
    // The result screen's Copy, and a direct transfer's.
    { what: 'a link copied', text: 'Link copied.', desktop: 'renderer.js', web: 'public/js/webui-main.js', webTimes: 2 },
    { what: "Delete's prompt", text: 'Delete This Upload?', desktop: 'renderer.js', web: 'views/pages/index.ejs' },
    { what: 'what Delete does', text: `${X} removes it at once, and its link stops working.`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: "Delete's yes", text: 'Delete', desktop: 'renderer.js', web: 'views/pages/index.ejs' },
    { what: 'a delete that failed', text: `Couldn't delete ${X}: ${X}`, desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    { what: 'a delete that failed with no reason', text: "The upload couldn't be deleted.", desktop: 'transfer.js', web: 'public/js/webui-main.js' },
    { what: 'an upload deleted', text: 'Deleted from the server. Its link no longer works.', desktop: 'renderer.js', web: 'public/js/webui-main.js' },
    // The toasts.
    { what: "a toast's close", text: 'Dismiss', desktop: 'kit', web: 'public/js/webui-main.js' },
    // Downloads.
    { what: 'an upload end-to-end encrypted, on its download page', text: 'End-to-End Encrypted', desktop: 'renderer.js', web: 'public/js/download.js' },
    { what: 'an upload not encrypted, on its download page', text: 'Not Encrypted', desktop: 'renderer.js', web: 'public/js/download.js' },
    { what: "a bundle's, on its download page", text: 'Not Encrypted', desktop: 'renderer.js', web: 'public/js/download-bundle.js' },
    { what: 'Retry, after a download failed', text: 'Retry', desktop: 'renderer.js', web: 'public/js/download.js' },
    { what: "Retry, after a bundle's ZIP failed", text: 'Retry', desktop: 'renderer.js', web: 'public/js/download-bundle.js' },
];

/**
 * Each pair one side no longer says, as a line saying which and where, with
 * `words(side, file)` giving the words of one side's file.
 */
function mismatches(pairs, words) {
    return pairs.flatMap(({ what, text, desktop, web, webTimes = 1 }) => {
        const inWeb = words('web', web).get(text) ?? 0;
        return [
            ...(words('desktop', desktop).has(text) ? [] : [`${what}: the desktop app's ${desktop === 'kit' ? 'kit (page/kit.js)' : `src/${desktop}`} doesn't say "${text}"`]),
            ...(inWeb >= webTimes ? [] : [`${what}: the Web UI's server/${web} doesn't say "${text}"${webTimes > 1 ? ` in all ${webTimes} places (${inWeb})` : ''}`]),
        ];
    });
}

test('the checks read every script and page of the Web UI\'s own, with their words: its EJS read as a browser shows it', () => {
    assert.deepEqual(webSources().sort(), ['public/js/download-bundle.js', 'public/js/download-p2p.js', 'public/js/download.js', 'public/js/not-found.js', 'public/js/page-common.js',
        'public/js/status-card.js', 'public/js/theme.js', 'public/js/tooltips.js', 'public/js/webui-main.js', 'views/pages/404.ejs', 'views/pages/download-p2p.ejs', 'views/pages/download.ejs',
        'views/pages/index.ejs', 'views/pages/older-version.ejs', 'views/partials/footer.ejs', 'views/partials/head-meta.ejs', 'views/partials/header.ejs', 'views/partials/older-version.ejs']);
    assert.deepEqual(pageText('<p class="a">Drag &amp; Drop <%# a comment %>Files Here</p><%- include(\'x\') %><b title="It&#39;s">x</b>').map(({ text }) => text),
        ['Drag & Drop Files Here', 'x', "It's"]);
    assert.ok(realWords('desktop', 'kit').has('Select Files'), "the kit's page script is read");
});

test('the Web UI says what the desktop app says, wherever the two say the same thing', () => {
    assert.deepEqual(mismatches(PAIRS, realWords), []);
});

test('a change to one app\'s words without the other\'s turns its pair red', () => {
    // As though one of the Web UI's Copy toasts said "Copied link." again, and the desktop app's Delete prompt something else.
    const planted = (side, file) => {
        const words = new Map(realWords(side, file));
        if (side === 'web' && file === 'public/js/webui-main.js') {
            words.set('Link copied.', words.get('Link copied.') - 1);
            words.set('Copied link.', 1);
        }
        if (side === 'desktop' && file === 'renderer.js') words.delete(`${X} removes it at once, and its link stops working.`);
        return words;
    };
    const already = new Set(mismatches(PAIRS, realWords));
    assert.deepEqual(mismatches(PAIRS, planted).filter((line) => !already.has(line)), [
        "a link copied: the Web UI's server/public/js/webui-main.js doesn't say \"Link copied.\" in all 2 places (1)",
        `what Delete does: the desktop app's src/renderer.js doesn't say "${X} removes it at once, and its link stops working."`,
    ]);
});

test('the Web UI\'s own words keep the house\'s copy rules: one-character ellipsis, a capital after a colon, Title Case between bullets, no "card"', () => {
    const slips = webSources().flatMap((file) => wordsOf(new URL(file, SERVER))
        // Markup and styles in a script (an icon's <span>, a style="…", a media query) are code, not copy.
        .filter(({ text }) => !/[<>]|[a-z-]+:\s*[^;]+;|^\([a-z-]+: [a-z-]+\)$/.test(text))
        .flatMap(({ text, line }) => copySlips(text).map((reason) => `server/${file}:${line}: ${reason} in ${text}`)));
    assert.deepEqual(slips, []);
});
