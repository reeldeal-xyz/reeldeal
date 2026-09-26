// Escalated keeper run persistence (sponsor-polish task, docs/JEV.md attest gate): the co-op screen's
// "Needs co-op review" card reads this so an escalated run survives restarts (not just the process that
// happened to run the keeper). Only runs the Jev gate actually held for `co_op_review` are written here --
// a clean attest never creates a row (see the call site in web/src/lib/keeper/run.ts, right before it
// returns `status: 'escalated'`).
//
// Storage: `app.keeper_runs` via Drizzle when DATABASE_URL is set, else a JSON file (env
// KEEPER_RUNS_FILE, default `.data/keeper-runs.json`) -- same fallback policy as payout-directory.ts.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { env } from './env';
import { getDb } from '../db/client';
import { keeperRuns } from '../db/schema';
import type { KeeperRunResult } from './keeper/run';

export interface EscalatedRun {
  id: string;
  referenceEventId: string;
  eventId: string;
  status: 'escalated' | 'resolved';
  jevDecision: string | null;
  jevConfidence: number | null;
  jevReason: string | null;
  jevProbabilities: Record<string, number> | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface KeeperRunsFile {
  runs: EscalatedRun[];
}

const EMPTY_FILE: KeeperRunsFile = { runs: [] };

let cache: KeeperRunsFile | null = null;

function load(): KeeperRunsFile {
  if (cache) return cache;
  const path = env.keeperRunsFile();
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<KeeperRunsFile>;
    cache = { runs: parsed.runs ?? [] };
  } catch {
    cache = { ...EMPTY_FILE, runs: [] };
  }
  return cache;
}

function persist(data: KeeperRunsFile): void {
  const path = env.keeperRunsFile();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[keeper-runs] failed to persist', path, err);
  }
}

/** Test-only: drop the in-memory cache so a test run starts clean and re-reads KEEPER_RUNS_FILE. */
export function _resetKeeperRunsCacheForTests(): void {
  cache = null;
}

/** Persists an escalated run (status must be 'escalated' -- see docs/JEV.md's attest gate). No-op if the
 *  gate wasn't actually asked (jevGate is only set when the gate ran -- see runKeeper). */
export async function recordEscalatedRun(result: KeeperRunResult): Promise<void> {
  if (result.status !== 'escalated' || !result.jevGate) return;
  const id = randomUUID();
  const gate = result.jevGate;

  const db = getDb();
  if (db) {
    try {
      await db.insert(keeperRuns).values({
        id,
        referenceEventId: result.referenceEventId,
        eventId: result.eventId,
        status: 'escalated',
        jevDecision: gate.decision,
        jevConfidence: gate.confidence,
        jevReason: gate.reason,
        jevProbabilities: gate.probabilities,
      });
      return;
    } catch (err) {
      console.warn('[keeper-runs] failed to record escalated run in DB', result.eventId, err);
      return;
    }
  }

  const data = load();
  data.runs.unshift({
    id,
    referenceEventId: result.referenceEventId,
    eventId: result.eventId,
    status: 'escalated',
    jevDecision: gate.decision,
    jevConfidence: gate.confidence,
    jevReason: gate.reason,
    jevProbabilities: gate.probabilities,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  });
  persist(data);
}

/** Runs still awaiting co-op review, newest first. */
export async function listEscalatedRuns(): Promise<EscalatedRun[]> {
  const db = getDb();
  if (db) {
    const rows = await db
      .select()
      .from(keeperRuns)
      .where(eq(keeperRuns.status, 'escalated'))
      .orderBy(desc(keeperRuns.createdAt));
    return rows.map((r) => ({
      id: r.id,
      referenceEventId: r.referenceEventId,
      eventId: r.eventId,
      status: r.status as 'escalated' | 'resolved',
      jevDecision: r.jevDecision,
      jevConfidence: r.jevConfidence,
      jevReason: r.jevReason,
      jevProbabilities: r.jevProbabilities,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    }));
  }
  const data = load();
  return data.runs.filter((r) => r.status === 'escalated');
}

/** Marks every escalated row for this eventId resolved (the co-op approved + force-replayed it). */
export async function resolveEscalatedRuns(eventId: string): Promise<void> {
  const db = getDb();
  if (db) {
    try {
      await db
        .update(keeperRuns)
        .set({ status: 'resolved', resolvedAt: new Date() })
        .where(eq(keeperRuns.eventId, eventId));
      return;
    } catch (err) {
      console.warn('[keeper-runs] failed to resolve escalated run in DB', eventId, err);
      return;
    }
  }
  const data = load();
  const now = new Date().toISOString();
  for (const run of data.runs) {
    if (run.eventId === eventId && run.status === 'escalated') {
      run.status = 'resolved';
      run.resolvedAt = now;
    }
  }
  persist(data);
}
