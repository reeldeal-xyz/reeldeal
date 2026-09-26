import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _resetPayoutDirectoryCacheForTests,
  bindWalletToLineUser,
  payoutDirectory,
  recordPlotWallet,
} from './payout-directory';

const dir = mkdtempSync(join(tmpdir(), 'umi-payout-directory-'));
const file = join(dir, 'payout-directory.json');
const originalEnv = process.env.PAYOUT_DIRECTORY_FILE;

beforeEach(() => {
  process.env.PAYOUT_DIRECTORY_FILE = file;
  _resetPayoutDirectoryCacheForTests();
});

afterEach(() => {
  _resetPayoutDirectoryCacheForTests();
});

afterAll(() => {
  process.env.PAYOUT_DIRECTORY_FILE = originalEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe('payoutDirectory', () => {
  test('lineUserIdForWallet is null until bindWalletToLineUser is called (issue #15 not landed)', async () => {
    expect(await payoutDirectory.lineUserIdForWallet('0xAAA')).toBeNull();
    await bindWalletToLineUser('0xAAA', 'U1');
    expect(await payoutDirectory.lineUserIdForWallet('0xAAA')).toBe('U1');
  });

  test('wallet lookup is case-insensitive', async () => {
    await bindWalletToLineUser('0xABCDEF0000000000000000000000000000000000', 'U2');
    expect(await payoutDirectory.lineUserIdForWallet('0xabcdef0000000000000000000000000000000000')).toBe('U2');
  });

  test('lineUserIdForPlot composes plotWallet + walletLine (the keeper knows the wallet before #15 binds it)', async () => {
    expect(await payoutDirectory.lineUserIdForPlot('p1213-017')).toBeNull();

    await recordPlotWallet('p1213-017', '0xFARMER0000000000000000000000000000000000');
    // Known wallet, but not yet bound to a LINE user -- still null.
    expect(await payoutDirectory.lineUserIdForPlot('p1213-017')).toBeNull();

    await bindWalletToLineUser('0xFARMER0000000000000000000000000000000000', 'U3');
    expect(await payoutDirectory.lineUserIdForPlot('p1213-017')).toBe('U3');
  });

  test('persists to disk and survives a cache reset (new process would see it too)', async () => {
    await recordPlotWallet('p-persist', '0xPERSIST000000000000000000000000000000000');
    await bindWalletToLineUser('0xPERSIST000000000000000000000000000000000', 'U4');

    _resetPayoutDirectoryCacheForTests(); // simulates a fresh read, e.g. a new serverless invocation

    expect(await payoutDirectory.lineUserIdForPlot('p-persist')).toBe('U4');
  });

  test('recordPlotWallet overwrites a stale mapping (plot changed farmer)', async () => {
    await recordPlotWallet('p1', '0x1111111111111111111111111111111111111111');
    await bindWalletToLineUser('0x1111111111111111111111111111111111111111', 'OLD-FARMER');
    expect(await payoutDirectory.lineUserIdForPlot('p1')).toBe('OLD-FARMER');

    await recordPlotWallet('p1', '0x2222222222222222222222222222222222222222');
    await bindWalletToLineUser('0x2222222222222222222222222222222222222222', 'NEW-FARMER');
    expect(await payoutDirectory.lineUserIdForPlot('p1')).toBe('NEW-FARMER');
  });
});
