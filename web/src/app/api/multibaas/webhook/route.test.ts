import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createHmac } from 'node:crypto';

const SECRET = 'test-webhook-secret';

const pushPaidMock = mock(async () => {});
const pushHeldMock = mock(async () => {});
const lineUserIdForWalletMock = mock(async (_wallet: string): Promise<string | null> => null);
const lineUserIdForPlotMock = mock(async (_plotLabel: string): Promise<string | null> => null);

mock.module('@/lib/line', () => ({
  pushPaid: pushPaidMock,
  pushHeld: pushHeldMock,
}));

// Preserve every other real export (bindWalletToLineUser, recordPlotWallet, _resetPayoutDirectoryCacheForTests)
// rather than replacing the whole module -- bun's `mock.module` swaps the module registry entry for the rest
// of this test process (it isn't scoped to this file), so dropping them here would break any later-loaded
// file that statically imports them by name (issue #15's app/api/liff/* routes do).
const realPayoutDirectory = await import('@/lib/payout-directory');

mock.module('@/lib/payout-directory', () => ({
  ...realPayoutDirectory,
  payoutDirectory: {
    lineUserIdForWallet: lineUserIdForWalletMock,
    lineUserIdForPlot: lineUserIdForPlotMock,
  },
}));

const { POST } = await import('./route');

function sign(body: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(body).update(timestamp).digest('hex');
}

function signedRequest(payload: unknown, opts: { secret?: string; timestamp?: string } = {}): Request {
  const body = JSON.stringify(payload);
  const timestamp = opts.timestamp ?? '1700000000';
  const signature = sign(body, timestamp, opts.secret ?? SECRET);
  return new Request('http://localhost/api/multibaas/webhook', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-multibaas-signature': signature,
      'x-multibaas-timestamp': timestamp,
    },
  });
}

function paidItem(overrides: Partial<Record<'eventId' | 'plotLabel' | 'farmer' | 'nullifier' | 'amount', string>> = {}) {
  return {
    id: 'evt-1',
    event: 'event.emitted' as const,
    data: {
      triggeredAt: '2026-09-26T00:00:00Z',
      event: {
        name: 'Paid',
        signature: 'Paid(bytes32,string,address,bytes32,uint256)',
        inputs: [
          { name: 'eventId', value: overrides.eventId ?? '0xevent1', hashed: false, type: 'bytes32' },
          { name: 'plotLabel', value: overrides.plotLabel ?? 'p1213-017', hashed: false, type: 'string' },
          {
            name: 'farmer',
            value: overrides.farmer ?? '0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172',
            hashed: false,
            type: 'address',
          },
          { name: 'nullifier', value: overrides.nullifier ?? '0xnullifier', hashed: false, type: 'bytes32' },
          { name: 'amount', value: overrides.amount ?? '20000000000000000000000', hashed: false, type: 'uint256' },
        ],
        contract: { address: '0xreliefpool', name: 'ReliefPool', label: 'reliefpool' },
        indexInLog: 0,
      },
      transaction: {
        from: '0xkeeper',
        txHash: '0xtxhash',
        txIndexInBlock: 0,
        blockHash: '0xblockhash',
        blockNumber: 42,
        contract: { address: '0xreliefpool', name: 'ReliefPool', label: 'reliefpool' },
      },
    },
  };
}

function heldItem(overrides: Partial<Record<'eventId' | 'plotLabel' | 'reason', string>> = {}) {
  return {
    id: 'evt-2',
    event: 'event.emitted' as const,
    data: {
      triggeredAt: '2026-09-26T00:00:00Z',
      event: {
        name: 'Held',
        signature: 'Held(bytes32,string,bytes32)',
        inputs: [
          { name: 'eventId', value: overrides.eventId ?? '0xevent1', hashed: false, type: 'bytes32' },
          { name: 'plotLabel', value: overrides.plotLabel ?? 'p1213-017', hashed: false, type: 'string' },
          { name: 'reason', value: overrides.reason ?? 'UNVERIFIED', hashed: false, type: 'bytes32' },
        ],
        contract: { address: '0xreliefpool', name: 'ReliefPool', label: 'reliefpool' },
        indexInLog: 0,
      },
      transaction: {
        from: '0xkeeper',
        txHash: '0xtxhash',
        txIndexInBlock: 0,
        blockHash: '0xblockhash',
        blockNumber: 43,
        contract: { address: '0xreliefpool', name: 'ReliefPool', label: 'reliefpool' },
      },
    },
  };
}

function donatedItem() {
  return {
    id: 'evt-3',
    event: 'event.emitted' as const,
    data: {
      triggeredAt: '2026-09-26T00:00:00Z',
      event: {
        name: 'Donated',
        signature: 'Donated(address,uint256,string)',
        inputs: [
          { name: 'from', value: '0xdonor', hashed: false, type: 'address' },
          { name: 'amount', value: '5000000000000000000000', hashed: false, type: 'uint256' },
          { name: 'memo', value: 'gambatte', hashed: false, type: 'string' },
        ],
        contract: { address: '0xreliefpool', name: 'ReliefPool', label: 'reliefpool' },
        indexInLog: 0,
      },
      transaction: {
        from: '0xdonor',
        txHash: '0xtxhash2',
        txIndexInBlock: 0,
        blockHash: '0xblockhash2',
        blockNumber: 44,
        contract: { address: '0xreliefpool', name: 'ReliefPool', label: 'reliefpool' },
      },
    },
  };
}

