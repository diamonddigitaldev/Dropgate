// Runs the real server.js in a throwaway copy, on a free port, and captures
// everything it writes to stdout and stderr.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SERVER_DIR = fileURLToPath(new URL('../../', import.meta.url));
const CLOCK_PRELOAD = fileURLToPath(new URL('./clock.cjs', import.meta.url));
const REQUESTS_PRELOAD = fileURLToPath(new URL('./requests.cjs', import.meta.url));
const LISTENING_PRELOAD = fileURLToPath(new URL('./listening.cjs', import.meta.url));

export const serverVersion = JSON.parse(
    fs.readFileSync(path.join(SERVER_DIR, 'package.json'), 'utf8')
).version;

// Settings the server reads from the environment. Anything inherited from the
// shell is dropped so every test starts from the server's own defaults.
// NODE_ENV matters too: Express stops printing error stacks when it is 'test'.
const SERVER_ENV = /^(SERVER_|ENABLE_|UPLOAD_|RATE_LIMIT_|P2P_|PEERJS_|LOG_LEVEL$|NODE_ENV$)/;

const freePort = () => new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
    });
});

/**
 * Start a copy of the server.
 * @param {object} [opts]
 * @param {Record<string, string>} [opts.env] - Server settings for this run.
 * @param {boolean} [opts.clock] - Load the test clock so advanceClock() works.
 * @param {boolean} [opts.requests] - Write down every request the server receives, for requests().
 * @param {number} [opts.port] - Try this port first. Another is used if it's taken.
 */
