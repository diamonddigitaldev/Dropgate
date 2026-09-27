// What every web UI flow must leave behind in the browser, and must keep from
// the server.
//
// Each test keeps a note of the file names and keys its flows handle (the web
// UI helpers add to it), and once the test is over the fixtures check that:
// - the server's origin holds no cookies, localStorage, sessionStorage,
//   IndexedDB or Cache Storage, and at most one service worker registration
//   (the one the download pages use to stream files to disk);
// - no request that reached the server had a file name or a key in its URL,
//   headers or body, and no WebSocket message did either. The one exception is
//   a file uploaded without encryption: the server stores its name, so the
//   upload's own requests may carry it in their bodies.
import { expect } from '@playwright/test';

/** The file names and keys a test's flows have handled, and the WebSocket messages its pages sent. */
export class Secrets {
    /** Names the server must never be sent. */
    names = new Set();
    /** Names of files uploaded without encryption, which the server stores. */
    storedNames = new Set();
    /** Keys from links, as they appear after the #, by the link's path. */
    keys = new Map();
    /** Every WebSocket message a page sent, as { url, payload }. */
    messagesSent = [];

    /**
     * @param {{ name: string }[]} files
     * @param {{ storedByServer?: boolean }} [opts] - Whether the server keeps the names:
     *   true for a hosted upload without encryption.
     */
    addFiles(files, { storedByServer = false } = {}) {
        for (const { name } of files) (storedByServer ? this.storedNames : this.names).add(name);
    }

    /** Note the key in a share link's fragment, if it has one. */
    addLink(link) {
        const url = new URL(link);
        if (url.hash.length > 1) this.keys.set(url.pathname, url.hash.slice(1));
    }
}

const secretsByContext = new WeakMap();

/** Make a browser context's pages note what they handle in `secrets`. */
export function keepSecretsFor(context, secrets) {
    secretsByContext.set(context, secrets);
}

/**
 * The notes for the test a page belongs to.
 * @param {import('@playwright/test').Page} page
 * @returns {Secrets}
 */
export function secretsOf(page) {
    const secrets = secretsByContext.get(page.context());
    if (!secrets) throw new Error("This page's browser context doesn't come from the test fixtures.");
    return secrets;
}