describe('POST /api/multibaas/webhook', () => {
  let originalSecret: string | undefined;

  beforeAll(() => {
    originalSecret = process.env.MULTIBAAS_WEBHOOK_SECRET;
    process.env.MULTIBAAS_WEBHOOK_SECRET = SECRET;
  });

  afterAll(() => {
    process.env.MULTIBAAS_WEBHOOK_SECRET = originalSecret;
  });

  beforeEach(() => {
    pushPaidMock.mockClear();
    pushHeldMock.mockClear();
    lineUserIdForWalletMock.mockClear();
    lineUserIdForPlotMock.mockClear();
    lineUserIdForWalletMock.mockImplementation(async () => null);
    lineUserIdForPlotMock.mockImplementation(async () => null);
  });

  afterEach(() => {
    lineUserIdForWalletMock.mockReset();
    lineUserIdForPlotMock.mockReset();
  });

  test('rejects a request with no signature header', async () => {
    const body = JSON.stringify([paidItem()]);
    const req = new Request('http://localhost/api/multibaas/webhook', { method: 'POST', body });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('rejects a request signed with the wrong secret', async () => {
    const req = signedRequest([paidItem()], { secret: 'wrong-secret' });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(pushPaidMock).not.toHaveBeenCalled();
  });

  test('rejects a tampered timestamp', async () => {
    const body = JSON.stringify([paidItem()]);
    const signature = sign(body, '1700000000', SECRET);
    const req = new Request('http://localhost/api/multibaas/webhook', {
      method: 'POST',
      body,
      headers: { 'x-multibaas-signature': signature, 'x-multibaas-timestamp': '1700000099' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('routes a Paid event to pushPaid when a LINE mapping exists', async () => {
    lineUserIdForWalletMock.mockImplementation(async () => 'U1234567890');
    const req = signedRequest([paidItem()]);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; processed: number };
    expect(json).toEqual({ ok: true, processed: 1 });

    expect(lineUserIdForWalletMock).toHaveBeenCalledWith('0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172');
    expect(pushPaidMock).toHaveBeenCalledTimes(1);
    expect(pushPaidMock).toHaveBeenCalledWith(
      'U1234567890',
      expect.objectContaining({ plotCode: 'p1213-017', amountWei: 20000000000000000000000n }),
    );
  });

  test('does not push a Paid event when there is no LINE mapping yet', async () => {
    const req = signedRequest([paidItem()]);
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(pushPaidMock).not.toHaveBeenCalled();
  });

  test('routes a Held event to pushHeld when a LINE mapping exists', async () => {
    lineUserIdForPlotMock.mockImplementation(async () => 'U9999999999');
    const req = signedRequest([heldItem()]);
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(lineUserIdForPlotMock).toHaveBeenCalledWith('p1213-017');
    expect(pushHeldMock).toHaveBeenCalledTimes(1);
    expect(pushHeldMock).toHaveBeenCalledWith(
      'U9999999999',
      expect.objectContaining({ plotCode: 'p1213-017', reasonEn: 'Verify your identity to receive the payout.' }),
    );
  });

  test('processes Donated events without pushing to LINE', async () => {
    const req = signedRequest([donatedItem()]);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; processed: number };
    expect(json).toEqual({ ok: true, processed: 1 });
    expect(pushPaidMock).not.toHaveBeenCalled();
    expect(pushHeldMock).not.toHaveBeenCalled();
  });

  test('handles a batch mixing multiple event types in one delivery', async () => {
    lineUserIdForWalletMock.mockImplementation(async () => 'U1');
    lineUserIdForPlotMock.mockImplementation(async () => 'U2');
    const req = signedRequest([paidItem(), heldItem({ eventId: '0xevent2' }), donatedItem()]);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; processed: number };
    expect(json.processed).toBe(3);
    expect(pushPaidMock).toHaveBeenCalledTimes(1);
    expect(pushHeldMock).toHaveBeenCalledTimes(1);
  });

  test('rejects malformed JSON with 400', async () => {
    const body = 'not json';
    const timestamp = '1700000000';
    const signature = sign(body, timestamp, SECRET);
    const req = new Request('http://localhost/api/multibaas/webhook', {
      method: 'POST',
      body,
      headers: { 'x-multibaas-signature': signature, 'x-multibaas-timestamp': timestamp },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test('ignores transaction.included items and unknown event names', async () => {
    const req = signedRequest([
      { id: 'tx-1', event: 'transaction.included', data: {} },
      {
        id: 'evt-4',
        event: 'event.emitted',
        data: {
          triggeredAt: '2026-09-26T00:00:00Z',
          event: {
            name: 'Enrolled',
            signature: 'Enrolled(string,bytes32,bytes32)',
            inputs: [],
            contract: { address: '0xreliefpool', name: 'ReliefPool', label: 'reliefpool' },
            indexInLog: 0,
          },
          transaction: {
            from: '0xfarmer',
            txHash: '0xtxhash3',
            txIndexInBlock: 0,
            blockHash: '0xblockhash3',
            blockNumber: 45,
            contract: { address: '0xreliefpool', name: 'ReliefPool', label: 'reliefpool' },
          },
        },
      },
    ]);
    const res = await POST(req);
    const json = (await res.json()) as { ok: boolean; processed: number };
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, processed: 0 });
  });
});
