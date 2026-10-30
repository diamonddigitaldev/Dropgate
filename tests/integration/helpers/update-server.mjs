// A local update server for the packaged desktop app (desktop/updates.spec.mjs).
// The app's test build is told to look here (its publish config, set on
// electron-builder's command line in CI), on a fixed port, since the build
// writes the address into the app.
//
// It answers the channel files electron-builder writes: latest.yml, beta.yml
// and alpha.yml, with "-linux" on Linux. It never has the installer they name,
// so an update found is never downloaded or installed: the app can't run
// anything from here. It records every request, with its headers.
import crypto from 'node:crypto';
import http from 'node:http';

/** The port the test build's update address names. CI builds it with this. */
export const UPDATE_PORT = 47713;

/** The installer a channel file names, as the release names it on this platform: never served. */
const installer = (version) => (process.platform === 'win32' ? `Dropgate-Client-Setup-${version}.exe` : `Dropgate-Client-${version}.AppImage`);

/** A channel file, as electron-builder writes it, for a version. */
function channelFile(version) {
    const sha512 = crypto.createHash('sha512').update(`no installer for ${version}`).digest('base64');
    return [
        `version: ${version}`,
        'files:',
        `  - url: ${installer(version)}`,
        `    sha512: ${sha512}`,
        '    size: 1024',
        `path: ${installer(version)}`,
        `sha512: ${sha512}`,
        "releaseDate: '2026-10-03T12:00:00.000Z'",
        '',
    ].join('\n');
}

/**
 * Start the update server.
 * @param {Record<string, string>} channels - What each channel offers: { latest: '3.0.14', beta: '3.0.14-beta.1' }.
 *   A channel left out is a 404, as a release without that file would be.
 */
export async function startUpdateServer(channels) {
    /** @type {{ at: number, file: string, headers: Record<string, string | string[] | undefined> }[]} */
    const requests = [];
    const server = http.createServer((req, res) => {
        const file = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.slice(1));
        requests.push({ at: Date.now(), file, headers: { ...req.headers } });
        const channel = /^(\w+?)(-linux)?\.yml$/.exec(file)?.[1];
        if (channel && channels[channel]) {
            res.writeHead(200, { 'content-type': 'text/yaml' });
            res.end(channelFile(channels[channel]));
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(UPDATE_PORT, '127.0.0.1', resolve);
    });
    return {
        requests,
        /** The channel files asked for, in order. */
        channelFiles: () => requests.map((r) => r.file).filter((f) => f.endsWith('.yml')),
        close: () => new Promise((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
        }),
    };
}
