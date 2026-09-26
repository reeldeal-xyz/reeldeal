import type { ReliefOutcome } from '../farmer-relief/props';

/** Local presentation fixtures, not the #59 domain or #63 authorization contract. */
export type SlotState = 'pending' | 'issued' | 'expired' | 'revoked' | 'unavailable';
export type OperationsState = 'ready' | 'loading' | 'empty' | 'unavailable';
export type ActionPhase = 'idle' | 'confirm' | 'cancelled' | 'wallet-rejected' | 'pending';
export interface OperationsPlot {
  id: string;
  plotLabel: string;
  seasonLabel: string;
  species: string;
  holder?: string;
  farmer?: string;
  slotRegistry?: string;
  identityLevel: 0 | 1 | 2 | null;
  slot: SlotState;
  expiresAt: string | null;
  requestedAtLabel: string;
  relief: ReliefOutcome;
  reliefRecipient?: string;
}
export interface HolderContext {
  asOf: string;
  wallet?: string;
  chainId?: number;
  authority: 'holder' | 'unauthorized' | 'unavailable';
}
export interface HolderPreview {
  state: OperationsState;
  context: HolderContext;
  rows: OperationsPlot[];
  initialPhase?: ActionPhase;
}
export interface CoopPreview {
  state: OperationsState;
  asOf: string;
  rows: OperationsPlot[];
}

export const slotLabels: Record<SlotState, string> = {
  pending: 'Request pending', issued: 'Issued', expired: 'Expired', revoked: 'Revoked', unavailable: 'Unavailable',
};
export const identityLabel = (level: OperationsPlot['identityLevel']) =>
  level === 0 ? 'Unverified · Level 0' : level === 1 || level === 2 ? `Verified · Level ${level}` : 'Identity unavailable';
