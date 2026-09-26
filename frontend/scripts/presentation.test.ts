/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { formatAmount } from '../src/lib/format-amount';
import { isLegacyPage } from '../src/lib/legacy-routes';
import { parseOffer } from '../src/components/solid/bid-services';

describe('display and route boundaries', () => {
  test('keeps full token precision when formatting', () => {
    expect(formatAmount('9007199254740993.000000000000000001')).toBe('9,007,199,254,740,993.000000000000000001');
    expect(formatAmount('0')).toBe('0');
    expect(formatAmount('NaN')).toBeNull();
  });
  test('demo offers reject ambiguous or unsafe amounts', () => {
    for (const value of ['', '-1', '0', '2.5', '1e6', '9007199254740992']) expect(parseOffer(value)).toBeNull();
    expect(parseOffer('2400')).toBe(2400);
  });
  test('only inventoried page routes can redirect to the legacy origin', () => {
    for (const route of ['/map', '/donate/', '/verify/event-1', '/liff', '/coop', '/holder']) expect(isLegacyPage(route)).toBe(true);
    for (const route of ['/api/world', '//evil.example', '/verify/', '/map/extra', '/health']) expect(isLegacyPage(route)).toBe(false);
  });
});
