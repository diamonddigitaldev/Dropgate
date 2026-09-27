# Dropgate Integration Tests

End-to-end tests that drive Dropgate's web UI in real browsers (Chromium, Firefox and WebKit) with [Playwright Test](https://playwright.dev/).


## What They Cover

Each test sends files through the web UI the way a person would, then receives them on the page a recipient would use, and compares every byte and file name with what was sent:

* **A single file**, unencrypted and end-to-end encrypted, from the home page to the standard download page.
* **A bundle of three files**, unencrypted and end-to-end encrypted, from the home page to the bundle page: each file on its own, then all of them with "Download All as ZIP".
* **File lifetime.** A single file and a bundle, uploaded with a five-minute lifetime set on the home page, are still there after three minutes. After six, the link shows "not found" and the server holds none of their files. Bundles are checked unencrypted and end-to-end encrypted.
* **Max downloads.** With a limit of 2 set on the home page, a single file downloads twice, and then its link shows "not found". A bundle's files can each be downloaded on their own without using up the limit, because only "Download All as ZIP" counts, so it gives two ZIPs and then its link is gone. Each is checked unencrypted and end-to-end encrypted.
* **Direct transfer**, in Chromium and Firefox. A file sent from the home page reaches a receiver in a second, separate browser context, whether they type the code into the home page's "Enter Sharing Code" box or open the link. Several files sent together arrive as one ZIP.

For encrypted uploads, they also check that the files the server stores hold none of the plaintext and none of the file names.

Once a test has passed, it also checks what its browsers kept and what the server was sent. For direct transfers, that's both the sender's browser and the receiver's:

* **Nothing is kept in the browser.** The server's origin has no cookies, localStorage, sessionStorage, IndexedDB or Cache Storage. At most one service worker is registered: the one the download pages use to stream files to disk.
* **The server never gets a file name or a key.** No request that reaches the server has a file name, or the key from a link's `#`, in its URL, headers or body, and no WebSocket message a page sends has either. The one exception is a file uploaded without encryption: the server stores its name, so the upload sends it in a request body. The download pages' own download URLs carry the file name too, but their service worker answers them inside the browser, and this checks that none gets through.

Tests for known issues use `test.fail()`, and each one's name says what fixes it. They pass while the issue exists, and fail once it's fixed, so the marker can't be forgotten. Each one only counts the failure its issue causes: if it fails for any other reason, it's reported as a failure. Today there are three:

* **An encrypted upload on a plain-HTTP localhost server can't be downloaded.** Browsers count localhost as a secure context, so the web UI encrypts the upload, but the server only serves encrypted download pages to requests that came in over HTTPS, so the link shows "Secure Connection Required".
* **Pasting an end-to-end encrypted link into "Enter Sharing Code" sends its key to the server.** The home page asks the server where the link leads, and sends the whole link, key and all, though the server only needs the part before the `#`. This test runs the checks above itself, and anything else they find still fails it.
* **Pasting an end-to-end encrypted link into "Enter Sharing Code" opens its download page without the key.** The page goes where the server says the link leads, and that has no `#`, so the download page says the key is missing. Behind a TLS proxy the link starts with `https://`, so this test pastes it that way.


## Running the Tests

Requires Node.js 24 or later. The tests start the server from `server/`, so install its dependencies first. From the repository root:

```bash
cd server
npm ci
cd ../tests/integration
npm ci
npx playwright install chromium firefox webkit
npm test
```

`npx playwright install` downloads the browser builds this version of Playwright needs into Playwright's own cache, outside the repository. On Linux, add `--with-deps` to install the system libraries they need as well.

To run the tests in one browser, or to watch them:

```bash
npx playwright test --project=chromium
npx playwright test --project=firefox --headed
```


## How They Work

* **Each test starts its own server.** It's the real `server.js`, started by the server tests' own harness ([`server/test/helpers/harness.mjs`](../../server/test/helpers/harness.mjs)): a copy in a temporary folder, on a free port on `127.0.0.1`. It never touches your `uploads/` folder or a running server, and server settings in your shell are ignored.
* **Nothing leaves your machine.** Every file is made up on the spot from a fixed seed, and the pages only talk to that local server. A test fails if the browser makes a request to anywhere but the server's own origin.
* **The server writes down every request it receives.** The harness starts it with a small preload ([`server/test/helpers/requests.cjs`](../../server/test/helpers/requests.cjs)) that records each request's URL, headers and body as they arrive, before the server handles them. So the checks above see exactly what reached the server, whatever the browser asked for first.
* **Direct transfers stay on your machine too.** The server is started with `P2P_STUN_SERVERS=,`, a list with nothing in it, so it offers browsers no ICE servers at all (an empty value would fall back to a public STUN server). The two browsers connect over this machine's own addresses. STUN runs over UDP, which the request check can't see, so each direct transfer test also checks that the server offered no ICE servers, and that every peer connection that gathered candidates had none and found only host candidates.
* **A direct transfer that doesn't connect says why.** The tests keep a record of every WebRTC peer connection on both pages: the candidates it found and was given, any ICE errors, and how its states changed. If the receiver never gets the file details, the failure shows that record, what each page says, and their console errors.
* **The server's clock can be moved forward.** Tests about time start the server with the test clock, which moves the server's `Date.now()` and runs any repeating timer that would have come due, such as the one-minute sweep for expired uploads. Checking a five-minute lifetime takes milliseconds.
* **The browser plays the part of a TLS reverse proxy.** The server only serves encrypted download pages to requests that came in over HTTPS, because it expects a reverse proxy in front of it to terminate TLS. So the browser sends `X-Forwarded-Proto: https` with every request, as that proxy would. Only the localhost known-issue test leaves it out. The pages load from `http://127.0.0.1`, which browsers treat as a secure context, so encryption works as it would over HTTPS.
* **The browsers ask for reduced motion.** Bootstrap otherwise scrolls smoothly, and a page that's still scrolling can move a button out from under a click.
* **Flaky tests get fixed, not retried.** Retries are off.

GitHub Actions runs the tests in all three browsers on Ubuntu ([`ci.yml`](../../.github/workflows/ci.yml)). The direct transfer tests run in Chromium and Firefox only. Playwright's WebKit on Windows has no WebRTC, and on Linux its two peers don't connect when the server offers no ICE servers.


## License

Licensed under the **AGPL-3.0 License**, like the server.
See the [LICENSE](../../LICENSE) file at the root of the repository for details.
