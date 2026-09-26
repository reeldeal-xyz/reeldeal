import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetKeeperRunsCacheForTests, listEscalatedRuns, recordEscalatedRun, resolveEscalatedRuns } from './keeper-runs';
import type { KeeperRunResult } from './keeper/run';

const dir = mkdtempSync(join(tmpdir(), 'umi-keeper-runs-'));
const file = join(dir, 'keeper-runs.json');
const originalEnv = process.env.KEEPER_RUNS_FILE;

beforeEach(() => {
  process.env.KEEPER_RUNS_FILE = file;
  rmSync(file, { force: true }); // each test starts from an empty store
  _resetKeeperRunsCacheForTests();
});

afterEach(() => {
  _resetKeeperRunsCacheForTests();
});

afterAll(() => {
  process.env.KEEPER_RUNS_FILE = originalEnv;
  rmSync(dir, { recursive: true, force: true });
});

function escalatedResult(overrides: Partial<KeeperRunResult> = {}): KeeperRunResult {
  return {
    referenceEventId: '2023-scallop-tier2',
    eventId: '0xevent' as `0x${string}`,
    triggerSource: 'feed',
    dryRun: false,
    alreadyAttested: false,
    eligiblePlots: [],
    unsettledPlots: [],
    settleTxHashes: [],
    plotOutcomes: [],
    pushes: [],
    status: 'escalated',
    jevGate: {
      decision: 'co_op_review',
      confidence: 0.53,
      probabilities: { attest_now: 0.47, co_op_review: 0.53 },
      reason: 'low_confidence',
    },
    ...overrides,
  };
}

describe('recordEscalatedRun / listEscalatedRuns / resolveEscalatedRuns', () => {
  test('does nothing for a non-escalated result (no jevGate)', async () => {
    await recordEscalatedRun({ ...escalatedResult(), status: 'ok', jevGate: undefined });
    expect(await listEscalatedRuns()).toHaveLength(0);
  });

  test('records an escalated run and lists it newest first', async () => {
    await recordEscalatedRun(escalatedResult({ referenceEventId: 'first' }));
    await recordEscalatedRun(escalatedResult({ referenceEventId: 'second' }));

    const runs = await listEscalatedRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0]?.referenceEventId).toBe('second');
    expect(runs[0]?.jevDecision).toBe('co_op_review');
    expect(runs[0]?.jevConfidence).toBe(0.53);
    expect(runs[0]?.jevProbabilities).toEqual({ attest_now: 0.47, co_op_review: 0.53 });
    expect(runs[0]?.status).toBe('escalated');
  });

  test('resolveEscalatedRuns removes a run from the escalated list', async () => {
    await recordEscalatedRun(escalatedResult({ eventId: '0xresolve-me' as `0x${string}` }));
    expect(await listEscalatedRuns()).toHaveLength(1);

    await resolveEscalatedRuns('0xresolve-me');
    expect(await listEscalatedRuns()).toHaveLength(0);
  });

  test('persists across a cache reset', async () => {
    await recordEscalatedRun(escalatedResult({ referenceEventId: 'persisted' }));
    _resetKeeperRunsCacheForTests();
    const runs = await listEscalatedRuns();
    expect(runs.some((r) => r.referenceEventId === 'persisted')).toBe(true);
  });
});
