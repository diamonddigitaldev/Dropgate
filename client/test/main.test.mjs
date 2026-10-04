// Guards on main.js and the page: what the client takes from electron-kit,
// checked with the kit's own helpers, every window's security settings, and
// the privacy rules the kit's options carry (hard requirement 8).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { balancedBlock, constructorOptions, readSource } from './helpers/source.mjs';

const require = createRequire(import.meta.url);
const { assertAccentContrast, assertNoBareAccelerators, assertBuildExtendsKit } = require('@diamonddigitaldev/electron-kit/testing');
const { SETTINGS_DEFAULTS, SETTINGS_SCHEMA_VERSION, V3_STORE_KEYS } = require('../src/constants.js');
const { menuItems } = require('../src/menu.js');
const pkg = require('../package.json');
// The electron-builder config, from the kit's config(), as electron-builder reads it.
const build = require('../electron-builder.cjs');

const SRC = new URL('../src/', import.meta.url);
const main = readSource('main.js');
const renderer = readSource('renderer.js');
const html = readSource('index.html');
const css = readSource('styles.css');

/** kit.start()'s options, as source text. */
const startOptions = () => balancedBlock(main, main.indexOf('{', main.indexOf('.start(')));

test('the accent meets WCAG 2.2 AA in both themes, and no other colour is the brand\'s', () => {
    assertAccentContrast(fileURLToPath(new URL('styles/accent.css', SRC)));
    // The accent lives in accent.css only; the app's own styles use the kit's tokens and Bootstrap's.
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'styles.css has a hex colour');
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(html), 'index.html has a hex colour');
});

test('the menu\'s own items each need a modifier, and Credits has none', () => {
    const items = menuItems({ openFile: () => {} });
    assertNoBareAccelerators(items);
    assert.deepEqual(items.map((i) => [i.label, i.accelerator]), [['Open File', 'CmdOrCtrl+O']]);
    assert.ok(!/Menu\.(setApplicationMenu|buildFromTemplate)/.test(main), 'the menu is the kit\'s');
});

test('the main process is the kit\'s: its name, settings, memory log, files, credits, menu, updater and link allowlist', () => {
    const options = startOptions();
    assert.match(options, /name: APP_NAME,/);
    assert.match(options, /defaults: SETTINGS_DEFAULTS,/);
    assert.match(options, /version: SETTINGS_SCHEMA_VERSION,/);
    assert.match(options, /obsoleteKeys: V3_STORE_KEYS,/);
    assert.match(options, /log: 'memory',/);
    // #93: the files it's opened with reach the page, bar a Share with Dropgate launch's, which main uploads.
    assert.match(options, /files: \{ except: \['--upload'\] \},/);
    // As in v3, a launch for Share with Dropgate doesn't check for updates.
    assert.match(options, /updates: wasLaunchedForBackgroundTask \? \{ checkOnLaunch: false \} : \{\},/);
    assert.match(options, /openExternal: \{ allow: \['https:\/\/github\.com\/diamonddigitaldev\/Dropgate\/'\] \}/);
    assert.match(options, /donate: 'https:\/\/buymeacoff\.ee\/willtda'/);
});

