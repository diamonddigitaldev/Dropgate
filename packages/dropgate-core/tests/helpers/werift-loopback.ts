import { afterEach, beforeEach } from 'vitest';
import {
  CipherContext, HashAlgorithm, NamedCurveAlgorithm, RTCCertificate, RTCPeerConnection as WeriftPeerConnection, SignatureAlgorithm,
  type RTCDataChannel as WeriftDataChannel,
} from 'werift';
import type { RtcPeerConnectionClass } from '../../src/dgdtp/webrtc.js';

// werift's RTCPeerConnection for core's suite, Node to Node on one machine.
//
// Two of werift's defaults are set aside here. With no ICE servers it still
// asks Google's STUN server (stun.l.google.com) for every IPv4 address, so ICE
// runs on IPv6's loopback address, ::1, alone, where it asks none: nothing
// leaves the machine and nothing is looked up. And it gives every peer
// connection in a process the same DTLS certificate, so each one here gets its
// own, as two devices would have. No candidate names a .local host: werift
// would look one up with an mDNS query on the LAN.

/** A new self-signed DTLS certificate, as werift makes its own. */
export async function newCertificate(): Promise<RTCCertificate> {
  const { certPem, keyPem, signatureHash } = await CipherContext.createSelfSignedCertificateWithKey(
    { signature: SignatureAlgorithm.ecdsa_3, hash: HashAlgorithm.sha256_4 }, NamedCurveAlgorithm.secp256r1_23,
  );
  return new RTCCertificate(keyPem, certPem, signatureHash);
}

/** Certificates for the test's peer connections, one each, made before it starts. */
export const certificates: RTCCertificate[] = [];
/** Every werift peer connection a test made, in order, to close once it's done. */
export const made: LoopbackPeerConnection[] = [];

/**
 * werift's RTCPeerConnection on IPv6's loopback address alone, with a
 * certificate of its own. It keeps its data channel and its certificate's
 * fingerprint, so a test can reach under the adapter.
 */
export class LoopbackPeerConnection extends WeriftPeerConnection {
  channel: WeriftDataChannel | undefined;
  readonly fingerprint: string;

  constructor(config: ConstructorParameters<typeof WeriftPeerConnection>[0] = {}) {
    const certificate = certificates.shift();
    if (!certificate) throw new Error('No certificate left for another peer connection: make more with useLoopback().');
    super({ ...config, certificates: [certificate], iceInterfaceAddresses: { udp6: '::1' }, iceUseIpv4: false, iceUseIpv6: true });
    this.fingerprint = (certificate.getFingerprints().find((f) => f.algorithm === 'sha-256')?.value ?? '').replace(/:/g, '').toLowerCase();
    made.push(this);
    this.addEventListener('datachannel', (event: { channel: WeriftDataChannel }) => { this.channel = event.channel; });
  }

  createDataChannel(...args: Parameters<WeriftPeerConnection['createDataChannel']>): WeriftDataChannel {
    this.channel = super.createDataChannel(...args);
    return this.channel;
  }
}

/** The loopback peer connection, as the adapter takes an RTCPeerConnection class. */
export const Loopback = LoopbackPeerConnection as unknown as RtcPeerConnectionClass;

/** Makes `perTest` certificates before each test, and closes every peer connection it made after. */
export function useLoopback(perTest: number): void {
  beforeEach(async () => {
    certificates.push(...await Promise.all(Array.from({ length: perTest }, newCertificate)));
  });
  afterEach(async () => {
    certificates.length = 0;
    await Promise.allSettled(made.splice(0).map((pc) => pc.close()));
  });
}
