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
 * The name a bundle's ZIP is saved under, for when it's saved, in local time:
 * "dropgate-bundle-20261010-143205.zip" (YYYYMMDD-HHMMSS), as the desktop app
 * names its own. It says nothing of the files, the upload or the code.
 */
export function bundleZipName(at = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  const date = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`;
  return `dropgate-bundle-${date}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}.zip`;
}

/**
 * A StreamSaver write stream that saves a file under `name`. StreamSaver's
 * download address would end with the name, and a browser can ask the server
 * for that address itself: Firefox does when its own Resume restarts a paused
 * download. So the address is a random one, with no name in it, and the name
 * reaches the browser only in the download's Content-Disposition header.
 */
export function saveStream(name, options = {}) {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  return window.streamSaver.createWriteStream(name, { ...options, pathname: random });
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

/**
 * A count with its word, as the desktop app says it (electron-kit's countOf):
 * "1 folder", "3 folders", "18,000 files".
 */
export function countOf(n, one) {
  const digits = String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${digits} ${n === 1 ? one : `${one}s`}`;
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
