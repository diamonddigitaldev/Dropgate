// Reads Markdown the way GitHub renders it, as far as the checks need: which
// text is code, where the links and headings are, which anchors the headings
// get, and what's in the tables. It isn't a full CommonMark parser. It handles
// what the repo's docs use, and markdown.test.mjs pins the parts the checks
// rely on.

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:[ \t]*(<[^>]*>|\S+)/;

/**
 * Splits a line (with no fenced code in it) into inline code spans and the
 * text between them, in order. A run of backticks opens a span that the next
 * run of the same length closes; an unmatched run is literal text, and so is
 * an escaped backtick.
 * @returns {{ code: boolean, text: string }[]}
 */
function segments(line) {
    const out = [];
    let prose = '';
    let i = 0;
    while (i < line.length) {
        if (line[i] === '\\' && i + 1 < line.length) {
            prose += line.slice(i, i + 2);
            i += 2;
            continue;
        }
        if (line[i] !== '`') {
            prose += line[i++];
            continue;
        }
        const run = /^`+/.exec(line.slice(i))[0];
        const rest = line.slice(i + run.length);
        const close = new RegExp(String.raw`(?<!\`)${run}(?!\`)`).exec(rest);
        if (!close) {
            prose += run;
            i += run.length;
            continue;
        }
        let content = rest.slice(0, close.index);
        if (/^ .*[^ ].* $/s.test(content)) content = content.slice(1, -1);
        out.push({ code: false, text: prose }, { code: true, text: content });
        prose = '';
        i += run.length + close.index + run.length;
    }
    out.push({ code: false, text: prose });
    return out;
}

/**
 * Splits a line (with no fenced code in it) into its inline code spans and the
 * text outside them.
 * @returns {{ prose: string, code: string[] }}
 */
export function splitCode(line) {
    const parts = segments(line);
    return {
        prose: parts.filter((part) => !part.code).map((part) => part.text).join(''),
        code: parts.filter((part) => part.code).map((part) => part.text),
    };
}

/**
 * The anchor GitHub gives a heading's text, before duplicates are numbered:
 * github-slugger's rule, applied to the text the heading renders as.
 */
export function headingSlug(heading) {
    return renderedText(heading).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
}

/**
 * The text a heading renders as. Code spans keep their text as it is, so each
 * stands in as a placeholder while the Markdown around it is removed.
 */
function renderedText(heading) {
    const code = [];
    const withPlaceholders = segments(heading)
        .map((part) => (part.code ? `\u0001${code.push(part.text) - 1}\u0001` : part.text))
        .join('');
    return stripInline(withPlaceholders).replace(/\u0001(\d+)\u0001/g, (_, i) => code[i]).trim();
}

