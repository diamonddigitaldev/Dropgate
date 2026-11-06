// What the code has, read from its source: the environment variables it
// reads, the server's routes and HTTP statuses, the error codes it gives, and
// every UPPER_SNAKE_CASE name in it. Nothing is run. Comments are removed
// first, so a name that's only in a comment doesn't count.
import path from 'node:path';
import { files, read } from './repo.mjs';

// Core's build, as the web UI and the client carry it. Core's source is read
// instead, so a name isn't counted twice or found only in a stale copy.
const BUILT_COPIES = new Set(['server/public/js/dropgate-core.js', 'client/src/dropgate-core.js']);

const SCRIPT = /\.(?:[cm]?js|ts)$/;
const CODE = /\.(?:[cm]?js|ts|ejs|html|json|ya?ml|sh|nsh)$|(?:^|\/)Dockerfile$/;

/** Every source, build and CI file, but not the docs, lockfiles, or these checks. */
export const codeFiles = files.filter((file) => CODE.test(file)
    && !BUILT_COPIES.has(file)
    && !file.endsWith('package-lock.json')
    && !file.startsWith('tests/docs/'));

// The code that runs for the people who use Dropgate, as opposed to its tests,
// build scripts and CI. Its environment variables and error codes are what the
// docs have to cover.
const inServer = (file) => /^server\/[^/]+\.[cm]?js$/.test(file);
const inClient = (file) => file.startsWith('client/src/') && SCRIPT.test(file);
const inCore = (file) => file.startsWith('packages/dropgate-core/src/') && SCRIPT.test(file);

export const serverFiles = codeFiles.filter(inServer);
export const productFiles = codeFiles.filter((file) => inServer(file) || inClient(file) || inCore(file));

/**
 * Removes comments from JavaScript or TypeScript, leaving strings, template
 * literals and regular expressions alone.
 */
export function stripScriptComments(code) {
    let out = '';
    let i = 0;
    // The last character that wasn't whitespace or a comment, to tell a regex
    // literal from a division.
    let last = '';
    while (i < code.length) {
        const ch = code[i];
        const next = code[i + 1];
        if (ch === '/' && next === '/') {
            while (i < code.length && code[i] !== '\n') i++;
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = code.indexOf('*/', i + 2);
            const comment = code.slice(i, end === -1 ? code.length : end + 2);
            out += comment.replace(/[^\n]/g, '');
            i += comment.length;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`' || (ch === '/' && (last === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(last)))) {
            const start = i++;
            let inClass = false;
            while (i < code.length) {
                const c = code[i];
                if (c === '\\') { i += 2; continue; }
                if (ch === '/') {
                    if (c === '[') inClass = true;
                    else if (c === ']') inClass = false;
                    else if (c === '/' && !inClass) break;
                    else if (c === '\n') break;
                } else if (c === ch || (ch !== '`' && c === '\n')) {
                    break;
                }
                i++;
            }
            i++;
            out += code.slice(start, i);
            last = ch;
            continue;
        }
        out += ch;
        if (!/\s/.test(ch)) last = ch;
        i++;
    }
    return out;
}

