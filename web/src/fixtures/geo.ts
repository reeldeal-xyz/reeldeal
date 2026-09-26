// Placeholder zone polygons and synthetic plot points for the map (#18). Zone geometry is hand-traced
// and APPROXIMATE — issue #22 (Jay) replaces it with real fishery-map GeoJSON. Plot points are entirely
// SYNTHETIC (no real plot locations); both facts are surfaced in the UI, never silently implied as real.
import type { Species, Zone } from '@repo/shared';

export interface ZoneFeature {
  zone: Zone;
  label: string;
  /** [lon, lat][] closed ring. */
  ring: [number, number][];
}

// Rough shapes around the Karakuwa peninsula / Kesennuma Bay, Miyagi. Coordinates are illustrative only.
export const ZONE_FEATURES: ZoneFeature[] = [
  {
    zone: 'karakuwa-east',
    label: 'Karakuwa East',
    ring: [
      [141.615, 38.884],
      [141.648, 38.888],
      [141.671, 38.869],
      [141.658, 38.847],
      [141.628, 38.843],
      [141.609, 38.862],
      [141.615, 38.884],
    ],
  },
  {
    zone: 'kesennuma-bay',
    label: 'Kesennuma Bay',
    ring: [
      [141.552, 38.911],
      [141.588, 38.916],
      [141.607, 38.898],
      [141.598, 38.878],
      [141.566, 38.872],
      [141.545, 38.888],
      [141.552, 38.911],
    ],
  },
];

// Minimal local GeoJSON typing (not the `geojson` package's ambient globals) so this module has no
// extra type dependency on whatever maplibre-gl happens to hoist.
export interface ZonePolygonFeature {
  type: 'Feature';
  properties: { zone: Zone; label: string; approximate: true };
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
      properties: { zone: z.zone, label: z.label, approximate: true },
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
