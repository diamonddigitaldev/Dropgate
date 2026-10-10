// The desktop app, launched the way a person would launch it, with a throwaway
// profile, against the test's own local server.
//
// Each launch runs the client in client/ with its own Electron build, through
// Playwright's _electron:
// - with --user-data-dir set to a temporary profile, so it never reads or writes
//   yours. (Moving APPDATA doesn't move it.);
// - without ELECTRON_RUN_AS_NODE, which some shells set, and which makes Electron
//   run as plain Node;
// - with desktop-preload.cjs loaded first, to write down its notifications,
//   clipboard writes and windows. Off CI it only writes them down, so your
//   clipboard is left alone (see there).
//
// A browser context watches the app's own requests too, and the test fails if
// any goes anywhere but the test's server. The app checks for updates only when
// it's packaged, so running it from source sends nothing to GitHub.
//
// Every launch also gets --no-proxy-server. Without it, the app looks for a
// proxy by itself when the system says to, as Windows does by default
// ("Automatically detect settings"): it asks the network for a WPAD proxy script
// over DHCP and DNS. After a test passes, each launch's net log must show it
// never looked, and never looked up any name beyond this machine. The app's
// spell checker is pointed at this machine for its dictionaries too.
//
// When a desktop test doesn't go as expected, its failure says what the test saw
// (Desktop.report()): what the TLS proxy saw, what reached the server, the app's
// requests that failed or never finished, what each run's network stack did (its
// net log, netlog.mjs), and what each run of the app wrote down.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { expect, passed, test as base } from './test.mjs';
import { describeNetLog, outsideLookups, proxyLookups, proxySettings, requestedUrls } from './netlog.mjs';
import { startTlsProxy } from './tls.mjs';

export { expect };

// No trailing separator: on Windows, a backslash before the closing quote of an argument escapes it.
const CLIENT_DIR = fileURLToPath(new URL('../../../client', import.meta.url));
const PRELOAD = fileURLToPath(new URL('./desktop-preload.cjs', import.meta.url));

/** The client's own Electron build. The electron package downloads it the first time it's asked for. */
const electronPath = () => createRequire(path.join(CLIENT_DIR, 'package.json'))('electron');

/** Don't look for a proxy: connect directly (see the top of this file). */
const NO_PROXY = '--no-proxy-server';

/**
 * Where the app's spell checker is told to download its dictionaries from, unless
 * a test says otherwise: a port on this machine that nothing answers. On Linux
 * the app would otherwise download them from Google's servers as it starts (see
 * desktop-preload.cjs, and desktop/dictionaries.spec.mjs).
 */
const NO_DICTIONARIES = 'http://127.0.0.1:9/';

/** Whether the app may use the real clipboard and show notifications: in CI, or when asked to. */
export const realClipboard = () => Boolean(process.env.CI) || process.env.DROPGATE_TEST_REAL_CLIPBOARD === '1';

const appEnv = (extra = {}) => {
    const env = { ...process.env, ...extra };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
};

/** Wait for a child process to exit, and return its exit code. */
async function exitOf(child, timeout, what) {
    if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        const timedOut = sleep(timeout).then(() => { throw new Error(`${what} didn't exit within ${timeout / 1000} s.`); });
        await Promise.race([exited, timedOut]);
    }
    return child.exitCode;
}

/** Whether a request is to a server, rather than for one of the app's own files. */
const toServer = (url) => /^(https?|wss?):$/.test(new URL(url).protocol);

/** One run of the app. */
export class DesktopApp {
    /**
     * The app's requests to servers that haven't finished or failed yet, with when each began.
     * @type {Map<import('@playwright/test').Request, number>}
     */
    unfinished = new Map();
    /**
     * The app's requests to servers that failed: when each began and failed, and why.
     * @type {{ request: import('@playwright/test').Request, began: number, at: number, error: string }[]}
     */
    failed = [];

