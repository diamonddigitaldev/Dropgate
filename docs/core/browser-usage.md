# Browser Usage

For browser environments, you can use the IIFE bundle:

```html
<script src="/path/to/dropgate-core.browser.js"></script>
<script>
  const { DropgateClient } = DropgateCore;
  const client = new DropgateClient({ server: location.origin });
  // ...
</script>
```

Or as an ES module:

```html
<script type="module">
  import { DropgateClient } from '/path/to/dropgate-core.js';
  const client = new DropgateClient({ server: location.origin });
  // ...
</script>
```

A page served over plain HTTP from another machine (such as `http://192.168.1.10`) isn't a secure context: browsers give it no Web Crypto, so nothing can be encrypted there, and its connection to the server isn't secure either. Core refuses such a server unless the client is made with `allowInsecure: true` ([Insecure Servers](api-reference.md#insecure-servers)). `http://localhost`, `http://127.0.0.1` and `http://[::1]` are secure contexts, and need no opt-in.
