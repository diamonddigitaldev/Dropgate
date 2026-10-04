// What the docs name: environment variables, endpoints, HTTP statuses and
// other UPPER_SNAKE_CASE names, each with where it's named. The README in this
// folder says how to write each one so these find it.
import { STATUS_CODES } from 'node:http';
import { parseMarkdown } from './markdown.mjs';
import { markdownFiles, read } from './repo.mjs';

/** Every Markdown file in the repository, parsed. */
export const docs = markdownFiles.map((file) => ({ file, ...parseMarkdown(read(file)) }));

const NAME = String.raw`[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+`;
const WHOLE_NAME = new RegExp(`^${NAME}$`);
const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';
const PATH = String.raw`\/[\w\-./:<>{}*~%]*`;

const where = (doc, line) => `${doc.file}:${line}`;
const trimPath = (p) => p.replace(/[.,:]+$/, '');

/** Drops repeats: the same name named twice on one line counts once. */
const unique = (found) => [...new Map(found.map((item) => [JSON.stringify(item), item])).values()];

/** The first column's header text of a table, lower-cased. */
const firstHeader = (table) => (table.header[0] ?? '').toLowerCase();

/**
 * Environment variables the docs name as such:
 * - in a table whose first column is headed "Variable";
 * - set with `NAME=value`, including `-e NAME=value` and `$env:NAME=value`,
 *   anywhere, code blocks included;
 * - called an environment variable: "the `NAME` environment variable".
 * @returns {{ name: string, at: string }[]}
 */
export function envMentions() {
    const found = [];
    for (const doc of docs) {
        for (const table of doc.tables.filter((t) => firstHeader(t) === 'variable')) {
            for (const row of table.rows) {
                for (const code of row.cells[0]?.code ?? []) {
                    if (WHOLE_NAME.test(code)) found.push({ name: code, at: where(doc, row.line) });
                }
            }
        }
        for (const line of doc.lines) {
            for (const match of line.raw.matchAll(new RegExp(String.raw`(?:^|[^\w$])(?:\$env:)?(${NAME})=`, 'g'))) {
                found.push({ name: match[1], at: where(doc, line.number) });
            }
            if (line.fenced) continue;
            for (const match of line.raw.matchAll(new RegExp(String.raw`\`(${NAME})\`\s+environment variable|environment variable\s+\`(${NAME})\``, 'gi'))) {
                found.push({ name: match[1] ?? match[2], at: where(doc, line.number) });
            }
        }
    }
    return unique(found);
}

/**
 * The error codes the docs list: names in inline code in a table column headed
 * "Code" (or `code`), such as core's error classes in docs/core/errors.md.
 * @returns {{ name: string, at: string }[]}
 */
export function errorCodeTableEntries() {
    const found = [];
    for (const doc of docs) {
        for (const table of doc.tables) {
            const column = table.header.findIndex((heading) => heading.toLowerCase() === 'code');
            if (column === -1) continue;
            for (const row of table.rows) {
                for (const code of row.cells[column]?.code ?? []) {
                    if (WHOLE_NAME.test(code)) found.push({ name: code, at: where(doc, row.line) });
                }
            }
        }
    }
    return found;
}

/** The environment variables that have a row in a "Variable" table. */
export function envTableNames() {
    const names = new Set();
    for (const doc of docs) {
        for (const table of doc.tables.filter((t) => firstHeader(t) === 'variable')) {
            for (const row of table.rows) for (const code of row.cells[0]?.code ?? []) names.add(code);
        }
    }
    return names;
}

/**
 * Every UPPER_SNAKE_CASE name the docs write in inline code, tables included:
 * environment variables, constants and error codes alike. Code blocks aren't
 * read for these, because their placeholders (`"code": "OPTIONAL_CODE"`) aren't
 * names.
 * @returns {{ name: string, at: string }[]}
 */
export function codeFormattedNames() {
    const found = [];
    for (const doc of docs) {
        for (const line of doc.lines.filter((l) => !l.fenced)) {
            for (const code of line.code) {
                for (const [name] of code.matchAll(new RegExp(String.raw`\b${NAME}\b`, 'g'))) found.push({ name, at: where(doc, line.number) });
            }
        }
    }
    return found;
}

// Absolute paths in inline code that are folders on the server's disk, not
// endpoints: its uploads folder and the Docker image's app folder.
const FILESYSTEM_PATHS = new Set(['uploads', 'usr']);

