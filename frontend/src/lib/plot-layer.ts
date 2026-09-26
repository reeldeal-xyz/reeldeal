// Pure helpers for the HMI farm-plots layer: styling, hover facts and the ring sent to /api/risk/heat/area.
type Point = [number, number];
type Geometry = { type: 'Polygon'; coordinates: Point[][] } | { type: 'MultiPolygon'; coordinates: Point[][][] };

export const OPERATION_COLORS: Record<string, string> = {
  longline: '#f7a32f', raft: '#e56b6f', cage: '#39b7a5', other: '#c9c9c9',
};
export const operationColor = (operation: string) => OPERATION_COLORS[operation] ?? OPERATION_COLORS.other;

const turn = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * The convex hull of every vertex as a closed ring (at most `max` points), or null for a degenerate shape.
 * Heat is sampled on a km-scale grid, so the hull loses nothing that matters, and unlike the licensed outline it is
 * always a simple ring that the area endpoint accepts (≤ 250 points, no self-intersection, no holes).
 */
export function sampleRing(geometry: Geometry, max = 250): Point[] | null {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const points = [...new Map(polygons.flatMap((polygon) => polygon[0] ?? [])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map((point) => [point.join(','), point] as const)).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (points.length < 3) return null;
  const half = (list: Point[]) => list.reduce<Point[]>((hull, point) => {
    while (hull.length >= 2 && turn(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
    hull.push(point);
    return hull;
  }, []);
  const lower = half(points);
  const upper = half([...points].reverse());
  let hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 3) return null;
  // A subset of a convex polygon's vertices is still convex, so thinning keeps the ring simple.
  if (hull.length > max - 1) hull = hull.filter((_, i) => i % Math.ceil(hull.length / (max - 1)) === 0);
  return [...hull, hull[0]];
}

export type PlotFacts = {
  plotCode: string; source: string; operation: string; species: string[]; areaM2: number; seaArea: string | null;
};
export type PlotLabels = {
  sources: Record<string, string>; operations: Record<string, string>; species: Record<string, string>;
  noSpecies: string; noSeaArea: string; hectares: string; locale: string;
};

/** Hover lines for a plot, in display order; the plot code is the tooltip title. */
export function plotFacts(plot: PlotFacts, labels: PlotLabels): string[] {
  const hectares = (plot.areaM2 / 10_000).toLocaleString(labels.locale, { maximumFractionDigits: plot.areaM2 < 100_000 ? 2 : 1 });
  return [
    labels.sources[plot.source] ?? plot.source,
    [labels.operations[plot.operation] ?? plot.operation, `${hectares} ${labels.hectares}`].join(' · '),
    plot.species.length ? plot.species.map((item) => labels.species[item] ?? item).join(', ') : labels.noSpecies,
    plot.seaArea ?? labels.noSeaArea,
  ];
}
