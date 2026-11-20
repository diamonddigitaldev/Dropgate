import { DropgateError } from './errors.js';

// The credential boundary: how core asks for a credential, for a
// server that needs one to accept an operation. It's the boundary only, not
// an account design: what a credential is, and how one is got, is the
// integrator's. Core asks only when the server says the operation needs one,
// sends it only to that server, only in the Authorization header, and never
// puts it in a link, a manifest, a snapshot, a result, an error or a URL.
// Receivers never need one: links and codes are bearer capabilities.

/** The operations a server can ask a credential for. */
export type CredentialOperation = 'hosted.upload';

/** What the credential provider is told when core asks it for a credential. */
export interface CredentialRequest {
  /** The operation the credential is for. */
  readonly operation: CredentialOperation;
  /** `required` as the operation starts; `expired` once more, after the server said the last one had expired. */
  readonly reason: 'required' | 'expired';
  /** The server asking: the client's own, which is the only one a credential is sent to. */
  readonly baseUrl: string;
  /** Aborts if the operation is cancelled while the provider is working. */
  readonly signal: AbortSignal;
}

/** A credential: a token, sent as `Authorization: Bearer <token>`. */
export interface Credential {
  /** The token: letters, digits and `-._~+/`, optionally ending in `=`s (RFC 6750's token68). */
  token: string;
}

/**
 * Gives the credential for an operation, or `null` for none. It's asked once
 * as an operation starts, and once more if the server says the credential has
 * expired. Core never keeps a credential beyond the operation it was given for.
 */
export type CredentialProvider = (request: CredentialRequest) => Promise<Credential | null> | Credential | null;

const TOKEN68 = /^[A-Za-z0-9\-._~+/]+=*$/;
const MAX_TOKEN_LENGTH = 8192;

/**
 * One operation's credential, if its server asked for one. The token is kept
 * in a private field: printed, logged or serialised, this shows as
 * `[Credentials]`, and it's never put anywhere but the header.
 */
export class OperationCredentials {
  /** For an operation the server doesn't ask a credential for: nothing is ever sent. */
  static readonly none = new OperationCredentials(null, 'hosted.upload', '');

  readonly #provider: CredentialProvider | null;
  readonly #operation: CredentialOperation;
  readonly #baseUrl: string;
  #token: string | null = null;
  #renewed = false;

  private constructor(provider: CredentialProvider | null, operation: CredentialOperation, baseUrl: string) {
    this.#provider = provider;
    this.#operation = operation;
    this.#baseUrl = baseUrl;
  }

  /**
   * The credential for an operation the server says needs one, from the
   * provider.
   * @throws {DropgateError} AUTH_REQUIRED if there's no provider, it gives none, or it fails;
   * INVALID_ARGUMENT if what it gives isn't a credential; OPERATION_CANCELLED.
   */
  static async required(
    provider: CredentialProvider | undefined,
    operation: CredentialOperation,
    baseUrl: string,
    signal: AbortSignal,
  ): Promise<OperationCredentials> {
    if (!provider) {
      throw new DropgateError({
        code: 'AUTH_REQUIRED',
        message: 'This server needs a credential for this, and the client was given no auth provider.',
      });
    }
    const credentials = new OperationCredentials(provider, operation, baseUrl);
    credentials.#token = await credentials.#ask('required', signal);
    return credentials;
  }

  /** The headers that carry the credential: none if there isn't one. */
  headers(): Record<string, string> {
    return this.#token === null ? {} : { Authorization: `Bearer ${this.#token}` };
  }

  /**
   * After the server said the credential had expired: asks the provider once
   * more, the first time only. Whether the request may be made again.
   */
  async renew(signal: AbortSignal): Promise<boolean> {
    if (!this.#provider || this.#renewed) return false;
    this.#renewed = true;
    this.#token = await this.#ask('expired', signal);
    return true;
  }

  async #ask(reason: CredentialRequest['reason'], signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw signal.reason;
    const request: CredentialRequest = Object.freeze({ operation: this.#operation, reason, baseUrl: this.#baseUrl, signal });
    let given: Credential | null;
    let stopWatching = (): void => { };
    // A cancel ends the wait, whether or not the provider listens to its signal.
    const cancelled = new Promise<never>((_, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      stopWatching = () => signal.removeEventListener('abort', onAbort);
    });
    try {
      given = await Promise.race([Promise.resolve().then(() => this.#provider!(request)), cancelled]);
    } catch {
      if (signal.aborted) throw signal.reason;
      // The provider's own error isn't kept, not even as the cause: it's the
      // integrator's, and could quote the credential.
      throw new DropgateError({ code: 'AUTH_REQUIRED', origin: 'local', message: "The auth provider couldn't give a credential." });
    } finally {
      stopWatching();
    }
    if (signal.aborted) throw signal.reason;
    if (given === null || given === undefined) {
      throw new DropgateError({ code: 'AUTH_REQUIRED', message: 'This server needs a credential for this, and the auth provider gave none.' });
    }
    const token = (given as { token?: unknown })?.token;
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !TOKEN68.test(token)) {
      throw new DropgateError({
        code: 'INVALID_ARGUMENT',
        message: "The auth provider's credential must be { token }, with a token of letters, digits and -._~+/ (optionally ending in =).",
      });
    }
    return token;
  }

  toJSON(): string { return '[Credentials]'; }
  toString(): string { return '[Credentials]'; }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return '[Credentials]'; }
}

/** Whether a server's answer says the credential sent has expired. */
export function credentialExpired(status: number, json: unknown): boolean {
  return status === 401 && Boolean(json) && typeof json === 'object' && (json as { code?: unknown }).code === 'AUTH_EXPIRED';
}
