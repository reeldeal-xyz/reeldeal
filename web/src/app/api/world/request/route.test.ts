import { describe, expect, test } from 'bun:test';

process.env.WORLD_APP_ID = 'app_test1234567890';
process.env.WORLD_RP_ID = 'rp_test1234567890';
process.env.WORLD_RP_SIGNING_KEY = '22'.repeat(32);
process.env.WORLD_ACTION = 'bind-payout-wallet';
process.env.WORLD_ACTION_L2 = 'upgrade-level-2';
process.env.WORLD_ENVIRONMENT = 'production';

import { POST } from './route';

describe('POST /api/world/request', () => {
  test('rejects an invalid level', async () => {
    const req = new Request('http://localhost/api/world/request', {
      method: 'POST',
      body: JSON.stringify({ level: 'nope' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test('rejects a missing body', async () => {
    const req = new Request('http://localhost/api/world/request', { method: 'POST', body: 'not json' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test('returns a signed request context for level1', async () => {
    const req = new Request('http://localhost/api/world/request', {
      method: 'POST',
      body: JSON.stringify({ level: 'level1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { action: string; app_id: string; rp_context: { rp_id: string } };
    expect(body.action).toBe('bind-payout-wallet');
    expect(body.app_id).toBe('app_test1234567890');
    expect(body.rp_context.rp_id).toBe('rp_test1234567890');
  });

  test('returns a signed request context for level2', async () => {
    const req = new Request('http://localhost/api/world/request', {
      method: 'POST',
      body: JSON.stringify({ level: 'level2' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { action: string };
    expect(body.action).toBe('upgrade-level-2');
  });
});
