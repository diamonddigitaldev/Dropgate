import type { ProtocolCompatibility } from './types.js';

// The build writes core's version in from its package.json, so nobody types
// it in. The tests' config does the same.
declare const __DROPGATE_CORE_VERSION__: string | undefined;

/** Core's own version, such as `4.0.0`. For display and logs: compatibility never depends on it. */
export const CORE_VERSION: string =
  typeof __DROPGATE_CORE_VERSION__ === 'string' ? __DROPGATE_CORE_VERSION__ : '0.0.0-dev';

/** A protocol's version: a different major can't work together; a minor only adds to its major. */
export interface ProtocolVersion {
  readonly major: number;
  readonly minor: number;
}

/** The protocols core speaks, each versioned on its own: hosted transfer (DGUP) and direct transfer (DGDTP). */
export interface Protocols {
  /** The Dropgate Upload Protocol: uploads to, and downloads from, a server. */
  readonly dgup: ProtocolVersion;
  /** The Dropgate Direct Transfer Protocol: from one device to another. */
  readonly dgdtp: ProtocolVersion;
}

/** The protocol versions this core speaks. */
export const PROTOCOLS: Protocols = Object.freeze({
  dgup: Object.freeze({ major: 4, minor: 0 }),
  dgdtp: Object.freeze({ major: 4, minor: 0 }),
});

export type ProtocolName = keyof Protocols;

/** A protocol version the server gave, if it's one: whole numbers, major and minor. */
export function protocolVersion(value: unknown): ProtocolVersion | null {
  if (!value || typeof value !== 'object') return null;
  const { major, minor } = value as { major?: unknown; minor?: unknown };
  if (!Number.isInteger(major) || !Number.isInteger(minor) || (major as number) < 0 || (minor as number) < 0) return null;
  return Object.freeze({ major: major as number, minor: minor as number });
}

/**
 * Whether this client's version of a protocol works with the server's: the
 * same major. A server that gives none is older than Dropgate 4.
 */
export function checkProtocol(client: ProtocolVersion, given: unknown): ProtocolCompatibility {
  const server = protocolVersion(given);
  if (!server || server.major < client.major) {
    return {
      compatible: false, client, server, update: 'server',
      message: 'Update required: this server runs an older version of Dropgate. Its operator needs to update it.',
    };
  }
  if (server.major > client.major) {
    return {
      compatible: false, client, server, update: 'client',
      message: 'Update required: this server runs a newer version of Dropgate. Update this app to use it.',
    };
  }
  return { compatible: true, client, server, message: 'This server works with this version of Dropgate.' };
}
