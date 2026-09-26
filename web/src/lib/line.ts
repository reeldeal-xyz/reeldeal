// LINE Messaging API push helpers (issue #14 — "LINE Messaging API push: Paid / Held messages").
//
// TODO(#14): this is a stub so #23 (MultiBaas webhook -> LINE push) and #17 (keeper) can land against a
// stable interface while #14 is built out on its own branch. Replace the bodies below with real
// `@line/bot-sdk` push calls (JA/EN templates, e.g. "唐桑東 p1213-017: ¥20,000 のお見舞金が届きました" /
// "保留中: 本人確認をすると受け取れます") plus the 200-pushes/month free-plan quota counter. Keep the
// exported names (`pushPaid`, `pushHeld`) and input shapes stable so callers don't need to change.

export interface PushPaidInput {
  /** LINE userId to push to (see web/src/lib/payout-directory.ts for wallet -> userId resolution). */
  lineUserId: string;
  plotLabel: string;
  /** Human-formatted JPYC amount, e.g. "20,000" (18 decimals already divided out by the caller). */
  amount: string;
  eventId: string;
}

export interface PushHeldInput {
  lineUserId: string;
  plotLabel: string;
  /** One of NO_FARMER, PLOT_EXPIRED, UNVERIFIED, CAP, ZONE_MISMATCH — see IReliefPool.Held. */
  reason: string;
  eventId: string;
}

export async function pushPaid(input: PushPaidInput): Promise<void> {
  // TODO(#14): real push via @line/bot-sdk Client#pushMessage with JA/EN templates + quota counter.
  console.log('[line] pushPaid (stub, #14 pending)', input);
}

export async function pushHeld(input: PushHeldInput): Promise<void> {
  // TODO(#14): real push via @line/bot-sdk Client#pushMessage with JA/EN templates + quota counter.
  console.log('[line] pushHeld (stub, #14 pending)', input);
}
