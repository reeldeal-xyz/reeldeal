/** Frontend presentation props only. These are not the #59 domain or API contract. */
export interface ContributionSplitProps {
  reference: string;
  saleAmount: string;
  sellerAmount: string;
  fundAmount: string;
  fundShareLabel: string;
  state: 'pending' | 'paid' | 'unavailable';
  explanation: string;
}

export interface MeasurementRowProps {
  label: string;
  tempC: number | null;
  sourceName: string;
  observedAtLabel: string;
  freshnessLabel: string;
  state: 'available' | 'loading' | 'missing' | 'stale' | 'advisory' | 'unavailable';
  explanation?: string;
}

export interface ProvenanceDetailsProps {
  sourceName: string;
  datasetLabel: string;
  observedAtLabel: string;
  retrievedAtLabel: string;
  evidenceLabel: string;
  state: 'available' | 'unavailable';
  explanation?: string;
  open?: boolean;
}

export interface TransactionRowProps {
  reference: string;
  label: string;
  amount: string;
  recipient?: string;
  state: 'pending' | 'paid' | 'held' | 'unavailable';
  timeLabel: string;
  explanation: string;
}
