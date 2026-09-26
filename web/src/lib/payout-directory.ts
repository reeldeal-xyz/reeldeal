// Wallet/plot -> LINE userId lookup (issue #23, real store landed by #17 "keeper"; wallet<->LINE binding
// itself is still #15's job -- see the TODO below).
//
// The ReliefPool `Paid` event carries the farmer's payout wallet; `Held` carries only the plotLabel (see
// IReliefPool.Held). Neither carries a LINE userId directly, so this directory turns on-chain identifiers
// into a push target via two small JSON-file-backed maps:
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
// Storage: a single JSON file (env PAYOUT_DIRECTORY_FILE, default `.data/payout-directory.json` under the
// web app's cwd). Good enough for local dev and for the keeper's own long-lived process during the demo.
// NOT durable across instances on a read-only/ephemeral serverless filesystem (e.g. Vercel's default
// runtime) -- #15 should move this to real shared KV (Vercel KV / Upstash) once cross-instance durability
// matters; this module's two functions (`recordPlotWallet`, `bindWalletToLineUser`) are the seam to swap.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './env';

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
export function recordPlotWallet(plotLabel: string, wallet: string): void {
  const data = load();
  data.plotWallet[plotLabel] = normalizeWallet(wallet);
  persist(data);
}

/** TODO(#15): call this from the LIFF wallet-bind flow once a farmer's in-app wallet is linked to their
 *  LINE session (after World ID verification, or as soon as the wallet + LINE login both exist). */
export function bindWalletToLineUser(wallet: string, lineUserId: string): void {
  const data = load();
  data.walletLine[normalizeWallet(wallet)] = lineUserId;
  persist(data);
}

export const payoutDirectory: PayoutDirectory = {
  async lineUserIdForWallet(wallet: string): Promise<string | null> {
    const data = load();
    return data.walletLine[normalizeWallet(wallet)] ?? null;
  },
  async lineUserIdForPlot(plotLabel: string): Promise<string | null> {
    const data = load();
    const wallet = data.plotWallet[plotLabel];
    if (!wallet) return null;
    return data.walletLine[wallet] ?? null;
  },
};
