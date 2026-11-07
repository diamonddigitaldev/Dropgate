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

The tests run in plain Node, with no browser environment. The P2P tests use stand-ins for the PeerJS objects (core's [`tests/helpers/fake-peer.ts`](../../packages/dropgate-core/tests/helpers/fake-peer.ts)), and most client tests use a fake server passed in as `fetchFn`. [`tests/hosted.test.ts`](../../packages/dropgate-core/tests/hosted.test.ts) runs against the real Dropgate Server instead, started by the server tests' own harness in a temporary folder on `127.0.0.1`, so install the server's dependencies first (`npm ci` in `server/`). No test reaches beyond your machine, or needs a PeerJS server. The Web UI and the Dropgate Client are tested in real browsers and Electron by the [integration tests](../../tests/integration/README.md).

Core's crypto is checked against published known answers, on both of its crypto providers, Web Crypto and `@noble` ([Crypto](crypto.md)). CPace, the exchange a typed code will run, is pinned by its own draft's test vectors, draft-irtf-cfrg-cpace-21's Appendix A.1, A.3, B.1 and B.1.10 (the generator, both shares, the shared point, both session keys, the session-ID output and the low-order points that must abort), copied from the draft's own JSON into [`tests/fixtures/cpace-x25519-sha512-vectors.json`](../../packages/dropgate-core/tests/fixtures/cpace-x25519-sha512-vectors.json), which says where each value came from. X25519, SHA-256, SHA-512, HMAC, HKDF and AES-GCM with associated data are checked against RFC 7748, FIPS 180-4, RFC 4231, RFC 5869, the GCM specification's own test cases, a NIST AES-256-GCM vector, and Project Wycheproof's AES-256-GCM tests with a 96-bit IV, in [`tests/fixtures/wycheproof-aes-gcm-256.json`](../../packages/dropgate-core/tests/fixtures/wycheproof-aes-gcm-256.json) (which says where they came from). [`tests/crypto.test.ts`](../../packages/dropgate-core/tests/crypto.test.ts) also gives both providers the same random inputs and checks they give the same bytes, and [`tests/object.test.ts`](../../packages/dropgate-core/tests/object.test.ts) makes DGUP 4's object vectors on each and opens each one's objects with the other. [`tests/provider-choice.test.ts`](../../packages/dropgate-core/tests/provider-choice.test.ts) checks which provider core chooses: Web Crypto in Node, every operation on it, with a spy showing `@noble`'s provider is never made; `@noble` for everything with no `crypto.subtle`, or one that can't make an X25519 key, with nothing more reaching `crypto.subtle` after the one probe. The CPace and provider checks ([`tests/helpers/cpace-vectors.ts`](../../packages/dropgate-core/tests/helpers/cpace-vectors.ts) and [`provider-vectors.ts`](../../packages/dropgate-core/tests/helpers/provider-vectors.ts)) also run in Chromium, Firefox and WebKit, through the integration tests' [`core/crypto-vectors.spec.mjs`](../../tests/integration/core/crypto-vectors.spec.mjs), on the provider core chooses in each engine (Web Crypto in Chromium and Firefox, and in WebKit where it has X25519; `@noble` in Playwright's WebKit on Windows, which has none) and on `@noble` in all three, so every browser engine is held to the same bytes as Node. Each test records the provider chosen.

`@noble/curves`, `@noble/hashes` and `@noble/ciphers` are dev dependencies pinned to an exact version, compiled into every build (ESM, CommonJS, the browser bundle and the two copies below), so core's package still lists no runtime dependencies. Every build starts with their MIT notice, written from their LICENSE files by [`scripts/third-party.mjs`](../../packages/dropgate-core/scripts/third-party.mjs), and [`THIRD-PARTY-NOTICES.md`](../../packages/dropgate-core/THIRD-PARTY-NOTICES.md), in the package, has each licence in full (`npm run notices` writes it again). [`tests/build.test.ts`](../../packages/dropgate-core/tests/build.test.ts) checks, after `npm run build`, that no build file imports `@noble/`, that each holds its code and the notice, that the notices file matches the installed licences, that the pins match the lockfile, and that [Crypto](crypto.md)'s audit table names the same versions. A dependency update that moves `@noble` updates that table too: its versions, the audits as each package's README lists them, and the date checked.

DGUP 4's encrypted object (its header, keys, chunks, padding and file list) is pinned byte for byte in [`tests/fixtures/dgup4-object-vectors.json`](../../packages/dropgate-core/tests/fixtures/dgup4-object-vectors.json). The vectors were made by [`tests/helpers/reference-object.mjs`](../../packages/dropgate-core/tests/helpers/reference-object.mjs), a second implementation on `node:crypto`, written from the format rather than from core's code. Core's tests check that both make exactly those bytes, and anything else that builds the object, such as the server's tests, can be checked against the same file.

Core's ZIP writer is tested two ways. [`tests/zip.test.ts`](../../packages/dropgate-core/tests/zip.test.ts) reads each archive back with a reader of its own, written from PKWARE's format description rather than from the writer, including one member of 4 GiB + 1 byte, offsets past 4 GiB and 65,535 members, which take about 6 seconds between them. Runs of zeros are recorded as their length, so those archives never sit in memory. In GitHub Actions, readers that aren't core's then check the same kinds of archive whole: [`tests/zip-readers/write-archive.mjs`](../../packages/dropgate-core/tests/zip-readers/write-archive.mjs) writes each with the build, and Info-ZIP's `unzip -t` and [`check_archive.py`](../../packages/dropgate-core/tests/zip-readers/check_archive.py), on Python's `zipfile`, read it back. To run them yourself, after `npm run build` (two of the archives are over 4 GiB, written one at a time):

```bash
node tests/zip-readers/write-archive.mjs member-4gib /tmp/zips
unzip -tq /tmp/zips/member-4gib.zip
python3 tests/zip-readers/check_archive.py /tmp/zips/member-4gib.zip /tmp/zips/member-4gib.json
```

The kinds are `classic`, `member-4gib`, `offsets-4gib` and `members-65536`.

Core's [`tests/copies.test.ts`](../../packages/dropgate-core/tests/copies.test.ts) checks that the server's and the client's copies are the build in `dist/`, so run it, and `tests/build.test.ts`, after `npm run build`.

Outside the repository, for example unpacked from a release's `dropgate-core-<version>.tar.gz`, there are no copies. The build then says so and writes none, and their tests are skipped. A test that always runs checks this only happens when the server's and the client's copies aren't there.

GitHub Actions runs these steps on Ubuntu ([`ci.yml`](../../.github/workflows/ci.yml)). It fails if the build changes either copy: that means a copy was edited by hand, or not built again after a change to core. The release workflow also runs them in core's source archive, unpacked on its own, and then stages the package on npm with provenance, through npm's trusted publishing, so no npm token is kept in GitHub. A staged version isn't on npm until a maintainer approves it there, with two-factor authentication. The workflow's dry run runs npm's dry run of publishing instead ([Releases](../../README.md#releases)).

Core shares its version with the server and the client, and they're released together ([Releases](../../README.md#releases)). Change it in `package.json`, `package-lock.json` and the version badge at the top of [core's README](../../packages/dropgate-core/README.md) together, or GitHub Actions fails.
