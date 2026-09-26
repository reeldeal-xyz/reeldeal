import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetPayoutDirectoryCacheForTests, pinWalletForLineUser, walletForLineUser } from '@/lib/payout-directory';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'payout-dir-'));
  process.env.PAYOUT_DIRECTORY_FILE = join(dir, 'dir.json');
  _resetPayoutDirectoryCacheForTests();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('pinWalletForLineUser', () => {
  const A = '0x1aEDC8476f15BdF1Ac742544c58Be3a187eEAB51';
  const B = '0x5a401E5825782DC8c5D3e20df6884F7130195132';

  test('pins the first wallet a LINE user presents', async () => {
    expect(await pinWalletForLineUser('U1', A)).toBe(A.toLowerCase());
    expect(await walletForLineUser('U1')).toBe(A.toLowerCase());
  });
  test('returns the pinned wallet when a new browser context presents a different one', async () => {
    await pinWalletForLineUser('U1', A);
    expect(await pinWalletForLineUser('U1', B)).toBe(A.toLowerCase());
  });
  test('returns null with no pinned wallet and no candidate', async () => {
    expect(await pinWalletForLineUser('U2', null)).toBeNull();
  });
});
