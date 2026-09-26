// Framework-agnostic core of GET/POST /api/liff/slot-request (issue #15) -- the LIFF app's missing write
// path that lib/slot-request-store.ts's header comment calls out, and the counterpart to
// app/api/holder/requests/route.ts's read side (issue #19 lists what this creates).
//
// `bindWalletToLineUser` and the store are dependency-injected (defaults: the real ones) for test hygiene --
// bun's `mock.module` replaces a module's exports process-wide for the rest of the test run (see
// app/api/multibaas/webhook/route.test.ts, which mocks '@/lib/payout-directory'), so a route that imports
// that module's named exports directly can't be tested reliably alongside other files that mock it.
import { isAddress } from 'viem';
import { bindWalletToLineUser as defaultBindWalletToLineUser } from '@/lib/payout-directory';
import { SEASON_LABEL } from '@/lib/plots';
import { slotRequestStore as defaultSlotRequestStore, type NewSlotRequest, type SlotRequest, type SlotRequestStore } from '@/lib/slot-request-store';

export interface SlotRequestDeps {
  bindWalletToLineUser: (wallet: string, lineUserId: string) => void;
  store: Pick<SlotRequestStore, 'list' | 'create'>;
}

export function defaultSlotRequestDeps(): SlotRequestDeps {
  return { bindWalletToLineUser: defaultBindWalletToLineUser, store: defaultSlotRequestStore };
}

export interface SlotRequestResponse {
  status: number;
  body: Record<string, unknown>;
}

/** GET: the caller's own requests only -- `lineUserId` always comes from the session, never a query param. */
export async function handleListMyRequests(lineUserId: string, deps: SlotRequestDeps = defaultSlotRequestDeps()): Promise<SlotRequestResponse> {
  const all = await deps.store.list();
  const requests: SlotRequest[] = all.filter((r) => r.lineUserId === lineUserId);
  return { status: 200, body: { requests } };
}

/** POST: `lineUserId` and `displayName` always come from the caller's own session (route.ts), never the
 *  request body -- a client could send any `lineUserId`/`farmerName` it likes otherwise.
 *
 *  `sessionKind` (default 'line', so every existing caller/test keeps working unchanged) gates the
 *  wallet<->LINE push-directory bind below: a wallet session's "lineUserId" is `wallet:<address>` (see
 *  lib/siwe.ts) -- there's no LINE account to route a push notification to, so binding it would just write
 *  a pointless self-mapping into lib/payout-directory.ts's walletLinks table. */
export async function handleCreateSlotRequest(
  raw: unknown,
  lineUserId: string,
  displayName: string | undefined,
  deps: SlotRequestDeps = defaultSlotRequestDeps(),
  sessionKind: 'line' | 'wallet' = 'line',
): Promise<SlotRequestResponse> {
  const b = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const plotLabel = b.plotLabel;
  const wallet = b.wallet;

  if (typeof plotLabel !== 'string' || plotLabel.length === 0) {
    return { status: 400, body: { error: 'missing_plot_label' } };
  }
  if (typeof wallet !== 'string' || !isAddress(wallet)) {
    return { status: 400, body: { error: 'invalid_wallet' } };
  }

  // Idempotent: re-tapping "request" (e.g. after a flaky connection) must not pile up duplicate requests
  // for the same farmer + plot.
  const existing = (await deps.store.list()).find(
    (r) => r.plotLabel === plotLabel && r.lineUserId === lineUserId && r.status !== 'revoked',
  );
  if (existing) {
    return { status: 200, body: { request: existing } };
  }

  // Bind wallet<->LINE user now, not only after World ID verification -- payout-directory.ts's
  // bindWalletToLineUser docstring explicitly allows "as soon as the wallet + LINE login both exist", and
  // doing it here means a Held/Paid push can reach this farmer even before they verify. LINE-only: see
  // the doc comment above for why a wallet session skips this.
  if (sessionKind === 'line') {
    deps.bindWalletToLineUser(wallet, lineUserId);
  }

  const input: NewSlotRequest = { plotLabel, farmerAddress: wallet, seasonLabel: SEASON_LABEL, farmerName: displayName, lineUserId };
  const created = await deps.store.create(input);

  return { status: 201, body: { request: created } };
}
