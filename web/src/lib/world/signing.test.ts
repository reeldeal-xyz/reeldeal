import { describe, expect, test } from 'bun:test';

process.env.WORLD_APP_ID = 'app_1234567890abcdef';
process.env.WORLD_RP_ID = 'rp_1234567890abcdef';
process.env.WORLD_RP_SIGNING_KEY = '11'.repeat(32);
process.env.WORLD_ACTION = 'bind-payout-wallet';
process.env.WORLD_ACTION_L2 = 'upgrade-level-2';
process.env.WORLD_ENVIRONMENT = 'production';

import { buildWorldRequestContext } from './signing';

describe('buildWorldRequestContext', () => {
  test('level1 uses WORLD_ACTION and level2 uses WORLD_ACTION_L2', () => {
    const level1 = buildWorldRequestContext('level1');
    expect(level1.action).toBe('bind-payout-wallet');
    expect(level1.app_id).toBe('app_1234567890abcdef');
    expect(level1.environment).toBe('production');
    expect(level1.rp_context.rp_id).toBe('rp_1234567890abcdef');
    expect(typeof level1.rp_context.signature).toBe('string');
    expect(level1.rp_context.expires_at).toBeGreaterThan(level1.rp_context.created_at);

    const level2 = buildWorldRequestContext('level2');
    expect(level2.action).toBe('upgrade-level-2');
  });

  test('never includes the signing key in the returned context', () => {
    const context = buildWorldRequestContext('level1');
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain(process.env.WORLD_RP_SIGNING_KEY);
  });

  test('two calls produce different nonces (not replayable request contexts)', () => {
    const a = buildWorldRequestContext('level1');
    const b = buildWorldRequestContext('level1');
    expect(a.rp_context.nonce).not.toBe(b.rp_context.nonce);
  });

  test('throws when WORLD_APP_ID does not start with app_', () => {
    const prev = process.env.WORLD_APP_ID;
    process.env.WORLD_APP_ID = 'bad_id';
    expect(() => buildWorldRequestContext('level1')).toThrow();
    process.env.WORLD_APP_ID = prev;
  });
});
