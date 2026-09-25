// What the server writes to its output: the privacy floor for logging.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { startServer, waitFor } from './helpers/harness.mjs';
import { runFixture } from './helpers/fixture.mjs';

// Dropgate's own log lines: "[<ISO time>] [LEVEL] message".
const OWN_LINE = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[(ERROR|WARN|INFO|DEBUG)\] /;
const LEVELS = ['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG'];

const linesOf = ({ stdout, stderr }) => (stdout + stderr).split(/\r?\n/).filter((l) => l.length > 0);

test('the default log level writes nothing per transfer', async () => {
    const server = await startServer({ env: { ENABLE_UPLOAD: 'true' } });
    try {
        await waitFor(() => server.output.stdout.includes('is running'), { what: 'the startup log' });
        const mark = server.mark();
        await runFixture(server);
        await new Promise((r) => setTimeout(r, 500));
        const written = linesOf(server.since(mark));
        assert.deepEqual(written, [], 'Lines written after startup at the default level');
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
                const secrets = await runFixture(server, { faults: true });
                await new Promise((r) => setTimeout(r, 500));
                runs.push({ level, secrets, lines: linesOf(server.output), bytes: server.output.stdout.length + server.output.stderr.length });
            } finally {
                await server.stop();
            }
        }
    });

    test("Dropgate's own log lines never contain an ID, a name, a key, a code, an IP or request body text", () => {
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
});
