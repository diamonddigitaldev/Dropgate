# Dropgate Integration Tests

End-to-end tests that drive Dropgate's web UI in real browsers (Chromium, Firefox and WebKit), and its desktop app, with [Playwright Test](https://playwright.dev/).


## What They Cover

Each test sends files through the web UI the way a person would, then receives them on the page a recipient would use, and compares every byte and file name with what was sent:

* **A single file**, unencrypted and end-to-end encrypted, from the home page to the standard download page.
* **A bundle of three files**, unencrypted and end-to-end encrypted, from the home page to the bundle page: each file on its own, then all of them with "Download All as ZIP".
* **File lifetime.** A single file and a bundle, uploaded with a five-minute lifetime set on the home page, are still there after three minutes. After six, the link shows "not found" and the server holds none of their files. Bundles are checked unencrypted and end-to-end encrypted.
* **Max downloads.** With a limit of 2 set on the home page, a single file downloads twice, and then its link shows "not found". A bundle's files can each be downloaded on their own without using up the limit, because only "Download All as ZIP" counts, so it gives two ZIPs and then its link is gone. Each is checked unencrypted and end-to-end encrypted.
* **Direct transfer**, in Chromium, Firefox and WebKit (not WebKit on Windows, which has no WebRTC). A file sent from the home page reaches a receiver in a second, separate browser context, whether they type the code into the home page's "Enter Sharing Code" box or open the link. Several files sent together arrive as one ZIP.

For encrypted uploads, they also check that the files the server stores hold none of the plaintext and none of the file names.

The desktop app's tests launch it from [`client/`](../../client) and open its links in Chromium:

* **Settings.** A new profile starts with no server and the default options, and makes no requests. The server set in **Settings**, under **Server**, and the file lifetime and max downloads set on **Upload**, are what an upload uses, and its link downloads intact. After a restart, the server, file lifetime and max downloads are still set, and the next upload uses them. A server that has only been tested is remembered too.
* **The Settings view.** Its tabs are Dropgate's Server, then Update, then Credits, last, which shows the app's logo. The Update tab's automatic downloads switch and update channel are still set after a restart.
* **No log on disk.** Through an upload and a restart, the app writes no `debug.log`, or any other log file, to its profile.
* **No spell-check dictionaries.** The app asks for none, on Windows or Linux. (On Linux, Electron's spell checker downloads them from Google's servers as the app starts, unless the app turns it off.)
* **Updates**, in a packaged build of the app, since the updater only runs in one (below). On each channel, Stable, Beta and Alpha, two new installs check for updates at launch: neither sends an ID of itself (`x-user-staging-id` is the same fixed value for everyone), no header they both send could tell them apart, and neither leaves a `.updaterId` in its profile. A profile holding the `.updaterId` v3's updater kept loses it at launch, and the check doesn't send it. With automatic downloads off, an update found shows the dot on Settings and on the Update tab, and nothing is downloaded.
* **"Share with Dropgate".** The app is launched with a file's path and `--upload`, as the Windows context menu does, after being set up with a server and a file lifetime:
  * on a server with HTTPS, it uploads the file end-to-end encrypted with the saved file lifetime, without showing a window. It copies the link, says so in a notification, and quits. The server stores none of the plaintext and not the file's name;
  * on a server without HTTPS, it first shows its window to warn that the upload won't be encrypted, uploads once told to, and quits;
  * if the app is already open, the new launch hands the file to it and quits, and the open window shows the link.

  Each link downloads intact. The link is copied once, and only after the upload has succeeded, and no notification says where the file is.

Once a test has passed, it also checks what its browsers kept and what the server was sent. For direct transfers, that's both the sender's browser and the receiver's. For the desktop app, it's the browser that opens its links, and everything the app sent the server:

* **Nothing is kept in the browser.** The server's origin has no cookies, localStorage, sessionStorage, IndexedDB or Cache Storage. At most one service worker is registered: the one the download pages use to stream files to disk.
* **The server never gets a file name or a key.** No request that reaches the server has a file name, or the key from a link's `#`, in its URL, headers or body, and no WebSocket message a page sends has either. The one exception is a file uploaded without encryption: the server stores its name, so the upload sends it in a request body. The download pages' own download URLs carry the file name too, but their service worker answers them inside the browser, and this checks that none gets through.

Tests for known issues use `test.fail()`, and each one's name says what fixes it. They pass while the issue exists, and fail once it's fixed, so the marker can't be forgotten. Each one only counts the failure its issue causes: if it fails for any other reason, it's reported as a failure. Today there are three:

