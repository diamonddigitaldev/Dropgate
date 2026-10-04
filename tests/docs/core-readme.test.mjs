// Core's npm README stays short and points into the repository, so a
// correction to the docs reaches npm's readers without a release: its only
// link into docs/ is the docs' contents on master, every other link into the
// repository is a file's full address on master, and it has no relative links.
// The contents list every page of docs/core/. The rules are checked on the real
// files, and on planted mistakes, so they can't pass by checking nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorCodes, productFiles, stripScriptComments } from './helpers/code.mjs';
import {
    CONTENTS, CONTENTS_URL, DOCS, README, exportedValues, importedNames, readmeProblems, unlistedPages,
} from './helpers/core-readme.mjs';
import { errorCodeTableEntries } from './helpers/docs.mjs';
import { isFile, markdownFiles, read } from './helpers/repo.mjs';
import { expectNone } from './helpers/report.mjs';

const pages = markdownFiles.filter((file) => file.startsWith(`${DOCS}/`));
const BLOB = 'https://github.com/diamonddigitaldev/Dropgate/blob/master/';

test('core\'s README links into the docs once, at their contents, and every other link into the repository is a file on master', () => {
    expectNone(readmeProblems(read(README), { isFile }), `Fix these links in ${README}:`);
});

test('the docs\' contents list every page of docs/core/', () => {
    assert.ok(isFile(CONTENTS), `${CONTENTS} isn't there`);
    assert.ok(pages.length > 1, `expected the pages of ${DOCS}/, but found ${pages.length}`);
    expectNone(unlistedPages(read(CONTENTS), pages), `${CONTENTS} doesn't list these pages:`);
});

test('the README\'s example only imports what core exports', () => {
    const entryPoints = {
        '@dropgate/core': 'packages/dropgate-core/src/index.ts',
        '@dropgate/core/p2p': 'packages/dropgate-core/src/p2p/index.ts',
    };
    const imports = importedNames(read(README));
    assert.ok(imports.length > 0, 'expected the README\'s example to import from @dropgate/core');
    expectNone(
        imports
            .filter(({ name, from }) => !entryPoints[from] || !exportedValues(stripScriptComments(read(entryPoints[from]))).has(name))
            .map(({ name, from }) => `${name}, from ${from}`),
        `${README} imports these, but core doesn't export them:`,
    );
});

// The error codes moved with the docs: core's are listed in docs/core/, not in
// the README npm shows.
test('every error code core gives is listed in docs/core/', () => {
    const listed = new Set(errorCodeTableEntries().filter(({ at }) => at.startsWith(`${DOCS}/`)).map(({ name }) => name));
    const core = [...errorCodes(productFiles)].filter(([, givenBy]) => givenBy.some((file) => file.startsWith('packages/dropgate-core/')));
    assert.ok(core.length > 0, 'expected core to give its errors codes');
    expectNone(core.filter(([code]) => !listed.has(code)).map(([code]) => code), `These need a row in an error code table in ${DOCS}/:`);
});

// The same rules on small examples, each with one mistake planted.
const files = new Set([CONTENTS, `${DOCS}/quick-start.md`, 'packages/dropgate-core/LICENSE', 'packages/dropgate-core/dropgate.png']);
const repo = { isFile: (file) => files.has(file) };
const good = [
    `![logo](${BLOB}packages/dropgate-core/dropgate.png?raw=true)`,
    `Start at [the docs' contents](${CONTENTS_URL}).`,
    `See the [LICENSE](${BLOB}packages/dropgate-core/LICENSE).`,
    '[Open an issue](https://github.com/diamonddigitaldev/Dropgate/issues) or [chat](https://diamonddigital.dev/discord).',
].join('\n\n');
const planted = (markdown) => readmeProblems(`${good}\n\n${markdown}`, repo);

test('a README that keeps the rules passes them', () => {
    assert.deepEqual(readmeProblems(good, repo), []);
});

test('a relative link fails, to a file, a folder or an anchor', () => {
    for (const link of ['[LICENSE](./LICENSE)', '[docs](../../docs/core/README.md)', '<img src="dropgate.png">', '[Install](#installation)']) {
        assert.equal(planted(link).length, 1, link);
        assert.match(planted(link)[0], /relative link/, link);
    }
});

test('a deep link into the docs fails: a page, an anchor, or the contents\' folder', () => {
    for (const link of [
        `[Quick Start](${BLOB}${DOCS}/quick-start.md)`,
        `[Errors](${CONTENTS_URL}#contents)`,
        `[docs](https://github.com/diamonddigitaldev/Dropgate/tree/master/${DOCS})`,
    ]) {
        assert.equal(planted(link).length, 1, link);
    }
});

test('a list of the docs\' pages fails', () => {
    const list = `* [Quick Start](${BLOB}${DOCS}/quick-start.md)\n* [Contents](${CONTENTS_URL})`;
    const problems = planted(list);
    assert.equal(problems.length, 2, problems.join('\n'));
    assert.ok(problems.some((problem) => /only link into docs/.test(problem)));
    assert.ok(problems.some((problem) => /linked 2 times/.test(problem)));
});

test('a link into the repository off master, or to a file that isn\'t there, fails', () => {
    for (const link of [
        `[LICENSE](https://github.com/diamonddigitaldev/Dropgate/blob/4.0.0/packages/dropgate-core/LICENSE)`,
        `[LICENSE](https://github.com/diamonddigitaldev/Dropgate/blob/v3.0.13/packages/dropgate-core/LICENSE)`,
        `![logo](https://raw.githubusercontent.com/diamonddigitaldev/Dropgate/master/packages/dropgate-core/dropgate.png)`,
        `[Notice](${BLOB}NOTICE.md)`,
    ]) {
        assert.equal(planted(link).length, 1, link);
    }
});

test('a README with no link to the contents fails', () => {
    assert.deepEqual(readmeProblems('No links at all.', repo), [`no link to the docs' contents, ${CONTENTS_URL}`]);
});

test('a page the contents don\'t list is found', () => {
    const contents = '* [Quick Start](quick-start.md)\n* [Errors](./errors.md#codes)';
    const all = [CONTENTS, `${DOCS}/quick-start.md`, `${DOCS}/errors.md`, `${DOCS}/p2p.md`];
    assert.deepEqual(unlistedPages(contents, all), [`${DOCS}/p2p.md`]);
});

test('an import core doesn\'t export is found', () => {
    const source = 'export { DropgateClient, getServerInfo } from \'./client.js\';\nexport type { Options } from \'./types.js\';\nexport const VERSION = \'1\';';
    const exported = exportedValues(source);
    assert.deepEqual([...exported].sort(), ['DropgateClient', 'VERSION', 'getServerInfo']);
    const imports = importedNames('```js\nimport { DropgateClient, Options, uploadFiles as up } from \'@dropgate/core\';\n```');
    assert.deepEqual(imports.filter(({ name }) => !exported.has(name)).map(({ name }) => name), ['Options', 'uploadFiles']);
});