/** Markdown and HTML outside code spans, reduced to the text it shows. */
function stripInline(s) {
    return s
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images show no text
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links show their text
        .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1') // reference links too
        .replace(/<[^>]+>/g, '') // HTML tags
        .replace(/(^|[^\p{L}\p{N}])_{1,3}(?=\S)(.+?)(?<=\S)_{1,3}(?=[^\p{L}\p{N}]|$)/gu, '$1$2') // _emphasis_
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/\\([!-/:-@[-`{-~])/g, '$1'); // backslash escapes
}

/**
 * Numbers repeated anchors as GitHub does: the second `usage` is `usage-1`,
 * and so on, skipping any that are already taken.
 */
export function slugger() {
    const occurrences = new Map();
    return (heading) => {
        const original = headingSlug(heading);
        let slug = original;
        while (occurrences.has(slug)) {
            occurrences.set(original, occurrences.get(original) + 1);
            slug = `${original}-${occurrences.get(original)}`;
        }
        occurrences.set(slug, 0);
        return slug;
    };
}

/** Splits a table row into cells. `\|` is a pipe inside a cell. */
function splitRow(raw) {
    let row = raw.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
    return row.split(/(?<!\\)\|/).map((cell) => {
        const text = cell.trim().replace(/\\\|/g, '|');
        return { text, ...splitCode(text) };
    });
}

/** A link's destination, read from just after its `](`. */
function destinationAt(s, start) {
    let i = start;
    while (s[i] === ' ' || s[i] === '\t') i++;
    if (s[i] === '<') {
        const end = s.indexOf('>', i);
        return end === -1 ? null : s.slice(i + 1, end);
    }
    let depth = 0;
    let out = '';
    for (; i < s.length; i++) {
        const ch = s[i];
        if (ch === '\\' && i + 1 < s.length) {
            out += s[++i];
            continue;
        }
        if (/\s/.test(ch)) break;
        if (ch === '(') depth++;
        if (ch === ')' && depth-- === 0) break;
        out += ch;
    }
    return out;
}

/**
 * Parses one Markdown file.
 *
 * Each line has its `number` (from 1), `raw` text, whether it's `fenced` (in a
 * fenced code block, fences included), whether it's `inTable`, its `prose` (the
 * text outside code spans and HTML comments, empty when fenced) and its inline
 * `code` spans. `links` are every link, image, HTML `href` or `src`, reference
 * definition and bare URL outside code. `anchors` are the headings' anchors and
 * any HTML `id` or `name`. `tables` have a `header` of cell texts and `rows` of
 * cells, each with its `text`, `prose` and `code`.
 */
export function parseMarkdown(markdown) {
    const lines = [];
    let fence = null;
    let inComment = false;
    for (const [index, raw] of markdown.split(/\r?\n/).entries()) {
        const line = { number: index + 1, raw, fenced: false, inTable: false, prose: '', code: [] };
        lines.push(line);
        if (fence) {
            line.fenced = true;
            const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(raw);
            if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
            continue;
        }
        const open = FENCE_OPEN.exec(raw);
        if (open) {
            line.fenced = true;
            fence = open[1];
            continue;
        }
        let text = raw;
        let visible = '';
        while (text) {
            if (inComment) {
                const end = text.indexOf('-->');
                if (end === -1) { text = ''; break; }
                text = text.slice(end + 3);
                inComment = false;
            } else {
                const start = text.indexOf('<!--');
                if (start === -1) { visible += text; break; }
                visible += text.slice(0, start);
                text = text.slice(start + 4);
                inComment = true;
            }
        }
        Object.assign(line, splitCode(visible));
    }

    const tables = [];
    for (let i = 0; i + 1 < lines.length; i++) {
        const head = lines[i];
        const delimiter = lines[i + 1];
        if (head.fenced || delimiter.fenced || !head.prose.includes('|') || !TABLE_DELIMITER.test(delimiter.raw)) continue;
        const header = splitRow(head.raw);
        if (header.length !== splitRow(delimiter.raw).length) continue;
        const table = { line: head.number, header: header.map((cell) => renderedText(cell.text)), rows: [] };
        head.inTable = delimiter.inTable = true;
        let j = i + 2;
        for (; j < lines.length && !lines[j].fenced && lines[j].raw.trim() && lines[j].raw.includes('|'); j++) {
            lines[j].inTable = true;
            table.rows.push({ line: lines[j].number, cells: splitRow(lines[j].raw) });
        }
        tables.push(table);
        i = j - 1;
    }

    const anchors = new Set();
    const slug = slugger();
    for (const [i, line] of lines.entries()) {
        if (line.fenced || line.inTable) continue;
        const atx = ATX_HEADING.exec(line.raw);
        if (atx) {
            anchors.add(slug(atx[2] ?? ''));
        } else if (SETEXT_UNDERLINE.test(line.raw) && i > 0 && isParagraph(lines[i - 1])) {
            const paragraph = [];
            for (let j = i - 1; j >= 0 && isParagraph(lines[j]); j--) paragraph.unshift(lines[j].raw.trim());
            anchors.add(slug(paragraph.join('\n')));
        }
        for (const match of line.prose.matchAll(/<[a-z][^>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
            anchors.add(match[1] ?? match[2]);
        }
    }

    const links = [];
    for (const line of lines) {
        if (line.fenced) continue;
        const { prose } = line;
        const found = [];
        const definition = REFERENCE_DEFINITION.exec(prose);
        if (definition) found.push(definition[1].replace(/^<|>$/g, ''));
        for (let at = prose.indexOf(']('); at !== -1; at = prose.indexOf('](', at + 2)) {
            const target = destinationAt(prose, at + 2);
            if (target !== null) found.push(target);
        }
        for (const match of prose.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) found.push(match[1] ?? match[2]);
        for (const match of prose.matchAll(/<([a-z][a-z0-9+.-]*:[^<>\s]*)>/gi)) found.push(match[1]);
        for (const match of prose.matchAll(/(?<![("'<=\w/])(?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,:;!?*_~'")\]]/gi)) found.push(match[0]);
        for (const target of found) links.push({ line: line.number, target });
    }

    return { lines, anchors, links, tables };
}

function isParagraph(line) {
    const { raw } = line;
    return !line.fenced && !line.inTable && raw.trim() !== '' && !ATX_HEADING.test(raw) && !SETEXT_UNDERLINE.test(raw)
        && !LIST_ITEM.test(raw) && !/^ {0,3}(?:>|<|\|)/.test(raw) && !/^ {4}/.test(raw);
}
