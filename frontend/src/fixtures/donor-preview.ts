import type { DonorFixture } from '../components/organisms/donor/model';

// Local presentation examples. These are not the #69 ledger or a wallet response.
const ready: DonorFixture = {
  connection: 'connected', poolConfigured: true, readState: 'ready',
  balanceBaseUnits: '50000000000000000000000', allowanceBaseUnits: '0',
  amount: '20000', memo: 'For coastal growers', ledgerState: 'ready',
  ledger: [
    { id: 'sample-event-5', event: 'Swept', amountBaseUnits: '1000000000000000000000', description: 'Expired reserve returned to the pool. No outgoing transfer.', recorded: 'Sample block 105 · log 0' },
    { id: 'sample-event-4', event: 'Claimed', amountBaseUnits: '1500000000000000000000', description: 'A previously held sample allocation was paid after a claim.', recorded: 'Sample block 104 · log 1' },
    { id: 'sample-event-3', event: 'Held', amountBaseUnits: null, description: 'Example allocation remains reserved. This event supplies no amount; nothing was paid.', recorded: 'Sample block 103 · log 0' },
    { id: 'sample-event-2', event: 'Paid', amountBaseUnits: '2500000000000000000000', description: 'Example confirmed farmer payment from the pooled fund.', recorded: 'Sample block 102 · log 0' },
    { id: 'sample-event-1', event: 'Donated', amountBaseUnits: '10000000000000000000000', description: 'Example contribution to the pool. It is not earmarked for a particular farmer.', recorded: 'Sample block 101 · log 0' },
  ],
};

export const donorPreviews = {
  ready,
  disconnected: { ...ready, connection: 'disconnected', balanceBaseUnits: null, allowanceBaseUnits: null },
  wrongNetwork: { ...ready, connection: 'wrong-network' },
  missingSetup: { ...ready, poolConfigured: false, ledgerState: 'unavailable', ledger: [] },
  loading: { ...ready, readState: 'loading', balanceBaseUnits: null, allowanceBaseUnits: null, ledgerState: 'loading', ledger: [] },
  unavailable: { ...ready, readState: 'unavailable', balanceBaseUnits: null, allowanceBaseUnits: null, ledgerState: 'unavailable', ledger: [] },
  allowanceUnavailable: { ...ready, allowanceBaseUnits: null },
  emptyLedger: { ...ready, ledger: [] },
  approvalReview: { ...ready, phase: 'review', operation: 'approval' },
  approvalPending: { ...ready, phase: 'pending', operation: 'approval' },
  approved: { ...ready, phase: 'approved', operation: 'approval' },
  approvalCancelled: { ...ready, phase: 'cancelled', operation: 'approval' },
  approvalRejected: { ...ready, phase: 'rejected', operation: 'approval' },
  approvalFailed: { ...ready, phase: 'failed', operation: 'approval' },
  approvalUnavailable: { ...ready, phase: 'unavailable', operation: 'approval' },
  donationReview: { ...ready, allowanceBaseUnits: '20000000000000000000000', phase: 'review', operation: 'donation' },
  donationPending: { ...ready, allowanceBaseUnits: '20000000000000000000000', phase: 'pending', operation: 'donation' },
  donationConfirmed: { ...ready, balanceBaseUnits: '30000000000000000000000', phase: 'confirmed', operation: 'donation' },
  donationCancelled: { ...ready, allowanceBaseUnits: '20000000000000000000000', phase: 'cancelled', operation: 'donation' },
  donationRejected: { ...ready, allowanceBaseUnits: '20000000000000000000000', phase: 'rejected', operation: 'donation' },
  donationFailed: { ...ready, allowanceBaseUnits: '20000000000000000000000', phase: 'failed', operation: 'donation' },
  donationUnavailable: { ...ready, allowanceBaseUnits: '20000000000000000000000', phase: 'unavailable', operation: 'donation' },
} satisfies Record<string, DonorFixture>;

export type DonorSample = keyof typeof donorPreviews;
