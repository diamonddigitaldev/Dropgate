# Direct Transfers

A direct transfer goes from one device straight to another over WebRTC. The Dropgate server only introduces the two, through its rendezvous: it never sees the files, their names, their sizes or the keys, and it keeps nothing once the transfer has gone. How the two devices connect, secure the connection and move the files is in [DGDTP](../technical/DGDTP.md); the calls are in the [API Reference](api-reference.md#clientdirect).

```javascript
import { DropgateClient } from '@dropgate/core';

const client = new DropgateClient({ server: 'https://files.example.com' });

// The sender: share the link, or the code, however you like.
const send = await client.direct.send({ files: [file1, file2] });
send.subscribe((snapshot) => {
  showProgress(snapshot.percent, snapshot.text);
  if (snapshot.code !== shownCodeState) showShare(send.share()); // a new code, or none for now
});
showShare(send.share()); // { link: 'https://files.example.com/p2p#…', code: 'ABCD-1234' }

// The receiver: the files first, then the choice.
const receive = await client.direct.receive({ link }); // or { code }
const offer = await receive.offer();                  // { files: [{ name, size, type }], totalSize }
if (await askToAccept(offer)) await receive.accept({ sink: (file) => sinkFor(file.name) });
else await receive.decline();

const outcome = await receive.result; // completed, cancelled or failed: it never rejects
```

## What core does, and what's yours

Core is headless: it runs the transfer, and you give it the files, somewhere to put them, and the screen.

- **The files.** `send()` takes [file sources](api-reference.md#file-sources), browser `File`s or `Blob`s. Each is read a 1 MiB block at a time, at most two blocks ahead of what's sent, so a large file never sits in memory. A read that stalls for 2 minutes fails the send with `SOURCE_UNAVAILABLE`.
- **The sink.** `accept()` takes a [sink](api-reference.md#download-sinks), as a hosted download does: one for one file or a ZIP of several (`asZip: true`), or a function giving one for each file. Core writes each block only once it has been checked against its hash and the transfer's checkpoint chain, awaits each write (a slow disk slows the sender down, never fills memory), closes each file's sink once it's whole, and completes only once the last one has closed. Any other end aborts the sink, so a partial file is never finished as if it were whole. A write that fails is `OUTPUT_WRITE_FAILED`; one that stalls for 2 minutes, `OUTPUT_STALLED`.
- **A browser's download.** A sink that hands the files to the browser to save, as StreamSaver does, can't know they were saved: pass `handOff: true` with it, and both sides' result says `handed-off`, never `saved`.
- **Names.** The receiver gets the names only from `offer()`, each checked by the [file name rule](quick-start.md#file-names); no snapshot, outcome or error holds one. Save each under `filenames.sanitize(name)` (a ZIP's members are made safe and unique by core's ZIP writer). `type` is the sender's word for it, advice only.
- **Sharing.** `send.share()` gives the link and the code as they are now. Show both: the link always works, and a code may not be free at once. A code is used once, right or wrong, so after someone tries it the sender gets a new one: read `share()` again whenever the snapshot's `code` changes, and show "Someone entered the wrong code. Here's a new one." when the receive that tried it fails with `CODE_MISMATCH`.
- **The screen.** Each handle's `snapshot` and `subscribe()` say where it is, with `text` in words you can show ([Direct transfer handles](api-reference.md#direct-transfer-handles)); the outcome says how it ended, in each side's words ([Outcomes](outcomes.md#direct-transfers)).

## Who gets the files

A link or a code is a bearer capability: anyone who has it can connect, and sees the offer. The first to accept gets the files; nobody else can join after that, and any other receiver still looking at the offer fails with `REQUEST_REJECTED`, "This transfer is already going to someone else." A receiver that declines, or an offer nobody accepts within 10 minutes (`TIMED_OUT`), ends the send. Share a link or a code only with the person it's for.

## Pausing

Either device can pause from the receiver's acceptance until all the data has been sent: `handle.pause()` and `handle.resume()`. The transfer runs only while neither holds it, and both screens show who does (`pausedBy`: `self`, `peer` or `both`). Nothing resumes by itself. A pause limit, set with the [`direct` option](api-reference.md#the-direct-option), ends a pause that goes on too long: a pause by either device counts against both devices' limits, both show the earlier deadline, and the device whose limit runs out first ends the transfer, both with `PAUSE_LIMIT`.

## Connecting, and STUN

The two devices connect directly. On one network that just works. Across two networks, each asks a STUN server for its public address: the server offers its own (`capabilities.p2p.iceServers`; Cloudflare's by default, or none, as its operator sets it). A STUN server sees the device's IP address, as any server it talks to does, and nothing of the transfer. With `direct: { stun: false }`, core gives the connection no ICE servers at all, so nothing is sent to a STUN server, and only devices that can reach each other directly connect. There's no relay (TURN): two devices that can't reach each other don't connect, with `TIMED_OUT`, "Couldn't connect to the other device."

A connection that drops ends the transfer with `CONNECTION_LOST`, never as a cancel: in this version it isn't recovered. Start it again.

## In Node

Node has a `WebSocket` (22 and later) but no `RTCPeerConnection`. Pass a library's as the client's `RTCPeerConnection` option; without one, every direct call is `RUNTIME_UNSUPPORTED`:

```javascript
import { RTCPeerConnection } from 'node-datachannel/polyfill';
// or: import { RTCPeerConnection } from 'werift';

const client = new DropgateClient({ server: 'https://files.example.com', RTCPeerConnection });
```

Core's own tests run on both, as an exact version of each:

- **[node-datachannel](https://github.com/murat-dogan/node-datachannel)** (libdatachannel, native, prebuilt for each platform): fast, about 120 MiB/s on one machine. It can't restart ICE, which a later version's recovery will use. Given no ICE servers it asks no STUN server, and uses its own addresses only, so it's the private choice.
- **[werift](https://github.com/shinyoshiaki/werift-webrtc)** (TypeScript, no native code): complete, ICE restart included, but slow, about 7.5 MiB/s on one machine. Two of its defaults matter for privacy. Given no ICE servers (`stun: false`, or a server offering none), it still asks Google's STUN server (`stun.l.google.com`) from every IPv4 address it has; a subclass passing `iceUseIpv4: false` to it keeps it on IPv6, where it asks none, as core's tests do. And it looks up another device's `.local` address with an mDNS query on the local network, as browsers do. It also gives every peer connection in a process the same DTLS certificate, unless it's given `certificates`.

Neither is a dependency of core, and neither is in its builds, the Web UI or the Dropgate Client: core uses whichever you give it.

## Changed in 4.0

Direct transfers are on handles and outcomes, as hosted transfers are, over Dropgate 4's own secure channel and the server's rendezvous, with PeerJS gone ([DGDTP](../technical/DGDTP.md)). A send gives a link as well as a code; a receiver sees the files before anything is saved, and chooses; either device can pause; a dropped connection is `CONNECTION_LOST`, never a cancel; the receiver's files are checked before they're written, and the sender only hears the transfer completed once they're saved. Dropgate 3's listeners (`onCode`, `onMeta`, `onData` and the rest), its `Peer` option and its sessions still run for a call that passes `Peer`, until the Web UI has moved onto handles; nothing new should use them. A Dropgate 4 device never connects to a Dropgate 3 one.
