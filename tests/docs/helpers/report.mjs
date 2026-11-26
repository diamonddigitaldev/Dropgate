import assert from 'node:assert/strict';

/**
 * Fails with a heading and one line per problem, if there are any. Each line
 * says where the problem is, so the output is the to-do list.
 */
export function expectNone(problems, heading) {
    if (problems.length) assert.fail(`${heading}\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
}
