import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

const TOKEN = 'test-keeper-token';

const runKeeperMock = mock(async (_opts: { referenceEventId: string; dryRun?: boolean }) => ({
  referenceEventId: '2023-scallop-tier2',
  eventId: '0xevent' as `0x${string}`,
  trigger: undefined,
  triggerSource: 'fallback' as const,
  dryRun: false,
  alreadyAttested: false,
  attestTxHash: '0xattest' as `0x${string}`,
  eligiblePlots: ['p1'],
  unsettledPlots: ['p1'],
  settleTxHashes: ['0xsettle' as `0x${string}`],
  plotOutcomes: [{ plotLabel: 'p1', status: 'Paid' as const, amount: 20000000000000000000000n }],
  pushes: [{ plotLabel: 'p1', kind: 'Paid' as const, lineUserId: 'U1', sent: true }],
}));

mock.module('@/lib/keeper/run', () => ({ runKeeper: runKeeperMock }));

const { POST } = await import('./route');

function request(body: unknown, token?: string): Request {
  return new Request('http://localhost/api/keeper/replay', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

describe('POST /api/keeper/replay', () => {
  let originalToken: string | undefined;

  beforeAll(() => {
    originalToken = process.env.KEEPER_API_TOKEN;
    process.env.KEEPER_API_TOKEN = TOKEN;
  });

  afterAll(() => {
    process.env.KEEPER_API_TOKEN = originalToken;
  });

  beforeEach(() => {
    runKeeperMock.mockClear();
  });

  test('rejects a request with no Authorization header', async () => {
    const res = await POST(request({ event: '2023-scallop-tier2' }));
    expect(res.status).toBe(401);
    expect(runKeeperMock).not.toHaveBeenCalled();
  });

  test('rejects the wrong bearer token', async () => {
    const res = await POST(request({ event: '2023-scallop-tier2' }, 'wrong-token'));
    expect(res.status).toBe(401);
  });

  test('rejects a missing event field', async () => {
    const res = await POST(request({}, TOKEN));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; knownEvents: string[] };
    expect(json.error).toBe('missing_event');
    expect(json.knownEvents).toContain('2023-scallop-tier2');
  });

  test('runs the keeper and returns tx hashes for a valid request', async () => {
    const res = await POST(request({ event: '2023-scallop-tier2' }, TOKEN));
    expect(res.status).toBe(200);
    expect(runKeeperMock).toHaveBeenCalledWith({ referenceEventId: '2023-scallop-tier2', dryRun: false });

    const json = (await res.json()) as { ok: boolean; attestTxHash: string; settleTxHashes: string[]; plotOutcomes: { amount?: string }[] };
    expect(json.ok).toBe(true);
    expect(json.attestTxHash).toBe('0xattest');
    expect(json.settleTxHashes).toEqual(['0xsettle']);
    // bigint amount must come back JSON-serializable (as a string).
    expect(json.plotOutcomes[0]!.amount).toBe('20000000000000000000000');
  });

  test('passes dryRun through to the keeper', async () => {
    await POST(request({ event: '2023-scallop-tier2', dryRun: true }, TOKEN));
    expect(runKeeperMock).toHaveBeenCalledWith({ referenceEventId: '2023-scallop-tier2', dryRun: true });
  });

  test('maps an unknown reference event to a 400', async () => {
    runKeeperMock.mockImplementationOnce(async () => {
      throw new Error('unknown reference event "bogus" (known: 2023-scallop-tier2)');
    });
    const res = await POST(request({ event: 'bogus' }, TOKEN));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('unknown_event');
  });

  test('maps an unexpected keeper failure to a 502', async () => {
    runKeeperMock.mockImplementationOnce(async () => {
      throw new Error('RPC timed out');
    });
    const res = await POST(request({ event: '2023-scallop-tier2' }, TOKEN));
    expect(res.status).toBe(502);
  });

  test('rejects malformed JSON with 400', async () => {
    const req = new Request('http://localhost/api/keeper/replay', {
      method: 'POST',
      body: 'not json',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
