/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { formatAmount } from '../src/lib/format-amount';
import { isLegacyPage } from '../src/lib/legacy-routes';
import { parseOffer } from '../src/components/solid/bid-services';
import { fishIllustration } from '../src/lib/fish-illustration';
import { measurementState } from '../src/components/molecules/relief/measurement-state';

describe('display and route boundaries', () => {
  test('uses only known species illustrations and keeps the missing-photo fallback', () => {
    for (const species of ['katsuo', 'sanma', 'saba', 'hotate', 'maguro', 'awabi']) {
      expect(fishIllustration(species).src).toBe(`/images/fish/${species}-ice.webp`);
    }
    expect(fishIllustration(' Mebachi ').src).toBe('/images/fish/maguro-ice.webp');
    for (const species of [undefined, '', 'unknown', '__proto__', '../saba']) {
      expect(fishIllustration(species).src).toBe('/images/landing-placeholder.png');
    }
  });
  test('keeps full token precision when formatting', () => {
    expect(formatAmount('9007199254740993.000000000000000001')).toBe('9,007,199,254,740,993.000000000000000001');
    expect(formatAmount('0')).toBe('0');
    expect(formatAmount('NaN')).toBeNull();
    for (const value of [2400, null, undefined, {}, [], Infinity]) expect(formatAmount(value)).toBeNull();
  });
  test('missing and malformed temperatures cannot claim an observation', () => {
    expect(measurementState('available', 0)).toBe('available');
    expect(measurementState('available', null)).toBe('missing');
    for (const value of [NaN, Infinity, '26.4', {}]) expect(measurementState('available', value)).toBe('unavailable');
    expect(measurementState('stale', 26.4)).toBe('stale');
    expect(measurementState('advisory', 26.4)).toBe('advisory');
    expect(measurementState('loading', 0)).toBe('loading');
    expect(measurementState('unexpected', 26.4)).toBe('unavailable');
  });
  test('demo offers reject ambiguous or unsafe amounts', () => {
    for (const value of ['', '-1', '0', '2.5', '1e6', '9007199254740992']) expect(parseOffer(value)).toBeNull();
    expect(parseOffer('2400')).toBe(2400);
  });
  test('only inventoried page routes can redirect to the legacy origin', () => {
    for (const route of ['/map', '/donate/', '/verify/event-1', '/liff', '/coop', '/holder']) expect(isLegacyPage(route)).toBe(true);
    expect(isLegacyPage('/market')).toBe(false);
    for (const route of ['/api/world', '//evil.example', '/verify/', '/map/extra', '/health']) expect(isLegacyPage(route)).toBe(false);
  });
});
