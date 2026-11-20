'use strict';

// The client's own items in the house menu. The kit builds the rest of it
// (Settings on CmdOrCtrl+,, Check for Updates, Toggle Developer Tools on a
// pre-release, Exit) and puts these first. Credits is the last tab of
// Settings, so it has no item, and v3's CmdOrCtrl+Shift+C is gone with it.
//
// Kept apart from main.js so test/kit.test.mjs can check the accelerators
// without launching Electron.

/**
 * @param {{ openFile: () => void }} actions
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function menuItems({ openFile }) {
    return [
        { label: 'Open File', accelerator: 'CmdOrCtrl+O', click: openFile },
    ];
}

module.exports = { menuItems };
