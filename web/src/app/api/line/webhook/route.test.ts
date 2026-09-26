import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createHmac } from 'node:crypto';

const SECRET = 'test-channel-secret';

process.env.LINE_MESSAGING_CHANNEL_ID = 'test-messaging-channel';
process.env.LINE_CHANNEL_SECRET = SECRET;
delete process.env.JEV_CONFIDENCE_THRESHOLD;
delete process.env.JEV_MODEL;

const askChoiceMock = mock(async (_state: unknown, _question: unknown) => null as { answer: string; probabilities: Record<string, number>; confidence: number } | null);
const replyMessageMock = mock(async (_replyToken: string, _messages: unknown[]) => {});

mock.module('@/lib/jev', () => ({ askChoice: askChoiceMock }));
mock.module('@/lib/line', () => ({ replyMessage: replyMessageMock }));

const { POST } = await import('./route');

function sign(body: string, secret: string): string {
  return createHmac('SHA256', secret).update(body).digest('base64');
}

function signedRequest(events: unknown[], secret = SECRET): Request {
  const body = JSON.stringify({ destination: 'U-bot', events });
  return new Request('http://localhost/api/line/webhook', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-line-signature': sign(body, secret) },
  });
}

function textMessageEvent(text: string, replyToken = 'reply-token-1') {
  return {
    type: 'message',
    mode: 'active',
    timestamp: 1700000000000,
    source: { type: 'user', userId: 'U-farmer-1' },
    webhookEventId: 'wh-1',
    deliveryContext: { isRedelivery: false },
    replyToken,
    message: { id: 'msg-1', type: 'text', text },
  };
}

beforeEach(() => {
  askChoiceMock.mockClear();
  replyMessageMock.mockClear();
});

afterEach(() => {
  askChoiceMock.mockReset();
  replyMessageMock.mockReset();
});

describe('POST /api/line/webhook', () => {
  test('rejects a request with a bad signature', async () => {
    const res = await POST(signedRequest([textMessageEvent('hello')], 'wrong-secret'));
    expect(res.status).toBe(401);
    expect(askChoiceMock).not.toHaveBeenCalled();
    expect(replyMessageMock).not.toHaveBeenCalled();
  });

  test('high-confidence intent: replies with the fixed template for that intent', async () => {
    askChoiceMock.mockResolvedValueOnce({
      answer: 'payout_status',
      confidence: 0.95,
      probabilities: { payout_status: 0.95, other: 0.05 },
    });

    const res = await POST(signedRequest([textMessageEvent('支払いはいつ届きますか？', 'reply-token-42')]));
    expect(res.status).toBe(200);

    expect(replyMessageMock).toHaveBeenCalledTimes(1);
    const [replyToken, messages] = replyMessageMock.mock.calls[0]!;
    expect(replyToken).toBe('reply-token-42');
    expect((messages as { type: string; text: string }[])[0]!.type).toBe('text');
    expect((messages as { type: string; text: string }[])[0]!.text).toContain('/donate');
  });

  test('low-confidence intent: escalates with the co-op fallback reply instead of the intent template', async () => {
    askChoiceMock.mockResolvedValueOnce({
      answer: 'payout_status',
      confidence: 0.4,
      probabilities: { payout_status: 0.4, other: 0.6 },
    });

    await POST(signedRequest([textMessageEvent('こんにちは')]));

    expect(replyMessageMock).toHaveBeenCalledTimes(1);
    const [, messages] = replyMessageMock.mock.calls[0]!;
    const text = (messages as { text: string }[])[0]!.text;
    expect(text).not.toContain('/donate');
    expect(text).toContain('組合');
  });

  test('Jev unavailable (null): escalates with the co-op fallback reply', async () => {
    askChoiceMock.mockResolvedValueOnce(null);

    await POST(signedRequest([textMessageEvent('hello')]));

    expect(replyMessageMock).toHaveBeenCalledTimes(1);
    const [, messages] = replyMessageMock.mock.calls[0]!;
    expect((messages as { text: string }[])[0]!.text).toContain('組合');
  });

  test('non-text events are not routed through Jev at all', async () => {
    const followEvent = {
      type: 'follow',
      mode: 'active',
      timestamp: 1700000000000,
      source: { type: 'user', userId: 'U-farmer-2' },
      webhookEventId: 'wh-2',
      deliveryContext: { isRedelivery: false },
      replyToken: 'reply-token-99',
    };

    const res = await POST(signedRequest([followEvent]));
    expect(res.status).toBe(200);
    expect(askChoiceMock).not.toHaveBeenCalled();
    expect(replyMessageMock).not.toHaveBeenCalled();
  });

  test('respects a custom JEV_CONFIDENCE_THRESHOLD', async () => {
    process.env.JEV_CONFIDENCE_THRESHOLD = '0.99';
    try {
      askChoiceMock.mockResolvedValueOnce({
        answer: 'payout_status',
        confidence: 0.95, // above the 0.7 default, below this test's 0.99 override
        probabilities: { payout_status: 0.95, other: 0.05 },
      });

      await POST(signedRequest([textMessageEvent('when will I get paid')]));

      const [, messages] = replyMessageMock.mock.calls[0]!;
      expect((messages as { text: string }[])[0]!.text).toContain('組合'); // escalated, not the payout_status template
    } finally {
      delete process.env.JEV_CONFIDENCE_THRESHOLD;
    }
  });
});