    /**
     * @param {import('@playwright/test').ElectronApplication} app
     * @param {string} eventsFile
     * @param {string} netLog - Where this run's network stack writes its net log (netlog.mjs).
     */
    constructor(app, eventsFile, netLog) {
        this.app = app;
        this.eventsFile = eventsFile;
        this.netLog = netLog;
        const context = app.context();
        context.on('request', (request) => {
            if (toServer(request.url())) this.unfinished.set(request, Date.now());
        });
        context.on('requestfinished', (request) => this.unfinished.delete(request));
        context.on('requestfailed', (request) => {
            if (!this.unfinished.has(request)) return;
            this.failed.push({ request, began: this.unfinished.get(request), at: Date.now(), error: request.failure()?.errorText ?? 'no reason given' });
            this.unfinished.delete(request);
        });
    }

    /**
     * The first window the app opens (its main window, or the one a background
     * upload runs in), once it has finished setting itself up (window:ready). Until
     * then it may still be filling in its saved settings over what a test types,
     * and its buttons may do nothing.
     */
    async window() {
        const window = await this.app.firstWindow();
        const id = await (await this.app.browserWindow(window)).evaluate((win) => win.id);
        await expect.poll(() => this.eventsOf('window-ready').some((e) => e.id === id),
            { message: 'whether the window has finished setting itself up', timeout: 15_000 }).toBe(true);
        return window;
    }

    /**
     * The transfer window's page: hidden, in a session of its own, where the
     * app's server checks and uploads run, so it's where their requests are
     * held (route()) and their clock moved (clock). The app starts it the
     * first time it has work for it, such as Test.
     */
    async transferWindow() {
        const isTransfer = (page) => page.url().endsWith('/transfer.html');
        await expect.poll(() => this.app.windows().some(isTransfer),
            { message: 'whether the transfer window has opened', timeout: 15_000 }).toBe(true);
        return this.app.windows().find(isTransfer);
    }

    /**
     * Everything the preload wrote down for this run, in order.
     * @returns {{ at: number, event: string, [key: string]: any }[]}
     */
    events() {
        if (!fs.existsSync(this.eventsFile)) return [];
        return fs.readFileSync(this.eventsFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    }

    /** Only the events of one kind. */
    eventsOf(kind) {
        return this.events().filter((e) => e.event === kind);
    }

    /** Whether the app is still running. */
    get running() {
        const child = this.app.process();
        return child.exitCode === null && child.signalCode === null;
    }

    /** Wait for the app to quit by itself, and return its exit code. The wait ends well inside a test's time, so a hang gets its report. */
    exited(timeout = 30_000) {
        return exitOf(this.app.process(), timeout, 'The desktop app');
    }

    /** Quit, as Exit in the app's menu does. */
    async quit() {
        if (this.running) await this.app.close();
    }
}

/** The desktop app for one test: its profile, its files, and every run of it. */
class Desktop {
    /** @type {DesktopApp[]} */
    runs = [];
    /** @type {string[]} */
    elsewhere = [];
    /**
     * Every launch's net log, with what to call it. A launch that hands its
     * arguments to the app already running (launchAgain()) quits before its
     * network stack starts, so its log is empty.
     * @type {{ label: string, file: string, handsOn: boolean }[]}
     */
    netLogs = [];
    /** Where the app's spell checker downloads its dictionaries from, for the next launch. */
    dictionaryUrl = NO_DICTIONARIES;

    /**
     * @param {object} opts
     * @param {number} opts.started - When the test started, in ms since 1970: the report's times are from here.
     * @param {string} opts.root - A temporary folder for the profile, the files and the events.
     * @param {{ baseUrl: string, requests: () => any[] }} opts.server
     * @param {{ url: string, describe: (since: number) => string } | null} opts.proxy - The TLS proxy in front of the server, if there is one.
     * @param {import('./privacy.mjs').Secrets} opts.secrets
     * @param {boolean} opts.real - Whether the clipboard and notifications are real.
     */
    constructor({ started, root, server, proxy, secrets, real }) {
        this.started = started;
        this.root = root;
        this.server = server;
        this.proxy = proxy;
        this.secrets = secrets;
        this.real = real;
        this.profile = path.join(root, 'profile');
        this.folder = path.join(root, 'Secret Folder');
        fs.mkdirSync(this.folder);
    }

