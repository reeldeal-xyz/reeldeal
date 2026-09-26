import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GET } from './route';

const ORIGINAL_URL = process.env.MULTIBAAS_URL;
const ORIGINAL_KEY = process.env.MULTIBAAS_API_KEY;
const ORIGINAL_POOL = process.env.RELIEF_POOL_ADDRESS;
const ORIGINAL_RPC = process.env.SEPOLIA_RPC_URL;
const ORIGINAL_FETCH = globalThis.fetch;

function restoreEnv() {
  if (ORIGINAL_URL === undefined) delete process.env.MULTIBAAS_URL;
  else process.env.MULTIBAAS_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.MULTIBAAS_API_KEY;
  else process.env.MULTIBAAS_API_KEY = ORIGINAL_KEY;
  if (ORIGINAL_POOL === undefined) delete process.env.RELIEF_POOL_ADDRESS;
  else process.env.RELIEF_POOL_ADDRESS = ORIGINAL_POOL;
  if (ORIGINAL_RPC === undefined) delete process.env.SEPOLIA_RPC_URL;
  else process.env.SEPOLIA_RPC_URL = ORIGINAL_RPC;
  globalThis.fetch = ORIGINAL_FETCH;
}

// Every test here runs with RELIEF_POOL_ADDRESS/SEPOLIA_RPC_URL unset (see restoreEnv/beforeEach): the
// pool JPYC balance read and the direct-viem-log fallback both need those, so leaving them unset keeps
// this file deterministic and network-free. web/src/lib/fund-activity.test.ts covers the pure
// totals/marketplace-memo logic; the live viem fallback path is exercised only by run.anvil.test.ts-style
// manual/integration testing, not here.
describe('GET /api/multibaas/events (Fund activity panel data source)', () => {
  beforeEach(() => {
    delete process.env.MULTIBAAS_URL;
    delete process.env.MULTIBAAS_API_KEY;
    delete process.env.RELIEF_POOL_ADDRESS;
    delete process.env.SEPOLIA_RPC_URL;
  });

  afterEach(() => {
    restoreEnv();
  });

  test('falls back to "unavailable" when neither MultiBaas nor a pool address/RPC is configured', async () => {
    const req = new Request('http://localhost/api/multibaas/events');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { configured: boolean; source: string; events: unknown[]; totals: unknown };
    expect(json).toEqual({ configured: false, source: 'unavailable', events: [], totals: null });
  });

  test('queries MultiBaas with the reliefpool alias and returns mapped events + totals when configured', async () => {
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
                inputs: [
                  { name: 'from', value: '0xdonor', hashed: false, type: 'address' },
                  { name: 'amount', value: '20000000000000000000000', hashed: false, type: 'uint256' },
                  { name: 'memo', value: 'sale:42', hashed: false, type: 'string' },
                ],
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

    const req = new Request('http://localhost/api/multibaas/events?limit=5');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(capturedUrl).toBe('https://example.multibaas.com/api/v0/events?contractLabel=reliefpool&limit=5');
    const json = (await res.json()) as {
      configured: boolean;
      source: string;
      events: Array<{ type: string; isMarketplaceSale?: boolean }>;
      totals: { donatedWei: string; availableWei: string | null };
    };
    expect(json.configured).toBe(true);
    expect(json.source).toBe('multibaas');
    expect(json.events).toHaveLength(1);
    expect(json.events[0]?.type).toBe('Donated');
    expect(json.events[0]?.isMarketplaceSale).toBe(true);
    expect(json.totals.donatedWei).toBe('20000000000000000000000');
    expect(json.totals.availableWei).toBeNull(); // no pool address/RPC configured in this test
  });

  test('falls back to "unavailable" (no RPC to read logs from) when the MultiBaas query fails', async () => {
    process.env.MULTIBAAS_URL = 'https://example.multibaas.com';
    process.env.MULTIBAAS_API_KEY = 'test-key';
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;

    const req = new Request('http://localhost/api/multibaas/events');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { configured: boolean; source: string; events: unknown[] };
    expect(json.configured).toBe(true);
    expect(json.source).toBe('unavailable');
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
    expect(capturedUrl).toBe('https://example.multibaas.com/api/v0/events?contractLabel=reliefpool&limit=50');
  });
});
