import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ROOT, inRepository } from '../scripts/copy-contents.mjs';

// @noble/curves, @noble/hashes and @noble/ciphers are compiled into every one
// of core's builds from exact pins, so core's package lists no runtime
// dependencies, an integrator's tree can't swap the version, and the web UI's
// and the desktop app's single-file copies carry them. These fail if a build
// file still imports @noble/ (it would break those copies, and unpin it), or if
// the pins or the package's empty dependencies change. CI builds before it
// tests; locally, run npm run build first.

const PACKAGE = new URL('../package.json', import.meta.url);
const LOCK = new URL('../package-lock.json', import.meta.url);
const NOBLE = ['@noble/ciphers', '@noble/curves', '@noble/hashes'];

const BUILDS = ['index.js', 'index.cjs', 'index.browser.js', 'p2p/index.js', 'p2p/index.cjs'];
const COPIES = ['server/public/js/dropgate-core.js', 'client/src/dropgate-core.js'];

/** An import or require of a @noble/ module: static, dynamic or CommonJS. */
const IMPORTS_NOBLE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]@noble\//;

describe("Core's builds carry @noble compiled in", () => {
  const files = [
    ...BUILDS.map((name) => ({ name: `dist/${name}`, url: new URL(`../dist/${name}`, import.meta.url) })),
    ...(inRepository() ? COPIES.map((name) => ({ name, url: new URL(name, ROOT) })) : []),
  ];

  for (const { name, url } of files) {
    it(`${name} imports nothing from @noble/, and holds its code and licence line`, () => {
      expect(existsSync(url), `${name} is missing: run npm run build first`).toBe(true);
      const build = readFileSync(url, 'utf8');
      expect(IMPORTS_NOBLE.test(build), `${name} imports @noble/`).toBe(false);
      // Elligator 2's constant J, from @noble/curves' ed25519.js, and its licence line.
      expect(build).toContain('486662');
      expect(build).toContain('noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com)');
    });
  }

  it('the check itself finds each way of importing', () => {
    for (const line of ['import { x } from "@noble/curves/ed25519.js";', "export * from '@noble/hashes/sha2.js'",
      'await import("@noble/ciphers/aes.js")', 'const n = require("@noble/curves/ed25519.js")', 'import"@noble/hashes"']) {
      expect(IMPORTS_NOBLE.test(line), line).toBe(true);
    }
    expect(IMPORTS_NOBLE.test('// node_modules/@noble/curves/ed25519.js')).toBe(false);
  });
});

describe("Core's package", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE, 'utf8'));
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));

  it('has no runtime dependencies', () => {
    expect(pkg.dependencies).toBeUndefined();
  });

  it('pins each @noble package exactly, as a dev dependency, at the version the lockfile installs', () => {
    for (const name of NOBLE) {
      expect(pkg.devDependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(lock.packages[`node_modules/${name}`]?.version, name).toBe(pkg.devDependencies[name]);
      expect(pkg.peerDependencies?.[name], name).toBeUndefined();
    }
  });
});
