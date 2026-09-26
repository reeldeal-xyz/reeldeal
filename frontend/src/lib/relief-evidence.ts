import type { Hex } from 'viem';

export interface ReliefEvidenceSource {
  eventId: Hex;
  referenceEventId: string;
  zone: string;
  species: string;
  peril: string;
  dataHash: Hex;
  sourceTitle: string;
  sourceUrl: string;
  sourceAsOf: string;
  banStart: string;
  firedOn: string;
  banLift: string;
  threshold: number;
  indexAtFire: number;
  /** Jev is an off-chain pre-attestation gate; this describes the recorded demo path, never chain state. */
  jev: {
    status: 'bypassed-by-coop-override';
    explanation: string;
  };
}

/**
 * Pinned evidence for the currently deployed Sepolia demo event.
 * The dataHash is the SHA-256 of the official Miyagi bulletin bytes and is the exact hash placed in the
 * Trigger by DeployReliefPoolV2.s.sol. Keep this mapping narrow: unknown hashes stay unknown.
 */
export const MIYAGI_SCALLOP_BAN_2026: ReliefEvidenceSource = {
  eventId: '0xb41040f1dfcd39de74b3261b703f60bc435680523e6ce5c9e3e0cfed019fc8c7',
  referenceEventId: '2026-scallop-banweeks-karakuwa',
  zone: 'karakuwa-east',
  species: 'scallop',
  peril: 'BANWEEKS',
  dataHash: '0x39851aa6b573d9a4491f48fb2595609ffb07f84ac4a42000ab81fb1c4563d708',
  sourceTitle: '令和8年度 宮城県の貝毒による規制・解除状況【まひ性貝毒】',
  sourceUrl: 'https://www.pref.miyagi.jp/documents/24934/080915_mahikeika.pdf',
  sourceAsOf: '2026-09-15',
  banStart: '2026-05-12',
  firedOn: '2026-06-02',
  banLift: '2026-09-15',
  threshold: 4,
  indexAtFire: 4,
  jev: {
    status: 'bypassed-by-coop-override',
    explanation: 'The live demo keeper replay used the explicit co-op force override, so JEV was not consulted for this attestation. ReliefPool settlement remains deterministic on-chain.',
  },
};

export function evidenceForTrigger(eventId: Hex, dataHash: Hex | undefined): ReliefEvidenceSource | null {
  if (!dataHash) return null;
  return eventId.toLowerCase() === MIYAGI_SCALLOP_BAN_2026.eventId.toLowerCase()
    && dataHash.toLowerCase() === MIYAGI_SCALLOP_BAN_2026.dataHash.toLowerCase()
    ? MIYAGI_SCALLOP_BAN_2026
    : null;
}
