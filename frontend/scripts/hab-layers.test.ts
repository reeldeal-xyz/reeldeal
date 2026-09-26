/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { PipelineLayerInfo } from '@repo/shared';
import { habMonth, pickChlLayer, validTilePath } from '../src/lib/hab-layers';

const layer = (over: Partial<PipelineLayerInfo>): PipelineLayerInfo => ({
  module: 'hab', layer: 'chla_sgli', cadence: 'daily', date: '2025-08-15', region: 'miyagi',
  product: 'GCOM-C_SGLI_L3-CHLA.daytime.v3', variable: 'CHL', unit: 'mg/m3', bbox: [140.8, 37.7, 142, 39.1],
  validFraction: 0.1, tileUrl: '/hab/tiles/miyagi/daily/2025-08-15/chla_sgli/{z}/{x}/{y}.png',
  tileScale: { kind: 'log', min: 0.1, max: 30, unit: 'mg/m3', colors: ['#000000', '#ffffff'] },
  zarrUrl: null, sha256: 'a'.repeat(64), ...over,
});

describe('HAB tile proxy boundary', () => {
  test('accepts pipeline tile paths', () => {
    expect(validTilePath('hab/tiles/miyagi/monthly/2025-08/chla_sgli_monthly/10/909/401.png')).toBe(true);
    expect(validTilePath('heat/tiles/miyagi/daily/2025-08-15/sst_sgli_night/0/0/0.png')).toBe(true);
    expect(validTilePath('heat/tiles/miyagi/daily-normal/08-15/sst_normal/16/58000/25000.png')).toBe(true);
  });

  test('rejects anything else before it reaches the pipeline', () => {
    for (const path of [
      '', 'health', 'hab/layers/2025-08-15', 'storm/tiles/miyagi/daily/2025-08-15/x/1/0/0.png',
      'hab/tiles/../plots/daily/2025-08-15/x/1/0/0.png', 'hab/tiles/miyagi/yearly/2025/x/1/0/0.png',
      'hab/tiles/miyagi/monthly/2025-08/chla_sgli_monthly/2/4/0.png', // x out of range at z2
      'hab/tiles/miyagi/monthly/2025-08/chla_sgli_monthly/17/0/0.png', // above max zoom
      'hab/tiles/miyagi/monthly/2025-08/chla_sgli_monthly/10/909/401.png?x=1',
      'hab/tiles/miyagi/monthly/2025-08/Chla/10/909/401.png',
    ]) expect(validTilePath(path)).toBe(false);
  });
});

describe('chl-a layer choice', () => {
  test('prefers the monthly composite over cloudy dailies', () => {
    const monthly = layer({ layer: 'chla_sgli_monthly', cadence: 'monthly', date: '2025-08-01', validFraction: 0.58 });
    expect(pickChlLayer([layer({ validFraction: 0.9 }), monthly])).toBe(monthly);
  });

  test('falls back to the best daily, and ignores untiled or non-chl layers', () => {
    const best = layer({ validFraction: 0.3 });
    expect(pickChlLayer([layer({ validFraction: 0.1 }), best, layer({ variable: 'SST', validFraction: 0.9 })])).toBe(best);
    expect(pickChlLayer([layer({ tileUrl: null, tileScale: null })])).toBeNull();
    expect(pickChlLayer([])).toBeNull();
  });

  test('month parameter defaults to August', () => {
    expect(habMonth('06')).toBe('06');
    expect(habMonth(null)).toBe('08');
    expect(habMonth('13')).toBe('08');
    expect(habMonth('__proto__')).toBe('08');
  });
});
