# Browser Usage

For browser environments, you can use the IIFE bundle:

```html
<script src="/path/to/dropgate-core.browser.js"></script>
<script>
  const { DropgateClient } = DropgateCore;
  const client = new DropgateClient({ clientVersion: '3.0.13', server: location.origin });
  // ...
</script>
```

Or as an ES module:

```html
<script type="module">
  import { DropgateClient } from '/path/to/dropgate-core.js';
  const client = new DropgateClient({ clientVersion: '3.0.13', server: location.origin });
  // ...
</script>
```
