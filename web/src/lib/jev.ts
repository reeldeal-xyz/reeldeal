// Typed client for TypeSafe's "Jev" System One decisions model, called via OpenRouter's alpha Decisions
// API. Request/response shape confirmed against real calls on 2026-09-26 (see docs/JEV.md for example
// logs and doc links). Docs:
//   https://openrouter.ai/docs/guides/community/jev
//   https://openrouter.ai/docs/guides/community/jev-tutorial
//   https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request
//
// Jev returns typed, calibrated-probability decisions — never free text — so a caller can trust the shape
// of what comes back. It can still fail to answer at all (missing key, timeout, 5xx, alpha-API hiccup): in
// every one of those cases this client returns `null` and the caller is expected to escalate to a human,
// never to assume an answer. Nothing in this file (or anything built on top of it) should ever move money.
import { env } from './env';

const DECISIONS_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const DEFAULT_TIMEOUT_MS = 8_000;
const QUESTION_KEY = 'q';

/** The Decisions API's "state" field: plain text, a JSON object, or an array — whatever describes the app's context. */
export type JevState = string | Record<string, unknown> | unknown[];

interface ChoiceQuestionSpec<TOption extends string> {
  type: 'choice';
  instructions: string;
  criteria: Record<TOption, string>;
}

interface ScoreQuestionSpec {
  type: 'score';
  instructions: string;
  criteria: string[];
}

interface DecisionsRequestBody {
  model: string;
  state: JevState;
  questions: Record<string, ChoiceQuestionSpec<string> | ScoreQuestionSpec>;
}

interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface ScoreAnswer {
  type: 'score';
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  legend?: Record<string, string>;
}

type DecisionsAnswer = ChoiceAnswer | ScoreAnswer | { type: 'noul'; noul: number };

interface DecisionsResponseBody {
  id: string;
  model: string;
  provider: string;
  answers: Record<string, DecisionsAnswer>;
  usage: { input_tokens: number; output_tokens: number; cost: number };
}

export interface JevUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** A Choice answer: exactly the shape callers need — {answer, probabilities, confidence} — plus usage/cost. */
export interface JevChoiceResult<TOption extends string> {
  answer: TOption;
  probabilities: Record<TOption, number>;
  confidence: number;
  usage: JevUsage;
}

/** A Score answer. `answer` is the probability-weighted position on the ordered `criteria` scale (0-indexed). */
export interface JevScoreResult {
  answer: number;
  probabilities: Record<string, number>;
  confidence: number;
  legend?: Record<string, string>;
  usage: JevUsage;
}

export interface JevRequestOptions {
  /** Overrides env.jevModel() (default 'typesafe/jev-1.13'). */
  model?: string;
  /** Overrides the default 8s request timeout (applies per attempt; one retry means up to 2x this). */
  timeoutMs?: number;
  /** Test seam: inject a fake fetch instead of calling OpenRouter for real. */
  fetchImpl?: typeof fetch;
}

function logJevEvent(fields: Record<string, unknown>): void {
  // Structured, single-line JSON so it's greppable in logs (`scope:"jev"`), per docs/JEV.md.
  console.error(JSON.stringify({ scope: 'jev', kind: 'client_error', ...fields }));
}

/** Fetches with one retry: retries once on a network error, a timeout, HTTP 429, or a 5xx response. */
async function fetchWithOneRetry(fetchImpl: typeof fetch, timeoutMs: number, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(DECISIONS_ENDPOINT, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (attempt === 0 && retryable) {
        lastError = new Error(`retryable HTTP ${res.status}`);
        continue;
      }
      return res; // non-retryable failure, or we're out of attempts: hand the response back as-is
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt === 0) continue;
      throw err;
    }
  }
  throw lastError;
}

async function postDecision(body: DecisionsRequestBody, opts: JevRequestOptions): Promise<DecisionsResponseBody | null> {
  const apiKey = env.openRouterApiKey();
  if (!apiKey) {
    logJevEvent({ reason: 'missing_api_key' });
    return null;
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetchWithOneRetry(fetchImpl, timeoutMs, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logJevEvent({ reason: 'network_error', detail: String(err) });
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logJevEvent({ reason: `http_${res.status}`, detail: text.slice(0, 500) });
    return null;
  }

  try {
    return (await res.json()) as DecisionsResponseBody;
  } catch (err) {
    logJevEvent({ reason: 'invalid_json', detail: String(err) });
    return null;
  }
}

/**
 * Asks a single Choice question: "which one of these options?" Returns null (never throws) on a missing
 * key, timeout, retry-exhausted network error, non-2xx response, or an unexpected answer shape — every
 * caller must treat null the same way it treats low confidence: escalate to a human.
 */
export async function askChoice<TOption extends string>(
  state: JevState,
  question: { instructions: string; criteria: Record<TOption, string> },
  opts: JevRequestOptions = {},
): Promise<JevChoiceResult<TOption> | null> {
  const body: DecisionsRequestBody = {
    model: opts.model ?? env.jevModel(),
    state,
    questions: {
      [QUESTION_KEY]: { type: 'choice', instructions: question.instructions, criteria: question.criteria },
    },
  };

  const res = await postDecision(body, opts);
  if (!res) return null;

  const answer = res.answers[QUESTION_KEY];
  if (!answer || answer.type !== 'choice') {
    logJevEvent({ reason: 'unexpected_answer_shape', detail: JSON.stringify(answer) });
    return null;
  }

  return {
    answer: answer.choice as TOption,
    probabilities: answer.probabilities as Record<TOption, number>,
    confidence: answer.confidence,
    usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, costUsd: res.usage.cost },
  };
}

/**
 * Asks a single Score question: "where does this fall on an ordered scale?" `criteria` is the ordered list
 * of scale labels (index 0 = lowest). Same null-on-failure contract as askChoice.
 */
export async function askScore(
  state: JevState,
  question: { instructions: string; criteria: string[] },
  opts: JevRequestOptions = {},
): Promise<JevScoreResult | null> {
  const body: DecisionsRequestBody = {
    model: opts.model ?? env.jevModel(),
    state,
    questions: {
      [QUESTION_KEY]: { type: 'score', instructions: question.instructions, criteria: question.criteria },
    },
  };

  const res = await postDecision(body, opts);
  if (!res) return null;

  const answer = res.answers[QUESTION_KEY];
  if (!answer || answer.type !== 'score') {
    logJevEvent({ reason: 'unexpected_answer_shape', detail: JSON.stringify(answer) });
    return null;
  }

  return {
    answer: answer.score,
    probabilities: answer.probabilities,
    confidence: answer.confidence,
    legend: answer.legend,
    usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, costUsd: res.usage.cost },
  };
}
