# Building and Testing

Requires Node.js 24 or later. From `packages/dropgate-core`:

```bash
npm ci
npm run typecheck
npm run build
npx vitest run
```

The Dropgate Server's Web UI and the Dropgate Client load core's ESM build as their own copy, [`server/public/js/dropgate-core.js`](../../server/public/js/dropgate-core.js) and [`client/src/dropgate-core.js`](../../client/src/dropgate-core.js). `npm run build` writes both ([`scripts/copy-build.mjs`](../../packages/dropgate-core/scripts/copy-build.mjs)). They're committed, so the server, its Docker image and the client run and package without building core first. After changing core, build it and commit the copies with the change, and never edit them by hand. `npm run dev` only rebuilds `dist/`.

Tests for known issues are marked `it.fails`, and vitest counts them as "expected fail". Each one only counts as expected while it fails in the specific way its issue causes, so it fails once the issue is fixed, or if something else breaks it, and the marker can't be forgotten. Each test's name says what fixes it. To list them all:

```bash
npx vitest run --reporter=verbose
```

The tests run in plain Node, with no browser environment. The P2P tests use stand-ins for the PeerJS objects (core's [`tests/helpers/fake-peer.ts`](../../packages/dropgate-core/tests/helpers/fake-peer.ts)), and the client tests use a fake server passed in as `fetchFn`, so no test needs a network or a PeerJS server. The Web UI and the Dropgate Client are tested in real browsers and Electron by the [integration tests](../../tests/integration/README.md).

DGUP 4's encrypted object (its header, keys, chunks, padding and file list) is pinned byte for byte in [`tests/fixtures/dgup4-object-vectors.json`](../../packages/dropgate-core/tests/fixtures/dgup4-object-vectors.json). The vectors were made by [`tests/helpers/reference-object.mjs`](../../packages/dropgate-core/tests/helpers/reference-object.mjs), a second implementation on `node:crypto`, written from the format rather than from core's code. Core's tests check that both make exactly those bytes, and anything else that builds the object, such as the server's tests, can be checked against the same file.

Core's [`tests/copies.test.ts`](../../packages/dropgate-core/tests/copies.test.ts) checks that the server's and the client's copies are the build in `dist/`, so run it after `npm run build`.

Outside the repository, for example unpacked from a release's `dropgate-core-<version>.tar.gz`, there are no copies. The build then says so and writes none, and their tests are skipped. A test that always runs checks this only happens when the server's and the client's copies aren't there.

GitHub Actions runs these steps on Ubuntu ([`ci.yml`](../../.github/workflows/ci.yml)). It fails if the build changes either copy: that means a copy was edited by hand, or not built again after a change to core. The release workflow also runs them in core's source archive, unpacked on its own, and then stages the package on npm with provenance, through npm's trusted publishing, so no npm token is kept in GitHub. A staged version isn't on npm until a maintainer approves it there, with two-factor authentication. The workflow's dry run runs npm's dry run of publishing instead ([Releases](../../README.md#releases)).

Core shares its version with the server and the client, and they're released together ([Releases](../../README.md#releases)). Change it in `package.json`, `package-lock.json` and the version badge at the top of [core's README](../../packages/dropgate-core/README.md) together, or GitHub Actions fails.
