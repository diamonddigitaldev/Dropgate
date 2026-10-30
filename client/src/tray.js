'use strict';

const { Menu, Tray, nativeImage } = require('electron');
const { APP_NAME } = require('./constants');
const { countsLine } = require('./core/notices');

// Dropgate's own tray icon (17 §5: "Dropgate first; kit if a second app wants
// it"): shown while the main window is closed with transfers running, paused
// or queued, so they go on out of sight. Its menu opens the window, says how
// many are going (counts only, never a name), and quits. Windows shows it in
// the notification area; Linux where the desktop has a tray.

/**
 * @param {object} options
 * @param {string} options.icon - The app's icon, without its extension (as kit.windows' icon).
 * @param {() => void} options.open - Open Dropgate Client: show the main window.
 * @param {() => void} options.quit - Quit, cancelling everything.
 */
function createTray({ icon, open, quit }) {
    /** @type {Tray | null} */
    let tray = null;

    const image = () => (process.platform === 'win32'
        ? nativeImage.createFromPath(`${icon}.ico`)
        : nativeImage.createFromPath(`${icon}.png`).resize({ width: 32, height: 32 }));

    function draw(counts) {
        const line = countsLine(counts);
        tray.setToolTip(`${APP_NAME}: ${line}`);
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: `Open ${APP_NAME}`, click: open },
            { label: line, enabled: false },
            { type: 'separator' },
            { label: 'Quit', click: quit },
        ]));
    }

    return {
        /** Show the icon, with these counts. */
        show(counts) {
            if (!tray) {
                tray = new Tray(image());
                // Windows opens the window on a click; Linux's trays open the menu.
                tray.on('click', open);
            }
            draw(counts);
        },
        /** The counts changed: redrawn, if it's showing. */
        update(counts) {
            if (tray) draw(counts);
        },
        /**
         * Take the icon away: the window is open again, or the app is quitting.
         * Destroyed once the event that asked has returned: Open and Quit ask
         * from the icon's own menu, and on Linux destroying a tray inside its
         * menu's click took the app down with it.
         */
        hide() {
            const gone = tray;
            tray = null;
            if (gone) setImmediate(() => gone.destroy());
        },
        get showing() {
            return tray !== null;
        },
    };
}

module.exports = { createTray };
