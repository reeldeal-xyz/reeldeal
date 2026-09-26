// Durable LINE push de-dup (sponsor-polish task): the same on-chain Paid/Held event must never push a
// LINE message twice, even across process restarts or a MultiBaas webhook replay. Keyed by the chain
// event id `${txHash}:${logIndex}` -- a single log entry is delivered/processed exactly once, so the
// dedup *is* an insert racing on that id's uniqueness (DB: primary key + onConflictDoNothing; JSON
// fallback: an in-memory+on-disk set, same best-effort persist() policy as payout-directory.ts).
//
// Storage: `app.notification_log` via Drizzle when DATABASE_URL is set, else a JSON file (env
// NOTIFICATION_LOG_FILE, default `.data/notification-log.json`) -- same fallback policy as
// payout-directory.ts/slot-request-store.ts, so nothing breaks in tests or local dev without a DB.
//
// Both call sites (web/src/app/api/multibaas/webhook/route.ts and web/src/lib/keeper/run.ts) call
// `claimNotification` right before pushPaid/pushHeld: it returns true exactly once per chain event id
// (whichever caller gets there first "claims" the push), false to every later caller for the same id.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './env';
import { getDb } from '../db/client';
import { notificationLog } from '../db/schema';

export const chainEventId = (txHash: string, logIndex: number): string => `${txHash}:${logIndex}`;

interface NotificationLogFile {
  seen: Record<string, { kind: string; pushedAt: string }>;
}

const EMPTY_FILE: NotificationLogFile = { seen: {} };

let cache: NotificationLogFile | null = null;

function load(): NotificationLogFile {
  if (cache) return cache;
  const path = env.notificationLogFile();
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<NotificationLogFile>;
    cache = { seen: parsed.seen ?? {} };
  } catch {
    cache = { ...EMPTY_FILE, seen: {} };
  }
  return cache;
}

function persist(data: NotificationLogFile): void {
  const path = env.notificationLogFile();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (err) {
    // Best-effort, same policy as payout-directory.ts: an ephemeral/read-only filesystem must not crash
    // the keeper run or the webhook handler.
    console.warn('[notification-log] failed to persist', path, err);
  }
}

/** Test-only: drop the in-memory cache so a test run starts clean and re-reads NOTIFICATION_LOG_FILE. */
export function _resetNotificationLogCacheForTests(): void {
  cache = null;
}

/**
 * Claims the right to push a LINE notification for this chain event. Returns `true` exactly once per
 * `(txHash, logIndex)` pair (the caller should push now); every subsequent call for the same event
 * returns `false` (skip -- someone already pushed it, or is pushing it right now).
 *
 * A DB write failure is treated as "go ahead and push" (best-effort dedup, never best-effort delivery) --
 * missing a push because Postgres hiccuped would be worse than an occasional duplicate.
 */
export async function claimNotification(txHash: string, logIndex: number, kind: 'Paid' | 'Held'): Promise<boolean> {
  const id = chainEventId(txHash, logIndex);
  const db = getDb();
  if (db) {
    try {
      const inserted = await db
        .insert(notificationLog)
        .values({ id, txHash, logIndex, kind })
        .onConflictDoNothing({ target: notificationLog.id })
        .returning({ id: notificationLog.id });
      return inserted.length > 0;
    } catch (err) {
      console.warn('[notification-log] failed to claim in DB, pushing anyway', id, err);
      return true;
    }
  }

  const data = load();
  if (data.seen[id]) return false;
  data.seen[id] = { kind, pushedAt: new Date().toISOString() };
  persist(data);
  return true;
}
