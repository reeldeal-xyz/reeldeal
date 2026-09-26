import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

// This only exercises the Next.js adapter wiring (session gate, JSON parsing). The request/idempotency
// logic itself is covered in lib/liff/slot-request.test.ts with an injected store and bindWalletToLineUser.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';

import { createSessionCookie, SESSION_COOKIE_NAME } from '@/lib/session';
import { GET, POST } from './route';

const WALLET = '0x1234567890123456789012345678901234567890';

function sessionCookieHeader(userId: string): string {
  const value = createSessionCookie({ userId, iat: Math.floor(Date.now() / 1000) });
  return `${SESSION_COOKIE_NAME}=${value}`;
}

function postReq(cookie: string | null, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/liff/slot-request', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
    body: JSON.stringify(body),
  });
}

describe('POST /api/liff/slot-request (adapter)', () => {
  test('rejects a request with no session cookie', async () => {
    const res = await POST(postReq(null, { plotLabel: 'p1213-001', wallet: WALLET }));
    expect(res.status).toBe(401);
  });

  test('rejects an invalid wallet once authorized', async () => {
    const res = await POST(postReq(sessionCookieHeader(randomUUID()), { plotLabel: 'p1213-001', wallet: 'not-an-address' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_wallet');
  });

  test('rejects invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/liff/slot-request', {
      method: 'POST',
      headers: { cookie: sessionCookieHeader(randomUUID()) },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/liff/slot-request (adapter)', () => {
  test('rejects a request with no session cookie', async () => {
    const res = await GET(new NextRequest('http://localhost/api/liff/slot-request'));
    expect(res.status).toBe(401);
  });
});
