# Browser Usage

For browser environments, you can use the IIFE bundle, `dist/index.browser.js` in the package, which defines the global `DropgateCore`:

```html
<script src="/path/to/index.browser.js"></script>
<script>
  const { DropgateClient } = DropgateCore;
  const client = new DropgateClient({ server: location.origin });
  // ...
</script>
```

Or as an ES module, `dist/index.js` (the Dropgate Server's Web UI serves this one as `/js/dropgate-core.js`):

```html
<script type="module">
  import { DropgateClient } from '/path/to/index.js';
  const client = new DropgateClient({ server: location.origin });
  // ...
</script>
```

A page served over plain HTTP from another machine (such as `http://192.168.1.10`) isn't a secure context: browsers give it no Web Crypto, so nothing can be encrypted there, and its connection to the server isn't secure either. Core refuses such a server unless the client is made with `allowInsecure: true` ([Insecure Servers](api-reference.md#insecure-servers)). `http://localhost`, `http://127.0.0.1` and `http://[::1]` are secure contexts, and need no opt-in.
