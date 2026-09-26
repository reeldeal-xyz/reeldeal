// Shared Held-reason copy (JA/EN) and zone display labels, used by both the MultiBaas webhook
// (web/src/app/api/multibaas/webhook/route.ts, issue #23) and the keeper (web/src/lib/keeper, issue #17)
// so the two LINE-push paths never drift apart. Hold reasons are bytes32-packed ASCII on-chain
// (ReliefPool.REASON_*); callers pass the decoded label (e.g. via multibaas's `eventInput`, or read
// directly off `plotSettlements(eventId, plotLabel).holdReason` on-chain).
export interface HeldReasonText {
  reasonJa: string;
  reasonEn: string;
}

export const HELD_REASON_TEXT: Record<string, HeldReasonText> = {
  UNVERIFIED: { reasonJa: '本人確認をすると受け取れます', reasonEn: 'Verify your identity to receive the payout.' },
  NO_FARMER: { reasonJa: 'この区画の今季の担い手が未登録です', reasonEn: "No farmer is registered for this plot's season slot." },
  PLOT_EXPIRED: { reasonJa: '今季の区画登録の期限が切れています', reasonEn: 'The season slot for this plot has expired.' },
  CAP: { reasonJa: '今回の上限口数に達しました', reasonEn: 'You have reached the unit cap for this event.' },
  ZONE_MISMATCH: { reasonJa: '区画の海域が一致しません', reasonEn: "The plot's zone does not match this event." },
  default: { reasonJa: '確認中です。組合にお問い合わせください', reasonEn: 'Under review. Please contact the co-op.' },
};

export function heldReasonText(reason: string): HeldReasonText {
  return HELD_REASON_TEXT[reason] ?? HELD_REASON_TEXT.default!;
}

// Plot labels don't carry the zone today; all demo plots sit in the Karakuwa branch.
export function zoneLabelFor(_plotLabel: string): string {
  return '唐桑東';
}