    /** The address the app is given for the server: the TLS proxy's when there is one. */
    get serverUrl() {
        return this.proxy?.url ?? this.server.baseUrl;
    }

    /**
     * Write a file for the app to share, and return its full path.
     * @param {{ name: string, buffer: Buffer }} file
     */
    addFile({ name, buffer }) {
        const file = path.join(this.folder, name);
        fs.writeFileSync(file, buffer);
        return file;
    }

    /**
     * Launch the app with these arguments after the app's own folder.
     * @param {...string} args
     */
    async launch(...args) {
        const eventsFile = path.join(this.root, `events-${this.runs.length + 1}.jsonl`);
        const netLog = path.join(this.root, `netlog-${this.runs.length + 1}.json`);
        this.netLogs.push({ label: `run ${this.runs.length + 1}`, file: netLog, handsOn: false });
        const app = await electron.launch({
            executablePath: electronPath(),
            args: ['-r', PRELOAD, `--user-data-dir=${this.profile}`, NO_PROXY, `--log-net-log=${netLog}`, CLIENT_DIR, ...args],
            env: appEnv({
                DROPGATE_TEST_EVENTS: eventsFile,
                DROPGATE_TEST_REAL_CLIPBOARD: this.real ? '1' : '0',
                DROPGATE_TEST_DICTIONARY_URL: this.dictionaryUrl,
            }),
            // The TLS proxy's certificate is made up for the test, so the app is told to accept it.
            ignoreHTTPSErrors: Boolean(this.proxy),
        });
        const allowed = new Set([new URL(this.server.baseUrl).origin, ...(this.proxy ? [this.proxy.url] : [])]);
        app.context().on('request', (request) => {
            if (toServer(request.url()) && !allowed.has(new URL(request.url()).origin)) this.elsewhere.push(request.url());
        });
        const run = new DesktopApp(app, eventsFile, netLog);
        this.runs.push(run);
        return run;
    }

    /**
     * "Share with Dropgate": launch the app as Windows does from a file's context
     * menu, with the file's path and --upload.
     * @param {string} file
     */
    share(file) {
        return this.launch(file, '--upload');
    }

    /**
     * Launch the app again while it's already running, with nothing watching
     * it, as Windows does for "Share with Dropgate" when the app is open. That
     * second process hands its arguments to the one running and quits. Resolves
     * with its exit code.
     * @param {...string} args
     */
    async launchAgain(...args) {
        // Playwright turns Chromium's sandbox off on Linux, where it needs setting up as root.
        const noSandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];
        const count = this.netLogs.filter((log) => log.handsOn).length + 1;
        const netLog = path.join(this.root, `netlog-again-${count}.json`);
        this.netLogs.push({ label: `second launch ${count}`, file: netLog, handsOn: true });
        const child = spawn(electronPath(), [...noSandbox, `--user-data-dir=${this.profile}`, NO_PROXY, `--log-net-log=${netLog}`, CLIENT_DIR, ...args], {
            env: appEnv(),
            stdio: 'ignore',
        });
        try {
            return await exitOf(child, 30_000, 'The second launch of the desktop app');
        } catch (err) {
            child.kill();
            throw err;
        }
    }

