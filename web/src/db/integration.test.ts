// Integration test for the `app` schema (db/postgres-plots task): only runs against a real database,
// when DATABASE_URL is set. `bun test` in CI/local dev never sets it (no .env is committed under
// web/), so this file's tests are skipped entirely by default and the rest of the suite keeps
// exercising the JSON-file/in-memory fallback exactly as before.
//
// Caveat if you DO run this locally with DATABASE_URL set: payout-directory.ts and slot-request-store.ts
// resolve their DB-vs-JSON path off the very same env var, so every *other* test file in the same `bun
// test` run also switches to the DB path. Point DATABASE_URL at a disposable/test database when doing
// this, never the shared demo instance -- this file cleans up its own rows, but a full-suite run with a
// live DB touches app.slot_requests/app.wallet_links/app.plot_wallets from other test files too.
//
// Uses plot 'p1213-002' (never 'p1213-001' -- that one carries the task's real seeded
// wallet_links/plot_wallets row for the live-verified test LINE user) and deletes every row it creates.
import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb } from './client';
import { plotWallets, slotRequests, walletLinks } from './schema';
import { payoutDirectory, recordPlotWallet, bindWalletToLineUser, pinWalletForLineUser } from '../lib/payout-directory';
import { slotRequestStore } from '../lib/slot-request-store';

const RUN = Boolean(process.env.DATABASE_URL);

const TEST_PLOT = 'p1213-002';
const TEST_WALLET = '0x9999999999999999999999999999999999999999';
const TEST_LINE_USER = 'integration-test-line-user';

describe.skipIf(!RUN)('app schema integration (DATABASE_URL set)', () => {
  afterAll(async () => {
    if (!RUN) return;
    const db = getDb()!;
    await db.delete(plotWallets).where(eq(plotWallets.plotId, TEST_PLOT));
    await db.delete(walletLinks).where(eq(walletLinks.lineUserId, TEST_LINE_USER));
    await db.delete(slotRequests).where(eq(slotRequests.plotLabel, '__integration_test__'));
  });

  test('recordPlotWallet + bindWalletToLineUser + payoutDirectory round-trip through app.plot_wallets/app.wallet_links', async () => {
    expect(await payoutDirectory.lineUserIdForPlot(TEST_PLOT)).toBeNull();

    await recordPlotWallet(TEST_PLOT, TEST_WALLET);
    expect(await payoutDirectory.lineUserIdForPlot(TEST_PLOT)).toBeNull(); // wallet known, not yet bound

    await bindWalletToLineUser(TEST_WALLET, TEST_LINE_USER);
    expect(await payoutDirectory.lineUserIdForPlot(TEST_PLOT)).toBe(TEST_LINE_USER);
    expect(await payoutDirectory.lineUserIdForWallet(TEST_WALLET)).toBe(TEST_LINE_USER);
  });

  test('pinWalletForLineUser is idempotent (first wallet wins, matching the JSON store)', async () => {
    const first = await pinWalletForLineUser(TEST_LINE_USER, TEST_WALLET);
    expect(first).toBe(TEST_WALLET.toLowerCase());

    const second = await pinWalletForLineUser(TEST_LINE_USER, '0x1111111111111111111111111111111111111111');
    expect(second).toBe(TEST_WALLET.toLowerCase()); // ignores the new candidate; already pinned
  });

  test('slotRequestStore is DB-backed and persists across a fresh read', async () => {
    const created = await slotRequestStore.create({
      plotLabel: '__integration_test__',
      farmerAddress: TEST_WALLET,
      seasonLabel: '2026',
    });
    expect(created.status).toBe('pending');

    const updated = await slotRequestStore.updateStatus(created.id, 'issued');
    expect(updated?.status).toBe('issued');

    const all = await slotRequestStore.list();
    expect(all.some((r) => r.id === created.id && r.status === 'issued')).toBe(true);
  });
});
