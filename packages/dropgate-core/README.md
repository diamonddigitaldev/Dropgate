<div align="center">
   <img alt="Dropgate Logo" src="https://github.com/diamonddigitaldev/Dropgate/blob/master/packages/dropgate-core/dropgate.png?raw=true" style="width:100px;height:auto;margin-bottom:1rem;" />

   # @dropgate/core

   <p style="margin-bottom:1rem;">A headless, environment-agnostic TypeScript library for Dropgate file sharing operations.</p>
</div>

<div align="center">

![license](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)
![version](https://img.shields.io/badge/version-3.0.13-brightgreen?style=flat-square)
![typescript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat-square)

[![discord](https://img.shields.io/discord/667479986214666272?logo=discord&logoColor=white&style=flat-square)](https://diamonddigital.dev/discord)
[![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee&logoColor=000000&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>


## Overview

**@dropgate/core** is the client library for Dropgate, the self-hosted file sharing app. It uploads files to a Dropgate server and downloads them, with optional end-to-end encryption, and sends files directly from one device to another. The Dropgate Server's Web UI and the Dropgate Client both run on it.

It's **headless**: it has no UI and touches no DOM, and your code decides where received files go.


## Installation

```bash
npm install @dropgate/core
```


## Example

Upload a file, encrypted, and get its link:

```javascript
import { DropgateClient } from '@dropgate/core';

const client = new DropgateClient({ clientVersion: '3.0.13', server: 'https://files.example.com' });

const session = await client.uploadFiles({ files: myFile, lifetimeMs: 60 * 60 * 1000, encrypt: true });
const { downloadUrl } = await session.result;
```


## Supported Runtimes

* **Node.js 24** or later, as an ES module or CommonJS.
* **Browsers**, through a bundler, as an ES module, or with a `<script>` tag. Encryption uses the Web Crypto API, which browsers only give pages served over HTTPS or from `localhost`.


## Documentation

The full documentation, with the Quick Start, the API reference and the error codes, is in the repository: start at [the docs' contents](https://github.com/diamonddigitaldev/Dropgate/blob/master/docs/core/README.md).


## License

Licensed under the **Apache-2.0 License**.
See the [LICENSE](https://github.com/diamonddigitaldev/Dropgate/blob/master/packages/dropgate-core/LICENSE) file for details.


## Acknowledgements

* Logo designed by [TheFuturisticIdiot](https://github.com/TheFuturisticIdiot)
* Built with [TypeScript](https://www.typescriptlang.org/)
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
