<div align="center">
   <img alt="Dropgate Logo" src="../docs/img/dropgate.png" style="width:100px;height:auto;margin-bottom:1rem;" />

   # Dropgate Client

   <p style="margin-bottom:1rem;">An Electron-based desktop app for sharing files through Dropgate, a self-hosted, privacy-first file sharing system.</p>
</div>

<div align="center">

![license](https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square)
![version](https://img.shields.io/badge/version-3.0.13-brightgreen?style=flat-square)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey?style=flat-square)

[![discord](https://img.shields.io/discord/667479986214666272?logo=discord&logoColor=white&style=flat-square)](https://diamonddigital.dev/discord)
[![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee&logoColor=000000&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>


## Overview

**Dropgate Client** is the desktop app for uploading files to a Dropgate Server and downloading them again.
It’s built to feel simple: drop your files, hit **Upload**, and share the link; paste a link, hit **Download**, and the files are in your folder.


## Features

* **End-to-End Encryption (E2EE)** | Encrypt on your device before upload, decrypt on the recipient’s device. The server doesn’t need your key.

* **Server Agnostic** | Connect to any compatible Dropgate Server — whether it’s self-hosted at home, deployed via Docker, or behind a reverse proxy.

* **Privacy by Design** | No telemetry, no analytics, and no personal identifiers. It keeps no history: nothing of your uploads or downloads outlives quitting the app, but the files you download. Your data stays between you and your chosen server.

* **Cross-Platform Support** | Available for Windows and Linux.

* **Your Servers** | Save the servers you use, pick one for each upload, and, if you choose, let an upload a server can't take go on to the next one in your list. A server is only contacted when it's used.

* **Downloads** | Paste a Dropgate link to download its file into a folder of your choice, decrypted on your device. A link to several files is saved as files in a folder of their own, or as one ZIP, all of them or those you choose.

* **Multi-File Uploads** | Select or drag-and-drop multiple files at once — they're bundled together and uploaded in one go, with one link.

* **Several at Once** | Up to 3 uploads and downloads run at once (up to 6, if you choose), the rest waiting their turn, and they keep going in the tray when you close the window.

* **Pause and Resume** | Pause an upload or a download, and pick it up where it stopped, for as long as the server keeps it.

* **Delete Your Upload** | A finished upload can be deleted from the server, so its link stops working.

* **Smart Compatibility Checks** | The app reads the server's capabilities (limits, encryption support, etc.) and offers only what it allows, so you don’t run into surprises mid-upload.

* **Windows Context Menu Integration** | Right-click a file and upload in the background with **Share with Dropgate**.


## Installation

Download the file for your OS from the latest release on the [releases page](https://github.com/diamonddigitaldev/Dropgate/releases), where `<version>` is the release's version. The app updates itself from then on, however it was installed (**Settings**, under **Update**).

### Windows

1. Download `Dropgate-Client-Setup-<version>.exe` and run it.
2. Windows may say **"Windows protected your PC"**, as the installer isn't signed. Choose **More info**, then **Run anyway**.
3. Choose who it's for: **Only for me** (the default, which needs no administrator), or **Anyone who uses this computer**. If Dropgate Client is already installed for everyone, as every version 3 install was, this is skipped and that copy is upgraded, so there are never two.
4. Choose whether to add **Share with Dropgate** to the menu a file shows when it's right-clicked (ticked by default). Your choice is kept for updates.
5. It adds a desktop shortcut, and one in the Start menu's **Diamond Digital Development** folder.

To open files with the app, drop them on its desktop shortcut, or use **Share with Dropgate**. It claims no file type, so it's never any file's default. Uninstalling it (**Settings** > **Apps**) takes away everything the installer added.

### Linux

On Debian or Ubuntu, install the `.deb`:

```bash
sudo apt install ./Dropgate-Client-<version>.deb
```

On Fedora, install the `.rpm`:

```bash
sudo dnf install ./Dropgate-Client-<version>.rpm
```

Both install it for everyone on the computer, and add it to the applications menu and to the file manager's **Open With** for any file. They update themselves in the app, asking for your password to install each update.

Or run the AppImage, which needs no installing:

```bash
chmod +x Dropgate-Client-<version>.AppImage
./Dropgate-Client-<version>.AppImage
```

It runs for whoever runs it, and adds itself to the menu and **Open With**, and shows its own icon in the taskbar or dock, only once a tool such as AppImageLauncher or Gear Lever has integrated it.

There's no right-click "Share with Dropgate" on Linux: use **Open With**, which adds the files to Upload.

The `latest.yml`, `latest-linux.yml` and `.blockmap` files on each release are for the app's updater: you don't need to download them.

To go back to an earlier version, uninstall the app and install that version from the releases page.

Then launch the app and add your server in **Settings**, under **Servers** ([Uploading](#uploading)).


## Usage

The app has two sections, in the sidebar: **Upload** and **Download**. Each upload and download waits on its own until you start it, runs with its own **Pause**, **Resume** and **Cancel**, and stays, with its link or where it was saved, until you remove it (its **×**, or select several and choose **Remove**), **Clear Finished** takes every one that has ended, or you quit. A failed or cancelled one has **Retry**, which makes it wait again. Click one to select it (**Ctrl** to add one, **Shift** for a range, **Ctrl+A** for all, **Delete** to remove those selected); the bar above them then acts on those selected, or on every one when none is.

### Uploading

1. **Add your server** in **Settings**, under **Servers** (for example, your home server or a private Dropgate instance): choose **Add Server**, enter its address and choose **Check**, which shows what it found (its name and version, whether uploads there are end-to-end encrypted, and its limits), then **Add Server** to save it. The first server you add is the default, where new uploads go. In its row, under **New uploads to this server**, set the file lifetime and max downloads each new upload starts with, within what the server allows.
2. **Add files** on **Upload**: drag and drop them into the window, or choose **Add Files**. The files added together are one upload, with one link, and it waits on its own, **Ready**, on the default server, with that server's settings for new uploads. Files dropped onto an upload that's waiting join it; a file already in it is skipped. Dropped onto one that has started, they're a new upload. Folders and empty files are skipped, and the app says so.
3. **Choose its server**, if not the default: an upload's **To** lists every server you've saved, by name (with its address where two share a name), and **Upload all to** on the bar above (**Upload selected to** with some selected) sets several at once. An upload moved to another server takes that server's settings for new uploads, and its line, its Advanced Options, its encryption and its Pause follow that server. A server is checked when an upload is moved to it, unless the app has already found it since it started. Once an upload starts, its server can't be changed ([tests](../tests/integration/desktop/upload-servers.spec.mjs)).
4. **Hit Upload** on it, or **Upload All** for every one waiting. Each goes to its own server, checked again first. An upload is end-to-end encrypted whenever its server supports it over HTTPS; when it can't be, Upload asks first (the **Upload Security Warning**, once for each such server's uploads it starts). When it finishes, the **download link is copied to your clipboard**, and the upload shows it, with **Copy Link** to copy it again.

Files opened with the app (**Open with**, files dropped on its icon, or opened while it's running) are added to **Upload**, every one of them: the files of one opening are one upload, waiting. On a Wayland desktop (such as GNOME's), a file opened while the app is running is added, but the desktop may only mark the app's icon as wanting attention instead of bringing its window forward.

### Downloading

1. **Paste a Dropgate link** into the box on **Download**, and choose **Add** (or press **Enter**). The app reads the upload's list of files first, which counts as no download, and shows its name and size (or how many files it has), waiting, **Ready**. A direct transfer's code or link isn't taken yet: the desktop app gets direct transfers later.
2. **Save to** on it says where it's saved: the folder in **Settings**, under **Transfers** (your system's Downloads folder unless you've chosen another), or **Choose Folder…** to pick one for it. **Save all to**, on the bar above, sets it for every download waiting, or those selected.
3. **Hit Download** on it, or **Download All**. The file is decrypted on your device as it comes, and its status line says **Saving…** as it's put in place, then where it was saved.

A file is never saved over one already there: if its name is taken, it's saved as `name (1).ext`, and so on. Its name is made safe for every system first (a name such as `CON.txt` is saved as `_CON.txt`, and a character that would hide part of a name is shown, as `[U+202E]`). Until it's whole, it's written in a folder in the app's own data folder, `Partial Downloads`, under a random name, and only then moved into its folder; that folder is emptied whenever the app starts and quits, so a download that didn't finish (cancelled, failed, or cut off by a crash) leaves nothing behind.

Or open the link in your web browser, and download it there. Either way, an end-to-end encrypted file is decrypted on your device.

### A Link to Several Files: As Files or One ZIP

A link to several files is downloaded all at once, as one download, counted once. Its **Advanced Options** lists its files, each ticked to download or not, and **Save as one ZIP**:

* **Saved as files** (the default), they go into a new folder of their own in its Save to folder, named for when they're saved (`dropgate-bundle-20261010-143205`, the date and time), and only once every one is whole: one cancelled part-way leaves no file and no folder. A single file chosen of them is saved on its own, as a link to one file is.
* **Saved as one ZIP**, it's one file in its Save to folder, named the same way (`dropgate-bundle-20261010-143205.zip`), holding only the files chosen; a ZIP of any size, written as ZIP64 where it needs it.

The line under its name says what's set ("3 of 8 Files · As One ZIP"), and while it downloads, which file it's on ("Downloading 41% · File 2 of 8"). **Bulk Edit**, on the bar above, sets **Save as one ZIP** for every one selected.

### Show in Folder and Open Folder

A finished download has **Show in Folder**, which opens the folder it was saved in with it selected, or, for files saved in a folder of their own, **Open Folder**, which opens that folder. The app never opens a file it has received.

### The Mark of the Web (Windows)

On Windows, every file the app saves, a ZIP and each of a bundle's files, is marked as having come from the internet, as your browser's downloads are: the Mark of the Web, which says only that, with no address in it. So Windows checks a program before it runs, and Office opens a document in Protected View. A drive that can't hold the mark (FAT, exFAT, some network shares) gets the file unmarked, as it would from your browser. On Linux, nothing is added.

### Advanced Options and Bulk Edit

An upload that's waiting has its own **Advanced Options**, and **Bulk Edit**, on the bar above, sets them for every one selected: the file lifetime and max downloads, offering only what its server allows (**Apply** is off, with the reason under the field, for a value outside it; uploads selected for different servers are held to the tightest of their limits, and the help line names the server that sets each), and for one upload of several files, its files, each of which can be taken out. They also say whether it will be end-to-end encrypted, which they can't turn off, and have its **Allow Fallback** ([below](#allow-fallback)), which starts as its server's. The line under an upload's name says what it has that differs from its server's settings for new uploads ("3 Days · 10 Downloads · No Fallback"). An upload whose settings are outside what its server allows as it starts (`config.json` edited by hand, or a server that has lowered its limits since) stops and asks first: **Use the Server's Limits** goes on with them, and **Cancel** leaves it waiting.

A download's Advanced Options are for a link to several files ([above](#a-link-to-several-files-as-files-or-one-zip)): a link to one file has nothing more to choose but its Save to.

### Allow Fallback

**Allow Fallback** is off unless you turn it on: for a server, in its row in **Settings > Servers**, for every new upload to it, or for one upload, in its **Advanced Options**. With it on, an upload its server can't take before any of it is sent (the server can't be reached, has uploads turned off, is full, is too small for it, doesn't allow its file lifetime or download limit, or needs a newer app) goes to the next server below it in **Settings > Servers**, in that order, and then the next. Each of those servers is checked only when the upload gets to it ([tests](../tests/integration/desktop/fallback.spec.mjs)).

* A server that's no less private takes it straight away. Its **To** then names that server, the line under its name says "Moved From" the server it was going to, and once it's done it says "Uploaded to" that server.
* A server that would be a step down is never used without asking first: one on plain HTTP after HTTPS, one that won't end-to-end encrypt it, or one that keeps files for less time or allows fewer downloads than the upload asks for. **Upload There** sends it there, held to that server's limits, and **Cancel** stops it, on its own server, saying why that server couldn't take it.
* Once a server has taken the upload's start, it stays there: a failure from then on fails it, with **Retry**. No file's contents are ever sent to two servers.
* With it off, an upload its server can't take stops and says why.

Each server an upload falls back to learns your IP address and the upload's size as it's checked and tried, as the server you chose would. A server that turns down an upload's start has been sent that start, as any server is: its size, and for an upload that isn't end-to-end encrypted, its files' names. **Share with Dropgate** takes the default server's Allow Fallback.

### Pause and Resume

On a server that allows it, **Pause** sits beside **Cancel** on an upload or a download while it runs. Paused, its status line says until when the server keeps it ("Paused. Kept until 14:32."), as long as the server's operator allows (an hour by default). **Resume** carries on from where it stopped; a download is still counted as one. Nothing resumes by itself: 5 minutes before that time (or as it pauses, if the server keeps it for less), a notification says so ("Upload Still Paused" or "Download Still Paused"), naming no file, and one still paused then ends with "The server dropped this paused upload." (or download). A file changed while its upload runs or is paused can't be read on, so the upload fails rather than send part of the old file and part of the new one. A paused download's part-written file waits in `Partial Downloads`.

### Deleting an Upload

A finished upload has **Delete**, which asks first, then deletes it from the server at once: its link stops working, and the upload says so. It's there until you remove the upload or quit: what deletes it, its manage token, is kept in the app's memory until then, and never written anywhere.

### Several at Once

Up to 3 transfers run at once, uploads and downloads together (**Settings**, under **Transfers**, sets it from 1 to 6); any more wait as queued ("Queued: Starts when one of the 3 running finishes."), and start in the order they were added as one finishes. A paused one doesn't hold a place: resumed while the others take every place, it waits for one. When transfers end while the window isn't in front of you, one notification tells of those ending together ("3 Uploads Finished", "2 Downloads Finished"), with counts and never a file's name, and after uploads the latest link is the one on the clipboard. While a transfer runs, your computer isn't let suspend the app.

### The Tray and Quitting

With uploads or downloads running, paused or queued, closing the window keeps them going: it hides, and Dropgate's icon shows in the notification area (or your Linux desktop's tray, where it has one), with **Open Dropgate Client**, how many are going ("2 Uploading • 1 Queued"), and **Quit**. The first time, a notification says so. Once they've all ended, the app quits, as it would have when you closed it. With nothing going, closing the window quits.

**Quitting**, from the tray or the menu, cancels every upload, each server told to drop it, and every download, its part-written file deleted: nothing of them is kept, and every link and manage token the app held goes with it.

### Share with Dropgate (Windows)

Right-click a file, or several, and choose **"Share with Dropgate"** to upload them in the background, several files as one upload with one link, to the default server in **Settings > Servers**, with its settings for new uploads (held to what the server allows), and its Allow Fallback; no other server is asked anything, unless it falls back ([tests](../tests/integration/desktop/upload-servers.spec.mjs), [its fallback](../tests/integration/desktop/fallback.spec.mjs)). (On Windows 11, it's under **Show more options**.) It's end-to-end encrypted when the server supports it over HTTPS; if it can't be, the window opens to ask first (the **Upload Security Warning**). Notifications say how it goes, counting the files and never naming them, and its link is copied once it's done. If the app wasn't open, it quits once the upload has ended; share again while one is going and they upload side by side.

### Settings and Updates

**Settings** is at the bottom of the sidebar, and in the menu (`Ctrl+,`). Its tabs are:

* **Servers**: the servers you upload to, in order, a row each, with its name and its address under it (many servers keep the name "Dropgate Server"), what its last check found ("Online · Dropgate 4.0.0 · End-to-End Encrypted", "Online · Dropgate 4.0.0 · Plain HTTP · Not Encrypted", "Can't connect", or "Not checked yet"), and its limits once it's been checked ("Keeps Files Up to 24 Hours · Up to 5 Downloads · Up to 100 MB"). **Default** marks the one new uploads and **Share with Dropgate** start on. Each row's arrow shows its settings for **New uploads to this server**: the file lifetime and max downloads each new upload to it starts with, offering only what the server allows (a value outside it says why under the field, and isn't saved), and off until the server has been checked. A server added starts at 24 hours (or its shorter limit) and 1 download, with **Allow Fallback** off; its switch there turns it on for new uploads to it, its help line saying what it does as it's flipped ([Allow Fallback](#allow-fallback)). **Test** checks it again, **Set as Default** makes it the default, **Move Up** and **Move Down** change the order (the order an upload falls back in), and **Remove** forgets it, with its settings, after asking (an upload already under way to it carries on; if it was the default, the first left takes its place). **Add Server** checks an address before saving it, as above; invite links aren't supported yet. As the app starts it checks only the default server; another is checked when you add it or test it, when an upload is moved to it (unless it's been found since the app started), as an upload starts on it, and as an upload falls back to it. **Remove** moves the server's uploads still waiting to the default. What a check found is kept in the app's memory only; the list itself is in its settings, and nothing else on disk names a server, so one removed leaves nothing ([tests](../tests/integration/desktop/servers.spec.mjs), [each upload's server](../tests/integration/desktop/upload-servers.spec.mjs), [the fallback](../tests/integration/desktop/fallback.spec.mjs)).
* **Transfers**: **Save downloads to**, the folder new downloads are saved in (your system's Downloads folder unless you choose another with **Browse**; **Reset** goes back), and **Transfers at once**, how many uploads and downloads run at once, from 1 to 6 (3 by default).
* **Privacy**: **Keep log on disk for troubleshooting**, off by default: the app's log is kept in memory only, and goes when the app closes. Turned on, it's also kept in `debug.log` in its user data folder, with none of your file names, folders or links in it, to send with a bug report; turning it off deletes the file.
* **Update**: the version you're running, **Check for Updates**, and whether updates download by themselves (on by default; an update downloaded is installed when you close the app). The update channel is **Stable**, **Beta** or **Alpha**: a new install starts on its own version's channel, and your choice is kept from then on. The app never offers an older version than the one you have.
* **Credits**.

The app checks GitHub for updates a few seconds after it starts, and sends nothing that identifies your installation. Its log is kept in memory, and on disk only if you turn that on. A link it copies is left out of Windows' clipboard history and cloud clipboard, since it holds the key. What it stores and sends is in [Data Processing](../docs/technical/DATA-PROCESSING.md#25-dropgate-client-electron), and what to do when something goes wrong in [Troubleshooting](../docs/TROUBLESHOOTING.md#7-the-desktop-app).


## Direct Transfer (P2P)

The desktop app doesn't do direct transfers yet: **Download** takes links to uploads, and says so when it's given a direct transfer's code or link. If your server has **Direct Transfer (P2P)** enabled, you can use it from the server’s **Web UI** in your browser.


## Development

To set up a development environment:

```bash
git clone https://github.com/diamonddigitaldev/Dropgate.git
cd Dropgate/client
npm ci
npm start
```

The app is built on [electron-kit](https://github.com/diamonddigitaldev/electron-kit), Diamond Digital Development's shared library for its desktop apps: the window and its sidebar, Settings with its Update and Credits tabs, the updater, the menu, prompts and notifications in the window, and the log. Dropgate's own parts are its Upload and Download sections, its Servers, Transfers and Privacy tabs, and Share with Dropgate.

It runs on [`@dropgate/core`](../packages/dropgate-core/README.md), loaded from [`src/dropgate-core.js`](src/dropgate-core.js) by its transfer window: a hidden window, in a session of its own, that makes every request the app makes to a server, and reads the files it uploads from a file service, a utility process, which also writes the files it downloads, so neither the app's window nor its main process ever holds a file's bytes. That file is core's build, written by `npm run build` in `packages/dropgate-core` and committed, so the app runs and packages without building core first. Don't edit it: change core's source and build it again ([Building and Testing](../docs/core/building-and-testing.md)). GitHub Actions fails if it isn't core's build.

The main process keeps every upload, the window's and Share with Dropgate's, and every download, in a registry, in memory only ([`src/core/transfers.js`](src/core/transfers.js)): it decides which run (3 at once, unless **Transfers at once** says otherwise) and which wait, and tells the window of each at most 4 times a second. The transfer window and the file service start together with the first server check, upload or link pasted into Download, and close 30 seconds after the transfer window's last work ends, unless it still holds a finished upload's manage token or a download's link; the file service holds a file only while its upload runs or is paused, and writes one only while its download runs or is paused. The tray icon is the app's own ([`src/tray.js`](src/tray.js)).


## Building

To build the client for your platform:

```bash
npm run build
```

The build config is [`electron-builder.cjs`](electron-builder.cjs), made by electron-kit's `config()`: its shared base, the installer that asks who it's for and about the right-click entry, and Linux's desktop entry. Distributable binaries will appear in the `dist` folder: the NSIS installer on Windows, or an AppImage, a `.deb` and a `.rpm` on Linux. The `.rpm` needs `rpmbuild`, from the `rpm` package on Debian and Ubuntu, or `rpm-build` on Fedora.

GitHub Actions builds all four packages ([`client-build.yml`](../.github/workflows/client-build.yml)): the installer on Windows, and the AppImage, `.deb` and `.rpm` on Ubuntu. It lists each file with its size, checks that the app holds only what `files` in [`electron-builder.cjs`](electron-builder.cjs) keeps (the app's `src/`, and only the files of electron-kit, Bootstrap and Material Icons its pages load) and that it carries core's build as it is, and doesn't publish or upload anything. The release workflow builds them the same way, lists the files a release attaches, with the update files, `latest.yml` and `latest-linux.yml`, checked against them, and attaches them to the release from the same build. Every release has the update files, pre-releases too, since the app's Beta and Alpha channels read a pre-release's. They go up last, after every other file of the release; its dry run only lists them ([Releases](../README.md#releases)).

The client shares its version with the server and core, and they're released together ([Releases](../README.md#releases)). Change it in `package.json`, `package-lock.json` and the badge at the top of this README together, or GitHub Actions fails.


## Running the Tests

Requires Node.js 24.14 or later.

```bash
npm ci
npm test
```

These tests read the app's source rather than launching it, so they don't need a display and don't download Electron. (The app itself is tested end to end, [below](#the-app-end-to-end).) Several use electron-kit's own test helpers. They guard the things that break quietly:

* **The preload contract.** The preload is run as a sandboxed preload would be, and only loads what one can. Every call of its bridge reaches a channel in `src/constants.js`, every channel the page asks is answered in `window-channels.js` through electron-kit (which answers the app's own page only), and every message `main.js` sends reaches the page. Only one channel takes a file's path, `files:add`: from then on the page holds a handle. A mistake in any of these leaves the app doing nothing, with no error in the main process.
* **The transfer window's contract.** Uploads, downloads and server checks run in a hidden transfer window, in a session of its own, and its files are read and written by a file service, a utility process, never by the page or `main.js`. Its preload loads only what a sandboxed one can, and gives its page `window.engine` alone; every engine channel is answered for its session only; its page has no Node and no bridge but its own, and a CSP allowing nothing but its own scripts and requests to servers; it can't navigate or open a window; and the page of the app's window imports no core and makes no request.
* **Every channel's session and shape.** The handlers are loaded as the app registers them, with electron-kit's own check on who's asking and a stand-in for Electron: the app's window is refused every channel of the transfer window's, and the transfer window every one of the app's window's; and every channel refuses a value of the wrong kind, an unsafe number, a path where a handle or an ID goes, and a handle or an upload the main process never made (or made for another window), before it does anything.
* **Share with Dropgate's upload.** The main process makes it with no window, from the server's check: the settings for new uploads held to the server's limits, end-to-end encrypted when the server can be over HTTPS, and Upload's own message when it can't go.
* **Upload and Download.** The page is built on electron-kit's page components (`card()`, `cardGrid()`, `bulkBar()`, `actionBar()`, `busy()`, `switchField()` and `stepSlider()`), and lights a waiting upload files are dragged over but never reads what's dropped itself (the drop zone does). A new upload takes the default server's settings for new uploads from the main process, and its To (a saved server by its ID, never an address) another's; the main process alone changes the saved servers (`core/servers.js`: saved once checked, nothing a check found written, each one's last check held in memory for Settings > Servers, and checked again only at its saved address, by its ID), which also adds files to one only while it waits (each file once, by its path), sets a waiting one's Advanced Options (a lifetime in a known unit, a whole download limit, whether it allows fallback, the files it keeps by their place in it, nothing else), removes only those waiting or ended, makes a failed or cancelled one wait again, and takes whether an upload is encrypted only as the page starts its own, refusing a word that differs from what its server's last check found. The fallback is the main process's alone, from its own checks (`core/servers.js`: which failures move an upload on, only before its server has taken its start; which servers can take it; which would be a step down, asked first), never from the page ([`test/fallback.test.mjs`](test/fallback.test.mjs)). A finished upload's Delete is the transfer window's, with the manage token the main process never holds.
* **Window security.** Every window the app makes itself, the transfer window, keeps `contextIsolation` on, `nodeIntegration` off and the sandbox on, as the main window (electron-kit's) does; Share with Dropgate makes none. The main window's page has a CSP too: only its own scripts, styles, fonts and images, and no request at all; nothing in it is inline.
* **Several at once.** The main process's registry runs 3 transfers at once (or as many as **Transfers at once** says), uploads and downloads together, queues the rest in the order added and starts them as places free, gives a paused one no place (resumed with none free, it waits as queued; while its resume is asked of the server, it keeps its place), answers Restart Now's question while any runs, is paused or is queued, and starts nothing once the app is quitting. One that has ended keeps its link or its reason until it's removed, and takes no place. The window gets each transfer's names and sizes, never a path, at most 4 times a second.
* **When the transfer window and the file service run.** On a stand-in Electron with its clock mocked: the transfer window closes 30 seconds after its last work ends, and not while any runs or it holds a finished upload's manage token (which it forgets as its upload is removed or deleted, or the app quits), and the file service with it; the transfer window gets its port to the file service once its page is ready, before any upload's work, and each upload's grants are revoked as it ends; quitting asks the transfer window to cancel everything, and waits 5 seconds for it at most.
* **What notifications and the tray say.** Uploads ending together are one notification ("3 Uploads Finished", a failure counted), downloads likewise, and both together "Transfers", a cancelled one none, every title in Title Case, and nothing but counts and core's reason; the tray gives counts only ("2 Uploading • 1 Downloading • 1 Queued").
* **The house's copy.** Every word the app can show, read from its source: one-character ellipses, never "card", a capital after a colon, items between bullets in Title Case, file names and addresses never recased, and every button that says it's doing something electron-kit's busy button.
* **Menu shortcuts.** Every shortcut has a modifier, so none of them fires while you're typing.
* **Reading files.** The file service reads only the files granted for an upload, by grant and never by path, a whole-number range inside the file at a time, and none that has changed since it was handed over (its size or its modification time), checked on real files. A window's handle works only for that window.
* **Writing downloads.** On real files: the file service writes only into the folder granted for a download, by the output's ID and never by a path, first in the partial folder under a random name, then moved into place under the name core makes safe and unique there, never replacing a file or following a link planted under the name, and copied where a hard link can't be made; a deep folder and a long name work; one aborted, closed before it's whole or revoked, or whose folder is gone, leaves nothing. A bundle's files are kept whole until the last is, then all moved into a new folder of their own named for when (made unique), or none of them; a ZIP is one file named the same way; and on Windows every file saved gets the Mark of the Web, the zone alone, and no other stream.
* **Downloads' channels and settings.** A pasted link is taken only in the shape Dropgate makes (the main process is told where it points, and passes the link on to the transfer window); a bundle's choice is only of its own files, by their place in it, and whether as one ZIP; a folder is only one the window chose with the system's picker, by an ID; the page can't set the downloads folder or the saved servers itself, and Transfers at once is held to 1 to 6 (electron-kit's settings only the main process changes, and its checks, run with the app's own). A version 1 profile's settings are kept as version 2 adds the downloads folder and Transfers at once, and version 2's server, with its settings for new uploads, becomes the first saved server and the default as version 3 makes them a list, once; the list keeps each server's own settings only, never anything a check found.
* **What comes from electron-kit.** The accent colour meets WCAG 2.2 AA in both themes, the page loads electron-kit's styles and scripts in order, the shared parts (prompts, form dialogs such as Advanced Options and Add Server, a server's status line, notifications in the window, the drop zone, the progress bar) are electron-kit's, Settings' tabs fill the pane and every scrollbar is electron-kit's thin one (the app's stylesheet has no scrollbar rules), the log is kept in memory, the updater is electron-kit's, and the build extends electron-kit's and packs only what the pages load.

Tests for known issues are marked as expected failures, and there are none today. To see each test's name and label, run the tests with the TAP reporter:

```bash
node --test --test-reporter=tap "test/*.test.mjs"
```

GitHub Actions runs the tests this way on Ubuntu and Windows ([`ci.yml`](../.github/workflows/ci.yml)).

### The App, End to End

The app itself is tested with the [integration tests](../tests/integration/README.md), which launch it from this folder with a throwaway profile, against a Dropgate Server started on your machine just for the test. They check its settings, its Settings view, Settings > Servers (Add Server's check before a server is saved, Set as Default, Move Up and Move Down, Remove asking first, each server's settings for new uploads bounded by its limits and a new upload taking the default's, each row's status line, limits and account's place, and the profile naming a saved server in its settings alone, and one only checked or removed nowhere), each upload's server (its To and Upload all to, and a server checked only when it's used), Allow Fallback (an upload its server can't take before it starts moving to the next server below, checked only then, asking first before a step down, a failure after it began failing with Retry, Share with Dropgate taking the default's), that it keeps no log on disk and downloads no spell-check dictionaries, that nothing in its profile holds a file's name, folder or bytes, a link or an upload's ID after an upload or with one paused, and **"Share with Dropgate"**: that a shared file uploads, end-to-end encrypted on a server with HTTPS, and that its link downloads intact; and pausing an upload: the deadline it shows, the notification before it, that nothing resumes by itself, the upload ending at the deadline, and a file edited while paused refused. Several at once: five shares, three running and two queued, a paused one taking no place, and the power-save blocker on only while one runs; the tray: closing the window with an upload running, the notifications when uploads end out of sight, and Quit from the tray leaving the server and the profile holding nothing of them; the main window's CSP; Advanced Options, bounded by the server, and the warning at the start of an upload outside its limits; **Delete**, and that an upload's manage token never passes through the main process and isn't in the profile, after a Delete or after quitting with an upload finished; the house's controls and copy on screen (every button on an upload one size, busy buttons with their spinner, each switch's help following it); and **Download**: a pasted link read with no lease, the file saved byte for byte into its folder under its made-safe, unique name (every awkward name, and a deep folder), Show in Folder, codes and links that aren't an upload's turned away, pausing (the file held in the partial folder, the deadline and its notification), quitting with one paused leaving the partial folder empty and nothing of it in the profile, a link to several files saved as files in a folder of their own (Open Folder) or as one ZIP read back whole, its files chosen, a download cancelled part-way or cut off by a crash leaving nothing, the Mark of the Web on Windows, the kept log naming nothing of a download, and the whole profile holding nothing after uploads, a Delete and downloads, Settings > Transfers kept after a restart, and uploads and downloads counted together. A packaged build's update checks are tested too, for anything that could identify an installation. Off CI they leave your clipboard alone, and they never touch your own settings.

They need this folder's and the server's dependencies. From the repository root:

```bash
cd server
npm ci
cd ../client
npm ci
cd ../tests/integration
npm ci
npx playwright install chromium
npx playwright test --project=desktop
```

The app opens real windows while they run, so on Linux without a desktop, run the last command under `xvfb-run`. GitHub Actions runs them on Ubuntu and Windows.


## Self-Hosting & Networking

Dropgate Client works seamlessly with **self-hosted Dropgate Servers**, which you can run from your own **home server**, **NAS**, or **cloud VPS**.

It plays nicely with common setups like:

* **NGINX** or **Caddy** reverse proxies
* **Cloudflare Tunnel**
* **Tailscale** private networks


## License

Dropgate Client is licensed under the **GPL-3.0 License**.
See the [LICENSE](./LICENSE) file for details.


## Acknowledgements

* Logo designed by [TheFuturisticIdiot](https://github.com/TheFuturisticIdiot)
* Built with [Electron](https://www.electronjs.org/)
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
