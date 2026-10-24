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
