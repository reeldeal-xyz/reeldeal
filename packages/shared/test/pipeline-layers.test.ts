import { describe, expect, test } from 'bun:test';
import { pipelineLayerInfo } from '../src/pipeline-map';

// As served by GET /hab/layers/2025-08-15 after `pipeline hab build --month 2025-08` (real JAXA inputs).
const CHLA_MONTHLY = {
  module: 'hab',
  layer: 'chla_sgli_monthly',
  cadence: 'monthly',
  date: '2025-08-01',
  region: 'miyagi',
  product: 'GCOM-C_SGLI_L3-CHLA.daytime.v3.monthly',
  variable: 'CHL',
  unit: 'mg/m3',
  bbox: [140.8, 37.7, 142.0, 39.1],
  validFraction: 0.585832,
  tileUrl: '/hab/tiles/miyagi/monthly/2025-08/chla_sgli_monthly/{z}/{x}/{y}.png',
  tileScale: {
    kind: 'log', min: 0.1, max: 30, unit: 'mg/m3',
    colors: ['#2c1c7a', '#2a4fb8', '#2294c9', '#2fc0b0', '#7ad86b', '#d7e24a', '#f6a93b', '#d8412f'],
  },
  zarrUrl: null,
  sha256: '1e7778b1ea5b45ebc3ac6389def4e2be104775021f61ba20234c258f09bee895',
};

describe('pipeline layer info', () => {
  test('accepts a served chl-a layer', () => {
    expect(pipelineLayerInfo.parse(CHLA_MONTHLY).tileUrl).toBe(CHLA_MONTHLY.tileUrl);
  });

  test('accepts a layer without tiles', () => {
    expect(() => pipelineLayerInfo.parse({ ...CHLA_MONTHLY, tileUrl: null, tileScale: null })).not.toThrow();
  });

  test('rejects absolute or non-template tile URLs', () => {
    for (const tileUrl of ['https://evil.example/{z}/{x}/{y}.png', '/hab/tiles/../x/{z}/{x}/{y}.png', '/hab/layers/2025-08-01']) {
      expect(() => pipelineLayerInfo.parse({ ...CHLA_MONTHLY, tileUrl })).toThrow();
    }
  });
});
