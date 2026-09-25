// What the server writes to its output: the privacy floor for logging.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { startServer, waitFor } from './helpers/harness.mjs';
import { runFixture } from './helpers/fixture.mjs';
import { PAST_SESSION_EXPIRY_MS, initUpload, postJson, sendChunk } from './helpers/uploads.mjs';

// Dropgate's own log lines: "[<ISO time>] [LEVEL] message".
const OWN_LINE = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[(ERROR|WARN|INFO|DEBUG)\] (.*)$/;
const LEVELS = ['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG'];

const linesOf = ({ stdout, stderr }) => (stdout + stderr).split(/\r?\n/).filter((l) => l.length > 0);

// Every message the server may log after startup. Each carries only sizes,
// counts and timestamps. A new message has to be added here deliberately.
const CAPACITY = String.raw`Server capacity: \d+\.\d{2} GB \/ \d+(\.\d+)? GB\.`;
const KNOWN_EVENTS = [
    String.raw`Initialised upload\. Reserved \d+\.\d{2} MB\.`,
    String.raw`Initialised bundle upload \(\d+ files\)\. Reserved \d+\.\d{2} MB total\.`,
    String.raw`Received chunk \d+\/\d+\. Size: \d+\.\d{2} KB`,
    String.raw`\[(Encrypted|Simple)\] File received\.( ${CAPACITY})?`,
    String.raw`Bundle created( \(sealed\))? \(\d+ files, \d+\.\d{2} MB total\)\. ${CAPACITY}`,
    String.raw`Upload cancelled by client\. Released \d+\.\d{2} MB\.`,
    String.raw`\[(Encrypted|Simple)\] File data sent and deleted \(\d+\/\d+ downloads\)\.( ${CAPACITY})?`,
    String.raw`\[(Encrypted|Simple)\] File data sent \(\d+\/(\d+|unlimited) downloads\)\.`,
    String.raw`\[(Encrypted|Simple)\] Bundle file data sent \(individual download, no count increment\)\.`,
    String.raw`Sealed bundle manifest deleted \(\d+\/\d+ downloads\)\. Member files will expire independently\.`,
    String.raw`Bundle downloaded and deleted \(\d+\/\d+ downloads\)\. ${CAPACITY}`,
    String.raw`Bundle downloaded \(\d+\/(\d+|unlimited) downloads\)\.`,
    String.raw`Blocked access to an encrypted (file|bundle) (over an insecure connection \(HTTP\)|because upload E2EE is disabled)\.`,
    String.raw`Upload rejected due to insufficient storage\. Current usage: \d+\.\d{2} GB, Reserved: \d+\.\d{2} GB, Requested: \d+\.\d{2} GB\.`,
    String.raw`Upload incomplete: \d+\/\d+ chunks\.`,
    String.raw`Upload size mismatch\. Expected: \d+, Actual: \d+`,
    String.raw`Rejected 0-byte file upload\.`,
    String.raw`Rejected an E2EE upload attempt because upload E2EE is disabled on the server\.`,
    String.raw`File expired\. Deleting\.\.\.`,
    String.raw`Sealed bundle manifest expired\. Deleting manifest record\.\.\.`,
    String.raw`Bundle expired\. Deleting \d+ member files\.\.\.`,
    String.raw`Cleaning zombie (bundle )?upload\.`,
    String.raw`Rate limit triggered\. Request blocked\.`,
].map((source) => new RegExp(`^${source}$`));
const FILE_COUNT = /\(\d+ files|\d+ member files/;

test('the default log level writes nothing per transfer', async () => {
    const server = await startServer({ env: { ENABLE_UPLOAD: 'true' } });
    try {
        await waitFor(() => server.output.stdout.includes('is running'), { what: 'the startup log' });
        const mark = server.mark();
        await runFixture(server);
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
            const server = await startServer({ env: { ENABLE_UPLOAD: 'true', LOG_LEVEL: level } });
            try {
                const { secrets } = await runFixture(server, { faults: true });
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

    test('nothing reaches stdout or stderr outside LOG_LEVEL', {
        expectFailure: {
            label: 'known issue until the v4 server rewrite: Express prints error stacks, one with a file ID',
            match: /outside LOG_LEVEL/,
        },
    }, () => {
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
        const server = await startServer({
            env: { ENABLE_UPLOAD: 'true', LOG_LEVEL: 'DEBUG', UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS: '100' },
            clock: true,
        });
        try {
            await waitFor(() => server.output.stdout.includes('is running'), { what: 'the startup log' });
            const mark = server.mark();
            await runFixture(server);

            // A cancelled upload, and an abandoned one for the zombie sweep.
            const cancelled = await initUpload(server, 1000, 2);
            await sendChunk(server, cancelled.uploadId, 0, new Uint8Array(500).fill(1));
            await postJson(server, '/upload/cancel', { uploadId: cancelled.uploadId });
            const abandoned = await initUpload(server, 1000, 2);
            await sendChunk(server, abandoned.uploadId, 0, new Uint8Array(500).fill(1));
            await server.advanceClock(PAST_SESSION_EXPIRY_MS);
            await waitFor(() => server.output.stdout.includes('Cleaning zombie upload.'), { what: 'the zombie sweep' });

            await sleep(300);
            messages = linesOf(server.since(mark)).map((l) => {
                const own = l.match(OWN_LINE);
                return own ? own[2] : `(not a log line) ${l}`;
            });
        } finally {
            await server.stop();
        }
    });

    test('every message is a known event carrying only sizes, counts and timestamps', () => {
        assert.ok(messages.length > 10, 'the run produced DEBUG messages');
        const unknown = messages.filter((m) => !KNOWN_EVENTS.some((re) => re.test(m)));
        assert.deepEqual(unknown, [], 'Messages that are not in the list of known events');
    });

    test("no message gives a bundle's file count", {
        expectFailure: {
            label: 'known issue until the v4 server rewrite: bundle messages include the file count',
            match: /file count/,
        },
    }, () => {
        const counted = messages.filter((m) => FILE_COUNT.test(m));
        assert.equal(counted.length, 0, `${counted.length} message(s) give a bundle's file count, first: ${counted[0]}`);
    });
});
