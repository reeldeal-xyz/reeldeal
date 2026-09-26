import { expect, mock, test } from 'bun:test';
import { decideAttest, type AttestGateState } from './jev-gate';
import type { JevChoiceResult, JevState } from './jev';

type GateChoice = 'attest_now' | 'co_op_review';
type GateQuestion = { instructions: string; criteria: Record<GateChoice, string> };

const STATE: AttestGateState = {
  trigger: { zone: 'karakuwa-east', species: 'scallop', peril: 'HEAT', tier: 1, index: 14, threshold: 14, tempC: 25, firedAt: '2026-08-12T00:00:00.000Z' },
  buoyOffset: { meanDiffC: 0.12, minDiffC: -0.3, maxDiffC: 0.4, sampleCount: 96 },
  daysOfData: 92,
  sourceHashes: ['sha256:deadbeef'],
};

function fakeAskChoice(answer: GateChoice, confidence: number, probabilities: Record<GateChoice, number>) {
  return mock(
    async (_state: JevState, _question: GateQuestion): Promise<JevChoiceResult<GateChoice>> => ({
      answer,
      confidence,
      probabilities,
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    }),
  );
}

test('attest_now above threshold: decision is attest_now with reason jev_choice', async () => {
  const askChoiceFn = fakeAskChoice('attest_now', 0.9, { attest_now: 0.9, co_op_review: 0.1 });
  const result = await decideAttest(STATE, { askChoiceFn, confidenceThreshold: 0.7 });

  expect(result).toEqual({
    decision: 'attest_now',
    confidence: 0.9,
    probabilities: { attest_now: 0.9, co_op_review: 0.1 },
    reason: 'jev_choice',
  });
  expect(askChoiceFn).toHaveBeenCalledTimes(1);
  const [state, question] = askChoiceFn.mock.calls[0]!;
  expect(state).toMatchObject({ trigger: STATE.trigger, daysOfData: 92, sourceHashes: ['sha256:deadbeef'] });
  expect(question.criteria.attest_now).toBeDefined();
  expect(question.criteria.co_op_review).toBeDefined();
});

test('Jev itself chooses co_op_review above threshold: decision is co_op_review with reason jev_choice', async () => {
  const askChoiceFn = fakeAskChoice('co_op_review', 0.85, { attest_now: 0.15, co_op_review: 0.85 });
  const result = await decideAttest(STATE, { askChoiceFn, confidenceThreshold: 0.7 });

  expect(result.decision).toBe('co_op_review');
  expect(result.reason).toBe('jev_choice');
});

test('confidence below threshold always falls back to co_op_review, even if Jev picked attest_now', async () => {
  const askChoiceFn = fakeAskChoice('attest_now', 0.53, { attest_now: 0.77, co_op_review: 0.23 }); // real low-confidence call, docs/JEV.md
  const result = await decideAttest(STATE, { askChoiceFn, confidenceThreshold: 0.7 });

  expect(result.decision).toBe('co_op_review');
  expect(result.reason).toBe('low_confidence');
  expect(result.confidence).toBe(0.53);
});

test('a failed Jev call (null) falls back to co_op_review with reason jev_unavailable', async () => {
  const askChoiceFn = mock(async (): Promise<JevChoiceResult<'attest_now' | 'co_op_review'> | null> => null);
  const result = await decideAttest(STATE, { askChoiceFn, confidenceThreshold: 0.7 });

  expect(result).toEqual({ decision: 'co_op_review', confidence: null, probabilities: null, reason: 'jev_unavailable' });
});

test('uses env.jevConfidenceThreshold() when no override is given', async () => {
  process.env.JEV_CONFIDENCE_THRESHOLD = '0.95';
  try {
    const askChoiceFn = fakeAskChoice('attest_now', 0.9, { attest_now: 0.9, co_op_review: 0.1 }); // above the default 0.7, below this override
    const result = await decideAttest(STATE, { askChoiceFn });
    expect(result.decision).toBe('co_op_review');
    expect(result.reason).toBe('low_confidence');
  } finally {
    delete process.env.JEV_CONFIDENCE_THRESHOLD;
  }
});