export async function startServer({ env = {}, clock = false, requests = false, port: firstPort } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-server-test-'));
    fs.copyFileSync(path.join(SERVER_DIR, 'server.js'), path.join(dir, 'server.js'));
    fs.copyFileSync(path.join(SERVER_DIR, 'package.json'), path.join(dir, 'package.json'));
    fs.cpSync(path.join(SERVER_DIR, 'views'), path.join(dir, 'views'), { recursive: true });
    fs.cpSync(path.join(SERVER_DIR, 'public'), path.join(dir, 'public'), { recursive: true });
    // A junction on Windows, a plain symlink elsewhere. fs.rmSync removes the link, never the target.
    fs.symlinkSync(path.join(SERVER_DIR, 'node_modules'), path.join(dir, 'node_modules'), 'junction');

    const preloads = ['--require', LISTENING_PRELOAD];
    if (clock) preloads.push('--require', CLOCK_PRELOAD);
    if (requests) preloads.push('--require', REQUESTS_PRELOAD);

    // Everything every run of the server in this folder has written, restarts included.
    const output = { stdout: '', stderr: '' };

    const launch = (port) => {
        const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SERVER_ENV.test(k)));
        Object.assign(childEnv, { SERVER_PORT: String(port) }, env);
        const child = spawn(process.execPath, [...preloads, 'server.js'], {
            cwd: dir,
            env: childEnv,
            stdio: ['ignore', 'pipe', 'pipe', clock ? 'ipc' : 'ignore'],
        });
        const run = { port, child, output, exited: false, closed: once(child, 'close') };
        child.stdout.on('data', (d) => { run.output.stdout += d; });
        child.stderr.on('data', (d) => { run.output.stderr += d; });
        child.once('exit', () => { run.exited = true; });
        return run;
    };

    // The port the server says it's listening on (listening.cjs), or null.
    const listeningOn = () => {
        try {
            return JSON.parse(fs.readFileSync(path.join(dir, 'listening.json'), 'utf8')).port;
        } catch {
            return null;
        }
    };
    // Why the server couldn't listen (listening.cjs), as a code such as EADDRINUSE, or null.
    const listenError = () => {
        try {
            return JSON.parse(fs.readFileSync(path.join(dir, 'listen-error.json'), 'utf8')).code;
        } catch {
            return null;
        }
    };

    let run;
    const kill = async () => {
        if (!run.exited) {
            run.child.kill();
            await once(run.child, 'exit');
        }
    };
    const stop = async () => {
        await kill();
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    };

    // Another test can start a server on the port freePort() found before this
    // one listens on it. Then this server exits with EADDRINUSE while the other
    // answers on the port, so the server has only started once it says it's
    // listening, and a taken port means trying another.
    const start = async (preferredPort) => {
        for (let attempt = 1; ; attempt++) {
            fs.rmSync(path.join(dir, 'listening.json'), { force: true });
            fs.rmSync(path.join(dir, 'listen-error.json'), { force: true });
            run = launch(attempt === 1 && preferredPort ? preferredPort : await freePort());
            for (let i = 0; listeningOn() !== run.port && !run.exited && i <= 100; i++) await sleep(100);
            if (listeningOn() === run.port) return;
            if (run.exited) await run.closed;
            if (attempt < 3 && run.exited && listenError() === 'EADDRINUSE') continue;
            await stop();
            // A test of a setting the server refuses reads why from these.
            throw Object.assign(new Error(`Server did not start.\n${run.output.stdout}${run.output.stderr}`), {
                exitCode: run.child.exitCode, output: { ...run.output },
            });
        }
    };
    await start(firstPort);

    const server = {
        baseUrl: `http://127.0.0.1:${run.port}`,
        dir,
        dataDir: path.join(dir, 'data'),
        uploadsDir: path.join(dir, 'data', 'uploads'),
        tmpDir: path.join(dir, 'data', 'uploads', 'tmp'),
        output,
        /** Position in the output, for since(). */
        mark: () => ({ stdout: output.stdout.length, stderr: output.stderr.length }),
        /** Everything written after a mark(). */
        since: (m) => ({ stdout: output.stdout.slice(m.stdout), stderr: output.stderr.slice(m.stderr) }),
        /**
         * Every stored upload's file, relative to uploadsDir (data/uploads/): those in
         * objects/ (as `objects/<name>`), and those in uploadsDir itself other than its
         * folders and the format marker.
         */
        storedFiles: () => [
            ...fs.readdirSync(path.join(dir, 'data', 'uploads'))
                .filter((f) => !['tmp', 'db', 'objects', 'dropgate-storage.json'].includes(f)),
            ...(fs.existsSync(path.join(dir, 'data', 'uploads', 'objects'))
                ? fs.readdirSync(path.join(dir, 'data', 'uploads', 'objects')).map((f) => `objects/${f}`)
                : []),
        ],
        tempFiles: () => fs.readdirSync(path.join(dir, 'data', 'uploads', 'tmp')),
        /**
         * Every record in one of the server's databases, as { id, value }.
         * Needs UPLOAD_PRESERVE_UPLOADS=true; the in-memory mode stores the same records.
         * @param {'file-database.sqlite' | 'bundle-database.sqlite' | 'objects.sqlite'} name - Dropgate 3's two, or 4's one.
         */
        records: (name) => {
            const Database = createRequire(path.join(dir, 'server.js'))('better-sqlite3');
            const db = new Database(path.join(dir, 'data', 'uploads', 'db', name), { readonly: true });
            try {
                const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
                return tables.flatMap(({ name: table }) => db.prepare(`SELECT * FROM "${table}"`).all())
                    .map((row) => ({ id: row.ID, value: JSON.parse(row.json) }));
            } finally {
                db.close();
            }
        },
        /** The web UI's own copy of dropgate-core, the same client the server ships. */
        loadCore: async () => {
            const copy = path.join(dir, 'dropgate-core.mjs');
            fs.copyFileSync(path.join(dir, 'public', 'js', 'dropgate-core.js'), copy);
            return import(pathToFileURL(copy).href);
        },
        /**
         * Every request the server has received so far, in order, as { at, method, url, headers, body },
         * with `answer: { at, status, finished }` once the server is done with it (see requests.cjs).
         * WebSocket upgrades are included, with an empty body and no answer. Needs { requests: true }.
         */
        requests: () => {
            if (!requests) throw new Error('Start the server with { requests: true } to use requests().');
            const lines = fs.readFileSync(path.join(dir, 'requests.jsonl'), 'utf8').split('\n');
            // Anything after the last newline is a line still being written.
            lines.pop();
            const received = [];
            for (const line of lines) {
                const { n, ...entry } = JSON.parse(line);
                if (entry.method !== undefined) received[n - 1] = { ...entry, body: [] };
                else if (entry.body !== undefined) received[n - 1].body.push(Buffer.from(entry.body, 'base64'));
                else received[n - 1].answer = entry;
            }
            return received.map(({ body, ...request }) => ({ ...request, body: Buffer.concat(body) }));
        },
        /**
         * Move the server's clock forward. Repeating timers due in that time run once, and
         * timeouts due in it run, before it resolves (see clock.cjs).
         */
        advanceClock: async (ms) => {
            if (!clock) throw new Error('Start the server with { clock: true } to use advanceClock().');
            run.child.send({ type: 'advance-clock', ms });
            await once(run.child, 'message');
        },
        /**
         * Stop the server and start it again in the same folder, as an operator's
         * restart would, on a port that may differ: baseUrl follows it. The output
         * goes on. The test clock, if any, starts again at the real time.
         */
        restart: async () => {
            await kill();
            await start();
            server.baseUrl = `http://127.0.0.1:${run.port}`;
        },
        stop,
    };
    return server;
}

/** Poll until check() returns true, or fail after timeoutMs. */
export async function waitFor(check, { timeoutMs = 5000, intervalMs = 50, what = 'condition' } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) return;
        await sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for ${what}.`);
}
