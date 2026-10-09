# 🛠️ Troubleshooting

This page covers the most common things that can go wrong when running or using Dropgate.
If you get stuck, turning on debug logs for a minute usually makes the cause obvious.

---

## 1) Quick sanity checks

- Can you reach `GET /api/info` on your server? (It should return JSON.)
- Is the feature you want actually enabled?
  - Hosted uploads: `ENABLE_UPLOAD=true`
  - Direct transfer (P2P): `ENABLE_P2P=true`
  - Web UI: `ENABLE_WEB_UI=true`
- If you’re using the Web UI in a browser, make sure you’re on **HTTPS** (localhost is the usual exception; see [section 4](#4-encryption--https-issues)).
- If you’re behind a reverse proxy, make sure it allows request bodies large enough for upload chunks (often called something like “max body size”).
- Ensure your network/firewall allows traffic on the server port (default `52443`, or the value set by `SERVER_PORT`).

## 2) Enable debug logging

Set `LOG_LEVEL=DEBUG` on the server, reproduce the issue once, then set it back.

- `LOG_LEVEL=DEBUG` → detailed transfer flow
- `LOG_LEVEL=INFO` → normal operation
- `LOG_LEVEL=NONE` → nothing at all, errors included (see [PRIVACY.md](PRIVACY.md))

**The server stops as it starts**
- It refuses a setting it can't use, and says why in an `ERROR` line (at `LOG_LEVEL=NONE` it prints nothing, so set `LOG_LEVEL=ERROR` or higher to see it).
- `UPLOAD_BUNDLE_SIZE_MODE=per-file`: Dropgate 4 removed per-file size limits, so `UPLOAD_MAX_FILE_SIZE_MB` applies to the whole upload. Remove `UPLOAD_BUNDLE_SIZE_MODE`; any other value of it is ignored, with a warning.

**"Removed 3 uploads left by Dropgate 3. Dropgate 4 can't serve them, and their links stopped working when it started."**
- The server was upgraded from Dropgate 3 in persistent mode (`UPLOAD_PRESERVE_UPLOADS=true`), and found what Dropgate 3 had stored in `data/uploads/`. Dropgate 4 can't read it, so it deleted it, and nothing else. It only says so once: the next start finds nothing.
- Dropgate 3's own folder, which the server never looks in, is yours to remove: see [Upgrading from Dropgate 3](../server/README.md#upgrading-from-dropgate-3).

**"This server runs Dropgate 4. Update the app to use it."**
- A Dropgate 3 app, or something else built for Dropgate 3, asked the server for one of Dropgate 3's routes. Update the app. (Dropgate 3's apps usually stop sooner, saying the server isn't compatible.)
- `UPLOAD_MAX_PAUSE_MINUTES` must be a whole number from `0` to `1440`, and `UPLOAD_CHUNK_SIZE_BYTES` from `65536` to `67108864`.

## 3) Hosted upload issues

**Uploads are disabled / 404 on upload routes**
- Make sure `ENABLE_UPLOAD=true`.

**"File at index 0 too large" / "These files are too large together" / "This upload is over the server's limit of … MB" / 413**
- Increase `UPLOAD_MAX_FILE_SIZE_MB`. It counts in 1024s (`100` is 100 × 1024 × 1024 bytes), and applies to the whole upload: for several files, their combined size.
- If you're behind NGINX/Caddy/etc, also check your proxy's upload/body size limit.

**“Server out of capacity” / 507**
- Increase `UPLOAD_MAX_STORAGE_GB` (or set `0` for unlimited), and/or free disk space.

**"The chunk's Content-Digest is missing, or doesn't match its bytes." / "Received data didn't pass its integrity check."**
- A chunk reached the server different from what was sent, or a download's bytes weren't what the upload holds. Often proxy buffering, or middleware touching the request or answer body. A proxy must pass the `Content-Digest` header through.
- Enable `LOG_LEVEL=DEBUG`, retry once, and check where it fails (start vs chunk vs finish).

**"Chunk upload failed. Retrying in …" / "The connection was lost. Reconnecting in …"**
- The server didn't answer, took too long, or answered `408`, `429` or a `5xx` other than `507`. The upload or the download tries again by itself, waiting a little longer each time, up to 30 seconds, for as long as the server keeps it: 5 minutes after it last heard from it. A download picks up where it stopped, and counts once. Any other error fails at once, since trying again wouldn't change it. See [DGUP §8](./technical/DGUP.md#8-retries).
- If it keeps happening behind a reverse proxy, check the proxy's timeouts and body size limit, and that it passes `Range` and `If-Range` through to the server.

**"The server dropped this paused upload."**
- The upload was paused for longer than the server keeps a paused upload: `UPLOAD_MAX_PAUSE_MINUTES` (60 by default) from the pause, the time the Web UI showed ("The server keeps this upload until …"), and the Dropgate Client ("Kept until …", with a notification 5 minutes before). Nothing resumes by itself, so the server deleted what it had. Upload the files again; to allow longer pauses, raise `UPLOAD_MAX_PAUSE_MINUTES` (at most `1440`, a day).
- A restart drops every upload in progress, paused ones too.
- No **Pause Upload** button: the server has pausing off (`UPLOAD_MAX_PAUSE_MINUTES=0`).

**A download paused in the browser failed, or never finishes**
- The download pages stream each file to disk through the page itself, so a browser's own Pause only works while that page stays open, and only in Chrome: Resume there carries on and saves the whole file. In Firefox, Pause ends the download, and the page says it failed. In Chrome with the page closed while paused, Resume never finishes: cancel it.
- Download the file again from its link. A download that got part of the file counts as one against the upload's download limit, so with a limit of 1 the upload is already gone: ask its sender to upload it again.
- No browser shows such a download as complete: Firefox marks it failed, and Chrome leaves it unfinished. See [DGUP §9.2](./technical/DGUP.md#92-the-download-page).

**"A file changed after the upload started, so the rest of it can't be read as it was."**
- A file was edited, replaced or resized while it was uploading or paused. The Dropgate Client, like a browser, won't read on, so the upload never holds part of the old file and part of the new one. Upload the file again as it is now.

**Tuning chunk size**
- The upload chunk size is controlled by `UPLOAD_CHUNK_SIZE_BYTES` (default `5242880` / 5MB, minimum `65536` / 64KB, maximum `67108864` / 64MB).
- If you're behind a reverse proxy with a body size limit, make sure the proxy allows at least `UPLOAD_CHUNK_SIZE_BYTES + 1024` bytes per request (the extra 1024 covers an encrypted chunk's 16-byte tag, with room to spare).
- Lowering the chunk size can help on unstable connections (smaller chunks = less data to re-upload on failure), but increases the number of HTTP requests per file and adds per-chunk overhead (hashing, the encryption tag).
- The 64KB minimum prevents extreme fragmentation — values below this would generate millions of chunks for moderate files and cause significant per-chunk overhead.
- **Changing the chunk size is safe,** in persistent mode too: each upload records its own, so uploads stored before the change still download. An upload in progress when it changes must start again. See [DGUP §4.2](./technical/DGUP.md#42-the-header).

**"A field of the request is missing or wrong." on a very large upload**
- The server takes at most 100,000 chunks per upload (about 500GB at 5MB chunk size); a larger one is refused as it starts.
- **Solution**: Increase `UPLOAD_CHUNK_SIZE_BYTES` to reduce the number of chunks. For very large files, consider using a 10MB or 20MB chunk size.

**"An upload holds 1 to 1000 files."**
- An upload of several files is limited to 1,000 files for security and performance reasons.
- **Solution**: Split your files into multiple separate uploads, or use client-side ZIP compression before uploading.

## 4) Encryption / HTTPS issues

- Browsers only provide some features Dropgate relies on in a **secure context** (HTTPS or localhost), notably the Web Crypto API used for end-to-end encryption. The Web UI also only enables direct transfer (P2P) in a secure context.
- If you see missing buttons or “blocked” errors in the Web UI, run the server behind HTTPS.
- An encrypted upload's download page over plain HTTP from another machine says it needs HTTPS, for one file or several: the browser gives the page no Web Crypto there. On `localhost` or `127.0.0.1` it works, since browsers count those as secure. (In 3.x, an encrypted bundle's page said **"Secure Connection Required"** on localhost too; that's fixed in 4.0.)
- An unencrypted upload's page over plain HTTP from another machine hands each file to the browser to download itself, so several files come as separate downloads, with no ZIP.
- **A link that says it's from an older version** was made by Dropgate 3: a bundle's (`/b/<id>`), or a single file's whose key after the `#` is 44 characters ending in `=`. A Dropgate 4 server can't open it: the sender needs to update and send the files again.

## 5) P2P issues (Direct transfer)

- P2P generally requires **HTTPS** (localhost is the usual exception).
- If peers can’t connect or get stuck “connecting”:
  - Try a different network (mobile hotspot is a quick test).
  - Confirm `ENABLE_P2P=true`.
  - Try changing `P2P_STUN_SERVERS` to a different STUN provider.
  - Some networks/NATs need a **TURN** server to relay traffic (currently not supported).

**"The sender cancelled the transfer" (or "The receiver cancelled…") when nobody did**
- Currently, if the connection drops mid-transfer for any reason (network change, Wi-Fi drop, a closed or sleeping device), it's reported as the other side cancelling. See [DGDTP §14.4](./technical/DGDTP.md#144-connection-loss).
- Interrupted transfers can't be resumed. Start the transfer again, ideally on a more stable connection.

## 6) Rate limiting

If clients see “Too many requests”:
- Increase `RATE_LIMIT_MAX_REQUESTS` or `RATE_LIMIT_WINDOW_MS`.
- Or disable rate limiting by setting both to `0`.

## 7) The desktop app

**To send its log with a bug report**
- Turn on **Keep log on disk for troubleshooting** in **Settings**, under **Privacy**, and do what went wrong again. The log is `debug.log` in the app's user data folder (`%APPDATA%\dropgate-client` on Windows, `~/.config/dropgate-client` on Linux). It holds none of your file names, folders or links. Turn the setting off afterwards, and the file is deleted.

**A `.*` key left in the registry after upgrading from version 3 (Windows)**
- Version 3, installed for all users, registered an association for a literal `.*` extension, which never did anything, and its uninstaller leaves that key behind. Nothing reads it. To remove it, from a Command Prompt run as administrator:

  ```
  reg delete "HKLM\Software\Classes\.*" /f
  ```

## 8) Still stuck?

When asking for help, include:
- Your `GET /api/info` output
- A short snippet of server logs around the error (ideally with `LOG_LEVEL=DEBUG`)
- Whether you’re using a reverse proxy/tunnel (NGINX/Caddy/Cloudflare Tunnel/Tailscale)
