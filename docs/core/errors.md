# Errors

Every error has a `code`, which you can check instead of its message.

| Class | `code` | Description |
| --- | --- | --- |
| `DropgateError` | `DROPGATE_ERROR` | Base error class. Also thrown itself, with one of the codes below |
| `DropgateValidationError` | `VALIDATION_ERROR` | Input validation errors |
| `DropgateNetworkError` | `NETWORK_ERROR` | Network/connection errors |
| `DropgateProtocolError` | `PROTOCOL_ERROR` | Server protocol errors |
| `DropgateAbortError` | `ABORT_ERROR` | Operation aborted. Its `name` is `AbortError` |
| `DropgateTimeoutError` | `TIMEOUT_ERROR` | Operation timed out. Its `name` is `TimeoutError` |

`DropgateError` itself is thrown with these codes:

| `code` | From | When |
| --- | --- | --- |
| `CRYPTO_PREP_FAILED` | `uploadFiles()`, through `session.result` | The encryption key couldn't be made, or a filename couldn't be encrypted |
| `DECRYPT_MANIFEST_FAILED` | `downloadFiles()`, for a bundle | The key couldn't be read, or the bundle's manifest or file names couldn't be decrypted (usually the wrong key) |
| `DECRYPT_FILENAME_FAILED` | `downloadFiles()`, for a single file | The key couldn't be read, or the filename couldn't be decrypted (usually the wrong key) |
