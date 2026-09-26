import type { HolderContext, OperationsPlot, SlotState } from './props';

export const validWallet = (value?: string): value is string =>
  typeof value === 'string' && /^0x[\da-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);

/** Expiry is evaluated at the explicit snapshot, never the viewer's local clock. */
export function displayedSlot(row: OperationsPlot, asOf: string): SlotState {
  if (row.slot !== 'issued') return ['pending', 'expired', 'revoked', 'unavailable'].includes(row.slot) ? row.slot : 'unavailable';
  const expiry = Date.parse(row.expiresAt ?? '');
  const snapshot = Date.parse(asOf);
  if (!Number.isFinite(expiry) || !Number.isFinite(snapshot)) return 'unavailable';
  return expiry <= snapshot ? 'expired' : 'issued';
}

export function currentFarmer(row: OperationsPlot, asOf: string): string | undefined {
  return displayedSlot(row, asOf) === 'issued' && validWallet(row.farmer) ? row.farmer : undefined;
}

export type ActionGuard = { action: 'issue' | 'revoke'; reason?: never } | { action?: never; reason: string };

/** Restricts local demo controls. This does not establish server/on-chain authority. */
export function holderAction(row: OperationsPlot, context: HolderContext): ActionGuard {
  if (!validWallet(context.wallet)) return { reason: 'A valid example holder wallet is missing.' };
  if (context.chainId !== 11155111) return { reason: 'The example wallet is not on Sepolia.' };
  if (context.authority !== 'holder') return { reason: context.authority === 'unauthorized'
    ? 'The example account is not authorized as this plot’s holder.'
    : 'Holder authority is unavailable. A connected wallet alone does not establish it.' };
  if (!validWallet(row.holder) || context.wallet.toLowerCase() !== row.holder.toLowerCase()) {
    return { reason: 'The example wallet does not match this plot’s recorded holder.' };
  }
  if (!validWallet(row.slotRegistry)) return { reason: 'This plot’s season-slot registry is unavailable.' };
  const slot = displayedSlot(row, context.asOf);
  if (slot === 'revoked') return { reason: 'This slot is revoked. A fresh reviewed request is required before an issue preview.' };
  if (slot === 'expired') return { reason: 'This slot is expired. Review the season and registration before another action.' };
  if (slot !== 'pending' && slot !== 'issued') return { reason: 'Current slot data is unavailable. No action can be previewed.' };
  const expiry = Date.parse(row.expiresAt ?? '');
  const snapshot = Date.parse(context.asOf);
  if (!Number.isFinite(expiry) || !Number.isFinite(snapshot) || expiry <= snapshot) {
    return { reason: 'A future slot expiry at the example snapshot is required.' };
  }
  if (slot === 'pending' && !validWallet(row.farmer)) return { reason: 'The requested farmer wallet is missing or invalid.' };
  return { action: slot === 'pending' ? 'issue' : 'revoke' };
}

export function expiryLabel(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Expiry unavailable';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(value)) + ' JST';
}