    /**
     * Point the app at the test's server, in Settings > Server, and set its
     * options on Upload, as a person would.
     * @param {import('@playwright/test').Page} window
     * @param {object} [opts]
     * @param {{ value: number, unit: 'minutes' | 'hours' | 'days' }} [opts.lifetime]
     * @param {number} [opts.maxDownloads]
     */
    async setUp(window, { lifetime, maxDownloads } = {}) {
        await window.getByRole('button', { name: 'Settings', exact: true }).click();
        await window.getByRole('tab', { name: 'Server' }).click();
        await window.locator('#server-url').fill(this.serverUrl);
        await window.locator('#test-connection-btn').click();
        await expect(window.locator('#connection-status')).toHaveText(/connection successful/i);
        await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();
        await expect(window.locator('#security-status')).toBeVisible();
        if (lifetime) {
            await window.locator('#file-lifetime-unit').selectOption(lifetime.unit);
            await window.locator('#file-lifetime-value').fill(String(lifetime.value));
        }
        if (maxDownloads !== undefined) {
            await window.locator('#max-downloads-value').fill(String(maxDownloads));
        }
        await saved(window);
    }

    /**
     * Upload files from Upload with the action bar's Upload button, and return
     * the link the window shows. Each file is written to the test's folder and
     * picked from there, as a person picks one: the window hands main each
     * file's path, and never reads a file itself.
     * @param {import('@playwright/test').Page} window
     * @param {{ name: string, mimeType: string, buffer: Buffer }[]} files
     * @param {{ encrypted: boolean }} opts - Whether the window should say the upload will be
     *   end-to-end encrypted. When it won't be, the window asks first (the Upload Security Warning), and
     *   this answers "Upload Anyway".
     */
    async upload(window, files, { encrypted }) {
        this.secrets.addFiles(files, { storedByServer: !encrypted });
        await expect(window.locator('#security-text')).toHaveText(encrypted ? /will be end-to-end encrypted/i : /will not be encrypted/i);
        await window.locator('#file-input').setInputFiles(files.map((file) => this.addFile(file)));
        await uploadButton(window).click();
        if (!encrypted) await securityWarning(window).getByRole('button', { name: 'Upload Anyway' }).click();
        await expect(uploadStatus(window)).toHaveText(/upload successful/i, { timeout: 30_000 });
        const link = await window.locator('#download-link').inputValue();
        this.secrets.addLink(link);
        return link;
    }

    /**
     * Where a browser opens one of the app's links. A link through the TLS proxy
     * is opened from the server's own address instead, as the other tests' pages
     * are, with the browser playing the proxy's part (see playwright.config.mjs).
     * @param {string} link
     */
    receivingUrl(link) {
        const url = new URL(link);
        return `${this.server.baseUrl}${url.pathname}${url.search}${url.hash}`;
    }

    async close() {
        for (const run of this.runs) await run.quit().catch(() => {});
    }

    /** The app's requests that failed or never finished, as Playwright saw them, for report(). */
    appRequests() {
        const ms = (at) => `+${Math.round(at - this.started)} ms`;
        const lines = [];
        for (const [i, run] of this.runs.entries()) {
            for (const { request, began, at, error } of run.failed) {
                lines.push({ began, text: `${request.method()} ${request.url()} (run ${i + 1}): failed at ${ms(at)}, after ${at - began} ms (${error})${phases(request, ms)}` });
            }
            for (const [request, began] of run.unfinished) {
                lines.push({ began, text: `${request.method()} ${request.url()} (run ${i + 1}): neither finished nor failed` });
            }
        }
        lines.sort((a, b) => a.began - b.began);
        return lines.map(({ began, text }) => `  ${ms(began)}  ${text}`).join('\n') || '  none';
    }

    /**
     * What a run's network stack did, from its net log, for the test's addresses.
     * @param {DesktopApp} run
     */
    netLogOf(run) {
        const origins = [new URL(this.server.baseUrl).origin, ...(this.proxy ? [this.proxy.url] : [])];
        return describeNetLog(run.netLog, this.started, origins);
    }