/** A file's text with its comments removed, as far as its kind has them. */
export function readCode(file) {
    const text = read(file);
    if (SCRIPT.test(file)) return stripScriptComments(text);
    if (/\.(?:ejs|html)$/.test(file)) return text.replace(/<!--[\s\S]*?-->/g, '').replace(/<%#[\s\S]*?%>/g, '');
    if (/\.json$/.test(file)) return text;
    if (/\.nsh$/.test(file)) return text.replace(/(^|\s)[#;].*$/gm, '$1');
    return text.replace(/(^|\s)#.*$/gm, '$1');
}

const UPPER_SNAKE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** Every UPPER_SNAKE_CASE name anywhere in the code, strings included. */
export function namesInCode() {
    const names = new Set();
    for (const file of codeFiles) {
        for (const [name] of readCode(file).matchAll(UPPER_SNAKE)) names.add(name);
    }
    return names;
}

/**
 * The environment variables each file reads, as `name → [file, ...]`: any
 * `process.env.NAME`, `process.env['NAME']` or `const { NAME } = process.env`.
 */
export function envReads(fileList) {
    const reads = new Map();
    const add = (name, file) => reads.set(name, [...new Set([...(reads.get(name) ?? []), file])]);
    for (const file of fileList.filter((f) => SCRIPT.test(f))) {
        const code = readCode(file);
        for (const match of code.matchAll(/\bprocess\.env\.([A-Za-z_$][\w$]*)/g)) add(match[1], file);
        for (const match of code.matchAll(/\bprocess\.env\[\s*(['"`])([^'"`]+)\1\s*\]/g)) add(match[2], file);
        for (const match of code.matchAll(/\{([^{}]*)\}\s*=\s*process\.env\b/g)) {
            for (const key of match[1].split(',')) {
                const name = key.split(/[:=]/)[0].trim();
                if (name && !name.startsWith('...')) add(name, file);
            }
        }
    }
    return reads;
}

/**
 * The error codes the code gives its errors: a string code set with `code:`,
 * `code =` or `code: something || 'CODE'`, and every code in core's catalogue
 * (an entry `NAME: { origin: ..., retryable: ..., message: ... }`), which can
 * hold a code nothing gives yet. A comparison such as `err.code === 'ABORT_ERR'`
 * is a code it reads, not one it gives.
 */
export function errorCodes(fileList) {
    const codes = new Map();
    const add = (name, file) => codes.set(name, [...new Set([...(codes.get(name) ?? []), file])]);
    for (const file of fileList.filter((f) => SCRIPT.test(f))) {
        const code = readCode(file);
        const pattern = /\bcode\??\s*(?::|=(?!=))\s*(?:[\w$.?]+\s*\|\|\s*)?(['"`])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\1/g;
        for (const match of code.matchAll(pattern)) add(match[2], file);
        const catalogue = /^\s*([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*:\s*\{\s*origin\s*:[^\n]*\bmessage\s*:/gm;
        for (const match of code.matchAll(catalogue)) add(match[1], file);
    }
    return codes;
}

/** The HTTP statuses the server sends, as `status → [file, ...]`. */
export function statusesSent() {
    const statuses = new Map();
    for (const file of serverFiles) {
        for (const match of readCode(file).matchAll(/\.(?:status|sendStatus|writeHead)\(\s*(\d{3})\b/g)) {
            const status = Number(match[1]);
            statuses.set(status, [...new Set([...(statuses.get(status) ?? []), file])]);
        }
    }
    return statuses;
}

/**
 * The server's routes. Each is `{ method, path, file }`, with `method` 'ALL'
 * for anything mounted with `app.use()`, which answers every method at that
 * path and under it (`mounted: true`). Files served by `express.static()` are
 * routes too (`file: true`), one per file.
 *
 * It reads Express's own calls: `express.Router()` objects, the paths they're
 * mounted at with `app.use()`, and `app.get()` and the like on either, with the
 * path as a string or a constant holding one.
 */
export function serverRoutes() {
    const routes = [];
    for (const file of serverFiles) {
        const code = readCode(file);
        const constants = new Map();
        for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`$]*)\2/g)) {
            constants.set(match[1], match[3]);
        }
        const pathOf = (literal, name) => (literal !== undefined ? literal : constants.get(name));

        const routers = new Map([['app', '']]);
        for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:express\.)?Router\(/g)) {
            routers.set(match[1], null);
        }
        for (const match of code.matchAll(/\bapp\.use\(\s*(?:(['"`])([^'"`$]*)\1|([A-Za-z_$][\w$]*))\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
            const at = pathOf(match[2], match[3]);
            if (at === undefined) continue;
            if (routers.has(match[4])) routers.set(match[4], at);
            else routes.push({ method: 'ALL', path: at, file, mounted: true });
        }
        for (const [name, at] of routers) {
            if (at === null) throw new Error(`${file}: the router ${name} is never mounted with app.use(), so the docs checks can't tell its paths.`);
            const calls = new RegExp(String.raw`\b${name.replace(/\$/g, '\\$')}\.(get|post|put|patch|delete|head|options|all)\(\s*(?:(['"\`])([^'"\`$]*)\2|([A-Za-z_$][\w$]*))`, 'g');
            for (const match of code.matchAll(calls)) {
                const route = pathOf(match[3], match[4]);
                if (route === undefined) continue;
                routes.push({ method: match[1].toUpperCase(), path: joinPath(at, route), file });
            }
        }
        for (const match of code.matchAll(/express\.static\(\s*path\.join\(\s*__dirname\s*,\s*(['"`])([^'"`]+)\1\s*\)\s*\)/g)) {
            const dir = path.posix.join(path.posix.dirname(file), match[2]);
            for (const served of files.filter((f) => f.startsWith(`${dir}/`))) {
                routes.push({ method: 'GET', path: `/${served.slice(dir.length + 1)}`, file, static: true });
            }
        }
    }
    return routes;
}

function joinPath(prefix, route) {
    const joined = `${prefix}/${route}`.replace(/\/+/g, '/');
    return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

/**
 * A path's segments, with any placeholder (`:id`, `<id>`, `{id}` or `*`)
 * written as `*`. `/` has none.
 */
export function pathSegments(p) {
    return p.split(/[?#]/)[0].split('/').filter(Boolean)
        .map((segment) => (/^(?::.+|<[^>]+>|\{[^}]+\}|\*)$/.test(segment) ? '*' : segment));
}

/**
 * Whether a path the docs name is this route. Placeholders only match
 * placeholders, so `/<fileId>` is `/:fileId`, but `/status` isn't. A mounted
 * route also covers every path under it. With `folders`, a path ending in `/`
 * (other than `/` itself) names every route under it, as in "the files under
 * `/vendor/`".
 */
export function routeMatches(route, docPath, docMethod, { folders = false } = {}) {
    if (docMethod && route.method !== 'ALL' && route.method !== docMethod && !(docMethod === 'HEAD' && route.method === 'GET')) return false;
    const want = pathSegments(route.path);
    const got = pathSegments(docPath);
    if (folders && docPath.length > 1 && docPath.split(/[?#]/)[0].endsWith('/')) {
        return got.length <= want.length && got.every((segment, i) => segment === want[i]);
    }
    if (route.mounted ? got.length < want.length : got.length !== want.length) return false;
    return want.every((segment, i) => segment === got[i]);
}
