import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ROOT, inRepository } from '../scripts/copy-contents.mjs';
import { NOBLE, buildBanner, licenceOf, noticesFile } from '../scripts/third-party.mjs';

// @noble/curves, @noble/hashes and @noble/ciphers are compiled into every one
// of core's builds from exact pins, so core's package lists no runtime
// dependencies, an integrator's tree can't swap the version, and the web UI's
// and the desktop app's single-file copies carry them, with their MIT notice.
// These fail if a build file still imports @noble/ (it would break those
// copies, and unpin it), if a build or the notices file lacks the licence, if
// the pins or the package's empty dependencies change, or if the audit note in
// docs/core/crypto.md names another version than the lockfile's.
// And no build imports werift or node-datachannel, the Node WebRTC libraries
// core's tests run on: dev dependencies only, which an integrator passes in.
// CI builds before it tests; locally, run npm run build first.

const PACKAGE = new URL('../package.json', import.meta.url);
const LOCK = new URL('../package-lock.json', import.meta.url);
const NOTICES = new URL('../THIRD-PARTY-NOTICES.md', import.meta.url);
const AUDIT_NOTE = new URL('docs/core/crypto.md', ROOT);

const BUILDS = ['index.js', 'index.cjs', 'index.browser.js', 'p2p/index.js', 'p2p/index.cjs'];
const COPIES = ['server/public/js/dropgate-core.js', 'client/src/dropgate-core.js'];

/** An import or require of a @noble/ module: static, dynamic or CommonJS. */
const IMPORTS_NOBLE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]@noble\//;

/**
 * The Node WebRTC libraries core's tests run on: dev dependencies only, never
 * in a build. An integrator passes one in; the web UI and the desktop app use
 * the browser's own.
 */
const NODE_WEBRTC = ['werift', 'node-datachannel'];

/** An import or require of `name` or a path in it, static, dynamic or CommonJS. */
const imports = (name: string) => new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*|\\brequire\\s*\\(\\s*)["'\`]${name}(?:/[^"'\`]*)?["'\`]`);

const pkg = JSON.parse(readFileSync(PACKAGE, 'utf8'));
const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
const installed = (name: string): string | undefined => lock.packages[`node_modules/${name}`]?.version;

describe("Core's builds carry @noble compiled in", () => {
  const files = [
    ...BUILDS.map((name) => ({ name: `dist/${name}`, url: new URL(`../dist/${name}`, import.meta.url) })),
    ...(inRepository() ? COPIES.map((name) => ({ name, url: new URL(name, ROOT) })) : []),
  ];

  for (const { name, url } of files) {
    it(`${name} imports nothing from @noble/, and holds its code and its MIT notice`, () => {
      expect(existsSync(url), `${name} is missing: run npm run build first`).toBe(true);
      const build = readFileSync(url, 'utf8').replace(/\r\n/g, '\n');
      expect(IMPORTS_NOBLE.test(build), `${name} imports @noble/`).toBe(false);
      // Elligator 2's constant J, from @noble/curves' ed25519.js, and its licence line.
      expect(build).toContain('486662');
      expect(build).toContain('noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com)');
      // The notice at the top: every copyright line and the MIT License's terms, as the licence asks.
      expect(build, 'the MIT notice').toContain(buildBanner());
      expect(build.indexOf(buildBanner()), 'the notice near the top').toBeLessThan(400);
    });
  }

  it('the notice holds each package, its version, every copyright line and the terms', () => {
    const banner = buildBanner();
    for (const name of NOBLE) {
      expect(banner).toContain(`${name} ${pkg.devDependencies[name]}`);
      for (const line of licenceOf(name).split('\n').filter((l: string) => l.startsWith('Copyright (c)'))) expect(banner).toContain(line);
    }
    expect(banner).toContain('The above copyright notice and this permission notice shall be included in');
    expect(banner).toContain('THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR');
  });

  it('the check itself finds each way of importing', () => {
    for (const line of ['import { x } from "@noble/curves/ed25519.js";', "export * from '@noble/hashes/sha2.js'",
      'await import("@noble/ciphers/aes.js")', 'const n = require("@noble/curves/ed25519.js")', 'import"@noble/hashes"']) {
      expect(IMPORTS_NOBLE.test(line), line).toBe(true);
    }
    expect(IMPORTS_NOBLE.test('// node_modules/@noble/curves/ed25519.js')).toBe(false);
  });
});

