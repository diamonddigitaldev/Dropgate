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
- The upload was paused for longer than the server keeps a paused upload: `UPLOAD_MAX_PAUSE_MINUTES` (60 by default) from the pause, the time the Web UI and the Dropgate Client showed ("Kept until …"; the Dropgate Client also notifies 5 minutes before). Nothing resumes by itself, so the server deleted what it had. Upload the files again; to allow longer pauses, raise `UPLOAD_MAX_PAUSE_MINUTES` (at most `1440`, a day).
- A restart drops every upload in progress, paused ones too.
- **"The server dropped this paused download."** in the Dropgate Client is the same for a download: the server let its lease go once the pause ran out, and it counts as one download, since it got part of the file. Nothing of it is left on your disk. Choose **Retry** to download it again from the start, if the upload is still there.
- No **Pause** on an upload or a download in the Dropgate Client: the server has pausing off (`UPLOAD_MAX_PAUSE_MINUTES=0`).

**A download paused in the browser failed, or never finishes**
- The download pages stream each file to disk through the page itself, so a browser's own Pause only works while that page stays open, and only in Chrome: Resume there carries on and saves the whole file. In Firefox, Pause ends the download, and the page says it failed. In Chrome with the page closed while paused, Resume never finishes: cancel it.
- Download the file again from its link. A download that got part of the file counts as one against the upload's download limit, so with a limit of 1 the upload is already gone: ask its sender to upload it again.
- No browser shows such a download as complete: Firefox marks it failed, and Chrome leaves it unfinished. See [DGUP §9.2](./technical/DGUP.md#92-the-download-page).

**A saved file has underscores where its name had spaces**
- Browsers built on the WebKitGTK that Ubuntu 26.04 ships, such as GNOME Web, save every space in a downloaded file's name as an underscore: "photos (holiday).zip" is saved as "photos_(holiday).zip". The browser does this to every download from any site, a direct transfer's too. The file is the same, and Dropgate's page shows its real name. Rename it after saving if you want the spaces back. The same WebKitGTK on Ubuntu 24.04 keeps them, and so do other browsers.

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
  - Try changing `P2P_STUN_SERVERS` to a different STUN provider. With `P2P_STUN_SERVERS=none`, devices on different networks often can't reach each other: that setting is for a server used on one network.
  - Some networks/NATs need a **TURN** server to relay traffic (currently not supported).
- **"Couldn't connect to the other device.":** the two devices found each other through the server but couldn't open a connection between them within 30 seconds (or set it up within 90). Usually that's two networks that can't reach each other directly: one of them behind a strict NAT or firewall, or the server set to `P2P_STUN_SERVERS=none`, which only connects devices that can already reach each other (on one network). Try another network, or a STUN server. There's no relay, so some pairs of networks never connect.
- **The server stops at startup over `P2P_STUN_SERVERS`, `P2P_LOCATOR_LETTERS` or `P2P_MAX_CODES_PER_IP`:** its log says which, and what it takes. In 4.0, `P2P_STUN_SERVERS` set to nothing is an error, where 3.x quietly used Cloudflare's STUN server: remove it for Cloudflare's, or set it to `none` for no STUN server. A `turn:` address is refused too. An app template that passes the setting through empty needs the same change.
- **`PEERJS_DEBUG` was removed in Dropgate 4:** the server warns that it's ignored, and starts. Remove it to quiet the warning.
- **A reverse proxy has to pass WebSocket upgrades to `/api/v4/rendezvous`**, where the two devices find each other. Without that, a send fails as it starts and a receiver's Connect fails, both saying the server couldn't be reached.
- **Senders often see "No short code is free right now…":** the server hands out at most 576 codes at once (2 letters), and each address holds at most 5 unused ones. On a busy server, set `P2P_LOCATOR_LETTERS=3` for 13,824, and `P2P_MAX_CODES_PER_IP` higher for many senders behind one address. The link works either way.
- **Dropgate 3's direct transfers don't work with Dropgate 4,** in either direction: Dropgate 4 has no PeerJS, which they signalled through. A Dropgate 3 app's direct send or receive on a Dropgate 4 server is told to update (`/peerjs` answers 410 `VERSION_UNSUPPORTED`); a Dropgate 3 direct link (`/p2p/<code>`, its code in the path) opens the older-version page; a code from a Dropgate 3 sender reads "No transfer has that code or link." Update both apps, and send again.

**Typing or pasting a code** (the home page's "Enter Sharing Code", and `/p2p` on its own)
- The code goes into eight boxes: four letters, then four digits. The letters are A to Z without I and O, upper-cased as they're typed. A key that doesn't fit where the caret is (a digit among the letters, a letter among the digits, an I or an O, a ninth character) is refused: its box flashes, and nothing changes. The dash is drawn, so typing it, or a space, does nothing. Backspace, Delete, the arrows, Home and End work as in any field.
- **There's no Go button:** the code opens as soon as the eighth character is in. A typo in the last digit is sent too, and a code takes one try, so the transfer fails and the sender's page shows a new code. If the code can't be opened (the server can't be reached, or has direct transfer off), it stays in the boxes with the reason under them: press Enter to try again.
- **Pasting:** a code in any form (lower case, spaces, with or without the dash) opens at once, and so does text with exactly one code in it, such as a chat message. A piece of a code goes in where the caret is, if it fits there. A link opens its own page: an upload's straight away with its key, sending nothing about the upload first; a direct transfer's its "Ready to Connect"; a Dropgate 3 link the older-version page.
- **"That isn't a code or a Dropgate link.":** what was pasted is neither, or holds two codes. **An upload's bare ID** can't be typed or pasted there any more (it could in 3.x): paste its whole link. **"URL must be from this server.":** the link is to another Dropgate server. Open it there.

**The receive page, `/p2p`**
- **"Ready to Connect", and nothing happens:** a link opens on Connect, by design. Until it's clicked, the page asks nothing of the server or anyone else, so a link previewed by a chat app or opened by mistake doesn't tell the sender anyone came. Click Connect.
- **The address bar says just `/p2p`:** the page takes the link's secret out of the address once Connect is clicked, and a typed code (which the home page opens as `/p2p#ABCD-1234`) as soon as the page opens. Both stay in the page's memory only. A reload after that shows the code boxes: open the link again, or ask the sender for the code their page shows now (a code is spent once tried).
- **"No transfer has that code or link. It may have ended, or the code was used.":** the sender's page was closed or the transfer ended, or the code was typed once already. Ask the sender to send again. A link's page offers Retry, for when the sender's page was only reloading.
- **"This browser can't save the download here.":** the page couldn't load what saves the download (StreamSaver), or the browser refused it, such as in some private windows. Nothing was accepted: a link's page never connected, and a code wasn't spent. Try another browser, or a normal window. If it comes at Download, the sender's page waits for another receiver, and the link still works.
- **"Secure Connection Required":** direct transfers need the page over HTTPS (or `localhost`).
- **"Someone entered the wrong code. Here's a new one." on the sending page:** a code takes one try. The receiver who typed it wrong sees the transfer fail; give them the new code. **"No short code is free right now…":** every code the server can hand out is held by other senders. The link works; a code shows by itself once one frees.

**How a transfer ended**
- **"The sender cancelled the transfer." / "The receiver cancelled the transfer." / "The receiver declined the transfer.":** the other person clicked Cancel or Decline.
- **"The sender closed Dropgate before the transfer finished." (or the receiver):** their page was closed or left mid-transfer. It's best effort: a Firefox page closed within a few milliseconds of starting the transfer (at the very moment of Download) can be gone before that message is, so the other side reads "The connection was lost, so the transfer couldn't continue." instead. Either way the transfer has ended on both sides.
- **"This transfer is already going to someone else.":** someone else with the same link accepted first. A link or a code reaches whoever has it, but only one receiver gets the files: ask the sender to send again for you.
- **"The offer wasn't accepted within 10 minutes.":** the receiver saw the files but didn't click Download (or Decline) in time, so the transfer ended on both sides. Send again.
- **"The connection was lost, so the transfer couldn't continue.":** the connection dropped (a network change, a sleeping device) or the other page closed. Interrupted transfers can't be resumed yet: start again, ideally on a steadier connection.
- **"Transfer Paused" with "The sender paused the transfer." (or the receiver):** only the side that paused can resume. Either side can pause too; the transfer runs once neither holds it.
- **The receiver's page said "Handed to your browser. Check your downloads.":** the page has handed the file (several as one ZIP) to the browser's own downloads, which finish writing it. If it isn't there, look at the browser's downloads list.

## 6) Rate limiting

If clients see “Too many requests”:
- Increase `RATE_LIMIT_MAX_REQUESTS` or `RATE_LIMIT_WINDOW_MS`.
- Or disable rate limiting by setting both to `0`.

## 7) The desktop app

**To send its log with a bug report**
- Turn on **Keep log on disk for troubleshooting** in **Settings**, under **Privacy**, and do what went wrong again. The log is `debug.log` in the app's user data folder (`%APPDATA%\dropgate-client` on Windows, `~/.config/dropgate-client` on Linux). It holds none of your file names, folders or links. Turn the setting off afterwards, and the file is deleted.

**Add Server says "Connection failed. Check the URL, and that the server is running."**
- Its **Check** couldn't reach the server. Check the address and the port, that the server is running, and that nothing in between blocks it. Nothing is saved until **Check** has found a Dropgate server there ([Add Server checks an address first…](../tests/integration/desktop/servers.spec.mjs)).
- An address with no `http://` or `https://` is tried over HTTPS, and the app never falls back to plain HTTP by itself. If the server only serves plain HTTP, the message says to enter its address starting with `http://`; uploads to it aren't end-to-end encrypted ([Add Server's Check never retries a server over plain HTTP…](../tests/integration/desktop/no-http-fallback.spec.mjs)).