* **An encrypted upload on a plain-HTTP localhost server can't be downloaded.** Browsers count localhost as a secure context, so the web UI encrypts the upload, but the server only serves encrypted download pages to requests that came in over HTTPS, so the link shows "Secure Connection Required".
* **Pasting an end-to-end encrypted link into "Enter Sharing Code" sends its key to the server.** The home page asks the server where the link leads, and sends the whole link, key and all, though the server only needs the part before the `#`. This test runs the checks above itself, and anything else they find still fails it.
* **Pasting an end-to-end encrypted link into "Enter Sharing Code" opens its download page without the key.** The page goes where the server says the link leads, and that has no `#`, so the download page says the key is missing. Behind a TLS proxy the link starts with `https://`, so this test pastes it that way.


## Running the Tests

Requires Node.js 24 or later. The tests start the server from `server/` and the desktop app from `client/`, so install their dependencies first. From the repository root:

```bash
cd server
npm ci
cd ../client
npm ci
cd ../tests/integration
npm ci
npx playwright install chromium firefox webkit
npm test
```

`npx playwright install` downloads the browser builds this version of Playwright needs into Playwright's own cache, outside the repository. On Linux, add `--with-deps` to install the system libraries they need as well. Electron downloads its own build into its package, in `client/node_modules`, the first time a test launches the desktop app.

To run the tests in one browser, or to watch them:

```bash
npx playwright test --project=chromium
npx playwright test --project=firefox --headed
```

The desktop app's tests are the `desktop` project. The app opens real windows while they run, so on Linux without a desktop, run them on a virtual display:

```bash
npx playwright test --project=desktop
xvfb-run npx playwright test --project=desktop
```

The update tests need a packaged build of the app that updates from this machine, named in `DROPGATE_PACKAGED_APP`. On Windows, from the repository root:

```bash
cd client
node ../.github/scripts/client-test-build-config.mjs "${TMPDIR:-/tmp}/test-build.json"
npx electron-builder --win --publish never --config "${TMPDIR:-/tmp}/test-build.json"
cd ../tests/integration
DROPGATE_PACKAGED_APP="$PWD/../../client/dist/win-unpacked/Dropgate Client.exe" npx playwright test --project=desktop --workers=1 desktop/updates.spec.mjs
```

On Linux, build `--linux AppImage` instead, and name the AppImage in `client/dist/`.


## How They Work

* **Each test starts its own server.** It's the real `server.js`, started by the server tests' own harness ([`server/test/helpers/harness.mjs`](../../server/test/helpers/harness.mjs)): a copy in a temporary folder, on a free port on `127.0.0.1`. It never touches your `uploads/` folder or a running server, and server settings in your shell are ignored.
* **Nothing leaves your machine.** Every file is made up on the spot from a fixed seed, and the pages only talk to that local server. A test fails if the browser makes a request to anywhere but the server's own origin.
* **Nothing looks for a proxy.** When the system says to, as Windows does by default with "Automatically detect settings", Chromium and the desktop app look for a proxy by themselves: they ask the network for a WPAD proxy script, over DHCP and by looking up the name `wpad` in DNS. So Chromium is launched with `--proxy-server=direct://`, and the desktop app with `--no-proxy-server`, which Playwright's headless Chromium ignores. [`privacy/proxy-lookup.spec.mjs`](privacy/proxy-lookup.spec.mjs) checks Chromium's net log for any search for a proxy, and every desktop test that passes checks the net log of each launch of the app the same way. Firefox only follows Windows' setting when its `network.proxy.system_wpad` preference is on, which it isn't by default, and the same test checks its proxy log. WebKit keeps no such log, so it isn't checked: on Windows it has no way to look for a proxy by itself, and on GitHub's Ubuntu runner no browser looked up `wpad` while the tests ran.
* **Nothing looks up names beyond your machine.** The browsers do some things by themselves that would, so the tests stop them, and check:
  * **mDNS names, in direct transfers.** A browser normally hides its own addresses behind made-up names ending in `.local`, and the other browser looks each one up: Chromium and Firefox by multicast on your local network, and WebKit on Linux through your network's DNS server. So Chromium's browser contexts are given camera and microphone permission, which the pages never use, because Chromium shows its real addresses to a page that has them. Firefox is told not to hide its addresses (`media.peerconnection.ice.obfuscate_host_addresses`). WebKit has no such setting that reaches the pages the tests open, so in WebKit the tests drop the other peer's `.local` names before the browser sees them. WebKit on Linux can't use them anyway, and connects through the tests' own STUN server (below). This changes how the browsers find each other on your machine, not what Dropgate does: the pages, the signalling and the transfer are the same. Each direct transfer test checks that no browser but WebKit found a `.local` name, and that none reached any browser.
  * **Firefox's own update check.** About 30 seconds after it starts, Firefox checks `aus5.mozilla.org` for updates to its system add-ons. Playwright turns Firefox's other updates off, but not that one, so the tests do (`extensions.systemAddon.update.enabled`). [`privacy/background-lookups.spec.mjs`](privacy/background-lookups.spec.mjs) keeps Firefox open until its profile says that check was due, and fails if Firefox looked up any name but this machine's. While it does, Firefox answers every name itself, as if it were `localhost`, so even a failure sends nothing.
  * **Everything Chromium looks up.** The net logs above, Chromium's and every desktop app launch's, also show each DNS lookup, and a test fails if any is of a name but this machine's.
  * **The desktop app's spell-check dictionaries.** The app turns its spell checker's download off. In case it ever asks again, the test preload points every session the app creates at an address on this machine, so no desktop test could send that request to Google; the dictionaries test points it at the test's own server, and checks it's never asked.
