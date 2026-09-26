import { describe, expect, test } from 'bun:test';
import { ContractFunctionRevertedError, encodeErrorResult, pad, type Address, type Hex } from 'viem';
import { ReliefPoolAbi } from '@repo/shared';
import { handleClaim, type HandleClaimDeps } from './claim';

const POOL = '0x1111111111111111111111111111111111111111' as Address;
const EVENT_ID = pad('0xabc' as Hex, { size: 32 });
const PLOT = 'p1213-001';
const VALID_BODY = { eventId: EVENT_ID, plotLabel: PLOT };

function makeDeps(overrides: {
  simulateContract?: (args: unknown) => Promise<unknown>;
  writeContract?: () => Promise<Hex>;
  poolAddress?: Address | undefined;
} = {}): { deps: HandleClaimDeps; calls: { simulate: unknown[]; write: unknown[] } } {
  const calls = { simulate: [] as unknown[], write: [] as unknown[] };

  const simulateContract =
    overrides.simulateContract ??
    (async (args: unknown) => {
      calls.simulate.push(args);
      return { request: args };
    });
  const writeContract =
    overrides.writeContract ??
    (async (args: unknown) => {
      calls.write.push(args);
      return '0x' + '22'.repeat(32);
    });

  const deps: HandleClaimDeps = {
    poolAddress: 'poolAddress' in overrides ? overrides.poolAddress : POOL,
    getChainClients: () => ({
      publicClient: {
        simulateContract: simulateContract as never,
        waitForTransactionReceipt: (async () => ({ status: 'success' })) as never,
      },
      walletClient: { writeContract: writeContract as never },
      account: { address: '0x9999999999999999999999999999999999999999', type: 'json-rpc' } as never,
    }),
  };

  return { deps, calls };
}

describe('handleClaim', () => {
  test('rejects an invalid body', async () => {
    const { deps } = makeDeps();
    const res = await handleClaim({ nope: true }, deps);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('rejects a non-hex eventId', async () => {
    const { deps } = makeDeps();
    const res = await handleClaim({ eventId: 'not-hex', plotLabel: PLOT }, deps);
    expect(res.status).toBe(400);
  });

  test('returns 503 when ReliefPool is not deployed yet', async () => {
    const { deps } = makeDeps({ poolAddress: undefined });
    const res = await handleClaim(VALID_BODY, deps);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('not_deployed');
  });

  test('calls claimHeld and returns the tx hash on success', async () => {
    const { deps, calls } = makeDeps();
    const res = await handleClaim(VALID_BODY, deps);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.txHash).toBe('0x' + '22'.repeat(32));
    expect(calls.simulate).toHaveLength(1);
    const simArgs = calls.simulate[0] as { functionName: string; args: unknown[] };
    expect(simArgs.functionName).toBe('claimHeld');
    expect(simArgs.args).toEqual([EVENT_ID, PLOT]);
  });

  test('maps a StillIneligible revert to a 409 with a clear message', async () => {
    const data = encodeErrorResult({
      abi: ReliefPoolAbi,
      errorName: 'StillIneligible',
      args: [EVENT_ID, PLOT, pad('0x1' as Hex, { size: 32 })],
    });
    const { deps } = makeDeps({
      simulateContract: async () => {
        throw new ContractFunctionRevertedError({ abi: ReliefPoolAbi, data, functionName: 'claimHeld' });
      },
    });
    const res = await handleClaim(VALID_BODY, deps);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('StillIneligible');
    expect(res.body.message).toContain('World ID');
  });

  test('maps a ClaimWindowElapsed revert to a 409', async () => {
    const data = encodeErrorResult({
      abi: ReliefPoolAbi,
      errorName: 'ClaimWindowElapsed',
      args: [0n, 0n],
    });
    const { deps } = makeDeps({
      simulateContract: async () => {
        throw new ContractFunctionRevertedError({ abi: ReliefPoolAbi, data, functionName: 'claimHeld' });
      },
    });
    const res = await handleClaim(VALID_BODY, deps);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ClaimWindowElapsed');
  });

  test('maps an unexpected failure to a 502', async () => {
    const { deps } = makeDeps({
      simulateContract: async () => {
        throw new Error('rpc timeout');
      },
    });
    const res = await handleClaim(VALID_BODY, deps);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('claim_failed');
  });
});