**Add Server says "That address answered, but not as a Dropgate server."**
- Something answered at that address, but not Dropgate's `/api/info`. Check the port, and, behind a reverse proxy, that the address reaches the Dropgate Server itself.

**An invite link isn't taken**
- Invite links aren't supported yet. Add the server by its address.

**A server's row says "Can't connect"**
- Its last check couldn't reach it; hold the pointer over the status for why. Once the server is back, choose **Test**. New uploads start on the default server, so while a default can't be reached, move uploads to another with their **To** (or **Upload all to**), or choose **Set as Default** on another; or turn on its **Allow Fallback**, and its uploads go on to the next server below it.

**An upload's "To" doesn't list a server, or can't be changed**
- **To** lists the servers saved in **Settings**, under **Servers**: add one there first. Once an upload has started, its server can't be changed; **Retry** on one that failed or was cancelled lets you choose again. An upload waiting on a server you remove moves to the default ([a new upload starts on the default with its settings…](../tests/integration/desktop/upload-servers.spec.mjs), [a removed server's uploads waiting go to the default…](../client/test/channels.test.mjs)).

**An upload moved to another server lost its own lifetime or max downloads**
- An upload moved to another server takes that server's settings for new uploads, as a new upload there would. Set its own again in its **Advanced Options**, within what that server allows.

