/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { eventVerificationPreviews as previews } from '../../../fixtures/event-verification-preview';
import { reviewState, type EventVerificationPreview } from './review';

describe('event evidence presentation gate', () => {
  test('shows supplied comparison results without deriving a payment outcome', () => {
    expect(reviewState(previews.matching)).toBe('matching');
    expect(previews.matching.transaction?.state).toBe('pending');
    expect(reviewState(previews.mismatched)).toBe('mismatched');
    expect(reviewState(previews.wrongDeployment)).toBe('mismatched');
  });
  test('requires the input bytes, deployment and replay season even if all supplied flags say match', () => {
    for (const key of ['inputBytes', 'deployment', 'dataSeason'] as const) {
      const review: EventVerificationPreview = {
        ...previews.matching,
        comparisons: { ...previews.matching.comparisons, [key]: undefined },
      };
      expect(reviewState(review)).toBe('unavailable');
    }
    expect(reviewState(previews.incomplete)).toBe('unavailable');
  });
  test('never treats forecasts or incomplete source evidence as an observed match', () => {
    expect(reviewState({ ...previews.matching, mode: 'advisory' })).toBe('advisory');
    expect(reviewState({ ...previews.matching, provenance: null })).toBe('unavailable');
    expect(reviewState({ ...previews.matching, measurement: { ...previews.matching.measurement!, state: 'advisory' } })).toBe('unavailable');
    expect(reviewState({ ...previews.matching, measurement: { ...previews.matching.measurement!, tempC: NaN } })).toBe('unavailable');
    expect(reviewState(null)).toBe('unavailable');
  });
  test('refuses a supplied match that contradicts its displayed values', () => {
    expect(reviewState({
      ...previews.matching,
      comparisons: { ...previews.matching.comparisons, index: { recorded: '14 days', evidence: '13 days', result: 'match' } },
    })).toBe('unavailable');
    expect(reviewState({
      ...previews.matching,
      comparisons: { ...previews.matching.comparisons, index: { recorded: '14 days', evidence: '14 days', result: 'unavailable' } },
    })).toBe('unavailable');
  });
  test('keeps historical observed replay distinct from the payout season', () => {
    expect(reviewState(previews.observedReplay)).toBe('matching');
    expect(previews.observedReplay.comparisons.dataSeason?.evidence).toBe('2025');
    expect(previews.observedReplay.comparisons.payoutSeason?.evidence).toBe('2026');
  });
});
