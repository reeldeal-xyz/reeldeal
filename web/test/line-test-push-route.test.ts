import { afterEach, beforeEach, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';

process.env.LINE_MESSAGING_CHANNEL_ID = 'test-messaging-channel';
process.env.LINE_CHANNEL_SECRET = 'test-channel-secret';
process.env.SESSION_SECRET = 'test-session-secret';
delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

const { POST } = await import('../src/app/api/line/test-push/route');
const { createSessionCookie, SESSION_COOKIE_NAME } = await import('../src/lib/session');
const { _resetChannelAccessTokenCacheForTests } = await import('../src/lib/line');

const originalFetch = global.fetch;
let pushCalls: Array<{ url: string; body: string }>;

beforeEach(() => {
  pushCalls = [];
  _resetChannelAccessTokenCacheForTests();
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('https://api.line.me/oauth2/v3/token')) {
      return new Response(JSON.stringify({ access_token: 'mock-access-token', expires_in: 900 }), { status: 200 });
    }
    if (url.startsWith('https://api.line.me/v2/bot/message/push')) {
      pushCalls.push({ url, body: String(init?.body) });
      return new Response(JSON.stringify({}), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

function requestWithCookie(cookie: string | undefined, bodyText?: string) {
  return new NextRequest('http://localhost/api/line/test-push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } : {}),
    },
    body: bodyText,
  });
}

test('rejects a request with no session cookie', async () => {
  const res = await POST(requestWithCookie(undefined, JSON.stringify({ kind: 'paid' })));
  expect(res.status).toBe(401);
  expect(pushCalls.length).toBe(0);
});

test('sends a Paid test push to the signed-in user by default', async () => {
  const cookie = createSessionCookie({ userId: 'U-farmer-1', iat: Math.floor(Date.now() / 1000) });
  const res = await POST(requestWithCookie(cookie));
  expect(res.status).toBe(200);

  const json = (await res.json()) as { ok: boolean; kind: string; sentTo: string };
  expect(json.ok).toBe(true);
  expect(json.kind).toBe('paid');
  expect(json.sentTo).toBe('U-farmer-1');

  expect(pushCalls.length).toBe(1);
  const payload = JSON.parse(pushCalls[0].body);
  expect(payload.to).toBe('U-farmer-1');
  expect(payload.messages[0].altText).toContain('のお見舞金が届きました');
});

test('sends a Held test push when kind=held', async () => {
  const cookie = createSessionCookie({ userId: 'U-farmer-2', iat: Math.floor(Date.now() / 1000) });
  const res = await POST(requestWithCookie(cookie, JSON.stringify({ kind: 'held' })));
  expect(res.status).toBe(200);

  const payload = JSON.parse(pushCalls[0].body);
  expect(payload.to).toBe('U-farmer-2');
  expect(payload.messages[0].altText).toContain('保留中');
});
