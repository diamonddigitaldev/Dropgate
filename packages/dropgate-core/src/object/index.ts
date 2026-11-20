// DGUP 4's object format: internal to core, for hosted uploads and downloads.
// Nothing here is exported from the package.

export {
  HEADER_BYTES, TAG_BYTES, MIN_CHUNK_SIZE, MAX_CHUNK_SIZE,
  ObjectLayout, padme, encryptedSize, paddedLength, isChunkSize,
} from './layout.js';
export type { ByteRange, Span, ChunkPart } from './layout.js';
export { parseHeader, headerFields, DGUP_VERSION, SUITE, SALT_BYTES } from './header.js';
export type { ObjectHeader } from './header.js';
export { deriveObjectKeys, SECRET_BYTES } from './keys.js';
export type { ObjectKeys } from './keys.js';
export { chunkNonce, ChunkSealer, ChunkOpener, openChunks } from './stream.js';
export {
  MAX_FILES, MIN_BUCKET, MAX_BUCKET, bucketFor, checkFiles, encodeManifest, decodeManifest, sealMeta, openMeta,
} from './manifest.js';
export type { ManifestFile } from './manifest.js';
export { createObject, openObject, ObjectWriter, OpenedObject } from './object.js';
export type { ObjectFile, CreateObjectOptions, OpenObjectOptions } from './object.js';
