import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetNotificationLogCacheForTests, claimNotification } from './notification-log';

const dir = mkdtempSync(join(tmpdir(), 'umi-notification-log-'));
const file = join(dir, 'notification-log.json');
const originalEnv = process.env.NOTIFICATION_LOG_FILE;

beforeEach(() => {
  process.env.NOTIFICATION_LOG_FILE = file;
  _resetNotificationLogCacheForTests();
});

afterEach(() => {
  _resetNotificationLogCacheForTests();
});

afterAll(() => {
  process.env.NOTIFICATION_LOG_FILE = originalEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe('claimNotification', () => {
  test('claims a chain event exactly once', async () => {
    expect(await claimNotification('0xabc', 3, 'Paid')).toBe(true);
    expect(await claimNotification('0xabc', 3, 'Paid')).toBe(false);
  });

  test('a different logIndex on the same tx is a distinct chain event', async () => {
    expect(await claimNotification('0xabc', 0, 'Paid')).toBe(true);
    expect(await claimNotification('0xabc', 1, 'Held')).toBe(true);
  });

  test('a different txHash with the same logIndex is a distinct chain event', async () => {
    expect(await claimNotification('0xaaa', 0, 'Paid')).toBe(true);
    expect(await claimNotification('0xbbb', 0, 'Paid')).toBe(true);
  });

  test('persists across a cache reset (simulates a fresh process / redeploy)', async () => {
    expect(await claimNotification('0xpersist', 0, 'Held')).toBe(true);
    _resetNotificationLogCacheForTests();
    expect(await claimNotification('0xpersist', 0, 'Held')).toBe(false);
  });
});
