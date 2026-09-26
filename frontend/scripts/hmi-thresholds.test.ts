import { describe, expect, test } from 'bun:test';
import { RULES, RULES_VERSION, pipelineHeatRisk, pipelinePlotRecord, type PipelineSpeciesDetail } from '@repo/shared';
import { thresholdView } from '../src/lib/hmi-thresholds';

const plot = pipelinePlotRecord.parse({
  plotCode: 'p1213-001', areaM2: 500, centroid: [141.6, 38.8], seaArea: 'karakuwa-east', prefecture: null,
  species: ['scallop'], operation: 'longline', source: 'fishery_right',
  geometry: { type: 'Polygon', coordinates: [[[141.6, 38.8], [141.61, 38.8], [141.61, 38.81], [141.6, 38.8]]] },
});
const now = new Date('2026-07-04T12:00:00Z');
const reading = (asOf: string, value: number | null) => ({
  index: 'SST', unit: 'degC', asOf, value,
  source: value === null ? null : { product: 'observed-sst', sha256: 'a'.repeat(64) },
  pixels: value === null ? null : { strategy: 'inside', count: 1, product: 'observed-sst', distanceKm: null, stationId: null },
});
const data = () => pipelineHeatRisk.parse({
  module: 'heat', module_version: 'heat-0.1.0',
  plot: { plotCode: plot.plotCode, areaM2: plot.areaM2, centroid: plot.centroid, seaArea: plot.seaArea },
  window: { start: '2026-06-01', end: '2026-10-31' }, advisory: [],
  indices: [reading('2026-07-01', 25), reading('2026-07-02', 26), reading('2026-07-03', 24), reading('2026-07-04', null)],
});

describe('scallop and sea-pineapple configured thresholds', () => {
  test('always exposes canonical thresholds even without online profile or observations', () => {
    const scallop = thresholdView('scallop', '2026', null, plot, null, now);
    expect(scallop.heat.map(({ rule }) => [rule.tempC, rule.threshold])).toEqual([[25, 14], [26, 12]]);
    expect(scallop.heat.every(({ count }) => count === null)).toBe(true);
    expect(scallop.bans[0].threshold).toBe(4);
    const hoya = thresholdView('hoya', '2026', null, undefined, null, now);
    expect(hoya.heat.map(({ rule }) => [rule.tempC, rule.threshold])).toEqual([[24, 30]]);
    expect(hoya.rulesVersion).toBe(RULES_VERSION);
  });

  test('inclusive SST comparisons count only observed days and disclose missingness', () => {
    const result = thresholdView('scallop', '2026', data(), plot, null, now);
    expect(result.heat.map(({ count }) => count)).toEqual([2, 1]);
    expect(result.heat[0]).toMatchObject({ observedDays: 3, missingDays: 1, elapsedDays: 4, asOf: '2026-07-03', reached: false });
    const hoyaPlot = { ...plot, plotCode: 'p1213-009', species: ['hoya'] };
    const observed = data(); observed.plot.plotCode = hoyaPlot.plotCode;
    expect(thresholdView('hoya', '2026', observed, hoyaPlot, null, now).heat[0].count).toBe(3);
  });

  test('zero is a genuine observed count, not a missing-data fallback', () => {
    const observed = data(); observed.indices = [reading('2026-07-01', 0)] as typeof observed.indices;
    expect(thresholdView('scallop', '2026', observed, plot, null, now).heat[0].count).toBe(0);
    observed.indices = [reading('2026-07-01', null)] as typeof observed.indices;
    expect(thresholdView('scallop', '2026', observed, plot, null, now).heat[0].count).toBeNull();
  });

  test('ignores dates outside July–September and future observations', () => {
    const observed = data();
    observed.indices = [reading('2026-06-30', 30), reading('2026-07-01', 25), reading('2026-07-05', 30), reading('2026-10-01', 30)] as typeof observed.indices;
    expect(thresholdView('scallop', '2026', observed, plot, null, now).heat[0].count).toBe(1);
    expect(thresholdView('scallop', '2025', observed, plot, null, now).heat[0].count).toBeNull();
    expect(thresholdView('scallop', '2026', observed, plot, null, new Date('2026-06-01')).heat[0].elapsedDays).toBe(0);
  });

  test('rejects duplicate/unordered dates and mismatched geometry or species', () => {
    const observed = data(); observed.indices.push(observed.indices[0]);
    const duplicate = thresholdView('scallop', '2026', observed, plot, null, now);
    expect(duplicate.invalidObservations).toBe(true); expect(duplicate.heat[0].count).toBeNull();
    const changed = thresholdView('scallop', '2026', data(), { ...plot, areaM2: 20000 }, null, now);
    expect(changed.geometryMismatch).toBe(true); expect(changed.heat[0].count).toBeNull();
    expect(thresholdView('scallop', '2026', data(), { ...plot, species: ['hoya'] }, null, now).heat[0].count).toBeNull();
  });

  test('online rule/version drift stops exposure calculation but preserves configured values', () => {
    const profile = { id: 'scallop', rules_version: RULES_VERSION,
      rules: RULES.filter((rule) => rule.species === 'scallop').map((rule) => ({ ...rule, tempC: rule.tempC ?? null, window: rule.window ?? null })),
    } as PipelineSpeciesDetail;
    expect(thresholdView('scallop', '2026', data(), plot, profile, now).drift).toBe(false);
    profile.rules[0].threshold = 1;
    const changed = thresholdView('scallop', '2026', data(), plot, profile, now);
    expect(changed.drift).toBe(true); expect(changed.heat[0].count).toBeNull();
    expect(changed.heat[0].rule.threshold).toBe(14);
  });
});
