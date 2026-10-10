/**
 * Body for an `it.fails` test that only counts the failure it names.
 *
 * `it.fails` passes on any error, so a broken test double or a renamed API
 * would look just like the known issue. This wrapper rethrows only an error
 * whose message matches `match`, like `expectFailure.match` in the server
 * suite. Any other error is logged and swallowed, so `it.fails` reports the
 * test as failed. It fails the same way once the issue is fixed: then remove
 * `.fails` and this wrapper.
 */
export function onlyFailsWith(match: RegExp, body: () => unknown): () => Promise<void> {
  return async () => {
    try {
      await body();
    } catch (err) {
      if (err instanceof Error && match.test(err.message)) throw err;
      console.error(`Failed, but not with ${match}:`, err);
    }
  };
}

/** Waits for every pending promise callback to run. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
