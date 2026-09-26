// Framework-agnostic core of POST /api/liff/world-bind (issue #15). Kept separate from route.ts (like
// lib/world/verify-handler.ts and lib/liff/claim.ts) so `bindWalletToLineUser` is dependency-injectable in
// tests: bun's `mock.module` replaces a module's exports process-wide for the rest of the test run (see
// app/api/multibaas/webhook/route.test.ts, which mocks '@/lib/payout-directory'), so a route that imports
// that module's named exports directly can't be tested reliably alongside other files that mock it.
import { isAddress } from 'viem';
import { bindWalletToLineUser as defaultBindWalletToLineUser } from '@/lib/payout-directory';

export interface WorldBindDeps {
  bindWalletToLineUser: (wallet: string, lineUserId: string) => void;
}

export function defaultWorldBindDeps(): WorldBindDeps {
  return { bindWalletToLineUser: defaultBindWalletToLineUser };
}

export interface WorldBindResponse {
  status: number;
  body: Record<string, unknown>;
}

/** `lineUserId` always comes from the caller's own session (route.ts), never the request body. */
export function handleWorldBind(raw: unknown, lineUserId: string, deps: WorldBindDeps = defaultWorldBindDeps()): WorldBindResponse {
  const wallet = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).wallet : undefined;
  if (typeof wallet !== 'string' || !isAddress(wallet)) {
    return { status: 400, body: { error: 'invalid_wallet' } };
  }

  deps.bindWalletToLineUser(wallet, lineUserId);
  return { status: 200, body: { ok: true } };
}
