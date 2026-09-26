import { afterEach, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';

process.env.LINE_LOGIN_CHANNEL_ID = 'test-login-channel';
process.env.SESSION_SECRET = 'test-session-secret';

const { POST } = await import('../src/app/api/liff/session/route');
const { verifySessionCookie, SESSION_COOKIE_NAME } = await import('../src/lib/session');

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function postSession(bodyText: string | undefined) {
  return POST(
    new NextRequest('http://localhost/api/liff/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,
    }),
  );
}

test('rejects a missing idToken', async () => {
  const res = await postSession(JSON.stringify({}));
  expect(res.status).toBe(400);
});

test('rejects invalid JSON', async () => {
  const res = await postSession('not json');
  expect(res.status).toBe(400);
});

test('verifies the ID token and sets a signed session cookie', async () => {
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        iss: 'https://access.line.me',
        sub: 'U-farmer-1',
        aud: 'test-login-channel',
        exp: 9999999999,
        iat: 1,
        name: 'Taro',
        picture: 'https://example.com/p.png',
      }),
      { status: 200 },
    )) as typeof fetch;

  const res = await postSession(JSON.stringify({ idToken: 'a-valid-id-token' }));
  expect(res.status).toBe(200);

  const json = (await res.json()) as { ok: boolean; user: { id: string; displayName: string | null } };
  expect(json.ok).toBe(true);
  expect(json.user.id).toBe('U-farmer-1');
  expect(json.user.displayName).toBe('Taro');

  const setCookie = res.cookies.get(SESSION_COOKIE_NAME);
  expect(setCookie).toBeDefined();
  const session = verifySessionCookie(setCookie?.value);
  expect(session?.userId).toBe('U-farmer-1');
});

test('returns 401 when LINE rejects the ID token', async () => {
  global.fetch = (async () => new Response('invalid_request', { status: 400 })) as typeof fetch;

  const res = await postSession(JSON.stringify({ idToken: 'a-bad-id-token' }));
  expect(res.status).toBe(401);
});
