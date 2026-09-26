import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { NewSlotRequest, SlotRequest } from '@/lib/slot-request-store';
import { handleCreateSlotRequest, handleListMyRequests, type SlotRequestDeps } from './slot-request';

const WALLET = '0x1234567890123456789012345678901234567890';

function makeDeps(): { deps: SlotRequestDeps; requests: SlotRequest[]; binds: [string, string][] } {
  const requests: SlotRequest[] = [];
  const binds: [string, string][] = [];
  const deps: SlotRequestDeps = {
    bindWalletToLineUser: (wallet, lineUserId) => binds.push([wallet, lineUserId]),
    store: {
      list: async () => [...requests],
      create: async (input: NewSlotRequest) => {
        const request: SlotRequest = { id: randomUUID(), requestedAt: new Date().toISOString(), status: 'pending', ...input };
        requests.push(request);
        return request;
      },
    },
  };
  return { deps, requests, binds };
}

describe('handleCreateSlotRequest', () => {
  test('rejects a missing plotLabel', async () => {
    const { deps } = makeDeps();
    const res = await handleCreateSlotRequest({ wallet: WALLET }, 'U1', undefined, deps);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_plot_label');
  });

  test('rejects an invalid wallet', async () => {
    const { deps } = makeDeps();
    const res = await handleCreateSlotRequest({ plotLabel: 'p1213-001', wallet: 'nope' }, 'U1', undefined, deps);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_wallet');
  });

  test('creates a request using the caller-supplied lineUserId/displayName, never a client-supplied one', async () => {
    const { deps, binds } = makeDeps();
    const res = await handleCreateSlotRequest(
      { plotLabel: 'p1213-001', wallet: WALLET, lineUserId: 'attacker-supplied-id' },
      'U-real',
      'Farmer Name',
      deps,
    );
    expect(res.status).toBe(201);
    const { request } = res.body as { request: SlotRequest };
    expect(request.plotLabel).toBe('p1213-001');
    expect(request.farmerAddress).toBe(WALLET);
    expect(request.lineUserId).toBe('U-real');
    expect(request.farmerName).toBe('Farmer Name');
    expect(request.status).toBe('pending');
    // Bound as soon as the wallet + LINE session both exist, not gated behind World ID verification.
    expect(binds).toEqual([[WALLET, 'U-real']]);
  });

  test('is idempotent: re-requesting the same plot for the same caller returns the existing request', async () => {
    const { deps, binds } = makeDeps();
    const first = await handleCreateSlotRequest({ plotLabel: 'p1', wallet: WALLET }, 'U1', undefined, deps);
    const second = await handleCreateSlotRequest({ plotLabel: 'p1', wallet: WALLET }, 'U1', undefined, deps);
    expect(second.status).toBe(200);
    expect((second.body.request as SlotRequest).id).toBe((first.body.request as SlotRequest).id);
    expect(binds).toHaveLength(1); // not re-bound on the idempotent replay
  });

  test('a wallet session (no LINE account) skips the wallet<->LINE push bind', async () => {
    const { deps, binds } = makeDeps();
    const res = await handleCreateSlotRequest({ plotLabel: 'p1213-002', wallet: WALLET }, 'wallet:0xabc', undefined, deps, 'wallet');
    expect(res.status).toBe(201);
    const { request } = res.body as { request: SlotRequest };
    expect(request.lineUserId).toBe('wallet:0xabc'); // still filed under the session's own id for GET's "my requests"
    expect(binds).toEqual([]); // no LINE account exists for this session, so nothing to bind
  });

  test('does not treat a revoked request as an existing one -- a new request can be re-submitted', async () => {
    const { deps, requests } = makeDeps();
    const first = await handleCreateSlotRequest({ plotLabel: 'p1', wallet: WALLET }, 'U1', undefined, deps);
    requests[0]!.status = 'revoked';
    const second = await handleCreateSlotRequest({ plotLabel: 'p1', wallet: WALLET }, 'U1', undefined, deps);
    expect(second.status).toBe(201);
    expect((second.body.request as SlotRequest).id).not.toBe((first.body.request as SlotRequest).id);
  });
});

describe('handleListMyRequests', () => {
  test("only returns the caller's own requests", async () => {
    const { deps } = makeDeps();
    await handleCreateSlotRequest({ plotLabel: 'p1', wallet: WALLET }, 'U1', undefined, deps);
    await handleCreateSlotRequest({ plotLabel: 'p2', wallet: WALLET }, 'U2', undefined, deps);

    const res = await handleListMyRequests('U1', deps);
    expect(res.status).toBe(200);
    const { requests } = res.body as { requests: SlotRequest[] };
    expect(requests).toHaveLength(1);
    expect(requests[0]!.plotLabel).toBe('p1');
  });
});
