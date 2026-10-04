import { describe, it, expect } from 'vitest';
import { CancelScope } from '../src/cancel.js';
import type { Cancellation } from '../src/cancel.js';
import { settle } from '../src/outcome.js';
import type { Outcome } from '../src/outcome.js';
import { DropgateError } from '../src/errors.js';

// The cancellation tree, and the one outcome each operation settles with.

/** Work that runs until its signal aborts, then fails the way a fetch does. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/** A client, two operations under it, and steps under those. */
function tree() {
  const client = new CancelScope('client');
  const upload = client.child('upload');
  const download = client.child('download');
  const steps = [upload.child('file'), upload.child('file'), download.child('stream')];
  return { client, upload, download, steps, all: [upload, download, ...steps] };
}

describe('CancelScope', () => {
  it('cancelling a node reaches every node under it, once each, and says who cancelled', () => {
    const { client, all } = tree();
    const heard = new Map<CancelScope, Cancellation[]>(all.map((node) => [node, []]));
    for (const node of all) node.onCancel((cancellation) => heard.get(node)!.push(cancellation));

    expect(client.cancel()).toBe(true);
    expect(client.cancel(), 'a second cancel does nothing').toBe(false);

    for (const node of all) {
      expect(heard.get(node), node.label).toEqual([{ by: 'parent', source: 'client' }]);
      expect(node.cancellation).toEqual({ by: 'parent', source: 'client' });
      expect(node.signal.aborted).toBe(true);
      expect(DropgateError.is(node.signal.reason, 'OPERATION_CANCELLED')).toBe(true);
      expect((node.signal.reason as DropgateError).details).toEqual({ cancellation: { by: 'parent', source: 'client' } });
    }
    expect(client.cancellation).toEqual({ by: 'self', source: 'client' });
  });

  it('cancelling a node reaches nothing above it or beside it', () => {
    const { client, upload, download, steps } = tree();
    upload.cancel();

    expect(upload.cancellation).toEqual({ by: 'self', source: 'upload' });
    expect(steps[0].cancellation).toEqual({ by: 'parent', source: 'upload' });
    expect(steps[1].cancellation).toEqual({ by: 'parent', source: 'upload' });
    expect(client.cancellation).toBeNull();
    expect(download.cancellation).toBeNull();
    expect(steps[2].cancellation).toBeNull();

    // A later cancel above still reaches the rest, and doesn't change the first one.
    client.cancel();
    expect(download.cancellation).toEqual({ by: 'parent', source: 'client' });
    expect(upload.cancellation).toEqual({ by: 'self', source: 'upload' });
  });

  it('starts a node under a cancelled one already cancelled', () => {
    const client = new CancelScope('client');
    client.cancel();
    const late = client.child('upload');
    expect(late.cancellation).toEqual({ by: 'parent', source: 'client' });
    expect(late.signal.aborted).toBe(true);
  });

  it('counts an AbortSignal passed in as a cancel by signal, aborted before or after', () => {
    const before = new AbortController();
    before.abort();
    expect(new CancelScope('download', { signal: before.signal }).cancellation).toEqual({ by: 'signal', source: 'download' });

    const after = new AbortController();
    const client = new CancelScope('client');
    const download = new CancelScope('download', { parent: client, signal: after.signal });
    const stream = download.child('stream');
    after.abort();
    expect(download.cancellation).toEqual({ by: 'signal', source: 'download' });
    expect(stream.cancellation).toEqual({ by: 'parent', source: 'download' });
    expect(client.cancellation).toBeNull();
  });

  it('a finished node leaves the tree: a later cancel above doesn\'t reach it, and its own does nothing', () => {
    const { client, upload } = tree();
    let heard = 0;
    upload.onCancel(() => heard++);
    upload.finish();
    client.cancel();
    expect(upload.cancel()).toBe(false);
    expect(upload.cancellation).toBeNull();
    expect(heard).toBe(0);
  });

  it('runs a listener added after the cancel straight away, and keeps going past one that throws', () => {
    const node = new CancelScope('upload');
    const order: string[] = [];
    node.onCancel(() => { throw new Error('a listener\'s own problem'); });
    node.onCancel(() => order.push('second'));
    node.cancel();
    node.onCancel(() => order.push('late'));
    expect(order).toEqual(['second', 'late']);
    expect(() => node.throwIfCancelled()).toThrow(DropgateError);
  });
});

describe('settle', () => {
  it('gives completed with the value the work returns', async () => {
    const node = new CancelScope('upload');
    expect(await settle(node, async () => 'link')).toEqual({ status: 'completed', value: 'link' });
  });

  it('gives failed with a DropgateError, typing any other error as UNEXPECTED_ERROR', async () => {
    const typed = new DropgateError({ code: 'NOT_FOUND' });
    expect(await settle(new CancelScope('download'), async () => { throw typed; })).toEqual({ status: 'failed', error: typed });

    const outcome = await settle(new CancelScope('download'), async () => { throw new RangeError('oops'); });
    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.error.code).toBe('UNEXPECTED_ERROR');
  });

  it('gives cancelled, with who cancelled, however work that was cancelled ends', async () => {
    const node = new CancelScope('upload');
    const outcome = settle(node, async () => {
      await untilAborted(node.signal).catch(() => {});
      // Ended by the cancel, but failing on the way out, like a request cut off part-way.
      throw new DropgateError({ code: 'CONNECTION_LOST' });
    });
    node.cancel();
    expect(await outcome).toEqual({ status: 'cancelled', cancellation: { by: 'self', source: 'upload' } });
  });

  it('gives completed when the work finished before a cancel could stop it', async () => {
    const node = new CancelScope('upload');
    const outcome = settle(node, async () => {
      node.cancel();
      return 'committed';
    });
    expect(await outcome).toEqual({ status: 'completed', value: 'committed' });
  });

  it('counts an abort of a signal the work used instead of its node as a cancel by signal', async () => {
    const node = new CancelScope('upload');
    const external = new AbortController();
    const outcome = settle(node, () => untilAborted(external.signal), external.signal);
    external.abort(new DOMException('Stop.', 'AbortError'));
    expect(await outcome).toEqual({ status: 'cancelled', cancellation: { by: 'signal', source: 'upload' } });
  });

  it('cancelling the parent gives every operation under it one cancelled outcome, and takes each out of the tree', async () => {
    const client = new CancelScope('client');
    const nodes = Array.from({ length: 5 }, (_, i) => client.child(i % 2 ? 'upload' : 'download'));
    const settledWith: Outcome<unknown>[][] = nodes.map(() => []);
    const outcomes = nodes.map((node, i) =>
      settle(node, async () => {
        // A step under the operation, cancelled through it.
        const step = node.child('request');
        await untilAborted(step.signal);
      }).then((outcome) => { settledWith[i].push(outcome); return outcome; }));

    client.cancel();
    await Promise.all(outcomes);
    for (const [i, node] of nodes.entries()) {
      expect(settledWith[i], `operation ${i}`).toEqual([{ status: 'cancelled', cancellation: { by: 'parent', source: 'client' } }]);
      expect(node.cancel(), `operation ${i} has left the tree`).toBe(false);
    }
  });
});
