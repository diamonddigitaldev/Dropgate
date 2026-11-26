// Writes the desktop app's build config for the update tests: the config in
// client/electron-builder.cjs, made by the kit's config(), with its update
// address swapped for the tests' update server on this machine (tests/integration/helpers/update-server.mjs).
// CI's desktop job builds the app with it, from client/, and the tests run that
// build (desktop/updates.spec.mjs). It's never published or attached.
//
//   node ../.github/scripts/client-test-build-config.mjs <file to write>
//
// electron-builder's command line can't swap publish: it merges into the
// GitHub config, which then fails validation. A whole config file replaces it.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const out = process.argv[2];
if (!out) {
    console.error('Usage: node client-test-build-config.mjs <file to write>');
    process.exit(2);
}

// The port is the one the update server listens on, which the build writes into the app.
const { UPDATE_PORT } = await import(new URL('../../tests/integration/helpers/update-server.mjs', import.meta.url));

// From client/, so the kit's config() resolves from the client's node_modules.
const build = createRequire(path.resolve('package.json'))('./electron-builder.cjs');
build.publish = { provider: 'generic', url: `http://127.0.0.1:${UPDATE_PORT}/` };
fs.writeFileSync(out, `${JSON.stringify(build, null, 2)}\n`);
console.log(`Wrote ${out}: the app's build config, updating from ${build.publish.url}.`);
