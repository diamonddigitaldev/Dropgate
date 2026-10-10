// Reads the client's source for the static checks. Nothing here loads
// Electron: the tests only read the code.
import { readFileSync } from 'node:fs';

const SRC = new URL('../../src/', import.meta.url);

/** A file in client/src, with comments removed. */
export function readSource(name) {
    return stripComments(readFileSync(new URL(name, SRC), 'utf8'));
}

/**
 * Drops comments, so prose about require() or a commented-out option isn't
 * read as code. The `[^:]` keeps the `//` in a URL.
 */
export function stripComments(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * The string literal passed first to each call matching `callee`, a regex
 * source such as String.raw`ipcMain\.handle`.
 */
export function channelsCalled(code, callee) {
    const pattern = new RegExp(String.raw`${callee}\(\s*(['"\`])([^'"\`]+)\1`, 'g');
    return [...code.matchAll(pattern)].map((match) => match[2]);
}

/** How many calls match `callee`, whatever their arguments. */
export function countCalls(code, callee) {
    return [...code.matchAll(new RegExp(String.raw`${callee}\(`, 'g'))].length;
}

/**
 * The object literal passed to each `new <name>(`, as source text. Returns
 * null for a call whose argument isn't an object literal, so the caller can
 * fail rather than skip it.
 */
export function constructorOptions(code, name) {
    const results = [];
    for (const match of code.matchAll(new RegExp(String.raw`new\s+${name}\(\s*`, 'g'))) {
        const start = match.index + match[0].length;
        results.push(code[start] === '{' ? balancedBlock(code, start) : null);
    }
    return results;
}

/** The `{...}` block starting at `start`, skipping braces inside strings. */
export function balancedBlock(code, start) {
    let depth = 0;
    let quote = null;
    for (let i = start; i < code.length; i++) {
        const ch = code[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
        } else if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}' && --depth === 0) {
            return code.slice(start, i + 1);
        }
    }
    throw new Error(`Unbalanced braces from offset ${start}.`);
}
