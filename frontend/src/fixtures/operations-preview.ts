import type { CoopPreview, HolderPreview, OperationsPlot } from '../components/organisms/operations/props';
import type { HeldReason } from '../components/organisms/farmer-relief/props';

// All accounts, role checks, registrations and outcomes below are synthetic.
// There are no chain reads, private farmer identifiers, receipt hashes or QR links.
const holder = '0x3333333333333333333333333333333333333333';
const farmer = '0x1111111111111111111111111111111111111111';
const asOf = '2026-09-26T03:00:00Z';
const request: OperationsPlot = {
  id: 'sample-request-001', plotLabel: 'p1213-001', seasonLabel: '2026', species: 'Scallop',
  holder, farmer, slotRegistry: '0x4444444444444444444444444444444444444444',
  identityLevel: 0, slot: 'pending', expiresAt: '2027-03-31T00:00:00Z',
  requestedAtLabel: '26 Sep 2026 · 12:00 JST · example', relief: { kind: 'none' },
};
const issued: OperationsPlot = {
  ...request, id: 'sample-request-009', plotLabel: 'p1213-009', species: 'Hoya',
  farmer: '0x2222222222222222222222222222222222222222',
  slotRegistry: '0x5555555555555555555555555555555555555555',
  slot: 'issued', identityLevel: 1,
  relief: { kind: 'paid', amount: '15000' }, reliefRecipient: '0x2222222222222222222222222222222222222222',
};
const context: HolderPreview['context'] = { asOf, wallet: holder, chainId: 11155111, authority: 'holder' };
const single: HolderPreview = { state: 'ready', context, rows: [request] };

export const holderPreviews = {
  queue: { ...single, rows: [request, issued] },
  unverified: single,
  verified: { ...single, rows: [{ ...request, identityLevel: 2 }] },
  issued: { ...single, rows: [issued] },
  confirmIssue: { ...single, initialPhase: 'confirm' },
  issuePending: { ...single, initialPhase: 'pending' },
  revokePending: { ...single, rows: [issued], initialPhase: 'pending' },
  walletCancelled: { ...single, initialPhase: 'wallet-rejected' },
  expired: { ...single, rows: [{ ...issued, expiresAt: '2026-09-26T03:00:00Z' }] },
  revoked: { ...single, rows: [{ ...issued, slot: 'revoked' }] },
  missingRegistry: { ...single, rows: [{ ...request, slotRegistry: undefined }] },
  missingFarmer: { ...single, rows: [{ ...request, farmer: undefined }] },
  disconnected: { ...single, context: { ...context, wallet: undefined } },
  wrongNetwork: { ...single, context: { ...context, chainId: 1 } },
  unauthorized: { ...single, context: { ...context, authority: 'unauthorized' } },
  authorityUnavailable: { ...single, context: { ...context, authority: 'unavailable' } },
  slotUnavailable: { ...single, rows: [{ ...issued, expiresAt: null }] },
  loading: { ...single, state: 'loading', rows: [] },
  empty: { ...single, state: 'empty', rows: [] },
  unavailable: { ...single, state: 'unavailable', rows: [] },
} satisfies Record<string, HolderPreview>;

const heldPlot = (reason: HeldReason): OperationsPlot => ({
  ...issued, id: `sample-held-${reason}`, plotLabel: 'p1213-001', species: 'Scallop',
  identityLevel: reason === 'NO_FARMER' ? null : reason === 'UNVERIFIED' ? 0 : 1,
  slot: reason === 'NO_FARMER' ? 'pending' : reason === 'PLOT_EXPIRED' ? 'expired' : 'issued',
  expiresAt: reason === 'PLOT_EXPIRED' ? asOf : issued.expiresAt,
  farmer: reason === 'NO_FARMER' ? undefined : farmer,
  reliefRecipient: ['NO_FARMER', 'ZONE_MISMATCH'].includes(reason) ? undefined : farmer,
  relief: { kind: 'held', reason, amount: '15000' },
});
const overview: CoopPreview = { state: 'ready', asOf, rows: [request, issued] };
export const coopPreviews = {
  overview,
  paid: { ...overview, rows: [issued] },
  unverified: { ...overview, rows: [{ ...issued, identityLevel: 0, relief: { kind: 'none' } }] },
  heldUnverified: { ...overview, rows: [heldPlot('UNVERIFIED')] },
  verifiedHistoricalHold: { ...overview, rows: [{ ...heldPlot('UNVERIFIED'), identityLevel: 1 }] },
  heldNoFarmer: { ...overview, rows: [heldPlot('NO_FARMER')] },
  heldPlotExpired: { ...overview, rows: [heldPlot('PLOT_EXPIRED')] },
  heldCap: { ...overview, rows: [heldPlot('CAP')] },
  heldZoneMismatch: { ...overview, rows: [heldPlot('ZONE_MISMATCH')] },
  expired: { ...overview, rows: [{ ...issued, expiresAt: asOf }] },
  revoked: { ...overview, rows: [{ ...issued, slot: 'revoked' }] },
  claimWindowElapsed: { ...overview, rows: [{ ...issued, relief: { kind: 'expired' } }] },
  identityUnavailable: { ...overview, rows: [{ ...issued, identityLevel: null }] },
  missingHolder: { ...overview, rows: [{ ...issued, holder: undefined }] },
  slotUnavailable: { ...overview, rows: [{ ...issued, expiresAt: null, relief: { kind: 'unavailable' } }] },
  loading: { ...overview, state: 'loading', rows: [] },
  empty: { ...overview, state: 'empty', rows: [] },
  unavailable: { ...overview, state: 'unavailable', rows: [] },
} satisfies Record<string, CoopPreview>;
