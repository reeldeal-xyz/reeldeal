import { afterEach, beforeEach, expect, test } from 'bun:test';

process.env.LINE_MESSAGING_CHANNEL_ID = 'test-messaging-channel';
process.env.LINE_CHANNEL_SECRET = 'test-channel-secret';
delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

const { formatJpyc, getPushQuota, pushHeld, pushPaid, _resetChannelAccessTokenCacheForTests } = await import(
  '../src/lib/line'
);

const originalFetch = global.fetch;

interface Call {
  url: string;
  init?: RequestInit;
}

let calls: Call[];

function installFetchMock() {
  calls = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    if (url.startsWith('https://api.line.me/oauth2/v3/token')) {
      return new Response(JSON.stringify({ access_token: 'mock-access-token', expires_in: 900, token_type: 'Bearer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('https://api.line.me/v2/bot/message/push')) {
      return new Response(JSON.stringify({ sentMessages: [{ id: '1', quoteToken: 'q' }] }), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;
}

beforeEach(() => {
  installFetchMock();
  _resetChannelAccessTokenCacheForTests();
});

afterEach(() => {
  global.fetch = originalFetch;
});

test('formatJpyc renders whole-yen amounts with thousands separators', () => {
  expect(formatJpyc(20000n * 10n ** 18n)).toBe('¥20,000');
  expect(formatJpyc(1234567n * 10n ** 18n)).toBe('¥1,234,567');
  expect(formatJpyc(0n)).toBe('¥0');
});

test('formatJpyc keeps fractional yen when present', () => {
  // 20000.5 JPYC (18 decimals)
  const amount = 20000n * 10n ** 18n + 5n * 10n ** 17n;
  expect(formatJpyc(amount)).toBe('¥20,000.50');
});

test('pushPaid mints a channel access token then sends a Flex push', async () => {
  await pushPaid('U-farmer-1', { plotCode: 'p1213-017', zoneLabel: '唐桑東', amountWei: 20000n * 10n ** 18n });

  expect(calls.length).toBe(2);
  const [tokenCall, pushCall] = calls;

  expect(tokenCall.url).toBe('https://api.line.me/oauth2/v3/token');
  expect(tokenCall.init?.method).toBe('POST');
  const tokenBody = String(tokenCall.init?.body);
  expect(tokenBody).toContain('grant_type=client_credentials');
  expect(tokenBody).toContain('client_id=test-messaging-channel');
  expect(tokenBody).toContain('client_secret=test-channel-secret');

  expect(pushCall.url).toBe('https://api.line.me/v2/bot/message/push');
  const headers = pushCall.init?.headers as Record<string, string>;
  expect(headers.authorization ?? headers.Authorization).toBe('Bearer mock-access-token');

  const payload = JSON.parse(String(pushCall.init?.body));
  expect(payload.to).toBe('U-farmer-1');
  expect(payload.messages).toHaveLength(1);
  expect(payload.messages[0].type).toBe('flex');
  expect(payload.messages[0].altText).toContain('¥20,000');
  expect(payload.messages[0].altText).toContain('唐桑東');
  expect(payload.messages[0].altText).toContain('p1213-017');
});

test('pushHeld sends a Flex push with the held reason', async () => {
  await pushHeld('U-farmer-2', {
    plotCode: 'p1213-017',
    zoneLabel: '唐桑東',
    reasonJa: '本人確認をすると受け取れます',
    reasonEn: 'Verify your identity to receive the payout.',
  });

  const pushCall = calls.find((c) => c.url === 'https://api.line.me/v2/bot/message/push');
  expect(pushCall).toBeDefined();
  const payload = JSON.parse(String(pushCall?.init?.body));
  expect(payload.messages[0].altText).toContain('保留中');
  const bodyJson = JSON.stringify(payload.messages[0].contents);
  expect(bodyJson).toContain('本人確認をすると受け取れます');
  expect(bodyJson).toContain('Verify your identity');
});

test('the channel access token is cached across pushes within its TTL', async () => {
  await pushPaid('U-farmer-3', { plotCode: 'p1213-017', zoneLabel: '唐桑東', amountWei: 10000n * 10n ** 18n });
  const afterFirst = calls.length;
  await pushPaid('U-farmer-3', { plotCode: 'p1213-017', zoneLabel: '唐桑東', amountWei: 10000n * 10n ** 18n });

  const tokenCalls = calls.filter((c) => c.url === 'https://api.line.me/oauth2/v3/token');
  expect(tokenCalls.length).toBe(1);
  expect(calls.length).toBe(afterFirst + 1); // second call only hits the push endpoint
});

test('LINE_CHANNEL_ACCESS_TOKEN overrides the client_credentials mint entirely', async () => {
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'override-token';
  try {
    await pushPaid('U-farmer-4', { plotCode: 'p1213-017', zoneLabel: '唐桑東', amountWei: 10000n * 10n ** 18n });
    const tokenCalls = calls.filter((c) => c.url === 'https://api.line.me/oauth2/v3/token');
    expect(tokenCalls.length).toBe(0);
    const pushCall = calls.find((c) => c.url === 'https://api.line.me/v2/bot/message/push');
    const headers = pushCall?.init?.headers as Record<string, string>;
    expect(headers.authorization ?? headers.Authorization).toBe('Bearer override-token');
  } finally {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  }
});

test('getPushQuota increments the in-memory counter on each successful push', async () => {
  const before = getPushQuota().count;
  await pushPaid('U-farmer-5', { plotCode: 'p1213-017', zoneLabel: '唐桑東', amountWei: 10000n * 10n ** 18n });
  const after = getPushQuota().count;
  expect(after).toBe(before + 1);
  expect(getPushQuota().limit).toBe(200);
});
