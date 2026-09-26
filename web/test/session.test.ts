import { expect, test } from 'bun:test';

process.env.SESSION_SECRET = 'test-session-secret';

const { createSessionCookie, verifySessionCookie, SESSION_MAX_AGE_SECONDS } = await import('../src/lib/session');

test('round-trips a valid session', () => {
  const iat = Math.floor(Date.now() / 1000);
  const cookie = createSessionCookie({ userId: 'U123', displayName: 'Taro', pictureUrl: 'https://example.com/p.png', iat });
  const payload = verifySessionCookie(cookie);
  expect(payload).not.toBeNull();
  expect(payload?.userId).toBe('U123');
  expect(payload?.displayName).toBe('Taro');
  expect(payload?.pictureUrl).toBe('https://example.com/p.png');
  expect(payload?.iat).toBe(iat);
});

test('rejects a missing cookie', () => {
  expect(verifySessionCookie(undefined)).toBeNull();
  expect(verifySessionCookie(null)).toBeNull();
  expect(verifySessionCookie('')).toBeNull();
});

test('rejects a malformed cookie', () => {
  expect(verifySessionCookie('not-a-valid-cookie')).toBeNull();
  expect(verifySessionCookie('..')).toBeNull();
});

test('rejects a tampered signature', () => {
  const iat = Math.floor(Date.now() / 1000);
  const cookie = createSessionCookie({ userId: 'U123', iat });
  const [data] = cookie.split('.');
  const tampered = `${data}.deadbeef`;
  expect(verifySessionCookie(tampered)).toBeNull();
});

test('rejects a tampered payload even with a well-formed signature segment', () => {
  const iat = Math.floor(Date.now() / 1000);
  const cookie = createSessionCookie({ userId: 'U123', iat });
  const [, signature] = cookie.split('.');
  const forgedData = Buffer.from(JSON.stringify({ userId: 'U-attacker', iat })).toString('base64url');
  expect(verifySessionCookie(`${forgedData}.${signature}`)).toBeNull();
});

test('rejects an expired session', () => {
  const staleIat = Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 60;
  const cookie = createSessionCookie({ userId: 'U123', iat: staleIat });
  expect(verifySessionCookie(cookie)).toBeNull();
});

test('a session signed with a different secret does not verify', async () => {
  const iat = Math.floor(Date.now() / 1000);
  const cookie = createSessionCookie({ userId: 'U123', iat });

  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'a-different-secret';
  try {
    // Re-import isn't needed: verifySessionCookie reads env.sessionSecret() at call time.
    expect(verifySessionCookie(cookie)).toBeNull();
  } finally {
    process.env.SESSION_SECRET = previousSecret;
  }
});
