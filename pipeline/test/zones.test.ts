import { expect, test, describe } from 'bun:test';
import { ZONES } from '@repo/shared';

type Ring = [number, number][];
interface PolygonGeoJson {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: { type: 'Polygon'; coordinates: Ring[] };
  }[];
}

const dataDir = new URL('../data/zones/', import.meta.url);

/** Shoelace formula on [lon, lat] directly (planar), as GeoJSON/RFC 7946 assumes for validation. */
function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

async function loadZone(file: string): Promise<PolygonGeoJson> {
  return Bun.file(new URL(file, dataDir)).json();
}

describe('zone GeoJSON (#22)', () => {
  for (const zone of ['karakuwa-east', 'kesennuma-bay'] as const) {
    test(`${zone}.geojson: valid FeatureCollection tagged for the right zone`, async () => {
      const gj = await loadZone(`${zone}.geojson`);
      expect(gj.type).toBe('FeatureCollection');
      expect(gj.features.length).toBe(1);
      const feature = gj.features[0]!;
      expect(feature.geometry.type).toBe('Polygon');
      expect(feature.properties.zone).toBe(zone);
      expect(ZONES).toContain(feature.properties.zone as (typeof ZONES)[number]);
    });

    test(`${zone}.geojson: marked approximate with a source citation`, async () => {
      const gj = await loadZone(`${zone}.geojson`);
      const props = gj.features[0]!.properties;
      expect(String(props.accuracy)).toMatch(/approximate/i);
      expect(String(props.accuracy)).toMatch(/^approximate, traced from https?:\/\//);
      expect(Array.isArray(props.sourceUrls)).toBe(true);
      expect((props.sourceUrls as string[]).length).toBeGreaterThan(0);
    });

    test(`${zone}.geojson: exterior ring is closed`, async () => {
      const gj = await loadZone(`${zone}.geojson`);
      const ring = gj.features[0]!.geometry.coordinates[0]!;
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring.at(-1)!);
    });

    test(`${zone}.geojson: exterior ring follows the right-hand rule (counterclockwise)`, async () => {
      const gj = await loadZone(`${zone}.geojson`);
      const ring = gj.features[0]!.geometry.coordinates[0]!;
      expect(signedArea(ring)).toBeGreaterThan(0);
    });

    test(`${zone}.geojson: coordinates are lon/lat WGS84 within the Kesennuma area`, async () => {
      const gj = await loadZone(`${zone}.geojson`);
      const ring = gj.features[0]!.geometry.coordinates[0]!;
      for (const [lon, lat] of ring) {
        expect(lon).toBeGreaterThan(141);
        expect(lon).toBeLessThan(142.2);
        expect(lat).toBeGreaterThan(38.5);
        expect(lat).toBeLessThan(39.2);
      }
    });
  }
});
