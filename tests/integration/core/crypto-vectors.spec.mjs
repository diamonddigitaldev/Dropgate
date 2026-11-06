// Core's crypto in each browser engine: CPace's known answers
// (draft-irtf-cfrg-cpace-21's Appendix A.1, A.3, B.1 and B.1.10) and the
// standards' answers for the crypto provider's X25519, SHA-512, HMAC, HKDF and
// AES-GCM with associated data, on core's own WebCrypto provider, byte for
// byte as core's tests have them in Node. Each engine's WebCrypto must also
// refuse CPace's low-order points itself, as Node's does.
//
// The checks are core's own test code (packages/dropgate-core/tests/browser/
// vectors-entry.ts and the helpers it imports), bundled here with core's
// esbuild, so core's dependencies need installing first. They run on a page
// served from 127.0.0.1, which browsers treat as a secure context, by a
// server of this file's own: the Dropgate server plays no part.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const CORE = new URL('../../../packages/dropgate-core/', import.meta.url);
const ENTRY = fileURLToPath(new URL('tests/browser/vectors-entry.ts', CORE));

/** Core's test entry as one script for a page. */
async function bundle() {
    const esbuild = createRequire(new URL('package.json', CORE))('esbuild');
    const { outputFiles } = await esbuild.build({
        entryPoints: [ENTRY],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        write: false,
        logLevel: 'silent',
    });
    return outputFiles[0].text;
}

let server;
let origin;

test.beforeAll(async () => {
    const script = await bundle();
    const page = '<!doctype html><meta charset="utf-8"><title>Crypto vectors</title><script src="/vectors.js"></script>';
    server = createServer((req, res) => {
        const body = req.url === '/' ? page : req.url === '/vectors.js' ? script : null;
        if (body === null) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'Content-Type': req.url === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' }).end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
});

/** The page, open on this test's own server, its requests watched. */
async function open(page, context) {
    const elsewhere = [];
    context.on('request', (request) => {
        if (new URL(request.url()).origin !== origin) elsewhere.push(request.url());
    });
    await page.goto(origin);
    expect(await page.evaluate(() => window.isSecureContext), 'a secure context').toBe(true);
    return () => expect(elsewhere, "requests that weren't to this test's own server").toEqual([]);
}

/** Each check whose value isn't the known answer, so a failure names them all. */
const wrong = (checks) => checks.filter(({ expected, actual }) => actual !== expected);

test("CPace's generator, transcripts and session-ID output, SHA-512, HMAC, HKDF and AES-GCM with associated data", async ({ page, context }) => {
    const nothingElsewhere = await open(page, context);
    const { cpace, provider } = await page.evaluate(() => window.runCryptoVectors({ x25519: false }));
    expect(wrong([...cpace, ...provider]), 'checks whose value differs from the known answer').toEqual([]);
    expect(cpace.length, "CPace's checks").toBe(31);
    expect(provider.length, "the provider's checks").toBe(8);
    nothingElsewhere();
});

test("X25519, CPace's shares, K and ISK, and B.1.10's points, with WebCrypto refusing the low-order ones itself", async ({ page, context, browserName }) => {
    const nothingElsewhere = await open(page, context);
    // Chromium and Firefox have X25519 in WebCrypto. WebKit has it on macOS
    // and iOS; Playwright's WebKit on Windows doesn't, and there core takes its
    // JavaScript provider instead, whose own run of these comes with it.
    const hasX25519 = await page.evaluate(() => window.webCryptoHasX25519());
    test.skip(browserName === 'webkit' && hasX25519 !== 'yes', `This WebKit's WebCrypto has no X25519 (${hasX25519}).`);
    expect(hasX25519, 'X25519 in WebCrypto').toBe('yes');

    const { cpace, provider } = await page.evaluate(() => window.runCryptoVectors({ x25519: true }));
    expect(wrong([...cpace, ...provider]), 'checks whose value differs from the known answer').toEqual([]);
    expect(cpace.length, "CPace's checks").toBe(65);
    expect(provider.length, "the provider's checks").toBe(14);
    expect(cpace.filter(({ name }) => /^B\.1\.10 the engine's WebCrypto refuses u[0-7]$/.test(name))).toHaveLength(7);
    nothingElsewhere();
});
