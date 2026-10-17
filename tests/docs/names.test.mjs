// The names the docs give match the code, both ways: environment variables,
// the server's endpoints, its HTTP statuses, and the error codes core gives
// its errors. So does any other UPPER_SNAKE_CASE name the docs put in code
// formatting, such as a constant. Whether what the docs say about each one is
// true is for the release proofread; these only check that the names line up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    codeFiles, envReads, errorCodes, namesInCode, productFiles, routeMatches, serverRoutes, statusesSent,
} from './helpers/code.mjs';
import {
    codeFormattedNames, endpointMentions, envMentions, envTableNames, errorCodeTableEntries, statusMentions, statusTableEntries,
} from './helpers/docs.mjs';
import { expectNone } from './helpers/report.mjs';

const allEnvReads = envReads(codeFiles);
const productEnvReads = envReads(productFiles);
const productErrorCodes = errorCodes(productFiles);
const routes = serverRoutes();
const statuses = statusesSent();

// The web UI's copies of its libraries (Bootstrap, StreamSaver, PeerJS and so
// on), served from the server's node_modules. Like the files in public/, the
// pages load them; they aren't endpoints anyone calls.
const isLibraryFile = (route) => route.path.startsWith('/vendor/');

// So a change to how the code is written can't pass the checks below by
// leaving them nothing to find. Each of these is used by something else: the
// test harness sets SERVER_PORT, and Docker's health check calls /api/info.
test('the checks find the code\'s environment variables, endpoints, statuses and error codes', () => {
    assert.ok(productEnvReads.has('SERVER_PORT'), 'expected the server to read SERVER_PORT');
    assert.ok(routes.some((route) => route.method === 'GET' && route.path === '/api/info'), 'expected the server to have GET /api/info');
    assert.ok(statuses.has(200) && statuses.has(404), 'expected the server to send 200 and 404');
    assert.ok(productErrorCodes.size > 0, 'expected core to give its errors codes');
});

test('every environment variable the docs name is one the code reads', () => {
    expectNone(
        envMentions().filter(({ name }) => !allEnvReads.has(name)).map(({ name, at }) => `${at}: ${name}`),
        'The docs name these as environment variables, but nothing in the code reads them:',
    );
});

test('every environment variable the server, the client and core read has a row in an environment variable table', () => {
    const inTables = envTableNames();
    expectNone(
        [...productEnvReads].filter(([name]) => !inTables.has(name)).map(([name, readBy]) => `${name}, read by ${readBy.join(', ')}`),
        'These need a row in a table whose first column is "Variable", such as the server README\'s:',
    );
});

test('every other UPPER_SNAKE_CASE name the docs put in code formatting exists in the code', () => {
    const inCode = namesInCode();
    expectNone(
        codeFormattedNames()
            .filter(({ name }) => !inCode.has(name) && !allEnvReads.has(name) && !productErrorCodes.has(name))
            .map(({ name, at }) => `${at}: ${name}`),
        'The docs name these, but they aren\'t anywhere in the code:',
    );
});

test('every endpoint the docs name is one the server has', () => {
    expectNone(
        endpointMentions()
            .filter(({ method, path }) => !routes.some((route) => routeMatches(route, path, method, { folders: true })))
            .map(({ method, path, at }) => `${at}: ${method ? `${method} ` : ''}${path}`),
        'The docs name these endpoints, but the server doesn\'t have them:',
    );
});

test('every endpoint the server has is in the docs', () => {
    const mentions = endpointMentions();
    expectNone(
        routes
            .filter((route) => !route.static && !isLibraryFile(route))
            .filter((route) => !mentions.some(({ method, path }) => routeMatches(route, path, method)))
            .map((route) => `${route.method === 'ALL' ? `${route.path} (and everything under it)` : `${route.method} ${route.path}`}, in ${route.file}`),
        'No doc names these endpoints:',
    );
});

test('every HTTP status the docs name is one the server sends', () => {
    expectNone(
        statusMentions().filter(({ status }) => !statuses.has(status)).map(({ status, at }) => `${at}: ${status}`),
        'The docs name these HTTP statuses, but the server never sends them:',
    );
});

test('every HTTP status the server sends is in a status table in the docs', () => {
    const inTables = new Set(statusTableEntries().map(({ status }) => status));
    expectNone(
        [...statuses].filter(([status]) => !inTables.has(status)).map(([status, sentBy]) => `${status}, sent by ${sentBy.join(', ')}`),
        'These need a row in a table whose first column is "Status" or "Code", such as DGUP\'s error model:',
    );
});

// Existing somewhere isn't enough for these: core's own tests and the Web UI
// still name a code after core stops giving it.
test('every error code the docs list is one the server, the client or core gives', () => {
    expectNone(
        errorCodeTableEntries().filter(({ name }) => !productErrorCodes.has(name)).map(({ name, at }) => `${at}: ${name}`),
        'The docs list these error codes, but nothing gives them:',
    );
});

test('every error code the server, the client and core give has a row in an error code table', () => {
    const listed = new Set(errorCodeTableEntries().map(({ name }) => name));
    expectNone(
        [...productErrorCodes].filter(([code]) => !listed.has(code)).map(([code, givenBy]) => `${code}, given by ${givenBy.join(', ')}`),
        'These need a row in a table with a column headed "Code", such as core\'s error classes in docs/core/errors.md:',
    );
});
