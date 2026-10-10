<div align="center">
   <img alt="Dropgate Logo" src="./public/assets/icon.png" style="width:100px;height:auto;margin-bottom:1rem;" />

   # Dropgate Server

   <p style="margin-bottom:1rem;">A Node.js-based backend for secure, privacy-focused file sharing with optional end-to-end encryption support.</p>
</div>

<div align="center">

![license](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)
![version](https://img.shields.io/badge/version-3.0.13-brightgreen?style=flat-square)
![docker](https://img.shields.io/badge/docker-supported-blue?style=flat-square)

[![discord](https://img.shields.io/discord/667479986214666272?logo=discord&logoColor=white&style=flat-square)](https://diamonddigital.dev/discord)
[![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee&logoColor=000000&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>


## Available on TrueNAS and umbrelOS

Install **Dropgate Server** on your favourite home server platform:

| Platform | Install | Learn more |
|----------|---------|------------|
| **TrueNAS** | [Apps Market →](https://apps.truenas.com/catalog/dropgate-server) | [Announcement](https://diamonddigital.dev/blog/announcing-dropgate-for-truenas) |
| **umbrelOS** | [App Store →](https://apps.umbrel.com/app/dropgate-server) | [Announcement](https://diamonddigital.dev/blog/announcing-dropgate-for-umbrelos) |

## Public Demo

See **Dropgate** in action here: **[dropgate.link](https://dropgate.link)**

To prevent and monitor for abuse, `DEBUG`-level logging and strict rate limits are enforced.

## Overview

**Dropgate Server** is the official backend and reference implementation for secure, privacy-focused file sharing using the Dropgate protocols: [DGUP (Dropgate Upload Protocol)](../docs/technical/DGUP.md) and [DGDTP (Dropgate Direct Transfer Protocol)](../docs/technical/DGDTP.md).

It can be self-hosted easily on:
- Home servers / NAS boxes
- VPS instances
- Docker containers
- Tunnelled/reverse-proxied setups (Cloudflare Tunnel, Tailscale, etc.)

Dropgate supports **two ways to share files**:

- **Hosted uploads (classic mode)** — you upload a file, share a link, and the server holds it temporarily.
- **Direct transfer (P2P)** — when enabled, files can transfer device-to-device, with the server only helping peers connect.

When running with **E2EE**, the server acts as a **blind data relay** — the contents are unreadable without the client-side decryption key.


## Defaults (important!)

Out of the box, the server is conservative:
- ✅ Web UI is enabled
- ✅ Direct Transfer (P2P) is enabled
- ❌ Hosted uploads are disabled (you must opt in)

This means you can spin it up, try the Web UI, and choose what features you want to allow.


## Quick Start (Manual)

Requires Node.js 24 or later, which the Docker image runs and the tests run on.

```bash
git clone https://github.com/diamonddigitaldev/Dropgate.git
cd Dropgate/server
npm ci
npm start
```

Enable hosted uploads:

```bash
ENABLE_UPLOAD=true npm start
```

(Windows PowerShell)

```powershell
$env:ENABLE_UPLOAD="true"
npm start
```


## Running the Tests

Requires Node.js 24.14 or later.

```bash
npm ci
npm test
```

Each test starts its own copy of the server in a temporary folder on a free port, so it never touches your `data/` folder or a running server. Server settings in your shell (`LOG_LEVEL`, `ENABLE_UPLOAD` and so on) are ignored during tests.

Tests for known issues are marked as expected failures (the server has none at the moment). They pass while the issue exists, and fail once it's fixed, so the marker can't be forgotten. To see what each one is waiting on, run the tests with the TAP reporter, which prints each label:

```bash
node --test --test-reporter=tap "test/*.test.mjs"
```

GitHub Actions runs the tests this way on Ubuntu and Windows ([`ci.yml`](../.github/workflows/ci.yml)).

The Web UI is tested in real browsers by the [integration tests](../tests/integration/README.md), which start the server with the same harness.

The server shares its version with the client and core, and they're released together ([Releases](../README.md#releases)). Change it in `package.json`, `package-lock.json` and the badge at the top of this README together, or GitHub Actions fails.


## The Web UI's Core Library

The Web UI runs on [`@dropgate/core`](../packages/dropgate-core/README.md), loaded from [`public/js/dropgate-core.js`](public/js/dropgate-core.js). That file is core's build, written by `npm run build` in `packages/dropgate-core` and committed, so the server and its Docker image don't need core built first. Don't edit it: change core's source and build it again ([Building and Testing](../docs/core/building-and-testing.md)). GitHub Actions fails if it isn't core's build, or if the Docker image doesn't carry it as it is.


## Running with Docker

```bash
docker run -d \
  --name dropgate-server \
  --restart unless-stopped \
  -p 52443:52443 \
  -e ENABLE_UPLOAD=true \
  -e UPLOAD_ENABLE_E2EE=true \
  -e UPLOAD_PRESERVE_UPLOADS=true \
  -e UPLOAD_MAX_FILE_SIZE_MB=1000 \
  -v /path/to/dropgate/data:/app/data \
  willtda/dropgate-server:latest
```

Everything the server keeps is in `/app/data`, so that's the one folder to map, as above. Its uploads are in `/app/data/uploads`, cleared at each start unless `UPLOAD_PRESERVE_UPLOADS=true`; the rest of it is the server's own data, which is never cleaned (nothing uses it yet). Without a mapping, it all goes when the container is removed. The entrypoint makes the folder and hands it to the user the server runs as, and [`docker-compose.yml`](docker-compose.yml) keeps it in a named volume, `dropgate-data`.

**Changed in 4.0:** the image's folder is `/app`, not `/usr/src/app`, and uploads moved into `/app/data`. A mapping of version 3's `/usr/src/app/uploads` does nothing in version 4, whose server can't serve version 3's uploads anyway: map `/app/data` instead, and remove the old folder (see [Upgrading from Dropgate 3](#upgrading-from-dropgate-3)).

The image holds only what the server runs, and its license: the Dockerfile copies the package files, `server.js`, `views/`, `public/`, `LICENSE` and `entrypoint.sh`, and `.dockerignore` keeps the tests, `test/`, out of the build context altogether. Its `org.opencontainers.image.licenses` label is `AGPL-3.0-only`, as `package.json` gives it.

Images are built for `linux/amd64` and `linux/arm64`. Each release's image is tagged with its version. A stable release also moves `latest`, and its major and minor tags, so `3` and `3.0` always give the newest 3.x release; pin one of those to stay on a major version. A pre-release is tagged `next` as well, and never `latest`. See [Releases](../README.md#releases) for how an image is built and checked before it's pushed, and checked again after.


## Environment Variables

### General

| Variable | Default | Description |
| --- | --- | --- |
| `SERVER_PORT` | `52443` | Port to run the server on. |
| `SERVER_NAME` | `Dropgate Server` | Display name used by the Web UI and `GET /api/info`. |
| `ENABLE_WEB_UI` | `true` | Enables the Web UI at `/`. |
| `LOG_LEVEL` | `INFO` | `NONE`, `ERROR`, `WARN`, `INFO`, `DEBUG`. At `NONE` the server writes nothing at all, errors included. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in milliseconds (`0` disables rate limiting). |
| `RATE_LIMIT_MAX_REQUESTS` | `25` | Requests allowed per window (`0` disables rate limiting). |

### Hosted Uploads (classic mode)

| Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_UPLOAD` | `false` | Enables the hosted upload protocol and routes. |
| `UPLOAD_ENABLE_E2EE` | `true` | Enables end-to-end encryption for hosted uploads (keys stay client-side). |
| `UPLOAD_PRESERVE_UPLOADS` | `false` | Persist uploads across restarts (uses `data/uploads/db/`). |
| `UPLOAD_MAX_FILE_SIZE_MB` | `100` | Max upload size in MB, counted in 1024s (`100` is 100 × 1024 × 1024 bytes). It applies to the whole upload: several files count together (`0` = unlimited). |
| `UPLOAD_MAX_STORAGE_GB` | `10` | Max total storage in GB, counted in 1024s (`0` = unlimited). |
| `UPLOAD_MAX_FILE_LIFETIME_HOURS` | `24` | Max file lifetime in hours (`0` = unlimited). |
| `UPLOAD_MAX_FILE_DOWNLOADS` | `1` | Max downloads before file is deleted (`0` = unlimited). |
| `UPLOAD_CHUNK_SIZE_BYTES` | `5242880` | Upload chunk size in bytes (default 5MB). Minimum `65536` (64KB), maximum `67108864` (64MB): outside that, the server doesn't start. Smaller values increase per-chunk overhead; larger values may need proxy body-size adjustments. |
| `UPLOAD_MAX_PAUSE_MINUTES` | `60` | How long an upload or a download can stay paused before the server drops it, in whole minutes from `1` to `1440` (a day), or `0` to turn pausing off. Anything else stops the server at startup. `GET /api/info` gives it as `maxPauseMinutes`. A paused upload ends at once when its pause runs out, and a restart ends it sooner. |
| `UPLOAD_BUNDLE_SIZE_MODE` | — | **Removed in 4.0.** The size limit always applies to the whole upload. Set to `per-file`, the server stops at startup and says why; any other value is ignored, with a warning. |

**Removed in 4.0:** `UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS`. An upload in progress ends at its own deadline instead (see [Storage and Lifecycle](#storage-and-lifecycle)), so nothing sweeps for abandoned ones, and the server ignores the setting.

### Direct Transfer (P2P)

| Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_P2P` | `true` | Enables direct transfer (P2P). |
| `P2P_STUN_SERVERS` | `stun:stun.cloudflare.com:3478` | Comma/space separated STUN servers for WebRTC. |
| `PEERJS_DEBUG` | `false` | Currently has no effect (the bundled PeerJS server has no logging). Still reported in `/api/info`. |


## Server Info Endpoint

You can sanity-check your server and see what it supports via:

- `GET /api/info`

Example response:

```json
{
  "name": "Dropgate Server",
  "version": "3.0.13",
  "protocols": {
    "dgup": { "major": 4, "minor": 0 },
    "dgdtp": { "major": 4, "minor": 0 }
  },
  "logLevel": "INFO",
  "capabilities": {
    "upload": {
      "enabled": true,
      "e2ee": true,
      "maxSizeMB": 100,
      "maxLifetimeHours": 24,
      "maxFileDownloads": 1,
      "chunkSize": 5242880,
      "maxPauseMinutes": 60,
      "credentialRequired": false
    },
    "p2p": {
      "enabled": true,
      "peerjsPath": "/peerjs",
      "iceServers": [
        {
          "urls": [
            "stun:stun.cloudflare.com:3478"
          ]
        }
      ],
      "peerjsDebugLogging": false
    },
    "webUI": {
      "enabled": true
    },
    "accounts": {
      "enabled": false
    }
  }
}
```

With uploads off, `upload` is `{ "enabled": false }` and nothing more. `maxSizeMB` is `UPLOAD_MAX_FILE_SIZE_MB` as set, in 1024s, and `maxPauseMinutes` is `0` when pausing is off. Nothing asks for a credential yet, and accounts aren't built yet. The answer is never cached. The [DGUP spec](../docs/technical/DGUP.md#3-capability-discovery) describes each field.


## HTTPS / Reverse Proxy Setup

For **E2EE** and **Direct Transfer (P2P)** in browsers, you generally want HTTPS (localhost is the common exception).
Run the server behind a reverse proxy that terminates TLS:

* [NGINX](https://nginx.org/)
* [Caddy](https://caddyserver.com/)
* [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
* [Tailscale Funnel](https://tailscale.com/kb/1223/funnel/)

On plain HTTP, even on `localhost` or `127.0.0.1`, the Web UI encrypts uploads, since browsers count localhost as secure. An upload's download page, `https://<host>/<id>`, one file or several, is served over HTTP and HTTPS alike: the page itself checks whether the browser can decrypt there, so on localhost an encrypted upload downloads, and over plain HTTP from another machine the page says it needs HTTPS. (In 3.x, an encrypted bundle's page needed HTTPS even on localhost; that's fixed in 4.0.) A Dropgate 3 bundle's link, `https://<host>/b/<id>`, answers 410 with a page saying it was made with an older version. A Dropgate 3 single file's link, `https://<host>/<id>#<key>`, names an upload the server doesn't have, so it answers 404, and the page, reading the key's older shape in the browser, says the same.

The Web UI's upload can pause: **Pause Upload** stops it part-way, the card says until when the server keeps it (`UPLOAD_MAX_PAUSE_MINUTES` from the pause, as a local time), and **Resume Upload** carries it on. Nothing resumes by itself: still paused then, the upload ends. With `UPLOAD_MAX_PAUSE_MINUTES=0` there's no Pause. The download pages have no Pause of their own. A browser's own Pause works in Chrome while the page stays open; in Firefox it ends the download, which then has to be downloaded again ([DGUP §9.2](../docs/technical/DGUP.md#92-the-download-page)).

The Web UI looks and behaves as the desktop app does. Its modals (the Upload Security Warning, Delete This Upload? and the QR code) close on Escape as Cancel, as their close button and backdrop do, and the focus goes back to the button that opened them; with no modal open, Escape goes back to the start, but never while an upload is under way. Its toasts are the desktop app's: centred at the top, filled with their kind's colour, gone after 4.5 seconds. Every text and control meets WCAG 2.2 AA contrast in the light theme and the dark one, which follow the browser's, with a solid focus ring for the keyboard. Every size it shows, the limit ("Max upload size") included, counts in 1024s, as `UPLOAD_MAX_FILE_SIZE_MB` does: 1.5 MB is 1,572,864 bytes.


## Storage and Lifecycle

- Everything the server keeps is in `data/`, beside `server.js` (`/app/data` in Docker).
- Uploaded files live in `data/uploads/`. The server writes `data/uploads/dropgate-storage.json` at each start, saying which version's layout the folder holds, and keeps its uploads in `data/uploads/objects/`, one file each, a single file or several alike. With `UPLOAD_PRESERVE_UPLOADS=true`, their records are in `data/uploads/db/objects.sqlite`.
- Uploads in progress are in `data/uploads/tmp/`, which is cleared at every start.
- The rest of `data/` is the server's own data. It's never cleaned, and nothing uses it yet.
- Files can be set to expire after a certain period or after a certain number of downloads. An upload is gone the moment it expires: from then on the server answers as if it had never existed, and deletes it within a minute.
- An upload in progress ends 5 minutes after its last request, or, paused, when its pause runs out (`UPLOAD_MAX_PAUSE_MINUTES`). It ends at once: its temporary file and the storage it reserved go.
- A download takes a lease, kept in memory only, and counts once when it ends if it sent anything, however many requests or files it took. At its upload's download limit, the upload is deleted at once, several files as a whole. While open downloads already make the limit, a new one is asked to wait. `UPLOAD_MAX_PAUSE_MINUTES` is also how long a paused download is kept.
- The uploader can delete an upload at once, with the manage token only their page or app holds: in the Web UI, **Delete Upload** on the result screen, while the page is open. With `UPLOAD_PRESERVE_UPLOADS=true`, a deleted record is overwritten with zeros in the database.
- Storage used, for `UPLOAD_MAX_STORAGE_GB`, is what's in `data/uploads/objects/` plus what every upload in progress has reserved. Nothing else in the folder counts.

### Upgrading from Dropgate 3

A Dropgate 4 server can't serve anything a Dropgate 3 server stored, and Dropgate 3's links stop working when it starts: a Dropgate 3 app or link is told to update.

- **In persistent mode** (`UPLOAD_PRESERVE_UPLOADS=true`), each start deletes exactly what a Dropgate 3 server left in `data/uploads/`: its two databases (`db/file-database.sqlite` and `db/bundle-database.sqlite`, with SQLite's own files beside them) and its stored files, named by their IDs. It logs one `INFO` line, such as "Removed 3 uploads left by Dropgate 3. Dropgate 4 can't serve them, and their links stopped working when it started.", with no ID or name. Nothing else in `data/uploads/` is touched. They're only there if Dropgate 3's folder was mapped onto `/app/data/uploads`.
- **In the default mode,** the start clears `data/uploads/` as always, Dropgate 3's files with the rest.
- **The server never looks in Dropgate 3's own folder,** so remove it yourself: in Docker, the volume or folder you mapped to `/usr/src/app/uploads`; run from a copy of the repository, `server/uploads/` beside `server/data/`.


## Logging and Privacy

Dropgate tries to keep logs **minimal and transparent**.
For the full breakdown of what gets logged (and what doesn’t), see:

- [`docs/PRIVACY.md`](../docs/PRIVACY.md)

If you’re debugging a problem, temporarily enable `LOG_LEVEL=DEBUG`, reproduce the issue, then turn it back down.


## License

Licensed under the **AGPL-3.0 License**.
See the [LICENSE](./LICENSE) file for details.


## Acknowledgements

* Logo designed by [TheFuturisticIdiot](https://github.com/TheFuturisticIdiot)
* Built with [Node.js](https://www.nodejs.org/)
* Inspired by the growing need for privacy-respecting, open file transfer tools


### AI Disclosure

This project uses AI tools to aid development. Read our [AI Transparency & Quality Commitment](https://diamonddigital.dev/ai-transparency) statement for more information.


## Contact Us

* **Need help or want to chat?** [Join our Discord Server](https://diamonddigital.dev/discord)
* **Found a bug?** [Open an issue](https://github.com/diamonddigitaldev/Dropgate/issues)
* **Have a suggestion?** [Submit a feature request](https://github.com/diamonddigitaldev/Dropgate/issues/new?labels=enhancement)

<div align="center">
  <a href="https://diamonddigital.dev/">
  <strong>Created and maintained by</strong>
  <img align="center" alt="Diamond Digital Development Logo" src="https://diamonddigital.dev/img/png/ddd_logo_text_transparent.png" style="width:25%;height:auto" /></a>
</div>
