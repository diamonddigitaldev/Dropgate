# DGDTP — Dropgate Direct Transfer Protocol

**Protocol Version:** 4.0, in development. Its secure channel ([§4](#4-the-secure-channel)) is built in the core library and tested, but no transfer runs over it yet: today's direct transfers use version 3's messages ([§5](#5-signalling-layer) to [§18](#18-error-model)), with `hello` carrying 4
**Status:** In development
**Last Updated:** November 2026

---

## 1. Overview

The Dropgate Direct Transfer Protocol (DGDTP) defines the peer-to-peer (P2P) file transfer mechanism used by Dropgate. Unlike DGUP (which uploads files to a server for later retrieval), DGDTP streams file data directly from one peer to another over a WebRTC data channel. The Dropgate Server only puts the two devices in touch and relays the messages that set up their connection; it doesn't store or process the transferred file content.

DGDTP 4 has two layers:

- **The secure channel** ([§4](#4-the-secure-channel)). From a secret both devices hold, a link's or a typed code's, it makes an encrypted, authenticated channel over the connection the two devices set up. Everything that sets up that connection goes through the server sealed, and the connection's own certificates are tied into an encrypted handshake that runs over it, so a server that changes, replays or swaps anything makes the connection fail instead of reading it.
- **The transfer messages** that run over it: the list of files, their data, flow control and the end of a transfer.

### 1.1 What's Built Now

The secure channel is built in `@dropgate/core` ([`packages/dropgate-core/src/dgdtp/`](../../packages/dropgate-core/src/dgdtp/)), and tested end to end over stand-in connections, over WebRTC between two peer connections in Node, and through a real Dropgate Server's rendezvous ([§4.12](#412-test-vectors-and-tests)). Nothing in core's API uses it yet, and none of it is exported.

Today's direct transfers still run version 3's transfer messages, with `hello` carrying 4, on PeerJS, protected by WebRTC's own DTLS encryption alone ([§5](#5-signalling-layer) to [§18](#18-error-model)). They support single-file transfers, multi-file transfers (streamed into a ZIP archive on the receiving end), flow control with chunk-level acknowledgements, and connection health monitoring. Resume messages are reserved but not implemented (see [§16](#16-resume-support)). What DTLS alone does and doesn't protect against is in [§19.1](#191-transport-encryption).

Dropgate 4's own rendezvous on the Dropgate Server, in place of PeerJS, is built, and so is core's client for it: a sender's room, its codes, its receivers' attempts by link or by code, and the sealed frames between them ([§4.13](#413-what-the-rendezvous-and-the-engine-add)). Core also writes and reads the transfer engine's records, its list of files and its checkpoint chain. The engine that sends them is still to come. Together they carry every direct transfer over the secure channel, and their messages replace §5 to §18.

### 1.2 Design Goals

- **Zero server storage** — file data never touches the server's filesystem or memory.
- **End-to-end security** — over the secure channel, only the two devices can read a transfer or the messages that set up its connection, and a server that tampers with either ends the connection instead of reading it. Today's transfers rely on DTLS alone, which a malicious signalling server can get between (see [§19.1](#191-transport-encryption)).
- **Flow control** — chunk acknowledgements and buffer monitoring prevent fast senders from overwhelming slow receivers.
- **Minimal signalling** — the server only relays what sets up the connection: today PeerJS's messages, and over the secure channel, sealed frames it can't read. Once the data channel is established, the server is no longer involved.
- **Human-readable codes** — peers are identified by short, pronounceable codes rather than opaque UUIDs or IP addresses. Over the secure channel, only a code's first two letters ever reach the server.

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| **Sender** | The peer that holds the file(s) and initiates the DGDTP session. |
| **Receiver** | The peer that connects to the sender's code and receives file data. |
| **Signalling Server** | The Dropgate Server component that relays WebRTC signalling messages (PeerJS, today). |
| **Rendezvous** | Dropgate 4's signalling on the Dropgate Server, in place of PeerJS: it puts a sender and a receiver in touch and relays the sealed messages that set up their connection. |
| **Data Channel** | The WebRTC RTCDataChannel over which DGDTP messages and binary data are sent. |
| **P2P Code** | A human-readable identifier in the format `XXXX-0000` (4 letters + 4 digits). |
| **Locator** | A code's first two letters (three on a server set for more rooms at once), which the rendezvous hands out and knows the sender's room by. The only part of a code that leaves the device. |
| **Password** | The rest of a code, made on the sender's device. |
| **Link Secret** | 32 random bytes made on the sender's device, carried after the `#` of a direct transfer's link. |
| **Room** | A sender's place on the rendezvous, found by its link's secret or its code's locator. |
| **Attempt** | One try at connecting to a room, with keys of its own: a receiver's, by link or by code, or a resume. |
| **Generation** | Which connection of a transfer an attempt makes: 0 for the first, one more for each resume. |
| **Crypto Provider** | What does core's cryptography: the platform's Web Crypto, or core's own JavaScript crypto on `@noble` ([Crypto](../core/crypto.md)). |
| **Session ID** | A UUID identifying a specific transfer session, used to check that all file metadata in a transfer belongs to the same session. |
| **Watchdog** | A receiver-side timer that detects stalled senders. |
| **Heartbeat** | A sender-side periodic ping that prevents idle-timeout disconnections. |

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

Today, the sender registers its whole code with PeerJS, up to **4 times** (configurable), drawing a new one when it's taken. Over the secure channel, the sender asks the rendezvous for a locator, and draws the password's letters and digits on its own device the same way.

### 3.4 Validation

Codes are normalised before use: whitespace anywhere is removed, letters are converted to uppercase, and the dash may be left out. Anything else, including an `I` or an `O`, isn't a code, and is refused before anything is sent. The canonical form is `^[A-HJ-NP-Z]{4}-[0-9]{4}$`. Letters are checked as ASCII before they're converted, so no other character can become one.

### 3.5 What Leaves the Device

Over the secure channel, only a code's locator is sent: the receiver joins the sender's room by it. The password goes only into CPace ([§4.3](#43-cpace-typed-codes)), on each device, and is never sent, logged or kept: its bytes can be read once, by the exchange that uses them, and are overwritten as soon as they've made CPace's generator. Core's tests search every byte both devices send, through the server and over the connection, for the code and its password in every form (with and without the dash, in either case, as UTF-8 and as UTF-16): neither is there.

Today, the sender registers its whole code with PeerJS as its peer ID, so the server sees it ([§19.8](#198-code-brute-force-resistance)).

### 3.6 Links

A sender's room has a link as well as an optional code. The link carries the **link secret** after its `#`: 32 random bytes from the sender's crypto provider. A browser never sends what's after a `#`, so the server never sees it, and the receiver joins the room by a room ID derived from it ([§4.4](#44-the-key-schedule)), which tells the server nothing about it. The link is separate from the code, so a wrong code never breaks it, and it can't be guessed. In the link, the secret will be URL-safe base64 with no `=`, 43 characters.

Today's links still carry the code itself, in the address's path ([§19.8](#198-code-brute-force-resistance)). The new links arrive with Dropgate 4's rendezvous.

---

## 4. The Secure Channel

What every direct transfer will run over: built in core and tested, but not used by any transfer yet ([§1.1](#11-whats-built-now)). It's core's own code, in [`codes.ts`](../../packages/dropgate-core/src/dgdtp/codes.ts), [`cpace.ts`](../../packages/dropgate-core/src/dgdtp/cpace.ts), [`keys.ts`](../../packages/dropgate-core/src/dgdtp/keys.ts), [`seal.ts`](../../packages/dropgate-core/src/dgdtp/seal.ts), [`prologue.ts`](../../packages/dropgate-core/src/dgdtp/prologue.ts), [`noise.ts`](../../packages/dropgate-core/src/dgdtp/noise.ts) and [`channel.ts`](../../packages/dropgate-core/src/dgdtp/channel.ts), on core's crypto provider: Web Crypto where it can, and `@noble` where it can't, with the same bytes either way ([Crypto](../core/crypto.md)).

In what follows, `‖` joins bytes, and every number written into bytes is big-endian.

### 4.1 What It Protects, and What It Doesn't

**It protects:**

- **The transfer:** file contents, names and sizes, the list of files, every message about the transfer and why it ended, from the network, from the rendezvous (the Dropgate Server) and from anything relaying packets between the devices.
- **What sets up the connection:** each device's addresses, its ICE credentials and its certificate's fingerprint, from the rendezvous.
- **A code, from guessing:** a guess can only be tried by connecting, once per code, and the sender sees it fail. Nothing anyone records, the server included, lets them test a guess afterwards.
- **Against a server in the middle:** a swapped certificate, or a set-up message changed, injected, replayed or reordered, ends the attempt with `SECURITY_POLICY_MISMATCH`, never with a connection that quietly works.
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

The sealing and close keys are AES-256-GCM keys held inside the crypto provider, which can't be exported. The room ID and the PSK are bytes: the room ID is overwritten once the rendezvous has it, and the PSK is given to Noise once, then overwritten. Every output is made before the base secret is let go, so the ISK is overwritten as soon as the schedule is done.

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
- The receiver's first frame must be its offer, and the sender's its answer, one each. Candidates follow as ICE finds them, then the end of them. The receiver seals its offer before it applies it, and the sender its answer, so each takes counter 0.
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

**BIND** is the receiver's first record. For now its layout is provisional: `01` ‖ the close secret (32 random bytes) ‖ the receiver's capabilities (at most 1,024 bytes). The engine's own layout replaces it. Anything else as the receiver's first record is `SECURITY_POLICY_MISMATCH` at the sender. Both devices derive the close keys from the close secret ([§4.4](#44-the-key-schedule)), then overwrite it.

**An out-of-band close** tells the other device a transfer has ended even when the data channel has already gone: a sealed frame through the rendezvous, of kind `0x11`, counter 0, under that direction's close key. Its inside is type 6, with the close's body, at most 509 bytes, padded to 512, so it's 550 bytes on the wire, like a candidate. Each device sends at most one. A close that doesn't open, isn't one, or comes after the first is ignored, so the server can't end a transfer by injecting one. Late candidates still arrive on the same path.

### 4.9 The Resume Secret

A resume is a new attempt, from the **resume secret** both devices hold: 32 bytes, mode 3 in the prologue, a new attempt ID and the generation one past the connection's last, so new sealing keys, a new PSK, a new handshake and new fingerprints. Nothing from the earlier attempt is reused, and a generation past 2⁶⁴ − 1 is refused.

Core builds a resume's keys and handshake now. Where the resume secret comes from is the engine's, still to come: the receiver will make it, 32 random bytes, and give it to the sender inside the channel once it has accepted the transfer, so only the accepted receiver ever holds it, and only ever in memory.

### 4.10 Errors

Each error is core's `DropgateError` with one of these codes ([Errors](../core/errors.md)). The message is core's, in words the apps show as they are. None holds anything from the other device.

| Code | Origin | When | Message |
|------|--------|------|---------|
| `CODE_MISMATCH` | `peer` | CPace didn't complete: a wrong code, a code already used, or any abort ([§4.3](#43-cpace-typed-codes)). Both devices get it | The receiver: "That code didn't match. Ask the sender for the new one." The sender: "Someone entered the wrong code. Here's a new one." |
| `SECURITY_POLICY_MISMATCH` | `peer` | A sealed frame, a handshake message or a record didn't open, wasn't the next, or wasn't a length it can be; a fingerprint broke the rule; message 1 held something; BIND wasn't one | "The connection couldn't be secured, so it was closed." |
| `SECURITY_POLICY_MISMATCH` | `local` | This device has sent every frame or record its keys allow | "Setting up this connection took too many messages, so it was closed." or "This connection has sent every record its keys allow, so it was closed." |
| `CONNECTION_LOST` | `network` | The rendezvous, or the data channel, went before the channel was up: the server closed the socket, or told a receiver the sender has gone | "The connection was lost." |
| `SERVER_UNREACHABLE` | `network` | The socket to the rendezvous never opened | "The server couldn't be reached." |
| `NOT_FOUND` | `server` | No room has that link's room ID, or no unused code has that locator | "No transfer has that code or link. It may have ended, or the code was used." |
| `REQUEST_REJECTED` | `server` | The room is locked, already has 4 attempts by link, or its code is being tried | "This transfer is already going to someone else." |
| `VERSION_UNSUPPORTED` | `server` | The rendezvous speaks another DGDTP major. `details` says which side needs updating, as `GET /api/info` does | "Update required: this server runs a newer version of Dropgate. Update this app to use it.", or that its operator needs to update it |
| `CAPABILITY_UNSUPPORTED` | `server` | A typed code, on a server whose `codeLetters` is 0. Nothing is sent | "This server doesn't use codes. Ask the sender for the link." |
| `INVALID_CODE` | `local` | A typed code isn't one. Nothing is sent | "That isn't a valid sharing code." |
| `INVALID_RESPONSE` | `server` | The rendezvous gave a room nonce or a locator that isn't one, sent something that isn't one of its messages, or refused one of core's as malformed or as one frame too many | "The server's answer wasn't understood." |
| `INVALID_MESSAGE` | `peer` | A record from the other device isn't one of this version's, at its exact length (the engine, still to come, ends a transfer with it) | "The other device sent something this version of Dropgate doesn't understand." |
| `OPERATION_CANCELLED` | `local` | This device closed the attempt or the channel | "The operation was cancelled." |

**How both devices hear it:**

- A wrong code ends both with `CODE_MISMATCH`, each in its own words, through CPace's abort.
- In the handshake or after it, the device that finds a fault sends its abort on the data channel, one zero byte, then closes it. The other device's Noise refuses that as too short, so both end with `SECURITY_POLICY_MISMATCH`. (It isn't an empty message, which some WebRTC implementations can't send.)
- A sealed set-up frame that doesn't open ends that device with `SECURITY_POLICY_MISMATCH`. The other, whose path through the rendezvous closes before any data channel is open, ends with `CONNECTION_LOST`: nothing can tell it securely.
- The rendezvous going matters only until the data channel is open. The data channel closing during the handshake is `CONNECTION_LOST`.
- Whatever ends an attempt, every key it made is let go, and the data channel, the path through the rendezvous and the peer connection are closed.

### 4.11 Secrets in Memory

- Keys are crypto-provider handles, and AES keys can't be exported. Printed, logged or serialised, a key, a code's password, an attempt's keys, a sender's room or a channel shows only its label, such as `[AttemptKeys]` or `[SecureChannel]`.
- Raw secret bytes (the link's secret, the ISK, CPace's `K`, Noise's chaining key and each key's bytes before it's imported, the PSK, the close secret and the resume secret) are held only while they're needed, then overwritten with zeros. JavaScript can't promise memory is erased, but this keeps the copies few.
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

### 4.13 What the Rendezvous and the Engine Add

Of these, the connection itself, the rendezvous's rooms and codes, and core's client for the rendezvous are built. Core runs the secure channel over a W3C `RTCPeerConnection` (the browser's own, or one an integrator passes in for Node).

- **The data channel:** the receiver makes the one data channel, `dgdtp/4`, ordered and fully reliable, carrying bytes only; anything else on it is refused as a fault. The fingerprints come from the real SDP each device applied.
- **Record size:** a device's largest record is the smaller of 65,535 bytes and its data channel's max-message-size. A data channel that can't take 16,384 bytes ends the attempt with `CAPABILITY_UNSUPPORTED`. How each device tells the other its size comes with the engine.
- **Backpressure:** a device sends no more while over 256 KiB waits in the data channel's buffer, going on once it drains, whether or not the `bufferedamountlow` event comes.
- **Ends:** ICE or the connection failing, or the data channel closing, ends it with `CONNECTION_LOST`.

The rendezvous's rooms and codes are built on the Dropgate Server ([`server/rendezvous.js`](../../server/rendezvous.js)), beside PeerJS; core's client speaks to it, but nothing in core's API or the apps uses it yet.

- **One WebSocket per device** at `/api/v4/rendezvous`, with nothing about a room in its address, speaking short binary messages: a type byte, then fixed fields. The sender's one socket holds its room; each receiver's attempt has a socket of its own. A text message, or one over 8,232 bytes, closes the socket.
- **In plain, as a room is created or joined:** the DGDTP major, so a mismatch is said before any cryptography. A major other than the server's is refused with the server's version; the minor is passed over.
- **Creating a room:** the room ID, the room's nonce and whether the sender wants a code. A second room with a live room's ID is refused.
- **Joining by the room ID:** the receiver gets the room's nonce, and the sender hears of the attempt under a one-byte tag, which then carries that attempt's frames on the sender's socket. A room takes at most 4 attempts by link at once. Once the sender locks it, it takes no new ones (core will lock it as a receiver accepts), and the attempts under way carry on; the sender can also drop any one attempt.
- **Codes** ([§3](#3-codes-and-links)): a sender that wants one, on creating its room or later by asking, is given a locator drawn uniformly at random from the server's free ones: every string of `CODE_LETTERS` of the server's length, 2 (576 of them) or 3 (13,824), which `GET /api/info` gives as `capabilities.p2p.codeLetters`. A room has at most one unused code; asked again while it's unused, the server gives the same one. A receiver joins by the locator alone, the rest of the code never leaving either device, and the sender hears of the attempt as one by code.
- **One try per code:** a code is that attempt's until the attempt sends its first frame, CPace's first message ([§4.3](#43-cpace-typed-codes)), and another join by it meanwhile is refused as busy. Relaying that frame uses the code up, right or wrong: only the first CPace message for a locator ever reaches the sender, and a later join by it finds nothing. The sender can ask for a new code, and its link still works. A receiver that leaves, or is dropped, before sending anything leaves the code unused. A room has one attempt by code at a time, beside its 4 by link.
- **Codes come back:** a locator leaves its room when its code is used, when the sender locks the room, when the room ends, or when the code is released: 10 minutes after the sender last asked for it or renewed it, when the sender is told. Every locator that leaves a room waits 5 minutes before the server hands it out again, so a late try at an old code can't meet another sender's new one.
- **When none is free,** or the sender's address already holds the server's limit of unused codes (5 by default), the sender is given none, and its room works by link. The count by address holds a 16-byte keyed hash of each address (HMAC-SHA-256, under a key made at random as the server starts and never written), never the address, and an entry goes when its count reaches 0. An IPv6 address is counted with the rest of its /56 network, as the server's rate limiter counts it. A server can turn codes off, and then gives `codeLetters` 0.
- **Frames:** relayed whole and in order each way, never read or kept, from 0 to 8,230 bytes (CPace's abort is an empty one), at most 4,104 each way in an attempt, only for the room's live attempts.
- **Ends:** a room lives while its sender's socket is open, with no time limit; when it closes, each receiver is told and its socket closed, and when a receiver's closes, the sender is told. The server pings every socket every 30 seconds and closes one it hasn't heard from in 60, and closes one with more than 1 MiB waiting to be sent to it.
- **Nothing kept or logged:** no room ID, room nonce, attempt ID, locator, share or frame, in any log or on disk.

Core's client for the rendezvous ([`dgdtp/rendezvous.ts`](../../packages/dropgate-core/src/dgdtp/rendezvous.ts)) carries the secure channel's set-up through it:

- **Its sockets:** one for the sender's room, and one for each receiver's attempt, at `wss://<server>/api/v4/rendezvous` (`ws:` for a server on plain HTTP, which a client reaches only with `allowInsecure`), with the global `WebSocket`. Every message is binary, in the layouts above; the DGDTP major and minor are core's own.
- **A sender's code:** asked for only when the sender wants one and the server gives codes (`codeLetters` isn't 0), and renewed every 4 minutes while it's unused. After any attempt by code, right, wrong or given up before it was tried, the sender asks for a new code at once and draws a new password on this device for whatever locator comes back, so a code someone has typed is never shown again. While none is free, the room works by its link, and the sender asks again every 15 seconds until one comes or a receiver is accepted; if the server releases an unused code, the sender asks again at once.
- **Accepting a receiver** locks the room: it takes no new attempt, every other attempt is dropped, and no more codes are asked for.
- **A receiver** joins by the link's room ID, or by a typed code's locator, as many letters as the server's `codeLetters`; the rest of the code never leaves the device. On a server that gives no codes, a typed code is refused before anything is sent.
- **Errors** are core's, worded for direct transfers ([§4.10](#410-errors)): another major `VERSION_UNSUPPORTED` saying which side needs updating; no such room or code `NOT_FOUND`; a room taken, locked or full `REQUEST_REJECTED`; anything the server sends that isn't one of its messages, or its refusing one of core's, `INVALID_RESPONSE`; a socket that never opens `SERVER_UNREACHABLE`, and one that closes before the data channel is open `CONNECTION_LOST`.

The engine's records are written and read by core ([`dgdtp/messages.ts`](../../packages/dropgate-core/src/dgdtp/messages.ts)), each a type byte then fixed fields at an exact length, a record of any other length `INVALID_MESSAGE`; so are the list of files a sender offers, in pieces the size of a record, with its hash, and the checkpoint chain over every 1 MiB block of every file. They match a second implementation's vectors ([§4.12](#412-test-vectors-and-tests)).

Still to come, from the engine: sending those records (the sender's hello, BIND, the receiver's acceptance with the resume secret, a close), strictly in order over the data channel; and 15 seconds for each attempt.

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
| `NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES`, `MAX_HELLO_BYTES` | 1,024 | The sender's hello, and the receiver's capabilities in BIND. |
| `NOISE_REKEY_INTERVAL` | 65,536 | Records under one key, each way. |
| `MAX_GENERATION` | 2⁶⁴ − 1 | The last generation. |
| `DATA_CHANNEL_LABEL` | `dgdtp/4` | The one data channel's name. |
| `MIN_RECORD_BYTES` | 16,384 | A data channel that can't take a record of this size isn't used. |
| `LOW_WATER_BYTES` | 262,144 | A device sends no more while more than this waits in the data channel's buffer. |
| `RENDEZVOUS_PATH` | `/api/v4/rendezvous` | The rendezvous's one path on a server. |
| `RENEW_INTERVAL_MS` | 240,000 | How often a sender renews its unused code; the server releases one after 10 minutes. |
| `CODE_RETRY_MS` | 15,000 | How often a sender asks again for a code while none is free. |
| `HELLO_BYTES` | 18 | A hello: the sender's in Noise's second message, the receiver's in BIND. |
| `BIND_BYTES` | 51 | BIND: its type, the close secret and the receiver's hello. |
| `MANIFEST_HEADER_BYTES`, `DATA_HEADER_BYTES` | 9, 14 | A MANIFEST record and a DATA record before their bytes. |
| `BLOCK_BYTES`, `MAX_MANIFEST_BYTES` | 1,048,576 | An integrity block of a file, and the largest list of files. |
| `MAX_MANIFEST_FILES` | 10,000 | The most files one transfer offers. |
| `MAX_MEDIA_TYPE_BYTES` | 127 | A file's media type in the list of files. |
| `MANIFEST_VERSION` | 1 | The list of files' version. |

---

## 5. Signalling Layer

This section and those up to [§18](#18-error-model) are how today's direct transfers work: version 3's messages on PeerJS, with DTLS alone. Dropgate 4's rendezvous and engine replace them, running every transfer over the secure channel ([§1.1](#11-whats-built-now)).

### 5.1 Architecture

Today's direct transfers use PeerJS as their signalling layer. The Dropgate Server mounts an ExpressPeerServer at the fixed path `/peerjs`. The signalling server handles:

- Peer registration and discovery.
- ICE candidate relay.
- SDP offer/answer exchange.
- Connection state notifications.

### 5.2 ICE Configuration

The server advertises ICE server configuration via the `/api/info` endpoint:

```json
{
  "capabilities": {
    "p2p": {
      "enabled": true,
      "iceServers": [
        { "urls": ["stun:stun.cloudflare.com:3478"] }
      ],
      "codeLetters": 2,
      "credentialRequired": false
    }
  }
}
```

- **Default STUN server:** `stun:stun.cloudflare.com:3478`.
- **Custom STUN servers:** configurable via the `P2P_STUN_SERVERS` environment variable (comma- or space-separated list of `stun:` or `stuns:` addresses). Set to `none`, the server offers no ICE servers at all (`"iceServers": []`).
- **PeerJS's path** isn't given any more: today's direct transfers find PeerJS at its fixed path, `/peerjs`.

### 5.3 Signalling Data Visible to the Server

The signalling server observes but does **not persist**:

| Data | Purpose |
|------|---------|
| Peer IDs (P2P codes) | Peer registration and routing. |
| ICE candidates | NAT traversal — includes IP addresses and ports of both peers. |
| SDP offers/answers | WebRTC capability negotiation — includes media/transport parameters. |
| Connection lifecycle events | Connect, disconnect, error. |

An honest server has **no visibility** into data channel content once the WebRTC connection is established. The SDP it relays includes each peer's DTLS certificate fingerprint, which is what authenticates the encrypted connection, so a malicious or compromised server could substitute its own and intercept the transfer. See [§19.1](#191-transport-encryption).

### 5.4 Secure Context Requirement

The Dropgate Web UI only allows direct transfers in a secure context (HTTPS or `localhost`). This is Dropgate's own check, using the core library's `hosts.isSecureForDirect()` helper, not a browser restriction on WebRTC; the core library does not enforce it itself. The signalling server MUST be accessed over HTTPS in production. The `proxied: true` flag is set on the PeerJS server to indicate it operates behind a TLS-terminating reverse proxy.

---

## 6. Connection Establishment

### 6.1 Sender Setup

1. The sender creates a PeerJS peer using their generated P2P code as the peer ID.
2. The peer registers with the signalling server.
3. The sender enters the **listening** state and waits for incoming connections.

### 6.2 Receiver Setup

1. The receiver creates a PeerJS peer with an auto-generated ID (no code needed).
2. The receiver calls `peer.connect(code)` to initiate a data channel with the sender.

### 6.3 Connection Rate Limiting

The sender enforces a **sliding-window rate limit** on incoming connections:

- Maximum **10 connection attempts** per **10-second window**.
- Excess attempts are rejected with an error message.
- This prevents denial-of-service attacks via connection flooding.

### 6.4 Connection Replacement

If a new connection arrives while an existing one is present:

- If a transfer has already started (`transferEverStarted` flag), the new connection is rejected.
- If no transfer has started and the existing connection is closed or dead, the new connection is accepted.
- This prevents mid-transfer hijacking whilst allowing legitimate reconnection during the setup phase.

---

## 7. Handshake

Once the data channel is open, both peers exchange `hello` messages. The receiver sends its `hello` as soon as its channel opens. The sender waits for it before sending anything, then replies with its own.

The sender waits because its channel can open before the receiver's, and a message sent in that gap is sometimes never delivered (seen in Chromium). The receiver would then never get the sender's `hello`, and would ignore the file details that follow it. Chromium also sometimes reports the sender's data channel open twice, so the sender starts only once per connection.

### 7.1 Hello Message

```json
{
  "t": "hello",
  "protocolVersion": 4,
  "sessionId": "<uuid>"
}
```

### 7.2 Version Compatibility

`protocolVersion` is the DGDTP major. Protocol versions MUST match exactly. There is no backwards-compatibility negotiation, so a peer older than Dropgate 4 is refused. If a version mismatch is detected, the connection is terminated with an error:

```
Protocol version mismatch: sender v4, receiver v3
```

In the current implementation only the sender performs this check. The receiver sends its version but does not compare it with the sender's.

Before either peer starts, its client checks the server's `protocols.dgdtp` from `/api/info` ([DGUP §3.3](./DGUP.md#33-compatibility)): a server whose major differs, or that gives none, is not used for direct transfers.

### 7.3 Timeout

The handshake MUST complete within **10 seconds**. If the `hello` is not received within this window, the connection is closed.

---

## 8. Metadata Exchange

### 8.1 Multi-File List (v3)

For transfers involving multiple files, the sender transmits a file list immediately after the handshake:

```json
{
  "t": "file_list",
  "fileCount": 3,
  "files": [
    { "name": "document.pdf", "size": 1048576, "mime": "application/pdf" },
    { "name": "photo.jpg", "size": 2097152, "mime": "image/jpeg" },
    { "name": "notes.txt", "size": 512, "mime": "text/plain" }
  ],
  "totalSize": 3146240
}
```

**Validation (receiver-side):**

- `fileCount` MUST NOT exceed **10,000**.
- `totalSize` MUST equal the sum of all individual file sizes.
- Every `name` MUST follow the file name rule DGUP shares: not empty, at most 255 bytes in UTF-8, and no control character, `/` or `\`. A `meta` message's `name` is checked the same way, and the sender checks its names before sending. A name that breaks it ends the transfer with `INVALID_FILENAME`. The receiver saves a file under a name sanitised for every OS ([File Names](../core/quick-start.md#file-names)).

### 8.2 File Metadata

Before each file's chunks, the sender transmits a `meta` message:

```json
{
  "t": "meta",
  "sessionId": "<uuid>",
  "name": "document.pdf",
  "size": 1048576,
  "mime": "application/pdf",
  "fileIndex": 0
}
```

- `fileIndex` is present only in multi-file transfers (v3).
- The `sessionId` is used for session hijacking prevention (see [§19.2](#192-session-id-tracking)).

### 8.3 Ready Signal

The receiver sends a `ready` message to indicate it is prepared to accept chunks:

```json
{
  "t": "ready"
}
```

- In **auto-ready mode** (default), the `ready` signal is sent automatically upon receiving the first `meta`.
- In **manual-ready mode**, the receiver can inspect the metadata (preview) before deciding whether to accept. The consumer calls a provided `sendReady()` function to proceed.

---

## 9. Data Transfer

### 9.1 Chunk Size

The default DGDTP chunk size is **65,536 bytes** (64 KiB). This is deliberately smaller than DGUP's 5 MiB chunks because:

- Smaller chunks reduce end-to-end latency.
- They enable finer-grained flow control over a real-time data channel.

The data channel is reliable, so lost packets are retransmitted by the transport (SCTP) regardless of chunk size. DGDTP itself never re-sends a chunk.

### 9.2 Chunk Message

Each chunk is sent as two consecutive data channel messages:

**1. Header (JSON):**

```json
{
  "t": "chunk",
  "seq": 0,
  "offset": 0,
  "size": 65536,
  "total": 1048576
}
```

**2. Payload (ArrayBuffer):**

The raw binary data for this chunk.

### 9.3 Chunk Acknowledgement

The receiver sends an acknowledgement after processing each chunk:

```json
{
  "t": "chunk_ack",
  "seq": 0,
  "received": 65536
}
```

- `seq` echoes the sequence number of the acknowledged chunk.
- `received` indicates cumulative bytes received for the current transfer.

### 9.4 Sequence Enforcement

The receiver enforces strict sequential ordering. If a chunk arrives out of order:

```
Chunk sequence error: expected 5, got 7
```

The connection is terminated. WebRTC data channels configured in reliable mode guarantee ordering, so out-of-order delivery indicates a protocol violation.

### 9.5 Size Validation

- The payload size MUST match the declared `size` field.
- The cumulative received bytes MUST NOT exceed the declared `total`.

Violations result in immediate connection termination.

---

## 10. Flow Control

DGDTP implements multi-layered flow control to prevent fast senders from overwhelming slow receivers.

### 10.1 Chunk Acknowledgement Back-pressure

| Parameter | Default |
|-----------|---------|
| Maximum unacknowledged chunks | 64 |
| Unacknowledged chunk timeout | 60,000 ms |

The sender maintains a map of unacknowledged chunks. When the number of unacknowledged chunks reaches the maximum, the sender pauses until acknowledgements are received. If no acknowledgement arrives within 60 seconds, the transfer is aborted.

### 10.2 Data Channel Buffer Monitoring

| Parameter | Default |
|-----------|---------|
| Buffer high water mark | 8 MiB |
| Buffer low water mark | 2 MiB |

The sender monitors the RTCDataChannel's `bufferedAmount` property. When `bufferedAmount` exceeds the high water mark, the sender waits for the `bufferedamountlow` event (with a 60 ms fallback timeout) before sending the next chunk. The `bufferedAmountLowThreshold` is set to the low water mark.

### 10.3 Write Queue Depth Limiting

The receiver enforces a maximum write queue depth of **100 entries**. If the queue exceeds this limit, the transfer is aborted with:

```
Write queue overflow — receiver cannot keep up
```

This prevents unbounded memory consumption when the receiver's storage I/O is slower than the network throughput.

---

## 11. Multi-File Transfers (v3)

Protocol version 3 introduced native multi-file transfer support.

### 11.1 Sequence

```
Sender                                      Receiver
  │                                           │
  │◄──────────────────────────────────────────│
  │                                     hello │
  │  hello                                    │
  │──────────────────────────────────────────►│
  │                                           │
  │  file_list                                │
  │──────────────────────────────────────────►│
  │                                           │
  │  meta (fileIndex: 0)                      │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                                     ready │
  │                                           │
  │  chunk [×N]                               │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                               chunk_ack[] │
  │                                           │
  │  file_end (fileIndex: 0)                  │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                   file_end_ack (index: 0) │
  │                                           │
  │  meta (fileIndex: 1)                      │
  │──────────────────────────────────────────►│
  │                                           │
  │  chunk [×M]                               │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                               chunk_ack[] │
  │                                           │
  │  file_end (fileIndex: 1)                  │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                   file_end_ack (index: 1) │
  │                                           │
  │  end                                      │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                                   end_ack │
  │                                           │
```

### 11.2 File End Signalling

```json
{ "t": "file_end", "fileIndex": 0, "attempt": 0 }
```

The sender signals that all chunks for the current file have been transmitted. The receiver flushes its write queue and responds:

```json
{ "t": "file_end_ack", "fileIndex": 0, "received": 1048576, "size": 1048576 }
```

Only after receiving the `file_end_ack` does the sender proceed to the next file.

### 11.3 Browser-Side ZIP Streaming

When a multi-file transfer is received in a browser, the Web UI creates a streaming ZIP archive. Each file's chunks are piped through the core library's streaming ZIP writer (`zip.writer()`) and ultimately saved as a single `.zip` download. Each file starts its member with the name and size from its `meta` message ([§8.2](#82-file-metadata)): the writer stores the name made safe, told apart from any other the same, and fails the transfer if the file's bytes don't come to that size. The archive is stored, not compressed, and uses ZIP64 only when it needs it (a file or the archive past 4 GiB, or 65,535 files or more), so a smaller one is the classic format every reader opens.

---

## 12. Transfer Completion

### 12.1 End Message

Once all files have been transferred, the sender transmits:

```json
{ "t": "end", "attempt": 0 }
```

### 12.2 End Acknowledgement

The receiver validates that all expected bytes have been received and responds:

```json
{ "t": "end_ack", "received": 3146240, "total": 3146240 }
```

### 12.3 Retry Logic

The `end` message is critical — if it is lost, the receiver will never know the transfer is complete. The sender therefore retries:

| Parameter | Default |
|-----------|---------|
| Maximum retries | 3 |
| Base timeout | 15,000 ms |
| Back-off multiplier | 1.5× |

- Attempt 0: wait 15 s.
- Attempt 1: wait 22.5 s.
- Attempt 2: wait 33.75 s.

The receiver sends multiple `end_ack` messages for reliability — an immediate response plus 2 additional retransmissions at **100 ms** intervals.

### 12.4 Validation

The sender validates: `end_ack.received >= total`. If the receiver reports fewer bytes than expected, the sender treats the transfer as failed.

### 12.5 Grace Period

After successful completion, both peers wait **2 seconds** before closing the connection. This grace period allows any in-flight acknowledgements to be processed.

---

## 13. Heartbeat and Watchdog

### 13.1 Heartbeat (Sender)

The sender emits periodic pings to prevent idle-timeout disconnections:

```json
{ "t": "ping", "timestamp": 1706200000000 }
```

The receiver auto-responds:

```json
{ "t": "pong", "timestamp": 1706200000000 }
```

| Parameter | Default |
|-----------|---------|
| Interval | 5,000 ms |

The heartbeat is active during the `transferring`, `finishing`, and `awaiting_ack` states. Setting the interval to 0 disables it.

### 13.2 Watchdog (Receiver)

The receiver runs a watchdog timer that detects stalled senders:

| Parameter | Default |
|-----------|---------|
| Timeout | 30,000 ms |

**Critically**, the watchdog resets **only on receipt of binary data** (actual file chunks), not on control messages such as `ping`. This prevents a malicious sender from keeping the connection alive with heartbeats alone whilst never delivering file data.

If the watchdog fires, the transfer is aborted.

---

## 14. Connection Health Monitoring

### 14.1 Health Event

Clients may optionally monitor connection health via periodic callbacks:

```json
{
  "iceConnectionState": "connected",
  "bufferedAmount": 65536,
  "lastActivityMs": 200
}
```

Health checks run every **2 seconds** and report:

- The ICE connection state.
- The data channel's buffered byte count.
- Milliseconds since last activity.

### 14.2 Uses

- Display connection quality indicators in the UI.
- Detect degrading connections before the watchdog fires.
- Monitor buffer build-up indicative of network congestion.

---

## 15. Cancellation

### 15.1 Sender Cancellation

The sender transmits:

```json
{ "t": "cancelled", "reason": "Sender cancelled the transfer." }
```

The session transitions to `cancelled` → `closed`. All timers are cleared and the connection is destroyed.

### 15.2 Receiver Cancellation

The receiver transmits:

```json
{ "t": "cancelled", "reason": "Receiver cancelled the transfer." }
```

Both peers receive an `onCancel` callback with:

```json
{ "cancelledBy": "sender" | "receiver", "message": "..." }
```

### 15.3 Browser Navigation

The Web UI registers a `beforeunload` handler to warn users before navigating away during an active transfer. Navigation triggers implicit cancellation.

### 15.4 Connection Loss

If the data channel closes during an active transfer without a `cancelled` message, the current implementation still reports it as a cancellation by the other peer: the receiver's `onCancel` fires with `cancelledBy: "sender"`, and the sender's with `cancelledBy: "receiver"`. This happens whatever the cause, including a network drop, a closed or crashed tab, or a device going to sleep.

So a "cancelled by the other peer" result means the transfer stopped. It does not prove the other person chose to cancel.

---

## 16. Resume Support

DGDTP reserves `resume` and `resume_ack` messages for continuing interrupted transfers, but **the current implementation does not support resuming**. Neither peer sends or handles these messages, and the `onResumeRequest` callback is never called. Once a transfer has started, the sender rejects new connections (see [§6.4](#64-connection-replacement)), so an interrupted transfer has to be started again.

The message formats below are kept for reference.

### 16.1 Resume Request (Receiver)

```json
{ "t": "resume", "sessionId": "<uuid>", "receivedBytes": 524288 }
```

### 16.2 Resume Acknowledgement (Sender)

```json
{ "t": "resume_ack", "resumeFromOffset": 524288, "accepted": true }
```

As designed, the sender would validate the resume request via an `onResumeRequest` callback returning a boolean and, if accepted, continue from the indicated byte offset. This is not implemented.

---

## 17. State Machines

### 17.1 Sender States

```
initializing ──► listening ──► handshaking ──► negotiating ──► transferring
                     │              │              │                │
                     ▼              ▼              ▼                ▼
                  closed         closed         closed          finishing
                  cancelled      cancelled      cancelled          │
                                                                   ▼
                                                             awaiting_ack
                                                                   │
                                                                   ▼
                                                              completed
                                                                   │
                                                                   ▼
                                                                closed
```

### 17.2 Receiver States

```
initializing ──► connecting ──► handshaking ──► negotiating ──► transferring
                      │              │              │                │
                      ▼              ▼              ▼                ▼
                   closed         closed         closed         completed
                   cancelled      cancelled      cancelled          │
                                                                    ▼
                                                                 closed
```

Invalid state transitions are logged as warnings but do not throw exceptions, preventing cascading failures during error recovery.

---

## 18. Error Model

### 18.1 Error Message

```json
{ "t": "error", "message": "Human-readable description", "code": "OPTIONAL_CODE" }
```

### 18.2 Error Propagation

When one peer encounters an error, it transmits an `error` message to the other peer before closing the connection. Both peers invoke their `onError` callbacks.

### 18.3 Error Codes

Core reports each error as a `DropgateError`, with one of these codes (the full list is in [core's docs](../core/errors.md)). A peer's own `message` isn't passed on: an `error` message from the other peer is reported as `PEER_FAILED`, with core's own wording.

| Code | Meaning |
|-------|---------|
| `INVALID_ARGUMENT` | No code, no files, or no PeerJS `Peer` given. |
| `INVALID_CODE` | The code isn't the shape of one. |
| `CAPABILITY_UNSUPPORTED` | Direct transfer is disabled on the server. |
| `INTEGRITY_FAILED` | Data before acceptance, an unexpected sequence number, or a size mismatch. |
| `INVALID_MANIFEST` | Too many files, or a file list whose sizes don't add up. |
| `CONNECTION_LOST` | The connection closed, acknowledgements stalled, or a confirmation never came. |
| `OUTPUT_WRITE_FAILED` | The receiver's write queue overflowed. |
| `TIMED_OUT` | The receiver didn't answer the handshake. |
| `VERSION_UNSUPPORTED` | The peers' protocol versions differ. |
| `PEER_FAILED` | The other peer sent an `error` message, or reported an incomplete transfer. |
| `SERVER_UNREACHABLE` | The PeerJS signalling server couldn't be reached. |

---

## 19. Security Considerations

These are today's direct transfers' ([§5](#5-signalling-layer) to [§18](#18-error-model)). What the secure channel protects, and what it doesn't, is in [§4.1](#41-what-it-protects-and-what-it-doesnt).

### 19.1 Transport Encryption

WebRTC data channels are encrypted via **DTLS** (Datagram Transport Layer Security). This is handled transparently by the browser's WebRTC implementation. All data in transit between peers — including DGDTP messages and file content — is encrypted.

Today's direct transfers add no encryption of their own to DTLS, and that has a consequence for what DTLS protects against. Each peer proves its identity during the DTLS handshake with a certificate whose fingerprint is sent to the other peer in the SDP. In DGDTP the SDP travels through the signalling server, and nothing else authenticates it: the P2P code is only used to find the sender.

- **Network observers** (including anyone relaying WebRTC packets) see only encrypted data.
- **An honest signalling server** relays the fingerprints unchanged and cannot read the transfer.
- **A malicious or compromised signalling server** can replace both fingerprints with its own, place itself between the peers and read or alter everything, including file names and contents. Neither peer can detect this.

In practice, today's direct transfers are only as confidential as the signalling server is trustworthy. For sensitive transfers, use a server you run or trust.

The secure channel closes this gap: its set-up messages are sealed, and both certificates' fingerprints are in its encrypted handshake, so a server that swaps them makes the handshake fail ([§4.6](#46-the-dtls-prologue)). Direct transfers run over it once Dropgate 4's rendezvous and engine are built.

### 19.2 Session ID Tracking

The `sessionId` from the initial `meta` message is stored by the receiver. Subsequent `meta` messages (in multi-file transfers) MUST carry the same `sessionId`. A mismatch indicates a possible session hijacking attempt and causes immediate termination.

### 19.3 Binary Data State Gating

The receiver only accepts binary data (file chunks) when in the `transferring` state. Binary data received in any other state is rejected.

This prevents pre-transfer data injection attacks.

### 19.4 Connection Rate Limiting

A sliding-window rate limit (10 attempts per 10 seconds) protects the sender from connection-flooding attacks.

### 19.5 Write Queue Depth Limiting

The receiver's write queue is capped at 100 entries. This prevents a malicious or buggy sender from causing unbounded memory allocation on the receiver.

### 19.6 Watchdog Data-Only Reset

The receiver's watchdog timer resets only on actual binary data, not on `ping`/`pong` messages. A sender cannot keep a connection alive indefinitely by sending heartbeats without delivering file data.

### 19.7 ICE Candidate Exposure

During WebRTC connection establishment, ICE candidates are exchanged via the signalling server. These candidates contain IP addresses and port numbers of both peers. In environments where IP privacy is critical:

- **Use a VPN** to mask real IP addresses. Select a VPN provider that supports peer-to-peer traffic so that the WebRTC data channel can be established through the VPN tunnel. Research providers carefully, paying attention to their logging policies, jurisdiction, and track record.
- Be aware that STUN servers receive requests from both peers' IP addresses during the ICE gathering phase.

### 19.8 Code Brute-Force Resistance

With ~3.3 billion possible codes and active codes existing only for the duration of a transfer, brute-force guessing is impractical under the connection rate limit (10 attempts per 10 seconds per sender). However, server operators SHOULD monitor for distributed scanning patterns.

The code is the only credential needed to connect, so treat a live code like a password:

- Anyone who connects with a valid code receives the file names and sizes as part of the preview (§8), before the receiver accepts anything.
- The receiver link carries the code in the URL path (`/p2p/<code>`), not in a fragment. It can therefore appear in reverse-proxy access logs and browser history.
- The Web UI's receive page connects to the sender as soon as the link is opened.

Over the secure channel, only a code's locator reaches the server, each code takes one try ([§4.3](#43-cpace-typed-codes)), and a link carries a secret of its own after its `#` ([§3.6](#36-links)).

---

## 20. Configuration Reference

### 20.1 Server Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_P2P` | `true` | Enable or disable DGDTP. |
| `P2P_STUN_SERVERS` | `stun:stun.cloudflare.com:3478` | `stun:` or `stuns:` addresses, each a host and an optional port, separated by commas or spaces; or `none`, for no ICE servers. Set to nothing, a `turn:` address or anything else, the server doesn't start. |
| `P2P_LOCATOR_LETTERS` | `2` | How many of a code's letters are the rendezvous's locator: `2` (576 codes at once) or `3` (13,824). |
| `P2P_MAX_CODES_PER_IP` | `5` | The most unused codes one address holds at once; `0` turns codes off. |
| `PEERJS_DEBUG` | — | Removed in Dropgate 4: set to anything, the server warns once at startup that it's ignored. |

### 20.2 Client Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `chunkSize` | 65,536 (64 KiB) | Size of each data chunk. |
| `maxAttempts` | 4 | Code registration retries. |
| `endAckTimeoutMs` | 15,000 | Base timeout for end acknowledgement. |
| `bufferHighWaterMark` | 8,388,608 (8 MiB) | Pause sending above this buffer level. |
| `bufferLowWaterMark` | 2,097,152 (2 MiB) | Resume sending below this buffer level. |
| `heartbeatIntervalMs` | 5,000 | Ping interval (0 = disabled). |
| `chunkAcknowledgments` | `true` | Enable chunk-level acks. |
| `maxUnackedChunks` | 64 | Back-pressure threshold. |
| `watchdogTimeoutMs` | 30,000 | Receiver stall detection timeout. |
| `autoReady` | `true` | Auto-accept transfers on metadata receipt. |

---

## 21. Protocol Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `P2P_PROTOCOL_VERSION` | 4 | The DGDTP major, as `@dropgate/core` gives it in `DropgateClient.protocols.dgdtp`. |
| `P2P_CHUNK_SIZE` | 65,536 | Default chunk size (bytes). |
| `P2P_MAX_UNACKED_CHUNKS` | 64 | Flow control threshold. |
| `P2P_END_ACK_TIMEOUT_MS` | 15,000 | End-ack base timeout. |
| `P2P_END_ACK_RETRIES` | 3 | End message retry count. |
| `P2P_END_ACK_RETRY_DELAY_MS` | 100 | Delay between redundant end-acks. |
| `P2P_CLOSE_GRACE_PERIOD_MS` | 2,000 | Delay before closing after completion. |
| `P2P_UNACKED_CHUNK_TIMEOUT_MS` | 60,000 | Stale ack detection. |
| `MAX_FILE_COUNT` | 10,000 | Maximum files in a multi-file transfer. |
| `MAX_CONNECTION_ATTEMPTS` | 10 | Connection rate limit. |
| `CONNECTION_RATE_WINDOW_MS` | 10,000 | Rate limit sliding window. |
| `MAX_WRITE_QUEUE_DEPTH` | 100 | Receiver memory protection. |

---

## 22. Message Type Reference

| Type | Direction | State(s) | Purpose |
|------|-----------|----------|---------|
| `hello` | Both | handshaking | Protocol version and session negotiation. |
| `file_list` | Sender → Receiver | handshaking | Multi-file manifest (v3). |
| `meta` | Sender → Receiver | negotiating | File name, size, MIME type. |
| `ready` | Receiver → Sender | negotiating | Acceptance signal. |
| `chunk` | Sender → Receiver | transferring | Chunk header (followed by binary). |
| `chunk_ack` | Receiver → Sender | transferring | Per-chunk acknowledgement. |
| `file_end` | Sender → Receiver | transferring | Current file complete (v3 multi-file). |
| `file_end_ack` | Receiver → Sender | transferring | Current file receipt confirmed (v3). |
| `end` | Sender → Receiver | finishing | All data transmitted. |
| `end_ack` | Receiver → Sender | awaiting_ack | Transfer verified complete. |
| `ping` | Sender → Receiver | transferring+ | Keepalive. |
| `pong` | Receiver → Sender | transferring+ | Keepalive response. |
| `error` | Both | Any | Error notification. |
| `cancelled` | Both | Any | Cancellation notification. |
| `resume` | Receiver → Sender | handshaking | Resume request (reserved, not implemented). |
| `resume_ack` | Sender → Receiver | handshaking | Resume response (reserved, not implemented). |

---

## 23. Best Practices

### 23.1 Server Deployment

- **Deploy the Dropgate Server/signalling server behind HTTPS.** The Web UI only enables direct transfers in a secure context (§5.4). The PeerJS server MUST be accessed via HTTPS (or `localhost` for development).
- **Treat the signalling server as trusted infrastructure.** Because it relays the DTLS fingerprints that secure each transfer (§19.1), whoever controls it could intercept transfers. For sensitive use, run your own.
- **Configure appropriate STUN servers.** The default Cloudflare STUN server is suitable for most deployments. For privacy-sensitive applications, consider self-hosting a STUN server or using a VPN to mask IP addresses.
- **Mind the reverse proxy's access log.** Every sender's code appears in the URL of the PeerJS WebSocket connection (`/peerjs/peerjs?key=peerjs&id=<code>&token=…`), even when the receiver types the code in. See [DATA-PROCESSING §9.2](./DATA-PROCESSING.md#92-reverse-proxies).
- **Monitor connection patterns.** Unusual rates of peer registrations or connection attempts may indicate scanning or abuse.

### 23.2 Client Behaviour

- **Keep chunk acknowledgements enabled.** Disabling them removes flow control and can cause buffer overflows on slow receivers.
- **Set appropriate buffer water marks.** The defaults (8 MiB high / 2 MiB low) are tuned for typical broadband connections. Constrained environments may benefit from lower values.
- **Implement `onConnectionHealth` monitoring** for user-facing applications. This allows early detection of degrading connections.
- **Respect the watchdog.** If the receiver's watchdog fires, the connection has genuinely stalled. Do not simply increase the timeout to mask underlying network problems.

### 23.3 Network Privacy

- **Use a VPN for sensitive P2P transfers.** ICE candidates expose real IP addresses to the signalling server and (briefly) to the peer. A VPN that supports peer-to-peer traffic masks the sender's and receiver's true network locations. Research VPN providers carefully — audit their logging policies, jurisdiction, and technical architecture before relying on them for privacy-critical transfers.
- **Be aware of STUN server visibility.** STUN servers receive ICE binding requests containing the peer's IP address. Self-hosted STUN servers eliminate third-party visibility.
- **Consider network topology.** In corporate or institutional environments, WebRTC traffic may be blocked or inspected.

---

## 24. Single-File Transfer Flow Summary

```
Sender                                      Receiver
  │                                           │
  │  [PeerJS signalling: SDP + ICE]           │
  │◄═════════════════════════════════════════►│
  │                                           │
  │◄──────────────────────────────────────────│
  │  hello { v4, sessionId }                  │
  │                                           │
  │  hello { v4, sessionId }                  │
  │──────────────────────────────────────────►│
  │                                           │
  │  meta { name, size, mime }                │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │  ready                                    │
  │                                           │
  │  chunk { seq:0 } + [binary]               │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │  chunk_ack { seq:0, received }            │
  │                                           │
  │  ...repeated for all chunks...            │
  │                                           │
  │  end { attempt:0 }                        │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │  end_ack { received, total }              │
  │                                           │
  │  [2s grace period]                        │
  │  [connection closed]                      │
```
