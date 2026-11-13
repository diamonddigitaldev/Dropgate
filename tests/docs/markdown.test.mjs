// The Markdown scanner the other checks rely on. If it read a heading's anchor
// differently from GitHub, or took code for a link, the checks would pass or
// fail for the wrong reasons, so these pin what it does on small examples.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from './helpers/markdown.mjs';

const anchors = (markdown) => [...parseMarkdown(markdown).anchors];
const targets = (markdown) => parseMarkdown(markdown).links.map((link) => link.target);

test('headings get the anchors GitHub gives them', () => {
    const cases = [
        ['# 🔒 Privacy and Logging', '-privacy-and-logging'],
        ['## 1) Quick sanity checks', '1-quick-sanity-checks'],
        ['### 4.8 Chunk Framing on Download', '48-chunk-framing-on-download'],
        ['# DGDTP — Dropgate Direct Transfer Protocol', 'dgdtp--dropgate-direct-transfer-protocol'],
        ['## HTTPS / Reverse Proxy Setup', 'https--reverse-proxy-setup'],
        ['## The Web UI’s Core Library', 'the-web-uis-core-library'],
        ['# @dropgate/core', 'dropgatecore'],
        ['### `onCancel` also fires', 'oncancel-also-fires'],
        ['### The `snake_case` name', 'the-snake_case-name'],
        ['## A *very* _important_ **note**', 'a-very-important-note'],
        ['## See [DGUP](./DGUP.md) first', 'see-dgup-first'],
        ['## Closing hashes ##', 'closing-hashes'],
    ];
    for (const [heading, anchor] of cases) assert.deepEqual(anchors(heading), [anchor], heading);
});

test('a repeated heading gets a number, as on GitHub', () => {
    assert.deepEqual(anchors('## Usage\n\n## Usage\n\n## Usage-1\n\n## Usage'), ['usage', 'usage-1', 'usage-1-1', 'usage-2']);
});

test('underlined headings and HTML anchors count, and headings in code don\'t', () => {
    assert.deepEqual(anchors('Title\n=====\n\nSub title\n---\n\n<a name="custom"></a>\n\n```\n# not a heading\n```'), ['title', 'sub-title', 'custom']);
    assert.deepEqual(anchors('Some text.\n\n---\n'), [], 'a line of dashes after a blank line is a rule, not a heading');
});

test('links in code aren\'t links, and links in text are', () => {
    const markdown = [
        'See [the guide](guide.md#setup), not `[this](code.md)`.',
        '```md',
        '[fenced](fenced.md)',
        '```',
        '<!-- [commented](comment.md) -->',
        '<img src="./img/logo.png" alt="logo">',
        '[ref]: ./reference.md',
        'Plain http://example.com and <https://example.org/x>.',
    ].join('\n');
    assert.deepEqual(targets(markdown), ['guide.md#setup', './img/logo.png', './reference.md', 'https://example.org/x', 'http://example.com']);
});

test('a badge inside a link gives both targets', () => {
    assert.deepEqual(targets('[![badge](img/badge.svg)](docs/page.md)'), ['img/badge.svg', 'docs/page.md']);
});

test('table cells split on pipes, but not on escaped ones', () => {
    const { tables } = parseMarkdown('| Option | Type |\n| --- | --- |\n| `server` | `string \\| ServerTarget` |\n\nAfter.');
    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0].header, ['Option', 'Type']);
    assert.deepEqual(tables[0].rows.map((row) => row.cells.map((cell) => cell.code)), [[['server'], ['string | ServerTarget']]]);
});
