<div align="center">
   <img alt="Dropgate Logo" src="../docs/img/dropgate.png" style="width:100px;height:auto;margin-bottom:1rem;" />

   # Dropgate Client

   <p style="margin-bottom:1rem;">An Electron-based, privacy-first file sharing client built for secure communication with Dropgate servers.</p>
</div>

<div align="center">

![license](https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square)
![version](https://img.shields.io/badge/version-3.0.13-brightgreen?style=flat-square)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey?style=flat-square)

[![discord](https://img.shields.io/discord/667479986214666272?logo=discord&logoColor=white&style=flat-square)](https://diamonddigital.dev/discord)
[![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee&logoColor=000000&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>


## Overview

**Dropgate Client** is the desktop way to upload and share files through a Dropgate Server.
It’s built to feel simple: pick a file, choose your options, hit upload, and share the link.


## Features

* **End-to-End Encryption (E2EE)** | Encrypt on your device before upload, decrypt on the recipient’s device. The server doesn’t need your key.

* **Server Agnostic** | Connect to any compatible Dropgate Server — whether it’s self-hosted at home, deployed via Docker, or behind a reverse proxy.

* **Privacy by Design** | No telemetry, no analytics, and no personal identifiers. Your data stays between you and your chosen server.

* **Cross-Platform Support** | Available for Windows and Linux.

* **Multi-File Uploads** | Select or drag-and-drop multiple files at once — they're bundled together and uploaded in one go.

* **Fast, Lightweight Interface** | Simple drag-and-drop UI focused on minimalism and clarity.

* **Smart Compatibility Checks** | The client reads server capabilities (limits, encryption support, etc.) so you don’t run into surprises mid-upload.

* **Windows Context Menu Integration** | Right-click a file and upload in the background.


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

Then launch the client and connect to your server.


## Usage

### Sending a file

1. **Launch** the client.
2. **Enter the server address** you want to connect to in **Settings**, under **Server**, and choose **Test** (for example, your home server or a private Dropgate instance). It's remembered from then on.
3. **Select a file** to upload on **Upload** (or drag and drop it into the window).
4. **Choose your options** (E2EE is auto-applied when available, file lifetime, etc.).
5. **Hit upload!** When it finishes, the **download link is copied to your clipboard**.

**Pausing an upload.** On a server that allows it, **Pause Upload** sits beside **Cancel** while an upload runs. Paused, the status line says until when the server keeps it ("Paused. Kept until 14:32."), as long as the server's operator allows (an hour by default). **Resume Upload** carries on from where it stopped. Nothing resumes by itself: 5 minutes before that time (or as it pauses, if the server keeps it for less), a notification says so, naming no file, and an upload still paused then ends with "The server dropped this paused upload." A file changed while its upload runs or is paused can't be read on, so the upload fails rather than send part of the old file and part of the new one.

Files opened with the app (**Open with**, files dropped on its icon, or opened while it's running) are added to **Upload**, every one of them; a file already in the list isn't added twice. On a Wayland desktop (such as GNOME's), a file opened while the app is running is added, but the desktop may only mark the app's icon as wanting attention instead of bringing its window forward.

**Protip (Windows):** Right-click a file, or several, and choose **"Share with Dropgate"** to upload in the background, several files as one bundle. E2EE is auto-applied when available; if not, you'll see a warning. (On Windows 11, it's under **Show more options**.)

### Settings and updates

**Settings** is at the bottom of the sidebar, and in the menu (`Ctrl+,`). Its tabs are:

* **Server**: the server your uploads go to, and **Share with Dropgate**'s.
* **Privacy**: **Keep log on disk for troubleshooting**, off by default. Turned on, the app's log is also kept in `debug.log` in its user data folder, with none of your file names, folders or links in it, to send with a bug report. Turned off, the file is deleted.
* **Update**: the version you're running, **Check for Updates**, and whether updates download by themselves (on by default; an update downloaded is installed when you close the app). The update channel is **Stable**, **Beta** or **Alpha**: a new install starts on its own version's channel, and your choice is kept from then on. The app never offers an older version than the one you have.
* **Credits**.

The app checks GitHub for updates a few seconds after it starts, and sends nothing that identifies your installation. Its log is kept in memory, and on disk only if you turn that on. A link it copies is left out of Windows' clipboard history and cloud clipboard, since it holds the key. What it stores and sends is in [Data Processing](../docs/technical/DATA-PROCESSING.md#25-dropgate-client-electron).

### Receiving a file

1. Open your web browser.
2. Paste the download link into the address bar.
3. Download as usual. If the file is end-to-end encrypted, decryption happens locally on your device.


## Direct Transfer (P2P)

The desktop client focuses on the classic hosted-upload flow.
If your server has **Direct Transfer (P2P)** enabled, you can use it from the server’s **Web UI** in your browser.


## Development

To set up a development environment:

```bash
git clone https://github.com/diamonddigitaldev/Dropgate.git
cd Dropgate/client
npm ci
npm start
```

The app is built on [electron-kit](https://github.com/diamonddigitaldev/electron-kit), Diamond Digital Development's shared library for its desktop apps: the window and its sidebar, Settings with its Update and Credits tabs, the updater, the menu, prompts and notifications in the window, and the log. Dropgate's own parts are its Upload section, its Server and Privacy tabs, and Share with Dropgate.

It runs on [`@dropgate/core`](../packages/dropgate-core/README.md), loaded from [`src/dropgate-core.js`](src/dropgate-core.js). That file is core's build, written by `npm run build` in `packages/dropgate-core` and committed, so the app runs and packages without building core first. Don't edit it: change core's source and build it again ([Building and Testing](../docs/core/building-and-testing.md)). GitHub Actions fails if it isn't core's build.


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

* **The preload contract.** The preload is run as a sandboxed preload would be, and only loads what one can. Every call of its bridge reaches a channel in `src/constants.js`, every channel the page asks is answered in `main.js` through electron-kit (which answers the app's own page only), and every message `main.js` sends reaches the page. A mistake in any of these leaves the app doing nothing, with no error in the main process.
* **Window security.** Every window keeps `contextIsolation` on, `nodeIntegration` off and the sandbox on.
* **Menu shortcuts.** Every shortcut has a modifier, so none of them fires while you're typing.
* **Reading files.** The page reads only the files the app handed it, and none that has changed since (its size or its modification time), checked on real files.
* **What comes from electron-kit.** The accent colour meets WCAG 2.2 AA in both themes, the page loads electron-kit's styles and scripts in order, the shared parts (prompts, notifications in the window, the drop zone, the progress bar) are electron-kit's, the log is kept in memory, the updater is electron-kit's, and the build extends electron-kit's and packs only what the pages load.

Tests for known issues are marked as expected failures, and there are none today. To see each test's name and label, run the tests with the TAP reporter:

```bash
node --test --test-reporter=tap "test/*.test.mjs"
```

GitHub Actions runs the tests this way on Ubuntu and Windows ([`ci.yml`](../.github/workflows/ci.yml)).

### The App, End to End

The app itself is tested with the [integration tests](../tests/integration/README.md), which launch it from this folder with a throwaway profile, against a Dropgate Server started on your machine just for the test. They check its settings, its Settings view, that it keeps no log on disk and downloads no spell-check dictionaries, that nothing in its profile holds a file's name, folder or bytes, a link or an upload's ID after an upload or with one paused, and **"Share with Dropgate"**: that a shared file uploads, end-to-end encrypted on a server with HTTPS, and that its link downloads intact; and pausing an upload: the deadline it shows, the notification before it, that nothing resumes by itself, the upload ending at the deadline, and a file edited while paused refused. A packaged build's update checks are tested too, for anything that could identify an installation. Off CI they leave your clipboard alone, and they never touch your own settings.

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
