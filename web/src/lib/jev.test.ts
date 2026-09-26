import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
delete process.env.JEV_MODEL;
delete process.env.JEV_CONFIDENCE_THRESHOLD;

const { askChoice, askScore } = await import('./jev');

const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const originalFetch = global.fetch;

interface Call {
  url: string;
  init?: RequestInit;
}

let calls: Call[];

function installFetchMock(handler: (call: Call) => Response) {
  calls = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const call = { url, init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
});

// Recorded from a real OpenRouter Decisions API call on 2026-09-26 (see docs/JEV.md), with the answer's
// key renamed from "intent" to "q" -- this client always names its single question "q" (jev.ts).
const REAL_CHOICE_RESPONSE = {
  id: 'gen-dec-1790392982-MC1uL9O9oIev0xUfhWPs',
  model: 'typesafe/jev-1.13-20260917',
  provider: 'TypeSafe',
  answers: {
    q: {
      type: 'choice',
      choice: 'payout_status',
      confidence: 1,
      probabilities: { why_held: 0, trigger_explanation: 0, talk_to_coop: 0, other: 0, request_slot: 0, verify_identity: 0, payout_status: 1 },
    },
  },
  usage: { input_tokens: 522, output_tokens: 80, cost: 0.000021924 },
};

// Recorded from a real call for the keeper attest gate (docs/JEV.md): a genuinely low-confidence answer.
const REAL_LOW_CONFIDENCE_RESPONSE = {
  id: 'gen-dec-1790393006-vnEG5xG6H8KtJhflKwVe',
  model: 'typesafe/jev-1.13-20260917',
  provider: 'TypeSafe',
  answers: {
    q: { type: 'choice', choice: 'attest_now', confidence: 0.53, probabilities: { attest_now: 0.77, co_op_review: 0.23 } },
  },
  usage: { input_tokens: 637, output_tokens: 37, cost: 0.000026754 },
};

describe('askChoice', () => {
  test('parses a real recorded Choice response into {answer, probabilities, confidence}', async () => {
    installFetchMock(() => new Response(JSON.stringify(REAL_CHOICE_RESPONSE), { status: 200 }));

    const result = await askChoice(
      { message: 'when will my payout arrive?' },
      { instructions: 'classify', criteria: { payout_status: 'a', other: 'b' } },
    );

    expect(result).not.toBeNull();
    expect(result!.answer).toBe('payout_status');
    expect(result!.confidence).toBe(1);
    expect(result!.probabilities.payout_status).toBe(1);
    expect(result!.usage.costUsd).toBe(0.000021924);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(ENDPOINT);
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-openrouter-key');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.model).toBe('typesafe/jev-1.13');
    expect(body.questions.q.type).toBe('choice');
  });

  test('surfaces a genuinely low-confidence answer unchanged (caller decides what to do with it)', async () => {
    installFetchMock(() => new Response(JSON.stringify(REAL_LOW_CONFIDENCE_RESPONSE), { status: 200 }));

    const result = await askChoice(
      { trigger: 'x' },
      { instructions: 'decide', criteria: { attest_now: 'a', co_op_review: 'b' } },
    );

    expect(result!.confidence).toBe(0.53);
    expect(result!.answer).toBe('attest_now');
  });

  test('returns null without calling fetch when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    installFetchMock(() => {
      throw new Error('must not fetch');
    });

    const result = await askChoice({ x: 1 }, { instructions: 'i', criteria: { a: 'a', b: 'b' } });

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('returns null on a non-2xx response after exhausting its one retry', async () => {
    installFetchMock(() => new Response(JSON.stringify({ error: { code: 500, message: 'boom' } }), { status: 500 }));

    const result = await askChoice({ x: 1 }, { instructions: 'i', criteria: { a: 'a', b: 'b' } });

    expect(result).toBeNull();
    expect(calls).toHaveLength(2); // one retry on a 5xx
  });

  test('does not retry a non-retryable 4xx response', async () => {
    installFetchMock(() => new Response(JSON.stringify({ error: { code: 400, message: 'bad request' } }), { status: 400 }));

    const result = await askChoice({ x: 1 }, { instructions: 'i', criteria: { a: 'a', b: 'b' } });

    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test('retries once on a network error and succeeds on the second attempt', async () => {
    let attempt = 0;
    installFetchMock(() => {
      attempt++;
      if (attempt === 1) throw new Error('ECONNRESET');
      return new Response(JSON.stringify(REAL_CHOICE_RESPONSE), { status: 200 });
    });

    const result = await askChoice({ x: 1 }, { instructions: 'i', criteria: { payout_status: 'a', other: 'b' } });

    expect(result).not.toBeNull();
    expect(calls).toHaveLength(2);
  });

  test('returns null when both attempts throw', async () => {
    installFetchMock(() => {
      throw new Error('ECONNRESET');
    });

    const result = await askChoice({ x: 1 }, { instructions: 'i', criteria: { a: 'a', b: 'b' } });

    expect(result).toBeNull();
    expect(calls).toHaveLength(2);
  });

  test('returns null on an unexpected answer shape (wrong type discriminator)', async () => {
    installFetchMock(
      () =>
        new Response(
          JSON.stringify({ ...REAL_CHOICE_RESPONSE, answers: { q: { type: 'score', score: 1, confidence: 1, probabilities: {} } } }),
          { status: 200 },
        ),
    );

    const result = await askChoice({ x: 1 }, { instructions: 'i', criteria: { a: 'a', b: 'b' } });

    expect(result).toBeNull();
  });

  test('respects a per-call model override', async () => {
    installFetchMock(() => new Response(JSON.stringify(REAL_CHOICE_RESPONSE), { status: 200 }));

    await askChoice({ x: 1 }, { instructions: 'i', criteria: { a: 'a', b: 'b' } }, { model: '~typesafe/jev-latest' });

    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.model).toBe('~typesafe/jev-latest');
  });
});

describe('askScore', () => {
  test('parses a Score answer into {answer, probabilities, confidence, legend}', async () => {
    const scoreResponse = {
      id: 'gen-dec-test',
      model: 'typesafe/jev-1.13-20260917',
      provider: 'TypeSafe',
      answers: {
        q: {
          type: 'score',
          score: 1.99,
          confidence: 0.99,
          probabilities: { '0': 0, '1': 0.01, '2': 0.99 },
          legend: { '0': 'low', '1': 'medium', '2': 'high' },
        },
      },
      usage: { input_tokens: 10, output_tokens: 5, cost: 0.000001 },
    };
    installFetchMock(() => new Response(JSON.stringify(scoreResponse), { status: 200 }));

    const result = await askScore({ x: 1 }, { instructions: 'rate it', criteria: ['low', 'medium', 'high'] });

    expect(result!.answer).toBe(1.99);
    expect(result!.confidence).toBe(0.99);
    expect(result!.legend).toEqual({ '0': 'low', '1': 'medium', '2': 'high' });
  });
});

describe('OPENROUTER_API_KEY missing entirely for the process', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  test('askChoice never throws -- always resolves null', async () => {
    installFetchMock(() => {
      throw new Error('must not fetch');
    });
    await expect(askChoice({ x: 1 }, { instructions: 'i', criteria: { a: 'a', b: 'b' } })).resolves.toBeNull();
  });
});
