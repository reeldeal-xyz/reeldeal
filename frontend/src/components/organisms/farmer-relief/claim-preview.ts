import type { FarmerReliefProps } from './props';

type ClaimContext = Pick<FarmerReliefProps, 'outcome' | 'identityLevel' | 'slot' | 'wallet'>;
export type ClaimPreviewState = 'not-applicable' | 'identity-required' | 'identity-unavailable' | 'wallet-unavailable' | 'slot-required' | 'ready';

/** Gates a local demo control, not on-chain eligibility or an approved claim. */
export function claimPreviewState({ outcome, identityLevel, slot, wallet }: ClaimContext): ClaimPreviewState {
  if (outcome.kind !== 'held' || outcome.reason !== 'UNVERIFIED') return 'not-applicable';
  if (identityLevel === 0) return 'identity-required';
  if (identityLevel !== 1 && identityLevel !== 2) return 'identity-unavailable';
  if (typeof wallet !== 'string' || !/^0x[\da-fA-F]{40}$/.test(wallet) || /^0x0{40}$/.test(wallet)) return 'wallet-unavailable';
  if (slot !== 'issued') return 'slot-required';
  return 'ready';
}
