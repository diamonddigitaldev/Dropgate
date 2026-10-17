'use strict';

const path = require('path');
const { fileURLToPath } = require('url');
const { app, ipcMain, session } = require('electron');
const { AT_ONCE_RANGE, KIT_SETTINGS_SET, MAIN_ONLY_SETTINGS } = require('./constants');
const { settingsChangesOf } = require('./core/payloads');

// The page's settings changes (kitAPI.setSettings()), answered by main in
// place of the kit, which takes any setting from the page. Two of Dropgate's
// aren't the page's to set as it likes: the downloads folder is chosen with
// the system's folder picker in main (folder:set-default), and a page that
// could set it could choose where every download lands, so a change naming it
// is refused (MAIN_ONLY_SETTINGS); and how many transfers run at once is held
// to the stepped slider's range, and main's registry is told as it changes.
// Everything else goes to the kit's own settings.set(), as the kit's handler
// does, the updater told and the log kept or deleted as before.
//
// kit-gap: https://github.com/diamonddigitaldev/electron-kit/issues/66
// (settings only main changes, and a way for main to hear the page's
// changes). Until a kit release has them, this takes over the kit's channel:
// the kit registers it in start(), so it's replaced straight after, with the
// kit's own sender check, the app's own page in the UI session only.

/**
 * Whether an IPC message came from the app's own page: a frame, still there,
 * showing a file:// page inside the app's own code, in the UI session (the
 * kit's own check, main/ipc.js' isAppPage(), which the kit doesn't export).
 * @param {Electron.IpcMainInvokeEvent} event
 */
function isAppPage(event) {
    const frame = event.senderFrame;
    if (!frame || event.sender.session !== session.defaultSession) return false;
    let file;
    try {
        const url = new URL(frame.url);
        if (url.protocol !== 'file:') return false;
        file = fileURLToPath(url);
    } catch {
        return false;
    }
    const relative = path.relative(app.getAppPath(), file);
    return relative !== '' && relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative);
}

/**
 * Answer the page's settings changes in place of the kit. Call straight after kit.start().
 * @param {object} options
 * @param {any} options.kit - The kit, from start(): its settings.
 * @param {(changes: object, after: object) => void} [options.onChange] - The page changed some settings.
 */
function guardSettings({ kit, onChange = () => {} }) {
    ipcMain.removeHandler(KIT_SETTINGS_SET);
    ipcMain.handle(KIT_SETTINGS_SET, (event, changes) => {
        if (!isAppPage(event)) throw new Error(`electron-kit answers "${KIT_SETTINGS_SET}" for the app's own page only.`);
        const checked = settingsChangesOf(changes, MAIN_ONLY_SETTINGS, AT_ONCE_RANGE);
        const after = kit.settings.set(checked);
        onChange(checked, after);
        return after;
    });
}

module.exports = { guardSettings, isAppPage };
