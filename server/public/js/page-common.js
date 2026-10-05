import { DropgateClient } from './dropgate-core.js';

/**
 * A client for the server this page came from. A page served over plain HTTP
 * from another machine came over a connection that isn't secure, as everything
 * it sends will: the operator chose to serve it that way, and whoever opened it
 * typed or followed an http:// address. So its own server is allowed as it is,
 * and nothing else ever is: there's no other server, and no fallback.
 */
export function pageClient() {
  return new DropgateClient({ server: location.origin, allowInsecure: location.protocol === 'http:' });
}

(async () => {
  try {
    const client = pageClient();
    const serverInfo = await client.server.info({ timeoutMs: 5000 });
    const v = serverInfo?.version ? `v${serverInfo.version}` : '';

    const el1 = document.getElementById('serverVersion');
    if (el1) el1.textContent = v;

    const el2 = document.getElementById('server-version');
    if (el2) el2.textContent = v;
  } catch {
    // ignore
  }
})();
