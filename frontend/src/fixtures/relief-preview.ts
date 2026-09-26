import type {
  ContributionSplitProps,
  MeasurementRowProps,
  ProvenanceDetailsProps,
  TransactionRowProps,
} from '../components/molecules/relief/props';

// Presentation-only samples for #61. Replace with reviewed #59 fixture adapters
// after that dependency lands; these values do not describe a real observation,
// relief decision, wallet transfer, sale, or configured contribution policy.
export const reliefPreviewNotice = 'Synthetic preview · no live readings, payments or notifications.';

const split: ContributionSplitProps = {
  reference: 'Example order · demo-sanma-001',
  saleAmount: '2400',
  sellerAmount: '2160',
  fundAmount: '240',
  fundShareLabel: '10% example',
  state: 'pending',
  explanation: 'The example sale contributes 240 JPYC. Its fund transfer is awaiting confirmation.',
};

export const contributionPreviews = {
  pending: split,
  paid: {
    ...split,
    state: 'paid',
    explanation: 'This synthetic state represents a confirmed contribution to the relief fund.',
  },
  unavailable: {
    ...split,
    state: 'unavailable',
    explanation: 'Transfer status could not be loaded. The amounts shown are the example order split, not a payment receipt.',
  },
} satisfies Record<string, ContributionSplitProps>;

const measurement: MeasurementRowProps = {
  label: 'Sea temperature',
  tempC: 26.4,
  sourceName: 'Example in-water sensor',
  observedAtLabel: '26 Sep 2026 · 11:50 JST',
  freshnessLabel: '10 minutes old at preview time',
  state: 'available',
  explanation: 'A synthetic observation. No threshold or payout decision is attached.',
};

export const measurementPreviews = {
  observed: measurement,
  zero: { ...measurement, tempC: 0 },
  malformed: { ...measurement, tempC: Number.NaN },
  missingValue: { ...measurement, tempC: null },
  stale: {
    ...measurement,
    state: 'stale',
    observedAtLabel: '25 Sep 2026 · 12:00 JST',
    freshnessLabel: '24 hours old at preview time',
    explanation: 'Last available reading. Its stale status is supplied by this fixture; no freshness policy is inferred here.',
  },
  advisory: {
    ...measurement,
    state: 'advisory',
    tempC: 27.1,
    sourceName: 'Example temperature forecast',
    observedAtLabel: '27 Sep 2026 · 09:00 JST',
    freshnessLabel: 'Issued 26 Sep 2026 · 09:00 JST',
    explanation: 'Forecast only. This does not confirm a threshold crossing or release funds.',
  },
  loading: {
    ...measurement,
    state: 'loading',
    tempC: null,
    observedAtLabel: 'Not loaded',
    freshnessLabel: 'Unknown',
    explanation: 'Waiting for a reading and its observation time.',
  },
  missing: {
    ...measurement,
    state: 'missing',
    tempC: null,
    freshnessLabel: 'No reading for this time',
    explanation: 'The source supplied no temperature for this observation. A missing value is not zero.',
  },
  unavailable: {
    ...measurement,
    state: 'unavailable',
    tempC: null,
    observedAtLabel: 'Unavailable',
    freshnessLabel: 'Unknown',
    explanation: 'The source is unavailable. No current temperature can be shown.',
  },
} satisfies Record<string, MeasurementRowProps>;

const provenance: ProvenanceDetailsProps = {
  sourceName: 'Example in-water sensor',
  datasetLabel: 'Synthetic buoy temperature series',
  observedAtLabel: '26 Sep 2026 · 11:50 JST',
  retrievedAtLabel: '26 Sep 2026 · 11:55 JST',
  evidenceLabel: 'Preview fixture only · no source receipt',
  state: 'available',
  explanation: 'Provider, dataset and timestamps remain visible together. Production evidence is supplied by the reviewed data contract.',
};

export const provenancePreviews = {
  collapsed: provenance,
  expanded: { ...provenance, open: true },
  unavailable: {
    ...provenance,
    state: 'unavailable',
    open: true,
    observedAtLabel: 'Unavailable',
    retrievedAtLabel: 'Unavailable',
    evidenceLabel: 'No evidence available',
    explanation: 'Source metadata could not be loaded. This view cannot verify a reading.',
  },
} satisfies Record<string, ProvenanceDetailsProps>;

const transaction: TransactionRowProps = {
  reference: 'Example relief event · demo-001',
  label: 'Farmer relief',
  amount: '15000',
  recipient: '0x1111111111111111111111111111111111111111',
  state: 'pending',
  timeLabel: '26 Sep 2026 · 12:00 JST',
  explanation: 'Example transfer awaiting confirmation. Funds have not been marked as paid.',
};

export const transactionPreviews = {
  pending: transaction,
  paid: {
    ...transaction,
    state: 'paid',
    explanation: 'This synthetic state represents a confirmed payment. There is no live transaction behind this preview.',
  },
  held: {
    ...transaction,
    state: 'held',
    explanation: 'Identity verification is pending. This example amount is held; no payment has been released.',
  },
  unavailable: {
    ...transaction,
    state: 'unavailable',
    recipient: undefined,
    explanation: 'The example transfer status and recipient could not be loaded. No payment outcome is known.',
  },
} satisfies Record<string, TransactionRowProps>;
