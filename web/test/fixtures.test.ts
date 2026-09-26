import { computeIndices, parseErddapCsv, REFERENCE_FIRES, sha256Hex } from '@repo/shared';
import { expect, test } from 'bun:test';
import { fixtureBanweeksTriggers } from '../src/fixtures/banweeks';
import { FIXTURE_BUOY_MONTH, fixtureBuoy } from '../src/fixtures/buoy';
import { ZONE_FEATURES, SYNTHETIC_PLOTS, zoneFeaturesGeoJson } from '../src/fixtures/geo';
import { fixtureCsvText, fixtureIndices, fixtureSeries, fixtureTriggers } from '../src/fixtures/series';

const REPLAY_SEASONS = ['2022', '2023', '2024', '2025'] as const;

for (const season of REPLAY_SEASONS) {
  test(`karakuwa-east fixture reproduces REFERENCE_FIRES for ${season}`, async () => {
    const { triggers } = await fixtureTriggers('karakuwa-east', season);
    const byLabel = Object.fromEntries(triggers.map((t) => [t.label, t.firedOn]));
    expect(byLabel).toEqual(REFERENCE_FIRES[season]);
  });
}

test('the fixture CSV hashes to the sha256 recorded in the fixture SeriesFile (pinned-file integrity)', async () => {
  for (const zone of ['karakuwa-east', 'kesennuma-bay'] as const) {
    const series = await fixtureSeries(zone, '2023');
    const csv = fixtureCsvText(zone, '2023');
    expect(await sha256Hex(csv)).toBe(series.source.sha256);
  }
});

test('re-parsing the fixture CSV and recomputing indices matches the fixture IndicesFile', () => {
  const csv = fixtureCsvText('karakuwa-east', '2023');
  const recomputed = computeIndices(parseErddapCsv(csv));
  expect(recomputed).toEqual(fixtureIndices('karakuwa-east', '2023').days);
});

test('the fixture buoy month exists and its offset is in a plausible range', async () => {
  const buoy = await fixtureBuoy(FIXTURE_BUOY_MONTH);
  expect(buoy).not.toBeNull();
  expect(buoy!.readings.length).toBeGreaterThan(20);
  expect(buoy!.vsSatellite!.meanDiffC).toBeLessThan(0); // buoy runs cooler than satellite, per docs/INTERFACE.md
  const other = await fixtureBuoy('2099-01');
  expect(other).toBeNull();
});

test('the 2026 BANWEEKS fixture matches pipeline/test/banweeks.test.ts (#28) fire dates', async () => {
  expect(fixtureBanweeksTriggers('karakuwa-east').triggers[0]?.firedOn).toBe('2026-06-02');
  expect(fixtureBanweeksTriggers('kesennuma-bay').triggers[0]?.firedOn).toBe('2026-06-16');
  // fixtureTriggers(zone, '2026') must delegate to the same BANWEEKS fixture, not the HEAT generator.
  const viaFixtureTriggers = await fixtureTriggers('karakuwa-east', '2026');
  expect(viaFixtureTriggers).toEqual(fixtureBanweeksTriggers('karakuwa-east'));
});

test('zone geometry is labelled approximate and plots are labelled synthetic by construction', () => {
  const geojson = zoneFeaturesGeoJson();
  expect(geojson.features).toHaveLength(ZONE_FEATURES.length);
  for (const f of geojson.features) expect(f.properties.accuracy).toMatch(/approximate/i);
  expect(SYNTHETIC_PLOTS).toHaveLength(15);
  const zones = new Set(SYNTHETIC_PLOTS.map((p) => p.zone));
  expect(zones).toEqual(new Set(['karakuwa-east', 'kesennuma-bay']));
});
