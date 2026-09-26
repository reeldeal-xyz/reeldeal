import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GET } from './route';

const ORIGINAL_URL = process.env.MULTIBAAS_URL;
const ORIGINAL_KEY = process.env.MULTIBAAS_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;

function restoreEnv() {
  if (ORIGINAL_URL === undefined) delete process.env.MULTIBAAS_URL;
  else process.env.MULTIBAAS_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.MULTIBAAS_API_KEY;
  else process.env.MULTIBAAS_API_KEY = ORIGINAL_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
}

describe('GET /api/multibaas/events', () => {
  beforeEach(() => {
    delete process.env.MULTIBAAS_URL;
    delete process.env.MULTIBAAS_API_KEY;
  });

  afterEach(() => {
    restoreEnv();
  });

  test('falls back gracefully when MultiBaas is not configured', async () => {
    const req = new Request('http://localhost/api/multibaas/events');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { configured: boolean; events: unknown[] };
    expect(json).toEqual({ configured: false, events: [] });
  });

  test('queries MultiBaas and returns mapped events when configured', async () => {
    process.env.MULTIBAAS_URL = 'https://example.multibaas.com';
    process.env.MULTIBAAS_API_KEY = 'test-key';

    let capturedUrl: string | undefined;
    globalThis.fetch = (async (input: string | URL) => {
      capturedUrl = input.toString();
      return new Response(
        JSON.stringify({
          status: 200,
          message: 'success',
          result: [
            {
              triggeredAt: '2026-09-26T00:00:00Z',
              event: {
                name: 'Donated',
                signature: 'Donated(address,uint256,string)',
                inputs: [{ name: 'from', value: '0xdonor', hashed: false, type: 'address' }],
                contract: { address: '0xreliefpool', name: 'ReliefPool', label: 'reliefpool' },
                indexInLog: 0,
              },
              transaction: {
                from: '0xdonor',
                txHash: '0xtxhash',
                txIndexInBlock: 0,
                blockHash: '0xblockhash',
                blockNumber: 10,
                contract: { address: '0xreliefpool', name: 'ReliefPool', label: 'reliefpool' },
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const req = new Request('http://localhost/api/multibaas/events?contract=reliefpool&limit=5');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(capturedUrl).toBe('https://example.multibaas.com/api/v0/events?contractLabel=reliefpool&limit=5');
    const json = (await res.json()) as { configured: boolean; events: Array<{ name: string }> };
    expect(json.configured).toBe(true);
    expect(json.events).toHaveLength(1);
    expect(json.events[0]?.name).toBe('Donated');
  });

  test('returns 502 with an empty list when the MultiBaas query fails', async () => {
    process.env.MULTIBAAS_URL = 'https://example.multibaas.com';
    process.env.MULTIBAAS_API_KEY = 'test-key';
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;

    const req = new Request('http://localhost/api/multibaas/events');
    const res = await GET(req);

    expect(res.status).toBe(502);
    const json = (await res.json()) as { configured: boolean; events: unknown[] };
    expect(json.configured).toBe(true);
    expect(json.events).toEqual([]);
  });

  test('clamps an out-of-range limit', async () => {
    process.env.MULTIBAAS_URL = 'https://example.multibaas.com';
    process.env.MULTIBAAS_API_KEY = 'test-key';

    let capturedUrl: string | undefined;
    globalThis.fetch = (async (input: string | URL) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ status: 200, message: 'success', result: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const req = new Request('http://localhost/api/multibaas/events?limit=9999');
    await GET(req);
    expect(capturedUrl).toBe('https://example.multibaas.com/api/v0/events?limit=100');
  });
});
