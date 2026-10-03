// The desktop app mustn't download anything from anyone but the server it's
// given. On Linux, Electron's built-in spell checker downloads its dictionaries
// from Google's servers as the app starts, which tells them each user's address
// and language; on Windows it uses Windows' own spell checker, and downloads
// nothing. v3 only ever shipped for Windows, but the v4 desktop client ships for
// Linux too, and turns the download off: electron-kit gives every session no
// spell-check languages, so there's nothing to download (v3 downloaded them on
// Linux).
//
// Every desktop test points the spell checker at a dead address on this machine
// instead (desktop-preload.cjs), so none of them could send that request out.
// This one points it at the test's own server, and checks the server is never
// asked, so the app's own behaviour stays visible.
import { expect, test } from '../helpers/desktop.mjs';

test('downloads no spell-check dictionaries', async ({ desktop, server }) => {
    desktop.dictionaryUrl = `${server.baseUrl}/dictionaries/`;
    const app = await desktop.launch();
    await app.window();
    const asked = () => server.requests().filter(({ url }) => url.startsWith('/dictionaries/')).map(({ method, url }) => `${method} ${url}`);
    // On Linux the request came as the app started. Give it time to come, then stop looking.
    await expect.poll(() => asked().length, { timeout: 10_000 }).toBeGreaterThan(0).catch(() => {});
    await app.quit();
    expect(asked(), 'the spell-check dictionaries the app asked for').toEqual([]);
});