describe("Core's builds carry no Node WebRTC library", () => {
  const files = [
    ...BUILDS.map((name) => ({ name: `dist/${name}`, url: new URL(`../dist/${name}`, import.meta.url) })),
    ...(inRepository() ? COPIES.map((name) => ({ name, url: new URL(name, ROOT) })) : []),
  ];

  for (const { name, url } of files) {
    it(`${name} imports neither werift nor node-datachannel, nor holds their code`, () => {
      expect(existsSync(url), `${name} is missing: run npm run build first`).toBe(true);
      const build = readFileSync(url, 'utf8');
      for (const library of NODE_WEBRTC) {
        expect(imports(library).test(build), `${name} imports ${library}`).toBe(false);
        expect(build.includes(`node_modules/${library}/`), `${name} holds ${library}'s code`).toBe(false);
      }
    });
  }

  it('the check itself finds each way of importing either', () => {
    for (const library of NODE_WEBRTC) {
      for (const line of [`import { RTCPeerConnection } from "${library}";`, `export * from '${library}/polyfill'`, `await import("${library}")`,
        `const w = require("${library}")`, `import"${library}"`, `require( \`${library}/lib/index.js\` )`]) {
        expect(imports(library).test(line), line).toBe(true);
      }
      expect(imports(library).test(`// tested on ${library} in Node`), library).toBe(false);
      expect(imports(library).test(`import x from "${library}-other"`), library).toBe(false);
    }
  });

  it('werift is a dev dependency only, pinned exactly at the version the lockfile installs', () => {
    expect(pkg.devDependencies.werift).toMatch(/^\d+\.\d+\.\d+$/);
    expect(installed('werift')).toBe(pkg.devDependencies.werift);
    for (const library of NODE_WEBRTC) {
      expect(pkg.dependencies?.[library], library).toBeUndefined();
      expect(pkg.peerDependencies?.[library], library).toBeUndefined();
      expect(pkg.optionalDependencies?.[library], library).toBeUndefined();
    }
  });
});

describe("Core's package", () => {
  it('has no runtime dependencies', () => {
    expect(pkg.dependencies).toBeUndefined();
  });

  it('pins each @noble package exactly, as a dev dependency, at the version the lockfile installs', () => {
    for (const name of NOBLE) {
      expect(pkg.devDependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(installed(name), name).toBe(pkg.devDependencies[name]);
      expect(pkg.peerDependencies?.[name], name).toBeUndefined();
    }
  });

  it('ships THIRD-PARTY-NOTICES.md, with each @noble licence in full as installed (npm run notices writes it)', () => {
    expect(pkg.files).toContain('THIRD-PARTY-NOTICES.md');
    const notices = readFileSync(NOTICES, 'utf8').replace(/\r\n/g, '\n');
    expect(notices, 'THIRD-PARTY-NOTICES.md differs from the installed licences: run npm run notices').toBe(noticesFile());
    for (const name of NOBLE) expect(notices).toContain(licenceOf(name));
  });
});

/** The audit note's table rows: each package, its version and the date it was checked. */
function auditRows(note: string) {
  return [...note.matchAll(/^\| `(@noble\/[a-z]+)` \| ([^|]+?) \| .+ \| ([^|]+?) \|$/gm)]
    .map(([, name, version, checked]) => ({ name, version, checked }));
}

describe.runIf(inRepository())('The audit note in docs/core/crypto.md', () => {
  const note = readFileSync(AUDIT_NOTE, 'utf8').replace(/\r\n/g, '\n');

  it("names each @noble package once, at the version the lockfile installs, with the date it was checked", () => {
    const rows = auditRows(note);
    expect(rows.map((row) => row.name).sort()).toEqual([...NOBLE].sort());
    for (const { name, version, checked } of rows) {
      expect(version, `${name}'s version in docs/core/crypto.md: update its row (version, audits, date checked)`).toBe(installed(name));
      expect(checked, `${name}'s date checked`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(checked))).toBe(false);
    }
  });

  it('the check itself fails on a version the lockfile doesn\'t install', () => {
    const moved = note.replace(`| \`@noble/hashes\` | ${installed('@noble/hashes')} |`, '| `@noble/hashes` | 0.0.0 |');
    expect(moved).not.toBe(note);
    expect(auditRows(moved).find((row) => row.name === '@noble/hashes')?.version).not.toBe(installed('@noble/hashes'));
    expect(auditRows(note.replace(/^\| `@noble\/ciphers`.*$/m, '')).map((row) => row.name)).not.toContain('@noble/ciphers');
  });
});