    /**
     * What the test saw, for the message of a test that didn't go as expected,
     * with times in ms from the test's start: what the TLS proxy saw, what reached
     * the server and what it answered, the app's requests that failed or never
     * finished, what each run's network stack did, what each run of the app wrote
     * down, and the end of its debug.log. Methods, URLs, statuses, sizes and times
     * only: never a header or a body.
     *
     * Chromium writes its net log in batches, and finishes it when the app quits,
     * so the fixture closes the app before asking for this. Closing it ends the
     * requests still going, so what Playwright saw of them is taken first.
     * @param {string} appRequests - appRequests(), from before the app was closed.
     */
    report(appRequests) {
        const ms = (at) => `+${Math.round(at - this.started)} ms`;
        const section = (heading, describe) => {
            let body;
            try {
                body = describe();
            } catch (err) {
                body = `  (couldn't look: ${err.message.split('\n')[0]})`;
            }
            return `${heading}\n${body}`;
        };
        const sections = ['What the desktop test saw, in ms from its start.'];

        if (this.proxy) {
            sections.push(section(`What the TLS proxy at ${this.proxy.url} saw:`, () => this.proxy.describe(this.started)));
        }

        sections.push(section('What reached the server:', () => this.server.requests().map(({ at, method, url, headers, body, answer }) => {
            const from = /\bElectron\//.test(headers['user-agent'] ?? '') ? 'the app' : 'the browser';
            const size = body.length ? `, ${body.length} bytes of body` : '';
            let what;
            if (headers.upgrade) what = `a ${headers.upgrade} upgrade`;
            else if (!answer) what = 'no answer yet';
            else if (answer.finished) what = `answered ${answer.status} at ${ms(answer.at)}`;
            else if (answer.status) what = `the connection closed at ${ms(answer.at)}, before its ${answer.status} answer was sent in full`;
            else what = `the connection closed at ${ms(answer.at)}, before the server answered`;
            return `  ${ms(at)}  ${method} ${url} from ${from}${size}: ${what}`;
        }).join('\n') || '  nothing'));

        sections.push(`The app's requests that failed or never finished:\n${appRequests}`);

        for (const [i, run] of this.runs.entries()) {
            sections.push(section(`What run ${i + 1}'s network stack did (its net log):`, () => this.netLogOf(run)));
        }

        for (const [i, run] of this.runs.entries()) {
            sections.push(section(`What run ${i + 1} of the app wrote down:`, () => run.events()
                .map(({ at, event, ...rest }) => `  ${ms(at)}  ${event} ${JSON.stringify(rest)}`).join('\n') || '  nothing'));
        }

        sections.push(section("The end of the app's debug.log:", () => {
            const log = path.join(this.profile, 'debug.log');
            if (!fs.existsSync(log)) return '  (none)';
            return fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).slice(-40).map((line) => `  ${line}`).join('\n');
        }));

        return sections.join('\n\n');
    }
}

/**
 * How far a request got, as the browser tells it, for the report. The browser
 * only gives this for a request that got some answer, so it's often nothing.
 * @param {import('@playwright/test').Request} request
 * @param {(at: number) => string} ms
 */
function phases(request, ms) {
    const { startTime, connectStart, secureConnectionStart, connectEnd, requestStart, responseStart } = request.timing();
    const at = (offset) => ms(startTime + offset);
    const steps = [];
    if (connectStart >= 0) steps.push(`began connecting at ${at(connectStart)}`);
    if (secureConnectionStart >= 0) steps.push(`began TLS at ${at(secureConnectionStart)}`);
    if (connectEnd >= 0) steps.push(`was connected by ${at(connectEnd)}`);
    if (requestStart >= 0) steps.push(`sent the request at ${at(requestStart)}`);
    if (responseStart >= 0) steps.push(`had the answer's first byte at ${at(responseStart)}`);
    return steps.length ? `; it ${steps.join(', ')}` : '';
}

/**
 * Check that no launch of the app looked for a proxy by itself, or looked up any
 * name beyond this machine, from each one's net log. They're soft, so a failure
 * still gets the report, whose net log sections show what each run found. A
 * launch that asked a server anything must have logged its proxy settings, or
 * its log can't show a lookup either. One that asked nothing (a new profile
 * with no server) may have none: on Linux, Chromium only reads them for a
 * request, and the app makes none by itself.
 * @param {Desktop} desktop
 */
