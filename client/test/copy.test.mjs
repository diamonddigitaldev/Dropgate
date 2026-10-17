// The house's copy rules, on every word the client can show (helpers/copy.mjs:
// its scripts' string literals and its pages' text), read without running it:
// - an ellipsis is one character, "…", never "...";
// - "card" is the client's own word, never the person's: no copy says it;
// - after a colon, the next word starts with a capital;
// - items between bullets (" · ", or the tray's " • ") are in Title Case,
//   short words after an item's first left small, unless an item is a sentence;
// - a file's name or a server's address is never recased: nothing the page
//   shows goes through CSS or code that changes its case, but core's reason;
// - a button that says it's doing something ("Deleting…") is the kit's busy
//   button, never a label of the page's own.
// The desktop tests check the same on the screens a run shows
// (tests/integration/desktop/copy-and-controls.spec.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { clientSources, copySlips, literalsIn, PLACEHOLDER, untitled, wordsInPage } from './helpers/copy.mjs';
import { readSource } from './helpers/source.mjs';

const { scripts, pages } = clientSources();
const everything = [...scripts, ...pages].flatMap(({ name, words }) => words.map((word) => ({ ...word, where: `${name}:${word.line}` })));

/** Every word the client can show that breaks a rule, as "where: reason in text". */
const slipsOf = (rule) => everything.flatMap(({ where, text }) => copySlips(text).filter((reason) => rule.test(reason)).map((reason) => `${where}: ${reason} in ${text}`));

test('the checks read every script and page of the client\'s own, with their words and none of their comments', () => {
    assert.deepEqual(scripts.map(({ name }) => name).sort(), ['constants.js', 'core/file-service.js', 'core/handles.js', 'core/notices.js', 'core/payloads.js', 'core/share.js',
        'core/transfers.js', 'file-service.js', 'main.js', 'menu.js', 'preload.js', 'renderer.js', 'settings-guard.js', 'transfer-host.js', 'transfer-preload.js', 'transfer.js', 'tray.js', 'window-channels.js']);
    assert.deepEqual(pages.map(({ name }) => name).sort(), ['index.html', 'transfer.html']);
    const texts = new Set(everything.map(({ text }) => text));
    for (const known of ['Delete This Upload?', 'Deleted from the server. Its link no longer works.', "Outside This Server's Limits", 'Uploaded · End-to-End Encrypted', 'Add Files',
        `${PLACEHOLDER} removes it at once, and its link stops working.`]) {
        assert.ok(texts.has(known), known);
    }
    // What the reader leaves out, and how it reads a template literal.
    assert.deepEqual(literalsIn("// 'commented out'\n/* \"nor this\" */ const a = /'not a string'/.test(b) ? `x ${c ? 'y' : `z ${d}`} w` : 1 / 2 / 3;").map(({ text }) => text),
        ['y', `z ${PLACEHOLDER}`, `x ${PLACEHOLDER} w`]);
    assert.deepEqual(wordsInPage('<p title="A Title">Some <b>text</b></p><script>const s = "no";</script><!-- nor this -->').map(({ text }) => text), ['Some', 'text', 'A Title']);
});

test('an ellipsis is one character', () => {
    assert.deepEqual(slipsOf(/ellipsis/), []);
    assert.deepEqual(copySlips('Deleting...'), ['a three-dot ellipsis']);
});

test('no copy says "card": the person sees uploads, never the client\'s own word for them', () => {
    assert.deepEqual(slipsOf(/"card"/), []);
    assert.deepEqual(copySlips('Remove this card.'), ['the word "card"']);
    assert.deepEqual(copySlips('kit-card-name .upload-card upload_card'), [], 'a class or a selector is code');
});

test('after a colon, the next word starts with a capital', () => {
    assert.deepEqual(slipsOf(/colon/), []);
    assert.deepEqual(copySlips('Failed: the server closed the connection.'), ['a small letter after a colon']);
    assert.deepEqual(copySlips('Server: v4.0.0, Client: v4.0.0.'), [], 'a version is a number');
    assert.deepEqual(copySlips('Couldn\'t delete report.pdf: The server is busy.', { names: ['report.pdf'] }), []);
});

test('items between bullets are in Title Case, unless an item is a sentence', () => {
    assert.deepEqual(slipsOf(/Title Case/), []);
    assert.deepEqual(copySlips('30 KB · report.pdf and 1 More', { names: ['report.pdf'] }), [], 'a name is never recased');
    // The rule, on its own.
    assert.deepEqual(untitled('Uploaded · End-to-End Encrypted'), []);
    assert.deepEqual(untitled(`3 Days · 10 Downloads · ${PLACEHOLDER} and 37 More`), []);
    assert.deepEqual(untitled('Uploading 81% · File 32 of 38 · Kept until 14:32.'), []);
    assert.deepEqual(untitled('Uploaded · end-to-end encrypted'), ['end-to-end encrypted']);
    assert.deepEqual(untitled('1 paused · 2 Ready'), ['1 paused']);
    assert.deepEqual(untitled('Online · Dropgate 4.0.0 · End-to-end Encrypted'), ['End-to-end Encrypted']);
});

test('a file\'s name or a server\'s address is never recased: nothing the page shows changes case, but the first letter of core\'s reason', () => {
    const page = readSource('index.html');
    const css = readSource('styles.css');
    const renderer = readSource('renderer.js');
    assert.doesNotMatch(css, /text-transform/, 'styles.css recases text');
    assert.doesNotMatch(page + renderer, /\btext-(uppercase|lowercase|capitalize)\b/, 'a Bootstrap class recases text');
    const recasing = [...renderer.matchAll(/\.(to(Locale)?(Upper|Lower)Case)\(/g)];
    assert.equal(recasing.length, 1, 'the page recases text');
    assert.match(renderer, /const sentence = \(text\) => \(text \? text\[0\]\.toUpperCase\(\) \+ text\.slice\(1\) : text\);/,
        'the one is the capital after a colon in core\'s reason, which never names a file');
    assert.match(renderer, /`Failed: \$\{sentence\(view\.message/);
});

test('a button that says it\'s doing something is the kit\'s busy button: disabled, with its spinner', () => {
    const renderer = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
    const labels = [...renderer.matchAll(/kit\.ui\.busy\(\w+, ([^)]+)\)/g)].map(([, label]) => label);
    assert.deepEqual(labels, ["pause ? 'Pausing…' : 'Resuming…'", "'Deleting…'", "'Testing…'"]);
    // Never a label the page writes itself: a button's text is the kit's, or its own label.
    assert.doesNotMatch(renderer, /(Btn|Button|button)\.textContent = ['`][^'`]*ing…/);
    assert.doesNotMatch(readSource('index.html'), /<button[^>]*>[^<]*ing…/);
});
