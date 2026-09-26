import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { KeeperRunResult } from '@/lib/keeper/run';

const PASSCODE = 'test-coop-passcode';

const runKeeperMock = mock(
  async (_opts: { referenceEventId: string; force?: boolean }): Promise<KeeperRunResult> => ({
    referenceEventId: '2023-scallop-tier2',
    eventId: '0xevent' as `0x${string}`,
    triggerSource: 'feed' as const,
    dryRun: false,
    alreadyAttested: false,
    attestTxHash: '0xattest' as `0x${string}`,
    eligiblePlots: ['p1'],
    unsettledPlots: [],
    settleTxHashes: [],
    plotOutcomes: [],
    pushes: [],
    status: 'ok' as const,
  }),
);
const resolveEscalatedRunsMock = mock(async (_eventId: string) => {});

mock.module('@/lib/keeper/run', () => ({ runKeeper: runKeeperMock }));
mock.module('@/lib/keeper-runs', () => ({ resolveEscalatedRuns: resolveEscalatedRunsMock }));

const { POST } = await import('./route');

function request(body: unknown): Request {
  return new Request('http://localhost/api/coop/approve-attest', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/coop/approve-attest', () => {
  let originalPasscode: string | undefined;

  beforeAll(() => {
    originalPasscode = process.env.COOP_PASSCODE;
    process.env.COOP_PASSCODE = PASSCODE;
  });

  afterAll(() => {
    process.env.COOP_PASSCODE = originalPasscode;
  });

  beforeEach(() => {
    runKeeperMock.mockClear();
    resolveEscalatedRunsMock.mockClear();
  });

  test('rejects a missing or wrong passcode without calling runKeeper', async () => {
    const res = await POST(request({ event: '2023-scallop-tier2', passcode: 'wrong' }));
    expect(res.status).toBe(401);
    expect(runKeeperMock).not.toHaveBeenCalled();
  });

  test('rejects when COOP_PASSCODE is unset server-side (fail closed)', async () => {
    process.env.COOP_PASSCODE = '';
    const res = await POST(request({ event: '2023-scallop-tier2', passcode: '' }));
    expect(res.status).toBe(401);
    process.env.COOP_PASSCODE = PASSCODE;
  });

  test('requires an event id', async () => {
    const res = await POST(request({ passcode: PASSCODE }));
    expect(res.status).toBe(400);
  });

  test('calls runKeeper with force:true and resolves the escalated run on success', async () => {
    const res = await POST(request({ event: '2023-scallop-tier2', passcode: PASSCODE }));
    expect(res.status).toBe(200);
    expect(runKeeperMock).toHaveBeenCalledWith({ referenceEventId: '2023-scallop-tier2', force: true });
    expect(resolveEscalatedRunsMock).toHaveBeenCalledWith('0xevent');

    const json = (await res.json()) as { ok: boolean; attestTxHash?: string };
    expect(json.ok).toBe(true);
    expect(json.attestTxHash).toBe('0xattest');
  });

  test('never exposes KEEPER_API_TOKEN to the request/response', async () => {
    const res = await POST(request({ event: '2023-scallop-tier2', passcode: PASSCODE }));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('KEEPER_API_TOKEN');
  });
});