function expectNoLookups(desktop) {
    for (const { label, file, handsOn } of desktop.netLogs) {
        expect.soft(proxyLookups(file), `the times ${label} of the app looked for a proxy by itself (its net log)`).toEqual([]);
        expect.soft(outsideLookups(file), `the names ${label} of the app looked up beyond this machine (its net log)`).toEqual([]);
        const askedAServer = requestedUrls(file).some((url) => /^(https?|wss?):/.test(url));
        if (!handsOn && askedAServer) expect.soft(proxySettings(file), `the proxy settings ${label} of the app found (its net log)`).not.toEqual([]);
    }
}

/**
 * Wait for the app to have saved the settings a window just changed. The window
 * saves them over IPC as they change, without waiting for an answer, and the
 * app answers IPC in the order it's sent. So once it has answered a request for
 * its settings, it has saved them.
 * @param {import('@playwright/test').Page} window
 */
export const saved = (window) => window.evaluate(() => window.kitAPI.getSettings());

/** Upload's status line: the action bar's. */
export const uploadStatus = (window) => window.locator('#action-bar .kit-action-line');

/** The action bar's Upload button (the rail's Upload is a section, not this). */
export const uploadButton = (window) => window.locator('#action-bar').getByRole('button', { name: 'Upload', exact: true });

/** The Upload Security Warning: the kit's prompt, asked before an upload that won't be encrypted. */
export const securityWarning = (window) => window.getByRole('alertdialog', { name: 'Upload Security Warning' });

/**
 * The body of every upload the server was asked to start, in order: one file
 * or several, each upload is one POST /api/v4/uploads.
 * @param {{ requests: () => { method: string, url: string, body: Buffer }[] }} server
 */
export const uploadsStarted = (server) => server.requests()
    .filter(({ method, url }) => method === 'POST' && /^\/api\/v4\/uploads$/.test(url))
    .map(({ body }) => JSON.parse(body.toString('utf8')));

export const test = base.extend({
    // Put a TLS proxy in front of the server, and give the desktop app its
    // https:// address, as it would have for a real server. The app only
    // encrypts uploads to an https:// address. Set it with test.use({ tlsProxy: true }).
    tlsProxy: [false, { option: true }],

    desktop: async ({ server, secrets, tlsProxy }, use, testInfo) => {
        const started = Date.now();
        const real = realClipboard();
        // The clipboard is shared by everything on the machine, so two tests using it at once would mix up their links.
        if (real && testInfo.config.workers > 1) {
            throw new Error('The real clipboard is shared by every test, so run the desktop tests with --workers=1.');
        }
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-desktop-test-'));
        const proxy = tlsProxy ? await startTlsProxy(server.baseUrl) : null;
        const desktop = new Desktop({ started, root, server, proxy, secrets, real });
        // A hung app gets 10 s to quit, so the teardown can't hang with it and lose the report.
        const close = () => Promise.race([desktop.close(), sleep(10_000)]);
        try {
            await use(desktop);
            const bodyPassed = passed(testInfo);
            expect.soft(desktop.elsewhere, "requests the desktop app made that weren't to the test's server").toEqual([]);
            const appRequests = desktop.appRequests();
            // Quitting finishes each run's net log.
            await close();
            if (bodyPassed) expectNoLookups(desktop);
            if (testInfo.status !== testInfo.expectedStatus) {
                // A test.fail() test that passed: failing it now would count as the failure it expects, and hide the pass.
                if (testInfo.expectedStatus === 'failed') console.error(`"${testInfo.title}" passed, though it's expected to fail.\n\n${desktop.report(appRequests)}`);
                else throw new Error(desktop.report(appRequests));
            }
        } finally {
            await close();
            await proxy?.stop();
            try {
                fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
            } catch (err) {
                // An app that didn't quit can still hold its files. Throwing here would replace the test's own error.
                console.error(`Couldn't remove the test's folder ${root}: ${err.message}`);
            }
        }
    },
});
