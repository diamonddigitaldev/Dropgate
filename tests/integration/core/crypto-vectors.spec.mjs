// Core's crypto in each browser engine: CPace's known answers
// (draft-irtf-cfrg-cpace-21's Appendix A.1, A.3, B.1 and B.1.10), the CPace
// exchange a typed code runs (the same code, a wrong one, each low-order share
// and each confirmation that doesn't match, ending both sides), cacophony's
// Noise_NNpsk0_25519_AESGCM_SHA256 vector (the handshake, its hash and four
// transport messages, and a flipped bit refused in each kind of message), and
// the standards' answers for the crypto provider's X25519, SHA-512, HMAC, HKDF
// and AES-GCM with associated data, byte for byte as core's tests have them in
// Node: on the provider core chooses in that engine (WebCrypto, where it can
// make an X25519 key; @noble, in JavaScript, where it can't, as in Playwright's
// WebKit on Windows), and on @noble in every engine. Where WebCrypto is chosen,
// the engine's own WebCrypto must also refuse CPace's low-order points itself,
// as Node's does. Each test records the provider chosen as an annotation.
//
// The checks are core's own test code (packages/dropgate-core/tests/browser/
// vectors-entry.ts and the helpers it imports), bundled here with core's
// esbuild as a test build (core's scripts/test-build-define.mjs: Noise's
// vector pins its ephemeral keys, which core's own builds refuse), so core's
// dependencies need installing first. They run on a page
// served from 127.0.0.1, which browsers treat as a secure context, by a
// server of this file's own: the Dropgate server plays no part.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { testBuildDefine } from '../../../packages/dropgate-core/scripts/test-build-define.mjs';

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
        define: testBuildDefine(true),
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

/** The checks of the engine's own WebCrypto refusing CPace's low-order points. */
const engineRefusals = (cpace) => cpace.filter(({ name }) => /^B\.1\.10 the engine's WebCrypto refuses u[0-7]$/.test(name));

/**
 * The provider core should choose in this engine: WebCrypto where it can make
 * an X25519 key (Chromium, Firefox, and WebKit on macOS, iOS and CI's Linux),
 * else @noble (Playwright's WebKit on Windows). Recorded on the test.
 */
async function expectedProvider(page, browserName) {
    const hasX25519 = await page.evaluate(() => window.webCryptoHasX25519());
    // Only WebKit may lack it: Chromium's and Firefox's WebCrypto have X25519.
    if (browserName !== 'webkit') expect(hasX25519, 'X25519 in WebCrypto').toBe('yes');
    const name = hasX25519 === 'yes' ? 'webcrypto' : 'noble';
    test.info().annotations.push({
        type: 'crypto provider',
        description: `${browserName}: ${name}${hasX25519 === 'yes' ? '' : ` (no X25519 in WebCrypto: ${hasX25519})`}`,
    });
    return name;
}

test("CPace's generator, transcripts and session-ID output, SHA-512, HMAC, HKDF and AES-GCM with associated data, on the provider core chooses", async ({ page, context, browserName }) => {
    const nothingElsewhere = await open(page, context);
    const expected = await expectedProvider(page, browserName);
    const { name, cpace, exchange, provider } = await page.evaluate(() => window.runCryptoVectors({ x25519: false, provider: 'chosen' }));
    expect(name, 'the provider core chose').toBe(expected);
    expect(wrong([...cpace, ...provider]), 'checks whose value differs from the known answer').toEqual([]);
    expect(exchange, 'no exchange without X25519').toEqual([]);
    expect(cpace.length, "CPace's checks").toBe(31);
    expect(provider.length, "the provider's checks").toBe(8);
    nothingElsewhere();
});

test("X25519, CPace's shares, K and ISK, B.1.10's points, the CPace exchange and cacophony's Noise vector, on the provider core chooses, WebCrypto refusing the low-order ones itself where it's chosen", async ({ page, context, browserName }) => {
    const nothingElsewhere = await open(page, context);
    const expected = await expectedProvider(page, browserName);
    const { name, cpace, exchange, provider, noise } = await page.evaluate(() => window.runCryptoVectors({ x25519: true, provider: 'chosen' }));
    expect(name, 'the provider core chose').toBe(expected);
    expect(wrong([...cpace, ...exchange, ...provider, ...noise]), 'checks whose value differs from the known answer').toEqual([]);
    // With WebCrypto, 7 more: the engine's own refusal of each low-order point.
    expect(cpace.length, "CPace's checks").toBe(name === 'webcrypto' ? 65 : 58);
    expect(exchange.length, "the CPace exchange's checks").toBe(18);
    expect(provider.length, "the provider's checks").toBe(14);
    expect(engineRefusals(cpace)).toHaveLength(name === 'webcrypto' ? 7 : 0);
    expect(noise.length, "Noise's checks").toBe(18);
    nothingElsewhere();
});

test('every check on @noble, in this engine', async ({ page, context }) => {
    const nothingElsewhere = await open(page, context);
    const { name, cpace, exchange, provider, noise } = await page.evaluate(() => window.runCryptoVectors({ x25519: true, provider: 'noble' }));
    expect(name).toBe('noble');
    expect(wrong([...cpace, ...exchange, ...provider, ...noise]), 'checks whose value differs from the known answer').toEqual([]);
    expect(cpace.length, "CPace's checks").toBe(58);
    expect(exchange.length, "the CPace exchange's checks").toBe(18);
    expect(provider.length, "the provider's checks").toBe(14);
    expect(noise.length, "Noise's checks").toBe(18);
    nothingElsewhere();
});