/** The ways some text can be written into a URL, a header or a body. */
function spellings(text) {
    const uri = encodeURIComponent(text);
    return [
        text,
        uri,
        // As StreamSaver writes a file name into its download URLs (RFC 5987).
        uri.replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
        // A form body.
        uri.replace(/%20/g, '+'),
        // JSON with everything outside ASCII escaped.
        JSON.stringify(text).slice(1, -1).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`),
    ];
}

/** Everything to look for, as { what, forms }, each form a Buffer. */
function lookFor(secrets, { storedNames }) {
    const wanted = [];
    const names = storedNames ? [...secrets.names, ...secrets.storedNames] : secrets.names;
    for (const name of names) {
        wanted.push({ what: `the file name "${name}"`, forms: spellings(name).map((s) => Buffer.from(s)) });
    }
    for (const [path, key] of secrets.keys) {
        const raw = Buffer.from(key, 'base64');
        wanted.push({
            what: `the key from the link to ${path}`,
            forms: [...spellings(key), raw.toString('base64url'), raw.toString('hex')].map((s) => Buffer.from(s)).concat([raw]),
        });
    }
    return wanted;
}

/** Text as it is, and URL-decoded where that works. */
function withDecoded(text) {
    const decoded = [text];
    for (const t of [text, text.replace(/\+/g, ' ')]) {
        try {
            decoded.push(decodeURIComponent(t));
        } catch {
            // Not valid percent-encoding, so there's nothing to decode.
        }
    }
    return decoded.map((t) => Buffer.from(t));
}

const found = (haystacks, { forms }) => haystacks.some((h) => forms.some((f) => h.includes(f)));

/**
 * Every file name and key that reached the server in a request, or went out in
 * a WebSocket message a page sent, each described with where it was found. The
 * name of a file uploaded without encryption only counts outside the body of an
 * upload request, which is where the server is meant to get it.
 * @param {{ requests: () => { method: string, url: string, headers: object, body: Buffer }[] }} server
 * @param {Secrets} secrets
 * @returns {string[]}
 */
export function secretsSent(server, secrets) {
    const all = lookFor(secrets, { storedNames: true });
    const allButStoredNames = lookFor(secrets, { storedNames: false });
    const leaks = [];

    for (const { method, url, headers, body } of server.requests()) {
        const request = `${method} ${new URL(url, 'http://server').pathname}`;
        const inUrl = withDecoded(url);
        const inHeaders = Object.values(headers).flat().flatMap((v) => withDecoded(String(v)));
        const isUpload = method === 'POST' && url.startsWith('/upload/');
        for (const secret of all) {
            if (found(inUrl, secret)) leaks.push(`${secret.what}, in the URL of ${request}`);
            if (found(inHeaders, secret)) leaks.push(`${secret.what}, in a header of ${request}`);
        }
        for (const secret of isUpload ? allButStoredNames : all) {
            if (found([body], secret)) leaks.push(`${secret.what}, in the body of ${request}`);
        }
    }

    for (const { url, payload } of secrets.messagesSent) {
        // Playwright gives a text message as a string, but Firefox's has one character per UTF-8 byte.
        const message = typeof payload === 'string' ? [Buffer.from(payload), Buffer.from(payload, 'latin1')] : [payload];
        for (const secret of all) {
            if (found(message, secret)) leaks.push(`${secret.what}, in a WebSocket message to ${new URL(url).pathname}`);
        }
    }

    return leaks;
}

/**
 * Check that no file name or key reached the server (see secretsSent()).
 * @param {{ requests: () => { method: string, url: string, headers: object, body: Buffer }[] }} server
 * @param {Secrets} secrets
 */
export function expectNoSecretsSent(server, secrets) {
    expect(secretsSent(server, secrets), 'file names and keys the server was sent').toEqual([]);
}

/**
 * Check what a browser context keeps for the server's origin: no cookies,
 * localStorage, sessionStorage, IndexedDB or Cache Storage, and at most one
 * service worker registration.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} origin
 * @param {string} which - Which context this is, for the failure message.
 */
export async function expectNothingStored(context, origin, which) {
    let pages = context.pages().filter((p) => p.url().startsWith(`${origin}/`));
    if (pages.length === 0) {
        // Nothing of this origin is open any more, so open something that is.
        const page = await context.newPage();
        await page.goto(`${origin}/`);
        pages = [page];
    }

    // sessionStorage belongs to each tab, so every page is asked. The rest is shared by the origin.
    const perPage = await Promise.all(pages.map((p) => p.evaluate(() => ({
        localStorage: Object.keys(localStorage),
        sessionStorage: Object.keys(sessionStorage),
    }))));
    const shared = await pages[0].evaluate(async () => ({
        indexedDB: (await indexedDB.databases()).map((db) => db.name),
        cacheStorage: await caches.keys(),
        serviceWorkers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope) : [],
    }));

    const stored = {
        cookies: (await context.cookies()).map((c) => `${c.name} for ${c.domain}`),
        localStorage: [...new Set(perPage.flatMap((p) => p.localStorage))],
        sessionStorage: [...new Set(perPage.flatMap((p) => p.sessionStorage))],
        indexedDB: shared.indexedDB,
        cacheStorage: shared.cacheStorage,
    };
    expect(stored, `what ${which} keeps for the server's origin`).toEqual({
        cookies: [], localStorage: [], sessionStorage: [], indexedDB: [], cacheStorage: [],
    });
    expect(shared.serviceWorkers.length, `service workers ${which} has registered: ${shared.serviceWorkers.join(', ')}`).toBeLessThanOrEqual(1);
}
