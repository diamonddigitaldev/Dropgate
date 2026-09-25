// Guards on main.js: every window's security settings, and the menu's
// keyboard shortcuts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { balancedBlock, constructorOptions, readSource } from './helpers/source.mjs';

const main = readSource('main.js');

test('every window keeps context isolation on, Node integration off and the sandbox on', () => {
    // Checked per window, so a new window can't leave out a setting unnoticed.
    const windows = constructorOptions(main, 'BrowserWindow');
    assert.ok(windows.length > 0, 'expected main.js to create windows');

    windows.forEach((options, i) => {
        const which = `window ${i + 1} of ${windows.length}`;
        assert.ok(options, `${which} isn't given an object literal, so its settings can't be checked`);

        const at = options.search(/webPreferences:\s*\{/);
        assert.ok(at >= 0, `${which} has no webPreferences`);
        const prefs = balancedBlock(options, options.indexOf('{', at));
        assert.match(prefs, /preload:/, `${which} has no preload`);
        assert.match(prefs, /contextIsolation:\s*true/, `${which} doesn't set contextIsolation: true`);
        assert.match(prefs, /nodeIntegration:\s*false/, `${which} doesn't set nodeIntegration: false`);
    });

    // Nothing anywhere in main.js turns them back off, for any window.
    for (const setting of [/contextIsolation:\s*false/, /nodeIntegration:\s*true/, /sandbox:\s*false/, /webSecurity:\s*false/]) {
        assert.doesNotMatch(main, setting);
    }
});

test('no menu shortcut is a key without a modifier', () => {
    // Electron registers menu accelerators whatever has focus, so a bare "C"
    // would fire on every "c" typed into a text field. Function keys are
    // shortcuts nobody types, so they're allowed alone.
    const accelerators = [...main.matchAll(/accelerator:\s*(['"`])([^'"`]+)\1/g)].map((match) => match[2]);
    assert.ok(accelerators.length > 0, 'expected the menu to have shortcuts');
    assert.equal(accelerators.length, [...main.matchAll(/accelerator:/g)].length,
        'every accelerator should be a string literal, so it can be checked');

    const bare = accelerators.filter((key) => !key.includes('+') && !/^F\d{1,2}$/.test(key));
    assert.deepEqual(bare, [], `these shortcuts need a modifier: ${bare.join(', ')}`);
});
