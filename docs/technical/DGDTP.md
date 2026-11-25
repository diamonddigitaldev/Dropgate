# DGDTP — Dropgate Direct Transfer Protocol

**Protocol Version:** 4.0, in development. Its secure channel ([§4](#4-the-secure-channel)), the rendezvous on the Dropgate Server ([§5](#5-the-rendezvouss-wire), [§6](#6-codes-and-the-pool)) and the engine that carries a transfer over them ([§7](#7-one-transfer-end-to-end) to [§14](#14-generation-fencing)) are built in the core library and the server, tested, and what core's `client.direct` and the Web UI run ([§4.15](#415-in-cores-api), [§4.16](#416-in-the-web-ui)); the desktop app's direct transfers, and recovering a dropped connection ([§16](#16-recovery-reserved)), come later. PeerJS, and Dropgate 3's messages on it, are gone ([§4.17](#417-no-compatibility-with-dropgate-3)).
**Status:** In development
**Last Updated:** November 2026

---

## 1. Overview

The Dropgate Direct Transfer Protocol (DGDTP) defines the peer-to-peer (P2P) file transfer mechanism used by Dropgate. Unlike DGUP (which uploads files to a server for later retrieval), DGDTP streams file data directly from one peer to another over a WebRTC data channel. The Dropgate Server only puts the two devices in touch and relays the messages that set up their connection; it doesn't store or process the transferred file content.

DGDTP 4 has two layers:

- **The secure channel** ([§4](#4-the-secure-channel)). From a secret both devices hold, a link's or a typed code's, it makes an encrypted, authenticated channel over the connection the two devices set up. Everything that sets up that connection goes through the server sealed, and the connection's own certificates are tied into an encrypted handshake that runs over it, so a server that changes, replays or swaps anything makes the connection fail instead of reading it.
- **The engine's records** that run over it ([§7](#7-one-transfer-end-to-end) to [§14](#14-generation-fencing)): the list of files, their data in checked blocks, credit, pausing, liveness and one way to end.

Before the channel, the server's **rendezvous** ([§5](#5-the-rendezvouss-wire)) puts the two devices in touch: a sender's room, found by its link or by a short code ([§6](#6-codes-and-the-pool)), and the sealed frames between them.

### 1.1 What's Built Now

The secure channel is built in `@dropgate/core` ([`packages/dropgate-core/src/dgdtp/`](../../packages/dropgate-core/src/dgdtp/)), and tested end to end over stand-in connections, over WebRTC between two peer connections in Node, and through a real Dropgate Server's rendezvous ([§4.12](#412-test-vectors-and-tests)). Core's `client.direct` runs every direct transfer over it, on handles ([§4.15](#415-in-cores-api)); none of the channel itself is exported.

The Web UI's direct transfers run over it too, on core's handles: the home page's send and the receive page, `/p2p` ([§4.16](#416-in-the-web-ui)).

Dropgate 4's own rendezvous on the Dropgate Server is built, and so is core's client for it: a sender's room, its codes, its receivers' attempts by link or by code, and the sealed frames between them ([§4.13](#413-what-the-rendezvous-and-the-engine-add)). Core also has the transfer engine: its records, its list of files and its checkpoint chain, and the engine that sends them, one transfer end to end, from the offer to the receiver's result, with pausing from either device, its timers and liveness, and one way to end. Core's `client.direct` runs on them, and so does the Web UI; the desktop app's direct transfers come later. Every direct transfer is carried over the secure channel.

**PeerJS is gone.** Dropgate 3's direct transfers signalled through PeerJS, protected by WebRTC's own DTLS encryption alone; Dropgate 4 has none of it, and works with nothing of Dropgate 3's ([§4.17](#417-no-compatibility-with-dropgate-3) has what each of its parts gets, and [§19.1](#191-transport-encryption) why it mattered).

### 1.2 Design Goals

- **Zero server storage** — file data never touches the server's filesystem or memory.
- **End-to-end security** — only the two devices can read a transfer or the messages that set up its connection, and a server that tampers with either ends the connection instead of reading it. Dropgate 3's transfers relied on DTLS alone, which a malicious signalling server could get between (see [§19.1](#191-transport-encryption)).
- **Flow control** — the receiver's credit and the data channel's buffer keep a fast sender from overwhelming a slow receiver, and memory bounded on both ([§10](#10-the-pump-credit-and-the-sink)).
- **Completion only after the save** — the sender hears a transfer completed only once the receiver has every file checked and saved ([§7](#7-one-transfer-end-to-end)).
- **Minimal signalling** — the server only relays what sets up the connection, as sealed frames it can't read. Once the data channel is established, the server is no longer involved.
- **Human-readable codes** — peers are identified by short, pronounceable codes rather than opaque UUIDs or IP addresses. Only a code's first two letters ever reach the server.

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| **Sender** | The peer that holds the file(s) and initiates the DGDTP session. |
| **Receiver** | The peer that connects to the sender's code and receives file data. |
| **Signalling Server** | The Dropgate Server component that relays what sets up a WebRTC connection: its rendezvous. (Dropgate 3's was PeerJS.) |
| **Rendezvous** | Dropgate 4's signalling on the Dropgate Server: it puts a sender and a receiver in touch and relays the sealed messages that set up their connection. |
| **Data Channel** | The WebRTC RTCDataChannel over which DGDTP messages and binary data are sent. |
| **P2P Code** | A human-readable identifier in the format `XXXX-0000` (4 letters + 4 digits). |
| **Locator** | A code's first two letters (three on a server set for more rooms at once), which the rendezvous hands out and knows the sender's room by. The only part of a code that leaves the device. |
| **Password** | The rest of a code, made on the sender's device. |
| **Link Secret** | 32 random bytes made on the sender's device, carried after the `#` of a direct transfer's link. |
| **Room** | A sender's place on the rendezvous, found by its link's secret or its code's locator. |
| **Attempt** | One try at connecting to a room, with keys of its own: a receiver's, by link or by code, or a resume. |
| **Generation** | Which connection of a transfer an attempt makes: 0 for the first, one more for each resume. |
| **Crypto Provider** | What does core's cryptography: the platform's Web Crypto, or core's own JavaScript crypto on `@noble` ([Crypto](../core/crypto.md)). |
| **Record** | One encrypted message of the engine's over the data channel: a type byte, then fixed fields ([§8](#8-records)). |
| **List of files** | The manifest: every file's size, name and media type, which the receiver sees before it accepts ([§9](#9-the-list-of-files-and-the-checkpoint-chain)). |
| **Checkpoint chain** | A hash over every block of every file in order, which both devices compare at the end. |
| **Sink** | Where the receiver's app writes the files: one, one for each file, or a ZIP. |
| **Credit** | How much the sender may have sent that the receiver hasn't written yet ([§10](#10-the-pump-credit-and-the-sink)). |
| **Hold** | A pause, by either device: data runs only when neither holds the transfer ([§11](#11-pausing-hold)). |

---

## 3. Codes and Links

### 3.1 Format

Codes follow the pattern `XXXX-0000`:

- **Letters:** drawn from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ` (24 characters). The letters `I` and `O` are excluded to avoid visual confusion with `1` and `0`.
- **Digits:** `0`–`9`.

### 3.2 Entropy

- Letter space: 24⁴ = 331,776 combinations.
- Digit space: 10⁴ = 10,000 combinations.
- Total: ~3.3 × 10⁹ combinations.

Over the secure channel, a code is two parts. The **locator**, its first two letters, is one of 576, which the rendezvous hands out so no two senders hold the same one at once. The **password**, its other two letters and its four digits, is one of 5.76 million (24² × 10⁴), made on the sender's device. A guess at the password can only be tried by connecting, and each code takes one try, right or wrong ([§4.3](#43-cpace-typed-codes)). Core also takes three-letter locators, for a server set for more rooms at once: the password is then one letter and four digits, and nothing else about the protocol changes.

### 3.3 Generation

Codes are generated from secure random numbers (`crypto.getRandomValues()`, which every browser has, even on a page served over plain HTTP), and never from anything weaker: where there are none, no code is made. Each character comes from one random byte by rejection sampling, so every letter and every digit is equally likely: a letter from a byte under 240, taken mod 24, and a digit from a byte under 250, taken mod 10; a byte at or over the limit is thrown away and another drawn. Every random byte is overwritten once used.

The sender asks the rendezvous for a locator, and draws the password's letters and digits on its own device. (Dropgate 3's sender drew a whole code and registered it with PeerJS, drawing another when it was taken.)

### 3.4 Validation

Codes are normalised before use: whitespace anywhere is removed, letters are converted to uppercase, and the dash may be left out. Anything else, including an `I` or an `O`, isn't a code, and is refused before anything is sent. The canonical form is `^[A-HJ-NP-Z]{4}-[0-9]{4}$`. Letters are checked as ASCII before they're converted, so no other character can become one.

### 3.5 What Leaves the Device

Over the secure channel, only a code's locator is sent: the receiver joins the sender's room by it. The password goes only into CPace ([§4.3](#43-cpace-typed-codes)), on each device, and is never sent, logged or kept: its bytes can be read once, by the exchange that uses them, and are overwritten as soon as they've made CPace's generator. Core's tests search every byte both devices send, through the server and over the connection, for the code and its password in every form (with and without the dash, in either case, as UTF-8 and as UTF-16): neither is there.

Dropgate 3's sender registered its whole code with PeerJS as its peer ID, so the server saw it ([§19.6](#196-codes-and-links)). A Dropgate 3 sender's code finds nothing on a Dropgate 4 server: its rendezvous knows only its own rooms, so a receive by such a code ends `NOT_FOUND` ([§4.17](#417-no-compatibility-with-dropgate-3)).

### 3.6 Links

A sender's room has a link as well as an optional code. The link carries the **link secret** after its `#`: 32 random bytes from the sender's crypto provider. A browser never sends what's after a `#`, so the server never sees it, and the receiver joins the room by a room ID derived from it ([§4.4](#44-the-key-schedule)), which tells the server nothing about it. The link is separate from the code, so a wrong code never breaks it, and it can't be guessed. The link is `https://<server>/p2p#` and the secret in URL-safe base64 with no `=`, 43 characters, with nothing else in its path and no query: core's `share()` gives it, and a receive by link refuses anything else, or a link to another server, before anything is sent.


---

## 4. The Secure Channel

What every direct transfer runs over ([§1.1](#11-whats-built-now)). It's core's own code, in [`codes.ts`](../../packages/dropgate-core/src/dgdtp/codes.ts), [`cpace.ts`](../../packages/dropgate-core/src/dgdtp/cpace.ts), [`keys.ts`](../../packages/dropgate-core/src/dgdtp/keys.ts), [`seal.ts`](../../packages/dropgate-core/src/dgdtp/seal.ts), [`prologue.ts`](../../packages/dropgate-core/src/dgdtp/prologue.ts), [`noise.ts`](../../packages/dropgate-core/src/dgdtp/noise.ts) and [`channel.ts`](../../packages/dropgate-core/src/dgdtp/channel.ts), on core's crypto provider: Web Crypto where it can, and `@noble` where it can't, with the same bytes either way ([Crypto](../core/crypto.md)).

In what follows, `‖` joins bytes, and every number written into bytes is big-endian.

### 4.1 What It Protects, and What It Doesn't

**It protects:**

- **The transfer:** file contents, names and sizes, the list of files, every message about the transfer and why it ended, from the network, from the rendezvous (the Dropgate Server) and from anything relaying packets between the devices.
- **What sets up the connection:** each device's addresses, its ICE credentials and its certificate's fingerprint, from the rendezvous.
- **A code, from guessing:** a guess can only be tried by connecting, once per code, and the sender sees it fail. Nothing anyone records, the server included, lets them test a guess afterwards.
- **Against a server in the middle:** a swapped certificate, a set-up message changed, injected, replayed or reordered, or a receiver's first message sent again as a new attempt, ends the attempt with `SECURITY_POLICY_MISMATCH`, never with a connection that quietly works, and the sender seals nothing for the attempt sent again ([§4.5](#45-sealed-signalling)).
- **The sender's network, from a wrong code:** a wrong code is caught before either device opens anything the other sent to set up the connection, so someone guessing never learns the sender's addresses.

**It doesn't protect:**

- The timing and volume of traffic, or the public IP addresses the rendezvous and the STUN server see.
- How many sealed messages each side sends, and when: their padding ([§4.5](#45-sealed-signalling)) hides only what kind each one is.
- Who holds a link. A link is all anyone needs to connect, so the handshake proves the link or the code was known, not who knew it.
- A link that leaks later. By link, the sealed set-up messages aren't forward secret: whoever recorded them (only the server could) and later gets the link can open them. They hold only the connection's set-up, never the transfer, which the handshake's one-time keys protect ([§4.7](#47-noise)).
- A server that serves the Web UI tampered JavaScript: a web page's code comes from its server. The Dropgate Client runs only its own bundled code.
- Code on the same device timing the cryptography that runs in JavaScript ([§4.11](#411-secrets-in-memory)).

### 4.2 How a Connection Is Made

1. **The room.** The sender makes its link's secret and the room's nonce (16 random bytes), and opens a room on the rendezvous under a room ID derived from the secret, asking for a code too if it wants one. The rendezvous gives the code's locator, and the sender draws the password.
2. **The secret.** By link, the receiver derives the room ID from the link's secret and joins by it. By code, it joins by the locator, and the two devices run CPace through the rendezvous ([§4.3](#43-cpace-typed-codes)), which gives each the same 64-byte key, the ISK. On resume, they use the resume secret they already share ([§4.9](#49-the-resume-secret)). Either way, the rendezvous gives the receiver the room's nonce, and the receiver makes a new attempt ID, 16 random bytes.
3. **The keys.** Each device derives the attempt's keys from that secret, the room's nonce and the attempt ID ([§4.4](#44-the-key-schedule)).
4. **Sealed signalling.** Through the rendezvous, each sealed and padded: the receiver's offer, the sender's answer, each side's ICE candidates as they're found, and the end of them ([§4.5](#45-sealed-signalling)).
5. **The handshake.** Once the data channel is open: Noise, the receiver first, under the attempt's pre-shared key, with both devices' certificate fingerprints in its prologue ([§4.6](#46-the-dtls-prologue), [§4.7](#47-noise)).
6. **BIND.** The receiver's first encrypted record, with the secret for an out-of-band close ([§4.8](#48-bind-and-the-out-of-band-close)).

Then the channel carries encrypted records each way until either side closes it.

```
Receiver                          Rendezvous                          Sender
   │                                  │◄──────────── create room ────────│ room ID, room nonce
   │──── join: room ID or locator ───►│                                  │
   │◄─────────── room nonce ──────────│                                  │
   │                                  │                                  │
   │  [by code: CPace messages 1 to 3, relayed as they are]              │
   │◄═════════════════════════════════╪═════════════════════════════════►│
   │                                  │                                  │
   │  [sealed: offer, answer, candidates, end of candidates]             │
   │◄═════════════════════════════════╪═════════════════════════════════►│
   │                                  │                                  │
   │  [data channel open]                                                │
   │  Noise message 1 (-> psk, e) ──────────────────────────────────────►│
   │◄───────────────────────────────────── Noise message 2 (<- e, ee) ───│
   │  BIND (first record) ──────────────────────────────────────────────►│
   │◄═══════════════════════ encrypted records ═════════════════════════►│
```

### 4.3 CPace (Typed Codes)

A typed code runs CPace, CPACE-X25519-SHA512 as [draft-irtf-cfrg-cpace-21](https://datatracker.ietf.org/doc/draft-irtf-cfrg-cpace/) specifies it, with the explicit key confirmation of its §10.4. Two devices that know the same short password end up with the same 64-byte ISK, and nobody watching, the server included, can test a guess at the password offline. The receiver is the initiator (A) and the sender the responder (B): a sender only ever answers for its own password, so a message of its own sent back to it can't complete.

| Input | Value |
|-------|-------|
| `PRS` | The password's characters, in ASCII, upper case, without the dash: `CD1234` for `ABCD-1234` |
| `CI` | `lv_cat("dropgate/4 dgdtp cpace", "receiver", "sender", locator)`: the roles and the locator, never sent |
| `sid` | The room's nonce ‖ the attempt ID (32 bytes): the sender's 16 random bytes for the room, which the rendezvous gives the receiver, and the receiver's 16 for this attempt |
| `ADa` | `01` ‖ the receiver's DGDTP major ‖ minor |
| `ADb` | `02` ‖ the sender's DGDTP major ‖ minor |

The generator is the draft's: SHA-512 of `lv_cat("CPace255", PRS, zero padding, CI, sid)`, the padding filling SHA-512's first block, and its first 32 bytes mapped to the curve with Elligator 2. Each side makes a new random scalar and its share, `Y = X25519(y, generator)`.

The messages, relayed by the rendezvous as they are:

| # | Direction | Bytes | Holds |
|---|-----------|-------|-------|
| 1 | Receiver → sender | 51 | The attempt ID (16), `Ya` (32), `ADa` (3) |
| 2 | Sender → receiver | 99 | `Yb` (32), `ADb` (3), `Tb` (64) |
| 3 | Receiver → sender | 64 | `Ta` |

**Key confirmation.** Each side makes `K = X25519(its scalar, the other's share)`, then `ISK = SHA-512(lv_cat("CPace255_ISK", sid, K) ‖ lv_cat(Ya, ADa) ‖ lv_cat(Yb, ADb))`, and from it a confirmation key, `mac_key = SHA-512("CPaceMac" ‖ sid ‖ ISK)`. Then `Tb = HMAC-SHA-512(mac_key, lv_cat(Yb, ADb))` and `Ta = HMAC-SHA-512(mac_key, lv_cat(Ya, ADa))`, each compared in constant time. The sender makes the ISK from message 1 and sends `Tb`; the receiver checks `Tb` before it makes `Ta`; and the sender checks `Ta` before it uses the ISK, so it opens nothing sealed under keys made from it until the receiver has proved it holds the same one.

**Aborts.** An attempt ends with `CODE_MISMATCH` on both devices if a message is the wrong length, a role byte in `ADa` or `ADb` is wrong, a share is one of the low-order points that would make `K` all zeros (both crypto providers refuse them, and CPace checks `K` again), or a confirmation doesn't match. The side that finds it sends an abort, an empty message, in place of message 2 or 3. When the sender's check of `Ta` fails, it sends one where the receiver waits for its first sealed frame. The versions in `ADa` and `ADb` are bound, not compared: the rendezvous is to check the major in plain ([§4.13](#413-what-the-rendezvous-and-the-engine-add)).

**One try per code.** The sender runs CPace once for a code, right or wrong: the first message 1 uses up its password, and an attempt by code after that is answered with an abort. The sender then needs a new code from the rendezvous; its link still works.

**Secrets.** The password's bytes are overwritten as soon as the generator is made, the generator as soon as the share is, `K` as soon as it's hashed, and the ISK as soon as the key schedule has used it. `K` never leaves CPace's code.

### 4.4 The Key Schedule

Every key of an attempt comes from one **base secret**: the link's secret (32 bytes), the ISK (64), or the resume secret (32). Each is made with HKDF-SHA256 and a label of its own, so no key serves two purposes. The salt is the attempt's context, `ctx` = the room's nonce (16) ‖ the attempt ID (16). Both are public, and every attempt (a second receiver by link, a retry, a resume) has a new attempt ID, so new keys.

| Output | Bytes | HKDF-SHA256: key material, salt, label | Used for |
|--------|-------|----------------------------------------|----------|
| Room ID | 16 | The link's secret, no salt, `"dropgate/4 dgdtp room"` | The room's address on the rendezvous, by link |
| PSK | 32 | The base secret, `ctx`, `"dropgate/4 dgdtp psk"` | Noise's pre-shared key ([§4.7](#47-noise)) |
| Receiver's sealing key | 32 | The base secret, `ctx`, `"dropgate/4 dgdtp signal r>s"` | The receiver's sealed frames ([§4.5](#45-sealed-signalling)) |
| Sender's sealing key | 32 | The base secret, `ctx`, `"dropgate/4 dgdtp signal s>r"` | The sender's sealed frames |
| Close keys | 32 each | BIND's close secret, `ctx`, `"dropgate/4 dgdtp close r>s"` and `"dropgate/4 dgdtp close s>r"` | An out-of-band close, each way ([§4.8](#48-bind-and-the-out-of-band-close)) |

The sealing keys are AES-256-GCM keys held inside the crypto provider, which can't be exported. The close keys are bytes, made by the provider's HKDF and held only by the connection's close channel, so a close can be sealed at once, with nothing to wait for ([§4.8](#48-bind-and-the-out-of-band-close)); each is overwritten once it's used, or as the channel goes. The room ID and the PSK are bytes: the room ID is overwritten once the rendezvous has it, and the PSK is given to Noise once, then overwritten. Every output is made before the base secret is let go, so the ISK is overwritten as soon as the schedule is done.

### 4.5 Sealed Signalling

Every message that sets up the connection travels through the rendezvous as a sealed frame, under that direction's key for the attempt:

```
frame      kind (1) ‖ direction (1) ‖ attempt ID (16) ‖ counter (4) ‖ AES-256-GCM(key, nonce, inside, ad)
kind       0x10 signalling, 0x11 an out-of-band close (§4.8)
direction  1 receiver to sender, 2 sender to receiver
nonce      8 zero bytes ‖ counter (4)
ad         "dropgate/4 dgdtp signal" ‖ room nonce ‖ attempt ID ‖ direction ‖ counter (4) ‖ kind
inside     type (1) ‖ length (2) ‖ body, then zero bytes to its padded size
```

| Type | Sent by | Body |
|------|---------|------|
| 1, offer | The receiver | Its SDP, in UTF-8, with no candidates in it |
| 2, answer | The sender | Its SDP, in UTF-8, with no candidates in it |
| 3, candidate | Either | `lv(candidate)` ‖ `lv(sdpMid)` ‖ `sdpMLineIndex` (2 bytes, `FFFF` for none) ‖ `lv(usernameFragment)` |
| 4, end of candidates | Either | Nothing |
| 5, restart | The sender | Nothing: it asks the receiver for an ICE-restart offer |
| 6, close | Either | A close's body, in a close frame only ([§4.8](#48-bind-and-the-out-of-band-close)) |

`lv(x)` is the length of `x` in UTF-8, in 2 bytes, then `x` in UTF-8; an empty one means none.

**Padding.** An inside is padded to **512 bytes** for a candidate, the end of candidates, a restart or a close; to **2,048** for an offer or an answer; or to **8,192** for an offer or an answer that doesn't fit 2,048. So every frame is 550, 2,086 or 8,230 bytes, and the rendezvous can't tell an IPv4 candidate from an IPv6 one or a local name. Anything bigger (an offer or an answer of more than 8,189 bytes, a candidate's or a close's body of more than 509) is refused before it's sealed, never moved up a size. Browsers' candidates are far smaller.

**The rules:**

- The rendezvous sees each frame's kind, direction, attempt ID, counter, size and timing: nothing else.
- Each direction's counter starts at 0 for the attempt, and a frame is opened only if its counter is exactly the next one expected.
- A frame is checked before it's decrypted: its size, then its whole header, which must be exactly the one expected next. Once it's open, its inside must be exactly one message: a type the other side sends, padded to its own size (an answer that fits 2,048 bytes but is padded to 8,192 is refused), zero padding, and a body exactly its type's.
- Anything else ends the attempt with `SECURITY_POLICY_MISMATCH`, both ways at once: a flipped bit, a frame from another attempt, one sent back to the device that sealed it, a replay, a gap, a reorder, the wrong size. Nothing is tried again, sealed or not.
- At most 4,096 frames go each way. A device's 4,097th ends the attempt (`SECURITY_POLICY_MISMATCH`, origin `local`), and so does a 4,097th received.
- The receiver's first frame must be its offer, and the sender's its answer, one each. Candidates follow as ICE finds them, then the end of them: a candidate found before the device's own offer or answer has gone (some WebRTC stacks, libdatachannel's among them, start finding them while the description is being made) waits, and goes just after it. The receiver seals its offer before it applies it, and the sender its answer, so each takes counter 0.
- **An attempt ID is taken once in a room.** By link and on resume, the sender reads the attempt's ID from the plain header of the receiver's first frame, so the same first frame sent again would give the same keys, and anything the sender sealed for it would use a key and nonce it had already used. So the sender's room keeps every attempt ID it has taken, in every mode (by code, the one in CPace's message 1), and an attempt whose ID it has seen ends with `SECURITY_POLICY_MISMATCH` before any key is derived or anything sealed, its path through the rendezvous and its peer connection closed.
- **The sender sets up no more attempts at once than the rendezvous lets a room have:** 4 by link (a resume counts as one) and 1 by its code ([§5.3](#53-rooms-and-attempts)). One more is dropped as it comes, its path closed, with no peer connection made for it.
- By code, the sender opens no frame before `Ta` checks ([§4.3](#43-cpace-typed-codes)), and until the sender's first frame opens, the receiver takes an empty message as the sender's abort.
- A candidate the connection can't use is skipped, and ICE carries on with the others. A restart is ignored until the engine handles ICE restarts.

### 4.6 The DTLS Prologue

WebRTC encrypts the data channel with DTLS, and each device's SDP names its certificate by a fingerprint. A browser refuses a DTLS peer whose certificate doesn't match the SDP it applied, so tying those fingerprints into the handshake ties it to the certificates actually in use.

**The fingerprints** come from the sealed SDPs each side applied: the receiver's from the offer, the sender's from the answer, as exactly the strings each side set. Every line that starts `a=fingerprint:` is read, at session or media level. A SHA-256 one (its name in either case) must be exactly 32 hex pairs, colon-separated, in either case; the same value more than once counts once; other hash functions are ignored. No SHA-256 fingerprint, two different ones, or a SHA-256 line that isn't one is `SECURITY_POLICY_MISMATCH`, and the error holds nothing from the SDP.

**The prologue**, which Noise hashes in before anything else, is 131 bytes, the same on both sides:

```
"dropgate/4 dgdtp prologue" (25) ‖ major (1) ‖ mode (1: 1 link, 2 code, 3 resume) ‖ room nonce (16)
‖ attempt ID (16) ‖ generation (8) ‖ receiver's fingerprint (32) ‖ sender's fingerprint (32)
```

Anything in the middle that ends DTLS with certificates of its own leaves the two devices with different prologues, so the handshake's first message doesn't open: `SECURITY_POLICY_MISMATCH`, and nothing after the handshake is sent.

The server's address isn't in it. A server reached by two names, such as a LAN address and a hostname, would otherwise break every transfer between them, and the PSK and the sealed signalling already tie the handshake to the secret.

### 4.7 Noise

Once the data channel is open, the two devices run `Noise_NNpsk0_25519_AESGCM_SHA256` over it, exactly as the [Noise Protocol Framework](https://noiseprotocol.org/noise.html) (revision 34) specifies it, in core's own implementation of this one pattern. The receiver is the initiator:

```
-> psk, e     message 1, the receiver's: its one-time key, under the PSK (48 bytes, nothing in it)
<- e, ee      message 2, the sender's: its one-time key, and its hello (at most 1,024 bytes)
```

- The PSK is the attempt's ([§4.4](#44-the-key-schedule)) and the prologue holds both certificates ([§4.6](#46-the-dtls-prologue)), so the handshake completes only between the two devices that hold the same secret, over the connection they set up.
- Both one-time keys are new for every attempt, so a transfer stays secret even if its link or its code is learned later.
- A message 1 with anything in it is refused.
- After the handshake, there's one key each way. AES-GCM's nonce is 4 zero bytes, then the record's counter in 8 bytes. Records carry no associated data, and go strictly in order each way.

**Its limits:**

- **A record** is at most 65,535 bytes with its 16-byte tag (Noise's largest message), so at most 65,519 bytes of plaintext. A longer one isn't sent (`INVALID_ARGUMENT`, and nothing changes). One received that's shorter than 16 bytes or longer than 65,535 is refused before it's decrypted.
- **Rekeying:** each direction rekeys after every 65,536 records, as Noise's `Rekey()` does: the key becomes the first 32 bytes of 32 zero bytes sealed under the reserved nonce 2⁶⁴ − 1. So about 4 GiB at most goes under one key. The counter carries on, never reset.
- **The end of the nonces:** a direction stops before that reserved nonce. Sending there is `SECURITY_POLICY_MISMATCH`, origin `local`; no transfer comes near it.
- **Failures:** any message that doesn't open, or isn't a length it can be, is `SECURITY_POLICY_MISMATCH`, and the direction is finished. Nothing is tried again, with or without encryption.
- **NN:** neither device has a long-term key, so holding the secret is the only proof either gives. Anyone who saw a message 1 can send it again, but can't read message 2 or make a BIND, so nothing more reaches them.
- **One suite:** there's no negotiation. Another suite would be another major version of DGDTP.

### 4.8 BIND and the Out-of-Band Close

**BIND** is the receiver's first record, exactly 51 bytes: `01` ‖ the close secret (32 random bytes) ‖ the receiver's hello (18 bytes). The sender's hello, the same 18 bytes, is Noise's second message's payload. A **hello** is, big-endian:

```
major (1) ‖ minor (1) ‖ features (4) ‖ largest record (4) ‖ pause limit, seconds (4, 0 for none) ‖ reconnect window, seconds (4)
```

The major and minor are the device's DGDTP version; feature bits are none in 4.0, and bits a device doesn't know are ignored; the largest record is the one its data channel takes ([§4.13](#413-what-the-rendezvous-and-the-engine-add)), 16,384 to 65,535; the pause limit and the reconnect window are the device's own (a reconnect window of 2 minutes unless it sets another). Each device checks the other's major once its own hello has gone: another is `VERSION_UNSUPPORTED` on both devices, each told which of them needs updating ([§4.10](#410-errors)). A first record that isn't exactly a BIND, or a sender's hello that isn't exactly a hello, is `SECURITY_POLICY_MISMATCH`. Both devices derive the close keys from the close secret ([§4.4](#44-the-key-schedule)), then overwrite it.

**An out-of-band close** tells the other device a transfer has ended even when the data channel has already gone: a sealed frame through the rendezvous, of kind `0x11`, counter 0, under that direction's close key. Its inside is type 6, with the close's body, at most 509 bytes, padded to 512, so it's 550 bytes on the wire, like a candidate. Each device sends at most one. It's sealed synchronously, on `@noble`'s AES-256-GCM whichever crypto provider the device uses (the same bytes as Web Crypto's, which the signal vectors hold), because a page being closed may never see a Web Crypto promise settle; the cipher is warmed as the close keys are made, so the seal itself takes a fraction of a millisecond. How a device sends and hears one is in [§13.2](#132-in-band-and-through-the-rendezvous). A close that doesn't open, isn't one, or comes after the first is ignored, so the server can't end a transfer by injecting one. Late candidates still arrive on the same path. When the data channel goes once the channel is up, each device keeps its path through the rendezvous and its close keys until its engine closes the channel, so a close can still be sent or heard that way ([§4.13](#413-what-the-rendezvous-and-the-engine-add)).

### 4.9 The Resume Secret

A resume is a new attempt, from the **resume secret** both devices hold: 32 bytes, mode 3 in the prologue, a new attempt ID and the generation one past the connection's last, so new sealing keys, a new PSK, a new handshake and new fingerprints. Nothing from the earlier attempt is reused, and a generation past 2⁶⁴ − 1 is refused.

Core builds a resume's keys and handshake now. The resume secret is the receiver's: 32 random bytes it makes as it accepts a transfer and gives the sender in its acceptance, inside the channel, so only the accepted receiver ever holds it, and only ever in memory. Each device overwrites it as its transfer ends. Resuming with it comes with recovery.

### 4.10 Errors

Each error is core's `DropgateError` with one of these codes ([Errors](../core/errors.md)). The message is core's, in words the apps show as they are. None holds anything from the other device.

| Code | Origin | When | Message |
|------|--------|------|---------|
| `CODE_MISMATCH` | `peer` | CPace didn't complete: a wrong code, a code already used, or any abort ([§4.3](#43-cpace-typed-codes)). Both devices get it | The receiver: "That code didn't match. Ask the sender for the new one." The sender: "Someone entered the wrong code. Here's a new one." |
| `SECURITY_POLICY_MISMATCH` | `peer` | A sealed frame, a handshake message or a record didn't open, wasn't the next, or wasn't a length it can be; a fingerprint broke the rule; message 1 held something; BIND, or the sender's hello, wasn't exactly one | "The connection couldn't be secured, so it was closed." |
| `VERSION_UNSUPPORTED` | `peer` | The other device's hello says another DGDTP major. Both devices get it; `details.update` is `peer` when the other device needs updating, `client` when this one does | "Update required: the sender is using an older version of Dropgate. They need to update.", or "… a newer version of Dropgate. Update this app to receive from them." (and the receiver's, for the sender) |
| `SECURITY_POLICY_MISMATCH` | `local` | This device has sent every frame or record its keys allow | "Setting up this connection took too many messages, so it was closed." or "This connection has sent every record its keys allow, so it was closed." |
| `CONNECTION_LOST` | `network` | The rendezvous, or the data channel, went before the channel was up: the server closed the socket, or told a receiver the sender has gone | "The connection was lost." |
| `TIMED_OUT` | `network` | An attempt ran out of time: its data channel not open 30 seconds after it started (ICE), its handshake not done 15 seconds after the data channel opened, or the whole set-up not done in 90 seconds. The receiver can try again; the sender's room goes on | "Couldn't connect to the other device." |
| `SERVER_UNREACHABLE` | `network` | The socket to the rendezvous never opened | "The server couldn't be reached." |
| `NOT_FOUND` | `server` | No room has that link's room ID, or no unused code has that locator | "No transfer has that code or link. It may have ended, or the code was used." |
| `REQUEST_REJECTED` | `server` | The room is locked, already has 4 attempts by link, or its code is being tried | "This transfer is already going to someone else." |
| `VERSION_UNSUPPORTED` | `server` | The rendezvous speaks another DGDTP major. `details` says which side needs updating, as `GET /api/info` does | "Update required: this server runs a newer version of Dropgate. Update this app to use it.", or that its operator needs to update it |
| `CAPABILITY_UNSUPPORTED` | `server` | A typed code, on a server whose `codeLetters` is 0. Nothing is sent | "This server doesn't use codes. Ask the sender for the link." |
| `INVALID_CODE` | `local` | A typed code isn't one. Nothing is sent | "That isn't a valid sharing code." |
| `INVALID_RESPONSE` | `server` | The rendezvous gave a room nonce or a locator that isn't one, sent something that isn't one of its messages, or refused one of core's as malformed or as one frame too many | "The server's answer wasn't understood." |
| `INVALID_MESSAGE` | `peer` | A record from the other device isn't one of this version's at its exact length, or isn't one the engine takes then: from the wrong device, out of order, a DATA record of any size but the one it must be, or past the credit given ([§4.13](#413-what-the-rendezvous-and-the-engine-add)) | "The other device sent something this version of Dropgate doesn't understand." |
| `OPERATION_CANCELLED` | `local` | This device closed the attempt or the channel | "The operation was cancelled." |

In a transfer, the engine adds these ([§4.13](#413-what-the-rendezvous-and-the-engine-add)):

| Code | Origin | When | Message |
|------|--------|------|---------|
| `REQUEST_REJECTED` | `peer` | Another receiver accepted the transfer first: the sender's CLOSE, `TAKEN` | "This transfer is already going to someone else." |
| `INTEGRITY_FAILED` | `peer` | A block didn't match its hash, or a file's end or FINISH didn't match what arrived | "A block of a file didn't match its hash.", "A file's end didn't match the list of files.", "A file's checkpoint didn't match." or "The transfer's end didn't match what arrived." |
| `INVALID_MANIFEST` | `peer` | The list of files didn't come whole and in order, or doesn't add up | "The list of files sent didn't add up." |
| `OUTPUT_WRITE_FAILED` | `local` | The receiver's sink couldn't be had, or a write or a close failed | "Received data couldn't be written." |
| `OUTPUT_STALLED` | `local` | A write or close of the receiver's sink (or its ZIP being finished) hadn't finished 2 minutes after it began, not counting time held | "Saving the received files stopped for 2 minutes, so the transfer ended." |
| `SOURCE_UNAVAILABLE` | `local` | The sender couldn't read a file, it gave other than the bytes asked for, or a read hadn't finished 2 minutes after it began, not counting time held | "A file couldn't be read.", or "Reading a file stopped for 2 minutes, so the transfer ended." |
| `PAUSE_LIMIT` | `local` | This device's own pause limit ran out while the transfer was held; `details.by` is `self` | "Your app ended the transfer after a 1-hour pause." (its limit, in minutes, hours or days) |
| `PAUSE_LIMIT` | `peer` | The other device's pause limit ran out first: its CLOSE, `PAUSE_LIMIT`; `details.by` is `peer` | "The sender's app ended the transfer after a 1-hour pause." (or the receiver's; its limit, from its hello) |
| `PEER_CLOSED` | `peer` | The other device's app closed: its CLOSE, `APP_CLOSED` | "The sender closed Dropgate before the transfer finished." (or the receiver) |
| `PEER_FAILED` | `peer` | The other device's CLOSE: `FAILED`, with what failed as `details.reason`, or a reason this side can only report | The sender's: "The receiver couldn't save the file.", "The receiver's device stopped saving the file.", "The file didn't arrive intact.", "The receiver couldn't read the list of files."; the receiver's: "The sender's file couldn't be read."; either: "The … device couldn't understand what this device sent.", "The … device reported an error." |
| `TIMED_OUT` | `local`, `peer` | The offer wasn't accepted within 10 minutes: this device's timer, or the other device's CLOSE saying so | "The offer wasn't accepted within 10 minutes." |
| `CONNECTION_LOST` | `network` | The data channel closed, or nothing was heard from the other device for 15 seconds (or six of its smoothed round trips, if longer), and no CLOSE came through the rendezvous in the 2 seconds after | "The connection was lost, so the transfer couldn't continue." |

A cancel by the other device (CLOSE, `USER_CANCELLED`) ends this one cancelled by the peer; a receiver's decline (`USER_DECLINED`) ends the sender cancelled by the peer, declined. A device that cancels, declines or closes its app ends cancelled by itself.

**How both devices hear it:**

- A wrong code ends both with `CODE_MISMATCH`, each in its own words, through CPace's abort.
- In the handshake or after it, the device that finds a fault sends its abort on the data channel, one zero byte, then closes it. The other device's Noise refuses that as too short, so both end with `SECURITY_POLICY_MISMATCH`. (It isn't an empty message, which some WebRTC implementations can't send.)
- A sealed set-up frame that doesn't open ends that device with `SECURITY_POLICY_MISMATCH`. The other, whose path through the rendezvous closes before any data channel is open, ends with `CONNECTION_LOST`: nothing can tell it securely.
- The rendezvous going matters only until the data channel is open. The data channel closing during the handshake is `CONNECTION_LOST`.
- Whatever ends an attempt, every key it made is let go, and the data channel, the path through the rendezvous and the peer connection are closed.

### 4.11 Secrets in Memory

- Keys are crypto-provider handles, and AES keys can't be exported, but for the two close keys, which are bytes so a close can be sealed at once ([§4.4](#44-the-key-schedule)). Printed, logged or serialised, a key, a code's password, an attempt's keys, a sender's room or a channel shows only its label, such as `[AttemptKeys]` or `[SecureChannel]`.
- Raw secret bytes (the link's secret, the ISK, CPace's `K`, Noise's chaining key and each key's bytes before it's imported, the PSK, the close secret, the close keys and the resume secret) are held only while they're needed, then overwritten with zeros. JavaScript can't promise memory is erased, but this keeps the copies few.
- Nothing in the secure channel logs.
- CPace's map from a code to the curve, and all of the JavaScript provider, run in JavaScript, which makes no promise of constant time, so code on the same device might time them. That's a stated limit ([Crypto](../core/crypto.md)); a code is used once.

### 4.12 Test Vectors and Tests

**Published vectors,** on both crypto providers:

| Vector | For |
|--------|-----|
| CPace's own, draft-irtf-cfrg-cpace-21's Appendix A.1, A.3, B.1 and B.1.10 ([`cpace-x25519-sha512-vectors.json`](../../packages/dropgate-core/tests/fixtures/cpace-x25519-sha512-vectors.json)) | CPace: the generator, both shares, `K`, the ISK both ways, the session-ID output, and the low-order points that must abort |
| [Cacophony](https://github.com/haskell-cryptography/cacophony)'s one `Noise_NNpsk0_25519_AESGCM_SHA256` vector, commit `8ee9d41` ([`noise-cacophony-vector.json`](../../packages/dropgate-core/tests/fixtures/noise-cacophony-vector.json)) | Noise: both handshake messages, the handshake hash and four transport messages |
| RFC 7748, FIPS 180-4, RFC 4231, RFC 5869, the GCM specification's test cases, and NIST's and Project Wycheproof's AES-256-GCM tests | X25519, SHA-256, SHA-512, HMAC, HKDF and AES-GCM with associated data |

**Dropgate's own vectors.** No published vector covers Noise's `Rekey()`, or anything Dropgate builds on CPace and Noise. So each set comes from a second implementation in core's tests, on `node:crypto`, written from the format rather than from core's code, and core must give exactly its bytes:

| Vectors | Second implementation | For |
|---------|-----------------------|-----|
| [`noise-rekey-vectors.json`](../../packages/dropgate-core/tests/fixtures/noise-rekey-vectors.json) | [`reference-noise.mjs`](../../packages/dropgate-core/tests/helpers/reference-noise.mjs), which passes cacophony's vector too | Runs past 65,536 records each way, with the key after each rekey |
| [`dgdtp-signal-vectors.json`](../../packages/dropgate-core/tests/fixtures/dgdtp-signal-vectors.json) | [`reference-signal.mjs`](../../packages/dropgate-core/tests/helpers/reference-signal.mjs) | Every output of the key schedule, by link, by code and on resume; each type of sealed frame each way, in each padded size; a close each way |
| [`dgdtp-prologue-vectors.json`](../../packages/dropgate-core/tests/fixtures/dgdtp-prologue-vectors.json) | [`reference-prologue.mjs`](../../packages/dropgate-core/tests/helpers/reference-prologue.mjs) | The fingerprint rule on 18 SDPs; the prologue in each mode, up to the last generation; a whole handshake from an offer and an answer |
| [`dgdtp-message-vectors.json`](../../packages/dropgate-core/tests/fixtures/dgdtp-message-vectors.json) | [`reference-messages.mjs`](../../packages/dropgate-core/tests/helpers/reference-messages.mjs) | Every record of the engine at its edges, those read leniently and those refused; manifests of one file, of several with empty ones, and of exactly 1 MiB, with their hashes; the checkpoint chain over files of 0, 1, 1 MiB − 1, 1 MiB and 1 MiB + 1 bytes; every rendezvous message, and the server's that must be refused |

Core's tests also run the whole channel end to end, on each provider and with one device on each, over a stand-in rendezvous and stand-in connections with fake SDP: by link, by code and on resume, every attack above ending the attempt as it says, and with every random value fixed, the channel's own handshake giving the vector's bytes. They run it over WebRTC too, between two peer connections in Node, and through a real Dropgate Server's rendezvous: by link, by code, a wrong code then the link and the new code, a resume, and a server with every code held. The vectors and the channel's checks run in Chromium, Firefox and WebKit too, on the provider core chooses in each and on `@noble` in all three ([Building and Testing](../core/building-and-testing.md)).

The engine's tests run it over the channel in memory, with the test playing either device record by record (every refusal above, credit, the pump's limits, fencing a generation's effects, and each of the faults Dropgate 3's direct transfer had, now a plain test), and end to end through a real Dropgate Server over WebRTC in Node: one file of 0, 1, 1 MiB − 1, 1 MiB and 1 MiB + 1 bytes, many files with empty ones by code, into one ZIP, and 20 MiB, each byte for byte, a hold mid-transfer and a cancel. Every timer runs on a clock the tests move: pausing either way and both, pause limits, a 6-hour and a 24-hour pause with PING and PONG going on, a device gone quiet, stalls, STATUS, the offer's 10 minutes, the set-up's timers (a frame the rendezvous drops ends as a timeout, never a success), and every way a transfer ends, table-driven: one outcome on each device, and at most one CLOSE, from the device that ended it. An app closing hands its sealed CLOSE to the rendezvous before the call returns, on either provider and with the provider's own work stalled, as a closing page's Web Crypto is; one that overtakes the records before it is heard after them. In the Web UI's tests, a receive page closed mid-transfer tells the sending page it closed in Chromium, Firefox and WebKit; a sending page closed mid-transfer tells the receive page, best effort.

### 4.13 What the Rendezvous and the Engine Add

All of these are built: the connection itself, the rendezvous's rooms and codes, core's client for the rendezvous, and the engine that sends one transfer. Core runs the secure channel over a W3C `RTCPeerConnection` (the browser's own, or one an integrator passes in for Node).

- **The data channel:** the receiver makes the one data channel, `dgdtp/4`, ordered and fully reliable, carrying bytes only; anything else on it is refused as a fault. The fingerprints come from the real SDP each device applied.
- **Record size:** a device's largest record is the smaller of 65,535 bytes and its data channel's max-message-size. A data channel that can't take 16,384 bytes ends the attempt with `CAPABILITY_UNSUPPORTED`. Each device says its own in its hello ([§4.8](#48-bind-and-the-out-of-band-close)), and both send records no larger than the smaller of the two.
- **Backpressure:** a device sends no more while over 256 KiB waits in the data channel's buffer, going on once it drains, whether or not the `bufferedamountlow` event comes.
- **Ends:** ICE or the connection failing, or the data channel closing, ends it with `CONNECTION_LOST`.
- **The set-up's time:** an attempt's data channel must open within 30 seconds of the attempt starting (ICE), its handshake finish within 15 seconds of that, and the whole set-up, a code's exchange included, within 90 seconds. Running out ends that attempt `TIMED_OUT`, "Couldn't connect to the other device.", with everything it opened closed; a receiver can try again, and the sender's room goes on. A frame the rendezvous drops shows up this way, never as success.

The rendezvous's rooms and codes are built on the Dropgate Server, and core's client speaks to it: its wire, rooms and attempts are [§5](#5-the-rendezvouss-wire), and its codes [§6](#6-codes-and-the-pool). The engine's records are written and read by core, each a type byte then fixed fields at an exact length ([§8](#8-records)), with the list of files and the checkpoint chain ([§9](#9-the-list-of-files-and-the-checkpoint-chain)); the engine sends one transfer over the channel ([§7](#7-one-transfer-end-to-end)): its pump and credit ([§10](#10-the-pump-credit-and-the-sink)), pausing ([§11](#11-pausing-hold)), its timers and liveness ([§12](#12-timers-and-liveness)), one way to end ([§13](#13-close-and-outcomes)) and its fencing ([§14](#14-generation-fencing)).

### 4.15 In Core's API

Core's `client.direct.send()` and `receive()` run the engine on handles, as hosted transfers are ([API Reference](../core/api-reference.md#clientdirect), [Direct Transfers](../core/p2p.md)). What the protocol shows through them:

- **A send** checks its files and settings, connects to the server (its DGDTP major against core's, and `capabilities.p2p`), asks for a credential only when `capabilities.p2p.credentialRequired` says a send needs one ([§4.13](#413-what-the-rendezvous-and-the-engine-add)'s CREATE carries it, and nothing else does), then opens its room with a code unless asked not to. Its handle's `share()` gives the link ([§3.6](#36-links)) and the room's code: the code is `null` while none is free, or after an attempt by code until the next comes, so a code someone has typed is never shown again; both are `null` once a receiver has accepted.
- **A receive** checks its link or code on the device (another server's link, or a code on a server with `codeLetters` 0, is refused before anything is sent), then joins: by the link's room ID, or by the code's locator. Its handle's `offer()` gives the list of files once it's whole and checked; `accept()` opens the sink, then sends ACCEPT; `decline()` sends CLOSE (`USER_DECLINED`). A cancel before the channel is up gives up the join at once and closes what it opened.
- **The hello** carries the device's `direct` settings in whole seconds: its pause limit (0 for none) and its reconnect window. The settings are client-wide, and each transfer may override any of them; a pause limit is a whole number of seconds from one minute to one week, a reconnect window from 10 seconds to an hour, and anything else is refused before anything is sent. With `stun: false`, the device's peer connection is given no ICE servers at all; otherwise the STUN servers in the server's `iceServers`: its `stun:` and `stuns:` addresses, with no username or credential ([§19.5](#195-ice-candidate-exposure)).
- **Snapshots** follow each device's engine: a send's `waiting`, `connecting` (a receiver's attempt being set up), `offered`, `transferring`, `finalising`; a receive's `connecting`, `offered`, `transferring`, `finalising`; and `paused` whenever either device holds the transfer, with who holds it and the shared deadline. Progress is the bytes the receiver has written: the sender knows them from CREDIT. No snapshot, outcome or error holds the link, the code, a secret or a file name; the names reach the receiving app only through `offer()`.
- **Outcomes** are [§4.10](#410-errors)'s, each device's in its own words: a cancel, a decline or a pause limit heard through a CLOSE ends the other device `cancelled` by `peer` (`declined` for a decline) or as the CLOSE says. A completed transfer's value is its assurance (`saved` or `handed-off`, as ACCEPT said the sink would), how many files went and their total size.
- **Runtime:** the global `RTCPeerConnection` and `WebSocket`, or, for Node, an `RTCPeerConnection` class passed as a client option; without one, a direct call is `RUNTIME_UNSUPPORTED`.
- **An app closing:** `client.direct.appClosing()` ends every direct transfer the client runs at its call, each telling its other device with CLOSE (`APP_CLOSED`), and each ending `cancelled` by this device. It returns at once, and the transfers end in the microtask straight after the caller's code, each sealing its CLOSE synchronously and sending it before anything else ([§13.3](#133-an-app-closing)). It's still best effort: a page being closed may be gone first, so the other device can read `CONNECTION_LOST` instead. A transfer still opening its room, or still connecting, has nobody to tell, and is cancelled. Before a receiver has accepted, a receiver leaving (closing, cancelling or failing to save) sends the sender back to waiting, its link still good.

### 4.16 In the Web UI

The Web UI runs its direct transfers on core's handles ([§4.15](#415-in-cores-api)), and passes no `direct` settings, so core's defaults apply: no pause limit, a 2-minute reconnect window, STUN on.

- **Sending (the home page):** the code, large, and under it "or share this link:" with the link, Copy and a QR code of the link. With no code free, the link alone and "No short code is free right now. The link works, and a code will show here when one frees."; after a wrong code, the new code and "Someone entered the wrong code. Here's a new one."; with codes off on the server, the link alone. Once a receiver has the offer, "Connected. Waiting for them to accept.", and once accepted, progress (the bytes the receiver has written), Pause and Resume, who paused ("You paused the transfer.", "The receiver paused the transfer.", "Paused by both of you."), the deadline only when a pause limit is set (by the other device; the Web UI sets none), Cancel, and "Stalled" after 30 seconds without progress. It ends in [§4.10](#410-errors)'s words; "Transfer Complete" only when the receiver has the files. Escape never resets the page under a direct send: only Cancel ends it.
- **Receiving (`/p2p`):** the server answers `/p2p` with the same page for every request, and `/p2p/<anything>` (a Dropgate 3 link, its code in the path) with its older-version page, 410. What the page receives is after the `#`, which a browser never sends:
  - **`/p2p#<43 characters>`, a link:** "Ready to Connect" and Connect. Nothing is asked of the server, or anyone, before Connect, however long the page stays open: only the page's own files are loaded. Connect takes the secret out of the address (`/p2p`, in its place in the tab's history), keeping it in the page's memory for Retry.
  - **`/p2p#<a code>`, a typed code:** what the home page opens once a code's eight characters are in (core's `links.resolve()` gives `/p2p#ABCD-1234`); typed as anyone might, in any case, with or without the dash. The page takes it out of the address before it asks anything, then connects at once. A code is spent once tried, so a failed one brings back the code boxes.
  - **`/p2p` alone:** the code boxes, which connect a code there and open a pasted link.
  - Then the file's name and size (or "N files", their total size and the list), and Download or Decline. Download saves into StreamSaver as a hand-off (several files as one ZIP, named `dropgate-bundle-<date>-<time>.zip`); then Pause and Resume, who paused, Cancel, "Stalled", and "Handed to your browser. Check your downloads." once complete, or the failure in [§4.10](#410-errors)'s words.
  - **No usable sink:** with StreamSaver not loaded, the page says "This browser can't save the download here." and never connects, so no code is spent. A sink that can't be made at Download is the same, before ACCEPT: the receive is cancelled, and the sender waits for another receiver.
- **Leaving a page:** each page calls `client.direct.appClosing()` on `pagehide`. The other page reads "The sender closed Dropgate before the transfer finished." (or the receiver), in Chromium, Firefox and WebKit. It's best effort: a sending page closed while it's busy sending, on a slow machine, or a Firefox page closed at the very moment of a Download click, may be gone first, and the other page reads "The connection was lost, so the transfer couldn't continue." ([§13.3](#133-an-app-closing)).
- **What the pages keep:** nothing in the browser's storage, and nothing of a link, a code, a name or a size in any request: every request is to the page's own server (and the STUN server, over UDP), and the code reaches it only as its locator, inside a rendezvous message.

### 4.17 No Compatibility with Dropgate 3

Dropgate 4's direct transfers work with nothing of Dropgate 3's, and each part of Dropgate 3 is told so where it can be:

- **A Dropgate 3 app on a Dropgate 4 server:** its direct transfers signalled through PeerJS at `/peerjs`. Anything there, over HTTP or as a WebSocket, is answered 410 with `{ "code": "VERSION_UNSUPPORTED", "error": "This server runs Dropgate 4. Update the app to use it." }`, as Dropgate 3's upload paths are ([DGUP](./DGUP.md)), whether direct transfer is on or off; PeerJS's script isn't served any more.
- **A Dropgate 3 link** (`/p2p/<code>`, its code in the path): the server answers it with its older-version page, 410 ([§4.16](#416-in-the-web-ui)). Core's `links.resolve()` gives its path, which opens that page; `client.direct.receive({ link })` refuses it with `INVALID_ARGUMENT` before anything is sent.
- **A Dropgate 3 code:** it looks like a Dropgate 4 one, but no Dropgate 4 room has it, so a receive by it ends `NOT_FOUND`, "No transfer has that code or link. It may have ended, or the code was used."
- **A Dropgate 3 server, for a Dropgate 4 app:** its `/api/info` gives no protocol versions, so every call is refused with `VERSION_UNSUPPORTED`, saying the server needs updating, and nothing more is asked of it.
- **Dropgate 3's calls to core:** a `client.direct.send()` or `receive()` that passes PeerJS's `Peer` is refused with `INVALID_ARGUMENT`, "Dropgate 4's direct transfers take no Peer option: use the handle that send() or receive() gives.", before anything is made or sent.

### 4.14 Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `NOISE_PROTOCOL_NAME` | `Noise_NNpsk0_25519_AESGCM_SHA256` | The handshake's protocol. |
| `CPACE_MESSAGE1_BYTES`, `CPACE_MESSAGE2_BYTES`, `CPACE_MESSAGE3_BYTES` | 51, 99, 64 | CPace's three messages. |
| `CPACE_ROOM_NONCE_BYTES`, `CPACE_ATTEMPT_ID_BYTES` | 16 | The room's nonce and an attempt ID. |
| `LINK_SECRET_BYTES`, `RESUME_SECRET_BYTES`, `CLOSE_SECRET_BYTES` | 32 | The link's secret, the resume secret and BIND's close secret. |
| `ISK_BYTES` | 64 | CPace's ISK. |
| `ROOM_ID_BYTES` | 16 | The room's address by link. |
| `PSK_BYTES` | 32 | Noise's pre-shared key. |
| `FRAME_HEADER_BYTES` | 22 | A sealed frame's plain header. |
| `SMALL_BUCKET_BYTES`, `SDP_BUCKET_BYTES`, `LARGE_BUCKET_BYTES` | 512, 2,048, 8,192 | The three padded sizes. |
| `MAX_FRAME_BYTES` | 8,230 | The largest sealed frame. |
| `MAX_FRAMES_EACH_WAY` | 4,096 | Sealed frames each way, per attempt. |
| `MAX_CLOSE_BODY_BYTES` | 509 | A close's body. |
| `PROLOGUE_BYTES` | 131 | Noise's prologue. |
| `NOISE_MAX_MESSAGE_BYTES` | 65,535 | A record, with its tag. |
| `NOISE_MAX_RECORD_PLAINTEXT_BYTES` | 65,519 | A record's plaintext. |
| `NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES` | 1,024 | The most a handshake message's payload holds. |
| `NOISE_REKEY_INTERVAL` | 65,536 | Records under one key, each way. |
| `MAX_GENERATION` | 2⁶⁴ − 1 | The last generation. |
| `DATA_CHANNEL_LABEL` | `dgdtp/4` | The one data channel's name. |
| `MIN_RECORD_BYTES` | 16,384 | A data channel that can't take a record of this size isn't used. |
| `LOW_WATER_BYTES` | 262,144 | A device sends no more while more than this waits in the data channel's buffer. |
| `RENDEZVOUS_PATH` | `/api/v4/rendezvous` | The rendezvous's one path on a server. |
| `RENEW_INTERVAL_MS` | 240,000 | How often a sender renews its unused code; the server releases one after 10 minutes. |
| `CODE_RETRY_MS` | 15,000 | How often a sender asks again for a code while none is free. |
| `MAX_LINK_ATTEMPTS_AT_ONCE`, `MAX_CODE_ATTEMPTS_AT_ONCE` | 4, 1 | The most receivers' attempts a sender sets up at once by link and by its code, as the rendezvous allows a room ([§4.5](#45-sealed-signalling)). |
| `HELLO_BYTES` | 18 | A hello: the sender's in Noise's second message, the receiver's in BIND. |
| `BIND_BYTES` | 51 | BIND: its type, the close secret and the receiver's hello. |
| `MANIFEST_HEADER_BYTES`, `DATA_HEADER_BYTES` | 9, 14 | A MANIFEST record and a DATA record before their bytes. |
| `BLOCK_BYTES`, `MAX_MANIFEST_BYTES` | 1,048,576 | An integrity block of a file, and the largest list of files. |
| `MAX_MANIFEST_FILES` | 10,000 | The most files one transfer offers. |
| `MAX_MEDIA_TYPE_BYTES` | 127 | A file's media type in the list of files. |
| `MANIFEST_VERSION` | 1 | The list of files' version. |
| `DEFAULT_RECONNECT_WINDOW_SECONDS` | 120 | A device's reconnect window, in its hello, when it doesn't set one. |
| `CREDIT_WINDOW_BYTES` | 4,194,304 | The receiver's credit: at most this much sent and not yet written. |
| `CREDIT_STEP_BYTES` | 262,144 | The receiver sends CREDIT once what it has written moves this far. |
| `PUMP_HIGH_WATER_BYTES` | 1,048,576 | A device's pump stops once about this much waits in the data channel's buffer. |
| `SOURCE_BLOCKS_AHEAD` | 2 | The sender reads a file at most this many blocks ahead of what it has sent. |
| `ENCRYPT_AHEAD` | 8 | Records encrypted at once, ahead of the data channel. |
| `MAX_UNFINISHED_FILE_ENDS` | 8 | File ends the sender sends ahead of the files the receiver has finished. |
| `RESULT_ACK_WAIT_MS` | 2,000 | How long the receiver waits for RESULT_ACK before completing anyway. |
| `ICE_TIMEOUT_MS` | 30,000 | An attempt's data channel must open within this of its start. |
| `HANDSHAKE_TIMEOUT_MS` | 15,000 | An attempt's handshake must finish within this of its data channel opening. |
| `SETUP_TIMEOUT_MS` | 90,000 | An attempt's whole set-up must finish within this. |
| `OFFER_TIMEOUT_MS` | 600,000 | How long an offer waits to be accepted or declined. |
| `PING_INTERVAL_MS` | 5,000 | A device that has sent nothing for this long sends a PING. |
| `MIN_NO_ANSWER_MS` | 15,000 | Nothing heard for this long, at least, ends the connection. |
| `NO_ANSWER_RTTS` | 6 | Smoothed round trips without a word that end the connection, when longer than `MIN_NO_ANSWER_MS`. |
| `NO_PROGRESS_MS` | 30,000 | No data for this long with credit given: the receiver sends a STATUS ask. |
| `STALL_SHOWN_MS` | 30,000 | A write, close or read this long shows as stalled. |
| `STALL_FAILED_MS` | 120,000 | A write, close or read this long ends the transfer. |
| `CLOSE_ACK_WAIT_MS` | 2,000 | How long a device that sent a CLOSE waits for CLOSE_ACK. |
| `LATE_CLOSE_WAIT_MS` | 2,000 | How long a device whose data channel has gone listens for a CLOSE through the rendezvous. |
| `MIN_PAUSE_LIMIT_MS`, `MAX_PAUSE_LIMIT_MS` | 60,000, 604,800,000 | The shortest and longest pause limit a device can set: one minute and one week. |
| `MIN_RECONNECT_WINDOW_MS`, `MAX_RECONNECT_WINDOW_MS` | 10,000, 3,600,000 | The shortest and longest reconnect window a device can set: 10 seconds and one hour. |

---

## 5. The Rendezvous's Wire

The rendezvous is the Dropgate Server's part in a direct transfer ([`server/rendezvous.js`](../../server/rendezvous.js)): it puts a sender and its receivers in touch and relays the sealed frames that set up their connection, and nothing else. Core speaks to it from [`dgdtp/rendezvous.ts`](../../packages/dropgate-core/src/dgdtp/rendezvous.ts).

### 5.1 The Connection

- **One WebSocket per device** at `/api/v4/rendezvous`, over `wss:` (or `ws:` to a server on plain HTTP, which a client reaches only with `allowInsecure`). The sender's one socket holds its room; each receiver's attempt has a socket of its own, kept for the whole transfer. Nothing about a room, a code or a link is in the address, so a reverse proxy's log sees that path alone.
- **The upgrade goes through the server's rate limiter** like any request, the address read with the server's one-hop rule (the last address a trusted proxy added, else the socket's). There's no `Origin` check: nothing rides on the socket by itself (no cookie), and a credential, when one is needed, is in a message.
- **Binary messages only,** at most 8,232 bytes: a text message, or a bigger one, closes the socket. Each message is a type byte, then fixed fields, big-endian.
- **Pings:** the server pings every socket every 30 seconds and closes one it hasn't heard from in 60, and closes one with more than 1 MiB waiting to be sent to it, so a slow reader can't make it hold data.

### 5.2 Messages

| Type | Name | From | Body |
|------|------|------|------|
| `0x01` | `CREATE` | The sender | Major (1) ‖ minor (1) ‖ room ID (16) ‖ room nonce (16) ‖ flags (1: bit 0, a code wanted) ‖ credential's length (2) ‖ credential (0 to 8,192 ASCII bytes; empty unless the server asks for one) |
| `0x02` | `CODE` | The sender | Nothing: asks for a code. While the room has an unused one, the server answers with it and renews it |
| `0x03` | `RENEW` | The sender | Nothing: keeps the unused code |
| `0x04` | `SEND` | The sender | Tag (1) ‖ a frame (0 to 8,230 bytes), for that attempt's receiver |
| `0x05` | `DROP` | The sender | Tag (1): ends that attempt, whose receiver is told |
| `0x06` | `LOCK` | The sender | Nothing: no new attempt, by link or by code; an unused code is let go |
| `0x81` | `CREATED` | The server | Locator's length (1) ‖ locator (none, or the server's 2 or 3 letters) |
| `0x82` | `CODE_IS` | The server | Locator's length (1) ‖ locator (none when none is free, or the address holds its limit) |
| `0x83` | `ATTEMPT` | The server | Tag (1, 1 to 255) ‖ by (1: 1 link, 2 code) |
| `0x84` | `FRAME_TO_SENDER` | The server | Tag (1) ‖ the receiver's frame |
| `0x85` | `GONE_TO_SENDER` | The server | Tag (1): that receiver's socket has closed |
| `0x86` | `CODE_GONE` | The server | Nothing: the unused code was let go, unrenewed for 10 minutes |
| `0x11` | `JOIN` | A receiver | Major (1) ‖ minor (1) ‖ by (1: 1 room ID, 2 locator) ‖ room ID (16), or locator's length (1) ‖ locator |
| `0x12` | `RECEIVER_SEND` | A receiver | A frame (0 to 8,230 bytes), for the sender |
| `0x91` | `JOINED` | The server | Room nonce (16) |
| `0x92` | `FRAME_TO_RECEIVER` | The server | The sender's frame |
| `0x93` | `GONE_TO_RECEIVER` | The server | Nothing: the sender's socket closed, or it dropped this attempt |
| `0xFF` | `ERROR` | The server | Its code (1); for `VERSION_UNSUPPORTED`, then the server's major (1) and minor (1). The socket then closes |

**`ERROR`'s codes:**

| Number | Name | When |
|--------|------|------|
| 1 | `VERSION_UNSUPPORTED` | The `CREATE` or `JOIN` gave another DGDTP major |
| 2 | `NOT_FOUND` | No live room has that room ID, or no unused code has that locator |
| 3 | `BUSY` | The room is locked, already has 4 attempts by link, or its code is being tried; or a room with that ID is live |
| 4 | `MALFORMED` | A message that isn't one, or isn't one this socket sends now |
| 5 | `LIMIT` | An attempt's 4,105th frame one way |
| 6 | `AUTH_REQUIRED` | The server asks for a credential, and `CREATE` gave none |
| 7 | `AUTH_EXPIRED` | The credential has expired |
| 8 | `AUTH_DENIED` | The credential was refused |

The socket closes with 1002 after `MALFORMED` and 1008 after any other `ERROR`; 1003 for a text message and 1009 for one too big. Core reads every message the server sends at its exact length; anything else ends the room or the attempt with `INVALID_RESPONSE`. `ERROR`'s codes reach the app as core's errors ([§4.10](#410-errors)): `VERSION_UNSUPPORTED` saying which side needs updating, `NOT_FOUND`, `BUSY` as `REQUEST_REJECTED`, `MALFORMED` and `LIMIT` as `INVALID_RESPONSE`, and the three credential codes as `AUTH_REQUIRED`, `AUTH_EXPIRED` and `AUTH_DENIED`. No Dropgate server asks for a credential yet (`capabilities.p2p.credentialRequired` is `false`).

### 5.3 Rooms and Attempts

- **The first message on a socket** is `CREATE` or `JOIN`, once; anything else is `MALFORMED`. Each carries the DGDTP major and minor in plain, so a mismatch is said before any cryptography: a major other than the server's is `VERSION_UNSUPPORTED`, with the server's version; the minor is passed over.
- **A room** is created under its room ID, which is its address by link ([§4.4](#44-the-key-schedule)), with its nonce, which the server gives each receiver that joins. A second `CREATE` with a live room's ID is `BUSY`.
- **An attempt** is each `JOIN` that finds its room. It gets the next free tag after the last one the room gave (1 to 255, then round again, so a tag just freed isn't given straight back to take a late frame), and the sender is told by `ATTEMPT`. A room has at most 4 live attempts by link, and one by its code, beside them.
- **Frames** are relayed whole and in order each way, never read or kept: 0 to 8,230 bytes (CPace's abort is an empty one), at most 4,104 each way in an attempt (4,096 sealed frames, CPace's three messages, an abort and a close), and only for the room's live attempts. The 4,105th is `LIMIT`, and the attempt ends.
- **`LOCK`** stops new attempts: core locks the room as a receiver accepts, and drops every other attempt (`DROP`), whose receivers are told by `GONE_TO_RECEIVER`.
- **How long they live:** a room lives while its sender's socket is open, with no time limit. When it closes, every attempt's receiver is told and its socket closed; when a receiver's closes, the sender is told by `GONE_TO_SENDER`. An attempt lives while both its sockets are open.

## 6. Codes and the Pool

- **Locators:** the server's pool is every string of its length from `CODE_LETTERS` (the 24 letters of [§3.1](#31-format)): 576 for 2 letters, 13,824 for 3, as `P2P_LOCATOR_LETTERS` sets and `GET /api/info` gives as `capabilities.p2p.codeLetters`. A sender that wants a code, as it creates its room or later by `CODE`, is given one drawn uniformly at random from the free ones, and draws the rest of the code, the password, on its own device ([§3.3](#33-generation)). A room has at most one unused code; asked again while it's unused, the server gives the same one, renewed.
- **None free:** with every locator held, or the sender's address already holding the server's limit of unused codes (`P2P_MAX_CODES_PER_IP`, 5 by default), the sender is given none, and its room works by link. Core asks again every 15 seconds while none is free, and at once when the server lets one go, until one comes or a receiver has accepted. A server with codes off (`P2P_MAX_CODES_PER_IP=0`) gives `codeLetters` 0, and core never asks; a typed code is then refused before anything is sent (`CAPABILITY_UNSUPPORTED`).
- **The count by address** holds a 16-byte keyed hash of each address (HMAC-SHA-256, under a key made at random as the server starts and never written anywhere), never the address, and an entry goes when its count reaches 0. An IPv6 address is counted with the rest of its /56, as the server's rate limiter counts it.
- **One try per code:** a `JOIN` by a locator finds the room whose unused code it is, and binds the code to that attempt; another `JOIN` by it meanwhile is `BUSY`. The attempt's first frame is CPace's first message ([§4.3](#43-cpace-typed-codes)), and relaying it uses the code up, right or wrong: a later `JOIN` by it is `NOT_FOUND`. A receiver that leaves, or is dropped, before sending anything leaves the code unused.
- **A new code after every try:** after any attempt by code, right, wrong or given up, core asks for a new code at once and draws a new password for whatever locator comes back, so a code someone has typed is never shown again. Its link still works throughout.
- **Release and renewal:** an unused code is let go 10 minutes after the sender last asked for it or renewed it, and the sender is told by `CODE_GONE`; core renews an unused code every 4 minutes. A code also goes when it's used, when the room is locked, and when the room ends.
- **Quarantine:** every locator that leaves a room waits 5 minutes before the pool gives it out again, with nothing tied to it, so a late try at an old code can't meet another sender's new one.

## 7. One Transfer, End to End

Core's engine ([`dgdtp/engine.ts`](../../packages/dropgate-core/src/dgdtp/engine.ts), [`send.ts`](../../packages/dropgate-core/src/dgdtp/send.ts), [`receive.ts`](../../packages/dropgate-core/src/dgdtp/receive.ts)) runs one transfer over the secure channel, once each device's hello has said its largest record ([§4.8](#48-bind-and-the-out-of-band-close)). Records go both ways at once, each a Noise transport message ([§4.7](#47-noise)).

```
Receiver                                                   Sender
   │  [the secure channel: rendezvous, CPace by code, sealed set-up, Noise]   (§4)
   │  BIND (close secret, its hello) ─────────────────────────────►│
   │◄──────────────────────────── MANIFEST (each fragment of the list) │
   │  [the files shown; Download, or Decline]                         │
   │  ACCEPT (list's hash, resume secret, credit, sink) ──────────►│  [room locked]
   │◄──────────────────────────────────────── DATA … BLOCK_END        │
   │  CREDIT (as blocks are written) ─────────────────────────────►│
   │◄──────────────────────────── … FILE_END (each file's checkpoint) │
   │◄────────────────────────── FINISH (count, total, hash, the chain) │
   │  [every file's sink closed]                                      │
   │  RESULT (the same totals, where the files went) ─────────────►│
   │◄─────────────────────────────────────────────────── RESULT_ACK   │
   │  [both completed; the receiver closes the channel]               │
```

**The sender** opens its room (`CREATE`) and shares its link, and its code if one was free: `waiting`. Each receiver that reaches it runs the handshake, sends BIND, and is sent the list of files: `offered`. A link can reach several people before one accepts, and each sees the offer. **The first ACCEPT whose list's hash matches wins:** the sender locks the room, drops every other attempt, and tells each receiver already offered, and any that accepts later, with a CLOSE whose reason is `TAKEN`; they end `REQUEST_REJECTED`, "This transfer is already going to someone else." DATA then flows under the receiver's credit ([§10](#10-the-pump-credit-and-the-sink)): `transferring`. After the last FILE_END, FINISH: `finalising`. RESULT, with the agreed totals and chain, is checked, answered with RESULT_ACK, and the send completes, with the receiver's word for where the files went. A receiver that leaves before accepting sends the sender back to `waiting`, its link still good.

**The receiver** joins, runs the handshake and sends BIND. Once the whole list is in and checked it sees the files: `offered`, for up to 10 minutes. It accepts into a sink, which is opened first (so a sink that can't be had fails the receive before anything is accepted), with ACCEPT, carrying the list's hash, the resume secret ([§4.9](#49-the-resume-secret)), the first credit and whether the files will be saved or handed to a browser. Each block is checked before it's written ([§9](#9-the-list-of-files-and-the-checkpoint-chain)); at FINISH the count, the total, the list's hash and the chain must all match. Then every file's sink is closed (a ZIP finished first), and only then does it send RESULT: completion only after the save. It completes once RESULT_ACK comes, or 2 seconds after RESULT without it, the files saved either way. `decline()` sends CLOSE (`USER_DECLINED`), which ends the send too.

## 8. Records

Every record's plaintext is a **type byte, then its fields**, big-endian, each record **exactly its type's length**. A record whose type is unknown or kept for a later version, or whose length isn't its type's, or a field out of range, is `INVALID_MESSAGE`. They're written and read by [`dgdtp/messages.ts`](../../packages/dropgate-core/src/dgdtp/messages.ts), and pinned by a second implementation's vectors ([§4.12](#412-test-vectors-and-tests)).

### 8.1 The Records

| Type | Name | From | Body after the type | Bytes |
|------|------|------|---------------------|-------|
| 1 | `BIND` | The receiver | Close secret (32) ‖ its hello (18) ([§4.8](#48-bind-and-the-out-of-band-close)) | 51 |
| 2 | `MANIFEST` | The sender | The list's total length (4) ‖ this fragment's offset (4) ‖ the fragment (1 or more bytes) | at most the record size − 16 |
| 3 | `ACCEPT` | The receiver | The list's hash (32) ‖ resume secret (32) ‖ credit limit (8) ‖ sink (1) | 74 |
| 4 | `DATA` | The sender | Flags (1, 0) ‖ file index (4) ‖ offset in the file (8) ‖ bytes | at most the record size − 16 |
| 5 | `BLOCK_END` | The sender | File index (4) ‖ block index (8) ‖ length (4) ‖ SHA-256 of the block (32) | 49 |
| 6 | `FILE_END` | The sender | File index (4) ‖ size (8) ‖ block count (8) ‖ the chain, after this file (32) | 53 |
| 7 | `CREDIT` | The receiver | Revision (8) ‖ limit (8) ‖ consumed (8) ‖ files done (4) ‖ verified file index (4) ‖ verified offset (8) | 41 |
| 8 | `FINISH` | The sender | File count (4) ‖ total size (8) ‖ the list's hash (32) ‖ the chain (32) | 77 |
| 9 | `RESULT` | The receiver | Commit ID (16) ‖ assurance (1) ‖ file count (4) ‖ total size (8) ‖ the chain (32) | 62 |
| 10 | `RESULT_ACK` | The sender | Commit ID (16) | 17 |
| 11 | `HOLD` | Either | Held (1: 0 or 1) ‖ reason (1) | 3 |
| 12 | `CLOSE` | Either | Operation ID (16) ‖ reason (1) ‖ detail (1) | 19 |
| 13 | `CLOSE_ACK` | Either | Operation ID (16) ‖ finished (1) ‖ RESULT's body (61), when finished | 18 or 79 |
| 14 | `PING` | Either | ID (8) | 9 |
| 15 | `PONG` | Either | The PING's ID (8) | 9 |
| 16 | `RESUME` | The receiver | Kept for recovery: refused | — |
| 17 | `RESUME_OK` | The sender | Kept for recovery: refused | — |
| 18 | `STATUS` | Either | Kind (1: 1 ask, 2 answer) ‖ ID (8) ‖ for an answer, state (1) ‖ held (1) ‖ consumed (8) ‖ has a result (1) ‖ RESULT's body (61), if so | 10, 21 or 82 |

The record size is the smaller of the two hellos' largest records ([§4.13](#413-what-the-rendezvous-and-the-engine-add)); a record's plaintext is at most 16 bytes less, for Noise's tag. Sizes and offsets are whole numbers of at most 2⁵³ − 1; IDs are bytes, never text.

### 8.2 The Fields' Values

**`ACCEPT`'s sink, and `RESULT`'s assurance:**

| Value | Name | Meaning |
|-------|------|---------|
| 1 | `saved` | The receiver's app saves the files itself |
| 2 | `handed-off` | The files are handed to a browser to save (StreamSaver), so nobody can say they were saved |

**`HOLD`'s reason** (any other value is read as 1):

| Value | Name | Meaning |
|-------|------|---------|
| 1 | `person` | Someone paused it |
| 2 | `app` | The app paused it by itself |

**`STATUS`'s state:**

| Value | Name | Meaning |
|-------|------|---------|
| 1 | `OFFERED` | Offered, not yet accepted |
| 2 | `TRANSFERRING` | Data moving, or held |
| 3 | `FINALISING` | After FINISH, the files being finished |
| 4 | `FINISHED` | The receiver has sent RESULT |
| 0 | — | Anything else |

**`CLOSE`'s reason** (any other value is read as `FAILED`):

| Value | Name | Sent when |
|-------|------|-----------|
| 1 | `USER_CANCELLED` | This device's person cancelled |
| 2 | `USER_DECLINED` | The receiver declined the offer |
| 3 | `APP_CLOSED` | This device's app closed ([§13.3](#133-an-app-closing)) |
| 4 | `PAUSE_LIMIT` | This device's pause limit ran out ([§11](#11-pausing-hold)) |
| 5 | `RECOVERY_EXHAUSTED` | Kept for recovery |
| 6 | `FAILED` | Something failed: the detail says what |
| 7 | `TAKEN` | Another receiver accepted first (the sender, to the others) |

**`CLOSE`'s detail,** with `FAILED` (0 otherwise; any other value is read as none):

| Value | Name |
|-------|------|
| 1 | `OUTPUT_WRITE_FAILED` |
| 2 | `OUTPUT_STALLED` |
| 3 | `SOURCE_UNAVAILABLE` |
| 4 | `INTEGRITY_FAILED` |
| 5 | `INVALID_MANIFEST` |
| 6 | `INVALID_MESSAGE` |
| 7 | `TIMED_OUT` |
| 8 | `CAPABILITY_UNSUPPORTED` |

A CLOSE never carries text: the device that hears it says what happened in its own words ([§13.4](#134-outcomes)). A `HOLD` reason, a `STATUS` state or a `DATA` flag this version doesn't use is refused or read as the tables say; feature bits in a hello it doesn't know are ignored.

## 9. The List of Files and the Checkpoint Chain

**The list of files** (the manifest) is the first thing the sender sends each receiver:

```
version (1) = 1 ‖ block size (4) = 1,048,576 ‖ file count (4) ‖ total size (8)
then for each file: size (8) ‖ name's length (2) ‖ name (UTF-8) ‖ type's length (1) ‖ media type (ASCII)
```

- 1 to 10,000 files, at most 1 MiB in all; each size and the total at most 2⁵³ − 1, the total exactly their sum; each name 1 to 255 UTF-8 bytes under core's file name rule (the sender refuses a bad one with `INVALID_FILENAME`, a receiver with `INVALID_MANIFEST`); a media type of 0 to 127 printable ASCII bytes, advice only (a sender with a bad one sends it empty); nothing after the last file. Any other version or block size is `INVALID_MANIFEST`.
- **Its hash:** SHA-256 of `"dropgate/4 dgdtp manifest"` ‖ the list. ACCEPT and FINISH carry it.
- **Its fragments** go in MANIFEST records, in order from offset 0, each the most a record holds, every one giving the same total; a gap, an overlap, a fragment past the total or DATA before ACCEPT is `INVALID_MANIFEST` or `INVALID_MESSAGE`. The receiver sees the files only once the whole list is in and checked.

**Blocks:** each file is cut into 1 MiB integrity blocks, the last shorter. A DATA record never crosses a block or a file's end, and its bytes are **exactly** the most a record holds, or what's left of its block: at a record size of 65,535, 65,505 bytes, so a block is 16 records of 65,505 bytes and one of 496. A receiver refuses any other size (`INVALID_MESSAGE`), so every transfer's records are the same for the same files. After each block's last DATA, its BLOCK_END; a block that doesn't match its hash, or a BLOCK_END before its bytes, is `INTEGRITY_FAILED` or `INVALID_MESSAGE`. An empty file is its FILE_END alone.

**The checkpoint chain** runs over every block of every file, in order:

```
C0 = SHA-256("dropgate/4 dgdtp checkpoint" ‖ the list's hash)
each block:     C = SHA-256(C ‖ 01 ‖ file index (4) ‖ block index (8) ‖ length (4) ‖ the block's SHA-256 (32))
each file's end: C = SHA-256(C ‖ 02 ‖ file index (4) ‖ size (8) ‖ block count (8))
```

FILE_END carries the chain after its own step, and FINISH the last; RESULT gives it back. A file's end whose size isn't the list's, or a chain that doesn't match, is `INTEGRITY_FAILED`.

## 10. The Pump, Credit and the Sink

- **The pump.** Each device sends its records from one ordered loop. Control records go ahead of any of the stream not yet sent; records are encrypted in the order they go, up to 8 at a time, and none is ever dropped. The loop stops once about 1 MiB waits in the data channel's buffer, and goes on at 256 KiB ([§4.13](#413-what-the-rendezvous-and-the-engine-add)).
- **Reading.** The sender reads each file a 1 MiB block at a time, at most 2 blocks ahead of what it has sent, hashing each block and stepping it into the chain. A read that gives other than the bytes asked for is `SOURCE_UNAVAILABLE`.
- **Credit.** The sender never has more sent and not yet written than the receiver's credit allows: `limit − consumed` is at most 4 MiB. ACCEPT gives the first limit, and CREDIT moves it on as the receiver writes: once what it has written moves 256 KiB, and at once as a file finishes. The receiver writes whole blocks, so no CREDIT waits on a timer. Revisions only rise; a CREDIT that lowers anything, or DATA past the credit given, is `INVALID_MESSAGE`. DATA is counted against the credit as it arrives, not as it's handled, so a sender that ignores credit is refused at once rather than piled up unread.
- **File ends ahead.** At most 8 FILE_ENDs go ahead of the files the receiver has finished (CREDIT's files done), so a transfer of many small files can't run far ahead of the receiver's disk.
- **The sink** is mandatory: no sink, no ACCEPT. One sink, one for each file, or one ZIP of them all through core's ZIP writer. The receiver writes a block only once it matches; `consumed` counts the bytes whose write has finished (through the ZIP writer, once it has taken them). Each file's sink is closed at its FILE_END, the last after FINISH, a ZIP finished first. A write or close that fails is `OUTPUT_WRITE_FAILED`, and on any end but completion the sink is aborted, so a partial file is never finished as if it were whole. A sink marked as a browser's hand-off makes RESULT's assurance `handed-off`, never `saved`.

## 11. Pausing (HOLD)

- **Either device** may hold the transfer from ACCEPT until FINISH: HOLD with 1 as it pauses, 0 as it resumes, each device's hold its own. **Data runs only when neither holds:** the sender sends no more of the stream, and the receiver gives no more credit; what's already on its way is still received, checked and saved, and nothing is sent twice. Each device knows who holds it: itself, the other or both. A HOLD outside that span, after FINISH say, is passed over: once all the data is in, the files are finished whatever either device holds.
- **While held,** liveness keeps running ([§12](#12-timers-and-liveness)), and nothing counts as stalled; the count starts afresh once the transfer runs again.
- **Pause limits:** each device has its own, none by default, from its client's `direct` option, and says it in its hello in whole seconds. A hold by either device counts against both limits from the moment the transfer stopped, afresh each time it stops; both devices show the same deadline, the earlier of the two. The device whose limit runs out first sends CLOSE (`PAUSE_LIMIT`), and both end `PAUSE_LIMIT`, worded by whose limit it was ([§4.10](#410-errors)).
- A hold survives nothing in this version: a dropped connection ends the transfer. Recovery, later, carries a hold through ([§16](#16-recovery-reserved)).

## 12. Timers and Liveness

Every timer runs on a monotonic clock (`performance.now()`). The values are [§4.14](#414-constants)'s.

| Timer | Value | When it runs out |
|-------|-------|------------------|
| An attempt's ICE | 30 seconds from its start | That attempt ends `TIMED_OUT`, "Couldn't connect to the other device." |
| Its handshake | 15 seconds from the data channel opening | The same |
| Its whole set-up | 90 seconds | The same |
| An offer waiting for its answer | 10 minutes | CLOSE (`FAILED`, `TIMED_OUT`) from whichever device ran out first: both `TIMED_OUT`, "The offer wasn't accepted within 10 minutes." |
| Nothing sent | 5 seconds | A PING |
| Nothing heard | 15 seconds, or six smoothed round trips if longer | `CONNECTION_LOST` |
| No data, with credit given and not held | 30 seconds | The receiver sends a STATUS ask, and again every 30 seconds while nothing moves |
| A write, close or read not finished | 30 seconds | Shown as stalled |
| The same | 2 minutes | CLOSE (`FAILED`): `OUTPUT_STALLED` on the receiver, `SOURCE_UNAVAILABLE` on the sender |
| A CLOSE waiting for its CLOSE_ACK | 2 seconds | Closed anyway |
| RESULT waiting for RESULT_ACK | 2 seconds | The receiver completes anyway |
| A data channel gone, before RESULT | 2 seconds | Listening for a CLOSE through the rendezvous, then `CONNECTION_LOST` |
| An out-of-band CLOSE heard while the data channel is up | 2 seconds | Heard, if the in-band one hasn't come ([§13.2](#132-in-band-and-through-the-rendezvous)) |

**Liveness.** A device that has sent nothing for 5 seconds sends a PING; each is answered with a PONG as it arrives, whatever the device is busy with, and the round trips make a smoothed round-trip time, each new one counting for an eighth. PING, PONG, STATUS, CLOSE and CLOSE_ACK are all handled as they arrive, never behind a slow sink. Liveness keeps running while the transfer is held, so a 6-hour pause stays connected; finishing the files after FINISH counts as a write.

**STATUS.** An answer gives the device's state ([§8.2](#82-the-fields-values)), whether it holds the transfer, the bytes written as it knows them, and, once it has sent RESULT, the RESULT. An answer is kept for the device's screens and changes nothing else.

## 13. CLOSE and Outcomes

### 13.1 One Way to End

Every end but completion and a fault in the secure channel itself is one CLOSE: a cancel (`USER_CANCELLED`), a decline (`USER_DECLINED`), an app closing (`APP_CLOSED`), a pause limit (`PAUSE_LIMIT`), another receiver chosen (`TAKEN`) or a failure (`FAILED`, with what failed). The device that hears it ends as [§13.4](#134-outcomes) says and answers with CLOSE_ACK; the device that sent it waits up to 2 seconds for that, then closes. A second CLOSE, by either path, is ignored.

- **After RESULT,** a CLOSE is answered with CLOSE_ACK holding the RESULT, and the receiver stays completed. One that comes while the receiver is finishing the files is answered once they're finished.
- **A late cancel:** a sender that cancels once FINISH has gone waits those 2 seconds for the receiver's answer, and if the files were saved already, the send is completed, not cancelled.
- **A secure-channel fault** ends both devices with the channel's own abort ([§4.10](#410-errors)), never a CLOSE.

### 13.2 In-Band and Through the Rendezvous

Each CLOSE goes two ways: inside the channel, after whatever is already encrypted, and sealed through the rendezvous as an out-of-band close ([§4.8](#48-bind-and-the-out-of-band-close)), so it arrives even when the data channel has gone.

- **The out-of-band copy goes first, at once.** It's sealed with no promise to wait for, on `@noble`'s AES-256-GCM whichever crypto provider the device uses (the same bytes as Web Crypto's: the signal vectors hold them), and handed to the rendezvous's socket before anything else the device does as it ends: before a sink is aborted or the app is told. A page that's closing may never see a Web Crypto promise settle, and its close must still go ([§13.3](#133-an-app-closing)).
- **Heard in order.** Because it goes at once, the out-of-band copy can arrive ahead of records the other device sent before it, such as an ACCEPT still on the data channel. So one heard while the data channel is up waits for the in-band CLOSE, which follows those records, for the data channel's end, or for 2 seconds, whichever is first. Once the data channel has gone, it's heard at once.
- **A lost connection:** with the data channel gone, or the other device gone quiet, before RESULT, each device listens 2 seconds more for a CLOSE through the rendezvous, which ends it as it says (an app closed, say); otherwise it ends `CONNECTION_LOST`, never a cancel.

### 13.3 An App Closing

`client.direct.appClosing()` ([§4.15](#415-in-cores-api)) ends every direct transfer the client runs, each sending CLOSE (`APP_CLOSED`); the other device reads "The sender closed Dropgate before the transfer finished." (or the receiver). It returns at once, and the transfers end in a microtask straight after the caller's code, a page's `pagehide` listener, returns.

A page being closed has almost no time, and engines differ in what it can still send. Measured in Playwright's builds of each engine:

- **No Web Crypto result arrives** in a closing Firefox or WebKit page, nor does any timer fire; synchronous code and microtasks still run. So the close is sealed synchronously ([§13.2](#132-in-band-and-through-the-rendezvous)), and the in-band copy, encrypted through the crypto provider, may never go.
- **Firefox lets one WebSocket message out,** and only one sent within about a millisecond of `pagehide`. A message sent from inside the page's first `pagehide` listener didn't go, where the same one sent from the microtask straight after it did, which is why `appClosing()` does its work there.
- So the close reaches the other device in Chromium, Firefox and WebKit. It's still best effort. A page closed while it's busy sending, on a slow or loaded machine, sometimes never runs its `pagehide` in time, in Chromium as in Firefox (in Firefox 5 times in 16 under heavy load in testing, rarely otherwise); and a Firefox page closed within a few milliseconds of its last message to the server (at the very moment of a Download click, as the sender locks its room) may not get it out. The other device then reads `CONNECTION_LOST` instead. A receiving page, closed mid-transfer, has told the sender every time in testing, in all three.

A transfer still opening its room, or still connecting, has nobody to tell, and is cancelled.

### 13.4 Outcomes

Each device ends once, in its own words, never with the other device's text ([§4.10](#410-errors) has every code and message):

| What happened | The receiver | The sender |
|---------------|--------------|------------|
| Completed, saved | `completed`, `saved` | `completed`, `saved`: "The receiver has the files." |
| Completed, handed to a browser | `completed`, `handed-off`: "Handed to your browser. Check your downloads." | `completed`, `handed-off`: "Delivered to the receiver's browser." |
| This device cancels | `cancelled` by `self` | `cancelled` by `self` |
| The other device cancels | `cancelled` by `peer`: "The sender cancelled the transfer." | `cancelled` by `peer`: "The receiver cancelled the transfer." |
| The receiver declines | `cancelled` by `self` | `cancelled` by `peer`, declined: "The receiver declined the transfer." |
| The other device's app closed | `failed`, `PEER_CLOSED`: "The sender closed Dropgate before the transfer finished." | the same, of the receiver |
| A pause limit | `failed`, `PAUSE_LIMIT`, by whose it was | the same |
| The connection dropped | `failed`, `CONNECTION_LOST` | the same |
| The receiver's sink failed or stalled | `failed`, `OUTPUT_WRITE_FAILED` or `OUTPUT_STALLED` | `failed`, `PEER_FAILED`: "The receiver couldn't save the file." or "The receiver's device stopped saving the file." |
| The sender's file couldn't be read | `failed`, `PEER_FAILED`: "The sender's file couldn't be read." | `failed`, `SOURCE_UNAVAILABLE` |
| A block, a file's end or FINISH didn't match | `failed`, `INTEGRITY_FAILED` | `failed`, `PEER_FAILED`: "The file didn't arrive intact." |
| A record that isn't one | `failed`, `INVALID_MESSAGE` | the same, or `PEER_FAILED` when the other device found it |
| Another receiver accepted first | `failed`, `REQUEST_REJECTED` | (the send goes on with the one chosen) |
| Nobody accepted in 10 minutes | `failed`, `TIMED_OUT` | the same |
| A wrong code; a security fault | `CODE_MISMATCH`; `SECURITY_POLICY_MISMATCH` | the same |

## 14. Generation Fencing

Every effect carries the generation of the connection it came from or started on ([§2](#2-terminology)) and its transfer: a record, a sink's write, a file's read, a timer. One from another generation, or one that comes after the transfer has ended, is dropped and touches nothing. This version has generation 0 only, so the fence is tested by injecting a stale effect; recovery's resumes ([§16](#16-recovery-reserved)) will be the generations after it.

## 15. Node

Browsers and the Dropgate Client have their own `RTCPeerConnection`. In Node, core runs a direct transfer on one an integrator passes as the client's `RTCPeerConnection` option, and Node 22 and later have the `WebSocket` core uses for the rendezvous. Core's tests run on two, each pinned to an exact version: **werift** (TypeScript, complete, ICE restart included, about 7.5 MiB/s on one machine) for the suite, and **node-datachannel** (libdatachannel, native, about 120 MiB/s, no ICE restart) for one transfer. Neither is a dependency of core or in any of its builds, the Web UI or the Dropgate Client, and a test checks that no build imports either. What each does for privacy, werift's lookups of a STUN server and of `.local` names among them, is in [Direct Transfers](../core/p2p.md#in-node).

## 16. Recovery (Reserved)

Recovering a dropped connection (an ICE restart, a resume into a new connection, a transfer started again in place) is for a later version. What this version holds for it:

- RESUME (16) and RESUME_OK (17) are kept, and refused as `INVALID_MESSAGE`; so is CLOSE's `RECOVERY_EXHAUSTED`, sent by nothing yet.
- A resume's keys and handshake are built, from the resume secret ([§4.9](#49-the-resume-secret)); the generation in the prologue and every effect's fence are there for it.
- Each device's reconnect window is in its hello, 2 minutes unless it sets another, and is used by nothing yet.
- Until then, a dropped connection ends the transfer `CONNECTION_LOST`, and is started again from the beginning.

## 17. What the Server Holds

| What | Where, and how long |
|------|---------------------|
| The sender's socket, its room ID (a hash of the link's secret) and its room's nonce (random, public) | Memory, while the sender's socket is open |
| A room's locator (2 or 3 letters) | Memory, while its code is unused; then 5 minutes' quarantine, with nothing tied to it |
| Each attempt's socket and tag | Memory, while both its sockets are open |
| Frames | In flight only, in the sockets' buffers: at most 1 MiB each |
| The count by address | Memory: a 16-byte keyed hash and a number, while a code is unused |
| Logs, disk | Nothing: no room ID, room nonce, attempt ID, locator, share or frame |

Nothing the rendezvous holds lets it read a frame, test a guess at a code or find a link's secret. At the `DEBUG` log level it writes only known events ("A direct transfer's room opened.", "… closed.", "A receiver joined.", "No code was free."), with no room ID, nonce, locator, tag, address or size; nothing at `INFO`. [DATA-PROCESSING](./DATA-PROCESSING.md) has each of these with the test that proves it.

## 18. Error Model

Every failure is core's `DropgateError`, with a code from its catalogue ([Errors](../core/errors.md)) and an origin: `local` for this device, `peer` for what the other device did or said, `server` for the rendezvous, `network` for the connection. [§4.10](#410-errors) has each code a direct transfer gives, with its message. What the other device says arrives only as a CLOSE's reason and detail, numbers this device words itself ([§8.2](#82-the-fields-values)), so no peer's text is ever shown, logged or passed on; `PEER_FAILED` carries what failed as `details.reason`. A transfer's outcome, `completed`, `cancelled` (by `self` or `peer`) or `failed`, is its handle's result, which never rejects ([Outcomes](../core/outcomes.md#direct-transfers)).

---

## 19. Security Considerations

What the secure channel protects, and what it doesn't, is in [§4.1](#41-what-it-protects-and-what-it-doesnt). Beyond it:

### 19.1 Transport Encryption

WebRTC encrypts the data channel with DTLS, and every Dropgate 4 transfer runs its own encrypted channel inside it ([§4](#4-the-secure-channel)): the set-up messages are sealed, and both devices' certificate fingerprints are bound into the encrypted handshake, so a server that swaps them ends the connection instead of reading it ([§4.6](#46-the-dtls-prologue)).

Dropgate 3's direct transfers relied on DTLS alone, and their SDP, fingerprints included, travelled through the signalling server unauthenticated: a malicious or compromised server could replace both fingerprints, place itself between the peers and read or change everything, undetected. Dropgate 3's transfers were only as confidential as their server was trustworthy; Dropgate 4's don't depend on it.

### 19.2 Records Are Exact

Every record is one type at one exact length, read field by field ([§8](#8-records)), so nothing in a record is ever guessed at or passed over: a DATA record before ACCEPT, of any size but the one it must be, past the credit given, or from the wrong device, is refused. The receiver accepts data only into a sink it opened itself, and writes a block only once it matches its hash and the chain ([§9](#9-the-list-of-files-and-the-checkpoint-chain)).

### 19.3 Memory Is Bounded

Credit caps what the sender may have sent and not yet written at 4 MiB, and DATA is counted against it as it arrives, so a sender that ignores credit is refused rather than held in memory. The list of files is at most 1 MiB and 10,000 files; the sender reads at most 2 blocks ahead; the rendezvous holds at most 1 MiB for a slow socket and closes it past that.

### 19.4 Liveness Can't Be Faked Into Progress

PING and PONG keep a connection alive, never a transfer going: a stalled sink or source still ends the transfer at 2 minutes, whatever arrives meanwhile, and only data moves its progress. A hold stops the stall count, and is shown to both devices with whose it is.

### 19.5 ICE Candidate Exposure

The two devices tell each other their addresses to connect: local addresses, and the public ones a STUN server sees. They're sealed through the rendezvous, so the server can't read them, but the other device learns them, and so does the STUN server, of the device that asks it. Where that matters:

- **Turn STUN off** (`P2P_STUN_SERVERS=none` on the server, or core's `direct: { stun: false }`): nothing goes to a STUN server, and only devices that can reach each other directly connect.
- **Only STUN servers are used.** Core takes from the server's `capabilities.p2p.iceServers` only `stun:` and `stuns:` addresses, with no username or credential: a TURN relay the server lists, with its credentials, is left out, as is anything that isn't an address, so a server can't route a transfer through a relay of its own. A list left with none means no STUN.
- **Use a VPN** that allows peer-to-peer traffic, so the addresses shown are the VPN's. Research providers carefully: their logging, jurisdiction and record.
- A wrong code is caught before either device opens anything the other sent to set up the connection, so someone guessing never learns the sender's addresses ([§4.1](#41-what-it-protects-and-what-it-doesnt)).

### 19.6 Codes and Links

- **A code takes one try,** right or wrong ([§6](#6-codes-and-the-pool)): a guess can only be tried by connecting, the sender sees it fail and gets a new code, and nothing anyone records, the server included, lets them test a guess afterwards ([§4.3](#43-cpace-typed-codes)). Only a code's locator reaches the server, and a used locator waits 5 minutes before it's given out again. Each address holds at most 5 unused codes by default, and the rendezvous's sockets pass the server's rate limiter.
- **A link carries 256 bits** after its `#`, which a browser never sends, so the server sees only a room ID derived from it, and it can't be guessed.
- **A link or a code is a bearer capability:** anyone who has it can connect and sees the offer, the files' names and sizes included, before anything is accepted. Once a receiver accepts, nobody else can join. Share one only with the person it's for.
- Dropgate 3's receiver link carried its code in the URL's path (`/p2p/<code>`), where a reverse proxy's log or a browser's history could keep it, and its receive page connected as soon as it opened. A Dropgate 4 server answers such a link with its older-version page; Dropgate 4's links and typed codes go after the `#`, and a link's page waits for Connect.

### 19.7 A Closing Page

A page that closes mid-transfer tells the other device it closed, best effort ([§13.3](#133-an-app-closing)). Where it can't, the other device reads the connection lost, and both end there: nothing is left running either way.

---

## 20. Configuration Reference

### 20.1 Server Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_P2P` | `true` | Turns direct transfers on or off: the rendezvous, the receive page and `capabilities.p2p`. |
| `P2P_STUN_SERVERS` | `stun:stun.cloudflare.com:3478` | `stun:` or `stuns:` addresses, each a host and an optional port, separated by commas or spaces; or `none`, for no ICE servers. Set to nothing, a `turn:` address or anything else, the server doesn't start. |
| `P2P_LOCATOR_LETTERS` | `2` | How many of a code's letters are the rendezvous's locator: `2` (576 codes at once) or `3` (13,824). |
| `P2P_MAX_CODES_PER_IP` | `5` | The most unused codes one address holds at once; `0` turns codes off. |
| `PEERJS_DEBUG` | — | Removed in Dropgate 4: set to anything, the server warns once at startup that it's ignored. |

### 20.2 Client Configuration Options

A direct transfer takes three settings, from core's `direct` option on the client, each overridable per transfer ([§4.15](#415-in-cores-api); their ranges are in [§4.14](#414-constants)): the pause limit (none by default), the reconnect window (2 minutes) and STUN (on). The Web UI passes none, so core's defaults apply. In Node, the client also takes an `RTCPeerConnection` ([§15](#15-node)). Dropgate 3's options (its chunk size, acknowledgements, buffer marks, heartbeat and watchdog) went with its code.

---

## 21. Protocol Constants

The secure channel's, the rendezvous client's and the engine's constants are in [§4.14](#414-constants).

---

## 22. Message Type Reference

- The rendezvous's messages, and `ERROR`'s codes: [§5.2](#52-messages).
- The engine's records: [§8.1](#81-the-records); their fields' values, CLOSE's reasons and details among them: [§8.2](#82-the-fields-values).
- The sealed frames that set up the connection, and the out-of-band close: [§4.5](#45-sealed-signalling), [§4.8](#48-bind-and-the-out-of-band-close).
- CPace's three messages and Noise's two: [§4.3](#43-cpace-typed-codes), [§4.7](#47-noise).

---

## 23. Best Practices

### 23.1 Server Deployment

- **Deploy the Dropgate Server behind HTTPS.** Browsers allow direct transfers only in a secure context, and the rendezvous MUST be reached over HTTPS and WSS (or `localhost` for development). A reverse proxy has to pass WebSocket upgrades on `/api/v4/rendezvous`.
- **A server can stop a transfer, not read it.** Everything the rendezvous relays is sealed, and both devices' certificates are checked inside the encrypted handshake, so a server that changes anything ends the connection ([§4.1](#41-what-it-protects-and-what-it-doesnt)).
- **Choose the STUN server.** Cloudflare's is the default and suits most servers. For privacy, offer one you run, or none (`P2P_STUN_SERVERS=none`), for devices that reach each other directly.
- **Size the pool.** 2 letters give 576 codes at once; on a busy server, 3 give 13,824. Links work whatever the pool holds.
- **Mind the reverse proxy's access log.** Nothing of a link or a code is in any URL a direct transfer uses: the rendezvous's address is `/api/v4/rendezvous` alone. A Dropgate 3 app's PeerJS connection puts its code in the URL it asks for (`/peerjs/peerjs?key=peerjs&id=<code>&token=…`), which the server answers with "update", but which an access log may keep. See [DATA-PROCESSING §9.2](./DATA-PROCESSING.md#92-reverse-proxies).

### 23.2 Client Behaviour

- **Show the link as well as the code.** A code may not be free at once, and is used up by one try; the link always works. Read `share()` again whenever the snapshot's `code` changes.
- **Show the offer before saving anything.** The receiver sees the names and sizes first; accept into a sink only once someone has chosen to, and save each file under `filenames.sanitize(name)`.
- **Say where the files went.** A browser's hand-off (StreamSaver) can only be `handed-off`: say "Check your downloads", never "Saved".
- **Call `client.direct.appClosing()` from `pagehide`,** or as a desktop app quits, so the other device hears that this side closed rather than seeing a lost connection.
- **Treat `CONNECTION_LOST` as final in this version:** start the transfer again. Never present it as a cancel.
- **In Node, pick the `RTCPeerConnection` with care** ([§15](#15-node)): werift asks a STUN server even when given none.

### 23.3 Network Privacy

- **Use a VPN for sensitive direct transfers,** one that allows peer-to-peer traffic, or turn STUN off ([§19.5](#195-ice-candidate-exposure)). Research providers carefully: their logging policies, jurisdiction and technical architecture.
- **A STUN server sees the device's IP address** as it asks, as any server it talks to does, and nothing of the transfer. A self-hosted one, or none, keeps that off a third party.
- **Consider the network.** In corporate or institutional networks, WebRTC traffic may be blocked or inspected; two devices that can't reach each other don't connect (there's no relay: core uses only the STUN servers the server lists, and never a TURN relay, [§19.5](#195-ice-candidate-exposure)), and end `TIMED_OUT`, "Couldn't connect to the other device."

---

## 24. A Transfer, Start to Finish

One file, by code, from the sender's room to the receiver's save:

```
Receiver                          Rendezvous                          Sender
   │                                  │◄─── CREATE (room ID, nonce, code wanted)
   │                                  │──── CREATED (locator) ──────────►│  [shows the code and the link]
   │──── JOIN (by locator) ──────────►│──── ATTEMPT (tag, by code) ─────►│
   │◄─── JOINED (room nonce) ─────────│                                  │
   │  [CPace's three messages, then the sealed offer, answer and candidates, as frames]
   │◄═════════════════════════════════╪═════════════════════════════════►│  [the code used up; a new one asked for]
   │  [data channel open: Noise's two messages, then records]                │
   │  BIND ─────────────────────────────────────────────────────────────────►│
   │◄─────────────────────────────────────────────────────────── MANIFEST    │
   │  ACCEPT ───────────────────────────────────────────────────────────────►│
   │                                  │◄─────────────────────────── LOCK ────│
   │◄──────────────────────────── DATA × 17, BLOCK_END (each 1 MiB block)    │
   │  CREDIT ───────────────────────────────────────────────────────────────►│
   │◄──────────────────────────────────────────────── FILE_END, FINISH       │
   │  [the sink closed: the file saved]                                      │
   │  RESULT ───────────────────────────────────────────────────────────────►│
   │◄──────────────────────────────────────────────────────── RESULT_ACK     │
   │  [completed; the channel closed, the sockets with it]                   │
```
