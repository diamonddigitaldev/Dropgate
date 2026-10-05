# @dropgate/core Documentation

**@dropgate/core** is the universal client library for Dropgate. It implements the client side of the Dropgate protocols — [DGUP (Dropgate Upload Protocol)](../technical/DGUP.md) for hosted uploads and [DGDTP (Dropgate Direct Transfer Protocol)](../technical/DGDTP.md) for peer-to-peer transfers — and provides all the core functionality for:

- Uploading files to Dropgate servers (with optional E2EE)
- Downloading files from Dropgate servers
- Direct peer-to-peer file transfers (P2P)
- Server capability detection and version checking
- Utility functions for lifetime conversions, base64 encoding, and more

This package is **headless** and **environment-agnostic** — it contains no DOM manipulation, no browser-specific APIs, and no Node.js-specific code. All environment-specific concerns (loading PeerJS, handling file streams, etc.) are handled by the consumer.


## Contents

* [Quick Start](quick-start.md): configuring a client, connecting, uploading (and file sources), downloading, metadata, and P2P transfers.
* [API Reference](api-reference.md): the client's options, properties and methods, the upload handle, file sources, and every exported function, constant and class.
* [Outcomes and Cancellation](outcomes.md): how an upload or a download ends, and the cancellation tree that cancels it.
* [Errors](errors.md): the one error class, and the codes it carries.
* [Browser Usage](browser-usage.md): loading core with a `<script>` tag or as an ES module.
* [P2P Consumer Responsibilities](p2p.md): what your code has to do for P2P transfers, and the behaviour to account for.
* [Building and Testing](building-and-testing.md): building core, its tests, the copies the server and the client load, and how it's released.


## Installation

```bash
npm install @dropgate/core
```


## Builds

The package ships with multiple build targets:

| Format | File | Use Case |
| --- | --- | --- |
| ESM | `dist/index.js` | Modern bundlers, Node.js 24+ |
| CJS | `dist/index.cjs` | CommonJS consumers, Node.js 24+ |
| Browser IIFE | `dist/index.browser.js` | `<script>` tag, exposes `DropgateCore` global |


## About These Docs

[Core's README](../../packages/dropgate-core/README.md), the page npm shows, is kept short, and links here and nowhere else in these docs. npm shows the README a version was published with, so a change to it only reaches npm with the next release. These docs are read from the repository's `master` branch, which only holds released code, so a correction here reaches readers straight away.

Keep it that way: the README links only to this page, with its full address on `master`, and this page lists every page of the docs. The [docs checks](../../tests/docs/README.md) fail otherwise.
