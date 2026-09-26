type Point = [number, number];
type Ring = Point[];

const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function onSegment(a: Point, b: Point, p: Point) {
  return Math.abs(cross(a, b, p)) < 1e-12
    && p[0] >= Math.min(a[0], b[0]) - 1e-12 && p[0] <= Math.max(a[0], b[0]) + 1e-12
    && p[1] >= Math.min(a[1], b[1]) - 1e-12 && p[1] <= Math.max(a[1], b[1]) + 1e-12;
}

function intersects(a: Point, b: Point, c: Point, d: Point) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (abC > 1e-12 && abD < -1e-12 || abC < -1e-12 && abD > 1e-12)
    && (cdA > 1e-12 && cdB < -1e-12 || cdA < -1e-12 && cdB > 1e-12)
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function simpleRing(ring: Ring, bounds: { west: number; south: number; east: number; north: number }) {
  if (ring.length < 4 || ring.length > 250 || ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) return false;
  const points = ring.slice(0, -1);
  if (new Set(points.map((point) => point.join(','))).size < 3
    || points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)
      || x < bounds.west || x > bounds.east || y < bounds.south || y > bounds.north)) return false;
  const area = points.reduce((sum, point, i) => {
    const next = points[(i + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  if (Math.abs(area) < 1e-12 || points.some((point, i) => point[0] === points[(i + 1) % points.length][0]
    && point[1] === points[(i + 1) % points.length][1])) return false;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || i === 0 && j === points.length - 1) continue;
      if (intersects(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return false;
    }
  }
  return true;
}

function contains(ring: Ring, point: Point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringsIntersect(a: Ring, b: Ring) {
  for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++)
    if (intersects(a[i], a[i + 1], b[j], b[j + 1])) return true;
  return false;
}

export function validAreaPolygon(value: unknown, bounds: { west: number; south: number; east: number; north: number }) {
  if (!Array.isArray(value) || !value.length || value.length > 50
    || !value.every((ring) => Array.isArray(ring) && ring.every((point) => Array.isArray(point)
      && point.length === 2 && typeof point[0] === 'number' && typeof point[1] === 'number'))
    || value.reduce((count, ring) => count + ring.length, 0) > 250) return false;
  const rings = value as Ring[];
  if (!rings.every((ring) => simpleRing(ring, bounds)) || rings.slice(1).some((ring) => !contains(rings[0], ring[0]))) return false;
  for (let i = 1; i < rings.length; i++) {
    if (ringsIntersect(rings[0], rings[i])) return false;
    for (let j = 1; j < i; j++) {
      if (ringsIntersect(rings[i], rings[j]) || contains(rings[j], rings[i][0]) || contains(rings[i], rings[j][0])) return false;
    }
  }
  return true;
}
