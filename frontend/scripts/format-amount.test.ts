import { describe, expect, test } from 'bun:test';
import { formatAmount, jpycFromBaseUnits } from '../src/lib/format-amount';

describe('jpycFromBaseUnits', () => {
  test('converts 18-decimal base units to yen text', () => {
    expect(jpycFromBaseUnits(20000n * 10n ** 18n)).toBe('20000');
    expect(jpycFromBaseUnits('50000000000000000000000')).toBe('50000');
  });
  test('keeps fractional yen without floating point', () => {
    expect(jpycFromBaseUnits(1500000000000000000n)).toBe('1.5');
    expect(jpycFromBaseUnits(1n)).toBe('0.000000000000000001');
    expect(jpycFromBaseUnits(0n)).toBe('0');
  });
  test('rejects non-integer input', () => {
    expect(jpycFromBaseUnits('20000.5')).toBeNull();
    expect(jpycFromBaseUnits(-1n)).toBeNull();
    expect(jpycFromBaseUnits(20000)).toBeNull();
    expect(jpycFromBaseUnits(undefined)).toBeNull();
  });
  test('composes with formatAmount for display', () => {
    expect(formatAmount(jpycFromBaseUnits(200000n * 10n ** 18n))).toBe('200,000');
  });
});
