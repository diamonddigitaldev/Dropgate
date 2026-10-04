import { DropgateError } from '../errors.js';

/**
 * Validate a plain (non-encrypted) filename.
 * Throws INVALID_FILENAME if it isn't.
 */
export function validatePlainFilename(filename: string): void {
  if (typeof filename !== 'string' || filename.trim().length === 0) {
    throw new DropgateError({ code: 'INVALID_FILENAME', message: 'Invalid filename. Must be a non-empty string.' });
  }

  if (filename.length > 255 || /[\/\\]/.test(filename)) {
    throw new DropgateError({ code: 'INVALID_FILENAME', message: 'Invalid filename. Contains illegal characters or is too long.' });
  }
}
