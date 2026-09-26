import type { FarmerReliefProps, HeldReason } from '../components/organisms/farmer-relief/props';
import { farmPreviews } from './resource-preview';

// Synthetic presentation samples, not #59 domain fixtures, live identities,
// farm/plot mappings or settlement receipts. Paid/Held semantics follow #31.
const base: FarmerReliefProps = {
  farm: {
    ...farmPreviews.ready,
    mappingLabel: 'Example selection · p1213-001 · mapping not verified',
  },
  plotLabel: 'p1213-001',
  seasonLabel: '2026',
  wallet: '0x1111111111111111111111111111111111111111',
  identityLevel: 0,
  slot: 'unissued',
  outcome: { kind: 'none' },
  updatedAtLabel: '26 Sep 2026 · 12:00 JST · example',
  provenance: {
    sourceName: 'Local synthetic fixture',
    datasetLabel: 'Farmer relief status preview',
    observedAtLabel: 'No live observation',
    retrievedAtLabel: 'No network request',
    evidenceLabel: 'No transaction hash or chain receipt',
    state: 'available',
    explanation: 'The preview describes screen states only. An integrated status requires identity, slot and event-specific settlement evidence.',
  },
};

const held = (reason: HeldReason): FarmerReliefProps => ({
  ...base,
  identityLevel: reason === 'UNVERIFIED' ? 0 : 1,
  slot: reason === 'NO_FARMER' ? 'unissued' : reason === 'PLOT_EXPIRED' ? 'expired' : 'issued',
  outcome: { kind: 'held', reason, amount: '15000' },
});

export const farmerReliefPreviews = {
  unverified: base,
  verified: { ...base, identityLevel: 1, slot: 'issued' },
  verifiedLevelTwo: { ...base, identityLevel: 2, slot: 'issued' },
  requestPending: { ...base, slot: 'requested' },
  paid: { ...base, identityLevel: 1, slot: 'issued', outcome: { kind: 'paid', amount: '15000' } },
  heldUnverified: held('UNVERIFIED'),
  verifiedHeld: { ...held('UNVERIFIED'), identityLevel: 1 },
  claimPending: { ...held('UNVERIFIED'), identityLevel: 1, outcome: { kind: 'held', reason: 'UNVERIFIED', amount: '15000', claimPending: true } },
  verifiedHeldExpiredSlot: { ...held('UNVERIFIED'), identityLevel: 1, slot: 'expired' },
  verifiedHeldRevokedSlot: { ...held('UNVERIFIED'), identityLevel: 1, slot: 'revoked' },
  verifiedHeldNoWallet: { ...held('UNVERIFIED'), identityLevel: 1, wallet: undefined },
  heldIdentityUnavailable: { ...held('UNVERIFIED'), identityLevel: null },
  heldNoFarmer: held('NO_FARMER'),
  heldPlotExpired: held('PLOT_EXPIRED'),
  heldCap: held('CAP'),
  heldZoneMismatch: held('ZONE_MISMATCH'),
  claimWindowElapsed: { ...base, identityLevel: 1, slot: 'issued', outcome: { kind: 'expired' } },
  slotExpired: { ...base, identityLevel: 1, slot: 'expired' },
  slotRevoked: { ...base, identityLevel: 1, slot: 'revoked' },
  verificationCancelled: { ...held('UNVERIFIED'), verificationCancelled: true },
  unavailable: {
    ...base,
    farm: farmPreviews.unavailable,
    wallet: undefined,
    identityLevel: null,
    slot: 'unavailable',
    outcome: { kind: 'unavailable' },
    provenance: { ...base.provenance, state: 'unavailable', evidenceLabel: 'Unavailable', explanation: 'Identity, registration and settlement evidence could not be loaded. Unknown status is not proof of a failed verification or a payment.' },
  },
} satisfies Record<string, FarmerReliefProps>;
