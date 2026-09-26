import type { FarmCardProps } from '../../molecules/relief/resource-props';
import type { ProvenanceDetailsProps } from '../../molecules/relief/props';

/** Display-only props for #67 previews; not the pending #59 or #63 contract. */
export type HeldReason = 'UNVERIFIED' | 'NO_FARMER' | 'PLOT_EXPIRED' | 'CAP' | 'ZONE_MISMATCH';

export type ReliefOutcome =
  | { kind: 'none' }
  | { kind: 'held'; reason: HeldReason; amount: string; claimPending?: boolean }
  | { kind: 'paid'; amount: string }
  | { kind: 'expired' }
  | { kind: 'unavailable' };

export interface FarmerReliefProps {
  farm: FarmCardProps;
  plotLabel: string;
  seasonLabel: string;
  wallet?: string;
  identityLevel: 0 | 1 | 2 | null;
  slot: 'unissued' | 'requested' | 'issued' | 'expired' | 'revoked' | 'unavailable';
  outcome: ReliefOutcome;
  updatedAtLabel: string;
  provenance: ProvenanceDetailsProps;
  verificationCancelled?: boolean;
}

// Five reasons emitted by ReliefPool.sol. CLAIM_WINDOW_ELAPSED is separately
// represented as expired: PR #31 derives it from the on-chain Swept state.
export const heldReasonCopy: Record<HeldReason, { title: string; detail: string; next: string }> = {
  UNVERIFIED: {
    title: 'Identity verification needed',
    detail: 'The settlement was held because the farmer did not have a verified identity.',
    next: 'Verify with World ID. A later claim must still pass the current eligibility and claim-window checks.',
  },
  NO_FARMER: {
    title: 'No farmer registered',
    detail: 'No farmer is registered for this plot’s season slot.',
    next: 'Ask the co-op to check the season-slot registration.',
  },
  PLOT_EXPIRED: {
    title: 'Season slot expired',
    detail: 'The season slot had expired when eligibility was checked.',
    next: 'Ask the co-op to check the slot expiry and registration.',
  },
  CAP: {
    title: 'Event unit cap reached',
    detail: 'The verified identity has already received its allowed units for this event.',
    next: 'Contact the co-op about this event’s unit cap. No claim action is available in this preview.',
  },
  ZONE_MISMATCH: {
    title: 'Plot does not match this event',
    detail: 'The plot is not enrolled for this event’s zone and species.',
    next: 'Ask the co-op to check the plot’s enrollment, zone and species.',
  },
};
