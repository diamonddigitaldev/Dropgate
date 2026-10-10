// The client's main-process modules, loaded in plain Node, with a stand-in
// for Electron: its ipcMain records each handler, its sessions are two
// objects (the UI session and the transfer session), and its windows and
// utility processes keep what they're sent. The kit's own ipc.js is loaded
// with it, so kit.ipc.handle() checks each sender as it does in the app: the
// app's own page, in the session the channel is answered in. A test invokes a
// channel as a page would, from a frame showing one of the client's pages in
// one of the sessions.
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const CLIENT = fileURLToPath(new URL('../../', import.meta.url));
const KIT_IPC = path.join(path.dirname(require.resolve('@diamonddigitaldev/electron-kit/package.json')), 'main', 'ipc.js');

/**
 * Load a CommonJS file afresh, with `electron` replaced. The modules it
 * requires in turn that don't touch Electron are shared as usual.
 * @param {string} file - Its path, absolute or relative to this folder's parent.
 * @param {object} electron
 */
function loadWith(file, electron) {
    const resolved = require.resolve(path.resolve(fileURLToPath(new URL('../', import.meta.url)), file));
    const original = Module._load;
    Module._load = function (request, ...rest) {
        return request === 'electron' ? electron : original.call(this, request, ...rest);
    };
    try {
        delete require.cache[resolved];
        return require(resolved);
    } finally {
        Module._load = original;
    }
}

/** A stand-in main process, with the kit's IPC checks, for one test. */
export function fakeMain({ settings = {} } = {}) {
    /** @type {Map<string, Function>} ipcMain's handlers, by channel. */
    const handlers = new Map();
    const uiSession = { name: 'ui' };
    const transferSession = { name: 'transfer' };
    /** Every BrowserWindow made, and every utility process forked. */
    const windows = [];
    const processes = [];
    let nextContents = 1;

    class WebContents {
        constructor(session) {
            this.id = nextContents++;
            this.session = session;
            /** What main sent its page: [channel, ...args]. */
            this.sent = [];
        }

        send(channel, ...args) {
            this.sent.push([channel, ...args]);
        }

        postMessage(channel, message) {
            this.sent.push([channel, message]);
        }

        on() {}
        once() {}
        setWindowOpenHandler() {}
    }

    class BrowserWindow {
        constructor(options) {
            this.options = options;
            this.webContents = new WebContents(options?.webPreferences?.session ?? uiSession);
            this.destroyed = false;
            windows.push(this);
        }

        removeMenu() {}
        on() {}
        loadFile(page) {
            this.page = page;
        }

        isDestroyed() {
            return this.destroyed;
        }

        destroy() {
            this.destroyed = true;
        }
    }

    const electron = {
        app: { getAppPath: () => CLIENT },
        session: { defaultSession: uiSession },
        ipcMain: {
            handle(channel, handler) {
                if (handlers.has(channel)) throw new Error(`"${channel}" is handled twice.`);
                handlers.set(channel, handler);
            },
        },
        BrowserWindow,
        MessageChannelMain: class {
            port1 = { name: 'port1' };
            port2 = { name: 'port2' };
        },
        utilityProcess: {
            fork() {
                const child = { messages: [], postMessage: (message) => child.messages.push(message), kill() {}, on() {} };
                processes.push(child);
                return child;
            },
        },
    };

    const ipc = loadWith(KIT_IPC, electron);
    const kit = {
        ipc: { handle: (channel, handler, options) => ipc.handleApp(channel, handler, options, (ses) => ses === transferSession) },
        sessions: { isolated: (name) => (name === 'transfer' ? transferSession : null) },
        settings: { get: () => ({ serverURL: '', ...settings }) },
    };

    /**
     * A page of the client's: one of its files in src/, in a session, with its own webContents unless given.
     * @param {string} page - e.g. 'index.html'
     * @param {object} session
     * @param {object} [sender]
     */
    const pageOf = (page, session, sender = new WebContents(session)) => ({
        sender,
        senderFrame: { url: pathToFileURL(path.join(CLIENT, 'src', page)).href },
    });

    /**
     * Invoke a channel as a page's invoke() would: what its handler answers, or
     * the error it throws, as a promise.
     */
    const invoke = async (channel, event, ...args) => {
        const handler = handlers.get(channel);
        if (!handler) throw new Error(`Nothing handles "${channel}".`);
        return handler(event, ...args);
    };

    return {
        electron,
        kit,
        handlers,
        windows,
        processes,
        uiSession,
        transferSession,
        pageOf,
        invoke,
        load: (file) => loadWith(file, electron),
        /** The app's window's page, in the UI session. */
        windowPage: (sender) => pageOf('index.html', uiSession, sender),
        /** The transfer window's page, in its session. */
        transferPage: (sender) => pageOf('transfer.html', transferSession, sender),
    };
}
