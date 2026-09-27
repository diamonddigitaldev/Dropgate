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
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { expect, test as base } from './test.mjs';
import { startTlsProxy } from './tls.mjs';

export { expect };

// No trailing separator: on Windows, a backslash before the closing quote of an argument escapes it.
const CLIENT_DIR = fileURLToPath(new URL('../../../client', import.meta.url));
const PRELOAD = fileURLToPath(new URL('./desktop-preload.cjs', import.meta.url));

/** The client's own Electron build. The electron package downloads it the first time it's asked for. */
const electronPath = () => createRequire(path.join(CLIENT_DIR, 'package.json'))('electron');

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

/** One run of the app. */
export class DesktopApp {
    /**
     * @param {import('@playwright/test').ElectronApplication} app
     * @param {string} eventsFile
     * @param {Desktop} desktop
     */
    constructor(app, eventsFile, desktop) {
        this.app = app;
        this.eventsFile = eventsFile;
        this.desktop = desktop;
    }

    /** The first window the app opens: its main window, or the one a background upload runs in. */
    window() {
        return this.app.firstWindow();
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

    /** Wait for the app to quit by itself, and return its exit code. The wait ends well inside a test's time, so a hang says what the app did. */
    async exited(timeout = 30_000) {
        try {
            return await exitOf(this.app.process(), timeout, 'The desktop app');
        } catch (err) {
            err.message += `\n\n${this.describe()}`;
            throw err;
        }
    }

    /** Quit, as Exit in the app's menu does. */
    async quit() {
        if (this.running) await this.app.close();
    }

    /** What the app wrote down and logged, for a failure message. */
    describe() {
        const events = this.events().map((e) => `  ${JSON.stringify(e)}`).join('\n') || '  (none)';
        const log = path.join(this.desktop.profile, 'debug.log');
        const debug = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').slice(-40).join('\n') : '(none)';
        return `What the app did:\n${events}\n\nThe end of its debug.log:\n${debug}`;
    }
}

/** The desktop app for one test: its profile, its files, and every run of it. */
class Desktop {
    /** @type {DesktopApp[]} */
    runs = [];
    /** @type {string[]} */
    elsewhere = [];

    /**
     * @param {object} opts
     * @param {string} opts.root - A temporary folder for the profile, the files and the events.
     * @param {{ baseUrl: string }} opts.server
     * @param {{ url: string } | null} opts.proxy - The TLS proxy in front of the server, if there is one.
     * @param {import('./privacy.mjs').Secrets} opts.secrets
     * @param {boolean} opts.real - Whether the clipboard and notifications are real.
     */
    constructor({ root, server, proxy, secrets, real }) {
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
        const app = await electron.launch({
            executablePath: electronPath(),
            args: ['-r', PRELOAD, `--user-data-dir=${this.profile}`, CLIENT_DIR, ...args],
            env: appEnv({ DROPGATE_TEST_EVENTS: eventsFile, DROPGATE_TEST_REAL_CLIPBOARD: this.real ? '1' : '0' }),
            // The TLS proxy's certificate is made up for the test, so the app is told to accept it.
            ignoreHTTPSErrors: Boolean(this.proxy),
        });
        const allowed = new Set([new URL(this.server.baseUrl).origin, ...(this.proxy ? [this.proxy.url] : [])]);
        app.context().on('request', (request) => {
            const { protocol, origin } = new URL(request.url());
            if (/^(https?|wss?):$/.test(protocol) && !allowed.has(origin)) this.elsewhere.push(request.url());
        });
        const run = new DesktopApp(app, eventsFile, this);
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
        const child = spawn(electronPath(), [...noSandbox, `--user-data-dir=${this.profile}`, CLIENT_DIR, ...args], {
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
     * Point the app at the test's server and set its options in the main
     * window, as a person would.
     * @param {import('@playwright/test').Page} window
     * @param {object} [opts]
     * @param {{ value: number, unit: 'minutes' | 'hours' | 'days' }} [opts.lifetime]
     * @param {number} [opts.maxDownloads]
     */
    async setUp(window, { lifetime, maxDownloads } = {}) {
        await window.locator('#server-url').fill(this.serverUrl);
        await window.locator('#test-connection-btn').click();
        await expect(window.locator('#connection-status')).toHaveText(/connection successful/i);
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
     * Upload files from the main window with its Upload button, and return the
     * link the window shows.
     * @param {import('@playwright/test').Page} window
     * @param {{ name: string, mimeType: string, buffer: Buffer }[]} files
     * @param {{ encrypted: boolean }} opts - Whether the window should say the upload will be
     *   end-to-end encrypted. When it won't be, the window asks first, and this answers "Upload Anyway".
     */
    async upload(window, files, { encrypted }) {
        this.secrets.addFiles(files, { storedByServer: !encrypted });
        await expect(window.locator('#security-text')).toHaveText(encrypted ? /will be end-to-end encrypted/i : /will not be encrypted/i);
        await window.locator('#file-input').setInputFiles(files);
        await window.locator('#upload-btn').click();
        if (!encrypted) {
            await expect(window.locator('#insecure-upload-modal')).toBeVisible();
            await window.locator('#confirm-insecure-upload').click();
        }
        await expect(window.locator('#upload-status')).toHaveText(/upload successful/i, { timeout: 30_000 });
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
}

/**
 * Wait for the app to have saved the settings a window just changed. The window
 * saves them over IPC as they change, without waiting for an answer, and the
 * app answers IPC in the order it's sent. So once it has answered a request for
 * its settings, it has saved them.
 * @param {import('@playwright/test').Page} window
 */
export const saved = (window) => window.evaluate(() => window.electronAPI.getSettings());

/**
 * The body of every upload the server was asked to start, in order: single
 * files (POST /upload/init) and bundles (POST /upload/init-bundle).
 * @param {{ requests: () => { method: string, url: string, body: Buffer }[] }} server
 */
export const uploadsStarted = (server) => server.requests()
    .filter(({ method, url }) => method === 'POST' && /^\/upload\/init(-bundle)?$/.test(url))
    .map(({ body }) => JSON.parse(body.toString('utf8')));

export const test = base.extend({
    // Put a TLS proxy in front of the server, and give the desktop app its
    // https:// address, as it would have for a real server. The app only
    // encrypts uploads to an https:// address. Set it with test.use({ tlsProxy: true }).
    tlsProxy: [false, { option: true }],

    desktop: async ({ server, secrets, tlsProxy }, use, testInfo) => {
        const real = realClipboard();
        // The clipboard is shared by everything on the machine, so two tests using it at once would mix up their links.
        if (real && testInfo.config.workers > 1) {
            throw new Error('The real clipboard is shared by every test, so run the desktop tests with --workers=1.');
        }
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-desktop-test-'));
        const proxy = tlsProxy ? await startTlsProxy(server.baseUrl) : null;
        const desktop = new Desktop({ root, server, proxy, secrets, real });
        try {
            await use(desktop);
            expect(desktop.elsewhere, "requests the desktop app made that weren't to the test's server").toEqual([]);
        } finally {
            await desktop.close();
            await proxy?.stop();
            fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
        }
    },
});
