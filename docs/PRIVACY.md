# 🔒 Privacy and Logging

Dropgate is built to be **privacy-first** and **transparent**.
That means: logs exist for diagnostics, but they’re designed to be **minimal**, **non-identifying**, and **optional**.

Logging is controlled by the `LOG_LEVEL` environment variable (default: `INFO`).
The current log level is also exposed to clients via `GET /api/info` so users can see what they’re interacting with.

---

## ✅ What Dropgate does *not* log

Dropgate is intentionally opinionated about avoiding identifying data.
By design, Dropgate's own log messages **never** include:

- File contents / Bundle manifests
- File names
- Encryption keys / URL fragments
- Upload session IDs
- File IDs
- Bundle IDs
- Client IP addresses
- Per-request identifiers or headers

If you’re running a public instance, this is one of the key ways the project tries to reduce “paper trails”.

**Everything the server writes goes through `LOG_LEVEL`,** errors included:

- **Unexpected errors** are logged at `ERROR` by the kind of error and the route's pattern only, such as `GET /api/file/:fileId (Error, ENOENT)`: never the error's message or stack trace, which could hold the internal path of a stored file (and so its file ID) or part of a request body. The answer to the request says only that something went wrong.
- **A misconfigured reverse proxy,** one that passes a client address the rate limiter can't read (for example `IP:port`), is logged at `ERROR` by the rate limiter's error code, never the address.

---

## 🧾 What Dropgate *may* log

Depending on your `LOG_LEVEL`, you may see:

- Startup configuration (feature flags, limits, and server name)
- Storage usage at startup (useful for capacity limits)
- Rate limit warnings
- Internal errors, by their kind only (from Node.js / the OS)

At `DEBUG` level you may also see:

- Upload/download lifecycle events (init/chunk/complete/download)
- An upload paused or resumed, and one that ended at its deadline, with its size
- Chunk counts and chunk sizes
- The number of files in a bundle
- Cleanup of expired or incomplete uploads

**A paused upload** is kept only in the server's memory, with its temporary file and the storage it reserved, until its pause runs out (`UPLOAD_MAX_PAUSE_MINUTES`): then it goes at once. Nothing about it, not even that it exists, is written to a database, so a restart ends it, with `UPLOAD_PRESERVE_UPLOADS=true` too. No upload in progress, paused or not, records an IP address or when it started.

File sizes and capacity values may appear in logs because they’re necessary for understanding limits and diagnosing issues.

---

## 📊 Log levels

- **`NONE`**
  - Turns off all logging: the server writes nothing to stdout or stderr

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
  - Nothing per upload or download

- **`DEBUG`**
  - Detailed transfer flow logs
  - Cleanup events
  - Helpful for diagnosing tricky upload/download issues

---

## ✅ Recommended defaults

- Run with **`LOG_LEVEL=INFO`** for normal use.
- Temporarily switch to **`LOG_LEVEL=DEBUG`** when diagnosing an issue, then turn it back down.
- If you’re extremely sensitive about logging, use **`LOG_LEVEL=NONE`**: the server then writes nothing at all.

---

## 🖥️ The desktop app

The Dropgate Client keeps its log **in memory** and writes nothing to disk, unless you turn on **Keep log on disk for troubleshooting** (**Settings**, under **Privacy**), to send it with a bug report; turned off, the file is deleted at once. The log never names your files or their folders, and each line is redacted before it's kept besides: a file's path keeps only its file name, and a link loses its query and its `#` fragment, where an encrypted upload's key is. The log goes when the app quits, and a `debug.log` an earlier version left behind is deleted when it starts.

A link it copies to the clipboard is marked to be left out of Windows' clipboard history and cloud clipboard, and out of KDE's history on Linux, since it holds the key. Its notifications say how many files it's uploading, never which. On Windows, the installer keeps one choice (whether you added "Share with Dropgate" to the right-click menu), so updates keep it; uninstalling removes it.

It checks GitHub for updates, and sends nothing that identifies the installation: the update library's install ID is replaced with a fixed value, the same for everyone, no ID is made or kept, and the one version 3 kept is deleted. It downloads no spell-check dictionaries.

What it stores, and what each update check sends, is in [Data Processing](./technical/DATA-PROCESSING.md#25-dropgate-client-electron).
