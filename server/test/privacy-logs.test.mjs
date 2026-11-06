// What the server writes to its output: the privacy floor for logging.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { startServer, waitFor } from './helpers/harness.mjs';
import { runFixture } from './helpers/fixture.mjs';
import { QUIET_MS, SMALL_CHUNKS, plainObject, fileBytes, runDownloads, runUploads, sendChunks, startUpload } from './helpers/dgup4.mjs';

// Each run's uploads and downloads are within the rate limit, which stays on.
const UPLOADS = { ENABLE_UPLOAD: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, RATE_LIMIT_MAX_REQUESTS: '100' };

// Dropgate's own log lines: "[<ISO time>] [LEVEL] message".
const OWN_LINE = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[(ERROR|WARN|INFO|DEBUG)\] (.*)$/;
const LEVELS = ['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG'];

const linesOf = ({ stdout, stderr }) => (stdout + stderr).split(/\r?\n/).filter((l) => l.length > 0);

// Every message the server may log after startup. Each carries only sizes,
// counts and timestamps. A new message has to be added here deliberately.
const CAPACITY = String.raw`Server capacity: \d+\.\d{2} GB \/ \d+(\.\d+)? GB\.`;
const KNOWN_EVENTS = [
    String.raw`Upload started\. Reserved \d+\.\d{2} MB\.`,
    String.raw`Received chunk \d+\/\d+\. Size: \d+\.\d{2} KB`,
    String.raw`Upload cancelled by client\. Released \d+\.\d{2} MB\.`,
    String.raw`Upload rejected due to insufficient storage\. Current usage: \d+\.\d{2} GB, Reserved: \d+\.\d{2} GB, Requested: \d+\.\d{2} GB\.`,
    String.raw`Rate limit triggered\. Request blocked\.`,
    String.raw`Upload (paused|resumed)\.`,
    String.raw`Upload finished\.( ${CAPACITY})?`,
    String.raw`Upload ended at its deadline( while paused)?\. Released \d+\.\d{2} MB\.`,
    String.raw`Upload expired\. Deleting\.\.\.`,
    String.raw`Download lease (taken|paused)\.`,
    String.raw`Download counted \((\d+\/\d+|unlimited) downloads\)\.`,
    String.raw`Upload deleted at its download limit \(\d+\/\d+ downloads\)\.( ${CAPACITY})?`,
    String.raw`Upload deleted by its uploader\.`,
    String.raw`Refused a request whose body could not be read\.`,
    String.raw`Unexpected error while answering a request( to [A-Z]+ [\w/:.-]+)?( \([A-Za-z]+(, [A-Z][A-Z0-9_]+)?\))?\.`,
].map((source) => new RegExp(`^${source}$`));
const FILE_COUNT = /\(\d+ files|\d+ member files/;

test('the default log level writes nothing per transfer', async () => {
    const server = await startServer({ env: UPLOADS });
    try {
        await waitFor(() => server.output.stdout.includes('is running'), { what: 'the startup log' });
        const mark = server.mark();
        await runFixture(server);
        await runUploads(server);
        await runDownloads(server);
        await sleep(500);
        assert.deepEqual(linesOf(server.since(mark)), [], 'Lines written after startup at the default level');
    } finally {
        await server.stop();
    }
});

describe('at every log level, with a malformed request and a missing stored file', () => {
    const runs = [];

    before(async () => {
        for (const level of LEVELS) {
            const server = await startServer({ env: { ...UPLOADS, LOG_LEVEL: level } });
            try {
                const { secrets } = await runFixture(server, { faults: true });
                for (const secret of (await runUploads(server, { faults: true })).secrets) secrets.add(secret);
                for (const secret of (await runDownloads(server)).secrets) secrets.add(secret);
                const info = await (await fetch(`${server.baseUrl}/api/info`)).json();
                await sleep(500);
                runs.push({
                    level,
                    secrets,
                    reportedLevel: info.logLevel,
                    lines: linesOf(server.output),
                    bytes: server.output.stdout.length + server.output.stderr.length,
                });
            } finally {
                await server.stop();
            }
        }
    });

    test("Dropgate's own log lines never contain an ID, a name, a key, a code, an IP, a user agent or request body text", () => {
        const leaks = [];
        for (const { level, secrets, lines } of runs) {
            for (const line of lines.filter((l) => OWN_LINE.test(l))) {
                for (const secret of secrets) {
                    if (line.includes(secret)) leaks.push(`${level}: "${secret}" in: ${line}`);
                }
            }
        }
        assert.deepEqual(leaks, []);
    });

    test('nothing reaches stdout or stderr outside LOG_LEVEL', () => {
        const problems = [];
        for (const { level, lines } of runs) {
            const own = lines.filter((l) => OWN_LINE.test(l));
            if (level === 'NONE' && own.length > 0) problems.push(`NONE: ${own.length} own log line(s), first: ${own[0]}`);
            const outside = lines.filter((l) => !OWN_LINE.test(l));
            if (outside.length > 0) problems.push(`${level}: ${outside.length} line(s) written outside LOG_LEVEL, first: ${outside[0]}`);
        }
        const none = runs.find((r) => r.level === 'NONE');
        if (none.bytes > 0 && problems.length === 0) problems.push(`NONE: ${none.bytes} bytes written`);
        assert.deepEqual(problems, []);
    });

    test('/api/info reports the log level the server is running at', () => {
        assert.deepEqual(runs.map((r) => r.reportedLevel), LEVELS);
    });
});

describe('what DEBUG logs', () => {
    let messages = [];

    before(async () => {
        const server = await startServer({ env: { ...UPLOADS, LOG_LEVEL: 'DEBUG' }, clock: true });
        try {
            await waitFor(() => server.output.stdout.includes('is running'), { what: 'the startup log' });
            const mark = server.mark();
            await runFixture(server);
            await runUploads(server, { faults: true });
            await runDownloads(server);

            // An upload left quiet, which ends at its deadline.
            const quiet = plainObject({ files: [{ name: 'quiet.bin', bytes: fileBytes(70_000) }] });
            await sendChunks(server, await startUpload(server, quiet), quiet, 0, 1);
            await server.advanceClock(QUIET_MS + 1_000);
            await waitFor(() => server.output.stdout.includes('Upload ended at its deadline.'), { what: 'the quiet upload to end' });
            await sleep(300);
            messages = linesOf(server.since(mark)).map((l) => l.match(OWN_LINE)?.[2] ?? `(not a log line) ${l}`);
        } finally {
            await server.stop();
        }
    });

    test('every message is a known event carrying only sizes, counts and timestamps', () => {
        assert.ok(messages.length > 10, 'the run produced DEBUG messages');
        const unknown = messages.filter((m) => !KNOWN_EVENTS.some((re) => re.test(m)));
        assert.deepEqual(unknown, [], 'Messages that are not in the list of known events');
    });

    test('an upload\'s start, pause, resume, finish, cancel and deadline are each one of them', () => {
        for (const expected of [/^Upload started\./, /^Upload paused\.$/, /^Upload resumed\.$/, /^Upload finished\./, /^Upload cancelled by client\./, /^Upload ended at its deadline\./]) {
            assert.ok(messages.some((m) => expected.test(m)), `no message like ${expected}`);
        }
    });

    test('a download\'s lease, its pause, the upload going at its limit, and the uploader\'s delete are each one of them', () => {
        for (const expected of [/^Download lease taken\.$/, /^Download lease paused\.$/, /^Upload deleted at its download limit \(1\/1 downloads\)\./, /^Upload deleted by its uploader\.$/]) {
            assert.ok(messages.some((m) => expected.test(m)), `no message like ${expected}`);
        }
    });

    test('no message gives how many files an upload has, a bundle\'s included', () => {
        assert.ok(messages.some((m) => /^Upload started\./.test(m)), 'the uploads logged');
        const counted = messages.filter((m) => FILE_COUNT.test(m) || /\b\d+ files?\b/.test(m));
        assert.deepEqual(counted, []);
    });
});
