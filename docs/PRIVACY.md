# 🔒 Privacy and Logging

Dropgate is built to be **privacy-first** and **transparent**.
That means: logs exist for diagnostics, but they’re designed to be **minimal**, **non-identifying**, and **optional**.

Logging is controlled by the `LOG_LEVEL` environment variable (default: `INFO`).
The current log level is also exposed to clients via `GET /api/info` so users can see what they’re interacting with.

Every claim below that Dropgate doesn't log or keep something links the automated test that checks it, by the test's name (or its first words, ending in "…"). The tests run on every change to Dropgate.

---

## ✅ What Dropgate does *not* log

Dropgate is intentionally opinionated about avoiding identifying data.
By design, Dropgate's own log messages **never** include (tests: [Dropgate's own log lines never contain an ID, a name, a key, a code, an IP, a user agent or request body text](../server/test/privacy-logs.test.mjs), at every level; [every message is a known event carrying only sizes, counts and timestamps](../server/test/privacy-logs.test.mjs), at `DEBUG`):

- File contents / file lists, sealed or not
- File names
- Encryption keys / URL fragments
- Upload IDs, of uploads in progress
- Download leases
- Manage tokens, or their hashes
- The IDs of stored uploads
- How many files an upload has (test: [no message gives how many files an upload has, a bundle's included](../server/test/privacy-logs.test.mjs))
- Client IP addresses
- Per-request identifiers or headers

If you’re running a public instance, this is one of the key ways the project tries to reduce “paper trails”.

**Everything the server writes goes through `LOG_LEVEL`,** errors included (test: [nothing reaches stdout or stderr outside LOG_LEVEL](../server/test/privacy-logs.test.mjs)):

- **Unexpected errors** are logged at `ERROR` by the kind of error and the route's pattern only, such as `GET /api/v4/objects/:id (Error, EISDIR)`: never the error's message or stack trace, which could hold the internal path of a stored upload (and so its ID) or part of a request body. The answer to the request says only that something went wrong (tests: [an error while answering gives 500 SERVER_ERROR, and the log names the route's pattern, never its ID](../server/test/api.test.mjs); [a request body that can't be read answers 400 INVALID_REQUEST…](../server/test/api.test.mjs)).
- **A misconfigured reverse proxy,** one that passes a client address the rate limiter can't read (for example `IP:port`), is logged at `ERROR` by the rate limiter's error code, never the address (test: [a client address the rate limiter can't read is logged by its code alone, and not at all at NONE](../server/test/api.test.mjs)).

---

## 🧾 What Dropgate *may* log

Depending on your `LOG_LEVEL`, you may see:

- Startup configuration (feature flags, limits, and server name)
- Storage usage at startup (useful for capacity limits)
- How many uploads a persistent Dropgate 3 server left, once, at the start that deletes them: Dropgate 4 can't serve them, and their links already don't work
- Rate limit warnings
- Internal errors, by their kind only (from Node.js / the OS)

At `DEBUG` level you may also see:

- Upload lifecycle events (start/chunk/finish/cancel), with sizes
- An upload paused or resumed, and one that ended at its deadline, with its size
- A download lease taken or paused, a download counted against its limit, and an upload deleted at its download limit or by its uploader
- Chunk counts and chunk sizes
- Expired uploads being deleted

**A paused upload** is kept only in the server's memory, with its temporary file and the storage it reserved, until its pause runs out (`UPLOAD_MAX_PAUSE_MINUTES`): then it goes at once. Nothing about it, not even that it exists, is written to a database, so a restart ends it, with `UPLOAD_PRESERVE_UPLOADS=true` too (test: [a restart ends a paused upload, in persistent mode too…](../server/test/pause.test.mjs)). No upload in progress, paused or not, records an IP address or when it started (test: [an upload in progress holds what its start sent and how far it has got…](../server/test/privacy-data.test.mjs)).

**A download** of an upload takes a lease: a random ID, held only in the server's memory with the upload's ID, whether it has sent any bytes, whether it's paused, and when it runs out. It holds no IP address and nothing else about who asked, and none survives a restart (tests: [a lease holds only its upload's ID, its own, how far it has got and its deadline: nothing from the request](../server/test/privacy-data.test.mjs); [no lease survives a restart…](../server/test/downloads.test.mjs)). When it ends, it counts as one download if it sent anything; at the upload's download limit, the upload is deleted at once. A download page holds one lease for everything it downloads, an upload's files one by one and its ZIP, and releases it as the page closes. Its metadata (what a link preview or a download page reads first) takes no lease and counts nothing.

**An uploader can delete their own upload** with its manage token, a random value only the page or app that uploaded it holds: in the Web UI, **Delete Upload** on the result screen, while the page is open; in the desktop app, **Delete** on a finished upload, until it's removed or the app quits. The server keeps only its SHA-256, and the token is sent only in the delete's own header, never in a URL (test: [deletes the upload with its manage token, sent only in Dropgate-Manage-Token…](../packages/dropgate-core/tests/hosted.test.ts)). Deleting removes the upload's bytes and record at once, and downloads in progress stop. With `UPLOAD_PRESERVE_UPLOADS=true`, the database writes zeros over a record as it deletes it, so an upload that's gone leaves nothing of itself in the file (test: [no stored byte holds a lease, a manage token, an ID, a name or an address](../server/test/privacy-data.test.mjs)).

File sizes and capacity values may appear in logs because they’re necessary for understanding limits and diagnosing issues.

---

## 📊 Log levels

- **`NONE`**
  - Turns off all logging: the server writes nothing to stdout or stderr (test: [nothing reaches stdout or stderr outside LOG_LEVEL](../server/test/privacy-logs.test.mjs))

- **`ERROR`**
  - Startup/config failures
  - File I/O errors and unexpected exceptions

- **`WARN`**
  - Security/config warnings
  - Rate limit triggers

- **`INFO`**
  - Startup and configuration summary
  - Feature flags and size/retention limits
  - Storage usage at startup
  - Nothing per upload or download (test: [the default log level writes nothing per transfer](../server/test/privacy-logs.test.mjs))

- **`DEBUG`**
  - Detailed transfer flow logs
  - Cleanup events
  - Helpful for diagnosing tricky upload/download issues

---

## ✅ Recommended defaults

- Run with **`LOG_LEVEL=INFO`** for normal use.
- Temporarily switch to **`LOG_LEVEL=DEBUG`** when diagnosing an issue, then turn it back down.
- If you’re extremely sensitive about logging, use **`LOG_LEVEL=NONE`**: the server then writes nothing at all (test: [nothing reaches stdout or stderr outside LOG_LEVEL](../server/test/privacy-logs.test.mjs)).

---

## 🖥️ The desktop app

The Dropgate Client keeps its log **in memory** and writes nothing of it to disk, unless you turn on **Keep log on disk for troubleshooting** (**Settings**, under **Privacy**), to send it with a bug report; turned off, the file is deleted at once. The log never names your files or their folders, and each line is redacted before it's kept besides: a file's path keeps only its file name, and a link loses its query and its `#` fragment, where an encrypted upload's key is. The log goes when the app quits, and a `debug.log` an earlier version left behind is deleted when it starts (tests: [keeps no log on disk by default, through an upload and a restart](../tests/integration/desktop/settings-view.spec.mjs); [Keep log on disk for troubleshooting: off and no file by default…](../tests/integration/desktop/settings-view.spec.mjs)).

A link it copies to the clipboard is marked to be left out of Windows' clipboard history and cloud clipboard, and out of KDE's history on Linux, since it holds the key. Its notifications say how many files it's uploading, never which, and the one before a paused upload's deadline gives only the time (tests: [a link is copied kept out of the clipboard's history and sync, and notifications and the log never name a file](../client/test/main.test.mjs); [a notification comes 5 minutes before the deadline, naming no file, and the upload stays paused](../tests/integration/desktop/pause-upload.spec.mjs)). The files you give it, and its uploads, waiting, running, queued, paused or finished, are held in its memory only: a finished one's link stays on its card until you remove it or quit, and nothing of them, or of a link, is written to disk (tests: [after an upload and a restart, nothing in the profile holds the file's name…](../tests/integration/desktop/profile.spec.mjs); [quit with an upload paused part-way, nothing in the profile holds…](../tests/integration/desktop/profile.spec.mjs)). Closing its window while uploads go on keeps them going in the tray, out of sight but counted on its icon; quitting cancels every one, and each server is told to drop it (test: [Quit from the tray cancels every transfer, running, paused and queued…](../tests/integration/desktop/tray.spec.mjs)). Uploads ending out of sight are told of together, by counts, never by name (test: [transfers ending while the window is out of sight are told of in one notification…](../tests/integration/desktop/tray.spec.mjs)). A finished upload's manage token, which its **Delete** sends, is held only by the app's transfer window, the hidden window that makes its requests: from the upload's end until it's removed or deleted, or the app quits. The rest of the app never holds it, and it's never written to disk (tests: [Delete asks first…](../tests/integration/desktop/delete-upload.spec.mjs); [removing a finished upload makes the transfer window forget its token…](../tests/integration/desktop/delete-upload.spec.mjs)). A link pasted into **Download** is held only by the transfer window, from then until the download is removed or the app quits; the rest of the app keeps only the server's address, and neither the link nor its key is ever written to disk. While a download runs, or is paused, its decrypted bytes are in a folder in the app's own data folder, `Partial Downloads`, under a random name, until it's moved into place under its own name; one cancelled or failed is deleted at once, a link to several files' with every file of it already whole, and the folder is emptied every time the app starts and quits, so a crash leaves nothing there for long (tests: [cancelled while it runs, a download leaves nothing…](../tests/integration/desktop/download-leftovers.spec.mjs); [killed mid-download, the app leaves its partial file in the profile…](../tests/integration/desktop/download-leftovers.spec.mjs)). A link to several files is saved as files in a new folder of its own, named only for when it was saved, or as one ZIP named the same way: neither name says anything of the files or where they came from (tests: [a bundle's chosen files are saved as files into a new folder of their own…](../tests/integration/desktop/download-bundle.spec.mjs); [a bundle as one ZIP…](../tests/integration/desktop/download-bundle.spec.mjs)). On Windows, every file it saves carries the Mark of the Web, as a browser's downloads do, holding only that it came from the internet: never the server's address or the link (test: [on Windows, every file saved carries the Mark of the Web, the zone alone, and no other stream…](../tests/integration/desktop/download-bundle.spec.mjs)). Its log, when you keep it on disk, names no file, folder or link of a download, and after uploads, a Delete and downloads, nothing in its data folder holds any of them (tests: [the log kept on disk holds the downloads, and none of their names, folders, links, keys or IDs](../tests/integration/desktop/nothing-kept.spec.mjs); [after uploads, a Delete, downloads saved and one paused at quit, nothing in the profile holds…](../tests/integration/desktop/nothing-kept.spec.mjs)). The app never opens a file it has received: **Show in Folder** only shows its folder, and **Open Folder** opens a folder of files it saved (tests: [after a download and a restart, nothing in the profile holds the link, its key…](../tests/integration/desktop/download.spec.mjs); [quit with a download paused, the partial folder is empty, and nothing in the profile holds…](../tests/integration/desktop/download-pause.spec.mjs); [a pasted link reads its list of files with no lease and waits…](../tests/integration/desktop/download.spec.mjs)). On Windows, the installer keeps one choice (whether you added "Share with Dropgate" to the right-click menu), so updates keep it; uninstalling removes it.

It checks GitHub for updates, and sends nothing that identifies the installation: the update library's install ID is replaced with a fixed value, the same for everyone, no ID is made or kept, and the one version 3 kept is deleted (tests: [on each channel, two new installs' update checks carry no ID of either, and leave none in the profile](../tests/integration/desktop/updates.spec.mjs); [an upgrade from v3 deletes the ID of the install v3's updater kept, and never sends it](../tests/integration/desktop/updates.spec.mjs)). It downloads no spell-check dictionaries (test: [downloads no spell-check dictionaries](../tests/integration/desktop/dictionaries.spec.mjs)).

What it stores, and what each update check sends, is in [Data Processing](./technical/DATA-PROCESSING.md#25-dropgate-client-electron).
