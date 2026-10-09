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

/**
 * A size in bytes, short, as the desktop app shows it (electron-kit's
 * formatBytes): "512 B", "1.5 KB", "12 MB". In 1024s, as the server's limits
 * and core count, labelled KB, MB, GB and TB; one decimal below 10. A size
 * that isn't known is "0 B".
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  // Rounding up to 1024 of a unit reads as the next one.
  if (Math.round(value) >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
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
