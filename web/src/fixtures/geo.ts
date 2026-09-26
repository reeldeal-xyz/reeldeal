// Zone polygons and synthetic plot points for the map (#18).
//
// Zone geometry is copied from the real, hand-traced GeoJSON issue #22 landed at
// pipeline/data/ref/zones/{karakuwa-east,kesennuma-bay}.geojson (source: 宮城海区漁場計画 令和5年一斉更新, a
// 2023 Miyagi-prefecture fishery map; see that directory's sources.json for full citations and the
// geocoding method). It is still APPROXIMATE by the source's own admission — "not surveyed; do not use
// for navigation or legal boundary purposes" — which this module carries through as `properties.accuracy`
// on every feature, verbatim. Copied rather than imported across the workspace so the web app has no
// runtime dependency on pipeline/data/ (see docs/INTERFACE.md: "the web app may also import the files
// directly for the static demo"); keep in sync with the pipeline files by hand if #22's data changes.
//
// Plot points are entirely SYNTHETIC (no real plot registry exists yet — season slots are minted on
// ENSv2, #7/#8); that fact is surfaced in the UI, never silently implied as real.
import type { Species, Zone } from '@repo/shared';

export interface ZoneFeature {
  zone: Zone;
  label: string;
  accuracy: string;
  /** [lon, lat][] closed ring. */
  ring: [number, number][];
}

export const ZONE_FEATURES: ZoneFeature[] = [
  {
    zone: 'karakuwa-east',
    label: '唐桑半島東部 (Karakuwa Peninsula East)',
    accuracy:
      'Approximate — traced from the 2023 Miyagi fishery map (pref.miyagi.jp/documents/37871/kukakun.pdf, page 1); not surveyed.',
    ring: [
      [141.6332, 38.965],
      [141.6317, 38.9302],
      [141.655, 38.91],
      [141.6648, 38.8961],
      [141.6715, 38.8611],
      [141.705, 38.858],
      [141.7, 38.905],
      [141.672, 38.932],
      [141.665, 38.968],
      [141.6332, 38.965],
    ],
  },
  {
    zone: 'kesennuma-bay',
    label: '気仙沼湾 (Kesennuma Bay)',
    accuracy:
      'Approximate — traced from the 2023 Miyagi fishery map (pref.miyagi.jp/documents/37871/kukakun.pdf, pages 2-3); not surveyed; simplified to one ring (does not carve out Oshima island).',
    ring: [
      [141.66, 38.861],
      [141.6428, 38.8934],
      [141.6232, 38.9046],
      [141.5794, 38.9008],
      [141.59, 38.855],
      [141.6034, 38.8284],
      [141.645, 38.838],
      [141.66, 38.861],
    ],
  },
];

// Minimal local GeoJSON typing (not the `geojson` package's ambient globals) so this module has no
// extra type dependency on whatever maplibre-gl happens to hoist.
export interface ZonePolygonFeature {
  type: 'Feature';
  properties: { zone: Zone; label: string; accuracy: string };
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
}
export interface ZoneFeatureCollection {
  type: 'FeatureCollection';
  features: ZonePolygonFeature[];
}

export function zoneFeaturesGeoJson(): ZoneFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: ZONE_FEATURES.map((z) => ({
      type: 'Feature',
      properties: { zone: z.zone, label: z.label, accuracy: z.accuracy },
      geometry: { type: 'Polygon', coordinates: [z.ring] },
    })),
  };
}

export interface SyntheticPlot {
  id: string;
  plotLabel: string;
  zone: Zone;
  species: Species;
  lon: number;
  lat: number;
}

// 15 synthetic plots (no real plot data exists yet — season slots are minted on ENSv2, #7/#8). Spread
// across both zones and all three species so the map legend has something to show for each color.
export const SYNTHETIC_PLOTS: SyntheticPlot[] = [
  { id: 'p1', plotLabel: 'p1213-017', zone: 'karakuwa-east', species: 'scallop', lon: 141.634, lat: 38.868 },
  { id: 'p2', plotLabel: 'p1213-021', zone: 'karakuwa-east', species: 'scallop', lon: 141.641, lat: 38.874 },
  { id: 'p3', plotLabel: 'p1213-034', zone: 'karakuwa-east', species: 'hoya', lon: 141.629, lat: 38.858 },
  { id: 'p4', plotLabel: 'p1213-040', zone: 'karakuwa-east', species: 'hoya', lon: 141.647, lat: 38.862 },
  { id: 'p5', plotLabel: 'p1213-052', zone: 'karakuwa-east', species: 'oyster', lon: 141.622, lat: 38.877 },
  { id: 'p6', plotLabel: 'p1213-058', zone: 'karakuwa-east', species: 'scallop', lon: 141.652, lat: 38.855 },
  { id: 'p7', plotLabel: 'p1213-063', zone: 'karakuwa-east', species: 'hoya', lon: 141.637, lat: 38.851 },
  { id: 'p8', plotLabel: 'p1213-071', zone: 'karakuwa-east', species: 'oyster', lon: 141.618, lat: 38.867 },
  { id: 'p9', plotLabel: 'p0906-012', zone: 'kesennuma-bay', species: 'oyster', lon: 141.574, lat: 38.899 },
  { id: 'p10', plotLabel: 'p0906-019', zone: 'kesennuma-bay', species: 'oyster', lon: 141.582, lat: 38.905 },
  { id: 'p11', plotLabel: 'p0906-027', zone: 'kesennuma-bay', species: 'scallop', lon: 141.567, lat: 38.891 },
  { id: 'p12', plotLabel: 'p0906-033', zone: 'kesennuma-bay', species: 'hoya', lon: 141.578, lat: 38.884 },
  { id: 'p13', plotLabel: 'p0906-041', zone: 'kesennuma-bay', species: 'oyster', lon: 141.592, lat: 38.896 },
  { id: 'p14', plotLabel: 'p0906-047', zone: 'kesennuma-bay', species: 'scallop', lon: 141.561, lat: 38.902 },
  { id: 'p15', plotLabel: 'p0906-055', zone: 'kesennuma-bay', species: 'hoya', lon: 141.586, lat: 38.878 },
];
