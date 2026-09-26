import { describe, expect, test } from 'bun:test';
import { formatJpyc, parseJpyc, shortAddress } from './format';

describe('formatJpyc', () => {
  test('formats an 18-decimal amount with a thousands separator and yen sign', () => {
    // 18 decimals -- ¥20,000 is 20000e18, never 20000e6 (see CLAUDE.md).
    expect(formatJpyc(20_000n * 10n ** 18n)).toBe('¥20,000');
  });

  test('formats zero and small amounts', () => {
    expect(formatJpyc(0n)).toBe('¥0');
    expect(formatJpyc(1n * 10n ** 18n)).toBe('¥1');
  });

  test('formats a large balance with multiple thousands separators', () => {
    expect(formatJpyc(1_234_567n * 10n ** 18n)).toBe('¥1,234,567');
  });

  test('round-trips through parseJpyc', () => {
    const amount = parseJpyc('20000');
    expect(amount).toBe(20_000n * 10n ** 18n);
    expect(formatJpyc(amount)).toBe('¥20,000');
  });
});

describe('shortAddress', () => {
  test('shortens a long address to a head…tail form', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
  });

  test('leaves a short string unchanged', () => {
    expect(shortAddress('0x1234')).toBe('0x1234');
  });
});
