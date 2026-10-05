import { Zip, ZipPassThrough } from 'fflate';

/**
 * Streaming ZIP writer that assembles files into a ZIP archive on the fly.
 * Uses fflate's store mode (no compression) for maximum speed and minimal memory usage.
 * Works in both Node.js and browser environments.
 *
 * The archive's bytes go to `onData` in order, one call at a time. Await
 * `drained()` after writing to wait for them, so a slow consumer slows the
 * writer down instead of the bytes piling up in memory. Once `onData` fails,
 * nothing more is given to it, and `drained()` and `finalize()` throw its error.
 */
export class StreamingZipWriter {
  private zip: InstanceType<typeof Zip>;
  private currentFile: InstanceType<typeof ZipPassThrough> | null = null;
  private onData: (chunk: Uint8Array) => void | Promise<void>;
  private finalized = false;
  private pendingWrites: Promise<void> = Promise.resolve();
  private failed: { error: unknown } | null = null;

  constructor(onData: (chunk: Uint8Array) => void | Promise<void>) {
    this.onData = onData;
    this.zip = new Zip((err, data) => {
      if (err) {
        this.failed ??= { error: err };
        return;
      }
      // Queue data delivery to handle async consumers
      this.pendingWrites = this.pendingWrites
        .then(() => (this.failed ? undefined : this.onData(data)))
        .catch((error: unknown) => { this.failed ??= { error }; });
    });
  }

  /**
   * Begin a new file entry in the ZIP.
   * Must call endFile() before starting another file.
   * @param name - Filename within the ZIP archive.
   */
  startFile(name: string): void {
    if (this.currentFile) {
      throw new Error('Must call endFile() before starting a new file.');
    }
    if (this.finalized) {
      throw new Error('ZIP has already been finalized.');
    }
    const entry = new ZipPassThrough(name);
    this.zip.add(entry);
    this.currentFile = entry;
  }

  /**
   * Write a chunk of data to the current file entry.
   * @param data - The data chunk to write.
   */
  writeChunk(data: Uint8Array): void {
    if (!this.currentFile) {
      throw new Error('No file started. Call startFile() first.');
    }
    this.currentFile.push(data, false);
  }

  /**
   * End the current file entry.
   */
  endFile(): void {
    if (!this.currentFile) {
      throw new Error('No file to end.');
    }
    this.currentFile.push(new Uint8Array(0), true);
    this.currentFile = null;
  }

  /** Waits until `onData` has taken everything written so far. Throws its error if it failed. */
  async drained(): Promise<void> {
    await this.pendingWrites;
    if (this.failed) throw this.failed.error;
  }

  /**
   * Finalize the ZIP archive. Must be called after all files are written.
   * Waits for all pending async writes to complete before resolving.
   */
  async finalize(): Promise<void> {
    if (this.currentFile) {
      throw new Error('Cannot finalize with an open file. Call endFile() first.');
    }
    if (!this.finalized) {
      this.finalized = true;
      this.zip.end();
    }
    await this.drained();
  }
}
