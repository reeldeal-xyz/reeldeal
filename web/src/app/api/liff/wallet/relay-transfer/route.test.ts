import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';

// This only exercises the Next.js adapter wiring (session gate, JSON parsing) -- the actual signature/balance/
// rate-limit logic is covered exhaustively in lib/liff/wallet-relay.test.ts with mocked viem clients.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';

import { createSessionCookie, SESSION_COOKIE_NAME } from '@/lib/session';
import { POST } from './route';

function sessionCookieHeader(): string {
  const value = createSessionCookie({ userId: 'U-relay-test', iat: Math.floor(Date.now() / 1000) });
  return `${SESSION_COOKIE_NAME}=${value}`;
}

describe('POST /api/liff/wallet/relay-transfer (adapter)', () => {
  test('rejects a request with no session cookie', async () => {
    const req = new NextRequest('http://localhost/api/liff/wallet/relay-transfer', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  test('rejects an invalid body once authorized (never touches the chain)', async () => {
    const req = new NextRequest('http://localhost/api/liff/wallet/relay-transfer', {
      method: 'POST',
      headers: { cookie: sessionCookieHeader() },
      body: JSON.stringify({ nope: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_request');
  });

  test('rejects invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/liff/wallet/relay-transfer', {
      method: 'POST',
      headers: { cookie: sessionCookieHeader() },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
