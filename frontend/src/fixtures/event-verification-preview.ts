import type { EvidenceComparison, EvidenceKey, EventVerificationPreview } from '../components/organisms/event-verification/review';

// Entirely synthetic comparison results. Hashes, deployment and event identity
// are dummy values; this file does not hash bytes or evaluate a relief rule.
const values: Record<EvidenceKey, string> = {
  inputBytes: '0x646174652c74656d70430a323032352d30382d32382c32362e340a',
  inputHash: `0x${'11'.repeat(32)}`,
  index: '14 days',
  threshold: '14 days',
  fireDate: '1756339200 · 2025-08-28T00:00:00Z',
  windowStart: '1751328000 · 2025-07-01T00:00:00Z',
  windowEnd: '1759276799 · 2025-09-30T23:59:59Z',
  rule: 'fixture-heat-v2 · scallop · HEAT (tempC 25) · tier 1',
  dataSeason: '2025',
  payoutSeason: '2026',
  chainId: '11155111 · Sepolia',
  deployment: `0x${'22'.repeat(20)}`,
  abi: 'fixture-relief-pool-v2',
};
const comparisons = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
  recorded: value, evidence: value, result: 'match',
}])) as Record<EvidenceKey, EvidenceComparison>;

const matching: EventVerificationPreview = {
  eventId: `0x${'33'.repeat(32)}`,
  zone: 'karakuwa-east · example record',
  mode: 'observed',
  comparisons,
  measurement: {
    label: 'Sea temperature',
    tempC: 26.4,
    sourceName: 'Example in-water sensor',
    observedAtLabel: '28 Aug 2025 · 09:00 JST',
    freshnessLabel: 'Historical observation · not current conditions',
    state: 'available',
    explanation: 'Synthetic observation. The temperature is not itself the cumulative heat index.',
  },
  provenance: {
    sourceName: 'Example in-water sensor',
    datasetLabel: 'Synthetic temperature bytes',
    observedAtLabel: '28 Aug 2025 · 09:00 JST',
    retrievedAtLabel: '26 Sep 2026 · 12:00 JST',
    evidenceLabel: 'Local fixture only · dummy hash and input bytes',
    state: 'available',
    explanation: 'Production evidence must identify the exact input artifact and extraction strategy through the reviewed shared adapter.',
  },
  transaction: {
    reference: 'Example relief record · demo-event-001',
    label: 'Farmer relief',
    amount: '15000',
    recipient: `0x${'44'.repeat(20)}`,
    state: 'pending',
    timeLabel: '26 Sep 2026 · 12:00 JST',
    explanation: 'Synthetic pending record. A matching evidence preview does not confirm a transfer.',
  },
};

export const eventVerificationPreviews = {
  matching,
  mismatched: {
    ...matching,
    comparisons: {
      ...comparisons,
      index: { recorded: '14 days', evidence: '13 days', result: 'mismatch' },
      inputHash: { recorded: values.inputHash, evidence: `0x${'55'.repeat(32)}`, result: 'mismatch' },
    },
  },
  unavailable: {
    ...matching,
    comparisons: {},
    measurement: {
      ...matching.measurement!,
      tempC: null,
      state: 'unavailable',
      observedAtLabel: 'Unavailable',
      freshnessLabel: 'Unknown',
      explanation: 'No temperature could be loaded for this example event.',
    },
    provenance: {
      ...matching.provenance!,
      state: 'unavailable',
      observedAtLabel: 'Unavailable',
      retrievedAtLabel: 'Unavailable',
      evidenceLabel: 'No input artifact available',
      explanation: 'The source cannot supply evidence for this example event.',
      open: true,
    },
    transaction: null,
  },
  observedReplay: {
    ...matching,
    mode: 'replay',
  },
  advisory: {
    ...matching,
    eventId: '',
    mode: 'advisory',
    comparisons: {},
    measurement: {
      ...matching.measurement!,
      tempC: 27.1,
      state: 'advisory',
      sourceName: 'Example temperature forecast',
      observedAtLabel: '27 Sep 2026 · 09:00 JST',
      freshnessLabel: 'Issued 26 Sep 2026 · 09:00 JST',
      explanation: 'Forecast only. No observed event or relief decision is attached.',
    },
    // The provenance molecule currently labels its timestamp Observed. Do not
    // mislabel a forecast: keep it unavailable until that adapter is reviewed.
    provenance: null,
    transaction: null,
  },
  incomplete: {
    ...matching,
    comparisons: {
      ...comparisons,
      dataSeason: { recorded: '2025', evidence: null, result: 'match' },
    },
  },
  wrongDeployment: {
    ...matching,
    comparisons: {
      ...comparisons,
      deployment: { recorded: values.deployment, evidence: `0x${'66'.repeat(20)}`, result: 'mismatch' },
    },
  },
} satisfies Record<string, EventVerificationPreview>;
