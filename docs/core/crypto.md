# Crypto

Every encryption, decryption, key, hash and random number core uses goes through one internal crypto provider. There are two, and core chooses one for the runtime it's in. Neither is part of core's API: nothing here changes how you call core.


## Which Provider Core Uses

* **Web Crypto,** the browser's or Node's own `crypto.subtle`, wherever it can make an X25519 key. That's every supported browser on a secure page (HTTPS, or `localhost`), Node.js 24 and the Dropgate Client.
* **The JavaScript provider,** on [`@noble`](https://paulmillr.com/noble/), everywhere else: a page with no `crypto.subtle` at all (one served over plain HTTP from another machine), or one whose Web Crypto has no X25519.

Core chooses once per runtime, the first time it needs to: it tries to make an X25519 key with `crypto.subtle`, and takes Web Crypto if that works. The chosen provider then does every operation, with one exception: a direct transfer's out-of-band close, below. Random numbers always come from `crypto.getRandomValues()`, with either provider, and core refuses to run without it. It never falls back to `Math.random()`.

WebKit's Linux builds (measured in Playwright's WebKit 26.6 on Ubuntu 24.04 and 26.04) refuse any X25519 private key whose first byte is zero, so about one X25519 key in 256 fails to be made there, with an `OperationError`, although nothing was wrong with the request. So whenever core makes an X25519 key with Web Crypto, the probe's included, it asks again after an `OperationError`, up to three times in all. Each try is a fresh random key, and a refused one gave nothing. Any other refusal, such as an engine with no X25519 at all, counts at once.

Both providers give exactly the same bytes for every input. Core's tests run both on the same published known answers (FIPS 180-4, RFC 4231, RFC 5869, RFC 7748, the GCM specification's test cases, NIST's and [Project Wycheproof](https://github.com/C2SP/wycheproof)'s AES-256-GCM tests, CPace's own vectors, and cacophony's Noise vector), on random inputs, and on DGUP 4's object vectors. An upload encrypted on one opens on the other. The integration tests also run them in Chromium, Firefox and WebKit, on the provider core chooses in each and on `@noble` in all three ([Building and Testing](building-and-testing.md)).

With either provider, keys stay inside it. Printed, logged or serialised, a key shows only its label, such as `[ContentKey]`, and a key derived from another can't be exported, nor can the keys of Noise, the encrypted handshake and records a direct transfer runs over its connection.

The Elligator 2 map that CPace (the exchange a typed code runs) needs is `@noble/curves`' with both providers, because Web Crypto has none.

**The out-of-band close.** When a direct transfer ends, each device also sends its CLOSE sealed through the server, and an app that's closing has to get that out before it's gone. A page being closed may never see a Web Crypto promise settle (Firefox and WebKit tear it down first), so that one seal is synchronous: `@noble/ciphers`' AES-256-GCM, whichever provider is chosen ([`sync-aes-gcm.ts`](../../packages/dropgate-core/src/crypto/sync-aes-gcm.ts)). Its two keys are made by the chosen provider as bytes, held only by the connection's close channel, and overwritten once used or when the connection goes; its bytes are exactly Web Crypto's, which DGDTP's signal vectors hold ([DGDTP §4.8](../technical/DGDTP.md#48-bind-and-the-out-of-band-close)).

**A stated limit:** Web Crypto runs natively and in constant time. `@noble` is written to run in constant time too, but JavaScript's compiler and its big-integer arithmetic make no such promise, so the JavaScript provider, the Elligator 2 map everywhere and the out-of-band close's seal may leak timing to code running on the same device.


## The `@noble` Packages and Their Audits

`@noble/curves`, `@noble/hashes` and `@noble/ciphers` are compiled into every one of core's builds from an exact version, so core's npm package has no runtime dependencies and an app's own dependencies can't change the version core runs. Core uses `@noble/curves` for X25519 and the Elligator 2 map, `@noble/ciphers` for AES-256-GCM (in every runtime for a direct transfer's out-of-band close), and `@noble/hashes` for SHA-256, SHA-512, HMAC and HKDF.

| Package | Version | Audits | Checked |
| --- | --- | --- | --- |
| `@noble/curves` | 2.4.0 | Trail of Bits, August 2026, of version 2.3.0, everything in the package (no report linked from the package yet). Cure53, September 2024, of version 1.6.0: ed25519, ed448, their add-ons, bls12-381, bn254, hash-to-curve and the low-level `bls`, `tower`, `edwards` and `montgomery` modules ([report](https://cure53.de/audit-report_noble-crypto-libs.pdf)). Earlier: Kudelski Security, September 2023, of version 1.2.0, and Trail of Bits, February 2023, of version 0.7.3, of modules core doesn't use. | 2026-11-07 |
| `@noble/hashes` | 2.4.0 | Cure53, January 2022, of version 1.0.0: everything but blake3, sha3-addons, sha1 and argon2 ([report](https://cure53.de/pentest-report_hashing-libs.pdf)). | 2026-11-07 |
| `@noble/ciphers` | 2.4.0 | Cure53, September 2024, of version 1.0.0: everything ([report](https://cure53.de/audit-report_noble-crypto-libs.pdf)). | 2026-11-07 |

Each audit is as the package's own README lists it on the date checked. The version core uses is newer than every audited one, so the changes since each audit haven't been audited independently.

When a dependency update moves one of these packages, its row here changes with it: the version, the audits as the package's README then lists them, and the date checked. Core's [`tests/build.test.ts`](../../packages/dropgate-core/tests/build.test.ts) fails if a version here isn't the one core's lockfile installs.


## Licences

All three packages are MIT-licensed. Every one of core's builds starts with their copyright lines and the MIT License's terms, so the copies the Dropgate Server's Web UI and the Dropgate Client load carry them too. Core's package includes each licence in full, in [`THIRD-PARTY-NOTICES.md`](../../packages/dropgate-core/THIRD-PARTY-NOTICES.md), and the Dropgate Client's Credits name them.
