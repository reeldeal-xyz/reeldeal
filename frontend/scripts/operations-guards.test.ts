import { describe, expect, test } from 'bun:test';
import { holderPreviews } from '../src/fixtures/operations-preview';
import { currentFarmer, displayedSlot, holderAction } from '../src/components/organisms/operations/guards';
import type { OperationsPlot } from '../src/components/organisms/operations/props';

const { rows: [pending], context } = holderPreviews.unverified;
const issued = holderPreviews.issued.rows[0];

describe('operations preview boundaries', () => {
  test('identity alone neither grants holder authority nor blocks an authorized slot preview', () => {
    for (const identityLevel of [0, 1, 2, null] as const) {
      expect(holderAction({ ...pending, identityLevel }, context).action).toBe('issue');
      expect(holderAction({ ...pending, identityLevel }, { ...context, authority: 'unauthorized' }).action).toBeUndefined();
    }
    expect(holderAction(issued, context).action).toBe('revoke');
  });

  test('missing or contradictory wallet, network, role and per-plot registry fail closed', () => {
    for (const sample of ['missingRegistry', 'missingFarmer', 'disconnected', 'wrongNetwork', 'unauthorized', 'authorityUnavailable', 'slotUnavailable'] as const) {
      const fixture = holderPreviews[sample];
      expect(holderAction(fixture.rows[0], fixture.context).action).toBeUndefined();
    }
    for (const wallet of ['0x' + '0'.repeat(40), '0x123', '0x' + '9'.repeat(40)]) {
      expect(holderAction(pending, { ...context, wallet }).action).toBeUndefined();
    }
    expect(holderAction({ ...pending, slotRegistry: '0x' + '0'.repeat(40) }, context).action).toBeUndefined();
  });

  test('expiry at the snapshot boundary is expired, even when the retained owner is valid', () => {
    const expired = { ...issued, expiresAt: context.asOf };
    expect(displayedSlot(expired, context.asOf)).toBe('expired');
    expect(currentFarmer(expired, context.asOf)).toBeUndefined();
    expect(holderAction(expired, context).action).toBeUndefined();
    expect(holderAction({ ...pending, expiresAt: context.asOf }, context).action).toBeUndefined();
    expect(currentFarmer(issued, context.asOf)).toBe(issued.farmer);
  });

  test('revoked, unavailable and invalid time data cannot become active ownership or actions', () => {
    for (const row of [
      { ...issued, slot: 'revoked' }, { ...issued, slot: 'unavailable' },
      { ...issued, expiresAt: null }, { ...issued, expiresAt: 'not a date' },
      { ...issued, slot: 'unknown' },
    ] as OperationsPlot[]) {
      expect(currentFarmer(row, context.asOf)).toBeUndefined();
      expect(holderAction(row, context).action).toBeUndefined();
    }
    expect(currentFarmer(issued, 'not a snapshot')).toBeUndefined();
    expect(displayedSlot({ ...issued, slot: 'unknown' } as unknown as OperationsPlot, context.asOf)).toBe('unavailable');
    expect(holderAction(pending, { ...context, asOf: 'not a snapshot' }).action).toBeUndefined();
    expect(currentFarmer({ ...issued, farmer: '0x' + '0'.repeat(40) }, context.asOf)).toBeUndefined();
  });

  test('checking an action never changes the recorded slot or historical relief', () => {
    const before = structuredClone(issued);
    holderAction(issued, context);
    currentFarmer(issued, context.asOf);
    expect(issued).toEqual(before);
  });
});
