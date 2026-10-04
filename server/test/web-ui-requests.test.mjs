// The web UI's own requests. Dropgate uses no cookies, so every fetch() the
// pages make omits credentials, as core's do: none can be sent, and the browser
// never waits on its cookie store before a request goes out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const SERVER = path.resolve(import.meta.dirname, '..');
// Core's build is checked by core's own tests.
const CORE_BUILD = path.join(SERVER, 'public', 'js', 'dropgate-core.js');

function filesIn(dir, extensions) {
    return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter((entry) => entry.isFile() && extensions.includes(path.extname(entry.name)))
        .map((entry) => path.join(entry.parentPath, entry.name))
        .filter((file) => file !== CORE_BUILD);
}

/** Each fetch( call in some source, with the text of its arguments. */
function fetchCalls(source) {
    const calls = [];
    for (const match of source.matchAll(/\bfetch\(/g)) {
        let depth = 1;
        let i = match.index + match[0].length;
        while (i < source.length && depth > 0) {
            if (source[i] === '(') depth++;
            if (source[i] === ')') depth--;
            i++;
        }
        calls.push({ line: source.slice(0, match.index).split('\n').length, args: source.slice(match.index + match[0].length, i - 1) });
    }
    return calls;
}

test("every fetch() in the web UI's pages and scripts omits credentials", () => {
    const files = [...filesIn(path.join(SERVER, 'public', 'js'), ['.js']), ...filesIn(path.join(SERVER, 'views'), ['.ejs'])];
    const calls = files.flatMap((file) => fetchCalls(fs.readFileSync(file, 'utf8'))
        .map((call) => ({ ...call, where: `${path.relative(SERVER, file).split(path.sep).join('/')}:${call.line}` })));

    assert.ok(calls.length >= 3, `expected to find the web UI's fetch() calls, found ${calls.length}`);
    assert.deepEqual(calls.filter((call) => !/credentials:\s*'omit'/.test(call.args)).map((call) => call.where), [],
        "fetch() calls that don't pass credentials: 'omit'");
});
