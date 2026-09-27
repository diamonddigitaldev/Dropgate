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

const canConnect = (port) => new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
});

/**
 * Start a copy of the server.
 * @param {object} [opts]
 * @param {Record<string, string>} [opts.env] - Server settings for this run.
 * @param {boolean} [opts.clock] - Load the test clock so advanceClock() works.
 * @param {boolean} [opts.requests] - Write down every request the server receives, for requests().
 */
export async function startServer({ env = {}, clock = false, requests = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-server-test-'));
    fs.copyFileSync(path.join(SERVER_DIR, 'server.js'), path.join(dir, 'server.js'));
    fs.copyFileSync(path.join(SERVER_DIR, 'package.json'), path.join(dir, 'package.json'));
    fs.cpSync(path.join(SERVER_DIR, 'views'), path.join(dir, 'views'), { recursive: true });
    fs.cpSync(path.join(SERVER_DIR, 'public'), path.join(dir, 'public'), { recursive: true });
    // A junction on Windows, a plain symlink elsewhere. fs.rmSync removes the link, never the target.
    fs.symlinkSync(path.join(SERVER_DIR, 'node_modules'), path.join(dir, 'node_modules'), 'junction');

    const port = await freePort();
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SERVER_ENV.test(k)));
    Object.assign(childEnv, { SERVER_PORT: String(port) }, env);

    const preloads = [];
    if (clock) preloads.push('--require', CLOCK_PRELOAD);
    if (requests) preloads.push('--require', REQUESTS_PRELOAD);
    const child = spawn(process.execPath, [...preloads, 'server.js'], {
        cwd: dir,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe', clock ? 'ipc' : 'ignore'],
    });

    const output = { stdout: '', stderr: '' };
    child.stdout.on('data', (d) => { output.stdout += d; });
    child.stderr.on('data', (d) => { output.stderr += d; });
    let exited = false;
    child.once('exit', () => { exited = true; });

    const stop = async () => {
        if (!exited) {
            child.kill();
            await once(child, 'exit');
        }
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    };

    for (let i = 0; !(await canConnect(port)); i++) {
        if (exited || i > 100) {
            await stop();
            throw new Error(`Server did not start.\n${output.stdout}${output.stderr}`);
        }
        await sleep(100);
    }

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        dir,
        uploadsDir: path.join(dir, 'uploads'),
        tmpDir: path.join(dir, 'uploads', 'tmp'),
        output,
        /** Position in the output, for since(). */
        mark: () => ({ stdout: output.stdout.length, stderr: output.stderr.length }),
        /** Everything written after a mark(). */
        since: (m) => ({ stdout: output.stdout.slice(m.stdout), stderr: output.stderr.slice(m.stderr) }),
        /** Files in uploads/ other than the tmp/ and db/ folders. */
        storedFiles: () => fs.readdirSync(path.join(dir, 'uploads')).filter((f) => f !== 'tmp' && f !== 'db'),
        tempFiles: () => fs.readdirSync(path.join(dir, 'uploads', 'tmp')),
        /**
         * Every record in one of the server's databases, as { id, value }.
         * Needs UPLOAD_PRESERVE_UPLOADS=true; the in-memory mode stores the same records.
         * @param {'file-database.sqlite' | 'bundle-database.sqlite'} name
         */
        records: (name) => {
            const Database = createRequire(path.join(dir, 'server.js'))('better-sqlite3');
            const db = new Database(path.join(dir, 'uploads', 'db', name), { readonly: true });
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
         * Every request the server has received so far, in order, as { method, url, headers, body }.
         * WebSocket upgrades are included, with an empty body. Needs { requests: true }.
         */
        requests: () => {
            if (!requests) throw new Error('Start the server with { requests: true } to use requests().');
            const lines = fs.readFileSync(path.join(dir, 'requests.jsonl'), 'utf8').split('\n');
            // Anything after the last newline is a line still being written.
            lines.pop();
            const received = [];
            for (const line of lines) {
                const entry = JSON.parse(line);
                if (entry.body === undefined) received[entry.n - 1] = { ...entry, body: [] };
                else received[entry.n - 1].body.push(Buffer.from(entry.body, 'base64'));
            }
            return received.map(({ n, body, ...request }) => ({ ...request, body: Buffer.concat(body) }));
        },
        /** Move the server's clock forward. Repeating timers due in that time run once before it resolves. */
        advanceClock: async (ms) => {
            if (!clock) throw new Error('Start the server with { clock: true } to use advanceClock().');
            child.send({ type: 'advance-clock', ms });
            await once(child, 'message');
        },
        stop,
    };
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
