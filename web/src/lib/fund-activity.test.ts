import { describe, expect, test } from 'bun:test';
import { computeTotals, isMarketplaceSaleMemo, type FundActivityEvent } from './fund-activity';

function event(partial: Partial<FundActivityEvent> & Pick<FundActivityEvent, 'type'>): FundActivityEvent {
  return { triggeredAt: null, blockNumber: 1, txHash: '0xabc', logIndex: 0, ...partial };
}

describe('isMarketplaceSaleMemo', () => {
  test('matches a sale:<orderId> memo', () => {
    expect(isMarketplaceSaleMemo('sale:42')).toBe(true);
    expect(isMarketplaceSaleMemo('SALE:abc-123')).toBe(true);
  });

  test('does not match a plain memo or missing memo', () => {
    expect(isMarketplaceSaleMemo('For the scallop growers')).toBe(false);
    expect(isMarketplaceSaleMemo(undefined)).toBe(false);
    expect(isMarketplaceSaleMemo('')).toBe(false);
  });
});

describe('computeTotals', () => {
  test('sums Donated and Paid+Claimed amounts separately', () => {
    const totals = computeTotals([
      event({ type: 'Donated', amountWei: '1000' }),
      event({ type: 'Donated', amountWei: '2000' }),
      event({ type: 'Paid', amountWei: '500' }),
      event({ type: 'Claimed', amountWei: '300' }),
    ]);
    expect(totals.donatedWei).toBe('3000');
    expect(totals.paidWei).toBe('800');
    expect(totals.heldCount).toBe(0);
    expect(totals.availableWei).toBeNull();
  });

  test('heldCount nets out Held events already resolved by a later Claimed/Swept', () => {
    const totals = computeTotals([
      event({ type: 'Held', plotLabel: 'p1' }),
      event({ type: 'Held', plotLabel: 'p2' }),
      event({ type: 'Held', plotLabel: 'p3' }),
      event({ type: 'Claimed', plotLabel: 'p1', amountWei: '100' }),
      event({ type: 'Swept', plotLabel: 'p2', amountWei: '50' }),
    ]);
    expect(totals.heldCount).toBe(1); // p3 still outstanding
  });

  test('heldCount never goes negative', () => {
    const totals = computeTotals([event({ type: 'Claimed', amountWei: '10' })]);
    expect(totals.heldCount).toBe(0);
  });

  test('passes availableWei through unchanged', () => {
    const totals = computeTotals([], '999');
    expect(totals.availableWei).toBe('999');
  });
});
