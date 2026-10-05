# Errors

Core has one error class, `DropgateError`. Every error it gives is one, with a `code` from the table below. Check the `code`, never the message: the codes are stable, so a code keeps its meaning, and a new situation gets a new code. `ERROR_CODES` lists them all, each with its default origin, retryable and message.

An upload or a download doesn't throw when it goes wrong: it ends with a `failed` [outcome](outcomes.md) that holds the error. The other calls, such as `client.server.connect()` and `client.hosted.metadata()`, throw it.

```javascript
import { DropgateError } from '@dropgate/core';

try {
  await client.server.connect();
} catch (err) {
  if (DropgateError.is(err, 'VERSION_UNSUPPORTED')) showUpdateRequired();
  else if (DropgateError.is(err) && err.retryable) showTryAgain(err.message);
  else throw err;
}
```

## What an Error Holds

| Property | Type | Description |
| --- | --- | --- |
| `name` | `string` | Always `DropgateError` |
| `code` | `DropgateErrorCode` | What went wrong: one of the codes below |
| `message` | `string` | A sentence a person can read. It never holds a file name or a key, so it's safe to show and to log |
| `origin` | `'local' \| 'server' \| 'network' \| 'peer'` | Where it went wrong: this device, the server, the network between, or the other device in a direct transfer |
| `retryable` | `boolean` | Whether the same request could succeed if made again later |
| `status` | `number` | The HTTP status, when the server answered with an error |
| `details` | `object` | More about it, for some codes: `capability` for `CAPABILITY_UNSUPPORTED` (`upload`, `e2ee` or `p2p`), `index` for a file's problem, `cancellation` for `OPERATION_CANCELLED` |
| `cause` | `unknown` | The error underneath, when there was one. Core didn't write it, so it may hold anything: `JSON.stringify()` leaves it out |

When the server answers with an error, the message is the server's own, if it sent a short one.

`DropgateError.is(err, code?)` tells whether `err` is a `DropgateError`, with that code if one is given.

## Codes

| Code | Origin | Retryable | When |
| --- | --- | --- | --- |
| `INVALID_ARGUMENT` | local | No | An option is missing or invalid: no server, no files, no `fileId` or `bundleId`, a download without a sink that fits it, or a lifetime that isn't a whole number of milliseconds |
| `RUNTIME_UNSUPPORTED` | local | No | There's no `fetch()` or Web Crypto, or encryption was asked for where the browser gives no `crypto.subtle` (a page not served over HTTPS or from `localhost`) |
| `OPERATION_CANCELLED` | local | No | A call was given an `AbortSignal`, and it was aborted. An upload or download that's cancelled ends with a `cancelled` outcome instead |
| `SOURCE_UNAVAILABLE` | local | No | A file being uploaded couldn't be read |
| `OUTPUT_WRITE_FAILED` | local | No | A download's sink failed a `write()` or its `close()`, or a function giving a sink failed; a direct transfer's `onData` threw or rejected, or its receiver couldn't keep up |
| `ENCRYPT_FAILED` | local | No | The encryption key couldn't be made, or a file name or chunk couldn't be encrypted |
| `KEY_REQUIRED` | local | No | The upload is encrypted, and there's no key |
| `DECRYPT_FAILED` | local | No | A file name or a bundle's manifest couldn't be decrypted: usually the wrong key |
| `INTEGRITY_FAILED` | server | No | Downloaded data didn't decrypt, or a direct transfer's sender sent data that didn't match what it declared (origin `peer`) |
| `INVALID_MANIFEST` | peer | No | A direct transfer's list of files didn't add up |
| `INVALID_FILENAME` | local | No | A file name sent unencrypted is empty, longer than 255 characters, or has a path in it |
| `INVALID_CODE` | local | No | A direct transfer code isn't the shape of one |
| `FILE_EMPTY` | local | No | A file to upload is empty (0 bytes) |
| `FILE_TOO_LARGE` | server | No | The upload is larger than the server's limit (`details.index` says which file, when core finds it before asking the server) |
| `LIFETIME_NOT_ALLOWED` | server | No | The server doesn't allow that file lifetime: too long, or unlimited |
| `CAPABILITY_UNSUPPORTED` | server | No | The server has uploads, end-to-end encryption or direct transfer turned off (`details.capability`) |
| `VERSION_UNSUPPORTED` | server | No | This version of core can't work with the server's, or a direct transfer's other device uses another protocol version (origin `peer`) |
| `NOT_FOUND` | server | No | The upload isn't on the server: it never was, it expired, or it was downloaded as many times as it could be (HTTP 404 or 410) |
| `REQUEST_REJECTED` | server | No | The server refused the request for another reason (any other 4xx status), and says why |
| `RATE_LIMITED` | server | Yes | The server has had too many requests (HTTP 429) |
| `SERVER_FULL` | server | Yes | The server is out of space (HTTP 507) |
| `SERVER_ERROR` | server | Yes | The server ran into an error (HTTP 5xx) |
| `INVALID_RESPONSE` | server | No | The server's answer wasn't understood, or isn't a Dropgate server's |
| `SERVER_UNREACHABLE` | network | Yes | No answer came: the server couldn't be reached |
| `TIMED_OUT` | network | Yes | The server took too long to answer, or a direct transfer's other device didn't answer in time (origin `peer`) |
| `CONNECTION_LOST` | network | Yes | A download was cut off part-way, or a direct transfer's connection dropped |
| `PEER_FAILED` | peer | No | A direct transfer's other device reported an error. What it said isn't passed on, since it could say anything |
| `UNEXPECTED_ERROR` | local | No | Anything else, with the error underneath as its `cause` |
