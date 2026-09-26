# Dropgate Integration Tests

End-to-end tests that drive Dropgate's web UI in real browsers (Chromium, Firefox and WebKit) with [Playwright Test](https://playwright.dev/).


## What They Cover

Each test uploads files through the web UI the way a person would, then downloads them from the page a recipient would use, and compares every byte and file name with what was sent:

* **A single file**, unencrypted and end-to-end encrypted, from the home page to the standard download page.
* **A bundle of three files**, unencrypted and end-to-end encrypted, from the home page to the bundle page: each file on its own, then all of them with "Download All as ZIP".

For encrypted uploads, they also check that the files the server stores hold none of the plaintext and none of the file names.


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
* **Nothing leaves your machine.** Every file is made up on the spot from a fixed seed, and the pages only talk to that local server. A test fails if the browser makes a request to any other host.
* **The browser plays the part of a TLS reverse proxy.** The server only serves encrypted download pages to requests that came in over HTTPS, because it expects a reverse proxy in front of it to terminate TLS. So the browser sends `X-Forwarded-Proto: https` with every request, as that proxy would. The pages load from `http://127.0.0.1`, which browsers treat as a secure context, so encryption works as it would over HTTPS.
* **Flaky tests get fixed, not retried.** Retries are off.

GitHub Actions runs the tests in all three browsers on Ubuntu ([`ci.yml`](../../.github/workflows/ci.yml)).


## License

Licensed under the **AGPL-3.0 License**, like the server.
See the [LICENSE](../../LICENSE) file at the root of the repository for details.
