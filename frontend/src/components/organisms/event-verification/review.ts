import type { MeasurementRowProps, ProvenanceDetailsProps, TransactionRowProps } from '../../molecules/relief/props';

/** Display slots for a reviewed verifier result, not a verifier or wire schema. */
export const evidenceFields = [
  ['inputBytes', 'Pinned input bytes (hex)'],
  ['inputHash', 'Input hash (SHA-256)'],
  ['index', 'Index and unit'],
  ['threshold', 'Threshold and unit'],
  ['fireDate', 'Fire date (UTC)'],
  ['windowStart', 'Window start (UTC)'],
  ['windowEnd', 'Window end (UTC)'],
  ['rule', 'Rule and version'],
  ['dataSeason', 'Observation / replay season'],
  ['payoutSeason', 'Payout season'],
  ['chainId', 'Chain ID'],
  ['deployment', 'ReliefPool deployment'],
  ['abi', 'Deployment ABI version'],
] as const;

export type EvidenceKey = typeof evidenceFields[number][0];
export type EvidenceResult = 'match' | 'mismatch' | 'unavailable';
export interface EvidenceComparison {
  recorded: string | null;
  evidence: string | null;
  result: EvidenceResult;
}

export interface EventVerificationPreview {
  eventId: string;
  zone: string;
  mode: 'observed' | 'replay' | 'advisory';
  /** Results supplied by the fixture now; the agreed verifier will own them later. */
  comparisons: Partial<Record<EvidenceKey, EvidenceComparison>>;
  measurement: MeasurementRowProps | null;
  provenance: ProvenanceDetailsProps | null;
  transaction: TransactionRowProps | null;
}

export const isDisplayText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function comparisonResult(value: EvidenceComparison | undefined): EvidenceResult {
  if (!value || !isDisplayText(value.recorded) || !isDisplayText(value.evidence)) return 'unavailable';
  // A supplied match cannot contradict its displayed canonical values. This
  // guard does not compute any field or turn equal text into a verified match.
  if (value.result === 'match' && value.recorded !== value.evidence) return 'unavailable';
  return value.result === 'match' || value.result === 'mismatch' ? value.result : 'unavailable';
}

export function usableMeasurement(value: MeasurementRowProps | null | undefined): value is MeasurementRowProps {
  return !!value && typeof value.tempC === 'number' && Number.isFinite(value.tempC)
    && ['available', 'stale', 'advisory'].includes(value.state)
    && [value.label, value.sourceName, value.observedAtLabel, value.freshnessLabel].every(isDisplayText);
}

export function usableProvenance(value: ProvenanceDetailsProps | null | undefined): value is ProvenanceDetailsProps {
  return !!value && value.state === 'available'
    && [value.sourceName, value.datasetLabel, value.observedAtLabel, value.retrievedAtLabel, value.evidenceLabel].every(isDisplayText);
}

/** Preserve unavailable reading states and never label forecast provenance Observed. */
export function sourceForReview(value: EventVerificationPreview | null | undefined) {
  const reading = value?.measurement;
  const measurement = reading && [reading.label, reading.sourceName, reading.observedAtLabel, reading.freshnessLabel].every(isDisplayText) ? {
    ...reading,
    state: value?.mode === 'advisory' && ['available', 'stale'].includes(reading.state) ? 'advisory' as const : reading.state,
  } : null;
  const source = value?.provenance;
  // ProvenanceDetails currently has an Observed label, so it cannot represent
  // forecast issue/valid times yet. Keep that integration gap visible.
  const provenance = value?.mode !== 'advisory' && source && ['available', 'unavailable'].includes(source.state)
    && [source.sourceName, source.datasetLabel, source.observedAtLabel, source.retrievedAtLabel, source.evidenceLabel].every(isDisplayText) ? source : null;
  return { measurement, provenance };
}

/** Fail closed on incomplete display evidence. No hashing, recomputation or RPC. */
export function reviewState(value: EventVerificationPreview | null | undefined): 'matching' | 'mismatched' | 'unavailable' | 'advisory' {
  if (value?.mode === 'advisory') return 'advisory';
  if (!value || !['observed', 'replay'].includes(value.mode)
    || !/^0x[\da-fA-F]{64}$/.test(value.eventId) || !isDisplayText(value.zone)
    || !usableMeasurement(value.measurement) || value.measurement.state === 'advisory'
    || !usableProvenance(value.provenance)) return 'unavailable';
  const results = evidenceFields.map(([key]) => comparisonResult(value.comparisons?.[key]));
  if (results.includes('unavailable')) return 'unavailable';
  return results.includes('mismatch') ? 'mismatched' : 'matching';
}