test('a link is copied kept out of the clipboard\'s history and sync, and notifications and the log never name a file (PB-D5, PB-D6)', () => {
    assert.doesNotMatch(main + renderer, /writeText\(|execCommand\('copy'\)/, 'every copy goes through copyPrivately()');
    for (const format of ['CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard', 'ExcludeClipboardContentFromMonitorProcessing', 'x-kde-passwordManagerHint']) {
        assert.ok(main.includes(`'${format}'`), format);
    }
    assert.match(main, /clipboard\.write\(\[new ClipboardItem\(item\)\]\)/, 'the link and its formats are written at once');
    assert.match(renderer, /api\.copyLink\(/, 'the page\'s Copy button copies through main');
    // The window's title, which the taskbar shows, gives the step and the percentage, never the progress text with its file name.
    assert.doesNotMatch(main, /setTitle\([^;]*progressData\.text/);
    assert.match(main, /setTitle\(`\$\{APP_NAME\} — \$\{progressData\.step\}`\)/);
    // Each notification's body is a count, never a name.
    for (const [, body] of main.matchAll(/showNotification\('[^']+', ([^)]+)\)/g)) {
        assert.doesNotMatch(body, /basename|\.name\b|filePath/, body);
    }
    // A log line gives an error's code, never its message, which can hold a path.
    for (const [call] of main.matchAll(/kit\.log\.\w+\([^;]*;/g)) {
        assert.doesNotMatch(call, /, (error|err)\)/, call);
    }
});

test('the client keeps no log of its own, and has no updater, update boxes or link opener of its own', () => {
    assert.ok(!/debug\.log|appendFileSync|writeFileSync|console\.log/.test(main), 'main.js logs through kit.log only');
    assert.ok(!/electron-updater|autoUpdater/.test(main), 'the updater is the kit\'s');
    assert.ok(!/Update Available|Update Ready|showMessageBox/.test(main), 'no native update boxes');
    assert.ok(!/shell\.openExternal|open-external/.test(main), 'links open through the kit\'s shell:open-external');
    assert.ok(!/requestSingleInstanceLock/.test(main), 'one instance is the kit\'s');
    assert.ok(!/console\.log/.test(renderer), 'the page logs nothing to its console: v3 logged file names and paths (PB-D9)');
});

test('v3\'s settings are dropped, once, and the client\'s defaults are ones the kit takes', () => {
    assert.equal(SETTINGS_SCHEMA_VERSION, 1);
    assert.deepEqual([...V3_STORE_KEYS].sort(), ['lifetimeUnit', 'lifetimeValue', 'maxDownloads', 'serverURL']);
    assert.ok(!V3_STORE_KEYS.includes('windowBounds'), 'the window\'s bounds are the kit\'s key too, so they carry over');
    // kit.start() throws at launch on either; this says so before then.
    for (const key of ['navCollapsed', 'autoDownloadUpdates', 'updateChannel', 'keepLogOnDisk']) {
        assert.ok(!Object.hasOwn(SETTINGS_DEFAULTS, key), `${key} is one of the kit's own settings`);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(SETTINGS_DEFAULTS)), { ...SETTINGS_DEFAULTS }, 'every default is a JSON value');
    assert.equal(typeof SETTINGS_DEFAULTS.lifetimeValue, 'number', 'v3 kept the lifetime as text');
    assert.equal(typeof SETTINGS_DEFAULTS.maxDownloads, 'number', 'v3 kept Max Downloads as text');
});

test('the main window is the kit\'s, and Share with Dropgate\'s hidden window keeps the house\'s security settings', () => {
    assert.match(main, /kit\.windows\.createMain\(\{/);
    assert.match(main, /webPreferences: \{ preload: path\.join\(__dirname, 'preload\.js'\) \}/);

    // Checked per window, so a new window can't leave out a setting unnoticed.
    const windows = constructorOptions(main, 'BrowserWindow');
    assert.equal(windows.length, 1, 'expected one window of the client\'s own: the hidden one for Share with Dropgate');
    for (const options of windows) {
        assert.ok(options, 'a window isn\'t given an object literal, so its settings can\'t be checked');
        const prefs = balancedBlock(options, options.indexOf('{', options.search(/webPreferences:\s*\{/)));
        assert.match(prefs, /preload:/);
        assert.match(prefs, /sandbox:\s*true/);
        assert.match(prefs, /contextIsolation:\s*true/);
        assert.match(prefs, /nodeIntegration:\s*false/);
    }
    assert.match(main, /backgroundWindow\.removeMenu\(\)/, 'the house menu is the main window\'s');

    // Nothing anywhere in main.js turns them back off, for any window.
    for (const setting of [/contextIsolation:\s*false/, /nodeIntegration:\s*true/, /sandbox:\s*false/, /webSecurity:\s*false/]) {
        assert.doesNotMatch(main, setting);
    }
});

test('the build is the kit\'s config(): its base, the asking installer, Open With for any file on Linux, and the client\'s own', () => {
    assertBuildExtendsKit(build);
    assert.ok(!Object.hasOwn(pkg, 'build'), 'package.json has no build: electron-builder would read it before electron-builder.cjs');
    assert.ok(!fs.existsSync(new URL('../installer.nsh', import.meta.url)), 'the right-click entry is the kit\'s contextMenu');
    assert.deepEqual(build.publish, { provider: 'github', owner: 'diamonddigitaldev', repo: 'Dropgate' });
    assert.equal(build.appId, 'com.diamonddigitaldev.dropgateclient');
    // The installer's name is what its update files point at: unchanged from v3. Only it is a Setup.
    assert.equal(build.nsis.artifactName, 'Dropgate-Client-Setup-${version}.${ext}');
    assert.equal(build.artifactName, 'Dropgate-Client-${version}.${ext}');
    assert.ok(!build.mac, 'there\'s no macOS build');

    // The kit's installer asks who it's for (only for the person, by default) and keeps an install for everyone.
    assert.deepEqual([build.nsis.oneClick, build.nsis.perMachine, build.nsis.allowElevation], [false, false, true]);
    // It claims no file type: v3's ext "*" registered a literal ".*" extension, so it never did anything.
    assert.equal(JSON.stringify(build).includes('fileAssociations'), false);
    const installer = fs.readFileSync(build.nsis.include, 'utf8');
    assert.match(installer, /Share with Dropgate/, 'the installer asks about the right-click entry');
    assert.match(installer, /--upload/, 'which launches the app with the file, then --upload');

    // Linux: Open With for any file, every file it's opened with, and its window matching its .desktop file.
    assert.deepEqual(build.linux.mimeTypes, ['application/octet-stream']);
    assert.deepEqual(build.linux.executableArgs, ['%F']);
    assert.equal(build.linux.category, 'Network');
    assert.equal(build.extraMetadata.desktopName, `${build.appId}.desktop`);
    // The Windows app ID is the one the installer's shortcut carries, so notifications show.
    assert.match(main, new RegExp(`\\bappId: '${build.appId.replace(/\./g, '\\.')}',`));
    assert.doesNotMatch(main, /setAppUserModelId/, 'the kit sets it, from start({ appId })');
});

test('the packaged app holds what it loads: the client\'s src/, and only the kit\'s, Bootstrap\'s and Material Icons\' files the pages use', () => {
    const { files } = build;
    assert.equal(files[0], 'src/**/*', 'an allowlist: the client\'s own files are its src/');
    assert.ok(!files.includes('**/*'));
    for (const out of ['testing', 'builder']) assert.ok(files.some((f) => f.startsWith('!node_modules/@diamonddigitaldev/electron-kit/') && f.includes(out)), `the kit's ${out}/`);
    assert.ok(files.includes('!node_modules/bootstrap/dist/css/!(bootstrap.min.css)'));
    assert.ok(files.includes('!node_modules/bootstrap/dist/js{,/**/*}'), 'the page loads no Bootstrap script');
    assert.ok(files.includes('!node_modules/material-icons/iconfont/!(round.css|material-icons-round.woff|material-icons-round.woff2)'));
    // What the page loads from node_modules is what the allowlist keeps.
    const loaded = [...html.matchAll(/(?:href|src)="\.\.\/node_modules\/([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(loaded, [
        '@diamonddigitaldev/electron-kit/css/kit.css',
        '@diamonddigitaldev/electron-kit/page/kit.js',
        '@diamonddigitaldev/electron-kit/page/theme.js',
        'bootstrap/dist/css/bootstrap.min.css',
        'material-icons/iconfont/round.css',
    ]);
});

test('the page links the kit\'s styles after Bootstrap\'s and before its own, and loads kit.js before renderer.js', () => {
    const order = (list) => list.map((needle) => {
        const at = html.indexOf(needle);
        assert.ok(at >= 0, `index.html loads ${needle}`);
        return at;
    });
    const styles = order(['bootstrap/dist/css/bootstrap.min.css', 'material-icons/iconfont/round.css', 'electron-kit/css/kit.css', '"styles/accent.css"', '"styles.css"', 'electron-kit/page/theme.js', '</head>']);
    assert.deepEqual(styles, [...styles].sort((a, b) => a - b), 'Bootstrap, Material Icons, kit.css, accent.css, styles.css, then theme.js in <head>');
    const scripts = order(['electron-kit/page/kit.js"', '<script type="module" src="renderer.js">']);
    assert.deepEqual(scripts, [...scripts].sort((a, b) => a - b));
    assert.ok(!fs.existsSync(new URL('credits.html', SRC)), 'Credits is the last tab of Settings: the window is gone');
});

test('the shell and the shared parts are the kit\'s: no modal, drop zone, progress bar or theme script of the client\'s own', () => {
    for (const call of ['kit.ui.mountShell(', 'kit.ui.dropZone(', 'kit.ui.actionBar(', 'kit.ui.confirm(', 'kit.ui.toast(', 'kit.format.countOf(', 'kit.format.formatBytes(']) {
        assert.ok(renderer.includes(call), `renderer.js uses ${call}`);
    }
    assert.match(renderer, /busy: async \(\) =>/, 'Restart Now asks first while an upload runs');
    for (const own of ['bootstrap.Modal', 'bootstrap.Tooltip', 'innerHTML', 'alert(', 'dragover']) {
        assert.ok(!renderer.includes(own), `renderer.js has ${own}`);
    }
    for (const markup of ['insecure-upload-modal', 'progress-bar', 'drop-zone', 'prefers-color-scheme', 'data-bs-theme']) {
        assert.ok(!html.includes(markup), `index.html has ${markup}`);
    }
    for (const selector of ['.nav-rail', '.nav-item', '.app-frame', '.app-header', '.kit-', '.toast', '.modal', '.progress']) {
        assert.ok(!css.includes(selector), `styles.css must not restyle ${selector}`);
    }
});

test('every icon is hidden from screen readers, and every icon-only button has a name', () => {
    const spans = html.match(/<span class="material-icons-round[^>]*>/g) ?? [];
    assert.ok(spans.length > 0);
    for (const span of spans) assert.match(span, /aria-hidden="true"/, span);
    // The icons the page makes; the ones in index.html (whose glyph it changes) are checked above.
    const created = new Set([...renderer.matchAll(/const (\w+) = document\.createElement\('span'\)/g)].map((m) => m[1]));
    const made = [...renderer.matchAll(/(\w+)\.className = 'material-icons-round[^']*';/g)].map((m) => m[1]).filter((name) => created.has(name));
    assert.ok(made.length > 0);
    for (const name of made) {
        assert.ok(renderer.includes(`${name}.setAttribute('aria-hidden', 'true');`), `${name} isn't aria-hidden`);
    }
    assert.match(renderer, /removeBtn\.setAttribute\('aria-label', `Remove \$\{f\.name\}`\)/);
});

test('the copy is the house\'s: Title Case buttons and titles, sentence case labels and status, one-character ellipses', () => {
    const text = renderer + html;
    for (const slip of ['File Lifetime</label>', 'Max Downloads</label>', 'Your Link:', '...\'', '...`', '..."', 'file(s)', 'Upload successful!']) {
        assert.ok(!text.includes(slip), `"${slip}"`);
    }
    for (const title of ['Upload Security Warning', 'Upload Anyway', 'Drag & Drop Files Here', 'Add More']) {
        assert.ok(text.includes(title), `"${title}"`);
    }
});
