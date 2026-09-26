import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';

// This only exercises the Next.js adapter wiring (Request in, Response out, cookie set on success). The
// actual SIWE verification logic is covered exhaustively in lib/wallet-auth.test.ts and lib/siwe.test.ts
// with real signed messages -- these bodies fail validation before any signature check happens.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';

import { POST } from './route';

function postReq(body: unknown, host = 'localhost'): NextRequest {
  return new NextRequest(`http://${host}/api/wallet-auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/wallet-auth/verify (adapter)', () => {
  test('rejects a malformed body', async () => {
    const res = await POST(postReq({ nope: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
    expect(res.cookies.get('umi_session')).toBeUndefined();
  });

  test('rejects invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/wallet-auth/verify', { method: 'POST', body: 'not json' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
