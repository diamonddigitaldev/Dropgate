// CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320), as ZIP uses it.
// Eight tables, so the loop takes eight bytes a step ("slicing by 8"): a ZIP
// member of several GiB is checksummed at memory speed, not a byte at a time.

const TABLES = (() => {
  const tables = new Int32Array(256 * 8);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tables[n] = c;
  }
  for (let n = 0; n < 256; n++) {
    let c = tables[n];
    for (let t = 1; t < 8; t++) {
      c = tables[c & 0xff] ^ (c >>> 8);
      tables[t * 256 + n] = c;
    }
  }
  return tables;
})();

const T0 = TABLES.subarray(0, 256);
const T1 = TABLES.subarray(256, 512);
const T2 = TABLES.subarray(512, 768);
const T3 = TABLES.subarray(768, 1024);
const T4 = TABLES.subarray(1024, 1280);
const T5 = TABLES.subarray(1280, 1536);
const T6 = TABLES.subarray(1536, 1792);
const T7 = TABLES.subarray(1792, 2048);

/**
 * The CRC-32 of `data` continued from `crc`, the CRC-32 of the bytes before
 * it (0 to start). Returns an unsigned 32-bit value.
 */
export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc;
  const n = data.length;
  let i = 0;
  for (const end = n - (n % 8); i < end; i += 8) {
    const lo = c ^ (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24));
    c = T7[lo & 0xff] ^ T6[(lo >>> 8) & 0xff] ^ T5[(lo >>> 16) & 0xff] ^ T4[lo >>> 24]
      ^ T3[data[i + 4]] ^ T2[data[i + 5]] ^ T1[data[i + 6]] ^ T0[data[i + 7]];
  }
  for (; i < n; i++) c = T0[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