**"Upload failed: … was checked again since: Try again."**
- The server was checked again (by **Test**, say) between the app deciding whether the upload would be end-to-end encrypted and starting it, and the check found otherwise. Choose **Upload** again: the app never sends an upload unencrypted to a server whose last check says it encrypts.

**A server's row says "Not checked yet"**
- As the app starts it checks only the default server, so the others aren't asked anything until they're used: an upload moved to one, starting on it, or falling back to it, checks it ([at launch only the default server is asked anything…](../tests/integration/desktop/upload-servers.spec.mjs), [an upload its server refuses before any byte is sent moves to the next server below, checked only then…](../tests/integration/desktop/fallback.spec.mjs)). Choose **Test** to check one: its limits then show, and its settings for new uploads can be changed ([a row looks as the mockup…](../tests/integration/desktop/servers.spec.mjs)).

**A server's row says "Needs an Update" or "Uploads Off"**
- **Needs an Update**: the server and the app run different major versions of Dropgate, and can't work together; hold the pointer over the status to see which needs updating.
- **Uploads Off**: the server's operator has turned hosted uploads off (`ENABLE_UPLOAD=false`).

**An upload says "Moved From …", or "Uploaded to …"**
- It allowed fallback (**Allow Fallback**, its server's for new uploads, or its own in **Advanced Options**), and the server it was going to couldn't take it before any of it was sent, so it went to the next server below in **Settings**, under **Servers**, which could. Its **To** names the server that took it, and its link is that server's ([an upload its server refuses before any byte is sent moves to the next server below…](../tests/integration/desktop/fallback.spec.mjs)). To keep an upload on its own server whatever happens, turn **Allow Fallback** off in its **Advanced Options**, or for every new upload to that server, in its row.

**The app asks "Upload to … Instead?"**
- An upload that allows fallback couldn't go to its server, and the next server below would be less private, or hold it for less: plain HTTP after HTTPS, no end-to-end encryption, or a shorter file lifetime or fewer downloads than it asks for. The question says which. **Upload There** sends it there, held to that server's limits; **Cancel** stops it, on its own server, with that server's reason, and **Retry** puts it back there ([a step down is never used without asking…](../tests/integration/desktop/fallback.spec.mjs)).

**"Failed: … No server below it in Settings › Servers could take it." or "… No server is saved below it to try."**
- The upload allowed fallback, but neither its own server nor any below it could take it: what comes first is why its own couldn't. Fix that (or add a server below it, or **Move Up** one that can), and choose **Retry**.

**An upload failed instead of trying another server**
- Only an upload with **Allow Fallback** on moves, and only before any of it is sent: once a server has taken its start, a failure fails it there, with **Retry**, so no file's contents go to two servers ([once its server has taken its start, a failure fails the upload, with Retry, and nothing moves…](../tests/integration/desktop/fallback.spec.mjs)). It moves on only when its server can't take it (can't be reached, has uploads off, is full, is too small, doesn't allow its lifetime, or needs a newer app), and only to a server below it in **Settings**, under **Servers**: use **Move Up** and **Move Down** to set that order.

**A server's file lifetime or max downloads says "Too long" or "Too many"**
- It's outside what the server allows, so it isn't saved: the help under the field says the server's limit. Enter a value within it ([Add, Set as Default, Move Up, Move Down and Remove…](../tests/integration/desktop/servers.spec.mjs)).

**Nothing is left behind when a download fails**
- Until it's whole, a download is written in `Partial Downloads` in the app's user data folder, under a random name, and only then moved into its folder. One that fails or is cancelled is deleted at once (a link to several files' with every file of it, and no folder made), and the folder is emptied whenever the app starts and quits, so a crash leaves nothing there either. Fix what it says, then choose **Retry**, and the download waits again. The server counts each try that got any of the file as one download, so on an upload with a download limit, a try that failed part-way has used one.

**"Failed: The folder to save to isn't there any more."**
- The folder it was to be saved in was moved or deleted after it was chosen. Choose another in its **Save to** (or, for every new download, in **Settings**, under **Transfers**), and choose **Retry**.

**"Failed: There is no space left on the disk."**
- Free some space and choose **Retry**. A download needs room on the drive that holds the app's user data folder while it runs, as that's where it's written until it's whole; saved to another drive, it's then copied there (it says **Saving…** while it is), so that drive needs room for it too.

**"Failed: The folder's path and the file's name are too long together."**
- Long paths work, on Windows too, so this is a path past what the drive itself takes. Choose a folder nearer the top of the drive in **Save to**, and choose **Retry**.

**"Failed: The folder to save to can't be written to." / "… is on a disk that is read-only."**
- Your account can't write in that folder, or the drive is read-only (a locked memory card, a share mounted read-only). Choose another folder in **Save to**.

**A download to a USB stick or a network share takes longer to say Saved**
- A drive with no hard links (FAT and exFAT, as most USB sticks and memory cards are, and many network shares) gets a copy of the finished file, where another folder on the app's own drive gets it at once. It says **Saving…** while it copies.
- On Windows, a file saved there has no Mark of the Web, since those drives can't hold one: Windows won't warn before running a program from it, as it wouldn't for a browser's download there. Check a program before you run it.

**"Failed: The download ended before the whole file came."**
- The file's bytes stopped short of the size its upload gave. Choose **Retry**. If it keeps happening, see [Received data didn't pass its integrity check](#3-hosted-upload-issues), which has the same causes.

**"Failed: The link to this download is no longer held: Paste it again."**
- The app's transfer window, which holds each download's link (its key with it) and nothing else does, stopped by itself, so the link went with it. Remove the download, paste the link again, and choose **Download**.

**"Couldn't open the folder: It was moved or deleted."**
- **Open Folder** opens the folder a link to several files was saved in, and it isn't where it was. The files are wherever it was moved to.

**A pasted link isn't taken**
- **Download** takes a link to an upload, `https://<server>/<id>`, with `#` and its key after it when it's encrypted.
- **"Direct transfers come to the desktop app later. For now, this box takes links to uploads."** A direct transfer's code, with its dash or without, or its link: open it in your browser instead, on the server's Web UI.
- **"That link was made with an older version of Dropgate, which this app can't download."** A link from Dropgate 3: a bundle's (`/b/<id>`), or a single file's whose key after the `#` is 44 characters ending in `=`. Ask its sender to update and send the files again.
- **"That isn't a Dropgate link."** Anything else, such as a link with a query, or one to a page that isn't an upload's.

**"<adapter> isn't connected", or "Failed: <adapter> isn't connected."**
- Dropgate is held to that adapter (**Settings**, under **Network**: **Network interface**), and it isn't there: a VPN that has disconnected, say. Nothing connects until it's back, and nothing goes out through another adapter: uploads and downloads that were running fail, one queued fails at its turn, a paused one's **Resume** is refused, a server's **Test** says **Can't connect**, and update checks fail ([an upload running fails at once, one queued at its turn, nothing moves to the next server…](../tests/integration/desktop/network.spec.mjs)).
- Connect it again, then choose **Retry**. Nothing starts again by itself. Or choose another adapter, or **Any interface**, under **Network interface**.
- An adapter is chosen by its name, so one renamed or reinstalled reads as not connected. A VPN that gives its adapter a new name each time it connects does too: choose it again once it's connected.

**A server on your own network says "Can't connect" with a VPN's adapter chosen**
- With an adapter chosen, Dropgate connects only through it, and a VPN's adapter usually can't reach the devices on your own network (your home server or NAS, at an address such as `192.168.1.20`). Choose **Any interface**, or the adapter of your own network (its Wi-Fi or Ethernet), under **Network interface**, to reach it. A server reached through the VPN itself (such as a Tailscale address) works through the VPN's adapter.

**"External IP Unavailable" in Settings, under Network, or "External IP unavailable" in the bottom bar**
- The dot is yellow, and what's wrong is under it and in its tooltip. Your connection may be fine: this only means your External IP couldn't be found.
- **"… lists no STUN server."** Your default saved server gives none to ask, perhaps as it has direct transfers off. Choose another as your default, or ask its operator.
- **"There's no saved server, so there's no STUN server to ask."** Add one in **Settings**, under **Servers**: the check goes once it's been found.
- **"… couldn't be reached, so its STUN server isn't known."** Check Again asks your default server again first.
- **"… didn't answer within 5 seconds."** or **"… couldn't be reached."** The STUN server didn't answer from this network: a firewall or a VPN may be blocking UDP. With an adapter chosen, it's asked through that adapter only. It's asked again when your network changes, and on Check Again, never by itself in between.

**The location data's month doesn't change, with Refresh location data monthly on**
- It's refreshed as you open Dropgate (not when it starts for **Share with Dropgate**), once the month has turned, by the UTC clock: DB-IP's files for a month come out in the first hours of the 1st. With an adapter chosen, it waits until that adapter is connected.
- If db-ip.com couldn't be reached, or what it sent wasn't DB-IP's location data, nothing is kept: the data you had is still used, and it's tried again the next time you open Dropgate, never sooner (turning the switch off and on doesn't). With **Keep log on disk for troubleshooting** on, the log says which: "The location data couldn't be refreshed (DB-IP couldn't be reached). It's tried again at the next launch." ([on, with the data from an earlier month: a failure waits for the next launch…](../tests/integration/desktop/location-refresh.spec.mjs)).
- A firewall that blocks `download.db-ip.com`, or a VPN's adapter that can't reach it, keeps it from refreshing. The data that came with your version of Dropgate is used meanwhile, and a newer version brings newer data.
- **"This copy of Dropgate has no location data, so country and ISP aren't shown."** A copy run from source without it: run `npm run location-data` in `client/` ([Building](../client/README.md#building)).

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
