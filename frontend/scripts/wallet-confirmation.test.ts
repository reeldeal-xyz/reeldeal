/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { PublicClient } from 'viem';
import { confirmTransaction } from '../src/lib/chain/wallet.client';

const HASH = `0x${'a'.repeat(64)}` as const;

describe('confirmTransaction', () => {
  test('requires the requested confirmation depth and reports current depth', async () => {
    let request: unknown;
    const reader = {
      waitForTransactionReceipt: async (args: unknown) => {
        request = args;
        return { status: 'success', blockNumber: 100n };
      },
      getBlockNumber: async () => 102n,
    } as unknown as Pick<PublicClient, 'waitForTransactionReceipt' | 'getBlockNumber'>;

    const confirmed = await confirmTransaction(reader, HASH, 'failed', 2);
    expect(request).toMatchObject({ hash: HASH, confirmations: 2, timeout: 180_000 });
    expect(confirmed).toEqual({ blockNumber: '100', confirmations: 3 });
  });

  test('never promotes a reverted receipt to confirmed', async () => {
    const reader = {
      waitForTransactionReceipt: async () => ({ status: 'reverted', blockNumber: 100n }),
      getBlockNumber: async () => 100n,
    } as unknown as Pick<PublicClient, 'waitForTransactionReceipt' | 'getBlockNumber'>;

    await expect(confirmTransaction(reader, HASH, 'transaction reverted')).rejects.toThrow('transaction reverted');
  });
});
