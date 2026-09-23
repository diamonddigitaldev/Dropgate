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
- If you’re using the Web UI in a browser, make sure you’re on **HTTPS** (localhost is the usual exception).
- If you’re behind a reverse proxy, make sure it allows request bodies large enough for upload chunks (often called something like “max body size”).
- Ensure your network/firewall allows traffic on the server port (default `52443`, or the value set by `SERVER_PORT`).

## 2) Enable debug logging

Set `LOG_LEVEL=DEBUG` on the server, reproduce the issue once, then set it back.

- `LOG_LEVEL=DEBUG` → detailed transfer flow
- `LOG_LEVEL=INFO` → normal operation
- `LOG_LEVEL=NONE` → no logs at all

## 3) Hosted upload issues

**Uploads are disabled / 404 on upload routes**
- Make sure `ENABLE_UPLOAD=true`.

**"File exceeds limit … MB" / "Total bundle size exceeds limit" / "Chunk too large" / 413**
- Increase `UPLOAD_MAX_FILE_SIZE_MB`.
- For multi-file uploads, the default behaviour (`UPLOAD_BUNDLE_SIZE_MODE=total`) enforces the size limit against the combined size of all files. Set it to `per-file` to check each file individually instead.
- If you're behind NGINX/Caddy/etc, also check your proxy's upload/body size limit.

**“Server out of capacity” / 507**
- Increase `UPLOAD_MAX_STORAGE_GB` (or set `0` for unlimited), and/or free disk space.

**"Integrity check failed" / "Upload incomplete"**
- Often proxy buffering/timeouts, unstable networks, or middleware touching the request body.
- Enable `LOG_LEVEL=DEBUG`, retry once, and check where it fails (init vs chunk vs complete).

**Tuning chunk size**
- The upload chunk size is controlled by `UPLOAD_CHUNK_SIZE_BYTES` (default `5242880` / 5MB, minimum `65536` / 64KB).
- If you're behind a reverse proxy with a body size limit, make sure the proxy allows at least `UPLOAD_CHUNK_SIZE_BYTES + 1024` bytes per request (the extra 1024 accounts for encryption overhead and request framing).
- Lowering the chunk size can help on unstable connections (smaller chunks = less data to re-upload on failure), but increases the number of HTTP requests per file and adds per-chunk overhead (hashing, encryption IV/tag).
- The 64KB minimum prevents extreme fragmentation — values below this would generate millions of chunks for moderate files and cause significant per-chunk overhead.
- **If you use `UPLOAD_PRESERVE_UPLOADS=true`, don't change the chunk size while encrypted files are still stored.** Encrypted files are decrypted using the server's current chunk size, so files uploaded before the change will fail to download. Let them expire first (or clear them), then change it. See [DGUP §4.8](./technical/DGUP.md#48-chunk-framing-on-download).

**"Too many chunks" error**
- The server limits files to 100,000 chunks maximum (about 500GB at 5MB chunk size).
- **Solution**: Increase `UPLOAD_CHUNK_SIZE_BYTES` to reduce the number of chunks. For very large files, consider using a 10MB or 20MB chunk size.

**"Too many files" error (bundles)**
- Bundles are limited to 1,000 files maximum for security and performance reasons.
- **Solution**: Split your files into multiple separate uploads, or use client-side ZIP compression before uploading.

## 4) Encryption / HTTPS issues

- Browsers only provide some features Dropgate relies on in a **secure context** (HTTPS or localhost), notably the Web Crypto API used for end-to-end encryption. The Web UI also only enables direct transfer (P2P) in a secure context.
- If you see missing buttons or “blocked” errors in the Web UI, run the server behind HTTPS.

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

## 7) Still stuck?

When asking for help, include:
- Your `GET /api/info` output
- A short snippet of server logs around the error (ideally with `LOG_LEVEL=DEBUG`)
- Whether you’re using a reverse proxy/tunnel (NGINX/Caddy/Cloudflare Tunnel/Tailscale)
