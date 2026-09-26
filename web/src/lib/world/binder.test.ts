import { describe, expect, test } from 'bun:test';
import { ContractFunctionRevertedError, encodeErrorResult, pad, zeroHash, type Address, type Hex } from 'viem';
import { HumanRegistryAbi } from '@repo/shared';

process.env.HUMAN_REGISTRY_ADDRESS = '0x1111111111111111111111111111111111111111';

import { bindOrUpgradeOnChain, computeReceiptHash, toNullifierBytes32, WorldBindError, type BinderClients } from './binder';

const WALLET = '0x00000000000000000000000000000000000000aA' as Address;
const NULLIFIER = pad('0xabc123' as Hex, { size: 32 });
const EXISTING_NULLIFIER = pad('0xdead' as Hex, { size: 32 });

function makeClients(overrides: Partial<{
  humanOf: () => Promise<unknown>;
  simulateContract: (args: unknown) => Promise<unknown>;
  writeContract: () => Promise<Hex>;
}> = {}): { clients: BinderClients; calls: { simulate: unknown[]; write: unknown[] } } {
  const calls = { simulate: [] as unknown[], write: [] as unknown[] };

  const readContract = overrides.humanOf ?? (async () => ({
    nullifier: zeroHash,
    schemaId: 0,
    sybilScoreBps: 0,
    verifiedAt: 0n,
    receiptHash: zeroHash,
  }));

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
      return '0x' + '11'.repeat(32);
    });

  const clients: BinderClients = {
    publicClient: {
      readContract: readContract as never,
      simulateContract: simulateContract as never,
      waitForTransactionReceipt: (async () => ({ status: 'success' })) as never,
    },
    walletClient: { writeContract: writeContract as never },
    account: { address: '0x2222222222222222222222222222222222222222', type: 'json-rpc' } as never,
  };

  return { clients, calls };
}

describe('toNullifierBytes32 / computeReceiptHash', () => {
  test('pads a short hex nullifier to 32 bytes', () => {
    const padded = toNullifierBytes32('0xabc123');
    expect(padded.length).toBe(66);
    expect(padded).toBe(pad('0xabc123' as Hex, { size: 32 }));
  });

  test('computeReceiptHash is deterministic for the same inputs', () => {
    const record = { wallet: WALLET, nullifier: NULLIFIER, schemaId: 11, action: 'bind-payout-wallet', verifiedAt: 1000 };
    expect(computeReceiptHash(record)).toBe(computeReceiptHash({ ...record }));
  });
});

describe('bindOrUpgradeOnChain', () => {
  test('calls bind() when the wallet has never been bound', async () => {
    const { clients, calls } = makeClients();
    const result = await bindOrUpgradeOnChain(
      { wallet: WALLET, nullifier: NULLIFIER, schemaId: 11, sybilScoreBps: 10, verifiedAt: 1000, receiptHash: zeroHash },
      clients,
    );
    expect(result.call).toBe('bind');
    expect(calls.simulate).toHaveLength(1);
    const simArgs = calls.simulate[0] as { functionName: string; args: unknown[] };
    expect(simArgs.functionName).toBe('bind');
    expect(simArgs.args[1]).toBe(NULLIFIER);
  });

  test('calls upgrade() with the EXISTING nullifier, not the new proof nullifier, when already bound', async () => {
    const { clients, calls } = makeClients({
      humanOf: async () => ({
        nullifier: EXISTING_NULLIFIER,
        schemaId: 11,
        sybilScoreBps: 10,
        verifiedAt: 500n,
        receiptHash: zeroHash,
      }),
    });
    const result = await bindOrUpgradeOnChain(
      { wallet: WALLET, nullifier: NULLIFIER, schemaId: 1, sybilScoreBps: 0, verifiedAt: 2000, receiptHash: zeroHash },
      clients,
    );
    expect(result.call).toBe('upgrade');
    const simArgs = calls.simulate[0] as { functionName: string; args: unknown[] };
    expect(simArgs.functionName).toBe('upgrade');
    // args: [wallet, nullifier, schemaId, receiptHash] -- must be the wallet's existing nullifier.
    expect(simArgs.args[1]).toBe(EXISTING_NULLIFIER);
    expect(simArgs.args[1]).not.toBe(NULLIFIER);
  });

  test('maps a NullifierAlreadyBound revert to a clear WorldBindError', async () => {
    const data = encodeErrorResult({
      abi: HumanRegistryAbi,
      errorName: 'NullifierAlreadyBound',
      args: ['0x3333333333333333333333333333333333333333'],
    });
    const { clients } = makeClients({
      simulateContract: async () => {
        throw new ContractFunctionRevertedError({ abi: HumanRegistryAbi, data, functionName: 'bind' });
      },
    });

    await expect(
      bindOrUpgradeOnChain(
        { wallet: WALLET, nullifier: NULLIFIER, schemaId: 11, sybilScoreBps: 0, verifiedAt: 1000, receiptHash: zeroHash },
        clients,
      ),
    ).rejects.toMatchObject({ code: 'nullifier_already_bound' });
  });

  test('maps a WalletAlreadyBound revert to a clear WorldBindError', async () => {
    const data = encodeErrorResult({
      abi: HumanRegistryAbi,
      errorName: 'WalletAlreadyBound',
      args: [zeroHash],
    });
    const { clients } = makeClients({
      simulateContract: async () => {
        throw new ContractFunctionRevertedError({ abi: HumanRegistryAbi, data, functionName: 'bind' });
      },
    });

    let caught: unknown;
    try {
      await bindOrUpgradeOnChain(
        { wallet: WALLET, nullifier: NULLIFIER, schemaId: 11, sybilScoreBps: 0, verifiedAt: 1000, receiptHash: zeroHash },
        clients,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WorldBindError);
    expect((caught as WorldBindError).code).toBe('wallet_already_bound');
  });

  test('maps an unrecognized failure to WorldBindError("unexpected")', async () => {
    const { clients } = makeClients({
      simulateContract: async () => {
        throw new Error('rpc timeout');
      },
    });
    await expect(
      bindOrUpgradeOnChain(
        { wallet: WALLET, nullifier: NULLIFIER, schemaId: 11, sybilScoreBps: 0, verifiedAt: 1000, receiptHash: zeroHash },
        clients,
      ),
    ).rejects.toMatchObject({ code: 'unexpected' });
  });
});
