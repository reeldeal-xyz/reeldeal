// Keeper data-quality gate (docs/JEV.md). Advisory only: `decideAttest` asks Jev whether a fired trigger's
// supporting data is clean enough to attest now, or should wait for a human co-op review first. It never
// attests or settles anything itself, so it can only ADD friction (a co_op_review hold) -- it can never
// cause a payout. A failed call or a low-confidence answer always falls back to co_op_review.
//
// Wire this into the keeper (web/src/lib/keeper/run.ts) with one line right before the attest step:
//   const gate = await decideAttest(buildState(trigger, ...));
//   if (gate.decision === 'co_op_review' && !force) return holdForReview(trigger, gate);
//   // else: proceed with the existing deterministic attest/sign flow
import { env } from './env';
import { askChoice, type JevChoiceResult, type JevState } from './jev';

export interface AttestGateTrigger {
  zone: string;
  species: string;
  peril: string;
  tier: number;
  index: number;
  threshold: number;
  /** HEAT: the rule's temperature (whole C, Trigger.tempC). 0 for every other peril. */
  tempC: number;
  /** ISO timestamp the index crossed the threshold. */
  firedAt: string;
}

export interface BuoyOffsetStats {
  meanDiffC: number;
  minDiffC: number;
  maxDiffC: number;
  sampleCount?: number;
}

export interface AttestGateState {
  trigger: AttestGateTrigger;
  /** null when no buoy ground-truth is available for this zone/period. */
  buoyOffset: BuoyOffsetStats | null;
  daysOfData: number;
  sourceHashes: string[];
}

const DECISION_OPTIONS = ['attest_now', 'co_op_review'] as const;
export type AttestDecision = (typeof DECISION_OPTIONS)[number];

export interface AttestGateResult {
  decision: AttestDecision;
  confidence: number | null;
  probabilities: Record<AttestDecision, number> | null;
  /** jev_choice: Jev answered above threshold. low_confidence / jev_unavailable: fell back to co_op_review. */
  reason: 'jev_choice' | 'low_confidence' | 'jev_unavailable';
}

// Concrete (non-generic) shape of askChoice specialized to AttestDecision, so a plain test mock is
// trivially assignable here without fighting askChoice's generic signature.
type GateAskChoiceFn = (
  state: JevState,
  question: { instructions: string; criteria: Record<AttestDecision, string> },
) => Promise<JevChoiceResult<AttestDecision> | null>;

export interface DecideAttestOptions {
  /** Test seam: inject a fake askChoice instead of calling OpenRouter for real. */
  askChoiceFn?: GateAskChoiceFn;
  confidenceThreshold?: number;
}

const INSTRUCTIONS =
  'A parametric relief-payout trigger just fired for a shellfish co-op. Decide whether the supporting data ' +
  '(satellite-vs-buoy sea-temperature offset, days of pinned input data, and source hashes) is clean enough ' +
  'to attest the trigger now, or should be held for a human co-op review first.';

const CRITERIA: Record<AttestDecision, string> = {
  attest_now:
    'The buoy-vs-satellite offset (when available) is small and stable, enough days of pinned data back ' +
    'the index, and source hashes are present. Safe to attest immediately.',
  co_op_review:
    'The offset is large or unstable, there are too few days of data, source hashes are missing, or ' +
    'anything else looks off. A human should review before attesting.',
};

/**
 * Decides whether a fired trigger's data quality is clean enough to attest now. Never causes a payout by
 * itself -- it only ever adds a co_op_review hold in front of the keeper's existing deterministic
 * attest/sign flow. A failed or low-confidence call always falls back to co_op_review.
 */
export async function decideAttest(state: AttestGateState, opts: DecideAttestOptions = {}): Promise<AttestGateResult> {
  const ask: GateAskChoiceFn = opts.askChoiceFn ?? askChoice;
  const threshold = opts.confidenceThreshold ?? env.jevConfidenceThreshold();

  const result = await ask(
    {
      trigger: state.trigger,
      buoyOffset: state.buoyOffset,
      daysOfData: state.daysOfData,
      sourceHashes: state.sourceHashes,
    },
    { instructions: INSTRUCTIONS, criteria: CRITERIA },
  );

  if (!result) {
    return { decision: 'co_op_review', confidence: null, probabilities: null, reason: 'jev_unavailable' };
  }

  if (result.confidence < threshold) {
    return { decision: 'co_op_review', confidence: result.confidence, probabilities: result.probabilities, reason: 'low_confidence' };
  }

  return { decision: result.answer, confidence: result.confidence, probabilities: result.probabilities, reason: 'jev_choice' };
}
