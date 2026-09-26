// Wallet/plot -> LINE userId lookup (issue #23, real store landed by #17 "keeper"; wallet<->LINE binding
// itself is still #15's job -- see the TODO below).
//
// The ReliefPool `Paid` event carries the farmer's payout wallet; `Held` carries only the plotLabel (see
// IReliefPool.Held). Neither carries a LINE userId directly, so this directory turns on-chain identifiers
// into a push target via two small maps:
//
//   plotWallet:  plotLabel   -> farmer wallet   (written by the keeper -- it already resolves this via
//                                                 `payoutTarget`/the Paid event on every attest+settle run)
//   walletLine:  wallet      -> LINE userId     (written by `bindWalletToLineUser`, which the LIFF wallet
//                                                 bind flow -- issue #15 -- should call once a farmer's
//                                                 in-app wallet is linked to their LINE session)
//
// `lineUserIdForPlot` composes the two: plotLabel -> wallet -> LINE userId. Until #15 calls
// `bindWalletToLineUser`, `walletLine` stays empty and both lookups return null (the caller already logs a
// warning and skips the push in that case -- see the webhook route and web/src/lib/keeper/run.ts).
//
// Storage (db/postgres-plots task): `app.wallet_links` / `app.plot_wallets` via Drizzle when DATABASE_URL
// is set (db/README.md §4.3) -- durable across instances/restarts, unlike the old JSON file. When
// DATABASE_URL is unset (tests, local dev without a DB), this falls back to the original single JSON file
// (env PAYOUT_DIRECTORY_FILE, default `.data/payout-directory.json`) so nothing breaks without a DB.
//
// All four write/read functions became `async` for the DB path (they were partly sync before); every
// existing caller already sits inside an async function, so call sites just gained an `await` -- see
// web/src/lib/keeper/run.ts, web/src/lib/liff/world-bind.ts and web/src/app/api/liff/session/route.ts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { env } from './env';
import { getDb } from '../db/client';
import { walletLinks, plotWallets } from '../db/schema';

export interface PayoutDirectory {
  lineUserIdForWallet(wallet: string): Promise<string | null>;
  lineUserIdForPlot(plotLabel: string): Promise<string | null>;
}

interface DirectoryFile {
  plotWallet: Record<string, string>; // plotLabel -> wallet (lowercased)
  walletLine: Record<string, string>; // wallet (lowercased) -> LINE userId
}

const EMPTY_FILE: DirectoryFile = { plotWallet: {}, walletLine: {} };

function normalizeWallet(wallet: string): string {
  return wallet.toLowerCase();
}

let cache: DirectoryFile | null = null;

function load(): DirectoryFile {
  if (cache) return cache;
  const path = env.payoutDirectoryFile();
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DirectoryFile>;
    cache = { plotWallet: parsed.plotWallet ?? {}, walletLine: parsed.walletLine ?? {} };
  } catch {
    cache = { ...EMPTY_FILE, plotWallet: {}, walletLine: {} };
  }
  return cache;
}

function persist(data: DirectoryFile): void {
  const path = env.payoutDirectoryFile();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (err) {
    // Best-effort: an ephemeral/read-only filesystem (e.g. a serverless deploy without a writable volume)
    // must not crash the keeper run or the webhook handler -- it just means this write doesn't persist.
    console.warn('[payout-directory] failed to persist', path, err);
  }
}

/** Test-only: drop the in-memory cache so a test run starts clean and re-reads PAYOUT_DIRECTORY_FILE. */
export function _resetPayoutDirectoryCacheForTests(): void {
  cache = null;
}

/** Records that `plotLabel`'s season slot currently pays `wallet` (issue #17: the keeper learns this from
 *  `payoutTarget`/the `Paid` event on every attest+settle run). Idempotent -- overwrites any prior value. */