* **The server writes down every request it receives.** The harness starts it with a small preload ([`server/test/helpers/requests.cjs`](../../server/test/helpers/requests.cjs)) that records each request's URL, headers and body as they arrive, before the server handles them, with the time it arrived and, once the server is done with it, what it answered. So the checks above see exactly what reached the server, whatever the browser asked for first.
* **Direct transfers stay on your machine too.** The server is started with `P2P_STUN_SERVERS=,`, a list with nothing in it, so it offers browsers no ICE servers at all (an empty value would fall back to a public STUN server). The direct transfer tests start a small STUN server of their own instead ([`helpers/stun.mjs`](helpers/stun.mjs)), on a free port on `127.0.0.1`, and the server offers only that one. It answers binding requests and nothing else, so a browser that asks it learns the address it sent from, one of this machine's own, and offers it to the other browser as a server-reflexive candidate. Without it, WebKit on Linux only offers a host candidate hidden behind an mDNS name, which the other WebKit can't look up, so its peers never connect. Chromium and Firefox connect by their host candidates, at this machine's own addresses (above); Firefox doesn't ask a STUN server on loopback at all. STUN runs over UDP, which the request check can't see, so each direct transfer test also checks that the server offered only that STUN server, and that every peer connection that gathered candidates had only that one and found only host candidates and server-reflexive ones at this machine's own addresses, or, in WebKit, host candidates under mDNS names.
* **A direct transfer that fails says what the peers did.** The tests keep a record of every WebRTC peer connection on both pages: the candidates it found and was given, any ICE errors, how its states changed, and which kinds of message its data channels sent and received (the kind only, never what's in them). If the receiver never gets the file details, or the transfer fails after it does, the failure shows that record, what each page says (hidden cards too), and the console errors and uncaught errors of both pages and their service workers.
* **The server's clock can be moved forward.** Tests about time start the server with the test clock, which moves the server's `Date.now()` and runs any repeating timer that would have come due, such as the one-minute sweep for expired uploads. Checking a five-minute lifetime takes milliseconds.
* **The browser plays the part of a TLS reverse proxy.** The server only serves encrypted download pages to requests that came in over HTTPS, because it expects a reverse proxy in front of it to terminate TLS. So the browser sends `X-Forwarded-Proto: https` with every request, as that proxy would. Only the localhost known-issue test leaves it out. The pages load from `http://127.0.0.1`, which browsers treat as a secure context, so encryption works as it would over HTTPS.
* **The browsers ask for reduced motion.** Bootstrap otherwise scrolls smoothly, and a page that's still scrolling can move a button out from under a click.
* **The desktop app runs from source, with a throwaway profile.** Each test launches `client/` with the client's own Electron build, through Playwright's `_electron`, with `--user-data-dir` set to a temporary folder, so it never reads or changes your own settings. `ELECTRON_RUN_AS_NODE`, which some shells set, is removed from its environment. The app only checks for updates when it's packaged, so running it from source sends nothing to GitHub, and a test fails if the app makes a request to anywhere but the test's server.
* **The update tests run a packaged build that updates from this machine.** [`desktop/updates.spec.mjs`](desktop/updates.spec.mjs) runs the app named in `DROPGATE_PACKAGED_APP`, and is skipped without it. That build's update address is a small update server the tests start on `127.0.0.1:47713` ([`helpers/update-server.mjs`](helpers/update-server.mjs)), which records every request with its headers. It answers the channel files, and never has the installer they name, so nothing is ever downloaded or installed. CI makes the build from the app's own build config with only the update address swapped ([`client-test-build-config.mjs`](../../.github/scripts/client-test-build-config.mjs)), and runs its unpacked app on Windows and its AppImage on Linux. Each launch has a new profile, given its settings in `config.json` before it starts.
* **A preload writes down what the desktop app does outside its windows.** [`helpers/desktop-preload.cjs`](helpers/desktop-preload.cjs) is loaded before the app's own code, and writes down every notification it shows, what it copies to the clipboard, which windows it shows, and how its uploads finish. It takes its own `-r` back out of the command line, so the app sees only its usual arguments.
* **A test uses the desktop app's window only once the app is ready.** The window says when it has filled in its saved settings and set up its buttons (`window:ready`, which the preload writes down); until then, what a test types could be overwritten. The test also waits for the app's cookie store to load. Every request the app makes reads it first, and it only starts loading from disk at the first one: with a new profile on a Windows runner, that has taken over 5 s, as long as the app waits for the server when Test is clicked.
* **Your clipboard is left alone.** Off CI, the preload only writes down what the app copies, with the formats that keep a link out of the clipboard's history, and the notifications it shows: nothing reaches your clipboard or your screen. In CI, the app uses the real clipboard and shows its notifications, and the link shared while the app is open is read back from the clipboard. (A background share quits straight after copying, which can be before a read-back finishes.) To do that locally, set `DROPGATE_TEST_REAL_CLIPBOARD=1` and add `--workers=1`: the clipboard is shared, so two tests at once would mix up their links.
* **The desktop app reaches the server over HTTPS through a proxy on this machine.** The app only encrypts uploads to an `https://` address, so the tests that need encryption put a TLS proxy ([`helpers/tls.mjs`](helpers/tls.mjs)) in front of the server, with a self-signed certificate made up for the test, which the app is told to accept. It passes each request on with `X-Forwarded-Proto: https`, as a real one would. The app's links are then opened from the server's own address, like every other test's pages.
* **"Share with Dropgate" while the app is open** is a second launch of the app, as Windows makes it, with nothing watching it: it hands its arguments to the app that's running, and quits.
* **A desktop test that fails says what the proxy, the server and the app saw.** Its failure ends with a report, with times from the start of the test:
  * each connection the TLS proxy got, and when its TLS was set up, or why it failed; and each request, when the proxy had all of it, when it passed it on, when the server answered and with what status, and whether the whole answer reached the app;
  * each request that reached the server, and what the server answered;
  * each of the app's requests that failed, with its error, or that never finished. Playwright only says how far a request got once some of an answer has arrived, so for most failures that's all it says;
  * what each run's network stack did, from Chromium's net log, which each run writes to the test's temporary folder ([`helpers/netlog.mjs`](helpers/netlog.mjs)): the proxy settings it found, each time it looked for a proxy by itself, how long its cookie store took to load from disk, and each request to the test's addresses, with how long it waited for a proxy decision, when it was sent and answered, how it ended, and every pause of 100 ms or more between its steps. This says where a request that got no answer was held. The app is closed before its net log is read, because Chromium writes the log in batches and finishes it when the app quits;
  * what each run of the app wrote down (the preload's record above), and the end of its `debug.log`, if it kept one (it keeps its log in memory unless told otherwise).

  It gives methods, addresses, statuses, sizes and times, never a header or a body. In every test over HTTPS, the app's first connection to the proxy fails with "certificate unknown": Electron refuses the made-up certificate, then connects again once it's told to accept it. A test for a known issue that passes gets the report on stderr instead, because failing it would count as the failure it expects.
* **Flaky tests get fixed, not retried.** Retries are off.

GitHub Actions runs the tests in all three browsers on Ubuntu, and the desktop app's tests on Ubuntu, under Xvfb, and on Windows, one test at a time, with the packaged build for the update tests made first ([`ci.yml`](../../.github/workflows/ci.yml)). Playwright's WebKit on Windows has no WebRTC, so on Windows the direct transfer tests are skipped in WebKit.


## License

Licensed under the **AGPL-3.0 License**, like the server.
See the [LICENSE](../../LICENSE) file at the root of the repository for details.
