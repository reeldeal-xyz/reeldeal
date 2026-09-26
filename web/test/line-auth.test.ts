import { afterEach, expect, test } from 'bun:test';

process.env.LINE_LOGIN_CHANNEL_ID = 'test-login-channel';

const { verifyLineIdToken, LineIdTokenError } = await import('../src/lib/line-auth');

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

test('verifyLineIdToken posts to the verify endpoint with id_token and client_id', async () => {
  let seenUrl = '';
  let seenBody = '';
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = typeof input === 'string' ? input : input.toString();
    seenBody = String(init?.body);
    return new Response(
      JSON.stringify({ iss: 'https://access.line.me', sub: 'U123', aud: 'test-login-channel', exp: 9999999999, iat: 1, name: 'Taro', picture: 'https://example.com/p.png' }),
      { status: 200 },
    );
  }) as typeof fetch;

  const claims = await verifyLineIdToken('a-valid-id-token');

  expect(seenUrl).toBe('https://api.line.me/oauth2/v2.1/verify');
  expect(seenBody).toContain('id_token=a-valid-id-token');
  expect(seenBody).toContain('client_id=test-login-channel');
  expect(claims.sub).toBe('U123');
  expect(claims.name).toBe('Taro');
});

test('verifyLineIdToken throws LineIdTokenError on a non-2xx response', async () => {
  global.fetch = (async () => new Response('invalid_request', { status: 400 })) as typeof fetch;

  await expect(verifyLineIdToken('a-bad-id-token')).rejects.toBeInstanceOf(LineIdTokenError);
});

test('verifyLineIdToken rejects an empty token without calling fetch', async () => {
  let called = false;
  global.fetch = (async () => {
    called = true;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  await expect(verifyLineIdToken('')).rejects.toBeInstanceOf(LineIdTokenError);
  expect(called).toBe(false);
});