/**
 * Endpoints the docs name:
 * - a method and a path, `POST /upload/init`, anywhere, code blocks included;
 * - a path on its own in inline code, `/api/info` or `/p2p/<code>`, unless it
 *   starts with a folder in FILESYSTEM_PATHS;
 * - a URL on the server itself, `https://<host>/b/<bundleId>`, anywhere.
 *   `localhost` and `127.0.0.1` count as the server too.
 * Placeholders can be `<name>`, `:name` or `{name}`.
 * @returns {{ method?: string, path: string, at: string }[]}
 */
export function endpointMentions() {
    const found = [];
    for (const doc of docs) {
        for (const line of doc.lines) {
            const at = where(doc, line.number);
            for (const match of line.raw.matchAll(new RegExp(String.raw`\b(${METHODS})\s+(${PATH})`, 'g'))) {
                found.push({ method: match[1], path: trimPath(match[2]), at });
            }
            for (const match of line.raw.matchAll(/\bhttps?:\/\/(?:<host>|localhost|127\.0\.0\.1)(?::\d+)?(\/[\w\-./:<>{}*~%]*)?/g)) {
                found.push({ path: trimPath(match[1] ?? '/'), at });
            }
            for (const code of line.code) {
                const bare = new RegExp(`^${PATH}`).exec(code);
                if (!bare) continue;
                const first = bare[0].split('/').filter(Boolean)[0];
                if (!FILESYSTEM_PATHS.has(first)) found.push({ path: trimPath(bare[0]), at });
            }
        }
    }
    return found;
}

// Any three-digit number from 100 to 599 is a status where the docs say it is
// one; where they might not, it has to be a status Node knows.
const inRange = (n) => Number(n) >= 100 && Number(n) <= 599;
const isKnownStatus = (n) => Object.hasOwn(STATUS_CODES, n);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The HTTP statuses in the docs' status tables: tables whose first column is
 * headed "Status", "Code" or "Status code", and whose first cell is a number.
 * @returns {{ status: number, at: string }[]}
 */
export function statusTableEntries() {
    const found = [];
    for (const doc of docs) {
        for (const table of doc.tables.filter((t) => ['status', 'code', 'status code'].includes(firstHeader(t)))) {
            for (const row of table.rows) {
                const cell = /^`?(\d{3})`?$/.exec(row.cells[0]?.text ?? '');
                if (cell && inRange(cell[1])) found.push({ status: Number(cell[1]), at: where(doc, row.line) });
            }
        }
    }
    return found;
}

/**
 * Every HTTP status the docs name: the status tables, plus a number written
 * `HTTP 420` or "responds `200`" (any number from 100 to 599), or `(507)`,
 * `/ 413` or with its reason, `200 OK` (a status Node knows). Code blocks are
 * read for `200 OK`, for sequence diagrams. Numbers in other tables, such as a
 * default of `100`, aren't statuses.
 * @returns {{ status: number, at: string }[]}
 */
export function statusMentions() {
    const found = [...statusTableEntries()];
    const withReason = new RegExp(String.raw`\b(\d{3}) (${Object.values(STATUS_CODES).map(escape).join('|')})\b`, 'g');
    const said = [/\bHTTP\s+`?(\d{3})\b/g, /\bresponds?\s+(?:with\s+)?(?:HTTP\s+)?`?(\d{3})\b/gi];
    const maybe = [/\(\s*`?(\d{3})`?\s*\)/g, /(?:^|\s)\/\s+`?(\d{3})\b/g];
    for (const doc of docs) {
        for (const line of doc.lines) {
            const at = where(doc, line.number);
            const add = (status) => found.push({ status: Number(status), at });
            for (const match of line.raw.matchAll(withReason)) {
                if (STATUS_CODES[match[1]] === match[2]) add(match[1]);
            }
            if (line.fenced || line.inTable) continue;
            for (const pattern of said) for (const match of line.raw.matchAll(pattern)) if (inRange(match[1])) add(match[1]);
            for (const pattern of maybe) for (const match of line.raw.matchAll(pattern)) if (isKnownStatus(match[1])) add(match[1]);
        }
    }
    return unique(found);
}

/** Every link in the docs, with the file it's in. */
export function links() {
    return docs.flatMap((doc) => doc.links.map((link) => ({ ...link, file: doc.file, at: where(doc, link.line) })));
}

/** The anchors of a Markdown file, by its path. */
export function anchorsOf(file) {
    return docs.find((doc) => doc.file === file)?.anchors;
}
