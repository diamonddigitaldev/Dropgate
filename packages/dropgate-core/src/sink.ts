import { DropgateError, toDropgateError } from './errors.js';

/**
 * Where a download's bytes go. Core awaits each `write()` before it reads
 * more, and `close()` once every byte is written; a download only completes
 * once `close()` has. If either fails, the download fails with
 * OUTPUT_WRITE_FAILED. If the download fails or is cancelled, core calls
 * `abort()`, if there is one, and never `close()`, so a partial file isn't
 * finished as if it were whole.
 *
 * A `WritableStream`'s writer is one (`stream.getWriter()`), and so is a
 * Node.js `FileHandle` opened for writing.
 */
export interface DownloadSink {
  /** Writes the next bytes. */
  write(chunk: Uint8Array): unknown;
  /** Finishes the output once every byte is written. */
  close(): unknown;
  /** Throws away what was written, when the download won't complete. */
  abort?(reason?: unknown): unknown;
}

/** One file of a download, as a function giving its sink is told it. */
export interface DownloadFileInfo {
  /** The file's name, decrypted if it was encrypted. */
  name: string;
  /** The file's size in bytes, as it will be written. */
  size: number;
  /** Which file of the download it is (0-based). */
  index: number;
}

/** A sink, or a function giving one for each file as its download starts. */
export type DownloadSinkOption = DownloadSink | ((file: DownloadFileInfo) => DownloadSink | Promise<DownloadSink>);

/** Whether `value` has a sink's `write()` and `close()`. */
export function isDownloadSink(value: unknown): value is DownloadSink {
  return typeof value === 'object' && value !== null
    && typeof (value as DownloadSink).write === 'function'
    && typeof (value as DownloadSink).close === 'function';
}

/** A sink core writes to, failing OUTPUT_WRITE_FAILED as the caller's sink fails. */
export class SinkWriter {
  private done = false;

  constructor(private readonly sink: DownloadSink) {}

  /** Gets the sink for one file from a function giving one, or fails OUTPUT_WRITE_FAILED. */
  static async open(option: DownloadSinkOption, file: DownloadFileInfo): Promise<SinkWriter> {
    let sink: unknown;
    try {
      sink = typeof option === 'function' ? await option(file) : option;
    } catch (err) {
      throw new DropgateError({ code: 'OUTPUT_WRITE_FAILED', cause: err });
    }
    if (!isDownloadSink(sink)) {
      throw new DropgateError({ code: 'OUTPUT_WRITE_FAILED', message: 'The function giving a sink gave something without write() and close().' });
    }
    return new SinkWriter(sink);
  }

  async write(chunk: Uint8Array): Promise<void> {
    try {
      await this.sink.write(chunk);
    } catch (err) {
      throw toDropgateError(err, 'OUTPUT_WRITE_FAILED');
    }
  }

  async close(): Promise<void> {
    this.done = true;
    try {
      await this.sink.close();
    } catch (err) {
      throw toDropgateError(err, 'OUTPUT_WRITE_FAILED');
    }
  }

  /** Aborts the sink, once, if it wasn't closed. Best effort: an abort that fails is ignored. */
  async abort(reason: unknown): Promise<void> {
    if (this.done) return;
    this.done = true;
    try {
      await this.sink.abort?.(reason);
    } catch { /* The download has already failed or been cancelled. */ }
  }
}