export async function recordPlotWallet(plotLabel: string, wallet: string): Promise<void> {
  const normalized = normalizeWallet(wallet);
  const db = getDb();
  if (db) {
    try {
      await db
        .insert(plotWallets)
        .values({ plotId: plotLabel, wallet: normalized, updatedAt: new Date() })
        .onConflictDoUpdate({ target: plotWallets.plotId, set: { wallet: normalized, updatedAt: new Date() } });
      return;
    } catch (err) {
      // Best-effort, same policy as the JSON persist() below: e.g. plotLabel isn't in geo.plots yet
      // (FK violation) must not crash the keeper run.
      console.warn('[payout-directory] failed to record plot wallet in DB', plotLabel, err);
      return;
    }
  }
  const data = load();
  data.plotWallet[plotLabel] = normalized;
  persist(data);
}

/** TODO(#15): call this from the LIFF wallet-bind flow once a farmer's in-app wallet is linked to their
 *  LINE session (after World ID verification, or as soon as the wallet + LINE login both exist). */
export async function bindWalletToLineUser(wallet: string, lineUserId: string): Promise<void> {
  const normalized = normalizeWallet(wallet);
  const db = getDb();
  if (db) {
    try {
      await db
        .insert(walletLinks)
        .values({ lineUserId, wallet: normalized, pinnedAt: new Date() })
        .onConflictDoUpdate({ target: walletLinks.lineUserId, set: { wallet: normalized } });
      return;
    } catch (err) {
      console.warn('[payout-directory] failed to bind wallet<->LINE user in DB', lineUserId, err);
      return;
    }
  }
  const data = load();
  data.walletLine[normalized] = lineUserId;
  persist(data);
}

export const payoutDirectory: PayoutDirectory = {
  async lineUserIdForWallet(wallet: string): Promise<string | null> {
    const normalized = normalizeWallet(wallet);
    const db = getDb();
    if (db) {
      const rows = await db.select({ lineUserId: walletLinks.lineUserId }).from(walletLinks).where(eq(walletLinks.wallet, normalized));
      return rows[0]?.lineUserId ?? null;
    }
    const data = load();
    return data.walletLine[normalized] ?? null;
  },
  async lineUserIdForPlot(plotLabel: string): Promise<string | null> {
    const db = getDb();
    if (db) {
      const rows = await db.select({ wallet: plotWallets.wallet }).from(plotWallets).where(eq(plotWallets.plotId, plotLabel));
      const wallet = rows[0]?.wallet;
      if (!wallet) return null;
      return payoutDirectory.lineUserIdForWallet(wallet);
    }
    const data = load();
    const wallet = data.plotWallet[plotLabel];
    if (!wallet) return null;
    return data.walletLine[wallet] ?? null;
  },
};

/** The wallet this LINE user was first linked to, if any (reverse of `walletLine`). */
export async function walletForLineUser(lineUserId: string): Promise<string | null> {
  const db = getDb();
  if (db) {
    const rows = await db.select({ wallet: walletLinks.wallet }).from(walletLinks).where(eq(walletLinks.lineUserId, lineUserId));
    return rows[0]?.wallet ?? null;
  }
  const data = load();
  for (const [wallet, user] of Object.entries(data.walletLine)) if (user === lineUserId) return wallet;
  return null;
}

/** One stable wallet per LINE user: the first wallet a user presents is pinned, and later sessions (a new
 *  browser context with its own localStorage, a reinstall) get that same wallet back instead of a new one. */
export async function pinWalletForLineUser(lineUserId: string, candidate: string | null): Promise<string | null> {
  const existing = await walletForLineUser(lineUserId);
  if (existing) return existing;
  if (!candidate) return null;
  const normalized = normalizeWallet(candidate);
  const db = getDb();
  if (db) {
    // onConflictDoNothing (not Update): two concurrent requests racing to pin the same LINE user get
    // one winner, matching the JSON store's "first wallet wins" invariant instead of last-write-wins.
    await db.insert(walletLinks).values({ lineUserId, wallet: normalized, pinnedAt: new Date() }).onConflictDoNothing({ target: walletLinks.lineUserId });
    return (await walletForLineUser(lineUserId)) ?? normalized;
  }
  await bindWalletToLineUser(candidate, lineUserId);
  return normalized;
}
